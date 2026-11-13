import { useEffect, type ReactNode } from 'react';

const ICONS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  trophy: 'M7 4h10v4a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  live: 'M5 5 19 19M19 5 5 19M4 4l3 1-2 2zM20 4l-3 1 2 2zM4 20l1-3 2 2zM20 20l-1-3-2 2',
  bell: 'M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0',
  back: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  share: 'M4 12v7h16v-7M12 3v12M8 7l4-4 4 4',
  sound: 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  mute: 'M4 9v6h4l5 4V5L8 9zM16 9l5 6M21 9l-5 6',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 11v6M12 7.5h.01',
  gift: 'M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7S10 3 8 3a2 2 0 0 0 0 4zM12 7s2-4 4-4a2 2 0 0 1 0 4z',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01',
  logout: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
  plus: 'M12 5v14M5 12h14',
  key: 'M14 10a4 4 0 1 0-3.9 4L12 16h2v2h2v2h3v-3l-5.2-5.2A4 4 0 0 0 14 10zM9 9h.01',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v5l3 2',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1.2V4h-4v2.8L9 8 7 7 5 11l2 1v2l-2 1 2 4 2-1 2 1.2V22h4v-2.8l2-1.2 2 1 2-4-2-1z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7M22 21a7 7 0 0 0-4-6.3',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12l5 5 9-10',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5',
  moon: 'M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z',
  refresh: 'M20 11a8 8 0 1 0-2.3 6.3M20 4v7h-7',
};

export function Icon({ name, size = 20, className = '' }: { name: keyof typeof ICONS | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="px-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c5cff" />
          <stop offset="1" stopColor="#ff4d8d" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#px-logo)" />
      <g fill="#fff">
        <circle cx="20" cy="20" r="6" /><circle cx="44" cy="20" r="6" /><circle cx="32" cy="32" r="6" /><circle cx="20" cy="44" r="6" /><circle cx="44" cy="44" r="6" />
      </g>
    </svg>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-extrabold tracking-tight ${className}`}>
      Player<span className="text-pink">X</span> <span className="text-brand">Ludo</span>
    </span>
  );
}

const AVATAR_BG: Record<string, [string, string]> = {
  a1: ['#7c5cff', '#b79bff'], a2: ['#ff4d8d', '#ff9a6b'], a3: ['#0ea5e9', '#67e8f9'], a4: ['#22c55e', '#a3e635'],
  a5: ['#f59e0b', '#fde047'], a6: ['#ef4444', '#fb7185'], a7: ['#14b8a6', '#5eead4'], a8: ['#6366f1', '#f472b6'],
};
export const AVATAR_IDS = Object.keys(AVATAR_BG);

export function Avatar({ id, name, size = 40, ring }: { id: string; name: string; size?: number; ring?: string }) {
  const [a, b] = AVATAR_BG[id] ?? AVATAR_BG.a1;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-extrabold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(135deg, ${a}, ${b})`, boxShadow: ring ? `0 0 0 3px ${ring}` : undefined }}
      aria-hidden="true"
    >
      {(name.trim()[0] ?? 'P').toUpperCase()}
    </span>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} role="status" aria-label="Loading" />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center text-brand">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function Empty({ icon = 'info', title, hint, action }: { icon?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-6 py-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-muted"><Icon name={icon} /></span>
      <p className="text-sm font-semibold">{title}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
      <span>{message}</span>
      {onRetry && <button className="font-bold underline" onClick={onRetry}>Retry</button>}
    </div>
  );
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="slide-up max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-5 pb-8 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-muted"><Icon name="x" size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-6 flex items-center justify-between">
      <h2 className="text-base font-extrabold">{children}</h2>
      {action}
    </div>
  );
}

export function PointsPill({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 font-bold ${className}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#ffb020" /><circle cx="12" cy="12" r="6" fill="#ffd66b" /></svg>
      {new Intl.NumberFormat('en-IN').format(value)}
    </span>
  );
}
