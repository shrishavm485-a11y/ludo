// LUDO MAYHEM rules engine. Pure JavaScript, no DOM, no network: the browser (offline mode)
// and the server (online mode) run exactly this code.
//
// Board model: the shared track is a ring of `arms * 13` squares. Every player owns one arm
// (their start square is at ring index arm*13). Four arms = the classic board; 5-10 players
// get as many arms as players, so every player has a unique start, path, safe squares and home lane.
//
// Token progress `p`:  0 = yard | 1..ringLen-1 = ring | ringLen..ringLen+4 = home lane | ringLen+5 = HOME
import { cleanText } from './social.js';

export const ARM = 13;
export const LANE = 5;
export const TOKENS = 4;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const LIVES = 3;
export const CHAOS_CHANCE = 20; // percent, per roll, only when chaos rules are active
export const CHAOS_EVENTS = ['sixStorm', 'bonusTurn', 'shield'];

export const PALETTE = [
  { name: 'Red', hex: '#e63232' },
  { name: 'Green', hex: '#1fa84f' },
  { name: 'Yellow', hex: '#ffd100' },
  { name: 'Blue', hex: '#2457e6' },
  { name: 'Orange', hex: '#ff8a1f' },
  { name: 'Purple', hex: '#8b3fd9' },
  { name: 'Teal', hex: '#12b5a6' },
  { name: 'Pink', hex: '#ff5fa8' },
  { name: 'Brown', hex: '#8a5a3c' },
  { name: 'Lime', hex: '#9bd400' },
];

const BASE_RULES = [
  'Roll a 6 to bring a token out of the yard.',
  'Move a token by the dice number. Land exactly on HOME: you cannot overshoot.',
  'Landing on an opponent’s token captures it and sends it back to its yard.',
  'Start squares (◆) and star squares (★) are safe: no captures there.',
  'A 6, a capture or reaching HOME gives an extra turn. Three 6s in a row forfeit the turn.',
  'First player to bring all 4 tokens HOME wins.',
];

export const MODES = {
  classic: { label: 'Classic', blurb: 'Standard Ludo. No custom rules.', rules: BASE_RULES },
  chaos: {
    label: 'Chaos',
    blurb: 'Standard Ludo plus random chaos events (custom rules).',
    rules: [...BASE_RULES, 'CUSTOM: each roll has a 20% chance of a chaos event: SIX STORM (the roll becomes a 6), BONUS TURN (roll again after this turn) or SHIELD (your tokens cannot be captured until your next roll).'],
  },
  speed: {
    label: 'Speed',
    blurb: 'Standard rules, 15-second turns.',
    rules: [...BASE_RULES, 'CUSTOM: every decision has a 15-second timer. When it runs out the game rolls or moves for you.'],
  },
  knockout: {
    label: 'Knockout',
    blurb: 'Lose your lives and you are out.',
    rules: [...BASE_RULES, 'CUSTOM: every player has 3 lives. Each captured token costs one life. At 0 lives you are eliminated and become a spectator. Last player standing also wins.'],
  },
  team: {
    label: 'Team',
    blurb: 'Partners sit opposite each other (4, 6, 8 or 10 players).',
    rules: [...BASE_RULES, 'CUSTOM: players are paired with the player sitting opposite them. Partners never capture each other. A team wins when both partners have all 4 tokens HOME.'],
  },
};

export const TIMERS = [15, 30, 45, 60, 0]; // 0 = unlimited
export const DEFAULT_SETTINGS = {
  name: 'Ludo Room', maxPlayers: 4, mode: 'classic', timer: 30,
  isPublic: false, spectators: true, reactions: true, rules: 'friendly',
};

/** Validate and normalise room settings (used by the server and by the setup forms). */
export function normalizeSettings(raw = {}, base = DEFAULT_SETTINGS) {
  const s = { ...base };
  if (typeof raw.name === 'string') s.name = cleanText(raw.name, 28) || base.name;
  if (Number.isInteger(raw.maxPlayers)) s.maxPlayers = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, raw.maxPlayers));
  if (typeof raw.mode === 'string' && Object.hasOwn(MODES, raw.mode)) s.mode = raw.mode;
  if (TIMERS.includes(raw.timer)) s.timer = raw.timer;
  for (const k of ['isPublic', 'spectators', 'reactions']) if (typeof raw[k] === 'boolean') s[k] = raw[k];
  if (raw.rules === 'friendly' || raw.rules === 'chaos') s.rules = raw.rules;
  if (s.mode === 'speed') s.timer = 15;
  if (s.mode === 'classic') s.rules = 'friendly';
  if (s.mode === 'team') { if (s.maxPlayers % 2) s.maxPlayers -= 1; if (s.maxPlayers < 4) s.maxPlayers = 4; }
  return s;
}

export const armsFor = (k) => Math.max(4, k);
export const seatArms = (k) => (k === 2 ? [0, 2] : Array.from({ length: k }, (_, i) => i));
export const isSafe = (ring) => ring % ARM === 0 || ring % ARM === 8;
export const ringIndex = (g, pl, p) => (pl.arm * ARM + p - 1) % g.ringLen;
export const isDone = (g, pl) => pl.tokens.every((p) => p >= g.home);
export const progressOf = (pl) => pl.tokens.reduce((a, b) => a + b, 0);

const fail = (error) => ({ ok: false, error, events: [] });
const ok = (events) => ({ ok: true, events });

/** players: [{id, name, color?, avatar?}] in seating order (2-10). */
export function createGame(players, { mode = 'classic', rules = 'friendly' } = {}) {
  const k = players.length;
  if (k < MIN_PLAYERS || k > MAX_PLAYERS) throw new Error('Ludo needs 2 to 10 players.');
  if (!Object.hasOwn(MODES, mode)) throw new Error('Unknown game mode.');
  if (mode === 'team' && (k < 4 || k % 2)) throw new Error('Team mode needs 4, 6, 8 or 10 players.');
  const arms = armsFor(k);
  const arm = seatArms(k);
  return {
    gid: Math.random().toString(36).slice(2, 8),
    arms, ringLen: arms * ARM, home: arms * ARM + LANE,
    mode, chaos: mode === 'chaos' || (rules === 'chaos' && mode !== 'classic'),
    seq: 0, turn: 0, phase: 'roll', dice: null, sixes: 0, extra: false, legal: [], winner: null,
    players: players.map((p, i) => ({
      id: p.id, name: p.name, avatar: p.avatar || '🙂', color: Number.isInteger(p.color) ? p.color : i,
      arm: arm[i], team: mode === 'team' ? i % (k / 2) : i,
      tokens: [0, 0, 0, 0], lives: LIVES, out: false, shield: false,
      stats: { rolls: 0, sixes: 0, captures: 0, captured: 0 },
    })),
  };
}

export function legalMoves(g, pi = g.turn) {
  if (g.dice == null) return [];
  const out = [];
  g.players[pi].tokens.forEach((p, t) => {
    if (p === 0 ? g.dice === 6 : p < g.home && p + g.dice <= g.home) out.push(t);
  });
  return out;
}

/** Opponent tokens [playerIdx, tokenIdx, progress] that a token arriving at progress `to` would capture. */
export function victimsAt(g, pi, to) {
  const me = g.players[pi];
  if (to < 1 || to >= g.ringLen) return [];
  const r = ringIndex(g, me, to);
  if (isSafe(r)) return [];
  const out = [];
  g.players.forEach((q, qi) => {
    if (q.out || q.team === me.team || q.shield) return;
    q.tokens.forEach((qp, qt) => { if (qp > 0 && qp < g.ringLen && ringIndex(g, q, qp) === r) out.push([qi, qt, qp]); });
  });
  return out;
}

function advance(g) {
  const k = g.players.length;
  for (let i = 1; i <= k; i++) {
    const n = (g.turn + i) % k;
    const q = g.players[n];
    if (!q.out && !isDone(g, q)) { g.turn = n; return; }
  }
}

function endTurn(g, ev) {
  g.phase = 'roll'; g.legal = [];
  const pl = g.players[g.turn];
  if (g.extra && !pl.out && !isDone(g, pl)) { g.extra = false; ev.push({ t: 'extraTurn', p: g.turn }); return; }
  g.extra = false; g.sixes = 0; advance(g);
}

function checkWinner(g, ev) {
  if (g.phase === 'over') return;
  const alive = g.players.map((_, i) => i).filter((i) => !g.players[i].out);
  let team = null; let reason = 'home';
  for (const i of alive) {
    const t = g.players[i].team;
    if (g.players.every((p) => p.team !== t || p.out || isDone(g, p))) { team = t; break; }
  }
  if (team === null && alive.length && new Set(alive.map((i) => g.players[i].team)).size === 1) {
    team = g.players[alive[0]].team; reason = 'lastStanding';
  }
  if (team === null) return;
  const players = alive.filter((i) => g.players[i].team === team);
  g.phase = 'over'; g.legal = []; g.winner = { players, team, reason };
  ev.push({ t: 'win', players, reason });
}

function doRoll(g, rng) {
  if (g.phase !== 'roll') return fail('You already rolled: pick a token to move.');
  const pi = g.turn; const pl = g.players[pi]; const ev = [];
  pl.shield = false; g.extra = false;
  let chaos = null;
  if (g.chaos && rng(100) < CHAOS_CHANCE) chaos = CHAOS_EVENTS[rng(CHAOS_EVENTS.length)];
  const d = chaos === 'sixStorm' ? 6 : rng(6) + 1;
  g.dice = d; g.seq++; pl.stats.rolls++; if (d === 6) pl.stats.sixes++;
  ev.push({ t: 'roll', p: pi, d });
  if (chaos) {
    ev.push({ t: 'chaos', p: pi, kind: chaos });
    if (chaos === 'bonusTurn') g.extra = true;
    if (chaos === 'shield') pl.shield = true;
  }
  g.sixes = d === 6 ? g.sixes + 1 : 0;
  if (g.sixes >= 3) { ev.push({ t: 'threeSixes', p: pi }); g.extra = false; endTurn(g, ev); return ok(ev); }
  g.legal = legalMoves(g);
  if (!g.legal.length) { ev.push({ t: 'noMove', p: pi }); endTurn(g, ev); } else g.phase = 'move';
  return ok(ev);
}

function doMove(g, t) {
  if (g.phase !== 'move') return fail('Roll the dice first.');
  if (!Number.isInteger(t) || !g.legal.includes(t)) return fail('That token cannot move.');
  const pi = g.turn; const pl = g.players[pi]; const ev = [];
  const from = pl.tokens[t]; const to = from === 0 ? 1 : from + g.dice;
  g.seq++; pl.tokens[t] = to;
  ev.push({ t: 'move', p: pi, tok: t, from, to });
  if (from === 0) ev.push({ t: 'exit', p: pi, tok: t });
  let extra = g.dice === 6 || g.extra;
  for (const [qi, qt, qp] of victimsAt(g, pi, to)) {
    const q = g.players[qi];
    q.tokens[qt] = 0; q.stats.captured++; pl.stats.captures++; extra = true;
    ev.push({ t: 'capture', p: pi, victim: qi, tok: qt, from: qp });
    if (g.mode === 'knockout' && !q.out && --q.lives <= 0) {
      q.out = true; q.tokens = [0, 0, 0, 0]; ev.push({ t: 'eliminated', p: qi });
    }
  }
  if (to === g.home) { extra = true; ev.push({ t: 'home', p: pi, tok: t }); }
  g.extra = extra; g.legal = [];
  checkWinner(g, ev);
  if (g.phase !== 'over') endTurn(g, ev);
  return ok(ev);
}

/**
 * The single entry point for gameplay. Mutates `g` and returns {ok, error?, events}.
 * Rejects wrong players, wrong phase, stale `seq` values (duplicate submissions) and illegal moves.
 * rng(max) must return an integer in [0, max).
 */
export function act(g, playerId, action, rng) {
  if (g.phase === 'over') return fail('The match is over.');
  const pi = g.players.findIndex((p) => p.id === playerId);
  if (pi < 0) return fail('You are not playing in this match.');
  if (pi !== g.turn) return fail('It is not your turn.');
  if (action && action.seq !== undefined && action.seq !== g.seq) return fail('Stale request ignored.');
  if (action?.type === 'roll') return doRoll(g, rng);
  if (action?.type === 'move') return doMove(g, action.token);
  return fail('Unknown action.');
}

function bestMove(g) {
  const pi = g.turn; const pl = g.players[pi]; let best = g.legal[0]; let bestScore = -1;
  for (const t of g.legal) {
    const from = pl.tokens[t]; const to = from === 0 ? 1 : from + g.dice;
    let s = to + (from === 0 ? 30 : 0) + victimsAt(g, pi, to).length * 100;
    if (to === g.home) s += 60;
    else if (to >= g.ringLen) s += 20;
    else if (isSafe(ringIndex(g, pl, to))) s += 15;
    if (s > bestScore) { best = t; bestScore = s; }
  }
  return best;
}

/** One automatic step (roll, or the best move) for the current player: timeouts, disconnected players. */
export function autoPlay(g, rng) {
  const id = g.players[g.turn]?.id;
  if (g.phase === 'roll') return act(g, id, { type: 'roll' }, rng);
  if (g.phase === 'move') return act(g, id, { type: 'move', token: bestMove(g) }, rng);
  return fail('Nothing to play.');
}

/** A player leaves or is kicked mid-match. */
export function forfeit(g, playerId) {
  const i = g.players.findIndex((p) => p.id === playerId);
  if (i < 0 || g.players[i].out || g.phase === 'over') return [];
  const ev = [{ t: 'left', p: i }];
  g.players[i].out = true; g.players[i].tokens = [0, 0, 0, 0]; g.seq++;
  checkWinner(g, ev);
  if (g.phase !== 'over' && g.turn === i) { g.extra = false; g.phase = 'roll'; g.legal = []; g.sixes = 0; advance(g); }
  return ev;
}

export function summarize(g) {
  return g.players.map((p, i) => ({
    index: i, id: p.id, name: p.name, avatar: p.avatar, color: p.color, team: p.team, out: p.out,
    home: p.tokens.filter((x) => x >= g.home).length, progress: progressOf(p),
    winner: !!g.winner?.players.includes(i), ...p.stats,
  })).sort((a, b) => (b.winner - a.winner) || (a.out - b.out) || (b.progress - a.progress));
}

export function eventText(g, e) {
  const n = (i) => g.players[i]?.name ?? '?';
  switch (e.t) {
    case 'roll': return `${n(e.p)} rolled a ${e.d}`;
    case 'exit': return `${n(e.p)} brought a token out`;
    case 'capture': return `${n(e.p)} captured ${n(e.victim)}’s token 💥`;
    case 'home': return `${n(e.p)} got a token HOME 🏠`;
    case 'extraTurn': return `${n(e.p)} plays again`;
    case 'threeSixes': return `${n(e.p)} rolled three 6s and loses the turn`;
    case 'noMove': return `${n(e.p)} has no legal move`;
    case 'chaos': return `CHAOS: ${{ sixStorm: 'SIX STORM, roll becomes a 6', bonusTurn: 'BONUS TURN', shield: 'SHIELD up' }[e.kind]} for ${n(e.p)}`;
    case 'eliminated': return `${n(e.p)} is knocked out ☠️`;
    case 'left': return `${n(e.p)} left the match`;
    case 'win': return `🏆 ${e.players.map(n).join(' & ')} won!`;
    default: return null;
  }
}

/** Secure browser/Node RNG: rng(max) -> integer in [0, max), unbiased. */
export function secureRng() {
  const buf = new Uint32Array(1);
  return (max) => {
    const lim = Math.floor(0x100000000 / max) * max;
    let x;
    do { globalThis.crypto.getRandomValues(buf); x = buf[0]; } while (x >= lim);
    return x % max;
  };
}
