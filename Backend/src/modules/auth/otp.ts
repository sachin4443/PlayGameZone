import { createHash, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { env } from '../../config/env';
import { AppError, badRequest } from '../../utils/errors';

/**
 * One-time-code delivery is behind this interface so that swapping the temporary
 * development login for real SMS only means adding a provider – routes, challenge
 * handling, user creation and JWT issuing stay exactly the same.
 */
export interface OtpProvider {
  readonly name: 'dev' | 'sms';
  /** Delivers the code. May return a value to expose to the client (dev only). */
  send(mobile: string, code: string): Promise<{ exposeCode: boolean }>;
}

/** TEMPORARY development login: no SMS is sent, the code is handed back to the client. */
class DevOtpProvider implements OtpProvider {
  readonly name = 'dev' as const;
  async send() {
    return { exposeCode: true };
  }
}

/**
 * Production provider. Plug the SMS gateway call in here (MSG91, Twilio, …),
 * reading its credentials from environment variables.
 */
class SmsOtpProvider implements OtpProvider {
  readonly name = 'sms' as const;
  async send(_mobile: string, _code: string): Promise<{ exposeCode: boolean }> {
    throw new AppError(501, 'SMS_NOT_CONFIGURED', 'SMS delivery is not configured on this server');
  }
}

export const otpProvider: OtpProvider = env.AUTH_PROVIDER === 'sms' ? new SmsOtpProvider() : new DevOtpProvider();

const TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const RESEND_GAP_MS = 20_000;
const MAX_ENTRIES = 50_000;

interface Challenge { mobile: string; hash: Buffer; attempts: number; expiresAt: number; createdAt: number }
const challenges = new Map<string, Challenge>();
const lastSent = new Map<string, number>();

const sha = (s: string) => createHash('sha256').update(s).digest();

function sweep() {
  const now = Date.now();
  for (const [id, c] of challenges) if (c.expiresAt < now) challenges.delete(id);
  for (const [m, at] of lastSent) if (now - at > RESEND_GAP_MS) lastSent.delete(m);
  while (challenges.size > MAX_ENTRIES) challenges.delete(challenges.keys().next().value as string);
}

export async function startChallenge(mobile: string) {
  sweep();
  const now = Date.now();
  if (!env.isTest && now - (lastSent.get(mobile) ?? 0) < RESEND_GAP_MS) {
    throw new AppError(429, 'OTP_TOO_SOON', 'Please wait a few seconds before requesting another code');
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const { exposeCode } = await otpProvider.send(mobile, code);
  lastSent.set(mobile, now);
  const challengeId = randomUUID();
  challenges.set(challengeId, { mobile, hash: sha(code), attempts: 0, expiresAt: now + TTL_MS, createdAt: now });
  return {
    challengeId,
    expiresInSec: TTL_MS / 1000,
    provider: otpProvider.name,
    ...(exposeCode ? { devCode: code } : {}),
  };
}

/** Returns the verified mobile number; the challenge is consumed on success or lock-out. */
export function completeChallenge(challengeId: string, code: string): string {
  const c = challenges.get(challengeId);
  if (!c || c.expiresAt < Date.now()) {
    challenges.delete(challengeId);
    throw badRequest('OTP_EXPIRED', 'This code has expired, request a new one');
  }
  c.attempts += 1;
  if (!timingSafeEqual(c.hash, sha(code))) {
    if (c.attempts >= MAX_ATTEMPTS) {
      challenges.delete(challengeId);
      throw badRequest('OTP_LOCKED', 'Too many wrong attempts, request a new code');
    }
    throw badRequest('OTP_INVALID', 'Incorrect code');
  }
  challenges.delete(challengeId);
  return c.mobile;
}
