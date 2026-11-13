import { useEffect, useMemo, useRef, useState } from 'react';
import { COLORS, HEX, HEX_DARK, HOME, HOME_COLUMN, ROTATION, STARS, START, TRACK, YARD, YARD_ORIGIN, cellKey, tokenPoint } from '../lib/board';
import type { Color, PlayerState } from '../lib/types';

const U = 40; // one grid cell in SVG units
const SIZE = U * 15;
const HOP_MS = 115;

interface Props {
  players: PlayerState[];
  /** Colour shown at the bottom-left (the viewer's own). */
  perspective: Color;
  /** Token indexes of `activeSeat` that may be pressed right now. */
  movable: number[];
  activeSeat: number | null;
  onTokenPress?: (tokenIndex: number) => void;
  onHop?: () => void;
}

type Shown = Record<string, number>;
const keyOf = (seat: number, token: number) => `${seat}:${token}`;

function starPath(cx: number, cy: number, r: number) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const rad = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    d += `${i === 0 ? 'M' : 'L'}${(cx + Math.cos(rad) * rr).toFixed(1)} ${(cy + Math.sin(rad) * rr).toFixed(1)}`;
  }
  return `${d}Z`;
}

/** Static board artwork: yards, ring, home columns, centre. */
function BoardArt() {
  const ringColor = new Map<number, Color>();
  COLORS.forEach((c) => ringColor.set(START[c], c));
  return (
    <g>
      <rect width={SIZE} height={SIZE} rx="18" fill="var(--board-bg)" />
      {COLORS.map((c) => {
        const [ox, oy] = YARD_ORIGIN[c];
        return (
          <g key={c}>
            <rect x={ox * U + 3} y={oy * U + 3} width={6 * U - 6} height={6 * U - 6} rx="22" fill={HEX[c]} />
            <rect x={(ox + 0.85) * U} y={(oy + 0.85) * U} width={4.3 * U} height={4.3 * U} rx="18" fill="#fff" />
            {[[1.9, 1.9], [4.1, 1.9], [1.9, 4.1], [4.1, 4.1]].map(([dx, dy], i) => (
              <circle key={i} cx={(ox + dx) * U} cy={(oy + dy) * U} r={U * 0.56} fill={HEX[c]} opacity="0.22" stroke={HEX[c]} strokeWidth="2" />
            ))}
          </g>
        );
      })}
      {TRACK.map(([r, c], i) => {
        const tint = ringColor.get(i);
        return <rect key={i} x={c * U + 1} y={r * U + 1} width={U - 2} height={U - 2} rx="6" fill={tint ? HEX[tint] : 'var(--board-cell)'} stroke="var(--board-line)" strokeWidth="1.2" />;
      })}
      {COLORS.map((c) => HOME_COLUMN[c].map(([r, col], i) => (
        <rect key={`${c}${i}`} x={col * U + 1} y={r * U + 1} width={U - 2} height={U - 2} rx="6" fill={HEX[c]} stroke="var(--board-line)" strokeWidth="1.2" />
      )))}
      {STARS.map((i) => {
        const [r, c] = TRACK[i];
        return <path key={i} d={starPath((c + 0.5) * U, (r + 0.5) * U, U * 0.34)} fill="none" stroke="#8f8ba8" strokeWidth="2" />;
      })}
      {COLORS.map((c) => {
        const [r, col] = TRACK[START[c]];
        return <path key={c} d={starPath((col + 0.5) * U, (r + 0.5) * U, U * 0.3)} fill="#fff" opacity="0.9" />;
      })}
      {/* Centre: four triangles pointing at the middle */}
      <g>
        <path d={`M${6 * U} ${6 * U}L${7.5 * U} ${7.5 * U}L${6 * U} ${9 * U}Z`} fill={HEX.red} />
        <path d={`M${6 * U} ${6 * U}L${7.5 * U} ${7.5 * U}L${9 * U} ${6 * U}Z`} fill={HEX.green} />
        <path d={`M${9 * U} ${6 * U}L${7.5 * U} ${7.5 * U}L${9 * U} ${9 * U}Z`} fill={HEX.yellow} />
        <path d={`M${6 * U} ${9 * U}L${7.5 * U} ${7.5 * U}L${9 * U} ${9 * U}Z`} fill={HEX.blue} />
        <rect x={6 * U} y={6 * U} width={3 * U} height={3 * U} fill="none" stroke="var(--board-line)" strokeWidth="1.5" />
      </g>
    </g>
  );
}

export function LudoBoard({ players, perspective, movable, activeSeat, onTokenPress, onHop }: Props) {
  const target = useMemo(() => {
    const t: Shown = {};
    for (const p of players) p.tokens.forEach((s, i) => (t[keyOf(p.seat, i)] = s));
    return t;
  }, [players]);

  // `shown` trails `target`: tokens walk cell by cell, and captured tokens only
  // fly home once the capturing token has arrived.
  const [shown, setShown] = useState<Shown>(target);
  const targetRef = useRef(target);
  targetRef.current = target;
  const hopRef = useRef(onHop);
  hopRef.current = onHop;

  useEffect(() => {
    const timer = setInterval(() => {
      setShown((cur) => {
        const goal = targetRef.current;
        let next: Shown | null = null;
        let walking = false;
        for (const k of Object.keys(goal)) {
          const from = cur[k] ?? goal[k];
          const to = goal[k];
          if (from === to) continue;
          const forward = from !== YARD && to !== YARD && to > from && to - from <= 12;
          const wrapping = from !== YARD && to !== YARD && to < from && from >= 38 && to <= 11; // kill-to-enter lap
          if (forward || wrapping) {
            walking = true;
            let step = from + 1;
            if (wrapping && step > 50) step -= 52;
            (next ??= { ...cur })[k] = step;
          }
        }
        if (walking) {
          hopRef.current?.();
          return next!;
        }
        // Nothing is walking: apply jumps (leaving the yard, being captured, resync).
        for (const k of Object.keys(goal)) {
          if ((cur[k] ?? goal[k]) !== goal[k] || !(k in cur)) (next ??= { ...cur })[k] = goal[k];
        }
        return next ?? cur;
      });
    }, HOP_MS);
    return () => clearInterval(timer);
  }, []);

  const settled = useMemo(() => Object.keys(target).every((k) => shown[k] === target[k]), [shown, target]);

  // Fan out tokens that share a square.
  const placed = useMemo(() => {
    const groups = new Map<string, { seat: number; token: number; color: Color; steps: number }[]>();
    for (const p of players) {
      if (!p.active && p.tokens.every((t) => t === YARD)) continue;
      p.tokens.forEach((_, i) => {
        const steps = shown[keyOf(p.seat, i)] ?? p.tokens[i];
        const k = cellKey(p.color, steps, i);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push({ seat: p.seat, token: i, color: p.color, steps });
      });
    }
    const out: { seat: number; token: number; color: Color; x: number; y: number; scale: number; home: boolean }[] = [];
    for (const group of groups.values()) {
      const n = group.length;
      group.forEach((t, idx) => {
        const [gx, gy] = tokenPoint(t.color, t.steps, t.token);
        const spread = n === 1 ? 0 : t.steps >= HOME ? 0.2 : 0.24;
        const angle = (2 * Math.PI * idx) / n - Math.PI / 4;
        out.push({
          seat: t.seat, token: t.token, color: t.color,
          x: (gx + (n > 1 ? Math.cos(angle) * spread : 0)) * U,
          y: (gy + (n > 1 ? Math.sin(angle) * spread : 0)) * U,
          scale: n === 1 ? 1 : n === 2 ? 0.8 : 0.66,
          home: t.steps >= HOME,
        });
      });
    }
    // Pressable tokens are drawn last so they sit on top.
    return out.sort((a, b) => Number(a.seat === activeSeat) - Number(b.seat === activeSeat));
  }, [players, shown, activeSeat]);

  const rotation = ROTATION[perspective];

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full select-none drop-shadow-2xl" role="img" aria-label="Ludo board">
      <g transform={`rotate(${rotation} ${SIZE / 2} ${SIZE / 2})`}>
        <BoardArt />
        {placed.map((t) => {
          const canPress = settled && t.seat === activeSeat && movable.includes(t.token);
          const r = U * 0.34 * t.scale * (t.home ? 0.8 : 1);
          return (
            <g
              key={keyOf(t.seat, t.token)}
              style={{ transform: `translate(${t.x}px, ${t.y}px)`, transition: `transform ${HOP_MS}ms linear`, cursor: canPress ? 'pointer' : 'default' }}
              onClick={canPress ? () => onTokenPress?.(t.token) : undefined}
              role={canPress ? 'button' : undefined}
              aria-label={canPress ? `Move ${t.color} token ${t.token + 1}` : undefined}
              tabIndex={canPress ? 0 : undefined}
              onKeyDown={canPress ? (e) => (e.key === 'Enter' || e.key === ' ') && onTokenPress?.(t.token) : undefined}
            >
              {canPress && <circle r={r + 7} fill="none" stroke="#ffb020" strokeWidth="4" className="token-hint" />}
              {/* Generous invisible hit area for touch */}
              {canPress && <circle r={U * 0.6} fill="transparent" />}
              <ellipse cx="0" cy={r * 0.75} rx={r * 0.9} ry={r * 0.35} fill="#000" opacity="0.25" />
              <circle r={r} fill={HEX[t.color]} stroke="#fff" strokeWidth={3 * t.scale} />
              <circle r={r * 0.52} fill={HEX_DARK[t.color]} />
              <circle cx={-r * 0.28} cy={-r * 0.32} r={r * 0.2} fill="#fff" opacity="0.75" />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
