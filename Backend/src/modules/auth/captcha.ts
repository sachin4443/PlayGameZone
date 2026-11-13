import { createHash, randomInt, randomUUID, timingSafeEqual } from 'crypto';

/**
 * Self-contained SVG CAPTCHA. Answers are kept hashed, in memory, single-use and
 * short-lived. For a multi-instance deployment move this store to Redis.
 */
const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 50_000;
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface Entry { hash: Buffer; expiresAt: number; answer?: string }
const store = new Map<string, Entry>();

const sha = (s: string) => createHash('sha256').update(s).digest();

function sweep() {
  const now = Date.now();
  for (const [id, e] of store) if (e.expiresAt < now) store.delete(id);
  // Hard cap so the store cannot be used to exhaust memory.
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
}

function render(text: string): string {
  const w = 40 + text.length * 26;
  const hgt = 56;
  const colors = ['#4f46e5', '#db2777', '#059669', '#d97706', '#0284c7'];
  let body = '';
  for (let i = 0; i < 5; i++) {
    body += `<path d="M${randomInt(w)} ${randomInt(hgt)} Q${randomInt(w)} ${randomInt(hgt)} ${randomInt(w)} ${randomInt(hgt)}" stroke="${colors[randomInt(colors.length)]}" stroke-width="1.2" fill="none" opacity="0.55"/>`;
  }
  for (let i = 0; i < 24; i++) {
    body += `<circle cx="${randomInt(w)}" cy="${randomInt(hgt)}" r="1.1" fill="${colors[randomInt(colors.length)]}" opacity="0.6"/>`;
  }
  [...text].forEach((ch, i) => {
    const x = 22 + i * 26 + randomInt(6);
    const y = 36 + randomInt(9);
    const rot = randomInt(50) - 25;
    body += `<text x="${x}" y="${y}" font-size="${26 + randomInt(6)}" font-family="Verdana,Arial,sans-serif" font-weight="700" fill="${colors[randomInt(colors.length)]}" transform="rotate(${rot} ${x} ${y})">${ch}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}" role="img" aria-label="CAPTCHA"><rect width="100%" height="100%" rx="10" fill="#f4f4fb"/>${body}</svg>`;
}

export function createCaptcha(length: number, keepAnswer = false): { captchaId: string; svg: string } {
  sweep();
  let text = '';
  for (let i = 0; i < length; i++) text += CHARS[randomInt(CHARS.length)];
  const captchaId = randomUUID();
  store.set(captchaId, { hash: sha(text), expiresAt: Date.now() + TTL_MS, ...(keepAnswer ? { answer: text } : {}) });
  return { captchaId, svg: render(text) };
}

/** Single use: the entry is consumed whether or not the answer is right. */
export function verifyCaptcha(captchaId: string, answer: string): boolean {
  const entry = store.get(captchaId);
  store.delete(captchaId);
  if (!entry || entry.expiresAt < Date.now()) return false;
  return timingSafeEqual(entry.hash, sha(answer.trim().toUpperCase()));
}

/** Test helper – only populated when the captcha was created with keepAnswer. */
export function peekCaptchaAnswer(captchaId: string): string | undefined {
  return store.get(captchaId)?.answer;
}
