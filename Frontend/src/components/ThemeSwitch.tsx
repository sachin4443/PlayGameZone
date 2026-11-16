import { useEffect, useState } from 'react';
import { applyTheme, storedTheme, type Theme } from '../state/auth';
import { Icon } from './ui';

const OPTIONS: [Theme, string, string][] = [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['auto', 'System', 'settings']];

/**
 * Light / Dark / System default. The choice is remembered on this device; pass
 * `onChange` to also save it to the signed-in player's profile.
 */
export function ThemeSwitch({ onChange, compact }: { onChange?: (t: Theme) => void; compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>(storedTheme());
  useEffect(() => {
    const sync = () => setTheme(storedTheme());
    window.addEventListener('px:theme', sync);
    return () => window.removeEventListener('px:theme', sync);
  }, []);
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="Theme">
      {OPTIONS.map(([value, label, icon]) => (
        <button key={value} type="button" role="radio" aria-checked={theme === value} title={value === 'auto' ? 'System default' : label}
          onClick={() => { applyTheme(value); onChange?.(value); }}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold ${theme === value ? 'bg-surface text-ink shadow' : 'text-muted'}`}>
          <Icon name={icon} size={14} />{!compact && label}
        </button>
      ))}
    </div>
  );
}
