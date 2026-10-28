# 🎲 LUDO MAYHEM

Multiplayer Ludo for **2 to 10 players**. Play **online** (private room: Room ID + Join Code) or **offline** on one device (pass-and-play). Bold neo-brutalist + neumorphic design, mobile first, installable PWA.

- Frontend: React + Vite · Backend: Node.js + Express + Socket.IO · Deployment: one Render Web Service
- Server-authoritative: dice, turns, moves, captures and wins are all decided on the server.
- The rules live in **one** shared module (`shared/engine.js`) used by the browser (offline) and the server (online).

---

## 1. Project structure

```
shared/engine.js      Rules engine: board model, dice, moves, captures, modes, 2-10 players (pure JS)
shared/layout.js      Board geometry for the SVG renderer (classic cross / radial 5-10 arm board)
shared/social.js      Avatars, reactions, preset messages, text sanitising
shared/*.test.js      Engine tests (node:test)
server/rooms.js       Room manager: rooms, codes, limits, reconnects, host transfer, timers, rate limits
server/index.js       Express + Socket.IO wiring, /healthz, serves the built frontend
server/rooms.test.js  Room / security tests
client/src/           React app (menu, offline setup, online lobby, board, game view, panels, styles)
client/public/        PWA manifest, service worker, icons
render.yaml           Render Blueprint (free plan)
```

## 2. Run it on your computer

Needs **Node.js 20 or newer** (https://nodejs.org).

```bash
npm install
npm test            # engine + room tests
npm run build       # builds the frontend into /dist
npm start           # http://localhost:3000  (server + frontend together)
```

Development with live reload (two terminals):

```bash
npm run dev          # terminal 1: backend on :3000
npm run dev:client   # terminal 2: frontend on :5173 (proxies /socket.io to :3000)
```

Optional: copy `.env.example` to `.env` (the server reads normal environment variables; Render sets `PORT` itself).

## 3. Test multiplayer

**Two browser sessions:** open `http://localhost:5173` (dev) or `:3000` (after build) in a normal window and an incognito window. Create a room in one, copy the Room ID and Join Code, join from the other, press READY, then START MATCH as host.

**Two phones on the same Wi-Fi:** run `npm start`, find your computer's local IP (for example `192.168.1.20`) and open `http://192.168.1.20:3000` on both phones.

**After deploying:** open your `https://….onrender.com` URL on two phones and use COPY INVITE.

Things worth trying: wrong join code (rejected), an 11th player (rejected: "Room is full"), closing a tab mid-game and reopening it (you rejoin your seat; meanwhile the server plays for you), host leaving (crown moves to the next player).

## 4. Put it on GitHub

```bash
git init
git add .
git commit -m "LUDO MAYHEM"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/ludo-mayhem.git
git push -u origin main
```

`npm install` creates `package-lock.json`: commit it too. `.gitignore` already excludes `node_modules`, `dist`, `.env` and logs.

## 5. Deploy on Render (free)

It must be a **Web Service** (Node), not a Static Site: Socket.IO needs a running server.

1. Sign in at https://render.com and connect your GitHub account.
2. **New + → Blueprint**, pick the repo (it reads `render.yaml`). Or **New + → Web Service** and enter by hand:
   - Runtime: **Node** · Build command: `npm install --include=dev && npm run build` · Start command: `npm start`
   - Health check path: `/healthz` · Environment variable: `NODE_VERSION` = `20`
3. Wait for the build, then open the `https://….onrender.com` URL.

No secrets are needed. The frontend talks to the **same origin**, so nothing is hardcoded to localhost.

### Free-tier limits (please read)

- A free service **sleeps after ~15 minutes without traffic** and takes up to a minute to wake. The app shows a "connecting" banner.
- Rooms and running games live **in memory**: a restart, redeploy or sleep **erases all rooms and matches**. Players will see "room no longer exists".
- Everything runs in **one process**. To scale to several instances you would need Redis (Socket.IO adapter + shared room store). `RoomManager` is the only place that would change.

## 6. How the rules work

- Ring of `arms × 13` squares; every player owns one arm with their own start square, safe star, 5-square home lane and HOME.
- 2, 3 and 4 players use the classic cross board (2 players sit opposite). 5-10 players get a radial board with one arm per player, so nobody shares a start square. Every player has the same path length, so no seat is favoured.
- 6 to leave the yard; exact roll to finish; capture on non-safe squares; extra turn for a 6, a capture or reaching HOME; three 6s forfeit the turn; first to bring 4 tokens home wins.
- Modes: Classic (standard), Chaos (random events), Speed (15 s), Knockout (3 lives), Team (opposite partners). Custom rules never apply in Classic.

## 7. Security notes

Server rolls dice with `crypto.randomInt`; every move is validated against the engine (turn owner, phase, legal token); stale/duplicate requests are rejected; player cap is enforced on the server (hard maximum 10); join codes are compared in constant time and never listed in public rooms; join attempts, room creation, chat and reactions are rate limited; nicknames and chat are sanitised; payloads over 10 KB are refused; the secret reconnect key is only sent to its owner.

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| `vite: not found` on Render | Build command must be `npm install --include=dev && npm run build` |
| Page loads but "Connecting…" forever | Free service is waking up (wait ~1 min), or you opened a static host. Use a Node Web Service |
| "Room not found" right after it worked | The server restarted or slept: in-memory rooms are gone. Create a new room |
| Phone cannot reach `http://192.168…` | Same Wi-Fi? Allow Node through the firewall; use the deployed URL instead |
| Port already in use | Set `PORT=3001` |
| Offline mode says nothing / blank when offline | Open the site once online first so the service worker caches it, then reload |
| Old version after redeploy | Reload twice or clear site data (service worker cache) |

## 9. Implemented features and limitations

Implemented: online rooms (create/join/quick/public list, Room ID + code, 2-10 players, ready, kick, lock, host transfer, reconnection, spectators, pause/end, rematch vote, back to lobby), offline 2-10 players with hand-off screen, pause, rematch and score tracking, five modes, 12 reactions + preset messages with cooldown/mute/host switch, chat, event feed, match timer, turn timer with auto-play, result card (PNG share/download), sounds (synthesised), haptics, light/dark theme, statistics (local), fullscreen, PWA + offline cache, automated tests.

Limitations (honest list):
- Rooms are in memory (see free-tier notes). No accounts, no persistence of stats across devices.
- Chat filtering only sanitises characters; there is no profanity filter. Reactions are fixed presets.
- Kicked players are blocked by their device key only, so a determined user could rejoin with a new identity.
- The game ends when the first player (or team) finishes; there is no full ranking play-on.
- On a phone, a 10-player board is small: use "Zoom in" or the token buttons under the dice.
- The timer applies to each decision (roll or move), not to the whole turn.
- Browser-side code (React UI) was written and statically checked but could not be built or run in the sandbox that produced this project (no network for `npm install`): run `npm install && npm run build` first and report any error. The engine and server logic are covered by the automated tests.
