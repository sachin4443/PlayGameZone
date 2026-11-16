import { Router } from 'express';
import { TxType } from '@prisma/client';
import { z } from 'zod';
import { h, pageParams, parse } from '../../utils/http';
import { getSettings } from '../../config/settings';
import { prisma } from '../../lib/prisma';
import { createPointRequest } from './pointRequests.service';
import { getWallet, listTransactions } from './wallet.service';

export const walletRouter = Router();

walletRouter.get('/', h(async (req, res) => {
  res.json(await getWallet(req.user!.id));
}));

const txQuery = z.object({
  type: z.nativeEnum(TxType).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

walletRouter.get('/transactions', h(async (req, res) => {
  const q = parse(txQuery, req.query);
  const p = pageParams(req.query);
  const { items, total } = await listTransactions(req.user!.id, { ...q, skip: p.skip, take: p.take });
  res.json({ items, total, page: p.page, pageSize: p.pageSize });
}));

// ── Requests to add / withdraw virtual points (decided by staff) ──

walletRouter.get('/requests', h(async (req, res) => {
  const [items, settings] = await Promise.all([
    prisma.pointRequest.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, type: true, amount: true, note: true, status: true, adminRemark: true, createdAt: true, decidedAt: true } }),
    getSettings(),
  ]);
  res.json({ items, enabled: settings.pointRequestsEnabled, max: settings.pointRequestMax });
}));

const requestSchema = z.object({
  type: z.enum(['ADD', 'WITHDRAW']),
  amount: z.number().int('Enter a whole number').min(1, 'Enter at least 1 point').max(10_000_000),
  note: z.string().trim().max(200).default(''),
});

walletRouter.post('/requests', h(async (req, res) => {
  const body = parse(requestSchema, req.body);
  const created = await createPointRequest(req.user!.id, body.type, body.amount, body.note);
  res.status(201).json({ id: created.id, status: created.status });
}));
