import { useEffect } from 'react';
import { PageHead } from '../components/PageHead';
import { PoolCard, type Pool } from '../components/PoolCard';
import { Empty, ErrorNote, PageLoader } from '../components/ui';
import { useFetch } from '../lib/useFetch';

export default function PoolsPage() {
  const { data, error, loading, reload } = useFetch<{ items: Pool[] }>('/rooms/pools');
  useEffect(() => {
    const t = setInterval(() => void reload(), 6000);
    return () => clearInterval(t);
  }, [reload]);
  return (
    <div>
      <PageHead title="Prize pools" subtitle="Pick a table – the match starts when it fills" />
      {error ? <ErrorNote message={error} onRetry={reload} /> : loading && !data ? <PageLoader /> : data!.items.length === 0 ? (
        <Empty icon="trophy" title="No prize pools right now" hint="Check back soon, or start a quick match." />
      ) : (
        <div className="space-y-3">{data!.items.map((p) => <PoolCard key={p.id} pool={p} />)}</div>
      )}
      <p className="mt-4 text-center text-[11px] text-muted">Your seat is reserved when you join. Entry points are taken when the match starts and the prize goes to the winner.</p>
    </div>
  );
}
