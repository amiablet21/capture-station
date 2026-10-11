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
const { parseReport } = require('./parseReport');
const { findIssues, returnsToWarehouseRows } = require('./reconcile');
const { classify, toSummary, buildRunWorkbook } = require('./classify');
const { formatPeriod, periodFromReportName, parsePeriodLabel } = require('./period');

let deps = null; // { retsync, listReturns, config, archiveDir, station, by }
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
    refunds: store.runRefunds(run.id), payouts: store.runPayouts(run.id), ledger: store.runLedger(run.id),
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
    'Net Refund (Payable Impact)': r.net, 'Return Reason': r.reason, 'Fulfillment Type': r.fulfillment,
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
  store.putRun(run, refunds, ev.payouts || [], ev.ledger || []);
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
    deps.retsync.auxBackfill('wmruns', () => store.ownRuns(mine()).map((r) => runEvent(r, r.syncTs || Date.parse(r.ranAt) || Date.now())));
    deps.retsync.auxBackfill('wmmarks', () => store.ownMarks(mine()));
  } catch { /* folder unreachable: the local tables stand alone */ }
  syncBusy = false;
}

/* ---------- import (§3) ---------- */

const safeLabel = (label) => String(label).replace(/[\\/:*?"<>|]/g, '-');
function archivePath(label) { return path.join(deps.archiveDir, `Walmart_Report_${safeLabel(label)}.csv`); }

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

  const label =
    formatPeriod(period.start, period.end) ||
    String(name || 'report').replace(/\.csv$/i, '').replace('Digital_World_Shop_10001467995_MP_', '').replace('_reconciliationreport', '');

  const csvHash = crypto.createHash('sha256').update(csvText).digest('hex');
  if (!force) {
    const dup = store.findRunByHash(csvHash) || store.findRunByLabel(label);
    if (dup) {
      return { alreadyImported: true, sameFile: dup.csvHash === csvHash, label: dup.label, ranAt: dup.ranAt, csvName: dup.csvName || '' };
    }
  }

  // keep the original report, named by its period, in a folder the owner can
  // open from Settings; a re-import overwrites the period's file
  let archived = '';
  try {
    fs.mkdirSync(deps.archiveDir, { recursive: true });
    fs.writeFileSync(archivePath(label), csvText, 'utf8');
    archived = archivePath(label);
  } catch { /* the run keeps everything it parsed */ }

  onProgress('Summarizing…');
  const { rows, counts } = classify(seller, wfs);
  const summary = toSummary(rows);

  // a re-import of the same period replaces the old run (and its items)
  const replaced = store.findRunByLabel(label);
  const ts = Date.now();
  if (replaced) deleteRunLocal(replaced.id, ts - 1);

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
    wh_price: r['Warehouse Price'], wh_condition: r['Warehouse Condition'] || '',
  }));
  const payoutRows = Object.entries(parsed.payouts).map(([po, v]) => ({ po, amount: v.amount, date: v.date || '', kind: v.kind || '' }));
  store.putRun(run, refundRows, payoutRows, parsed.ledger);
  store.addItems(rnr.trackerRows(seller, wfs).map((r) => rnr.itemFromRow(r, runId, run.ranAt)));
  if (replaced) { try { deps.retsync.appendAux('wmruns', { op: 'del', id: replaced.id, ts: ts - 1 }); } catch { /* offline */ } }
  try { deps.retsync.appendAux('wmruns', runEvent(run, ts)); } catch { /* offline: the local run stands */ }

  const result = {
    ok: true, id: runId, label, format, totalRefunds: refunds.length, sellerCount: seller.length, wfsCount: wfs.length,
    logRows: wh.logRows, counts, replaced: !!replaced, archived,
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
  const visible = items.filter((i) => i.status !== 'received');
  const sorted = runs.slice().sort((a, b) => periodStartMs(b) - periodStartMs(a) || String(b.ranAt).localeCompare(String(a.ranAt)));
  const openByRun = {};
  for (const it of visible) if (it.status === 'outstanding') openByRun[it.sourceRunId] = (openByRun[it.sourceRunId] || 0) + 1;
  const cfg = cfgRecovery();
  return {
    ok: true,
    runs: sorted.map((r) => ({ ...r, open: openByRun[r.id] || 0 })),
    // each row carries its sentence and its list tab, so the renderer only draws
    items: visible.map((it) => ({ ...it, statusText: rnr.statusText(it), tab: rnr.filterOf(it) })),
    today: rnr.todayCounts(visible),
    months: monthKeys(items),
    settings: { email: cfg.email || '', webhookUrl: cfg.webhookUrl || '', archiveDir: deps.archiveDir, syncOn: !!(deps.retsync && deps.retsync.enabled()) },
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
  configure, importReport, removeRun, state, runDetail, mark, summary, monthLabel,
  runWorkbook, auditWorkbook, summaryWorkbook, viewCsv, digest, sendDigest, mailto, syncIn, archivePath,
  // for tests
  _internal: { trackerItemsFromStored, applyRunEvent, decoratedItems, warehouse },
};
