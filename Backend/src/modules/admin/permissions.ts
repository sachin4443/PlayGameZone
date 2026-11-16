import type { RequestHandler } from 'express';
import type { RoleName } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { forbidden } from '../../utils/errors';

/**
 * Staff authorisation. Every admin API route names the module and action it
 * needs; the menu shown in the panel is derived from the same data, so hiding a
 * menu and blocking its API are one decision, enforced here on the server.
 *
 *  ROOT_OWNER   – everything, always. Cannot be edited, disabled or removed through the API.
 *  SUPER_ADMIN  – everything except other super admins and the root owner.
 *  ADMIN/SUPPORT – role defaults until the account's permissions are customised.
 */
export const MODULES = {
  dashboard: 'Dashboard',
  users: 'Users',
  wallet: 'Wallet adjustments',
  accountRequests: 'Account requests',
  games: 'Games',
  rooms: 'Rooms',
  prizePools: 'Prize pools',
  tournaments: 'Tournaments',
  modes: 'Game modes',
  settings: 'Configuration',
  audit: 'Audit log',
  staff: 'Staff & permissions',
} as const;
export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

export const ACTIONS = ['view', 'read', 'create', 'update', 'delete', 'download', 'approve', 'reject', 'manage'] as const;
export type Action = (typeof ACTIONS)[number];
export type PermissionMap = Record<ModuleKey, Action[]>;

const all = (actions: readonly Action[]): PermissionMap => Object.fromEntries(MODULE_KEYS.map((m) => [m, [...actions]])) as PermissionMap;

export function roleDefaults(role: RoleName): PermissionMap {
  if (role === 'ROOT_OWNER' || role === 'SUPER_ADMIN') return all(ACTIONS);
  const map = all(['view', 'read']);
  map.staff = [];
  if (role === 'ADMIN') {
    for (const m of ['users', 'wallet', 'accountRequests', 'games', 'rooms', 'prizePools', 'tournaments'] as ModuleKey[]) {
      map[m] = ['view', 'read', 'create', 'update', 'download', 'approve', 'reject', 'manage'];
    }
    map.audit = ['view', 'read', 'download'];
  } else if (role !== 'SUPPORT') {
    return all([]);
  }
  return map;
}

/** Highest staff role first. */
const RANK: RoleName[] = ['ROOT_OWNER', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT'];
export const topRole = (roles: RoleName[]): RoleName | null => RANK.find((r) => roles.includes(r)) ?? null;

export async function effectivePermissions(userId: string): Promise<{ role: RoleName | null; permissions: PermissionMap }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { permsCustomized: true, permissions: true, roles: { select: { role: { select: { name: true } } } } },
  });
  const role = user ? topRole(user.roles.map((r) => r.role.name)) : null;
  if (!user || !role) return { role: null, permissions: all([]) };
  // The two top roles are never narrowed by stored rows.
  if (role === 'ROOT_OWNER' || role === 'SUPER_ADMIN' || !user.permsCustomized) return { role, permissions: roleDefaults(role) };
  const map = all([]);
  for (const row of user.permissions) {
    if (row.module in MODULES) map[row.module as ModuleKey] = row.actions.filter((a): a is Action => (ACTIONS as readonly string[]).includes(a));
  }
  return { role, permissions: map };
}

declare module 'express-serve-static-core' {
  interface Request {
    staff?: { role: RoleName; permissions: PermissionMap };
  }
}

/** Loads the caller's staff role and permissions once per request. */
export const loadStaff: RequestHandler = (req, _res, next) => {
  if (!req.user || req.user.kind !== 'staff') return next(forbidden());
  effectivePermissions(req.user.id)
    .then(({ role, permissions }) => {
      if (!role) return next(forbidden());
      req.staff = { role, permissions };
      next();
    })
    .catch(next);
};

/** Route guard: the caller needs `action` on `module`. */
export const can =
  (module: ModuleKey, action: Action): RequestHandler =>
  (req, _res, next) => {
    if (!req.staff?.permissions[module]?.includes(action)) return next(forbidden(`You do not have permission to ${action} ${MODULES[module].toLowerCase()}`));
    next();
  };

export const isRoot = (role: RoleName | null | undefined) => role === 'ROOT_OWNER';
