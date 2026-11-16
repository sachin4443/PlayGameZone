import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Empty, ErrorNote, PageLoader, Sheet, Spinner } from '../components/ui';
import { adminApi, errorMessage } from '../lib/api';
import { dateTime, pts, TX_LABEL } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { useToast } from '../state/toast';
import { useStaff } from './AdminApp';

// ── shared bits ───────────────────────────────────────────────────

export const useAdmin = <T,>(url: string | null, params?: Record<string, unknown>) => useFetch<T>(url, params, adminApi);

export function Title({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-extrabold">{children}</h1>{action}</div>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead><tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">{head.map((h) => <th key={h} className="px-4 py-3 font-bold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line [&_td]:px-4 [&_td]:py-3">{children}</tbody>
      </table>
    </div>
  );
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-muted">
      <span>{pts(total)} total</span>
      <div className="flex items-center gap-2">
        <button className="btn-ghost !py-1.5" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span>{page} / {pages}</span>
        <button className="btn-ghost !py-1.5" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1" role="tablist">
      {options.map(([v, label]) => <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${value === v ? 'bg-surface shadow' : 'text-muted'}`}>{label}</button>)}
    </div>
  );
}

export const Badge = ({ children, tone = 'muted' }: { children: ReactNode; tone?: 'ok' | 'bad' | 'warn' | 'muted' }) => (
  <span className={`chip ${{ ok: 'bg-emerald-500/15 text-emerald-500', bad: 'bg-red-500/15 text-red-500', warn: 'bg-accent/20 text-accent', muted: 'bg-surface-2 text-muted' }[tone]}`}>{children}</span>
);
export const statusTone = (s: string) => (['ACTIVE', 'FINISHED', 'COMPLETED', 'RUNNING', 'IN_GAME'].includes(s) ? 'ok' : ['CANCELLED', 'BLOCKED'].includes(s) ? 'bad' : 'warn') as 'ok' | 'bad' | 'warn';

export function State({ error, loading, reload, empty, children }: { error: string; loading: boolean; reload: () => void; empty?: boolean; children: ReactNode }) {
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (loading) return <PageLoader />;
  if (empty) return <Empty title="Nothing here yet" />;
  return <>{children}</>;
}

/** Downloads a CSV export; shown only to staff with the download permission for that module. */
export function DownloadButton({ name, module, label = 'Download CSV' }: { name: string; module: string; label?: string }) {
  const { has } = useStaff();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!has(module, 'download')) return null;
  const run = async () => {
    setBusy(true);
    try {
      const res = await adminApi.get(`/admin/export/${name}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return <button className="btn-ghost !py-2" onClick={run} disabled={busy}>{busy ? <Spinner /> : label}</button>;
}

// ── dashboard ─────────────────────────────────────────────────────

export function DashboardPage() {
  const { data, error, loading, reload } = useAdmin<Record<string, number>>('/admin/dashboard');
  const cards: [string, string][] = [
    ['totalUsers', 'Registered users'], ['activeUsers', 'Active (24h)'], ['blockedUsers', 'Blocked users'], ['totalGames', 'Total games'],
    ['liveGames', 'Live games'], ['completedGames', 'Completed games'], ['cancelledGames', 'Cancelled games'], ['waitingRooms', 'Waiting rooms'],
    ['pointsIssued', 'Points issued'], ['pointsInCirculation', 'Points in circulation'], ['pointsInEscrow', 'Points in escrow'], ['commissionEarned', 'Commission kept'],
  ];
  return (
    <div>
      <Title action={<button className="btn-ghost !py-2" onClick={reload}>Refresh</button>}>Dashboard</Title>
      <State error={error} loading={loading && !data} reload={reload}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cards.map(([k, label]) => (
            <div key={k} className="card p-4"><p className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</p><p className="mt-1 text-2xl font-extrabold">{pts(data?.[k] ?? 0)}</p></div>
          ))}
        </div>
      </State>
    </div>
  );
}

// ── users ─────────────────────────────────────────────────────────

interface UserRow { id: string; mobile: string; name: string; status: string; balance: number; locked: number; createdAt: string; lastLoginAt: string | null }

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'BLOCKED'>('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAdmin<{ items: UserRow[]; total: number; pageSize: number }>('/admin/users', { page, ...(query ? { search: query } : {}), ...(status ? { status } : {}) });
  return (
    <div>
      <Title action={<div className="flex gap-2"><DownloadButton name="users" module="users" /><DownloadButton name="transactions" module="wallet" label="Wallet ledger CSV" /></div>}>Users</Title>
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); setPage(1); }}>
        <input className="input" placeholder="Search by mobile, name or referral code" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" />
        <button className="btn-primary">Search</button>
      </form>
      <Tabs value={status} options={[['', 'All'], ['ACTIVE', 'Active'], ['BLOCKED', 'Blocked']]} onChange={(v) => { setStatus(v); setPage(1); }} />
      <State error={error} loading={loading && !data} reload={reload} empty={data?.items.length === 0}>
        <Table head={['Player', 'Mobile', 'Status', 'Balance', 'Locked', 'Joined', '']}>
          {data?.items.map((u) => (
            <tr key={u.id}>
              <td className="font-bold">{u.name}</td><td>{u.mobile}</td><td><Badge tone={statusTone(u.status)}>{u.status}</Badge></td>
              <td>{pts(u.balance)}</td><td>{pts(u.locked)}</td><td className="text-muted">{dateTime(u.createdAt)}</td>
              <td><Link to={`/admin/users/${u.id}`} className="font-bold text-brand">Open</Link></td>
            </tr>
          ))}
        </Table>
        {data && <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
      </State>
    </div>
  );
}

interface UserDetail {
  id: string; mobile: string; name: string; status: 'ACTIVE' | 'BLOCKED'; referralCode: string; referredBy: string | null; createdAt: string; lastLoginAt: string | null;
  wallet: { balance: number; locked: number; totalEarned: number; totalSpent: number } | null; stats: { matches: number; wins: number };
  recentGames: { gameId: string; mode: string; isWinner: boolean; pointsWon: number; entryPaid: number; playedAt: string }[];
}
interface Tx { id: string; type: string; direction: string; amount: number; balanceAfter: number; note: string | null; createdAt: string }

export function UserDetailPage() {
  const { id } = useParams();
  const { has } = useStaff();
  const toast = useToast();
  const user = useAdmin<UserDetail>(`/admin/users/${id}`);
  const [page, setPage] = useState(1);
  const txs = useAdmin<{ items: Tx[]; total: number; pageSize: number }>(`/admin/users/${id}/transactions`, { page });
  const [adjust, setAdjust] = useState<'CREDIT' | 'DEBIT' | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const u = user.data;

  const submitAdjust = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminApi.post(`/admin/users/${id}/wallet-adjust`, { direction: adjust, amount: Number(amount), reason, requestId });
      toast('Wallet updated', 'success');
      setAdjust(null);
      void user.reload();
      void txs.reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const setPin = async () => {
    const pin = window.prompt('New PIN for this player (4 to 6 digits). Tell the player and ask them to change it.');
    if (!pin) return;
    try {
      await adminApi.post(`/admin/users/${id}/set-pin`, { pin });
      toast('PIN updated. The player has been signed out.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const setStatus = async (status: 'ACTIVE' | 'BLOCKED') => {
    const why = status === 'BLOCKED' ? window.prompt('Reason for blocking this player?') : '';
    if (why === null) return;
    try {
      await adminApi.post(`/admin/users/${id}/status`, { status, reason: why });
      toast(status === 'BLOCKED' ? 'Player blocked' : 'Player unblocked', 'success');
      void user.reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div>
      <Link to="/admin/users" className="mb-3 inline-block text-sm font-bold text-muted">← Users</Link>
      <State error={user.error} loading={user.loading && !u} reload={user.reload}>
        {u && (
          <>
            <Title action={(
              <div className="flex flex-wrap gap-2">
                {has('wallet', 'update') && <><button className="btn-primary !py-2" onClick={() => { setAdjust('CREDIT'); setAmount(''); setReason(''); setRequestId(crypto.randomUUID()); }}>Credit points</button>
                <button className="btn-ghost !py-2" onClick={() => { setAdjust('DEBIT'); setAmount(''); setReason(''); setRequestId(crypto.randomUUID()); }}>Debit points</button></>}
                {has('users', 'manage') && <button className="btn-ghost !py-2" onClick={setPin}>Set new PIN</button>}
                {has('users', 'update') && (u.status === 'ACTIVE' ? <button className="btn-danger !py-2" onClick={() => setStatus('BLOCKED')}>Block</button> : <button className="btn-ghost !py-2" onClick={() => setStatus('ACTIVE')}>Unblock</button>)}
              </div>
            )}>{u.name} <Badge tone={statusTone(u.status)}>{u.status}</Badge></Title>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[['Balance', u.wallet?.balance], ['Locked in games', u.wallet?.locked], ['Total earned', u.wallet?.totalEarned], ['Total spent', u.wallet?.totalSpent]].map(([l, v]) => (
                <div key={l as string} className="card p-4"><p className="text-[11px] font-bold uppercase tracking-wider text-muted">{l}</p><p className="mt-1 text-2xl font-extrabold">{pts((v as number) ?? 0)}</p></div>
              ))}
            </div>
            <div className="card mt-3 grid gap-2 p-4 text-sm sm:grid-cols-2">
              <p><span className="text-muted">Mobile:</span> {u.mobile}</p><p><span className="text-muted">Referral code:</span> {u.referralCode}</p>
              <p><span className="text-muted">Joined:</span> {dateTime(u.createdAt)}</p><p><span className="text-muted">Last login:</span> {u.lastLoginAt ? dateTime(u.lastLoginAt) : '—'}</p>
              <p><span className="text-muted">Matches / wins:</span> {u.stats.matches} / {u.stats.wins}</p><p><span className="text-muted">Referred by:</span> {u.referredBy ?? '—'}</p>
            </div>
          </>
        )}
      </State>

      <h2 className="mb-2 mt-6 text-lg font-extrabold">Wallet history</h2>
      <State error={txs.error} loading={txs.loading && !txs.data} reload={txs.reload} empty={txs.data?.items.length === 0}>
        <Table head={['When', 'Type', 'Amount', 'Balance after', 'Note']}>
          {txs.data?.items.map((t) => (
            <tr key={t.id}><td className="text-muted">{dateTime(t.createdAt)}</td><td>{TX_LABEL[t.type] ?? t.type}</td>
              <td className={t.type === 'GAME_LOSS' ? 'text-muted' : t.direction === 'CREDIT' ? 'font-bold text-emerald-500' : 'font-bold text-red-500'}>{t.type === 'GAME_LOSS' ? `(${pts(t.amount)} from escrow)` : `${t.direction === 'CREDIT' ? '+' : '-'}${pts(t.amount)}`}</td>
              <td>{pts(t.balanceAfter)}</td><td className="text-muted">{t.note ?? ''}</td></tr>
          ))}
        </Table>
        {txs.data && <Pager page={page} total={txs.data.total} pageSize={txs.data.pageSize} onPage={setPage} />}
      </State>

      <Sheet open={adjust !== null} onClose={() => setAdjust(null)} title={adjust === 'CREDIT' ? 'Credit points' : 'Debit points'}>
        <form onSubmit={submitAdjust} className="space-y-3">
          <div><label className="label" htmlFor="amt">Amount</label><input id="amt" className="input" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
          <div><label className="label" htmlFor="why">Reason (recorded in the audit log)</label><input id="why" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <button className={adjust === 'CREDIT' ? 'btn-primary w-full' : 'btn-danger w-full'} disabled={busy || !(Number(amount) >= 1) || reason.trim().length < 3}>{busy ? <Spinner /> : `${adjust === 'CREDIT' ? 'Credit' : 'Debit'} ${amount ? pts(Number(amount)) : ''} points`}</button>
        </form>
      </Sheet>
    </div>
  );
}

// ── games & rooms ─────────────────────────────────────────────────

interface GameRow { id: string; status: string; mode: string; roomCode: string | null; isTournament: boolean; entryPoints: number; pool: number; commissionAmount: number; startedAt: string; cancelReason: string | null; players: { name: string; mobile: string; color: string; status: string }[] }

export function GamesPage() {
  const { has } = useStaff();
  const toast = useToast();
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'FINISHED' | 'CANCELLED'>('ACTIVE');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAdmin<{ items: GameRow[]; total: number; pageSize: number }>('/admin/games', { page, ...(status ? { status } : {}) });

  const cancel = async (g: GameRow) => {
    const reason = window.prompt('Cancel this game and refund every player?\nReason (shown to the players):');
    if (!reason) return;
    try {
      const { data: r } = await adminApi.post(`/admin/games/${g.id}/cancel`, { reason });
      toast(`Game cancelled, ${r.refunded} players refunded`, 'success');
      void reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div>
      <Title action={<div className="flex gap-2"><DownloadButton name="games" module="games" /><button className="btn-ghost !py-2" onClick={reload}>Refresh</button></div>}>Games</Title>
      <Tabs value={status} options={[['ACTIVE', 'Live'], ['FINISHED', 'Completed'], ['CANCELLED', 'Cancelled'], ['', 'All']]} onChange={(v) => { setStatus(v); setPage(1); }} />
      <State error={error} loading={loading && !data} reload={reload} empty={data?.items.length === 0}>
        <Table head={['Started', 'Mode', 'Room', 'Players', 'Entry', 'Pool', 'Status', '']}>
          {data?.items.map((g) => (
            <tr key={g.id}>
              <td className="text-muted">{dateTime(g.startedAt)}</td><td>{g.mode}</td><td>{g.isTournament ? 'Tournament' : g.roomCode ?? '—'}</td>
              <td>{g.players.map((p) => <span key={p.mobile} className="mr-2 inline-block">{p.name} <span className="text-muted">({p.color}{p.status === 'LEFT' ? ', left' : ''})</span></span>)}</td>
              <td>{pts(g.entryPoints)}</td><td>{pts(g.pool)}{g.commissionAmount > 0 && <span className="text-muted"> (−{g.commissionAmount})</span>}</td>
              <td><Badge tone={statusTone(g.status)}>{g.status}</Badge>{g.cancelReason && <span className="block text-xs text-muted">{g.cancelReason}</span>}</td>
              <td>{g.status === 'ACTIVE' && has('games', 'manage') && !g.isTournament && <button className="font-bold text-red-500" onClick={() => cancel(g)}>Cancel & refund</button>}</td>
            </tr>
          ))}
        </Table>
        {data && <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
      </State>
    </div>
  );
}

interface RoomRow { id: string; code: string; name: string; mode: string; host: string; visibility: string; isMatchmaking: boolean; status: string; entryPoints: number; maxPlayers: number; players: number; createdAt: string; firstTurnUserId: string | null; firstTurnSetBy: string | null; seats: { userId: string; name: string }[] }

export function RoomsPage() {
  const { has } = useStaff();
  const toast = useToast();
  const [filter, setFilter] = useState<'WAITING' | 'IN_GAME' | 'COMPLETED' | 'PUBLIC' | 'PRIVATE'>('WAITING');
  const [page, setPage] = useState(1);
  const params = filter === 'PUBLIC' || filter === 'PRIVATE' ? { visibility: filter } : { status: filter };
  const { data, error, loading, reload } = useAdmin<{ items: RoomRow[]; total: number; pageSize: number }>('/admin/rooms', { page, ...params });
  const manage = has('rooms', 'manage');

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast(done, 'success');
      void reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };
  const close = (r: RoomRow) => {
    const reason = window.prompt(`Close room ${r.code}? Reason (shown to the players):`);
    if (reason) void act(() => adminApi.post(`/admin/rooms/${r.id}/close`, { reason }), 'Room closed');
  };

  return (
    <div>
      <Title action={<button className="btn-ghost !py-2" onClick={reload}>Refresh</button>}>Rooms</Title>
      <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">For a waiting private or public room you can choose which player takes the first turn. Players see that choice, and that staff made it, in their lobby before the game starts. Matchmaking and prize-pool tables always draw the first turn at random. Dice are always rolled at random by the server and cannot be set.</p>
      <Tabs value={filter} options={[['WAITING', 'Waiting'], ['IN_GAME', 'Active'], ['COMPLETED', 'Completed'], ['PUBLIC', 'Public'], ['PRIVATE', 'Private']]} onChange={(v) => { setFilter(v); setPage(1); }} />
      <State error={error} loading={loading && !data} reload={reload} empty={data?.items.length === 0}>
        <Table head={['Created', 'Code', 'Name', 'Mode', 'Host', 'Type', 'Players', 'Entry', 'First turn', 'Status', '']}>
          {data?.items.map((r) => {
            const editable = manage && r.status === 'WAITING' && !r.isMatchmaking;
            return (
              <tr key={r.id}><td className="text-muted">{dateTime(r.createdAt)}</td><td className="font-mono font-bold">{r.code}</td><td>{r.name}</td><td>{r.mode}</td><td>{r.host}</td>
                <td>{r.isMatchmaking ? 'Matchmaking' : r.visibility.toLowerCase()}</td><td>{r.players}/{r.maxPlayers}</td><td>{pts(r.entryPoints)}</td>
                <td>
                  {editable ? (
                    <select className="input !w-40 !py-1.5" value={r.firstTurnUserId ?? ''} aria-label={`First turn for room ${r.code}`}
                      onChange={(e) => act(() => adminApi.patch(`/admin/rooms/${r.id}`, { firstTurnUserId: e.target.value || null }), 'First turn updated. The players can see it in their lobby.')}>
                      <option value="">Random</option>
                      {r.seats.map((seat) => <option key={seat.userId} value={seat.userId}>{seat.name}</option>)}
                    </select>
                  ) : (
                    <span className="text-muted">{r.firstTurnUserId ? `${r.seats.find((x) => x.userId === r.firstTurnUserId)?.name ?? 'Player'} (${r.firstTurnSetBy === 'ADMIN' ? 'staff' : 'host'})` : 'Random'}</span>
                  )}
                </td>
                <td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                <td>{manage && r.status === 'WAITING' && <button className="font-bold text-red-500" onClick={() => close(r)}>Close</button>}</td></tr>
            );
          })}
        </Table>
        {data && <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
      </State>
    </div>
  );
}

// ── tournaments ───────────────────────────────────────────────────

interface TRow { id: string; name: string; mode: { key: string; name: string }; entryPoints: number; capacity: number; registered: number; prizePool: number; status: string; startsAt: string }

export function TournamentsAdminPage() {
  const { has } = useStaff();
  const toast = useToast();
  const { data, error, loading, reload } = useAdmin<{ items: TRow[] }>('/admin/tournaments');
  const modes = useAdmin<{ items: { key: string; name: string; isActive: boolean; allowedPlayers: number[] }[] }>('/admin/modes');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', modeKey: 'CLASSIC', entryPoints: '10', capacity: '8', bonusPool: '0', startsAt: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminApi.post('/admin/tournaments', { name: form.name, description: form.description, modeKey: form.modeKey, entryPoints: Number(form.entryPoints), capacity: Number(form.capacity), bonusPool: Number(form.bonusPool), startsAt: new Date(form.startsAt).toISOString() });
      toast('Tournament created', 'success');
      setOpen(false);
      void reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const act = async (t: TRow, action: 'start' | 'cancel') => {
    if (!window.confirm(action === 'start' ? `Start "${t.name}" now with ${t.registered} players?` : `Cancel "${t.name}" and refund all ${t.registered} entries?`)) return;
    try {
      const { data: r } = await adminApi.post(`/admin/tournaments/${t.id}/${action}`, {});
      toast(action === 'start' ? `Result: ${r.result}` : 'Tournament cancelled and refunded', 'success');
      void reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div>
      <Title action={has('tournaments', 'create') && <button className="btn-primary !py-2" onClick={() => setOpen(true)}>New tournament</button>}>Tournaments</Title>
      <State error={error} loading={loading && !data} reload={reload} empty={data?.items.length === 0}>
        <Table head={['Name', 'Mode', 'Starts', 'Players', 'Entry', 'Prize pool', 'Status', '']}>
          {data?.items.map((t) => (
            <tr key={t.id}><td className="font-bold">{t.name}</td><td>{t.mode.name}</td><td className="text-muted">{dateTime(t.startsAt)}</td><td>{t.registered}/{t.capacity}</td><td>{pts(t.entryPoints)}</td><td>{pts(t.prizePool)}</td>
              <td><Badge tone={statusTone(t.status)}>{t.status}</Badge></td>
              <td className="space-x-3 whitespace-nowrap">{t.status === 'UPCOMING' && has('tournaments', 'manage') && <><button className="font-bold text-brand" onClick={() => act(t, 'start')}>Start now</button><button className="font-bold text-red-500" onClick={() => act(t, 'cancel')}>Cancel</button></>}</td></tr>
          ))}
        </Table>
      </State>
      <Sheet open={open} onClose={() => setOpen(false)} title="New tournament">
        <form onSubmit={create} className="space-y-3">
          <div><label className="label" htmlFor="t-name">Name</label><input id="t-name" className="input" maxLength={60} value={form.name} onChange={set('name')} /></div>
          <div><label className="label" htmlFor="t-desc">Description</label><input id="t-desc" className="input" maxLength={400} value={form.description} onChange={set('description')} /></div>
          <div><label className="label" htmlFor="t-mode">Game mode</label>
            <select id="t-mode" className="input" value={form.modeKey} onChange={set('modeKey')}>{modes.data?.items.filter((m) => m.isActive && m.allowedPlayers.includes(2)).map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select></div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="label" htmlFor="t-entry">Entry</label><input id="t-entry" className="input" type="number" min={0} value={form.entryPoints} onChange={set('entryPoints')} /></div>
            <div><label className="label" htmlFor="t-cap">Capacity</label><select id="t-cap" className="input" value={form.capacity} onChange={set('capacity')}>{[2, 4, 8, 16, 32, 64].map((n) => <option key={n}>{n}</option>)}</select></div>
            <div><label className="label" htmlFor="t-bonus">Bonus pool</label><input id="t-bonus" className="input" type="number" min={0} value={form.bonusPool} onChange={set('bonusPool')} /></div>
          </div>
          <div><label className="label" htmlFor="t-start">Starts at</label><input id="t-start" className="input" type="datetime-local" value={form.startsAt} onChange={set('startsAt')} /></div>
          <p className="text-xs text-muted">Single-elimination, two-player matches. Prizes use the default split from Configuration.</p>
          <button className="btn-primary w-full" disabled={busy || form.name.trim().length < 3 || !form.startsAt}>{busy ? <Spinner /> : 'Create tournament'}</button>
        </form>
      </Sheet>
    </div>
  );
}

// ── configuration ─────────────────────────────────────────────────

interface Setting { key: string; value: unknown; default: unknown; description: string }

export function SettingsPage() {
  const { has } = useStaff();
  const toast = useToast();
  const { data, error, loading, reload } = useAdmin<{ items: Setting[] }>('/admin/settings');
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const editable = has('settings', 'manage');

  const save = async () => {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) {
      const original = data!.items.find((i) => i.key === k)!.value;
      body[k] = typeof original === 'boolean' ? v : Array.isArray(original) ? String(v).split(',').map((s) => Number(s.trim())) : Number(v);
    }
    setBusy(true);
    try {
      await adminApi.put('/admin/settings', body);
      toast('Configuration saved', 'success');
      setDraft({});
      void reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Title action={editable && <button className="btn-primary !py-2" disabled={busy || Object.keys(draft).length === 0} onClick={save}>{busy ? <Spinner /> : 'Save changes'}</button>}>Configuration</Title>
      {!editable && <p className="mb-3 text-sm text-muted">Your account can view configuration but not change it.</p>}
      <State error={error} loading={loading && !data} reload={reload}>
        <div className="card divide-y divide-line">
          {data?.items.map((s) => {
            const current = s.key in draft ? draft[s.key] : Array.isArray(s.value) ? (s.value as number[]).join(', ') : (s.value as string | boolean);
            return (
              <div key={s.key} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1"><p className="font-mono text-sm font-bold">{s.key}</p><p className="text-xs text-muted">{s.description} (default: {Array.isArray(s.default) ? (s.default as number[]).join(', ') : String(s.default)})</p></div>
                {typeof s.value === 'boolean'
                  ? <select className="input !w-32" disabled={!editable} value={String(current)} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value === 'true' })} aria-label={s.key}><option value="true">Enabled</option><option value="false">Disabled</option></select>
                  : <input className="input !w-32" disabled={!editable} value={String(current)} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} aria-label={s.key} />}
              </div>
            );
          })}
        </div>
      </State>
    </div>
  );
}

interface Mode { id: number; key: string; name: string; tagline: string; isActive: boolean; minEntry: number; maxEntry: number; allowedPlayers: number[]; rules: Record<string, unknown>; effectiveRules: Record<string, unknown> }

export function ModesPage() {
  const { has } = useStaff();
  const toast = useToast();
  const { data, error, loading, reload } = useAdmin<{ items: Mode[] }>('/admin/modes');
  const [edit, setEdit] = useState<Mode | null>(null);
  const [form, setForm] = useState({ name: '', tagline: '', minEntry: '', maxEntry: '', rules: '' });
  const [busy, setBusy] = useState(false);
  const editable = has('modes', 'update');

  const patch = async (id: number, body: object) => {
    setBusy(true);
    try {
      await adminApi.patch(`/admin/modes/${id}`, body);
      toast('Game mode updated', 'success');
      setEdit(null);
      void reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    let rules: unknown;
    try {
      rules = JSON.parse(form.rules || '{}');
    } catch {
      return toast('Rule overrides must be valid JSON', 'error');
    }
    void patch(edit!.id, { name: form.name, tagline: form.tagline, minEntry: Number(form.minEntry), maxEntry: Number(form.maxEntry), rules });
  };

  return (
    <div>
      <Title>Game modes</Title>
      <State error={error} loading={loading && !data} reload={reload}>
        <div className="grid gap-3 lg:grid-cols-2">
          {data?.items.map((m) => (
            <div key={m.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-extrabold">{m.name} <span className="font-mono text-xs text-muted">{m.key}</span></p><p className="text-xs text-muted">{m.tagline}</p></div>
                <Badge tone={m.isActive ? 'ok' : 'bad'}>{m.isActive ? 'Active' : 'Disabled'}</Badge>
              </div>
              <p className="mt-3 text-sm">Entry {pts(m.minEntry)}–{pts(m.maxEntry)} · {m.allowedPlayers.join(' or ')} players</p>
              <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                {Object.entries(m.effectiveRules).map(([k, v]) => <span key={k} className={`rounded-md px-1.5 py-0.5 font-mono ${k in m.rules ? 'bg-accent/20 text-accent' : 'bg-surface-2 text-muted'}`}>{k}: {String(v)}</span>)}
              </div>
              {editable && (
                <div className="mt-3 flex gap-3 text-sm font-bold">
                  <button className="text-brand" onClick={() => { setEdit(m); setForm({ name: m.name, tagline: m.tagline, minEntry: String(m.minEntry), maxEntry: String(m.maxEntry), rules: JSON.stringify(m.rules, null, 2) }); }}>Edit</button>
                  <button className={m.isActive ? 'text-red-500' : 'text-emerald-500'} disabled={busy} onClick={() => patch(m.id, { isActive: !m.isActive })}>{m.isActive ? 'Disable' : 'Enable'}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </State>
      <Sheet open={edit !== null} onClose={() => setEdit(null)} title={`Edit ${edit?.name ?? ''}`}>
        <form onSubmit={submit} className="space-y-3">
          <div><label className="label" htmlFor="m-name">Name</label><input id="m-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label" htmlFor="m-tag">Tagline</label><input id="m-tag" className="input" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label" htmlFor="m-min">Min entry</label><input id="m-min" className="input" type="number" value={form.minEntry} onChange={(e) => setForm({ ...form, minEntry: e.target.value })} /></div>
            <div><label className="label" htmlFor="m-max">Max entry</label><input id="m-max" className="input" type="number" value={form.maxEntry} onChange={(e) => setForm({ ...form, maxEntry: e.target.value })} /></div>
          </div>
          <div><label className="label" htmlFor="m-rules">Rule overrides (JSON)</label><textarea id="m-rules" className="input h-36 font-mono text-xs" value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} /><p className="mt-1 text-xs text-muted">Only list rules you want to change from the preset, e.g. {'{ "turnLimit": 20 }'}. Applies to games started afterwards.</p></div>
          <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : 'Save'}</button>
        </form>
      </Sheet>
    </div>
  );
}

// ── audit & staff ─────────────────────────────────────────────────

interface Log { id: string; admin: string; action: string; targetType: string | null; targetId: string | null; details: unknown; ip: string | null; createdAt: string }

export function AuditPage() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAdmin<{ items: Log[]; total: number; pageSize: number }>('/admin/audit-logs', { page });
  return (
    <div>
      <Title action={<DownloadButton name="audit" module="audit" />}>Audit log</Title>
      <State error={error} loading={loading && !data} reload={reload} empty={data?.items.length === 0}>
        <Table head={['When', 'Staff', 'Action', 'Target', 'Details', 'IP']}>
          {data?.items.map((l) => (
            <tr key={l.id}><td className="whitespace-nowrap text-muted">{dateTime(l.createdAt)}</td><td className="font-bold">{l.admin}</td><td><Badge>{l.action}</Badge></td>
              <td className="font-mono text-xs">{l.targetType}{l.targetId ? `:${l.targetId.slice(-8)}` : ''}</td><td className="max-w-xs truncate font-mono text-xs text-muted" title={JSON.stringify(l.details)}>{JSON.stringify(l.details)}</td><td className="text-muted">{l.ip}</td></tr>
          ))}
        </Table>
        {data && <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
      </State>
    </div>
  );
}

