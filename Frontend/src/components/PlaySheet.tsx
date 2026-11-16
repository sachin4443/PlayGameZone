import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { pts } from '../lib/format';
import type { GameMode, RoomView } from '../lib/types';
import { useAuth } from '../state/auth';
import { PointsPill, Sheet, Spinner } from './ui';

const PRESETS = [10, 20, 50, 100, 200, 500];

/** Configure a table (players + entry) and either queue for a public match or open a room. */
export function PlaySheet({ mode, intent, onClose }: { mode: GameMode | null; intent: 'quick' | 'room' | 'practice'; onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [players, setPlayers] = useState(2);
  const [entry, setEntry] = useState(20);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!mode) return;
    setPlayers(mode.allowedPlayers[0] ?? 2);
    setEntry(Math.max(mode.minEntry, 20));
    setName(`${user?.displayName ?? 'My'}'s table`.slice(0, 30));
    setError('');
  }, [mode, user?.displayName]);

  if (!mode) return null;
  const balance = user?.wallet?.balance ?? 0;
  const practice = intent === 'practice';
  const tooPoor = !practice && entry > balance;
  const sizes = practice ? [2, 3, 4].filter((n) => n <= Math.max(...mode.allowedPlayers)) : mode.allowedPlayers;

  async function submit() {
    if (!mode) return;
    setBusy(true);
    setError('');
    try {
      const body = { modeKey: mode.key, maxPlayers: players, entryPoints: entry };
      if (intent === 'practice') {
        const res = await api.post<{ gameId: string }>('/games/practice', { modeKey: mode.key, players });
        onClose();
        return navigate(`/game/${res.data.gameId}`);
      }
      const { data } = intent === 'quick'
        ? await api.post<RoomView>('/rooms/quick-match', body)
        : await api.post<RoomView>('/rooms', { ...body, name: name.trim(), visibility });
      onClose();
      navigate(data.gameId ? `/game/${data.gameId}` : `/room/${data.code}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={practice ? `Practice · ${mode.name}` : intent === 'quick' ? `Quick match · ${mode.name}` : `Create room · ${mode.name}`}>
      <p className="mb-4 text-sm text-muted">{mode.description}</p>

      {intent === 'room' && (
        <div className="mb-4">
          <label className="label" htmlFor="room-name">Room name</label>
          <input id="room-name" className="input" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      )}

      <span className="label">Players</span>
      <div className={`mb-4 grid gap-2 ${practice ? "grid-cols-1" : "grid-cols-2"}`}>
        {sizes.map((n) => (
          <button key={n} type="button" onClick={() => setPlayers(n)} className={`rounded-xl border py-3 text-sm font-bold ${players === n ? 'border-brand bg-brand text-white' : 'border-line bg-surface'}`}>{practice ? `You + ${n - 1} computer${n > 2 ? 's' : ''}` : `${n} players`}</button>
        ))}
      </div>

      {!practice && (
        <>
      <span className="label">Entry points (each player)</span>
      <div className="mb-2 grid grid-cols-3 gap-2">
        {PRESETS.filter((p) => p >= mode.minEntry && p <= mode.maxEntry).map((p) => (
          <button key={p} type="button" onClick={() => setEntry(p)} className={`rounded-xl border py-2.5 text-sm font-bold ${entry === p ? 'border-accent bg-accent text-[#2a1a00]' : 'border-line bg-surface'}`}>{pts(p)}</button>
        ))}
      </div>
      <input className="input mb-4" type="number" inputMode="numeric" min={mode.minEntry} max={mode.maxEntry} value={entry} onChange={(e) => setEntry(Math.max(0, Math.floor(Number(e.target.value) || 0)))} aria-label="Custom entry points" />

        </>
      )}

      {intent === 'room' && (
        <>
          <span className="label">Who can join</span>
          <div className="mb-4 grid grid-cols-2 gap-2">
            {(['PRIVATE', 'PUBLIC'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setVisibility(v)} className={`rounded-xl border px-3 py-2.5 text-left text-sm font-bold ${visibility === v ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-surface'}`}>
                {v === 'PRIVATE' ? 'Private' : 'Public'}
                <span className="block text-[11px] font-medium text-muted">{v === 'PRIVATE' ? 'Only with the room code' : 'Listed in open rooms'}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {!practice && (
        <div className="mb-4 flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3 text-sm">
        <span className="text-muted">Prize pool</span>
        <PointsPill value={entry * players} className="text-base" />
      </div>
      )}

      {tooPoor && <p className="mb-3 text-sm font-medium text-red-500">You have {pts(balance)} points – choose a smaller entry.</p>}
      {error && <p className="mb-3 text-sm font-medium text-red-500" role="alert">{error}</p>}
      <button className="btn-primary w-full" disabled={busy || tooPoor || (intent === 'room' && name.trim().length < 3)} onClick={submit}>
        {busy ? <Spinner /> : practice ? 'Start practice' : intent === 'quick' ? 'Find opponents' : 'Create room'}
      </button>
      <p className="mt-3 text-center text-[11px] text-muted">{practice ? "Free game against the computer. No points are won or lost, and it does not count on the leaderboard." : "Entry is only taken when the game actually starts."}</p>
    </Sheet>
  );
}
