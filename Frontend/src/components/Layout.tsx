import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';
import { Icon, Logo, PointsPill, Wordmark } from './ui';

const NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/live', label: 'Live', icon: 'live' },
  { to: '/tournaments', label: 'Cups', icon: 'trophy' },
  { to: '/wallet', label: 'Wallet', icon: 'wallet' },
  { to: '/profile', label: 'Me', icon: 'user' },
];

/** Decorative backdrop + brand panel that fills wide screens around the phone-width app column. */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-full overflow-x-hidden">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand/25 blur-3xl" />
        <div className="absolute -right-20 top-1/3 h-72 w-72 rounded-full bg-pink/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />
      </div>
      <div className="mx-auto flex min-h-dvh max-w-5xl justify-center gap-12 lg:px-8">
        <aside className="sticky top-0 hidden h-dvh flex-1 flex-col justify-center lg:flex">
          <div className="float-y mb-6 w-fit"><Logo size={84} /></div>
          <h1 className="text-5xl font-extrabold leading-tight">Roll. Race.<br /><span className="bg-gradient-to-r from-brand to-pink bg-clip-text text-transparent">Rule the board.</span></h1>
          <p className="mt-4 max-w-sm text-muted">Real-time multiplayer Ludo with private rooms, instant matchmaking and tournaments. Played with virtual points only – no deposits, no withdrawals.</p>
          <div className="mt-8 flex gap-3">
            {[['5', 'game modes'], ['2–4', 'players'], ['100', 'free points']].map(([n, l]) => (
              <div key={l} className="card px-4 py-3"><div className="text-xl font-extrabold">{n}</div><div className="text-[11px] font-bold uppercase tracking-wider text-muted">{l}</div></div>
            ))}
          </div>
        </aside>
        <div className="relative w-full max-w-md shrink-0 lg:my-6 lg:min-h-0 lg:overflow-hidden lg:rounded-[2rem] lg:border lg:border-line lg:bg-bg lg:shadow-2xl">{children}</div>
      </div>
    </div>
  );
}

export function Layout() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    api.get('/notifications', { params: { pageSize: 1 } }).then((r) => setUnread(r.data.unread)).catch(() => undefined);
    const socket = getSocket();
    const onNotification = (n: { title: string }) => {
      setUnread((u) => u + 1);
      toast(n.title);
    };
    // Tournament matches start on their own: take the player straight to the table.
    const onMatchReady = (m: { gameId: string }) => navigate(`/game/${m.gameId}`);
    socket.on('notification', onNotification);
    socket.on('match-ready', onMatchReady);
    return () => {
      socket.off('notification', onNotification);
      socket.off('match-ready', onMatchReady);
    };
  }, [toast, navigate]);

  return (
    <Shell>
      <div className="flex min-h-dvh flex-col lg:h-[calc(100dvh-3rem)] lg:min-h-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur">
          <Link to="/" className="flex items-center gap-2" aria-label="PlayerX Ludo home">
            <Logo size={32} />
            <Wordmark className="text-base" />
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/wallet" className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm" aria-label="Wallet balance">
              <PointsPill value={user?.wallet?.balance ?? 0} />
            </Link>
            <Link to="/notifications" onClick={() => setUnread(0)} className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
              <Icon name="bell" size={18} />
              {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-pink px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
            </Link>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 pb-28 pt-4"><Outlet /></main>

        <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:absolute" aria-label="Main">
          <div className="flex items-stretch justify-between rounded-2xl border border-line bg-surface/95 p-1.5 shadow-xl backdrop-blur">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 text-[10px] font-bold uppercase tracking-wider transition ${isActive ? 'bg-brand text-white shadow-lg shadow-brand/30' : 'text-muted hover:text-ink'}`}>
                <Icon name={n.icon} size={19} />
                {n.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </Shell>
  );
}
