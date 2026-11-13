import { useState } from 'react';
import { PageHead } from '../components/PageHead';
import { Avatar, Empty, ErrorNote, PageLoader, PointsPill } from '../components/ui';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../state/auth';

interface Row { rank: number; userId: string; name: string; avatar: string; matches: number; wins: number; winPct: number; points: number }
const PERIODS = [['daily', 'Today'], ['weekly', 'Week'], ['monthly', 'Month'], ['all', 'All time']] as const;

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>('weekly');
  const { data, error, loading, reload } = useFetch<{ items: Row[] }>('/leaderboard', { period });
  const medal = ['bg-accent text-[#2a1a00]', 'bg-slate-300 text-slate-800', 'bg-orange-400 text-orange-950'];

  return (
    <div>
      <PageHead title="Leaderboard" subtitle="Ranked by wins, then points won" />
      <div className="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-surface-2 p-1" role="tablist">
        {PERIODS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={period === k} onClick={() => setPeriod(k)} className={`rounded-xl py-2 text-xs font-bold ${period === k ? 'bg-brand text-white shadow' : 'text-muted'}`}>{label}</button>
        ))}
      </div>
      {error ? <ErrorNote message={error} onRetry={reload} /> : loading ? <PageLoader /> : data!.items.length === 0 ? (
        <Empty icon="trophy" title="No games in this period yet" hint="Finish a game to get on the board." />
      ) : (
        <div className="card divide-y divide-line">
          {data!.items.map((r) => (
            <div key={r.userId} className={`flex items-center gap-3 px-3 py-3 ${r.userId === user?.id ? 'bg-brand/10' : ''}`}>
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${medal[r.rank - 1] ?? 'bg-surface-2 text-muted'}`}>{r.rank}</span>
              <Avatar id={r.avatar} name={r.name} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{r.userId === user?.id ? 'You' : r.name}</p>
                <p className="text-[11px] text-muted">{r.matches} matches · {r.winPct}% wins</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-extrabold">{r.wins} wins</p>
                <PointsPill value={r.points} className="text-[11px] text-muted" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
