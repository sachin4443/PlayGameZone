import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '../../lib/prisma';
import { realtime } from '../../services/realtime';

export async function notify(
  userId: string,
  n: { type: string; title: string; body: string; data?: Prisma.InputJsonValue },
  db: Db = prisma,
) {
  const row = await db.notification.create({ data: { userId, ...n } });
  realtime.toUser(userId, 'notification', { id: row.id, type: row.type, title: row.title, body: row.body, data: row.data, createdAt: row.createdAt, readAt: null });
  return row;
}
