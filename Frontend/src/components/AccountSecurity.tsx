import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { dateTime } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { useToast } from '../state/toast';
import { Icon, Sheet, Spinner } from './ui';

interface Req { id: string; type: 'MOBILE_CHANGE' | 'ACCOUNT_DELETE'; newMobile: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; adminRemark: string | null; createdAt: string }
const TONE = { PENDING: 'bg-accent/20 text-accent', APPROVED: 'bg-emerald-500/15 text-emerald-500', REJECTED: 'bg-red-500/15 text-red-500' };

/** Change PIN, and the two requests only staff can carry out. */
export function AccountSecurity() {
  const toast = useToast();
  const requests = useFetch<{ items: Req[] }>('/users/me/requests');
  const [open, setOpen] = useState<'pin' | 'MOBILE_CHANGE' | 'ACCOUNT_DELETE' | null>(null);
  const [form, setForm] = useState({ currentPin: '', newPin: '', confirm: '', newMobile: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, digits = false) => (e: { target: { value: string } }) => setForm({ ...form, [k]: digits ? e.target.value.replace(/\D/g, '') : e.target.value });
  const show = (which: typeof open) => { setForm({ currentPin: '', newPin: '', confirm: '', newMobile: '', reason: '' }); setError(''); setOpen(which); };
  const pending = (type: Req['type']) => requests.data?.items.some((r) => r.type === type && r.status === 'PENDING');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (open === 'pin') {
        if (form.newPin !== form.confirm) throw new Error('The two new PINs do not match');
        await api.post('/auth/change-pin', { currentPin: form.currentPin, newPin: form.newPin });
        toast('PIN changed', 'success');
      } else {
        await api.post('/users/me/requests', { type: open, newMobile: open === 'MOBILE_CHANGE' ? form.newMobile : undefined, reason: form.reason });
        toast('Request sent. Our team will review it.', 'success');
        void requests.reload();
      }
      setOpen(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const row = (icon: string, label: string, hint: string, onClick: () => void, disabled = false) => (
    <button onClick={onClick} disabled={disabled} className="flex w-full items-center justify-between p-4 text-left disabled:opacity-60">
      <span className="flex items-center gap-3 text-sm font-bold"><Icon name={icon} /> <span>{label}<span className="block text-xs font-medium text-muted">{hint}</span></span></span>
      <Icon name="right" size={16} className="text-muted" />
    </button>
  );

  return (
    <>
      <h2 className="mb-2 mt-5 text-base font-extrabold">Account & security</h2>
      <section className="card divide-y divide-line">
        {row('key', 'Change PIN', 'Use a PIN nobody can guess', () => show('pin'))}
        {row('user', 'Change mobile number', pending('MOBILE_CHANGE') ? 'Request waiting for review' : 'Needs approval from our team', () => show('MOBILE_CHANGE'), pending('MOBILE_CHANGE'))}
        {row('x', 'Delete my account', pending('ACCOUNT_DELETE') ? 'Request waiting for review' : 'Needs approval from our team', () => show('ACCOUNT_DELETE'), pending('ACCOUNT_DELETE'))}
      </section>

      {requests.data && requests.data.items.length > 0 && (
        <section className="card mt-3 divide-y divide-line">
          {requests.data.items.slice(0, 5).map((r) => (
            <div key={r.id} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{r.type === 'MOBILE_CHANGE' ? `Change number to ${r.newMobile}` : 'Delete account'}</span>
                <span className={`chip ${TONE[r.status]}`}>{r.status.toLowerCase()}</span>
              </div>
              <p className="text-xs text-muted">{dateTime(r.createdAt)}{r.adminRemark ? ` · ${r.adminRemark}` : ''}</p>
            </div>
          ))}
        </section>
      )}

      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open === 'pin' ? 'Change PIN' : open === 'MOBILE_CHANGE' ? 'Change mobile number' : 'Delete my account'}>
        <form onSubmit={submit} className="space-y-3">
          {open === 'pin' && (
            <>
              <div><label className="label" htmlFor="cur-pin">Current PIN</label><input id="cur-pin" className="input tracking-[0.4em]" type="password" inputMode="numeric" maxLength={6} autoComplete="current-password" value={form.currentPin} onChange={set('currentPin', true)} /></div>
              <div><label className="label" htmlFor="new-pin">New PIN (4 to 6 digits)</label><input id="new-pin" className="input tracking-[0.4em]" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={form.newPin} onChange={set('newPin', true)} /></div>
              <div><label className="label" htmlFor="new-pin2">Confirm new PIN</label><input id="new-pin2" className="input tracking-[0.4em]" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={form.confirm} onChange={set('confirm', true)} /></div>
            </>
          )}
          {open === 'MOBILE_CHANGE' && (
            <div><label className="label" htmlFor="new-mobile">New mobile number</label><input id="new-mobile" className="input" inputMode="numeric" maxLength={10} placeholder="9876543210" value={form.newMobile} onChange={set('newMobile', true)} /></div>
          )}
          {open === 'ACCOUNT_DELETE' && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-500">Once approved, your account is closed, your points are lost and this cannot be undone.</p>}
          {open !== 'pin' && (
            <div><label className="label" htmlFor="req-reason">Reason</label><textarea id="req-reason" className="input h-24" maxLength={300} value={form.reason} onChange={set('reason')} /></div>
          )}
          {error && <p className="text-sm font-medium text-red-500" role="alert">{error}</p>}
          <button className={open === 'ACCOUNT_DELETE' ? 'btn-danger w-full' : 'btn-primary w-full'}
            disabled={busy || (open === 'pin' ? form.currentPin.length < 4 || form.newPin.length < 4 || form.confirm.length < 4 : form.reason.trim().length < 5 || (open === 'MOBILE_CHANGE' && !/^[6-9]\d{9}$/.test(form.newMobile)))}>
            {busy ? <Spinner /> : open === 'pin' ? 'Change PIN' : 'Send request'}
          </button>
        </form>
      </Sheet>
    </>
  );
}
