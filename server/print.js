'use strict';
// Printable pages: paper tickets and per-player slips (link + PIN + QR).
// Open in the browser and use Print -> Save as PDF.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BASE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Yatra+One&display=swap');
  *{box-sizing:border-box} body{margin:0;font-family:Poppins,system-ui,sans-serif;color:#1C1C1A;background:#fff}
  .bar{position:sticky;top:0;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 20px;background:#140F2E;color:#FFF7E6}
  .bar button{min-height:40px;padding:0 16px;border:0;border-radius:8px;background:#F5B83D;color:#2A1600;font:600 14px Poppins,sans-serif;cursor:pointer}
  .sheet{padding:12mm;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8mm}
  @media print{.bar{display:none}.sheet{padding:0}@page{size:A4;margin:10mm}}
`;

function ticketCard(t, p, title) {
  const cells = t.rows.flat().map((n) => (n
    ? `<div class="c">${n}</div>`
    : '<div class="c e"></div>')).join('');
  return `<article class="tk">
    <header><img src="/assets/logo.svg" alt="ProductSquads"><div class="tt">${esc(title)}</div><div class="id">${esc(t.id)}</div></header>
    <div class="g">${cells}</div>
    <footer><span>${esc(p.name)}${p.team ? ' · ' + esc(p.team) : ''}</span><span>Mark the numbers as they are called</span></footer>
  </article>`;
}

function renderTickets(game, playerId) {
  const s = game.state;
  const players = playerId && playerId !== 'all' ? [game.player(playerId)] : Object.values(s.players);
  const cards = [];
  players.forEach((p) => p.ticketIds.forEach((tid) => cards.push(ticketCard(s.tickets[tid], p, s.settings.title))));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tickets – ${esc(s.settings.title)}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>${BASE_CSS}
  .tk{border:2px solid #B4410F;border-radius:10px;padding:8px;break-inside:avoid;background:#FFFBF2}
  .tk header{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .tk header img{height:18px}.tt{flex:1;font-family:'Yatra One',serif;color:#8A2F08;font-size:15px}.id{font:700 12px ui-monospace,Menlo,monospace}
  .g{display:grid;grid-template-columns:repeat(9,1fr);gap:2px}
  .c{height:30px;border:1px solid #D9A066;border-radius:4px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;background:#fff}
  .c.e{background:repeating-linear-gradient(45deg,#F6E3C8,#F6E3C8 4px,#FFF4E2 4px,#FFF4E2 8px);border-color:#EBCFA6}
  .tk footer{display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:#5F5F5A}
  </style></head><body>
  <div class="bar"><span>${cards.length} ticket(s) · use Print → Save as PDF</span><button onclick="window.print()">Print / Save PDF</button></div>
  <main class="sheet">${cards.join('') || '<p>No tickets yet.</p>'}</main></body></html>`;
}

function renderSlips(game, baseUrl, qrByPlayer) {
  const s = game.state;
  const players = Object.values(s.players).filter((p) => p.ticketIds.length);
  const slips = players.map((p) => `<article class="sl">
    <img class="qr" src="${qrByPlayer[p.id]}" alt="QR code for ${esc(p.name)}">
    <div class="tx">
      <img class="lg" src="/assets/logo.svg" alt="ProductSquads">
      <div class="nm">${esc(p.name)}</div>
      <div class="mt">${esc(p.team || '')} · ${p.ticketIds.length} ticket(s): ${esc(p.ticketIds.join(', '))}</div>
      <div class="ln">${esc(`${baseUrl}/play?t=${p.token}`)}</div>
      <div class="pn">Login: ${esc(p.key)} · PIN <b>${esc(p.pin)}</b></div>
    </div></article>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Player slips – ${esc(s.settings.title)}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>${BASE_CSS}
  .sl{display:flex;gap:10px;align-items:center;border:1.5px dashed #B4410F;border-radius:10px;padding:10px;break-inside:avoid}
  .qr{width:110px;height:110px}.tx{min-width:0}.lg{height:16px}.nm{font-family:'Yatra One',serif;font-size:18px;color:#8A2F08}
  .mt{font-size:11px;color:#5F5F5A}.ln{font:10px ui-monospace,Menlo,monospace;word-break:break-all;margin-top:4px}.pn{font-size:12px;margin-top:4px}
  </style></head><body>
  <div class="bar"><span>${players.length} slip(s) · cut along the dashed lines</span><button onclick="window.print()">Print / Save PDF</button></div>
  <main class="sheet">${slips || '<p>No players with tickets yet.</p>'}</main></body></html>`;
}

module.exports = { renderTickets, renderSlips, esc };
