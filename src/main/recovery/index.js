'use strict';
// Recovery — the orchestration (the Walmart app's core.js, trimmed to the
// one job; spec docs/recovery/SPEC.md §3, §6, §8–§10). A payment-period
// report comes in as text, every refunded PO is checked against the
// Returns log, the run is stored with its refunds / payouts / ledger, the
// not-received POs join the tracker, and every status is re-derived on
// each read. Imports and markers ride the shared folder as the `wmruns`
// and `wmmarks` aux logs so every desktop folds to the same picture.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');
const rnr = require('./rnr');
const { parseCsvText } = require('./csv');
const { parseRefundDate } = require('./parseReport');
const { parseReport } = require('./parseReport');
const { findIssues, returnsToWarehouseRows } = require('./reconcile');
const { classify, toSummary, buildRunWorkbook } = require('./classify');
const { formatPeriod, periodFromReportName, parsePeriodLabel } = require('./period');
const { parseWfsInventory, gtinKey } = require('./wfsinv');
const { conditionOfSku } = require('../skucond');

let deps = null; // { retsync, listReturns, config, archiveDir, station, by, wfsShipments }
const auxStates = {};
const auxState = (prefix) => (auxStates[prefix] = auxStates[prefix] || {});
let syncBusy = false;

function configure(opts) {
  deps = { ...(deps || {}), ...opts };
}
const now = () => new Date().toISOString();
const station = () => (deps.retsync && deps.retsync.enabled() ? deps.retsync.stationName() : (typeof deps.station === 'function' ? deps.station() : deps.station) || '');
const mine = () => [station(), ...((typeof deps.stationAliases === 'function' ? deps.stationAliases() : deps.stationAliases) || [])].filter(Boolean);
const byName = () => (typeof deps.by === 'function' ? deps.by() : deps.by) || '';
const cfgRecovery = () => ((deps.config && deps.config.load().recovery) || {});

/* ---------- the Returns log (§2.5) ---------- */

function returnsLog() {
  if (deps.retsync && deps.retsync.enabled()) return deps.retsync.list();
  return deps.listReturns ? deps.listReturns(100000) : [];
}
function warehouse() {
  const log = returnsLog();
  const rows = returnsToWarehouseRows(log);
  return { rows, poSet: new Set(rows.map((r) => r['PO #'])), logRows: log.length };
}

/* ---------- shared-folder sync (§10.3) ---------- */

function runEvent(run, ts) {
  return {
    op: 'put', id: run.id, ts,
    run: { ...run, syncTs: undefined },
    refunds: store.runRefunds(run.id), payouts: store.runPayouts(run.id), ledger: store.runLedger(run.id), orders: store.runOrders(run.id), lines: store.runLines(run.id),
  };
}

// tracker rows rebuilt from a run's stored refunds (the same rule as the
// import: WFS with no warehouse count, seller MISSING or LOST)
function trackerItemsFromStored(run, refunds) {
  const hasTok = (r, t) => String(r.issues || '').split(', ').includes(t);
  const picked = refunds.filter((r) => {
    const wfs = /wfs|walmart-fulfilled/i.test(String(r.fulfillment || ''));
    return wfs ? (Number(r.wh_count) || 0) === 0 : (hasTok(r, 'MISSING') || hasTok(r, 'LOST'));
  });
  return picked.map((r) => rnr.itemFromRow({
    'PO #': r.po, 'Order #': r.order_no, Item: r.item, SKU: r.sku, Qty: r.qty, 'Refund Date': r.refund_date,
    'Net Refund (Payable Impact)': r.net, 'Return Reason': r.reason, 'Refunded By': r.refunded_by || '', 'Fulfillment Type': r.fulfillment,
  }, run.id, run.ranAt));
}

function applyRunEvent(ev) {
  if (!ev || !ev.id || !ev.ts) return;
  const ts = Number(ev.ts) || 0;
  if (ev.op === 'del') {
    const local = store.getRun(ev.id);
    if (local && local.syncTs <= ts) deleteRunLocal(ev.id, ts);
    else if (!local) store.deleteRun(ev.id, ts); // tombstone only
    return;
  }
  if (ev.op !== 'put' || !ev.run) return;
  const tomb = store.tombstoneTs(ev.id);
  if (tomb !== null && tomb >= ts) return;
  const local = store.getRun(ev.id);
  if (local && local.syncTs >= ts) return;
  const run = { ...ev.run, id: ev.id, syncTs: ts };
  // two desktops imported the same period before seeing each other: the
  // newer import wins on every station (same comparison everywhere)
  const twin = store.findRunByLabel(run.label);
  if (twin && twin.id !== run.id) {
    if (twin.syncTs > ts) return;
    deleteRunLocal(twin.id, ts);
  }
  const refunds = ev.refunds || [];
  store.putRun(run, refunds, ev.payouts || [], ev.ledger || [], ev.orders || null, ev.lines || null);
  store.addItems(trackerItemsFromStored(run, refunds));
}

function deleteRunLocal(id, ts) {
  const run = store.getRun(id);
  store.deleteRun(id, ts);
  if (run) { try { fs.rmSync(archivePath(run.label), { force: true }); } catch { /* best effort */ } }
}

function syncIn() {
  if (!deps.retsync || !deps.retsync.enabled() || syncBusy) return;
  syncBusy = true;
  try {
    for (const ev of deps.retsync.readAuxNew('wmruns', auxState('wmruns'))) applyRunEvent(ev);
    for (const ev of deps.retsync.readAuxNew('wmmarks', auxState('wmmarks'))) { if (ev && ev.po) store.upsertMarks(ev); }
    for (const ev of deps.retsync.readAuxNew('wmexpenses', auxState('wmexpenses'))) { if (ev && ev.id) store.upsertExpense(ev); }
    for (const ev of deps.retsync.readAuxNew('wmwfs', auxState('wmwfs'))) applyWfsEvent(ev);
    deps.retsync.auxBackfill('wmruns', () => store.ownRuns(mine()).map((r) => runEvent(r, r.syncTs || Date.parse(r.ranAt) || Date.now())));
    deps.retsync.auxBackfill('wmwfs', () => store.ownWfsReports(mine()).map((r) => wfsEvent(r, r.syncTs || Date.parse(r.importedAt) || Date.now())));
    // own marks and expenses: the file is rebuilt whenever it falls short
    // of the rows this station holds (an append that failed, marks made
    // before sync was on); every other desktop reads it on its next pass
    const ensure = deps.retsync.auxEnsure || ((p, fn) => deps.retsync.auxBackfill(p, fn));
    ensure('wmmarks', () => store.ownMarks(mine()));
    ensure('wmexpenses', () => store.ownExpenses(mine()));
  } catch { /* folder unreachable: the local tables stand alone */ }
  syncBusy = false;
}

// what the shared folder holds for Recovery and what this desktop has
// taken from it (owner 2026-10-14: marks from a file did not show on a
// new computer); "resync" forgets how far each file was read and reads
// every file from the top again
function syncStatus() {
  const rs = deps.retsync;
  if (!rs || !rs.enabled()) return { ok: true, enabled: false };
  const st = rs.status();
  const files = (prefix) => (typeof rs.auxFiles === 'function' ? rs.auxFiles(prefix) : []);
  const marks = [...store.allMarks().values()].filter((m) => !m.removed);
  const own = new Set(mine().map((x) => String(x).toUpperCase()));
  return {
    ok: true, enabled: true, folder: st.folder, folderOk: st.folderOk !== false, station: station(),
    files: { wmruns: files('wmruns'), wmmarks: files('wmmarks'), wmexpenses: files('wmexpenses') },
    local: { runs: store.listRunMeta().length, marks: marks.length, ownMarks: marks.filter((m) => own.has(String(m.station || '').toUpperCase())).length, expenses: store.allExpenses().filter((e) => !e.removed).length },
  };
}
function resync() {
  for (const k of Object.keys(auxStates)) delete auxStates[k];
  syncIn();
  return syncStatus();
}

/* ---------- import (§3) ---------- */

const safeLabel = (label) => String(label).replace(/[\\/:*?"<>|]/g, '-');
const archiveDir = () => (typeof deps.archiveDir === 'function' ? deps.archiveDir() : deps.archiveDir);
function archivePath(label) { return path.join(archiveDir(), `Walmart_Report_${safeLabel(label)}.csv`); }
// the archived statement for a period, wherever it was saved: the current
// archive folder first, then the other folders this app has used (the
// Documents folder before sync was turned on, the shared folder after) —
// a period imported before sync moved the folder still has its file
function findArchive(label) {
  const name = `Walmart_Report_${safeLabel(label)}.csv`;
  const dirs = [archiveDir(), ...((typeof deps.archiveDirs === 'function' ? deps.archiveDirs() : deps.archiveDirs) || [])];
  for (const d of dirs) { if (!d) continue; const f = path.join(d, name); try { if (fs.existsSync(f)) return f; } catch { /* next */ } }
  return null;
}

// the imported runs whose weeks overlap a period by at least 60% of the
// shorter span, shortest span first (the 14-day label from a filename beats
// a wider span read out of a file's transactions)
function runsOverlapping(period, label) {
  if (!period || !period.start || !period.end) return [];
  const day = 86400000;
  const a0 = period.start.getTime(); const a1 = period.end.getTime();
  const out = [];
  for (const run of store.listRunMeta()) {
    if (run.label === label) continue;
    const { start, end } = parsePeriodLabel(run.label);
    if (!start || !end) continue;
    const b0 = start.getTime(); const b1 = end.getTime();
    const overlap = (Math.min(a1, b1) - Math.max(a0, b0)) / day + 1;
    const shorter = Math.min(a1 - a0, b1 - b0) / day + 1;
    if (overlap >= 0.6 * shorter) out.push({ ...run, span: (b1 - b0) / day + 1 });
  }
  return out.sort((x, y) => x.span - y.span || String(x.ranAt).localeCompare(String(y.ranAt)));
}

async function importReport({ name, text, force }, onProgress = () => {}) {
  syncIn();
  const wh = warehouse();
  if (wh.logRows === 0) {
    throw new Error('Your returns log is empty — log returns first, otherwise every PO would be flagged as missing.');
  }
  onProgress('Reading Walmart report…');
  const csvText = String(text ?? '');
  const parsed = parseReport(csvText);
  const { refunds, format } = parsed;
  if (refunds.length === 0) return { noRefunds: true, format };
  const period = periodFromReportName(name) || parsed.period;

  onProgress(`Found ${refunds.length} refunded POs (${format} format). Checking against returns log…`);
  const { seller, wfs } = findIssues(refunds, wh.rows);

  let label =
    formatPeriod(period.start, period.end) ||
    String(name || 'report').replace(/\.csv$/i, '').replace('Digital_World_Shop_10001467995_MP_', '').replace('_reconciliationreport', '');

  const csvHash = crypto.createHash('sha256').update(csvText).digest('hex');
  // the same weeks under another name are the same period (owner
  // 2026-10-14: a renamed download named itself from its own columns, a day
  // off the filename's label, and sat beside the period it should have
  // replaced). The known period keeps its name; every run covering those
  // weeks is replaced, so a stray duplicate goes with it.
  const twins = runsOverlapping(period, label);
  if (twins.length) label = twins[0].label;
  if (!force) {
    const dup = store.findRunByHash(csvHash) || store.findRunByLabel(label) || twins[0];
    if (dup) {
      return { alreadyImported: true, sameFile: dup.csvHash === csvHash, label: dup.label, ranAt: dup.ranAt, csvName: dup.csvName || '' };
    }
  }

  onProgress('Summarizing…');
  const { rows, counts } = classify(seller, wfs);
  const summary = toSummary(rows);

  // a re-import of the same period replaces the old run (and its items) —
  // before the new file is archived: the old run's cleanup removes the
  // period's archive, which used to take the freshly written one with it
  const replaced = store.findRunByLabel(label);
  const ts = Date.now();
  if (replaced) deleteRunLocal(replaced.id, ts - 1);
  for (const t of twins) if (!replaced || t.id !== replaced.id) deleteRunLocal(t.id, ts - 1);

  // keep the original report, named by its period, in a folder the owner can
  // open from Settings; a re-import overwrites the period's file
  let archived = '';
  try {
    fs.mkdirSync(archiveDir(), { recursive: true });
    fs.writeFileSync(archivePath(label), csvText, 'utf8');
    archived = archivePath(label);
  } catch { /* the run keeps everything it parsed */ }

  const runId = crypto.randomUUID();
  const run = {
    id: runId, label, ranAt: now(), csvName: name || '', csvHash, format,
    totalRefunds: refunds.length, sellerCount: seller.length, wfsCount: wfs.length, logRows: wh.logRows,
    counts, summary, station: station(), by: byName(), syncTs: ts,
  };
  const refundRows = [...seller, ...wfs].map((r) => ({
    po: r['PO #'], order_no: r['Order #'] || '', item: r.Item || '', sku: r.SKU || '', qty: r.Qty || 0, refund_date: r['Refund Date'] || '',
    retail: r['Refunded Retail Sales'] || 0, net: r['Net Refund (Payable Impact)'] || 0, reason: r['Return Reason'] || '',
    fulfillment: r['Fulfillment Type'] || '', issues: r.Issues || '', wh_count: r['Warehouse Count'] || 0,
    wh_price: r['Warehouse Price'], wh_condition: r['Warehouse Condition'] || '', refunded_by: r['Refunded By'] || '',
  }));
  const payoutRows = Object.entries(parsed.payouts).map(([po, v]) => ({ po, amount: v.amount, date: v.date || '', kind: v.kind || '' }));
  store.putRun(run, refundRows, payoutRows, parsed.ledger, parsed.orders, parsed.lines);
  store.addItems(rnr.trackerRows(seller, wfs).map((r) => rnr.itemFromRow(r, runId, run.ranAt)));
  if (replaced) { try { deps.retsync.appendAux('wmruns', { op: 'del', id: replaced.id, ts: ts - 1 }); } catch { /* offline */ } }
  try { deps.retsync.appendAux('wmruns', runEvent(run, ts)); } catch { /* offline: the local run stands */ }

  const result = {
    ok: true, id: runId, label, format, totalRefunds: refunds.length, sellerCount: seller.length, wfsCount: wfs.length,
    logRows: wh.logRows, counts, replaced: !!replaced, archived,
    // Profit needs the goods price: say at import time when the file has none
    orders: parsed.orders.length, priced: parsed.orders.some((o) => Number(o.gross) > 0),
  };
  sendDigest().catch(() => {});
  return result;
}

function removeRun(id) {
  const run = store.getRun(id);
  if (!run) return { ok: false, error: 'That period is already gone.' };
  const ts = Date.now();
  deleteRunLocal(id, ts);
  try { deps.retsync.appendAux('wmruns', { op: 'del', id, ts }); } catch { /* offline */ }
  return { ok: true, label: run.label };
}

/* ---------- Profit: conditions grouped (owner 2026-10-15) ---------- */
// "It should automatically group": X133-64GB-GRAY, OPEN-BOX-X133-64GB-GRAY
// and USED-X133-64GB-GRAY are one family under the base SKU, each condition
// a row of its own beneath it. A Linnworks SKU's condition comes from the
// Returns condition mappings first (a listing graded by hand), then from
// its name (skucond.js). A family of one stays a plain row.
const COND_ORDER = ['new', 'openbox', 'used', 'scrap'];
const COND_LABEL = { new: 'New', openbox: 'Open Box', used: 'Used', scrap: 'Scrap' };
const SUM_FIELDS = ['orders', 'unitsSold', 'unitsRefunded', 'unitsBack', 'unitsPending', 'unitsLost', 'atRisk', 'payout', 'statementPayout', 'cogs', 'heldOut', 'gross', 'commission', 'pricedUnits', 'commGross'];

function skuCondition(sku, byTarget) {
  const mapped = byTarget.get(String(sku || '').toUpperCase());
  if (mapped) return mapped;
  const c = conditionOfSku(sku);
  return c ? { cond: c.cond, core: c.core } : { cond: 'new', core: String(sku || '') };
}

function buildFamilies(groups, condMap = {}) {
  const byTarget = new Map();
  for (const [base, conds] of Object.entries(condMap || {})) {
    for (const [cond, target] of Object.entries(conds || {})) {
      if (target && COND_LABEL[cond] && String(target).toUpperCase() !== String(base).toUpperCase()) byTarget.set(String(target).toUpperCase(), { cond, core: base });
    }
  }
  const fams = new Map();
  for (const g of groups || []) {
    const { cond, core } = skuCondition(g.sku, byTarget);
    const key = String(core).toUpperCase();
    if (!fams.has(key)) fams.set(key, { core, members: [] });
    fams.get(key).members.push({ ...g, cond, condLabel: COND_LABEL[cond] });
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  return [...fams.values()].map(({ core, members }) => {
    members.sort((a, b) => COND_ORDER.indexOf(a.cond) - COND_ORDER.indexOf(b.cond) || b.payout - a.payout);
    if (members.length === 1) return { ...members[0], members, family: false };
    const f = { sku: members.find((m) => m.cond === 'new') ? members.find((m) => m.cond === 'new').sku : core, item: '', members, family: true, mapped: members.every((m) => m.mapped !== false), commissionKnown: false };
    for (const k of SUM_FIELDS) f[k] = r2(members.reduce((t, m) => t + (Number(m[k]) || 0), 0));
    f.item = (members.find((m) => m.item) || {}).item || '';
    f.commissionKnown = members.some((m) => m.commissionKnown);
    // a family's profit needs every condition's cost; the unit cost shown is
    // the one cost they share, else the average over the units sold
    f.costKnown = members.every((m) => m.costKnown);
    const costs = [...new Set(members.filter((m) => m.costKnown).map((m) => m.unitCost))];
    const soldCosted = members.filter((m) => m.costKnown).reduce((t, m) => t + m.unitsSold, 0);
    f.mixedCost = costs.length > 1;
    f.unitCost = !f.costKnown ? null : costs.length === 1 ? costs[0] : soldCosted > 0 ? r2(members.reduce((t, m) => t + m.unitCost * m.unitsSold, 0) / soldCosted) : null;
    f.profit = r2(f.payout - f.cogs);
    f.avgPrice = f.pricedUnits > 0 && f.gross > 0 ? r2(f.gross / f.pricedUnits) : null;
    f.commissionPct = f.commissionKnown && f.commGross > 0 ? Math.round((-f.commission / f.commGross) * 1000) / 10 : null;
    f.margin = f.costKnown && f.unitsSold > 0 && f.payout > 0 ? Math.round(((f.payout - f.cogs) / f.payout) * 1000) / 10 : null;
    return f;
  }).sort((a, b) => b.payout - a.payout);
}

/* ---------- WFS inventory (owner 2026-10-15) ---------- */
// Walmart's Inventory Reconciliation report for a period, one row per SKU,
// beside what the WFS Shipments log says was sent in the same days. Only
// the report's own columns are shown; nothing is worked out on top of them.

function wfsArchivePath(label) { return path.join(archiveDir(), `WFS_Inventory_${safeLabel(label)}.csv`); }
const dayLabel = (iso) => { const [y, m, dd] = String(iso).split('-').map(Number); return new Date(y, m - 1, dd); };

function wfsEvent(rep, ts) {
  return { op: 'put', id: rep.id, ts, report: { ...rep, syncTs: undefined }, rows: store.wfsReportRows(rep.id) };
}
function deleteWfsLocal(id, ts) {
  const rep = store.getWfsReport(id);
  store.deleteWfsReport(id, ts);
  if (rep) { try { fs.rmSync(wfsArchivePath(rep.label), { force: true }); } catch { /* best effort */ } }
}
function applyWfsEvent(ev) {
  if (!ev || !ev.id || !ev.ts) return;
  const ts = Number(ev.ts) || 0;
  if (ev.op === 'del') {
    const local = store.getWfsReport(ev.id);
    if (local && local.syncTs <= ts) deleteWfsLocal(ev.id, ts);
    else if (!local) store.deleteWfsReport(ev.id, ts);
    return;
  }
  if (ev.op !== 'put' || !ev.report) return;
  const tomb = store.tombstoneTs(ev.id);
  if (tomb !== null && tomb >= ts) return;
  const local = store.getWfsReport(ev.id);
  if (local && local.syncTs >= ts) return;
  const rep = { ...ev.report, id: ev.id, syncTs: ts };
  // two desktops imported the same days: the newer import wins everywhere
  const twin = store.findWfsReportByLabel(rep.label);
  if (twin && twin.id !== rep.id) {
    if (twin.syncTs > ts) return;
    deleteWfsLocal(twin.id, ts);
  }
  store.putWfsReport(rep, ev.rows || []);
}

function importWfsReport({ name, text, force }) {
  syncIn();
  const csvText = String(text ?? '');
  const parsed = parseWfsInventory(csvText, name);
  const label = parsed.period
    ? formatPeriod(dayLabel(parsed.period.start), dayLabel(parsed.period.end))
    : String(name || 'WFS report').replace(/\.csv$/i, '');
  const csvHash = crypto.createHash('sha256').update(csvText).digest('hex');
  if (!force) {
    const dup = store.findWfsReportByHash(csvHash) || store.findWfsReportByLabel(label);
    if (dup) return { alreadyImported: true, sameFile: dup.csvHash === csvHash, label: dup.label, importedAt: dup.importedAt };
  }
  const ts = Date.now();
  const replaced = store.findWfsReportByLabel(label);
  if (replaced) deleteWfsLocal(replaced.id, ts - 1);
  try {
    fs.mkdirSync(archiveDir(), { recursive: true });
    fs.writeFileSync(wfsArchivePath(label), csvText, 'utf8');
  } catch { /* the report keeps everything it parsed */ }
  const rep = {
    id: crypto.randomUUID(), label, start: parsed.period ? parsed.period.start : null, end: parsed.period ? parsed.period.end : null,
    importedAt: now(), csvName: name || '', csvHash, fields: parsed.fields, unknown: parsed.unknown, station: station(), by: byName(), syncTs: ts,
  };
  store.putWfsReport(rep, parsed.rows);
  if (replaced) { try { deps.retsync.appendAux('wmwfs', { op: 'del', id: replaced.id, ts: ts - 1 }); } catch { /* offline */ } }
  try { deps.retsync.appendAux('wmwfs', wfsEvent(rep, ts)); } catch { /* offline: the local report stands */ }
  const skus = new Set(parsed.rows.map((r) => gtinKey(r.gtin) || String(r.sku).toUpperCase()));
  return { ok: true, id: rep.id, label, skus: skus.size, rows: parsed.rows.length, fields: parsed.fields, unknown: parsed.unknown, dated: !!parsed.period, replaced: !!replaced };
}

function removeWfsReport(id) {
  const rep = store.getWfsReport(id);
  if (!rep) return { ok: false, error: 'That report is already gone.' };
  const ts = Date.now();
  deleteWfsLocal(id, ts);
  try { deps.retsync.appendAux('wmwfs', { op: 'del', id, ts }); } catch { /* offline */ }
  return { ok: true, label: rep.label };
}

// the local day a shipment was logged on ("YYYY-MM-DD")
function localDay(stamp) {
  const t = new Date(String(stamp || ''));
  if (isNaN(t.getTime())) return '';
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

// one row per SKU: the report's fulfillment centers added together, and the
// units the WFS Shipments log sent in the report's days. A shipped line
// matches a report row by GTIN, then by its Walmart SKU, then by its
// Linnworks SKU; one that matches nothing gets a row of its own.
function wfsInventory(id) {
  syncIn();
  const rep = store.getWfsReport(id);
  if (!rep) return { ok: false, error: 'That WFS report is not imported.' };
  const byKey = new Map();
  const byGtin = new Map();
  const bySku = new Map();
  for (const r of store.wfsReportRows(id)) {
    const gk = gtinKey(r.gtin);
    const key = gk || `SKU:${String(r.sku).toUpperCase()}`;
    let row = byKey.get(key);
    if (!row) {
      row = { key, sku: r.sku, name: r.name, gtin: r.gtin, itemId: r.itemId, fcs: [], q: {}, shipped: 0, inReport: true };
      for (const f of rep.fields) row.q[f] = 0;
      byKey.set(key, row);
      if (gk) byGtin.set(gk, row);
    }
    if (!row.sku && r.sku) row.sku = r.sku;
    if (!row.name && r.name) row.name = r.name;
    if (r.fc && !row.fcs.includes(r.fc)) row.fcs.push(r.fc);
    for (const f of rep.fields) row.q[f] += Number(r.q[f]) || 0;
    if (r.sku) bySku.set(String(r.sku).toUpperCase(), row);
  }
  let shipments = 0;
  const dated = !!(rep.start && rep.end);
  if (dated) {
    const list = typeof deps.wfsShipments === 'function' ? (deps.wfsShipments() || []) : [];
    for (const s of list) {
      const day = localDay(s.created_at);
      if (!day || day < rep.start || day > rep.end) continue;
      shipments++;
      for (const it of Array.isArray(s.items) ? s.items : []) {
        const n = Number(it.qty) || 0;
        if (!n) continue;
        const ch = String(it.channelSku || '').toUpperCase();
        const lw = String(it.sku || '').toUpperCase();
        let row = byGtin.get(gtinKey(it.gtin)) || (ch && bySku.get(ch)) || (lw && bySku.get(lw));
        if (!row) {
          const key = `LOG:${ch || lw}`;
          row = byKey.get(key);
          if (!row) {
            row = { key, sku: it.channelSku || it.sku || '', name: '', gtin: it.gtin || '', itemId: '', fcs: [], q: {}, shipped: 0, inReport: false };
            byKey.set(key, row);
          }
        }
        row.shipped += n;
      }
    }
  }
  const rows = [...byKey.values()].sort((a, b) => String(a.sku).localeCompare(String(b.sku), undefined, { numeric: true, sensitivity: 'base' }));
  const totals = { shipped: rows.reduce((t, r) => t + r.shipped, 0) };
  for (const f of rep.fields) totals[f] = rows.reduce((t, r) => t + (Number(r.q[f]) || 0), 0);
  return { ok: true, report: rep, dated, shipments, rows, totals };
}

/* ---------- the tracker, decorated (§6.2–§6.4) ---------- */

function periodEndMs(run) {
  const { end } = parsePeriodLabel(run.label);
  if (end) return end.getTime();
  const t = Date.parse(run.ranAt);
  return Number.isFinite(t) ? t : 0;
}
function periodStartMs(run) {
  const { start } = parsePeriodLabel(run.label);
  if (start) return start.getTime();
  const t = Date.parse(run.ranAt);
  return Number.isFinite(t) ? t : 0;
}

function decoratedItems(today = new Date()) {
  store.pruneOrphans();
  const marks = store.allMarks();
  const base = store.listItems()
    .map((it) => ({ ...it, ...stripMeta(marks.get(it.po)) }))
    .filter((it) => !it.removed);
  const runs = store.listRunMeta();
  const cycleEnds = runs.map(periodEndMs).filter(Boolean);
  const wh = warehouse();
  return {
    items: rnr.sortItems(rnr.decorate(base, { warehousePoSet: wh.poSet, settlements: rnr.aggregateSettlements(store.allPayouts()), cycleEnds, today })),
    runs, logRows: wh.logRows,
  };
}
function stripMeta(m) {
  if (!m) return {};
  const { updated_at, station: st, by, ...rest } = m;
  return rest;
}

// the one call both screens render from
function state() {
  syncIn();
  const { items, runs, logRows } = decoratedItems();
  // logged returns leave the page; a PO marked received before the log
  // stays visible on the Marked tab (owner 2026-10-12)
  const visible = items.filter((i) => i.status !== 'received' || i.receivedManual);
  const sorted = runs.slice().sort((a, b) => periodStartMs(b) - periodStartMs(a) || String(b.ranAt).localeCompare(String(a.ranAt)));
  const openByRun = {};
  for (const it of visible) if (it.status === 'outstanding') openByRun[it.sourceRunId] = (openByRun[it.sourceRunId] || 0) + 1;
  ensureOrders();
  const byMap = store.refundedByMap();
  const cfg = cfgRecovery();
  return {
    ok: true,
    runs: sorted.map((r) => ({ ...r, open: openByRun[r.id] || 0 })),
    wfsReports: store.listWfsReports(),
    // each row carries its sentence and its list tab, so the renderer only draws
    items: visible.map((it) => ({ ...it, refundedBy: it.refundedBy || byMap[it.po] || '', statusText: rnr.statusText(it), short: rnr.shortStatus(it), tab: rnr.filterOf(it), lostAmount: rnr.lostAmount(it) })),
    today: rnr.todayCounts(visible),
    months: monthKeys(items),
    years: [...new Set(monthKeys(items).map((k) => k.slice(0, 4)))],
    settings: { email: cfg.email || '', webhookUrl: cfg.webhookUrl || '', archiveDir: archiveDir(), syncOn: !!(deps.retsync && deps.retsync.enabled()) },
    logRows,
  };
}

function runDetail(id) {
  const run = store.getRun(id);
  if (!run) return { ok: false, error: 'Period not found.' };
  const summary = run.summary || {};
  const deco = (rows) => (rows || []).map((r) => ({ ...r, todo: rnr.whatToDo(r) }));
  return { ok: true, run: { ...run, summary: { notReceived: deco(summary.notReceived), wfsWaiting: deco(summary.wfsWaiting), received: summary.received || [] } } };
}

/* ---------- markers ---------- */

function mark(po, action, payload = {}) {
  const p = String(po || '').trim();
  if (!p) return { ok: false, error: 'No PO.' };
  const cur = store.getMarks(p);
  const stamp = now();
  let next;
  if (action === 'remove') next = { ...rnr.blankMarks(), ...(cur || {}), removed: true };
  else next = { ...rnr.applyMarker(cur, action, payload, stamp), removed: false };
  const rec = { ...next, po: p, updated_at: stamp, station: station(), by: byName() };
  store.upsertMarks(rec);
  try { deps.retsync.appendAux('wmmarks', rec); } catch { /* offline */ }
  return { ok: true };
}

// the owner's own expenses (owner 2026-10-13: "outside shipping labels,
// packing stuff"): dated, categorised, taken off profit in the period they
// fall in, synced through the shared folder like marks
const EXPENSE_CATEGORIES = ['Shipping labels', 'Packaging', 'Supplies', 'Software', 'Advertising', 'Other'];
// an id that already exists edits that expense in place (owner 2026-10-14:
// "allow me to edit expenses once recorded"); an optional end date makes it
// run from one day to another and spread by days over the scopes it touches
function addExpense({ id, date, dateTo, category, note, amount, sku } = {}) {
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  if (!(n > 0)) return { ok: false, error: 'Enter an amount above 0.' };
  const day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: 'Pick a date.' };
  let to = String(dateTo || '').slice(0, 10);
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { ok: false, error: 'Pick an end date, or leave it empty.' };
  if (to && to < day) return { ok: false, error: 'The end date is before the start date.' };
  if (to === day) to = '';
  const key = String(id || '').trim();
  if (key && !store.getExpense(key)) return { ok: false, error: 'That expense is gone; add it again.' };
  const rec = { id: key || crypto.randomUUID(), date: day, dateTo: to, category: String(category || 'Other').trim() || 'Other', note: String(note || '').trim().slice(0, 200), sku: String(sku || '').trim().toUpperCase(), amount: n, updated_at: now(), station: station(), by: byName(), removed: false };
  store.upsertExpense(rec);
  try { deps.retsync.appendAux('wmexpenses', rec); } catch { /* offline */ }
  return { ok: true, id: rec.id, edited: !!key };
}
function removeExpense(id) {
  const cur = store.getExpense(id);
  if (!cur) return { ok: false, error: 'That expense is already gone.' };
  const rec = { ...cur, removed: true, updated_at: now(), station: station(), by: byName() };
  store.upsertExpense(rec);
  try { deps.retsync.appendAux('wmexpenses', rec); } catch { /* offline */ }
  return { ok: true };
}
// the expenses that fall inside a scope: a period's own dates, a month, a
// year, or all. An expense that runs from one day to another gives the
// scope its share by days (a $310 October subscription gives Sep 19 – Oct 3
// three days' worth); `amount` is the share, `full` the whole entry
function expensesIn(scope, key) {
  const all = store.allExpenses();
  const DAY = 86400000;
  const dayMs = (d) => { const t = Date.parse(`${d}T00:00:00`); return Number.isFinite(t) ? t : NaN; };
  let a; let b;
  if (scope === 'cycle') {
    const run = store.getRun(key);
    if (!run) return [];
    a = periodStartMs(run); b = periodEndMs(run);
  } else if (scope === 'month') {
    const [y, m] = String(key).split('-').map(Number);
    a = new Date(y, m - 1, 1).getTime(); b = new Date(y, m, 0).getTime();
  } else if (scope === 'year') {
    a = new Date(Number(key), 0, 1).getTime(); b = new Date(Number(key), 11, 31).getTime();
  } else return all.map((e) => ({ ...e, full: e.amount, days: 0, daysIn: 0 }));
  const out = [];
  for (const e of all) {
    const s = dayMs(e.date); const t = e.dateTo ? dayMs(e.dateTo) : s;
    if (!Number.isFinite(s) || !Number.isFinite(t)) continue;
    const days = Math.round((t - s) / DAY) + 1;
    const lo = Math.max(s, a); const hi = Math.min(t, b);
    if (hi < lo) continue;
    const daysIn = Math.round((hi - lo) / DAY) + 1;
    const share = days > 1 ? Math.round((e.amount * daysIn / days) * 100) / 100 : e.amount;
    out.push({ ...e, amount: share, full: e.amount, days, daysIn });
  }
  return out;
}

// the same mark on many POs at once (owner 2026-10-12: bulk select, and a
// CSV of what came back before the Returns log existed)
function markMany(list, action, payload = {}) {
  let done = 0;
  for (const x of list || []) {
    const po = typeof x === 'string' ? x : x && x.po;
    const r = mark(po, action, { ...payload, ...(x && x.on ? { on: x.on } : {}) });
    if (r.ok) done++;
  }
  return { ok: true, count: done };
}
// a file of POs to mark received: finds the PO column (any header, or the
// column whose values look like POs), an optional date column, and says
// which POs are on the tracker before anything is written
function markFile(text) {
  const { rows, columns } = parseCsvText(String(text || ''));
  // a bare run of digits (a date with slashes or dashes is not one)
  const looksPo = (v) => /^\s*\d{3,16}\s*$/.test(String(v || ''));
  const clean = (v) => String(v || '').trim();
  let poCol = columns.find((c) => /\b(po|purchase\s*order|order)\b/i.test(c));
  if (!poCol) poCol = columns.find((c) => rows.filter((r) => looksPo(r[c])).length >= Math.max(1, rows.length / 2));
  const dateCol = columns.find((c) => /date|received|arrived/i.test(c));
  const list = [];
  if (poCol) {
    if (looksPo(poCol)) list.push({ po: clean(poCol), on: null }); // a headerless list: the "header" is the first PO
    for (const r of rows) { if (looksPo(r[poCol])) list.push({ po: clean(r[poCol]), on: dateCol ? isoDay(r[dateCol]) : null }); }
  }
  const seen = new Set(); const pos = list.filter((x) => (seen.has(x.po) ? false : (seen.add(x.po), true)));
  const items = new Map(decoratedItems().items.map((it) => [it.po, it]));
  const matched = pos.filter((x) => items.has(x.po) && items.get(x.po).status !== 'received');
  const already = pos.filter((x) => items.has(x.po) && items.get(x.po).status === 'received').length;
  const unmatched = pos.filter((x) => !items.has(x.po)).map((x) => x.po);
  return { ok: true, found: pos.length, matched, already, unmatched };
}
function isoDay(v) {
  const s = String(v || '').trim(); if (!s) return null;
  const d = /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(s.slice(0, 10) + 'T00:00:00') : parseRefundDate(s.slice(0, 10));
  return d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;
}

/* ---------- summaries (§8) ---------- */

function monthKeys(items) {
  const keys = new Set();
  for (const t of rnr.dedupeLedger(store.allLedger())) { if (rnr.isRefundTx(t)) { const k = rnr.monthKeyOf(t.date); if (k) keys.add(k); } }
  for (const it of items) { const k = rnr.monthKeyOf(it.refundDate); if (k) keys.add(k); }
  return [...keys].sort().reverse();
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (k) => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;

// scope: 'cycle' (key = run id), 'month' (key = YYYY-MM), 'all'
function scopeRows(scope, key, items) {
  if (scope === 'cycle') {
    const run = store.getRun(key);
    const txs = run ? store.runLedger(run.id).map((t) => ({ ...t, order: t.order_no })) : [];
    return { txs, items: items.filter((i) => i.sourceRunId === key), label: run ? run.label : '' };
  }
  const all = rnr.dedupeLedger(store.allLedger());
  if (scope === 'month') {
    return { txs: all.filter((t) => rnr.monthKeyOf(t.date) === key), items: items.filter((i) => rnr.monthKeyOf(i.refundDate) === key), label: monthLabel(String(key)) };
  }
  if (scope === 'year') {
    const y = String(key);
    const yr = (d) => { const k = rnr.monthKeyOf(d); return k ? k.slice(0, 4) : null; };
    return { txs: all.filter((t) => yr(t.date) === y), items: items.filter((i) => yr(i.refundDate) === y), label: y };
  }
  return { txs: all, items, label: 'all time' };
}

function summary(scope, key) {
  syncIn();
  const { items } = decoratedItems();
  const { txs, items: its, label } = scopeRows(scope, key, items);
  const refunds = txs.filter(rnr.isRefundTx);
  return { ok: true, scope, key, label, ...rnr.bucketTotals(refunds, its), ...rnr.sumDisputeWins(txs, rnr.disputeWinSkipSet(items)) };
}

/* ---------- exports (§5, §7, §8) ---------- */

function runWorkbook(id) {
  const run = store.getRun(id);
  if (!run) return null;
  return { label: run.label, buffer: buildRunWorkbook(run.summary || {}, run.label) };
}
function auditWorkbook() {
  const { items } = decoratedItems();
  return rnr.buildAuditWorkbook(items);
}
function summaryWorkbook(scope, key) {
  const { items } = decoratedItems();
  const { txs, items: its, label } = scopeRows(scope, key, items);
  return { label, buffer: rnr.buildSummaryWorkbook({ label, refunds: txs.filter(rnr.isRefundTx), items: its, allTxs: txs, nameByPo: store.nameByPo() }) };
}
function viewCsv(pos) {
  const want = new Set((pos || []).map(String));
  const { items } = decoratedItems();
  return rnr.buildViewCsv(items.filter((i) => want.has(String(i.po))));
}

/* ---------- Profit (owner 2026-10-12: "a place for the profit") ---------- */
// What Walmart paid for each order (sales net of its fees, refunds taken
// off) against the cost of the units sold. Costs come from the app's own
// item_costs by inventory SKU; the report's Walmart SKU reaches it either
// directly or through the Pricing page's channel mappings. A unit that was
// refunded AND came back to the warehouse recovers its cost (it is stock
// again); a refunded unit that never came back does not.

// periods imported before Profit existed have no per-order rows: read them
// back from the period's archived CSV when it is on this computer
const pricesTried = new Set(); // run + file read once this session (a file found elsewhere is read again)
const byTried = new Set();
const linesTried = new Set();
const notesTried = new Set();
function ensureOrders() {
  const missing = [];
  for (const r of store.runsWithoutOrders()) {
    const f = findArchive(r.label);
    try {
      if (!f) { missing.push(r.label); continue; }
      const parsed = parseReport(fs.readFileSync(f, 'utf8'));
      store.putOrders(r.id, parsed.orders);
      if (!parsed.orders.length) missing.push(r.label);
    } catch { missing.push(r.label); }
  }
  // orders stored before v1.32.13 have no goods price or commission (owner
  // 2026-10-12: "why is the avg commission and avg price not showing"):
  // fill them from the archived CSV when it is on this computer or in the
  // shared folder; a run with no archive keeps its orders, prices unknown
  for (const r of store.runsWithoutPrices()) {
    const f = findArchive(r.label); // looked for on every call: the folder may appear later
    if (!f || pricesTried.has(`${r.id}|${f}`)) continue;
    try {
      pricesTried.add(`${r.id}|${f}`);
      const parsed = parseReport(fs.readFileSync(f, 'utf8'));
      if (parsed.orders.length) store.putOrders(r.id, parsed.orders);
    } catch { /* next time the file is readable */ }
  }
  // the fee wording on orders stored before v1.32.32 (note column NULL)
  for (const r of store.runsWithoutNotes()) {
    const f = findArchive(r.label);
    if (!f || notesTried.has(`${r.id}|${f}`)) continue;
    try {
      notesTried.add(`${r.id}|${f}`);
      const parsed = parseReport(fs.readFileSync(f, 'utf8'));
      if (parsed.orders.length) store.putOrders(r.id, parsed.orders);
    } catch { /* next time */ }
  }
  // the statement lines, for runs stored before v1.32.39
  for (const r of store.runsWithoutLines()) {
    const f = findArchive(r.label);
    if (!f || linesTried.has(`${r.id}|${f}`)) continue;
    try {
      linesTried.add(`${r.id}|${f}`);
      const parsed = parseReport(fs.readFileSync(f, 'utf8'));
      if (parsed.lines.length) store.putLines(r.id, parsed.lines);
    } catch { /* next time */ }
  }
  // likewise who issued each refund, for runs stored before v1.32.15
  for (const r of store.runsWithoutRefundedBy()) {
    const f = findArchive(r.label);
    if (!f || byTried.has(`${r.id}|${f}`)) continue;
    try {
      byTried.add(`${r.id}|${f}`);
      const parsed = parseReport(fs.readFileSync(f, 'utf8'));
      store.setRefundedBy(r.id, Object.fromEntries(parsed.refunds.map((x) => [x['PO #'], x['Refunded By'] || ''])));
    } catch { /* next time */ }
  }
  return missing;
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function profit(scope, key) {
  syncIn();
  const missingRuns = ensureOrders();
  const runs = store.listRunMeta();
  const costs = (deps.costs && deps.costs()) || {};
  const chan = (deps.channelMap && deps.channelMap()) || new Map();
  const whPo = warehouse().poSet;
  const unitCost = (sku) => {
    const k = String(sku || '').trim().toUpperCase();
    if (!k) return null;
    // a cost of $0 is a cleared cost, not a free unit (owner 2026-10-12: a
    // listing read 100% margin on a $0.00 cost): it counts as not set
    const known = (c) => (c && Number.isFinite(Number(c.cost)) && Number(c.cost) > 0 ? Number(c.cost) : null);
    const direct = known(costs[k]);
    if (direct !== null) return direct;
    const inv = chan.get(k);
    return inv ? known(costs[String(inv).toUpperCase()]) : null;
  };
  // the Linnworks (inventory) SKU behind a Walmart listing, from the Pricing
  // page's channel map (owner 2026-10-12: "organize it by Linnworks channel
  // SKU"); a listing that is itself an inventory SKU maps to itself, one the
  // map does not know stays on its own
  const invSku = (sku) => {
    const k = String(sku || '').trim().toUpperCase();
    if (!k) return '';
    if (chan.get(k)) return String(chan.get(k));
    if (costs[k] && Number(costs[k].cost) > 0) return String(costs[k].sku || sku).trim() || String(sku).trim();
    return '';
  };

  // every stored row, and where each one belongs. A refund usually posts in
  // a later statement than its sale; it goes home to the period that sold
  // the unit, and the two halves merge into one row per PO (owner
  // 2026-10-13: "margin should be based on products sold and their COGS,
  // not the returns"). A refund whose sale predates the first imported
  // statement has no home and stays where it posted; a fee-only row (no
  // units) is a charge of its own period and stays too.
  const allRows = store.allOrders();
  const saleHome = new Map();
  for (const o of allRows) if (o.saleUnits > 0 && !saleHome.has(o.po)) saleHome.set(o.po, { run: o.run_id, date: o.date });
  const homeOf = (o) => (!(o.saleUnits > 0) && o.refundUnits > 0 && saleHome.has(o.po) ? saleHome.get(o.po) : { run: o.run_id, date: o.date });
  const mergeRows = (rows) => {
    const by = new Map();
    for (const o of rows) {
      const m = by.get(o.po) || { po: o.po, run_id: o.run_id, sku: o.sku, item: o.item, fulfillment: o.fulfillment, date: o.date, saleUnits: 0, refundUnits: 0, netPayable: 0, gross: null, commission: null, note: '', moved: false, orphan: false };
      m.saleUnits += Number(o.saleUnits) || 0; m.refundUnits += Number(o.refundUnits) || 0; m.netPayable += Number(o.netPayable) || 0;
      // the goods price and the commission describe the sale: the sale row
      // carries them, a refund row's reversal is already inside its payout
      if (o.saleUnits > 0 && o.gross !== null && o.gross !== undefined) m.gross = (m.gross ?? 0) + Number(o.gross);
      if (o.saleUnits > 0 && o.commission !== null && o.commission !== undefined) m.commission = (m.commission ?? 0) + Number(o.commission);
      if (o.note && !m.note.includes(o.note)) m.note = m.note ? `${m.note} · ${o.note}` : o.note;
      // the sale row names the row: its SKU, date and period
      if (o.saleUnits > 0) { m.sku = o.sku; m.item = o.item || m.item; m.date = o.date; m.run_id = o.run_id; }
      if (!(o.saleUnits > 0) && o.refundUnits > 0) { if (saleHome.has(o.po)) { if (saleHome.get(o.po).run !== o.run_id) m.moved = true; } else m.orphan = true; }
      by.set(o.po, m);
    }
    return [...by.values()];
  };
  const rowsIn = (fn) => mergeRows(allRows.filter((o) => fn(homeOf(o))));
  const yr = (d) => { const k = rnr.monthKeyOf(d); return k ? k.slice(0, 4) : null; };
  let orders; let ledger; let label;
  if (scope === 'cycle') {
    const run = store.getRun(key);
    orders = run ? rowsIn((h) => h.run === run.id) : [];
    ledger = run ? store.runLedger(run.id) : [];
    label = run ? run.label : '';
  } else if (scope === 'month') {
    orders = rowsIn((h) => rnr.monthKeyOf(h.date) === key);
    ledger = rnr.dedupeLedger(store.allLedger()).filter((t) => rnr.monthKeyOf(t.date) === key);
    label = monthLabel(String(key));
  } else if (scope === 'year') {
    orders = rowsIn((h) => yr(h.date) === String(key));
    ledger = rnr.dedupeLedger(store.allLedger()).filter((t) => yr(t.date) === String(key));
    label = String(key);
  } else {
    orders = mergeRows(allRows);
    ledger = rnr.dedupeLedger(store.allLedger());
    label = 'all time';
  }

  const bySku = new Map();
  const tot = { recovered: 0, payout: 0, cogs: 0, orders: 0, unitsSold: 0, unitsRefunded: 0, unitsBack: 0, missingCount: 0, missingPayout: 0, costedPayout: 0, gross: 0, commission: 0, commissionKnown: false,
    pricedOrders: 0, unpricedOrders: 0, pricedUnits: 0, commGross: 0, atRisk: 0, atRiskUnits: 0, pendingOrders: 0, lostUnits: 0, heldOut: 0, heldOutOrders: 0 };
  const missingSkus = new Set();
  // each SKU also lists its POs with a situation (owner 2026-10-12: "a
  // dropdown where I can see all the relevant PO#s for each item")
  const trackerByPo = new Map(decoratedItems().items.map((it) => [it.po, it]));
  const marksByPo = store.allMarks();
  // how a refunded order stands for costing (owner 2026-10-12: "if a return
  // is pending, why would you deduct from the profit just yet"):
  //   back (logged, or marked received before the log) → cost recovered
  //   never shipped → nothing left the warehouse, nothing to cost
  //   pending (inside its window, Walmart's 90 days, a case open, parked) →
  //     not costed yet; its cost is carried as "at risk"
  //   lost (window passed with no case, marked lost, written off, paid by
  //     Walmart instead) → costed
  // a PO's sale and its refund often land in different payment periods, so
  // one PO is two stored rows: the sale row (units sold, no refund) and the
  // refund row (the refund, no units). The standing is judged on the PO as
  // a whole, across every period, and the cost relief lands on the row that
  // carries the sold units — where the cost was charged — while the refund
  // row keeps its payout hit in its own period (owner 2026-10-12: August's
  // margin looked low because returns of July sales never recovered a cost)
  const wholePo = new Map();
  for (const o of allRows) {
    const w = wholePo.get(o.po) || { saleUnits: 0, refundUnits: 0 };
    w.saleUnits += Number(o.saleUnits) || 0; w.refundUnits += Number(o.refundUnits) || 0;
    wholePo.set(o.po, w);
  }
  const standing = (o) => {
    const w = wholePo.get(o.po) || o;
    const mk = marksByPo.get(o.po);
    const manual = !!(mk && !mk.removed && mk.receivedManual);
    const never = !!(mk && !mk.removed && mk.neverShipped);
    // the relief this row can take: only its own sold units
    const own = (n) => Math.min(Number(o.saleUnits) || 0, n);
    if (never) return { kind: 'never', back: Number(o.saleUnits) || 0, held: 0, it: null, elsewhere: false };
    if (!(w.refundUnits > 0)) return { kind: 'kept', back: 0, held: 0, it: null, elsewhere: false };
    const elsewhere = !(o.refundUnits > 0); // this row sold it; the refund sits in another period
    const units = Math.min(w.refundUnits, w.saleUnits);
    if (whPo.has(o.po) || manual) return { kind: manual ? 'manual' : 'back', back: own(units), held: 0, it: null, elsewhere };
    const it = trackerByPo.get(o.po) || null;
    // a "lost" refund (Lost in transit, Lost after delivery) waits out its
    // window like any other before its cost is charged (owner 2026-10-14:
    // "it doesn't reduce from profit until I mark the lost return, right");
    // Reconcile still chases it from day one — only the costing waits
    const lostInside = !!it && it.lost === true && it.daysOld != null && it.daysOld < (it.isWfs ? 135 : 45);
    const pending = !!it && it.status === 'outstanding' && !it.windowClosed
      && (it.wfsWaiting || it.wfsDisputeOpen || it.caseOpened || it.adjustment || (it.daysLeft != null && it.daysLeft > 0) || lostInside);
    return pending ? { kind: 'pending', back: 0, held: own(units), it, elsewhere } : { kind: 'lost', back: 0, held: 0, it, elsewhere };
  };
  // a refund of a sale made before the first imported statement has no sale
  // income here to cancel against, so its whole amount would land on profit
  // even with the unit back on the shelf (owner 2026-10-14: "you are
  // removing from the profit even though it was returned back to us?"). It
  // is left out of profit while the unit is back, pending or never shipped,
  // and counted only once the return is lost. "Walmart paid" still shows
  // the statement's own total.
  const notCounted = (o, st) => !!o.orphan && st.kind !== 'lost';
  // a goods price is only known for periods imported with the price
  // columns (v1.32.13+) whose archive was on hand; an order without one
  // counts in payout and cost but not in goods sold, avg price or commission
  const priced = (o) => o.saleUnits > 0 && o.gross !== null && o.gross !== undefined && Number(o.gross) > 0;
  const recoveredSeen = new Set(); const recoveredByRun = new Map();
  for (const o of orders) {
    const cost = unitCost(o.sku);
    const st = standing(o);
    const { back, held } = st;
    const heldOut = notCounted(o, st);
    let situation = 'Sold, kept'; let tone = 'green';
    const when = (it) => { const sh = rnr.shortStatus(it); return `${sh.action}${sh.deadlineText && sh.deadlineText !== '—' ? ` · ${sh.deadlineText}` : ''}`; };
    const soldHere = (Number(o.saleUnits) || 0) > 0;
    const where = o.moved ? ' in a later period' : (o.orphan ? ' (sold before the first statement)' : (st.elsewhere ? ' (refund not in a statement yet)' : ''));
    // the cost words belong to the row that sold the unit; a refund row in a
    // later period only carries the payout hit
    const costNote = (t) => (soldHere ? ` · ${t}` : '');
    if (!soldHere && !(o.refundUnits > 0)) { situation = o.note ? `${o.note} · no units` : 'Walmart adjustment on this PO · no units'; tone = 'grey'; }
    else if (st.kind === 'never') { situation = 'Refunded · never shipped'; tone = 'grey'; }
    else if (st.kind === 'manual') { situation = `Refunded${where} · marked received before the log`; tone = 'navy'; }
    else if (st.kind === 'back') { situation = `Refunded${where} · back in stock${costNote('cost recovered')}`; tone = 'navy'; }
    else if (st.kind === 'pending') { situation = `Refunded${where} · pending · ${when(st.it)}${costNote('not costed yet')}`; tone = 'amber'; }
    else if (st.kind === 'lost') { situation = st.it ? `Refunded${where} · ${when(st.it)}${costNote('cost charged')}` : `Refunded${where} · not received${costNote('cost charged')}`; tone = 'red'; }
    if (o.orphan) situation += heldOut ? ' · not counted against profit' : ' · counted against profit';
    // the statement's own words for the PO's fee lines (owner 2026-10-13:
    // "include if this is a shipping label charge"). On a refunded row they
    // lead, joined with +, so the charge reads first (owner 2026-10-15:
    // "put what the charge is before the refunded in a later period");
    // on a kept sale they follow as before
    if (o.note) {
      const fees = String(o.note).split(' · ').filter(Boolean).join(' + ');
      if (st.kind !== 'kept' && (o.refundUnits > 0 || st.elsewhere)) situation = `${fees} · ${situation}`;
      else if (soldHere) situation += ` · ${fees}`;
    }
    // a payout typed by hand (owner 2026-10-14): Walmart's own lands on a
    // later statement, so only money from outside Walmart — the shipping
    // insurance, the carrier — is added to profit here, once per PO
    const mkPaid = marksByPo.get(o.po);
    let recovered = 0;
    if (mkPaid && !mkPaid.removed && mkPaid.paidOut > 0 && !recoveredSeen.has(o.po)) {
      recoveredSeen.add(o.po);
      const outside = !/walmart/i.test(String(mkPaid.paidOutBy || 'Walmart'));
      if (outside) recovered = Math.round(mkPaid.paidOut * 100) / 100;
      situation += ` · ${outside ? `${mkPaid.paidOutBy} paid $${mkPaid.paidOut.toFixed(2)}` : `Walmart paid $${mkPaid.paidOut.toFixed(2)} (marked by hand)`}`;
    }
    tot.recovered += recovered; recoveredByRun.set(o.run_id, (recoveredByRun.get(o.run_id) || 0) + recovered);
    const line = { po: o.po, date: o.date || '', saleUnits: o.saleUnits, refundUnits: o.refundUnits, net: r2(o.netPayable), back: back > 0, pending: held > 0, notCounted: heldOut, situation, tone };
    const costedUnits = Math.max(0, o.saleUnits - back - held);
    const cogs = cost === null ? 0 : costedUnits * cost;
    const atRisk = cost === null ? 0 : held * cost;
    // a lost unit is counted on the row that sold it, once
    const lostUnits = st.kind === 'lost' ? Math.min((wholePo.get(o.po) || o).refundUnits, Number(o.saleUnits) || 0) : 0;
    tot.payout += o.netPayable; tot.orders++; tot.unitsSold += o.saleUnits; tot.unitsRefunded += o.refundUnits; tot.unitsBack += back;
    tot.atRisk += atRisk; tot.atRiskUnits += held; tot.lostUnits += lostUnits; if (st.kind === 'pending') tot.pendingOrders++;
    const isPriced = priced(o);
    const gross = isPriced ? Number(o.gross) : 0;
    const comm = isPriced && o.commission !== null && o.commission !== undefined ? Number(o.commission) : null;
    if (isPriced) { tot.pricedOrders++; tot.pricedUnits += o.saleUnits; } else if (o.saleUnits > 0) tot.unpricedOrders++;
    tot.gross += gross; if (comm !== null) { tot.commission += comm; tot.commGross += gross; tot.commissionKnown = true; }
    if (cost === null) { tot.missingCount++; tot.missingPayout += o.netPayable; missingSkus.add(o.sku || '(no SKU)'); }
    else { tot.cogs += cogs; if (heldOut) { tot.heldOut += -o.netPayable; tot.heldOutOrders++; } else tot.costedPayout += o.netPayable; }
    const heldOutAmt = heldOut && cost !== null ? -o.netPayable : 0;
    const k = o.sku || '(no SKU)';
    if (!bySku.has(k)) bySku.set(k, { sku: k, item: o.item || '', orders: 0, unitsSold: 0, unitsRefunded: 0, unitsBack: 0, unitsPending: 0, unitsLost: 0, atRisk: 0, payout: 0, cogs: 0, heldOut: 0, unitCost: cost, costKnown: cost !== null, gross: 0, commission: 0, commissionKnown: false, pricedUnits: 0, commGross: 0, lines: [] });
    const g = bySku.get(k);
    g.lines.push(line);
    if (!g.item && o.item) g.item = o.item;
    g.orders++; g.unitsSold += o.saleUnits; g.unitsRefunded += o.refundUnits; g.unitsBack += back; g.unitsPending += held; g.unitsLost += lostUnits; g.atRisk += atRisk; g.payout += o.netPayable; g.cogs += cogs; g.heldOut += heldOutAmt;
    g.gross += gross; if (isPriced) g.pricedUnits += o.saleUnits; if (comm !== null) { g.commission += comm; g.commGross += gross; g.commissionKnown = true; }
  }
  const skus = [...bySku.values()].map((g) => ({
    // the SKU's money is the counted money: a pre-tracking refund left out
    // of profit is left out of Walmart paid here too, so profit and margin
    // read off the same number (owner 2026-10-14: "why is the margin 100%")
    ...g, inv: invSku(g.sku), payout: r2(g.payout + g.heldOut), statementPayout: r2(g.payout), cogs: r2(g.cogs), heldOut: r2(g.heldOut), profit: r2(g.payout + g.heldOut - g.cogs),
    // refunds first, then newest sale first
    lines: g.lines.slice().sort((a, b) => (b.refundUnits > 0) - (a.refundUnits > 0) || String(b.date).localeCompare(String(a.date))),
    // the goods price per unit sold and Walmart's cut of it, from the
    // report's own lines (null where a period predates these columns)
    gross: r2(g.gross), commission: r2(g.commission), atRisk: r2(g.atRisk),
    avgPrice: g.pricedUnits > 0 && g.gross > 0 ? r2(g.gross / g.pricedUnits) : null,
    commissionPct: g.commissionKnown && g.commGross > 0 ? Math.round((-g.commission / g.commGross) * 1000) / 10 : null,
    // no margin without a sale: a fee credit alone would read 100% (owner 2026-10-14)
    margin: g.costKnown && g.unitsSold > 0 && g.payout + g.heldOut > 0 ? Math.round(((g.payout + g.heldOut - g.cogs) / (g.payout + g.heldOut)) * 1000) / 10 : null,
  })).sort((a, b) => b.payout - a.payout);
  // the same listings grouped under their Linnworks SKU; an unmapped
  // listing is a group of one, flagged so the owner can map it on Pricing
  const byInv = new Map();
  for (const g of skus) {
    const key = g.inv || g.sku; const mapped = !!g.inv;
    if (!byInv.has(key)) byInv.set(key, { sku: key, mapped, listings: [], item: '', orders: 0, unitsSold: 0, unitsRefunded: 0, unitsBack: 0, unitsPending: 0, unitsLost: 0, atRisk: 0, payout: 0, cogs: 0, heldOut: 0, gross: 0, commission: 0, commissionKnown: false, pricedUnits: 0, commGross: 0, unitCost: null, costKnown: false });
    const x = byInv.get(key);
    x.listings.push(g); if (!x.item && g.item) x.item = g.item;
    for (const f of ['orders', 'unitsSold', 'unitsRefunded', 'unitsBack', 'unitsPending', 'unitsLost', 'atRisk', 'payout', 'cogs', 'heldOut', 'gross', 'commission', 'pricedUnits', 'commGross']) x[f] += g[f] || 0;
    if (g.commissionKnown) x.commissionKnown = true;
    if (g.costKnown) { x.costKnown = true; if (x.unitCost === null) x.unitCost = g.unitCost; }
  }
  const groups = [...byInv.values()].map((x) => ({
    // the listings' payout is already the counted money
    ...x, payout: r2(x.payout), statementPayout: r2(x.payout - x.heldOut), cogs: r2(x.cogs), atRisk: r2(x.atRisk), heldOut: r2(x.heldOut), gross: r2(x.gross), commission: r2(x.commission), profit: r2(x.payout - x.cogs),
    avgPrice: x.pricedUnits > 0 && x.gross > 0 ? r2(x.gross / x.pricedUnits) : null,
    commissionPct: x.commissionKnown && x.commGross > 0 ? Math.round((-x.commission / x.commGross) * 1000) / 10 : null,
    margin: x.costKnown && x.unitsSold > 0 && x.payout > 0 ? Math.round(((x.payout - x.cogs) / x.payout) * 1000) / 10 : null,
    listings: x.listings.slice().sort((a, b) => b.payout - a.payout),
  })).sort((a, b) => b.payout - a.payout);
  const condMap = typeof deps.conditionMap === 'function' ? (deps.conditionMap() || {}) : {};
  const families = buildFamilies(groups, condMap);
  // Walmart lines that belong to no order: storage, ads, WFS inventory
  // adjustments… but never the transfers to the bank or the summary line
  // (a real report carried −$197,100 of Instant Transfers, 2026-10-12)
  const other = r2(ledger.filter((t) => !String(t.po || '').trim() && !/transfer|paymentsummary|payout/i.test(String(t.type || ''))).reduce((a, t) => a + (Number(t.amount) || 0), 0));
  // profit is measured on the orders that have a cost: payout from a
  // listing with no cost set is reported beside it, never counted as profit
  // (owner 2026-10-12: "why are my margins so high")
  const profitV = r2(tot.costedPayout - tot.cogs + tot.recovered);
  // the owner's own expenses in this scope come off the top
  const expList = expensesIn(scope, key);
  const expTotal = r2(expList.reduce((a, e) => a + (Number(e.amount) || 0), 0));
  const byCat = new Map();
  for (const e of expList) byCat.set(e.category || 'Other', r2((byCat.get(e.category || 'Other') || 0) + (Number(e.amount) || 0)));

  // every period, for the trend (newest first, by the period start)
  const periods = runs
    .map((r) => {
      const os = rowsIn((h) => h.run === r.id);
      let payout = 0; let costed = 0; let cogs = 0; let miss = 0; let units = 0; let atRisk = 0; let anyPriced = false; let heldOut = 0;
      for (const o of os) {
        const cost = unitCost(o.sku);
        const st = standing(o); const { back, held } = st;
        payout += o.netPayable; units += o.saleUnits; if (priced(o)) anyPriced = true;
        if (cost === null) miss++;
        else { if (notCounted(o, st)) heldOut += -o.netPayable; else costed += o.netPayable; cogs += Math.max(0, o.saleUnits - back - held) * cost; atRisk += held * cost; }
      }
      const rec = r2(recoveredByRun.get(r.id) || 0);
      return { id: r.id, label: r.label, orders: os.length, units, payout: r2(payout), costedPayout: r2(costed), cogs: r2(cogs), profit: r2(costed - cogs + rec), recovered: rec, atRisk: r2(atRisk), heldOut: r2(heldOut), priced: anyPriced, margin: costed > 0 ? Math.round(((costed - cogs + rec) / costed) * 1000) / 10 : null, missingCount: miss, hasOrders: os.length > 0 };
    })
    .sort((a, b) => periodStartMs({ label: b.label, ranAt: '' }) - periodStartMs({ label: a.label, ranAt: '' }));

  return {
    ok: true, scope, key, label,
    payout: r2(tot.payout), cogs: r2(tot.cogs), profit: profitV,
    margin: tot.costedPayout > 0 ? Math.round(((profitV - expTotal) / tot.costedPayout) * 1000) / 10 : null,
    expenses: { total: expTotal, count: expList.length, list: expList, byCategory: [...byCat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount), categories: EXPENSE_CATEGORIES },
    netProfit: r2(profitV - expTotal),
    orders: tot.orders, unitsSold: tot.unitsSold, unitsRefunded: tot.unitsRefunded, unitsBack: tot.unitsBack,
    gross: r2(tot.gross), commission: r2(tot.commission),
    commissionPct: tot.commissionKnown && tot.commGross > 0 ? Math.round((-tot.commission / tot.commGross) * 1000) / 10 : null,
    avgPrice: tot.pricedUnits > 0 && tot.gross > 0 ? r2(tot.gross / tot.pricedUnits) : null,
    priced: { orders: tot.pricedOrders, unpriced: tot.unpricedOrders, units: tot.pricedUnits },
    atRisk: { amount: r2(tot.atRisk), units: tot.atRiskUnits, orders: tot.pendingOrders }, lostUnits: tot.lostUnits,
    missing: { orders: tot.missingCount, skus: missingSkus.size, payout: r2(tot.missingPayout) },
    costedPayout: r2(tot.costedPayout), recovered: r2(tot.recovered), heldOut: { amount: r2(tot.heldOut), orders: tot.heldOutOrders }, other, netAfterOther: r2(profitV + other),
    skus, groups, families, periods, missingRuns,
  };
}

// The statement, laid out as Walmart's Payments page lays it out (owner
// 2026-10-13): Sales and Refunds by amount type, Fees and Adjustments by
// Walmart's own description, Paid to you by day, and the period's payable.
// This period reads that statement 1:1; Month, Year and All time add the
// statements up.
const STATEMENT_AMOUNT_LABELS = {
  'Product Price': 'Product price', Shipping: 'Shipping', 'Product tax': 'Net tax collected', 'Other tax (Fees)': 'Other taxes (fee)',
  'Commission on Product': 'Net commission', 'Commission on Shipping': 'Net commission', 'Product tax withheld': 'Net tax withheld',
  'Total Walmart Funded Savings': 'Total Walmart funded savings', 'Promo Code': 'Promo code', 'Payable to partner': 'Payable to partner',
};
// the issuer of a refund, from the statement's Transaction Description
const REFUND_ISSUERS = { 'return refund': 'Customer returns', 'seller initiated returns': 'Seller issued', 'walmart customer care refund': 'Walmart Customer Care issued' };
const refundIssuer = (desc) => { const d = String(desc || '').trim(); if (!d) return ''; return REFUND_ISSUERS[d.toLowerCase()] || d; };
const STATEMENT_SALES_ORDER = ['Product price', 'Shipping', 'Net tax collected', 'Other taxes (fee)', 'Net commission', 'Net tax withheld', 'Total Walmart funded savings', 'Promo code', 'Payable to partner'];
function statement(scope, key) {
  syncIn();
  ensureOrders();
  const yr = (d) => { const k = rnr.monthKeyOf(d); return k ? k.slice(0, 4) : null; };
  let lines; let label; let runs = [];
  if (scope === 'cycle') {
    const run = store.getRun(key);
    lines = run ? store.runLines(run.id) : []; label = run ? run.label : ''; runs = run ? [run] : [];
  } else if (scope === 'month') {
    lines = store.allLines().filter((l) => rnr.monthKeyOf(l.date) === key); label = monthLabel(String(key));
  } else if (scope === 'year') {
    lines = store.allLines().filter((l) => yr(l.date) === String(key)); label = String(key);
  } else {
    lines = store.allLines(); label = 'all time';
  }
  return buildStatement(lines, label, scope, key, runs, expensesIn(scope, key));
}

// every imported statement, newest period first, each with its full
// breakdown (owner 2026-10-13: "click on a statement and just have a
// dropdown with all the information"); the scope pill does not apply here
function statements() {
  syncIn();
  ensureOrders();
  const runs = store.listRunMeta().slice().sort((a, b) => periodStartMs(b) - periodStartMs(a) || String(b.ranAt).localeCompare(String(a.ranAt)));
  return { ok: true, statements: runs.map((run) => ({ id: run.id, ranAt: run.ranAt, ...buildStatement(store.runLines(run.id), run.label, 'cycle', run.id, [run], expensesIn('cycle', run.id)) })) };
}

function buildStatement(lines, label, scope, key, runs, exps) {
  const sections = new Map();
  const put = (section, name, amount, count, order, issuer) => {
    const s = sections.get(section) || { name: section, lines: new Map(), total: 0, order };
    const l = s.lines.get(name) || { label: name, amount: 0, count: 0, by: new Map() };
    l.amount += amount; l.count += count; s.lines.set(name, l); s.total += amount;
    // who issued a refund (owner 2026-10-13): the statement's own words,
    // folded to three — the customer, the seller, Walmart Customer Care
    if (issuer) { const b = l.by.get(issuer) || { label: issuer, amount: 0, count: 0 }; b.amount += amount; b.count += count; l.by.set(issuer, b); }
    sections.set(section, s);
  };
  let payable = 0; let payableSeen = false;
  const paid = [];
  for (const l of lines) {
    const t = l.type;
    if (t === 'PaymentSummary') { payable += l.amount; payableSeen = true; continue; }
    if (t === 'Sale' || t === 'Refund') { put(t === 'Sale' ? 'Sales' : 'Refunds', STATEMENT_AMOUNT_LABELS[l.amountType] || l.amountType || l.desc || t, l.amount, l.count, t === 'Sale' ? 1 : 2, t === 'Refund' ? refundIssuer(l.desc) : ''); continue; }
    if (t === 'Instant Transfer' || /payout|transfer/i.test(t)) { paid.push({ date: l.date, amount: -l.amount, desc: l.desc }); continue; }
    if (t === 'Service Fee') { put('Fees', l.desc || l.amountType || t, l.amount, l.count, 3); continue; }
    if (t === 'Adjustment' || t === 'Dispute Settlement') { put('Adjustments', l.desc || t, l.amount, l.count, 4); continue; }
    put('Other activities', l.desc || l.amountType || t, l.amount, l.count, 5);
  }
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const out = [...sections.values()].sort((a, b) => a.order - b.order).map((s) => ({
    name: s.name, total: r2(s.total),
    lines: [...s.lines.values()].sort((a, b) => {
      const ia = STATEMENT_SALES_ORDER.indexOf(a.label); const ib = STATEMENT_SALES_ORDER.indexOf(b.label);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return Math.abs(b.amount) - Math.abs(a.amount);
    }).map((l) => ({ label: l.label, amount: r2(l.amount), count: l.count, by: l.by && (l.by.size > 1 || (l.by.size === 1 && !l.by.has('Customer returns'))) ? [...l.by.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).map((b) => ({ label: b.label, amount: r2(b.amount), count: b.count })) : [] })),
  }));
  // the owner's own expenses, as a section of their own
  if (exps.length) {
    const byCat = new Map();
    for (const e of exps) byCat.set(e.category || 'Other', (byCat.get(e.category || 'Other') || 0) + (Number(e.amount) || 0));
    out.push({ name: 'Your expenses', total: r2(-[...byCat.values()].reduce((a, v) => a + v, 0)), lines: [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ label: category, amount: r2(-amount), count: exps.filter((e) => (e.category || 'Other') === category).length })) });
  }
  const activity = r2(out.reduce((a, s) => a + s.total, 0));
  // by day, newest first; the bank transfers are negative lines on the statement
  const paidByDay = new Map();
  for (const p of paid) { const k = p.date || ''; paidByDay.set(k, r2((paidByDay.get(k) || 0) + p.amount)); }
  const paidOut = [...paidByDay.entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0]))).map(([date, amount]) => ({ date, amount }));
  return {
    ok: true, scope, key, label, runs: runs.length, sections: out, activity,
    payable: payableSeen ? r2(payable) : null, paid: paidOut, paidTotal: r2(paidOut.reduce((a, p) => a + p.amount, 0)),
    hasLines: lines.length > 0,
  };
}

function profitWorkbook(scope, key) {
  const { buildWorkbookSheets } = require('../xlsxwrite');
  const p = profit(scope, key);
  const money = 'money';
  return { label: p.label, buffer: buildWorkbookSheets([
    { name: 'Summary', columns: [{ header: `Profit — ${p.label}`, width: 36, kind: 'text' }, { header: 'Amount', width: 16, kind: money }], rows: [
      ['Walmart paid (orders net of fees and refunds)', p.payout], ['Walmart paid on costed orders', p.costedPayout], ['Cost of goods sold', p.cogs], ['Profit (costed orders)', p.profit], ['Margin %', p.margin ?? ''],
      ['Other Walmart lines (no order)', p.other], ['Net after other lines', p.netAfterOther],
      ['Your expenses', p.expenses.total], ['Profit after expenses', p.netProfit],
      ['At risk (pending returns, not costed yet)', p.atRisk.amount], ['Units pending return', p.atRisk.units], ['Units lost (costed)', p.lostUnits],
      ['Orders', p.orders], ['Units sold', p.unitsSold], ['Units refunded', p.unitsRefunded], ['Units back in stock', p.unitsBack],
      ['Orders with no cost set', p.missing.orders], ['Their payout', p.missing.payout],
    ] },
    { name: 'By SKU', columns: [
      { header: 'Linnworks SKU', width: 24, kind: 'text' }, { header: 'Walmart SKU', width: 26, kind: 'text' }, { header: 'Product', width: 48, kind: 'text' }, { header: 'Orders', width: 8, kind: 'int' }, { header: 'Units sold', width: 10, kind: 'int' },
      { header: 'Refunded', width: 9, kind: 'int' }, { header: 'Back in stock', width: 12, kind: 'int' }, { header: 'Avg price', width: 10, kind: money }, { header: 'Commission %', width: 12, kind: 'text' }, { header: 'Walmart paid', width: 14, kind: money }, { header: 'Unit cost', width: 10, kind: money },
      { header: 'Cost of goods', width: 14, kind: money }, { header: 'Profit', width: 12, kind: money }, { header: 'Margin %', width: 9, kind: 'text' },
    ], rows: p.skus.map((g) => [g.inv || '', g.sku, g.item, g.orders, g.unitsSold, g.unitsRefunded, g.unitsBack, g.avgPrice ?? '', g.commissionPct ?? '', g.payout, g.costKnown ? g.unitCost : '', g.costKnown ? g.cogs : '', g.costKnown ? g.profit : '', g.margin ?? (g.costKnown ? '' : 'no cost set')]) },
    { name: 'By period', columns: [
      { header: 'Period', width: 24, kind: 'text' }, { header: 'Orders', width: 8, kind: 'int' }, { header: 'Units', width: 8, kind: 'int' }, { header: 'Walmart paid', width: 14, kind: money },
      { header: 'Cost of goods', width: 14, kind: money }, { header: 'Profit', width: 12, kind: money }, { header: 'Margin %', width: 9, kind: 'text' }, { header: 'Orders without cost', width: 18, kind: 'int' },
    ], rows: p.periods.map((x) => [x.label, x.orders, x.units, x.payout, x.cogs, x.profit, x.margin ?? '', x.missingCount]) },
    { name: 'Expenses', columns: [
      { header: 'Date', width: 12, kind: 'text' }, { header: 'Category', width: 16, kind: 'text' }, { header: 'Note', width: 40, kind: 'text' }, { header: 'SKU', width: 24, kind: 'text' }, { header: 'Amount', width: 12, kind: money }, { header: 'Entered by', width: 16, kind: 'text' },
    ], rows: p.expenses.list.map((e) => [e.dateTo ? `${e.date} – ${e.dateTo}` : e.date, e.category, e.note, e.sku, e.amount, [e.station, e.by].filter(Boolean).join(' · ')]) },
  ]) };
}

/* ---------- alerts (§9) ---------- */

function digest() {
  const { items } = decoratedItems();
  return rnr.buildDigest(items);
}

// POST the digest to the make.com webhook; quiet when there is no URL,
// nothing to say, or the same set went out within ~20h (unless forced)
async function sendDigest({ force = false } = {}) {
  const cfg = cfgRecovery();
  const url = String(cfg.webhookUrl || '').trim();
  if (!/^https:\/\//i.test(url)) return { sent: false, reason: 'no_url' };
  const dg = digest();
  if (!dg) return { sent: false, reason: 'nothing_to_send' };
  const RESEND_MS = 20 * 60 * 60 * 1000;
  if (!force && cfg.lastDigestKey === dg.key && Date.now() - (Number(cfg.lastDigestAt) || 0) < RESEND_MS) {
    return { sent: false, reason: 'already_sent' };
  }
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject: dg.subject, html: dg.html, count: dg.count, total: dg.total, items: dg.items }),
  });
  if (!resp.ok) return { sent: false, reason: `http_${resp.status}` };
  deps.config.save({ recovery: { lastDigestKey: dg.key, lastDigestAt: Date.now() } });
  return { sent: true, count: dg.count, total: dg.total };
}

function mailto() {
  const { items } = decoratedItems();
  const email = String(cfgRecovery().email || '').trim();
  if (!email) return { ok: false, error: 'Set the alert email address in Settings → Recovery first.' };
  const m = rnr.mailtoFor(email, items);
  return m ? { ok: true, ...m } : { ok: false, error: 'Nothing needs action right now.' };
}

module.exports = {
  configure, importReport, removeRun, importWfsReport, removeWfsReport, wfsInventory, state, runDetail, mark, markMany, markFile, summary, monthLabel, profit, profitWorkbook, statement, statements, syncStatus, resync, addExpense, removeExpense,
  runWorkbook, auditWorkbook, summaryWorkbook, viewCsv, digest, sendDigest, mailto, syncIn, archivePath,
  // for tests
  _internal: { trackerItemsFromStored, applyRunEvent, applyWfsEvent, decoratedItems, warehouse, buildFamilies },
};
