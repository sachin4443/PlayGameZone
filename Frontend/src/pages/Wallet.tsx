import { useState } from 'react';
import { PageHead } from '../components/PageHead';
import { Empty, ErrorNote, PageLoader, PointsPill } from '../components/ui';
import { dateTime, pts, TX_LABEL } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../state/auth';

interface Tx { id: string; type: string; direction: 'CREDIT' | 'DEBIT'; amount: number; balanceAfter: number; note: string | null; createdAt: string }

export default function WalletPage() {
  const { user } = useAuth();
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useFetch<{ items: Tx[]; total: number; pageSize: number }>('/wallet/transactions', {
    page, pageSize: 20, ...(type ? { type } : {}), ...(from ? { from: new Date(from).toISOString() } : {}), ...(to ? { to: new Date(`${to}T23:59:59`).toISOString() } : {}),
  });
  const w = user?.wallet;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHead title="Wallet" subtitle="Virtual points · no cash value" />
      <section className="rounded-3xl bg-gradient-to-br from-accent to-orange-600 p-5 text-[#2a1a00] shadow-xl shadow-accent/25">
        <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Available points</p>
        <p className="text-4xl font-extrabold">{pts(w?.balance ?? 0)}</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-semibold">
          {[['Locked', w?.locked ?? 0], ['Earned', w?.totalEarned ?? 0], ['Spent', w?.totalSpent ?? 0]].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-black/10 py-2"><div className="text-base font-extrabold">{pts(v as number)}</div>{l}</div>
          ))}
        </div>
      </section>
      <p className="mt-3 text-xs text-muted">Points are earned by playing. They cannot be purchased, withdrawn or sent to other players.</p>

      <h2 className="mb-2 mt-5 text-base font-extrabold">Transaction history</h2>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <select className="input col-span-2" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Filter by type">
          <option value="">All types</option>
          {Object.entries(TX_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="text-[11px] font-bold uppercase tracking-wider text-muted">From<input type="date" className="input mt-1" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
        <label className="text-[11px] font-bold uppercase tracking-wider text-muted">To<input type="date" className="input mt-1" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
      </div>

      {error ? <ErrorNote message={error} onRetry={reload} /> : loading && !data ? <PageLoader /> : data!.items.length === 0 ? (
        <Empty icon="wallet" title="No transactions found" hint={type || from || to ? 'Try clearing the filters.' : 'Play a game to see activity here.'} />
      ) : (
        <>
          <div className="card divide-y divide-line">
            {data!.items.map((t) => {
              // A game loss only releases escrow that was already debited at entry.
              const neutral = t.type === 'GAME_LOSS';
              return (
                <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{TX_LABEL[t.type] ?? t.type}</p>
                    <p className="truncate text-xs text-muted">{dateTime(t.createdAt)}{t.note ? ` · ${t.note}` : neutral ? ' · entry lost' : ''}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-sm font-extrabold ${neutral ? 'text-muted' : t.direction === 'CREDIT' ? 'text-emerald-500' : 'text-red-500'}`}>{neutral ? '' : t.direction === 'CREDIT' ? '+' : '-'}{neutral ? '—' : pts(t.amount)}</p>
                    <p className="text-[11px] text-muted">Bal <PointsPill value={t.balanceAfter} /></p>
                  </div>
                </div>
              );
            })}
          </div>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <button className="btn-ghost !py-2" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <span className="text-muted">Page {page} of {pages}</span>
              <button className="btn-ghost !py-2" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
