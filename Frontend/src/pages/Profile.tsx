import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AccountSecurity } from '../components/AccountSecurity';
import { InstallRow } from '../components/InstallApp';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { Avatar, AVATAR_IDS, Icon, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import type { Me } from '../lib/types';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';

export default function ProfilePage() {
  const { user, setUser, signOut } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const save = async (patch: Partial<Pick<Me, 'displayName' | 'avatar' | 'soundEnabled' | 'theme'>>, quiet = false) => {
    setBusy(true);
    try {
      const { data } = await api.patch<Me>('/users/me', patch);
      setUser(data);
      if (!quiet) toast('Saved', 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    signOut();
  };

  return (
    <div>
      <section className="card flex items-center gap-4 p-4">
        <Avatar id={user.avatar} name={user.displayName} size={64} />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-extrabold">{user.displayName}</h1>
          <p className="text-sm text-muted">+91 {user.mobile}</p>
        </div>
      </section>

      <h2 className="mb-2 mt-5 text-base font-extrabold">Profile</h2>
      <section className="card space-y-4 p-4">
        <form onSubmit={(e) => { e.preventDefault(); void save({ displayName: name.trim() }); }}>
          <label className="label" htmlFor="display-name">Display name</label>
          <div className="flex gap-2">
            <input id="display-name" className="input" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn-primary" disabled={busy || name.trim().length < 3 || name.trim() === user.displayName}>{busy ? <Spinner /> : 'Save'}</button>
          </div>
        </form>
        <div>
          <span className="label">Avatar</span>
          <div className="flex flex-wrap gap-2">
            {AVATAR_IDS.map((a) => (
              <button key={a} onClick={() => save({ avatar: a }, true)} aria-label={`Avatar ${a}`} aria-pressed={user.avatar === a} className={`rounded-full p-0.5 ${user.avatar === a ? 'ring-2 ring-brand' : ''}`}>
                <Avatar id={a} name={user.displayName} size={40} />
              </button>
            ))}
          </div>
        </div>
      </section>

      <h2 className="mb-2 mt-5 text-base font-extrabold">Settings</h2>
      <section className="card divide-y divide-line">
        <div className="flex items-center justify-between p-4">
          <span className="flex items-center gap-3 text-sm font-bold"><Icon name="sound" /> Sound effects</span>
          <button role="switch" aria-checked={user.soundEnabled} aria-label="Sound effects" onClick={() => save({ soundEnabled: !user.soundEnabled }, true)} className={`relative h-7 w-12 rounded-full transition ${user.soundEnabled ? 'bg-brand' : 'bg-surface-2'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${user.soundEnabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        <InstallRow />
        <div className="p-4">
          <span className="mb-2 flex items-center gap-3 text-sm font-bold"><Icon name="sun" /> Theme</span>
          <ThemeSwitch onChange={(t) => void save({ theme: t }, true)} />
          <p className="mt-2 text-xs text-muted">Saved to your account, so it is applied whenever you sign in.</p>
        </div>
      </section>

      <AccountSecurity />

      <section className="card mt-5 divide-y divide-line">
        {[['/wallet', 'wallet', 'Transaction history'], ['/refer', 'gift', 'Refer & earn'], ['/leaderboard', 'trophy', 'Leaderboard'], ['/rules', 'list', 'Game rules'], ['/help', 'help', 'Help & support']].map(([to, icon, label]) => (
          <Link key={to} to={to} className="flex items-center justify-between p-4 text-sm font-bold"><span className="flex items-center gap-3"><Icon name={icon} /> {label}</span><Icon name="right" size={16} className="text-muted" /></Link>
        ))}
      </section>

      <button className="btn-ghost mt-5 w-full text-red-500" onClick={logout}><Icon name="logout" size={18} /> Sign out</button>
    </div>
  );
}
