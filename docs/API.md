# REST API

Base path `/api`. JSON in and out. Authenticated routes need `Authorization: Bearer <token>`.

Errors always have this shape, with a 4xx/5xx status:

```json
{ "error": { "code": "INSUFFICIENT_POINTS", "message": "You need 20 points to enter this room" } }
```

Lists that page accept `page` and `pageSize` and return `{ items, total, page, pageSize }`.

## Auth (public)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/auth/config` | | `{ method: "pin", captchaEnabled }` |
| POST | `/auth/captcha` | | `{ enabled, captchaId, svg }` |
| POST | `/auth/register` | `{ mobile, pin, confirmPin, captchaId, captchaAnswer, referralCode? }` | `{ token, isNewUser, user }` – `409 MOBILE_REGISTERED` if the number has an account |
| POST | `/auth/login` | `{ mobile, pin }` | `{ token, user }` – `401 INVALID_CREDENTIALS`, `423 PIN_LOCKED` |
| POST | `/auth/change-pin` | `{ currentPin, newPin }` (player token) | `{ ok }` |
| GET | `/auth/me` | | current user with wallet |
| POST | `/auth/logout` | | `{ ok }` |

## Player routes (player token)

| Method | Path | Notes |
|---|---|---|
| PATCH | `/users/me` | `{ displayName?, avatar?, soundEnabled?, theme? }` |
| GET | `/users/me/stats` | matches, wins, win rate, points won |
| GET / POST | `/users/me/requests` | list / create `{ type: MOBILE_CHANGE\|ACCOUNT_DELETE, newMobile?, reason }` – decided by staff |
| GET | `/wallet` | `{ balance, locked, totalEarned, totalSpent }` |
| GET | `/wallet/transactions` | filters: `type`, `from`, `to` (ISO dates) |
| GET / POST | `/wallet/requests` | list / create `{ type: ADD\|WITHDRAW, amount, note? }` – virtual points, decided by staff |
| GET | `/games/modes` | active modes with effective rules |
| POST | `/games/practice` | `{ modeKey, players }` – free game against computer players → `{ gameId }` |
| GET | `/games/live` | games in progress |
| GET | `/games/history` | the caller's finished games |
| GET | `/games/:id` | status, state snapshot, results |
| GET | `/rooms/public` | open public rooms |
| GET | `/rooms/pools` | active prize pools with seats taken |
| POST | `/rooms/pools/:id/join` | take a seat; starts when full |
| GET | `/rooms/active` | `{ room, gameIds }` to resume after a refresh |
| POST | `/rooms` | `{ name, modeKey, maxPlayers, entryPoints, visibility }` |
| POST | `/rooms/quick-match` | `{ modeKey, maxPlayers, entryPoints }` – joins or opens a matchmaking room |
| POST | `/rooms/join` | `{ code }` |
| GET | `/rooms/:code` | room details |
| POST | `/rooms/:code/ready` | `{ ready }` |
| POST | `/rooms/:code/first-turn` | host only: `{ userId \| null }` (null = random); visible to all players |
| POST | `/rooms/:code/start` | host only → `{ gameId }` |
| POST | `/rooms/:code/leave` | |
| GET | `/tournaments` | list |
| GET | `/tournaments/:id` | details, players, bracket |
| POST | `/tournaments/:id/register` | debits the entry |
| POST | `/tournaments/:id/unregister` | before the start; refunds the entry |
| GET | `/leaderboard?period=daily\|weekly\|monthly\|all` | wins, matches, win %, points |
| GET | `/referrals` | code, rewards, invited players |
| GET | `/notifications` | plus `unread` count |
| POST | `/notifications/read-all` | |

## Admin routes (staff token)

Each route needs one action on one module (shown as `module:action`). The root owner and super
admins have every permission; other staff have what was granted to them. Every change is written to
the audit log. A staff account with a temporary password gets `403 PASSWORD_CHANGE_REQUIRED` on
everything except `/admin/me` and `/admin/auth/change-password`.

| Method | Path | Needs | Notes |
|---|---|---|---|
| POST | `/admin/auth/login` | public | `{ username, password }` → `{ token, user, mustChangePassword }` |
| POST | `/admin/auth/change-password` | signed in | `{ currentPassword, newPassword }` |
| GET | `/admin/me` | signed in | profile, role, permission map, module and action lists |
| GET | `/admin/notifications/summary` | signed in | `{ accountRequests, pointRequests }` pending counts (polled by the panel) |
| GET | `/admin/dashboard` | dashboard:read | users, games, points issued / in circulation / in escrow |
| GET | `/admin/users`, `/admin/users/:id`, `/admin/users/:id/transactions` | users:read | `search`, `status` |
| POST | `/admin/users/:id/status` | users:update | `{ status: ACTIVE\|BLOCKED, reason }` |
| POST | `/admin/users/:id/set-pin` | users:manage | `{ pin }` – for players who forgot their PIN |
| POST | `/admin/users/:id/wallet-adjust` | wallet:update | `{ direction: CREDIT\|DEBIT, amount, reason, requestId? }` – `requestId` (UUID) makes retries safe |
| GET | `/admin/account-requests` | accountRequests:read | `status`, `search` |
| POST | `/admin/account-requests/:id/approve` | accountRequests:approve | `{ remark? }` |
| POST | `/admin/account-requests/:id/reject` | accountRequests:reject | `{ remark }` (required, shown to the player) |
| GET | `/admin/games`, `/admin/games/:id` | games:read | `status` |
| POST | `/admin/games/:id/cancel` | games:manage | `{ reason }` – cancels and refunds every entry |
| GET | `/admin/rooms` | rooms:read | `status`, `visibility` |
| PATCH | `/admin/rooms/:id` | rooms:manage | `{ firstTurnUserId \| null }` – waiting non-matchmaking rooms only; shown to players |
| POST | `/admin/rooms/:id/close` | rooms:manage | `{ reason }` – closes a room that has not started |
| GET | `/admin/point-requests` | pointRequests:read | `status`, `type`, `search` |
| POST | `/admin/point-requests/:id/approve` | pointRequests:approve | `{ remark? }` – applies the wallet change once |
| POST | `/admin/point-requests/:id/reject` | pointRequests:reject | `{ remark }` (required) |
| GET | `/admin/prize-pools` | prizePools:read | |
| POST / PUT / DELETE | `/admin/prize-pools`, `/admin/prize-pools/:id` | prizePools:create / update / delete | `{ name, modeKey, players, entryPoints, prizePoints, isActive, sortOrder }`; a played pool is disabled instead of deleted |
| GET / PUT | `/admin/settings` | settings:read / manage | PUT body is `{ key: value, ... }` |
| GET / PATCH | `/admin/modes`, `/admin/modes/:id` | modes:read / update | name, tagline, description, isActive, minEntry, maxEntry, allowedPlayers, rules |
| GET / POST | `/admin/tournaments` | tournaments:read / create | `{ name, description?, modeKey, entryPoints, capacity, bonusPool?, startsAt, prizeSplit? }` |
| POST | `/admin/tournaments/:id/start`, `/cancel` | tournaments:manage | |
| GET | `/admin/audit-logs` | audit:read | `adminId`, `action` filters |
| GET | `/admin/export/:name` | download on the module | CSV: `users`, `games`, `transactions` (wallet), `audit` |
| GET | `/admin/staff`, `/admin/staff/:id` | staff:read | accounts; one account's effective permissions |
| POST | `/admin/staff` | staff:create | `{ username, password, role: SUPER_ADMIN\|ADMIN\|SUPPORT }` – temporary password |
| PATCH | `/admin/staff/:id` | staff:update | `{ status?, role? }` |
| PUT | `/admin/staff/:id/permissions` | staff:manage | `{ module: [actions] }` – root owner or super admin only |
| POST | `/admin/staff/:id/reset-password` | staff:manage | `{ password }` – temporary |
| DELETE | `/admin/staff/:id` | staff:delete | account ended; audit history kept |

Hierarchy on all `/admin/staff/:id` routes: the root owner cannot be targeted, nobody can target
themselves, and only the root owner can create or manage super admins.

### Settings

`welcomeBonusPoints`, `platformCommissionPct`, `entryPointsMin`, `entryPointsMax`,
`referrerRewardPoints`, `refereeRewardPoints`, `turnTimeSec`, `maxMissedTurns`,
`disconnectTimeoutSec`, `matchmakingTimeoutSec`, `roomIdleTimeoutSec`, `captchaEnabled`,
`captchaLength`, `tournamentPrizeSplit`, `pointRequestsEnabled`, `pointRequestMax`.

### Rate limits

All of `/api`: 300 requests/minute per IP. Player auth endpoints: 40 per 10 minutes. Admin login:
15 per 15 minutes.
