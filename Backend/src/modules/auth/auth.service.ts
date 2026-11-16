import bcrypt from 'bcryptjs';
import { getSettings } from '../../config/settings';
import { prisma } from '../../lib/prisma';
import { randomCode } from '../../utils/codes';
import { AppError, badRequest, conflict, forbidden } from '../../utils/errors';
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
 * Creates (or loads) the account for a mobile number and returns a session.
 * Internal building block: callers must have established the right to the number
 * (PIN registration today, OTP verification once SMS is connected). On first use: profile, PLAYER role, wallet and the
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

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;
const WEAK_PINS = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123', '12345', '123456', '654321', '000000', '111111']);

export function assertStrongPin(pin: string) {
  if (!/^\d{4,6}$/.test(pin)) throw badRequest('PIN_INVALID', 'PIN must be 4 to 6 digits');
  if (WEAK_PINS.has(pin)) throw badRequest('PIN_WEAK', 'That PIN is too easy to guess. Choose another.');
}

/**
 * Registration with a self-chosen PIN (stored only as a bcrypt hash).
 * One mobile number = one account. When SMS is connected, verify the number with
 * the OtpProvider (see otp.ts) before calling this; nothing else has to change.
 */
export async function registerWithPin(mobile: string, pin: string, referralCode?: string) {
  assertStrongPin(pin);
  const existing = await prisma.user.findUnique({ where: { mobile }, select: { pinHash: true } });
  if (existing?.pinHash) throw conflict('MOBILE_REGISTERED', 'This mobile number is already registered. Sign in instead.');
  // Creates the account (profile, wallet, one-time welcome bonus) if it does not exist yet.
  const session = await loginWithVerifiedMobile(mobile, referralCode);
  // Atomic claim: only one caller can set the first PIN for an account.
  const claimed = await prisma.user.updateMany({ where: { id: session.user.id, pinHash: null }, data: { pinHash: await bcrypt.hash(pin, 10) } });
  if (claimed.count !== 1) throw conflict('MOBILE_REGISTERED', 'This mobile number is already registered. Sign in instead.');
  return session;
}

export async function loginWithPin(mobile: string, pin: string) {
  const user = await prisma.user.findUnique({ where: { mobile } });
  if (user?.pinLockedUntil && user.pinLockedUntil > new Date()) {
    const minutes = Math.ceil((user.pinLockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError(423, 'PIN_LOCKED', `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }
  const ok = await bcrypt.compare(pin, user?.pinHash ?? DUMMY_HASH);
  if (!user || !user.pinHash || !ok) {
    if (user?.pinHash) {
      const updated = await prisma.user.update({ where: { id: user.id }, data: { failedPinAttempts: { increment: 1 } } });
      if (updated.failedPinAttempts >= PIN_MAX_ATTEMPTS) {
        await prisma.user.update({ where: { id: user.id }, data: { failedPinAttempts: 0, pinLockedUntil: new Date(Date.now() + PIN_LOCK_MINUTES * 60_000) } });
        throw new AppError(423, 'PIN_LOCKED', `Too many wrong attempts. Try again in ${PIN_LOCK_MINUTES} minutes.`);
      }
    }
    // Same answer for an unknown number and a wrong PIN.
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong mobile number or PIN');
  }
  if (user.status === 'BLOCKED') throw forbidden('This account has been blocked');
  await prisma.user.update({ where: { id: user.id }, data: { failedPinAttempts: 0, pinLockedUntil: null, lastLoginAt: new Date(), lastSeenAt: new Date() } });
  return { token: signToken({ sub: user.id, kind: 'player' }), isNewUser: false, user: await getMe(user.id) };
}

export async function changePin(userId: string, currentPin: string, newPin: string) {
  assertStrongPin(newPin);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.pinHash || !(await bcrypt.compare(currentPin, user.pinHash))) throw badRequest('WRONG_PIN', 'Current PIN is incorrect');
  if (currentPin === newPin) throw badRequest('SAME_PIN', 'Choose a different PIN');
  await prisma.user.update({ where: { id: userId }, data: { pinHash: await bcrypt.hash(newPin, 10) } });
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
  return { token: signToken({ sub: user.id, kind: 'staff' }, '12h'), user: await getMe(user.id), mustChangePassword: user.mustChangePassword };
}
