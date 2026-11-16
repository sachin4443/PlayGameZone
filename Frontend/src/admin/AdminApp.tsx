import { createContext, useCallback, useContext, useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Icon, Logo, PageLoader, Spinner } from '../components/ui';
import { ADMIN_TOKEN_KEY, adminApi, errorMessage } from '../lib/api';
import type { Me } from '../lib/types';
import { AuditPage, DashboardPage, GamesPage, ModesPage, RoomsPage, SettingsPage, TournamentsAdminPage, UserDetailPage, UsersPage } from './pages';
import { AccountRequestsPage, PrizePoolsPage, StaffPage } from './pages2';

export interface StaffMe extends Me { role: string; permissions: Record<string, string[]>; mustChangePassword: boolean; modules: Record<string, string>; actions: string[] }
interface StaffCtx { staff: StaffMe; has: (module: string, action: string) => boolean; pendingRequests: number; refreshBadges: () => void }
const Ctx = createContext<StaffCtx | null>(null);
export const useStaff = () => useContext(Ctx)!;

/** [route, icon, label, permission module]. A link shows only with `view` on its module. */
const NAV = [
  ['', 'grid', 'Dashboard', 'dashboard'], ['users', 'users', 'Users', 'users'], ['requests', 'bell', 'Account requests', 'accountRequests'],
  ['games', 'live', 'Games', 'games'], ['rooms', 'key', 'Rooms', 'rooms'], ['pools', 'gift', 'Prize pools', 'prizePools'], ['tournaments', 'trophy', 'Tournaments', 'tournaments'],
  ['modes', 'list', 'Game modes', 'modes'], ['settings', 'settings', 'Configuration', 'settings'], ['audit', 'shield', 'Audit log', 'audit'], ['staff', 'user', 'Staff & permissions', 'staff'],
] as const;

function ChangePassword({ forced, onDone }: { forced: boolean; onDone: () => void }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setError('The two new passwords do not match');
    setBusy(true);
    setError('');
    try {
      await adminApi.post('/admin/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const field = (k: keyof typeof form, label: string, ac: string) => (
    <div><label className="label" htmlFor={k}>{label}</label><input id={k} type="password" className="input" autoComplete={ac} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
  );
  return (
    <form onSubmit={submit} className="card mx-auto w-full max-w-sm space-y-4 p-6">
      <h1 className="text-xl font-extrabold">{forced ? 'Choose a new password' : 'Change password'}</h1>
      {forced && <p className="text-sm text-muted">This account is using a temporary password. Set your own before continuing.</p>}
      {field('currentPassword', 'Current password', 'current-password')}
      {field('newPassword', 'New password (10+ characters, letters and numbers)', 'new-password')}
      {field('confirm', 'Confirm new password', 'new-password')}
      {error && <p className="text-sm font-medium text-red-500" role="alert">{error}</p>}
      <button className="btn-primary w-full" disabled={busy || !form.currentPassword || form.newPassword.length < 10 || !form.confirm}>{busy ? <Spinner /> : 'Save password'}</button>
    </form>
  );
}

function AdminLogin({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await adminApi.post<{ token: string; user: Me }>('/admin/auth/login', { username, password });
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-3"><Logo size={40} /><div><p className="text-[11px] font-bold uppercase tracking-widest text-brand">Staff only</p><h1 className="text-xl font-extrabold">PlayerX Ludo Admin</h1></div></div>
        <div><label className="label" htmlFor="u">Username</label><input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
        <div><label className="label" htmlFor="p">Password</label><input id="p" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {error && <p className="text-sm font-medium text-red-500" role="alert">{error}</p>}
        <button className="btn-primary w-full" disabled={busy || !username || !password}>{busy ? <Spinner /> : 'Sign in'}</button>
      </form>
    </div>
  );
}

export default function AdminApp() {
  const [staff, setStaff] = useState<StaffMe | null>(null);
  const [loading, setLoading] = useState(() => !!localStorage.getItem(ADMIN_TOKEN_KEY));
  const [menu, setMenu] = useState(false);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [changing, setChanging] = useState(false);

  const logout = useCallback(() => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setStaff(null);
  }, []);

  const loadMe = useCallback(async () => {
    try {
      setStaff((await adminApi.get<StaffMe>('/admin/me')).data);
    } catch {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      setStaff(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshBadges = useCallback(() => {
    adminApi.get<{ accountRequests: number }>('/admin/notifications/summary').then((r) => setPendingRequests(r.data.accountRequests)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (localStorage.getItem(ADMIN_TOKEN_KEY)) void loadMe();
    window.addEventListener('px:admin-logout', logout);
    return () => window.removeEventListener('px:admin-logout', logout);
  }, [logout, loadMe]);

  // New requests show up on their own: the count is polled, no page refresh needed.
  const ready = !!staff && !staff.mustChangePassword;
  useEffect(() => {
    if (!ready) return;
    refreshBadges();
    const t = setInterval(refreshBadges, 15000);
    return () => clearInterval(t);
  }, [ready, refreshBadges]);

  if (loading) return <PageLoader />;
  if (!staff) return <AdminLogin onDone={() => { setLoading(true); void loadMe(); }} />;
  if (staff.mustChangePassword) return <div className="flex min-h-dvh items-center p-4"><ChangePassword forced onDone={loadMe} /></div>;

  const has = (module: string, action: string) => staff.permissions[module]?.includes(action) ?? false;
  const links = NAV.filter(([, , , module]) => has(module, 'view'));
  const guard = (module: string, el: JSX.Element) => (has(module, 'view') ? el : <NoAccess />);
  const home = links[0] ? `/admin/${links[0][0]}` : null;

  return (
    <Ctx.Provider value={{ staff, has, pendingRequests, refreshBadges }}>
      <div className="flex min-h-dvh">
        <aside className={`${menu ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-40 w-64 flex-col border-r border-line bg-surface p-4 md:static md:flex`}>
          <div className="mb-6 flex items-center gap-2"><Logo size={32} /><span className="font-extrabold">PlayerX Admin</span></div>
          <nav className="flex-1 space-y-1 overflow-y-auto" aria-label="Admin">
            {links.map(([to, icon, label]) => (
              <NavLink key={to} to={`/admin/${to}`} end={to === ''} onClick={() => setMenu(false)} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold ${isActive ? 'bg-brand text-white' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
                <Icon name={icon} size={18} /> <span className="flex-1">{label}</span>
                {to === 'requests' && pendingRequests > 0 && <span className="rounded-full bg-pink px-2 py-0.5 text-[11px] font-extrabold text-white" aria-label={`${pendingRequests} pending`}>{pendingRequests}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-line pt-3 text-xs">
            <p className="font-bold">{staff.username}</p>
            <p className="text-muted">{staff.role.replace('_', ' ')}</p>
            <div className="mt-2 flex gap-4 font-bold">
              <button onClick={() => { setChanging(true); setMenu(false); }} className="text-brand">Change password</button>
              <button onClick={logout} className="flex items-center gap-1 text-red-500"><Icon name="logout" size={15} /> Sign out</button>
            </div>
          </div>
        </aside>
        {menu && <button className="fixed inset-0 z-30 bg-black/50 md:hidden" aria-label="Close menu" onClick={() => setMenu(false)} />}
        <div className="min-w-0 flex-1">
          <header className="flex items-center gap-3 border-b border-line px-4 py-3 md:hidden">
            <button onClick={() => setMenu(true)} aria-label="Open menu" className="flex h-9 w-9 items-center justify-center rounded-lg border border-line"><Icon name="list" size={18} /></button>
            <span className="font-extrabold">PlayerX Admin</span>
          </header>
          {pendingRequests > 0 && has('accountRequests', 'view') && (
            <NavLink to="/admin/requests" className="flex items-center justify-center gap-2 bg-pink px-4 py-2 text-sm font-bold text-white" role="status">
              <Icon name="bell" size={16} /> {pendingRequests} new account request{pendingRequests === 1 ? '' : 's'} waiting for review
            </NavLink>
          )}
          <main className="mx-auto max-w-6xl p-4 md:p-8">
            {changing ? <ChangePassword forced={false} onDone={() => setChanging(false)} /> : (
              <Routes>
                <Route index element={has('dashboard', 'view') ? <DashboardPage /> : home && home !== '/admin/' ? <Navigate to={home} replace /> : <NoAccess />} />
                <Route path="users" element={guard('users', <UsersPage />)} />
                <Route path="users/:id" element={guard('users', <UserDetailPage />)} />
                <Route path="requests" element={guard('accountRequests', <AccountRequestsPage />)} />
                <Route path="games" element={guard('games', <GamesPage />)} />
                <Route path="rooms" element={guard('rooms', <RoomsPage />)} />
                <Route path="pools" element={guard('prizePools', <PrizePoolsPage />)} />
                <Route path="tournaments" element={guard('tournaments', <TournamentsAdminPage />)} />
                <Route path="modes" element={guard('modes', <ModesPage />)} />
                <Route path="settings" element={guard('settings', <SettingsPage />)} />
                <Route path="audit" element={guard('audit', <AuditPage />)} />
                <Route path="staff" element={guard('staff', <StaffPage />)} />
                <Route path="*" element={<Navigate to="/admin" replace />} />
              </Routes>
            )}
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}

function NoAccess() {
  return <div className="card p-8 text-center"><h1 className="text-lg font-extrabold">No access</h1><p className="mt-1 text-sm text-muted">Your account does not have permission to open this page.</p></div>;
}
