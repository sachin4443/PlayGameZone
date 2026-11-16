import type { PointRequestType, Prisma, RequestStatus } from '@prisma/client';
import { getSettings } from '../../config/settings';
import { prisma } from '../../lib/prisma';
import { realtime } from '../../services/realtime';
import { AppError, badRequest, conflict, notFound } from '../../utils/errors';
import { notify } from '../notifications/notifications.service';
import { completeWithdraw, credit, holdForWithdraw, releaseWithdraw } from './wallet.service';

/**
 * Requests to add or withdraw VIRTUAL points, decided by staff.
 *
 * Points have no cash value. This workflow intentionally records no payment
 * details, references or payout information of any kind.
 *
 *  ADD       pending → approved: points credited once | rejected: nothing happens
 *  WITHDRAW  submitted: points reserved (cannot be spent or requested again)
 *            approved: reserved points removed | rejected: reserved points returned
 */

export async function createPointRequest(userId: string, type: PointRequestType, amount: number, note: string) {
  const settings = await getSettings();
  if (!settings.pointRequestsEnabled) throw new AppError(403, 'REQUESTS_DISABLED', 'Point requests are switched off right now');
  if (amount > settings.pointRequestMax) throw badRequest('AMOUNT_TOO_LARGE', `A single request can be for at most ${settings.pointRequestMax} points`);
  try {
    const created = await prisma.$transaction(async (tx) => {
      // The partial unique index allows one open request of each kind per player.
      const row = await tx.pointRequest.create({ data: { userId, type, amount, note } });
      if (type === 'WITHDRAW') await holdForWithdraw(tx, userId, amount, row.id);
      return row;
    });
    realtime.toUser(userId, 'wallet-update', {});
    return created;
  } catch (e: any) {
    if (e?.code === 'P2002') throw conflict('REQUEST_PENDING', 'You already have a request of this kind waiting for review');
    throw e;
  }
}

export async function listPointRequests(where: Prisma.PointRequestWhereInput, skip: number, take: number) {
  const [rows, total] = await Promise.all([
    prisma.pointRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: { user: { select: { mobile: true, profile: { select: { displayName: true } }, wallet: { select: { balance: true } } } } } }),
    prisma.pointRequest.count({ where }),
  ]);
  return {
    total,
    items: rows.map((r) => ({
      id: r.id, userId: r.userId, name: r.user.profile?.displayName ?? 'Player', mobile: r.user.mobile, balance: r.user.wallet?.balance ?? 0,
      type: r.type, amount: r.amount, note: r.note, status: r.status, adminRemark: r.adminRemark, createdAt: r.createdAt, decidedAt: r.decidedAt,
    })),
  };
}

/** Approves or rejects exactly once; the wallet movement happens in the same transaction. */
export async function decidePointRequest(id: string, decision: Exclude<RequestStatus, 'PENDING'>, adminId: string, remark: string, ip?: string) {
  const request = await prisma.$transaction(async (tx) => {
    const claimed = await tx.pointRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: decision, adminRemark: remark || null, decidedById: adminId, decidedAt: new Date() } });
    if (claimed.count !== 1) {
      if (!(await tx.pointRequest.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Request');
      throw conflict('ALREADY_DECIDED', 'This request has already been decided');
    }
    const r = await tx.pointRequest.findUniqueOrThrow({ where: { id } });
    let balanceAfter: number | null = null;
    if (r.type === 'ADD' && decision === 'APPROVED') {
      balanceAfter = (await credit(tx, r.userId, r.amount, 'POINTS_REQUEST', `pointreq:${r.id}:credit`, { refType: 'pointRequest', refId: r.id, createdById: adminId, note: 'Points request approved' })).transaction.balanceAfter;
    } else if (r.type === 'WITHDRAW') {
      const res = decision === 'APPROVED' ? await completeWithdraw(tx, r.userId, r.amount, r.id, adminId) : await releaseWithdraw(tx, r.userId, r.amount, r.id, adminId, remark);
      balanceAfter = res.transaction.balanceAfter;
    }
    await tx.adminAuditLog.create({ data: { adminId, action: `POINT_REQUEST_${decision === 'APPROVED' ? 'APPROVE' : 'REJECT'}_${r.type}`, targetType: 'user', targetId: r.userId, ip, details: { requestId: r.id, amount: r.amount, remark, balanceAfter } } });
    return r;
  });
  realtime.toUser(request.userId, 'wallet-update', {});
  const what = request.type === 'ADD' ? 'add' : 'withdraw';
  await notify(request.userId, {
    type: 'POINT_REQUEST',
    title: decision === 'APPROVED' ? `Your request to ${what} ${request.amount} points was approved` : `Your request to ${what} ${request.amount} points was declined`,
    body: remark || (decision === 'APPROVED' ? 'Your wallet has been updated.' : 'No reason was given.'),
  });
  return request;
}
