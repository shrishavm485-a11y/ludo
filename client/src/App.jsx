import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PrefsCtx, ToastCtx } from './ui.jsx';
import { Menu, HowTo, SettingsScreen, StatsScreen } from './Screens.jsx';
import Offline from './Offline.jsx';
import Online from './Online.jsx';
import { loadPrefs, savePrefs } from './lib/storage.js';
import { setHapticsEnabled, setSoundEnabled } from './lib/sound.js';

const params = new URLSearchParams(window.location.search);
const INVITE = params.get('room') ? { room: params.get('room').toUpperCase(), code: (params.get('code') || '').toUpperCase() } : null;

export default function App() {
  const [prefs, setPrefsState] = useState(loadPrefs);
  const [screen, setScreen] = useState(INVITE ? 'online' : 'menu');
  const [toasts, setToasts] = useState([]);
  const quick = useRef(false);

  const setPrefs = useCallback((patch) => setPrefsState((p) => { const n = { ...p, ...patch }; savePrefs(n); return n; }), []);
  const toast = useCallback((text) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  useEffect(() => { setSoundEnabled(prefs.sound); setHapticsEnabled(prefs.haptics); }, [prefs.sound, prefs.haptics]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = prefs.theme === 'auto' ? (mq.matches ? 'dark' : 'light') : prefs.theme; };
    apply(); mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [prefs.theme]);
  useEffect(() => { if (INVITE) window.history.replaceState({}, '', window.location.pathname); }, []);

  const go = (id) => {
    quick.current = id === 'quick';
    setScreen(id === 'quick' ? 'online' : id);
  };
  const prefsValue = useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs]);
  const back = () => { quick.current = false; setScreen('menu'); };

  let body;
  if (screen === 'offline') body = <Offline onExit={back} />;
  else if (screen === 'online') body = <Online onExit={back} quick={quick.current} initialJoin={INVITE} />;
  else if (screen === 'how') body = <HowTo go={go} />;
  else if (screen === 'settings') body = <SettingsScreen go={go} />;
  else if (screen === 'stats') body = <StatsScreen go={go} />;
  else body = <Menu go={go} />;

  return (
    <PrefsCtx.Provider value={prefsValue}>
      <ToastCtx.Provider value={toast}>
        {body}
        <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}</div>
      </ToastCtx.Provider>
    </PrefsCtx.Provider>
  );
}
