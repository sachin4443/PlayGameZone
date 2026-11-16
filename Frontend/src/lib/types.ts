export type Color = 'red' | 'green' | 'yellow' | 'blue';

export interface Me {
  id: string;
  mobile: string | null;
  username: string | null;
  referralCode: string;
  displayName: string;
  avatar: string;
  soundEnabled: boolean;
  theme: 'light' | 'dark' | 'auto';
  roles: string[];
  wallet: { balance: number; locked: number; totalEarned: number; totalSpent: number } | null;
}

export interface Rules {
  tokensPerPlayer: number;
  sixToRelease: boolean;
  killRequiredForHome: boolean;
  winBy: 'HOME' | 'SCORE';
  turnLimit: number;
  timeLimitSec: number;
  dice: 'ROLL' | 'PICK';
  powerTurnEvery: number;
  starSafe: boolean;
  blockSafe: boolean;
  scoreKill: number;
  scoreHome: number;
}

export interface SnakesRules { exactFinish: boolean; extraTurnOnSix: boolean; maxConsecutiveSixes: number }

export interface GameMode {
  /** Which board game this mode belongs to. */
  game: 'LUDO' | 'SNAKES';
  key: string;
  name: string;
  tagline: string;
  description: string;
  minEntry: number;
  maxEntry: number;
  allowedPlayers: number[];
  rules: Rules & SnakesRules;
}

export interface RoomView {
  id: string;
  code: string;
  name: string;
  mode: { key: string; name: string };
  hostId: string;
  maxPlayers: number;
  entryPoints: number;
  prizePool: number;
  pool: { id: string; name: string } | null;
  visibility: 'PUBLIC' | 'PRIVATE';
  isMatchmaking: boolean;
  status: 'WAITING' | 'IN_GAME' | 'COMPLETED' | 'CANCELLED';
  expiresAt: string | null;
  gameId: string | null;
  firstTurnUserId: string | null;
  firstTurnSetBy: 'HOST' | 'ADMIN' | null;
  players: { userId: string; seat: number; isReady: boolean; name: string; avatar: string }[];
}

export interface PlayerState {
  seat: number;
  userId: string;
  name: string;
  avatar: string;
  color: Color;
  tokens: number[];
  score: number;
  kills: number;
  turnsTaken: number;
  active: boolean;
  missed: number;
  connected: boolean;
  bot?: boolean;
}

export interface LegalMove { token: number; die?: number; from: number; to: number }

export interface GameResult { reason: 'HOME' | 'SCORE' | 'TIME' | 'TURNS' | 'FORFEIT'; winners: number[]; ranking: number[] }

export interface GameState {
  kind?: 'LUDO';
  rules: Rules;
  players: PlayerState[];
  turn: number;
  phase: 'ROLL' | 'MOVE' | 'DONE';
  dice: number | null;
  steps: number | null;
  power: boolean;
  pool: number[];
  legal: LegalMove[];
  startedAt: number;
  endsAt: number | null;
  turnDeadline: number | null;
  result: GameResult | null;
}

export interface SnakesPlayer extends Omit<PlayerState, 'tokens' | 'kills'> { pos: number }

export interface SnakesState {
  kind: 'SNAKES';
  rules: SnakesRules;
  board: { ladders: [number, number][]; snakes: [number, number][] };
  players: SnakesPlayer[];
  turn: number;
  phase: 'ROLL' | 'DONE';
  dice: number | null;
  startedAt: number;
  endsAt: number | null;
  turnDeadline: number | null;
  result: GameResult | null;
}

export type AnyState = GameState | SnakesState;

export type GameEvent =
  | { type: 'step'; seat: number; from: number; to: number }
  | { type: 'ladder' | 'snake'; seat: number; from: number; to: number }
  | { type: 'roll'; seat: number; dice: number; steps: number; power: boolean }
  | { type: 'pool'; pool: number[] }
  | { type: 'no-move'; seat: number }
  | { type: 'three-sixes'; seat: number }
  | { type: 'move'; seat: number; token: number; from: number; to: number; dice: number }
  | { type: 'kill'; seat: number; victimSeat: number; victimToken: number; cell: number }
  | { type: 'home'; seat: number; token: number }
  | { type: 'turn'; seat: number; extra: boolean }
  | { type: 'forfeit'; seat: number }
  | { type: 'finish'; result: GameResult };

export interface Payout { userId: string; seat: number; rank: number; isWinner: boolean; score: number; pointsWon: number; entryPaid: number }
