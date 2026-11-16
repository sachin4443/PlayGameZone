import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Dice } from '../components/Dice';
import { LudoBoard } from '../components/LudoBoard';
import { PIECE_HEX, SnakesBoard } from '../components/SnakesBoard';
import { Avatar, ErrorNote, Icon, PageLoader, PointsPill, Sheet } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { COLOR_NAME, HEX, HOME, cornerOf } from '../lib/board';
import { clock, pts } from '../lib/format';
import { emit, getSocket } from '../lib/socket';
import { isMuted, play, setMuted } from '../lib/sound';
import type { AnyState, Color, GameEvent, GameState as LudoState, Payout, PlayerState, SnakesPlayer } from '../lib/types';

type GameState = AnyState;
type AnyPlayer = PlayerState | SnakesPlayer;
const isLudo = (s: AnyState): s is LudoState => s.kind !== 'SNAKES';
const hexOf = (p: AnyPlayer) => ('tokens' in p ? HEX[p.color] : PIECE_HEX[p.color]);
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';

interface Meta { mode: { key: string; name: string }; pool: number; prize: number; entryPoints: number; status: 'ACTIVE' | 'FINISHED' | 'CANCELLED'; cancelReason: string | null; isTournament: boolean; isPractice: boolean }
interface Snapshot { gameId: string; state: GameState; events: GameEvent[]; serverTime: number }
interface LastRoll { seat: number; dice: number; power: boolean; at: number }

const ROLL_ANIM_MS = 450;

function PlayerPanel({ p, isTurn, isMe, state, deadline, now, align }: { p: AnyPlayer; isTurn: boolean; isMe: boolean; state: GameState; deadline: number | null; now: number; align: 'left' | 'right' }) {
  const color = hexOf(p);
  const remaining = isTurn && deadline ? Math.max(0, deadline - now) : 0;
  const pct = isTurn && deadline && !p.bot ? Math.min(100, (remaining / 20000) * 100) : 0;
  let detail: string;
  if (!p.active) detail = 'Left the game';
  else if (!p.connected) detail = 'Reconnecting…';
  else if (!isLudo(state)) detail = (p as SnakesPlayer).pos === 0 ? 'At the start' : `Square ${(p as SnakesPlayer).pos}`;
  else {
    const lp = p as PlayerState;
    detail = state.rules.winBy === 'SCORE' ? `Score ${lp.score}` : `Home ${lp.tokens.filter((t) => t >= HOME).length}/${state.rules.tokensPerPlayer}`;
    if (state.rules.turnLimit > 0) detail += ` · ${state.rules.turnLimit - lp.turnsTaken} left`;
  }
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-2 rounded-2xl border-2 bg-surface px-2 py-1.5 transition ${align === 'right' ? 'flex-row-reverse text-right' : ''} ${p.active ? '' : 'opacity-45'}`} style={{ borderColor: isTurn ? color : 'var(--line)', boxShadow: isTurn ? `0 0 16px ${color}66` : undefined }}>
      <Avatar id={p.avatar} name={p.name} size={34} ring={color} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-extrabold">{isMe ? 'You' : p.name}{p.bot && <span className="ml-1 rounded bg-surface-2 px-1 text-[9px] font-bold uppercase text-muted">CPU</span>}</p>
        <p className="truncate text-[10px] font-semibold text-muted">{detail}</p>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
          <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${pct}%`, background: remaining < 5000 ? '#ef4444' : color }} />
        </div>
      </div>
    </div>
  );
}

export default function GamePage() {
  const { id = '' } = useParams();
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [meta, setMeta] = useState<Meta | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState('');
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [cancelled, setCancelled] = useState<string | null>(null);
  const [lastRoll, setLastRoll] = useState<LastRoll | null>(null);
  const [rolling, setRolling] = useState(false);
  const [selectedDie, setSelectedDie] = useState<number | null>(null);
  const [anim, setAnim] = useState<{ id: number; seat: number; path: number[] } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const [now, setNow] = useState(Date.now());
  const [online, setOnline] = useState(getSocket().connected);
  const offset = useRef(0); // server clock minus local clock
  const pending = useRef(false);
  const stateRef = useRef<GameState | null>(null);
  stateRef.current = state;

  const me = useMemo<AnyPlayer | null>(() => (state?.players as AnyPlayer[] | undefined)?.find((p) => p.userId === user?.id) ?? null, [state, user?.id]);
  const ludoState = state && isLudo(state) ? state : null;
  const perspective: Color = me && 'tokens' in me ? me.color : 'blue';
  const current = state && state.phase !== 'DONE' ? state.players[state.turn] : null;
  const myTurn = !!me && !!current && current.seat === me.seat && me.active;
  const pick = ludoState?.rules.dice === 'PICK';

  const describe = useCallback((s: GameState, e: GameEvent): string | null => {
    const who = (seat: number) => {
      const p = s.players.find((x) => x.seat === seat);
      return p ? (p.userId === user?.id ? 'You' : p.name) : 'Player';
    };
    switch (e.type) {
      case 'roll': return `${who(e.seat)} rolled ${e.dice}${e.power ? ` – power roll, moves ${e.steps}` : ''}`;
      case 'no-move': return `${who(e.seat)} had no move`;
      case 'three-sixes': return `${who(e.seat)} rolled three sixes – turn lost`;
      case 'move': return e.from < 0 && e.to === 0 ? `${who(e.seat)} brought a token out` : `${who(e.seat)} moved ${e.dice}`;
      case 'kill': return `${who(e.seat)} captured ${who(e.victimSeat)}'s token`;
      case 'home': return `${who(e.seat)} got a token home`;
      case 'step': return `${who(e.seat)} moved to ${e.to}`;
      case 'ladder': return `${who(e.seat)} climbed a ladder to ${e.to}`;
      case 'snake': return `${who(e.seat)} slid down a snake to ${e.to}`;
      case 'forfeit': return `${who(e.seat)} left the game`;
      default: return null;
    }
  }, [user?.id]);

  const applySnapshot = useCallback((snap: Snapshot) => {
    offset.current = snap.serverTime - Date.now();
    pending.current = false;
    const lines: string[] = [];
    let delay = 0;
    for (const e of snap.events) {
      const line = describe(snap.state, e);
      if (line) lines.push(line);
      if (e.type === 'roll') {
        setRolling(true);
        setLastRoll({ seat: e.seat, dice: e.dice, power: e.power, at: Date.now() });
        play('roll');
        setTimeout(() => setRolling(false), ROLL_ANIM_MS);
        delay = ROLL_ANIM_MS;
      } else if (e.type === 'step') {
        // Walk square by square, then ride the ladder or snake if there is one.
        const jump = snap.events.find((x) => (x.type === 'ladder' || x.type === 'snake') && x.seat === e.seat) as { to: number; type: string } | undefined;
        const path = Array.from({ length: e.to - e.from }, (_, i) => e.from + i + 1);
        if (jump) {
          path.push(jump.to);
          setTimeout(() => play(jump.type === 'ladder' ? 'home' : 'kill'), delay + path.length * 130);
        }
        setTimeout(() => setAnim({ id: Date.now() + Math.random(), seat: e.seat, path }), delay);
      } else if (e.type === 'kill') setTimeout(() => play('kill'), delay + 500);
      else if (e.type === 'home') setTimeout(() => play('home'), delay + 500);
      else if (e.type === 'turn' && snap.state.players.find((p) => p.seat === e.seat)?.userId === user?.id) setTimeout(() => play('turn'), delay + 350);
    }
    if (lines.length) setLog((l) => [...lines.reverse(), ...l].slice(0, 40));
    setSelectedDie(null);
    setState(snap.state);
  }, [describe, user?.id]);

  // Initial load, then live updates. Rejoining after a refresh or network drop lands here too.
  useEffect(() => {
    let alive = true;
    const socket = getSocket();

    const loadRest = async () => {
      const { data } = await api.get(`/games/${id}`);
      if (!alive) return;
      offset.current = data.serverTime - Date.now();
      setMeta({ mode: data.mode, pool: data.pool, prize: data.prize, entryPoints: data.entryPoints, status: data.status, cancelReason: data.cancelReason, isTournament: data.isTournament, isPractice: data.isPractice });
      if (data.state) setState(data.state);
      if (data.status === 'FINISHED') {
        setPayouts(data.results.map((r: Payout) => ({ ...r, seat: ((data.state as GameState).players as AnyPlayer[]).find((p) => p.userId === r.userId)?.seat ?? 0 })));
        setShowResult(true);
      }
      if (data.status === 'CANCELLED') setCancelled(data.cancelReason ?? 'This game was cancelled.');
      return data.status as Meta['status'];
    };

    const join = async () => {
      try {
        const status = await loadRest();
        if (status === 'ACTIVE') {
          const snap = await emit<Omit<Snapshot, 'events'>>('join-game', { gameId: id });
          if (alive) applySnapshot({ ...snap, events: [] });
        }
      } catch (e) {
        if (alive) setError(errorMessage(e));
      }
    };
    void join();

    const onState = (snap: Snapshot) => snap.gameId === id && applySnapshot(snap);
    const onFinished = (p: { gameId: string; payouts: Payout[] | null }) => {
      if (p.gameId !== id) return;
      setPayouts(p.payouts);
      setMeta((m) => (m ? { ...m, status: 'FINISHED' } : m));
      const won = p.payouts?.find((x) => x.userId === user?.id)?.isWinner;
      setTimeout(() => {
        setShowResult(true);
        if (won !== undefined) play(won ? 'win' : 'lose');
      }, 900);
      void refresh().catch(() => undefined);
    };
    const onCancelled = (p: { gameId: string; reason: string }) => {
      if (p.gameId !== id) return;
      setCancelled(p.reason || 'This game was cancelled.');
      void refresh().catch(() => undefined);
    };
    const onConnect = () => {
      setOnline(true);
      void join();
    };
    const onDisconnect = () => setOnline(false);

    socket.on('game-state', onState);
    socket.on('game-finished', onFinished);
    socket.on('game-cancelled', onCancelled);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => {
      alive = false;
      clearInterval(tick);
      socket.off('game-state', onState);
      socket.off('game-finished', onFinished);
      socket.off('game-cancelled', onCancelled);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [id, applySnapshot, refresh, user?.id]);

  const send = useCallback(async (event: string, payload: object) => {
    if (pending.current) return;
    pending.current = true;
    try {
      await emit(event, payload);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      pending.current = false;
    }
  }, [toast]);

  const rollDice = () => {
    if (!myTurn || state?.phase !== 'ROLL' || rolling) return;
    setRolling(true);
    void send('roll-dice', { gameId: id });
    // Safety net if the reply is lost; a real result resets this through the snapshot.
    setTimeout(() => setRolling(false), 1500);
  };

  const moveToken = useCallback((tokenIndex: number, dieIndex?: number) => {
    void send('move-token', { gameId: id, tokenIndex, ...(dieIndex === undefined ? {} : { dieIndex }) });
  }, [id, send]);

  // Tokens the player may press right now.
  const movable = useMemo(() => {
    if (!ludoState || !myTurn || ludoState.phase !== 'MOVE' || rolling) return [];
    const legal = pick ? ludoState.legal.filter((m) => m.die === selectedDie) : ludoState.legal;
    return [...new Set(legal.map((m) => m.token))];
  }, [ludoState, myTurn, rolling, pick, selectedDie]);

  // With a single possible move there is nothing to choose: play it after the dice settles.
  useEffect(() => {
    if (!ludoState || !myTurn || ludoState.phase !== 'MOVE' || pick || rolling) return;
    const destinations = new Set(ludoState.legal.map((m) => `${m.from}>${m.to}`));
    if (destinations.size !== 1) return;
    const timer = setTimeout(() => {
      const s = stateRef.current;
      if (s && isLudo(s) && s.phase === 'MOVE' && s.legal.length) moveToken(s.legal[0].token);
    }, 550);
    return () => clearTimeout(timer);
  }, [ludoState, myTurn, pick, rolling, moveToken]);

  const onTokenPress = (token: number) => {
    if (pick) {
      if (selectedDie !== null) moveToken(token, selectedDie);
    } else moveToken(token);
  };

  const onDiePress = (index: number) => {
    if (!ludoState || !myTurn || !pick) return;
    const options = ludoState.legal.filter((m) => m.die === index);
    if (options.length === 0) return toast('No token can use that die', 'info');
    if (new Set(options.map((m) => `${m.from}>${m.to}`)).size === 1) return moveToken(options[0].token, index);
    setSelectedDie(index);
  };

  const toggleMute = () => {
    setMuted(!muted);
    setMutedState(!muted);
    void api.patch('/users/me', { soundEnabled: muted }).catch(() => undefined);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  const leave = async () => {
    setConfirmLeave(false);
    if (me?.active && state?.phase !== 'DONE') {
      try {
        await emit('leave-game', { gameId: id });
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    }
    navigate('/', { replace: true });
  };

  if (error) return <div className="mx-auto max-w-md p-4"><ErrorNote message={error} onRetry={() => navigate('/')} /></div>;
  if (!state || !meta) return <PageLoader />;

  const serverNow = now + offset.current;
  const players = state.players as AnyPlayer[];
  const deadline = state.turnDeadline ? state.turnDeadline - offset.current : null;

  // Ludo: seats sit at the corners of the (rotated) board. Snake & Ladder: simply in seat order.
  const byCorner: (AnyPlayer | undefined)[] = [undefined, undefined, undefined, undefined];
  if (ludoState) for (const p of ludoState.players) byCorner[cornerOf(p.color, perspective)] = p;
  else players.forEach((p, i) => (byCorner[[0, 1, 3, 2][i]] = p));
  const panel = (corner: number, align: 'left' | 'right') => {
    const p = byCorner[corner];
    return p
      ? <PlayerPanel p={p} isTurn={current?.seat === p.seat} isMe={p.userId === user?.id} state={state} deadline={deadline} now={now} align={align} />
      : <div className="flex-1" />;
  };

  const timeLeft = state.endsAt ? (state.endsAt - serverNow) / 1000 : null;
  const rollOwner = lastRoll ? players.find((p) => p.seat === lastRoll.seat) : null;
  const canRoll = myTurn && state.phase === 'ROLL' && !rolling && !pick;
  const dieValue = state.dice ?? (lastRoll && Date.now() - lastRoll.at < 2500 ? lastRoll.dice : canRoll ? null : lastRoll?.dice ?? null);
  const dieColor = canRoll ? hexOf(me!) : rollOwner ? hexOf(rollOwner) : undefined;
  const status = state.phase === 'DONE' ? 'Game over'
    : !me ? `Spectating · ${current?.name}'s turn`
    : !me.active ? 'You left this game'
    : myTurn ? (state.phase === 'ROLL' ? 'Your turn – tap the dice' : pick ? (selectedDie === null ? 'Pick a die' : 'Now tap a token') : 'Tap a token to move')
    : `${current?.name ?? 'Opponent'} is playing…`;
  const myPayout = payouts?.find((p) => p.userId === user?.id);
  const iWon = me ? state.result?.winners.includes(me.seat) : undefined;
  const power = ludoState?.power && ludoState.steps ? `Power roll! Moves ${ludoState.steps} steps.` : null;

  const mainDie = (size: number, className = '') => (
    <button onClick={rollDice} disabled={!canRoll} aria-label={canRoll ? 'Roll the dice' : 'Dice'} className={`rounded-2xl ${className}`}>
      <Dice value={rolling ? ((Math.floor(now / 80) % 6) + 1) : dieValue} rolling={rolling} size={size} className={size === 0 ? 'h-full w-full' : ''} active={canRoll} color={dieColor} />
    </button>
  );

  return (
    <div className="mx-auto flex h-dvh max-w-xl flex-col bg-bg">
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <button onClick={() => (me?.active && state.phase !== 'DONE' ? setConfirmLeave(true) : navigate('/'))} className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface" aria-label="Leave game"><Icon name="back" size={18} /></button>
        <div className="min-w-0 text-center">
          <p className="truncate text-sm font-extrabold">{meta.mode.name}{meta.isTournament && ' · Tournament'}</p>
          <p className="text-[11px] font-semibold text-muted">
            {meta.isPractice ? 'Practice · no points' : meta.prize > 0 ? <>Prize <PointsPill value={meta.prize} /></> : 'No entry'}
            {timeLeft !== null && state.phase !== 'DONE' && <span className={`ml-2 font-extrabold ${timeLeft < 30 ? 'text-red-500' : 'text-ink'}`}><Icon name="clock" size={11} className="mb-0.5 inline" /> {clock(timeLeft)}</span>}
          </p>
        </div>
        <div className="flex gap-1.5">
          <button onClick={toggleMute} className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface" aria-label={muted ? 'Unmute sounds' : 'Mute sounds'} aria-pressed={muted}><Icon name={muted ? 'mute' : 'sound'} size={18} /></button>
          <button onClick={toggleFullscreen} className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface" aria-label="Toggle full screen"><Icon name="full" size={18} /></button>
        </div>
      </header>

      {!online && <p className="bg-red-500 px-3 py-1 text-center text-xs font-bold text-white" role="status">Connection lost – reconnecting…</p>}

      <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 px-2">
        <div className="flex gap-2">{panel(0, 'left')}{panel(1, 'right')}</div>
        <div className="relative mx-auto aspect-square w-full" style={{ maxWidth: 'min(100%, calc(100dvh - 290px))' }}>
          {ludoState ? (
            <>
              <LudoBoard players={ludoState.players} perspective={perspective} movable={movable} activeSeat={me?.seat ?? null} onTokenPress={onTokenPress} onHop={() => play('move')} />
              {/* The dice lives in the middle of the board (shared-dice mode keeps its three dice in the dock). */}
              {!pick && <div className="absolute left-1/2 top-1/2 h-[15%] w-[15%] -translate-x-1/2 -translate-y-1/2">{mainDie(0, 'block h-full w-full')}</div>}
            </>
          ) : (
            <SnakesBoard players={(state as Extract<GameState, { kind: 'SNAKES' }>).players} board={(state as Extract<GameState, { kind: 'SNAKES' }>).board} anim={anim} onHop={() => play('move')} />
          )}
        </div>
        <div className="flex gap-2">{panel(3, 'left')}{panel(2, 'right')}</div>
      </div>

      <footer className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        <div className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-3">
          {pick && ludoState ? (
            <div className="flex gap-2" role="group" aria-label="Shared dice">
              {ludoState.pool.map((v, i) => {
                const usable = myTurn && ludoState.legal.some((m) => m.die === i);
                return (
                  <button key={i} onClick={() => onDiePress(i)} disabled={!usable} aria-label={`Use die showing ${v}`} className="rounded-2xl">
                    <Dice value={v} size={56} selected={selectedDie === i} active={usable && selectedDie === null} dim={!usable} color={current ? hexOf(current) : undefined} />
                  </button>
                );
              })}
            </div>
          ) : !ludoState ? mainDie(72) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold" style={{ color: myTurn ? hexOf(me!) : undefined }} role="status">{status}</p>
            <p className="truncate text-[11px] text-muted">{power ?? log[0] ?? (me ? (ludoState ? `You are ${COLOR_NAME[(me as PlayerState).color]}` : 'First to 100 wins') : 'Watching live')}</p>
          </div>
          <button onClick={() => setLogOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted" aria-label="Turn history"><Icon name="list" size={18} /></button>
        </div>
      </footer>

      <Sheet open={logOpen} onClose={() => setLogOpen(false)} title="Turn history">
        {log.length === 0 ? <p className="text-sm text-muted">Nothing has happened yet.</p> : (
          <ol className="space-y-1.5 text-sm">{log.map((l, i) => <li key={i} className="rounded-lg bg-surface-2 px-3 py-2">{l}</li>)}</ol>
        )}
      </Sheet>

      <Sheet open={confirmLeave} onClose={() => setConfirmLeave(false)} title="Leave this game?">
        <p className="mb-4 text-sm text-muted">
          {meta.isPractice ? 'This ends your practice game.' : `Leaving now forfeits the game${meta.entryPoints > 0 ? ` and your ${pts(meta.entryPoints)} entry points` : ''}. If you just lose connection instead, you can come back and continue.`}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost" onClick={() => setConfirmLeave(false)}>Keep playing</button>
          <button className="btn-danger" onClick={leave}>{meta.isPractice ? 'End game' : 'Forfeit'}</button>
        </div>
      </Sheet>

      {showResult && state.result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label="Game result" className="pop-in w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-2xl">
            <div className={`mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full ${iWon ? 'bg-accent text-[#2a1a00]' : 'bg-surface-2 text-muted'}`}><Icon name="trophy" size={30} /></div>
            <h2 className="text-2xl font-extrabold">{iWon === undefined ? 'Game over' : iWon ? (state.result.winners.length > 1 ? "It's a tie!" : 'You won!') : 'You lost'}</h2>
            {myPayout && meta.pool > 0 && (
              <p className={`mt-1 text-lg font-extrabold ${myPayout.isWinner ? 'text-emerald-500' : 'text-red-500'}`}>
                {myPayout.isWinner ? `+${pts(myPayout.pointsWon)} points` : `-${pts(myPayout.entryPaid)} points`}
              </p>
            )}
            <p className="mt-1 text-xs text-muted">{ludoState
              ? { HOME: 'All tokens home', SCORE: 'All tokens home – highest score', TIME: 'Time is up – highest score wins', TURNS: 'All turns played – highest score wins', FORFEIT: 'Opponent left the game' }[state.result.reason]
              : state.result.reason === 'FORFEIT' ? 'Opponent left the game' : 'First to square 100'}{meta.isPractice && ' · practice game'}</p>
            <ol className="mt-4 space-y-1.5 text-left">
              {state.result.ranking.map((seat, i) => {
                const p = players.find((x) => x.seat === seat)!;
                const pay = payouts?.find((x) => x.seat === seat);
                return (
                  <li key={seat} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                    <span className="w-4 font-extrabold text-muted">{i + 1}</span>
                    <Avatar id={p.avatar} name={p.name} size={28} ring={hexOf(p)} />
                    <span className="flex-1 truncate font-bold">{p.userId === user?.id ? 'You' : p.name}</span>
                    {ludoState?.rules.winBy === 'SCORE' && <span className="text-xs text-muted">{p.score} pts</span>}
                    {!ludoState && <span className="text-xs text-muted">Square {(p as SnakesPlayer).pos}</span>}
                    {pay && pay.pointsWon > 0 && <PointsPill value={pay.pointsWon} className="text-emerald-500" />}
                  </li>
                );
              })}
            </ol>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button className="btn-ghost" onClick={() => setShowResult(false)}>View board</button>
              <button className="btn-primary" onClick={() => navigate('/', { replace: true })}>Back to home</button>
            </div>
          </div>
        </div>
      )}

      {cancelled && !showResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div role="alertdialog" aria-label="Game ended" className="pop-in w-full max-w-sm rounded-3xl bg-surface p-6 text-center">
            <h2 className="text-xl font-extrabold">{meta.isPractice ? 'Practice ended' : 'Game cancelled'}</h2>
            <p className="mt-2 text-sm text-muted">{meta.isPractice ? 'This practice game is over.' : `${cancelled}${meta.entryPoints > 0 ? ' Your entry points were refunded.' : ''}`}</p>
            <button className="btn-primary mt-5 w-full" onClick={() => navigate('/', { replace: true })}>Back to home</button>
          </div>
        </div>
      )}
    </div>
  );
}
