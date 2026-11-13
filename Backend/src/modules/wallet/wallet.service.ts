import { Prisma, type TxType, type WalletTransaction } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma';
import { AppError, badRequest } from '../../utils/errors';

/**
 * All point movements go through this module. Rules enforced here:
 *  - every movement writes exactly one ledger row;
 *  - every movement has an idempotency key, so replays are no-ops;
 *  - balances are changed with conditional UPDATEs, so they can never go negative
 *    (the database CHECK constraints are a second line of defence);
 *  - callers pass an interactive transaction so that game/tournament state and
 *    points always change together.
 */

export interface Ref {
  refType?: string;
  refId?: string;
  note?: string;
  createdById?: string;
}

export const insufficientPoints = () => new AppError(402, 'INSUFFICIENT_POINTS', 'Not enough points');

type WalletDelta = { balance?: number; locked?: number; totalEarned?: number; totalSpent?: number };

interface Movement extends Ref {
  userId: string;
  type: TxType;
  direction: 'CREDIT' | 'DEBIT';
  amount: number;
  key: string;
  delta: WalletDelta;
  /** Minimum spendable balance / escrow required before applying. */
  requireBalance?: number;
  requireLocked?: number;
}

async function apply(tx: Tx, m: Movement): Promise<{ applied: boolean; transaction: WalletTransaction }> {
  if (!Number.isInteger(m.amount) || m.amount < 0) throw badRequest('INVALID_AMOUNT', 'Amount must be a non-negative integer');

  const existing = await tx.walletTransaction.findUnique({ where: { idempotencyKey: m.key } });
  if (existing) return { applied: false, transaction: existing };

  const data: Prisma.WalletUpdateInput = {};
  if (m.delta.balance) data.balance = { increment: m.delta.balance };
  if (m.delta.locked) data.locked = { increment: m.delta.locked };
  if (m.delta.totalEarned) data.totalEarned = { increment: m.delta.totalEarned };
  if (m.delta.totalSpent) data.totalSpent = { increment: m.delta.totalSpent };

  let wallet;
  try {
    // Single conditional UPDATE: the row is locked, checked and changed atomically.
    wallet = await tx.wallet.update({
      where: {
        userId: m.userId,
        balance: { gte: m.requireBalance ?? 0 },
        locked: { gte: m.requireLocked ?? 0 },
      },
      data,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw insufficientPoints();
    throw e;
  }

  const transaction = await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      userId: m.userId,
      type: m.type,
      direction: m.direction,
      amount: m.amount,
      balanceAfter: wallet.balance,
      lockedAfter: wallet.locked,
      idempotencyKey: m.key,
      refType: m.refType,
      refId: m.refId,
      note: m.note,
      createdById: m.createdById,
    },
  });
  return { applied: true, transaction };
}

/** Adds spendable points (bonuses, rewards, admin credits). */
export function credit(tx: Tx, userId: string, amount: number, type: TxType, key: string, ref: Ref = {}) {
  return apply(tx, { ...ref, userId, type, direction: 'CREDIT', amount, key, delta: { balance: amount, totalEarned: amount } });
}

/** Removes spendable points; fails with INSUFFICIENT_POINTS rather than going negative. */
export function debit(tx: Tx, userId: string, amount: number, type: TxType, key: string, ref: Ref = {}) {
  return apply(tx, {
    ...ref, userId, type, direction: 'DEBIT', amount, key,
    delta: { balance: -amount, totalSpent: amount },
    requireBalance: amount,
  });
}

/** Game start: moves the entry from spendable balance into escrow. */
export function lockEntry(tx: Tx, userId: string, amount: number, gameId: string) {
  return apply(tx, {
    userId, type: 'GAME_ENTRY', direction: 'DEBIT', amount, key: `game:${gameId}:entry:${userId}`,
    refType: 'game', refId: gameId,
    delta: { balance: -amount, locked: amount, totalSpent: amount },
    requireBalance: amount,
  });
}

/** Settlement for a losing player: the escrowed entry leaves the wallet for the pool. */
export function settleLoss(tx: Tx, userId: string, entry: number, gameId: string) {
  return apply(tx, {
    userId, type: 'GAME_LOSS', direction: 'DEBIT', amount: entry, key: `game:${gameId}:settle:${userId}`,
    refType: 'game', refId: gameId,
    delta: { locked: -entry },
    requireLocked: entry,
  });
}

/** Settlement for a winner: escrow is released and the prize becomes spendable. */
export function settleWin(tx: Tx, userId: string, entry: number, prize: number, gameId: string) {
  return apply(tx, {
    userId, type: 'GAME_WIN', direction: 'CREDIT', amount: prize, key: `game:${gameId}:settle:${userId}`,
    refType: 'game', refId: gameId,
    delta: { locked: -entry, balance: prize, totalEarned: prize },
    requireLocked: entry,
  });
}

/** Cancelled game: the escrowed entry goes back to the spendable balance. */
export function refundEntry(tx: Tx, userId: string, entry: number, gameId: string, note?: string) {
  return apply(tx, {
    userId, type: 'REFUND', direction: 'CREDIT', amount: entry, key: `game:${gameId}:refund:${userId}`,
    refType: 'game', refId: gameId, note,
    delta: { locked: -entry, balance: entry, totalSpent: -entry },
    requireLocked: entry,
  });
}

/** Creates the wallet if missing and credits the welcome bonus exactly once per user. */
export async function grantWelcomeBonus(tx: Tx, userId: string, amount: number): Promise<boolean> {
  await tx.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
  // Atomic flag flip: only one concurrent caller can win this UPDATE.
  const flipped = await tx.user.updateMany({ where: { id: userId, welcomeBonusGranted: false }, data: { welcomeBonusGranted: true } });
  if (flipped.count !== 1) return false;
  if (amount <= 0) return true;
  const r = await credit(tx, userId, amount, 'WELCOME_BONUS', `welcome:${userId}`, { note: 'Welcome bonus' });
  return r.applied;
}

export async function getWallet(userId: string) {
  const w = await prisma.wallet.findUnique({ where: { userId } });
  if (!w) throw badRequest('NO_WALLET', 'Wallet not found');
  return { balance: w.balance, locked: w.locked, totalEarned: w.totalEarned, totalSpent: w.totalSpent };
}

export async function listTransactions(
  userId: string,
  opts: { type?: TxType; from?: Date; to?: Date; skip: number; take: number },
) {
  const where: Prisma.WalletTransactionWhereInput = {
    userId,
    ...(opts.type ? { type: opts.type } : {}),
    ...(opts.from || opts.to ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: opts.skip, take: opts.take,
      select: { id: true, type: true, direction: true, amount: true, balanceAfter: true, lockedAfter: true, refType: true, refId: true, note: true, createdAt: true },
    }),
    prisma.walletTransaction.count({ where }),
  ]);
  return { items, total };
}
