'use strict';
// Shared label record (owner 2026-11-14). Every computer kept its labels and
// its order tracking to itself, so an order labelled on one computer still
// looked unshipped on the next and was labelled again (twelve Temu orders
// went out twice). Each station now publishes its labels to the shared
// folder, in its own shiplabels-<STATION>.jsonl like every other record
// there, and reads everyone else's — plus the tracking the other stations
// already publish with their captures. From those two this module answers
// one question: does this PO# already have a label, anywhere?
//
// Only records travel, never the label images: a label is reprinted and
// voided on the computer that bought it.

const fs = require('node:fs');
const path = require('node:path');

const PREFIX = 'shiplabels';
const PUBLISH_DAYS = 60;    // how far back this station keeps its labels published
const LOOK_DAYS = 30;       // how far back a label or tracking still counts
const READ_EVERY_MS = 15000; // the folder is re-read at most this often unless forced

let retsync = null;
let db = null;
let userDataDir = '';

// what the other stations wrote, folded to the newest line per record
let labelState = { files: {} };
let capState = { files: {} };
let farLabels = new Map(); // "STATION:id" -> label record
let farCaps = new Map();   // "STATION:id" -> { order_number, lw_order_id, tracking, ... }
let farIndex = null;       // PO# -> { labels: [], caps: [] }, rebuilt when something changed
let lastRead = 0;

const poKey = (v) => String(v || '').trim().toUpperCase();
const dayBack = (n) => db.localDay(new Date(Date.now() - n * 86400000));

function reset() {
  labelState = { files: {} };
  capState = { files: {} };
  farLabels = new Map();
  farCaps = new Map();
  farIndex = null;
  lastRead = 0;
}

// boot + every sync settings change (a new folder is a new set of files)
function configure({ sync, database, userData }) {
  retsync = sync;
  db = database;
  userDataDir = userData;
  reset();
}

const on = () => !!(retsync && db && retsync.enabled());

/* ---------- publishing this station's labels ---------- */

function pubPath() { return path.join(userDataDir, 'shiplabels-published.json'); }

function snap(l) {
  return {
    created_at: l.created_at, day: l.day, kind: l.kind, reference: l.reference || '', from_po: l.from_po ? 1 : 0,
    source: l.source || '', account_id: l.account_id || '', account_name: l.account_name || '',
    service_code: l.service_code || '', service_name: l.service_name || '', tracking: l.tracking || '',
    carrier: l.carrier || '', cost: l.cost == null ? null : Number(l.cost), value: Number(l.value) || 0,
    weight: Number(l.weight) || 0, dims: l.dims || '', party_name: l.party_name || '', test: l.test ? 1 : 0,
    voided_at: l.voided_at || '', row_id: Number(l.row_id) || 0, part: l.part || '', signature: l.signature ? 1 : 0,
  };
}

// Append every label that is new or changed (voided, taken by an order line)
// since the last pass. Returns true when something was written. A folder
// that is offline leaves the "already written" list alone, so the next pass
// retries the same lines.
function publish() {
  if (!on()) return false;
  const me = retsync.stationName();
  let pub = {};
  try { pub = JSON.parse(fs.readFileSync(pubPath(), 'utf8')) || {}; } catch { /* first run: publish everything */ }
  // a renamed station or a file that is gone (new folder, deleted) starts over
  if (pub._station !== me || !retsync.auxExists(PREFIX)) pub = { _station: me };
  const ts = Date.now();
  let changed = false;
  for (const l of db.shipLabelsForShare(dayBack(PUBLISH_DAYS))) {
    const row = snap(l);
    const sig = JSON.stringify(row);
    if (pub[l.id] === sig) continue;
    if (!retsync.appendAux(PREFIX, { op: 'put', id: l.id, ts, row })) break; // folder offline: retry next pass
    pub[l.id] = sig;
    changed = true;
  }
  if (changed) { try { fs.writeFileSync(pubPath(), JSON.stringify(pub)); } catch { /* republishes next pass */ } }
  return changed;
}

/* ---------- reading the other stations ---------- */

// Fold whatever the other stations appended since the last read. Returns
// true when a record changed. Throttled, since the Orders page asks on every
// redraw; a purchase passes force so it checks against the folder as it is.
function refresh(force) {
  if (!on()) {
    if (!farLabels.size && !farCaps.size) return false;
    reset();
    return true;
  }
  const now = Date.now();
  if (!force && now - lastRead < READ_EVERY_MS) return false;
  lastRead = now;
  const me = retsync.stationName();
  let changed = false;
  const newer = (map, k, ts) => { const prev = map.get(k); return !prev || (Number(prev.ts) || 0) <= ts; };
  for (const e of retsync.readAuxNew(PREFIX, labelState)) {
    if (!e || e.station === me || e.id === undefined || e.op !== 'put' || !e.row) continue;
    const k = `${e.station}:${e.id}`;
    const ts = Number(e.ts) || 0;
    if (!newer(farLabels, k, ts)) continue;
    farLabels.set(k, { ...e.row, id: e.id, station: e.station, ts });
    changed = true;
  }
  for (const e of retsync.readAuxNew('captures', capState)) {
    if (!e || e.station === me || e.id === undefined) continue;
    const k = `${e.station}:${e.id}`;
    const ts = Number(e.ts) || 0;
    if (!newer(farCaps, k, ts)) continue;
    const r = e.op === 'put' && e.row ? e.row : null;
    const next = {
      station: e.station, id: e.id, ts, gone: !r,
      order_number: r ? r.order_number || '' : '', lw_order_id: r ? r.lw_order_id || '' : '',
      tracking: r ? r.tracking || '' : '', carrier: r ? r.carrier || '' : '', status: r ? r.status || '' : '',
      created_at: r ? r.created_at || '' : '', day: r ? r.day || '' : '',
    };
    const prev = farCaps.get(k);
    // only what the duplicate check reads counts as a change
    if (!prev || prev.tracking !== next.tracking || prev.order_number !== next.order_number || prev.gone !== next.gone || prev.status !== next.status) changed = true;
    farCaps.set(k, next);
  }
  if (changed) farIndex = null;
  return changed;
}

function index() {
  if (farIndex) return farIndex;
  const since = dayBack(LOOK_DAYS);
  const idx = new Map();
  const slot = (po) => { const k = poKey(po); if (!k) return null; if (!idx.has(k)) idx.set(k, { labels: [], caps: [] }); return idx.get(k); };
  for (const l of farLabels.values()) {
    if (l.kind !== 'ship' || l.voided_at || !l.tracking || String(l.day || '') < since) continue;
    const s = slot(l.reference);
    if (s) s.labels.push(l);
  }
  for (const c of farCaps.values()) {
    if (c.gone || !c.tracking || String(c.day || '') < since) continue;
    const s = slot(c.order_number);
    if (s) s.caps.push(c);
  }
  farIndex = idx;
  return idx;
}

/* ---------- does this PO# already have a label? ---------- */

// One pass over this computer's live labels, then a finder for any number of
// PO#s (the Orders page asks for every open line at once). The finder
// returns every sign of a label for that PO#, newest first:
//   { station, kind, id, tracking, service, account, cost, at, weight, dims }
// station '' = this computer. kind 'tab' = made here in the Ship tab (the
// line can take it over), 'label' = any other label, 'tracking' = tracking
// another computer put on the order (a label made anywhere, typed in there).
// part / rowId name the order line that is asking, so a split order's other
// part and the line's own label are told apart.
function finder({ test = false } = {}) {
  const local = new Map();
  for (const l of db.shipLabelsLive({ test })) {
    const k = poKey(l.reference);
    if (!local.has(k)) local.set(k, []);
    local.get(k).push(l);
  }
  const far = on() ? index() : new Map();
  const rowCache = new Map();
  const rowOf = (id) => { if (!rowCache.has(id)) rowCache.set(id, db.getRow(id) || null); return rowCache.get(id); };
  return (po, { part = '', rowId = 0 } = {}) => {
    const k = poKey(po);
    if (!k) return [];
    const out = [];
    const seen = new Set();
    const add = (it) => {
      const t = String(it.tracking).trim().toUpperCase();
      if (!t || seen.has(t)) return;
      seen.add(t);
      out.push(it);
    };
    for (const l of local.get(k) || []) {
      let kind = 'tab';
      if (l.row_id) {
        kind = 'label';
        if (l.row_id !== rowId) {
          // the label of this order's other part (a split order) is not a second label
          const other = rowOf(l.row_id);
          if (other && part && other.lw_order_id && other.lw_order_id !== part && poKey(other.order_number) === k) continue;
        }
      }
      add({ station: '', kind, id: l.id, tracking: l.tracking, service: l.service_name, account: l.account_name, cost: l.cost, at: l.created_at, weight: l.weight, dims: l.dims, carrier: l.carrier || '' });
    }
    const f = far.get(k);
    if (f) {
      for (const l of f.labels) {
        if (!!l.test !== !!test) continue;
        if (part && l.part && l.part !== part) continue;
        add({ station: l.station, kind: 'label', id: l.id, tracking: l.tracking, service: l.service_name, account: l.account_name, cost: l.cost, at: l.created_at, weight: l.weight, dims: l.dims, carrier: l.carrier || '' });
      }
      for (const c of f.caps) {
        if (part && c.lw_order_id && c.lw_order_id !== part) continue;
        add({ station: c.station, kind: 'tracking', id: c.id, tracking: c.tracking, service: c.carrier || '', account: '', cost: null, at: c.ts ? new Date(c.ts).toISOString() : c.created_at, weight: 0, dims: '', carrier: c.carrier || '', processed: c.status === 'synced' });
      }
    }
    return out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  };
}

/* ---------- the Ship tab's Labels table, every computer ---------- */

// the other stations' labels since a day, in the table's row shape
function listFar(sinceDay) {
  if (!on()) return [];
  const since = String(sinceDay || '');
  const out = [];
  for (const [k, l] of farLabels) {
    if (String(l.day || '') < since) continue;
    out.push({
      id: k, created_at: l.created_at, day: l.day, kind: l.kind === 'return' ? 'return' : 'ship', reference: l.reference || '',
      from_po: l.from_po ? 1 : 0, source: l.source || '', account_id: l.account_id || '', account_name: l.account_name || '',
      service_code: l.service_code || '', service_name: l.service_name || '', tracking: l.tracking || '', shipment_id: '',
      cost: l.cost == null ? null : Number(l.cost), value: Number(l.value) || 0, weight: Number(l.weight) || 0, dims: l.dims || '',
      party_name: l.party_name || '', test: l.test ? 1 : 0, voided_at: l.voided_at || '', carrier: l.carrier || '',
      row_id: Number(l.row_id) || 0, signature: l.signature ? 1 : 0, station: l.station, remote: true,
    });
  }
  return out;
}

// PO#s with more than one live ship-to-customer label in the last 30 days,
// across every computer and both accounts: { "PO#": count }. A split order's
// parts each carry their own label, so labels bought for different parts
// are counted per part, not together. A reference that was only ever typed
// by hand ("SAMPLES") is not a PO# and never counts.
function duplicates({ test = false } = {}) {
  const since = dayBack(LOOK_DAYS);
  const byPo = new Map(); // PO# -> Map(part -> Set(label))
  const real = new Set(); // PO#s with a label made from an order (not a typed reference such as "SAMPLES")
  const take = (l, who) => {
    if (l.kind !== 'ship' || l.voided_at || !l.tracking || !!l.test !== !!test || String(l.day || '') < since) return;
    const k = poKey(l.reference);
    if (!k) return;
    if (l.from_po) real.add(k);
    if (!byPo.has(k)) byPo.set(k, new Map());
    const parts = byPo.get(k);
    const p = String(l.part || '');
    if (!parts.has(p)) parts.set(p, new Set());
    parts.get(p).add(`${who}:${l.id}`); // each label record counts, whatever its number
  };
  for (const l of db.shipLabelsForShare(since)) take(l, '');
  if (on()) for (const l of farLabels.values()) take(l, l.station);
  const out = {};
  for (const [k, parts] of byPo) {
    if (!real.has(k)) continue;
    // labels with no part ('' = Ship tab, or an unsplit order) belong to the whole order
    const loose = parts.get('') ? parts.get('').size : 0;
    let worst = loose;
    for (const [p, set] of parts) if (p) worst = Math.max(worst, set.size + loose);
    if (worst > 1) out[k] = worst;
  }
  return out;
}

module.exports = { configure, publish, refresh, finder, listFar, duplicates, poKey };
