import { useEffect, useState } from 'react';
import { Icon, Logo, Sheet } from './ui';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

// The browser fires this once, possibly before any component is mounted.
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallEvent;
  listeners.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  listeners.forEach((fn) => fn());
});

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent);

/** Whether an install option should be offered, and how to trigger it. */
export function useInstall() {
  const [, bump] = useState(0);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);
  const installed = isStandalone();
  // Android/desktop Chrome give us a real prompt; iOS Safari needs manual steps.
  const available = !installed && (deferred !== null || isIos() || isMobile());
  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') deferred = null;
      bump((n) => n + 1);
    } else setHelp(true);
  };
  return { available, installed, install, help, closeHelp: () => setHelp(false) };
}

function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ios = isIos();
  return (
    <Sheet open={open} onClose={onClose} title="Install PlayerX Ludo">
      <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
        {ios ? (
          <>
            <li>Open this site in <b className="text-ink">Safari</b>.</li>
            <li>Tap the <b className="text-ink">Share</b> button at the bottom of the screen.</li>
            <li>Choose <b className="text-ink">Add to Home Screen</b>, then <b className="text-ink">Add</b>.</li>
          </>
        ) : (
          <>
            <li>Open your browser's menu (the <b className="text-ink">⋮</b> button).</li>
            <li>Choose <b className="text-ink">Install app</b> or <b className="text-ink">Add to Home screen</b>.</li>
            <li>Confirm with <b className="text-ink">Install</b>.</li>
          </>
        )}
      </ol>
      <p className="mt-3 text-xs text-muted">The app then opens from your home screen like any other app, without typing the address.</p>
    </Sheet>
  );
}

/** Dismissible banner for the home screen. */
export function InstallBanner() {
  const { available, install, help, closeHelp } = useInstall();
  const [hidden, setHidden] = useState(() => Date.now() - Number(localStorage.getItem('px.install.dismissed') ?? 0) < 7 * 86400_000);
  if (!available || hidden) return <HelpSheet open={help} onClose={closeHelp} />;
  return (
    <>
      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-brand/40 bg-brand/10 p-3">
        <Logo size={44} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold">Install the app</p>
          <p className="text-xs text-muted">Open PlayerX Ludo straight from your home screen.</p>
        </div>
        <button className="btn-primary !px-3 !py-2" onClick={install}>Install</button>
        <button onClick={() => { localStorage.setItem('px.install.dismissed', String(Date.now())); setHidden(true); }} aria-label="Not now" className="flex h-8 w-8 items-center justify-center rounded-full text-muted"><Icon name="x" size={16} /></button>
      </div>
      <HelpSheet open={help} onClose={closeHelp} />
    </>
  );
}

/** Permanent entry for the profile page. */
export function InstallRow() {
  const { available, installed, install, help, closeHelp } = useInstall();
  if (!available && !installed) return null;
  return (
    <>
      <div className="flex items-center justify-between p-4">
        <span className="flex items-center gap-3 text-sm font-bold"><Icon name="share" /> <span>Install app<span className="block text-xs font-medium text-muted">{installed ? 'Installed on this device' : 'Add PlayerX Ludo to your home screen'}</span></span></span>
        {!installed && <button className="btn-primary !px-3 !py-2" onClick={install}>Install</button>}
      </div>
      <HelpSheet open={help} onClose={closeHelp} />
    </>
  );
}
