import { useCallback, useEffect, useState } from 'react';
import { MODES, PALETTE, victimsAt } from '../../shared/engine.js';
import Board, { useShown } from './Board.jsx';
import { Avatar, Btn, Dice, colorHex, useNow, usePrefs } from './ui.jsx';
import { ChatPanel, FeedPanel, ReactPanel } from './Panels.jsx';
import { sfx, haptic } from './lib/sound.js';

export function useFloats() {
  const [floats, setFloats] = useState([]);
  const push = useCallback((f) => {
    const id = f.id || Math.random().toString(36).slice(2);
    setFloats((a) => [...a.slice(-8), { ...f, id }]);
    setTimeout(() => setFloats((a) => a.filter((x) => x.id !== id)), 2400);
  }, []);
  return [floats, push];
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function PlayerCard({ pl, index, game, isMe, connected, floats, muted, onMute, score }) {
  const active = game.turn === index && game.phase !== 'over';
  const hit = floats.some((f) => f.target === pl.id);
  const home = pl.tokens.filter((p) => p >= game.home).length;
  return (
    <div className={`pcard${active ? ' active' : ''}${pl.out ? ' out' : ''}${hit ? ' hit' : ''}`} style={{ '--pc': colorHex(pl.color) }}>
      <div className="pfloats" aria-hidden="true">
        {floats.filter((f) => f.from === pl.id).map((f) => <span key={f.id} className="float">{f.emoji || '💬'}</span>)}
      </div>
      <Avatar emoji={pl.avatar} color={pl.color} size={36} />
      <div className="pinfo">
        <b className="pname">{pl.name}{isMe ? ' (you)' : ''}</b>
        <span className="pmeta">
          {Array.from({ length: 4 }, (_, i) => <i key={i} className={`dot${i < home ? ' on' : ''}`} />)}
          {game.mode === 'knockout' && !pl.out ? ` ❤${pl.lives}` : ''}
          {game.mode === 'team' ? ` T${pl.team + 1}` : ''}
          {pl.shield ? ' 🛡' : ''}
          {pl.out ? ' out' : ''}
          {connected === false ? ' ⚠ offline' : ''}
          {score ? ` 🏆${score}` : ''}
        </span>
      </div>
      {!isMe && onMute && <button type="button" className="mute" onClick={() => onMute(pl.id)} aria-label={`${muted ? 'Unmute' : 'Mute'} ${pl.name}`}>{muted ? '🔇' : '🔊'}</button>}
    </div>
  );
}

/**
 * Shared gameplay screen for online and offline play.
 * canAct: whether THIS device may roll/move right now (online: it is my turn; offline: not paused / no hand-off screen).
 */
export default function GameView({
  game, events = [], eventSeq = 0, me = null, canAct, onRoll, onMove, deadline = null, startedAt = null,
  feed = [], floats = [], react = null, chat = null, scores = {}, connected = {}, toolbar = null, overlay = null, senders = null, notice = null,
}) {
  const { prefs } = usePrefs();
  const { shown, busy } = useShown(game);
  const now = useNow(500);
  const [rolling, setRolling] = useState(false);
  const [zoom, setZoom] = useState(game.players.length >= 7 && window.innerWidth < 700);
  const [tab, setTab] = useState(window.innerWidth >= 900 ? 'feed' : null);
  const [muted, setMuted] = useState(() => new Set());
  const [hint, setHint] = useState(true);
  const [full, setFull] = useState(!!document.fullscreenElement);

  const cur = game.players[game.turn];
  const over = game.phase === 'over';
  const seconds = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : null;

  // sounds, haptics and the dice tumble react to engine events (same path online and offline)
  useEffect(() => {
    if (!events.length) return undefined;
    const timers = [];
    if (events.some((e) => e.t === 'roll')) { setRolling(true); sfx.roll(); timers.push(setTimeout(() => setRolling(false), 650)); }
    if (events.some((e) => e.t === 'move')) timers.push(setTimeout(sfx.move, 120));
    if (events.some((e) => e.t === 'capture')) timers.push(setTimeout(sfx.capture, 380));
    if (events.some((e) => e.t === 'home')) timers.push(setTimeout(sfx.home, 450));
    if (events.some((e) => e.t === 'win')) timers.push(setTimeout(sfx.win, 600));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventSeq]);

  useEffect(() => { const f = () => setFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);

  const ready = canAct && !over && !rolling && !busy;
  const canRoll = ready && game.phase === 'roll';
  const canPick = ready && game.phase === 'move';

  // one sensible option: play it automatically (setting)
  useEffect(() => {
    if (!canPick || !prefs.autoMove || game.legal.length === 0) return undefined;
    const same = new Set(game.legal.map((t) => cur.tokens[t])).size === 1;
    if (game.legal.length > 1 && !same) return undefined;
    const id = setTimeout(() => onMove(game.legal[0]), 500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPick, game.seq, prefs.autoMove]);

  const burst = [...floats].reverse().find((f) => !muted.has(f.from));
  const visibleFloats = prefs.muteReactions ? [] : floats.filter((f) => !muted.has(f.from));
  const nameOf = (id) => game.players.find((p) => p.id === id)?.name;
  const toggleMute = (id) => setMuted((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const status = over ? 'Match over' : canAct
    ? (game.phase === 'roll' ? 'Your turn: roll the dice' : 'Pick a token to move')
    : `${cur.name} is playing…`;

  const tabs = [['feed', 'Log'], ...(chat ? [['chat', 'Chat']] : []), ...(react ? [['react', 'React']] : [])];
  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {}); };
  const portraitBig = hint && game.players.length >= 5 && window.matchMedia('(orientation: portrait) and (max-width: 640px)').matches;

  return (
    <div className={`game n${game.players.length}`}>
      <header className="gbar">
        <div className="gtitle"><b>LUDO MAYHEM</b><span className="pill">{MODES[game.mode].label}{game.chaos && game.mode !== 'chaos' ? ' + chaos' : ''}</span></div>
        <div className="gtools">
          {elapsed !== null && <span className="pill" title="Match time">⏱ {fmt(elapsed)}</span>}
          {game.players.length >= 5 && <Btn variant="ghost small" onClick={() => setZoom((z) => !z)} aria-pressed={zoom}>{zoom ? 'Fit board' : 'Zoom in'}</Btn>}
          {document.fullscreenEnabled && <Btn variant="ghost small" onClick={toggleFull} aria-pressed={full}>{full ? 'Exit full' : 'Fullscreen'}</Btn>}
          {toolbar}
        </div>
      </header>
      {notice}
      {portraitBig && (
        <div className="banner" role="note">
          Big board! Rotate your phone for more room, or use “Zoom in”. <button type="button" className="link" onClick={() => setHint(false)}>Dismiss</button>
        </div>
      )}
      <div className="gbody">
        <aside className="cards" aria-label="Players">
          {game.players.map((pl, i) => (
            <PlayerCard key={pl.id} pl={pl} index={i} game={game} isMe={pl.id === me} connected={connected[pl.id]} floats={visibleFloats} muted={muted.has(pl.id)} onMute={toggleMute} score={scores[pl.id]} />
          ))}
        </aside>
        <main className="stage">
          <div className="status" role="status" style={{ '--pc': colorHex(cur.color) }}>
            <Avatar emoji={cur.avatar} color={cur.color} size={30} /><span>{status}</span>
            {seconds !== null && !over && <span className={`timer${seconds <= 5 ? ' low' : ''}`}>{seconds}s</span>}
          </div>
          <div className="boardwrap">
            <Board game={game} shown={shown} canPick={canPick} onPick={onMove} zoom={zoom} />
            {!prefs.muteReactions && burst && !muted.has(burst.from) && (
              <div key={burst.id} className="burst" aria-hidden="true">
                <span className="big">{burst.emoji || '💬'}</span>
                <small>{burst.text || burst.label}{burst.target ? ` → ${nameOf(burst.target)}` : ''}</small>
              </div>
            )}
          </div>
          <div className="controls">
            <Dice value={game.dice} rolling={rolling} disabled={!canRoll} onClick={() => { haptic(12); onRoll(); }} color={colorHex(cur.color)} />
            <div className="moves">
              {canPick && game.legal.length > 1 && game.legal.map((t) => {
                const from = cur.tokens[t]; const to = from === 0 ? 1 : from + game.dice;
                const hitN = victimsAt(game, game.turn, to).length;
                return (
                  <Btn key={t} variant="small" onClick={() => onMove(t)}>
                    Token {t + 1}{from === 0 ? ' out' : ` +${game.dice}`}{hitN ? ' 💥' : ''}{to === game.home ? ' 🏠' : ''}
                  </Btn>
                );
              })}
              {!canPick && !over && game.phase === 'move' && <span className="muted">Waiting for {cur.name}…</span>}
            </div>
          </div>
        </main>
        <aside className="side">
          <div className="tabs" role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' on' : ''}`} onClick={() => setTab(tab === id ? null : id)}>{label}</button>
            ))}
          </div>
          {tab === 'feed' && <FeedPanel feed={feed} />}
          {tab === 'chat' && chat && <ChatPanel messages={chat.messages} me={me} muted={muted} onSend={chat.onSend} disabled={chat.disabled} />}
          {tab === 'react' && react && <ReactPanel players={game.players} me={me} enabled={react.enabled} onReact={react.onReact} senders={senders} />}
        </aside>
      </div>
      {overlay}
    </div>
  );
}
