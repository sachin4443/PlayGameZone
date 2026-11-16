const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};

interface Props {
  value: number | null;
  rolling?: boolean;
  size?: number;
  /** Highlights the die as something the player can press. */
  active?: boolean;
  selected?: boolean;
  dim?: boolean;
  color?: string;
  /** Set with size={0} to let CSS size the die. */
  className?: string;
}

export function Dice({ value, rolling, size = 64, active, selected, dim, color = '#7c5cff', className = '' }: Props) {
  return (
    <svg
      width={size || undefined}
      height={size || undefined}
      viewBox="0 0 100 100"
      key={rolling ? 'rolling' : `v${value}`}
      className={`${rolling ? 'dice-rolling' : value ? 'dice-landed' : ''} ${active ? 'glow rounded-2xl' : ''} ${className} transition-opacity`}
      style={{ opacity: dim ? 0.45 : 1 }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="die-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e9e6fb" />
        </linearGradient>
      </defs>
      <rect x="6" y="9" width="88" height="88" rx="20" fill="#000" opacity="0.18" />
      <rect x="6" y="4" width="88" height="88" rx="20" fill="url(#die-face)" stroke={selected ? '#ffb020' : color} strokeWidth={selected ? 7 : 4} />
      {value
        ? PIPS[value].map(([x, y], i) => <circle key={i} cx={x} cy={y - 2} r="8.5" fill={value === 6 ? '#ef4444' : '#1b1a3a'} />)
        : <text x="50" y="62" textAnchor="middle" fontSize="40" fontWeight="800" fill={color}>?</text>}
    </svg>
  );
}
