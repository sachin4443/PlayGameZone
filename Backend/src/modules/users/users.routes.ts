import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
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
    prisma.gameResult.count({ where: { userId } }),
    prisma.gameResult.count({ where: { userId, isWinner: true } }),
    prisma.gameResult.aggregate({ where: { userId }, _sum: { pointsWon: true } }),
  ]);
  res.json({ matches, wins, losses: matches - wins, winPct: matches ? Math.round((wins * 100) / matches) : 0, pointsWon: sums._sum.pointsWon ?? 0 });
}));
