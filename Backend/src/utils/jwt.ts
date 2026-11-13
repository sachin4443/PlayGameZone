import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface TokenPayload {
  sub: string;
  /** "player" tokens come from mobile login, "staff" tokens from the admin login. */
  kind: 'player' | 'staff';
}

export function signToken(payload: TokenPayload, expiresIn: string = env.JWT_EXPIRES_IN): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn } as SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  if (typeof decoded.sub !== 'string' || (decoded.kind !== 'player' && decoded.kind !== 'staff')) {
    throw new Error('Malformed token');
  }
  return { sub: decoded.sub, kind: decoded.kind };
}
