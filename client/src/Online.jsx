import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, MAX_PLAYERS, MODES, PALETTE, TIMERS, normalizeSettings } from '../../shared/engine.js';
import { AVATARS } from '../../shared/social.js';
import GameView, { useFloats } from './GameView.jsx';
import Victory, { SummaryTable } from './Victory.jsx';
import { ChatPanel } from './Panels.jsx';
import { Avatar, Btn, Card, Modal, Toggle, colorHex, copyText, usePrefs, useToast } from './ui.jsx';
import { call, socket } from './lib/socket.js';
import { clearSession, loadSession, recordMatch, saveSession } from './lib/storage.js';
import { sfx } from './lib/sound.js';

const inviteText = (v) => `Join my LUDO MAYHEM game! 🎲\nRoom ID: ${v.id}\nJoin Code: ${v.code}\n${window.location.origin}/?room=${v.id}&code=${v.code}`;

function ProfileFields({ takenColors = [] }) {
  const { prefs, setPrefs } = usePrefs();
  return (
    <Card>
      <label className="field"><span>Nickname</span>
        <input value={prefs.name} maxLength={16} placeholder="Your nickname" onChange={(e) => setPrefs({ name: e.target.value })} />
      </label>
      <div className="field"><span>Avatar</span>
        <div className="pick">{AVATARS.map((a) => <button key={a} type="button" className={`pickbtn${prefs.avatar === a ? ' on' : ''}`} aria-label={`Avatar ${a}`} aria-pressed={prefs.avatar === a} onClick={() => setPrefs({ avatar: a })}>{a}</button>)}</div>
      </div>
      <div className="field"><span>Preferred color</span>
        <div className="pick">{PALETTE.map((c, i) => (
          <button key={c.name} type="button" className={`swatch${prefs.color === i ? ' on' : ''}`} style={{ background: c.hex }} disabled={takenColors.includes(i)} aria-label={c.name} aria-pressed={prefs.color === i} onClick={() => setPrefs({ color: i })} />
        ))}</div>
      </div>
    </Card>
  );
}

export function SettingsForm({ value, onChange, disabled }) {
  const set = (patch) => onChange(patch);
  return (
    <div className="form">
      <label className="field"><span>Room name</span><input value={value.name} maxLength={28} disabled={disabled} onChange={(e) => set({ name: e.target.value })} /></label>
      <label className="field"><span>Players (2 to {MAX_PLAYERS})</span>
        <select value={value.maxPlayers} disabled={disabled} onChange={(e) => set({ maxPlayers: Number(e.target.value) })}>
          {Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} players</option>)}
        </select>
      </label>
      <label className="field"><span>Game mode</span>
        <select value={value.mode} disabled={disabled} onChange={(e) => set({ mode: e.target.value })}>
          {Object.entries(MODES).map(([id, m]) => <option key={id} value={id}>{m.label}: {m.blurb}</option>)}
        </select>
      </label>
      <label className="field"><span>Turn timer</span>
        <select value={value.timer} disabled={disabled || value.mode === 'speed'} onChange={(e) => set({ timer: Number(e.target.value) })}>
          {TIMERS.map((t) => <option key={t} value={t}>{t ? `${t} seconds` : 'Unlimited'}</option>)}
        </select>
      </label>
      <label className="field"><span>Rules</span>
        <select value={value.rules} disabled={disabled || value.mode === 'classic'} onChange={(e) => set({ rules: e.target.value })}>
          <option value="friendly">Friendly (standard)</option><option value="chaos">Chaos (custom events)</option>
        </select>
      </label>
      <Toggle label="Public room" hint="Listed by name and ID. The join code is never shown." checked={value.isPublic} onChange={(v) => set({ isPublic: v })} />
      <Toggle label="Allow spectators" checked={value.spectators} onChange={(v) => set({ spectators: v })} />
      <Toggle label="Rage reactions" checked={value.reactions} onChange={(v) => set({ reactions: v })} />
      <details className="rules"><summary>Rules for {MODES[value.mode].label} mode</summary><ul>{MODES[value.mode].rules.map((r) => <li key={r}>{r}</li>)}</ul></details>
    </div>
  );
}

function OnlineHome({ initial, quickNow, onAccept, onBack, conn }) {
  const { prefs } = usePrefs();
  const toast = useToast();
  const [tab, setTab] = useState(initial?.room ? 'join' : 'create');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [code, setCode] = useState('');
  const [roomId, setRoomId] = useState(initial?.room || '');
  const [joinCode, setJoinCode] = useState(initial?.code || '');
  const [spectate, setSpectate] = useState(false);
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const profile = () => ({ nickname: prefs.name, avatar: prefs.avatar, color: prefs.color });

  const go = async (event, data) => {
    setBusy(true);
    const r = await call(event, { ...profile(), ...data });
    setBusy(false);
    if (!r.ok) { toast(r.error); sfx.error(); return; }
    onAccept(r);
  };
  const refresh = async () => { const r = await call('room:list'); setList(r.ok ? r.rooms : []); };
  useEffect(() => { if (tab === 'public' && conn === 'online') refresh(); }, [tab, conn]);
  useEffect(() => { if (quickNow && conn === 'online') go('room:quick', {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [quickNow, conn]);

  const offline = conn !== 'online';
  return (
    <div className="page narrow">
      <Btn variant="ghost small" onClick={onBack}>← Menu</Btn>
      <h1 className="h1">Play online</h1>
      {offline && <div className="banner warn" role="status">Connecting to the server… The free Render plan can take up to a minute to wake up.</div>}
      <ProfileFields />
      <div className="tabs" role="tablist">
        {[['create', 'Create room'], ['join', 'Join room'], ['quick', 'Quick play'], ['public', 'Public rooms']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'create' && (
        <Card>
          <SettingsForm value={settings} onChange={(p) => setSettings((s) => normalizeSettings(p, s))} />
          <label className="field"><span>Join code (optional, 4 to 6 letters or numbers)</span>
            <input value={code} maxLength={6} placeholder="Leave empty for a random code" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </label>
          <Btn variant="red big" disabled={busy || offline} onClick={() => go('room:create', { settings, code })}>CREATE ROOM</Btn>
        </Card>
      )}
      {tab === 'join' && (
        <Card>
          <label className="field"><span>Room ID</span><input value={roomId} maxLength={8} placeholder="LM4821" autoCapitalize="characters" onChange={(e) => setRoomId(e.target.value.toUpperCase())} /></label>
          <label className="field"><span>Join code</span><input value={joinCode} maxLength={6} placeholder="7392" autoCapitalize="characters" onChange={(e) => setJoinCode(e.target.value.toUpperCase())} /></label>
          <Toggle label="Join as spectator" checked={spectate} onChange={setSpectate} />
          <Btn variant="blue big" disabled={busy || offline || !roomId || !joinCode} onClick={() => go('room:join', { roomId, code: joinCode, spectate })}>JOIN ROOM</Btn>
        </Card>
      )}
      {tab === 'quick' && (
        <Card>
          <p>Creates a 4-player Classic room with sensible defaults. Share the invite right away.</p>
          <Btn variant="green big" disabled={busy || offline} onClick={() => go('room:quick', {})}>QUICK PLAY</Btn>
        </Card>
      )}
      {tab === 'public' && (
        <Card>
          <div className="row"><h3>Open lobbies</h3><Btn variant="ghost small" onClick={refresh}>Refresh</Btn></div>
          {list === null && <p className="muted">Loading…</p>}
          {list?.length === 0 && <p className="muted">No public rooms right now. Create one!</p>}
          {list?.map((r) => (
            <div key={r.id} className="listrow">
              <div><b>{r.name}</b><br /><span className="muted small">{r.id} · {MODES[r.mode]?.label} · {r.players}/{r.max} players</span></div>
              <Btn variant="small" onClick={() => { setRoomId(r.id); setJoinCode(''); setTab('join'); }}>Join</Btn>
            </div>
          ))}
          <p className="muted small">Public rooms still need the join code from the host.</p>
        </Card>
      )}
    </div>
  );
}

function Lobby({ view, you, chat, run, onLeave }) {
  const { prefs, setPrefs } = usePrefs();
  const toast = useToast();
  const [canForce, setCanForce] = useState(false);
  const isHost = view.host === you.pid;
  const me = view.players.find((p) => p.pid === you.pid);
  const spectator = !me;
  const taken = view.players.filter((p) => p.pid !== you.pid).map((p) => p.color);
  const text = inviteText(view);

  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'LUDO MAYHEM', text }); return; } catch { /* cancelled */ } }
    toast((await copyText(text)) ? 'Invite copied!' : 'Copy failed: select the code manually.');
  };
  const start = async (force) => {
    const r = await call('host:start', { force });
    if (!r.ok) { toast(r.error); setCanForce(!!r.canForce); sfx.error(); }
  };

  return (
    <div className="page lobby">
      <div className="row between wrap">
        <div><h1 className="h1">{view.settings.name}</h1><span className="pill">{MODES[view.settings.mode].label}</span> <span className="pill">{view.players.length}/{view.settings.maxPlayers} players</span>{view.locked && <span className="pill">🔒 locked</span>}</div>
        <Btn variant="ghost small" onClick={onLeave}>Leave room</Btn>
      </div>
      <div className="lobby-grid">
        <Card className="invite">
          <div className="codes">
            <div><small>Room ID</small><b className="code">{view.id}</b></div>
            <div><small>Join Code</small><b className="code">{view.code}</b></div>
          </div>
          <div className="row wrap">
            <Btn variant="yellow big" onClick={async () => toast((await copyText(text)) ? 'Invite copied!' : 'Copy failed')}>COPY INVITE</Btn>
            <Btn variant="ghost" onClick={share}>Share…</Btn>
          </div>
          <pre className="invite-preview">{text}</pre>
        </Card>
        <Card>
          <h3>Players</h3>
          {view.players.map((p) => (
            <div key={p.pid} className="listrow">
              <div className="row"><Avatar emoji={p.avatar} color={p.color} size={36} />
                <span><b>{p.pid === view.host ? '👑 ' : ''}{p.name}{p.pid === you.pid ? ' (you)' : ''}</b><br />
                  <span className="muted small"><i className={`led${p.connected ? ' on' : ''}`} /> {p.connected ? 'connected' : 'reconnecting…'} · {p.pid === view.host ? 'host' : p.ready ? '✅ ready' : '⏳ not ready'}</span></span>
              </div>
              {isHost && p.pid !== you.pid && <Btn variant="red small" onClick={() => window.confirm(`Remove ${p.name}?`) && run('host:kick', { pid: p.pid })}>Kick</Btn>}
            </div>
          ))}
          {view.spectators.length > 0 && <p className="muted small">👀 Watching: {view.spectators.map((s) => s.name).join(', ')}</p>}
        </Card>
        {!spectator && (
          <Card>
            <h3>You</h3>
            <div className="pick">{AVATARS.map((a) => <button key={a} type="button" className={`pickbtn${me.avatar === a ? ' on' : ''}`} aria-label={`Avatar ${a}`} onClick={() => { setPrefs({ avatar: a }); run('lobby:profile', { avatar: a }); }}>{a}</button>)}</div>
            <div className="pick">{PALETTE.map((c, i) => <button key={c.name} type="button" className={`swatch${me.color === i ? ' on' : ''}`} style={{ background: c.hex }} disabled={taken.includes(i)} aria-label={c.name} onClick={() => { setPrefs({ color: i }); run('lobby:profile', { color: i }); }} />)}</div>
            {!isHost && <Btn variant={me.ready ? 'ghost big' : 'green big'} onClick={() => run('lobby:profile', { ready: !me.ready })}>{me.ready ? 'Not ready' : 'READY'}</Btn>}
          </Card>
        )}
        <Card>
          <h3>Match settings</h3>
          {isHost
            ? <SettingsForm value={view.settings} onChange={(p) => run('host:settings', { settings: p })} />
            : <><p><b>{MODES[view.settings.mode].label}</b>: {MODES[view.settings.mode].blurb}</p><ul className="rules-list">{MODES[view.settings.mode].rules.map((r) => <li key={r}>{r}</li>)}</ul><p className="muted small">Timer: {view.settings.timer ? `${view.settings.timer}s` : 'unlimited'} · Reactions {view.settings.reactions ? 'on' : 'off'} · Spectators {view.settings.spectators ? 'on' : 'off'}</p></>}
          {isHost && (
            <>
              <Toggle label="Lock room" hint="Stops new players joining" checked={view.locked} onChange={(v) => run('host:lock', { locked: v })} />
              <Btn variant="red big" disabled={view.players.length < 2} onClick={() => start(false)}>START MATCH</Btn>
              {canForce && <Btn variant="ghost" onClick={() => { setCanForce(false); start(true); }}>Start anyway</Btn>}
              {view.players.length < 2 && <p className="muted small">Waiting for at least one more player…</p>}
            </>
          )}
          {!isHost && <p className="muted">Waiting for the host to start…</p>}
        </Card>
        <Card className="chatcard">
          <h3>Lobby chat</h3>
          <ChatPanel messages={chat} me={you.pid} onSend={(p) => run('chat:send', p)} />
        </Card>
        {view.summary && (
          <Card>
            <h3>Last match</h3>
            <p className="muted small">{view.summary.winners.join(' & ') || 'No winner'} · {view.summary.reason}</p>
            <SummaryTable rows={view.summary.rows} />
          </Card>
        )}
      </div>
    </div>
  );
}

export default function Online({ onExit, quick = false, initialJoin = null }) {
  const { prefs } = usePrefs();
  const toast = useToast();
  const [conn, setConn] = useState(socket.connected ? 'online' : 'connecting');
  const [view, setView] = useState(null);
  const [you, setYou] = useState(null);
  const [chat, setChat] = useState([]);
  const [floats, pushFloat] = useFloats();
  const [showBoard, setShowBoard] = useState(false);
  const offset = useRef(0);
  const recorded = useRef('');

  const accept = useCallback((r) => {
    setYou(r.you); saveSession({ roomId: r.you.roomId, key: r.you.key });
    offset.current = Date.now() - r.room.now; setView(r.room); setChat(r.room.chat || []);
  }, []);
  const reset = useCallback(() => { setView(null); setYou(null); setChat([]); clearSession(); }, []);

  useEffect(() => {
    const onConnect = async () => {
      setConn('online');
      const s = loadSession();
      if (s) { const r = await call('room:rejoin', s); if (r.ok) accept(r); else if (r.gone) reset(); }
    };
    const onDisconnect = () => setConn('offline');
    const onState = (v) => { offset.current = Date.now() - v.now; setView(v); };
    const onChat = (m) => setChat((c) => (c.some((x) => x.id === m.id) ? c : [...c, m].slice(-100)));
    const onReaction = (r) => { sfx.pop(); pushFloat(r); };
    const onKicked = (d) => { reset(); toast(d?.reason || 'You were removed from the room.'); };
    const onReplaced = () => toast('This game was opened somewhere else.');
    socket.on('connect', onConnect); socket.on('disconnect', onDisconnect); socket.on('connect_error', onDisconnect);
    socket.on('room:state', onState); socket.on('room:chat', onChat); socket.on('room:reaction', onReaction);
    socket.on('kicked', onKicked); socket.on('replaced', onReplaced);
    if (socket.connected) onConnect(); else socket.connect();
    return () => {
      ['connect', 'disconnect', 'connect_error', 'room:state', 'room:chat', 'room:reaction', 'kicked', 'replaced'].forEach((e) => socket.off(e));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(async (event, data) => {
    const r = await call(event, data);
    if (!r.ok && !/Stale|already rolled|Roll the dice first/.test(r.error || '')) { toast(r.error); sfx.error(); }
    return r;
  }, [toast]);

  const leave = async () => {
    if (view && !window.confirm('Leave this room?')) return;
    await call('room:leave'); reset(); socket.disconnect(); onExit();
  };

  // record the finished match once (my own stats)
  const g = view?.game;
  useEffect(() => {
    if (view?.status === 'over' && view.summary && you) {
      const key = `${view.id}:${view.startedAt}`;
      if (recorded.current !== key) { recorded.current = key; recordMatch({ online: true, rows: view.summary.rows, mePid: you.pid, mode: view.summary.mode }); }
    }
    if (view?.status !== 'over') setShowBoard(false);
  }, [view?.status, view?.startedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view || !you) {
    return <OnlineHome initial={initialJoin} quickNow={quick} conn={conn} onAccept={accept} onBack={() => { socket.disconnect(); onExit(); }} />;
  }
  if (view.status === 'lobby') return <Lobby view={view} you={you} chat={chat} run={run} onLeave={leave} />;

  const isHost = view.host === you.pid;
  const mePlaying = g && g.players[g.turn]?.id === you.pid;
  const canAct = view.status === 'playing' && g.phase !== 'over' && mePlaying && conn === 'online';
  const connectedMap = Object.fromEntries(view.players.map((p) => [p.pid, p.connected]));
  const here = view.players.filter((p) => p.connected).length;

  return (
    <GameView
      game={g} events={view.lastEvents} eventSeq={view.eventSeq} me={you.pid} canAct={canAct}
      onRoll={() => run('game:roll', { seq: g.seq })} onMove={(t) => run('game:move', { token: t, seq: g.seq })}
      deadline={view.deadline ? view.deadline + offset.current : null}
      startedAt={view.startedAt ? view.startedAt + offset.current : null}
      feed={view.feed} floats={floats} connected={connectedMap}
      react={view.players.some((p) => p.pid === you.pid) ? { enabled: view.settings.reactions, onReact: ({ kind, preset, target }) => run('reaction:send', { kind, preset, target }) } : null}
      chat={{ messages: chat, onSend: (p) => run('chat:send', p) }}
      notice={conn !== 'online' ? <div className="banner warn" role="status">Connection lost: reconnecting… your seat is kept.</div> : null}
      toolbar={(
        <>
          {isHost && view.status === 'playing' && <Btn variant="ghost small" onClick={() => run('host:pause')}>Pause</Btn>}
          {isHost && view.status !== 'over' && <Btn variant="ghost small" onClick={() => window.confirm('End the match for everyone?') && run('host:end')}>End</Btn>}
          <Btn variant="red small" onClick={leave}>Leave</Btn>
        </>
      )}
      overlay={(
        <>
          {view.status === 'paused' && (
            <Modal label="Paused" className="pause">
              <h2>⏸ Paused by the host</h2>
              {isHost ? <Btn variant="green big" onClick={() => run('host:resume')}>Resume</Btn> : <p className="muted">Hang tight…</p>}
            </Modal>
          )}
          {view.status === 'over' && view.summary && !showBoard && (
            <Victory summary={view.summary} onClose={() => setShowBoard(true)}>
              {view.players.some((p) => p.pid === you.pid) && (
                <Btn variant="green" disabled={view.rematch.includes(you.pid)} onClick={() => run('game:rematch')}>
                  {view.rematch.includes(you.pid) ? `Waiting… ${view.rematch.length}/${here}` : `Rematch vote (${view.rematch.length}/${here})`}
                </Btn>
              )}
              {isHost && <Btn variant="ghost" onClick={() => run('host:lobby')}>Back to lobby</Btn>}
              <Btn variant="red" onClick={leave}>Leave</Btn>
            </Victory>
          )}
          {view.status === 'over' && showBoard && <div className="floating-actions"><Btn variant="green small" onClick={() => setShowBoard(false)}>Results</Btn></div>}
        </>
      )}
    />
  );
}
