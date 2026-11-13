import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { h, parse } from '../../utils/http';

export const leaderboardRouter = Router();

type Period = 'daily' | 'weekly' | 'monthly' | 'all';

export function periodStart(period: Period, now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === 'daily') return d;
  if (period === 'weekly') {
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
    return d;
  }
  if (period === 'monthly') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return new Date(0);
}

interface Row { userId: string; matches: number; wins: number; points: number }

export async function getLeaderboard(period: Period, limit = 50) {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT r."userId",
           COUNT(*)::int AS matches,
           COALESCE(SUM(CASE WHEN r."isWinner" THEN 1 ELSE 0 END), 0)::int AS wins,
           COALESCE(SUM(r."pointsWon"), 0)::int AS points
    FROM "GameResult" r
    WHERE r."createdAt" >= ${periodStart(period)}
    GROUP BY r."userId"
    ORDER BY wins DESC, points DESC, matches ASC, r."userId" ASC
    LIMIT ${limit}`;
  const profiles = await prisma.userProfile.findMany({ where: { userId: { in: rows.map((r) => r.userId) } }, select: { userId: true, displayName: true, avatar: true } });
  const byId = new Map(profiles.map((p) => [p.userId, p]));
  return rows.map((r, i) => ({
    rank: i + 1,
    userId: r.userId,
    name: byId.get(r.userId)?.displayName ?? 'Player',
    avatar: byId.get(r.userId)?.avatar ?? 'a1',
    matches: r.matches,
    wins: r.wins,
    winPct: r.matches ? Math.round((r.wins * 100) / r.matches) : 0,
    points: r.points,
  }));
}

leaderboardRouter.get('/', h(async (req, res) => {
  const { period } = parse(z.object({ period: z.enum(['daily', 'weekly', 'monthly', 'all']).default('weekly') }), req.query);
  res.json({ period, items: await getLeaderboard(period) });
}));
