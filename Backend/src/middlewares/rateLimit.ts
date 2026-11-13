import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const make = (windowMs: number, limit: number, message: string) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.isTest,
    message: { error: { code: 'RATE_LIMITED', message } },
  });

/** Global ceiling for the whole API. */
export const apiLimiter = make(60_000, 300, 'Too many requests, slow down');
/** Login / captcha / OTP endpoints: brute-force protection per IP. */
export const authLimiter = make(10 * 60_000, 40, 'Too many sign-in attempts, try again later');
/** Admin login: stricter. */
export const adminAuthLimiter = make(15 * 60_000, 15, 'Too many sign-in attempts, try again later');
