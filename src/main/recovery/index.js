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
    refunds: store.runRefunds(run.id), payouts: store.runPayouts(run.id), ledger: store.runLedger(run.id), orders: store.runOrders(run.id),
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
  store.putRun(run, refunds, ev.payouts || [], ev.ledger || [], ev.orders || null);
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
const archiveDir = () => (typeof deps.archiveDir === 'function' ? deps.archiveDir() : deps.archiveDir);
function archivePath(label) { return path.join(archiveDir(), `Walmart_Report_${safeLabel(label)}.csv`); }

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
    fs.mkdirSync(archiveDir(), { recursive: true });
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
    wh_price: r['Warehouse Price'], wh_condition: r['Warehouse Condition'] || '', refunded_by: r['Refunded By'] || '',
  }));
  const payoutRows = Object.entries(parsed.payouts).map(([po, v]) => ({ po, amount: v.amount, date: v.date || '', kind: v.kind || '' }));
  store.putRun(run, refundRows, payoutRows, parsed.ledger, parsed.orders);
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
const pricesTried = new Set(); // runs whose archive was looked for once this session
const byTried = new Set();
function ensureOrders() {
  const missing = [];
  for (const r of store.runsWithoutOrders()) {
    const f = archivePath(r.label);
    try {
      if (!fs.existsSync(f)) { missing.push(r.label); continue; }
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
    if (pricesTried.has(r.id)) continue;
    pricesTried.add(r.id);
    const f = archivePath(r.label);
    try {
      if (!fs.existsSync(f)) continue;
      const parsed = parseReport(fs.readFileSync(f, 'utf8'));
      if (parsed.orders.length) store.putOrders(r.id, parsed.orders);
    } catch { /* next time the file is readable */ }
  }
  // likewise who issued each refund, for runs stored before v1.32.15
  for (const r of store.runsWithoutRefundedBy()) {
    if (byTried.has(r.id)) continue;
    byTried.add(r.id);
    const f = archivePath(r.label);
    try {
      if (!fs.existsSync(f)) continue;
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
    const direct = costs[k];
    if (direct && Number.isFinite(Number(direct.cost))) return Number(direct.cost);
    const inv = chan.get(k);
    const viaMap = inv ? costs[String(inv).toUpperCase()] : null;
    return viaMap && Number.isFinite(Number(viaMap.cost)) ? Number(viaMap.cost) : null;
  };

  // the orders and the non-order ledger lines in scope
  let orders; let ledger; let label;
  if (scope === 'cycle') {
    const run = store.getRun(key);
    orders = run ? store.runOrders(run.id) : [];
    ledger = run ? store.runLedger(run.id) : [];
    label = run ? run.label : '';
  } else if (scope === 'month') {
    orders = store.allOrders().filter((o) => rnr.monthKeyOf(o.date) === key);
    ledger = rnr.dedupeLedger(store.allLedger()).filter((t) => rnr.monthKeyOf(t.date) === key);
    label = monthLabel(String(key));
  } else if (scope === 'year') {
    const yr = (d) => { const k = rnr.monthKeyOf(d); return k ? k.slice(0, 4) : null; };
    orders = store.allOrders().filter((o) => yr(o.date) === String(key));
    ledger = rnr.dedupeLedger(store.allLedger()).filter((t) => yr(t.date) === String(key));
    label = String(key);
  } else {
    orders = store.allOrders();
    ledger = rnr.dedupeLedger(store.allLedger());
    label = 'all time';
  }

  const bySku = new Map();
  const tot = { payout: 0, cogs: 0, orders: 0, unitsSold: 0, unitsRefunded: 0, unitsBack: 0, missingCount: 0, missingPayout: 0, costedPayout: 0, gross: 0, commission: 0, commissionKnown: false };
  const missingSkus = new Set();
  // each SKU also lists its POs with a situation (owner 2026-10-12: "a
  // dropdown where I can see all the relevant PO#s for each item")
  const trackerByPo = new Map(decoratedItems().items.map((it) => [it.po, it]));
  const marksByPo = store.allMarks();
  for (const o of orders) {
    const cost = unitCost(o.sku);
    const mk = marksByPo.get(o.po);
    const manual = !!(mk && !mk.removed && mk.receivedManual);
    const never = !!(mk && !mk.removed && mk.neverShipped);
    // came back (logged, or marked received before the log): cost recovered;
    // never shipped: nothing left the warehouse, so nothing to cost
    const back = o.refundUnits > 0 && (whPo.has(o.po) || manual) ? Math.min(o.refundUnits, o.saleUnits) : (never ? o.saleUnits : 0);
    let situation = 'Sold, kept'; let tone = 'green';
    if (never) { situation = 'Refunded · never shipped'; tone = 'grey'; }
    else if (o.refundUnits > 0) {
      if (manual) { situation = 'Refunded · marked received before the log'; tone = 'navy'; }
      else if (back > 0) { situation = 'Refunded · back in stock · cost recovered'; tone = 'navy'; }
      else {
        const it = trackerByPo.get(o.po);
        if (it) { const sh = rnr.shortStatus(it); situation = `Refunded · ${sh.action}${sh.deadlineText && sh.deadlineText !== '—' ? ` · ${sh.deadlineText}` : ''}`; tone = sh.tone; }
        else { situation = 'Refunded · not received'; tone = 'red'; }
      }
    }
    const line = { po: o.po, date: o.date || '', saleUnits: o.saleUnits, refundUnits: o.refundUnits, net: r2(o.netPayable), back: back > 0, situation, tone };
    const costedUnits = Math.max(0, o.saleUnits - back);
    const cogs = cost === null ? 0 : costedUnits * cost;
    tot.payout += o.netPayable; tot.orders++; tot.unitsSold += o.saleUnits; tot.unitsRefunded += o.refundUnits; tot.unitsBack += back;
    const gross = Number.isFinite(Number(o.gross)) && o.gross !== null ? Number(o.gross) : 0;
    const comm = o.commission === null || o.commission === undefined ? null : Number(o.commission);
    tot.gross += gross; if (comm !== null) { tot.commission += comm; tot.commissionKnown = true; }
    if (cost === null) { tot.missingCount++; tot.missingPayout += o.netPayable; missingSkus.add(o.sku || '(no SKU)'); }
    else { tot.cogs += cogs; tot.costedPayout += o.netPayable; }
    const k = o.sku || '(no SKU)';
    if (!bySku.has(k)) bySku.set(k, { sku: k, item: o.item || '', orders: 0, unitsSold: 0, unitsRefunded: 0, unitsBack: 0, payout: 0, cogs: 0, unitCost: cost, costKnown: cost !== null, gross: 0, commission: 0, commissionKnown: false, lines: [] });
    const g = bySku.get(k);
    g.lines.push(line);
    if (!g.item && o.item) g.item = o.item;
    g.orders++; g.unitsSold += o.saleUnits; g.unitsRefunded += o.refundUnits; g.unitsBack += back; g.payout += o.netPayable; g.cogs += cogs;
    g.gross += gross; if (comm !== null) { g.commission += comm; g.commissionKnown = true; }
  }
  const skus = [...bySku.values()].map((g) => ({
    ...g, payout: r2(g.payout), cogs: r2(g.cogs), profit: r2(g.payout - g.cogs),
    // refunds first, then newest sale first
    lines: g.lines.slice().sort((a, b) => (b.refundUnits > 0) - (a.refundUnits > 0) || String(b.date).localeCompare(String(a.date))),
    // the goods price per unit sold and Walmart's cut of it, from the
    // report's own lines (null where a period predates these columns)
    gross: r2(g.gross), commission: r2(g.commission),
    avgPrice: g.unitsSold > 0 && g.gross > 0 ? r2(g.gross / g.unitsSold) : null,
    commissionPct: g.commissionKnown && g.gross > 0 ? Math.round((-g.commission / g.gross) * 1000) / 10 : null,
    margin: g.costKnown && g.payout > 0 ? Math.round(((g.payout - g.cogs) / g.payout) * 1000) / 10 : null,
  })).sort((a, b) => b.payout - a.payout);
  // Walmart lines that belong to no order: storage, ads, WFS inventory
  // adjustments… but never the transfers to the bank or the summary line
  // (a real report carried −$197,100 of Instant Transfers, 2026-10-12)
  const other = r2(ledger.filter((t) => !String(t.po || '').trim() && !/transfer|paymentsummary|payout/i.test(String(t.type || ''))).reduce((a, t) => a + (Number(t.amount) || 0), 0));
  const profitV = r2(tot.payout - tot.cogs);

  // every period, for the trend (newest first, by the period start)
  const periods = runs
    .map((r) => {
      const os = store.runOrders(r.id);
      let payout = 0; let cogs = 0; let miss = 0; let units = 0;
      for (const o of os) {
        const cost = unitCost(o.sku);
        const back = o.refundUnits > 0 && whPo.has(o.po) ? Math.min(o.refundUnits, o.saleUnits) : 0;
        payout += o.netPayable; units += o.saleUnits;
        if (cost === null) miss++; else cogs += Math.max(0, o.saleUnits - back) * cost;
      }
      return { id: r.id, label: r.label, orders: os.length, units, payout: r2(payout), cogs: r2(cogs), profit: r2(payout - cogs), margin: payout > 0 ? Math.round(((payout - cogs) / payout) * 1000) / 10 : null, missingCount: miss, hasOrders: os.length > 0 };
    })
    .sort((a, b) => periodStartMs({ label: b.label, ranAt: '' }) - periodStartMs({ label: a.label, ranAt: '' }));

  return {
    ok: true, scope, key, label,
    payout: r2(tot.payout), cogs: r2(tot.cogs), profit: profitV,
    margin: tot.payout > 0 ? Math.round((profitV / tot.payout) * 1000) / 10 : null,
    orders: tot.orders, unitsSold: tot.unitsSold, unitsRefunded: tot.unitsRefunded, unitsBack: tot.unitsBack,
    gross: r2(tot.gross), commission: r2(tot.commission),
    commissionPct: tot.commissionKnown && tot.gross > 0 ? Math.round((-tot.commission / tot.gross) * 1000) / 10 : null,
    missing: { orders: tot.missingCount, skus: missingSkus.size, payout: r2(tot.missingPayout) },
    costedPayout: r2(tot.costedPayout), other, netAfterOther: r2(profitV + other),
    skus, periods, missingRuns,
  };
}

function profitWorkbook(scope, key) {
  const { buildWorkbookSheets } = require('../xlsxwrite');
  const p = profit(scope, key);
  const money = 'money';
  return { label: p.label, buffer: buildWorkbookSheets([
    { name: 'Summary', columns: [{ header: `Profit — ${p.label}`, width: 36, kind: 'text' }, { header: 'Amount', width: 16, kind: money }], rows: [
      ['Walmart paid (orders net of fees and refunds)', p.payout], ['Cost of goods sold', p.cogs], ['Profit', p.profit], ['Margin %', p.margin ?? ''],
      ['Other Walmart lines (no order)', p.other], ['Net after other lines', p.netAfterOther],
      ['Orders', p.orders], ['Units sold', p.unitsSold], ['Units refunded', p.unitsRefunded], ['Units back in stock', p.unitsBack],
      ['Orders with no cost set', p.missing.orders], ['Their payout', p.missing.payout],
    ] },
    { name: 'By SKU', columns: [
      { header: 'Walmart SKU', width: 26, kind: 'text' }, { header: 'Product', width: 48, kind: 'text' }, { header: 'Orders', width: 8, kind: 'int' }, { header: 'Units sold', width: 10, kind: 'int' },
      { header: 'Refunded', width: 9, kind: 'int' }, { header: 'Back in stock', width: 12, kind: 'int' }, { header: 'Avg price', width: 10, kind: money }, { header: 'Commission %', width: 12, kind: 'text' }, { header: 'Walmart paid', width: 14, kind: money }, { header: 'Unit cost', width: 10, kind: money },
      { header: 'Cost of goods', width: 14, kind: money }, { header: 'Profit', width: 12, kind: money }, { header: 'Margin %', width: 9, kind: 'text' },
    ], rows: p.skus.map((g) => [g.sku, g.item, g.orders, g.unitsSold, g.unitsRefunded, g.unitsBack, g.avgPrice ?? '', g.commissionPct ?? '', g.payout, g.costKnown ? g.unitCost : '', g.costKnown ? g.cogs : '', g.costKnown ? g.profit : '', g.margin ?? (g.costKnown ? '' : 'no cost set')]) },
    { name: 'By period', columns: [
      { header: 'Period', width: 24, kind: 'text' }, { header: 'Orders', width: 8, kind: 'int' }, { header: 'Units', width: 8, kind: 'int' }, { header: 'Walmart paid', width: 14, kind: money },
      { header: 'Cost of goods', width: 14, kind: money }, { header: 'Profit', width: 12, kind: money }, { header: 'Margin %', width: 9, kind: 'text' }, { header: 'Orders without cost', width: 18, kind: 'int' },
    ], rows: p.periods.map((x) => [x.label, x.orders, x.units, x.payout, x.cogs, x.profit, x.margin ?? '', x.missingCount]) },
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
  configure, importReport, removeRun, state, runDetail, mark, markMany, markFile, summary, monthLabel, profit, profitWorkbook,
  runWorkbook, auditWorkbook, summaryWorkbook, viewCsv, digest, sendDigest, mailto, syncIn, archivePath,
  // for tests
  _internal: { trackerItemsFromStored, applyRunEvent, decoratedItems, warehouse },
};
