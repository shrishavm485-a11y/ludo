import { useEffect, useMemo, useState } from 'react';
import { ARM, PALETTE, isSafe } from '../../shared/engine.js';
import { buildLayout, tokenPoint } from '../../shared/layout.js';

const INK = '#151515';

/** Walks displayed token positions one square at a time so moves animate along the path. */
export function useShown(game) {
  const [shown, setShown] = useState(() => game.players.map((p) => [...p.tokens]));
  const target = game.players.map((p) => p.tokens.join(',')).join('|');
  useEffect(() => {
    const id = setInterval(() => {
      let changed = false;
      setShown((prev) => {
        const next = prev.map((arr, i) => arr.map((v, t) => {
          const goal = game.players[i]?.tokens[t] ?? 0;
          if (v === goal) return v;
          changed = true;
          return goal > v && goal - v <= 6 ? v + 1 : goal;
        }));
        return changed ? next : prev;
      });
      if (!changed) clearInterval(id);
    }, 110);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const busy = game.players.some((p, i) => p.tokens.some((v, t) => shown[i]?.[t] !== v));
  return { shown, busy };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export default function Board({ game, shown, canPick = false, onPick, zoom = false }) {
  const L = useMemo(() => buildLayout(game.arms), [game.arms]);
  const [W, H] = L.size;
  const byArm = {};
  game.players.forEach((p, i) => { byArm[p.arm] = { p, i }; });
  const hexOf = (a) => (byArm[a] ? PALETTE[byArm[a].p.color % PALETTE.length].hex : null);
  const R = L.tokenR;

  // tokens and stacking offsets
  const items = [];
  game.players.forEach((pl, pi) => {
    if (pl.out) return;
    pl.tokens.forEach((_, t) => {
      const sp = shown[pi]?.[t] ?? 0;
      items.push({ pi, t, sp, pt: tokenPoint(L, game, pi, t, sp), dx: 0, dy: 0, k: 1 });
    });
  });
  const groups = new Map();
  items.forEach((it) => {
    if (it.sp === 0 || it.sp >= game.home) return;
    const key = `${it.pt.x.toFixed(2)},${it.pt.y.toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  });
  groups.forEach((arr) => {
    if (arr.length < 2) return;
    arr.forEach((it, i) => { const a = (2 * Math.PI * i) / arr.length; it.dx = Math.cos(a) * R * 0.62; it.dy = Math.sin(a) * R * 0.62; it.k = 0.78; });
  });
  const isLegal = (it) => canPick && game.phase === 'move' && it.pi === game.turn && game.legal.includes(it.t);
  items.sort((a, b) => Number(isLegal(a)) - Number(isLegal(b)));

  // viewBox: whole board, or a close-up around the active token (for big boards on small screens)
  let vb = [0, 0, W, H];
  if (zoom) {
    const cur = items.find((it) => it.pi === game.turn && game.legal.includes(it.t)) || items.find((it) => it.pi === game.turn && it.sp > 0 && it.sp < game.home);
    const f = cur ? cur.pt : L.centre;
    const w = W * 0.5; const h = H * 0.5;
    vb = [clamp(f.x - w / 2, 0, W - w), clamp(f.y - h / 2, 0, H - h), w, h];
  }

  const cell = (c, key, fill, extra = {}) => {
    const props = { x: c.x - c.w / 2, y: c.y - c.w / 2, width: c.w, height: c.w, rx: c.w * 0.12, fill, stroke: INK, strokeWidth: c.w * 0.07, ...extra };
    if (c.rot) props.transform = `rotate(${c.rot} ${c.x} ${c.y})`;
    return <rect key={key} {...props} />;
  };

  const ghosts = items.filter(isLegal).map((it) => {
    const from = game.players[it.pi].tokens[it.t];
    const to = from === 0 ? 1 : from + game.dice;
    return { it, p: tokenPoint(L, game, it.pi, it.t, to) };
  });

  return (
    <svg className="board" viewBox={vb.join(' ')} role="img" aria-label={`Ludo board for ${game.players.length} players`}>
      <rect x="0" y="0" width={W} height={H} rx={L.kind === 'classic' ? 0.4 : 4} fill="var(--board)" stroke={INK} strokeWidth={L.kind === 'classic' ? 0.12 : 0.5} />
      {L.yards.map((y, a) => {
        const hex = hexOf(a);
        return (
          <g key={`y${a}`}>
            {L.kind === 'classic'
              ? <rect x={y.rect.x + 0.3} y={y.rect.y + 0.3} width={y.rect.w - 0.6} height={y.rect.h - 0.6} rx="0.6" fill={hex || 'var(--empty)'} fillOpacity={hex ? 0.9 : 0.6} stroke={INK} strokeWidth="0.1" />
              : <circle cx={y.x} cy={y.y} r={y.r} fill={hex || 'var(--empty)'} fillOpacity={hex ? 0.9 : 0.6} stroke={INK} strokeWidth="0.4" />}
            {y.slots.map((s, t) => <circle key={t} cx={s.x} cy={s.y} r={R * 1.25} fill="var(--board)" stroke={INK} strokeWidth={R * 0.12} />)}
          </g>
        );
      })}
      {L.kind === 'classic' && L.homes.map((h, a) => <polygon key={`h${a}`} points={h.tri} fill={hexOf(a) || 'var(--empty)'} stroke={INK} strokeWidth="0.08" />)}
      {L.kind === 'radial' && L.homes.map((h, a) => {
        const cx = h.slots.reduce((s, p) => s + p.x, 0) / 4; const cy = h.slots.reduce((s, p) => s + p.y, 0) / 4;
        return <circle key={`h${a}`} cx={cx} cy={cy} r={R * 3.3} fill={hexOf(a) || 'var(--empty)'} fillOpacity="0.9" stroke={INK} strokeWidth="0.3" />;
      })}
      {L.lanes.map((lane, a) => lane.map((c, k) => cell(c, `l${a}-${k}`, hexOf(a) || 'var(--empty)')))}
      {L.ring.map((c, i) => {
        const start = i % ARM === 0;
        return cell(c, `r${i}`, start ? (hexOf(i / ARM) || 'var(--empty)') : 'var(--cell)');
      })}
      {L.ring.map((c, i) => (isSafe(i) && i % ARM === 8
        ? <text key={`s${i}`} x={c.x} y={c.y} fontSize={c.w * 0.85} textAnchor="middle" dominantBaseline="central" fill={INK} pointerEvents="none">★</text>
        : null))}
      {L.ring.map((c, i) => (i % ARM === 0
        ? <text key={`d${i}`} x={c.x} y={c.y} fontSize={c.w * 0.7} textAnchor="middle" dominantBaseline="central" fill={INK} pointerEvents="none">◆</text>
        : null))}
      {ghosts.map(({ it, p }) => (
        <circle key={`g${it.pi}-${it.t}`} className="ghost" cx={p.x} cy={p.y} r={R * 1.15} fill="none" stroke={INK} strokeWidth={R * 0.2} strokeDasharray={`${R * 0.5} ${R * 0.4}`} onClick={() => onPick?.(it.t)} />
      ))}
      {items.map((it) => {
        const pl = game.players[it.pi];
        const legal = isLegal(it);
        const x = it.pt.x + it.dx; const y = it.pt.y + it.dy; const r = R * it.k;
        return (
          <g
            key={`${it.pi}-${it.t}`}
            className={`tok${legal ? ' legal' : ''}`}
            style={{ transform: `translate(${x}px, ${y}px)` }}
            role={legal ? 'button' : undefined}
            tabIndex={legal ? 0 : undefined}
            aria-label={legal ? `Move ${pl.name}'s token ${it.t + 1}` : undefined}
            onClick={legal ? () => onPick?.(it.t) : undefined}
            onKeyDown={legal ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(it.t); } } : undefined}
          >
            {legal && <circle className="halo" r={r * 1.55} fill="var(--y)" fillOpacity="0.55" />}
            <circle r={r} fill={PALETTE[pl.color % PALETTE.length].hex} stroke={INK} strokeWidth={r * 0.2} />
            <circle r={r * 0.5} fill="#fffdf5" />
            <text fontSize={r * 0.85} fontWeight="900" textAnchor="middle" dominantBaseline="central" fill={INK} pointerEvents="none">{it.t + 1}</text>
            {pl.shield && it.sp > 0 && it.sp < game.home && <circle r={r * 1.35} fill="none" stroke="#2457e6" strokeWidth={r * 0.18} strokeDasharray={`${r * 0.5} ${r * 0.3}`} />}
          </g>
        );
      })}
    </svg>
  );
}
