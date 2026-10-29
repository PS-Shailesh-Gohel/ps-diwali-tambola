'use strict';
// ProductSquads Diwali Tambola server: Express (pages + API) and Socket.io (real-time game).

const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

// Minimal .env loader (no extra dependency)
(function loadEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
}());

const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Game, GameError } = require('./game');
const { toCsv } = require('./csv');
const { renderTickets, renderSlips } = require('./print');

const PORT = Number(process.env.PORT) || 3000;
const HOST_PASSWORD = process.env.HOST_PASSWORD || 'diwali2026';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

if (!process.env.HOST_PASSWORD) {
  console.warn('⚠️  HOST_PASSWORD is not set. Using the default "diwali2026" - set your own before the event.');
}

const game = new Game({ file: path.join(DATA_DIR, 'game.json') });
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});
// Always revalidate pages, scripts and styles so a refresh never runs an old version.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  extensions: ['html'],
  setHeaders: (res, file) => { if (/\.(html|js|css)$/.test(file)) res.set('Cache-Control', 'no-cache'); }
}));
app.get('/', (req, res) => res.redirect('/play'));

// ---------- host auth ----------
const hostTokens = new Map(); // token -> expiry time
const HOST_SESSION_MS = 24 * 60 * 60 * 1000;
const loginFails = new Map(); // ip -> {count, until}

function passwordOk(pw) {
  const a = crypto.createHash('sha256').update(String(pw || '')).digest();
  const b = crypto.createHash('sha256').update(HOST_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
function isHost(token) {
  const exp = token && hostTokens.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { hostTokens.delete(token); return false; }
  return true;
}
function requireHost(req, res, next) {
  const token = req.get('x-host-token') || req.query.token;
  if (!isHost(token)) return res.status(401).json({ error: 'Please log in as host again.' });
  return next();
}

const baseUrl = (req) => PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const msg = (e) => (e instanceof GameError ? e.message : 'Something went wrong. Please try again.');
const handle = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    if (!(e instanceof GameError)) console.error(e);
    res.status(e instanceof GameError ? 400 : 500).json({ error: msg(e) });
  }
};

app.post('/api/host/login', handle((req) => {
  const ip = req.ip;
  const f = loginFails.get(ip);
  if (f && f.count >= 8 && f.until > Date.now()) throw new GameError('Too many attempts. Try again in a few minutes.');
  if (!passwordOk(req.body && req.body.password)) {
    const next = f && f.until > Date.now() ? { count: f.count + 1, until: f.until } : { count: 1, until: Date.now() + 10 * 60 * 1000 };
    loginFails.set(ip, next);
    throw new GameError('Wrong password.');
  }
  loginFails.delete(ip);
  const token = crypto.randomBytes(24).toString('hex');
  hostTokens.set(token, Date.now() + HOST_SESSION_MS);
  return { token };
}));

app.post('/api/host/roster/preview', requireHost, handle((req) => game.previewRoster(req.body.csv)));
app.post('/api/host/roster/import', requireHost, handle((req) => {
  const result = game.importRoster(req.body.csv);
  broadcastAll();
  sendAllPlayers();
  return result;
}));

app.get('/api/roster-template.csv', (req, res) => {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="tambola-roster-template.csv"');
  res.send(toCsv([
    ['Name', 'Email/Employee ID', 'Team', 'Tickets Bought', 'Paid (Yes/No)'],
    ['Employee One', 'employee.one@productsquads.co', 'QA', 3, 'Yes'],
    ['Employee Two', 'EMP-1002', 'Engineering', 1, 'Yes'],
    ['Employee Three', 'EMP-1003', 'Talent', 2, 'No']
  ]));
});

app.get('/api/host/export/send-ready.csv', requireHost, handle((req, res) => {
  const base = baseUrl(req);
  const rows = [['Name', 'Email/Employee ID', 'Team', 'Ticket count', 'Ticket IDs', 'Personal link', 'PIN', 'Paid']];
  Object.values(game.state.players).forEach((p) => rows.push([
    p.name, p.key, p.team, p.ticketIds.length, p.ticketIds.join(' '), p.ticketIds.length ? `${base}/play?t=${p.token}` : '', p.pin, p.paid ? 'Yes' : 'No'
  ]));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="tambola-send-ready.csv"');
  res.send(toCsv(rows));
}));

app.get('/api/host/export/results.csv', requireHost, handle((req, res) => {
  const rows = [['Prize', 'Prize value', 'Winner', 'Team', 'Ticket ID', 'Winning number', 'Shared', 'Confirmed at']];
  game.state.winners.forEach((w) => rows.push([
    w.prizeName, w.value, w.name, w.team, w.ticketId, w.number, w.shared || '', new Date(w.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  ]));
  rows.push([]);
  rows.push(['Numbers drawn (in order)', game.state.draws.join(' ')]);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="tambola-results.csv"');
  res.send(toCsv(rows));
}));

const QR_OPTS = { margin: 1, width: 360, color: { dark: '#140F2E', light: '#FFF7E6' } };

app.get('/api/host/players/:id/qr.png', requireHost, handle(async (req, res) => {
  const p = game.player(req.params.id);
  const png = await QRCode.toBuffer(`${baseUrl(req)}/play?t=${p.token}`, QR_OPTS);
  res.set('Content-Type', 'image/png');
  res.send(png);
}));

app.get('/api/join-qr.png', handle(async (req, res) => {
  const png = await QRCode.toBuffer(`${baseUrl(req)}/play`, QR_OPTS);
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-store');
  res.send(png);
}));

app.post('/api/player/login', handle((req) => {
  const p = game.playerByLogin(req.body.key, req.body.pin);
  if (!p) throw new GameError("We couldn't find that Email/Employee ID and PIN. Check the message from the host.");
  if (!p.ticketIds.length) throw new GameError("Your tickets aren't ready yet. Please check with the host.");
  return { token: p.token };
}));

app.get('/print/tickets', requireHost, handle((req, res) => {
  res.type('html').send(renderTickets(game, req.query.player));
}));

app.get('/print/slips', requireHost, handle(async (req, res) => {
  const base = baseUrl(req);
  const qr = {};
  for (const p of Object.values(game.state.players)) {
    if (p.ticketIds.length) qr[p.id] = await QRCode.toDataURL(`${base}/play?t=${p.token}`, { margin: 1, width: 220 });
  }
  res.type('html').send(renderSlips(game, base, qr));
}));

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------- real-time ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

const online = new Map(); // playerId -> Set(socketId)
let autoTimer = null;

function onlineInfo() {
  const warnings = [];
  online.forEach((set, pid) => {
    if (set.size > 2 && game.state.players[pid]) warnings.push({ playerId: pid, name: game.state.players[pid].name, devices: set.size });
  });
  return {
    players: online.size,
    displays: (io.sockets.adapter.rooms.get('display') || new Set()).size,
    warnings
  };
}
const publicState = () => ({ ...game.publicView(), online: online.size, auto: !!autoTimer });
const hostState = () => ({ ...game.hostView(), online: onlineInfo(), auto: !!autoTimer });

function broadcastHost() { io.to('hosts').emit('host:state', hostState()); }
function broadcastPublic() { io.to('display').to('players').emit('public:state', publicState()); }
function broadcastAll() { broadcastHost(); broadcastPublic(); }
function sendPlayer(pid) {
  if (!game.state.players[pid]) return;
  io.to(`p:${pid}`).emit('player:state', game.playerView(pid));
}
function sendAllPlayers() { online.forEach((_, pid) => sendPlayer(pid)); }

function doDraw() {
  const d = game.draw();
  io.emit('drawn', d);
  broadcastAll();
  if (game.state.draws.length >= 90) setAuto(false);
  return d;
}

function setAuto(on) {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  if (on) {
    const ms = Math.max(4, Number(game.state.settings.autoInterval) || 8) * 1000;
    autoTimer = setInterval(() => {
      try { doDraw(); } catch (e) {
        if (game.state.draws.length >= 90 || !(e instanceof GameError)) setAuto(false);
      }
    }, ms);
    try { doDraw(); } catch (e) { /* first draw may be throttled; the timer continues */ }
  }
  broadcastAll();
  return { auto: !!autoTimer };
}

io.on('connection', (socket) => {
  socket.data = {};

  const hostCmd = (event, fn) => socket.on(event, (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!socket.data.host || !isHost(socket.data.hostToken)) return reply({ ok: false, error: 'Please log in as host again.', auth: false });
    try {
      const result = fn(payload || {});
      return reply({ ok: true, result });
    } catch (e) {
      if (!(e instanceof GameError)) console.error(e);
      return reply({ ok: false, error: msg(e) });
    }
  });

  socket.on('host:auth', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const token = payload && payload.token;
    if (!isHost(token)) return reply({ ok: false, error: 'Please log in as host again.' });
    socket.data.host = true;
    socket.data.hostToken = token;
    socket.join('hosts');
    return reply({ ok: true, state: hostState() });
  });

  socket.on('display:join', (payload, ack) => {
    socket.join('display');
    if (typeof ack === 'function') ack({ ok: true, state: publicState() });
    broadcastHost();
  });

  socket.on('player:join', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const p = game.playerByToken(payload && payload.token);
    if (!p) return reply({ ok: false, error: 'This link is not valid any more. Ask the host for your personal link.' });
    if (!p.ticketIds.length) return reply({ ok: false, error: "Your tickets aren't ready yet. Please check with the host." });
    socket.data.playerId = p.id;
    socket.join('players');
    socket.join(`p:${p.id}`);
    if (!online.has(p.id)) online.set(p.id, new Set());
    online.get(p.id).add(socket.id);
    reply({ ok: true, public: publicState(), me: game.playerView(p.id) });
    return broadcastHost();
  });

  socket.on('player:mark', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      game.setMark(socket.data.playerId, payload.ticketId, payload.number, !!payload.on);
      reply({ ok: true });
      socket.to(`p:${socket.data.playerId}`).emit('player:state', game.playerView(socket.data.playerId));
    } catch (e) { reply({ ok: false, error: msg(e) }); }
  });

  socket.on('player:claim', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const claim = game.claim(socket.data.playerId, payload && payload.prize);
      reply({ ok: true, claim: { id: claim.id, prize: claim.prize, ticketId: claim.ticketId, status: claim.status } });
      io.to('hosts').emit('host:claim', claim);
      sendPlayer(socket.data.playerId);
      broadcastHost();
    } catch (e) { reply({ ok: false, error: msg(e) }); }
  });

  hostCmd('host:draw', () => doDraw());
  hostCmd('host:undo', () => {
    const n = game.undo();
    io.emit('undo', { number: n });
    broadcastAll();
    return { number: n };
  });
  hostCmd('host:auto', ({ on }) => setAuto(!!on));
  hostCmd('host:settings', (patch) => {
    game.updateSettings(patch);
    if (autoTimer && patch.autoInterval !== undefined) setAuto(true);
    broadcastAll();
    sendAllPlayers();
  });
  hostCmd('host:player:save', (input) => {
    const p = game.savePlayer(input);
    broadcastAll();
    sendPlayer(p.id);
    return { id: p.id };
  });
  hostCmd('host:player:remove', ({ id }) => {
    game.removePlayer(id);
    io.to(`p:${id}`).emit('player:removed');
    online.delete(id);
    broadcastAll();
  });
  hostCmd('host:generate', () => {
    const made = game.generateMissingTickets();
    broadcastAll();
    sendAllPlayers();
    return { made };
  });
  hostCmd('host:claim:confirm', ({ id }) => {
    const winners = game.confirmClaim(id);
    io.emit('winner', { winners: winners.map((w) => ({ prize: w.prize, prizeName: w.prizeName, value: w.value, name: w.name, team: w.team, ticketId: w.ticketId, shared: w.shared })) });
    winners.forEach((w) => sendPlayer(w.playerId));
    broadcastAll();
    if (game.state.status === 'ended') setAuto(false);
    return { winners: winners.length };
  });
  hostCmd('host:claim:reject', ({ id }) => {
    const c = game.rejectClaim(id);
    sendPlayer(c.playerId);
    broadcastHost();
  });
  hostCmd('host:claim:bogey', ({ id }) => {
    const c = game.bogeyClaim(id);
    const prizeName = game.state.settings.prizes[c.prize].name;
    io.emit('bogey', { name: c.playerName, team: c.team, prizeName });
    sendPlayer(c.playerId);
    broadcastHost();
  });
  hostCmd('host:sales-override', ({ on }) => { game.setSalesOverride(on); broadcastAll(); });
  hostCmd('host:end', () => { setAuto(false); game.endGame(); broadcastAll(); });
  hostCmd('host:new-round', () => {
    setAuto(false);
    game.newRound();
    io.emit('reset');
    broadcastAll();
    sendAllPlayers();
  });
  hostCmd('host:reset', () => {
    setAuto(false);
    game.resetAll();
    io.emit('player:removed');
    online.clear();
    broadcastAll();
  });

  socket.on('disconnect', () => {
    const pid = socket.data.playerId;
    if (pid && online.has(pid)) {
      online.get(pid).delete(socket.id);
      if (!online.get(pid).size) online.delete(pid);
    }
    if (pid || socket.rooms) broadcastHost();
  });
});

server.listen(PORT, () => {
  const base = PUBLIC_URL || `http://localhost:${PORT}`;
  console.log('\n🪔  ProductSquads Diwali Tambola is running');
  console.log(`   Players:   ${base}/play`);
  console.log(`   Projector: ${base}/display`);
  console.log(`   Host:      ${base}/host\n`);
});

function shutdown() {
  game.saveNow();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, server };
