import type { Server } from 'socket.io';

/**
 * Thin indirection over Socket.IO so services can push events without importing
 * the socket layer (and so tests can run services with no server attached).
 */
let io: Server | null = null;

export const realtime = {
  attach(server: Server) {
    io = server;
  },
  toUser(userId: string, event: string, payload: unknown) {
    io?.to(`user:${userId}`).emit(event, payload);
  },
  toRoom(code: string, event: string, payload: unknown) {
    io?.to(`room:${code}`).emit(event, payload);
  },
  toGame(gameId: string, event: string, payload: unknown) {
    io?.to(`game:${gameId}`).emit(event, payload);
  },
  /** Subscribes every live socket of a user to a channel (used when a game starts). */
  joinUser(userId: string, channel: string) {
    io?.in(`user:${userId}`).socketsJoin(channel);
  },
  leaveAll(channel: string) {
    io?.in(channel).socketsLeave(channel);
  },
  isOnline(userId: string): boolean {
    return (io?.sockets.adapter.rooms.get(`user:${userId}`)?.size ?? 0) > 0;
  },
};
