import { Link } from 'react-router-dom';
import { PageHead } from '../components/PageHead';
import { Empty, ErrorNote, Icon, PageLoader, PointsPill } from '../components/ui';
import { countdown, dateTime } from '../lib/format';
import { useFetch } from '../lib/useFetch';

export interface TournamentRow { id: string; name: string; mode: { name: string }; entryPoints: number; capacity: number; registered: number; prizePool: number; status: 'UPCOMING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'; startsAt: string }

export const STATUS_TONE: Record<string, string> = {
  UPCOMING: 'bg-brand/15 text-brand', RUNNING: 'bg-emerald-500/15 text-emerald-500', COMPLETED: 'bg-surface-2 text-muted', CANCELLED: 'bg-red-500/15 text-red-500',
};

export default function TournamentsPage() {
  const { data, error, loading, reload } = useFetch<{ items: TournamentRow[] }>('/tournaments');
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (loading && !data) return <PageLoader />;
  const open = data!.items.filter((t) => t.status === 'UPCOMING' || t.status === 'RUNNING');
  const past = data!.items.filter((t) => t.status === 'COMPLETED' || t.status === 'CANCELLED');

  const row = (t: TournamentRow) => (
    <Link key={t.id} to={`/tournaments/${t.id}`} className="card block p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-extrabold">{t.name}</p>
          <p className="text-xs text-muted">{t.mode.name} · knockout</p>
        </div>
        <span className={`chip ${STATUS_TONE[t.status]}`}>{t.status === 'UPCOMING' ? countdown(t.startsAt) : t.status.toLowerCase()}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-xl bg-surface-2 py-2"><span className="block text-muted">Entry</span><PointsPill value={t.entryPoints} /></div>
        <div className="rounded-xl bg-surface-2 py-2"><span className="block text-muted">Prize pool</span><PointsPill value={t.prizePool} /></div>
        <div className="rounded-xl bg-surface-2 py-2"><span className="block text-muted">Players</span><b>{t.registered}/{t.capacity}</b></div>
      </div>
      <p className="mt-2 flex items-center gap-1 text-[11px] text-muted"><Icon name="clock" size={12} /> {dateTime(t.startsAt)}</p>
    </Link>
  );

  return (
    <div>
      <PageHead title="Tournaments" subtitle="Knockout cups with prize pools" />
      {open.length === 0 ? <Empty icon="trophy" title="No tournaments open" hint="Check back soon – new cups are added regularly." /> : <div className="space-y-3">{open.map(row)}</div>}
      {past.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-base font-extrabold">History</h2>
          <div className="space-y-3">{past.map(row)}</div>
        </>
      )}
    </div>
  );
}
