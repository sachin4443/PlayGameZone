import { randomInt } from 'crypto';
import { prisma, type Tx } from '../../lib/prisma';
import { realtime } from '../../services/realtime';
import { badRequest, conflict, notFound } from '../../utils/errors';
import { gameManager } from '../games/game.manager';
import { startDirectGame, type SettleOutcome } from '../games/games.service';
import { notify } from '../notifications/notifications.service';
import { credit, debit } from '../wallet/wallet.service';

/**
 * Single-elimination tournaments made of two-player matches. Entries are debited
 * on registration and held by the tournament; prizes are paid when the final
 * ends. Every point movement uses the shared wallet ledger with idempotency keys.
 */

export async function listTournaments() {
  const rows = await prisma.tournament.findMany({
    orderBy: [{ startsAt: 'desc' }], take: 50,
    include: { mode: { select: { key: true, name: true } }, _count: { select: { players: true } } },
  });
  return rows.map((t) => ({
    id: t.id, name: t.name, description: t.description, mode: t.mode, entryPoints: t.entryPoints, capacity: t.capacity,
    registered: t._count.players, prizePool: t.entryPoints * t._count.players + t.bonusPool, prizeSplit: t.prizeSplit,
    status: t.status, startsAt: t.startsAt, endedAt: t.endedAt, winnerId: t.winnerId,
  }));
}

export async function getTournament(id: string, viewerId?: string) {
  const t = await prisma.tournament.findUnique({
    where: { id },
    include: {
      mode: { select: { key: true, name: true } },
      players: { orderBy: { createdAt: 'asc' }, include: { user: { select: { profile: { select: { displayName: true, avatar: true } } } } } },
      matches: { orderBy: [{ round: 'asc' }, { index: 'asc' }], include: { game: { select: { id: true, status: true } } } },
    },
  });
  if (!t) throw notFound('Tournament');
  const names = new Map(t.players.map((p) => [p.userId, { name: p.user.profile?.displayName ?? 'Player', avatar: p.user.profile?.avatar ?? 'a1' }]));
  const who = (id: string | null) => (id ? { userId: id, ...(names.get(id) ?? { name: 'Player', avatar: 'a1' }) } : null);
  return {
    id: t.id, name: t.name, description: t.description, mode: t.mode, entryPoints: t.entryPoints, capacity: t.capacity,
    registered: t.players.length, prizePool: t.entryPoints * t.players.length + t.bonusPool, bonusPool: t.bonusPool, prizeSplit: t.prizeSplit,
    status: t.status, startsAt: t.startsAt, startedAt: t.startedAt, endedAt: t.endedAt, totalRounds: t.totalRounds, currentRound: t.currentRound,
    winner: who(t.winnerId),
    isRegistered: viewerId ? t.players.some((p) => p.userId === viewerId) : false,
    players: t.players.map((p) => ({ userId: p.userId, ...names.get(p.userId)!, status: p.status, finalRank: p.finalRank, prize: p.prize })),
    matches: t.matches.map((m) => ({
      id: m.id, round: m.round, index: m.index, status: m.status, player1: who(m.player1Id), player2: who(m.player2Id), winnerId: m.winnerId,
      gameId: m.game?.id ?? null, gameStatus: m.game?.status ?? null,
    })),
  };
}

export async function registerForTournament(userId: string, tournamentId: string) {
  await prisma.$transaction(async (tx) => {
    // Row lock so capacity cannot be oversold by concurrent registrations.
    await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE`;
    const t = await tx.tournament.findUnique({ where: { id: tournamentId }, include: { _count: { select: { players: true } } } });
    if (!t) throw notFound('Tournament');
    if (t.status !== 'UPCOMING' || t.startsAt <= new Date()) throw conflict('REGISTRATION_CLOSED', 'Registration is closed');
    if (t._count.players >= t.capacity) throw conflict('TOURNAMENT_FULL', 'This tournament is full');
    if (await tx.tournamentPlayer.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } })) {
      throw conflict('ALREADY_REGISTERED', 'You are already registered');
    }
    const tp = await tx.tournamentPlayer.create({ data: { tournamentId, userId } });
    if (t.entryPoints > 0) {
      await debit(tx, userId, t.entryPoints, 'TOURNAMENT_ENTRY', `tournament:${tournamentId}:entry:${tp.id}`, { refType: 'tournament', refId: tournamentId, note: t.name });
    }
  });
  realtime.toUser(userId, 'wallet-update', {});
}

async function refundPlayer(tx: Tx, t: { id: string; name: string; entryPoints: number }, tp: { id: string; userId: string }) {
  if (t.entryPoints > 0) {
    await credit(tx, tp.userId, t.entryPoints, 'REFUND', `tournament:${t.id}:refund:${tp.id}`, { refType: 'tournament', refId: t.id, note: `${t.name} refund` });
    // A refund is returned money, not income.
    await tx.wallet.update({ where: { userId: tp.userId }, data: { totalEarned: { decrement: t.entryPoints }, totalSpent: { decrement: t.entryPoints } } });
  }
}

export async function unregisterFromTournament(userId: string, tournamentId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE`;
    const t = await tx.tournament.findUnique({ where: { id: tournamentId } });
    if (!t) throw notFound('Tournament');
    if (t.status !== 'UPCOMING') throw conflict('TOURNAMENT_STARTED', 'The tournament has already started');
    const tp = await tx.tournamentPlayer.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } });
    if (!tp) throw badRequest('NOT_REGISTERED', 'You are not registered');
    await refundPlayer(tx, t, tp);
    await tx.tournamentPlayer.delete({ where: { id: tp.id } });
  });
  realtime.toUser(userId, 'wallet-update', {});
}

export async function cancelTournament(tournamentId: string, reason: string) {
  const userIds = await prisma.$transaction(async (tx) => {
    const claimed = await tx.tournament.updateMany({ where: { id: tournamentId, status: 'UPCOMING' }, data: { status: 'CANCELLED', endedAt: new Date() } });
    if (claimed.count !== 1) throw conflict('NOT_CANCELLABLE', 'Only upcoming tournaments can be cancelled');
    const t = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId }, include: { players: true } });
    for (const tp of t.players) await refundPlayer(tx, t, tp);
    return t.players.map((p) => p.userId);
  });
  for (const userId of userIds) {
    realtime.toUser(userId, 'wallet-update', {});
    await notify(userId, { type: 'TOURNAMENT_CANCELLED', title: 'Tournament cancelled', body: `Your entry was refunded. ${reason}`.trim(), data: { tournamentId } });
  }
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Builds the bracket and launches round one. Cancels (with refunds) if fewer than two players registered. */
export async function startTournament(tournamentId: string): Promise<'started' | 'cancelled' | 'skipped'> {
  const count = await prisma.tournamentPlayer.count({ where: { tournamentId } });
  if (count < 2) {
    try {
      await cancelTournament(tournamentId, 'Not enough players registered.');
      return 'cancelled';
    } catch {
      return 'skipped';
    }
  }
  const started = await prisma.$transaction(async (tx) => {
    const claimed = await tx.tournament.updateMany({ where: { id: tournamentId, status: 'UPCOMING' }, data: { status: 'RUNNING', startedAt: new Date(), currentRound: 1 } });
    if (claimed.count !== 1) return false;
    const players = shuffle(await tx.tournamentPlayer.findMany({ where: { tournamentId } }));
    const n = players.length;
    let size = 2;
    while (size < n) size *= 2;
    const totalRounds = Math.log2(size);
    const byes = size - n;

    // First `byes` players advance without playing; the rest are paired.
    const firstRound: { p1: string; p2: string | null }[] = [];
    for (let i = 0; i < byes; i++) firstRound.push({ p1: players[i].userId, p2: null });
    for (let i = byes; i < n; i += 2) firstRound.push({ p1: players[i].userId, p2: players[i + 1].userId });
    const ordered = shuffle(firstRound);

    await tx.tournamentMatch.createMany({
      data: ordered.map((m, index) => ({
        tournamentId, round: 1, index, player1Id: m.p1, player2Id: m.p2,
        status: m.p2 ? ('PENDING' as const) : ('BYE' as const), winnerId: m.p2 ? null : m.p1, completedAt: m.p2 ? null : new Date(),
      })),
    });
    for (let round = 2; round <= totalRounds; round++) {
      await tx.tournamentMatch.createMany({
        data: Array.from({ length: size / 2 ** round }, (_, index) => ({ tournamentId, round, index })),
      });
    }
    // Byes feed straight into round two.
    for (const [index, m] of ordered.entries()) {
      if (!m.p2 && totalRounds > 1) await placeInNextRound(tx, tournamentId, 1, index, m.p1);
    }
    await tx.tournament.update({ where: { id: tournamentId }, data: { totalRounds } });
    await tx.tournamentPlayer.updateMany({ where: { tournamentId }, data: { status: 'ACTIVE' } });
    return true;
  });
  if (!started) return 'skipped';
  await launchReadyMatches(tournamentId);
  return 'started';
}

async function placeInNextRound(tx: Tx, tournamentId: string, round: number, index: number, userId: string) {
  await tx.tournamentMatch.update({
    where: { tournamentId_round_index: { tournamentId, round: round + 1, index: Math.floor(index / 2) } },
    data: index % 2 === 0 ? { player1Id: userId } : { player2Id: userId },
  });
}

/** Starts a game for every match that has both players and has not begun. */
async function launchReadyMatches(tournamentId: string) {
  const t = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  if (t.status !== 'RUNNING') return;
  const ready = await prisma.tournamentMatch.findMany({ where: { tournamentId, status: 'PENDING', player1Id: { not: null }, player2Id: { not: null } } });
  for (const m of ready) {
    const claimed = await prisma.tournamentMatch.updateMany({ where: { id: m.id, status: 'PENDING' }, data: { status: 'IN_PROGRESS', scheduledAt: new Date() } });
    if (claimed.count !== 1) continue;
    const started = await startDirectGame({ modeId: t.modeId, userIds: [m.player1Id!, m.player2Id!], tournamentMatchId: m.id }, gameManager.rng);
    await gameManager.register(started);
    for (const userId of started.userIds) {
      await notify(userId, { type: 'TOURNAMENT_MATCH', title: `${t.name}: your match is ready`, body: `Round ${m.round} has started. Join now, the turn timer is running.`, data: { gameId: started.gameId, tournamentId } });
      realtime.toUser(userId, 'match-ready', { gameId: started.gameId, tournamentId, round: m.round });
    }
  }
}

/** Called for every settled game; advances the bracket when it was a tournament match. */
export async function onGameSettled(outcome: SettleOutcome) {
  if (!outcome.tournamentMatchId) return;
  const ranked = [...outcome.payouts].sort((a, b) => a.rank - b.rank);
  const winnerId = ranked[0].userId;
  const loserId = ranked[1]?.userId;

  const finished = await prisma.$transaction(async (tx) => {
    const claimed = await tx.tournamentMatch.updateMany({ where: { id: outcome.tournamentMatchId!, status: 'IN_PROGRESS' }, data: { status: 'COMPLETED', winnerId, completedAt: new Date() } });
    if (claimed.count !== 1) return null;
    const m = await tx.tournamentMatch.findUniqueOrThrow({ where: { id: outcome.tournamentMatchId! }, include: { tournament: true } });
    const t = m.tournament;
    if (loserId) {
      // Final loser is 2nd, semi-final losers share 3rd, and so on down the bracket.
      const finalRank = m.round === t.totalRounds ? 2 : 2 ** (t.totalRounds - m.round) + 1;
      await tx.tournamentPlayer.updateMany({ where: { tournamentId: t.id, userId: loserId }, data: { status: 'ELIMINATED', finalRank } });
    }
    if (m.round < t.totalRounds) {
      await placeInNextRound(tx, t.id, m.round, m.index, winnerId);
      const open = await tx.tournamentMatch.count({ where: { tournamentId: t.id, round: m.round, status: { in: ['PENDING', 'IN_PROGRESS'] } } });
      if (open === 0) await tx.tournament.update({ where: { id: t.id }, data: { currentRound: m.round + 1 } });
      return { tournamentId: t.id, done: false as const };
    }

    // Final: close the tournament and pay the prizes.
    await tx.tournamentPlayer.updateMany({ where: { tournamentId: t.id, userId: winnerId }, data: { status: 'WINNER', finalRank: 1 } });
    await tx.tournament.update({ where: { id: t.id }, data: { status: 'COMPLETED', endedAt: new Date(), winnerId } });
    const players = await tx.tournamentPlayer.findMany({ where: { tournamentId: t.id }, orderBy: [{ finalRank: 'asc' }, { createdAt: 'asc' }] });
    const pool = t.entryPoints * players.length + t.bonusPool;
    const split = Array.isArray(t.prizeSplit) ? (t.prizeSplit as number[]) : [100];
    const paid: { userId: string; prize: number; rank: number }[] = [];
    for (const [i, pct] of split.entries()) {
      const tp = players[i];
      if (!tp || tp.finalRank === null) break;
      const prize = Math.floor((pool * pct) / 100);
      if (prize <= 0) continue;
      await credit(tx, tp.userId, prize, 'TOURNAMENT_REWARD', `tournament:${t.id}:reward:${tp.userId}`, { refType: 'tournament', refId: t.id, note: `${t.name} – place ${i + 1}` });
      await tx.tournamentPlayer.update({ where: { id: tp.id }, data: { prize } });
      paid.push({ userId: tp.userId, prize, rank: i + 1 });
    }
    return { tournamentId: t.id, done: true as const, name: t.name, paid };
  });

  if (!finished) return;
  if (finished.done) {
    for (const p of finished.paid) {
      realtime.toUser(p.userId, 'wallet-update', {});
      await notify(p.userId, { type: 'TOURNAMENT_PRIZE', title: `${finished.name}: you won ${p.prize} points`, body: `You finished in place ${p.rank}.`, data: { tournamentId: finished.tournamentId } });
    }
  } else {
    await launchReadyMatches(finished.tournamentId);
  }
}

/** Starts tournaments whose start time has arrived. */
export async function startDueTournaments(): Promise<number> {
  const due = await prisma.tournament.findMany({ where: { status: 'UPCOMING', startsAt: { lte: new Date() } }, select: { id: true }, take: 20 });
  for (const t of due) await startTournament(t.id).catch((e) => console.error('[tournament] start failed', t.id, e));
  return due.length;
}
