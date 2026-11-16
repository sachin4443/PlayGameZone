import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { dateTime, pts } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';
import { Icon, Sheet, Spinner } from './ui';

interface Req { id: string; type: 'ADD' | 'WITHDRAW'; amount: number; note: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; adminRemark: string | null; createdAt: string }
const TONE = { PENDING: 'bg-accent/20 text-accent', APPROVED: 'bg-emerald-500/15 text-emerald-500', REJECTED: 'bg-red-500/15 text-red-500' };

/** Ask staff to add or withdraw virtual points, and follow the requests' status. */
export function PointRequests() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const { data, reload } = useFetch<{ items: Req[]; enabled: boolean; max: number }>('/wallet/requests');
  const [open, setOpen] = useState<'ADD' | 'WITHDRAW' | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const balance = user?.wallet?.balance ?? 0;
  const pending = (t: Req['type']) => data?.items.some((r) => r.type === t && r.status === 'PENDING') ?? false;
  const n = Number(amount);
  const invalid = !Number.isInteger(n) || n < 1 || (data ? n > data.max : false) || (open === 'WITHDRAW' && n > balance);

  const show = (t: 'ADD' | 'WITHDRAW') => { setAmount(''); setNote(''); setError(''); setOpen(t); };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/wallet/requests', { type: open, amount: n, note });
      toast('Request sent. You will be notified when it is reviewed.', 'success');
      setOpen(null);
      void reload();
      void refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (data && !data.enabled && data.items.length === 0) return null;

  return (
    <section className="mt-4">
      {data?.enabled && (
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-primary" disabled={pending('ADD')} onClick={() => show('ADD')}><Icon name="plus" size={18} /> {pending('ADD') ? 'Request pending' : 'Request points'}</button>
          <button className="btn-ghost" disabled={pending('WITHDRAW') || balance < 1} onClick={() => show('WITHDRAW')}>{pending('WITHDRAW') ? 'Withdrawal pending' : 'Withdraw points'}</button>
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <h2 className="mb-2 mt-5 text-base font-extrabold">Your requests</h2>
          <div className="card divide-y divide-line">
            {data.items.slice(0, 8).map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-bold">{r.type === 'ADD' ? 'Add' : 'Withdraw'} {pts(r.amount)} points</span>
                  <span className={`chip ${TONE[r.status]}`}>{r.status.toLowerCase()}</span>
                </div>
                <p className="text-xs text-muted">{dateTime(r.createdAt)}{r.status === 'PENDING' && r.type === 'WITHDRAW' ? ' · points reserved until reviewed' : ''}</p>
                {r.adminRemark && <p className={`mt-1 text-xs ${r.status === 'REJECTED' ? 'text-red-500' : 'text-muted'}`}>{r.status === 'REJECTED' ? 'Reason: ' : 'Note: '}{r.adminRemark}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open === 'ADD' ? 'Request points' : 'Withdraw points'}>
        <form onSubmit={submit} className="space-y-3">
          <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
            Points are virtual and used only inside PlayerX Ludo. They have no cash value: they cannot be bought, sold or exchanged for money.
            {open === 'WITHDRAW' ? ' Withdrawn points are removed from your wallet once our team approves; they are reserved until then.' : ' Our team reviews every request.'}
          </p>
          <div>
            <label className="label" htmlFor="pr-amount">Points</label>
            <input id="pr-amount" className="input text-lg font-bold" type="number" inputMode="numeric" min={1} max={open === 'WITHDRAW' ? balance : data?.max} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            <p className="mt-1 text-xs text-muted">{open === 'WITHDRAW' ? `Available: ${pts(balance)} points` : `Up to ${pts(data?.max ?? 0)} points per request`}</p>
          </div>
          <div><label className="label" htmlFor="pr-note">Note (optional)</label><input id="pr-note" className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          {error && <p className="text-sm font-medium text-red-500" role="alert">{error}</p>}
          <button className="btn-primary w-full" disabled={busy || invalid}>{busy ? <Spinner /> : 'Send request'}</button>
        </form>
      </Sheet>
    </section>
  );
}
