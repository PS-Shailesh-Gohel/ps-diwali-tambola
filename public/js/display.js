/* Projector / Teams display: read-only, plays the coin animation for every draw. */
(function () {
  'use strict';
  const T = window.Tambola;
  const { $, esc } = T;
  const socket = io();

  let state = null;
  let animating = false;
  let shown = null;        // number currently shown in the circle
  let freshNumber = null;  // number to highlight on the board right after it lands
  let queue = Promise.resolve();

  const root = $('#root');
  T.sparkles(root, 8);
  root.insertAdjacentHTML('beforeend', T.rangoliSvg('#F5B83D', 460, 'right:-150px;bottom:-150px;opacity:.16'));
  root.insertAdjacentHTML('beforeend', T.rangoliSvg('#F07B1D', 320, 'left:-120px;top:90px;opacity:.12'));

  // ---------- start / sound / fullscreen ----------
  async function showVoices() {
    const m = await T.Sound.manifest();
    if (m && m.male) { $('#voiceInfo').textContent = `Recorded calls ready · Voice: ${m.male}${m.female ? ' · Female: ' + m.female : ''}`; return; }
    const v = T.Sound.pickVoices();
    $('#voiceInfo').textContent = `No recorded calls yet — run "npm run voices" for reliable sound. Browser voice: ${v.male ? v.male.name + ' (' + v.male.lang + ')' : 'not found'}`;
  }
  showVoices();
  document.addEventListener('tambola:voices', showVoices);
  async function testVoices() {
    T.Sound.unlock();
    updateSoundBtn();
    const mode = (state && state.voiceMode) || 'male';
    await T.Sound.playCall({ number: 62, index: 1, call: 'Sixty-two, a laddoo for you' }, { mode });
    await T.Sound.playCall({ number: 85, index: 2, call: 'Eighty-five, Diwali bonus has arrived' }, { mode });
  }
  $('#testVoices').addEventListener('click', testVoices);
  $('#testVoice2').addEventListener('click', testVoices);
  $('#startBtn').addEventListener('click', () => {
    T.Sound.unlock();
    $('#start').hidden = true;
    updateSoundBtn();
  });
  $('#soundBtn').addEventListener('click', () => {
    if (T.Sound.enabled) T.Sound.enabled = false; else T.Sound.unlock();
    updateSoundBtn();
  });
  $('#fsBtn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  });
  function updateSoundBtn() { $('#soundBtn').textContent = T.Sound.enabled ? 'Sound on' : 'Sound off'; }

  // ---------- rendering ----------
  function render() {
    if (!state) return;
    $('#title').textContent = state.title || 'Diwali Tambola';
    $('#online').textContent = state.online || 0;
    $('#tickets').textContent = state.ticketsInPlay || 0;
    const draws = state.draws || [];
    // While a coin is in the air, keep showing the previous number.
    const visibleDraws = animating ? draws.slice(0, draws.length - 1) : draws;
    const count = visibleDraws.length;
    $('#countTop').textContent = count;
    $('#label').textContent = count ? `Number ${count} of 90` : 'Waiting for the first number';
    if (!animating) {
      shown = state.current;
      $('#circle').textContent = shown || '–';
      $('#call').textContent = state.call || '';
    }
    $('#prev').innerHTML = visibleDraws.slice(-6, -1).reverse().map((n) => `<span>${n}</span>`).join('');
    const set = new Set(visibleDraws);
    let html = '';
    for (let n = 1; n <= 90; n++) {
      const cls = set.has(n) ? (n === freshNumber ? 'on fresh lit' : 'on') : '';
      html += `<div class="${cls}">${n}</div>`;
    }
    $('#board').innerHTML = html;
    $('#prizes').innerHTML = (state.prizes || []).map((p) => (p.status === 'won'
      ? `<span class="won">${esc(p.name)} · ${esc(p.winners.map((w) => w.name).join(' & '))}</span>`
      : `<span>${esc(p.name)}${p.value ? ' · ' + esc(p.value) : ''} · open</span>`)).join('');
    const wins = (state.prizes || []).filter((p) => p.status === 'won');
    $('#winners').innerHTML = wins.length
      ? wins.slice(-3).reverse().map((p) => `${esc(p.name)} — ${p.winners.map((w) => `${esc(w.name)}${w.team ? ' · ' + esc(w.team) : ''} <span class="mono small">${esc(w.ticketId)}</span>`).join(' & ')}`).join('<br>')
      : 'The first winner will appear here';
  }

  async function playDraw(d) {
    animating = true;
    $('#call').textContent = 'Drawing…';
    const stage = $('#stage');
    const size = stage.getBoundingClientRect().width || 240;
    await T.coinDrop({ stage, number: d.number, size, fromY: -(window.innerHeight * 0.8), peak: 1.7, hoverY: -size * 0.12 });
    animating = false;
    shown = d.number;
    freshNumber = d.number;
    $('#circle').textContent = d.number;
    $('#call').textContent = d.call;
    T.restartAnimation($('#circle'), 'settle');
    render();
    if (state && state.voice) T.Sound.playCall(d, { mode: state.voiceMode, rate: state.voiceRate || 1 });
    setTimeout(() => { if (freshNumber === d.number) { freshNumber = null; } }, 1500);
  }

  function announce(html, kind, ms) {
    const back = document.createElement('div');
    back.className = 'announce';
    back.innerHTML = `<div class="card ${kind}">${html}</div>`;
    document.body.appendChild(back);
    if (kind === 'bogey') T.restartAnimation(back.firstElementChild, 'shake');
    setTimeout(() => back.remove(), ms);
  }

  // ---------- socket ----------
  socket.on('connect', () => {
    socket.emit('display:join', {}, (res) => {
      if (res && res.ok) { state = res.state; render(); }
    });
  });
  socket.on('public:state', (s) => { state = s; render(); });
  socket.on('drawn', (d) => { queue = queue.then(() => playDraw(d)); });
  socket.on('undo', ({ number }) => { T.toast(`Number ${number} was taken back by the host.`); });
  socket.on('reset', () => { shown = null; freshNumber = null; T.toast('A new round is starting!'); });
  socket.on('winner', ({ winners }) => {
    queue = queue.then(async () => {
      if (!winners || !winners.length) return;
      const w0 = winners[0];
      const names = winners.map((w) => `${esc(w.name)}${w.team ? ' · ' + esc(w.team) : ''} <span class="mono" style="font-size:.6em">${esc(w.ticketId)}</span>`).join('<br>');
      const shared = winners.length > 1 ? `<div class="muted" style="margin-top:8px">${w0.shared === 'split' ? 'Tie — the prize is shared' : 'Tie — both win the full prize'}</div>` : '';
      announce(`<div class="k">Winner</div><div class="prize">${esc(w0.prizeName)}</div><div class="who">${names}</div>${w0.value ? `<div class="muted" style="margin-top:6px">${esc(w0.value)}</div>` : ''}${shared}`, '', 7000);
      T.fireworks(5000);
      if (state && state.voice) T.Sound.speak(`Badhaai ho! ${w0.prizeName} goes to ${winners.map((w) => w.name).join(' and ')}! Congratulations!`, state.voiceRate || 1, 'male');
      await T.sleep(1500);
    });
  });
  socket.on('bogey', ({ name, team, prizeName }) => {
    announce(`<div class="k">Bogey!</div><div class="prize">Oops!</div><div class="who">${esc(name)}${team ? ' · ' + esc(team) : ''} claimed ${esc(prizeName)} too early</div>`, 'bogey', 4500);
    T.Sound.tone(220, 0.4, 'sawtooth', 0.08); T.Sound.tone(160, 0.6, 'sawtooth', 0.08, 0.35);
  });
  socket.on('disconnect', () => T.toast('Reconnecting…', 'bad', 2500));
}());
