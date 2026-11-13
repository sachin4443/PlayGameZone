import type { Prisma } from '@prisma/client';
import { getSettings } from '../../config/settings';
import { prisma, type Tx } from '../../lib/prisma';
import { realtime } from '../../services/realtime';
import { AppError, badRequest, conflict, notFound } from '../../utils/errors';
import { notify } from '../notifications/notifications.service';
import { credit, lockEntry, refundEntry, settleLoss, settleWin } from '../wallet/wallet.service';
import { createGame, type GameState, type Rng } from './engine/engine';
import { resolveRules } from './engine/rules';

/**
 * Database side of a game's life-cycle: creation with entry escrow, settlement
 * and cancellation/refund. Each of the three is one transaction, and the two
 * terminal operations are guarded so that exactly one of them can ever apply.
 */

export interface StartedGame {
  gameId: string;
  state: GameState;
  userIds: string[];
  roomCode?: string;
}

export class InsufficientPlayerPoints extends AppError {
  constructor(public userId: string, name: string) {
    super(402, 'PLAYER_INSUFFICIENT_POINTS', `${name} does not have enough points for this room`);
  }
}

interface Seat { userId: string; name: string; avatar: string }

async function createGameTx(
  tx: Tx,
  args: { modeId: number; modeKey: string; modeRules: unknown; entryPoints: number; seats: Seat[]; roomId?: string; tournamentMatchId?: string; commissionPct: number },
  rng: Rng,
) {
  const { seats, entryPoints } = args;
  const game = await tx.game.create({
    data: {
      roomId: args.roomId,
      tournamentMatchId: args.tournamentMatchId,
      modeId: args.modeId,
      playerCount: seats.length,
      entryPoints,
      pool: entryPoints * seats.length,
      commissionPct: args.commissionPct,
    },
  });

  // Escrow: every player's entry leaves their spendable balance now.
  if (entryPoints > 0) {
    for (const seat of seats) {
      try {
        await lockEntry(tx, seat.userId, entryPoints, game.id);
      } catch (e) {
        if (e instanceof AppError && e.code === 'INSUFFICIENT_POINTS') throw new InsufficientPlayerPoints(seat.userId, seat.name);
        throw e;
      }
    }
  }

  const state = createGame(resolveRules(args.modeKey, args.modeRules), seats, rng, Date.now());
  await tx.gamePlayer.createMany({
    data: state.players.map((p) => ({ gameId: game.id, userId: p.userId, seat: p.seat, color: p.color, entryPaid: entryPoints })),
  });
  await tx.gameState.create({ data: { gameId: game.id, state: state as unknown as Prisma.InputJsonValue } });
  return { game, state };
}

/** Turns a waiting room into a running game. All-or-nothing. */
export async function startRoomGame(roomId: string, rng: Rng): Promise<StartedGame> {
  const settings = await getSettings();
  return prisma.$transaction(async (tx) => {
    // The conditional update is the lock: only one caller can move WAITING → IN_GAME.
    const claimed = await tx.gameRoom.updateMany({ where: { id: roomId, status: 'WAITING' }, data: { status: 'IN_GAME', expiresAt: null } });
    if (claimed.count !== 1) throw conflict('ROOM_NOT_WAITING', 'This room has already started or closed');

    const room = await tx.gameRoom.findUniqueOrThrow({
      where: { id: roomId },
      include: { mode: true, players: { orderBy: { seat: 'asc' }, include: { user: { include: { profile: true } } } } },
    });
    if (room.players.length < 2) throw badRequest('NOT_ENOUGH_PLAYERS', 'At least two players are needed');

    const seats = room.players.map((p) => ({
      userId: p.userId,
      name: p.user.profile?.displayName ?? 'Player',
      avatar: p.user.profile?.avatar ?? 'a1',
    }));
    const { game, state } = await createGameTx(
      tx,
      { modeId: room.modeId, modeKey: room.mode.key, modeRules: room.mode.rules, entryPoints: room.entryPoints, seats, roomId, commissionPct: settings.platformCommissionPct },
      rng,
    );
    return { gameId: game.id, state, userIds: seats.map((s) => s.userId), roomCode: room.code };
  });
}

/** Starts a game that is not attached to a room (tournament matches; no entry escrow). */
export async function startDirectGame(args: { modeId: number; userIds: string[]; tournamentMatchId?: string }, rng: Rng): Promise<StartedGame> {
  return prisma.$transaction(async (tx) => {
    const mode = await tx.gameMode.findUniqueOrThrow({ where: { id: args.modeId } });
    const users = await tx.user.findMany({ where: { id: { in: args.userIds } }, include: { profile: true } });
    const seats = args.userIds.map((id) => {
      const u = users.find((x) => x.id === id);
      if (!u) throw notFound('Player');
      return { userId: id, name: u.profile?.displayName ?? 'Player', avatar: u.profile?.avatar ?? 'a1' };
    });
    const { game, state } = await createGameTx(
      tx,
      { modeId: mode.id, modeKey: mode.key, modeRules: mode.rules, entryPoints: 0, seats, tournamentMatchId: args.tournamentMatchId, commissionPct: 0 },
      rng,
    );
    return { gameId: game.id, state, userIds: args.userIds };
  });
}

export interface Payout { userId: string; seat: number; rank: number; isWinner: boolean; score: number; pointsWon: number; entryPaid: number }
export interface SettleOutcome { gameId: string; pool: number; commission: number; payouts: Payout[]; tournamentMatchId: string | null }

/**
 * Pays out a finished game. Idempotent: the Game row can leave ACTIVE only once,
 * and each wallet movement carries its own idempotency key as a second guard.
 * Returns null when the game was already settled or cancelled.
 */
export async function settleGame(gameId: string, state: GameState): Promise<SettleOutcome | null> {
  const result = state.result;
  if (!result) throw new Error('Cannot settle a game that has not finished');
  const settings = await getSettings();

  const outcome = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.game.updateMany({ where: { id: gameId, status: 'ACTIVE', settledAt: null }, data: { status: 'FINISHED', endedAt: now, settledAt: now } });
    if (claimed.count !== 1) return null;

    const game = await tx.game.findUniqueOrThrow({ where: { id: gameId }, include: { players: true } });
    const pool = game.players.reduce((sum, p) => sum + p.entryPaid, 0);
    const baseCommission = Math.floor((pool * game.commissionPct) / 100);
    const winners = result.winners;
    const share = Math.floor((pool - baseCommission) / winners.length);
    // Points that cannot be split evenly between tied winners stay with the platform.
    const commission = pool - share * winners.length;

    const payouts: Payout[] = [];
    for (const gp of game.players) {
      const ps = state.players.find((p) => p.seat === gp.seat)!;
      const isWinner = winners.includes(gp.seat);
      const pointsWon = isWinner ? share : 0;
      if (gp.entryPaid > 0 || pointsWon > 0) {
        if (isWinner) await settleWin(tx, gp.userId, gp.entryPaid, pointsWon, gameId);
        else await settleLoss(tx, gp.userId, gp.entryPaid, gameId);
      }
      payouts.push({ userId: gp.userId, seat: gp.seat, rank: result.ranking.indexOf(gp.seat) + 1, isWinner, score: ps.score, pointsWon, entryPaid: gp.entryPaid });
      await tx.gamePlayer.update({ where: { id: gp.id }, data: { status: ps.active ? 'FINISHED' : 'LEFT' } });
    }
    await tx.gameResult.createMany({
      data: payouts.map((p) => ({ gameId, userId: p.userId, rank: p.rank, isWinner: p.isWinner, score: p.score, entryPaid: p.entryPaid, pointsWon: p.pointsWon })),
    });
    await tx.game.update({ where: { id: gameId }, data: { commissionAmount: commission } });
    await tx.gameState.update({ where: { gameId }, data: { state: state as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
    if (game.roomId) await tx.gameRoom.update({ where: { id: game.roomId }, data: { status: 'COMPLETED' } });

    // Referral rewards unlock when the invited player completes a first game.
    const finishers = state.players.filter((p) => p.active).map((p) => p.userId);
    const pending = await tx.referral.findMany({ where: { refereeId: { in: finishers }, status: 'PENDING' } });
    for (const ref of pending) {
      const flipped = await tx.referral.updateMany({
        where: { id: ref.id, status: 'PENDING' },
        data: { status: 'REWARDED', rewardedAt: now, referrerReward: settings.referrerRewardPoints, refereeReward: settings.refereeRewardPoints },
      });
      if (flipped.count !== 1) continue;
      if (settings.referrerRewardPoints > 0)
        await credit(tx, ref.referrerId, settings.referrerRewardPoints, 'REFERRAL_BONUS', `referral:${ref.id}:referrer`, { refType: 'referral', refId: ref.id, note: 'Referral reward' });
      if (settings.refereeRewardPoints > 0)
        await credit(tx, ref.refereeId, settings.refereeRewardPoints, 'REFERRAL_BONUS', `referral:${ref.id}:referee`, { refType: 'referral', refId: ref.id, note: 'Referral joining reward' });
      payoutsExtra.push(ref.referrerId);
    }

    return { gameId, pool, commission, payouts, tournamentMatchId: game.tournamentMatchId };
  });

  if (outcome) {
    for (const p of outcome.payouts) realtime.toUser(p.userId, 'wallet-update', {});
    for (const id of payoutsExtra.splice(0)) realtime.toUser(id, 'wallet-update', {});
  }
  return outcome;
}
const payoutsExtra: string[] = [];

/**
 * Cancels a running game and refunds every escrowed entry. Idempotent, and
 * mutually exclusive with settleGame through the same status guard.
 */
export async function cancelGame(gameId: string, reason: string): Promise<{ userIds: string[]; tournamentMatchId: string | null } | null> {
  const out = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.game.updateMany({
      where: { id: gameId, status: 'ACTIVE', settledAt: null },
      data: { status: 'CANCELLED', endedAt: now, settledAt: now, cancelReason: reason },
    });
    if (claimed.count !== 1) return null;
    const game = await tx.game.findUniqueOrThrow({ where: { id: gameId }, include: { players: true } });
    for (const gp of game.players) {
      if (gp.entryPaid > 0) await refundEntry(tx, gp.userId, gp.entryPaid, gameId, reason);
    }
    if (game.roomId) await tx.gameRoom.update({ where: { id: game.roomId }, data: { status: 'CANCELLED' } });
    return { userIds: game.players.map((p) => p.userId), tournamentMatchId: game.tournamentMatchId };
  });
  if (out) {
    for (const userId of out.userIds) {
      realtime.toUser(userId, 'wallet-update', {});
      await notify(userId, { type: 'GAME_CANCELLED', title: 'Game cancelled', body: `Your game was cancelled and your entry was refunded. ${reason}`.trim(), data: { gameId } });
    }
  }
  return out;
}
