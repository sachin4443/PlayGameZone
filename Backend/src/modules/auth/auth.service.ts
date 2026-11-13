import bcrypt from 'bcryptjs';
import { getSettings } from '../../config/settings';
import { prisma } from '../../lib/prisma';
import { randomCode } from '../../utils/codes';
import { AppError, forbidden } from '../../utils/errors';
import { signToken } from '../../utils/jwt';
import { grantWelcomeBonus } from '../wallet/wallet.service';

const AVATARS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];

async function uniqueReferralCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = randomCode(8);
    if (!(await prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } }))) return code;
  }
  throw new Error('Could not allocate a referral code');
}

/**
 * Called once a mobile number has been verified (by whichever OTP provider).
 * Creates the account on first sign-in: profile, PLAYER role, wallet and the
 * one-time welcome bonus are all written in a single transaction.
 */
export async function loginWithVerifiedMobile(mobile: string, referralCode?: string) {
  const settings = await getSettings();
  let user = await prisma.user.findUnique({ where: { mobile } });
  let isNewUser = false;

  if (!user) {
    const code = await uniqueReferralCode();
    try {
      user = await prisma.$transaction(async (tx) => {
        const role = await tx.role.upsert({ where: { name: 'PLAYER' }, create: { name: 'PLAYER' }, update: {} });
        const created = await tx.user.create({
          data: {
            mobile,
            referralCode: code,
            profile: { create: { displayName: `Player${mobile.slice(-4)}`, avatar: AVATARS[Number(mobile.slice(-1)) % AVATARS.length] } },
            roles: { create: { roleId: role.id } },
          },
        });
        await grantWelcomeBonus(tx, created.id, settings.welcomeBonusPoints);

        // Referral is recorded now; the reward is paid after the first finished game.
        const refCode = referralCode?.trim().toUpperCase();
        if (refCode && refCode !== code) {
          const referrer = await tx.user.findUnique({ where: { referralCode: refCode }, select: { id: true, status: true, mobile: true } });
          if (referrer && referrer.status === 'ACTIVE' && referrer.mobile && referrer.id !== created.id) {
            await tx.referral.create({ data: { referrerId: referrer.id, refereeId: created.id, code: refCode } });
          }
        }
        return created;
      });
      isNewUser = true;
    } catch (e: any) {
      // Two simultaneous first logins for the same number: the loser reads the winner's row.
      if (e?.code !== 'P2002') throw e;
      user = await prisma.user.findUnique({ where: { mobile } });
      if (!user) throw e;
    }
  }

  if (user.status === 'BLOCKED') throw forbidden('This account has been blocked');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastSeenAt: new Date() } });
  return { token: signToken({ sub: user.id, kind: 'player' }), isNewUser, user: await getMe(user.id) };
}

export async function getMe(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { profile: true, wallet: true, roles: { include: { role: true } } },
  });
  return {
    id: u.id,
    mobile: u.mobile,
    username: u.username,
    referralCode: u.referralCode,
    displayName: u.profile?.displayName ?? u.username ?? 'Player',
    avatar: u.profile?.avatar ?? 'a1',
    soundEnabled: u.profile?.soundEnabled ?? true,
    theme: u.profile?.theme ?? 'auto',
    roles: u.roles.map((r) => r.role.name),
    wallet: u.wallet
      ? { balance: u.wallet.balance, locked: u.wallet.locked, totalEarned: u.wallet.totalEarned, totalSpent: u.wallet.totalSpent }
      : null,
    createdAt: u.createdAt,
  };
}

// A real hash so that unknown usernames cost the same time as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export async function staffLogin(username: string, password: string) {
  const user = await prisma.user.findUnique({ where: { username }, include: { roles: { include: { role: true } } } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  const isStaff = user?.roles.some((r) => r.role.name !== 'PLAYER') ?? false;
  if (!user || !user.passwordHash || !ok || !isStaff) throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong username or password');
  if (user.status === 'BLOCKED') throw forbidden('This account has been blocked');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { token: signToken({ sub: user.id, kind: 'staff' }, '12h'), user: await getMe(user.id) };
}
