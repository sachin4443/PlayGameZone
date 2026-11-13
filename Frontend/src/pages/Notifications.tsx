import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHead } from '../components/PageHead';
import { Empty, ErrorNote, PageLoader } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useFetch } from '../lib/useFetch';

interface N { id: string; title: string; body: string; readAt: string | null; createdAt: string; data: { gameId?: string; tournamentId?: string } | null }

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useFetch<{ items: N[] }>('/notifications', { pageSize: 50 });
  useEffect(() => {
    if (data) void api.post('/notifications/read-all').catch(() => undefined);
  }, [data]);
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (loading && !data) return <PageLoader />;
  return (
    <div>
      <PageHead title="Notifications" />
      {data!.items.length === 0 ? <Empty icon="bell" title="You're all caught up" /> : (
        <div className="space-y-2">
          {data!.items.map((n) => {
            const target = n.data?.tournamentId ? `/tournaments/${n.data.tournamentId}` : n.data?.gameId ? `/game/${n.data.gameId}` : null;
            return (
              <button key={n.id} disabled={!target} onClick={() => target && navigate(target)} className={`card block w-full p-4 text-left ${n.readAt ? '' : '!border-brand'}`}>
                <p className="text-sm font-bold">{n.title}</p>
                <p className="mt-0.5 text-sm text-muted">{n.body}</p>
                <p className="mt-1 text-[11px] text-muted">{timeAgo(n.createdAt)}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
