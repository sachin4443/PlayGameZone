import { Prisma, type RoomVisibility } from '@prisma/client';
import { getSettings } from '../../config/settings';
import { prisma, type Tx } from '../../lib/prisma';
import { realtime } from '../../services/realtime';
import { randomCode } from '../../utils/codes';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { gameManager } from '../games/game.manager';
import { InsufficientPlayerPoints, startRoomGame } from '../games/games.service';
import { notify } from '../notifications/notifications.service';

const roomInclude = {
  mode: { select: { key: true, name: true } },
  game: { select: { id: true, status: true } },
  players: { orderBy: { seat: 'asc' as const }, include: { user: { select: { profile: { select: { displayName: true, avatar: true } } } } } },
} satisfies Prisma.GameRoomInclude;

type RoomRow = Prisma.GameRoomGetPayload<{ include: typeof roomInclude }>;

export function toRoomView(r: RoomRow) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    mode: r.mode,
    hostId: r.hostId,
    maxPlayers: r.maxPlayers,
    entryPoints: r.entryPoints,
    prizePool: r.entryPoints * r.maxPlayers,
    visibility: r.visibility,
    isMatchmaking: r.isMatchmaking,
    status: r.status,
    expiresAt: r.expiresAt,
    gameId: r.game?.id ?? null,
    players: r.players.map((p) => ({
      userId: p.userId,
      seat: p.seat,
      isReady: p.isReady,
      name: p.user.profile?.displayName ?? 'Player',
      avatar: p.user.profile?.avatar ?? 'a1',
    })),
  };
}
export type RoomView = ReturnType<typeof toRoomView>;

export async function getRoomView(code: string): Promise<RoomView> {
  const room = await prisma.gameRoom.findUnique({ where: { code: code.toUpperCase() }, include: roomInclude });
  if (!room) throw notFound('Room');
  return toRoomView(room);
}

async function pushRoom(code: string) {
  const view = await getRoomView(code);
  realtime.toRoom(code, 'room-state', view);
  return view;
}

/** A player may sit in only one waiting room / running room-game at a time. */
async function assertFree(tx: Tx, userId: string, exceptRoomId?: string) {
  const waiting = await tx.roomPlayer.findFirst({
    where: { userId, room: { status: 'WAITING', ...(exceptRoomId ? { id: { not: exceptRoomId } } : {}) } },
    select: { room: { select: { code: true } } },
  });
  if (waiting) throw conflict('ALREADY_IN_ROOM', `You are already in room ${waiting.room.code}. Leave it first.`);
  const playing = await tx.gamePlayer.findFirst({ where: { userId, status: 'PLAYING', game: { status: 'ACTIVE', roomId: { not: null } } }, select: { gameId: true } });
  if (playing) throw conflict('ALREADY_IN_GAME', 'Finish your current game first');
}

async function assertCanAfford(tx: Tx, userId: string, entryPoints: number) {
  const wallet = await tx.wallet.findUnique({ where: { userId }, select: { balance: true } });
  if (!wallet || wallet.balance < entryPoints) {
    throw new AppError(402, 'INSUFFICIENT_POINTS', `You need ${entryPoints} points to enter this room`);
  }
}

interface RoomSpec { modeKey: string; maxPlayers: number; entryPoints: number }

async function validateSpec(spec: RoomSpec) {
  const settings = await getSettings();
  const mode = await prisma.gameMode.findUnique({ where: { key: spec.modeKey } });
  if (!mode || !mode.isActive) throw badRequest('MODE_UNAVAILABLE', 'This game mode is not available');
  if (!mode.allowedPlayers.includes(spec.maxPlayers)) {
    throw badRequest('PLAYERS_NOT_ALLOWED', `${mode.name} supports ${mode.allowedPlayers.join(' or ')} players`);
  }
  const min = Math.max(settings.entryPointsMin, mode.minEntry);
  const max = Math.min(settings.entryPointsMax, mode.maxEntry);
  if (spec.entryPoints < min || spec.entryPoints > max) {
    throw badRequest('ENTRY_OUT_OF_RANGE', `Entry points must be between ${min} and ${max}`);
  }
  return { mode, settings };
}

async function allocateCode(tx: Tx): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = randomCode(6);
    if (!(await tx.gameRoom.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  throw new Error('Could not allocate a room code');
}

export async function createRoom(userId: string, input: RoomSpec & { name: string; visibility: RoomVisibility }): Promise<RoomView> {
  const { mode, settings } = await validateSpec(input);
  const room = await prisma.$transaction(async (tx) => {
    await assertFree(tx, userId);
    await assertCanAfford(tx, userId, input.entryPoints);
    return tx.gameRoom.create({
      data: {
        code: await allocateCode(tx),
        name: input.name,
        modeId: mode.id,
        hostId: userId,
        maxPlayers: input.maxPlayers,
        entryPoints: input.entryPoints,
        visibility: input.visibility,
        expiresAt: new Date(Date.now() + settings.roomIdleTimeoutMin * 60_000),
        players: { create: { userId, seat: 0, isReady: true } },
      },
      include: roomInclude,
    });
  });
  return toRoomView(room);
}

/** Seats the user in a waiting room (inside a transaction that holds the room row lock). */
async function seatPlayer(tx: Tx, roomId: string, userId: string): Promise<'joined' | 'already'> {
  // Row lock: concurrent joins to the same room are serialised, so seats cannot be double-booked.
  await tx.$queryRaw`SELECT id FROM "GameRoom" WHERE id = ${roomId} FOR UPDATE`;
  const room = await tx.gameRoom.findUniqueOrThrow({ where: { id: roomId }, include: { players: true } });
  if (room.players.some((p) => p.userId === userId)) return 'already';
  if (room.status !== 'WAITING') throw conflict('ROOM_CLOSED', 'This room has already started or closed');
  if (room.players.length >= room.maxPlayers) throw conflict('ROOM_FULL', 'This room is full');
  await assertFree(tx, userId, roomId);
  await assertCanAfford(tx, userId, room.entryPoints);
  const taken = new Set(room.players.map((p) => p.seat));
  let seat = 0;
  while (taken.has(seat)) seat++;
  await tx.roomPlayer.create({ data: { roomId, userId, seat, isReady: room.isMatchmaking } });
  return 'joined';
}

export async function joinRoom(userId: string, code: string): Promise<RoomView> {
  const found = await prisma.gameRoom.findUnique({ where: { code: code.toUpperCase() }, select: { id: true, code: true } });
  if (!found) throw notFound('Room');
  await prisma.$transaction((tx) => seatPlayer(tx, found.id, userId));
  const view = await pushRoom(found.code);
  await maybeAutoStart(view);
  return getRoomView(found.code);
}

export async function leaveRoom(userId: string, code: string): Promise<void> {
  const room = await prisma.gameRoom.findUnique({ where: { code: code.toUpperCase() }, select: { id: true, code: true } });
  if (!room) throw notFound('Room');
  const closed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "GameRoom" WHERE id = ${room.id} FOR UPDATE`;
    const fresh = await tx.gameRoom.findUniqueOrThrow({ where: { id: room.id }, include: { players: { orderBy: { joinedAt: 'asc' } } } });
    if (fresh.status !== 'WAITING') throw conflict('ROOM_STARTED', 'The game has already started');
    if (!fresh.players.some((p) => p.userId === userId)) return false;
    await tx.roomPlayer.delete({ where: { roomId_userId: { roomId: room.id, userId } } });
    const rest = fresh.players.filter((p) => p.userId !== userId);
    if (rest.length === 0) {
      await tx.gameRoom.update({ where: { id: room.id }, data: { status: 'CANCELLED' } });
      return true;
    }
    if (fresh.hostId === userId) {
      // Hand the room to whoever has been waiting longest.
      await tx.gameRoom.update({ where: { id: room.id }, data: { hostId: rest[0].userId } });
      await tx.roomPlayer.update({ where: { id: rest[0].id }, data: { isReady: true } });
    }
    return false;
  });
  if (closed) realtime.toRoom(room.code, 'room-closed', { code: room.code, reason: 'Everyone left' });
  else await pushRoom(room.code);
}

export async function setReady(userId: string, code: string, ready: boolean): Promise<RoomView> {
  const room = await prisma.gameRoom.findUnique({ where: { code: code.toUpperCase() }, select: { id: true, code: true, status: true, hostId: true } });
  if (!room) throw notFound('Room');
  if (room.status !== 'WAITING') throw conflict('ROOM_STARTED', 'The game has already started');
  const res = await prisma.roomPlayer.updateMany({ where: { roomId: room.id, userId }, data: { isReady: room.hostId === userId ? true : ready } });
  if (res.count !== 1) throw forbidden('You are not in this room');
  return pushRoom(room.code);
}

/** Starts the game; when a player can no longer afford the entry they are removed and the room stays open. */
async function launch(roomId: string, code: string) {
  try {
    const started = await startRoomGame(roomId, gameManager.rng);
    await gameManager.register(started);
    await pushRoom(code);
    return started.gameId;
  } catch (e) {
    if (e instanceof InsufficientPlayerPoints) {
      await prisma.roomPlayer.deleteMany({ where: { roomId, userId: e.userId } });
      const left = await prisma.roomPlayer.findMany({ where: { roomId }, orderBy: { joinedAt: 'asc' } });
      if (left.length === 0) await prisma.gameRoom.update({ where: { id: roomId }, data: { status: 'CANCELLED' } });
      else await prisma.gameRoom.updateMany({ where: { id: roomId, hostId: e.userId }, data: { hostId: left[0].userId } });
      await notify(e.userId, { type: 'ROOM_REMOVED', title: 'Removed from room', body: 'You no longer had enough points for the entry, so you were removed from the room.' });
      realtime.toUser(e.userId, 'room-closed', { code, reason: 'Not enough points' });
      await pushRoom(code);
    }
    throw e;
  }
}

export async function startRoom(userId: string, code: string): Promise<string> {
  const room = await prisma.gameRoom.findUnique({ where: { code: code.toUpperCase() }, include: { players: true } });
  if (!room) throw notFound('Room');
  if (room.hostId !== userId) throw forbidden('Only the host can start the game');
  if (room.status !== 'WAITING') throw conflict('ROOM_NOT_WAITING', 'This room has already started or closed');
  if (room.players.length < 2) throw badRequest('NOT_ENOUGH_PLAYERS', 'At least two players are needed');
  if (room.players.some((p) => !p.isReady)) throw badRequest('PLAYERS_NOT_READY', 'Wait until every player is ready');
  return launch(room.id, room.code);
}

async function maybeAutoStart(view: RoomView) {
  if (view.isMatchmaking && view.status === 'WAITING' && view.players.length >= view.maxPlayers) {
    await launch(view.id, view.code).catch((e) => {
      if (!(e instanceof AppError)) console.error('[matchmaking] start failed', e);
    });
  }
}

/**
 * Public matchmaking: join the oldest open queue room with the same mode, table
 * size and entry, or open a new one. An advisory lock per queue makes the
 * find-or-create step atomic, so two simultaneous players always meet.
 */
export async function quickMatch(userId: string, spec: RoomSpec): Promise<RoomView> {
  const { mode, settings } = await validateSpec(spec);
  const queueKey = `mm:${mode.id}:${spec.maxPlayers}:${spec.entryPoints}`;
  const code = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${queueKey}))`;
    await assertFree(tx, userId);
    await assertCanAfford(tx, userId, spec.entryPoints);
    const candidates = await tx.gameRoom.findMany({
      where: { status: 'WAITING', isMatchmaking: true, modeId: mode.id, maxPlayers: spec.maxPlayers, entryPoints: spec.entryPoints, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { players: true } } },
      take: 5,
    });
    const open = candidates.find((c) => c._count.players < c.maxPlayers);
    if (open) {
      await seatPlayer(tx, open.id, userId);
      return open.code;
    }
    const created = await tx.gameRoom.create({
      data: {
        code: await allocateCode(tx),
        name: `${mode.name} match`,
        modeId: mode.id,
        hostId: userId,
        maxPlayers: spec.maxPlayers,
        entryPoints: spec.entryPoints,
        visibility: 'PUBLIC',
        isMatchmaking: true,
        expiresAt: new Date(Date.now() + settings.matchmakingTimeoutSec * 1000),
        players: { create: { userId, seat: 0, isReady: true } },
      },
    });
    return created.code;
  });
  const view = await pushRoom(code);
  await maybeAutoStart(view);
  return getRoomView(code);
}

export async function listPublicRooms() {
  const rooms = await prisma.gameRoom.findMany({
    where: { status: 'WAITING', visibility: 'PUBLIC', isMatchmaking: false },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: roomInclude,
  });
  return rooms.map(toRoomView).filter((r) => r.players.length < r.maxPlayers);
}

/** What the player should be returned to after a refresh / reconnect. */
export async function getActiveContext(userId: string) {
  const seat = await prisma.roomPlayer.findFirst({ where: { userId, room: { status: 'WAITING' } }, select: { room: { select: { code: true, isMatchmaking: true } } } });
  const games = await prisma.gamePlayer.findMany({ where: { userId, status: 'PLAYING', game: { status: 'ACTIVE' } }, select: { gameId: true } });
  return { room: seat?.room ?? null, gameIds: games.map((g) => g.gameId) };
}

/** Closes waiting rooms whose time ran out (matchmaking timeout, abandoned lobbies). */
export async function sweepExpiredRooms(): Promise<number> {
  const expired = await prisma.gameRoom.findMany({ where: { status: 'WAITING', expiresAt: { lt: new Date() } }, select: { id: true, code: true, isMatchmaking: true }, take: 100 });
  let closed = 0;
  for (const room of expired) {
    const res = await prisma.gameRoom.updateMany({ where: { id: room.id, status: 'WAITING' }, data: { status: 'CANCELLED' } });
    if (res.count !== 1) continue;
    closed++;
    realtime.toRoom(room.code, 'room-closed', {
      code: room.code,
      reason: room.isMatchmaking ? 'No opponent found. Please try again.' : 'The room expired',
      matchmakingTimeout: room.isMatchmaking,
    });
  }
  return closed;
}
