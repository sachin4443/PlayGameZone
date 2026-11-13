import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PageHead } from '../components/PageHead';
import { Avatar, Empty, ErrorNote, Icon, PageLoader, PointsPill } from '../components/ui';
import { HEX } from '../lib/board';
import { timeAgo } from '../lib/format';
import type { Color } from '../lib/types';
import { useFetch } from '../lib/useFetch';

interface Live { id: string; mode: { name: string }; pool: number; startedAt: string; isTournament: boolean; players: { name: string; avatar: string; color: Color }[] }

export default function LivePage() {
  const { data, error, loading, reload } = useFetch<{ items: Live[] }>('/games/live');
  useEffect(() => {
    const t = setInterval(() => void reload(), 10000);
    return () => clearInterval(t);
  }, [reload]);
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (loading && !data) return <PageLoader />;
  return (
    <div>
      <PageHead title="Live games" subtitle="Watch tables being played right now" />
      {data!.items.length === 0 ? <Empty icon="live" title="No games are live" hint="Start one from the home screen." /> : (
        <div className="space-y-3">
          {data!.items.map((g) => (
            <Link key={g.id} to={`/game/${g.id}`} className="card block p-4">
              <div className="flex items-center justify-between">
                <span className="chip bg-red-500/15 text-red-500"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> Live</span>
                <span className="text-xs text-muted">{g.mode.name}{g.isTournament ? ' · Tournament' : ''} · {timeAgo(g.startedAt)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex -space-x-2">{g.players.map((p, i) => <Avatar key={i} id={p.avatar} name={p.name} size={36} ring={HEX[p.color]} />)}</div>
                <p className="min-w-0 flex-1 truncate text-sm font-bold">{g.players.map((p) => p.name).join(' vs ')}</p>
                {g.pool > 0 && <PointsPill value={g.pool} />}
                <Icon name="eye" size={18} className="text-muted" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
