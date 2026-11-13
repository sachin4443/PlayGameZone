import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHead } from '../components/PageHead';
import { Avatar, ErrorNote, PageLoader, PointsPill, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { dateTime, pts } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';
import { STATUS_TONE } from './Tournaments';

interface Who { userId: string; name: string; avatar: string }
interface Detail {
  id: string; name: string; description: string; mode: { name: string }; entryPoints: number; capacity: number; registered: number; prizePool: number;
  prizeSplit: number[]; status: 'UPCOMING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'; startsAt: string; totalRounds: number; winner: Who | null; isRegistered: boolean;
  players: (Who & { status: string; finalRank: number | null; prize: number })[];
  matches: { id: string; round: number; index: number; status: string; player1: Who | null; player2: Who | null; winnerId: string | null; gameId: string | null; gameStatus: string | null }[];
}

const roundName = (round: number, total: number) => (round === total ? 'Final' : round === total - 1 ? 'Semi-finals' : round === total - 2 ? 'Quarter-finals' : `Round ${round}`);

export default function TournamentDetailPage() {
  const { id } = useParams();
  const { user, refresh } = useAuth();
  const toast = useToast();
  const { data: t, error, loading, reload, setData } = useFetch<Detail>(`/tournaments/${id}`);
  const [busy, setBusy] = useState(false);

  // Brackets move while you watch them.
  useEffect(() => {
    if (t?.status !== 'RUNNING' && t?.status !== 'UPCOMING') return;
    const timer = setInterval(() => void reload(), 8000);
    return () => clearInterval(timer);
  }, [t?.status, reload]);

  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (loading && !t) return <PageLoader />;
  if (!t) return null;

  const act = async (action: 'register' | 'unregister') => {
    setBusy(true);
    try {
      const { data } = await api.post<Detail>(`/tournaments/${t.id}/${action}`);
      setData(data);
      await refresh();
      toast(action === 'register' ? 'You are in! We will take you to your match when it starts.' : 'Registration cancelled and entry refunded.', 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const myMatch = t.matches.find((m) => m.status === 'IN_PROGRESS' && m.gameId && (m.player1?.userId === user?.id || m.player2?.userId === user?.id));
  const rounds = [...new Set(t.matches.map((m) => m.round))];
  const cell = (p: Who | null, winnerId: string | null, bye: boolean) => (
    <div className={`flex items-center gap-2 px-3 py-2 text-sm ${p && winnerId === p.userId ? 'font-extrabold text-emerald-500' : winnerId && p ? 'text-muted line-through' : ''}`}>
      {p ? <><Avatar id={p.avatar} name={p.name} size={22} /><span className="truncate">{p.userId === user?.id ? 'You' : p.name}</span></> : <span className="text-muted">{bye ? 'Bye' : 'To be decided'}</span>}
    </div>
  );

  return (
    <div>
      <PageHead title={t.name} subtitle={`${t.mode.name} · knockout`} />
      <section className="card p-4">
        <div className="flex items-center justify-between">
          <span className={`chip ${STATUS_TONE[t.status]}`}>{t.status.toLowerCase()}</span>
          <span className="text-xs text-muted">{dateTime(t.startsAt)}</span>
        </div>
        {t.description && <p className="mt-3 text-sm text-muted">{t.description}</p>}
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-xl bg-surface-2 py-2"><span className="block text-muted">Entry</span><PointsPill value={t.entryPoints} /></div>
          <div className="rounded-xl bg-surface-2 py-2"><span className="block text-muted">Prize pool</span><PointsPill value={t.prizePool} /></div>
          <div className="rounded-xl bg-surface-2 py-2"><span className="block text-muted">Players</span><b>{t.registered}/{t.capacity}</b></div>
        </div>
        <p className="mt-3 text-xs text-muted">Prizes: {t.prizeSplit.map((p, i) => `${['1st', '2nd', '3rd', '4th'][i]} ${p}% (${pts(Math.floor((t.prizePool * p) / 100))})`).join(' · ')}</p>

        {myMatch && <Link to={`/game/${myMatch.gameId}`} className="btn-accent glow mt-4 w-full">Your match is live – play now</Link>}
        {t.status === 'UPCOMING' && (
          t.isRegistered
            ? <button className="btn-ghost mt-4 w-full" disabled={busy} onClick={() => act('unregister')}>{busy ? <Spinner /> : 'Registered · tap to withdraw'}</button>
            : <button className="btn-primary mt-4 w-full" disabled={busy || t.registered >= t.capacity || (user?.wallet?.balance ?? 0) < t.entryPoints} onClick={() => act('register')}>
                {busy ? <Spinner /> : t.registered >= t.capacity ? 'Tournament full' : (user?.wallet?.balance ?? 0) < t.entryPoints ? 'Not enough points' : `Register for ${pts(t.entryPoints)} points`}
              </button>
        )}
        {t.winner && <p className="mt-4 rounded-xl bg-accent/15 px-4 py-3 text-center text-sm font-bold text-accent">Champion: {t.winner.userId === user?.id ? 'You' : t.winner.name}</p>}
      </section>

      {rounds.length > 0 && (
        <>
          <h2 className="mb-2 mt-5 text-base font-extrabold">Bracket</h2>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
            {rounds.map((r) => (
              <div key={r} className="w-56 shrink-0">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">{roundName(r, t.totalRounds)}</p>
                <div className="flex h-full flex-col justify-around gap-3">
                  {t.matches.filter((m) => m.round === r).map((m) => (
                    <div key={m.id} className={`card divide-y divide-line ${m.status === 'IN_PROGRESS' ? '!border-emerald-500' : ''}`}>
                      {cell(m.player1, m.winnerId, false)}
                      {cell(m.player2, m.winnerId, m.status === 'BYE')}
                      {m.status === 'IN_PROGRESS' && m.gameId && <Link to={`/game/${m.gameId}`} className="block px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-wider text-emerald-500">Live · watch</Link>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="mb-2 mt-5 text-base font-extrabold">Players</h2>
      {t.players.length === 0 ? <p className="text-sm text-muted">Nobody has registered yet. Be the first.</p> : (
        <div className="card divide-y divide-line">
          {t.players.map((p) => (
            <div key={p.userId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Avatar id={p.avatar} name={p.name} size={28} />
              <span className="flex-1 truncate font-bold">{p.userId === user?.id ? 'You' : p.name}</span>
              {p.finalRank && <span className="text-xs text-muted">#{p.finalRank}</span>}
              {p.prize > 0 && <PointsPill value={p.prize} className="text-emerald-500" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
