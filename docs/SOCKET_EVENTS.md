# Socket.IO events

Connect to the backend origin with the player JWT:

```js
const socket = io(BACKEND_URL, { auth: { token } });
```

Connections without a valid player token are refused. Each socket is rate limited.

Every client → server event takes one payload object and an acknowledgement callback:

```js
socket.emit('roll-dice', { gameId }, (res) => {
  // { ok: true, data } or { ok: false, error: { code, message } }
});
```

## Client → server

| Event | Payload | Result / effect |
|---|---|---|
| `join-room` | `{ code }` | Takes a seat in the room and subscribes to it. Returns the room. Fails with `ROOM_FULL`, `ROOM_CLOSED`, `INSUFFICIENT_POINTS`, `ALREADY_IN_ROOM`, `NOT_FOUND`. |
| `watch-room` | `{ code }` | Subscribes to room updates without taking a seat (after joining over REST, or after a reconnect). Returns the room. |
| `leave-room` | `{ code }` | Leaves a room that has not started. In matchmaking this cancels the search. |
| `player-ready` | `{ code, ready }` | Sets the caller's ready flag. |
| `start-game` | `{ code }` | Host only, all players ready. Locks every entry and starts the game. Returns `{ gameId }`. |
| `join-game` | `{ gameId }` | Subscribes to a running game and returns `{ gameId, state, serverTime }`. Players use it to resync after reconnecting; anyone else spectates read-only. |
| `roll-dice` | `{ gameId }` | Rolls for the caller if it is their turn. Any dice value sent by the client is ignored. |
| `move-token` | `{ gameId, tokenIndex, dieIndex? }` | Moves token `0..3`. `dieIndex` selects the shared die in Pick Your Dice. Fails with `ILLEGAL_MOVE`, `NOT_YOUR_TURN`, `WRONG_PHASE`. |
| `leave-game` | `{ gameId }` | Forfeits the game. |

## Server → client

| Event | Payload | When |
|---|---|---|
| `room-state` | room object | Any change in a room you are subscribed to. |
| `room-closed` | `{ code, reason, matchmakingTimeout? }` | Room cancelled, expired or matchmaking timed out. |
| `game-started` | `{ gameId }` | Your room's game has begun. |
| `match-ready` | `{ gameId, tournamentId, round }` | Your tournament match has begun. |
| `game-state` | `{ gameId, state, events, serverTime }` | After every action. `state` is the full authoritative snapshot; `events` lists what just happened, in order. |
| `dice-result` | `{ gameId, seat, dice, steps, power }` | A die was rolled. `steps` differs from `dice` on a power roll. |
| `token-killed` | `{ gameId, seat, victimSeat, victimToken }` | A token was captured. |
| `player-turn` | `{ gameId, seat, extra, deadline }` | The turn passed (or stayed, when `extra`). `deadline` is a server timestamp. |
| `player-disconnected` | `{ gameId, seat, userId, graceSec }` | A player lost their last connection. They forfeit after `graceSec`. |
| `player-reconnected` | `{ gameId, seat, userId }` | The player is back. |
| `game-finished` | `{ gameId, result, pool, commission, payouts }` | The game ended and was settled. |
| `game-cancelled` | `{ gameId, reason }` | The game was cancelled and entries refunded. |
| `wallet-update` | `{}` | Your points changed; re-fetch `/api/auth/me`. |
| `notification` | notification object | A new notification for you. |

## Game state

```ts
{
  rules,                      // effective rules of this game
  players: [{ seat, userId, name, avatar, color, tokens: number[], score, kills,
              turnsTaken, active, missed, connected }],
  turn,                       // index into players of whoever must act
  phase: 'ROLL' | 'MOVE' | 'DONE',
  dice, steps, power,         // current roll (ROLL mode)
  pool: number[],             // shared dice (PICK mode)
  legal: [{ token, die?, from, to }],   // moves the current player may make
  startedAt, endsAt, turnDeadline,      // server timestamps (ms)
  result: { reason, winners: seat[], ranking: seat[] } | null
}
```

Token positions: `-10` yard, `0` start cell, `1..50` ring, `51..55` home column, `56` home
(`-1` only in Kill to Enter: the ring cell before the start cell).

Event types inside `game-state.events`: `roll`, `pool`, `no-move`, `three-sixes`, `move`, `kill`,
`home`, `turn`, `forfeit`, `finish`.
