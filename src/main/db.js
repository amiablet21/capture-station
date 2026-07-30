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
    CREATE INDEX IF NOT EXISTS idx_serials_serial ON serials(serial);
    CREATE INDEX IF NOT EXISTS idx_serials_row ON serials(row_id);
  `);
  // migration: free-text notes per row (serial tracking retired 2026-07-30)
  const cols = db.prepare(`SELECT name FROM pragma_table_info('rows')`).all().map(c => c.name);
  if (!cols.includes('notes')) {
    db.exec(`ALTER TABLE rows ADD COLUMN notes TEXT NOT NULL DEFAULT ''`);
  }
  return db;
}

function parseRow(r) {
  return r ? { ...r, serials: JSON.parse(r.serials) } : null;
}

function createRow({ channel, orderNumber }) {
  const now = new Date();
  const res = open().prepare(
    'INSERT INTO rows (created_at, day, channel, order_number) VALUES (?, ?, ?, ?)'
  ).run(now.toISOString(), localDay(now), channel, orderNumber);
  return getRow(Number(res.lastInsertRowid));
}

function getRow(id) {
  return parseRow(open().prepare('SELECT * FROM rows WHERE id = ?').get(id));
}

function todayRows() {
  return open().prepare('SELECT * FROM rows WHERE day = ? ORDER BY id DESC')
    .all(localDay()).map(parseRow);
}

function findByOrderNumber(orderNumber) {
  return parseRow(open().prepare('SELECT * FROM rows WHERE order_number = ? ORDER BY id DESC').get(orderNumber));
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
  // any edit re-queues the row for sync (Linnworks writes are idempotent overwrites)
  const status = tracking ? 'captured' : 'pending';
  d.prepare("UPDATE rows SET status = ?, fail_reason = '' WHERE id = ?").run(status, id);
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
  createRow, getRow, todayRows, findByOrderNumber,
  setTracking, updateRow, deleteRow, markSynced, markFailed,
  rowsToSync,
};
