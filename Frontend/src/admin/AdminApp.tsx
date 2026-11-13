import { createContext, useCallback, useContext, useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Icon, Logo, PageLoader, Spinner } from '../components/ui';
import { ADMIN_TOKEN_KEY, adminApi, errorMessage } from '../lib/api';
import type { Me } from '../lib/types';
import { AuditPage, DashboardPage, GamesPage, ModesPage, RoomsPage, SettingsPage, StaffPage, TournamentsAdminPage, UserDetailPage, UsersPage } from './pages';

interface StaffCtx { staff: Me; can: (level: 'admin' | 'super') => boolean }
const Ctx = createContext<StaffCtx | null>(null);
export const useStaff = () => useContext(Ctx)!;

const NAV = [
  ['', 'grid', 'Dashboard'], ['users', 'users', 'Users'], ['games', 'live', 'Games'], ['rooms', 'key', 'Rooms'], ['tournaments', 'trophy', 'Tournaments'],
  ['modes', 'list', 'Game modes'], ['settings', 'settings', 'Configuration'], ['audit', 'shield', 'Audit log'], ['staff', 'user', 'Staff'],
] as const;

function AdminLogin({ onDone }: { onDone: (staff: Me) => void }) {
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
      onDone(data.user);
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
  const [staff, setStaff] = useState<Me | null>(null);
  const [loading, setLoading] = useState(() => !!localStorage.getItem(ADMIN_TOKEN_KEY));
  const [menu, setMenu] = useState(false);

  const logout = useCallback(() => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setStaff(null);
  }, []);

  useEffect(() => {
    if (localStorage.getItem(ADMIN_TOKEN_KEY)) {
      adminApi.get<Me>('/admin/me').then((r) => setStaff(r.data)).catch(() => localStorage.removeItem(ADMIN_TOKEN_KEY)).finally(() => setLoading(false));
    }
    window.addEventListener('px:admin-logout', logout);
    return () => window.removeEventListener('px:admin-logout', logout);
  }, [logout]);

  if (loading) return <PageLoader />;
  if (!staff) return <AdminLogin onDone={setStaff} />;

  const can = (level: 'admin' | 'super') => staff.roles.includes('SUPER_ADMIN') || (level === 'admin' && staff.roles.includes('ADMIN'));
  const links = NAV.filter(([to]) => to !== 'staff' || can('super'));

  return (
    <Ctx.Provider value={{ staff, can }}>
      <div className="flex min-h-dvh">
        <aside className={`${menu ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-line bg-surface p-4 md:static md:flex`}>
          <div className="mb-6 flex items-center gap-2"><Logo size={32} /><span className="font-extrabold">PlayerX Admin</span></div>
          <nav className="flex-1 space-y-1" aria-label="Admin">
            {links.map(([to, icon, label]) => (
              <NavLink key={to} to={`/admin/${to}`} end={to === ''} onClick={() => setMenu(false)} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold ${isActive ? 'bg-brand text-white' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
                <Icon name={icon} size={18} /> {label}
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-line pt-3 text-xs">
            <p className="font-bold">{staff.username}</p>
            <p className="text-muted">{staff.roles.filter((r) => r !== 'PLAYER').join(', ').replace('_', ' ')}</p>
            <button onClick={logout} className="mt-2 flex items-center gap-2 font-bold text-red-500"><Icon name="logout" size={15} /> Sign out</button>
          </div>
        </aside>
        {menu && <button className="fixed inset-0 z-30 bg-black/50 md:hidden" aria-label="Close menu" onClick={() => setMenu(false)} />}
        <div className="min-w-0 flex-1">
          <header className="flex items-center gap-3 border-b border-line px-4 py-3 md:hidden">
            <button onClick={() => setMenu(true)} aria-label="Open menu" className="flex h-9 w-9 items-center justify-center rounded-lg border border-line"><Icon name="list" size={18} /></button>
            <span className="font-extrabold">PlayerX Admin</span>
          </header>
          <main className="mx-auto max-w-6xl p-4 md:p-8">
            <Routes>
              <Route index element={<DashboardPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="users/:id" element={<UserDetailPage />} />
              <Route path="games" element={<GamesPage />} />
              <Route path="rooms" element={<RoomsPage />} />
              <Route path="tournaments" element={<TournamentsAdminPage />} />
              <Route path="modes" element={<ModesPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="staff" element={can('super') ? <StaffPage /> : <Navigate to="/admin" replace />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
