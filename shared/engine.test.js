import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARM, createGame, act, autoPlay, forfeit, legalMoves, summarize, isSafe, ringIndex,
  normalizeSettings, MAX_PLAYERS,
} from './engine.js';
import { buildLayout, tokenPoint } from './layout.js';

const names = (k) => Array.from({ length: k }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
/** rng that returns scripted dice values (1-6) for rng(6) calls */
const dice = (...ds) => { const q = [...ds]; return (max) => { assert.equal(max, 6); return q.shift() - 1; }; };
const roll = (g, d) => act(g, g.players[g.turn].id, { type: 'roll' }, dice(d));
const move = (g, t) => act(g, g.players[g.turn].id, { type: 'move', token: t });
function mulberry(seed) { return (max) => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max); }; }

test('classic board: 52 ring squares, HOME at 57, starts and stars are safe', () => {
  const g = createGame(names(4));
  assert.equal(g.ringLen, 52); assert.equal(g.home, 57);
  for (let a = 0; a < 4; a++) { assert.ok(isSafe(a * ARM)); assert.ok(isSafe(a * ARM + 8)); }
  assert.ok(!isSafe(1)); assert.ok(!isSafe(7));
});

test('a token needs a 6 to leave the yard; no legal move passes the turn', () => {
  const g = createGame(names(4));
  assert.ok(roll(g, 3).ok);
  assert.equal(g.turn, 1, 'turn passed to player 1');
  roll(g, 6);
  assert.deepEqual(g.legal, [0, 1, 2, 3]);
  assert.ok(move(g, 2).ok);
  assert.equal(g.players[1].tokens[2], 1);
  assert.equal(g.turn, 1, 'six gives an extra turn');
});

test('three sixes in a row forfeit the turn', () => {
  const g = createGame(names(4));
  roll(g, 6); move(g, 0); roll(g, 6); move(g, 0);
  const r = roll(g, 6);
  assert.ok(r.events.some((e) => e.t === 'threeSixes'));
  assert.equal(g.turn, 1);
  assert.equal(g.players[0].tokens[0], 7, 'the third six is not played');
});

test('captures happen on normal squares only; safe squares protect', () => {
  const g = createGame(names(4));
  // P2 (arm 2, start ring 26) at progress 34 stands on ring 7, a normal square.
  g.players[2].tokens[0] = 34;
  assert.equal(ringIndex(g, g.players[2], 34), 7);
  g.players[0].tokens[1] = 5; // ring 4 + 3 = ring 7
  g.turn = 0; roll(g, 3);
  const r = move(g, 1);
  assert.ok(r.events.some((e) => e.t === 'capture'));
  assert.equal(g.players[2].tokens[0], 0);
  assert.equal(g.turn, 0, 'capture gives an extra turn');
  // safe square: ring 8 is a star
  const h = createGame(names(4));
  h.players[0].tokens[0] = 5; // ring 4
  h.players[2].tokens[0] = 35; // ring 8 (star)
  roll(h, 4); const r2 = move(h, 0);
  assert.ok(!r2.events.some((e) => e.t === 'capture'));
  assert.equal(h.players[2].tokens[0], 35);
  assert.equal(h.turn, 1, 'no extra turn without 6/capture/home');
});

test('exact roll is required to finish; reaching HOME grants an extra turn', () => {
  const g = createGame(names(4));
  g.players[0].tokens = [55, 0, 0, 0]; // home = 57
  roll(g, 3);
  assert.equal(g.legal.length, 0, 'overshoot is illegal');
  assert.equal(g.turn, 1);
  g.turn = 0; g.phase = 'roll';
  roll(g, 2);
  assert.deepEqual(g.legal, [0]);
  const r = move(g, 0);
  assert.equal(g.players[0].tokens[0], 57);
  assert.ok(r.events.some((e) => e.t === 'home'));
  assert.equal(g.turn, 0);
});

test('winning: all four tokens home ends the match', () => {
  const g = createGame(names(2));
  g.players[0].tokens = [57, 57, 57, 56];
  roll(g, 1); const r = move(g, 3);
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.winner.players, [0]);
  assert.ok(r.events.some((e) => e.t === 'win'));
  assert.equal(roll(g, 1).ok, false);
});

test('only the current player can act; duplicate and stale requests are rejected', () => {
  const g = createGame(names(3));
  assert.equal(act(g, 'p1', { type: 'roll' }, dice(6)).error, 'It is not your turn.');
  assert.equal(act(g, 'ghost', { type: 'roll' }, dice(6)).ok, false);
  assert.equal(move(g, 0).ok, false, 'cannot move before rolling');
  const seq = g.seq;
  assert.ok(act(g, 'p0', { type: 'roll', seq }, dice(6)).ok);
  assert.equal(act(g, 'p0', { type: 'roll', seq }, dice(6)).ok, false, 'second roll rejected');
  assert.equal(move(g, 9).ok, false, 'illegal token');
  assert.ok(move(g, 0).ok);
  assert.equal(move(g, 0).ok, false, 'second move rejected');
});

test('knockout: 3 lives, elimination, last player standing wins', () => {
  const g = createGame(names(2), { mode: 'knockout' });
  g.players[1].lives = 1;
  // 2 players sit on arms 0 and 2: P1 at progress 34 stands on ring 7
  g.players[1].tokens = [34, 0, 0, 0];
  g.players[0].tokens[1] = 5; roll(g, 3);
  const r = move(g, 1);
  assert.ok(r.events.some((e) => e.t === 'eliminated'));
  assert.equal(g.phase, 'over');
  assert.equal(g.winner.reason, 'lastStanding');
});

test('team mode: partners never capture each other; team wins together', () => {
  const g = createGame(names(4), { mode: 'team' });
  assert.equal(g.players[0].team, g.players[2].team);
  g.players[2].tokens[0] = 34;    // partner stands on ring 7
  g.players[0].tokens[1] = 5; roll(g, 3);
  const r = move(g, 1);
  assert.ok(!r.events.some((e) => e.t === 'capture'));
  const h = createGame(names(4), { mode: 'team' });
  h.players[0].tokens = [57, 57, 57, 57]; h.players[2].tokens = [57, 57, 57, 56];
  h.turn = 2; roll(h, 1); move(h, 3);
  assert.deepEqual(h.winner.players.sort(), [0, 2]);
  assert.throws(() => createGame(names(3), { mode: 'team' }));
});

test('chaos events never occur outside chaos rules', () => {
  const g = createGame(names(4), { mode: 'classic', rules: 'chaos' });
  assert.equal(g.chaos, false);
  const c = createGame(names(4), { mode: 'chaos' });
  assert.equal(c.chaos, true);
  let seen = false; const rng = mulberry(7);
  for (let i = 0; i < 400 && !seen; i++) { const r = autoPlay(c, rng); seen = r.events.some((e) => e.t === 'chaos'); if (c.phase === 'over') break; }
  assert.ok(seen, 'chaos rolled at least once');
});

test('forfeit removes a player and passes the turn; last player wins', () => {
  const g = createGame(names(3));
  forfeit(g, 'p0'); assert.equal(g.turn, 1);
  forfeit(g, 'p1'); assert.equal(g.phase, 'over'); assert.deepEqual(g.winner.players, [2]);
});

test('settings are validated server-side', () => {
  const s = normalizeSettings({ maxPlayers: 99, timer: 7, mode: 'nope', name: '<b>x</b>' });
  assert.equal(s.maxPlayers, MAX_PLAYERS); assert.equal(s.timer, 30); assert.equal(s.mode, 'classic'); assert.equal(s.name, 'bx/b');
  assert.equal(normalizeSettings({ mode: 'speed' }).timer, 15);
  assert.equal(normalizeSettings({ mode: 'classic', rules: 'chaos' }).rules, 'friendly');
  assert.equal(normalizeSettings({ mode: 'team', maxPlayers: 5 }).maxPlayers, 4);
});

for (let k = 2; k <= MAX_PLAYERS; k++) {
  test(`${k} players: valid unique paths, distinct board points, and a full match finishes`, () => {
    const g = createGame(names(k));
    const L = buildLayout(g.arms);
    assert.equal(new Set(g.players.map((p) => p.arm)).size, k, 'unique arms');
    const starts = g.players.map((p) => ringIndex(g, p, 1));
    assert.equal(new Set(starts).size, k, 'unique start squares');
    starts.forEach((s) => assert.ok(isSafe(s)));
    // every path visits ringLen-1 distinct ring squares then 5 lane squares
    for (const p of g.players) {
      const ring = new Set(); for (let q = 1; q < g.ringLen; q++) ring.add(ringIndex(g, p, q));
      assert.equal(ring.size, g.ringLen - 1);
    }
    // board points: ring + lanes + yards + homes never overlap
    const pts = [...L.ring, ...L.lanes.flat()].map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`);
    assert.equal(new Set(pts).size, pts.length, 'no overlapping squares');
    // consecutive path points are close together (continuous path) for every player
    for (let i = 0; i < k; i++) {
      let prev = tokenPoint(L, g, i, 0, 1);
      for (let p = 2; p < g.home; p++) {
        const c = tokenPoint(L, g, i, 0, p);
        assert.ok(Math.hypot(c.x - prev.x, c.y - prev.y) < (L.kind === 'classic' ? 1.5 : 7), `gap at p=${p}, player ${i}`);
        prev = c;
      }
    }
    // full automated match
    const rng = mulberry(1000 + k); let steps = 0;
    while (g.phase !== 'over' && steps++ < 200000) assert.ok(autoPlay(g, rng).ok);
    assert.equal(g.phase, 'over', 'match finished');
    assert.ok(g.winner.players.length >= 1);
    assert.equal(summarize(g)[0].winner, true);
    for (const p of g.players) p.tokens.forEach((x) => assert.ok(x >= 0 && x <= g.home));
  });
}
