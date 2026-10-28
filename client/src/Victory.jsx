import { useState } from 'react';
import { Avatar, Btn, Modal, useToast } from './ui.jsx';

function drawCard(rows, mode, winners) {
  const c = document.createElement('canvas'); c.width = 900; c.height = 520;
  const x = c.getContext('2d');
  x.fillStyle = '#f6efdc'; x.fillRect(0, 0, 900, 520);
  x.lineWidth = 8; x.strokeStyle = '#151515'; x.strokeRect(16, 16, 868, 488);
  x.fillStyle = '#ffd100'; x.fillRect(16, 16, 868, 110); x.strokeRect(16, 16, 868, 110);
  x.fillStyle = '#151515'; x.font = '900 52px Arial Black, Impact, sans-serif'; x.fillText('LUDO MAYHEM', 44, 90);
  x.font = '900 40px Arial, sans-serif'; x.fillText(`🏆 ${winners.join(' & ') || 'No winner'}`, 44, 190);
  x.font = '700 24px Arial, sans-serif'; x.fillStyle = '#5b5547'; x.fillText(`${mode} mode · ${rows.length} players`, 44, 228);
  x.fillStyle = '#151515';
  rows.slice(0, 6).forEach((r, i) => { x.font = '700 28px Arial, sans-serif'; x.fillText(`${i + 1}. ${r.avatar} ${r.name}`, 44, 288 + i * 36); x.fillText(`${r.home}/4 home · ${r.captures} captures`, 520, 288 + i * 36); });
  return c;
}

export async function shareResult(rows, mode, winners, toast) {
  const canvas = drawCard(rows, mode, winners);
  const text = `LUDO MAYHEM: ${winners.join(' & ') || 'no winner'} won a ${mode} match! 🎲`;
  canvas.toBlob(async (blob) => {
    if (!blob) { toast('Could not make the result card.'); return; }
    const file = new File([blob], 'ludo-mayhem-result.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'LUDO MAYHEM', text }); return; } catch { /* cancelled: fall back to download */ } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ludo-mayhem-result.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Result card saved.');
  });
}

/** summary = { rows (engine summarize), mode, winners, durationMs, reason } */
export function SummaryTable({ rows }) {
  return (
    <div className="table-wrap">
      <table className="summary">
        <thead><tr><th>#</th><th>Player</th><th>Home</th><th>Captures</th><th>Captured</th><th>Sixes</th><th>Rolls</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={r.winner ? 'win' : ''}>
              <td>{r.winner ? '🏆' : i + 1}</td>
              <td><Avatar emoji={r.avatar} color={r.color} size={24} /> {r.name}{r.out ? ' ☠️' : ''}</td>
              <td>{r.home}/4</td><td>{r.captures}</td><td>{r.captured}</td><td>{r.sixes}</td><td>{r.rolls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Victory({ summary, children, onClose }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const mins = Math.max(1, Math.round((summary.durationMs || 0) / 60000));
  return (
    <Modal label="Match finished" className="victory">
      <h2 className="trophy">🏆 {summary.winners.length ? summary.winners.join(' & ') : 'Match over'}</h2>
      <p className="muted">{summary.reason} · {summary.mode} mode · about {mins} min</p>
      <SummaryTable rows={summary.rows} />
      <div className="row wrap">
        <Btn variant="ghost small" disabled={busy} onClick={async () => { setBusy(true); await shareResult(summary.rows, summary.mode, summary.winners, toast); setBusy(false); }}>Share result card</Btn>
        {onClose && <Btn variant="ghost small" onClick={onClose}>View board</Btn>}
      </div>
      <div className="row wrap">{children}</div>
    </Modal>
  );
}
