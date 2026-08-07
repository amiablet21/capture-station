'use strict';

// Walmart "shipped orders" file import: the Seller Center download (Manage
// Orders → Download) is an .xlsx with one row per item line — PO#, Status,
// Carrier, Tracking Number among ~57 columns. This module parses it without
// any dependency (the xlsx is a zip of XML; zlib inflates the parts) and
// fills tracking onto matching queue rows in bulk.

const fs = require('fs');
const zlib = require('zlib');

/* ---------- minimal zip reader (xlsx = zip of XML parts) ---------- */

function readZip(buf) {
  // End Of Central Directory: scan backwards (a trailing comment may exist)
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) throw new Error('Not an .xlsx file (zip signature missing).');
  const count = buf.readUInt16LE(i + 10);
  let off = buf.readUInt32LE(i + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const cmtLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.set(name, { method, csize, lho });
    off += 46 + nameLen + extraLen + cmtLen;
  }
  const read = (name) => {
    const f = entries.get(name);
    if (!f) return null;
    const nl = buf.readUInt16LE(f.lho + 26);
    const el = buf.readUInt16LE(f.lho + 28);
    const start = f.lho + 30 + nl + el;
    const data = buf.subarray(start, start + f.csize);
    if (f.method === 8) return zlib.inflateRawSync(data);
    if (f.method === 0) return Buffer.from(data);
    throw new Error(`Unsupported zip compression (method ${f.method}).`);
  };
  return { entries, read };
}

/* ---------- sheet XML → rows of cell strings ---------- */

const unesc = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));

function colIndex(letters) { // "BC" -> 54 (0-based)
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''));
}

function parseSheet(xml, shared) {
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] || '';
      const inner = cm[2] || '';
      const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1] || '';
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || '';
      let val = '';
      if (type === 'inlineStr' || inner.includes('<is>')) {
        val = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('');
      } else {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        if (v) val = type === 's' ? (shared[Number(v[1])] ?? '') : v[1];
      }
      const idx = ref ? colIndex(ref) : cells.length;
      cells[idx] = unesc(val).trim();
    }
    rows.push(cells);
  }
  return rows;
}

/* ---------- csv (fallback, quoted fields supported) ---------- */

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field.trim()); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim()); field = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field.trim());
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

/* ---------- extraction: find the header row, pull the records ---------- */

// Header names are matched loosely so a slightly different Walmart report
// still works; "Update Tracking Number" must never win over the real one.
function findColumns(headerRow) {
  const idx = (test) => headerRow.findIndex(h => h && test(String(h).trim()));
  const po = idx(h => /^po\s*#?$/i.test(h)) !== -1
    ? idx(h => /^po\s*#?$/i.test(h))
    : idx(h => /^purchase\s*order/i.test(h));
  const tracking = idx(h => /tracking\s*number/i.test(h) && !/update/i.test(h));
  return {
    po,
    tracking,
    carrier: idx(h => /^carrier$/i.test(h) && !/update/i.test(h)),
    status: idx(h => /^status$/i.test(h)),
  };
}

function recordsFromRows(rows) {
  for (let h = 0; h < Math.min(rows.length, 10); h++) {
    const cols = findColumns(rows[h] || []);
    if (cols.po === -1 || cols.tracking === -1) continue;
    const out = [];
    for (const r of rows.slice(h + 1)) {
      const po = String(r[cols.po] || '').trim();
      const tracking = String(r[cols.tracking] || '').trim();
      if (!po || !tracking) continue;
      out.push({
        po,
        tracking,
        carrier: cols.carrier === -1 ? '' : String(r[cols.carrier] || '').trim(),
        status: cols.status === -1 ? '' : String(r[cols.status] || '').trim(),
      });
    }
    return out;
  }
  return null; // no header row found in any candidate sheet
}

function extractShipped(filePath) {
  if (/\.csv$/i.test(filePath)) {
    const recs = recordsFromRows(parseCsv(fs.readFileSync(filePath, 'utf8')));
    if (!recs) throw new Error('No PO# / Tracking Number columns found in that file.');
    return recs;
  }
  const zip = readZip(fs.readFileSync(filePath));
  const shared = parseSharedStrings((zip.read('xl/sharedStrings.xml') || '').toString());
  const sheetNames = [...zip.entries.keys()]
    .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  for (const name of sheetNames) {
    const recs = recordsFromRows(parseSheet(zip.read(name).toString(), shared));
    if (recs) return recs; // the first sheet with a PO#+Tracking header wins
  }
  throw new Error('No PO# / Tracking Number columns found in that file.');
}

/* ---------- apply: fill tracking onto matching queue rows ---------- */

// One PO can appear on several file lines (one per item) and, with split
// orders, on several queue rows. Trackings are assigned in stable order:
// first unfilled row gets the first tracking, and a single-tracking order
// fills every trackingless row it has.
function applyShipped(db, records) {
  const byPo = new Map(); // po -> [{tracking, carrier}] in file order, deduped
  for (const r of records) {
    if (!byPo.has(r.po)) byPo.set(r.po, []);
    const list = byPo.get(r.po);
    if (!list.some(x => x.tracking === r.tracking)) list.push({ tracking: r.tracking, carrier: r.carrier });
  }
  const summary = { pos: byPo.size, filled: 0, already: 0, conflicts: [], notInQueue: [] };
  for (const [po, tracks] of byPo) {
    const rows = db.rowsByOrderNumber(po);
    if (!rows.length) { summary.notInQueue.push(po); continue; }
    let ti = 0;
    for (const row of rows) {
      const t = tracks[Math.min(ti, tracks.length - 1)];
      ti++;
      if (row.tracking) {
        if (tracks.some(x => x.tracking === row.tracking)) summary.already++;
        else summary.conflicts.push(`${po}: row has ${row.tracking}, file says ${tracks.map(x => x.tracking).join(' / ')}`);
        continue;
      }
      db.setTracking(row.id, t.tracking, t.carrier);
      summary.filled++;
    }
  }
  return summary;
}

module.exports = { extractShipped, applyShipped, recordsFromRows, parseCsv };
