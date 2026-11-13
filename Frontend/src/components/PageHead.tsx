import { useNavigate } from 'react-router-dom';
import { Icon } from './ui';

export function PageHead({ title, subtitle }: { title: string; subtitle?: string }) {
  const navigate = useNavigate();
  return (
    <div className="mb-4 flex items-center gap-3">
      <button onClick={() => navigate(-1)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface" aria-label="Back"><Icon name="back" size={18} /></button>
      <div className="min-w-0">
        <h1 className="truncate text-xl font-extrabold">{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
      </div>
    </div>
  );
}
