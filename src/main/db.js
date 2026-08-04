'use strict';
// SQLite storage via Electron's built-in node:sqlite (synchronous, like better-sqlite3).
const { app } = require('electron');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
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
  return db;
}

function parseRow(r) {
  if (!r) return null;
  let items = [];
  try { items = JSON.parse(r.items || '[]'); } catch { /* pre-migration row */ }
  return { ...r, serials: JSON.parse(r.serials), items };
}

// snapshot of the order's item lines, kept forever on the row
function setRowItems(id, items) {
  const clean = (Array.isArray(items) ? items : [])
    .map(i => ({ sku: String(i.sku || '').slice(0, 120), qty: Number(i.qty) || 1 }))
    .filter(i => i.sku);
  open().prepare('UPDATE rows SET items = ? WHERE id = ?').run(JSON.stringify(clean), id);
}

function createRow({ channel, orderNumber, origin }) {
  const now = new Date();
  const res = open().prepare(
    'INSERT INTO rows (created_at, day, channel, order_number, origin) VALUES (?, ?, ?, ?, ?)'
  ).run(now.toISOString(), localDay(now), channel, orderNumber, origin || '');
  return getRow(Number(res.lastInsertRowid));
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

// Graded customer returns. items: [{ sku, condition, targetSku, qty, price, note }]
// unmatched = physically arrived without a Linnworks order behind it
// (pre-Linnworks sale, WFS removal shipment, missing PO#).
function createReturn({ orderNumber, source, customer, note, items, unmatched, tracking, receivedBy }) {
  const res = open().prepare(
    'INSERT INTO returns (created_at, order_number, source, customer, note, items, unmatched, tracking, received_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(new Date().toISOString(), orderNumber, source || '', customer || '', note || '', JSON.stringify(items || []), unmatched ? 1 : 0, tracking || '', receivedBy || '');
  return Number(res.lastInsertRowid);
}

function listReturns(limit = 200) {
  return open().prepare('SELECT * FROM returns ORDER BY id DESC LIMIT ?').all(limit)
    .map(r => ({ ...r, items: JSON.parse(r.items), unmatched: !!r.unmatched }));
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

function resolveConditionTargets(baseSku, inventorySkus) {
  const bySkuUpper = new Map((inventorySkus || []).map(s => [String(s).toUpperCase(), s]));
  const saved = getConditionMap()[baseSku] || {};
  const targets = { new: baseSku };
  for (const [cond, suf] of Object.entries(CONDITION_SUFFIX)) {
    targets[cond] = saved[cond] || bySkuUpper.get(`${baseSku}${suf}`.toUpperCase()) || '';
  }
  return targets;
}

// Low-stock alerting: which SKUs CROSSED below their minimum since the last
// check. Pure, so it is testable offline: items = [{ sku, title, available,
// min }], prevBelow = { sku: true } (the persisted latch). A SKU alerts once
// per crossing; recovering to >= min drops it from `below`, re-arming it.
// min <= 0 means "no minimum set" and never alerts.
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
  setTracking, updateRow, deleteRow, markSynced, markFailed, setSubstitution, setRowItems,
  rowsToSync, createWfsShipment, listWfsShipments, untouchedImportedRows,
  createReturn, listReturns, getConditionMap, saveConditionMapping,
  deleteConditionMapping, resolveConditionTargets, CONDITION_SUFFIX,
  lowStockCrossings,
};
