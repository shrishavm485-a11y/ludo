import { useEffect, useMemo, useState } from 'react';
import { MODES, createGame } from '../../shared/engine.js';
import Board from './Board.jsx';
import { Btn, Card, Dice, Toggle, usePrefs } from './ui.jsx';
import { DEFAULT_STATS, loadSession, loadStats, resetStats } from './lib/storage.js';

const DEMO = (() => {
  const g = createGame(['Ana', 'Ben', 'Cy', 'Di'].map((name, i) => ({ id: `d${i}`, name, color: i })));
  g.players[0].tokens = [9, 22, 0, 0]; g.players[1].tokens = [4, 0, 30, 57]; g.players[2].tokens = [15, 45, 0, 0]; g.players[3].tokens = [1, 33, 0, 0];
  return g;
})();
const MOODS = ['😂', '💀', '😈', '🤡', '🔥', '😭', '👀', '😤'];

export function Menu({ go }) {
  const [face, setFace] = useState(6);
  const [rolling, setRolling] = useState(false);
  const [mood, setMood] = useState(0);
  const shown = useMemo(() => DEMO.players.map((p) => p.tokens), []);
  useEffect(() => { const id = setInterval(() => setMood((m) => (m + 1) % MOODS.length), 1800); return () => clearInterval(id); }, []);
  const roll = () => { setRolling(true); setTimeout(() => { setFace(1 + Math.floor(Math.random() * 6)); setRolling(false); }, 600); };
  const hasSession = !!loadSession();
  const items = [
    ['online', 'PLAY ONLINE', 'red'], ['offline', 'PLAY OFFLINE', 'blue'], ['quick', 'QUICK PLAY', 'green'],
    ['how', 'HOW TO PLAY', 'ghost'], ['settings', 'SETTINGS', 'ghost'], ['stats', 'STATISTICS', 'ghost'],
  ];
  return (
    <div className="page menu">
      <div className="hero">
        <h1 className="logo"><span>LUDO</span><span className="m">MAYHEM</span></h1>
        <p className="tag">Up to 10 friends. One board. Zero mercy. <span className="mood" aria-hidden="true">{MOODS[mood]}</span></p>
        <div className="preview">
          <div className="preview-board"><Board game={DEMO} shown={shown} /></div>
          <div className="preview-dice"><Dice value={face} rolling={rolling} onClick={roll} disabled={rolling} label="Roll the preview dice" /></div>
        </div>
      </div>
      <nav className="menu-list" aria-label="Main menu">
        {hasSession && <Btn variant="yellow big" onClick={() => go('online')}>↩ RETURN TO YOUR ROOM</Btn>}
        {items.map(([id, label, v]) => <Btn key={id} variant={`${v} big`} onClick={() => go(id)}>{label}</Btn>)}
      </nav>
    </div>
  );
}

export function HowTo({ go }) {
  return (
    <div className="page narrow">
      <Btn variant="ghost small" onClick={() => go('menu')}>← Menu</Btn>
      <h1 className="h1">How to play</h1>
      <Card><h3>The basics</h3><ul className="rules-list">{MODES.classic.rules.map((r) => <li key={r}>{r}</li>)}</ul></Card>
      <Card>
        <h3>The expanded board (5 to 10 players)</h3>
        <p>With more than 4 players the board becomes a ring with one arm per player. Nobody shares a start square.</p>
        <ul className="rules-list">
          <li>Every arm has 13 track squares, so a 7-player board has a 91-square ring.</li>
          <li>Each player’s start square (◆) and a star square (★) 8 squares later are safe.</li>
          <li>A token travels almost the whole ring, then turns into its own 5-square home lane and needs an exact roll to reach HOME.</li>
          <li>The 2 and 3 player games use the classic board; 2 players sit opposite each other.</li>
          <li>On a phone use “Zoom in” to follow your token, or tap the token buttons under the dice.</li>
        </ul>
      </Card>
      <Card><h3>Game modes</h3>{Object.values(MODES).map((m) => (<div key={m.label}><h4>{m.label}</h4><p className="muted">{m.blurb}</p></div>))}<p className="muted small">Custom rules (Chaos, Speed, Knockout, Team) are labelled and never apply in Classic.</p></Card>
      <Card>
        <h3>Playing with friends</h3>
        <ul className="rules-list">
          <li><b>Online:</b> one person creates a room and taps COPY INVITE. Friends open the link, or enter the Room ID and Join Code.</li>
          <li><b>Offline:</b> choose the number of players and pass the device when asked.</li>
          <li><b>Reactions:</b> tap the React tab and spam responsibly. There is a short cooldown, and you can mute players or everyone.</li>
          <li>If your connection drops online, your seat is kept and the game plays for you until you are back.</li>
        </ul>
      </Card>
    </div>
  );
}

export function SettingsScreen({ go }) {
  const { prefs, setPrefs } = usePrefs();
  const [done, setDone] = useState(false);
  return (
    <div className="page narrow">
      <Btn variant="ghost small" onClick={() => go('menu')}>← Menu</Btn>
      <h1 className="h1">Settings</h1>
      <Card>
        <Toggle label="Sound effects" checked={prefs.sound} onChange={(v) => setPrefs({ sound: v })} />
        <Toggle label="Haptic feedback" hint="Vibration on supported phones" checked={prefs.haptics} onChange={(v) => setPrefs({ haptics: v })} />
        <Toggle label="Auto-move when there is only one option" checked={prefs.autoMove} onChange={(v) => setPrefs({ autoMove: v })} />
        <Toggle label="Mute all reactions" checked={prefs.muteReactions} onChange={(v) => setPrefs({ muteReactions: v })} />
        <label className="field"><span>Theme</span>
          <select value={prefs.theme} onChange={(e) => setPrefs({ theme: e.target.value })}>
            <option value="auto">Match my device</option><option value="light">Light</option><option value="dark">Dark</option>
          </select>
        </label>
      </Card>
      <Card>
        <h3>Your data</h3>
        <p className="muted">Everything is stored only on this device: no accounts.</p>
        <Btn variant="red small" onClick={() => { resetStats(); setDone(true); }}>Reset statistics</Btn>{done && <span className="muted"> Done.</span>}
      </Card>
    </div>
  );
}

export function StatsScreen({ go }) {
  const s = { ...DEFAULT_STATS, ...loadStats() };
  const wins = Object.entries(s.offlineWins).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <div className="page narrow">
      <Btn variant="ghost small" onClick={() => go('menu')}>← Menu</Btn>
      <h1 className="h1">Statistics</h1>
      <div className="stat-grid">
        {[['Matches', s.games], ['Online', s.onlineGames], ['Offline', s.offlineGames], ['Online wins', s.wins], ['Captures', s.captures], ['Times captured', s.captured], ['Sixes', s.sixes], ['Rolls', s.rolls]].map(([k, v]) => (
          <Card key={k} className="stat"><b>{v}</b><span>{k}</span></Card>
        ))}
      </div>
      {wins.length > 0 && <Card><h3>Offline wins</h3>{wins.map(([n, c]) => <p key={n}>🏆 {n}: {c}</p>)}</Card>}
      <Card><h3>Recent matches</h3>
        {s.recent.length === 0 && <p className="muted">Play a match and it shows up here.</p>}
        {s.recent.map((r) => <p key={r.ts}>{r.online ? '🌐' : '📱'} {MODES[r.mode]?.label || r.mode}, {r.players} players: {r.winners.join(' & ') || 'no winner'} <span className="muted small">{new Date(r.ts).toLocaleDateString()}</span></p>)}
      </Card>
    </div>
  );
}
