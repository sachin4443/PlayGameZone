import type { RequestHandler } from 'express';
import type { RoleName } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { forbidden, unauthorized } from '../utils/errors';
import { verifyToken } from '../utils/jwt';

export interface AuthUser {
  id: string;
  kind: 'player' | 'staff';
  roles: RoleName[];
  mustChangePassword: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/** Resolves a bearer token to a live, non-blocked user (shared by HTTP and sockets). */
export async function authenticateToken(token: string | undefined): Promise<AuthUser> {
  if (!token) throw unauthorized();
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw unauthorized('Session expired, please sign in again');
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, status: true, mustChangePassword: true, isBot: true, roles: { select: { role: { select: { name: true } } } } },
  });
  if (!user || user.isBot) throw unauthorized();
  if (user.status === 'BLOCKED') throw forbidden('This account has been blocked');
  return { id: user.id, kind: payload.kind, roles: user.roles.map((r) => r.role.name), mustChangePassword: user.mustChangePassword };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  authenticateToken(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(next);
};

/** Player-facing routes: staff tokens are not accepted for gameplay or wallets. */
export const requirePlayer: RequestHandler = (req, _res, next) => {
  if (req.user?.kind !== 'player') return next(forbidden('Player account required'));
  next();
};

/** Staff routes: needs a staff token AND one of the given roles. */
export const requireRole =
  (...roles: RoleName[]): RequestHandler =>
  (req, _res, next) => {
    const u = req.user;
    if (!u || u.kind !== 'staff' || !u.roles.some((r) => roles.includes(r))) return next(forbidden());
    next();
  };
