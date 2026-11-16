import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { getSettings } from '../../config/settings';
import { requireAuth } from '../../middlewares/auth';
import { authLimiter } from '../../middlewares/rateLimit';
import { badRequest } from '../../utils/errors';
import { h, parse } from '../../utils/http';
import { changePin, getMe, loginWithPin, registerWithPin } from './auth.service';
import { createCaptcha, verifyCaptcha } from './captcha';

export const authRouter = Router();

const mobile = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');

authRouter.get('/config', h(async (_req, res) => {
  const s = await getSettings();
  res.json({ method: 'pin', captchaEnabled: s.captchaEnabled });
}));

authRouter.post('/captcha', authLimiter, h(async (_req, res) => {
  const s = await getSettings();
  res.json({ enabled: s.captchaEnabled, ...createCaptcha(s.captchaLength, env.isTest) });
}));

const pin = z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits');

async function checkCaptcha(captchaId?: string, captchaAnswer?: string) {
  const s = await getSettings();
  if (!s.captchaEnabled) return;
  if (!captchaId || !captchaAnswer || !verifyCaptcha(captchaId, captchaAnswer)) throw badRequest('CAPTCHA_INVALID', 'CAPTCHA did not match, please try again');
}

const registerSchema = z.object({
  mobile,
  pin,
  confirmPin: z.string(),
  captchaId: z.string().max(64).optional(),
  captchaAnswer: z.string().max(16).optional(),
  referralCode: z.string().trim().max(16).optional(),
}).refine((v) => v.pin === v.confirmPin, { message: 'The two PINs do not match', path: ['confirmPin'] });

/** New account: mobile number + PIN (entered twice) + CAPTCHA. */
authRouter.post('/register', authLimiter, h(async (req, res) => {
  const body = parse(registerSchema, req.body);
  await checkCaptcha(body.captchaId, body.captchaAnswer);
  res.status(201).json({ ...(await registerWithPin(body.mobile, body.pin, body.referralCode || undefined)), isNewUser: true });
}));

/** Sign in with mobile number + PIN. Repeated wrong PINs lock the account temporarily. */
authRouter.post('/login', authLimiter, h(async (req, res) => {
  const body = parse(z.object({ mobile, pin }), req.body);
  res.json(await loginWithPin(body.mobile, body.pin));
}));

authRouter.post('/change-pin', authLimiter, requireAuth, h(async (req, res) => {
  const body = parse(z.object({ currentPin: pin, newPin: pin }), req.body);
  if (req.user!.kind !== 'player') throw badRequest('NOT_A_PLAYER', 'Only player accounts have a PIN');
  await changePin(req.user!.id, body.currentPin, body.newPin);
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, h(async (req, res) => {
  res.json(await getMe(req.user!.id));
}));

/** JWTs are stateless: the client discards the token. Kept as an endpoint for symmetry/auditing. */
authRouter.post('/logout', requireAuth, h(async (_req, res) => {
  res.json({ ok: true });
}));
