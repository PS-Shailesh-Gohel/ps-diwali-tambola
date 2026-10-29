/* Player phone app: personal tickets, marking, hints and claims. */
(function () {
  'use strict';
  const T = window.Tambola;
  const { $, $$, esc } = T;

  const params = new URLSearchParams(location.search);
  if (params.get('t')) {
    localStorage.setItem('tambola_token', params.get('t'));
    history.replaceState(null, '', '/play');
  }
  let token = localStorage.getItem('tambola_token');

  let pub = null;   // public game state
  let me = null;    // my tickets, marks, claims
  let view = localStorage.getItem('tambola_view') || 'all';
  let page = 0;
  let autoMark = null;
  let freshNumber = null;
  let claimStatus = {}; // claimId -> status, to detect changes
  let socket = null;

  // ---------- login ----------
  function showLogin(message) {
    $('#gameView').hidden = true;
    $('#me').hidden = true;
    $('#loginView').hidden = false;
    if (message) $('#loginMsg').textContent = message;
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await fetch('/api/player/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: fd.get('key'), pin: fd.get('pin') }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { T.toast(data.error || 'Could not log in.', 'bad'); return; }
    token = data.token;
    localStorage.setItem('tambola_token', token);
    connect();
  });

  // ---------- helpers ----------
  const drawnSet = () => new Set((pub && pub.draws) || []);
  const markSet = (tid) => new Set((me.marks && me.marks[tid]) || []);
  function openPrizes() {
    if (!pub) return [];
    const fh1Won = pub.prizes.some((p) => p.key === 'fullHouse1' && p.status === 'won');
    const mine = new Set((me.wins || []).map((w) => w.prize));
    const bogeys = new Set(me.bogeys || []);
    return pub.prizes.filter((p) => p.status === 'open' && !mine.has(p.key) && !bogeys.has(p.key) && (p.key !== 'fullHouse2' || fh1Won));
  }

  function setMark(tid, n, on) {
    const pm = me.marks[tid] || (me.marks[tid] = []);
    const i = pm.indexOf(n);
    if (on && i < 0) pm.push(n);
    if (!on && i >= 0) pm.splice(i, 1);
    socket.emit('player:mark', { ticketId: tid, number: n, on });
  }

  function autoMarkAll() {
    if (!autoMark || !me) return;
    const drawn = drawnSet();
    me.tickets.forEach((t) => {
      const marks = markSet(t.id);
      t.rows.flat().forEach((n) => { if (n && drawn.has(n) && !marks.has(n)) setMark(t.id, n, true); });
    });
  }

  // ---------- rendering ----------
  function renderHeader() {
    $('#me').hidden = false;
    $('#meName').textContent = me.player.name;
    $('#meMeta').textContent = `${me.tickets.length} ticket${me.tickets.length === 1 ? '' : 's'}${me.player.team ? ' · ' + me.player.team : ''}`;
  }

  function renderStrip() {
    const draws = pub.draws || [];
    const coin = $('#coin');
    if (pub.current) { coin.classList.remove('empty'); coin.textContent = pub.current; } else { coin.classList.add('empty'); coin.textContent = '–'; }
    $('#call').textContent = pub.current ? pub.call : 'Waiting for the first number…';
    $('#last').innerHTML = draws.slice(-6, -1).reverse().map((n) => `<span>${n}</span>`).join('');
  }

  function ticketHtml(t, idx) {
    const drawn = drawnSet();
    const marks = markSet(t.id);
    const cells = t.rows.flat().map((n) => {
      if (!n) return '<div class="cell blank"></div>';
      const cls = ['cell'];
      if (marks.has(n)) cls.push('marked');
      if (drawn.has(n)) cls.push('called');
      if (n === freshNumber && marks.has(n)) cls.push('pop');
      return `<button class="${cls.join(' ')}" data-t="${esc(t.id)}" data-n="${n}" aria-pressed="${marks.has(n)}" aria-label="${n}${marks.has(n) ? ', marked' : ''}">${n}</button>`;
    }).join('');
    const hint = T.ticketHint(t.rows, drawn, openPrizes());
    return `<article class="ticket">
      <div class="ticket-head"><span class="ti">Ticket ${idx + 1} of ${me.tickets.length}</span><span class="mono muted">${esc(t.id)}</span></div>
      <div class="ticket-grid">${cells}</div>
      <div class="ticket-hint ${hint.cls}">${esc(hint.text)}</div>
    </article>`;
  }

  function renderTickets() {
    const box = $('#tickets');
    $('#viewAll').setAttribute('aria-selected', String(view === 'all'));
    $('#viewOne').setAttribute('aria-selected', String(view === 'one'));
    if (view === 'all' || me.tickets.length === 1) {
      box.innerHTML = me.tickets.map(ticketHtml).join('');
    } else {
      page = Math.min(page, me.tickets.length - 1);
      box.innerHTML = `${ticketHtml(me.tickets[page], page)}
        <div class="pager"><button class="btn btn-quiet" id="prevT" ${page === 0 ? 'disabled' : ''}>Previous</button>
        <span class="small muted">Swipe or tap</span>
        <button class="btn btn-quiet" id="nextT" ${page === me.tickets.length - 1 ? 'disabled' : ''}>Next</button></div>`;
      const p = $('#prevT'); const n = $('#nextT');
      if (p) p.onclick = () => { page = Math.max(0, page - 1); renderTickets(); };
      if (n) n.onclick = () => { page = Math.min(me.tickets.length - 1, page + 1); renderTickets(); };
    }
  }

  function renderAll() {
    if (!pub || !me) return;
    $('#loginView').hidden = true;
    $('#gameView').hidden = false;
    renderHeader();
    renderStrip();
    renderTickets();
  }

  // swipe between tickets in one-at-a-time view
  let touchX = null;
  $('#tickets').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('#tickets').addEventListener('touchend', (e) => {
    if (view !== 'one' || touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) < 50) return;
    page = Math.max(0, Math.min(me.tickets.length - 1, page + (dx < 0 ? 1 : -1)));
    renderTickets();
  });

  $('#tickets').addEventListener('click', (e) => {
    const b = e.target.closest('button.cell');
    if (!b) return;
    const n = Number(b.dataset.n);
    const tid = b.dataset.t;
    const marked = markSet(tid).has(n);
    if (!marked && !drawnSet().has(n)) { T.toast(`${n} hasn't been called yet.`); return; }
    setMark(tid, n, !marked);
    renderTickets();
  });

  $('#viewAll').addEventListener('click', () => { view = 'all'; localStorage.setItem('tambola_view', view); renderTickets(); });
  $('#viewOne').addEventListener('click', () => { view = 'one'; localStorage.setItem('tambola_view', view); renderTickets(); });
  $('#autoMark').addEventListener('change', (e) => {
    autoMark = e.target.checked;
    localStorage.setItem(`tambola_auto_${me.player.id}`, autoMark ? '1' : '0');
    autoMarkAll();
    renderTickets();
  });
  $('#soundBtn').addEventListener('click', () => {
    if (T.Sound.enabled) T.Sound.enabled = false; else T.Sound.unlock();
    $('#soundBtn').setAttribute('aria-pressed', String(T.Sound.enabled));
    T.toast(T.Sound.enabled ? 'Sound and number calls on' : 'Sound off', '', 1800);
  });

  // ---------- claim sheet ----------
  $('#claimBtn').addEventListener('click', openSheet);
  function openSheet() {
    const drawn = drawnSet();
    const fh1Won = pub.prizes.some((p) => p.key === 'fullHouse1' && p.status === 'won');
    const mineWon = new Set((me.wins || []).map((w) => w.prize));
    const bogeys = new Set(me.bogeys || []);
    const rows = pub.prizes.map((p) => {
      if (p.status === 'won' && !mineWon.has(p.key)) return { p, kind: 'closed', note: `Won by ${p.winners.map((w) => w.name).join(' & ')}` };
      if (mineWon.has(p.key)) return { p, kind: 'closed', note: 'You won this!' };
      if (bogeys.has(p.key)) return { p, kind: 'closed', note: 'Blocked after a Bogey' };
      if (p.key === 'fullHouse2' && !fh1Won) return { p, kind: 'open', note: 'Opens after the first Full House', disabled: true };
      let best = null;
      me.tickets.forEach((t) => { const m = T.missing(t.rows, p.key, drawn); if (!best || m < best.m) best = { m, t }; });
      if (best && best.m === 0) return { p, kind: 'ready', note: `Ready on ${best.t.id}` };
      return { p, kind: 'open', note: best ? `${best.m} away on ${best.t.id}` : '' };
    });
    rows.sort((a, b) => ({ ready: 0, open: 1, closed: 2 }[a.kind] - { ready: 0, open: 1, closed: 2 }[b.kind]));
    const back = document.createElement('div');
    back.className = 'sheet-back';
    back.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-label="Claim a prize">
      <div class="grab" aria-hidden="true"></div>
      <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="font-size:26px">Claim a prize</h2>
      <button class="icon-btn" data-close aria-label="Close" style="border:0;color:var(--cream)"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"></path></svg></button></div>
      <p class="small muted" style="margin:0">The app checks all your tickets and picks the one that qualifies.</p>
      ${rows.map((r) => `<div class="prize-row ${r.kind}">
        <div style="flex:1"><div class="pn">${esc(r.p.name)}${r.p.value ? ` <span class="small muted">· ${esc(r.p.value)}</span>` : ''}</div><div class="pd">${esc(r.note)}</div></div>
        ${r.kind === 'closed' ? '<span class="small">Closed</span>' : `<button class="btn ${r.kind === 'ready' ? 'btn-ok' : 'btn-quiet'}" data-claim="${esc(r.p.key)}" ${r.disabled ? 'disabled' : ''}>Claim</button>`}
      </div>`).join('')}
      <div class="small" style="background:var(--bad-bg);color:var(--bad);border-radius:10px;padding:10px 12px">Careful: a wrong claim is a <b>Bogey</b> and blocks you from that prize.</div>
    </section>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener('click', async (e) => {
      if (e.target === back || e.target.closest('[data-close]')) { close(); return; }
      const btn = e.target.closest('[data-claim]');
      if (!btn) return;
      btn.disabled = true;
      const res = await T.emit(socket, 'player:claim', { prize: btn.dataset.claim });
      close();
      if (res.ok) T.toast(`Claim sent on ${res.claim.ticketId || 'your ticket'} — the host is confirming…`, 'ok', 5000);
      else T.toast(res.error || 'Could not send the claim.', 'bad', 5000);
    });
  }

  function checkClaimChanges() {
    (me.claims || []).forEach((c) => {
      const before = claimStatus[c.id];
      if (before && before !== c.status) {
        const name = (pub.prizes.find((p) => p.key === c.prize) || {}).name || 'the prize';
        if (c.status === 'confirmed') { T.toast(`You won ${name}! Congratulations!`, 'ok', 7000); T.fireworks(4500); }
        if (c.status === 'bogey') { T.toast(`Bogey! Your ${name} claim was not valid.`, 'bad', 7000); T.restartAnimation($('#tickets'), 'shake'); }
        if (c.status === 'rejected') T.toast(`Your ${name} claim was not accepted.`, 'bad', 6000);
      }
      claimStatus[c.id] = c.status;
    });
  }

  // ---------- socket ----------
  function connect() {
    if (!token) { showLogin(); return; }
    if (socket) socket.disconnect();
    socket = io();
    socket.on('connect', () => {
      socket.emit('player:join', { token }, (res) => {
        if (!res || !res.ok) {
          localStorage.removeItem('tambola_token');
          token = null;
          showLogin((res && res.error) || 'Please log in.');
          return;
        }
        pub = res.public;
        me = res.me;
        claimStatus = {};
        (me.claims || []).forEach((c) => { claimStatus[c.id] = c.status; });
        const saved = localStorage.getItem(`tambola_auto_${me.player.id}`);
        autoMark = saved === null ? me.tickets.length >= 3 : saved === '1';
        $('#autoMark').checked = autoMark;
        autoMarkAll();
        renderAll();
      });
    });
    socket.on('public:state', (s) => { pub = s; if (me) renderAll(); });
    socket.on('player:state', (m) => { me = m; checkClaimChanges(); renderAll(); });
    socket.on('drawn', (d) => {
      if (!pub || !me) return;
      if (!pub.draws.includes(d.number)) pub.draws = pub.draws.concat(d.number);
      pub.current = d.number;
      pub.call = d.call;
      freshNumber = d.number;
      autoMarkAll();
      renderAll();
      T.restartAnimation($('#coin'), 'coin-flip');
      setTimeout(() => T.Sound.clink(), 900);
      if (T.Sound.enabled) T.Sound.playCall(d, { mode: pub.voiceMode, rate: pub.voiceRate || 1 });
      if (navigator.vibrate && me.tickets.some((t) => t.rows.flat().includes(d.number))) navigator.vibrate(60);
      setTimeout(() => { freshNumber = null; }, 1500);
    });
    socket.on('winner', ({ winners }) => {
      if (!winners || !winners.length || !me) return;
      if (winners.some((w) => w.name === me.player.name && w.team === me.player.team)) return; // own win handled via player:state
      T.toast(`${winners[0].prizeName} won by ${winners.map((w) => w.name).join(' & ')}`, '', 5000);
    });
    socket.on('bogey', ({ name, prizeName }) => { if (me && name !== me.player.name) T.toast(`Bogey! ${name} claimed ${prizeName} too early.`, 'bad', 4000); });
    socket.on('reset', () => T.toast('A new round is starting!', 'ok'));
    socket.on('player:removed', () => { localStorage.removeItem('tambola_token'); token = null; showLogin('Your tickets were removed. Please check with the host.'); });
    socket.on('disconnect', () => T.toast('Reconnecting…', 'bad', 2000));
  }

  connect();
}());
