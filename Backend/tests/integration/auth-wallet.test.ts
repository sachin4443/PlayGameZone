import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { loginWithVerifiedMobile } from '../../src/modules/auth/auth.service';
import { peekCaptchaAnswer } from '../../src/modules/auth/captcha';
import { credit, debit, grantWelcomeBonus } from '../../src/modules/wallet/wallet.service';
import { balanceOf, newPlayer, nextMobile, resetDb, setSetting } from '../helpers';

const app = createApp();
beforeAll(resetDb);

async function httpLogin(mobile: string, opts: { answer?: string; code?: string; referralCode?: string } = {}) {
  const cap = await request(app).post('/api/auth/captcha').expect(200);
  const otp = await request(app).post('/api/auth/request-otp').send({ mobile, captchaId: cap.body.captchaId, captchaAnswer: opts.answer ?? peekCaptchaAnswer(cap.body.captchaId) });
  if (otp.status !== 200) return otp;
  return request(app).post('/api/auth/verify-otp').send({ challengeId: otp.body.challengeId, code: opts.code ?? otp.body.devCode, referralCode: opts.referralCode });
}

describe('registration and login', () => {
  it('registers a new player with a wallet and exactly 100 welcome points', async () => {
    const mobile = nextMobile();
    const res = await httpLogin(mobile);
    expect(res.status).toBe(200);
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.user.wallet.balance).toBe(100);
    const txs = await prisma.walletTransaction.findMany({ where: { userId: res.body.user.id } });
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ type: 'WELCOME_BONUS', direction: 'CREDIT', amount: 100, balanceAfter: 100 });

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
    expect(me.body.mobile).toBe(mobile);
  });

  it('never grants the welcome bonus again on later logins', async () => {
    const mobile = nextMobile();
    const first = await httpLogin(mobile);
    const second = await httpLogin(mobile);
    const third = await httpLogin(mobile);
    expect(second.body.isNewUser).toBe(false);
    expect(third.body.user.id).toBe(first.body.user.id);
    expect(third.body.user.wallet.balance).toBe(100);
    expect(await prisma.walletTransaction.count({ where: { userId: first.body.user.id, type: 'WELCOME_BONUS' } })).toBe(1);
  });

  it('grants one bonus even when first logins race each other', async () => {
    const mobile = nextMobile();
    const results = await Promise.all(Array.from({ length: 6 }, () => loginWithVerifiedMobile(mobile)));
    const ids = new Set(results.map((r) => r.user.id));
    expect(ids.size).toBe(1);
    expect(await balanceOf([...ids][0])).toBe(100);
    // Calling the grant directly again is also a no-op.
    const again = await prisma.$transaction((tx) => grantWelcomeBonus(tx, [...ids][0], 100));
    expect(again).toBe(false);
    expect(await balanceOf([...ids][0])).toBe(100);
  });

  it('uses the configured welcome bonus amount', async () => {
    await setSetting('welcomeBonusPoints', 250);
    const res = await httpLogin(nextMobile());
    expect(res.body.user.wallet.balance).toBe(250);
    await setSetting('welcomeBonusPoints', 100);
  });

  it('rejects a wrong CAPTCHA, a reused CAPTCHA and a wrong code', async () => {
    const mobile = nextMobile();
    const bad = await httpLogin(mobile, { answer: 'WRONG' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('CAPTCHA_INVALID');

    const cap = await request(app).post('/api/auth/captcha');
    const answer = peekCaptchaAnswer(cap.body.captchaId)!;
    await request(app).post('/api/auth/request-otp').send({ mobile, captchaId: cap.body.captchaId, captchaAnswer: answer }).expect(200);
    await request(app).post('/api/auth/request-otp').send({ mobile, captchaId: cap.body.captchaId, captchaAnswer: answer }).expect(400);

    const wrong = await httpLogin(mobile, { code: '000000' });
    expect(wrong.status).toBe(400);
    expect(await prisma.user.count({ where: { mobile } })).toBe(0);
  });

  it('locks a challenge after too many wrong codes', async () => {
    const cap = await request(app).post('/api/auth/captcha');
    const otp = await request(app).post('/api/auth/request-otp').send({ mobile: nextMobile(), captchaId: cap.body.captchaId, captchaAnswer: peekCaptchaAnswer(cap.body.captchaId) });
    const wrong = otp.body.devCode === '111111' ? '222222' : '111111';
    let last;
    for (let i = 0; i < 5; i++) last = await request(app).post('/api/auth/verify-otp').send({ challengeId: otp.body.challengeId, code: wrong });
    expect(last!.body.error.code).toBe('OTP_LOCKED');
    const after = await request(app).post('/api/auth/verify-otp').send({ challengeId: otp.body.challengeId, code: otp.body.devCode });
    expect(after.status).toBe(400);
  });

  it('validates the mobile number and requires a token', async () => {
    const res = await request(app).post('/api/auth/request-otp').send({ mobile: '12345' });
    expect(res.status).toBe(400);
    await request(app).get('/api/wallet').expect(401);
    await request(app).get('/api/wallet').set('Authorization', 'Bearer nonsense').expect(401);
  });

  it('refuses blocked accounts', async () => {
    const p = await newPlayer();
    await prisma.user.update({ where: { id: p.id }, data: { status: 'BLOCKED' } });
    await request(app).get('/api/wallet').set('Authorization', `Bearer ${p.token}`).expect(403);
    await expect(loginWithVerifiedMobile(p.mobile)).rejects.toMatchObject({ status: 403 });
  });
});

describe('wallet ledger', () => {
  let user: Awaited<ReturnType<typeof newPlayer>>;
  beforeEach(async () => {
    user = await newPlayer();
  });

  it('credits and debits with a ledger row and running balance', async () => {
    await prisma.$transaction((tx) => credit(tx, user.id, 50, 'ADMIN_CREDIT', `t:${user.id}:c`));
    await prisma.$transaction((tx) => debit(tx, user.id, 30, 'ADMIN_DEBIT', `t:${user.id}:d`));
    expect(await balanceOf(user.id)).toBe(120);
    const res = await request(app).get('/api/wallet/transactions').set('Authorization', `Bearer ${user.token}`).expect(200);
    expect(res.body.items.map((t: any) => [t.type, t.balanceAfter])).toEqual([['ADMIN_DEBIT', 120], ['ADMIN_CREDIT', 150], ['WELCOME_BONUS', 100]]);
    const filtered = await request(app).get('/api/wallet/transactions?type=ADMIN_CREDIT').set('Authorization', `Bearer ${user.token}`);
    expect(filtered.body.total).toBe(1);
    const w = await request(app).get('/api/wallet').set('Authorization', `Bearer ${user.token}`);
    expect(w.body).toMatchObject({ balance: 120, totalEarned: 150, totalSpent: 30 });
  });

  it('never lets the balance go negative', async () => {
    await expect(prisma.$transaction((tx) => debit(tx, user.id, 101, 'ADMIN_DEBIT', `t:${user.id}:x`))).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });
    expect(await balanceOf(user.id)).toBe(100);
    // Concurrent debits: only as many succeed as the balance allows.
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => prisma.$transaction((tx) => debit(tx, user.id, 40, 'ADMIN_DEBIT', `t:${user.id}:race:${i}`))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(await balanceOf(user.id)).toBe(20);
    // The database itself also refuses a negative balance.
    await expect(prisma.wallet.update({ where: { userId: user.id }, data: { balance: -1 } })).rejects.toThrow();
  });

  it('applies an idempotency key at most once', async () => {
    const key = `t:${user.id}:once`;
    const a = await prisma.$transaction((tx) => credit(tx, user.id, 10, 'ADMIN_CREDIT', key));
    const b = await prisma.$transaction((tx) => credit(tx, user.id, 10, 'ADMIN_CREDIT', key));
    expect([a.applied, b.applied]).toEqual([true, false]);
    expect(await balanceOf(user.id)).toBe(110);
  });

  it('players cannot reach the admin API', async () => {
    await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${user.token}`).expect(403);
    await request(app).post(`/api/admin/users/${user.id}/wallet-adjust`).set('Authorization', `Bearer ${user.token}`).send({ direction: 'CREDIT', amount: 1000, reason: 'self' }).expect(403);
  });
});
