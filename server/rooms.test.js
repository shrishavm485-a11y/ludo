import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, LIMITS } from './rooms.js';

function setup(rng = (m) => (m === 6 ? 2 : 0)) { // dice always 3
  const clock = { t: 1_000_000 };
  const out = { room: [], socket: [] };
  const m = new RoomManager({ now: () => clock.t, rng, emit: { room: (id, ev, d) => out.room.push([id, ev, d]), socket: (sid, ev, d) => out.socket.push([sid, ev, d]) } });
  return { m, clock, out };
}
const mk = (m, over = {}) => m.createRoom('host', '1.1.1.1', { nickname: 'Hosty', settings: { maxPlayers: 4 }, ...over });
const joinN = (m, room, n, from = 1) => { for (let i = from; i < from + n; i++) { const r = m.join(`s${i}`, `ip${i}`, { roomId: room.roomId, code: room.room.code, nickname: `P${i}` }); assert.ok(r.ok, r.error); } };

test('create room, join with the code, reject wrong code / unknown room', () => {
  const { m } = setup();
  const r = mk(m);
  assert.ok(r.ok); assert.match(r.roomId, /^LM\d{4}$/); assert.match(r.room.code, /^[A-Z0-9]{4,6}$/);
  assert.equal(m.join('a', 'x', { roomId: r.roomId, code: 'WRONG1', nickname: 'A' }).error, 'Incorrect join code.');
  assert.match(m.join('a', 'x', { roomId: 'LM0000', code: '1234', nickname: 'A' }).error, /Room not found/);
  const j = m.join('a', 'x', { roomId: r.roomId.toLowerCase(), code: r.room.code, nickname: 'A', color: 0 });
  assert.ok(j.ok); assert.equal(j.room.players.length, 2);
  assert.notEqual(j.room.players[0].color, j.room.players[1].color, 'colors are unique');
});

test('a room never exceeds the player cap (10 hard cap, server side)', () => {
  const { m } = setup();
  const r = mk(m, { settings: { maxPlayers: 99 } });
  assert.equal(r.room.settings.maxPlayers, 10);
  joinN(m, r, 9);
  const late = m.join('s99', 'ipx', { roomId: r.roomId, code: r.room.code, nickname: 'Late' });
  assert.equal(late.ok, false); assert.match(late.error, /full/);
  assert.equal(m.rooms.get(r.roomId).players.length, 10);
});

test('custom cap is enforced and spectators can still watch', () => {
  const { m } = setup();
  const r = mk(m, { settings: { maxPlayers: 2 } }); joinN(m, r, 1);
  assert.match(m.join('z', 'z', { roomId: r.roomId, code: r.room.code, nickname: 'Z' }).error, /full/);
  const s = m.join('z', 'z', { roomId: r.roomId, code: r.room.code, nickname: 'Z', spectate: true });
  assert.ok(s.ok); assert.equal(m.rooms.get(r.roomId).players.length, 2);
  assert.equal(m.roll('z').error, 'Spectators cannot play.');
});

test('join attempts are rate limited (code brute force)', () => {
  const { m } = setup(); const r = mk(m);
  let last;
  for (let i = 0; i < 20; i++) last = m.join(`b${i}`, 'attacker', { roomId: r.roomId, code: `00${i}0`, nickname: 'X' });
  assert.match(last.error, /Too many attempts/);
});

test('only the host can start; ready check; team mode needs an even count', () => {
  const { m } = setup();
  const r = mk(m); joinN(m, r, 1);
  assert.equal(m.start('s1', {}).error, 'Only the host can do that.');
  const waiting = m.start('host', {}); assert.equal(waiting.ok, false); assert.ok(waiting.canForce);
  m.profile('s1', { ready: true });
  assert.ok(m.start('host', {}).ok);
  const t = mk(m, { settings: { mode: 'team', maxPlayers: 4 } }); // host already left previous room via createRoom
  const j = m.join('t1', 'ip', { roomId: t.roomId, code: t.room.code, nickname: 'T1' }); assert.ok(j.ok);
  assert.match(m.start('host', { force: true }).error, /Team mode needs/);
});

test('only the current player can roll; duplicates rejected; server rolls the dice', () => {
  const { m } = setup();
  const r = mk(m); joinN(m, r, 1); assert.ok(m.start('host', { force: true }).ok);
  const room = m.rooms.get(r.roomId);
  const first = room.game.players[room.game.turn].id;
  const [hostSid, otherSid] = room.players[0].pid === first ? ['host', 's1'] : ['s1', 'host'];
  assert.equal(m.roll(otherSid).error, 'It is not your turn.');
  assert.ok(m.roll(hostSid).ok);
  assert.equal(room.game.dice, 3);
  assert.equal(m.roll(hostSid, { seq: 0 }).ok, false);
  assert.equal(m.move(hostSid, { token: 99 }).ok, false);
});

test('turn timer auto-plays; disconnected player is auto-played; reconnect restores the seat', () => {
  const { m, clock } = setup();
  const r = mk(m); joinN(m, r, 1); m.start('host', { force: true });
  const room = m.rooms.get(r.roomId);
  const seq0 = room.game.seq;
  clock.t += 31_000; m.tick();
  assert.ok(room.game.seq > seq0, 'timer fired an automatic roll');
  // disconnect everyone's current player and let auto-play run
  const curPid = room.game.players[room.game.turn].id;
  const mem = room.players.find((p) => p.pid === curPid);
  const key = mem.key; const sidOf = mem.sid;
  m.disconnect(sidOf);
  const seq1 = room.game.seq; clock.t += LIMITS.autoMs + 1; m.tick();
  assert.ok(room.game.seq > seq1, 'disconnected player auto-played');
  const back = m.rejoin('new-sid', 'ip', { roomId: r.roomId, key });
  assert.ok(back.ok); assert.equal(back.you.pid, curPid);
  assert.equal(m.rejoin('evil', 'ip', { roomId: r.roomId, key: 'nope' }).ok, false);
});

test('host transfer after the grace period; kick and lock work', () => {
  const { m, clock } = setup();
  const r = mk(m); joinN(m, r, 2);
  const room = m.rooms.get(r.roomId);
  m.disconnect('host'); clock.t += LIMITS.hostGraceMs + 1; m.tick();
  assert.notEqual(room.hostPid, r.you.pid);
  const newHostSid = room.players.find((p) => p.pid === room.hostPid).sid;
  const victim = room.players.find((p) => p.pid !== room.hostPid && p.connected);
  assert.ok(m.kick(newHostSid, { pid: victim.pid }).ok);
  assert.equal(room.players.some((p) => p.pid === victim.pid), false);
  assert.ok(m.lock(newHostSid, { locked: true }).ok);
  assert.equal(m.join('late', 'l', { roomId: r.roomId, code: r.room.code, nickname: 'L' }).error, 'The host locked this room.');
  assert.equal(m.rejoin('x', 'x', { roomId: r.roomId, key: victim.key }).ok, false, 'kicked player cannot come back');
});

test('chat and nickname are sanitised; chat and reactions are rate limited; reactions can be disabled', () => {
  const { m, clock, out } = setup();
  const r = mk(m, { nickname: '<img src=x onerror=alert(1)>' });
  assert.ok(!/[<>]/.test(r.room.players[0].name));
  joinN(m, r, 1);
  assert.ok(m.chat('host', { text: '  <script>hi</script>  ' }).ok);
  assert.ok(!/[<>]/.test(out.room.filter((e) => e[1] === 'chat').at(-1)[2].text));
  assert.equal(m.chat('host', { text: '   ' }).ok, false);
  for (let i = 0; i < 4; i++) m.chat('host', { text: `m${i}` });
  assert.match(m.chat('host', { text: 'spam' }).error, /Slow down/);
  assert.ok(m.react('host', { kind: 'lol' }).ok);
  assert.match(m.react('host', { kind: 'lol' }).error, /Cooldown/);
  clock.t += 2000;
  assert.equal(m.react('host', { kind: 'nonsense' }).ok, false);
  assert.ok(m.react('host', { preset: 'six', target: 'whoever' }).ok);
  const off = mk(m, { settings: { reactions: false } });
  assert.match(m.react('host', { kind: 'lol' }).error, /turned reactions off/);
  assert.ok(off.ok);
});

test('public room list never exposes join codes', () => {
  const { m } = setup();
  const r = mk(m, { settings: { isPublic: true, name: 'Open table' } });
  const list = m.publicRooms();
  assert.equal(list.length, 1); assert.equal(list[0].id, r.roomId);
  assert.ok(!JSON.stringify(list).includes(r.room.code));
});

test('finishing a match records a summary and rematch voting starts a new game', () => {
  const { m } = setup();
  const r = mk(m); joinN(m, r, 1); m.start('host', { force: true });
  const room = m.rooms.get(r.roomId);
  assert.ok(m.end('host').ok); assert.equal(room.status, 'over'); assert.ok(room.summary.rows.length === 2);
  const gid = room.game.gid;
  assert.ok(m.rematch('host').ok); assert.equal(room.status, 'over');
  assert.ok(m.rematch('s1').ok);
  assert.equal(room.status, 'playing'); assert.notEqual(room.game.gid, gid);
  m.end('host'); assert.ok(m.toLobby('host').ok); assert.equal(room.status, 'lobby'); assert.ok(room.summary, 'last summary is kept for replay');
});

test('leaving mid-match forfeits and ends a two player match', () => {
  const { m } = setup();
  const r = mk(m); joinN(m, r, 1); m.start('host', { force: true });
  const room = m.rooms.get(r.roomId);
  m.leave('s1');
  assert.equal(room.status, 'over'); assert.equal(room.summary.reason, 'Last player standing');
});
