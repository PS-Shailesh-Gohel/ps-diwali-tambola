/* Host / admin console: players & tickets, game control, claims, winners, settings. */
(function () {
  'use strict';
  const T = window.Tambola;
  const { $, $$, esc } = T;

  let token = sessionStorage.getItem('tambola_host');
  let st = null;
  let socket = null;
  let tab = (location.hash || '#players').slice(1);
  let animating = false;
  let search = '';
  let lastWalkInId = null;

  const prizeName = (key) => (st && st.settings.prizes[key] ? st.settings.prizes[key].name : key);

  // ---------- auth ----------
  function showLogin() {
    $('#app').hidden = true;
    $('#loginView').hidden = false;
  }
  function logout(message) {
    sessionStorage.removeItem('tambola_host');
    token = null;
    if (socket) socket.disconnect();
    showLogin();
    if (message) T.toast(message, 'bad');
    return null;
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = new FormData(e.target).get('password');
    const res = await fetch('/api/host/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { T.toast(data.error || 'Login failed', 'bad'); return; }
    token = data.token;
    sessionStorage.setItem('tambola_host', token);
    connect();
  });

  async function api(url, body) {
    const res = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-host-token': token }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { logout('Your session expired. Please log in again.'); throw new Error('auth'); }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function cmd(event, payload, okMsg) {
    const r = await T.emit(socket, event, payload);
    if (r.auth === false) return logout('Your session expired. Please log in again.');
    if (!r.ok) { T.toast(r.error || 'Something went wrong', 'bad', 5000); return null; }
    if (okMsg) T.toast(okMsg, 'ok', 2500);
    return r.result === undefined ? true : r.result;
  }

  // ---------- modal ----------
  function modal(html, onClick) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener('click', (e) => {
      if (e.target === back || e.target.closest('[data-close]')) { close(); return; }
      if (onClick) onClick(e, close, back);
    });
    const first = back.querySelector('input, select, button');
    if (first) first.focus();
    return { back, close };
  }

  // ---------- tabs ----------
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; location.hash = tab; renderTab(); }));

  function renderTab() {
    if (!['setup', 'players', 'game', 'winners'].includes(tab)) tab = 'players';
    $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const main = $('#main');
    if (tab === 'setup') main.innerHTML = setupHtml();
    else if (tab === 'game') main.innerHTML = gameHtml();
    else if (tab === 'winners') main.innerHTML = '<div id="winnersBox" style="display:flex;flex-direction:column;gap:20px"></div>';
    else main.innerHTML = playersHtml();
    bindTab();
    renderLive();
  }

  // ---------- claim alerts (visible on every tab) ----------
  function renderClaimAlert() {
    const pending = st.claims.filter((c) => c.status === 'pending');
    const badge = $('#claimBadge');
    badge.hidden = !pending.length;
    badge.textContent = pending.length;
    document.title = pending.length ? `(${pending.length}) Claim${pending.length > 1 ? 's' : ''} waiting – Tambola Host` : 'Diwali Tambola – Host';
    $('#claimAlertWrap').hidden = !pending.length;
    if (!pending.length) return;
    const list = pending.map((c) => `${esc(c.playerName)} – ${esc(prizeName(c.prize))}`).join(' · ');
    $('#claimAlert').innerHTML = `<svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FFD27A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.7 21a2 2 0 0 1-3.4 0"></path></svg>
      <div class="t"><b>${pending.length} claim${pending.length > 1 ? 's' : ''} waiting</b><br>${list}</div>
      ${tab === 'game' ? '' : '<button class="btn btn-saffron" id="reviewClaims">Review claims</button>'}`;
    const rb = $('#reviewClaims');
    if (rb) rb.onclick = () => { tab = 'game'; location.hash = 'game'; renderTab(); };
  }

  function chime() {
    T.Sound.tone(880, 0.25, 'triangle', 0.15);
    T.Sound.tone(1175, 0.3, 'triangle', 0.15, 0.18);
    T.Sound.tone(1568, 0.45, 'triangle', 0.15, 0.36);
  }
  // Browsers only allow sound after a click, so enable it on the host's first click.
  document.addEventListener('click', () => { if (!T.Sound.enabled) T.Sound.unlock(); }, { once: true });

  function renderLive() {
    if (!st) return;
    renderClaimAlert();
    $('#statusText').textContent = `${st.online.players} players online · ${st.online.displays} projector${st.online.displays === 1 ? '' : 's'} · ${st.draws.length}/90 drawn`;
    if (tab === 'players') livePlayers();
    if (tab === 'game') liveGame();
    if (tab === 'winners') liveWinners();
  }

  // ================= PLAYERS & TICKETS =================
  function playersHtml() {
    const q = `token=${encodeURIComponent(token)}`;
    return `
    <div class="tiles" id="tiles"></div>
    <div id="lockLine"></div>
    <div id="devWarn"></div>
    <div class="row">
      <div class="grow">
        <section class="dropzone" aria-label="Import roster">
          <div><div style="font-weight:600">Import roster CSV</div>
          <div class="small muted">Name · Email/Employee ID · Team · Tickets Bought · Paid (Yes/No). Re-importing updates existing players.</div></div>
          <div class="actions">
            <a class="btn btn-ghost" href="/api/roster-template.csv">Download template</a>
            <label class="btn btn-gold" style="cursor:pointer">Upload CSV<input type="file" id="csvFile" accept=".csv,text/csv" hidden></label>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head">
            <label class="field" style="flex-direction:row;align-items:center;gap:8px">Search
              <input class="input" id="search" placeholder="Name, email or Employee ID" style="width:240px" value="${esc(search)}"></label>
            <div class="actions">
              <button class="btn btn-ghost" id="genBtn">Generate missing tickets</button>
              <a class="btn btn-ghost" href="/api/host/export/send-ready.csv?${q}">Export send-ready CSV</a>
              <a class="btn btn-ghost" target="_blank" rel="noopener" href="/print/tickets?player=all&${q}">Print all tickets</a>
              <a class="btn btn-ghost" target="_blank" rel="noopener" href="/print/slips?${q}">Print slips</a>
            </div>
          </div>
          <div class="scroll-x"><table style="min-width:820px">
            <thead><tr><th>Player</th><th>Team</th><th>Tickets</th><th>Paid</th><th>Ticket IDs</th><th>PIN</th><th>Actions</th></tr></thead>
            <tbody id="ptable"></tbody></table></div>
        </section>
      </div>
      <aside class="side panel panel-body" aria-label="Add player or walk-in">
        <div><h2 style="font-size:22px">Add player / walk-in</h2><div class="small muted">Same email/ID adds tickets to an existing player.</div></div>
        <form id="walkForm" style="display:flex;flex-direction:column;gap:12px">
          <label class="field">Name<input class="input" name="name" required></label>
          <label class="field">Email or Employee ID<input class="input" name="key" required></label>
          <label class="field">Team<input class="input" name="team"></label>
          <div class="field"><span>Tickets (max <span id="maxT"></span>)</span>
            <div class="stepper"><button type="button" class="btn btn-quiet" data-step="-1" aria-label="Fewer tickets">−</button><output id="walkCount">1</output><button type="button" class="btn btn-quiet" data-step="1" aria-label="More tickets">+</button><span class="muted" style="margin-left:auto" id="walkPrice"></span></div></div>
          <label class="check"><input type="checkbox" name="paid" checked> Paid</label>
          <button class="btn btn-saffron" type="submit">Save &amp; generate tickets</button>
        </form>
        <div id="walkResult"></div>
      </aside>
    </div>`;
  }

  function livePlayers() {
    const t = st.totals;
    $('#tiles').innerHTML = `
      <div class="panel tile"><div class="small muted">Players</div><div class="v">${t.players}</div></div>
      <div class="panel tile"><div class="small muted">Tickets generated</div><div class="v">${t.tickets}</div></div>
      <div class="panel tile"><div class="small muted">Amount collected</div><div class="v">${T.rupees(t.collected)}</div></div>
      <div class="panel tile ${t.unpaid ? 'warn' : ''}"><div class="small muted">Unpaid (no tickets yet)</div><div class="v">${t.unpaid}</div></div>`;
    $('#lockLine').innerHTML = st.draws.length
      ? `<div class="${st.salesLocked ? 'warnline' : 'okline'}" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <span>${st.salesLocked ? 'Sales are locked because the game has started.' : 'Lock overridden: you can add players and tickets during the game.'}</span>
          <button class="btn btn-sm btn-quiet" id="lockBtn">${st.salesLocked ? 'Override lock' : 'Lock sales again'}</button></div>`
      : '';
    const lb = $('#lockBtn');
    if (lb) lb.onclick = () => cmd('host:sales-override', { on: st.salesLocked });
    $('#devWarn').innerHTML = st.online.warnings.length
      ? `<div class="warnline">Open on more than 2 devices: ${st.online.warnings.map((w) => `${esc(w.name)} (${w.devices})`).join(', ')}</div>` : '';
    $('#maxT').textContent = st.settings.maxTickets;
    updateWalkPrice();
    const q = search.trim().toLowerCase();
    const rows = st.players.filter((p) => !q || `${p.name} ${p.key} ${p.team}`.toLowerCase().includes(q));
    $('#ptable').innerHTML = rows.length ? rows.map((p) => `<tr>
      <td><div style="font-weight:600">${esc(p.name)}</div><div class="small muted mono">${esc(p.key)}</div></td>
      <td>${esc(p.team)}</td>
      <td style="font-family:var(--display);font-size:20px;color:var(--gold)">${p.bought}</td>
      <td>${p.paid ? '<span class="badge badge-ok">Paid</span>' : '<span class="badge badge-bad">Unpaid</span>'}</td>
      <td class="mono small">${p.ticketIds.length ? esc(p.ticketIds.join(' · ')) : '<span class="muted">not generated</span>'}</td>
      <td class="mono">${p.ticketIds.length ? esc(p.pin) : '—'}</td>
      <td><div class="actions">
        <button class="btn btn-sm btn-quiet" data-act="edit" data-id="${p.id}">Edit / + Tickets</button>
        ${p.ticketIds.length ? `<button class="btn btn-sm btn-quiet" data-act="qr" data-id="${p.id}">Link &amp; QR</button>
        <a class="btn btn-sm btn-quiet" target="_blank" rel="noopener" href="/print/tickets?player=${p.id}&token=${encodeURIComponent(token)}">Print</a>` : ''}
        <button class="btn btn-sm btn-quiet" data-act="remove" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">Remove</button>
      </div></td></tr>`).join('') : `<tr><td colspan="7" class="muted" style="padding:20px">${st.players.length ? 'No players match your search.' : 'No players yet. Upload the roster CSV or add players on the right.'}</td></tr>`;
  }

  function updateWalkPrice() {
    const n = Number($('#walkCount') ? $('#walkCount').textContent : 1);
    if ($('#walkPrice')) $('#walkPrice').textContent = st.settings.price ? T.rupees(n * st.settings.price) : '';
  }

  function playerLink(p) { return `${location.origin}/play?t=${p.token}`; }

  function qrBox(p) {
    return `<div class="qr-box"><img src="/api/host/players/${p.id}/qr.png?token=${encodeURIComponent(token)}" alt="QR code for ${esc(p.name)}">
      <div class="small"><div style="font-weight:600">${esc(p.name)}</div><div class="muted">${p.ticketIds.length} ticket(s) · PIN <b class="mono" style="color:var(--gold)">${esc(p.pin)}</b></div>
      <div class="mono" style="font-size:11px;word-break:break-all;margin:6px 0">${esc(playerLink(p))}</div>
      <button class="btn btn-sm btn-ghost" data-copy="${esc(playerLink(p))}">Copy link</button></div></div>`;
  }

  function editPlayer(p) {
    const max = st.settings.maxTickets;
    modal(`<h2 style="font-size:24px;margin-bottom:12px">${p ? 'Edit player' : 'Add player'}</h2>
      <form id="editForm" style="display:flex;flex-direction:column;gap:12px">
        <label class="field">Name<input class="input" name="name" required value="${esc(p ? p.name : '')}"></label>
        <label class="field">Email or Employee ID<input class="input" name="key" required value="${esc(p ? p.key : '')}"></label>
        <label class="field">Team<input class="input" name="team" value="${esc(p ? p.team : '')}"></label>
        <label class="field">Tickets bought (max ${max})<input class="input" name="bought" type="number" min="1" max="${max}" required value="${p ? p.bought : 1}"></label>
        <label class="check"><input type="checkbox" name="paid" ${!p || p.paid ? 'checked' : ''}> Paid</label>
        <div class="actions" style="justify-content:flex-end"><button type="button" class="btn btn-quiet" data-close>Cancel</button><button class="btn btn-saffron" type="submit">Save</button></div>
      </form>`);
    $('#editForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const ok = await cmd('host:player:save', { id: p ? p.id : undefined, name: fd.get('name'), key: fd.get('key'), team: fd.get('team'), bought: Number(fd.get('bought')), paid: fd.get('paid') === 'on' }, 'Player saved');
      if (ok) e.target.closest('.modal-back').remove();
    });
  }

  async function handleCsv(file) {
    const csv = await file.text();
    let preview;
    try { preview = await api('/api/host/roster/preview', { csv }); } catch (e) { if (e.message !== 'auth') T.toast(e.message, 'bad'); return; }
    if (preview.headerErrors.length) { T.toast(preview.headerErrors.join(' '), 'bad', 7000); return; }
    const bad = preview.rows.filter((r) => r.errors.length);
    modal(`<h2 style="font-size:24px">Roster preview</h2>
      <p class="small muted">${preview.rows.length} rows · ${preview.newCount} new · ${preview.updateCount} updates · ${preview.errorCount} need fixing</p>
      ${bad.length ? `<div class="warnline" style="margin-bottom:10px">Fix these rows in your sheet and upload again:</div>
        <div class="scroll-x"><table><thead><tr><th>Row</th><th>Name</th><th>Problem</th></tr></thead><tbody>
        ${bad.map((r) => `<tr><td>${r.line}</td><td>${esc(r.name || '—')}</td><td style="color:var(--bad)">${esc(r.errors.join('; '))}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="okline">All rows look good. Paid players get their tickets right away.</div>
        <div class="scroll-x" style="max-height:40vh;margin-top:10px"><table><thead><tr><th>Name</th><th>ID</th><th>Team</th><th>Tickets</th><th>Paid</th><th></th></tr></thead><tbody>
        ${preview.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="mono small">${esc(r.key)}</td><td>${esc(r.team)}</td><td>${esc(r.bought)}</td><td>${r.paid ? 'Yes' : 'No'}</td><td class="small muted">${r.status}</td></tr>`).join('')}</tbody></table></div>`}
      <div class="actions" style="justify-content:flex-end;margin-top:14px"><button class="btn btn-quiet" data-close>Close</button>
      ${bad.length ? '' : `<button class="btn btn-saffron" data-import>Import ${preview.rows.length} rows</button>`}</div>`,
    async (e, close) => {
      if (!e.target.closest('[data-import]')) return;
      try { await api('/api/host/roster/import', { csv }); T.toast('Roster imported and tickets generated', 'ok'); close(); } catch (err) { if (err.message !== 'auth') T.toast(err.message, 'bad'); }
    });
  }

  // ================= GAME CONTROL =================
  function gameHtml() {
    return `<div id="gameOver"></div>
    <div class="row">
      <section class="side" style="flex:1 1 380px">
        <div class="panel draw-panel">
          <div class="small muted" id="gCount"></div>
          <div class="coin-stage" id="gStage"><div class="num-circle" id="gCircle">–</div></div>
          <div id="gCall" style="font-style:italic;color:var(--gold-text);min-height:22px"></div>
          <button class="btn btn-saffron btn-xl" id="drawBtn">Draw next number</button>
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;width:100%">
            <button class="btn btn-ghost" id="autoBtn">Auto-draw</button>
            <button class="btn btn-ghost" id="undoBtn">Undo last</button>
            <button class="btn btn-ghost" id="voiceBtn">Mute voice</button>
          </div>
          <label class="check small" style="align-self:center"><input type="checkbox" id="hostVoice"> Play the caller voice on this screen too</label>
          <div class="small muted" id="autoInfo"></div>
          <div class="actions" style="justify-content:center">
            <a class="btn btn-sm btn-quiet" href="/display" target="_blank" rel="noopener">Open projector screen</a>
            <button class="btn btn-sm btn-quiet" id="endBtn">End game</button>
          </div>
        </div>
        <div class="panel panel-body"><div class="small muted" style="margin-bottom:10px">Drawn so far <span class="small">(Spacebar draws too)</span></div><div class="chips" id="gChips"></div></div>
      </section>
      <section class="grow">
        <div class="panel"><div class="panel-head"><h2>Live claims</h2><span class="small muted">Checked against drawn numbers only</span></div><div id="gClaims"></div></div>
        <div class="panel"><div class="panel-head"><h2>Prizes</h2></div><div class="panel-body"><div class="prize-grid" id="gPrizes"></div><div class="small muted" id="gRules" style="margin-top:12px"></div></div></div>
      </section>
    </div>`;
  }

  function drawBlocked() {
    return animating || !st || st.draws.length >= 90 || st.status === 'ended' || (Date.now() - (st.lastDrawAt || 0) < 2900);
  }

  function liveGame() {
    const n = st.draws.length;
    $('#gCount').textContent = `Current number · ${n} of 90 drawn`;
    if (!animating) {
      $('#gCircle').textContent = st.current || '–';
      $('#gCall').textContent = st.call ? `“${st.call}”` : 'Press Draw to start the game';
    }
    $('#drawBtn').disabled = drawBlocked();
    $('#drawBtn').textContent = st.status === 'ended' ? 'Game over' : 'Draw next number';
    $('#endBtn').hidden = st.status === 'ended';
    const q = `token=${encodeURIComponent(token)}`;
    $('#gameOver').innerHTML = st.status === 'ended' ? `<section class="panel panel-body" style="border:2px solid var(--gold);display:flex;flex-direction:column;gap:12px">
        <h2 style="font-size:26px">Game over</h2>
        <div class="small muted">No more numbers can be drawn. ${st.winners.length} winner${st.winners.length === 1 ? '' : 's'} · ${st.draws.length} numbers drawn. What next?</div>
        <div class="actions">
          <a class="btn btn-ghost" href="/api/host/export/results.csv?${q}">Export results CSV</a>
          <button class="btn btn-saffron" id="goNewRound">Start a new round (same players &amp; tickets)</button>
          <button class="btn btn-quiet" id="goResume">Undo “End game”</button>
          <button class="btn btn-bad" id="goReset">Clear everything</button>
        </div>
        <div class="small muted">New round clears the numbers, claims and winners on every screen; everyone keeps their tickets and links. Clear everything also deletes all players and tickets.</div>
      </section>` : '';
    if (st.status === 'ended') {
      $('#goNewRound').onclick = async () => { if (confirm('Start a new round? Numbers, claims and winners are cleared on every screen. Players keep their tickets.')) await cmd('host:new-round', {}, 'New round ready — press Draw to start'); };
      $('#goResume').onclick = () => cmd('host:resume', {}, 'Game resumed');
      $('#goReset').onclick = async () => {
        const typed = prompt('This deletes ALL players, tickets and results. Type RESET to confirm.');
        if (typed === 'RESET') { const ok = await cmd('host:reset', {}, 'Everything was cleared'); if (ok) renderTab(); }
      };
    }
    $('#autoBtn').textContent = st.auto ? 'Stop auto' : 'Auto-draw';
    $('#voiceBtn').textContent = st.settings.voice ? 'Mute voice' : 'Voice on';
    $('#autoInfo').textContent = st.auto ? `Auto-drawing every ${st.settings.autoInterval} seconds` : `Auto-draw interval: ${st.settings.autoInterval} seconds · the coin animation plays on every screen`;
    $('#gChips').innerHTML = st.draws.map((d) => `<span class="num-chip">${d}</span>`).join('') || '<span class="small muted">None yet</span>';

    // Group claims by prize, earliest completion first, so ties and order are obvious.
    const pending = st.claims.filter((c) => c.status === 'pending')
      .sort((a, b) => a.prize.localeCompare(b.prize) || (b.valid - a.valid) || ((a.completedAt ?? 999) - (b.completedAt ?? 999)) || (a.at - b.at));
    const done = st.claims.filter((c) => c.status !== 'pending').slice(0, 12);
    const tieOf = (c) => c.valid && pending.filter((x) => x.valid && x.prize === c.prize && x.completedAt === c.completedAt).length > 1;
    const claimHtml = (c) => {
      const who = `<div class="who"><div style="font-weight:600">${esc(prizeName(c.prize))} · ${esc(c.playerName)}${c.team ? ` (${esc(c.team)})` : ''}</div>`;
      if (c.status !== 'pending') {
        const label = { confirmed: '<span class="badge badge-ok">Won</span>', rejected: '<span class="badge badge-quiet">Rejected</span>', bogey: '<span class="badge badge-bad">Bogey</span>' }[c.status];
        return `<div class="claim" style="opacity:.7">${label}${who}<div class="small muted mono">${esc(c.ticketId || '')} ${c.reason ? '· ' + esc(c.reason) : ''}</div></div></div>`;
      }
      const earlier = c.valid && pending.find((x) => x.valid && x.prize === c.prize && x.completedAt < c.completedAt);
      if (earlier) {
        return `<div class="claim"><span class="badge badge-quiet">Later</span>${who}
          <div class="small muted">Valid, but ${esc(earlier.playerName)} completed it earlier (on ${st.draws[earlier.completedAt]}). Confirm theirs first; this one closes automatically.</div></div>
          <button class="btn btn-quiet" data-reject="${c.id}">Reject</button></div>`;
      }
      if (c.valid) {
        const tie = tieOf(c);
        const prev = st.winners.some((w) => w.prize === c.prize);
        return `<div class="claim">${tie || prev ? '<span class="badge badge-gold">Tie</span>' : '<span class="badge badge-ok">✓ Valid</span>'}${who}
          <div class="small muted mono">${esc(c.ticketId)} · completed on ${st.draws[c.completedAt]} (number ${c.completedAt + 1})${tie || prev ? ` · rule: ${st.settings.rules.tieMode === 'split' ? 'split the prize' : 'award both'}` : ''}</div></div>
          <button class="btn btn-ok" data-confirm="${c.id}">${tie ? 'Confirm tie' : 'Confirm &amp; announce'}</button>
          <button class="btn btn-quiet" data-reject="${c.id}">Reject</button></div>`;
      }
      return `<div class="claim bad"><span class="badge badge-bad">✕ Not valid</span>${who}<div class="small muted mono">${esc(c.reason)}</div></div>
        <button class="btn btn-bad" data-bogey="${c.id}">Mark Bogey</button><button class="btn btn-quiet" data-reject="${c.id}">Dismiss</button></div>`;
    };
    $('#gClaims').innerHTML = (pending.length ? pending.map(claimHtml).join('') : '<div class="claim muted small">No claims waiting. They pop up here instantly.</div>')
      + (done.length ? `<div class="claim small muted" style="padding-bottom:4px">Recently handled</div>${done.map(claimHtml).join('')}` : '');

    $('#gPrizes').innerHTML = st.prizes.map((p) => `<div class="prize-card"><div style="font-weight:600">${esc(p.name)}</div>
      <div class="small muted">${p.value ? esc(p.value) + ' · ' : ''}${p.status === 'won' ? 'Won by ' + esc(p.winners.map((w) => w.name).join(' & ')) : (pending.some((c) => c.prize === p.key) ? 'Claim pending' : 'Open')}</div></div>`).join('');
    const r = st.settings.rules;
    $('#gRules').textContent = `Rules: different prizes per player allowed · same prize twice blocked · one prize per person ${r.onePrizePerPerson ? 'ON' : 'off'} · ties: ${r.tieMode === 'split' ? 'split the prize' : 'award both'}`;
  }

  async function hostDraw() {
    if (drawBlocked()) return;
    $('#drawBtn').disabled = true;
    await cmd('host:draw');
  }

  // ================= WINNERS =================
  function liveWinners() {
    const q = `token=${encodeURIComponent(token)}`;
    $('#winnersBox').innerHTML = `<section class="panel">
      <div class="panel-head"><h2>Winners</h2><div class="actions"><a class="btn btn-ghost" href="/api/host/export/results.csv?${q}">Export results CSV</a></div></div>
      <div class="scroll-x"><table><thead><tr><th>Prize</th><th>Winner</th><th>Team</th><th>Ticket</th><th>Winning number</th><th>Shared</th></tr></thead><tbody>
      ${st.winners.length ? st.winners.map((w) => `<tr><td style="font-weight:600">${esc(w.prizeName)}${w.value ? ` <span class="small muted">· ${esc(w.value)}</span>` : ''}</td><td>${esc(w.name)}</td><td>${esc(w.team)}</td><td class="mono">${esc(w.ticketId)}</td><td>${w.number}</td><td>${w.shared ? (w.shared === 'split' ? 'Split' : 'Both win') : ''}</td></tr>`).join('')
        : '<tr><td colspan="6" class="muted" style="padding:20px">No winners yet.</td></tr>'}
      </tbody></table></div></section>
      <section class="panel panel-body"><div class="small muted" style="margin-bottom:10px">Numbers drawn, in order (${st.draws.length})</div><div class="chips">${st.draws.map((d) => `<span class="num-chip">${d}</span>`).join('') || '<span class="small muted">None yet</span>'}</div></section>
      <section class="panel panel-body"><div class="small muted">Open prizes: ${esc(st.prizes.filter((p) => p.status === 'open').map((p) => p.name).join(', ') || 'none — all prizes won')}</div></section>`;
  }

  // ================= SETUP =================
  function setupHtml() {
    if (!st) return '';
    const s = st.settings;
    return `<form id="setupForm" style="display:flex;flex-direction:column;gap:20px">
      <section class="panel"><div class="panel-head"><h2>Game</h2><span class="small muted">Game code <b class="mono" style="color:var(--gold)">${esc(st.gameCode)}</b></span></div>
        <div class="panel-body grid-form">
          <label class="field">Title on screens<input class="input" name="title" value="${esc(s.title)}"></label>
          <label class="field">Max tickets per person<input class="input" type="number" min="1" max="20" name="maxTickets" value="${s.maxTickets}"></label>
          <label class="field">Price per ticket (₹)<input class="input" type="number" min="0" name="price" value="${s.price}"></label>
          <label class="field">Auto-draw every (seconds)<input class="input" type="number" min="4" max="60" name="autoInterval" value="${s.autoInterval}"></label>
          <label class="field">Voice speed<select class="input" name="voiceRate">${[0.8, 0.9, 1, 1.1, 1.2].map((r) => `<option value="${r}" ${Number(s.voiceRate) === r ? 'selected' : ''}>${r === 1 ? 'Normal' : (r < 1 ? 'Slower ' : 'Faster ') + r}</option>`).join('')}</select></label>
          <label class="field">Caller voice<select class="input" name="voiceMode">
            <option value="male" ${s.voiceMode === 'male' ? 'selected' : ''}>One voice: Indian English male (original)</option>
            <option value="alternate" ${s.voiceMode === 'alternate' ? 'selected' : ''}>Alternate male &amp; female (English voices)</option>
            <option value="female" ${s.voiceMode === 'female' ? 'selected' : ''}>Female only (English voice)</option></select></label>
          <label class="check" style="align-self:end;min-height:44px"><input type="checkbox" name="voice" ${s.voice ? 'checked' : ''}> Read numbers aloud on the projector</label>
        </div></section>
      <section class="panel"><div class="panel-head"><h2>Prizes</h2><span class="small muted">Toggle prizes, rename them and set values</span></div>
        <div class="scroll-x"><table style="min-width:700px"><thead><tr><th>In play</th><th>Name</th><th>Value</th><th>What wins it</th></tr></thead><tbody>
        ${st.prizeCatalog.map((p) => { const c = s.prizes[p.key]; return `<tr>
          <td><input type="checkbox" name="en_${p.key}" ${c.enabled ? 'checked' : ''} aria-label="${esc(p.name)} in play" style="width:20px;height:20px;accent-color:var(--gold)"></td>
          <td><input class="input" name="nm_${p.key}" value="${esc(c.name)}" aria-label="${esc(p.name)} name"></td>
          <td><input class="input" name="vl_${p.key}" value="${esc(c.value)}" placeholder="e.g. ₹500 voucher" aria-label="${esc(p.name)} value"></td>
          <td class="small muted">${esc(p.help)}</td></tr>`; }).join('')}
        </tbody></table></div></section>
      <section class="panel"><div class="panel-head"><h2>Prize rules</h2></div>
        <div class="panel-body grid-form">
          <div class="small muted">A player can win different prizes on different tickets, but never the same prize twice.</div>
          <label class="check"><input type="checkbox" name="onePrize" ${s.rules.onePrizePerPerson ? 'checked' : ''}> Limit each player to one prize in total</label>
          <label class="field">When two players complete a prize on the same number<select class="input" name="tieMode">
            <option value="split" ${s.rules.tieMode === 'split' ? 'selected' : ''}>Split the prize</option>
            <option value="both" ${s.rules.tieMode === 'both' ? 'selected' : ''}>Both win the full prize</option></select></label>
        </div></section>
      <div class="actions"><button class="btn btn-saffron" type="submit">Save settings</button></div>
    </form>
    <section class="panel"><div class="panel-head"><h2>Links</h2></div><div class="panel-body small" style="display:flex;flex-direction:column;gap:8px">
      <div>Projector / Teams screen: <a href="/display" target="_blank" rel="noopener">${esc(location.origin)}/display</a></div>
      <div>Player page (personal links open it automatically): <a href="/play" target="_blank" rel="noopener">${esc(location.origin)}/play</a></div>
    </div></section>
    <section class="panel"><div class="panel-head"><h2 style="color:var(--bad-strong)">Rounds &amp; reset</h2></div><div class="panel-body actions">
      <button class="btn btn-quiet" id="newRoundBtn">Start a new round (keep players &amp; tickets)</button>
      <button class="btn btn-bad" id="resetBtn">Reset everything</button>
    </div></section>`;
  }

  async function saveSetup(form) {
    const fd = new FormData(form);
    const prizes = {};
    st.prizeCatalog.forEach((p) => { prizes[p.key] = { enabled: fd.get(`en_${p.key}`) === 'on', name: fd.get(`nm_${p.key}`), value: fd.get(`vl_${p.key}`) }; });
    await cmd('host:settings', {
      title: fd.get('title'), maxTickets: fd.get('maxTickets'), price: fd.get('price'), autoInterval: fd.get('autoInterval'),
      voice: fd.get('voice') === 'on', voiceRate: fd.get('voiceRate'), voiceMode: fd.get('voiceMode'),
      rules: { onePrizePerPerson: fd.get('onePrize') === 'on', tieMode: fd.get('tieMode') },
      prizes
    }, 'Settings saved');
  }

  // ---------- event binding ----------
  function bindTab() {
    const main = $('#main');
    if (tab === 'players') {
      $('#csvFile').addEventListener('change', (e) => { if (e.target.files[0]) handleCsv(e.target.files[0]); e.target.value = ''; });
      $('#search').addEventListener('input', (e) => { search = e.target.value; livePlayers(); });
      $('#genBtn').addEventListener('click', async () => { const r = await cmd('host:generate'); if (r) T.toast(`${r.made} ticket(s) generated`, 'ok'); });
      $('#walkForm').addEventListener('click', (e) => {
        const b = e.target.closest('[data-step]');
        if (!b) return;
        const out = $('#walkCount');
        out.textContent = Math.max(1, Math.min(st.settings.maxTickets, Number(out.textContent) + Number(b.dataset.step)));
        updateWalkPrice();
      });
      $('#walkForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const r = await cmd('host:player:save', { name: fd.get('name'), key: fd.get('key'), team: fd.get('team'), bought: Number($('#walkCount').textContent), paid: fd.get('paid') === 'on' }, 'Player saved');
        if (!r) return;
        lastWalkInId = r.id;
        e.target.reset();
        $('#walkCount').textContent = '1';
        updateWalkPrice();
        const p = st.players.find((x) => x.id === lastWalkInId);
        $('#walkResult').innerHTML = p && p.ticketIds.length ? `<div class="small muted" style="margin-bottom:6px">Ask them to scan this:</div>${qrBox(p)}` : '<div class="warnline">Saved. Tickets are created once the player is marked as paid.</div>';
      });
    }
    if (tab === 'game') {
      $('#drawBtn').addEventListener('click', hostDraw);
      let hv = false;
      try { hv = localStorage.getItem('tambola_host_voice') === '1'; } catch (e) { /* ignore */ }
      $('#hostVoice').checked = hv;
      $('#hostVoice').addEventListener('change', (e) => {
        try { localStorage.setItem('tambola_host_voice', e.target.checked ? '1' : '0'); } catch (err) { /* ignore */ }
        if (e.target.checked) {
          T.Sound.unlock();
          T.toast('Caller voice on for this screen. Turn it off if the projector is on the same laptop, or you will hear it twice.', 'ok', 6000);
        }
      });
      $('#autoBtn').addEventListener('click', () => cmd('host:auto', { on: !st.auto }));
      $('#undoBtn').addEventListener('click', async () => { if (confirm('Take back the last number?')) await cmd('host:undo', {}, 'Last number taken back'); });
      $('#voiceBtn').addEventListener('click', () => cmd('host:settings', { voice: !st.settings.voice }));
      $('#endBtn').addEventListener('click', async () => { if (confirm('End the game now? No more numbers can be drawn.')) await cmd('host:end', {}, 'Game ended'); });
    }
    if (tab === 'setup') {
      $('#setupForm').addEventListener('submit', (e) => { e.preventDefault(); saveSetup(e.target); });
      $('#newRoundBtn').addEventListener('click', async () => { if (confirm('Start a new round? Numbers, claims and winners are cleared; players keep their tickets.')) await cmd('host:new-round', {}, 'New round ready'); });
      $('#resetBtn').addEventListener('click', async () => {
        const typed = prompt('This deletes ALL players, tickets and results. Type RESET to confirm.');
        if (typed === 'RESET') { const ok = await cmd('host:reset', {}, 'Everything was reset'); if (ok) renderTab(); }
      });
    }
    main.onclick = async (e) => {
      const copy = e.target.closest('[data-copy]');
      if (copy) { navigator.clipboard.writeText(copy.dataset.copy).then(() => T.toast('Link copied', 'ok', 1500)); return; }
      const act = e.target.closest('[data-act]');
      if (act) {
        const p = st.players.find((x) => x.id === act.dataset.id);
        if (!p) return;
        if (act.dataset.act === 'edit') editPlayer(p);
        if (act.dataset.act === 'qr') {
          modal(`<h2 style="font-size:24px;margin-bottom:12px">Personal link</h2>${qrBox(p)}<div class="actions" style="justify-content:flex-end;margin-top:14px"><button class="btn btn-quiet" data-close>Close</button></div>`, (ev) => {
            const c = ev.target.closest('[data-copy]');
            if (c) navigator.clipboard.writeText(c.dataset.copy).then(() => T.toast('Link copied', 'ok', 1500));
          });
        }
        if (act.dataset.act === 'remove' && confirm(`Remove ${p.name} and their tickets?`)) await cmd('host:player:remove', { id: p.id }, 'Player removed');
        return;
      }
      const c = e.target.closest('[data-confirm],[data-reject],[data-bogey]');
      if (c) {
        c.disabled = true;
        if (c.dataset.confirm) await cmd('host:claim:confirm', { id: c.dataset.confirm }, 'Winner announced!');
        if (c.dataset.reject) await cmd('host:claim:reject', { id: c.dataset.reject });
        if (c.dataset.bogey) await cmd('host:claim:bogey', { id: c.dataset.bogey }, 'Bogey!');
      }
    };
  }

  document.addEventListener('keydown', (e) => {
    if (tab !== 'game' || e.code !== 'Space' || e.repeat) return;
    if (e.target.closest('input, textarea, select, button, a')) return;
    e.preventDefault();
    hostDraw();
  });

  // ---------- socket ----------
  function connect() {
    if (!token) { showLogin(); return; }
    if (socket) socket.disconnect();
    socket = io();
    socket.on('connect', () => {
      $('#connDot').classList.remove('off');
      socket.emit('host:auth', { token }, (res) => {
        if (!res || !res.ok) { logout(res && res.error); return; }
        st = res.state;
        $('#loginView').hidden = true;
        $('#app').hidden = false;
        renderTab();
      });
    });
    socket.on('disconnect', () => { $('#connDot').classList.add('off'); $('#statusText').textContent = 'Reconnecting…'; });
    socket.on('host:state', (s) => { st = s; renderLive(); });
    socket.on('host:claim', (c) => {
      chime();
      T.toast(`New claim: ${prizeName(c.prize)} by ${c.playerName}${c.valid ? ' (valid)' : ' (not valid)'}`, c.valid ? 'ok' : 'bad', 6000);
      if (c.autoPaused) T.toast('Auto-draw paused while you check the claim.', '', 6000);
      setTimeout(() => T.restartAnimation($('#claimAlert'), 'flash'), 50);
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    });
    socket.on('drawn', async (d) => {
      if (tab !== 'game' || !$('#gStage')) return;
      animating = true;
      $('#drawBtn').disabled = true;
      $('#gCall').textContent = 'Drawing…';
      await T.coinDrop({ stage: $('#gStage'), number: d.number, size: 170, fromY: -420, peak: 1.5, hoverY: -20, dim: false });
      animating = false;
      if (!$('#gCircle')) return;
      $('#gCircle').textContent = d.number;
      T.restartAnimation($('#gCircle'), 'settle');
      if ($('#hostVoice') && $('#hostVoice').checked && st.settings.voice) {
        if (!T.Sound.enabled) T.Sound.unlock();
        T.Sound.playCall(d, { mode: st.settings.voiceMode, rate: st.settings.voiceRate || 1 });
      }
      renderLive();
      setTimeout(() => { if (tab === 'game' && $('#drawBtn')) $('#drawBtn').disabled = drawBlocked(); }, 400);
    });
  }

  if (token) connect(); else showLogin();
}());
