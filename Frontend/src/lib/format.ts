export const pts = (n: number) => new Intl.NumberFormat('en-IN').format(n);

export function dateTime(value: string | number | Date) {
  return new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(value: string | number | Date) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function clock(totalSeconds: number) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function countdown(to: string | Date) {
  const s = Math.floor((new Date(to).getTime() - Date.now()) / 1000);
  if (s <= 0) return 'starting';
  if (s < 3600) return `in ${Math.ceil(s / 60)} min`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `in ${Math.floor(s / 86400)}d`;
}

export const TX_LABEL: Record<string, string> = {
  WELCOME_BONUS: 'Welcome bonus',
  GAME_ENTRY: 'Game entry',
  GAME_WIN: 'Game win',
  GAME_LOSS: 'Game loss',
  REFUND: 'Refund',
  ADMIN_CREDIT: 'Admin credit',
  ADMIN_DEBIT: 'Admin debit',
  TOURNAMENT_ENTRY: 'Tournament entry',
  TOURNAMENT_REWARD: 'Tournament reward',
  REFERRAL_BONUS: 'Referral bonus',
  POINTS_REQUEST: 'Points request approved',
  WITHDRAW_HOLD: 'Withdrawal reserved',
  WITHDRAW: 'Withdrawal approved',
  WITHDRAW_RELEASE: 'Withdrawal returned',
};
