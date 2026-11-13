import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { h, pageParams } from '../../utils/http';

export const notificationsRouter = Router();

notificationsRouter.get('/', h(async (req, res) => {
  const p = pageParams(req.query, 50);
  const where = { userId: req.user!.id };
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);
  res.json({ items, unread });
}));

notificationsRouter.post('/read-all', h(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
}));
