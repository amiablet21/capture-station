'use strict';
// RFC 4180 CSV reader for the Walmart reconciliation reports. Stands in
// for PapaParse ({ header: true, skipEmptyLines: "greedy" }) so the
// Recovery page adds no dependency: quoted fields, doubled quotes, CR/LF
// or LF line ends, a leading UTF-8 BOM. Every value is a string — PO
// numbers are 13–15 digits and must never become numbers.

function parseCsvText(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      row.push(field); field = '';
      records.push(row); row = [];
      if (c === '\r' && s[i + 1] === '\n') i++;
      i++; continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); records.push(row); }

  // "greedy" empty-line skipping: a record whose every cell is blank is dropped
  const kept = records.filter(r => r.some(v => String(v).trim() !== ''));
  if (!kept.length) return { rows: [], columns: [] };
  const columns = kept[0].map(h => String(h).trim());
  const rows = kept.slice(1).map(r => {
    const o = {};
    columns.forEach((col, idx) => { o[col] = r[idx] === undefined ? '' : r[idx]; });
    return o;
  });
  return { rows, columns };
}

module.exports = { parseCsvText };
