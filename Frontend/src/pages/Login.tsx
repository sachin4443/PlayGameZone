import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Shell } from '../components/Layout';
import { Icon, Logo, Spinner, Wordmark } from '../components/ui';
import { api, errorCode, errorMessage } from '../lib/api';
import type { Me } from '../lib/types';
import { useAuth } from '../state/auth';

interface Captcha { enabled: boolean; captchaId: string; svg: string }
interface Challenge { challengeId: string; provider: 'dev' | 'sms'; devCode?: string }

export default function LoginPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const [mobile, setMobile] = useState('');
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [answer, setAnswer] = useState('');
  const [referral, setReferral] = useState(params.get('ref') ?? '');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
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
    void loadCaptcha();
  }, [loadCaptcha]);

  if (user) return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />;

  const mobileOk = /^[6-9]\d{9}$/.test(mobile);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    if (!mobileOk) return setError('Enter a valid 10-digit mobile number.');
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post<Challenge>('/auth/request-otp', { mobile, captchaId: captcha?.captchaId, captchaAnswer: answer });
      setChallenge(data);
      setCode(data.devCode ?? '');
    } catch (err) {
      setError(errorMessage(err));
      if (errorCode(err) === 'CAPTCHA_INVALID' || captcha?.enabled) void loadCaptcha();
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post<{ token: string; user: Me; isNewUser: boolean }>('/auth/verify-otp', { challengeId: challenge.challengeId, code, referralCode: referral || undefined });
      signIn(data.token, data.user);
      navigate('/', { replace: true, state: { welcome: data.isNewUser } });
    } catch (err) {
      setError(errorMessage(err));
      const c = errorCode(err);
      if (c === 'OTP_EXPIRED' || c === 'OTP_LOCKED') {
        setChallenge(null);
        void loadCaptcha();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="flex min-h-dvh flex-col px-5 pb-10 pt-10 lg:min-h-0">
        <div className="mb-8 flex items-center gap-3">
          <Logo size={52} />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand">Sign in</p>
            <h1 className="text-2xl"><Wordmark /></h1>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-3 gap-2 text-center text-[10px] font-bold uppercase tracking-wider">
          <div className="rounded-xl bg-accent/15 px-2 py-3 text-accent"><Icon name="gift" className="mx-auto mb-1" />100 free points</div>
          <div className="rounded-xl bg-emerald-500/15 px-2 py-3 text-emerald-500"><Icon name="bolt" className="mx-auto mb-1" />Instant match</div>
          <div className="rounded-xl bg-brand/15 px-2 py-3 text-brand"><Icon name="shield" className="mx-auto mb-1" />Fair dice</div>
        </div>

        {!challenge ? (
          <form onSubmit={requestCode} className="card space-y-4 p-5" noValidate>
            <div>
              <label className="label" htmlFor="mobile">Mobile number</label>
              <div className="flex">
                <span className="flex items-center rounded-l-xl border border-r-0 border-line bg-surface-2 px-3 text-sm font-bold">+91</span>
                <input id="mobile" className="input rounded-l-none" inputMode="numeric" autoComplete="tel-national" placeholder="9876543210" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} />
              </div>
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
            {error && <p className="text-sm font-medium text-red-500" role="alert">{error}</p>}
            <button className="btn-primary w-full" disabled={busy || !mobileOk || (captcha?.enabled && answer.length < 4)}>
              {busy ? <Spinner /> : <>Continue <Icon name="right" size={16} /></>}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="card space-y-4 p-5" noValidate>
            <div>
              <p className="text-sm text-muted">Enter the 6-digit code for <b className="text-ink">+91 {mobile}</b></p>
              {challenge.provider === 'dev' && (
                <p className="mt-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
                  Development login: SMS is not connected yet, so your code is shown here: <b className="tracking-widest">{challenge.devCode}</b>
                </p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="otp">One-time code</label>
              <input id="otp" className="input text-center text-xl font-bold tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
            </div>
            {error && <p className="text-sm font-medium text-red-500" role="alert">{error}</p>}
            <button className="btn-primary w-full" disabled={busy || code.length !== 6}>{busy ? <Spinner /> : 'Verify & play'}</button>
            <button type="button" className="w-full text-center text-xs font-bold text-muted underline" onClick={() => { setChallenge(null); setError(''); void loadCaptcha(); }}>Use a different number</button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-muted">PlayerX Ludo uses virtual points only. Points have no cash value and cannot be bought, withdrawn or transferred.</p>
      </div>
    </Shell>
  );
}
