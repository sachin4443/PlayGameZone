import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar, ErrorNote, Icon, PageLoader, PointsPill, Spinner } from '../components/ui';
import { clock } from '../lib/format';
import { emit, getSocket } from '../lib/socket';
import type { RoomView } from '../lib/types';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';

export default function RoomPage() {
  const { code = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const socket = getSocket();
    let alive = true;
    const watch = () =>
      emit<RoomView>('watch-room', { code })
        .then((view) => alive && setRoom(view))
        .catch((e: Error) => alive && setError(e.message));
    void watch();

    const onState = (view: RoomView) => view.code === code.toUpperCase() && setRoom(view);
    const onStarted = (p: { gameId: string }) => navigate(`/game/${p.gameId}`, { replace: true });
    const onClosed = (p: { code: string; reason: string }) => {
      if (p.code !== code.toUpperCase()) return;
      toast(p.reason, 'error');
      navigate('/', { replace: true });
    };
    socket.on('room-state', onState);
    socket.on('game-started', onStarted);
    socket.on('room-closed', onClosed);
    socket.on('connect', watch); // re-subscribe after a reconnect
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(tick);
      socket.off('room-state', onState);
      socket.off('game-started', onStarted);
      socket.off('room-closed', onClosed);
      socket.off('connect', watch);
    };
  }, [code, navigate, toast]);

  useEffect(() => {
    if (room?.gameId && room.status === 'IN_GAME') navigate(`/game/${room.gameId}`, { replace: true });
  }, [room, navigate]);

  if (error) return <ErrorNote message={error} onRetry={() => navigate('/')} />;
  if (!room || !user) return <PageLoader />;

  const me = room.players.find((p) => p.userId === user.id);
  const isHost = room.hostId === user.id;
  const allReady = room.players.length >= 2 && room.players.every((p) => p.isReady);
  const closed = room.status === 'CANCELLED' || room.status === 'COMPLETED';
  const secondsLeft = room.expiresAt ? (new Date(room.expiresAt).getTime() - now) / 1000 : null;

  const run = async (event: string, payload: object, after?: () => void) => {
    setBusy(true);
    try {
      await emit(event, payload);
      after?.();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const text = `Join my PlayerX Ludo room with code ${room.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'PlayerX Ludo', text });
      else {
        await navigator.clipboard.writeText(room.code);
        toast('Room code copied', 'success');
      }
    } catch {
      /* user dismissed the share dialog */
    }
  };

  return (
    <div>
      <button onClick={() => navigate('/')} className="mb-3 flex items-center gap-1 text-sm font-bold text-muted"><Icon name="back" size={16} /> Home</button>

      <section className="card overflow-hidden">
        <div className="bg-gradient-to-br from-brand to-pink p-5 text-white">
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/75">{room.isMatchmaking ? 'Public matchmaking' : room.visibility === 'PRIVATE' ? 'Private room' : 'Public room'} · {room.mode.name}</p>
          <h1 className="mt-1 text-xl font-extrabold">{room.isMatchmaking ? 'Finding opponents…' : room.name}</h1>
          {!room.isMatchmaking && (
            <button onClick={share} className="mt-4 flex w-full items-center justify-between rounded-2xl bg-black/20 px-4 py-3 text-left">
              <span><span className="block text-[10px] font-bold uppercase tracking-wider text-white/70">Room code</span><span className="text-3xl font-extrabold tracking-[0.3em]">{room.code}</span></span>
              <span className="flex items-center gap-1 rounded-xl bg-white/20 px-3 py-2 text-xs font-bold"><Icon name="share" size={15} /> Share</span>
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 divide-x divide-line text-center text-xs">
          <div className="p-3"><span className="block text-muted">Entry</span><PointsPill value={room.entryPoints} className="text-sm" /></div>
          <div className="p-3"><span className="block text-muted">Prize pool</span><PointsPill value={room.entryPoints * Math.max(room.players.length, 2)} className="text-sm" /></div>
          <div className="p-3"><span className="block text-muted">{room.isMatchmaking ? 'Time left' : 'Players'}</span><b className="text-sm">{room.isMatchmaking && secondsLeft !== null ? clock(secondsLeft) : `${room.players.length}/${room.maxPlayers}`}</b></div>
        </div>
      </section>

      <h2 className="mb-2 mt-5 text-sm font-extrabold">Players</h2>
      <div className="space-y-2">
        {Array.from({ length: room.maxPlayers }, (_, i) => room.players[i]).map((p, i) =>
          p ? (
            <div key={p.userId} className="card flex items-center gap-3 p-3">
              <Avatar id={p.avatar} name={p.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{p.name}{p.userId === user.id && <span className="text-muted"> (you)</span>}</p>
                <p className="text-xs text-muted">{p.userId === room.hostId ? 'Host' : 'Player'}</p>
              </div>
              <span className={`chip ${p.isReady ? 'bg-emerald-500/15 text-emerald-500' : 'bg-surface-2 text-muted'}`}>{p.isReady ? 'Ready' : 'Not ready'}</span>
            </div>
          ) : (
            <div key={`empty-${i}`} className="flex items-center gap-3 rounded-2xl border border-dashed border-line p-3 text-sm text-muted">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2"><Spinner className="h-4 w-4" /></span>
              Waiting for a player…
            </div>
          ),
        )}
      </div>

      {closed ? (
        <div className="mt-5"><ErrorNote message="This room is closed." onRetry={() => navigate('/')} /></div>
      ) : (
        <div className="mt-5 space-y-2">
          {!room.isMatchmaking && me && !isHost && (
            <button className={me.isReady ? 'btn-ghost w-full' : 'btn-accent w-full'} disabled={busy} onClick={() => run('player-ready', { code: room.code, ready: !me.isReady })}>
              {me.isReady ? 'Cancel ready' : "I'm ready"}
            </button>
          )}
          {!room.isMatchmaking && isHost && (
            <>
              <button className="btn-primary w-full" disabled={busy || !allReady} onClick={() => run('start-game', { code: room.code })}>
                {busy ? <Spinner /> : 'Start game'}
              </button>
              {!allReady && <p className="text-center text-xs text-muted">{room.players.length < 2 ? 'Share the code – you need at least one more player.' : 'Waiting for everyone to be ready.'}</p>}
            </>
          )}
          {room.isMatchmaking && <p className="text-center text-sm text-muted">The game starts automatically when the table is full.</p>}
          {me && (
            <button className="btn-ghost w-full text-red-500" disabled={busy} onClick={() => run('leave-room', { code: room.code }, () => navigate('/', { replace: true }))}>
              {room.isMatchmaking ? 'Cancel search' : 'Leave room'}
            </button>
          )}
        </div>
      )}
      <p className="mt-4 text-center text-[11px] text-muted">Each player's {room.entryPoints} points are locked when the game starts and paid to the winner when it ends.</p>
    </div>
  );
}
