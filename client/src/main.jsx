import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);

// Offline support: register the service worker and ask it to keep every file this page loaded.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then((reg) => {
      const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.startsWith(window.location.origin) && !u.includes('/socket.io'));
      reg.active?.postMessage({ type: 'CACHE', urls: [...new Set([...urls, `${window.location.origin}/`])] });
    }).catch(() => {});
  });
}
