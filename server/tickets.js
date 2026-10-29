'use strict';
// Tambola ticket generation and validation.
// Ticket = 3 rows x 9 columns, 15 numbers, exactly 5 per row.
// Column 1 = 1-9, column 2 = 10-19 ... column 9 = 80-90.
// Numbers ascend top-to-bottom within a column; every column has at least one number.

const crypto = require('crypto');

const ROWS = 3;
const COLS = 9;
const PER_ROW = 5;

function columnRange(c) {
  if (c === 0) return [1, 9];
  if (c === 8) return [80, 90];
  return [c * 10, c * 10 + 9];
}

function columnOf(n) {
  if (n === 90) return 8;
  return Math.floor(n / 10);
}

function randInt(max) {
  return crypto.randomInt(max);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Choose which cells hold numbers: each row exactly 5 cells, each column >= 1.
function layout() {
  for (;;) {
    const grid = [];
    for (let r = 0; r < ROWS; r++) {
      const cols = shuffle([...Array(COLS).keys()]).slice(0, PER_ROW);
      const row = Array(COLS).fill(false);
      cols.forEach((c) => { row[c] = true; });
      grid.push(row);
    }
    let ok = true;
    for (let c = 0; c < COLS; c++) {
      if (!grid.some((row) => row[c])) { ok = false; break; }
    }
    if (ok) return grid;
  }
}

function generateTicket() {
  const grid = layout();
  const rows = [...Array(ROWS)].map(() => Array(COLS).fill(0));
  for (let c = 0; c < COLS; c++) {
    const slots = [];
    for (let r = 0; r < ROWS; r++) if (grid[r][c]) slots.push(r);
    const [lo, hi] = columnRange(c);
    const pool = [];
    for (let n = lo; n <= hi; n++) pool.push(n);
    const picked = shuffle(pool).slice(0, slots.length).sort((a, b) => a - b);
    slots.forEach((r, i) => { rows[r][c] = picked[i]; });
  }
  return rows;
}

// Stable identity of a ticket, used to guarantee no two tickets are identical.
function ticketKey(rows) {
  return rows.map((row) => row.join(',')).join('|');
}

function numbersOf(rows) {
  return rows.flat().filter((n) => n > 0);
}

// Returns a list of problems; empty list means the ticket is valid.
function validateTicket(rows) {
  const problems = [];
  if (!Array.isArray(rows) || rows.length !== ROWS) return ['ticket must have 3 rows'];
  rows.forEach((row, r) => {
    if (!Array.isArray(row) || row.length !== COLS) problems.push(`row ${r + 1} must have 9 columns`);
    else if (row.filter((n) => n > 0).length !== PER_ROW) problems.push(`row ${r + 1} must have exactly 5 numbers`);
  });
  if (problems.length) return problems;
  const nums = numbersOf(rows);
  if (nums.length !== 15) problems.push('ticket must have 15 numbers');
  if (new Set(nums).size !== nums.length) problems.push('ticket has duplicate numbers');
  for (let c = 0; c < COLS; c++) {
    const col = rows.map((row) => row[c]).filter((n) => n > 0);
    if (col.length === 0) problems.push(`column ${c + 1} is empty`);
    const [lo, hi] = columnRange(c);
    col.forEach((n) => { if (n < lo || n > hi) problems.push(`${n} is in the wrong column`); });
    for (let i = 1; i < col.length; i++) {
      if (col[i] <= col[i - 1]) problems.push(`column ${c + 1} is not ascending`);
    }
  }
  return problems;
}

module.exports = { generateTicket, validateTicket, ticketKey, numbersOf, columnOf, columnRange };
