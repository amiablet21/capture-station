'use strict';
// SQLite storage via Electron's built-in node:sqlite (synchronous, like better-sqlite3).
const { app } = require('electron');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let db = null;

function dbPath() {
  return path.join(app.getPath('userData'), 'capture-station.db');
}

function localDay(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function open() {
  if (db) return db;
  fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
  db = new DatabaseSync(dbPath());
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      day TEXT NOT NULL,
      channel TEXT NOT NULL,
      order_number TEXT NOT NULL,
      tracking TEXT NOT NULL DEFAULT '',
      carrier TEXT NOT NULL DEFAULT '',
      serials TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      fail_reason TEXT NOT NULL DEFAULT '',
      synced_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_rows_order ON rows(order_number);
    CREATE INDEX IF NOT EXISTS idx_rows_day ON rows(day);
    CREATE INDEX IF NOT EXISTS idx_rows_status ON rows(status);
    CREATE TABLE IF NOT EXISTS serials (
      serial TEXT NOT NULL,
      row_id INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wfs_shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      items TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      order_number TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      customer TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      items TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS condition_map (
      base_sku TEXT NOT NULL,
      condition TEXT NOT NULL,
      target_sku TEXT NOT NULL,
      PRIMARY KEY (base_sku, condition)
    );
    CREATE INDEX IF NOT EXISTS idx_serials_serial ON serials(serial);
    CREATE INDEX IF NOT EXISTS idx_serials_row ON serials(row_id);
    CREATE TABLE IF NOT EXISTS stock_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      day TEXT NOT NULL,
      sku TEXT NOT NULL,
      location_id TEXT NOT NULL DEFAULT '',
      delta INTEGER,
      level_after INTEGER,
      reason TEXT NOT NULL DEFAULT '',
      change_source TEXT NOT NULL DEFAULT '',
      ref TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      computer TEXT NOT NULL DEFAULT '',
      by TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_stock_log_sku ON stock_log(sku, id);
    CREATE INDEX IF NOT EXISTS idx_stock_log_day ON stock_log(day);
  `);
  // migration: free-text notes per row (serial tracking retired 2026-07-30)
  const cols = db.prepare(`SELECT name FROM pragma_table_info('rows')`).all().map(c => c.name);
  if (!cols.includes('notes')) {
    db.exec(`ALTER TABLE rows ADD COLUMN notes TEXT NOT NULL DEFAULT ''`);
  }
  // migration: where the row came from ('' = captured by hand,
  // 'linnworks' = auto-imported from open orders)
  if (!cols.includes('origin')) {
    db.exec(`ALTER TABLE rows ADD COLUMN origin TEXT NOT NULL DEFAULT ''`);
  }
  // migration: "shipped different item" substitution intent (internal only)
  if (!cols.includes('sub_sku')) {
    db.exec(`ALTER TABLE rows ADD COLUMN sub_sku TEXT NOT NULL DEFAULT ''`);
    db.exec(`ALTER TABLE rows ADD COLUMN sub_qty INTEGER NOT NULL DEFAULT 0`);
    db.exec(`ALTER TABLE rows ADD COLUMN sub_note TEXT NOT NULL DEFAULT ''`);
  }
  // migration: returns not matched to a Linnworks order (arrival-driven log)
  const retCols = db.prepare(`SELECT name FROM pragma_table_info('returns')`).all().map(c => c.name);
  if (!retCols.includes('unmatched')) {
    db.exec(`ALTER TABLE returns ADD COLUMN unmatched INTEGER NOT NULL DEFAULT 0`);
  }
  // migration: returns worksheet columns (outbound tracking, receiver initials)
  if (!retCols.includes('tracking')) {
    db.exec(`ALTER TABLE returns ADD COLUMN tracking TEXT NOT NULL DEFAULT ''`);
  }
  if (!retCols.includes('received_by')) {
    db.exec(`ALTER TABLE returns ADD COLUMN received_by TEXT NOT NULL DEFAULT ''`);
  }
  // migration: which listed line a substitution replaces ('' = the whole
  // order, the pre-multi-line behavior kept for old rows)
  if (!cols.includes('sub_for')) {
    db.exec(`ALTER TABLE rows ADD COLUMN sub_for TEXT NOT NULL DEFAULT ''`);
  }
  // migration: item snapshot [{sku, qty}] taken while the order was open,
  // so completed rows keep showing what was in them after the live order
  // metadata disappears from the open-order book
  if (!cols.includes('items')) {
    db.exec(`ALTER TABLE rows ADD COLUMN items TEXT NOT NULL DEFAULT '[]'`);
  }
  // migration: Linnworks order id, so SPLIT orders (the fulfillment network
  // splits one marketplace order across locations, 2026-08-07) get one row
  // per part — same order_number, different lw_order_id
  if (!cols.includes('lw_order_id')) {
    db.exec(`ALTER TABLE rows ADD COLUMN lw_order_id TEXT NOT NULL DEFAULT ''`);
  }
  // migration (2026-09-23): every stock_log row carries a unique gid so
  // merges from the shared folder and the bulk-import history are
  // insert-if-absent — the same change can never land twice
  const slCols = db.prepare(`SELECT name FROM pragma_table_info('stock_log')`).all().map(c => c.name);
  if (!slCols.includes('gid')) {
    db.exec(`ALTER TABLE stock_log ADD COLUMN gid TEXT NOT NULL DEFAULT ''`);
    const host = String(os.hostname() || 'local').toUpperCase();
    db.exec(`UPDATE stock_log SET gid = 'legacy:' || '${host.replace(/'/g, '')}' || ':' || id WHERE gid = ''`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_log_gid ON stock_log(gid)`);
  // migration (2026-09-23): corrections. A line is never rewritten — an edit
  // or a delete is a NEW line that points at the original (link_kind +
  // link_gid) and carries what it changed / applied as JSON (data).
  const slCols2 = db.prepare(`SELECT name FROM pragma_table_info('stock_log')`).all().map(c => c.name);
  if (!slCols2.includes('link_kind')) {
    db.exec(`ALTER TABLE stock_log ADD COLUMN link_kind TEXT NOT NULL DEFAULT ''`);
    db.exec(`ALTER TABLE stock_log ADD COLUMN link_gid TEXT NOT NULL DEFAULT ''`);
    db.exec(`ALTER TABLE stock_log ADD COLUMN data TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_log_link ON stock_log(link_gid)`);
  // migration: WFS shipments carry a received date (Overview marks them
  // received by hand until a Walmart connection can say so itself)
  const wfsCols = db.prepare(`SELECT name FROM pragma_table_info('wfs_shipments')`).all().map(c => c.name);
  if (!wfsCols.includes('received_at')) {
    db.exec(`ALTER TABLE wfs_shipments ADD COLUMN received_at TEXT NOT NULL DEFAULT ''`);
  }
  // Overview "Ignore" on a Send-to-WFS suggestion: hidden until `until`,
  // or sooner if the SKU's WFS pace outgrows the pace it was ignored at
  db.exec(`
    CREATE TABLE IF NOT EXISTS wfs_ignores (
      sku TEXT PRIMARY KEY,
      until TEXT NOT NULL,
      pace REAL NOT NULL DEFAULT 0
    );
  `);
  return db;
}

function parseRow(r) {
  if (!r) return null;
  let items = [];
  try { items = JSON.parse(r.items || '[]'); } catch { /* pre-migration row */ }
  return { ...r, serials: JSON.parse(r.serials), items };
}

// One-time repair for the 2026-08-04 corruption: while the rows table's
// B-tree was damaged ("rowid out of order"), the importer's duplicate check
// could not see existing rows and created second copies of open orders.
// Keeps the richest copy of each order number and drops the redundant ones —
// but never a copy carrying tracking the kept row lacks (that would be a real
// conflict, so both stay and get reported).
function dedupeOrderRows() {
  const d = open();
  const groups = d.prepare('SELECT order_number FROM rows GROUP BY order_number HAVING COUNT(*) > 1').all();
  let removed = 0;
  let conflicts = 0;
  const score = (r) => (r.tracking ? 8 : 0) + (r.status === 'synced' ? 4 : 0) + (r.notes ? 2 : 0);
  for (const g of groups) {
    const rows = d.prepare('SELECT * FROM rows WHERE order_number = ? ORDER BY id').all(g.order_number);
    const keep = rows.slice().sort((a, b) => score(b) - score(a) || b.id - a.id)[0];
    for (const r of rows) {
      if (r.id === keep.id) continue;
      // SPLIT parts legitimately share an order number: different Linnworks
      // order ids are different orders, never duplicates
      if (r.lw_order_id && keep.lw_order_id && r.lw_order_id !== keep.lw_order_id) continue;
      if (r.tracking && r.tracking !== keep.tracking) { conflicts++; continue; }
      d.prepare('DELETE FROM rows WHERE id = ?').run(r.id);
      removed++;
    }
  }
  return { removed, conflicts };
}

/* ---------- Overview tab: order aggregates (captured rows = orders) ---------- */

// today's orders per channel + yesterday's total (the delta headline)
function overviewToday() {
  const today = localDay();
  const yday = localDay(new Date(Date.now() - 86400000));
  const by = open().prepare(
    'SELECT channel, COUNT(*) AS n FROM rows WHERE day = ? GROUP BY channel'
  ).all(today);
  const yesterday = open().prepare('SELECT COUNT(*) AS n FROM rows WHERE day = ?').get(yday);
  const byChannel = {};
  let total = 0;
  for (const r of by) { byChannel[String(r.channel).toLowerCase()] = Number(r.n); total += Number(r.n); }
  return { total, byChannel, yesterday: Number((yesterday && yesterday.n) || 0) };
}

// Day: cumulative orders today per hour (8am -> now)
function overviewSeriesDay() {
  const today = localDay();
  const rows = open().prepare('SELECT created_at FROM rows WHERE day = ?').all(today);
  const nowH = new Date().getHours();
  const endH = Math.max(9, Math.min(23, nowH)); // at least one step past 8am
  const perHour = {};
  for (const r of rows) {
    const h = new Date(r.created_at).getHours();
    perHour[h] = (perHour[h] || 0) + 1;
  }
  const vals = [];
  const tips = [];
  let run = 0;
  for (let h = 0; h <= endH; h++) {
    run += perHour[h] || 0;
    if (h < 8) continue; // pre-8am orders roll into the first point
    vals.push(run);
    tips.push(h === nowH ? 'now' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`);
  }
  return { vals, tips };
}

// Month: orders per local day, last 30 days (oldest first)
function overviewSeriesMonth() {
  const days = [];
  for (let i = 29; i >= 0; i--) days.push(localDay(new Date(Date.now() - i * 86400000)));
  const got = new Map(open().prepare(
    `SELECT day, COUNT(*) AS n FROM rows WHERE day >= ? GROUP BY day`
  ).all(days[0]).map(r => [r.day, Number(r.n)]));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return {
    vals: days.map(d => got.get(d) || 0),
    tips: days.map((d, i) => i === 29 ? 'Today' : `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}`),
  };
}

// Year: orders per month, last 12 (oldest first)
function overviewSeriesYear() {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const got = new Map(open().prepare(
    `SELECT substr(day, 1, 7) AS m, COUNT(*) AS n FROM rows WHERE day >= ? GROUP BY m`
  ).all(months[0] + '-01').map(r => [r.m, Number(r.n)]));
  return {
    vals: months.map(m => got.get(m) || 0),
    tips: months.map(m => `${MON[Number(m.slice(5)) - 1]} '${m.slice(2, 4)}`),
  };
}

// one-click cleanup of rows whose orders left Linnworks' open book: only
// the specific retriable failure is touched, other failures stay visible
function clearFailedNotFound() {
  const res = open().prepare(
    "DELETE FROM rows WHERE status = 'failed' AND fail_reason LIKE 'Not found in open orders%'"
  ).run();
  return Number(res.changes) || 0;
}

// snapshot of the order's item lines, kept forever on the row
function setRowItems(id, items) {
  const clean = (Array.isArray(items) ? items : [])
    .map(i => ({ sku: String(i.sku || '').slice(0, 120), qty: Number(i.qty) || 1 }))
    .filter(i => i.sku);
  open().prepare('UPDATE rows SET items = ? WHERE id = ?').run(JSON.stringify(clean), id);
}

function createRow({ channel, orderNumber, origin, lwOrderId }) {
  const now = new Date();
  const res = open().prepare(
    'INSERT INTO rows (created_at, day, channel, order_number, origin, lw_order_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(now.toISOString(), localDay(now), channel, orderNumber, origin || '', lwOrderId || '');
  return getRow(Number(res.lastInsertRowid));
}

// every row for a PO#, oldest first (split parts share an order number)
function rowsByOrderNumber(orderNumber) {
  return open().prepare('SELECT * FROM rows WHERE order_number = ? ORDER BY id')
    .all(orderNumber).map(parseRow);
}

// split-order support: one row per Linnworks order PART
function findByOrderAndPart(orderNumber, lwOrderId) {
  return parseRow(open().prepare(
    'SELECT * FROM rows WHERE order_number = ? AND lw_order_id = ? ORDER BY id DESC'
  ).get(orderNumber, String(lwOrderId || '')));
}

function setRowPart(id, lwOrderId) {
  open().prepare('UPDATE rows SET lw_order_id = ? WHERE id = ?').run(String(lwOrderId || ''), id);
  return getRow(id);
}

// Auto-imported rows the user never touched: safe to remove when their order
// leaves Linnworks' open orders (cancelled, or processed elsewhere).
function untouchedImportedRows() {
  return open().prepare(
    "SELECT * FROM rows WHERE origin = 'linnworks' AND status = 'pending' AND tracking = '' AND notes = ''"
  ).all().map(parseRow);
}

function getRow(id) {
  return parseRow(open().prepare('SELECT * FROM rows WHERE id = ?').get(id));
}

// the Overview card's live feed: the latest captures, newest first
function overviewRecent(limit) {
  return open().prepare('SELECT id, created_at, channel, order_number, items FROM rows ORDER BY id DESC LIMIT ?')
    .all(limit || 8).map(r => {
      let items = [];
      try { items = JSON.parse(r.items || '[]'); } catch { /* pre-migration row */ }
      return {
        id: r.id,
        at: r.created_at,
        channel: String(r.channel || '').toLowerCase(),
        order: r.order_number,
        sku: items.length ? String(items[0].sku || '') : '',
        more: Math.max(0, items.length - 1),
      };
    });
}

function todayRows() {
  return open().prepare('SELECT * FROM rows WHERE day = ? ORDER BY id DESC')
    .all(localDay()).map(parseRow);
}

// Work queue for sync mode: everything not yet pushed to Linnworks, any day,
// so unprocessed captures from yesterday stay visible until they are dealt with.
function activeRows() {
  return open().prepare("SELECT * FROM rows WHERE status != 'synced' ORDER BY id DESC")
    .all().map(parseRow);
}

// History shows completed work only: orders actually processed to Linnworks.
// Unprocessed captures live in the active list until they are dealt with.
function historyRows(limit = 1000) {
  return open().prepare("SELECT * FROM rows WHERE status = 'synced' ORDER BY id DESC LIMIT ?")
    .all(limit).map(parseRow);
}

// processed orders captured between two local days (inclusive), newest
// first — the Capture page's History view
function historyRowsRange(from, to, limit = 3000) {
  return open().prepare("SELECT * FROM rows WHERE status = 'synced' AND day >= ? AND day <= ? ORDER BY id DESC LIMIT ?")
    .all(String(from || '0000-00-00'), String(to || '9999-99-99'), limit).map(parseRow);
}

function findByOrderNumber(orderNumber) {
  return parseRow(open().prepare('SELECT * FROM rows WHERE order_number = ? ORDER BY id DESC').get(orderNumber));
}

// Copy-mistake guard: a capture whose number is a fragment of an existing one
// (or vice versa) is almost certainly a clipped/overshot Ctrl+C, not a new order.
// Real marketplace numbers are equal length and never contain each other.
function findSimilarOrder(orderNumber) {
  const s = String(orderNumber);
  if (s.length < 10) return null;
  return parseRow(open().prepare(
    `SELECT * FROM rows
     WHERE order_number != ? AND length(order_number) >= 10
       AND (instr(order_number, ?) > 0 OR instr(?, order_number) > 0)
     ORDER BY id DESC`
  ).get(s, s, s));
}

// Recompute pending/captured after any data change; never demote synced/failed here.
// A row is complete once it has tracking (serial tracking retired).
function refreshStatus(id) {
  const row = getRow(id);
  if (!row) return null;
  if (row.status === 'pending' || row.status === 'captured') {
    const status = row.tracking ? 'captured' : 'pending';
    if (status !== row.status) {
      open().prepare('UPDATE rows SET status = ? WHERE id = ?').run(status, id);
    }
  }
  return getRow(id);
}

function setTracking(id, tracking, carrier) {
  open().prepare('UPDATE rows SET tracking = ?, carrier = ? WHERE id = ?').run(tracking, carrier || '', id);
  return refreshStatus(id);
}

function updateRow(id, fields) {
  const row = getRow(id);
  if (!row) return null;
  const d = open();
  const orderNumber = fields.order_number ?? row.order_number;
  const channel = fields.channel ?? row.channel;
  const tracking = fields.tracking ?? row.tracking;
  const carrier = fields.carrier ?? row.carrier;
  const notes = fields.notes ?? row.notes ?? '';
  d.prepare('UPDATE rows SET order_number = ?, channel = ?, tracking = ?, carrier = ?, notes = ? WHERE id = ?')
    .run(orderNumber, channel, tracking, carrier, notes, id);
  // Re-queue for sync only when a sync-relevant field changed. A notes-only edit
  // keeps the current status: a synced order is no longer open in Linnworks, so
  // re-sending it could only fail.
  const material = orderNumber !== row.order_number || channel !== row.channel
    || tracking !== row.tracking || carrier !== row.carrier;
  if (material) {
    const status = tracking ? 'captured' : 'pending';
    d.prepare("UPDATE rows SET status = ?, fail_reason = '' WHERE id = ?").run(status, id);
  }
  return getRow(id);
}

function deleteRow(id) {
  const d = open();
  d.prepare('DELETE FROM serials WHERE row_id = ?').run(id);
  d.prepare('DELETE FROM rows WHERE id = ?').run(id);
}

// Substitution intent: what actually shipped instead of the listed item.
// Stored on the row, applied to stock at process time; internal only
// (visible in Notes/CSV/history, never sent to Linnworks as an order note).
function setSubstitution(id, sku, qty, note, subFor) {
  open().prepare('UPDATE rows SET sub_sku = ?, sub_qty = ?, sub_note = ?, sub_for = ? WHERE id = ?')
    .run(sku || '', Number(qty) || 0, note || '', subFor || '', id);
  return getRow(id);
}

function markSynced(id) {
  open().prepare("UPDATE rows SET status = 'synced', fail_reason = '', synced_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

function markFailed(id, reason) {
  open().prepare("UPDATE rows SET status = 'failed', fail_reason = ? WHERE id = ?")
    .run(String(reason).slice(0, 500), id);
}

// Rows eligible for sync: complete captures plus prior failures (auto-retry).
function rowsToSync() {
  return open().prepare("SELECT * FROM rows WHERE status IN ('captured','failed') ORDER BY id ASC")
    .all().map(parseRow);
}

// Internal log of inventory shipped from the warehouse to Walmart WFS.
// items: [{ sku, gtin, qty }]
function createWfsShipment({ note, items }) {
  const res = open().prepare('INSERT INTO wfs_shipments (created_at, note, items) VALUES (?, ?, ?)')
    .run(new Date().toISOString(), note || '', JSON.stringify(items || []));
  return Number(res.lastInsertRowid);
}

function listWfsShipments(limit = 200) {
  return open().prepare('SELECT * FROM wfs_shipments ORDER BY id DESC LIMIT ?').all(limit)
    .map(s => ({ ...s, items: JSON.parse(s.items) }));
}

function markWfsReceived(id, received) {
  open().prepare('UPDATE wfs_shipments SET received_at = ? WHERE id = ?')
    .run(received ? new Date().toISOString() : '', id);
}

function setWfsIgnore(sku, days, pace) {
  const until = new Date(Date.now() + days * 86400000).toISOString();
  open().prepare('INSERT INTO wfs_ignores (sku, until, pace) VALUES (?, ?, ?) ON CONFLICT(sku) DO UPDATE SET until = excluded.until, pace = excluded.pace')
    .run(String(sku).toUpperCase(), until, Number(pace) || 0);
}

// sku omitted = restore every ignored suggestion
function clearWfsIgnore(sku) {
  if (sku) open().prepare('DELETE FROM wfs_ignores WHERE sku = ?').run(String(sku).toUpperCase());
  else open().prepare("DELETE FROM wfs_ignores WHERE sku NOT LIKE 'LOW:%'").run(); // Running low ignores stay
}

// Running low ignores live in the same table under a LOW: prefix
function clearIgnoresByPrefix(prefix) {
  open().prepare('DELETE FROM wfs_ignores WHERE sku LIKE ?').run(`${String(prefix).toUpperCase()}%`);
}

function listWfsIgnores() {
  const now = new Date().toISOString();
  open().prepare('DELETE FROM wfs_ignores WHERE until <= ?').run(now);
  return open().prepare('SELECT * FROM wfs_ignores').all();
}

// Graded customer returns. items: [{ sku, condition, targetSku, qty, price, note }]
// unmatched = physically arrived without a Linnworks order behind it
// (pre-Linnworks sale, WFS removal shipment, missing PO#).
function createReturn({ orderNumber, source, customer, note, items, unmatched, tracking, receivedBy, createdAt }) {
  const res = open().prepare(
    'INSERT INTO returns (created_at, order_number, source, customer, note, items, unmatched, tracking, received_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(createdAt || new Date().toISOString(), orderNumber, source || '', customer || '', note || '', JSON.stringify(items || []), unmatched ? 1 : 0, tracking || '', receivedBy || '');
  return Number(res.lastInsertRowid);
}

function listReturns(limit = 200) {
  return open().prepare('SELECT * FROM returns ORDER BY id DESC LIMIT ?').all(limit)
    .map(r => ({ ...r, items: JSON.parse(r.items), unmatched: !!r.unmatched }));
}

function getReturn(id) {
  const r = open().prepare('SELECT * FROM returns WHERE id = ?').get(id);
  return r ? { ...r, items: JSON.parse(r.items), unmatched: !!r.unmatched } : null;
}

// full-record update used by the log's inline edit; created_at accepts a
// replacement ISO string so the received DATE is editable while the time
// part of the original stamp is preserved by the caller
function saveReturn(id, { orderNumber, createdAt, customer, tracking, note, items, unmatched, receivedBy }) {
  open().prepare(
    'UPDATE returns SET order_number = ?, created_at = ?, customer = ?, tracking = ?, note = ?, items = ?, unmatched = ?, received_by = ? WHERE id = ?'
  ).run(orderNumber, createdAt, customer || '', tracking || '', note || '', JSON.stringify(items || []), unmatched ? 1 : 0, receivedBy || '', id);
  return getReturn(id);
}

function deleteReturn(id) {
  open().prepare('DELETE FROM returns WHERE id = ?').run(id);
}

// Remembered condition -> listing mappings (one-time picks in the Returns UI,
// or edits made in the Mappings dialog).
function getConditionMap() {
  const out = {};
  for (const row of open().prepare('SELECT * FROM condition_map').all()) {
    (out[row.base_sku] = out[row.base_sku] || {})[row.condition] = row.target_sku;
  }
  return out;
}

function saveConditionMapping(baseSku, condition, targetSku) {
  open().prepare(
    'INSERT INTO condition_map (base_sku, condition, target_sku) VALUES (?, ?, ?) ' +
    'ON CONFLICT(base_sku, condition) DO UPDATE SET target_sku = excluded.target_sku'
  ).run(baseSku, condition, targetSku);
}

// Removing a manual pick falls back to auto-derivation everywhere.
function deleteConditionMapping(baseSku, condition) {
  open().prepare('DELETE FROM condition_map WHERE base_sku = ? AND condition = ?').run(baseSku, condition);
}

// The single condition-mapping engine: manual picks (condition_map) beat
// auto-derivation from the -OPENBOX / -USED / -SCRAP listing convention.
// Pure given an inventory SKU list, so it is testable offline.
const CONDITION_SUFFIX = { openbox: '-OPENBOX', used: '-USED', scrap: '-SCRAP' };
// preferred naming since 2026-08-06: prefix listings (OPEN-BOX-<SKU> …);
// suffix names keep auto-deriving so existing listings never unmap
const CONDITION_PREFIX = { openbox: 'OPEN-BOX-', used: 'USED-', scrap: 'SCRAP-' };

// The condition a SKU's own NAME carries (OPEN-BOX-X = openbox), plus the
// core sku with that affix stripped. null = a plain sold SKU.
function conditionOfSku(sku) {
  const s = String(sku || '');
  const up = s.toUpperCase();
  for (const [cond, pre] of Object.entries(CONDITION_PREFIX)) {
    if (up.startsWith(pre) && up.length > pre.length) return { cond, core: s.slice(pre.length) };
  }
  for (const [cond, suf] of Object.entries(CONDITION_SUFFIX)) {
    if (up.endsWith(suf) && up.length > suf.length) return { cond, core: s.slice(0, s.length - suf.length) };
  }
  return null;
}

function resolveConditionTargets(baseSku, inventorySkus) {
  const bySkuUpper = new Map((inventorySkus || []).map(s => [String(s).toUpperCase(), s]));
  const saved = getConditionMap()[baseSku] || {};
  // a base that IS already a condition listing: its own condition lands
  // back on itself, and the other grades derive from the CORE sku —
  // deriving OPEN-BOX-OPEN-BOX-X133… made no sense (owner 2026-09-09,
  // an open-box listing's return graded open box refused to save)
  const own = conditionOfSku(baseSku);
  const core = own ? own.core : baseSku;
  const savedCore = own ? (getConditionMap()[core] || {}) : {};
  // a saved mapping whose target left the inventory (renamed / deleted) is
  // DEAD — trusting it 400s every stock move (owner-hit 2026-09-21). When
  // the inventory list is at hand, a dead mapping falls through to the
  // name-derived listings; with no list (lookup offline) it stands as-is.
  const alive = (t) => t && (!bySkuUpper.size || bySkuUpper.has(String(t).toUpperCase())) ? t : '';
  const targets = { new: baseSku };
  for (const cond of Object.keys(CONDITION_SUFFIX)) {
    targets[cond] = alive(saved[cond])
      || (own && cond === own.cond ? baseSku : '')
      || alive(savedCore[cond])
      || bySkuUpper.get(`${CONDITION_PREFIX[cond]}${core}`.toUpperCase())
      || bySkuUpper.get(`${core}${CONDITION_SUFFIX[cond]}`.toUpperCase())
      || '';
  }
  return targets;
}

// Low-stock alerting: which SKUs CROSSED below their minimum since the last
// check. Pure, so it is testable offline: items = [{ sku, title, available,
// min }], prevBelow = { sku: true } (the persisted latch). A SKU alerts once
// per crossing; recovering to >= min drops it from `below`, re-arming it.
// min <= 0 means "no minimum set" and never alerts.
/* ---------- stock history ---------- */
// One row per SKU per level write the app made (owner 2026-09-23: "whenever
// someone changes stock, receives a return… I can see what happened, and
// which computer did it"). Logging starts the day this ships; earlier moves
// live only in Linnworks' own audit.
// null / '' / non-numbers stay null (Number(null) is 0, which once turned a
// hand-set count into a "+0" line)
function intOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
// Inserts one row per change. Every row carries a unique gid; a row whose
// gid already exists is skipped (never doubled). Returns the rows actually
// inserted, in the exact shape the shared-folder file carries.
function logStockChanges(rows) {
  const d = open();
  const ins = d.prepare(`INSERT OR IGNORE INTO stock_log (gid, created_at, day, sku, location_id, delta, level_after, reason, change_source, ref, note, computer, by, link_kind, link_gid, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const inserted = [];
  for (const r of rows) {
    if (!r || !r.sku) continue;
    const at = r.createdAt && !Number.isNaN(Date.parse(r.createdAt)) ? new Date(r.createdAt) : new Date();
    const row = {
      gid: String(r.gid || '').trim() || `${String(os.hostname() || 'local').toUpperCase()}:${crypto.randomUUID()}`,
      created_at: at.toISOString(), day: localDay(at), sku: String(r.sku).toUpperCase(),
      location_id: String(r.locationId || r.location_id || ''),
      delta: intOrNull(r.delta), // null = a hand-set count, not a move
      level_after: intOrNull(r.levelAfter ?? r.level_after),
      reason: String(r.reason || ''), change_source: String(r.changeSource || r.change_source || '').slice(0, 120),
      ref: String(r.ref || '').slice(0, 80), note: String(r.note || '').slice(0, 300),
      computer: String(r.computer || '').slice(0, 80), by: String(r.by || '').slice(0, 60),
      link_kind: String(r.link_kind || r.linkKind || ''), link_gid: String(r.link_gid || r.linkGid || ''),
      data: typeof r.data === 'string' ? r.data : (r.data ? JSON.stringify(r.data) : ''),
    };
    const res = ins.run(row.gid, row.created_at, row.day, row.sku, row.location_id, row.delta, row.level_after,
      row.reason, row.change_source, row.ref, row.note, row.computer, row.by, row.link_kind, row.link_gid, row.data);
    if (res.changes > 0) inserted.push(row);
  }
  return inserted;
}

// The bulk-import dialog's history entries (add / set / edit / revert /
// fix), as stock_log rows. Pure: the gid is bulk:<entry id>:<line>, so
// importing the same entry twice, on any computer, yields one row.
function stockRowsFromBulkEntry(e) {
  if (!e || !e.id || !Array.isArray(e.rows)) return [];
  const out = [];
  e.rows.forEach((r, i) => {
    if (!r || !r.sku) return;
    const before = r.before == null ? null : Number(r.before);
    const after = r.after == null ? null : Number(r.after);
    const base = { gid: `bulk:${e.id}:${i}`, createdAt: e.ts, sku: r.sku, computer: e.station || '', note: String(e.note || '') };
    if (e.mode === 'add') {
      const qty = Number(r.qty) || (after !== null && before !== null ? after - before : 0);
      out.push({ ...base, delta: qty, levelAfter: after, reason: 'bulk-add', changeSource: 'Capture Station bulk import (received)' });
    } else if (e.mode === 'set' || e.mode === 'edit') {
      if (after === null) return;
      out.push({ ...base, delta: null, levelAfter: after, reason: e.mode === 'edit' ? 'set' : 'bulk-set',
        changeSource: e.mode === 'edit' ? 'Capture Station stock page' : 'Capture Station bulk import (correction)',
        note: [before === null ? '' : `was ${before}`, base.note].filter(Boolean).join(' · ') });
    } else if (e.mode === 'revert' || e.mode === 'fix') {
      const delta = Number(r.qty);
      if (!Number.isFinite(delta) || delta === 0) return;
      out.push({ ...base, delta, levelAfter: after, reason: e.mode === 'revert' ? 'revert' : 'correction',
        changeSource: e.mode === 'revert' ? 'Capture Station revert' : 'Capture Station history correction (wrong SKU)',
        note: e.mode === 'fix' ? 'moved to the right SKU' : 'reverted an earlier change' });
    }
  });
  return out;
}

// rows already in the local log that this computer made (for seeding its
// shared-folder file); bulk-derived rows stay out — every computer derives
// those itself from the bulk history that already syncs
// names compare in the station form, so rows written before the computer
// name was normalized ("Imran MacBook Pro") still count as this computer's
const pcKey = (s) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
function stockLogOwnRows(computers) {
  const names = new Set((computers || []).map(pcKey).filter(Boolean));
  return open().prepare(`SELECT * FROM stock_log WHERE gid NOT LIKE 'bulk:%' ORDER BY id ASC`).all()
    .filter(r => names.has(pcKey(r.computer)));
}

function stockHistory(sku, limit = 500) {
  return open().prepare(`SELECT * FROM stock_log WHERE sku = ? ORDER BY id DESC LIMIT ?`)
    .all(String(sku || '').toUpperCase(), limit);
}

/* ---------- corrections: edit / delete a history line ---------- */

function stockLogGet(gid) {
  return open().prepare(`SELECT * FROM stock_log WHERE gid = ?`).get(String(gid || '')) || null;
}

// every correction line, keyed by the line it points at (children) — the
// whole set is small, and it is what turns "corrected" / "deleted" marks on
function stockLogLinkMap() {
  const map = new Map();
  for (const r of open().prepare(`SELECT * FROM stock_log WHERE link_gid != '' ORDER BY id ASC`).all()) {
    if (!map.has(r.link_gid)) map.set(r.link_gid, []);
    map.get(r.link_gid).push(r);
  }
  return map;
}

function parseData(r) { try { return r && r.data ? JSON.parse(r.data) : {}; } catch { return {}; } }

// The line as it stands after its corrections: sku / qty (units, or the
// count for a hand-set line) / deleted. A correction that was itself
// deleted no longer counts.
function stockLogEffective(original, linkMap) {
  const isSet = original.delta === null || original.delta === undefined;
  const eff = { sku: original.sku, qty: isSet ? Number(original.level_after) : Math.abs(Number(original.delta) || 0), sign: isSet ? 0 : (Number(original.delta) >= 0 ? 1 : -1), isSet, deleted: false, corrected: false };
  for (const l of (linkMap.get(original.gid) || [])) {
    if ((linkMap.get(l.gid) || []).some(x => x.link_kind === 'delete')) continue; // that correction was undone
    if (l.link_kind === 'delete') { eff.deleted = true; continue; }
    if (l.link_kind === 'edit') {
      const d = parseData(l);
      if (d.toSku) eff.sku = String(d.toSku).toUpperCase();
      if (Number.isFinite(Number(d.toQty))) eff.qty = Number(d.toQty);
      eff.corrected = true;
    }
  }
  return eff;
}

// rows for the renderer: each original carries its live marks, each
// correction carries a pointer back to what it changed
function annotateStockRows(rows) {
  const linkMap = stockLogLinkMap();
  const byGid = new Map();
  const need = new Set(rows.filter(r => r.link_gid).map(r => r.link_gid));
  for (const g of need) if (!byGid.has(g)) byGid.set(g, stockLogGet(g));
  return rows.map(r => {
    const eff = stockLogEffective(r, linkMap);
    const out = { ...r, dataObj: parseData(r), eff };
    if (r.link_gid) {
      const t = byGid.get(r.link_gid);
      out.target = t ? { gid: t.gid, day: t.day, computer: t.computer, sku: t.sku, reason: t.reason } : null;
    }
    const kids = (linkMap.get(r.gid) || []).filter(l => !(linkMap.get(l.gid) || []).some(x => x.link_kind === 'delete'));
    out.marks = kids.map(l => ({ gid: l.gid, kind: l.link_kind, day: l.day, computer: l.computer, created_at: l.created_at }));
    return out;
  });
}

// rule 1 (owner 2026-09-23): a hand-set count after the line makes the
// count authoritative — a later correction of that line fixes the record
// only, never the stock
function stockLogLaterSet(sku, afterIso) {
  const linkMap = stockLogLinkMap();
  const rows = open().prepare(`SELECT * FROM stock_log WHERE sku = ? AND delta IS NULL AND link_kind = '' AND created_at > ? ORDER BY id ASC`)
    .all(String(sku || '').toUpperCase(), String(afterIso || ''));
  return rows.find(r => !stockLogEffective(r, linkMap).deleted) || null;
}

// lines the app made that a person may correct here; returns / shipments /
// sales are corrected where they live
const STOCK_LOG_EDITABLE = new Set(['bulk-add', 'bulk-set', 'set', 'new-sku', 'revert', 'correction', 'other', 'dropship', 'substitution']);
const STOCK_LOG_LINK_REASONS = new Set(['edit-qty', 'edit-sku', 'deleted']);

// Pure: what a correction would do. original = the line, linkMap = every
// correction line, change = { del: true } | { qty, sku }, levelOf(sku) =
// the live count or null, laterSet(sku, afterIso) = the hand-set line that
// makes the count authoritative, or null. Never touches anything.
function planStockCorrection({ original, linkMap, change, levelOf, laterSet }) {
  if (!original) return { ok: false, error: 'That history line no longer exists.' };
  const isLink = STOCK_LOG_LINK_REASONS.has(original.reason) || !!original.link_gid;
  if (!isLink && !STOCK_LOG_EDITABLE.has(original.reason)) {
    const where = original.reason === 'return' || original.reason === 'return-edit' || original.reason === 'return-delete' ? 'Returns'
      : original.reason === 'wfs' ? 'WFS Shipments' : original.reason === 'sale' ? 'the marketplace' : 'Linnworks';
    return { ok: false, error: `This line is corrected in ${where}, not here.` };
  }
  const eff = stockLogEffective(original, linkMap);
  if (eff.deleted) return { ok: false, error: 'This line was already deleted.' };
  const del = !!(change && change.del);
  const want = [];
  const data = { kind: del ? 'delete' : 'edit', fromSku: eff.sku, fromQty: eff.qty };
  if (isLink) {
    // a correction line: only deletable, and deleting it reverses exactly what it applied
    if (!del) return { ok: false, error: 'A correction can be deleted, which undoes it — not edited.' };
    for (const a of (parseData(original).applied || [])) want.push({ sku: String(a.sku).toUpperCase(), delta: -(Number(a.delta) || 0) });
  } else if (eff.isSet) {
    // a hand-set count: qty = the count. Deleting needs the count it replaced.
    if (del) {
      const was = /was (\d+)/.exec(original.note || '');
      if (!was) return { ok: false, error: 'This count has no record of what it replaced — set the count by hand instead.' };
      want.push({ sku: eff.sku, delta: Number(was[1]) - eff.qty });
    } else {
      const newQty = Number(change.qty);
      if (!Number.isInteger(newQty) || newQty < 0) return { ok: false, error: 'Enter a whole number of 0 or more.' };
      if (change.sku && String(change.sku).toUpperCase() !== eff.sku) return { ok: false, error: 'A hand-set count keeps its SKU — delete it and set the other SKU instead.' };
      if (newQty === eff.qty) return { ok: false, error: 'No change.' };
      data.toSku = eff.sku; data.toQty = newQty;
      want.push({ sku: eff.sku, delta: newQty - eff.qty });
    }
  } else {
    const D = eff.sign * eff.qty;
    if (del) {
      want.push({ sku: eff.sku, delta: -D });
    } else {
      const newQty = Number(change.qty);
      const newSku = String(change.sku || eff.sku).trim().toUpperCase();
      if (!Number.isInteger(newQty) || newQty < 0) return { ok: false, error: 'Enter a whole number of 0 or more.' };
      if (!newSku) return { ok: false, error: 'Pick a SKU.' };
      if (levelOf(newSku) === null && newSku !== eff.sku) return { ok: false, error: `${newSku} is not in Linnworks — pick a listing that exists.` };
      if (newQty === eff.qty && newSku === eff.sku) return { ok: false, error: 'No change.' };
      data.toSku = newSku; data.toQty = newQty;
      if (newSku === eff.sku) want.push({ sku: eff.sku, delta: eff.sign * (newQty - eff.qty) });
      else { want.push({ sku: eff.sku, delta: -D }); want.push({ sku: newSku, delta: eff.sign * newQty }); }
    }
  }
  // rule 1, then the floor at zero — per SKU
  const applies = [];
  const notes = [];
  for (const w of want) {
    if (!w.delta) continue;
    const later = laterSet(w.sku, original.created_at);
    if (later) {
      applies.push({ sku: w.sku, delta: w.delta, applied: 0, skipped: 'later-set', laterDay: later.day });
      notes.push(`${w.sku}: count was set by hand on ${later.day.slice(5, 7)}/${later.day.slice(8, 10)}, record only`);
      continue;
    }
    const level = levelOf(w.sku);
    let applied = w.delta;
    if (w.delta < 0 && level !== null && level + w.delta < 0) {
      applied = -Math.max(0, level);
      notes.push(`${w.sku}: removed ${Math.abs(applied)} of ${Math.abs(w.delta)}, only ${Math.max(0, level)} on hand`);
    }
    applies.push({ sku: w.sku, delta: w.delta, applied, level });
  }
  data.applied = applies.filter(a => a.applied).map(a => ({ sku: a.sku, delta: a.applied }));
  const recordOnly = applies.length > 0 && applies.every(a => !a.applied);
  const text = applies.length === 0 ? 'No stock change'
    : applies.map(a => a.applied
      ? `${a.applied > 0 ? '+' : '−'}${Math.abs(a.applied)} on ${a.sku}${a.level !== null && a.level !== undefined ? ` (${a.level} → ${a.level + a.applied})` : ''}`
      : `${a.sku}: record only`).join(' · ');
  return { ok: true, del, eff, data, applies, recordOnly, notes, text };
}

// every SKU's changes between two local days (inclusive), newest first —
// the History dialog's Stock tab
function stockHistoryRange(from, to, limit = 3000) {
  return open().prepare(`SELECT * FROM stock_log WHERE day >= ? AND day <= ? ORDER BY id DESC LIMIT ?`)
    .all(String(from || '0000-00-00'), String(to || '9999-99-99'), limit);
}

// today's activity per SKU, for the grid's tray dot and count tooltip:
// { SKU: { count, lastAt, lastDelta, lastReason, lastComputer, lastBy } }
function stockHistoryToday(day = localDay()) {
  const rows = open().prepare(`SELECT sku, created_at, delta, level_after, reason, computer, by FROM stock_log WHERE day = ? ORDER BY id ASC`).all(day);
  const out = {};
  for (const r of rows) {
    const m = out[r.sku] || (out[r.sku] = { count: 0 });
    m.count += 1;
    m.lastAt = r.created_at; m.lastDelta = r.delta; m.lastAfter = r.level_after;
    m.lastReason = r.reason; m.lastComputer = r.computer; m.lastBy = r.by;
  }
  return out;
}

function lowStockCrossings(items, prevBelow) {
  const below = {};
  const crossed = [];
  for (const it of items || []) {
    const min = Number(it.min) || 0;
    if (min <= 0) continue;
    if ((Number(it.available) || 0) >= min) continue;
    below[it.sku] = true;
    if (!prevBelow || !prevBelow[it.sku]) crossed.push(it);
  }
  return { below, crossed };
}

function close() {
  if (db) { try { db.close(); } catch { /* already closed */ } db = null; }
}

// Health check of the LIVE db. quick_check's first row is 'ok' or the first
// problem found; a throw (file unreadable) also counts as unhealthy.
function quickCheck() {
  try {
    const r = open().prepare('PRAGMA quick_check').get();
    const v = r ? String(Object.values(r)[0]) : 'no result';
    return { ok: v === 'ok', detail: v };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

// Same check against an arbitrary file (used to pick a healthy backup),
// read-only so it never creates -wal/-shm next to the backups.
function checkFile(file) {
  try {
    const d = new DatabaseSync(file, { readOnly: true });
    const r = d.prepare('PRAGMA quick_check').get();
    d.close();
    const v = r ? String(Object.values(r)[0]) : 'no result';
    return { ok: v === 'ok', detail: v };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

// Replace the live db with a (healthy) backup. The damaged file is kept
// beside it, and stale WAL/SHM side files are removed so the old state
// cannot bleed back in on the next open.
function restoreFrom(file) {
  close();
  const p = dbPath();
  // side files FIRST: if another process still holds them this throws while
  // the live db is untouched — a half-done restore must never strand it
  for (const ext of ['-wal', '-shm']) fs.rmSync(p + ext, { force: true });
  try { fs.renameSync(p, `${p}.corrupt-${Date.now()}`); } catch { /* nothing to quarantine */ }
  fs.copyFileSync(file, p);
  open();
}

function backup() {
  // never overwrite a good backup with a bad database: check health first,
  // and fold the WAL in so the copy is one self-contained file
  const health = quickCheck();
  try { open().exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* copy still works */ }
  close();
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `capture-station-${localDay()}.db`);
  if (!health.ok) {
    // keep the evidence under a name the restore scan and rotation ignore
    const quarantine = path.join(dir, `capture-station-${localDay()}-corrupt-${Date.now()}.bad`);
    fs.copyFileSync(dbPath(), quarantine);
    return { dest: quarantine, healthy: false, detail: health.detail };
  }
  fs.copyFileSync(dbPath(), dest);
  // keep the newest 14 backups
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 14))) {
    fs.rmSync(path.join(dir, f), { force: true });
  }
  return { dest, healthy: true, detail: 'ok' };
}

module.exports = {
  open, close, backup, dbPath, localDay, quickCheck, checkFile, restoreFrom,
  createRow, getRow, todayRows, activeRows, historyRows, findByOrderNumber, findSimilarOrder,
  setTracking, updateRow, deleteRow, markSynced, markFailed, setSubstitution, setRowItems, clearFailedNotFound, dedupeOrderRows, findByOrderAndPart, setRowPart, rowsByOrderNumber,
  rowsToSync, createWfsShipment, listWfsShipments, markWfsReceived, setWfsIgnore, clearWfsIgnore, clearIgnoresByPrefix, listWfsIgnores, untouchedImportedRows,
  createReturn, listReturns, getReturn, saveReturn, deleteReturn, getConditionMap, saveConditionMapping,
  deleteConditionMapping, resolveConditionTargets, conditionOfSku, CONDITION_SUFFIX,
  lowStockCrossings, logStockChanges, stockHistory, stockHistoryToday, stockHistoryRange, historyRowsRange, stockRowsFromBulkEntry, stockLogOwnRows,
  stockLogGet, stockLogLinkMap, stockLogEffective, annotateStockRows, stockLogLaterSet, planStockCorrection, STOCK_LOG_EDITABLE,
  overviewToday, overviewSeriesDay, overviewSeriesMonth, overviewSeriesYear, overviewRecent,
};
