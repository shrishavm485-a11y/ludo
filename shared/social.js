// Shared by the client and the server: avatars, reactions, preset messages, text sanitising.
export const AVATARS = ['😀', '😎', '🤠', '🦊', '🐸', '🐼', '🦄', '🐙', '👾', '🤖', '🐯', '🦁'];

export const REACTIONS = [
  { id: 'lol', emoji: '😂', label: 'LOL' },
  { id: 'rip', emoji: '💀', label: 'RIP' },
  { id: 'cry', emoji: '😭', label: 'CRY' },
  { id: 'evil', emoji: '😈', label: 'EVIL' },
  { id: 'clown', emoji: '🤡', label: 'CLOWN' },
  { id: 'easy', emoji: '🔥', label: 'TOO EASY' },
  { id: 'ez', emoji: '😎', label: 'EZ WIN' },
  { id: 'rage', emoji: '😤', label: 'RAGE' },
  { id: 'watch', emoji: '👀', label: 'WATCH THIS' },
  { id: 'rekt', emoji: '💀', label: 'GET REKT' },
  { id: 'lucky', emoji: '🎲', label: 'LUCKY' },
  { id: 'salty', emoji: '🧂', label: 'SALTY' },
];

export const PRESETS = [
  { id: 'missed', text: 'BRO MISSED AGAIN 💀' },
  { id: 'six', text: 'LUCKY SIX!' },
  { id: 'cooked', text: 'YOU GOT COOKED 🔥' },
  { id: 'skill', text: 'SKILL ISSUE 🤡' },
  { id: 'nottoken', text: 'NOT MY TOKEN 😭' },
  { id: 'revenge', text: 'REVENGE INCOMING 😈' },
  { id: 'gg', text: 'GG, WELL PLAYED 🤝' },
  { id: 'hurry', text: 'TAKE YOUR TIME... NOT 😴' },
];

export const REACTION_COOLDOWN_MS = 1200;

const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;

/** Strip control/invisible characters and angle brackets, collapse spaces, cap the length. */
export function cleanText(value, max = 200) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
