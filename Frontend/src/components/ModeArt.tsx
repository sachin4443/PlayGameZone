/** Small original illustrations for the game-mode cards. */
export function ModeArt({ kind, size = 84 }: { kind: 'board' | 'clock' | 'burst' | 'dice' | 'lock' | 'snake'; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 100 100', 'aria-hidden': true } as const;
  if (kind === 'board')
    return (
      <svg {...common}>
        <g transform="rotate(12 50 50)">
          <rect x="10" y="10" width="80" height="80" rx="14" fill="#fff" opacity="0.95" />
          <rect x="16" y="16" width="30" height="30" rx="8" fill="#ef4444" /><rect x="54" y="16" width="30" height="30" rx="8" fill="#22c55e" />
          <rect x="16" y="54" width="30" height="30" rx="8" fill="#3b82f6" /><rect x="54" y="54" width="30" height="30" rx="8" fill="#f5b800" />
          {[[31, 31], [69, 31], [31, 69], [69, 69]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="7" fill="#fff" />)}
        </g>
      </svg>
    );
  if (kind === 'snake')
    return (
      <svg {...common}>
        <g stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity="0.95">
          <path d="M22 88 40 14M44 88 62 14" />
          {[76, 60, 44, 28].map((y, i) => <path key={y} d={`M${25 + i * 3.9} ${y}h22`} />)}
        </g>
        <path d="M84 16c-22 4-4 22-18 30s-2 22-16 26" stroke="#fde047" strokeWidth="10" strokeLinecap="round" fill="none" />
        <circle cx="84" cy="16" r="8" fill="#fde047" /><circle cx="86" cy="14" r="2" fill="#14532d" />
      </svg>
    );
  if (kind === 'clock')
    return (
      <svg {...common}>
        <rect x="42" y="6" width="16" height="10" rx="3" fill="#fff" />
        <circle cx="50" cy="56" r="36" fill="#fff" /><circle cx="50" cy="56" r="28" fill="#fde68a" />
        <path d="M50 56V34M50 56l14 9" stroke="#1e1b4b" strokeWidth="6" strokeLinecap="round" />
        <text x="50" y="86" textAnchor="middle" fontSize="11" fontWeight="800" fill="#1e1b4b">5 MIN</text>
      </svg>
    );
  if (kind === 'burst')
    return (
      <svg {...common}>
        <path d="M50 4l9 20 21-9-7 21 23 6-20 12 12 20-23-3-3 23-12-19-18 15 5-23-23-4 19-13L18 31l22 2z" fill="#fde047" />
        <circle cx="50" cy="52" r="20" fill="#fff" />
        <text x="50" y="60" textAnchor="middle" fontSize="22" fontWeight="800" fill="#be123c">x2</text>
      </svg>
    );
  if (kind === 'dice')
    return (
      <svg {...common}>
        {[[8, 30, -10], [36, 10, 6], [54, 44, 14]].map(([x, y, r], i) => (
          <g key={i} transform={`rotate(${r} ${x + 19} ${y + 19})`}>
            <rect x={x} y={y} width="38" height="38" rx="9" fill="#fff" />
            {[[11, 11], [27, 27], ...(i > 0 ? [[27, 11], [11, 27]] : []), ...(i === 2 ? [[19, 19]] : [])].map(([dx, dy]) => <circle key={`${dx}${dy}`} cx={x + dx} cy={y + dy} r="3.6" fill="#6b21a8" />)}
          </g>
        ))}
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M32 44V32a18 18 0 0 1 36 0v12" stroke="#fff" strokeWidth="9" fill="none" strokeLinecap="round" />
      <rect x="20" y="42" width="60" height="48" rx="12" fill="#fbbf24" />
      <circle cx="50" cy="62" r="8" fill="#1f2937" /><rect x="46" y="64" width="8" height="16" rx="3" fill="#1f2937" />
    </svg>
  );
}
