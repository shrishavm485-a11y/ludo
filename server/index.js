// LUDO MAYHEM server: serves the built React app and runs the Socket.IO multiplayer backend.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { RoomManager } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../dist');
const PORT = Number(process.env.PORT) || 3000; // Render injects PORT
const HOST = '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY !== '0';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || ''; // only needed if the frontend is hosted elsewhere

const app = express();
app.disable('x-powered-by');
if (TRUST_PROXY) app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self' ws: wss:; manifest-src 'self'; worker-src 'self'; base-uri 'self'; form-action 'self'");
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 10_000, // chat/actions are tiny: refuse big payloads
  cors: CLIENT_ORIGIN ? { origin: CLIENT_ORIGIN.split(','), methods: ['GET', 'POST'] } : undefined,
});

const rooms = new RoomManager({
  emit: {
    room: (roomId, event, data) => io.to(roomId).emit(`room:${event}`, data),
    socket: (sid, event, data) => {
      const s = io.sockets.sockets.get(sid);
      if (!s) return;
      s.emit(event, data);
      if (event === 'kicked') for (const r of s.rooms) if (r !== s.id) s.leave(r);
    },
  },
});

app.get('/healthz', (_req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()), ...rooms.stats() }));

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { maxAge: '1h', setHeaders: (res, p) => { if (/(sw\.js|index\.html)$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text').send('LUDO MAYHEM server is running. Run "npm run build" to create the frontend, or use "npm run dev:client" during development.'));
}

const clientIp = (socket) => {
  const fwd = TRUST_PROXY ? String(socket.handshake.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return fwd || socket.handshake.address || 'unknown';
};

io.on('connection', (socket) => {
  const ip = clientIp(socket);
  const on = (event, fn) => socket.on(event, (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try { reply(fn(data && typeof data === 'object' ? data : {})); } catch (e) { console.error(`[${event}]`, e); reply({ ok: false, error: 'Server error. Please try again.' }); }
  });
  const enter = (res) => { if (res.ok) { for (const r of socket.rooms) if (r !== socket.id) socket.leave(r); socket.join(res.roomId); } return res; };

  on('room:create', (d) => enter(rooms.createRoom(socket.id, ip, d)));
  on('room:quick', (d) => enter(rooms.createRoom(socket.id, ip, { ...d, settings: { name: 'Quick Play', maxPlayers: 4, mode: 'classic', timer: 30 }, code: '' })));
  on('room:join', (d) => enter(rooms.join(socket.id, ip, d)));
  on('room:rejoin', (d) => enter(rooms.rejoin(socket.id, ip, d)));
  on('room:list', () => ({ ok: true, rooms: rooms.publicRooms() }));
  on('room:leave', () => { const res = rooms.leave(socket.id); for (const r of socket.rooms) if (r !== socket.id) socket.leave(r); return res; });
  on('lobby:profile', (d) => rooms.profile(socket.id, d));
  on('host:settings', (d) => rooms.settings(socket.id, d));
  on('host:lock', (d) => rooms.lock(socket.id, d));
  on('host:kick', (d) => rooms.kick(socket.id, d));
  on('host:start', (d) => rooms.start(socket.id, d));
  on('host:pause', () => rooms.pause(socket.id));
  on('host:resume', () => rooms.resume(socket.id));
  on('host:end', () => rooms.end(socket.id));
  on('host:lobby', () => rooms.toLobby(socket.id));
  on('game:roll', (d) => rooms.roll(socket.id, d));
  on('game:move', (d) => rooms.move(socket.id, d));
  on('game:rematch', () => rooms.rematch(socket.id));
  on('chat:send', (d) => rooms.chat(socket.id, d));
  on('reaction:send', (d) => rooms.react(socket.id, d));
  socket.on('disconnect', () => rooms.disconnect(socket.id));
});

setInterval(() => { try { rooms.tick(); } catch (e) { console.error('[tick]', e); } }, 500).unref();

server.listen(PORT, HOST, () => console.log(`LUDO MAYHEM listening on http://${HOST}:${PORT}`));
process.on('SIGTERM', () => { io.close(); server.close(() => process.exit(0)); });
