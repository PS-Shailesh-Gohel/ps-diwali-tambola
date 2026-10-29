'use strict';
// Prize definitions and verification.
// Verification ALWAYS uses the numbers drawn so far, never what a player marked.

const { numbersOf } = require('./tickets');

const rowNums = (row) => row.filter((n) => n > 0);

const PRIZES = [
  { key: 'earlyFive', name: 'Early Five', defaultOn: true, help: 'Any 5 numbers on a ticket' },
  { key: 'topLine', name: 'Top Line', defaultOn: true, help: 'All 5 numbers of the top row', pattern: (t) => rowNums(t[0]) },
  { key: 'middleLine', name: 'Middle Line', defaultOn: true, help: 'All 5 numbers of the middle row', pattern: (t) => rowNums(t[1]) },
  { key: 'bottomLine', name: 'Bottom Line', defaultOn: true, help: 'All 5 numbers of the bottom row', pattern: (t) => rowNums(t[2]) },
  {
    key: 'fourCorners', name: 'Four Corners', defaultOn: true, help: 'First and last number of the top and bottom rows',
    pattern: (t) => { const a = rowNums(t[0]); const c = rowNums(t[2]); return [a[0], a[4], c[0], c[4]]; }
  },
  {
    key: 'rangoli', name: 'Rangoli', defaultOn: false, help: 'Four corners plus the centre number (3rd number of the middle row)',
    pattern: (t) => { const a = rowNums(t[0]); const b = rowNums(t[1]); const c = rowNums(t[2]); return [a[0], a[4], b[2], c[0], c[4]]; }
  },
  {
    key: 'diya', name: 'Diya', defaultOn: false,
    help: 'The flame (3rd number of the top row), the whole middle row, and the base (2nd, 3rd and 4th numbers of the bottom row)',
    pattern: (t) => { const a = rowNums(t[0]); const b = rowNums(t[1]); const c = rowNums(t[2]); return [a[2], ...b, c[1], c[2], c[3]]; }
  },
  { key: 'fullHouse1', name: 'Full House', defaultOn: true, help: 'All 15 numbers', pattern: (t) => numbersOf(t) },
  { key: 'fullHouse2', name: 'Second Full House', defaultOn: true, help: 'All 15 numbers, after the first Full House is won', pattern: (t) => numbersOf(t) }
];

const PRIZE_BY_KEY = Object.fromEntries(PRIZES.map((p) => [p.key, p]));

// drawIndex: Map number -> position in the draw order (0-based).
// Returns the draw position at which the prize was completed on this ticket, or null if not complete.
function completedAt(ticketRows, prizeKey, drawIndex) {
  const prize = PRIZE_BY_KEY[prizeKey];
  if (!prize) throw new Error(`Unknown prize ${prizeKey}`);
  if (prizeKey === 'earlyFive') {
    const idx = numbersOf(ticketRows).filter((n) => drawIndex.has(n)).map((n) => drawIndex.get(n)).sort((a, b) => a - b);
    return idx.length >= 5 ? idx[4] : null;
  }
  const nums = prize.pattern(ticketRows);
  let max = -1;
  for (const n of nums) {
    if (!drawIndex.has(n)) return null;
    max = Math.max(max, drawIndex.get(n));
  }
  return max;
}

// Numbers still needed for the prize on this ticket.
function missingNumbers(ticketRows, prizeKey, drawIndex) {
  if (prizeKey === 'earlyFive') {
    const have = numbersOf(ticketRows).filter((n) => drawIndex.has(n)).length;
    return Math.max(0, 5 - have);
  }
  return PRIZE_BY_KEY[prizeKey].pattern(ticketRows).filter((n) => !drawIndex.has(n));
}

function missingCount(ticketRows, prizeKey, drawIndex) {
  const m = missingNumbers(ticketRows, prizeKey, drawIndex);
  return Array.isArray(m) ? m.length : m;
}

function drawIndexOf(draws) {
  return new Map(draws.map((n, i) => [n, i]));
}

module.exports = { PRIZES, PRIZE_BY_KEY, completedAt, missingNumbers, missingCount, drawIndexOf };
