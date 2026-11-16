import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { SETTING_DEFS, type SettingKey, getSettings, invalidateSettings } from '../../config/settings';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middlewares/auth';
import { adminAuthLimiter } from '../../middlewares/rateLimit';
import { realtime } from '../../services/realtime';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { h, pageParams, parse } from '../../utils/http';
import { getMe, staffLogin } from '../auth/auth.service';
import { PRESET_KEYS, resolveModeRules } from '../games/engine/rules';
import { ACTIONS, MODULES, MODULE_KEYS, can, effectivePermissions, isRoot, loadStaff, roleDefaults, topRole, type Action, type ModuleKey } from './permissions';
import { gameManager } from '../games/game.manager';
import { notify } from '../notifications/notifications.service';
import { cancelTournament, getTournament, listTournaments, startTournament } from '../tournaments/tournaments.service';
import { setFirstTurn } from '../rooms/rooms.service';
import { decidePointRequest, listPointRequests } from '../wallet/pointRequests.service';
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
adminRouter.use(requireAuth, loadStaff);

const passwordSchema = z.string().min(10, 'Password needs at least 10 characters').max(100)
  .refine((v) => /[a-z]/i.test(v) && /\d/.test(v), 'Password needs letters and numbers');

adminRouter.get('/me', h(async (req, res) => {
  const me = await getMe(req.user!.id);
  res.json({ ...me, role: req.staff!.role, permissions: req.staff!.permissions, mustChangePassword: req.user!.mustChangePassword, modules: MODULES, actions: ACTIONS });
}));

adminRouter.post('/auth/change-password', adminAuthLimiter, h(async (req, res) => {
  const body = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!user.passwordHash || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw badRequest('WRONG_PASSWORD', 'Current password is incorrect');
  if (body.newPassword === body.currentPassword) throw badRequest('SAME_PASSWORD', 'Choose a password you have not used here before');
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(body.newPassword, 12), mustChangePassword: false } });
  await audit(req, 'PASSWORD_CHANGE', { type: 'user', id: user.id });
  res.json({ ok: true });
}));

// A temporary or reset password only lets its holder choose a new one.
adminRouter.use((req, _res, next) => {
  if (req.user!.mustChangePassword) return next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your password to continue'));
  next();
});

adminRouter.get('/dashboard', can('dashboard', 'read'), h(async (_req, res) => {
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const players = { mobile: { not: null } };
  const [totalUsers, activeUsers, blockedUsers, games, wallets, issued, rooms, tournaments] = await Promise.all([
    prisma.user.count({ where: players }),
    prisma.user.count({ where: { ...players, lastSeenAt: { gte: dayAgo } } }),
    prisma.user.count({ where: { ...players, status: 'BLOCKED' } }),
    prisma.game.groupBy({ by: ['status'], _count: true, _sum: { commissionAmount: true } }),
    prisma.wallet.aggregate({ _sum: { balance: true, locked: true } }),
    prisma.walletTransaction.aggregate({ where: { type: { in: ['WELCOME_BONUS', 'ADMIN_CREDIT', 'REFERRAL_BONUS', 'POINTS_REQUEST'] } }, _sum: { amount: true } }),
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

adminRouter.get('/users', can('users', 'read'), h(async (req, res) => {
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

adminRouter.get('/users/:id', can('users', 'read'), h(async (req, res) => {
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

adminRouter.get('/users/:id/transactions', can('users', 'read'), h(async (req, res) => {
  const p = pageParams(req.query);
  const { items, total } = await listTransactions(req.params.id, { skip: p.skip, take: p.take });
  res.json({ items, total, page: p.page, pageSize: p.pageSize });
}));

adminRouter.post('/users/:id/status', can('users', 'update'), h(async (req, res) => {
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

adminRouter.post('/users/:id/wallet-adjust', can('wallet', 'update'), h(async (req, res) => {
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

adminRouter.get('/games', can('games', 'read'), h(async (req, res) => {
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

adminRouter.get('/games/:id', can('games', 'read'), h(async (req, res) => {
  const g = await prisma.game.findUnique({
    where: { id: req.params.id },
    include: { mode: true, room: true, state: true, results: true, players: { orderBy: { seat: 'asc' }, include: { user: { select: { mobile: true, profile: { select: { displayName: true } } } } } }, _count: { select: { moves: true } } },
  });
  if (!g) throw notFound('Game');
  res.json({ ...g, state: gameManager.getState(g.id) ?? g.state?.state ?? null, moveCount: g._count.moves });
}));

adminRouter.post('/games/:id/cancel', can('games', 'manage'), h(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'A reason is required').max(200) }), req.body);
  const game = await prisma.game.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, tournamentMatchId: true } });
  if (!game) throw notFound('Game');
  if (game.tournamentMatchId) throw badRequest('TOURNAMENT_GAME', 'Tournament matches cannot be cancelled individually');
  const out = await gameManager.cancel(game.id, reason);
  if (!out) throw conflict('NOT_ACTIVE', 'This game is no longer active');
  await audit(req, 'GAME_CANCEL', { type: 'game', id: game.id }, { reason, refundedPlayers: out.userIds.length });
  res.json({ ok: true, refunded: out.userIds.length });
}));

adminRouter.get('/rooms', can('rooms', 'read'), h(async (req, res) => {
  const q = parse(z.object({ status: z.enum(['WAITING', 'IN_GAME', 'COMPLETED', 'CANCELLED']).optional(), visibility: z.enum(['PUBLIC', 'PRIVATE']).optional() }), req.query);
  const p = pageParams(req.query);
  const where = { ...(q.status ? { status: q.status } : {}), ...(q.visibility ? { visibility: q.visibility } : {}) };
  const [rows, total] = await Promise.all([
    prisma.gameRoom.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take,
      include: { mode: { select: { name: true } }, host: { select: { mobile: true, profile: { select: { displayName: true } } } }, game: { select: { id: true } }, _count: { select: { players: true } }, players: { orderBy: { seat: 'asc' }, select: { userId: true, user: { select: { profile: { select: { displayName: true } } } } } } },
    }),
    prisma.gameRoom.count({ where }),
  ]);
  res.json({
    total, page: p.page, pageSize: p.pageSize,
    items: rows.map((r) => ({
      id: r.id, code: r.code, name: r.name, mode: r.mode.name, host: r.host.profile?.displayName ?? r.host.mobile, visibility: r.visibility, isMatchmaking: r.isMatchmaking,
      status: r.status, entryPoints: r.entryPoints, maxPlayers: r.maxPlayers, players: r._count.players, gameId: r.game?.id ?? null, createdAt: r.createdAt,
      firstTurnUserId: r.firstTurnUserId, firstTurnSetBy: r.firstTurnSetBy, seats: r.players.map((pl) => ({ userId: pl.userId, name: pl.user.profile?.displayName ?? 'Player' })),
    })),
  });
}));

// ── Configuration ─────────────────────────────────────────────────

adminRouter.get('/settings', can('settings', 'read'), h(async (_req, res) => {
  const values = await getSettings(true);
  res.json({ items: (Object.keys(SETTING_DEFS) as SettingKey[]).map((key) => ({ key, value: values[key], default: SETTING_DEFS[key].default, description: SETTING_DEFS[key].description })) });
}));

adminRouter.put('/settings', can('settings', 'manage'), h(async (req, res) => {
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

adminRouter.get('/modes', can('modes', 'read'), h(async (_req, res) => {
  const modes = await prisma.gameMode.findMany({ orderBy: { sortOrder: 'asc' } });
  res.json({ presets: PRESET_KEYS, items: modes.map((m) => ({ ...m, effectiveRules: resolveModeRules(m.key, m.rules).rules })) });
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

adminRouter.patch('/modes/:id', can('modes', 'update'), h(async (req, res) => {
  const body = parse(modePatch, req.body);
  const mode = await prisma.gameMode.findUnique({ where: { id: Number(req.params.id) } });
  if (!mode) throw notFound('Game mode');
  if (body.rules) {
    try {
      resolveModeRules(mode.key, body.rules);
    } catch (e: any) {
      throw badRequest('INVALID_RULES', e?.issues?.[0] ? `${e.issues[0].path.join('.') || 'rules'}: ${e.issues[0].message}` : 'Invalid rules');
    }
  }
  if ((body.minEntry ?? mode.minEntry) > (body.maxEntry ?? mode.maxEntry)) throw badRequest('INVALID_RANGE', 'minEntry cannot exceed maxEntry');
  const updated = await prisma.gameMode.update({ where: { id: mode.id }, data: { ...body, rules: body.rules as Prisma.InputJsonValue | undefined } });
  await audit(req, 'MODE_UPDATE', { type: 'gameMode', id: String(mode.id) }, body as Prisma.InputJsonValue);
  res.json({ ...updated, effectiveRules: resolveModeRules(updated.key, updated.rules).rules });
}));

// ── Tournaments ───────────────────────────────────────────────────

adminRouter.get('/tournaments', can('tournaments', 'read'), h(async (_req, res) => res.json({ items: await listTournaments() })));
adminRouter.get('/tournaments/:id', can('tournaments', 'read'), h(async (req, res) => res.json(await getTournament(req.params.id))));

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

adminRouter.post('/tournaments', can('tournaments', 'create'), h(async (req, res) => {
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

adminRouter.post('/tournaments/:id/start', can('tournaments', 'manage'), h(async (req, res) => {
  const result = await startTournament(req.params.id);
  await audit(req, 'TOURNAMENT_START', { type: 'tournament', id: req.params.id }, { result });
  res.json({ result });
}));

adminRouter.post('/tournaments/:id/cancel', can('tournaments', 'manage'), h(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(200).default('') }), req.body);
  await cancelTournament(req.params.id, reason);
  await audit(req, 'TOURNAMENT_CANCEL', { type: 'tournament', id: req.params.id }, { reason });
  res.json({ ok: true });
}));

// ── Audit ─────────────────────────────────────────────────

adminRouter.get('/audit-logs', can('audit', 'read'), h(async (req, res) => {
  const p = pageParams(req.query);
  const q = parse(z.object({ adminId: z.string().max(40).optional(), action: z.string().max(40).optional() }), req.query);
  const where = { ...(q.adminId ? { adminId: q.adminId } : {}), ...(q.action ? { action: q.action } : {}) };
  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: { admin: { select: { username: true } } } }),
    prisma.adminAuditLog.count({ where }),
  ]);
  res.json({ total, page: p.page, pageSize: p.pageSize, items: rows.map((r) => ({ id: r.id, admin: r.admin.username, action: r.action, targetType: r.targetType, targetId: r.targetId, details: r.details, ip: r.ip, createdAt: r.createdAt })) });
}));


// ── Exports (CSV) ─────────────────────────────────────────────────

function csv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cell = (v: unknown) => {
    let t = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Neutralise spreadsheet formulas, then quote.
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return `"${t.replace(/"/g, '""')}"`;
  };
  const head = Object.keys(rows[0]);
  return [head.map(cell).join(','), ...rows.map((r) => head.map((k) => cell(r[k])).join(','))].join('\r\n');
}

const EXPORT_LIMIT = 10_000;
const exporters: Record<string, { module: ModuleKey; run: () => Promise<Record<string, unknown>[]> }> = {
  users: {
    module: 'users',
    run: async () =>
      (await prisma.user.findMany({ where: { mobile: { not: null } }, orderBy: { createdAt: 'desc' }, take: EXPORT_LIMIT, include: { profile: true, wallet: true } }))
        .map((u) => ({ id: u.id, mobile: u.mobile, name: u.profile?.displayName, status: u.status, balance: u.wallet?.balance ?? 0, locked: u.wallet?.locked ?? 0, joined: u.createdAt, lastLogin: u.lastLoginAt })),
  },
  games: {
    module: 'games',
    run: async () =>
      (await prisma.game.findMany({ orderBy: { startedAt: 'desc' }, take: EXPORT_LIMIT, include: { mode: { select: { name: true } } } }))
        .map((g) => ({ id: g.id, mode: g.mode.name, status: g.status, players: g.playerCount, entry: g.entryPoints, pool: g.pool, commission: g.commissionAmount, practice: g.isPractice, started: g.startedAt, ended: g.endedAt })),
  },
  transactions: {
    module: 'wallet',
    run: async () =>
      (await prisma.walletTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: EXPORT_LIMIT, include: { user: { select: { mobile: true } } } }))
        .map((t) => ({ id: t.id, mobile: t.user.mobile, type: t.type, direction: t.direction, amount: t.amount, balanceAfter: t.balanceAfter, reference: t.refId, note: t.note, at: t.createdAt })),
  },
  audit: {
    module: 'audit',
    run: async () =>
      (await prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: EXPORT_LIMIT, include: { admin: { select: { username: true } } } }))
        .map((l) => ({ at: l.createdAt, staff: l.admin.username, action: l.action, targetType: l.targetType, targetId: l.targetId, details: l.details, ip: l.ip })),
  },
};

adminRouter.get('/export/:name', h(async (req, res) => {
  const exporter = exporters[req.params.name];
  if (!exporter) throw notFound('Export');
  if (!req.staff!.permissions[exporter.module].includes('download')) throw forbidden('You do not have permission to download this data');
  const rows = await exporter.run();
  await audit(req, 'EXPORT_DOWNLOAD', { type: 'export', id: req.params.name }, { rows: rows.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv(rows));
}));

// ── Prize pools ───────────────────────────────────────────────────

const poolSchema = z.object({
  name: z.string().trim().min(3).max(40),
  modeKey: z.string().min(1).max(40),
  players: z.number().int().min(2).max(4),
  entryPoints: z.number().int().min(1).max(1_000_000),
  prizePoints: z.number().int().min(1).max(4_000_000),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

async function poolData(body: z.infer<typeof poolSchema>) {
  const mode = await prisma.gameMode.findUnique({ where: { key: body.modeKey } });
  if (!mode) throw badRequest('MODE_UNAVAILABLE', 'Unknown game mode');
  if (!mode.allowedPlayers.includes(body.players)) throw badRequest('PLAYERS_NOT_ALLOWED', `${mode.name} supports ${mode.allowedPlayers.join(' or ')} players`);
  if (body.prizePoints > body.entryPoints * body.players) throw badRequest('PRIZE_TOO_LARGE', `The prize cannot exceed the total entries (${body.entryPoints * body.players})`);
  return { name: body.name, modeId: mode.id, players: body.players, entryPoints: body.entryPoints, prizePoints: body.prizePoints, isActive: body.isActive, sortOrder: body.sortOrder };
}

adminRouter.get('/prize-pools', can('prizePools', 'read'), h(async (_req, res) => {
  const rows = await prisma.prizePool.findMany({ orderBy: [{ sortOrder: 'asc' }, { entryPoints: 'asc' }], include: { mode: { select: { key: true, name: true } }, _count: { select: { games: true } } } });
  res.json({ items: rows.map((r) => ({ id: r.id, name: r.name, mode: r.mode, players: r.players, entryPoints: r.entryPoints, prizePoints: r.prizePoints, isActive: r.isActive, sortOrder: r.sortOrder, gamesPlayed: r._count.games })) });
}));

adminRouter.post('/prize-pools', can('prizePools', 'create'), h(async (req, res) => {
  const pool = await prisma.prizePool.create({ data: await poolData(parse(poolSchema, req.body)) });
  await audit(req, 'PRIZE_POOL_CREATE', { type: 'prizePool', id: pool.id }, { name: pool.name, entryPoints: pool.entryPoints, prizePoints: pool.prizePoints, players: pool.players });
  res.status(201).json({ id: pool.id });
}));

adminRouter.put('/prize-pools/:id', can('prizePools', 'update'), h(async (req, res) => {
  const existing = await prisma.prizePool.findUnique({ where: { id: req.params.id } });
  if (!existing) throw notFound('Prize pool');
  const data = await poolData(parse(poolSchema, req.body));
  await prisma.prizePool.update({ where: { id: existing.id }, data });
  await audit(req, 'PRIZE_POOL_UPDATE', { type: 'prizePool', id: existing.id }, { before: { entryPoints: existing.entryPoints, prizePoints: existing.prizePoints, isActive: existing.isActive }, after: { entryPoints: data.entryPoints, prizePoints: data.prizePoints, isActive: data.isActive } });
  res.json({ ok: true });
}));

adminRouter.delete('/prize-pools/:id', can('prizePools', 'delete'), h(async (req, res) => {
  const pool = await prisma.prizePool.findUnique({ where: { id: req.params.id }, include: { _count: { select: { games: true, rooms: true } } } });
  if (!pool) throw notFound('Prize pool');
  // Pools that have been played stay for history; they are switched off instead.
  if (pool._count.games > 0 || pool._count.rooms > 0) await prisma.prizePool.update({ where: { id: pool.id }, data: { isActive: false } });
  else await prisma.prizePool.delete({ where: { id: pool.id } });
  await audit(req, 'PRIZE_POOL_DELETE', { type: 'prizePool', id: pool.id }, { name: pool.name, disabledOnly: pool._count.games > 0 || pool._count.rooms > 0 });
  res.json({ ok: true, disabledOnly: pool._count.games > 0 || pool._count.rooms > 0 });
}));

// ── Account requests (mobile change / account deletion) ───────────

adminRouter.get('/notifications/summary', h(async (req, res) => {
  const perms = req.staff!.permissions;
  const [accountRequests, pointRequests] = await Promise.all([
    perms.accountRequests.includes('view') ? prisma.accountRequest.count({ where: { status: 'PENDING' } }) : 0,
    perms.pointRequests.includes('view') ? prisma.pointRequest.count({ where: { status: 'PENDING' } }) : 0,
  ]);
  res.json({ accountRequests, pointRequests });
}));

adminRouter.get('/account-requests', can('accountRequests', 'read'), h(async (req, res) => {
  const q = parse(z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(), search: z.string().trim().max(20).optional() }), req.query);
  const p = pageParams(req.query);
  const where: Prisma.AccountRequestWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.search ? { OR: [{ newMobile: { contains: q.search } }, { user: { mobile: { contains: q.search } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.accountRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: { user: { select: { mobile: true, profile: { select: { displayName: true } } } } } }),
    prisma.accountRequest.count({ where }),
  ]);
  res.json({
    total, page: p.page, pageSize: p.pageSize,
    items: rows.map((r) => ({ id: r.id, userId: r.userId, name: r.user.profile?.displayName, mobile: r.user.mobile, type: r.type, newMobile: r.newMobile, reason: r.reason, status: r.status, adminRemark: r.adminRemark, createdAt: r.createdAt, decidedAt: r.decidedAt })),
  });
}));

adminRouter.post('/account-requests/:id/approve', can('accountRequests', 'approve'), h(async (req, res) => {
  const { remark } = parse(z.object({ remark: z.string().trim().max(200).default('') }), req.body);
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.accountRequest.updateMany({ where: { id: req.params.id, status: 'PENDING' }, data: { status: 'APPROVED', adminRemark: remark, decidedById: req.user!.id, decidedAt: new Date() } });
    if (claimed.count !== 1) throw conflict('ALREADY_DECIDED', 'This request has already been decided');
    const r = await tx.accountRequest.findUniqueOrThrow({ where: { id: req.params.id }, include: { user: true } });
    if (r.type === 'MOBILE_CHANGE') {
      if (!r.newMobile) throw badRequest('NO_MOBILE', 'The request has no new mobile number');
      if (await tx.user.findUnique({ where: { mobile: r.newMobile } })) throw conflict('MOBILE_REGISTERED', 'That mobile number already has an account');
      await tx.user.update({ where: { id: r.userId }, data: { mobile: r.newMobile } });
    } else {
      const busy = await tx.gamePlayer.findFirst({ where: { userId: r.userId, status: 'PLAYING', game: { status: 'ACTIVE' } } });
      if (busy) throw conflict('IN_GAME', 'This player is in a running game. Try again when it has finished.');
      await tx.roomPlayer.deleteMany({ where: { userId: r.userId, room: { status: 'WAITING' } } });
      // The account is closed and its number released; game and ledger history is kept.
      await tx.user.update({ where: { id: r.userId }, data: { mobile: null, pinHash: null, status: 'BLOCKED', deletedAt: new Date() } });
      await tx.userProfile.updateMany({ where: { userId: r.userId }, data: { displayName: 'Deleted player' } });
    }
    await tx.adminAuditLog.create({ data: { adminId: req.user!.id, action: `ACCOUNT_REQUEST_APPROVE_${r.type}`, targetType: 'user', targetId: r.userId, ip: req.ip, details: { requestId: r.id, oldMobile: r.user.mobile, newMobile: r.newMobile, remark } } });
    return r;
  });
  if (result.type === 'ACCOUNT_DELETE') realtime.kick(result.userId);
  else await notify(result.userId, { type: 'ACCOUNT_REQUEST', title: 'Mobile number changed', body: `Your account now signs in with ${result.newMobile}.` });
  res.json({ ok: true });
}));

adminRouter.post('/account-requests/:id/reject', can('accountRequests', 'reject'), h(async (req, res) => {
  const { remark } = parse(z.object({ remark: z.string().trim().min(3, 'Give the player a reason').max(200) }), req.body);
  const claimed = await prisma.accountRequest.updateMany({ where: { id: req.params.id, status: 'PENDING' }, data: { status: 'REJECTED', adminRemark: remark, decidedById: req.user!.id, decidedAt: new Date() } });
  if (claimed.count !== 1) throw conflict('ALREADY_DECIDED', 'This request has already been decided');
  const r = await prisma.accountRequest.findUniqueOrThrow({ where: { id: req.params.id } });
  await audit(req, `ACCOUNT_REQUEST_REJECT_${r.type}`, { type: 'user', id: r.userId }, { requestId: r.id, remark });
  await notify(r.userId, { type: 'ACCOUNT_REQUEST', title: 'Your request was declined', body: remark });
  res.json({ ok: true });
}));

/** Players cannot recover a forgotten PIN themselves until SMS is connected: staff set a new one. */
adminRouter.post('/users/:id/set-pin', can('users', 'manage'), h(async (req, res) => {
  const { pin } = parse(z.object({ pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits') }), req.body);
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, mobile: true } });
  if (!user || !user.mobile) throw notFound('User');
  await prisma.user.update({ where: { id: user.id }, data: { pinHash: await bcrypt.hash(pin, 10), failedPinAttempts: 0, pinLockedUntil: null } });
  realtime.kick(user.id);
  await audit(req, 'USER_PIN_RESET', { type: 'user', id: user.id });
  res.json({ ok: true });
}));

// ── Point requests (virtual points only) ──────────────────────────

adminRouter.get('/point-requests', can('pointRequests', 'read'), h(async (req, res) => {
  const q = parse(z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(), type: z.enum(['ADD', 'WITHDRAW']).optional(), search: z.string().trim().max(20).optional() }), req.query);
  const p = pageParams(req.query);
  const where: Prisma.PointRequestWhereInput = {
    ...(q.status ? { status: q.status } : {}), ...(q.type ? { type: q.type } : {}),
    ...(q.search ? { user: { OR: [{ mobile: { contains: q.search } }, { profile: { displayName: { contains: q.search, mode: 'insensitive' } } }] } } : {}),
  };
  const { items, total } = await listPointRequests(where, p.skip, p.take);
  res.json({ items, total, page: p.page, pageSize: p.pageSize });
}));

adminRouter.post('/point-requests/:id/approve', can('pointRequests', 'approve'), h(async (req, res) => {
  const { remark } = parse(z.object({ remark: z.string().trim().max(200).default('') }), req.body);
  await decidePointRequest(req.params.id, 'APPROVED', req.user!.id, remark, req.ip);
  res.json({ ok: true });
}));

adminRouter.post('/point-requests/:id/reject', can('pointRequests', 'reject'), h(async (req, res) => {
  const { remark } = parse(z.object({ remark: z.string().trim().min(3, 'Give the player a reason').max(200) }), req.body);
  await decidePointRequest(req.params.id, 'REJECTED', req.user!.id, remark, req.ip);
  res.json({ ok: true });
}));

// ── Room management ───────────────────────────────────────────────

/**
 * Staff may set who takes the first turn in a waiting private/public room, or
 * hand the choice back to chance. The setting is shown to every player in the
 * lobby before the game starts. Matchmaking and prize-pool tables always draw
 * the first turn at random and cannot be changed. Dice are never affected.
 */
adminRouter.patch('/rooms/:id', can('rooms', 'manage'), h(async (req, res) => {
  const body = parse(z.object({ firstTurnUserId: z.string().max(40).nullable() }), req.body);
  const room = await prisma.gameRoom.findUnique({ where: { id: req.params.id }, select: { code: true, firstTurnUserId: true } });
  if (!room) throw notFound('Room');
  await setFirstTurn(room.code, body.firstTurnUserId, 'ADMIN');
  await audit(req, 'ROOM_FIRST_TURN', { type: 'room', id: req.params.id }, { code: room.code, before: room.firstTurnUserId, after: body.firstTurnUserId });
  res.json({ ok: true });
}));

adminRouter.post('/rooms/:id/close', can('rooms', 'manage'), h(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'A reason is required').max(200) }), req.body);
  const room = await prisma.gameRoom.findUnique({ where: { id: req.params.id }, select: { id: true, code: true } });
  if (!room) throw notFound('Room');
  const closed = await prisma.gameRoom.updateMany({ where: { id: room.id, status: 'WAITING' }, data: { status: 'CANCELLED' } });
  if (closed.count !== 1) throw conflict('ROOM_NOT_WAITING', 'Only rooms that have not started can be closed. Cancel the game instead.');
  realtime.toRoom(room.code, 'room-closed', { code: room.code, reason: `Closed by staff: ${reason}` });
  await audit(req, 'ROOM_CLOSE', { type: 'room', id: room.id }, { code: room.code, reason });
  res.json({ ok: true });
}));

// ── Staff & permissions ───────────────────────────────────────────

type StaffRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT';

/**
 * Hierarchy rules, enforced for every staff-management action:
 *  - nobody can act on the root owner, or on themselves;
 *  - only the root owner can act on (or create) super admins;
 *  - a super admin can manage admins and support staff.
 */
async function loadTarget(req: Request, id: string) {
  const target = await prisma.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
  const role = target ? topRole(target.roles.map((r) => r.role.name)) : null;
  if (!target || !role || !target.username) throw notFound('Staff account');
  if (isRoot(role)) throw forbidden('The root owner account cannot be changed');
  if (target.id === req.user!.id) throw forbidden('You cannot change your own account here');
  if (role === 'SUPER_ADMIN' && !isRoot(req.staff!.role)) throw forbidden('Only the root owner can manage super admins');
  return { target, role };
}

function assertMayAssign(req: Request, role: StaffRole) {
  if (role === 'SUPER_ADMIN' && !isRoot(req.staff!.role)) throw forbidden('Only the root owner can create or promote super admins');
  if (!isRoot(req.staff!.role) && req.staff!.role !== 'SUPER_ADMIN') throw forbidden('Only the root owner or a super admin can assign roles');
}

adminRouter.get('/staff', can('staff', 'read'), h(async (_req, res) => {
  const rows = await prisma.user.findMany({ where: { username: { not: null }, deletedAt: null }, orderBy: { createdAt: 'asc' }, include: { roles: { include: { role: true } } } });
  res.json({
    modules: MODULES, actions: ACTIONS,
    items: rows.map((u) => ({ id: u.id, username: u.username, status: u.status, role: topRole(u.roles.map((r) => r.role.name)), permsCustomized: u.permsCustomized, mustChangePassword: u.mustChangePassword, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt })),
  });
}));

adminRouter.get('/staff/:id', can('staff', 'read'), h(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, username: true, status: true, permsCustomized: true, lastLoginAt: true } });
  if (!u || !u.username) throw notFound('Staff account');
  const { role, permissions } = await effectivePermissions(u.id);
  res.json({ ...u, role, permissions, defaults: role ? roleDefaults(role) : null });
}));

const staffSchema = z.object({
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_.-]+$/, 'Use letters, numbers, _ . -'),
  password: passwordSchema,
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'SUPPORT']),
});

adminRouter.post('/staff', can('staff', 'create'), h(async (req, res) => {
  const body = parse(staffSchema, req.body);
  assertMayAssign(req, body.role);
  const role = await prisma.role.upsert({ where: { name: body.role }, create: { name: body.role }, update: {} });
  const user = await prisma.user.create({
    data: {
      username: body.username, passwordHash: await bcrypt.hash(body.password, 12), mustChangePassword: true,
      referralCode: `STAFF${randomUUID().slice(0, 8).toUpperCase()}`, welcomeBonusGranted: true, roles: { create: { roleId: role.id } },
    },
  });
  await audit(req, 'STAFF_CREATE', { type: 'staff', id: user.id }, { username: body.username, role: body.role });
  res.status(201).json({ id: user.id });
}));

adminRouter.patch('/staff/:id', can('staff', 'update'), h(async (req, res) => {
  const body = parse(z.object({ status: z.enum(['ACTIVE', 'BLOCKED']).optional(), role: z.enum(['SUPER_ADMIN', 'ADMIN', 'SUPPORT']).optional() }), req.body);
  const { target, role: oldRole } = await loadTarget(req, req.params.id);
  if (body.role) assertMayAssign(req, body.role);
  await prisma.$transaction(async (tx) => {
    if (body.status) await tx.user.update({ where: { id: target.id }, data: { status: body.status } });
    if (body.role && body.role !== oldRole) {
      const role = await tx.role.upsert({ where: { name: body.role }, create: { name: body.role }, update: {} });
      await tx.userRole.deleteMany({ where: { userId: target.id } });
      await tx.userRole.create({ data: { userId: target.id, roleId: role.id } });
      // A new role starts from that role's defaults.
      await tx.staffPermission.deleteMany({ where: { userId: target.id } });
      await tx.user.update({ where: { id: target.id }, data: { permsCustomized: false } });
    }
  });
  await audit(req, 'STAFF_UPDATE', { type: 'staff', id: target.id }, { username: target.username, ...body, previousRole: oldRole });
  res.json({ ok: true });
}));

const permissionsSchema = z.record(z.array(z.enum(ACTIONS)).max(ACTIONS.length));

adminRouter.put('/staff/:id/permissions', can('staff', 'manage'), h(async (req, res) => {
  const body = parse(permissionsSchema, req.body);
  const { target, role } = await loadTarget(req, req.params.id);
  if (role === 'SUPER_ADMIN') throw badRequest('FULL_ACCESS_ROLE', 'Super admins always have full access. Change the role to restrict this account.');
  // Only the two top roles hand out permissions, so staff can never widen their own access.
  if (!isRoot(req.staff!.role) && req.staff!.role !== 'SUPER_ADMIN') throw forbidden('Only the root owner or a super admin can change permissions');
  for (const key of Object.keys(body)) if (!(key in MODULES)) throw badRequest('UNKNOWN_MODULE', `Unknown module: ${key}`);
  const rows = MODULE_KEYS.map((m) => {
    const actions = [...new Set(body[m] ?? [])] as Action[];
    // Any granted action implies the menu is visible.
    if (actions.length > 0 && !actions.includes('view')) actions.unshift('view');
    return { userId: target.id, module: m as string, actions };
  });
  const before = (await effectivePermissions(target.id)).permissions;
  await prisma.$transaction([
    prisma.staffPermission.deleteMany({ where: { userId: target.id } }),
    prisma.staffPermission.createMany({ data: rows }),
    prisma.user.update({ where: { id: target.id }, data: { permsCustomized: true } }),
  ]);
  await audit(req, 'STAFF_PERMISSIONS_UPDATE', { type: 'staff', id: target.id }, { username: target.username, before, after: Object.fromEntries(rows.map((r) => [r.module, r.actions])) });
  res.json({ ok: true });
}));

adminRouter.post('/staff/:id/reset-password', can('staff', 'manage'), h(async (req, res) => {
  const { password } = parse(z.object({ password: passwordSchema }), req.body);
  const { target } = await loadTarget(req, req.params.id);
  await prisma.user.update({ where: { id: target.id }, data: { passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true } });
  await audit(req, 'STAFF_PASSWORD_RESET', { type: 'staff', id: target.id }, { username: target.username });
  res.json({ ok: true });
}));

adminRouter.delete('/staff/:id', can('staff', 'delete'), h(async (req, res) => {
  const { target } = await loadTarget(req, req.params.id);
  // The row stays so the audit trail keeps pointing at a real account; it can never sign in again.
  await prisma.$transaction([
    prisma.staffPermission.deleteMany({ where: { userId: target.id } }),
    prisma.userRole.deleteMany({ where: { userId: target.id } }),
    prisma.user.update({ where: { id: target.id }, data: { status: 'BLOCKED', passwordHash: null, username: `deleted-${target.username}-${target.id.slice(-6)}`, deletedAt: new Date() } }),
  ]);
  await audit(req, 'STAFF_DELETE', { type: 'staff', id: target.id }, { username: target.username });
  res.json({ ok: true });
}));
