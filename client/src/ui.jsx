import { createContext, useContext, useEffect, useState } from 'react';
import { PALETTE } from '../../shared/engine.js';

export const PrefsCtx = createContext({ prefs: {}, setPrefs: () => {} });
export const usePrefs = () => useContext(PrefsCtx);
export const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export const colorHex = (i) => PALETTE[(i ?? 0) % PALETTE.length].hex;

export function Btn({ variant = '', className = '', children, ...props }) {
  return <button type="button" className={`btn ${variant} ${className}`} {...props}>{children}</button>;
}

export function Card({ className = '', children, ...props }) {
  return <section className={`card ${className}`} {...props}>{children}</section>;
}

export function Avatar({ emoji, color, size = 40 }) {
  return <span className="avatar" style={{ background: colorHex(color), width: size, height: size, fontSize: size * 0.58 }}>{emoji}</span>;
}

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

/** Chunky die. While `rolling` it flickers through random faces (visual only: the result comes from the engine/server). */
export function Dice({ value, rolling = false, disabled = false, onClick, color = '#ffd100', label = 'Roll the dice' }) {
  const [face, setFace] = useState(value || 1);
  useEffect(() => {
    if (!rolling) { setFace(value || 1); return undefined; }
    const id = setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 70);
    return () => clearInterval(id);
  }, [rolling, value]);
  const die = (
    <div className={`die ${rolling ? 'rolling' : ''}`} style={{ '--dc': color }}>
      {Array.from({ length: 9 }, (_, i) => <i key={i} className={PIPS[face].includes(i) ? 'pip on' : 'pip'} />)}
    </div>
  );
  if (!onClick) return die;
  return (
    <button type="button" className="die-btn" disabled={disabled} onClick={onClick} aria-label={label}>
      {die}
      <span className="die-label">{disabled ? (value ? `Rolled ${value}` : '…') : 'ROLL'}</span>
    </button>
  );
}

export function Modal({ children, label, className = '' }) {
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label={label}>
      <div className={`modal card ${className}`}>{children}</div>
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
      <span>{label}{hint ? <small>{hint}</small> : null}</span>
    </label>
  );
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }
}
