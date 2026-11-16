import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict } from '../../utils/errors';
import { h, parse } from '../../utils/http';
import { getMe } from '../auth/auth.service';

export const usersRouter = Router();

const patch = z.object({
  displayName: z.string().trim().min(3).max(20).regex(/^[\p{L}\p{N} _.-]+$/u, 'Use letters, numbers, spaces, _ . -').optional(),
  avatar: z.enum(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']).optional(),
  soundEnabled: z.boolean().optional(),
  theme: z.enum(['light', 'dark', 'auto']).optional(),
});

usersRouter.patch('/me', h(async (req, res) => {
  const data = parse(patch, req.body);
  await prisma.userProfile.update({ where: { userId: req.user!.id }, data });
  res.json(await getMe(req.user!.id));
}));

usersRouter.get('/me/stats', h(async (req, res) => {
  const userId = req.user!.id;
  const [matches, wins, sums] = await Promise.all([
    prisma.gameResult.count({ where: { userId, game: { isPractice: false } } }),
    prisma.gameResult.count({ where: { userId, isWinner: true, game: { isPractice: false } } }),
    prisma.gameResult.aggregate({ where: { userId, game: { isPractice: false } }, _sum: { pointsWon: true } }),
  ]);
  res.json({ matches, wins, losses: matches - wins, winPct: matches ? Math.round((wins * 100) / matches) : 0, pointsWon: sums._sum.pointsWon ?? 0 });
}));

// ── Requests only staff can carry out ──

usersRouter.get('/me/requests', h(async (req, res) => {
  const items = await prisma.accountRequest.findMany({
    where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 20,
    select: { id: true, type: true, newMobile: true, reason: true, status: true, adminRemark: true, createdAt: true, decidedAt: true },
  });
  res.json({ items });
}));

const requestSchema = z.object({
  type: z.enum(['MOBILE_CHANGE', 'ACCOUNT_DELETE']),
  newMobile: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number').optional(),
  reason: z.string().trim().min(5, 'Please tell us why (at least 5 characters)').max(300),
});

usersRouter.post('/me/requests', h(async (req, res) => {
  const body = parse(requestSchema, req.body);
  const userId = req.user!.id;
  if (body.type === 'MOBILE_CHANGE') {
    if (!body.newMobile) throw badRequest('MOBILE_REQUIRED', 'Enter the new mobile number');
    if (await prisma.user.findUnique({ where: { mobile: body.newMobile }, select: { id: true } })) throw conflict('MOBILE_REGISTERED', 'That mobile number already has an account');
  }
  if (await prisma.accountRequest.findFirst({ where: { userId, type: body.type, status: 'PENDING' } })) throw conflict('REQUEST_PENDING', 'You already have a request of this kind waiting for review');
  const created = await prisma.accountRequest.create({ data: { userId, type: body.type, newMobile: body.type === 'MOBILE_CHANGE' ? body.newMobile : null, reason: body.reason } });
  res.status(201).json({ id: created.id });
}));
