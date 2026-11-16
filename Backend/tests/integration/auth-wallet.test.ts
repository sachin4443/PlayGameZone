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

async function register(mobile: string, pin = '4826', over: Record<string, unknown> = {}) {
  const cap = await request(app).post('/api/auth/captcha').expect(200);
  return request(app).post('/api/auth/register').send({ mobile, pin, confirmPin: pin, captchaId: cap.body.captchaId, captchaAnswer: peekCaptchaAnswer(cap.body.captchaId), ...over });
}
const login = (mobile: string, pin = '4826') => request(app).post('/api/auth/login').send({ mobile, pin });

describe('registration and login', () => {
  it('registers a new player with a wallet and exactly 100 welcome points', async () => {
    const mobile = nextMobile();
    const res = await register(mobile);
    expect(res.status).toBe(201);
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.user.wallet.balance).toBe(100);
    const txs = await prisma.walletTransaction.findMany({ where: { userId: res.body.user.id } });
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ type: 'WELCOME_BONUS', direction: 'CREDIT', amount: 100, balanceAfter: 100 });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
    expect(me.body.mobile).toBe(mobile);
  });

  it('stores the PIN only as a hash', async () => {
    const mobile = nextMobile();
    await register(mobile, '7391');
    const user = await prisma.user.findUniqueOrThrow({ where: { mobile } });
    expect(user.pinHash).toMatch(/^\$2[aby]\$/);
    expect(user.pinHash).not.toContain('7391');
    expect(JSON.stringify((await login(mobile, '7391')).body)).not.toContain('pinHash');
  });

  it('never grants the welcome bonus again on later logins', async () => {
    const mobile = nextMobile();
    const first = await register(mobile);
    const second = await login(mobile);
    const third = await login(mobile);
    expect(second.status).toBe(200);
    expect(second.body.isNewUser).toBe(false);
    expect(third.body.user.id).toBe(first.body.user.id);
    expect(third.body.user.wallet.balance).toBe(100);
    expect(await prisma.walletTransaction.count({ where: { userId: first.body.user.id, type: 'WELCOME_BONUS' } })).toBe(1);
  });

  it('allows only one account per mobile number, even under concurrent registration', async () => {
    const mobile = nextMobile();
    expect((await register(mobile)).status).toBe(201);
    const again = await register(mobile, '9514');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('MOBILE_REGISTERED');
    expect((await login(mobile, '9514')).status).toBe(401); // the second PIN did not replace the first

    const fresh = nextMobile();
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => register(fresh, `58${i}3`)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.user.count({ where: { mobile: fresh } })).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { mobile: fresh } });
    expect(await balanceOf(user.id)).toBe(100);
  });

  it('grants one bonus even when account creation races', async () => {
    const mobile = nextMobile();
    const results = await Promise.all(Array.from({ length: 6 }, () => loginWithVerifiedMobile(mobile)));
    const ids = new Set(results.map((r) => r.user.id));
    expect(ids.size).toBe(1);
    expect(await balanceOf([...ids][0])).toBe(100);
    const again = await prisma.$transaction((tx) => grantWelcomeBonus(tx, [...ids][0], 100));
    expect(again).toBe(false);
    expect(await balanceOf([...ids][0])).toBe(100);
  });

  it('uses the configured welcome bonus amount', async () => {
    await setSetting('welcomeBonusPoints', 250);
    const res = await register(nextMobile());
    expect(res.body.user.wallet.balance).toBe(250);
    await setSetting('welcomeBonusPoints', 100);
  });

  it('validates the PIN, its confirmation and the CAPTCHA', async () => {
    const mobile = nextMobile();
    expect((await register(mobile, '4826', { confirmPin: '4827' })).status).toBe(400);
    expect((await register(mobile, '12')).status).toBe(400);
    const weak = await register(mobile, '1234');
    expect(weak.body.error.code).toBe('PIN_WEAK');
    const bad = await register(mobile, '4826', { captchaAnswer: 'WRONG' });
    expect(bad.body.error.code).toBe('CAPTCHA_INVALID');
    // A CAPTCHA works once.
    const cap = await request(app).post('/api/auth/captcha');
    const body = { mobile, pin: '4826', confirmPin: '4826', captchaId: cap.body.captchaId, captchaAnswer: peekCaptchaAnswer(cap.body.captchaId) };
    await request(app).post('/api/auth/register').send(body).expect(201);
    await request(app).post('/api/auth/register').send({ ...body, mobile: nextMobile() }).expect(400);
    expect(await prisma.user.count({ where: { mobile } })).toBe(1);
  });

  it('gives the same answer for a wrong PIN and an unknown number', async () => {
    const mobile = nextMobile();
    await register(mobile);
    const wrong = await login(mobile, '0001');
    const unknown = await login(nextMobile(), '0001');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
  });

  it('locks the account after repeated wrong PINs, then lets the right PIN in after the lock', async () => {
    const mobile = nextMobile();
    await register(mobile);
    let last;
    for (let i = 0; i < 5; i++) last = await login(mobile, '0002');
    expect(last!.status).toBe(423);
    expect(last!.body.error.code).toBe('PIN_LOCKED');
    expect((await login(mobile)).status).toBe(423); // even the right PIN waits
    await prisma.user.update({ where: { mobile }, data: { pinLockedUntil: new Date(Date.now() - 1000) } });
    expect((await login(mobile)).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { mobile } })).failedPinAttempts).toBe(0);
  });

  it('changes the PIN only with the current one', async () => {
    const mobile = nextMobile();
    const { body } = await register(mobile);
    const auth = { Authorization: `Bearer ${body.token}` };
    await request(app).post('/api/auth/change-pin').set(auth).send({ currentPin: '0003', newPin: '6157' }).expect(400);
    await request(app).post('/api/auth/change-pin').set(auth).send({ currentPin: '4826', newPin: '6157' }).expect(200);
    expect((await login(mobile, '4826')).status).toBe(401);
    expect((await login(mobile, '6157')).status).toBe(200);
  });

  it('validates the mobile number and requires a token', async () => {
    expect((await register('12345')).status).toBe(400);
    await request(app).get('/api/wallet').expect(401);
    await request(app).get('/api/wallet').set('Authorization', 'Bearer nonsense').expect(401);
  });

  it('refuses blocked accounts', async () => {
    const mobile = nextMobile();
    const { body } = await register(mobile);
    await prisma.user.update({ where: { id: body.user.id }, data: { status: 'BLOCKED' } });
    await request(app).get('/api/wallet').set('Authorization', `Bearer ${body.token}`).expect(403);
    expect((await login(mobile)).status).toBe(403);
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
