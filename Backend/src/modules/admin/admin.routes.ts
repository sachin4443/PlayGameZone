import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { SETTING_DEFS, type SettingKey, getSettings, invalidateSettings } from '../../config/settings';
import { prisma } from '../../lib/prisma';
import { requireAuth, requireRole } from '../../middlewares/auth';
import { adminAuthLimiter } from '../../middlewares/rateLimit';
import { realtime } from '../../services/realtime';
import { badRequest, conflict, notFound } from '../../utils/errors';
import { h, pageParams, parse } from '../../utils/http';
import { getMe, staffLogin } from '../auth/auth.service';
import { PRESET_KEYS, resolveRules } from '../games/engine/rules';
import { gameManager } from '../games/game.manager';
import { cancelTournament, getTournament, listTournaments, startTournament } from '../tournaments/tournaments.service';
import { credit, debit, listTransactions } from '../wallet/wallet.service';

export const adminRouter = Router();

/** Every sensitive staff action is recorded with who, what, on what and from where. */
async function audit(req: Request, action: string, target: { type?: string; id?: string }, details?: Prisma.InputJsonValue) {
  await prisma.adminAuditLog.create({ data: { adminId: req.user!.id, action, targetType: target.type, targetId: target.id, details, ip: req.ip } });
}

adminRouter.post('/auth/login', adminAuthLimiter, h(async (req, res) => {
  const body = parse(z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(200) }), req.body);
  res.json(await staffLogin(body.username, body.password));
}));

// Everything below needs a staff token.
adminRouter.use(requireAuth);
const anyStaff = requireRole('SUPER_ADMIN', 'ADMIN', 'SUPPORT');
const adminUp = requireRole('SUPER_ADMIN', 'ADMIN');
const superOnly = requireRole('SUPER_ADMIN');

adminRouter.get('/me', anyStaff, h(async (req, res) => res.json(await getMe(req.user!.id))));

adminRouter.get('/dashboard', anyStaff, h(async (_req, res) => {
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const players = { mobile: { not: null } };
  const [totalUsers, activeUsers, blockedUsers, games, wallets, issued, rooms, tournaments] = await Promise.all([
    prisma.user.count({ where: players }),
    prisma.user.count({ where: { ...players, lastSeenAt: { gte: dayAgo } } }),
    prisma.user.count({ where: { ...players, status: 'BLOCKED' } }),
    prisma.game.groupBy({ by: ['status'], _count: true, _sum: { commissionAmount: true } }),
    prisma.wallet.aggregate({ _sum: { balance: true, locked: true } }),
    prisma.walletTransaction.aggregate({ where: { type: { in: ['WELCOME_BONUS', 'ADMIN_CREDIT', 'REFERRAL_BONUS'] } }, _sum: { amount: true } }),
    prisma.gameRoom.count({ where: { status: 'WAITING' } }),
    prisma.tournament.count({ where: { status: { in: ['UPCOMING', 'RUNNING'] } } }),
  ]);
  const count = (s: string) => games.find((g) => g.status === s)?._count ?? 0;
  res.json({
    totalUsers, activeUsers, blockedUsers,
    totalGames: games.reduce((n, g) => n + g._count, 0),
    liveGames: count('ACTIVE'), completedGames: count('FINISHED'), cancelledGames: count('CANCELLED'),
    pointsIssued: issued._sum.amount ?? 0,
    pointsInCirculation: (wallets._sum.balance ?? 0) + (wallets._sum.locked ?? 0),
    pointsInEscrow: wallets._sum.locked ?? 0,
    commissionEarned: games.reduce((n, g) => n + (g._sum.commissionAmount ?? 0), 0),
    waitingRooms: rooms, openTournaments: tournaments,
  });
}));

// ── Users ─────────────────────────────────────────────────────────

adminRouter.get('/users', anyStaff, h(async (req, res) => {
  const q = parse(z.object({ search: z.string().trim().max(40).optional(), status: z.enum(['ACTIVE', 'BLOCKED']).optional() }), req.query);
  const p = pageParams(req.query);
  const where: Prisma.UserWhereInput = {
    mobile: { not: null },
    ...(q.status ? { status: q.status } : {}),
    ...(q.search ? { OR: [{ mobile: { contains: q.search } }, { profile: { displayName: { contains: q.search, mode: 'insensitive' } } }, { referralCode: q.search.toUpperCase() }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: { profile: true, wallet: true } }),
    prisma.user.count({ where }),
  ]);
  res.json({
    total, page: p.page, pageSize: p.pageSize,
    items: rows.map((u) => ({ id: u.id, mobile: u.mobile, name: u.profile?.displayName, avatar: u.profile?.avatar, status: u.status, balance: u.wallet?.balance ?? 0, locked: u.wallet?.locked ?? 0, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt })),
  });
}));

adminRouter.get('/users/:id', anyStaff, h(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.params.id }, include: { profile: true, wallet: true, referredBy: { include: { referrer: { select: { mobile: true } } } } } });
  if (!u) throw notFound('User');
  const [matches, wins, recent] = await Promise.all([
    prisma.gameResult.count({ where: { userId: u.id } }),
    prisma.gameResult.count({ where: { userId: u.id, isWinner: true } }),
    prisma.gameResult.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 10, include: { game: { select: { mode: { select: { name: true } }, pool: true } } } }),
  ]);
  res.json({
    id: u.id, mobile: u.mobile, name: u.profile?.displayName, avatar: u.profile?.avatar, status: u.status, referralCode: u.referralCode,
    referredBy: u.referredBy?.referrer.mobile ?? null, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
    wallet: u.wallet ? { balance: u.wallet.balance, locked: u.wallet.locked, totalEarned: u.wallet.totalEarned, totalSpent: u.wallet.totalSpent } : null,
    stats: { matches, wins },
    recentGames: recent.map((r) => ({ gameId: r.gameId, mode: r.game.mode.name, pool: r.game.pool, isWinner: r.isWinner, pointsWon: r.pointsWon, entryPaid: r.entryPaid, playedAt: r.createdAt })),
  });
}));

adminRouter.get('/users/:id/transactions', anyStaff, h(async (req, res) => {
  const p = pageParams(req.query);
  const { items, total } = await listTransactions(req.params.id, { skip: p.skip, take: p.take });
  res.json({ items, total, page: p.page, pageSize: p.pageSize });
}));

adminRouter.post('/users/:id/status', adminUp, h(async (req, res) => {
  const { status, reason } = parse(z.object({ status: z.enum(['ACTIVE', 'BLOCKED']), reason: z.string().trim().max(200).default('') }), req.body);
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, mobile: true } });
  if (!user || !user.mobile) throw notFound('User');
  await prisma.user.update({ where: { id: user.id }, data: { status } });
  if (status === 'BLOCKED') realtime.kick(user.id);
  await audit(req, status === 'BLOCKED' ? 'USER_BLOCK' : 'USER_UNBLOCK', { type: 'user', id: user.id }, { reason });
  res.json({ ok: true });
}));

const adjustSchema = z.object({
  direction: z.enum(['CREDIT', 'DEBIT']),
  amount: z.number().int().min(1).max(1_000_000),
  reason: z.string().trim().min(3, 'A reason is required').max(200),
  /** Client-generated id: re-submitting the same request never applies twice. */
  requestId: z.string().uuid().optional(),
});

adminRouter.post('/users/:id/wallet-adjust', adminUp, h(async (req, res) => {
  const body = parse(adjustSchema, req.body);
  const userId = req.params.id;
  const key = `admin:${body.requestId ?? randomUUID()}`;
  const result = await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) throw notFound('Wallet');
    const ref = { refType: 'admin', refId: req.user!.id, note: body.reason, createdById: req.user!.id };
    const r = body.direction === 'CREDIT'
      ? await credit(tx, userId, body.amount, 'ADMIN_CREDIT', key, ref)
      : await debit(tx, userId, body.amount, 'ADMIN_DEBIT', key, ref);
    if (r.applied) {
      await tx.adminAuditLog.create({
        data: { adminId: req.user!.id, action: `WALLET_${body.direction}`, targetType: 'user', targetId: userId, ip: req.ip, details: { amount: body.amount, reason: body.reason, transactionId: r.transaction.id, balanceAfter: r.transaction.balanceAfter } },
      });
    }
    return r;
  });
  realtime.toUser(userId, 'wallet-update', {});
  res.json({ applied: result.applied, balanceAfter: result.transaction.balanceAfter });
}));

// ── Games & rooms ─────────────────────────────────────────────────

adminRouter.get('/games', anyStaff, h(async (req, res) => {
  const q = parse(z.object({ status: z.enum(['ACTIVE', 'FINISHED', 'CANCELLED']).optional() }), req.query);
  const p = pageParams(req.query);
  const where = q.status ? { status: q.status } : {};
  const [rows, total] = await Promise.all([
    prisma.game.findMany({
      where, orderBy: { startedAt: 'desc' }, skip: p.skip, take: p.take,
      include: { mode: { select: { name: true } }, room: { select: { code: true, visibility: true, isMatchmaking: true } }, players: { orderBy: { seat: 'asc' }, include: { user: { select: { mobile: true, profile: { select: { displayName: true } } } } } } },
    }),
    prisma.game.count({ where }),
  ]);
  res.json({
    total, page: p.page, pageSize: p.pageSize,
    items: rows.map((g) => ({
      id: g.id, status: g.status, mode: g.mode.name, roomCode: g.room?.code ?? null, isTournament: !!g.tournamentMatchId,
      entryPoints: g.entryPoints, pool: g.pool, commissionAmount: g.commissionAmount, startedAt: g.startedAt, endedAt: g.endedAt, cancelReason: g.cancelReason,
      players: g.players.map((pl) => ({ userId: pl.userId, name: pl.user.profile?.displayName, mobile: pl.user.mobile, color: pl.color, status: pl.status })),
    })),
  });
}));

adminRouter.get('/games/:id', anyStaff, h(async (req, res) => {
  const g = await prisma.game.findUnique({
    where: { id: req.params.id },
    include: { mode: true, room: true, state: true, results: true, players: { orderBy: { seat: 'asc' }, include: { user: { select: { mobile: true, profile: { select: { displayName: true } } } } } }, _count: { select: { moves: true } } },
  });
  if (!g) throw notFound('Game');
  res.json({ ...g, state: gameManager.getState(g.id) ?? g.state?.state ?? null, moveCount: g._count.moves });
}));

adminRouter.post('/games/:id/cancel', adminUp, h(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'A reason is required').max(200) }), req.body);
  const game = await prisma.game.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, tournamentMatchId: true } });
  if (!game) throw notFound('Game');
  if (game.tournamentMatchId) throw badRequest('TOURNAMENT_GAME', 'Tournament matches cannot be cancelled individually');
  const out = await gameManager.cancel(game.id, reason);
  if (!out) throw conflict('NOT_ACTIVE', 'This game is no longer active');
  await audit(req, 'GAME_CANCEL', { type: 'game', id: game.id }, { reason, refundedPlayers: out.userIds.length });
  res.json({ ok: true, refunded: out.userIds.length });
}));

adminRouter.get('/rooms', anyStaff, h(async (req, res) => {
  const q = parse(z.object({ status: z.enum(['WAITING', 'IN_GAME', 'COMPLETED', 'CANCELLED']).optional(), visibility: z.enum(['PUBLIC', 'PRIVATE']).optional() }), req.query);
  const p = pageParams(req.query);
  const where = { ...(q.status ? { status: q.status } : {}), ...(q.visibility ? { visibility: q.visibility } : {}) };
  const [rows, total] = await Promise.all([
    prisma.gameRoom.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take,
      include: { mode: { select: { name: true } }, host: { select: { mobile: true, profile: { select: { displayName: true } } } }, game: { select: { id: true } }, _count: { select: { players: true } } },
    }),
    prisma.gameRoom.count({ where }),
  ]);
  res.json({
    total, page: p.page, pageSize: p.pageSize,
    items: rows.map((r) => ({
      id: r.id, code: r.code, name: r.name, mode: r.mode.name, host: r.host.profile?.displayName ?? r.host.mobile, visibility: r.visibility, isMatchmaking: r.isMatchmaking,
      status: r.status, entryPoints: r.entryPoints, maxPlayers: r.maxPlayers, players: r._count.players, gameId: r.game?.id ?? null, createdAt: r.createdAt,
    })),
  });
}));

// ── Configuration ─────────────────────────────────────────────────

adminRouter.get('/settings', anyStaff, h(async (_req, res) => {
  const values = await getSettings(true);
  res.json({ items: (Object.keys(SETTING_DEFS) as SettingKey[]).map((key) => ({ key, value: values[key], default: SETTING_DEFS[key].default, description: SETTING_DEFS[key].description })) });
}));

adminRouter.put('/settings', superOnly, h(async (req, res) => {
  const body = parse(z.record(z.unknown()), req.body);
  const changes: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, raw] of Object.entries(body)) {
    const def = SETTING_DEFS[key as SettingKey];
    if (!def) throw badRequest('UNKNOWN_SETTING', `Unknown setting: ${key}`);
    const parsed = def.schema.safeParse(raw);
    if (!parsed.success) throw badRequest('INVALID_SETTING', `${key}: ${parsed.error.issues[0].message}`);
    changes[key] = parsed.data as Prisma.InputJsonValue;
  }
  const current = await getSettings(true);
  const merged = { ...current, ...changes } as Record<string, unknown>;
  if ((merged.entryPointsMin as number) > (merged.entryPointsMax as number)) throw badRequest('INVALID_SETTING', 'entryPointsMin cannot exceed entryPointsMax');
  if (Array.isArray(changes.tournamentPrizeSplit) && (changes.tournamentPrizeSplit as number[]).reduce((a, b) => a + b, 0) > 100) {
    throw badRequest('INVALID_SETTING', 'tournamentPrizeSplit cannot add up to more than 100');
  }
  await prisma.$transaction(
    Object.entries(changes).map(([key, value]) =>
      prisma.appSetting.upsert({ where: { key }, create: { key, value, description: SETTING_DEFS[key as SettingKey].description, updatedById: req.user!.id }, update: { value, updatedById: req.user!.id } }),
    ),
  );
  invalidateSettings();
  await audit(req, 'SETTINGS_UPDATE', { type: 'settings' }, { before: Object.fromEntries(Object.keys(changes).map((k) => [k, (current as Record<string, unknown>)[k]])) as Prisma.InputJsonValue, after: changes });
  res.json({ ok: true });
}));

adminRouter.get('/modes', anyStaff, h(async (_req, res) => {
  const modes = await prisma.gameMode.findMany({ orderBy: { sortOrder: 'asc' } });
  res.json({ presets: PRESET_KEYS, items: modes.map((m) => ({ ...m, effectiveRules: resolveRules(m.key, m.rules) })) });
}));

const modePatch = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  tagline: z.string().trim().max(80).optional(),
  description: z.string().trim().max(600).optional(),
  isActive: z.boolean().optional(),
  minEntry: z.number().int().min(0).optional(),
  maxEntry: z.number().int().min(1).optional(),
  allowedPlayers: z.array(z.number().int().min(2).max(4)).min(1).max(3).optional(),
  rules: z.record(z.unknown()).optional(),
});

adminRouter.patch('/modes/:id', superOnly, h(async (req, res) => {
  const body = parse(modePatch, req.body);
  const mode = await prisma.gameMode.findUnique({ where: { id: Number(req.params.id) } });
  if (!mode) throw notFound('Game mode');
  if (body.rules) {
    try {
      resolveRules(mode.key, body.rules);
    } catch (e: any) {
      throw badRequest('INVALID_RULES', e?.issues?.[0] ? `${e.issues[0].path.join('.') || 'rules'}: ${e.issues[0].message}` : 'Invalid rules');
    }
  }
  if ((body.minEntry ?? mode.minEntry) > (body.maxEntry ?? mode.maxEntry)) throw badRequest('INVALID_RANGE', 'minEntry cannot exceed maxEntry');
  const updated = await prisma.gameMode.update({ where: { id: mode.id }, data: { ...body, rules: body.rules as Prisma.InputJsonValue | undefined } });
  await audit(req, 'MODE_UPDATE', { type: 'gameMode', id: String(mode.id) }, body as Prisma.InputJsonValue);
  res.json({ ...updated, effectiveRules: resolveRules(updated.key, updated.rules) });
}));

// ── Tournaments ───────────────────────────────────────────────────

adminRouter.get('/tournaments', anyStaff, h(async (_req, res) => res.json({ items: await listTournaments() })));
adminRouter.get('/tournaments/:id', anyStaff, h(async (req, res) => res.json(await getTournament(req.params.id))));

const tournamentSchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().max(400).default(''),
  modeKey: z.string(),
  entryPoints: z.number().int().min(0).max(100000),
  capacity: z.number().int().min(2).max(64),
  bonusPool: z.number().int().min(0).max(1_000_000).default(0),
  startsAt: z.coerce.date(),
  prizeSplit: z.array(z.number().int().min(0).max(100)).min(1).max(4).optional(),
});

adminRouter.post('/tournaments', adminUp, h(async (req, res) => {
  const body = parse(tournamentSchema, req.body);
  const mode = await prisma.gameMode.findUnique({ where: { key: body.modeKey } });
  if (!mode || !mode.isActive) throw badRequest('MODE_UNAVAILABLE', 'This game mode is not available');
  if (!mode.allowedPlayers.includes(2)) throw badRequest('MODE_UNSUPPORTED', 'Tournament matches are two-player games');
  if (body.startsAt.getTime() < Date.now() + 30_000) throw badRequest('INVALID_START', 'Start time must be in the future');
  const prizeSplit = body.prizeSplit ?? (await getSettings()).tournamentPrizeSplit;
  if (prizeSplit.reduce((a, b) => a + b, 0) > 100) throw badRequest('INVALID_SPLIT', 'Prize split cannot add up to more than 100');
  const t = await prisma.tournament.create({
    data: { name: body.name, description: body.description, modeId: mode.id, entryPoints: body.entryPoints, capacity: body.capacity, bonusPool: body.bonusPool, startsAt: body.startsAt, prizeSplit, createdById: req.user!.id },
  });
  await audit(req, 'TOURNAMENT_CREATE', { type: 'tournament', id: t.id }, { name: t.name, entryPoints: t.entryPoints, capacity: t.capacity, bonusPool: t.bonusPool });
  res.status(201).json(await getTournament(t.id));
}));

adminRouter.post('/tournaments/:id/start', adminUp, h(async (req, res) => {
  const result = await startTournament(req.params.id);
  await audit(req, 'TOURNAMENT_START', { type: 'tournament', id: req.params.id }, { result });
  res.json({ result });
}));

adminRouter.post('/tournaments/:id/cancel', adminUp, h(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(200).default('') }), req.body);
  await cancelTournament(req.params.id, reason);
  await audit(req, 'TOURNAMENT_CANCEL', { type: 'tournament', id: req.params.id }, { reason });
  res.json({ ok: true });
}));

// ── Staff & audit ─────────────────────────────────────────────────

adminRouter.get('/audit-logs', anyStaff, h(async (req, res) => {
  const p = pageParams(req.query);
  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: { admin: { select: { username: true } } } }),
    prisma.adminAuditLog.count(),
  ]);
  res.json({ total, page: p.page, pageSize: p.pageSize, items: rows.map((r) => ({ id: r.id, admin: r.admin.username, action: r.action, targetType: r.targetType, targetId: r.targetId, details: r.details, ip: r.ip, createdAt: r.createdAt })) });
}));

adminRouter.get('/staff', superOnly, h(async (_req, res) => {
  const rows = await prisma.user.findMany({ where: { username: { not: null } }, orderBy: { createdAt: 'asc' }, include: { roles: { include: { role: true } } } });
  res.json({ items: rows.map((u) => ({ id: u.id, username: u.username, status: u.status, roles: u.roles.map((r) => r.role.name), lastLoginAt: u.lastLoginAt })) });
}));

const staffSchema = z.object({
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(10, 'Password needs at least 10 characters').max(100),
  role: z.enum(['ADMIN', 'SUPPORT', 'SUPER_ADMIN']),
});

adminRouter.post('/staff', superOnly, h(async (req, res) => {
  const body = parse(staffSchema, req.body);
  const role = await prisma.role.upsert({ where: { name: body.role }, create: { name: body.role }, update: {} });
  const user = await prisma.user.create({
    data: { username: body.username, passwordHash: await bcrypt.hash(body.password, 12), referralCode: `STAFF${randomUUID().slice(0, 8).toUpperCase()}`, welcomeBonusGranted: true, roles: { create: { roleId: role.id } } },
  });
  await audit(req, 'STAFF_CREATE', { type: 'user', id: user.id }, { username: body.username, role: body.role });
  res.status(201).json({ id: user.id });
}));
