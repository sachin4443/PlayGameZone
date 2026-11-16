import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Shell } from '../components/Layout';
import { Icon, Logo, Spinner, Wordmark } from '../components/ui';
import { api, errorCode, errorMessage } from '../lib/api';
import type { Me } from '../lib/types';
import { useAuth } from '../state/auth';

interface Captcha { enabled: boolean; captchaId: string; svg: string }
type Session = { token: string; user: Me; isNewUser: boolean };

function PinInput({ id, label, value, onChange, autoComplete }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="relative">
        <input id={id} className="input pr-12 text-lg font-bold tracking-[0.4em]" type={show ? 'text' : 'password'} inputMode="numeric" autoComplete={autoComplete} maxLength={6} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} />
        <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted" aria-label={show ? 'Hide PIN' : 'Show PIN'}><Icon name="eye" size={18} /></button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const [tab, setTab] = useState<'login' | 'register'>(params.get('ref') ? 'register' : 'login');
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [answer, setAnswer] = useState('');
  const [referral, setReferral] = useState(params.get('ref') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadCaptcha = useCallback(async () => {
    setAnswer('');
    try {
      const { data } = await api.post<Captcha>('/auth/captcha');
      setCaptcha(data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (tab === 'register') void loadCaptcha();
    setError('');
  }, [tab, loadCaptcha]);

  if (user) return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />;

  const mobileOk = /^[6-9]\d{9}$/.test(mobile);
  const pinOk = /^\d{4,6}$/.test(pin);
  const mismatch = tab === 'register' && confirmPin.length >= pin.length && confirmPin !== pin;
  const ready = mobileOk && pinOk && (tab === 'login' || (confirmPin === pin && (!captcha?.enabled || answer.length >= 4)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const { data } = tab === 'login'
        ? await api.post<Session>('/auth/login', { mobile, pin })
        : await api.post<Session>('/auth/register', { mobile, pin, confirmPin, captchaId: captcha?.captchaId, captchaAnswer: answer, referralCode: referral || undefined });
      signIn(data.token, data.user);
      navigate('/', { replace: true, state: { welcome: data.isNewUser } });
    } catch (err) {
      setError(errorMessage(err));
      if (tab === 'register') void loadCaptcha();
      if (errorCode(err) === 'MOBILE_REGISTERED') setTab('login');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="flex min-h-dvh flex-col px-5 pb-10 pt-10 lg:min-h-0">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={52} />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand">Welcome</p>
            <h1 className="text-2xl"><Wordmark /></h1>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1" role="tablist">
          {(['login', 'register'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-xl py-2.5 text-sm font-bold ${tab === t ? 'bg-brand text-white shadow' : 'text-muted'}`}>{t === 'login' ? 'Sign in' : 'Create account'}</button>
          ))}
        </div>

        <form onSubmit={submit} className="card space-y-4 p-5" noValidate>
          <div>
            <label className="label" htmlFor="mobile">Mobile number</label>
            <div className="flex">
              <span className="flex items-center rounded-l-xl border border-r-0 border-line bg-surface-2 px-3 text-sm font-bold">+91</span>
              <input id="mobile" className="input rounded-l-none" inputMode="numeric" autoComplete="tel-national" placeholder="9876543210" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} />
            </div>
          </div>
          <PinInput id="pin" label={tab === 'login' ? 'PIN' : 'Create a PIN (4 to 6 digits)'} value={pin} onChange={setPin} autoComplete={tab === 'login' ? 'current-password' : 'new-password'} />
          {tab === 'register' && (
            <>
              <div>
                <PinInput id="confirm-pin" label="Confirm PIN" value={confirmPin} onChange={setConfirmPin} autoComplete="new-password" />
                {mismatch && <p className="mt-1 text-xs font-medium text-red-500">The two PINs do not match.</p>}
              </div>
              {captcha?.enabled && (
                <div>
                  <label className="label" htmlFor="captcha">Type the characters you see</label>
                  <div className="mb-2 flex items-center gap-2">
                    <div className="overflow-hidden rounded-xl border border-line bg-white" dangerouslySetInnerHTML={{ __html: captcha.svg }} />
                    <button type="button" onClick={loadCaptcha} className="btn-ghost !px-3" aria-label="New CAPTCHA"><Icon name="refresh" size={18} /></button>
                  </div>
                  <input id="captcha" className="input uppercase tracking-[0.3em]" autoComplete="off" autoCapitalize="characters" maxLength={8} value={answer} onChange={(e) => setAnswer(e.target.value.toUpperCase())} />
                </div>
              )}
              <div>
                <label className="label" htmlFor="ref">Referral code (optional)</label>
                <input id="ref" className="input uppercase" maxLength={12} placeholder="Friend's code" value={referral} onChange={(e) => setReferral(e.target.value.toUpperCase())} />
              </div>
            </>
          )}
          {error && <p className="text-sm font-medium text-red-500" role="alert">{error}</p>}
          <button className="btn-primary w-full" disabled={busy || !ready}>{busy ? <Spinner /> : tab === 'login' ? 'Sign in' : 'Create account & get 100 points'}</button>
          {tab === 'login' && <p className="text-center text-xs text-muted">Forgot your PIN? Contact support – staff can set a new one for you.</p>}
        </form>

        <p className="mt-6 text-center text-xs text-muted">One account per mobile number. PlayerX Ludo uses virtual points only: they have no cash value and cannot be bought, withdrawn or transferred.</p>
      </div>
    </Shell>
  );
}
