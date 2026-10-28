import { useEffect, useRef, useState } from 'react';
import { PRESETS, REACTIONS, REACTION_COOLDOWN_MS } from '../../shared/social.js';
import { Btn, usePrefs } from './ui.jsx';

export function FeedPanel({ feed }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [feed.length]);
  return (
    <div className="panel-scroll" ref={ref} aria-live="polite">
      {feed.length === 0 && <p className="muted">Game events show up here.</p>}
      {feed.map((f, i) => <p key={`${f.ts}-${i}`} className="feed-line">{f.text}</p>)}
    </div>
  );
}

export function ChatPanel({ messages, me, muted, onSend, disabled }) {
  const [text, setText] = useState('');
  const ref = useRef(null);
  const shown = messages.filter((m) => !muted?.has(m.pid));
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [shown.length]);
  const submit = (e) => { e.preventDefault(); if (!text.trim()) return; onSend({ text }); setText(''); };
  return (
    <div className="chat">
      <div className="panel-scroll" ref={ref} aria-live="polite">
        {shown.length === 0 && <p className="muted">No messages yet. Say hi 👋</p>}
        {shown.map((m) => (
          <p key={m.id} className={`chat-line${m.pid === me ? ' mine' : ''}`}><b>{m.name}</b> {m.text}</p>
        ))}
      </div>
      <div className="chips">
        {PRESETS.map((p) => <button key={p.id} type="button" className="chip" disabled={disabled} onClick={() => onSend({ preset: p.id })}>{p.text}</button>)}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="Type a message" aria-label="Chat message" enterKeyHint="send" disabled={disabled} />
        <Btn variant="blue small" type="submit" disabled={disabled || !text.trim()}>Send</Btn>
      </form>
    </div>
  );
}

/**
 * Reactions: one tap, no keyboard. `senders` (offline only) lets the person holding the device pick who is reacting.
 * Cooldown is also enforced by the server online.
 */
export function ReactPanel({ players, me, enabled = true, onReact, senders, hapticOn }) {
  const { prefs, setPrefs } = usePrefs();
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState(senders?.[0]?.id ?? '');
  const [cool, setCool] = useState(false);
  useEffect(() => { if (senders && !senders.some((s) => s.id === from)) setFrom(senders[0]?.id ?? ''); }, [senders, from]);
  const send = (payload) => {
    if (cool || !enabled) return;
    setCool(true); setTimeout(() => setCool(false), REACTION_COOLDOWN_MS);
    onReact({ ...payload, target: target || null, from: senders ? from : me });
  };
  const others = players.filter((p) => p.id !== (senders ? from : me));
  if (!enabled) return <p className="muted">The host turned reactions off for this room.</p>;
  return (
    <div className="react">
      {senders && (
        <label className="field"><span>Reacting as</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>{senders.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </label>
      )}
      <label className="field"><span>Aim at</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Everyone</option>
          {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <div className="react-grid">
        {REACTIONS.map((r) => (
          <button key={r.id} type="button" className="react-btn" disabled={cool} onClick={() => send({ kind: r.id, emoji: r.emoji, label: r.label })}>
            <span className="emo">{r.emoji}</span><span>{r.label}</span>
          </button>
        ))}
      </div>
      <div className="chips">
        {PRESETS.slice(0, 6).map((p) => <button key={p.id} type="button" className="chip" disabled={cool} onClick={() => send({ preset: p.id, text: p.text })}>{p.text}</button>)}
      </div>
      <div className="row">
        <label className="check"><input type="checkbox" checked={prefs.muteReactions} onChange={(e) => setPrefs({ muteReactions: e.target.checked })} /> Mute everyone’s reactions</label>
        {hapticOn ? null : null}
      </div>
    </div>
  );
}
