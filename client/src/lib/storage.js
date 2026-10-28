const read = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v ? { ...fallback, ...JSON.parse(v) } : fallback; } catch { return fallback; }
};
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / quota */ } };

export const DEFAULT_PREFS = { sound: true, theme: 'auto', haptics: true, muteReactions: false, autoMove: true, name: '', avatar: '😀', color: 0 };
export const loadPrefs = () => read('lm_prefs', DEFAULT_PREFS);
export const savePrefs = (p) => write('lm_prefs', p);

export const DEFAULT_STATS = { games: 0, onlineGames: 0, offlineGames: 0, wins: 0, captures: 0, captured: 0, sixes: 0, rolls: 0, offlineWins: {}, recent: [] };
export const loadStats = () => read('lm_stats', DEFAULT_STATS);
export const resetStats = () => write('lm_stats', DEFAULT_STATS);

/** rows = engine summarize() output. Online: only my row counts as "mine". Offline: all seats on the device. */
export function recordMatch({ online, rows, mePid, mode }) {
  const s = loadStats();
  const mine = online ? rows.filter((r) => r.id === mePid) : rows;
  s.games += 1; s[online ? 'onlineGames' : 'offlineGames'] += 1;
  for (const r of mine) {
    s.captures += r.captures; s.captured += r.captured; s.sixes += r.sixes; s.rolls += r.rolls;
    if (online && r.winner) s.wins += 1;
  }
  const winners = rows.filter((r) => r.winner).map((r) => r.name);
  if (!online) for (const n of winners) s.offlineWins = { ...s.offlineWins, [n]: (s.offlineWins[n] || 0) + 1 };
  s.recent = [{ ts: Date.now(), mode, online, players: rows.length, winners }, ...s.recent].slice(0, 10);
  write('lm_stats', s);
}

export const loadSession = () => { try { return JSON.parse(localStorage.getItem('lm_session')) || null; } catch { return null; } };
export const saveSession = (s) => write('lm_session', s);
export const clearSession = () => { try { localStorage.removeItem('lm_session'); } catch { /* ignore */ } };
