import { io, type Socket } from 'socket.io-client';
import { API_ORIGIN, PLAYER_TOKEN_KEY } from './api';

let socket: Socket | null = null;

/** One shared, authenticated connection for the signed-in player. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_ORIGIN || undefined, {
      // Function form: a refreshed token is picked up on every reconnect.
      auth: (cb) => cb({ token: localStorage.getItem(PLAYER_TOKEN_KEY) }),
      transports: ['websocket', 'polling'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
  }
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}

export class SocketError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Emits with an acknowledgement and resolves/rejects with the server's reply. */
export function emit<T = unknown>(event: string, payload: unknown, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    getSocket()
      .timeout(timeoutMs)
      .emit(event, payload, (err: Error | null, res?: { ok: boolean; data?: T; error?: { code: string; message: string } }) => {
        if (err) return reject(new SocketError('TIMEOUT', 'The server did not respond. Check your connection.'));
        if (!res?.ok) return reject(new SocketError(res?.error?.code ?? 'ERROR', res?.error?.message ?? 'Request failed'));
        resolve(res.data as T);
      });
  });
}
