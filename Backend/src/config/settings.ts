import { z } from 'zod';
import { prisma } from '../lib/prisma';

/**
 * Runtime configuration editable from the admin panel (stored in AppSetting).
 * Every key has a validator, a default and a description; unknown keys are rejected.
 */
export const SETTING_DEFS = {
  welcomeBonusPoints: { schema: z.number().int().min(0).max(100000), default: 100, description: 'Points credited once to every new player' },
  platformCommissionPct: { schema: z.number().int().min(0).max(50), default: 0, description: 'Percentage of each game pool kept by the platform' },
  entryPointsMin: { schema: z.number().int().min(0), default: 10, description: 'Smallest entry a room may ask for' },
  entryPointsMax: { schema: z.number().int().min(1), default: 10000, description: 'Largest entry a room may ask for' },
  referrerRewardPoints: { schema: z.number().int().min(0), default: 20, description: 'Points for the referrer once the invited player finishes a first game' },
  refereeRewardPoints: { schema: z.number().int().min(0), default: 10, description: 'Points for the invited player after finishing a first game' },
  turnTimeSec: { schema: z.number().int().min(5).max(120), default: 20, description: 'Seconds a player has to roll / move before the server plays for them' },
  maxMissedTurns: { schema: z.number().int().min(1).max(20), default: 3, description: 'Consecutive timed-out turns before a player forfeits' },
  disconnectTimeoutSec: { schema: z.number().int().min(5).max(600), default: 60, description: 'Seconds a disconnected player may take to reconnect before forfeiting' },
  matchmakingTimeoutSec: { schema: z.number().int().min(10).max(600), default: 60, description: 'Seconds to wait for opponents in public matchmaking' },
  roomIdleTimeoutSec: { schema: z.number().int().min(30).max(86400), default: 120, description: 'Seconds a room may sit without activity (nobody joining or readying up) before it is closed' },
  pointRequestsEnabled: { schema: z.boolean(), default: true, description: 'Let players send requests to add or withdraw virtual points' },
  pointRequestMax: { schema: z.number().int().min(1).max(10_000_000), default: 10000, description: 'Largest number of points a single request may ask for' },
  captchaEnabled: { schema: z.boolean(), default: true, description: 'Require a CAPTCHA on player sign-in' },
  captchaLength: { schema: z.number().int().min(4).max(8), default: 5, description: 'Number of characters in the CAPTCHA' },
  tournamentPrizeSplit: { schema: z.array(z.number().int().min(0).max(100)).min(1).max(4), default: [70, 30], description: 'Default prize percentages by final rank for new tournaments' },
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;
export type Settings = { [K in SettingKey]: z.infer<(typeof SETTING_DEFS)[K]['schema']> };

const TTL_MS = 5_000;
let cache: { at: number; value: Settings } | null = null;

export function defaultSettings(): Settings {
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(SETTING_DEFS)) out[k] = def.default;
  return out as Settings;
}

export async function getSettings(fresh = false): Promise<Settings> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const rows = await prisma.appSetting.findMany();
  const value = defaultSettings() as Record<string, unknown>;
  for (const row of rows) {
    const def = SETTING_DEFS[row.key as SettingKey];
    if (!def) continue;
    const parsed = def.schema.safeParse(row.value);
    if (parsed.success) value[row.key] = parsed.data;
  }
  cache = { at: Date.now(), value: value as Settings };
  return cache.value;
}

export function invalidateSettings() {
  cache = null;
}
