import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../utils/errors';
import { h, pageParams } from '../../utils/http';
import { resolveRules } from './engine/rules';
import { gameManager } from './game.manager';

export const gamesRouter = Router();

gamesRouter.get('/modes', h(async (_req, res) => {
  const modes = await prisma.gameMode.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  res.json({
    items: modes.map((m) => ({
      key: m.key, name: m.name, tagline: m.tagline, description: m.description,
      minEntry: m.minEntry, maxEntry: m.maxEntry, allowedPlayers: m.allowedPlayers,
      rules: resolveRules(m.key, m.rules),
    })),
  });
}));

/** Games being played right now (anyone signed in may watch). */
gamesRouter.get('/live', h(async (_req, res) => {
  const games = await prisma.game.findMany({
    where: { status: 'ACTIVE' }, orderBy: { startedAt: 'desc' }, take: 20,
    include: { mode: { select: { key: true, name: true } }, players: { orderBy: { seat: 'asc' }, include: { user: { select: { profile: { select: { displayName: true, avatar: true } } } } } } },
  });
  res.json({
    items: games.map((g) => ({
      id: g.id, mode: g.mode, pool: g.pool, entryPoints: g.entryPoints, startedAt: g.startedAt, isTournament: !!g.tournamentMatchId,
      players: g.players.map((p) => ({ name: p.user.profile?.displayName ?? 'Player', avatar: p.user.profile?.avatar ?? 'a1', color: p.color })),
    })),
  });
}));

gamesRouter.get('/history', h(async (req, res) => {
  const p = pageParams(req.query, 50);
  const where = { userId: req.user!.id };
  const [rows, total] = await Promise.all([
    prisma.gameResult.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take,
      include: { game: { select: { id: true, pool: true, playerCount: true, tournamentMatchId: true, mode: { select: { key: true, name: true } } } } },
    }),
    prisma.gameResult.count({ where }),
  ]);
  res.json({
    total, page: p.page, pageSize: p.pageSize,
    items: rows.map((r) => ({
      gameId: r.gameId, mode: r.game.mode, playerCount: r.game.playerCount, pool: r.game.pool, isTournament: !!r.game.tournamentMatchId,
      rank: r.rank, isWinner: r.isWinner, score: r.score, entryPaid: r.entryPaid, pointsWon: r.pointsWon, playedAt: r.createdAt,
    })),
  });
}));

/** Current snapshot (live from memory, or the final persisted state). */
gamesRouter.get('/:id', h(async (req, res) => {
  const game = await prisma.game.findUnique({
    where: { id: req.params.id },
    include: { mode: { select: { key: true, name: true } }, state: true, results: true },
  });
  if (!game) throw notFound('Game');
  res.json({
    id: game.id, status: game.status, mode: game.mode, pool: game.pool, entryPoints: game.entryPoints,
    commissionPct: game.commissionPct, cancelReason: game.cancelReason, isTournament: !!game.tournamentMatchId,
    state: gameManager.getState(game.id) ?? game.state?.state ?? null,
    results: game.results.map((r) => ({ userId: r.userId, rank: r.rank, isWinner: r.isWinner, score: r.score, pointsWon: r.pointsWon, entryPaid: r.entryPaid })),
    serverTime: Date.now(),
  });
}));
