'use strict';
// The whole game lives here: players, tickets, draws, claims and winners.
// Everything is kept in memory and saved to a JSON file so a restart loses nothing.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateTicket, ticketKey } = require('./tickets');
const { PRIZES, PRIZE_BY_KEY, completedAt, missingNumbers, drawIndexOf } = require('./prizes');
const { callFor, hindiFor } = require('./calls');
const { readRoster } = require('./csv');

const MIN_DRAW_GAP_MS = 3000; // the coin animation takes ~2.6s on every screen

class GameError extends Error {}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = (len = 6) => Array.from({ length: len }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
const randomToken = () => crypto.randomBytes(16).toString('hex');
const randomPin = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');
const normKey = (k) => String(k || '').trim().toLowerCase();

function parsePaid(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'paid'].includes(s)) return true;
  if (['no', 'n', 'false', '0', '', 'unpaid'].includes(s)) return false;
  return null;
}

function defaultSettings() {
  return {
    title: 'Diwali Tambola 2026',
    maxTickets: 5,
    price: 50,
    autoInterval: 8,
    voice: true,
    voiceRate: 1,
    voiceMode: 'male', // male (one Indian English voice, the original) | alternate | female
    voiceVersion: 2,
    prizes: Object.fromEntries(PRIZES.map((p) => [p.key, { enabled: p.defaultOn, name: p.name, value: '' }])),
    rules: { onePrizePerPerson: false, tieMode: 'split' } // tieMode: 'split' | 'both'
  };
}

function mergeSettings(saved) {
  const d = defaultSettings();
  if (!saved) return d;
  // Games saved before voiceVersion 2 go back to the original single voice.
  if (!saved.voiceVersion) saved = { ...saved, voiceMode: 'male', voiceVersion: 2 };
  return {
    ...d,
    ...saved,
    prizes: { ...d.prizes, ...(saved.prizes || {}) },
    rules: { ...d.rules, ...(saved.rules || {}) }
  };
}

function freshState() {
  return {
    gameCode: randomCode(),
    createdAt: Date.now(),
    status: 'setup', // setup | running | ended
    salesOverride: false,
    settings: defaultSettings(),
    players: {},
    tickets: {},
    ticketSeq: 0,
    draws: [],
    drawTimes: [],
    lastDrawAt: 0,
    claims: [],
    winners: [],
    bogeys: {},
    marks: {}
  };
}

class Game {
  constructor({ file = null, now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    this.state = freshState();
    this._ticketKeys = null;
    this._saveTimer = null;
    if (file) this.load();
  }

  // ---------- persistence ----------
  load() {
    try {
      if (fs.existsSync(this.file)) {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.state = { ...freshState(), ...saved, settings: mergeSettings(saved.settings) };
      }
    } catch (e) {
      console.error('Could not read the saved game, starting fresh:', e.message);
    }
  }

  save() {
    if (!this.file) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), 200);
  }

  saveNow() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.file);
  }

  get s() { return this.state; }

  // ---------- lookups ----------
  salesLocked() { return this.s.draws.length > 0 && !this.s.salesOverride; }

  player(id) {
    const p = this.s.players[id];
    if (!p) throw new GameError('Player not found.');
    return p;
  }

  playerByToken(token) {
    if (!token) return null;
    return Object.values(this.s.players).find((p) => p.token === token) || null;
  }

  playerByLogin(key, pin) {
    const k = normKey(key);
    return Object.values(this.s.players).find((p) => p.keyNorm === k && p.pin === String(pin || '').trim()) || null;
  }

  findByKey(key) {
    const k = normKey(key);
    return Object.values(this.s.players).find((p) => p.keyNorm === k) || null;
  }

  totals() {
    const players = Object.values(this.s.players);
    const price = Number(this.s.settings.price) || 0;
    return {
      players: players.length,
      tickets: Object.keys(this.s.tickets).length,
      collected: players.filter((p) => p.paid).reduce((sum, p) => sum + p.bought * price, 0),
      unpaid: players.filter((p) => !p.paid).length
    };
  }

  // ---------- tickets ----------
  _keys() {
    if (!this._ticketKeys) this._ticketKeys = new Set(Object.values(this.s.tickets).map((t) => ticketKey(t.rows)));
    return this._ticketKeys;
  }

  _newTicket(playerId) {
    const keys = this._keys();
    let rows;
    let key;
    do { rows = generateTicket(); key = ticketKey(rows); } while (keys.has(key));
    keys.add(key);
    this.s.ticketSeq += 1;
    const id = `DT-${String(this.s.ticketSeq).padStart(4, '0')}`;
    this.s.tickets[id] = { id, playerId, rows };
    return id;
  }

  _syncTickets(p) {
    if (!p.paid) return 0;
    let made = 0;
    while (p.ticketIds.length < p.bought) { p.ticketIds.push(this._newTicket(p.id)); made++; }
    return made;
  }

  generateMissingTickets() {
    if (this.salesLocked()) throw new GameError('Sales are locked because the game has started. Use "Override lock" first.');
    let made = 0;
    Object.values(this.s.players).forEach((p) => { made += this._syncTickets(p); });
    this.save();
    return made;
  }

  // ---------- players ----------
  _validatePlayerInput({ name, key, bought, paid }) {
    const errors = [];
    if (!String(name || '').trim()) errors.push('Name is missing');
    if (!String(key || '').trim()) errors.push('Email/Employee ID is missing');
    const n = Number(bought);
    const max = Number(this.s.settings.maxTickets) || 5;
    if (!Number.isInteger(n) || n < 1) errors.push('Tickets must be a whole number of 1 or more');
    else if (n > max) errors.push(`Tickets above the max of ${max}`);
    if (paid === null) errors.push('Paid must be Yes or No');
    return errors;
  }

  savePlayer(input) {
    const name = String(input.name || '').trim().slice(0, 80);
    const key = String(input.key || '').trim().slice(0, 120);
    const team = String(input.team || '').trim().slice(0, 60);
    const bought = Number(input.bought);
    const paid = typeof input.paid === 'boolean' ? input.paid : parsePaid(input.paid);
    const errors = this._validatePlayerInput({ name, key, bought, paid });
    if (errors.length) throw new GameError(errors.join('; '));

    const sameKey = this.findByKey(key);
    let p = null;
    if (input.id) {
      p = this.player(input.id);
      if (sameKey && sameKey.id !== p.id) throw new GameError('Another player already uses that email/Employee ID.');
    } else if (sameKey) {
      p = sameKey; // adding to an existing player
    }

    const locked = this.salesLocked();
    if (!p && locked) throw new GameError('Sales are locked because the game has started. Use "Override lock" to add players.');
    if (p && locked && paid && bought > p.ticketIds.length) {
      throw new GameError('Sales are locked because the game has started. Use "Override lock" to add tickets.');
    }
    if (!p) {
      p = { id: randomToken().slice(0, 12), token: randomToken(), pin: randomPin(), ticketIds: [], createdAt: this.now() };
      this.s.players[p.id] = p;
    }
    if (bought < p.ticketIds.length) {
      if (this.s.draws.length) throw new GameError("Tickets can't be removed after the game has started.");
      const extra = p.ticketIds.splice(bought);
      extra.forEach((t) => { delete this.s.tickets[t]; });
      this._ticketKeys = null;
    }
    Object.assign(p, { name, key, keyNorm: normKey(key), team, bought, paid });
    this._syncTickets(p);
    this.save();
    return p;
  }

  removePlayer(id) {
    const p = this.player(id);
    if (this.s.draws.length && p.ticketIds.length) throw new GameError("Players with tickets can't be removed after the game has started.");
    p.ticketIds.forEach((t) => { delete this.s.tickets[t]; });
    this._ticketKeys = null;
    delete this.s.players[id];
    delete this.s.marks[id];
    this.save();
  }

  previewRoster(csvText) {
    const { records, headerErrors } = readRoster(csvText);
    const seen = new Map();
    const rows = records.map((r) => {
      const paid = parsePaid(r.paidRaw);
      const bought = r.boughtRaw === '' ? NaN : Number(r.boughtRaw);
      const errors = this._validatePlayerInput({ name: r.name, key: r.key, bought, paid });
      const k = normKey(r.key);
      if (k) {
        if (seen.has(k)) errors.push(`Duplicate email/Employee ID (also on row ${seen.get(k)})`);
        else seen.set(k, r.line);
      }
      const existing = k ? this.findByKey(k) : null;
      if (existing && this.s.draws.length && bought < existing.ticketIds.length) errors.push("Can't reduce tickets after the game has started");
      if (!existing && this.salesLocked()) errors.push('Sales are locked (game started)');
      return { line: r.line, name: r.name, key: r.key, team: r.team, bought: r.boughtRaw, paid, status: existing ? 'update' : 'new', errors };
    });
    return {
      headerErrors,
      rows,
      errorCount: rows.filter((r) => r.errors.length).length,
      newCount: rows.filter((r) => r.status === 'new' && !r.errors.length).length,
      updateCount: rows.filter((r) => r.status === 'update' && !r.errors.length).length
    };
  }

  importRoster(csvText) {
    const preview = this.previewRoster(csvText);
    if (preview.headerErrors.length) throw new GameError(preview.headerErrors.join(' '));
    if (preview.errorCount) throw new GameError(`${preview.errorCount} row(s) need fixing before import.`);
    preview.rows.forEach((r) => this.savePlayer({ name: r.name, key: r.key, team: r.team, bought: Number(r.bought), paid: r.paid }));
    return preview;
  }

  setSalesOverride(on) { this.s.salesOverride = !!on; this.save(); }

  // ---------- settings ----------
  updateSettings(patch = {}) {
    const st = this.s.settings;
    if (patch.title !== undefined) st.title = String(patch.title).slice(0, 60);
    if (patch.maxTickets !== undefined) st.maxTickets = Math.max(1, Math.min(20, parseInt(patch.maxTickets, 10) || 5));
    if (patch.price !== undefined) st.price = Math.max(0, Number(patch.price) || 0);
    if (patch.autoInterval !== undefined) st.autoInterval = Math.max(4, Math.min(60, Number(patch.autoInterval) || 8));
    if (patch.voice !== undefined) st.voice = !!patch.voice;
    if (['alternate', 'male', 'female'].includes(patch.voiceMode)) st.voiceMode = patch.voiceMode;
    if (patch.voiceRate !== undefined) st.voiceRate = Math.max(0.6, Math.min(1.4, Number(patch.voiceRate) || 1));
    if (patch.rules) {
      if (patch.rules.onePrizePerPerson !== undefined) st.rules.onePrizePerPerson = !!patch.rules.onePrizePerPerson;
      if (['split', 'both'].includes(patch.rules.tieMode)) st.rules.tieMode = patch.rules.tieMode;
    }
    if (patch.prizes) {
      Object.entries(patch.prizes).forEach(([k, v]) => {
        if (!st.prizes[k] || !v) return;
        if (v.enabled !== undefined) st.prizes[k].enabled = !!v.enabled;
        if (v.name !== undefined) st.prizes[k].name = String(v.name).slice(0, 40) || PRIZE_BY_KEY[k].name;
        if (v.value !== undefined) st.prizes[k].value = String(v.value).slice(0, 40);
      });
    }
    this.save();
    return st;
  }

  // ---------- drawing ----------
  draw() {
    const s = this.s;
    if (s.draws.length >= 90) throw new GameError('All 90 numbers have been drawn.');
    if (s.status === 'ended') throw new GameError('The game has ended. Start a new round to play again.');
    if (!Object.keys(s.tickets).length) throw new GameError('There are no tickets yet. Add players and generate tickets first.');
    if (this.now() - (s.lastDrawAt || 0) < MIN_DRAW_GAP_MS) throw new GameError('Wait for the coin to land before drawing again.');
    const drawn = new Set(s.draws);
    const remaining = [];
    for (let n = 1; n <= 90; n++) if (!drawn.has(n)) remaining.push(n);
    return this.applyDraw(remaining[crypto.randomInt(remaining.length)]);
  }

  // Records a specific number (used by draw() and by tests).
  applyDraw(number) {
    const s = this.s;
    if (s.draws.includes(number)) throw new GameError(`${number} was already drawn.`);
    s.draws.push(number);
    s.drawTimes.push(this.now());
    s.lastDrawAt = this.now();
    s.status = 'running';
    this.save();
    return { number, index: s.draws.length, call: callFor(number), hindi: hindiFor(number) };
  }

  undo() {
    const s = this.s;
    if (!s.draws.length) throw new GameError('Nothing to undo.');
    const lastIdx = s.draws.length - 1;
    if (s.winners.some((w) => w.completedAt === lastIdx)) {
      throw new GameError("A prize was confirmed on this number, so it can't be undone.");
    }
    const n = s.draws.pop();
    s.drawTimes.pop();
    s.lastDrawAt = 0;
    s.claims
      .filter((c) => c.status === 'pending' && c.valid && c.completedAt >= s.draws.length)
      .forEach((c) => { c.valid = false; c.reason = `Number ${n} was undone`; });
    if (!s.draws.length) s.status = 'setup';
    this.save();
    return n;
  }

  // ---------- claims ----------
  claim(playerId, prizeKey) {
    const s = this.s;
    const p = this.player(playerId);
    const cfg = s.settings.prizes[prizeKey];
    if (!PRIZE_BY_KEY[prizeKey] || !cfg || !cfg.enabled) throw new GameError('That prize is not in play.');
    if (!p.ticketIds.length) throw new GameError("You don't have any tickets.");
    if (!s.draws.length) throw new GameError('No numbers have been drawn yet.');
    if ((s.bogeys[playerId] || []).includes(prizeKey)) throw new GameError(`You had a Bogey on ${cfg.name}, so you can't claim it again.`);
    if (s.winners.some((w) => w.prize === prizeKey && w.playerId === playerId)) throw new GameError(`You have already won ${cfg.name}.`);
    if (s.settings.rules.onePrizePerPerson && s.winners.some((w) => w.playerId === playerId)) {
      throw new GameError('One prize per person: you have already won a prize. Congratulations!');
    }
    if (prizeKey === 'fullHouse2' && !s.winners.some((w) => w.prize === 'fullHouse1')) {
      throw new GameError("The first Full House hasn't been won yet. Claim Full House instead.");
    }
    const existing = s.claims.find((c) => c.playerId === playerId && c.prize === prizeKey && c.status === 'pending');
    if (existing) return existing;

    const idx = drawIndexOf(s.draws);
    const prizeWinners = s.winners.filter((w) => w.prize === prizeKey);
    const excluded = new Set(prizeKey === 'fullHouse2' ? s.winners.filter((w) => w.prize === 'fullHouse1').map((w) => w.ticketId) : []);
    let best = null;
    let closest = null;
    for (const tid of p.ticketIds) {
      if (excluded.has(tid)) continue;
      const rows = s.tickets[tid].rows;
      const at = completedAt(rows, prizeKey, idx);
      if (at !== null && (best === null || at < best.at)) best = { tid, at };
      const miss = missingNumbers(rows, prizeKey, idx);
      const cnt = Array.isArray(miss) ? miss.length : miss;
      if (!closest || cnt < closest.cnt) closest = { tid, miss, cnt };
    }

    const claim = {
      id: randomToken().slice(0, 12),
      playerId,
      playerName: p.name,
      team: p.team,
      prize: prizeKey,
      at: this.now(),
      drawCount: s.draws.length,
      status: 'pending'
    };
    if (best) {
      if (prizeWinners.length && prizeWinners[0].completedAt !== best.at) throw new GameError(`${cfg.name} has already been won.`);
      Object.assign(claim, { valid: true, ticketId: best.tid, completedAt: best.at, reason: '' });
    } else {
      if (prizeWinners.length) throw new GameError(`${cfg.name} has already been won.`);
      let reason = 'No eligible ticket';
      if (closest) {
        reason = Array.isArray(closest.miss)
          ? `Missing ${closest.miss.join(', ')} on ${closest.tid}`
          : `Only ${5 - closest.miss} of 5 numbers drawn on ${closest.tid}`;
      }
      Object.assign(claim, { valid: false, ticketId: closest ? closest.tid : null, completedAt: null, reason });
    }
    s.claims.push(claim);
    this.save();
    return claim;
  }

  _claim(id) {
    const c = this.s.claims.find((x) => x.id === id);
    if (!c) throw new GameError('Claim not found.');
    if (c.status !== 'pending') throw new GameError('That claim has already been handled.');
    return c;
  }

  // Confirms a valid claim, plus any other valid claim that completed the same prize on the same number (a tie).
  confirmClaim(id) {
    const s = this.s;
    const c = this._claim(id);
    if (!c.valid) throw new GameError('This claim is not valid. Reject it or mark it as a Bogey.');
    const prizeWinners = s.winners.filter((w) => w.prize === c.prize);
    if (prizeWinners.length && prizeWinners[0].completedAt !== c.completedAt) {
      c.status = 'rejected';
      c.reason = 'Prize already won';
      this.save();
      throw new GameError('That prize has already been won.');
    }
    const at = completedAt(s.tickets[c.ticketId].rows, c.prize, drawIndexOf(s.draws));
    if (at === null || at !== c.completedAt) {
      c.valid = false;
      c.reason = 'No longer valid (a number was undone)';
      this.save();
      throw new GameError('This claim is no longer valid.');
    }
    // Whoever completed the prize on the EARLIEST number wins, whatever order the claims arrived in.
    const earliest = s.claims
      .filter((x) => x.status === 'pending' && x.valid && x.prize === c.prize)
      .reduce((m, x) => Math.min(m, x.completedAt), Infinity);
    if (earliest < c.completedAt) {
      const first = s.claims.find((x) => x.status === 'pending' && x.valid && x.prize === c.prize && x.completedAt === earliest);
      throw new GameError(`${first.playerName} completed this prize earlier (on number ${s.draws[earliest]}). Confirm their claim first.`);
    }
    const prizeName = s.settings.prizes[c.prize].name;
    const group = s.claims.filter((x) => x.status === 'pending' && x.valid && x.prize === c.prize && x.completedAt === c.completedAt);
    const added = group.map((x) => {
      x.status = 'confirmed';
      return {
        prize: x.prize,
        prizeName,
        value: s.settings.prizes[c.prize].value,
        playerId: x.playerId,
        name: x.playerName,
        team: x.team,
        ticketId: x.ticketId,
        completedAt: x.completedAt,
        number: s.draws[x.completedAt],
        at: this.now()
      };
    });
    s.winners.push(...added);
    s.claims
      .filter((x) => x.status === 'pending' && x.prize === c.prize && x.valid && x.completedAt !== c.completedAt)
      .forEach((x) => { x.status = 'rejected'; x.reason = 'Someone completed it on an earlier number'; });
    const all = s.winners.filter((w) => w.prize === c.prize);
    all.forEach((w) => { w.shared = all.length > 1 ? s.settings.rules.tieMode : null; });
    if (this.allPrizesWon()) s.status = 'ended';
    this.save();
    return all;
  }

  rejectClaim(id) {
    const c = this._claim(id);
    c.status = 'rejected';
    this.save();
    return c;
  }

  bogeyClaim(id) {
    const c = this._claim(id);
    c.status = 'bogey';
    const list = this.s.bogeys[c.playerId] || (this.s.bogeys[c.playerId] = []);
    if (!list.includes(c.prize)) list.push(c.prize);
    this.save();
    return c;
  }

  allPrizesWon() {
    const enabled = Object.entries(this.s.settings.prizes).filter(([, v]) => v.enabled).map(([k]) => k);
    return enabled.length > 0 && enabled.every((k) => this.s.winners.some((w) => w.prize === k));
  }

  endGame() { this.s.status = 'ended'; this.save(); }

  resumeGame() {
    if (this.s.status !== 'ended') return;
    if (this.s.draws.length >= 90) throw new GameError('All 90 numbers have been drawn. Start a new round instead.');
    this.s.status = this.s.draws.length ? 'running' : 'setup';
    this.save();
  }

  // ---------- marks ----------
  setMark(playerId, ticketId, number, on) {
    const p = this.player(playerId);
    if (!p.ticketIds.includes(ticketId)) throw new GameError('Not your ticket.');
    const n = Number(number);
    if (!this.s.tickets[ticketId].rows.flat().includes(n) || n === 0) throw new GameError('Number is not on this ticket.');
    const pm = this.s.marks[playerId] || (this.s.marks[playerId] = {});
    const set = new Set(pm[ticketId] || []);
    if (on) set.add(n); else set.delete(n);
    pm[ticketId] = [...set];
    this.save();
  }

  // ---------- rounds ----------
  newRound() {
    const s = this.s;
    Object.assign(s, { status: 'setup', draws: [], drawTimes: [], lastDrawAt: 0, claims: [], winners: [], bogeys: {}, marks: {}, salesOverride: false });
    this.save();
  }

  resetAll() {
    this.state = freshState();
    this._ticketKeys = null;
    this.save();
  }

  // ---------- views ----------
  prizeList() {
    const s = this.s;
    return PRIZES.filter((p) => s.settings.prizes[p.key] && s.settings.prizes[p.key].enabled).map((p) => {
      const cfg = s.settings.prizes[p.key];
      const winners = s.winners.filter((w) => w.prize === p.key).map((w) => ({ name: w.name, team: w.team, ticketId: w.ticketId, shared: w.shared }));
      return { key: p.key, name: cfg.name, value: cfg.value, help: p.help, winners, status: winners.length ? 'won' : 'open' };
    });
  }

  publicView() {
    const s = this.s;
    const current = s.draws[s.draws.length - 1] || null;
    return {
      gameCode: s.gameCode,
      title: s.settings.title,
      status: s.status,
      draws: s.draws,
      current,
      call: current ? callFor(current) : '',
      salesLocked: this.salesLocked(),
      prizes: this.prizeList(),
      ticketsInPlay: Object.keys(s.tickets).length,
      voice: s.settings.voice,
      voiceRate: s.settings.voiceRate,
      voiceMode: s.settings.voiceMode,
      autoInterval: s.settings.autoInterval,
      latestWinners: s.winners.slice(-3),
      // Who is claiming right now (no validity shown, to keep the suspense on the projector)
      pendingClaims: s.claims.filter((c) => c.status === 'pending')
        .map((c) => ({ id: c.id, name: c.playerName, team: c.team, prizeName: (s.settings.prizes[c.prize] || {}).name || c.prize }))
    };
  }

  playerView(playerId) {
    const s = this.s;
    const p = this.player(playerId);
    return {
      player: { id: p.id, name: p.name, team: p.team },
      tickets: p.ticketIds.map((t) => ({ id: t, rows: s.tickets[t].rows })),
      marks: s.marks[playerId] || {},
      bogeys: s.bogeys[playerId] || [],
      claims: s.claims.filter((c) => c.playerId === playerId).slice(-20)
        .map((c) => ({ id: c.id, prize: c.prize, status: c.status, valid: c.valid, ticketId: c.ticketId, reason: c.valid ? '' : c.reason })),
      wins: s.winners.filter((w) => w.playerId === playerId)
    };
  }

  hostView() {
    const s = this.s;
    const players = Object.values(s.players)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((p) => ({ id: p.id, name: p.name, key: p.key, team: p.team, bought: p.bought, paid: p.paid, pin: p.pin, token: p.token, ticketIds: p.ticketIds }));
    const claims = s.claims.filter((c) => c.status === 'pending').concat(s.claims.filter((c) => c.status !== 'pending').slice(-30).reverse());
    return {
      ...this.publicView(),
      settings: s.settings,
      salesOverride: s.salesOverride,
      totals: this.totals(),
      players,
      claims,
      winners: s.winners,
      bogeys: s.bogeys,
      lastDrawAt: s.lastDrawAt,
      prizeCatalog: PRIZES.map((p) => ({ key: p.key, name: p.name, help: p.help }))
    };
  }
}

module.exports = { Game, GameError, parsePaid, MIN_DRAW_GAP_MS };
