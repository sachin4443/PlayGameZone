import { useEffect, useState, type FormEvent } from 'react';
import { Sheet, Spinner } from '../components/ui';
import { adminApi, errorMessage } from '../lib/api';
import { dateTime, pts } from '../lib/format';
import { useToast } from '../state/toast';
import { useStaff } from './AdminApp';
import { Badge, Pager, State, Table, Tabs, Title, statusTone, useAdmin } from './pages';

// ── account requests ──────────────────────────────────────────────

interface Req { id: string; userId: string; name: string; mobile: string | null; type: 'MOBILE_CHANGE' | 'ACCOUNT_DELETE'; newMobile: string | null; reason: string; status: string; adminRemark: string | null; createdAt: string }

export function AccountRequestsPage() {
  const { has, refreshBadges } = useStaff();
  const toast = useToast();
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAdmin<{ items: Req[]; total: number; pageSize: number }>('/admin/account-requests', { page, ...(status ? { status } : {}), ...(query ? { search: query } : {}) });

  // Keep the list current while it is open.
  useEffect(() => {
    const t = setInterval(() => void reload(), 15000);
    return () => clearInterval(t);
  }, [reload]);

  const decide = async (r: Req, action: 'approve' | 'reject') => {
    const remark = action === 'reject'
      ? window.prompt('Reason for rejecting (the player will see this):')
      : window.confirm(r.type === 'ACCOUNT_DELETE' ? `Permanently close ${r.name}'s account (${r.mobile})? Their points are lost.` : `Change ${r.name}'s number from ${r.mobile} to ${r.newMobile}?`) ? '' : null;
    if (remark === null || (action === 'reject' && !remark.trim())) return;
    try {
      await adminApi.post(`/admin/account-requests/${r.id}/${action}`, { remark });
      toast(action === 'approve' ? 'Request approved' : 'Request rejected', 'success');
      void reload();
      refreshBadges();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div>
      <Title>Account requests</Title>
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); setPage(1); }}>
        <input className="input" placeholder="Search by mobile number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search requests" />
        <button className="btn-primary">Search</button>
      </form>
      <Tabs value={status} options={[['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['', 'All']]} onChange={(v) => { setStatus(v); setPage(1); }} />
      <State error={error} loading={loading && !data} reload={reload} empty={data?.items.length === 0}>
        <Table head={['Received', 'Player', 'Request', 'Reason', 'Status', '']}>
          {data?.items.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-muted">{dateTime(r.createdAt)}</td>
              <td><span className="font-bold">{r.name}</span><span className="block text-xs text-muted">{r.mobile ?? 'account closed'}</span></td>
              <td>{r.type === 'MOBILE_CHANGE' ? <>Change number to <b>{r.newMobile}</b></> : <span className="font-bold text-red-500">Delete account</span>}</td>
              <td className="max-w-xs text-muted">{r.reason}</td>
              <td><Badge tone={r.status === 'PENDING' ? 'warn' : r.status === 'APPROVED' ? 'ok' : 'bad'}>{r.status}</Badge>{r.adminRemark && <span className="block text-xs text-muted">{r.adminRemark}</span>}</td>
              <td className="space-x-3 whitespace-nowrap">
                {r.status === 'PENDING' && has('accountRequests', 'approve') && <button className="font-bold text-emerald-500" onClick={() => decide(r, 'approve')}>Approve</button>}
                {r.status === 'PENDING' && has('accountRequests', 'reject') && <button className="font-bold text-red-500" onClick={() => decide(r, 'reject')}>Reject</button>}
              </td>
            </tr>
          ))}
        </Table>
        {data && <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
      </State>
    </div>
  );
}

// ── prize pools ───────────────────────────────────────────────────

interface PoolRow { id: string; name: string; mode: { key: string; name: string }; players: number; entryPoints: number; prizePoints: number; isActive: boolean; sortOrder: number; gamesPlayed: number }
const EMPTY_POOL = { name: '', modeKey: 'CLASSIC', players: '2', entryPoints: '25', prizePoints: '47', sortOrder: '0', isActive: true };

export function PrizePoolsPage() {
  const { has } = useStaff();
  const toast = useToast();
  const { data, error, loading, reload } = useAdmin<{ items: PoolRow[] }>('/admin/prize-pools');
  const modes = useAdmin<{ items: { key: string; name: string; allowedPlayers: number[] }[] }>(has('modes', 'read') ? '/admin/modes' : null);
  const [edit, setEdit] = useState<PoolRow | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY_POOL);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof EMPTY_POOL) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const total = Number(form.entryPoints) * Number(form.players);

  const open = (p: PoolRow | 'new') => {
    setEdit(p);
    setForm(p === 'new' ? EMPTY_POOL : { name: p.name, modeKey: p.mode.key, players: String(p.players), entryPoints: String(p.entryPoints), prizePoints: String(p.prizePoints), sortOrder: String(p.sortOrder), isActive: p.isActive });
  };
  const body = (f: typeof EMPTY_POOL) => ({ name: f.name.trim(), modeKey: f.modeKey, players: Number(f.players), entryPoints: Number(f.entryPoints), prizePoints: Number(f.prizePoints), sortOrder: Number(f.sortOrder), isActive: f.isActive });

  const call = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done, 'success');
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
    void call(() => (edit === 'new' ? adminApi.post('/admin/prize-pools', body(form)) : adminApi.put(`/admin/prize-pools/${(edit as PoolRow).id}`, body(form))), 'Prize pool saved');
  };
  const toggle = (p: PoolRow) => call(() => adminApi.put(`/admin/prize-pools/${p.id}`, { name: p.name, modeKey: p.mode.key, players: p.players, entryPoints: p.entryPoints, prizePoints: p.prizePoints, sortOrder: p.sortOrder, isActive: !p.isActive }), p.isActive ? 'Prize pool disabled' : 'Prize pool enabled');
  const remove = (p: PoolRow) => window.confirm(`Delete "${p.name}"? Pools that have been played are disabled instead, to keep their history.`) && call(() => adminApi.delete(`/admin/prize-pools/${p.id}`), 'Prize pool removed');

  return (
    <div>
      <Title action={has('prizePools', 'create') && <button className="btn-primary !py-2" onClick={() => open('new')}>New prize pool</button>}>Prize pools</Title>
      <State error={error} loading={loading && !data} reload={reload} empty={data?.items.length === 0}>
        <Table head={['Name', 'Game', 'Players', 'Entry', 'Prize', 'Kept by platform', 'Games', 'Status', '']}>
          {data?.items.map((p) => (
            <tr key={p.id}>
              <td className="font-bold">{p.name}</td><td>{p.mode.name}</td><td>{p.players}</td><td>{pts(p.entryPoints)}</td><td className="font-bold">{pts(p.prizePoints)}</td>
              <td className="text-muted">{pts(p.entryPoints * p.players - p.prizePoints)}</td><td>{p.gamesPlayed}</td><td><Badge tone={p.isActive ? 'ok' : 'bad'}>{p.isActive ? 'Enabled' : 'Disabled'}</Badge></td>
              <td className="space-x-3 whitespace-nowrap">
                {has('prizePools', 'update') && <><button className="font-bold text-brand" onClick={() => open(p)}>Edit</button><button className="font-bold text-muted" disabled={busy} onClick={() => toggle(p)}>{p.isActive ? 'Disable' : 'Enable'}</button></>}
                {has('prizePools', 'delete') && <button className="font-bold text-red-500" onClick={() => remove(p)}>Delete</button>}
              </td>
            </tr>
          ))}
        </Table>
      </State>
      <Sheet open={edit !== null} onClose={() => setEdit(null)} title={edit === 'new' ? 'New prize pool' : 'Edit prize pool'}>
        <form onSubmit={submit} className="space-y-3">
          <div><label className="label" htmlFor="pp-name">Name</label><input id="pp-name" className="input" maxLength={40} value={form.name} onChange={set('name')} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label" htmlFor="pp-mode">Game</label>
              <select id="pp-mode" className="input" value={form.modeKey} onChange={set('modeKey')}>{(modes.data?.items ?? [{ key: form.modeKey, name: form.modeKey, allowedPlayers: [2, 4] }]).map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select></div>
            <div><label className="label" htmlFor="pp-players">Players</label><select id="pp-players" className="input" value={form.players} onChange={set('players')}>{[2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></div>
            <div><label className="label" htmlFor="pp-entry">Entry points</label><input id="pp-entry" className="input" type="number" min={1} value={form.entryPoints} onChange={set('entryPoints')} /></div>
            <div><label className="label" htmlFor="pp-prize">Prize points</label><input id="pp-prize" className="input" type="number" min={1} value={form.prizePoints} onChange={set('prizePoints')} /></div>
          </div>
          <p className={`text-xs ${Number(form.prizePoints) > total ? 'text-red-500' : 'text-muted'}`}>Total entries: {pts(total || 0)}. The prize cannot be more than that; the difference ({pts(Math.max(0, total - Number(form.prizePoints)) || 0)}) stays with the platform.</p>
          <div><label className="label" htmlFor="pp-sort">Display order</label><input id="pp-sort" className="input" type="number" min={0} value={form.sortOrder} onChange={set('sortOrder')} /></div>
          <button className="btn-primary w-full" disabled={busy || form.name.trim().length < 3 || Number(form.prizePoints) > total || Number(form.prizePoints) < 1}>{busy ? <Spinner /> : 'Save'}</button>
        </form>
      </Sheet>
    </div>
  );
}

// ── staff & permissions ───────────────────────────────────────────

interface StaffRow { id: string; username: string; status: string; role: string; permsCustomized: boolean; mustChangePassword: boolean; lastLoginAt: string | null }
interface StaffDetail { id: string; username: string; role: string; permissions: Record<string, string[]>; defaults: Record<string, string[]> }
interface Log { id: string; action: string; targetType: string | null; targetId: string | null; details: unknown; createdAt: string }

const ROLE_LABEL: Record<string, string> = { ROOT_OWNER: 'Root owner', SUPER_ADMIN: 'Super admin', ADMIN: 'Admin', SUPPORT: 'Staff' };

export function StaffPage() {
  const { staff, has } = useStaff();
  const toast = useToast();
  const { data, error, loading, reload } = useAdmin<{ items: StaffRow[]; modules: Record<string, string>; actions: string[] }>('/admin/staff');
  const [form, setForm] = useState({ username: '', password: '', role: 'SUPPORT' });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<StaffDetail | null>(null);
  const [matrix, setMatrix] = useState<Record<string, string[]>>({});
  const [activity, setActivity] = useState<{ username: string; items: Log[] } | null>(null);

  const isRoot = staff.role === 'ROOT_OWNER';
  const topRole = isRoot || staff.role === 'SUPER_ADMIN';
  /** Mirrors the server's hierarchy rules, so buttons that would be refused are not shown. */
  const manageable = (s: StaffRow) => s.id !== staff.id && s.role !== 'ROOT_OWNER' && (s.role !== 'SUPER_ADMIN' || isRoot);

  const call = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done, 'success');
      void reload();
      return true;
    } catch (err) {
      toast(errorMessage(err), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (await call(() => adminApi.post('/admin/staff', form), 'Staff account created. They must change the password at first sign-in.')) setForm({ username: '', password: '', role: 'SUPPORT' });
  };
  const openPermissions = async (s: StaffRow) => {
    try {
      const { data: d } = await adminApi.get<StaffDetail>(`/admin/staff/${s.id}`);
      setEditing(d);
      setMatrix(d.permissions);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };
  const toggle = (module: string, action: string) => {
    const cur = new Set(matrix[module] ?? []);
    if (cur.has(action)) {
      cur.delete(action);
      if (action === 'view') cur.clear(); // hiding the menu removes everything under it
    } else {
      cur.add(action);
      cur.add('view');
    }
    setMatrix({ ...matrix, [module]: [...cur] });
  };
  const savePermissions = async () => {
    if (await call(() => adminApi.put(`/admin/staff/${editing!.id}/permissions`, matrix), 'Permissions saved')) setEditing(null);
  };
  const resetPassword = (s: StaffRow) => {
    const password = window.prompt(`Temporary password for ${s.username} (10+ characters, letters and numbers). They must change it at next sign-in.`);
    if (password) void call(() => adminApi.post(`/admin/staff/${s.id}/reset-password`, { password }), 'Password reset');
  };
  const showActivity = async (s: StaffRow) => {
    try {
      const { data: d } = await adminApi.get<{ items: Log[] }>('/admin/audit-logs', { params: { adminId: s.id, pageSize: 50 } });
      setActivity({ username: s.username, items: d.items });
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div>
      <Title>Staff & permissions</Title>
      <State error={error} loading={loading && !data} reload={reload}>
        <Table head={['Username', 'Role', 'Access', 'Status', 'Last sign-in', '']}>
          {data?.items.map((s) => (
            <tr key={s.id}>
              <td className="font-bold">{s.username}{s.id === staff.id && <span className="ml-1 text-xs font-medium text-muted">(you)</span>}</td>
              <td><Badge tone={s.role === 'ROOT_OWNER' ? 'warn' : 'muted'}>{ROLE_LABEL[s.role] ?? s.role}</Badge></td>
              <td className="text-muted">{s.role === 'ROOT_OWNER' || s.role === 'SUPER_ADMIN' ? 'Full access' : s.permsCustomized ? 'Custom' : 'Role defaults'}</td>
              <td><Badge tone={statusTone(s.status)}>{s.status === 'ACTIVE' ? 'Active' : 'Disabled'}</Badge>{s.mustChangePassword && <span className="block text-xs text-muted">temporary password</span>}</td>
              <td className="text-muted">{s.lastLoginAt ? dateTime(s.lastLoginAt) : 'never'}</td>
              <td className="space-x-3 whitespace-nowrap text-sm font-bold">
                {has('audit', 'read') && <button className="text-muted" onClick={() => showActivity(s)}>Activity</button>}
                {manageable(s) && (
                  <>
                    {topRole && has('staff', 'manage') && s.role !== 'SUPER_ADMIN' && <button className="text-brand" onClick={() => openPermissions(s)}>Permissions</button>}
                    {has('staff', 'manage') && <button className="text-brand" onClick={() => resetPassword(s)}>Reset password</button>}
                    {has('staff', 'update') && <button className="text-muted" disabled={busy} onClick={() => call(() => adminApi.patch(`/admin/staff/${s.id}`, { status: s.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE' }), s.status === 'ACTIVE' ? 'Account disabled' : 'Account reactivated')}>{s.status === 'ACTIVE' ? 'Disable' : 'Reactivate'}</button>}
                    {has('staff', 'delete') && <button className="text-red-500" onClick={() => window.confirm(`Delete ${s.username}? Their activity history is kept.`) && call(() => adminApi.delete(`/admin/staff/${s.id}`), 'Staff account deleted')}>Delete</button>}
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </State>

      {has('staff', 'create') && topRole && (
        <>
          <h2 className="mb-2 mt-6 text-lg font-extrabold">Add staff account</h2>
          <form onSubmit={create} className="card grid gap-3 p-4 sm:grid-cols-4">
            <input className="input" placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} aria-label="Username" autoComplete="off" />
            <input className="input" type="password" placeholder="Temporary password (10+)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} aria-label="Temporary password" autoComplete="new-password" />
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="Role">
              <option value="SUPPORT">Staff (read only by default)</option><option value="ADMIN">Admin</option>{isRoot && <option value="SUPER_ADMIN">Super admin (full access)</option>}
            </select>
            <button className="btn-primary" disabled={busy || form.username.length < 3 || form.password.length < 10}>{busy ? <Spinner /> : 'Create'}</button>
          </form>
          <p className="mt-2 text-xs text-muted">New accounts start with their role's default access. Open Permissions to choose exactly which menus and actions each person gets.</p>
        </>
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={`Permissions · ${editing?.username ?? ''}`}>
        {editing && data && (
          <div>
            <p className="mb-3 text-xs text-muted">Tick what this account may do in each menu. Without "view" the menu is hidden and its pages and APIs are blocked.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr><th className="py-1 text-left">Menu</th>{data.actions.map((a) => <th key={a} className="px-1 capitalize" style={{ writingMode: 'vertical-rl' }}>{a}</th>)}</tr></thead>
                <tbody>
                  {Object.entries(data.modules).map(([key, label]) => (
                    <tr key={key} className="border-t border-line">
                      <td className="py-1.5 pr-2 font-bold">{label}</td>
                      {data.actions.map((a) => (
                        <td key={a} className="text-center"><input type="checkbox" className="h-4 w-4 accent-[#7c5cff]" checked={matrix[key]?.includes(a) ?? false} onChange={() => toggle(key, a)} aria-label={`${label}: ${a}`} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button className="btn-ghost" onClick={() => setMatrix(editing.defaults)}>Role defaults</button>
              <button className="btn-ghost" onClick={() => setMatrix({})}>Clear all</button>
              <button className="btn-primary" disabled={busy} onClick={savePermissions}>{busy ? <Spinner /> : 'Save'}</button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={activity !== null} onClose={() => setActivity(null)} title={`Activity · ${activity?.username ?? ''}`}>
        {activity?.items.length === 0 ? <p className="text-sm text-muted">No recorded actions yet.</p> : (
          <ol className="space-y-1.5 text-sm">
            {activity?.items.map((l) => (
              <li key={l.id} className="rounded-lg bg-surface-2 px-3 py-2">
                <span className="font-bold">{l.action}</span> <span className="text-xs text-muted">{l.targetType}{l.targetId ? ` ${l.targetId.slice(-8)}` : ''}</span>
                <span className="block text-[11px] text-muted">{dateTime(l.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </Sheet>
    </div>
  );
}

// ── point requests (virtual points) ───────────────────────────────

interface PReq { id: string; userId: string; name: string; mobile: string | null; balance: number; type: 'ADD' | 'WITHDRAW'; amount: number; note: string; status: string; adminRemark: string | null; createdAt: string }

export function PointRequestsPage() {
  const { has, refreshBadges } = useStaff();
  const toast = useToast();
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING');
  const [type, setType] = useState<'' | 'ADD' | 'WITHDRAW'>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAdmin<{ items: PReq[]; total: number; pageSize: number }>('/admin/point-requests', { page, ...(status ? { status } : {}), ...(type ? { type } : {}), ...(query ? { search: query } : {}) });

  useEffect(() => {
    const t = setInterval(() => void reload(), 15000);
    return () => clearInterval(t);
  }, [reload]);

  const decide = async (r: PReq, action: 'approve' | 'reject') => {
    const remark = action === 'reject'
      ? window.prompt('Reason for rejecting (the player will see this):')
      : window.confirm(r.type === 'ADD' ? `Add ${pts(r.amount)} points to ${r.name}'s wallet?` : `Remove the ${pts(r.amount)} reserved points from ${r.name}'s wallet?`) ? '' : null;
    if (remark === null || (action === 'reject' && !remark.trim())) return;
    try {
      await adminApi.post(`/admin/point-requests/${r.id}/${action}`, { remark });
      toast(action === 'approve' ? 'Request approved and wallet updated' : 'Request rejected', 'success');
      void reload();
      refreshBadges();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div>
      <Title>Point requests</Title>
      <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">These are requests for virtual in-app points. No payment is involved and none is recorded: approving an "add" credits points, approving a "withdraw" removes the points that were reserved.</p>
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); setPage(1); }}>
        <input className="input" placeholder="Search by mobile or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search requests" />
        <select className="input !w-40" value={type} onChange={(e) => { setType(e.target.value as typeof type); setPage(1); }} aria-label="Request type"><option value="">All types</option><option value="ADD">Add points</option><option value="WITHDRAW">Withdraw points</option></select>
        <button className="btn-primary">Search</button>
      </form>
      <Tabs value={status} options={[['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['', 'All']]} onChange={(v) => { setStatus(v); setPage(1); }} />
      <State error={error} loading={loading && !data} reload={reload} empty={data?.items.length === 0}>
        <Table head={['Received', 'Player', 'Request', 'Current balance', 'Note', 'Status', '']}>
          {data?.items.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-muted">{dateTime(r.createdAt)}</td>
              <td><span className="font-bold">{r.name}</span><span className="block text-xs text-muted">{r.mobile}</span></td>
              <td className="font-bold"><span className={r.type === 'ADD' ? 'text-emerald-500' : 'text-accent'}>{r.type === 'ADD' ? 'Add' : 'Withdraw'}</span> {pts(r.amount)}</td>
              <td>{pts(r.balance)}</td>
              <td className="max-w-xs text-muted">{r.note}</td>
              <td><Badge tone={r.status === 'PENDING' ? 'warn' : r.status === 'APPROVED' ? 'ok' : 'bad'}>{r.status}</Badge>{r.adminRemark && <span className="block text-xs text-muted">{r.adminRemark}</span>}</td>
              <td className="space-x-3 whitespace-nowrap">
                {r.status === 'PENDING' && has('pointRequests', 'approve') && <button className="font-bold text-emerald-500" onClick={() => decide(r, 'approve')}>Approve</button>}
                {r.status === 'PENDING' && has('pointRequests', 'reject') && <button className="font-bold text-red-500" onClick={() => decide(r, 'reject')}>Reject</button>}
              </td>
            </tr>
          ))}
        </Table>
        {data && <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
      </State>
    </div>
  );
}
