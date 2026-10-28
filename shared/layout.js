// Board geometry for the SVG renderer. Four arms = the classic 15x15 cross; 5-10 arms = a radial board.
import { ARM, LANE, ringIndex } from './engine.js';

const CLASSIC_RING = (() => {
  const p = [];
  const seg = (c, r, dc, dr, n) => { for (let i = 0; i < n; i++) p.push([c + dc * i, r + dr * i]); };
  seg(1, 6, 1, 0, 5); seg(6, 5, 0, -1, 6); seg(7, 0, 1, 0, 2); seg(8, 1, 0, 1, 5);
  seg(9, 6, 1, 0, 6); seg(14, 7, 0, 1, 2); seg(13, 8, -1, 0, 5); seg(8, 9, 0, 1, 6);
  seg(7, 14, -1, 0, 2); seg(6, 13, 0, -1, 5); seg(5, 8, -1, 0, 6); seg(0, 7, 0, -1, 2);
  return p;
})();

function classic() {
  const c = (x, y) => ({ x: x + 0.5, y: y + 0.5 });
  const laneAt = [(k) => [1 + k, 7], (k) => [7, 1 + k], (k) => [13 - k, 7], (k) => [7, 13 - k]];
  const yardC = [[3, 3], [12, 3], [12, 12], [3, 12]];
  const dirs = [[-1, 0], [0, -1], [1, 0], [0, 1]];
  const tris = ['6,6 6,9 7.5,7.5', '6,6 9,6 7.5,7.5', '9,6 9,9 7.5,7.5', '6,9 9,9 7.5,7.5'];
  return {
    kind: 'classic', size: [15, 15], cell: 1, tokenR: 0.38,
    ring: CLASSIC_RING.map(([x, y]) => ({ ...c(x, y), w: 1, rot: 0 })),
    lanes: laneAt.map((f) => Array.from({ length: LANE }, (_, k) => ({ ...c(...f(k)), w: 1, rot: 0 }))),
    yards: yardC.map(([x, y]) => ({
      x, y, rect: { x: x - 3, y: y - 3, w: 6, h: 6 },
      slots: [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]].map(([dx, dy]) => ({ x: x + dx, y: y + dy })),
    })),
    homes: dirs.map(([dx, dy], a) => ({
      tri: tris[a],
      slots: [0, 1, 2, 3].map((t) => ({ x: 7.5 + dx * 1.1 - dy * (t - 1.5) * 0.55, y: 7.5 + dy * 1.1 + dx * (t - 1.5) * 0.55 })),
    })),
    centre: { x: 7.5, y: 7.5 },
  };
}

function radial(arms) {
  const n = arms * ARM; const C = 50; const R = 37; const TAU = Math.PI * 2;
  const ang = (i) => -Math.PI / 2 + (TAU * i) / n;
  const pt = (r, a) => ({ x: C + r * Math.cos(a), y: C + r * Math.sin(a) });
  const cell = Math.min(5.2, ((TAU * R) / n) * 0.86);
  const step = 2.4 + cell * 0.6;
  const tokenR = Math.max(1.15, cell * 0.42);
  const deg = (a) => (a * 180) / Math.PI + 90;
  const ring = Array.from({ length: n }, (_, i) => ({ ...pt(R, ang(i)), w: cell, rot: deg(ang(i)) }));
  const lanes = []; const yards = []; const homes = [];
  for (let a = 0; a < arms; a++) {
    const la = ang(a * ARM - 2); // the last ring square a player visits is start-2
    lanes.push(Array.from({ length: LANE }, (_, k) => ({ ...pt(R - (k + 1) * step, la), w: cell, rot: deg(la) })));
    const hb = pt(R - (LANE + 1) * step, la); const tx = Math.cos(la + Math.PI / 2); const ty = Math.sin(la + Math.PI / 2);
    homes.push({ slots: [0, 1, 2, 3].map((t) => ({ x: hb.x + tx * (t - 1.5) * tokenR * 1.6, y: hb.y + ty * (t - 1.5) * tokenR * 1.6 })) });
    const yc = pt(45, ang(a * ARM + 6));
    yards.push({ ...yc, r: 4.9, slots: [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]].map(([dx, dy]) => ({ x: yc.x + dx, y: yc.y + dy })) });
  }
  return { kind: 'radial', size: [100, 100], cell, tokenR, ring, lanes, yards, homes, centre: { x: C, y: C } };
}

export const buildLayout = (arms) => (arms === 4 ? classic() : radial(arms));

/** Board coordinates of a token at progress p. */
export function tokenPoint(L, g, pi, t, p) {
  const pl = g.players[pi];
  if (p <= 0) return L.yards[pl.arm].slots[t];
  if (p >= g.home) return L.homes[pl.arm].slots[t];
  if (p >= g.ringLen) return L.lanes[pl.arm][p - g.ringLen];
  return L.ring[ringIndex(g, pl, p)];
}
