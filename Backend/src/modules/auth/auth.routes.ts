import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { getSettings } from '../../config/settings';
import { requireAuth } from '../../middlewares/auth';
import { authLimiter } from '../../middlewares/rateLimit';
import { badRequest } from '../../utils/errors';
import { h, parse } from '../../utils/http';
import { getMe, loginWithVerifiedMobile } from './auth.service';
import { createCaptcha, verifyCaptcha } from './captcha';
import { completeChallenge, otpProvider, startChallenge } from './otp';

export const authRouter = Router();

const mobile = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');

authRouter.get('/config', h(async (_req, res) => {
  const s = await getSettings();
  res.json({ provider: otpProvider.name, captchaEnabled: s.captchaEnabled });
}));

authRouter.post('/captcha', authLimiter, h(async (_req, res) => {
  const s = await getSettings();
  res.json({ enabled: s.captchaEnabled, ...createCaptcha(s.captchaLength, env.isTest) });
}));

const requestSchema = z.object({
  mobile,
  captchaId: z.string().max(64).optional(),
  captchaAnswer: z.string().max(16).optional(),
});

/** Step 1: mobile + CAPTCHA → a one-time-code challenge. */
authRouter.post('/request-otp', authLimiter, h(async (req, res) => {
  const body = parse(requestSchema, req.body);
  const s = await getSettings();
  if (s.captchaEnabled) {
    if (!body.captchaId || !body.captchaAnswer || !verifyCaptcha(body.captchaId, body.captchaAnswer)) {
      throw badRequest('CAPTCHA_INVALID', 'CAPTCHA did not match, please try again');
    }
  }
  res.json(await startChallenge(body.mobile));
}));

const verifySchema = z.object({
  challengeId: z.string().max(64),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  referralCode: z.string().trim().max(16).optional(),
});

/** Step 2: challenge + code → JWT. Registers the player on first sign-in. */
authRouter.post('/verify-otp', authLimiter, h(async (req, res) => {
  const body = parse(verifySchema, req.body);
  const verifiedMobile = completeChallenge(body.challengeId, body.code);
  res.json(await loginWithVerifiedMobile(verifiedMobile, body.referralCode || undefined));
}));

authRouter.get('/me', requireAuth, h(async (req, res) => {
  res.json(await getMe(req.user!.id));
}));

/** JWTs are stateless: the client discards the token. Kept as an endpoint for symmetry/auditing. */
authRouter.post('/logout', requireAuth, h(async (_req, res) => {
  res.json({ ok: true });
}));
