import { Router } from 'express';
import { getSettings } from '../../config/settings';
import { prisma } from '../../lib/prisma';
import { h } from '../../utils/http';

export const referralsRouter = Router();

referralsRouter.get('/', h(async (req, res) => {
  const userId = req.user!.id;
  const [user, referrals, settings] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } }),
    prisma.referral.findMany({
      where: { referrerId: userId }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { referee: { select: { profile: { select: { displayName: true, avatar: true } } } } },
    }),
    getSettings(),
  ]);
  res.json({
    code: user.referralCode,
    referrerReward: settings.referrerRewardPoints,
    refereeReward: settings.refereeRewardPoints,
    totalInvited: referrals.length,
    totalEarned: referrals.reduce((sum, r) => sum + (r.status === 'REWARDED' ? r.referrerReward : 0), 0),
    items: referrals.map((r) => ({
      id: r.id, name: r.referee.profile?.displayName ?? 'Player', avatar: r.referee.profile?.avatar ?? 'a1',
      status: r.status, reward: r.status === 'REWARDED' ? r.referrerReward : 0, joinedAt: r.createdAt,
    })),
  });
}));
