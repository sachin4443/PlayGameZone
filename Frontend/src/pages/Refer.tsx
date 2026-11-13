import { PageHead } from '../components/PageHead';
import { Avatar, Empty, ErrorNote, Icon, PageLoader, PointsPill } from '../components/ui';
import { timeAgo } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { useToast } from '../state/toast';

interface Data { code: string; referrerReward: number; refereeReward: number; totalInvited: number; totalEarned: number; items: { id: string; name: string; avatar: string; status: 'PENDING' | 'REWARDED'; reward: number; joinedAt: string }[] }

export default function ReferPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<Data>('/referrals');
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (loading && !data) return <PageLoader />;
  const d = data!;
  const link = `${window.location.origin}/login?ref=${d.code}`;

  const share = async () => {
    const text = `Play Ludo with me on PlayerX Ludo! Use my code ${d.code} when you sign up: ${link}`;
    try {
      if (navigator.share) await navigator.share({ title: 'PlayerX Ludo', text });
      else {
        await navigator.clipboard.writeText(text);
        toast('Invite copied', 'success');
      }
    } catch {
      /* dismissed */
    }
  };

  return (
    <div>
      <PageHead title="Refer & earn" />
      <section className="rounded-3xl bg-gradient-to-br from-pink to-brand p-5 text-white shadow-xl">
        <Icon name="gift" size={30} />
        <h2 className="mt-2 text-xl font-extrabold">Invite a friend, earn {d.referrerReward} points</h2>
        <p className="mt-1 text-sm text-white/80">Your friend gets {d.refereeReward} bonus points too. Rewards arrive once they finish their first game.</p>
        <button onClick={async () => { await navigator.clipboard.writeText(d.code).catch(() => undefined); toast('Code copied', 'success'); }} className="mt-4 flex w-full items-center justify-between rounded-2xl bg-black/20 px-4 py-3" aria-label="Copy referral code">
          <span><span className="block text-left text-[10px] font-bold uppercase tracking-wider text-white/70">Your code</span><span className="text-2xl font-extrabold tracking-[0.25em]">{d.code}</span></span>
          <Icon name="copy" />
        </button>
        <button onClick={share} className="btn mt-3 w-full bg-white text-brand"><Icon name="share" size={16} /> Share invite</button>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-2 text-center">
        <div className="card p-3"><p className="text-xl font-extrabold">{d.totalInvited}</p><p className="text-xs text-muted">Friends invited</p></div>
        <div className="card p-3"><PointsPill value={d.totalEarned} className="text-xl font-extrabold" /><p className="text-xs text-muted">Points earned</p></div>
      </div>

      <h2 className="mb-2 mt-5 text-base font-extrabold">Your invites</h2>
      {d.items.length === 0 ? <Empty icon="users" title="No invites yet" hint="Share your code to get started." /> : (
        <div className="card divide-y divide-line">
          {d.items.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <Avatar id={r.avatar} name={r.name} size={32} />
              <div className="min-w-0 flex-1"><p className="truncate font-bold">{r.name}</p><p className="text-xs text-muted">Joined {timeAgo(r.joinedAt)}</p></div>
              {r.status === 'REWARDED' ? <PointsPill value={r.reward} className="text-emerald-500" /> : <span className="chip bg-surface-2 text-muted">Waiting for first game</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
