import { io } from 'socket.io-client';

// Same origin by default (the Node server serves the page and the sockets).
// VITE_SERVER_URL is only for a split deployment; nothing is hardcoded to localhost.
export const socket = io(import.meta.env.VITE_SERVER_URL || undefined, { autoConnect: false, reconnectionDelayMax: 4000 });

export function call(event, data = {}) {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve({ ok: false, error: 'Not connected to the server. Check your internet connection.' });
    socket.timeout(8000).emit(event, data, (err, res) => resolve(err ? { ok: false, error: 'The server did not answer. Try again.' } : res));
    return undefined;
  });
}
