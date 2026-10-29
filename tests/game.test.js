'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../server/game');

// Fixed tickets so results are predictable.
const A = [[4, 0, 23, 0, 41, 0, 62, 0, 85], [0, 12, 0, 35, 47, 0, 0, 76, 88], [9, 18, 0, 39, 0, 54, 69, 0, 0]];
const B = [[2, 14, 0, 31, 0, 57, 0, 73, 0], [0, 0, 26, 0, 44, 0, 61, 78, 80], [7, 19, 0, 0, 49, 0, 66, 0, 90]];
const C = [[1, 0, 23, 0, 41, 0, 62, 0, 85], [5, 11, 0, 33, 0, 52, 0, 70, 0], [0, 16, 28, 0, 46, 0, 63, 77, 0]];
const allOf = (t) => t.flat().filter(Boolean);

function setup({ prizes = {}, rules = {} } = {}) {
  const g = new Game();
  const enable = { rangoli: { enabled: true }, diya: { enabled: true }, ...prizes };
  g.updateSettings({ prizes: enable, rules });
  const p1 = g.savePlayer({ name: 'Asha', key: 'asha@ps.co', team: 'QA', bought: 2, paid: true });
  const p2 = g.savePlayer({ name: 'Ravi', key: 'ravi@ps.co', team: 'Eng', bought: 1, paid: true });
  g.state.tickets[p1.ticketIds[0]].rows = A;
  g.state.tickets[p1.ticketIds[1]].rows = B;
  g.state.tickets[p2.ticketIds[0]].rows = C;
  return { g, p1, p2 };
}
const draw = (g, nums) => nums.forEach((n) => g.applyDraw(n));

// ---------- ticket counts ----------
test('paid players get exactly the tickets they bought; unpaid get none', () => {
  const g = new Game();
  const a = g.savePlayer({ name: 'A', key: 'a', bought: 3, paid: true });
  const b = g.savePlayer({ name: 'B', key: 'b', bought: 2, paid: false });
  assert.equal(a.ticketIds.length, 3);
  assert.equal(b.ticketIds.length, 0);
  g.savePlayer({ id: b.id, name: 'B', key: 'b', bought: 2, paid: true });
  assert.equal(b.ticketIds.length, 2);
});

test('top-ups add tickets under the same player, link and PIN', () => {
  const g = new Game();
  const a = g.savePlayer({ name: 'A', key: 'a@x.co', bought: 2, paid: true });
  const { token, pin } = a;
  const again = g.savePlayer({ name: 'A', key: 'A@X.co', bought: 5, paid: true }); // same key, different case
  assert.equal(again.id, a.id);
  assert.equal(again.ticketIds.length, 5);
  assert.equal(again.token, token);
  assert.equal(again.pin, pin);
});

test('tickets above the max are refused', () => {
  const g = new Game();
  assert.throws(() => g.savePlayer({ name: 'A', key: 'a', bought: 6, paid: true }), /max/);
});

test('sales lock after the first draw, unless the host overrides', () => {
  const g = new Game();
  g.savePlayer({ name: 'A', key: 'a', bought: 1, paid: true });
  g.applyDraw(10);
  assert.throws(() => g.savePlayer({ name: 'Late', key: 'late', bought: 1, paid: true }), /locked/);
  g.setSalesOverride(true);
  const late = g.savePlayer({ name: 'Late', key: 'late', bought: 2, paid: true });
  assert.equal(late.ticketIds.length, 2);
});

test('roster CSV preview flags duplicates, missing fields and counts above max', () => {
  const g = new Game();
  const csv = 'Name,Email/Employee ID,Team,Tickets Bought,Paid (Yes/No)\n'
    + 'Asha,EMP-1,QA,3,Yes\n'
    + 'Ravi,emp-1,Eng,1,Yes\n'
    + ',EMP-3,Eng,1,No\n'
    + 'Big,EMP-4,Eng,9,Yes\n'
    + 'Odd,EMP-5,Eng,two,Yes\n';
  const p = g.previewRoster(csv);
  assert.equal(p.rows.length, 5);
  assert.equal(p.errorCount, 4);
  assert.match(p.rows[1].errors.join(), /Duplicate/);
  assert.match(p.rows[2].errors.join(), /Name is missing/);
  assert.match(p.rows[3].errors.join(), /max/);
  assert.match(p.rows[4].errors.join(), /whole number/);
  assert.throws(() => g.importRoster(csv), /need fixing/);
});

test('roster CSV import creates players and tickets for paid rows only', () => {
  const g = new Game();
  g.importRoster('Name,Email,Team,Tickets,Paid\n"Shah, Asha",asha@ps.co,QA,3,Yes\nRavi,ravi@ps.co,Eng,2,No\n');
  const players = Object.values(g.state.players);
  assert.equal(players.length, 2);
  assert.equal(players.find((p) => p.key === 'asha@ps.co').name, 'Shah, Asha');
  assert.equal(Object.keys(g.state.tickets).length, 3);
});

// ---------- claim verification for every prize ----------
const cases = [
  { prize: 'earlyFive', win: [4, 12, 9, 23, 18], lose: [4, 12, 9, 23, 2] },
  { prize: 'topLine', win: [4, 23, 41, 62, 85], lose: [4, 23, 41, 62, 88] },
  { prize: 'middleLine', win: [12, 35, 47, 76, 88], lose: [12, 35, 47, 76, 85] },
  { prize: 'bottomLine', win: [9, 18, 39, 54, 69], lose: [9, 18, 39, 54, 70] },
  { prize: 'fourCorners', win: [4, 85, 9, 69], lose: [4, 85, 9, 54] },
  { prize: 'rangoli', win: [4, 85, 47, 9, 69], lose: [4, 85, 35, 9, 69] },
  { prize: 'diya', win: [41, 12, 35, 47, 76, 88, 18, 39, 54], lose: [41, 12, 35, 47, 76, 88, 18, 39, 9] },
  { prize: 'fullHouse1', win: allOf(A), lose: allOf(A).slice(0, 14) }
];

cases.forEach(({ prize, win, lose }) => {
  test(`${prize}: valid when the pattern is complete`, () => {
    const { g, p1 } = setup();
    draw(g, win);
    const c = g.claim(p1.id, prize);
    assert.equal(c.valid, true);
    assert.equal(c.ticketId, p1.ticketIds[0]);
    assert.equal(c.completedAt, win.length - 1);
  });
  test(`${prize}: not valid (bogey candidate) when a number is missing`, () => {
    const { g, p1 } = setup();
    draw(g, lose);
    const c = g.claim(p1.id, prize);
    assert.equal(c.valid, false);
    assert.ok(c.reason.length > 0);
  });
});

test('verification uses drawn numbers only, not the player\'s marks', () => {
  const { g, p1 } = setup();
  draw(g, [4, 23, 41, 62]);
  [4, 23, 41, 62, 85].forEach((n) => g.setMark(p1.id, p1.ticketIds[0], n, true));
  assert.equal(g.claim(p1.id, 'topLine').valid, false);
});

test('the app picks whichever of the player\'s tickets qualifies', () => {
  const { g, p1 } = setup();
  draw(g, [2, 14, 31, 57, 73]); // top line of ticket B (second ticket)
  const c = g.claim(p1.id, 'topLine');
  assert.equal(c.valid, true);
  assert.equal(c.ticketId, p1.ticketIds[1]);
});

// ---------- rules ----------
test('a Bogey blocks the player from that prize', () => {
  const { g, p1 } = setup();
  draw(g, [4, 23]);
  const c = g.claim(p1.id, 'topLine');
  g.bogeyClaim(c.id);
  draw(g, [41, 62, 85]);
  assert.throws(() => g.claim(p1.id, 'topLine'), /Bogey/);
  assert.equal(g.claim(p1.id, 'earlyFive').valid, true); // other prizes still open to them
});

test('a player may win different prizes but not the same prize twice', () => {
  const { g, p1 } = setup();
  draw(g, [4, 23, 41, 62, 85]);
  g.confirmClaim(g.claim(p1.id, 'earlyFive').id);
  g.confirmClaim(g.claim(p1.id, 'topLine').id);
  assert.equal(g.state.winners.filter((w) => w.playerId === p1.id).length, 2);
  assert.throws(() => g.claim(p1.id, 'topLine'), /already won/);
});

test('one-prize-per-person rule', () => {
  const { g, p1 } = setup({ rules: { onePrizePerPerson: true } });
  draw(g, [4, 23, 41, 62, 85]);
  g.confirmClaim(g.claim(p1.id, 'earlyFive').id);
  assert.throws(() => g.claim(p1.id, 'topLine'), /One prize per person/);
});

test('a claim after the prize was won on an earlier number is refused', () => {
  const { g, p1, p2 } = setup();
  draw(g, [4, 23, 41, 62, 85]); // A and C both have 23,41,62,85; C also needs 1
  g.confirmClaim(g.claim(p1.id, 'topLine').id);
  draw(g, [1]); // C completes top line one number later
  assert.throws(() => g.claim(p2.id, 'topLine'), /already been won/);
});

test('tie: both players completed on the same number -> both win, marked split', () => {
  const { g, p1, p2 } = setup({ rules: { tieMode: 'split' } });
  draw(g, [1, 4, 23, 41, 62, 85]); // both top lines complete on 85
  const c1 = g.claim(p1.id, 'topLine');
  const c2 = g.claim(p2.id, 'topLine');
  assert.equal(c1.completedAt, c2.completedAt);
  const winners = g.confirmClaim(c1.id);
  assert.equal(winners.length, 2);
  assert.ok(winners.every((w) => w.shared === 'split'));
  assert.equal(g.state.claims.find((c) => c.id === c2.id).status, 'confirmed');
});

test('tie that is claimed after the first winner was confirmed is still accepted', () => {
  const { g, p1, p2 } = setup({ rules: { tieMode: 'both' } });
  draw(g, [1, 4, 23, 41, 62, 85]);
  g.confirmClaim(g.claim(p1.id, 'topLine').id);
  const late = g.claim(p2.id, 'topLine');
  assert.equal(late.valid, true);
  const all = g.confirmClaim(late.id);
  assert.equal(all.length, 2);
  assert.ok(all.every((w) => w.shared === 'both'));
});

test('second Full House needs the first one won, on a different ticket', () => {
  const { g, p1, p2 } = setup();
  draw(g, [...new Set([...allOf(A), ...allOf(C)])]);
  assert.throws(() => g.claim(p2.id, 'fullHouse2'), /first Full House/);
  g.confirmClaim(g.claim(p1.id, 'fullHouse1').id);
  const c = g.claim(p2.id, 'fullHouse2');
  assert.equal(c.valid, true);
  g.confirmClaim(c.id);
  assert.equal(g.state.winners.length, 2);
});

test('undo invalidates a pending claim that relied on the last number', () => {
  const { g, p1 } = setup();
  draw(g, [4, 23, 41, 62, 85]);
  const c = g.claim(p1.id, 'topLine');
  g.undo();
  assert.equal(g.state.claims.find((x) => x.id === c.id).valid, false);
  assert.throws(() => g.confirmClaim(c.id), /not valid/);
});

test('undo is blocked once a prize was confirmed on that number', () => {
  const { g, p1 } = setup();
  draw(g, [4, 23, 41, 62, 85]);
  g.confirmClaim(g.claim(p1.id, 'topLine').id);
  assert.throws(() => g.undo(), /can't be undone/);
});

test('draws are unique, 1-90, and stop at 90', () => {
  let t = 0;
  const g = new Game({ now: () => (t += 5000) });
  g.savePlayer({ name: 'A', key: 'a', bought: 1, paid: true });
  for (let i = 0; i < 90; i++) g.draw();
  assert.equal(new Set(g.state.draws).size, 90);
  assert.ok(g.state.draws.every((n) => n >= 1 && n <= 90));
  assert.throws(() => g.draw(), /All 90/);
});

test('draws closer together than the coin animation are refused', () => {
  let t = 1_000_000;
  const g = new Game({ now: () => t });
  g.savePlayer({ name: 'A', key: 'a', bought: 1, paid: true });
  g.draw();
  t += 1000;
  assert.throws(() => g.draw(), /coin/);
  t += 3000;
  assert.doesNotThrow(() => g.draw());
});
