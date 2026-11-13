import { Router } from 'express';
import { TxType } from '@prisma/client';
import { z } from 'zod';
import { h, pageParams, parse } from '../../utils/http';
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
