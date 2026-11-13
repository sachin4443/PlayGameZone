import { prisma } from '../src/lib/prisma';
import { invalidateSettings } from '../src/config/settings';
import { loginWithVerifiedMobile } from '../src/modules/auth/auth.service';
import type { Rng } from '../src/modules/games/engine/engine';

/** Empties the TEST database (guarded in setup.ts) and restores reference data. */
export async function resetDb() {
  if (!/_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) throw new Error('Refusing to truncate a non-test database');
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  invalidateSettings();
  for (const name of ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'PLAYER'] as const) await prisma.role.create({ data: { name } });
  for (const [i, key] of ['CLASSIC', 'SCORE', 'MANIA', 'PICK_DICE', 'KILL_TO_ENTER'].entries()) {
    await prisma.gameMode.create({ data: { key, name: key, sortOrder: i } });
  }
}

let counter = 0;
export function nextMobile() {
  counter += 1;
  return `9${String(100000000 + counter).padStart(9, '0')}`;
}

export async function newPlayer(referralCode?: string) {
  const mobile = nextMobile();
  const r = await loginWithVerifiedMobile(mobile, referralCode);
  return { id: r.user.id, mobile, token: r.token, referralCode: r.user.referralCode };
}

export const balanceOf = async (userId: string) => (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;
export const lockedOf = async (userId: string) => (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).locked;

/** Dice that follow a script, then repeat the last value. */
export function scripted(values: number[]): Rng {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

export async function setSetting(key: string, value: unknown) {
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
  invalidateSettings();
}
