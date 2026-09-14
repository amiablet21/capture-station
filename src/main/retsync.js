'use strict';
// Shared returns across desktops through a file-synced folder (Google
// Drive / OneDrive / a network share — the app only ever sees a local
// folder). Owner design 2026-09-14, built from the approved mockup.
//
// The contract that makes a consumer sync service safe to build on:
//   - every station appends full-record SNAPSHOTS of its changes to its
//     OWN file, returns-<STATION>.jsonl (one JSON event per line, op
//     'put' or 'del'). No two stations ever write the same file, so the
//     sync service can never produce a conflicted copy — the worst case
//     is a change arriving late.
//   - the shared log is the FOLD of every file: newest event per return
//     wins. A return's identity is "<ownerStation>:<localDbId>".
//   - the local SQLite stays each station's own storage. Remote edits to
//     THIS station's returns are applied back into it (the CSV mirror and
//     the sync-off fallback stay truthful); other stations' returns stay
//     virtual, straight out of the fold.
const fs = require('node:fs');
const path = require('node:path');

let db = null;
let userDataDir = '';
let onChange = null; // ({ changes }) => void — renderer refresh + toast
let folder = '';
let station = '';
let watcher = null;
let debounce = null;
let lastFoldSig = null; // Map gid -> "ts|actor|op" for change detection
let lastSeenTs = 0;     // newest foreign event already shown to the user

const enabled = () => !!(folder && station);
const stationName = () => station;
const fileFor = (st) => path.join(folder, `returns-${st}.jsonl`);
const gidOf = (localId) => `${station}:${localId}`;
const ownerOf = (gid) => String(gid).split(':')[0];
const saneStation = (s) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

function statePath() { return path.join(userDataDir, 'retsync-state.json'); }
function loadState() {
  try { lastSeenTs = Number(JSON.parse(fs.readFileSync(statePath(), 'utf8')).lastSeenTs) || 0; }
  catch { lastSeenTs = 0; }
}
function saveState() {
  try { fs.writeFileSync(statePath(), JSON.stringify({ lastSeenTs })); } catch { /* best effort */ }
}

// db row -> the snapshot a 'put' event carries (db column names travel
// verbatim so folding back into row shape is a spread)
function snapOf(row) {
  return {
    created_at: row.created_at,
    order_number: row.order_number,
    source: row.source || '',
    customer: row.customer || '',
    note: row.note || '',
    items: row.items || [],
    unmatched: !!row.unmatched,
    tracking: row.tracking || '',
    received_by: row.received_by || '',
  };
}

function appendEvent(ev) {
  if (!enabled()) return;
  try {
    fs.mkdirSync(folder, { recursive: true });
    fs.appendFileSync(fileFor(station), JSON.stringify(ev) + '\n', 'utf8');
    scheduleMirror();
  } catch (e) {
    console.error('[retsync] write failed:', e.message);
  }
}

// a local create/edit: snapshot the row as it now stands
function emitRow(row, ts) {
  if (!enabled() || !row) return;
  appendEvent({ v: 1, op: 'put', gid: gidOf(row.id), ts: ts || Date.now(), actor: station, rec: snapOf(row) });
}
// an edit/delete of ANOTHER station's return: same events, their gid
function emitPutFor(gid, snap) {
  if (!enabled()) return;
  appendEvent({ v: 1, op: 'put', gid, ts: Date.now(), actor: station, rec: snap });
}
function emitDel(gid) {
  if (!enabled()) return;
  appendEvent({ v: 1, op: 'del', gid, ts: Date.now(), actor: station });
}

// first enable: the whole local history joins the folder so every other
// desktop sees this station's past, not just what happens from now on
function backfill() {
  if (!enabled()) return;
  try {
    if (fs.existsSync(fileFor(station))) return;
    const rows = db.listReturns(100000);
    const lines = rows.reverse().map(r => JSON.stringify({
      v: 1, op: 'put', gid: gidOf(r.id), ts: Date.parse(r.created_at) || Date.now(), actor: station, rec: snapOf(r),
    }));
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(fileFor(station), lines.length ? lines.join('\n') + '\n' : '', 'utf8');
  } catch (e) {
    console.error('[retsync] backfill failed:', e.message);
  }
}

// read every station file; newest event per gid wins (actor name breaks
// exact-timestamp ties so every station folds to the same answer)
function fold() {
  const winners = new Map(); // gid -> event
  if (!enabled()) return winners;
  let names = [];
  try { names = fs.readdirSync(folder).filter(n => /^returns-.+\.jsonl$/i.test(n)); } catch { return winners; }
  for (const name of names) {
    let text = '';
    try { text = fs.readFileSync(path.join(folder, name), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let ev = null;
      try { ev = JSON.parse(line); } catch { continue; } // half-synced tail line: next pass gets it
      if (!ev || !ev.gid || !ev.ts || (ev.op !== 'put' && ev.op !== 'del')) continue;
      const cur = winners.get(ev.gid);
      if (!cur || ev.ts > cur.ts || (ev.ts === cur.ts && String(ev.actor) > String(cur.actor))) winners.set(ev.gid, ev);
    }
  }
  return winners;
}

// remote edits/deletes of THIS station's rows land back in SQLite, so the
// local db (and the returns.csv it mirrors) always matches the fold
function applyToDb(winners, writeCsv) {
  let touched = false;
  for (const [gid, ev] of winners) {
    if (ownerOf(gid) !== station || ev.actor === station) continue;
    const localId = Number(String(gid).slice(station.length + 1));
    if (!Number.isInteger(localId)) continue;
    const row = db.getReturn(localId);
    if (ev.op === 'del') {
      if (row) { db.deleteReturn(localId); touched = true; }
      continue;
    }
    if (!row) continue; // deleted locally after their stale edit: fold view still shows the winner
    const s = ev.rec || {};
    const same = JSON.stringify(snapOf(row)) === JSON.stringify(snapOf({ ...s, id: localId, items: s.items || [] }));
    if (same) continue;
    db.saveReturn(localId, {
      orderNumber: s.order_number || '', createdAt: s.created_at || row.created_at,
      customer: s.customer || '', tracking: s.tracking || '',
      note: s.note || '', items: s.items || [], unmatched: !!s.unmatched,
      receivedBy: s.received_by || '',
    });
    touched = true;
  }
  if (touched && writeCsv) writeCsv();
}

// the merged log, in db.listReturns row shape plus sync metadata
function list() {
  const winners = fold();
  const rows = [];
  for (const [gid, ev] of winners) {
    if (ev.op !== 'put') continue;
    const s = ev.rec || {};
    rows.push({
      id: gid, gid,
      created_at: s.created_at || new Date(ev.ts).toISOString(),
      order_number: s.order_number || '', source: s.source || '',
      customer: s.customer || '', note: s.note || '',
      items: Array.isArray(s.items) ? s.items : [],
      unmatched: !!s.unmatched, tracking: s.tracking || '', received_by: s.received_by || '',
      _st: ownerOf(gid), _actor: ev.actor || ownerOf(gid), _ts: ev.ts,
    });
  }
  // db rows the fold has not caught up with yet (a write that raced the
  // read) still show — own data never blinks out of the log
  const seen = new Set(rows.map(r => r.gid));
  for (const r of db.listReturns(100000)) {
    const gid = gidOf(r.id);
    if (seen.has(gid)) continue;
    rows.push({ ...r, id: gid, gid, _st: station, _actor: station, _ts: Date.parse(r.created_at) || 0 });
  }
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.gid).localeCompare(String(a.gid)));
  return rows;
}

function getRec(gid) {
  const ev = fold().get(gid);
  if (!ev || ev.op !== 'put') return null;
  const s = ev.rec || {};
  return {
    id: gid, gid, created_at: s.created_at || new Date(ev.ts).toISOString(),
    order_number: s.order_number || '', source: s.source || '', customer: s.customer || '',
    note: s.note || '', items: Array.isArray(s.items) ? s.items : [],
    unmatched: !!s.unmatched, tracking: s.tracking || '', received_by: s.received_by || '',
  };
}

function status() {
  if (!enabled()) return { enabled: false };
  const stations = [];
  try {
    for (const name of fs.readdirSync(folder)) {
      const m = name.match(/^returns-(.+)\.jsonl$/i);
      if (!m) continue;
      let ts = 0;
      try { ts = fs.statSync(path.join(folder, name)).mtimeMs; } catch { /* listed is enough */ }
      stations.push({ name: m[1], lastTs: ts });
    }
  } catch { return { enabled: true, station, folder, folderOk: false, stations: [] }; }
  stations.sort((a, b) => (b.name === station) - (a.name === station) || b.lastTs - a.lastTs);
  return { enabled: true, station, folder, folderOk: true, stations };
}

// how many foreign changes landed since this station last looked — the
// "caught up while you were away" banner on the Returns page
function missedCount(winners) {
  let n = 0;
  let newest = lastSeenTs;
  for (const ev of winners.values()) {
    if (ev.actor !== station && ev.ts > lastSeenTs) n++;
    if (ev.ts > newest) newest = ev.ts;
  }
  return { missed: n, newest };
}
function markSeen(ts) {
  if (ts > lastSeenTs) { lastSeenTs = ts; saveState(); }
}

const foldSig = (winners) => {
  const sig = new Map();
  for (const [gid, ev] of winners) sig.set(gid, `${ev.ts}|${ev.actor}|${ev.op}`);
  return sig;
};

// the folder changed on disk (a peer's file synced in): re-fold, apply to
// the db, and tell the renderer exactly which returns moved
function rescan(writeCsv) {
  if (!enabled()) return;
  const winners = fold();
  applyToDb(winners, writeCsv);
  const changes = [];
  if (lastFoldSig) {
    for (const [gid, ev] of winners) {
      if (ev.actor === station) continue;
      const prev = lastFoldSig.get(gid);
      const now = `${ev.ts}|${ev.actor}|${ev.op}`;
      if (prev === now) continue;
      changes.push({ gid, op: ev.op, actor: ev.actor, kind: prev ? 'edit' : 'new' });
    }
  }
  lastFoldSig = foldSig(winners);
  const { newest } = missedCount(winners);
  markSeen(newest);
  writeMirror(winners);
  if (changes.length && onChange) onChange({ changes });
}

// The spreadsheet MIRROR (owner 2026-09-14: "can the drive just be like a
// spreadsheet?"): one merged returns-log.csv beside the sync files — the
// whole company log, every station, double-clickable in Drive / Excel /
// Google Sheets. Strictly derived and never read back: an edit made in
// the spreadsheet is overwritten on the next change; real edits go
// through the app, where stock moves and validation live.
const csvEsc = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
let mirrorTimer = null;

function writeMirror(winners) {
  if (!enabled()) return;
  try {
    const lines = ['date,station,order_number,source,customer,tracking,sku,condition,target_sku,qty,price,received_by,last_edit_station,note,unmatched'];
    const puts = [...winners.entries()].filter(([, ev]) => ev.op === 'put');
    puts.sort((a, b) => String(a[1].rec?.created_at || '').localeCompare(String(b[1].rec?.created_at || '')));
    for (const [gid, ev] of puts) {
      const s = ev.rec || {};
      const its = (Array.isArray(s.items) && s.items.length) ? s.items : [{ sku: '', condition: '', targetSku: '', qty: '', price: null, note: '' }];
      for (const it of its) {
        lines.push([
          s.created_at || '', ownerOf(gid), s.order_number || '', s.source || '', s.customer || '', s.tracking || '',
          it.sku || '', it.condition || '', it.targetSku || '', it.qty ?? '',
          it.price != null ? it.price : '', s.received_by || '',
          ev.actor !== ownerOf(gid) ? ev.actor : '',
          it.note || s.note || '', s.unmatched ? 'yes' : '',
        ].map(csvEsc).join(','));
      }
    }
    const text = lines.join('\r\n');
    const fp = path.join(folder, 'returns-log.csv');
    // skip the write when nothing changed — every station regenerates this
    // file, and identical rewrites would only feed the sync service churn
    try { if (fs.readFileSync(fp, 'utf8') === text) return; } catch { /* first write */ }
    fs.writeFileSync(fp, text, 'utf8');
  } catch { /* the mirror is a convenience — the jsonl files are the truth */ }
}

// emits + folder ticks both land here; the debounce batches a burst of
// changes into one spreadsheet write
function scheduleMirror() {
  if (!enabled()) return;
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => writeMirror(fold()), 2000);
}

function stopWatch() {
  if (watcher) { try { watcher.close(); } catch { /* already gone */ } watcher = null; }
  clearTimeout(debounce);
  clearTimeout(mirrorTimer);
}

function startWatch(writeCsv) {
  stopWatch();
  if (!enabled()) return;
  try {
    watcher = fs.watch(folder, { persistent: false }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => rescan(writeCsv), 1500);
    });
  } catch (e) {
    console.error('[retsync] watch failed:', e.message);
  }
}

// boot + every settings change: (re)point at the folder, seed history,
// fold once for the catch-up count, then watch
function configure({ sync, database, userData, changed, writeCsv }) {
  db = database;
  userDataDir = userData;
  onChange = changed;
  stopWatch();
  folder = String((sync && sync.folder) || '').trim();
  station = saneStation((sync && sync.station) || '');
  if (!enabled()) { lastFoldSig = null; return { enabled: false, missed: 0 }; }
  loadState();
  backfill();
  const winners = fold();
  applyToDb(winners, writeCsv);
  lastFoldSig = foldSig(winners);
  const { missed, newest } = missedCount(winners);
  markSeen(newest);
  writeMirror(winners);
  startWatch(writeCsv);
  return { enabled: true, missed };
}

module.exports = { configure, enabled, stationName, gidOf, ownerOf, emitRow, emitPutFor, emitDel, list, getRec, status, rescan };
