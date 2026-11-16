# PlayerX Ludo

Real-time multiplayer Ludo platform: private rooms with room codes, public matchmaking, five
playable Ludo modes plus Snake & Ladder, prize-pool tables, practice against the computer, knockout tournaments, leaderboards, referrals, a points wallet with a full
ledger, and a staff admin panel.

**Points are virtual.** There is no deposit, withdrawal, cash redemption or player-to-player
transfer anywhere in the system.

| | |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS 4, React Router, Axios, Socket.IO client |
| Backend | Node.js, Express, TypeScript, Socket.IO, Zod, JWT |
| Database | PostgreSQL, Prisma ORM + migrations |
| Tests | Vitest, Supertest, socket.io-client (105 tests) |

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

- A strong `JWT_SECRET`, HTTPS, and `CORS_ORIGINS` limited to your domain.
- Run a single backend process (see "Scaling").

## Authentication

**Players** register with a mobile number and a 4–6 digit PIN (entered twice, plus a CAPTCHA), then
sign in with mobile + PIN.

- One mobile number = one account (unique in the database; concurrent registrations cannot both win).
- The PIN is stored only as a bcrypt hash. Easily guessed PINs (1234, 0000 …) are refused.
- Five wrong PINs lock the account for 15 minutes; auth endpoints are also rate limited per IP.
- A wrong PIN and an unknown number get the same answer.
- Changing a mobile number or deleting an account is a request that staff approve or reject
  (Profile → Account & security). A forgotten PIN is reset by staff from the user's page.
- **Accounts created before PIN login existed** have no PIN: the owner sets one by using
  "Create account" with the same number, once.
- **Limitation:** without SMS there is no proof that someone owns the number they register.
  `Backend/src/modules/auth/otp.ts` is the ready integration point: verify the number there before
  `registerWithPin` once an SMS gateway is available.

**Staff** sign in at `/admin` with username and password. Player and staff tokens are different
kinds and are not interchangeable.

## Staff roles and permissions

| Role | Access |
|---|---|
| Root owner | Everything, always. Cannot be edited, disabled, deleted or have its password reset by anyone else through the API. There is one, created by the seed. |
| Super admin | Everything, except managing other super admins or the root owner. |
| Admin / Staff | Exactly the menus and actions granted to that account. |

- Each admin API route requires an action (`view`, `read`, `create`, `update`, `delete`, `download`,
  `approve`, `reject`, `manage`) on a module (Dashboard, Users, Wallet adjustments, Account requests,
  Games, Rooms, Prize pools, Tournaments, Game modes, Configuration, Audit log, Staff & permissions).
  The menu is built from the same data, so a hidden menu is also blocked by direct URL and by API.
- Only the root owner or a super admin can assign permissions, and nobody can change their own
  account, so staff cannot raise their own access.
- New and reset staff passwords are temporary: the account can do nothing until it sets its own.
- Every change, approval, export and permission edit is written to the audit log, viewable per
  staff member (Staff → Activity).

**Creating the root owner.** Put the username and an initial password in `Backend/.env`
(`ROOT_OWNER_USERNAME`, `ROOT_OWNER_PASSWORD`), run `npm run db:seed`, sign in at `/admin`, choose a
new password when asked, then delete `ROOT_OWNER_PASSWORD` from `.env`. The password is never in the
source code or the repository.

## Ways to play

- **Private room** – create a room, share the code, start when everyone is ready.
- **Quick match** – public matchmaking by game, table size and entry.
- **Prize pools** – standing tables set up by staff with a fixed entry and a fixed prize. Tap to take
  a seat; the match starts when the table fills.
- **Vs computer** – free practice against 1–3 computer players, for Ludo modes and Snake & Ladder.
  No points move, and practice games do not count for the leaderboard, statistics or referrals.
  Computer players only ever appear in practice games, and are labelled.

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
| Snake & Ladder | Separate board game (2–4 players). Race to 100; ladders up, snakes down, six rolls again, exact roll to finish. |

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
- **Prize pools** pay their advertised prize; the rest of the entries stays with the platform. The
  prize can never exceed the total entries.
- **Deleting an account** closes it, frees the mobile number and keeps game and ledger history.
- **Logout** discards the JWT on the client; tokens are stateless and expire after `JWT_EXPIRES_IN`.

## Scaling

Live game state and CAPTCHAs are held in the memory of one backend process (games
are also persisted after every move and resume after a restart). To run several instances, add the
Socket.IO Redis adapter with sticky sessions and move those stores to Redis.

## Documentation

- [REST API](docs/API.md)
- [Socket.IO events](docs/SOCKET_EVENTS.md)
