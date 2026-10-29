/* Shared helpers: escaping, toasts, coin animation, fireworks, sounds, voice, prize patterns. */
(function () {
  'use strict';
  const T = (window.Tambola = {});

  T.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  T.$ = (sel, root = document) => root.querySelector(sel);
  T.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  T.reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  T.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  T.rupees = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

  // socket.emit with acknowledgement as a promise (with timeout)
  T.emit = (socket, event, payload) => new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: 'No response from the server. Check your connection.' }); } }, 8000);
    socket.emit(event, payload || {}, (res) => { if (!done) { done = true; clearTimeout(timer); resolve(res || { ok: false }); } });
  });

  // ---------- toasts ----------
  let toastWrap = null;
  T.toast = (text, kind = '', ms = 4000) => {
    if (!toastWrap) {
      toastWrap = document.createElement('div');
      toastWrap.className = 'toast-wrap';
      toastWrap.setAttribute('role', 'status');
      toastWrap.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastWrap);
    }
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    toastWrap.appendChild(el);
    setTimeout(() => el.remove(), ms);
  };

  // ---------- decorations ----------
  T.sparkles = (container, count = 6) => {
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'spark';
      s.setAttribute('aria-hidden', 'true');
      s.style.top = `${8 + Math.random() * 84}%`;
      s.style.left = `${4 + Math.random() * 92}%`;
      s.style.animationDelay = `${(Math.random() * 3).toFixed(2)}s`;
      container.appendChild(s);
    }
  };

  T.rangoliSvg = (color, size, style) => {
    const petals = (rx, ry, d) => `<ellipse cx="100" cy="${100 - d}" rx="${rx}" ry="${ry}"></ellipse><ellipse cx="100" cy="${100 + d}" rx="${rx}" ry="${ry}"></ellipse><ellipse cx="${100 - d}" cy="100" rx="${ry}" ry="${rx}"></ellipse><ellipse cx="${100 + d}" cy="100" rx="${ry}" ry="${rx}"></ellipse>`;
    return `<svg class="rangoli" aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 200 200" style="${style}" fill="none" stroke="${color}" stroke-width="1.2">
      <circle cx="100" cy="100" r="18"></circle><circle cx="100" cy="100" r="40"></circle><circle cx="100" cy="100" r="88"></circle>
      <g>${petals(10, 26, 48)}</g><g transform="rotate(45 100 100)">${petals(10, 26, 48)}</g>
      <g transform="rotate(22.5 100 100)">${petals(4, 10, 74)}</g><g transform="rotate(67.5 100 100)">${petals(4, 10, 74)}</g></svg>`;
  };

  // ---------- sound ----------
  const Sound = (T.Sound = {
    enabled: false,
    ctx: null,
    unlock() {
      try {
        this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
        this.ctx.resume();
      } catch (e) { /* audio not available */ }
      if ('speechSynthesis' in window) window.speechSynthesis.resume();
      this.enabled = true;
    },
    tone(freq, dur, type = 'sine', gain = 0.12, when = 0) {
      if (!this.enabled || !this.ctx) return;
      const t = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    },
    noise(dur, gain = 0.2, filterFreq = 1200, when = 0) {
      if (!this.enabled || !this.ctx) return;
      const t = this.ctx.currentTime + when;
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterFreq;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      src.connect(f).connect(g).connect(this.ctx.destination);
      src.start(t);
    },
    clink() { this.tone(2093, 0.3, 'triangle', 0.1); this.tone(3136, 0.45, 'sine', 0.06, 0.04); this.tone(1568, 0.7, 'sine', 0.05, 0.08); },
    whoosh() { this.noise(0.6, 0.08, 900); },
    boom() { this.noise(0.9, 0.25, 500); this.noise(0.25, 0.08, 4000, 0.15); },
    // ---- Indian voices: one male, one female, alternating per draw ----
    // Browsers don't say a voice's gender, so we recognise the common Indian voices by name.
    // Best quality: Microsoft Edge (Prabhat & Neerja natural voices). Mac: Rishi & Veena/Lekha. Windows: Ravi/Hemant & Heera/Kalpana.
    FEMALE_RE: /veena|heera|neerja|ananya|aditi|raveena|kajal|isha|samantha|karen|moira|tessa|serena|fiona|victoria|zira|susan|hazel|female/i,
    MALE_RE: /rishi|ravi|hemant|prabhat|madhur|aarav|kunal|arjun|male|daniel|alex|fred|aaron|thomas/i,
    pickVoices() {
      if (!('speechSynthesis' in window)) return { male: null, female: null };
      // English voices only (no Hindi voices), Indian English first - same as the original single voice.
      const all = window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
      const quality = (v) => (/natural|online|neural|premium|enhanced/i.test(v.name) ? 0 : 1);
      const region = (v) => (/-IN$|_IN$/i.test(v.lang) ? 0 : /GB/i.test(v.lang) ? 1 : 2);
      const ranked = all.slice().sort((a, b) => region(a) - region(b) || quality(a) - quality(b));
      const gender = (v) => (this.FEMALE_RE.test(v.name) ? 'female' : this.MALE_RE.test(v.name) ? 'male' : 'unknown');
      const male = ranked.find((v) => gender(v) === 'male') || ranked[0] || null;
      const female = ranked.find((v) => gender(v) === 'female') || null;
      return { male, female };
    },
    voiceFor(gender) {
      const v = this.pickVoices();
      const wanted = gender === 'female' ? v.female : v.male;
      if (wanted) return { voice: wanted, pitch: 1 };
      // Only one voice available: change the pitch so male and female still sound different.
      const any = v.male || v.female || null;
      return { voice: any, pitch: gender === 'female' ? 1.25 : 0.8 };
    },
    genderForDraw(index, mode) {
      if (mode === 'male' || mode === 'female') return mode;
      return index % 2 === 1 ? 'male' : 'female';
    },
    say(text, { gender = 'male', rate = 1, hiText = null, queue = false } = {}) {
      if (!this.enabled || !('speechSynthesis' in window)) return;
      const synth = window.speechSynthesis;
      const { voice, pitch } = this.voiceFor(gender);
      const useHindi = !!(voice && /^hi/i.test(voice.lang) && hiText);
      const make = (withVoice) => {
        const u = new SpeechSynthesisUtterance(useHindi && withVoice ? hiText : text);
        if (withVoice && voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-IN';
        u.pitch = withVoice ? pitch : 1;
        u.rate = rate;
        u.volume = 1;
        return u;
      };
      const go = (u, isRetry) => {
        // Keep a reference: Chrome can garbage-collect a queued utterance and then never play it.
        this._utterances = (this._utterances || []).concat(u).slice(-6);
        let started = false;
        u.onstart = () => { started = true; };
        u.onerror = (e) => {
          console.warn('Speech error:', e.error, u.voice ? u.voice.name : '(default voice)');
          if (e.error === 'not-allowed') { T.toast('Click once on the page to allow sound.', 'bad'); return; }
          if (!isRetry && e.error !== 'interrupted' && e.error !== 'canceled') go(make(false), true);
        };
        synth.resume(); // Chrome sometimes leaves speech paused
        synth.speak(u);
        if (!isRetry) {
          setTimeout(() => {
            if (!started && !synth.speaking) { console.warn('Voice did not start, retrying with the default voice'); synth.cancel(); setTimeout(() => go(make(false), true), 200); }
          }, queue ? 8000 : 2500);
        }
      };
      // Chrome drops speech that is queued straight after cancel(), so wait a moment if something is playing.
      if (!queue && (synth.speaking || synth.pending)) { synth.cancel(); setTimeout(() => go(make(true), false), 200); }
      else go(make(true), false);
    },
    // Calls a drawn number simply: "62. Sixty-two, a laddoo for you"
    speakCall(d, { mode = 'alternate', rate = 1, queue = false } = {}) {
      if (!this.enabled || !('speechSynthesis' in window)) return;
      const text = `${d.number}. ${d.call}`;
      this.say(text, { gender: this.genderForDraw(d.index || 1, mode), rate, queue });
    },
    // ---- Recorded calls (made by "npm run voices", or your own recordings) ----
    _audio: null,
    _manifest: undefined,
    async manifest() {
      if (this._manifest !== undefined) return this._manifest;
      try {
        const r = await fetch('/audio/calls/voices.json', { cache: 'no-store' });
        this._manifest = r.ok ? await r.json() : null;
      } catch (e) { this._manifest = null; }
      return this._manifest;
    },
    playFile(url) {
      return new Promise((resolve) => {
        const a = new Audio(url);
        this._audio = a;
        a.onended = () => resolve(true);
        a.onerror = () => resolve(false);
        a.play().catch(() => resolve(false));
      });
    },
    // Plays the recorded call for this draw; falls back to the browser voice if there is no file.
    async playCall(d, { mode = 'alternate', rate = 1 } = {}) {
      if (!this.enabled) return false;
      const gender = this.genderForDraw(d.index || 1, mode);
      const m = await this.manifest();
      const folder = gender === 'female' ? 'f' : 'm';
      const has = m && (gender === 'female' ? m.female : m.male);
      if (has) {
        if (this._audio) { try { this._audio.pause(); } catch (e) { /* ignore */ } }
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        const ok = await this.playFile(`/audio/calls/${folder}/${d.number}.${m.ext || 'm4a'}`);
        if (ok) return true;
      }
      this.speakCall(d, { mode: gender, rate });
      return false;
    },
    speak(text, rate = 1, gender = 'male') {
      if (!this.enabled || !('speechSynthesis' in window)) return;
      this.say(text, { gender, rate });
    }
  });

  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener && window.speechSynthesis.addEventListener('voiceschanged', () => document.dispatchEvent(new Event('tambola:voices')));
  }

  // ---------- coin animation ----------
  // Drops a spinning gold coin into `stage` (an element the same size as the number circle).
  T.coinDrop = ({ stage, number, size = 240, fromY = -640, peak = 1.7, hoverY = -30, ms = 2600, dim = true }) => new Promise((resolve) => {
    if (T.reducedMotion() || !stage) { resolve(); return; }
    const coin = document.createElement('div');
    coin.className = 'coin coin-fly';
    coin.setAttribute('aria-hidden', 'true');
    coin.style.setProperty('--coin-size', `${size}px`);
    coin.style.setProperty('--from-y', `${fromY}px`);
    coin.style.setProperty('--peak', String(peak));
    coin.style.setProperty('--hover-y', `${hoverY}px`);
    coin.style.setProperty('--coin-ms', `${ms}ms`);
    coin.innerHTML = `<span class="coin-word">✦ SHUBH ✦</span><span class="coin-num">${Number(number)}</span><span class="coin-word">DEEPAVALI</span>`;
    const burst = document.createElement('div');
    burst.className = 'burst';
    burst.style.setProperty('--hover-y', `${hoverY}px`);
    let overlay = null;
    if (dim) {
      overlay = document.createElement('div');
      overlay.className = 'dim-overlay';
      overlay.style.setProperty('--coin-ms', `${ms}ms`);
      document.body.appendChild(overlay);
    }
    stage.append(burst, coin);
    Sound.whoosh();
    setTimeout(() => Sound.clink(), ms * 0.38);
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      coin.remove(); burst.remove(); if (overlay) overlay.remove();
      resolve();
    };
    coin.addEventListener('animationend', done, { once: true });
    setTimeout(done, ms + 400);
  });

  T.restartAnimation = (el, cls) => {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // reflow so the animation plays again
    el.classList.add(cls);
  };

  // ---------- fireworks + confetti ----------
  T.fireworks = (ms = 4000) => {
    if (T.reducedMotion()) return;
    const c = document.createElement('canvas');
    c.className = 'fx-canvas';
    c.setAttribute('aria-hidden', 'true');
    document.body.appendChild(c);
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth;
    const H = window.innerHeight;
    c.width = W * dpr; c.height = H * dpr;
    ctx.scale(dpr, dpr);
    const colors = ['#F5B83D', '#FFD27A', '#F07B1D', '#FF8A8A', '#7BE3A6', '#C77DFF', '#FFF7E6'];
    const parts = [];
    const confetti = [];
    const burst = (x, y) => {
      const base = colors[Math.floor(Math.random() * colors.length)];
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 1.5 + Math.random() * 5;
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: 55 + Math.random() * 35, color: Math.random() < 0.7 ? base : '#FFF7E6', r: 1.5 + Math.random() * 2 });
      }
      Sound.boom();
    };
    for (let i = 0; i < 120; i++) {
      confetti.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vy: 1.5 + Math.random() * 2.5, vx: -1 + Math.random() * 2, rot: Math.random() * 6, vr: -0.2 + Math.random() * 0.4, w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, color: colors[i % colors.length] });
    }
    const t0 = performance.now();
    let last = 0;
    const frame = (t) => {
      ctx.clearRect(0, 0, W, H);
      if (t - last > 380 && t - t0 < ms - 900) { burst(W * (0.15 + Math.random() * 0.7), H * (0.12 + Math.random() * 0.35)); last = t; }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.vy += 0.05; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.age++;
        if (p.age > p.life) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      const elapsed = t - t0;
      confetti.forEach((q) => {
        q.y += q.vy; q.x += q.vx; q.rot += q.vr;
        ctx.globalAlpha = elapsed > ms - 600 ? Math.max(0, (ms - elapsed) / 600) : 1;
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.fillStyle = q.color; ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h); ctx.restore();
      });
      ctx.globalAlpha = 1;
      if (elapsed < ms || parts.length) requestAnimationFrame(frame); else c.remove();
    };
    requestAnimationFrame(frame);
  };

  // ---------- prize patterns (mirror of server/prizes.js, used for hints only) ----------
  const rn = (row) => row.filter((n) => n > 0);
  const all = (t) => t.flat().filter((n) => n > 0);
  T.PATTERNS = {
    topLine: (t) => rn(t[0]),
    middleLine: (t) => rn(t[1]),
    bottomLine: (t) => rn(t[2]),
    fourCorners: (t) => { const a = rn(t[0]); const c = rn(t[2]); return [a[0], a[4], c[0], c[4]]; },
    rangoli: (t) => { const a = rn(t[0]); const b = rn(t[1]); const c = rn(t[2]); return [a[0], a[4], b[2], c[0], c[4]]; },
    diya: (t) => { const a = rn(t[0]); const b = rn(t[1]); const c = rn(t[2]); return [a[2], ...b, c[1], c[2], c[3]]; },
    fullHouse1: all,
    fullHouse2: all
  };
  T.missing = (rows, key, drawn) => {
    if (key === 'earlyFive') return Math.max(0, 5 - all(rows).filter((n) => drawn.has(n)).length);
    const f = T.PATTERNS[key];
    return f ? f(rows).filter((n) => !drawn.has(n)).length : 99;
  };
  // Best hint for one ticket given the prizes that are still open.
  T.ticketHint = (rows, drawn, openPrizes) => {
    let best = null;
    openPrizes.forEach((p) => {
      const m = T.missing(rows, p.key, drawn);
      if (!best || m < best.m) best = { m, p };
    });
    const called = all(rows).filter((n) => drawn.has(n)).length;
    if (best && best.m === 0) return { text: `${best.p.name} complete — claim it!`, cls: 'done' };
    if (best && best.m === 1) return { text: `1 away from ${best.p.name}!`, cls: 'near' };
    if (best && best.m === 2 && best.p.key !== 'fullHouse1' && best.p.key !== 'fullHouse2') return { text: `2 away from ${best.p.name}`, cls: '' };
    return { text: `${called} of 15 called`, cls: '' };
  };
}());
