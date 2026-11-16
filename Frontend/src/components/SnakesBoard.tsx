import { useEffect, useMemo, useRef, useState } from 'react';
import type { SnakesPlayer } from '../lib/types';

const U = 60;
const SIZE = U * 10;
const HOP_MS = 130;
export const PIECE_HEX: Record<string, string> = { red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#f5b800' };
const SNAKE_COLORS = ['#e11d48', '#7c3aed', '#0891b2', '#ea580c', '#16a34a', '#db2777', '#4f46e5', '#b45309'];

/** Centre of a square (1..100) on the boustrophedon board; 0 waits beside square 1. */
function centre(n: number): [number, number] {
  if (n <= 0) return [-0.1 * U, SIZE - U / 2];
  const row = Math.floor((n - 1) / 10);
  const col = row % 2 === 0 ? (n - 1) % 10 : 9 - ((n - 1) % 10);
  return [col * U + U / 2, SIZE - row * U - U / 2];
}

function Ladder({ from, to }: { from: number; to: number }) {
  const [x1, y1] = centre(from);
  const [x2, y2] = centre(to);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const nx = (-(y2 - y1) / len) * 9;
  const ny = ((x2 - x1) / len) * 9;
  const rungs = Math.max(2, Math.round(len / 26));
  return (
    <g stroke="#8a5a2b" strokeWidth="5" strokeLinecap="round">
      <line x1={x1 + nx} y1={y1 + ny} x2={x2 + nx} y2={y2 + ny} />
      <line x1={x1 - nx} y1={y1 - ny} x2={x2 - nx} y2={y2 - ny} />
      {Array.from({ length: rungs }, (_, i) => {
        const t = (i + 0.5) / rungs;
        const cx = x1 + (x2 - x1) * t;
        const cy = y1 + (y2 - y1) * t;
        return <line key={i} x1={cx + nx} y1={cy + ny} x2={cx - nx} y2={cy - ny} stroke="#c58b4a" strokeWidth="4" />;
      })}
    </g>
  );
}

function Snake({ from, to, color }: { from: number; to: number; color: string }) {
  const [hx, hy] = centre(from);
  const [tx, ty] = centre(to);
  const len = Math.hypot(tx - hx, ty - hy);
  const nx = -(ty - hy) / len;
  const ny = (tx - hx) / len;
  const wiggle = Math.min(46, len / 4);
  const p = (t: number, side: number): string => `${hx + (tx - hx) * t + nx * wiggle * side} ${hy + (ty - hy) * t + ny * wiggle * side}`;
  const d = `M${hx} ${hy} C${p(0.2, 1)} ${p(0.35, 1)} ${p(0.5, 0)} S${p(0.8, -1)} ${tx} ${ty}`;
  return (
    <g fill="none" strokeLinecap="round">
      <path d={d} stroke="#00000033" strokeWidth="17" transform="translate(2 3)" />
      <path d={d} stroke={color} strokeWidth="14" />
      <path d={d} stroke="#ffffff66" strokeWidth="3" strokeDasharray="2 14" />
      <circle cx={hx} cy={hy} r="12" fill={color} />
      <circle cx={hx - 4} cy={hy - 4} r="3" fill="#fff" /><circle cx={hx + 4} cy={hy - 4} r="3" fill="#fff" />
      <circle cx={hx - 4} cy={hy - 4} r="1.4" fill="#111" /><circle cx={hx + 4} cy={hy - 4} r="1.4" fill="#111" />
    </g>
  );
}

interface Props {
  players: SnakesPlayer[];
  board: { ladders: [number, number][]; snakes: [number, number][] };
  /** Latest move to animate: walk the squares, then ride the ladder / snake. */
  anim: { id: number; seat: number; path: number[] } | null;
  onHop?: () => void;
}

export function SnakesBoard({ players, board, anim, onHop }: Props) {
  const [shown, setShown] = useState<Record<number, number>>(() => Object.fromEntries(players.map((p) => [p.seat, p.pos])));
  const queue = useRef<{ seat: number; path: number[] } | null>(null);
  const latest = useRef(players);
  latest.current = players;
  const hop = useRef(onHop);
  hop.current = onHop;

  useEffect(() => {
    if (anim) queue.current = { seat: anim.seat, path: [...anim.path] };
  }, [anim]);

  useEffect(() => {
    const timer = setInterval(() => {
      const q = queue.current;
      if (q && q.path.length) {
        const next = q.path.shift()!;
        hop.current?.();
        setShown((s) => ({ ...s, [q.seat]: next }));
        return;
      }
      queue.current = null;
      // Nothing to animate: make sure the display matches the server.
      setShown((s) => (latest.current.every((p) => s[p.seat] === p.pos) ? s : Object.fromEntries(latest.current.map((p) => [p.seat, p.pos]))));
    }, HOP_MS);
    return () => clearInterval(timer);
  }, []);

  const pieces = useMemo(() => {
    const active = players.filter((p) => p.active);
    return active.map((p) => {
      const at = shown[p.seat] ?? p.pos;
      const sharing = active.filter((o) => (shown[o.seat] ?? o.pos) === at);
      const idx = sharing.findIndex((o) => o.seat === p.seat);
      const [cx, cy] = centre(at);
      const spread = sharing.length > 1 ? 13 : 0;
      const angle = (2 * Math.PI * idx) / sharing.length;
      return { seat: p.seat, color: PIECE_HEX[p.color], x: cx + Math.cos(angle) * spread, y: cy + Math.sin(angle) * spread - (at <= 0 ? p.seat * 20 : 0), small: sharing.length > 1 };
    });
  }, [players, shown]);

  return (
    <svg viewBox={`-14 0 ${SIZE + 14} ${SIZE}`} className="h-full w-full select-none drop-shadow-2xl" role="img" aria-label="Snake and ladder board">
      <rect x="0" width={SIZE} height={SIZE} rx="14" fill="#fff" />
      {Array.from({ length: 100 }, (_, i) => {
        const n = i + 1;
        const [cx, cy] = centre(n);
        const shade = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff'][(n + Math.floor((n - 1) / 10)) % 5];
        return (
          <g key={n}>
            <rect x={cx - U / 2 + 1} y={cy - U / 2 + 1} width={U - 2} height={U - 2} rx="8" fill={n === 100 ? '#facc15' : shade} />
            <text x={cx - U / 2 + 7} y={cy - U / 2 + 18} fontSize="13" fontWeight="800" fill="#1f2937" opacity="0.7">{n}</text>
          </g>
        );
      })}
      {board.ladders.map(([f, t]) => <Ladder key={`l${f}`} from={f} to={t} />)}
      {board.snakes.map(([f, t], i) => <Snake key={`s${f}`} from={f} to={t} color={SNAKE_COLORS[i % SNAKE_COLORS.length]} />)}
      {pieces.map((p) => (
        <g key={p.seat} style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition: `transform ${HOP_MS}ms linear` }}>
          <ellipse cy="14" rx="15" ry="6" fill="#000" opacity="0.25" />
          <circle r={p.small ? 13 : 17} fill={p.color} stroke="#fff" strokeWidth="4" />
          <circle cx="-5" cy="-6" r="4" fill="#fff" opacity="0.7" />
        </g>
      ))}
    </svg>
  );
}
