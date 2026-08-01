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
  return db;
}

function parseRow(r) {
  return r ? { ...r, serials: JSON.parse(r.serials) } : null;
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

function close() {
  if (db) { try { db.close(); } catch { /* already closed */ } db = null; }
}

function backup() {
  close();
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `capture-station-${localDay()}.db`);
  fs.copyFileSync(dbPath(), dest);
  // keep the newest 14 backups
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 14))) {
    fs.rmSync(path.join(dir, f), { force: true });
  }
  return dest;
}

module.exports = {
  open, close, backup, dbPath, localDay,
  createRow, getRow, todayRows, activeRows, historyRows, findByOrderNumber, findSimilarOrder,
  setTracking, updateRow, deleteRow, markSynced, markFailed,
  rowsToSync, createWfsShipment, listWfsShipments, untouchedImportedRows,
};
