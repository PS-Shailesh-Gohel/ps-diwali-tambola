'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTicket, validateTicket, ticketKey, columnOf } = require('../server/tickets');
const { Game } = require('../server/game');

test('2,000 generated tickets all follow the Tambola rules', () => {
  for (let i = 0; i < 2000; i++) {
    const t = generateTicket();
    assert.deepEqual(validateTicket(t), [], `ticket ${i} invalid: ${JSON.stringify(t)}`);
  }
});

test('every number sits in the right column (1-9, 10-19 ... 80-90)', () => {
  for (let i = 0; i < 300; i++) {
    const t = generateTicket();
    t.forEach((row) => row.forEach((n, c) => { if (n) assert.equal(columnOf(n), c); }));
  }
});

test('validateTicket rejects broken tickets', () => {
  const good = [[4, 0, 23, 0, 41, 0, 62, 0, 85], [0, 12, 0, 35, 47, 0, 0, 76, 88], [9, 18, 0, 39, 0, 54, 69, 0, 0]];
  assert.deepEqual(validateTicket(good), []);
  const sixInRow = JSON.parse(JSON.stringify(good)); sixInRow[0][1] = 11;
  assert.ok(validateTicket(sixInRow).length > 0);
  const notAscending = JSON.parse(JSON.stringify(good)); notAscending[0][0] = 9; notAscending[2][0] = 4;
  assert.ok(validateTicket(notAscending).some((p) => p.includes('ascending')));
  const wrongColumn = JSON.parse(JSON.stringify(good)); wrongColumn[0][2] = 33;
  assert.ok(validateTicket(wrongColumn).some((p) => p.includes('wrong column')));
});

test('no two tickets in a game are identical (150 players x 5 tickets)', () => {
  const g = new Game();
  for (let i = 0; i < 150; i++) g.savePlayer({ name: `P${i}`, key: `emp-${i}`, team: 'QA', bought: 5, paid: true });
  const keys = Object.values(g.state.tickets).map((t) => ticketKey(t.rows));
  assert.equal(keys.length, 750);
  assert.equal(new Set(keys).size, 750);
  const ids = Object.keys(g.state.tickets);
  assert.equal(new Set(ids).size, 750);
  assert.match(ids[0], /^DT-\d{4}$/);
});
