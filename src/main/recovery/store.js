'use strict';
// Recovery storage in capture-station.db (spec docs/recovery/SPEC.md §10.1).
// Runs, their refunds / payouts / ledger rows, the not-received items and
// the manual markers. Markers live in their own table (wm_marks, keyed by
// PO) rather than as columns on wm_items: a marker synced in from another
// desktop can arrive before the run that carries its item, and a decision
// must survive the item being re-imported or pruned (spec §6.1: "known POs
// keep their markers"). Everything derived — status, settlements, days,
// cycles — is computed on read, never stored.
let conn = null;

function ensureSchema(db) {
  conn = db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS wm_runs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      ran_at TEXT NOT NULL,
      csv_name TEXT NOT NULL DEFAULT '',
      csv_hash TEXT NOT NULL DEFAULT '',
      format TEXT NOT NULL DEFAULT '',
      total_refunds INTEGER NOT NULL DEFAULT 0,
      seller_count INTEGER NOT NULL DEFAULT 0,
      wfs_count INTEGER NOT NULL DEFAULT 0,
      log_rows INTEGER NOT NULL DEFAULT 0,
      counts TEXT NOT NULL DEFAULT '{}',
      summary TEXT NOT NULL DEFAULT '{}',
      station TEXT NOT NULL DEFAULT '',
      by TEXT NOT NULL DEFAULT '',
      sync_ts INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_wm_runs_label ON wm_runs(label);
    CREATE TABLE IF NOT EXISTS wm_refunds (
      run_id TEXT NOT NULL,
      po TEXT NOT NULL,
      order_no TEXT NOT NULL DEFAULT '',
      item TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      qty INTEGER NOT NULL DEFAULT 0,
      refund_date TEXT NOT NULL DEFAULT '',
      retail REAL NOT NULL DEFAULT 0,
      net REAL NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      fulfillment TEXT NOT NULL DEFAULT '',
      issues TEXT NOT NULL DEFAULT '',
      wh_count INTEGER NOT NULL DEFAULT 0,
      wh_price REAL,
      wh_condition TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_wm_refunds_run ON wm_refunds(run_id);
    CREATE TABLE IF NOT EXISTS wm_payouts (
      run_id TEXT NOT NULL,
      po TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      date TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_wm_payouts_run ON wm_payouts(run_id);
    CREATE TABLE IF NOT EXISTS wm_ledger (
      run_id TEXT NOT NULL,
      key TEXT NOT NULL DEFAULT '',
      po TEXT NOT NULL DEFAULT '',
      order_no TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      date TEXT,
      amount REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_wm_ledger_run ON wm_ledger(run_id);
    CREATE TABLE IF NOT EXISTS wm_items (
      po TEXT PRIMARY KEY,
      order_no TEXT NOT NULL DEFAULT '',
      item TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      qty INTEGER NOT NULL DEFAULT 0,
      refund_date TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      lost INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'Seller',
      source_run_id TEXT NOT NULL DEFAULT '',
      added_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wm_items_run ON wm_items(source_run_id);
    CREATE TABLE IF NOT EXISTS wm_marks (
      po TEXT PRIMARY KEY,
      case_opened INTEGER NOT NULL DEFAULT 0,
      case_opened_at TEXT,
      case_id TEXT,
      case_approved INTEGER NOT NULL DEFAULT 0,
      case_approved_at TEXT,
      adjustment INTEGER NOT NULL DEFAULT 0,
      adjustment_at TEXT,
      reimburse_pending INTEGER NOT NULL DEFAULT 0,
      reimburse_pending_at TEXT,
      written_off INTEGER NOT NULL DEFAULT 0,
      written_off_at TEXT,
      note TEXT,
      note_at TEXT,
      updated_at TEXT NOT NULL,
      station TEXT NOT NULL DEFAULT '',
      by TEXT NOT NULL DEFAULT '',
      removed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS wm_tombstones (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wm_orders (
      run_id TEXT NOT NULL,
      po TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      item TEXT NOT NULL DEFAULT '',
      fulfillment TEXT NOT NULL DEFAULT '',
      date TEXT,
      sale_units INTEGER NOT NULL DEFAULT 0,
      refund_units INTEGER NOT NULL DEFAULT 0,
      net REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_wm_orders_run ON wm_orders(run_id);
    CREATE TABLE IF NOT EXISTS wm_lines (
      run_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT '',
      desc TEXT NOT NULL DEFAULT '',
      amount_type TEXT NOT NULL DEFAULT '',
      date TEXT,
      amount REAL NOT NULL DEFAULT 0,
      count INTEGER NOT NULL DEFAULT 0,
      pos INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_wm_lines_run ON wm_lines(run_id);
    CREATE TABLE IF NOT EXISTS wm_expenses (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT '',
      station TEXT NOT NULL DEFAULT '',
      by TEXT NOT NULL DEFAULT '',
      removed INTEGER NOT NULL DEFAULT 0
    );
  `);
  // v1.32.13: the goods price and Walmart's commission per order (null on
  // rows imported before, until that period is re-imported)
  for (const col of ['gross REAL', 'commission REAL']) {
    try { db.exec(`ALTER TABLE wm_orders ADD COLUMN ${col}`); } catch { /* already there */ }
  }
  // v1.32.32: the statement's wording for a PO's other lines (fees, reversals)
  try { db.exec('ALTER TABLE wm_orders ADD COLUMN note TEXT'); } catch { /* already there */ }
  // v1.32.20: the two Reconcile marks — received before the Returns log
  // existed (with the day it came back, when known), and never shipped
  for (const col of ['received_manual INTEGER NOT NULL DEFAULT 0', 'received_manual_at TEXT', 'received_on TEXT', 'never_shipped INTEGER NOT NULL DEFAULT 0', 'never_shipped_at TEXT']) {
    try { db.exec(`ALTER TABLE wm_marks ADD COLUMN ${col}`); } catch { /* already there */ }
  }
  // v1.32.57: a payout typed by hand (case approved, insurance, carrier)
  for (const col of ['paid_out REAL NOT NULL DEFAULT 0', 'paid_out_by TEXT', 'paid_out_at TEXT', 'paid_out_on TEXT']) {
    try { db.exec(`ALTER TABLE wm_marks ADD COLUMN ${col}`); } catch { /* already there */ }
  }
  // v1.32.15: who issued the refund, on the stored refund and on the tracker item
  for (const t of ['wm_refunds', 'wm_items']) {
    try { db.exec(`ALTER TABLE ${t} ADD COLUMN refunded_by TEXT NOT NULL DEFAULT ''`); } catch { /* already there */ }
  }
}

const d = () => {
  if (!conn) throw new Error('recovery store not initialised');
  return conn;
};

/* ---------- runs ---------- */

function runOut(r) {
  if (!r) return null;
  let counts = {};
  let summary = {};
  try { counts = JSON.parse(r.counts || '{}'); } catch { /* keep {} */ }
  try { summary = JSON.parse(r.summary || '{}'); } catch { /* keep {} */ }
  return {
    id: r.id, label: r.label, ranAt: r.ran_at, csvName: r.csv_name, csvHash: r.csv_hash, format: r.format,
    totalRefunds: r.total_refunds, sellerCount: r.seller_count, wfsCount: r.wfs_count, logRows: r.log_rows,
    counts, summary, station: r.station, by: r.by, syncTs: r.sync_ts,
  };
}

function listRuns() {
  return d().prepare('SELECT * FROM wm_runs ORDER BY ran_at DESC').all().map(runOut);
}
// the run list without the (large) summary JSON — the state call's shape
function listRunMeta() {
  return d().prepare('SELECT id, label, ran_at, csv_name, csv_hash, format, total_refunds, seller_count, wfs_count, log_rows, counts, station, by, sync_ts FROM wm_runs ORDER BY ran_at DESC').all()
    .map((r) => runOut({ ...r, summary: '{}' }));
}
function getRun(id) {
  return runOut(d().prepare('SELECT * FROM wm_runs WHERE id = ?').get(String(id || '')));
}
function findRunByLabel(label) {
  return runOut(d().prepare('SELECT * FROM wm_runs WHERE label = ?').get(String(label || '')));
}
function findRunByHash(hash) {
  return runOut(d().prepare('SELECT * FROM wm_runs WHERE csv_hash = ?').get(String(hash || '')));
}

// one import's whole payload in one transaction: the run row + its
// refunds, payouts and ledger. Replaces any run with the same id.
function putLinesRows(db, runId, lines) {
  db.prepare('DELETE FROM wm_lines WHERE run_id = ?').run(runId);
  const il = db.prepare('INSERT INTO wm_lines (run_id, type, desc, amount_type, date, amount, count, pos) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const l of lines || []) il.run(runId, String(l.type || ''), String(l.desc || ''), String(l.amountType ?? l.amount_type ?? ''), l.date || null, Number(l.amount) || 0, Number(l.count) || 0, Number(l.pos) || 0);
}
function putLines(runId, lines) { putLinesRows(d(), runId, lines); }
const linesOut = (r) => ({ run_id: r.run_id, type: r.type, desc: r.desc, amountType: r.amount_type, date: r.date, amount: r.amount, count: r.count, pos: r.pos });
function runLines(id) { return d().prepare('SELECT * FROM wm_lines WHERE run_id = ?').all(id).map(linesOut); }
function allLines() { return d().prepare('SELECT * FROM wm_lines').all().map(linesOut); }
function runsWithoutNotes() {
  return d().prepare('SELECT id, label FROM wm_runs WHERE id IN (SELECT DISTINCT run_id FROM wm_orders) AND id NOT IN (SELECT DISTINCT run_id FROM wm_orders WHERE note IS NOT NULL)').all();
}
function runsWithoutLines() {
  return d().prepare('SELECT id, label FROM wm_runs WHERE id NOT IN (SELECT DISTINCT run_id FROM wm_lines)').all();
}
// the owner's own expenses outside Walmart (owner 2026-10-13: outside
// shipping labels, packing…): one row each, newest write wins, synced
// through the shared folder like marks; a removal is a tombstoned row
const expenseOut = (r) => (r ? { id: r.id, date: r.date, category: r.category, note: r.note, sku: r.sku, amount: Number(r.amount) || 0, updated_at: r.updated_at, station: r.station, by: r.by, removed: !!r.removed } : null);
function upsertExpense(rec) {
  const db = d();
  const id = String(rec && rec.id || '').trim();
  if (!id) return null;
  const updatedAt = rec.updated_at && !Number.isNaN(Date.parse(rec.updated_at)) ? new Date(rec.updated_at).toISOString() : new Date().toISOString();
  const cur = db.prepare('SELECT updated_at FROM wm_expenses WHERE id = ?').get(id);
  if (cur && String(cur.updated_at) >= updatedAt) return null;
  const row = { id, date: String(rec.date || '').slice(0, 10), category: String(rec.category || ''), note: String(rec.note || ''), sku: String(rec.sku || ''), amount: Math.round((Number(rec.amount) || 0) * 100) / 100, updated_at: updatedAt, station: String(rec.station || ''), by: String(rec.by || ''), removed: rec.removed ? 1 : 0 };
  db.prepare(`INSERT INTO wm_expenses (id, date, category, note, sku, amount, updated_at, station, by, removed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET date = excluded.date, category = excluded.category, note = excluded.note, sku = excluded.sku, amount = excluded.amount, updated_at = excluded.updated_at, station = excluded.station, by = excluded.by, removed = excluded.removed`)
    .run(row.id, row.date, row.category, row.note, row.sku, row.amount, row.updated_at, row.station, row.by, row.removed);
  return expenseOut(row);
}
function getExpense(id) { return expenseOut(d().prepare('SELECT * FROM wm_expenses WHERE id = ?').get(String(id || ''))); }
function allExpenses() { return d().prepare('SELECT * FROM wm_expenses WHERE removed = 0 ORDER BY date DESC, updated_at DESC').all().map(expenseOut); }
function ownExpenses(stations) {
  const set = new Set((stations || []).filter(Boolean).map((s) => String(s).toUpperCase()));
  return d().prepare('SELECT * FROM wm_expenses').all().map(expenseOut).filter((r) => set.has(String(r.station).toUpperCase()));
}
function putRun(run, refunds, payouts, ledger, orders, lines) {
  const db = d();
  const tx = db.prepare('BEGIN');
  tx.run();
  try {
    deleteRunRows(run.id);
    db.prepare(`INSERT INTO wm_runs (id, label, ran_at, csv_name, csv_hash, format, total_refunds, seller_count, wfs_count, log_rows, counts, summary, station, by, sync_ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(run.id, run.label, run.ranAt, run.csvName || '', run.csvHash || '', run.format || '',
        Number(run.totalRefunds) || 0, Number(run.sellerCount) || 0, Number(run.wfsCount) || 0, Number(run.logRows) || 0,
        JSON.stringify(run.counts || {}), JSON.stringify(run.summary || {}), run.station || '', run.by || '', Number(run.syncTs) || 0);
    const ir = db.prepare('INSERT INTO wm_refunds (run_id, po, order_no, item, sku, qty, refund_date, retail, net, reason, fulfillment, issues, wh_count, wh_price, wh_condition, refunded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of refunds || []) {
      ir.run(run.id, String(r.po || ''), String(r.order_no || ''), String(r.item || ''), String(r.sku || ''), Number(r.qty) || 0, String(r.refund_date || ''),
        Number(r.retail) || 0, Number(r.net) || 0, String(r.reason || ''), String(r.fulfillment || ''), String(r.issues || ''),
        Number(r.wh_count) || 0, r.wh_price == null ? null : Number(r.wh_price), String(r.wh_condition || ''), String(r.refunded_by || ''));
    }
    const ip = db.prepare('INSERT INTO wm_payouts (run_id, po, amount, date, kind) VALUES (?, ?, ?, ?, ?)');
    for (const p of payouts || []) ip.run(run.id, String(p.po || ''), Number(p.amount) || 0, String(p.date || ''), String(p.kind || ''));
    const il = db.prepare('INSERT INTO wm_ledger (run_id, key, po, order_no, type, date, amount) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const t of ledger || []) il.run(run.id, String(t.key || ''), String(t.po || ''), String(t.order_no || t.order || ''), String(t.type || ''), t.date || null, Number(t.amount) || 0);
    if (orders) putOrdersRows(db, run.id, orders);
    if (lines) putLinesRows(db, run.id, lines);
    db.prepare('DELETE FROM wm_tombstones WHERE id = ?').run(run.id);
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
}

// the per-order sales of a run (Profit); a run imported before Profit
// existed has none until its archived CSV is re-read
function putOrdersRows(db, runId, orders) {
  db.prepare('DELETE FROM wm_orders WHERE run_id = ?').run(runId);
  const io = db.prepare('INSERT INTO wm_orders (run_id, po, sku, item, fulfillment, date, sale_units, refund_units, net, gross, commission, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  for (const o of orders || []) {
    io.run(runId, String(o.po || ''), String(o.sku || ''), String(o.item || ''), String(o.fulfillment || ''), o.date || null,
      Number(o.saleUnits ?? o.sale_units) || 0, Number(o.refundUnits ?? o.refund_units) || 0, Number(o.netPayable ?? o.net) || 0, num(o.gross), num(o.commission), String(o.note || ''));
  }
}
function putOrders(runId, orders) { putOrdersRows(d(), runId, orders); }
const ordersOut = (r) => ({ run_id: r.run_id, po: r.po, sku: r.sku, item: r.item, fulfillment: r.fulfillment, date: r.date, saleUnits: r.sale_units, refundUnits: r.refund_units, netPayable: r.net, gross: r.gross ?? null, commission: r.commission ?? null, note: r.note || '' });
function runOrders(id) { return d().prepare('SELECT * FROM wm_orders WHERE run_id = ?').all(id).map(ordersOut); }
function allOrders() { return d().prepare('SELECT * FROM wm_orders').all().map(ordersOut); }
function runsWithoutOrders() {
  return d().prepare('SELECT id, label FROM wm_runs WHERE id NOT IN (SELECT DISTINCT run_id FROM wm_orders)').all();
}
// runs whose orders were stored before v1.32.13 (no goods price on any of
// them) — ensureOrders re-reads their archived CSV to fill the price in
function runsWithoutPrices() {
  return d().prepare('SELECT id, label FROM wm_runs WHERE id IN (SELECT DISTINCT run_id FROM wm_orders) AND id NOT IN (SELECT DISTINCT run_id FROM wm_orders WHERE gross > 0)').all();
}

function deleteRunRows(id) {
  const db = d();
  for (const t of ['wm_refunds', 'wm_payouts', 'wm_ledger', 'wm_orders', 'wm_lines']) db.prepare(`DELETE FROM ${t} WHERE run_id = ?`).run(id);
  db.prepare('DELETE FROM wm_items WHERE source_run_id = ?').run(id);
  db.prepare('DELETE FROM wm_runs WHERE id = ?').run(id);
}

// a delete: the run and everything hanging off it; the tombstone keeps a
// late-arriving older copy from the shared folder from resurrecting it
function deleteRun(id, ts = Date.now()) {
  const db = d();
  deleteRunRows(id);
  db.prepare('INSERT INTO wm_tombstones (id, ts) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET ts = MAX(ts, excluded.ts)').run(id, Number(ts) || Date.now());
}
function tombstoneTs(id) {
  const r = d().prepare('SELECT ts FROM wm_tombstones WHERE id = ?').get(id);
  return r ? Number(r.ts) : null;
}

const refundsOut = (r) => ({
  po: r.po, order_no: r.order_no, item: r.item, sku: r.sku, qty: r.qty, refund_date: r.refund_date, retail: r.retail, net: r.net,
  reason: r.reason, fulfillment: r.fulfillment, issues: r.issues, wh_count: r.wh_count, wh_price: r.wh_price, wh_condition: r.wh_condition,
  refunded_by: r.refunded_by || '',
});
// runs whose stored refunds predate refunded_by — ensureOrders fills them
// from the archived CSV
function runsWithoutRefundedBy() {
  return d().prepare("SELECT id, label FROM wm_runs WHERE id IN (SELECT DISTINCT run_id FROM wm_refunds) AND id NOT IN (SELECT DISTINCT run_id FROM wm_refunds WHERE refunded_by != '')").all();
}
function setRefundedBy(runId, byPo) {
  const db = d();
  const up = db.prepare('UPDATE wm_refunds SET refunded_by = ? WHERE run_id = ? AND po = ?');
  const upItem = db.prepare("UPDATE wm_items SET refunded_by = ? WHERE po = ? AND refunded_by = ''");
  for (const [po, by] of Object.entries(byPo || {})) { if (by) { up.run(by, runId, po); upItem.run(by, po); } }
}
// po -> who refunded, for tracker items stored before the column existed
function refundedByMap() {
  const m = {};
  for (const r of d().prepare("SELECT po, refunded_by FROM wm_refunds WHERE refunded_by != ''").all()) m[r.po] = r.refunded_by;
  return m;
}
function runRefunds(id) { return d().prepare('SELECT * FROM wm_refunds WHERE run_id = ?').all(id).map(refundsOut); }
function runPayouts(id) { return d().prepare('SELECT po, amount, date, kind FROM wm_payouts WHERE run_id = ?').all(id); }
function runLedger(id) { return d().prepare('SELECT key, po, order_no, type, date, amount FROM wm_ledger WHERE run_id = ?').all(id); }
function allPayouts() { return d().prepare('SELECT run_id, po, amount, date, kind FROM wm_payouts').all(); }
function allLedger() { return d().prepare('SELECT run_id, key, po, order_no AS "order", type, date, amount FROM wm_ledger').all(); }
// po -> item name across every run's refunds (the summary workbook's Received sheet)
function nameByPo() {
  const m = new Map();
  for (const r of d().prepare('SELECT po, item FROM wm_refunds').all()) if (r.po && !m.has(r.po)) m.set(r.po, r.item || '');
  return m;
}

/* ---------- items ---------- */

const itemOut = (r) => r && ({
  po: r.po, order: r.order_no, item: r.item, sku: r.sku, qty: r.qty, refundDate: r.refund_date, amount: r.amount,
  reason: r.reason, refundedBy: r.refunded_by || '', lost: !!r.lost, type: r.type, sourceRunId: r.source_run_id, addedAt: r.added_at,
});

// add items for POs not tracked yet; known POs keep everything (§6.1)
function addItems(items) {
  const db = d();
  const ins = db.prepare(`INSERT INTO wm_items (po, order_no, item, sku, qty, refund_date, amount, reason, lost, type, source_run_id, added_at, refunded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(po) DO NOTHING`);
  let added = 0;
  for (const it of items || []) {
    if (!it.po) continue;
    const r = ins.run(it.po, it.order || '', it.item || '', it.sku || '', Number(it.qty) || 0, it.refundDate || '', Number(it.amount) || 0,
      it.reason || '', it.lost ? 1 : 0, it.type || 'Seller', it.sourceRunId || '', it.addedAt || new Date().toISOString(), it.refundedBy || '');
    added += Number(r.changes) || 0;
  }
  return added;
}
function listItems() {
  return d().prepare('SELECT * FROM wm_items ORDER BY added_at, po').all().map(itemOut);
}
function removeItem(po) { d().prepare('DELETE FROM wm_items WHERE po = ?').run(String(po || '')); }
// items whose run is gone leave the tracker
function pruneOrphans() {
  return Number(d().prepare('DELETE FROM wm_items WHERE source_run_id NOT IN (SELECT id FROM wm_runs)').run().changes) || 0;
}

/* ---------- marks ---------- */

const marksOut = (r) => r && ({
  po: r.po,
  caseOpened: !!r.case_opened, caseOpenedAt: r.case_opened_at || null, caseId: r.case_id || null,
  caseApproved: !!r.case_approved, caseApprovedAt: r.case_approved_at || null,
  adjustment: !!r.adjustment, adjustmentAt: r.adjustment_at || null,
  reimbursePending: !!r.reimburse_pending, reimbursePendingAt: r.reimburse_pending_at || null,
  writtenOff: !!r.written_off, writtenOffAt: r.written_off_at || null,
  note: r.note || null, noteAt: r.note_at || null,
  receivedManual: !!r.received_manual, receivedManualAt: r.received_manual_at || null, receivedOn: r.received_on || null,
  neverShipped: !!r.never_shipped, neverShippedAt: r.never_shipped_at || null,
  paidOut: Number(r.paid_out) || 0, paidOutBy: r.paid_out_by || null, paidOutAt: r.paid_out_at || null, paidOutOn: r.paid_out_on || null,
  updated_at: r.updated_at, station: r.station, by: r.by, removed: !!r.removed,
});
function getMarks(po) { return marksOut(d().prepare('SELECT * FROM wm_marks WHERE po = ?').get(String(po || ''))); }
function allMarks() {
  const m = new Map();
  for (const r of d().prepare('SELECT * FROM wm_marks').all()) m.set(r.po, marksOut(r));
  return m;
}
// newest write wins (updated_at), same as item_costs; returns the stored
// row, or null when an older copy was ignored
function upsertMarks(rec) {
  const db = d();
  const po = String(rec && rec.po || '').trim();
  if (!po) return null;
  const updatedAt = rec.updated_at && !Number.isNaN(Date.parse(rec.updated_at)) ? new Date(rec.updated_at).toISOString() : new Date().toISOString();
  const cur = db.prepare('SELECT updated_at FROM wm_marks WHERE po = ?').get(po);
  if (cur && String(cur.updated_at) >= updatedAt) return null;
  db.prepare(`INSERT INTO wm_marks (po, case_opened, case_opened_at, case_id, case_approved, case_approved_at, adjustment, adjustment_at,
      reimburse_pending, reimburse_pending_at, written_off, written_off_at, note, note_at, updated_at, station, by, removed,
      received_manual, received_manual_at, received_on, never_shipped, never_shipped_at, paid_out, paid_out_by, paid_out_at, paid_out_on)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(po) DO UPDATE SET case_opened = excluded.case_opened, case_opened_at = excluded.case_opened_at, case_id = excluded.case_id,
      case_approved = excluded.case_approved, case_approved_at = excluded.case_approved_at, adjustment = excluded.adjustment, adjustment_at = excluded.adjustment_at,
      reimburse_pending = excluded.reimburse_pending, reimburse_pending_at = excluded.reimburse_pending_at, written_off = excluded.written_off, written_off_at = excluded.written_off_at,
      note = excluded.note, note_at = excluded.note_at, updated_at = excluded.updated_at, station = excluded.station, by = excluded.by, removed = excluded.removed,
      received_manual = excluded.received_manual, received_manual_at = excluded.received_manual_at, received_on = excluded.received_on,
      never_shipped = excluded.never_shipped, never_shipped_at = excluded.never_shipped_at,
      paid_out = excluded.paid_out, paid_out_by = excluded.paid_out_by, paid_out_at = excluded.paid_out_at, paid_out_on = excluded.paid_out_on`)
    .run(po, rec.caseOpened ? 1 : 0, rec.caseOpenedAt || null, rec.caseId || null, rec.caseApproved ? 1 : 0, rec.caseApprovedAt || null,
      rec.adjustment ? 1 : 0, rec.adjustmentAt || null, rec.reimbursePending ? 1 : 0, rec.reimbursePendingAt || null,
      rec.writtenOff ? 1 : 0, rec.writtenOffAt || null, rec.note || null, rec.noteAt || null, updatedAt,
      String(rec.station || '').slice(0, 60), String(rec.by || '').slice(0, 80), rec.removed ? 1 : 0,
      rec.receivedManual ? 1 : 0, rec.receivedManualAt || null, rec.receivedOn || null, rec.neverShipped ? 1 : 0, rec.neverShippedAt || null,
      Number(rec.paidOut) || 0, rec.paidOutBy || null, rec.paidOutAt || null, rec.paidOutOn || null);
  return getMarks(po);
}
function ownMarks(stations) {
  const set = new Set((stations || []).filter(Boolean).map((s) => String(s).toUpperCase()));
  return d().prepare('SELECT * FROM wm_marks').all().map(marksOut).filter((r) => set.has(String(r.station).toUpperCase()));
}
function ownRuns(stations) {
  const set = new Set((stations || []).filter(Boolean).map((s) => String(s).toUpperCase()));
  return listRuns().filter((r) => set.has(String(r.station).toUpperCase()));
}

module.exports = {
  ensureSchema, listRuns, listRunMeta, getRun, findRunByLabel, findRunByHash, putRun, deleteRun, tombstoneTs,
  runRefunds, runPayouts, runLedger, allPayouts, allLedger, nameByPo, putOrders, runOrders, allOrders, runsWithoutOrders, runsWithoutPrices, runsWithoutRefundedBy, setRefundedBy, refundedByMap,
  putLines, runLines, allLines, runsWithoutLines, runsWithoutNotes,
  upsertExpense, getExpense, allExpenses, ownExpenses,
  addItems, listItems, removeItem, pruneOrphans,
  getMarks, allMarks, upsertMarks, ownMarks, ownRuns,
};
