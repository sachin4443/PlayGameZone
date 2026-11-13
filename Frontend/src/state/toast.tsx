import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Kind = 'info' | 'success' | 'error';
interface Toast { id: number; kind: Kind; text: string }

const ToastContext = createContext<((text: string, kind?: Kind) => void) | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Kind = 'info') => {
    const id = nextId++;
    // Identical messages that are already on screen are not stacked.
    setToasts((t) => (t.some((x) => x.text === text) ? t : [...t.slice(-2), { id, kind, text }]));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  const value = useMemo(() => push, [push]);
  const tone = { info: 'bg-ink text-bg', success: 'bg-emerald-500 text-white', error: 'bg-red-500 text-white' };
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`pop-in max-w-sm rounded-xl px-4 py-2.5 text-sm font-semibold shadow-xl ${tone[t.kind]}`}>{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
