import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, type RoleName } from '@prisma/client';

/**
 * Idempotent seed: safe to run any number of times. It only inserts what is
 * missing and never deletes or resets existing data.
 */
const prisma = new PrismaClient();

const MODES = [
  { key: 'CLASSIC', name: 'Classic Ludo', tagline: 'The original. First home wins.', allowedPlayers: [2, 4], description: 'Roll a six to leave the yard, capture rivals, and bring all four tokens home first. Sixes, captures and reaching home earn another roll.' },
  { key: 'SCORE', name: 'Timer 5 Min', tagline: 'Highest score in five minutes.', allowedPlayers: [2, 4], description: 'All tokens start on the board. Every step scores a point, captures and home runs score big. When the five-minute clock stops, the highest score wins.' },
  { key: 'MANIA', name: 'Mania', tagline: '25 rolls. No shelters. Power rolls.', allowedPlayers: [2, 4], description: '25 rolls each. Star cells do not protect, blocks do not protect, and every fifth roll moves double. Highest score wins.' },
  { key: 'PICK_DICE', name: 'Pick Your Dice', tagline: 'Three shared dice. 30 picks.', allowedPlayers: [2, 4], description: 'Three dice sit on the table for everyone. Pick one, move, and it is re-rolled for the next player. 30 picks each, highest score wins.' },
  { key: 'KILL_TO_ENTER', name: 'Kill to Enter', tagline: 'No capture, no home.', allowedPlayers: [2, 4], description: 'Classic rules, but your home column stays locked until you capture a rival token. Until then your tokens keep circling the board.' },
];

async function main() {
  const roles: RoleName[] = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'PLAYER'];
  for (const name of roles) await prisma.role.upsert({ where: { name }, create: { name }, update: {} });

  for (const [i, m] of MODES.entries()) {
    await prisma.gameMode.upsert({ where: { key: m.key }, create: { ...m, sortOrder: i }, update: {} });
  }

  const username = process.env.SEED_ADMIN_USERNAME;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!username || !password) {
    console.log('SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD not set: skipping super admin.');
  } else if (await prisma.user.findUnique({ where: { username } })) {
    console.log(`Super admin "${username}" already exists (password left unchanged).`);
  } else {
    if (password.length < 10) throw new Error('SEED_ADMIN_PASSWORD must be at least 10 characters');
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
    await prisma.user.create({
      data: { username, passwordHash: await bcrypt.hash(password, 12), referralCode: 'STAFFROOT', welcomeBonusGranted: true, roles: { create: { roleId: role.id } } },
    });
    console.log(`Created super admin "${username}".`);
  }
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
