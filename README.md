# PlayerX Ludo

Real-time multiplayer Ludo platform: private rooms with room codes, public matchmaking, five
playable game modes, knockout tournaments, leaderboards, referrals, a points wallet with a full
ledger, and a staff admin panel.

**Points are virtual.** There is no deposit, withdrawal, cash redemption or player-to-player
transfer anywhere in the system.

| | |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS 4, React Router, Axios, Socket.IO client |
| Backend | Node.js, Express, TypeScript, Socket.IO, Zod, JWT |
| Database | PostgreSQL, Prisma ORM + migrations |
| Tests | Vitest, Supertest, socket.io-client (79 tests) |

```
Backend/
  prisma/            schema.prisma, migrations/, seed.ts
  src/
    config/          env validation, admin-editable settings
    middlewares/     auth (JWT + roles), rate limits, error handling
    modules/
      auth/          CAPTCHA, pluggable OTP provider, login/registration
      wallet/        ledger: credit, debit, escrow, settlement, refund
      rooms/         private/public rooms, room codes, matchmaking
      games/         engine/ (pure rules engine), game.manager (live games), settlement
      tournaments/   registration, brackets, prizes
      leaderboard/ referrals/ notifications/ users/ admin/
    sockets/         Socket.IO server
    services/        realtime hub, scheduler
  tests/             unit/ (engine) and integration/ (database, HTTP, sockets)
Frontend/
  src/pages/         player app      src/admin/   admin panel (lazy-loaded at /admin)
  src/components/    LudoBoard (SVG), Dice, layout, UI kit
docs/                API.md, SOCKET_EVENTS.md
```

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer

## Setup

```bash
npm run install:all
```

Create the two databases (the second is used only by the automated tests):

```sql
CREATE DATABASE "AlwaysGame";
CREATE DATABASE "AlwaysGame_test";
```

Create `Backend/.env` from the example and fill in your values:

```bash
cp Backend/.env.example Backend/.env
```

For `Host=localhost;Port=5431;Database=AlwaysGame;Username=postgres;Password=root@123` the Prisma
URL is below. The `@` inside the password must be written as `%40`:

```
DATABASE_URL="postgresql://postgres:root%40123@localhost:5431/AlwaysGame?schema=public"
TEST_DATABASE_URL="postgresql://postgres:root%40123@localhost:5431/AlwaysGame_test?schema=public"
```

`.env` is git-ignored. Never commit it. Set `JWT_SECRET` to a long random value
(`openssl rand -hex 48`) and choose your own `SEED_ADMIN_PASSWORD`.

Create the tables and the initial data:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

`db:migrate` runs `prisma migrate deploy` and regenerates the Prisma client (if you ever see
"@prisma/client did not initialize yet", run `npm run db:generate`). The deploy step: it only applies pending migrations and never resets or
drops anything. The seed is idempotent; it adds roles, the five game modes and the super admin
(from `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`) if they are missing.

## Run in development

Backend on http://localhost:4000:

```bash
npm run dev:backend
```

Frontend on http://localhost:5173 (it proxies `/api` and `/socket.io` to the backend):

```bash
npm run dev:frontend
```

- Player app: http://localhost:5173
- Admin panel: http://localhost:5173/admin

To try multiplayer on one machine, open the app in two different browsers (or one normal and one
private window) and sign in with two different mobile numbers.

## Tests

```bash
npm test
```

Integration tests run against `TEST_DATABASE_URL` and truncate its tables; the test setup refuses to
run unless that database name ends in `_test`. Apply migrations to it once:

```bash
cd Backend && DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
```

Covered: registration, one-time welcome bonus (including concurrent first logins), login, CAPTCHA
and OTP failures, wallet credit/debit, insufficient points, room creation/joining/code validation,
game start and escrow, server dice, move validation, captures, winner calculation, settlement
(2 and 4 players, commission), duplicate-settlement prevention, cancellation and refunds,
reconnection, forfeits, server-restart recovery, matchmaking, tournaments and prizes, referrals,
admin permissions and audit logging, and a full game over real Socket.IO connections.

## Production build

```bash
npm run build
```

```bash
NODE_ENV=production npm start
```

Serve `Frontend/dist` as static files (with a fallback to `index.html` for client-side routes) and
reverse-proxy `/api` and `/socket.io` (with WebSocket upgrade) to the backend. If the frontend is on
a different origin, build it with `VITE_API_URL=https://api.example.com` and list the frontend
origin in the backend's `CORS_ORIGINS`.

Production checklist:

- `AUTH_PROVIDER=sms` with a real SMS gateway (see below). The server refuses to start in
  production with the development login unless `ALLOW_DEV_AUTH_IN_PRODUCTION=true`.
- A strong `JWT_SECRET`, HTTPS, and `CORS_ORIGINS` limited to your domain.
- Run a single backend process (see "Scaling").

## Authentication

Player sign-in is two steps and is built so SMS can be added without touching the rest:

1. `POST /api/auth/request-otp` with mobile number + CAPTCHA answer → a challenge id.
2. `POST /api/auth/verify-otp` with challenge id + 6-digit code → JWT. The account, profile, wallet
   and welcome bonus are created on the first successful sign-in.

How the code reaches the user is decided by an `OtpProvider` (`Backend/src/modules/auth/otp.ts`):

- `AUTH_PROVIDER=dev` (**temporary, development only**): no SMS is sent; the code is returned to the
  client and shown on screen. The CAPTCHA only slows bots down here – it does **not** prove that
  someone owns a phone number, so anyone can sign in as any number in this mode.
- `AUTH_PROVIDER=sms`: implement `SmsOtpProvider.send()` with your gateway. Nothing else changes.

Staff sign in separately with username and password (bcrypt) at `/admin`. Player and staff tokens
are different kinds and are not interchangeable.

## Points and wallet rules

- New players get the welcome bonus (default 100) exactly once. The grant flips a flag on the user
  row atomically and uses a unique ledger key, so repeated or simultaneous logins cannot repeat it.
- Every movement writes one row to an append-only ledger with the balance after it.
- **Escrow:** when a game starts, each player's entry moves from `balance` to `locked` in the same
  transaction that creates the game. If any player cannot pay, nothing is taken and the game does
  not start.
- **Settlement:** when the game ends, losers' escrow is released to the pool and the winner receives
  `pool − commission`. Commission is admin-configurable and defaults to 0%.
- **Refund:** a cancelled game returns every locked entry.
- Settlement and cancellation are mutually exclusive and idempotent: the game row can leave `ACTIVE`
  only once, and every wallet movement has a unique idempotency key.
- Balances are changed with conditional updates and protected by database `CHECK` constraints, so
  they cannot go negative.

## Game modes

Every mode is a rules configuration run by the same server engine
(`Backend/src/modules/games/engine`). Admins can override individual rules per mode.

| Mode | How it plays |
|---|---|
| Classic Ludo | Six to leave the yard, captures, safe cells, exact roll home. First to get all four tokens home wins. |
| Timer 5 Min | Tokens start on the board. Points per step, capture and home. Highest score when the 5-minute server clock ends. |
| Mania | 25 rolls each, star cells and blocks give no protection, every 5th roll moves double. Highest score wins. |
| Pick Your Dice | Three shared dice; pick one, move, it is re-rolled for the next player. 30 picks each. Highest score wins. |
| Kill to Enter | Classic, but your home column is locked until you capture a token. |

The server rolls the dice (`crypto.randomInt`), validates every move, runs turn and game clocks and
decides the winner. Clients only send "roll" and "move token N".

## Assumptions made

- **Database URL.** The URL in the brief (`postgresql://postgres%40123@localhost:5431/...`) was
  missing the user/password separator; the working form is shown above.
- **Four-player games** end when the first player finishes, and that player takes the pool.
- **Score ties** (score modes only) split the pool equally; an indivisible remainder stays with the
  platform.
- **Blocks:** two tokens of one colour on a cell cannot be captured (configurable per mode).
- **Mania and Pick Your Dice** rule details were not specified, so the rules in the table above were
  designed for this project; all of them are configurable.
- **Entry** is taken when the game starts, not when a player joins a room. A player can sit in only
  one waiting room or room game at a time.
- **Tournaments** are single-elimination with two-player matches. The entry is paid at registration;
  matches themselves take no further entry. Default prize split is 70% / 30%.
- **Referral rewards** are paid to both sides after the invited player finishes a first game, to
  discourage farming with throwaway accounts.
- **Leaving a game on purpose forfeits it.** Losing connection does not: the server plays the turns
  and the player can rejoin until the reconnect window (default 60 s) runs out.
- **Logout** discards the JWT on the client; tokens are stateless and expire after `JWT_EXPIRES_IN`.

## Scaling

Live game state, CAPTCHAs and OTP challenges are held in the memory of one backend process (games
are also persisted after every move and resume after a restart). To run several instances, add the
Socket.IO Redis adapter with sticky sessions and move those stores to Redis.

## Documentation

- [REST API](docs/API.md)
- [Socket.IO events](docs/SOCKET_EVENTS.md)
