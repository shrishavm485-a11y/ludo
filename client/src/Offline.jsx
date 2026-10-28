import { useEffect, useRef, useState } from 'react';
import { MODES, PALETTE, act, autoPlay, createGame, eventText, secureRng, summarize } from '../../shared/engine.js';
import { AVATARS } from '../../shared/social.js';
import GameView, { useFloats } from './GameView.jsx';
import Victory from './Victory.jsx';
import { Avatar, Btn, Card, Modal, Toggle, useToast } from './ui.jsx';
import { recordMatch } from './lib/storage.js';
import { sfx } from './lib/sound.js';

const modeOk = (mode, n) => mode !== 'team' || (n >= 4 && n % 2 === 0);

function Setup({ onStart, onBack }) {
  const [n, setN] = useState(4);
  const [mode, setMode] = useState('classic');
  const [chaos, setChaos] = useState(false);
  const [timer, setTimer] = useState(0);
  const [privacy, setPrivacy] = useState(true);
  const [names, setNames] = useState(() => Array.from({ length: 10 }, (_, i) => `Player ${i + 1}`));
  const error = modeOk(mode, n) ? '' : 'Team mode needs 4, 6, 8 or 10 players.';
  const start = () => onStart({
    mode, rules: chaos && mode !== 'classic' ? 'chaos' : 'friendly', privacy,
    timer: mode === 'speed' ? 15 : timer,
    players: names.slice(0, n).map((name, i) => ({ id: `p${i}`, name: name.trim().slice(0, 16) || `Player ${i + 1}`, color: i, avatar: AVATARS[i % AVATARS.length] })),
  });
  return (
    <div className="page narrow">
      <Btn variant="ghost small" onClick={onBack}>← Menu</Btn>
      <h1 className="h1">Play offline</h1>
      <p className="muted">One phone or computer, no internet needed. Pass the device around.</p>
      <Card>
        <h3>How many players?</h3>
        <div className="seg" role="radiogroup" aria-label="Number of players">
          {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => <button key={k} type="button" role="radio" aria-checked={n === k} className={`segbtn${n === k ? ' on' : ''}`} onClick={() => setN(k)}>{k}</button>)}
        </div>
        <p className="muted small">{n <= 4 ? 'Classic cross board.' : `Expanded ${n}-arm board: every player gets their own start, path and home lane.`}</p>
      </Card>
      <Card>
        <h3>Game mode</h3>
        <label className="field"><span>Mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {Object.entries(MODES).map(([id, m]) => <option key={id} value={id}>{m.label}: {m.blurb}</option>)}
          </select>
        </label>
        {mode !== 'classic' && mode !== 'chaos' && <Toggle label="Add chaos events" hint="Custom rules, random bonus events" checked={chaos} onChange={setChaos} />}
        {mode !== 'speed' && (
          <label className="field"><span>Turn timer</span>
            <select value={timer} onChange={(e) => setTimer(Number(e.target.value))}>
              <option value={0}>Unlimited</option>{[15, 30, 45, 60].map((t) => <option key={t} value={t}>{t} seconds</option>)}
            </select>
          </label>
        )}
        <Toggle label="“Pass the device” screen" hint="Hides the board between players" checked={privacy} onChange={setPrivacy} />
        <details className="rules"><summary>Rules for this mode</summary><ul>{MODES[mode].rules.map((r) => <li key={r}>{r}</li>)}</ul></details>
      </Card>
      <Card>
        <h3>Names</h3>
        <div className="names">
          {Array.from({ length: n }, (_, i) => (
            <label key={i} className="namerow"><Avatar emoji={AVATARS[i % AVATARS.length]} color={i} size={34} />
              <input value={names[i]} maxLength={16} aria-label={`Player ${i + 1} name`} onChange={(e) => setNames((a) => a.map((v, j) => (j === i ? e.target.value : v)))} />
              <span className="muted small">{PALETTE[i].name}</span>
            </label>
          ))}
        </div>
      </Card>
      {error && <p className="error" role="alert">{error}</p>}
      <Btn variant="red big" disabled={!!error} onClick={start}>START GAME</Btn>
    </div>
  );
}

function LocalGame({ config, onExit }) {
  const toast = useToast();
  const rng = useRef(secureRng());
  const [game, setGame] = useState(() => createGame(config.players, { mode: config.mode, rules: config.rules }));
  const gref = useRef(game);
  const [events, setEvents] = useState([]);
  const [eventSeq, setEventSeq] = useState(0);
  const [feed, setFeed] = useState([]);
  const [paused, setPaused] = useState(false);
  const [handoff, setHandoff] = useState(config.privacy);
  const [scores, setScores] = useState({});
  const [floats, pushFloat] = useFloats();
  const [deadline, setDeadline] = useState(null);
  const [summary, setSummary] = useState(null);
  const [showBoard, setShowBoard] = useState(false);
  const startedAt = useRef(Date.now());
  const lastTurn = useRef(0);

  const commit = (g, res) => {
    gref.current = g; setGame(g); setEvents(res.events); setEventSeq((s) => s + 1);
    setFeed((f) => [...f, ...res.events.map((e) => ({ ts: Date.now(), text: eventText(g, e) })).filter((x) => x.text)].slice(-40));
    if (g.phase === 'over') {
      const rows = summarize(g);
      const winners = rows.filter((r) => r.winner).map((r) => r.name);
      setSummary({ rows, mode: g.mode, winners, durationMs: Date.now() - startedAt.current, reason: g.winner?.reason === 'lastStanding' ? 'Last player standing' : 'All tokens home' });
      setScores((s) => { const n = { ...s }; g.winner.players.forEach((i) => { n[g.players[i].id] = (n[g.players[i].id] || 0) + 1; }); return n; });
      recordMatch({ online: false, rows, mode: g.mode });
    }
  };
  const apply = (action) => {
    const g = structuredClone(gref.current);
    const res = act(g, g.players[g.turn].id, action, rng.current);
    if (!res.ok) { toast(res.error); sfx.error(); return; }
    commit(g, res);
  };
  const autoRef = useRef();
  autoRef.current = () => {
    const g = structuredClone(gref.current);
    if (g.phase === 'over') return;
    const res = autoPlay(g, rng.current);
    if (res.ok) commit(g, res);
  };

  // hand the device to the next player when the turn changes
  useEffect(() => {
    if (game.turn !== lastTurn.current && game.phase !== 'over' && config.privacy) setHandoff(true);
    lastTurn.current = game.turn;
  }, [game.turn, game.phase, config.privacy]);

  // turn timer (optional): restarts on every decision, pauses with the pause / hand-off screens
  useEffect(() => {
    if (!config.timer || paused || handoff || game.phase === 'over') { setDeadline(null); return undefined; }
    const d = Date.now() + config.timer * 1000;
    setDeadline(d);
    const id = setTimeout(() => autoRef.current(), config.timer * 1000);
    return () => clearTimeout(id);
  }, [config.timer, paused, handoff, game.seq, game.turn, game.phase]);

  const restart = () => {
    const g = createGame(config.players, { mode: config.mode, rules: config.rules });
    gref.current = g; setGame(g); setEvents([]); setFeed([]); setSummary(null); setShowBoard(false); setPaused(false);
    setHandoff(config.privacy); lastTurn.current = 0; startedAt.current = Date.now();
  };

  const cur = game.players[game.turn];
  const canAct = !paused && !handoff && game.phase !== 'over';
  const onReact = ({ from, target, emoji, label, text }) => { sfx.pop(); pushFloat({ from, target, emoji, label, text }); };

  return (
    <>
      <GameView
        game={game} events={events} eventSeq={eventSeq} me={null} canAct={canAct}
        onRoll={() => apply({ type: 'roll' })} onMove={(t) => apply({ type: 'move', token: t })}
        deadline={deadline} startedAt={startedAt.current} feed={feed} floats={floats} scores={scores}
        react={{ enabled: true, onReact }} senders={game.players.map((p) => ({ id: p.id, name: p.name }))}
        toolbar={<Btn variant="ghost small" onClick={() => setPaused(true)}>Pause</Btn>}
        overlay={(
          <>
            {handoff && !paused && game.phase !== 'over' && (
              <Modal label="Pass the device" className="handoff">
                <h2>Pass the device to</h2>
                <Avatar emoji={cur.avatar} color={cur.color} size={84} />
                <h1 className="h1">{cur.name}</h1>
                <p className="muted">Nobody else peeks. Tap when you are holding it.</p>
                <Btn variant="green big" onClick={() => setHandoff(false)}>I’m {cur.name}: let’s go</Btn>
              </Modal>
            )}
            {paused && (
              <Modal label="Paused" className="pause">
                <h2>Paused</h2>
                <Btn variant="green big" onClick={() => setPaused(false)}>Resume</Btn>
                <Btn variant="ghost" onClick={restart}>New game (same players)</Btn>
                <Btn variant="red" onClick={onExit}>Quit to menu</Btn>
              </Modal>
            )}
            {summary && !showBoard && (
              <Victory summary={summary} onClose={() => setShowBoard(true)}>
                <Btn variant="green" onClick={restart}>Rematch</Btn>
                <Btn variant="ghost" onClick={onExit}>Menu</Btn>
              </Victory>
            )}
            {summary && showBoard && (
              <div className="floating-actions"><Btn variant="green small" onClick={() => setShowBoard(false)}>Results</Btn><Btn variant="green small" onClick={restart}>Rematch</Btn></div>
            )}
          </>
        )}
      />
    </>
  );
}

export default function Offline({ onExit }) {
  const [config, setConfig] = useState(null);
  if (!config) return <Setup onStart={setConfig} onBack={onExit} />;
  return <LocalGame config={config} onExit={onExit} />;
}
