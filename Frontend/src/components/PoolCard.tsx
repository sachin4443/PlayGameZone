import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import type { RoomView } from '../lib/types';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';
import { Icon, PointsPill, Spinner } from './ui';

export interface Pool { id: string; name: string; mode: { key: string; name: string }; players: number; entryPoints: number; prizePoints: number; joined: number; slotsLeft: number; status: 'OPEN' | 'FILLING'; liveGames: number }

/** One standing prize-pool table: tap the entry button to take a seat. */
export function PoolCard({ pool }: { pool: Pool }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const short = (user?.wallet?.balance ?? 0) < pool.entryPoints;

  const join = async () => {
    setBusy(true);
    try {
      const { data } = await api.post<RoomView>(`/rooms/pools/${pool.id}/join`);
      navigate(data.gameId ? `/game/${data.gameId}` : `/room/${data.code}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card overflow-hidden">
      <header className="flex items-center justify-between gap-2 bg-surface-2 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted">
        <span className="flex min-w-0 items-center gap-2"><Icon name="users" size={14} /> <span className="truncate text-ink normal-case tracking-normal">{pool.name}</span></span>
        <span className="shrink-0">{pool.players} players · 1 winner</span>
      </header>
      <div className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Prize pool</p>
          <PointsPill value={pool.prizePoints} className="text-2xl font-extrabold" />
          <p className="mt-0.5 text-xs text-muted">{pool.mode.name}</p>
        </div>
        <span className={`chip ${pool.status === 'FILLING' ? 'bg-accent/20 text-accent' : 'bg-emerald-500/15 text-emerald-500'}`}>
          {pool.status === 'FILLING' ? `${pool.joined}/${pool.players} joined` : `${pool.slotsLeft} seats open`}
        </span>
        <button onClick={join} disabled={busy || short} className="btn min-w-[92px] bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 hover:bg-emerald-600" aria-label={`Join ${pool.name} for ${pool.entryPoints} points`}>
          {busy ? <Spinner /> : <span className="text-center leading-tight"><span className="block text-[10px] font-bold uppercase opacity-80">Entry</span>{pool.entryPoints}</span>}
        </button>
      </div>
      {short && <p className="border-t border-line px-4 py-2 text-xs text-red-500">You need {pool.entryPoints} points to join this table.</p>}
    </article>
  );
}
