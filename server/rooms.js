// Server-authoritative room manager. No sockets in here: index.js wires Socket.IO to these methods,
// so everything (including timers) can be unit tested with a fake clock.
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import {
  createGame, act, autoPlay, forfeit, summarize, eventText, normalizeSettings, MAX_PLAYERS, MIN_PLAYERS, PALETTE,
} from '../shared/engine.js';
import { REACTIONS, PRESETS, AVATARS, REACTION_COOLDOWN_MS, cleanText } from '../shared/social.js';

export const LIMITS = {
  maxRooms: 500, maxSpectators: 30, hostGraceMs: 15000, lobbyGraceMs: 60000,
  autoMs: 3000, autoStepMs: 800, emptyRoomMs: 10 * 60000, overRoomMs: 2 * 3600000,
};

const err = (error, extra = {}) => ({ ok: false, error, ...extra });
const digest = (s) => createHash('sha256').update(String(s)).digest();
const sameSecret = (a, b) => timingSafeEqual(digest(a), digest(b));
const normCode = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export class RateLimiter {
  constructor(now = Date.now) { this.now = now; this.hits = new Map(); }
  allow(key, max, windowMs) {
    const t = this.now();
    const arr = (this.hits.get(key) || []).filter((x) => t - x < windowMs);
    if (arr.length >= max) { this.hits.set(key, arr); return false; }
    arr.push(t); this.hits.set(key, arr); return true;
  }
  sweep(maxAgeMs = 10 * 60000) {
    const t = this.now();
    for (const [k, arr] of this.hits) if (!arr.length || t - arr[arr.length - 1] > maxAgeMs) this.hits.delete(k);
  }
}

export class RoomManager {
  constructor({ emit, now = Date.now, rng = (m) => randomInt(m) } = {}) {
    this.emit = { room() {}, socket() {}, ...emit };
    this.now = now; this.rng = rng;
    this.rooms = new Map(); this.sessions = new Map(); this.limiter = new RateLimiter(now);
  }

  // ---------- helpers ----------
  stats() { return { rooms: this.rooms.size, sessions: this.sessions.size }; }

  ctx(sid) {
    const s = this.sessions.get(sid);
    const room = s && this.rooms.get(s.roomId);
    if (!room) return null;
    const member = room.players.find((p) => p.pid === s.pid);
    if (member) return { room, member, spectator: false };
    const spec = room.spectators.find((p) => p.pid === s.pid);
    return spec ? { room, member: spec, spectator: true } : null;
  }

  hostCtx(sid) {
    const c = this.ctx(sid);
    if (!c) return { error: 'You are not in a room.' };
    if (c.spectator || c.member.pid !== c.room.hostPid) return { error: 'Only the host can do that.' };
    return c;
  }

  pickColor(room, want) {
    const used = new Set(room.players.map((p) => p.color));
    if (Number.isInteger(want) && want >= 0 && want < PALETTE.length && !used.has(want)) return want;
    for (let i = 0; i < PALETTE.length; i++) if (!used.has(i)) return i;
    return 0;
  }

  uniqueName(room, raw) {
    const base = cleanText(raw, 16) || `Guest${randomInt(100, 1000)}`;
    const taken = new Set([...room.players, ...room.spectators].map((m) => m.name.toLowerCase()));
    let name = base; let i = 2;
    while (taken.has(name.toLowerCase())) name = `${base.slice(0, 13)} ${i++}`;
    return name;
  }

  addMember(room, sid, data, spectator) {
    const m = {
      pid: randomBytes(4).toString('hex'), key: randomBytes(16).toString('hex'),
      name: this.uniqueName(room, data.nickname), avatar: AVATARS.includes(data.avatar) ? data.avatar : AVATARS[0],
      color: spectator ? 0 : this.pickColor(room, data.color), ready: false, sid, connected: true, lostAt: null,
    };
    (spectator ? room.spectators : room.players).push(m);
    this.sessions.set(sid, { roomId: room.id, pid: m.pid });
    return m;
  }

  removeMember(room, m) {
    room.players = room.players.filter((p) => p.pid !== m.pid);
    room.spectators = room.spectators.filter((p) => p.pid !== m.pid);
    room.rematch.delete(m.pid);
    if (m.sid && this.sessions.get(m.sid)?.pid === m.pid) this.sessions.delete(m.sid);
  }

  pushFeed(room, text) { room.feed.push({ ts: this.now(), text }); if (room.feed.length > 60) room.feed.shift(); }

  view(room, full = false) {
    const pub = (p) => ({ pid: p.pid, name: p.name, avatar: p.avatar, color: p.color, ready: p.ready, connected: p.connected });
    return {
      id: room.id, code: room.code, host: room.hostPid, status: room.status, locked: room.locked,
      settings: room.settings, now: this.now(), deadline: room.deadline, startedAt: room.startedAt,
      players: room.players.map(pub), spectators: room.spectators.map(pub),
      game: room.game, feed: room.feed.slice(-40), eventSeq: room.eventSeq, lastEvents: room.lastEvents,
      rematch: [...room.rematch], summary: room.summary, ...(full ? { chat: room.chat.slice(-50) } : {}),
    };
  }

  touch(room) { room.lastActive = this.now(); this.emit.room(room.id, 'state', this.view(room)); }

  // ---------- create / join / reconnect ----------
  createRoom(sid, ip, data = {}) {
    if (!this.limiter.allow(`create:${ip}`, 5, 60000)) return err('Too many rooms created. Try again in a minute.');
    if (this.rooms.size >= LIMITS.maxRooms) return err('The server is full right now. Try again later.');
    let code = normCode(data.code);
    if (String(data.code ?? '').trim() && (code.length < 4 || code.length > 6)) return err('Join code must be 4 to 6 letters or numbers.');
    if (!code) code = String(randomInt(1000, 10000));
    this.leave(sid);
    let id; do { id = `LM${randomInt(1000, 10000)}`; } while (this.rooms.has(id));
    const room = {
      id, code, settings: normalizeSettings(data.settings || {}), hostPid: null, status: 'lobby', locked: false,
      players: [], spectators: [], game: null, chat: [], feed: [], eventSeq: 0, lastEvents: [], rematch: new Set(),
      summary: null, deadline: null, autoNext: false, startedAt: null, banned: new Set(), lastActive: this.now(),
    };
    const me = this.addMember(room, sid, data, false);
    room.hostPid = me.pid;
    this.rooms.set(id, room);
    this.pushFeed(room, `${me.name} created the room`);
    return { ok: true, roomId: id, you: { pid: me.pid, key: me.key, roomId: id }, room: this.view(room, true) };
  }

  join(sid, ip, data = {}) {
    if (!this.limiter.allow(`join:${ip}`, 15, 60000)) return err('Too many attempts. Wait a minute and try again.');
    const room = this.rooms.get(String(data.roomId ?? '').trim().toUpperCase());
    if (!room) return err('Room not found. Check the Room ID: it may have closed.');
    if (!sameSecret(normCode(data.code), room.code)) return err('Incorrect join code.');
    if (room.locked) return err('The host locked this room.');
    this.leave(sid);
    const spectate = !!data.spectate;
    if (spectate) {
      if (!room.settings.spectators) return err('This room does not allow spectators.');
      if (room.spectators.length >= LIMITS.maxSpectators) return err('Too many spectators.');
    } else {
      if (room.status !== 'lobby') return err('The match already started. Join as a spectator, or reopen the page on your original device to reconnect.');
      if (room.players.length >= Math.min(room.settings.maxPlayers, MAX_PLAYERS)) return err(`Room is full (${room.players.length}/${room.settings.maxPlayers} players).`);
    }
    const me = this.addMember(room, sid, data, spectate);
    this.pushFeed(room, `${me.name} ${spectate ? 'is watching' : 'joined'}`);
    this.touch(room);
    return { ok: true, roomId: room.id, you: { pid: me.pid, key: me.key, roomId: room.id }, room: this.view(room, true) };
  }

  rejoin(sid, ip, data = {}) {
    if (!this.limiter.allow(`rejoin:${ip}`, 30, 60000)) return err('Too many attempts.');
    const room = this.rooms.get(String(data.roomId ?? '').toUpperCase());
    if (!room) return err('That room no longer exists.', { gone: true });
    const key = String(data.key ?? '');
    const me = [...room.players, ...room.spectators].find((p) => sameSecret(p.key, key));
    if (!me || room.banned.has(me.key)) return err('Could not restore your seat.', { gone: true });
    if (me.sid && me.sid !== sid) { this.sessions.delete(me.sid); this.emit.socket(me.sid, 'replaced', {}); }
    me.sid = sid; me.connected = true; me.lostAt = null;
    this.sessions.set(sid, { roomId: room.id, pid: me.pid });
    this.pushFeed(room, `${me.name} reconnected`);
    if (room.status === 'playing') this.schedule(room);
    this.touch(room);
    return { ok: true, roomId: room.id, you: { pid: me.pid, key: me.key, roomId: room.id }, room: this.view(room, true) };
  }

  disconnect(sid) {
    const c = this.ctx(sid);
    this.sessions.delete(sid);
    if (!c) return;
    const { room, member } = c;
    member.connected = false; member.sid = null; member.lostAt = this.now();
    this.pushFeed(room, `${member.name} lost connection`);
    if (room.status === 'playing') this.schedule(room);
    this.touch(room);
  }

  leave(sid) {
    const c = this.ctx(sid);
    if (!c) return { ok: true };
    const { room, member, spectator } = c;
    if (!spectator && room.status === 'playing' && room.game) this.applyEvents(room, forfeit(room.game, member.pid));
    this.removeMember(room, member);
    this.pushFeed(room, `${member.name} left`);
    if (!spectator && room.hostPid === member.pid) this.transferHost(room);
    if (!room.players.length) { this.rooms.delete(room.id); return { ok: true }; }
    if (room.status === 'playing') this.schedule(room);
    this.touch(room);
    return { ok: true };
  }

  transferHost(room) {
    const next = room.players.find((p) => p.connected && p.pid !== room.hostPid);
    if (!next) return;
    room.hostPid = next.pid;
    this.pushFeed(room, `${next.name} is the new host 👑`);
  }

  // ---------- lobby ----------
  profile(sid, data = {}) {
    const c = this.ctx(sid);
    if (!c || c.spectator) return err('You are not seated in a room.');
    const { room, member } = c;
    if (room.status !== 'lobby') return err('You can change this before the match starts.');
    if (typeof data.avatar === 'string' && AVATARS.includes(data.avatar)) member.avatar = data.avatar;
    if (typeof data.nickname === 'string') {
      const clean = cleanText(data.nickname, 16);
      if (clean && clean !== member.name) member.name = this.uniqueName({ players: room.players.filter((p) => p !== member), spectators: room.spectators }, clean);
    }
    if (Number.isInteger(data.color)) {
      if (room.players.some((p) => p !== member && p.color === data.color) || data.color < 0 || data.color >= PALETTE.length) return err('That color is taken.');
      member.color = data.color;
    }
    if (typeof data.ready === 'boolean') member.ready = data.ready;
    this.touch(room);
    return { ok: true };
  }

  settings(sid, data = {}) {
    const c = this.hostCtx(sid);
    if (c.error) return err(c.error);
    if (c.room.status !== 'lobby') return err('Settings can only change in the lobby.');
    const s = normalizeSettings(data.settings || {}, c.room.settings);
    if (s.maxPlayers < c.room.players.length) return err(`${c.room.players.length} players are already here: raise the player limit or kick someone.`);
    c.room.settings = s;
    this.touch(c.room);
    return { ok: true };
  }

  lock(sid, data = {}) {
    const c = this.hostCtx(sid);
    if (c.error) return err(c.error);
    c.room.locked = !!data.locked;
    this.pushFeed(c.room, c.room.locked ? 'Room locked 🔒' : 'Room unlocked 🔓');
    this.touch(c.room);
    return { ok: true };
  }

  kick(sid, data = {}) {
    const c = this.hostCtx(sid);
    if (c.error) return err(c.error);
    const { room } = c;
    const target = [...room.players, ...room.spectators].find((p) => p.pid === data.pid);
    if (!target || target.pid === room.hostPid) return err('You cannot kick that player.');
    const seated = room.players.includes(target);
    if (seated && room.status === 'playing' && room.game) this.applyEvents(room, forfeit(room.game, target.pid));
    room.banned.add(target.key);
    if (target.sid) this.emit.socket(target.sid, 'kicked', { reason: 'The host removed you from the room.' });
    this.removeMember(room, target);
    this.pushFeed(room, `${target.name} was removed by the host`);
    if (room.status === 'playing') this.schedule(room);
    this.touch(room);
    return { ok: true };
  }

  // ---------- match control ----------
  start(sid, data = {}) {
    const c = this.hostCtx(sid);
    if (c.error) return err(c.error);
    if (c.room.status === 'playing' || c.room.status === 'paused') return err('A match is already running.');
    return this.startGame(c.room, !!data.force);
  }

  startGame(room, force) {
    const active = room.players.filter((p) => p.connected);
    if (active.length < MIN_PLAYERS) return err('You need at least 2 connected players to start.');
    if (!force) {
      const waiting = active.filter((p) => p.pid !== room.hostPid && !p.ready);
      if (waiting.length) return err(`Waiting for ${waiting.map((p) => p.name).join(', ')} to press Ready.`, { canForce: true });
    }
    let game;
    try {
      game = createGame(active.map((p) => ({ id: p.pid, name: p.name, color: p.color, avatar: p.avatar })), { mode: room.settings.mode, rules: room.settings.rules });
    } catch (e) { return err(e.message); }
    for (const p of room.players.filter((x) => !x.connected)) this.removeMember(room, p);
    room.game = game; room.status = 'playing'; room.startedAt = this.now(); room.summary = null;
    room.rematch.clear(); room.players.forEach((p) => { p.ready = false; }); room.lastEvents = []; room.eventSeq++;
    this.pushFeed(room, `Match started: ${room.settings.mode} mode, ${active.length} players`);
    this.schedule(room);
    this.touch(room);
    return { ok: true };
  }

  pause(sid) {
    const c = this.hostCtx(sid);
    if (c.error) return err(c.error);
    if (c.room.status !== 'playing') return err('There is no running match to pause.');
    c.room.status = 'paused'; c.room.deadline = null;
    this.pushFeed(c.room, 'Host paused the match ⏸');
    this.touch(c.room);
    return { ok: true };
  }

  resume(sid) {
    const c = this.hostCtx(sid);
    if (c.error) return err(c.error);
    if (c.room.status !== 'paused') return err('The match is not paused.');
    c.room.status = 'playing'; this.pushFeed(c.room, 'Host resumed the match ▶');
    this.schedule(c.room); this.touch(c.room);
    return { ok: true };
  }

  end(sid) {
    const c = this.hostCtx(sid);
    if (c.error) return err(c.error);
    if (!c.room.game || c.room.status === 'over') return err('There is no match to end.');
    this.finish(c.room, 'Ended by the host');
    this.touch(c.room);
    return { ok: true };
  }

  toLobby(sid) {
    const c = this.hostCtx(sid);
    if (c.error) return err(c.error);
    const { room } = c;
    if (room.status !== 'over') return err('The match is still running.');
    room.status = 'lobby'; room.game = null; room.lastEvents = []; room.rematch.clear();
    room.players.forEach((p) => { p.ready = false; });
    this.pushFeed(room, 'Back in the lobby');
    this.touch(room);
    return { ok: true };
  }

  finish(room, reason) {
    const g = room.game;
    room.status = 'over'; room.deadline = null; room.autoNext = false;
    room.summary = {
      reason, mode: g.mode, durationMs: this.now() - room.startedAt, rows: summarize(g),
      winners: g.winner ? g.winner.players.map((i) => g.players[i].name) : [],
    };
    this.pushFeed(room, g.winner ? `🏆 ${room.summary.winners.join(' & ')} won the match` : `Match over: ${reason}`);
  }

  applyEvents(room, events) {
    const g = room.game;
    for (const e of events) { const t = eventText(g, e); if (t) this.pushFeed(room, t); }
    room.lastEvents = events; room.eventSeq++;
    if (g.phase === 'over' && room.status !== 'over') this.finish(room, g.winner?.reason === 'lastStanding' ? 'Last player standing' : 'All tokens home');
  }

  rematch(sid) {
    const c = this.ctx(sid);
    if (!c || c.spectator) return err('Only players can vote.');
    const { room, member } = c;
    if (room.status !== 'over') return err('Rematch voting opens when a match ends.');
    room.rematch.add(member.pid);
    const here = room.players.filter((p) => p.connected);
    this.pushFeed(room, `${member.name} wants a rematch (${room.rematch.size}/${here.length})`);
    if (here.length >= MIN_PLAYERS && here.every((p) => room.rematch.has(p.pid))) return this.startGame(room, true);
    this.touch(room);
    return { ok: true };
  }

  // ---------- gameplay (the only paths that change the game) ----------
  play(sid, action) {
    const c = this.ctx(sid);
    if (!c) return err('You are not in a room.');
    const { room, member, spectator } = c;
    if (spectator) return err('Spectators cannot play.');
    if (room.status === 'paused') return err('The host paused the match.');
    if (room.status !== 'playing' || !room.game) return err('No match is running.');
    const res = act(room.game, member.pid, { ...action, seq: Number.isInteger(action.seq) ? action.seq : undefined }, this.rng);
    if (!res.ok) return err(res.error);
    room.autoNext = false;
    this.applyEvents(room, res.events);
    this.schedule(room); this.touch(room);
    return { ok: true };
  }
  roll(sid, data = {}) { return this.play(sid, { type: 'roll', seq: data.seq }); }
  move(sid, data = {}) { return this.play(sid, { type: 'move', token: data.token, seq: data.seq }); }

  schedule(room) {
    room.deadline = null;
    if (room.status !== 'playing' || !room.game || room.game.phase === 'over') return;
    const cur = room.game.players[room.game.turn];
    const m = room.players.find((p) => p.pid === cur.id);
    let ms = room.settings.timer > 0 ? room.settings.timer * 1000 : null;
    if (!m || !m.connected) ms = Math.min(ms ?? LIMITS.autoMs, LIMITS.autoMs);
    if (room.autoNext) ms = LIMITS.autoStepMs;
    room.autoNext = false;
    if (ms !== null) room.deadline = this.now() + ms;
  }

  autoStep(room) {
    const res = autoPlay(room.game, this.rng);
    if (res.ok) { this.applyEvents(room, res.events); if (room.game.phase === 'move') room.autoNext = true; }
    this.schedule(room); this.touch(room);
  }

  // ---------- social ----------
  chat(sid, data = {}) {
    const c = this.ctx(sid);
    if (!c) return err('You are not in a room.');
    const { room, member } = c;
    if (!this.limiter.allow(`chat:${member.pid}`, 5, 10000)) return err('Slow down: too many messages.');
    const preset = PRESETS.find((p) => p.id === data.preset);
    const text = preset ? preset.text : cleanText(data.text, 200);
    if (!text) return err('Message is empty.');
    const msg = { id: randomBytes(4).toString('hex'), pid: member.pid, name: member.name, text, ts: this.now() };
    room.chat.push(msg); if (room.chat.length > 100) room.chat.shift();
    room.lastActive = this.now();
    this.emit.room(room.id, 'chat', msg);
    return { ok: true };
  }

  react(sid, data = {}) {
    const c = this.ctx(sid);
    if (!c || c.spectator) return err('Only players can react.');
    const { room, member } = c;
    if (!room.settings.reactions) return err('The host turned reactions off.');
    const kind = REACTIONS.find((r) => r.id === data.kind);
    const preset = PRESETS.find((p) => p.id === data.preset);
    if (!kind && !preset) return err('Unknown reaction.');
    if (!this.limiter.allow(`react:${member.pid}`, 1, REACTION_COOLDOWN_MS)) return err('Cooldown: wait a second.');
    const target = room.players.find((p) => p.pid === data.target && p.pid !== member.pid)?.pid ?? null;
    const payload = { id: randomBytes(4).toString('hex'), from: member.pid, target, kind: kind?.id ?? null, emoji: kind?.emoji ?? '', label: kind?.label ?? '', text: preset?.text ?? '' };
    this.pushFeed(room, `${member.name}: ${kind ? `${kind.emoji} ${kind.label}` : preset.text}`);
    this.emit.room(room.id, 'reaction', payload);
    this.touch(room);
    return { ok: true };
  }

  publicRooms() {
    return [...this.rooms.values()]
      .filter((r) => r.settings.isPublic && r.status === 'lobby' && !r.locked && r.players.length < r.settings.maxPlayers)
      .slice(0, 30)
      .map((r) => ({ id: r.id, name: r.settings.name, mode: r.settings.mode, players: r.players.length, max: r.settings.maxPlayers }));
  }

  // ---------- timers & cleanup: call every ~500ms ----------
  tick() {
    const t = this.now();
    for (const room of [...this.rooms.values()]) {
      if (room.deadline && t >= room.deadline && room.status === 'playing' && room.game && room.game.phase !== 'over') this.autoStep(room);
      const host = room.players.find((p) => p.pid === room.hostPid);
      if (host && !host.connected && t - host.lostAt >= LIMITS.hostGraceMs) { this.transferHost(room); this.touch(room); }
      if (room.status === 'lobby') {
        for (const p of [...room.players]) if (!p.connected && t - p.lostAt >= LIMITS.lobbyGraceMs) { this.removeMember(room, p); this.touch(room); }
      }
      for (const s of [...room.spectators]) if (!s.connected && t - s.lostAt >= LIMITS.lobbyGraceMs) { this.removeMember(room, s); this.touch(room); }
      const anyone = [...room.players, ...room.spectators].some((p) => p.connected);
      const idle = t - room.lastActive;
      if ((!anyone && idle >= LIMITS.emptyRoomMs) || (room.status === 'over' && idle >= LIMITS.overRoomMs)) this.rooms.delete(room.id);
    }
    this.limiter.sweep();
  }
}
