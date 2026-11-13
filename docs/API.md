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
| GET | `/auth/config` | | `{ provider, captchaEnabled }` |
| POST | `/auth/captcha` | | `{ enabled, captchaId, svg }` |
| POST | `/auth/request-otp` | `{ mobile, captchaId, captchaAnswer }` | `{ challengeId, expiresInSec, provider, devCode? }` (`devCode` only with the dev provider) |
| POST | `/auth/verify-otp` | `{ challengeId, code, referralCode? }` | `{ token, isNewUser, user }` |
| GET | `/auth/me` | | current user with wallet |
| POST | `/auth/logout` | | `{ ok }` |

## Player routes (player token)

| Method | Path | Notes |
|---|---|---|
| PATCH | `/users/me` | `{ displayName?, avatar?, soundEnabled?, theme? }` |
| GET | `/users/me/stats` | matches, wins, win rate, points won |
| GET | `/wallet` | `{ balance, locked, totalEarned, totalSpent }` |
| GET | `/wallet/transactions` | filters: `type`, `from`, `to` (ISO dates) |
| GET | `/games/modes` | active modes with effective rules |
| GET | `/games/live` | games in progress |
| GET | `/games/history` | the caller's finished games |
| GET | `/games/:id` | status, state snapshot, results |
| GET | `/rooms/public` | open public rooms |
| GET | `/rooms/active` | `{ room, gameIds }` to resume after a refresh |
| POST | `/rooms` | `{ name, modeKey, maxPlayers, entryPoints, visibility }` |
| POST | `/rooms/quick-match` | `{ modeKey, maxPlayers, entryPoints }` – joins or opens a matchmaking room |
| POST | `/rooms/join` | `{ code }` |
| GET | `/rooms/:code` | room details |
| POST | `/rooms/:code/ready` | `{ ready }` |
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

Roles: `SUPPORT` reads everything; `ADMIN` can also change users, games and tournaments;
`SUPER_ADMIN` can also change configuration, game modes and staff. Every change is written to the
audit log.

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/admin/auth/login` | public | `{ username, password }` → `{ token, user }` |
| GET | `/admin/dashboard` | any | users, games, points issued / in circulation / in escrow |
| GET | `/admin/users` | any | `search`, `status` |
| GET | `/admin/users/:id` | any | profile, wallet, stats, recent games |
| GET | `/admin/users/:id/transactions` | any | wallet history |
| POST | `/admin/users/:id/status` | admin | `{ status: ACTIVE\|BLOCKED, reason }` |
| POST | `/admin/users/:id/wallet-adjust` | admin | `{ direction: CREDIT\|DEBIT, amount, reason, requestId? }` – `requestId` (UUID) makes retries safe |
| GET | `/admin/games` | any | `status` |
| GET | `/admin/games/:id` | any | players, room, state, results |
| POST | `/admin/games/:id/cancel` | admin | `{ reason }` – cancels and refunds every entry |
| GET | `/admin/rooms` | any | `status`, `visibility` |
| GET / PUT | `/admin/settings` | any / super | PUT body is `{ key: value, ... }` |
| GET | `/admin/modes` | any | modes with stored overrides and effective rules |
| PATCH | `/admin/modes/:id` | super | name, tagline, description, isActive, minEntry, maxEntry, allowedPlayers, rules |
| GET / POST | `/admin/tournaments` | any / admin | POST `{ name, description?, modeKey, entryPoints, capacity, bonusPool?, startsAt, prizeSplit? }` |
| POST | `/admin/tournaments/:id/start` | admin | start now |
| POST | `/admin/tournaments/:id/cancel` | admin | upcoming only; refunds entries |
| GET | `/admin/audit-logs` | any | |
| GET / POST | `/admin/staff` | super | POST `{ username, password, role }` |

### Settings

`welcomeBonusPoints`, `platformCommissionPct`, `entryPointsMin`, `entryPointsMax`,
`referrerRewardPoints`, `refereeRewardPoints`, `turnTimeSec`, `maxMissedTurns`,
`disconnectTimeoutSec`, `matchmakingTimeoutSec`, `roomIdleTimeoutSec`, `captchaEnabled`,
`captchaLength`, `tournamentPrizeSplit`.

### Rate limits

All of `/api`: 300 requests/minute per IP. Player auth endpoints: 40 per 10 minutes. Admin login:
15 per 15 minutes.
