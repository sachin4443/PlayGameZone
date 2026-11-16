import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { InstallBanner } from '../components/InstallApp';
import { ModeArt } from '../components/ModeArt';
import { PlaySheet } from '../components/PlaySheet';
import { PoolCard, type Pool } from '../components/PoolCard';
import { Avatar, Empty, ErrorNote, Icon, PageLoader, PointsPill, SectionTitle, Sheet, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { countdown, pts, timeAgo } from '../lib/format';
import { modeStyle } from '../lib/modes';
import type { GameMode, RoomView } from '../lib/types';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';

interface HomeData {
  modes: GameMode[];
  active: { room: { code: string } | null; gameIds: string[] };
  rooms: RoomView[];
  pools: Pool[];
  tournaments: { id: string; name: string; entryPoints: number; prizePool: number; registered: number; capacity: number; startsAt: string; status: string; mode: { name: string } }[];
  history: { gameId: string; mode: { name: string }; isPractice: boolean; isWinner: boolean; pointsWon: number; entryPaid: number; playedAt: string }[];
  leaders: { rank: number; userId: string; name: string; avatar: string; wins: number; points: number }[];
  stats: { matches: number; wins: number; winPct: number };
}

export default function HomePage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<{ mode: GameMode; intent: 'quick' | 'room' | 'practice' } | null>(null);
  const [picker, setPicker] = useState<'quick' | 'room' | 'practice' | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [modes, active, rooms, tournaments, history, leaders, stats, pools] = await Promise.all([
        api.get('/games/modes'), api.get('/rooms/active'), api.get('/rooms/public'), api.get('/tournaments'),
        api.get('/games/history', { params: { pageSize: 5 } }), api.get('/leaderboard', { params: { period: 'weekly' } }), api.get('/users/me/stats'), api.get('/rooms/pools'),
      ]);
      setData({
        modes: modes.data.items, active: active.data, rooms: rooms.data.items, pools: pools.data.items,
        tournaments: tournaments.data.items.filter((t: { status: string }) => t.status === 'UPCOMING' || t.status === 'RUNNING').slice(0, 3),
        history: history.data.items, leaders: leaders.data.items.slice(0, 3), stats: stats.data,
      });
      void refresh().catch(() => undefined);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [refresh]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if ((location.state as { welcome?: boolean } | null)?.welcome) {
      toast('Welcome! 100 free points are in your wallet.', 'success');
      navigate('/', { replace: true, state: null });
    }
  }, [location.state, navigate, toast]);

  async function joinByCode(e: FormEvent) {
    e.preventDefault();
    setJoining(true);
    setJoinError('');
    try {
      const { data: room } = await api.post<RoomView>('/rooms/join', { code: code.trim() });
      navigate(room.gameId ? `/game/${room.gameId}` : `/room/${room.code}`);
    } catch (err) {
      setJoinError(errorMessage(err));
    } finally {
      setJoining(false);
    }
  }

  if (error) return <ErrorNote message={error} onRetry={load} />;
  if (!data || !user) return <PageLoader />;

  return (
    <div>
      {/* Welcome + wallet */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand to-[#3b1fb8] p-5 text-white shadow-xl shadow-brand/30">
        <div className="absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/10" aria-hidden="true" />
        <div className="flex items-center gap-3">
          <Avatar id={user.avatar} name={user.displayName} size={46} ring="rgba(255,255,255,.5)" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white/70">Welcome back</p>
            <p className="truncate text-lg font-extrabold">{user.displayName}</p>
          </div>
        </div>
        <div className="mt-5 flex items-end justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">Available points</p>
            <PointsPill value={user.wallet?.balance ?? 0} className="text-3xl font-extrabold" />
            {(user.wallet?.locked ?? 0) > 0 && <p className="mt-1 text-xs text-white/70">{pts(user.wallet!.locked)} locked in a running game</p>}
          </div>
          <Link to="/wallet" className="rounded-xl bg-white/15 px-3 py-2 text-xs font-bold backdrop-blur hover:bg-white/25">History</Link>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          {[[data.stats.matches, 'Matches'], [data.stats.wins, 'Wins'], [`${data.stats.winPct}%`, 'Win rate']].map(([v, l]) => (
            <div key={l} className="rounded-xl bg-black/20 py-2"><div className="text-base font-extrabold">{v}</div><div className="text-white/70">{l}</div></div>
          ))}
        </div>
      </section>

      <InstallBanner />

      {/* Resume */}
      {data.active.gameIds.map((id) => (
        <Link key={id} to={`/game/${id}`} className="glow mt-4 flex items-center justify-between rounded-2xl bg-accent px-4 py-3 font-bold text-[#2a1a00]">
          <span className="flex items-center gap-2"><Icon name="bolt" /> You have a game in progress</span><span className="underline">Rejoin</span>
        </Link>
      ))}
      {data.active.room && data.active.gameIds.length === 0 && (
        <Link to={`/room/${data.active.room.code}`} className="mt-4 flex items-center justify-between rounded-2xl border border-brand bg-brand/10 px-4 py-3 text-sm font-bold text-brand">
          <span>You are waiting in room {data.active.room.code}</span><span className="underline">Open</span>
        </Link>
      )}

      {/* Play now */}
      <SectionTitle>Play now</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Quick match', hint: 'Public', icon: 'bolt', tone: 'bg-accent text-[#2a1a00]', onClick: () => setPicker('quick') },
          { label: 'Create room', hint: 'Private', icon: 'plus', tone: 'bg-brand text-white', onClick: () => setPicker('room') },
          { label: 'Join by code', hint: 'Friends', icon: 'key', tone: 'bg-pink text-white', onClick: () => { setJoinOpen(true); setJoinError(''); } },
          { label: 'Vs computer', hint: 'Free practice', icon: 'grid', tone: 'bg-emerald-500 text-white', onClick: () => setPicker('practice') },
        ].map((a) => (
          <button key={a.label} onClick={a.onClick} className={`flex items-center gap-3 rounded-2xl p-3 text-left shadow-lg transition active:scale-95 ${a.tone}`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/15"><Icon name={a.icon} /></span>
            <span><span className="block text-sm font-extrabold leading-tight">{a.label}</span><span className="text-[10px] font-bold uppercase tracking-wider opacity-70">{a.hint}</span></span>
          </button>
        ))}
      </div>

      {/* Prize pools */}
      <SectionTitle action={<Link to="/pools" className="text-xs font-bold text-brand">See all</Link>}>Prize pools</SectionTitle>
      {data.pools.length === 0 ? (
        <Empty icon="trophy" title="No prize pools right now" hint="Use Quick match to find an opponent instead." />
      ) : (
        <div className="space-y-3">{data.pools.slice(0, 3).map((p) => <PoolCard key={p.id} pool={p} />)}</div>
      )}

      {/* Game modes */}
      <SectionTitle action={<Link to="/rules" className="chip border border-line bg-surface text-brand"><Icon name="info" size={13} /> Rules</Link>}>Game modes</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {data.modes.map((m, i) => {
          const s = modeStyle(m.key);
          const wide = i === 0 || (data.modes.length % 2 === 0 && i === data.modes.length - 1);
          return (
            <button key={m.key} onClick={() => setSheet({ mode: m, intent: 'quick' })} className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${s.gradient} p-4 text-left text-white shadow-lg transition active:scale-[0.98] ${wide ? 'col-span-2 min-h-[120px]' : 'min-h-[132px]'}`}>
              <span className="chip bg-black/25">{s.badge}</span>
              <span className="mt-6 block text-xl font-extrabold leading-tight">{m.name}</span>
              <span className="block max-w-[70%] text-xs font-medium text-white/80">{m.tagline}</span>
              <span className={`absolute ${wide ? 'right-4 top-1/2 -translate-y-1/2' : '-right-2 -top-1 opacity-90'}`}><ModeArt kind={s.art} size={wide ? 92 : 64} /></span>
            </button>
          );
        })}
      </div>

      {/* Open rooms */}
      <SectionTitle action={<Link to="/live" className="text-xs font-bold text-brand">Live games</Link>}>Open rooms</SectionTitle>
      {data.rooms.length === 0 ? (
        <Empty icon="grid" title="No open rooms right now" hint="Create a public room and others can join it from here." />
      ) : (
        <div className="space-y-2">
          {data.rooms.slice(0, 4).map((r) => (
            <div key={r.id} className="card flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{r.name}</p>
                <p className="text-xs text-muted">{r.mode.name} · {r.players.length}/{r.maxPlayers} players</p>
              </div>
              <button className="btn-primary !py-2" onClick={async () => { try { const { data: room } = await api.post<RoomView>('/rooms/join', { code: r.code }); navigate(room.gameId ? `/game/${room.gameId}` : `/room/${room.code}`); } catch (e) { toast(errorMessage(e), 'error'); } }}>
                Join · <PointsPill value={r.entryPoints} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tournaments */}
      <SectionTitle action={<Link to="/tournaments" className="text-xs font-bold text-brand">See all</Link>}>Upcoming tournaments</SectionTitle>
      {data.tournaments.length === 0 ? (
        <Empty icon="trophy" title="No tournaments scheduled" hint="New cups appear here as soon as they are announced." />
      ) : (
        <div className="space-y-2">
          {data.tournaments.map((t) => (
            <Link key={t.id} to={`/tournaments/${t.id}`} className="card flex items-center gap-3 p-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/20 text-accent"><Icon name="trophy" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{t.name}</p>
                <p className="text-xs text-muted">{t.mode.name} · {t.registered}/{t.capacity} · {t.status === 'RUNNING' ? 'running now' : countdown(t.startsAt)}</p>
              </div>
              <div className="text-right text-xs"><span className="block text-muted">Prize</span><PointsPill value={t.prizePool} /></div>
            </Link>
          ))}
        </div>
      )}

      {/* Recent matches */}
      <SectionTitle>Recent matches</SectionTitle>
      {data.history.length === 0 ? (
        <Empty icon="clock" title="No matches yet" hint="Your finished games will show up here." />
      ) : (
        <div className="card divide-y divide-line">
          {data.history.map((h) => (
            <div key={h.gameId} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-bold">{h.mode.name}{h.isPractice && <span className="ml-2 chip bg-surface-2 text-muted">Practice</span>}</p>
                <p className="text-xs text-muted">{timeAgo(h.playedAt)}</p>
              </div>
              <span className={`font-extrabold ${h.isWinner ? 'text-emerald-500' : 'text-red-500'}`}>{h.isPractice ? (h.isWinner ? 'Won' : 'Lost') : h.isWinner ? `+${pts(h.pointsWon - h.entryPaid)}` : `-${pts(h.entryPaid)}`}</span>
            </div>
          ))}
        </div>
      )}

      {/* Leaderboard preview */}
      <SectionTitle action={<Link to="/leaderboard" className="text-xs font-bold text-brand">Full board</Link>}>Top players this week</SectionTitle>
      {data.leaders.length === 0 ? (
        <Empty icon="trophy" title="The board is empty" hint="Win a game to take the first spot." />
      ) : (
        <div className="card divide-y divide-line">
          {data.leaders.map((l) => (
            <div key={l.userId} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="w-5 text-center font-extrabold text-accent">{l.rank}</span>
              <Avatar id={l.avatar} name={l.name} size={32} />
              <span className="flex-1 truncate font-bold">{l.name}</span>
              <span className="text-xs text-muted">{l.wins} wins</span>
            </div>
          ))}
        </div>
      )}

      {/* More */}
      <SectionTitle>More</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {[['/pools', 'trophy', 'Prize pools'], ['/refer', 'gift', 'Refer & earn'], ['/leaderboard', 'trophy', 'Leaderboard'], ['/rules', 'list', 'Game rules'], ['/help', 'help', 'Help & support'], ['/profile', 'settings', 'Settings']].map(([to, icon, label]) => (
          <Link key={to + label} to={to} className="card flex items-center gap-3 p-3 text-sm font-bold"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 text-brand"><Icon name={icon} size={18} /></span>{label}</Link>
        ))}
      </div>

      {/* Mode picker for quick match / create room */}
      <Sheet open={picker !== null} onClose={() => setPicker(null)} title={picker === 'quick' ? 'Quick match – choose a game' : picker === 'practice' ? 'Play the computer – choose a game' : 'Create room – choose a game'}>
        <div className="space-y-2">
          {data.modes.map((m) => (
            <button key={m.key} onClick={() => { setSheet({ mode: m, intent: picker! }); setPicker(null); }} className={`flex w-full items-center justify-between rounded-2xl bg-gradient-to-r ${modeStyle(m.key).gradient} px-4 py-3 text-left text-white`}>
              <span><span className="block font-extrabold">{m.name}</span><span className="text-xs text-white/80">{m.tagline}</span></span>
              <Icon name="right" />
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={joinOpen} onClose={() => setJoinOpen(false)} title="Join a room">
        <form onSubmit={joinByCode}>
          <label className="label" htmlFor="join-code">Room code</label>
          <input id="join-code" className="input mb-3 text-center text-2xl font-extrabold uppercase tracking-[0.4em]" maxLength={6} autoFocus autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="ABC234" />
          {joinError && <p className="mb-3 text-sm font-medium text-red-500" role="alert">{joinError}</p>}
          <button className="btn-primary w-full" disabled={joining || code.length < 6}>{joining ? <Spinner /> : 'Join room'}</button>
        </form>
      </Sheet>

      <PlaySheet mode={sheet?.mode ?? null} intent={sheet?.intent ?? 'quick'} onClose={() => setSheet(null)} />
    </div>
  );
}
