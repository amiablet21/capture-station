#!/usr/bin/env node
'use strict';
// Reads a returns-sync folder (the Google Drive shared folder, or a copy of
// it) into the DWS Server database. It only READS the folder: nothing in it
// is changed, moved or deleted. Safe to run again: records already in the
// database are left alone unless the folder holds a newer version.
//
//   node server/import-folder.js "G:\My Drive\returns-sync" [path/to/dws-server.sqlite]
//
// Every station's files are combined by the same rules the desktop app
// uses: newest change per record wins, an order sold on seven computers
// counts once, a deleted record stays deleted.

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const FILE_RE = /^([a-z]+(?:-[a-z]+)*)-([A-Z0-9][A-Z0-9-]*)\.jsonl$/;
const ms = (v) => (typeof v === 'number' ? v : Date.parse(v) || 0);

function readFolder(folder) {
  const byPrefix = {};
  const skipped = [];
  for (const name of fs.readdirSync(folder).sort()) {
    const full = path.join(folder, name);
    let st; try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) { skipped.push(`${name}/`); continue; }
    const m = name.match(FILE_RE);
    if (!m) { skipped.push(name); continue; }
    const [, prefix, station] = m;
    const lines = [];
    let torn = 0;
    for (const ln of fs.readFileSync(full, 'utf8').split('\n')) {
      if (!ln.trim()) continue;
      try { lines.push(JSON.parse(ln)); } catch { torn++; } // a half-written last line
    }
    (byPrefix[prefix] = byPrefix[prefix] || []).push({ name, station, lines, torn });
  }
  return { byPrefix, skipped };
}

// newest event per id; `op: 'del'` wins like any other event
function foldPutDel(files, idOf) {
  const win = new Map();
  for (const f of files || []) {
    for (const ev of f.lines) {
      if (!ev || !ev.ts) continue;
      const id = idOf(ev, f.station);
      if (!id) continue;
      const cur = win.get(id);
      const ts = ms(ev.ts);
      if (!cur || ts > cur.ts || (ts === cur.ts && String(ev.actor || f.station) > String(cur.actor))) {
        win.set(id, { ev, ts, station: f.station, actor: ev.actor || f.station });
      }
    }
  }
  return win;
}
const latestBy = (files, keyOf, tsOf) => {
  const win = new Map();
  for (const f of files || []) {
    for (const row of f.lines) {
      const k = row && keyOf(row);
      if (!k) continue;
      const ts = ms(tsOf(row));
      const cur = win.get(k);
      if (!cur || ts >= cur.ts) win.set(k, { row, ts, station: row.station || f.station });
    }
  }
  return win;
};

function importFolder(db, folder) {
  const { byPrefix, skipped } = readFolder(folder);
  const counts = {};
  const add = (kind, n = 1) => { counts[kind] = (counts[kind] || 0) + n; };
  const known = new Set();
  const take = (prefix) => { known.add(prefix); return byPrefix[prefix] || []; };
  const put = (kind, id, data, opts = {}) => { if (db.importPut(kind, id, data, opts)) add(opts.deleted ? `${kind} (deleted)` : kind); };

  db.tx(() => {
    /* Returns: full snapshots, put or del; every event becomes a history line */
    const returns = take('returns');
    for (const [gid, w] of foldPutDel(returns, (ev) => ev.gid)) {
      const owner = store.stationOf(gid);
      if (w.ev.op === 'del') { put('return', gid, { station: owner }, { srcTs: w.ts, station: owner, deleted: true }); continue; }
      put('return', gid, { ...(w.ev.rec || {}), station: owner }, { srcTs: w.ts, station: owner });
    }
    const events = [];
    for (const f of returns) for (const ev of f.lines) if (ev && ev.gid && ev.ts) events.push({ ev, station: f.station });
    events.sort((a, b) => ms(a.ev.ts) - ms(b.ev.ts));
    const last = new Map();
    const K = store.KINDS.return;
    for (const { ev, station } of events) {
      const before = last.get(ev.gid) || null;
      const after = ev.op === 'del' ? null : { ...(ev.rec || {}), station: store.stationOf(ev.gid) };
      const action = ev.op === 'del' ? 'delete' : before ? 'edit' : 'create';
      if (action === 'edit' && JSON.stringify(before) === JSON.stringify(after)) { last.set(ev.gid, after); continue; }
      const verb = action === 'create' ? 'added' : action === 'edit' ? 'edited' : 'deleted';
      const changed = action === 'edit' ? Object.keys({ ...before, ...after }).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).join(', ') : '';
      if (db.logHistory({
        actor: { user: '', station: ev.actor || station }, ts: new Date(ms(ev.ts)).toISOString(), area: 'returns', kind: 'return', id: ev.gid,
        action, summary: `${K.one} ${verb}: ${K.title(after || before || {})}`, changed, before, after, srcKey: `return|${ev.gid}|${ev.ts}|${ev.actor || station}`,
      })) add('history lines');
      last.set(ev.gid, after);
    }

    /* Stock */
    for (const f of take('stocklog')) for (const r of f.lines) if (r && r.gid && r.sku && db.importPut('stock_change', r.gid, r, { station: r.computer || f.station })) add('stock_change');
    for (const f of take('stockimports')) for (const r of f.lines) if (r && r.id && db.importPut('stock_import', r.id, { ...r, station: r.station || f.station }, { station: r.station || f.station })) add('stock_import');
    for (const [sku, w] of latestBy(take('costs'), (r) => String(r.sku || '').toUpperCase(), (r) => r.updated_at)) {
      put('cost', sku, { ...w.row, station: w.station }, { srcTs: w.ts || 1, station: w.station });
    }
    const wfsEdits = latestBy(take('wfsedit'), (r) => r.key, (r) => r.ts);
    const wfsRecv = latestBy(take('wfsrecv'), (r) => r.key, (r) => r.ts);
    for (const f of take('wfs')) {
      for (const r of f.lines) {
        if (!r || r.id === undefined) continue;
        const key = `${f.station}:${r.id}`;
        const edit = wfsEdits.get(key);
        const recv = wfsRecv.get(key);
        const data = { ts: r.ts, note: r.note || '', items: r.items || [], station: f.station, received_at: recv ? String(recv.row.receivedAt || '') : '' };
        if (edit && !edit.row.deleted) { if (Array.isArray(edit.row.items)) data.items = edit.row.items; if (edit.row.note !== undefined) data.note = String(edit.row.note || ''); }
        const srcTs = Math.max(ms(r.ts), edit ? edit.ts : 0, recv ? recv.ts : 0) || 1;
        put('wfs_shipment', key, data, { srcTs, station: f.station, deleted: !!(edit && edit.row.deleted) });
      }
    }

    /* Orders */
    for (const [id, w] of foldPutDel(take('captures'), (ev, st) => (ev.id === undefined ? '' : `${st}:${ev.id}`))) {
      const del = w.ev.op === 'del';
      put('packed_order', id, { ...(w.ev.row || {}), station: w.station }, { srcTs: w.ts, station: w.station, deleted: del });
    }
    for (const [id, w] of foldPutDel(take('shiplabels'), (ev, st) => (ev.id === undefined ? '' : `${st}:${ev.id}`))) {
      put('label', id, { ...(w.ev.row || {}), station: w.station }, { srcTs: w.ts, station: w.station, deleted: w.ev.op === 'del' });
    }
    for (const [key, w] of latestBy(take('shippkgs'), (r) => r.key, (r) => r.ts)) {
      put('box_size', key, { ...w.row, station: w.station }, { srcTs: w.ts || 1, station: w.station });
    }

    /* Pricing: one sale per order reference, however many computers logged it */
    const sales = new Map();
    let saleLines = 0;
    for (const f of take('chansales')) {
      for (const r of f.lines) {
        if (!r || !r.ref) continue;
        saleLines++;
        const cur = sales.get(r.ref);
        if (!cur || ms(r.ts) < ms(cur.ts)) sales.set(r.ref, { ...r, station: r.station || f.station });
      }
    }
    for (const [ref, r] of sales) put('sale', ref, r, { station: r.station });
    for (const f of take('pricechanges')) for (const r of f.lines) if (r && r.id && db.importPut('price_change', r.id, { ...r, station: r.station || f.station }, { station: r.station || f.station })) add('price_change');
    const ops = [];
    const seenOp = new Set();
    for (const f of take('pricegroups')) for (const r of f.lines) if (r && r.id && !seenOp.has(r.id)) { seenOp.add(r.id); ops.push({ ...r, station: r.station || f.station }); }
    ops.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    const groups = new Map(); // CHILD -> newest op on it
    for (const op of ops) { const c = String(op.child || '').toUpperCase(); if (c) groups.set(c, op); }
    for (const [child, op] of groups) {
      const data = { child: op.child, parent: op.parent, state: op.op === 'ignore' ? 'ignored' : 'grouped', ts: op.ts, station: op.station };
      put('price_group', child, data, { srcTs: ms(op.ts) || 1, station: op.station, deleted: op.op === 'remove' });
    }

    /* Recovery: the summary is the record, the full statement rides along as its detail */
    for (const [id, w] of foldPutDel(take('wmruns'), (ev) => ev.id)) {
      const run = w.ev.run || {};
      const data = { ...run, station: run.station || w.station };
      const detail = w.ev.op === 'del' ? null : JSON.stringify({ refunds: w.ev.refunds || [], payouts: w.ev.payouts || [], ledger: w.ev.ledger || [], orders: w.ev.orders || null, lines: w.ev.lines || null });
      put('wm_run', id, data, { srcTs: w.ts, station: data.station, detail, deleted: w.ev.op === 'del' });
    }
    for (const [id, w] of foldPutDel(take('wmwfs'), (ev) => ev.id)) {
      const rep = w.ev.report || {};
      const data = { ...rep, station: rep.station || w.station };
      const detail = w.ev.op === 'del' ? null : JSON.stringify({ rows: w.ev.rows || [] });
      put('wm_wfs_report', id, data, { srcTs: w.ts, station: data.station, detail, deleted: w.ev.op === 'del' });
    }
    for (const [po, w] of latestBy(take('wmmarks'), (r) => r.po, (r) => r.updated_at)) {
      put('wm_mark', po, { ...w.row, station: w.station }, { srcTs: w.ts || 1, station: w.station, deleted: !!w.row.removed });
    }
    for (const [id, w] of latestBy(take('wmexpenses'), (r) => r.id, (r) => r.updated_at)) {
      put('wm_expense', id, { ...w.row, station: w.station }, { srcTs: w.ts || 1, station: w.station, deleted: !!w.row.removed });
    }
    if (saleLines) counts['sale lines read (before removing repeats)'] = saleLines;
  });

  // files this importer has no table for yet: named, never silently dropped
  const notImported = [];
  for (const [prefix, files] of Object.entries(byPrefix)) if (!known.has(prefix)) for (const f of files) notImported.push(f.name);
  const torn = Object.values(byPrefix).flat().filter((f) => f.torn).map((f) => `${f.name} (${f.torn})`);
  const total = Object.entries(counts).filter(([k]) => !/read|history/.test(k)).reduce((a, [, n]) => a + n, 0);
  if (total) db.logHistory({ actor: { user: 'import', station: '' }, action: 'import', summary: `Imported ${total} records from ${path.basename(folder)}` });
  return { counts, notImported, skipped, torn };
}

// A dry run: the same import, into a database that only exists in memory
// and is thrown away. Nothing on disk changes, in the folder or anywhere
// else. Returns what a real import of this folder would hold.
function checkFolder(folder) {
  const db = store.open(':memory:');
  try {
    const res = importFolder(db, folder);
    const files = fs.readdirSync(folder).filter((n) => FILE_RE.test(n));
    return { ...res, totals: db.counts(), files: files.length, folder };
  } finally { db.close(); }
}

const AREA_NAMES = Object.fromEntries(store.AREAS);
const num = (n) => Number(n).toLocaleString('en-US');

// files the app itself no longer reads: the warehouse-rooms feature was
// reverted on 2026-09-22 and its file stayed behind in the folder
const LEFTOVER = /^rooms-/;
const splitUnplaced = (names) => ({ leftover: (names || []).filter((n) => LEFTOVER.test(n)), unplaced: (names || []).filter((n) => !LEFTOVER.test(n)) });

// The short version for the Settings screen (owner 2026-11-20: "is there a
// way to simplify this"): what was read, the total by section, whether the
// returns agree with this computer, and only the things that need a look.
function summarize(rep, { changed = false, compare = {} } = {}) {
  const areas = store.AREAS.map(([area, label]) => ({ label, count: rep.totals.filter((t) => t.area === area).reduce((n, t) => n + t.count, 0) })).filter((a) => a.count);
  const total = areas.reduce((n, a) => n + a.count, 0);
  const server = (rep.totals.find((t) => t.kind === 'return') || {}).count || 0;
  const lines = [
    `${changed ? 'Brought in' : 'Read'} ${num(rep.files)} files from your Drive folder. ${changed ? 'The folder itself was not changed.' : 'Nothing was changed.'}`,
    `${num(total)} records: ${areas.map((a) => `${a.label} ${num(a.count)}`).join(' · ')}`,
  ];
  const issues = [];
  if (compare.return !== undefined) {
    if (compare.return === server) lines.push(`Returns match DWS Stock on this computer (${num(server)}).`);
    else issues.push(`Returns differ: ${num(server)} here, ${num(compare.return)} in DWS Stock on this computer.`);
  }
  const { unplaced } = splitUnplaced(rep.notImported);
  if (unplaced.length) issues.push(`${num(unplaced.length)} file${unplaced.length === 1 ? ' was' : 's were'} not brought in: ${unplaced.join(', ')}`);
  if (rep.torn.length) issues.push(`${num(rep.torn.length)} file${rep.torn.length === 1 ? ' has' : 's have'} a line still being written. It is picked up next time.`);
  if (!issues.length) lines.push('Everything was read.');
  return { lines, issues, ok: !issues.length };
}

// the report as plain lines, for a screen or a terminal
function reportText(rep, { changed = false, compare = {} } = {}) {
  const out = [];
  out.push(`${changed ? 'Brought in' : 'Checked'} ${num(rep.files)} record files in ${rep.folder}`);
  out.push(changed ? 'The folder itself was not changed.' : 'Nothing was changed, in the folder or in the server.');
  let area = '';
  for (const t of rep.totals) {
    if (!t.count && !t.deleted) continue;
    if (t.area !== area) { area = t.area; out.push('', AREA_NAMES[area] || area); }
    const extra = [];
    if (t.deleted) extra.push(`${num(t.deleted)} deleted`);
    if (compare[t.kind] !== undefined) extra.push(`DWS Stock shows ${num(compare[t.kind])} on this computer`);
    out.push(`  ${t.label.padEnd(24)}${num(t.count).padStart(8)}${extra.length ? `   (${extra.join('; ')})` : ''}`);
  }
  const read = rep.counts['sale lines read (before removing repeats)'];
  if (read) out.push('', `Sales: ${num(read)} lines across the computers' files are ${num((rep.totals.find((t) => t.kind === 'sale') || {}).count || 0)} orders, each counted once.`);
  const { leftover, unplaced } = splitUnplaced(rep.notImported);
  if (unplaced.length) out.push('', 'No table for these yet (not brought in):', ...unplaced.map((n) => `  ${n}`));
  if (leftover.length) out.push('', 'Left over from a removed feature (ignored):', ...leftover.map((n) => `  ${n}`));
  if (rep.torn.length) out.push('', 'Half-written lines skipped:', ...rep.torn.map((n) => `  ${n}`));
  if (rep.skipped.length) out.push('', 'Left alone (not record files):', `  ${rep.skipped.join(', ')}`);
  return out.join('\n');
}

module.exports = { importFolder, checkFolder, reportText, summarize, readFolder };

if (require.main === module) {
  const folder = process.argv[2];
  if (!folder || !fs.existsSync(folder)) { console.error('Usage: node server/import-folder.js <returns-sync folder> [database file]'); process.exit(1); }
  const file = process.argv[3] || path.join(process.env.DWS_DATA || path.join(process.cwd(), 'dws-data'), 'dws-server.sqlite');
  if (process.argv.includes('--check')) { console.log(reportText(checkFolder(folder))); process.exit(0); }
  const db = store.open(file);
  const res = importFolder(db, folder);
  db.close();
  console.log(`Imported into ${file}`);
  for (const [k, n] of Object.entries(res.counts)) console.log(`  ${String(n).padStart(7)}  ${k}`);
  if (!Object.keys(res.counts).length) console.log('  nothing new');
  if (res.notImported.length) console.log(`Not imported yet (no table for them): ${res.notImported.join(', ')}`);
  if (res.skipped.length) console.log(`Left alone (not record files): ${res.skipped.join(', ')}`);
  if (res.torn.length) console.log(`Half-written lines skipped: ${res.torn.join(', ')}`);
}
