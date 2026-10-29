'use strict';
// Small CSV reader/writer (handles quotes, commas and newlines inside quotes).

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const HEADER_ALIASES = {
  name: ['name', 'full name', 'player', 'employee name'],
  key: ['email/employee id', 'email', 'employee id', 'emp id', 'empid', 'email / employee id', 'id', 'email or employee id'],
  team: ['team', 'department', 'dept'],
  bought: ['tickets bought', 'tickets', 'no of tickets', 'number of tickets', 'qty', 'quantity'],
  paid: ['paid', 'paid (yes/no)', 'payment', 'paid?']
};

function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const norm = String(h).trim().toLowerCase();
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] === undefined && aliases.includes(norm)) map[field] = i;
    }
  });
  return map;
}

// Returns { records: [{line, name, key, team, bought, paid, raw}], headerErrors: [] }
function readRoster(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { records: [], headerErrors: ['The file is empty.'] };
  const map = mapHeaders(rows[0]);
  const headerErrors = [];
  if (map.name === undefined) headerErrors.push('Missing a "Name" column.');
  if (map.key === undefined) headerErrors.push('Missing an "Email/Employee ID" column.');
  if (map.bought === undefined) headerErrors.push('Missing a "Tickets Bought" column.');
  if (headerErrors.length) return { records: [], headerErrors };
  const get = (r, f) => (map[f] === undefined ? '' : String(r[map[f]] ?? '').trim());
  const records = rows.slice(1).map((r, i) => ({
    line: i + 2,
    name: get(r, 'name'),
    key: get(r, 'key'),
    team: get(r, 'team'),
    boughtRaw: get(r, 'bought'),
    paidRaw: get(r, 'paid')
  }));
  return { records, headerErrors };
}

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Prevent spreadsheet formula injection from names typed by players.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(rows) {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

module.exports = { parseCsv, readRoster, toCsv };
