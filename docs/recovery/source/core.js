/**
 * Shared business operations for both the Electron app (main.js) and the
 * localhost web server (server.js). All file/OS specifics (dialogs, native
 * notifications, shell-open) stay in the thin wrappers; everything here is
 * data-directory-parameterized and platform-agnostic.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Papa = require("papaparse");

const { loadRefunds, loadOrders, loadTransactions, loadDailySeries, loadSettlements, loadStatement, toIsoDay } = require("./parseReport");
const store = require("./warehouseStore");
const { parseImportCsv, mapHeaderIndices } = require("./importCsv");
const { findIssues } = require("./reconcile");
const { classify, toSummary, writeWorkbook } = require("./excel");
const { formatPeriod } = require("./period");
const wfsWatch = require("./wfsWatch");
const nrWatch = require("./notReceivedWatch");
const rnr = require("./rnrStore");
const profitStore = require("./profitStore");
const pricingStore = require("./pricingStore");
const orderNotes = require("./orderNotesStore");

let DATA_DIR = null;
let OUTPUTS_DIR = null;
let TMP_DIR = null;

function configure({ dataDir, outputsDir }) {
  DATA_DIR = dataDir;
  OUTPUTS_DIR = outputsDir;
  TMP_DIR = path.join(dataDir, "tmp");
  fs.mkdirSync(TMP_DIR, { recursive: true });
  store.init(dataDir);
  wfsWatch.init(dataDir);
  nrWatch.init(dataDir);
  rnr.init(dataDir);
  profitStore.init(dataDir);
  pricingStore.init(dataDir);
  orderNotes.init(dataDir);
  // one-time: seed the unified Returns Not Received store from the two legacy
  // trackers if it doesn't exist yet (fresh install / first run after upgrade)
  if (!fs.existsSync(path.join(dataDir, "rnr.json"))) {
    rnr.save(rnr.migrateFrom(wfsWatch.load(), nrWatch.load()));
  }
  migrateRnrLossesOutOfWarehouse(); // pull old RNR write-offs off the warehouse Loss list
  try { migrateRunLabels(); } catch { /* best-effort */ }
  try { backfillImportedReports(); } catch { /* best-effort — real imports still archive */ }
}

// One-time: relabel runs whose label came from the misleading refund-date span.
// Derive the true payment period from the report filename's payment date and
// rename the run's files to match. Idempotent — derived == stored → untouched.
function migrateRunLabels() {
  const runs = loadHistory();
  let changed = false;
  const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, "-");
  for (const r of runs) {
    const p = periodFromReportName(r.csvName);
    if (!p) continue;
    const label = formatPeriod(p.start, p.end);
    if (!label || label === r.label) continue;
    if (r.outputPath && fs.existsSync(r.outputPath)) {
      const np = path.join(path.dirname(r.outputPath), `Reconciliation_${label}.xlsx`);
      try { fs.renameSync(r.outputPath, np); r.outputPath = np; } catch { /* keep old file name */ }
    }
    if (r.importedPath && fs.existsSync(r.importedPath)) {
      const rebuilt = / \(rebuilt\)\.csv$/i.test(r.importedPath);
      const np = path.join(path.dirname(r.importedPath), `Walmart_Report_${safe(label)}${rebuilt ? " (rebuilt)" : ""}.csv`);
      try { fs.renameSync(r.importedPath, np); r.importedPath = np; } catch { /* keep old file name */ }
    }
    r.label = label;
    changed = true;
  }
  if (changed) fs.writeFileSync(historyPath(), JSON.stringify({ runs }, null, 2));
}

// Where everything lives on disk — surfaced in the UI via "Open data folder" /
// "Open reports folder" so users can find their files.
function paths() {
  return { dataDir: DATA_DIR, reportsDir: OUTPUTS_DIR, importsDir: path.join(OUTPUTS_DIR, "Imported Walmart Reports") };
}

const historyPath = () => path.join(DATA_DIR, "history.json");

function loadHistory() {
  try {
    const runs = JSON.parse(fs.readFileSync(historyPath(), "utf8")).runs;
    return Array.isArray(runs) ? runs : [];
  } catch {
    return [];
  }
}

function saveRun(run) {
  // re-running the same period replaces the old entry (same output file anyway)
  const runs = loadHistory().filter((r) => r.label !== run.label);
  runs.unshift(run);
  fs.writeFileSync(historyPath(), JSON.stringify({ runs }, null, 2));
}

// fileExists: legacy runs (before summaries were kept in-app) still point at the
// workbook they wrote; newer runs carry `summary` and build Excel on demand.
const withFileExists = (r) => ({ ...r, fileExists: !!r.outputPath && fs.existsSync(r.outputPath) });

// Build the Excel workbook for a past run on demand, from its stored summary.
async function exportRun(id, outputPath) {
  const run = loadHistory().find((r) => r.id === id);
  if (!run) throw new Error("That report is no longer in Past reports.");
  if (!run.summary) throw new Error("This report was imported by an older version — re-import its CSV to enable Excel download.");
  await writeWorkbook(run.summary, outputPath, run.label);
  const s = run.summary;
  return { count: s.received.length + s.notReceived.length + s.wfsWaiting.length };
}

function listHistory() {
  return loadHistory().map(withFileExists);
}

function deleteHistory(id) {
  const gone = loadHistory().find((r) => r.id === id);
  const runs = loadHistory().filter((r) => r.id !== id);
  fs.writeFileSync(historyPath(), JSON.stringify({ runs }, null, 2));
  // deleting a period takes its archived source file with it
  if (gone && gone.importedPath) { try { fs.unlinkSync(gone.importedPath); } catch { /* already gone */ } }
  // deleting a report takes its side data with it: WFS watch + trackers + profit
  wfsWatch.removeByRun(id);
  nrWatch.removeByRun(id);
  rnr.removeByRun(id);
  profitStore.deleteOrdersRun(id);
  return runs.map(withFileExists);
}

// Derived warehouse views, rebuilt only when warehouse.json changes — they're
// read on every RNR/WFS/profit refresh, and building them parsed the 1MB+ log
// each time. Two shapes: a Set of received PO #s (presence, for RNR/WFS "did it
// come back") and a Map of PO # -> units received (for capping the profit COGS
// credit). Both are read-only to callers.
let _whCache = null; // { sig, set, units }
function whDerived() {
  const sig = store.signature();
  if (_whCache && _whCache.sig === sig) return _whCache;
  const set = new Set(store.toReconcileRows(store.load()).map((r) => r["PO #"]));
  _whCache = { sig, set, units: store.receivedUnitsByPo() };
  return _whCache;
}
const warehousePoSet = () => whDerived().set;
const warehouseReceivedUnits = () => whDerived().units;

// re-check the WFS watchlist; prune items whose source report was deleted
function checkWfs() {
  wfsWatch.pruneOrphans(new Set(loadHistory().map((r) => r.id)));
  return wfsWatch.refreshStatuses(warehousePoSet());
}

function checkNotReceived() {
  nrWatch.pruneOrphans(new Set(loadHistory().map((r) => r.id)));
  return nrWatch.refreshStatuses(warehousePoSet());
}

// Sum every report's stored Walmart-payout map into one { po: { amount, date } }.
// A given payout lives in exactly one report (distinct periods), so summing
// across runs is correct and never double-counts.
function aggregateSettlements() {
  const byPo = {};
  for (const r of loadHistory()) {
    const s = profitStore.loadSettlementsRun(r.id);
    if (!s) continue;
    for (const [po, v] of Object.entries(s)) {
      if (!v || !(v.amount > 0)) continue;
      if (!byPo[po]) byPo[po] = { amount: 0, date: v.date || null, kind: v.kind || null };
      else if (v.kind && byPo[po].kind && byPo[po].kind !== v.kind) byPo[po].kind = "mixed";
      else if (v.kind && !byPo[po].kind) byPo[po].kind = v.kind;
      byPo[po].amount += v.amount;
      if (!byPo[po].date && v.date) byPo[po].date = v.date;
    }
  }
  return byPo;
}

// unified Returns Not Received: prune orphans, re-derive Walmart payouts from
// every stored report, then re-derive each status from the source-of-truth
// lists (warehouse Received, warehouse Loss, settlements)
function checkRnr() {
  rnr.pruneOrphans(new Set(loadHistory().map((r) => r.id)));
  rnr.applySettlements(aggregateSettlements());
  const items = rnr.refreshStatuses(warehousePoSet(), store.lostPoSet());
  // Payment cycles since a case was opened = reports whose PERIOD ended after
  // that date (each period is one Walmart settlement cycle). Keyed to the
  // period end — NOT the import time — so backfilling old periods onto a new
  // computer doesn't count cycles that never actually elapsed.
  const periodEnd = (r) => {
    const label = String(r.label || "");
    const end = label.includes(" - ") ? label.split(" - ").pop().trim() : label;
    const t = Date.parse(end);
    return Number.isFinite(t) ? t : Date.parse(r.ranAt) || 0;
  };
  const cycleEnds = loadHistory().map(periodEnd).filter(Boolean);
  for (const it of items) {
    // Clock runs from the approval date once approved (the payment clock), else
    // from when the case was opened.
    const ref = it.caseApproved && it.caseApprovedAt ? it.caseApprovedAt : it.caseOpenedAt;
    const refT = ref ? Date.parse(ref) : NaN;
    it.cyclesSinceCase = it.caseOpened && Number.isFinite(refT) ? cycleEnds.filter((t) => t > refT).length : 0;
    // Still unpaid after 2 payment cycles is an issue — flag it and pull it back
    // into "needs action" so it bumps the tab badge.
    it.caseIssue = it.caseOpened && it.status === "outstanding" && it.cyclesSinceCase >= 2;
    if (it.caseIssue) it.needsAction = true;
  }
  return { items, summary: rnr.summary() };
}

// ---------- Warehouse ----------

const listEntries = () => store.load();
const addEntry = (entry) => store.addEntry(entry);
const updateEntry = (id, entry) => store.updateEntry(id, entry);
const deleteEntry = (id) => store.deleteEntry(id);

// The one returns file: two side-by-side tables in one CSV. Received occupies
// columns A–H, a 2-column gap (I–J), then the leaner Loss block in K–O.
const WAREHOUSE_HEADER = [
  "PO #", "Date Received", "Condition", "Price", "Units", "Returned SKU", "Customer Name", "Tracking #", "Notes",
  "", "",
  "LOSS PO#", "Price", "Returned SKU", "Customer Name", "Notes",
];

// Parse the side-by-side file in ARRAY mode (header names repeat across the two
// blocks, so PapaParse's header:true would silently rename the duplicates).
// Splits at "LOSS PO#"; returns both lists. Falls back to single-block parsing
// for legacy/simple files that have no Loss block.
function parseWarehouseCsv(text) {
  const parsed = Papa.parse(String(text || "").replace(/^﻿/, ""), { skipEmptyLines: false });
  const rows = parsed.data;
  const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // Undo the Excel text-forcing wrapper (="123") that exportWarehouseCsvText adds
  // to PO columns, so the round-trip is lossless. Plain cells pass through.
  const unwrap = (v) => { const s = String(v ?? "").trim(); const m = /^="(.*)"$/.exec(s); return m ? m[1] : s; };

  let headerIdx = -1, lossIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const idx = (rows[i] || []).findIndex((c) => norm(c) === "losspo");
    if (idx !== -1) { headerIdx = i; lossIdx = idx; break; }
  }
  if (headerIdx === -1) return { hasLossBlock: false };

  // Received block: columns before the gap, matched by alias to entry fields.
  const headerCells = rows[headerIdx];
  const recvMap = mapHeaderIndices(headerCells.slice(0, lossIdx));
  // Loss block: fixed positions from "LOSS PO#" — po, price, sku, customer, notes.
  const lossCols = ["po", "price", "sku", "customer", "notes"];

  const received = [];
  const losses = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const recv = {};
    for (const [key, ci] of Object.entries(recvMap)) recv[key] = unwrap(row[ci]);
    if (String(recv.po ?? "").trim()) received.push(recv);

    const loss = {};
    lossCols.forEach((key, k) => { loss[key] = unwrap(row[lossIdx + k]); });
    if (String(loss.po ?? "").trim()) losses.push(loss);
  }
  return { hasLossBlock: true, received, losses };
}

function importWarehouseCsv(text, mode = "add") {
  const parsed = parseWarehouseCsv(text);

  // Legacy / simple single-block file (e.g. a one-column PO# list) — keep the
  // tolerant header mapper and only touch the Received list.
  if (!parsed.hasLossBlock) {
    const { raws, totalRows } = parseImportCsv(String(text || ""));
    if (mode === "replace") store.clear();
    const { added } = store.addMany(raws);
    return {
      added, lossAdded: 0, skipped: totalRows - added,
      entries: store.load(), losses: store.loadLosses(), mode,
    };
  }

  // Two-block file — Add/Replace applies to BOTH lists together.
  if (mode === "replace") { store.clear(); store.clearLosses(); }
  const recvRes = store.addMany(parsed.received);
  const lossRes = store.addManyLosses(parsed.losses);
  return {
    added: recvRes.added,
    lossAdded: lossRes.added,
    skipped: (parsed.received.length - recvRes.added) + (parsed.losses.length - lossRes.added),
    entries: store.load(),
    losses: store.loadLosses(),
    mode,
  };
}

function exportWarehouseCsvText() {
  const entries = store.load();
  const losses = store.loadLosses();
  const n = Math.max(entries.length, losses.length);
  const rows = [WAREHOUSE_HEADER];
  for (let i = 0; i < n; i++) {
    const e = entries[i];
    const l = losses[i];
    rows.push([
      e?.po ?? "", e?.dateReceived ?? "", e?.condition ?? "", e?.price ?? "", e?.qty ?? "",
      e?.sku ?? "", e?.customer ?? "", e?.tracking ?? "", e?.notes ?? "",
      "", "",
      l?.po ?? "", l?.price ?? "", l?.sku ?? "", l?.customer ?? "", l?.notes ?? "",
    ]);
  }
  // Build the CSV by hand so the PO columns can be written as Excel text
  // (="123") — otherwise a 15-digit PO opens as 1.19E+14 and loses digits, and
  // if the file is saved from Excel the corruption is written back on re-import.
  // Papa.unparse would quote the inner quotes and break the ="..." trick.
  // Columns 0 (PO #) and 11 (LOSS PO#) hold the long numeric IDs (see WAREHOUSE_HEADER).
  const esc = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const poCell = (v) => { const s = String(v ?? "").replace(/"/g, ""); return s ? `="${s}"` : ""; };
  const PO_COLS = new Set([0, 11]);
  const csv = rows
    .map((row, ri) => row.map((cell, ci) => (ri > 0 && PO_COLS.has(ci) ? poCell(cell) : esc(cell))).join(","))
    .join("\n");
  return { csv, count: entries.length, lossCount: losses.length };
}

// ---------- Reconcile ----------

// runs the full pipeline from an uploaded CSV's text. onProgress(msg) is optional.
// Backfill "Imported Walmart Reports" for periods imported before the app kept
// the original upload: rebuild a CSV per period from the stored transaction
// data (one row per transaction line — PO, date, type, amount type, amount).
// Suffixed "(rebuilt)" since it's a reconstruction, not the original bytes; a
// later genuine re-import replaces it. Idempotent — skips runs whose file exists.
function backfillImportedReports() {
  const runs = loadHistory();
  const importsDir = path.join(OUTPUTS_DIR, "Imported Walmart Reports");
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const poCell = (po) => (po ? `="${String(po).replace(/"/g, "")}"` : "");
  let rebuilt = 0, changed = false;
  for (const r of runs) {
    if (r.importedPath && fs.existsSync(r.importedPath)) continue;
    const tx = profitStore.loadTransactionsRun(r.id);
    if (!tx || !tx.length) continue;
    const out = ["PO #,Order #,Date,Transaction Type,Amount Type,Item Id,Qty,Amount"];
    for (const t of tx) {
      const parts = Array.isArray(t.lines) && t.lines.length ? t.lines : [{ at: "", amt: t.amount }];
      for (const l of parts) {
        out.push([poCell(t.po), poCell(t.order), esc(t.date || ""), esc(t.type || ""), esc(l.at || ""), esc(t.itemId || ""), t.qty ?? "", l.amt ?? ""].join(","));
      }
    }
    fs.mkdirSync(importsDir, { recursive: true });
    const p = path.join(importsDir, `Walmart_Report_${String(r.label).replace(/[\\/:*?"<>|]/g, "-")} (rebuilt).csv`);
    fs.writeFileSync(p, out.join("\n"));
    r.importedPath = p;
    rebuilt++;
    changed = true;
  }
  if (changed) fs.writeFileSync(historyPath(), JSON.stringify({ runs }, null, 2));
  return { rebuilt };
}

// Walmart's report filename embeds the PAYMENT date (…MP_06022026_reconciliationreport…
// = paid Jun 2). The statement period, as shown on Walmart's Statements page, is
// paymentDate−17 → paymentDate−3 (paid Jun 2 ↔ "May 16 - May 30"; paid May 5 ↔
// "Apr 18 - May 2" — verified against the user's Statements screenshots). The
// report file's own Period columns run one day short of the Statements page, so
// the filename derivation is authoritative to match what Walmart displays.
function periodFromReportName(name) {
  const m = /MP_(\d{2})(\d{2})(\d{4})_/.exec(String(name || ""));
  if (!m) return null;
  const paid = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  if (isNaN(paid.getTime())) return null;
  const end = new Date(paid); end.setDate(end.getDate() - 3);
  const start = new Date(paid); start.setDate(start.getDate() - 17);
  return { start, end, explicit: true };
}

async function runReconcile({ name, text, force }, onProgress = () => {}) {
  const entries = store.load();
  if (entries.length === 0) {
    throw new Error("Your warehouse log is empty — add returns in the Warehouse Returns tab (or Import CSV) first, otherwise every PO would be flagged as missing.");
  }

  // park the upload in a temp file so the existing path-based parsers work
  const tmpPath = path.join(TMP_DIR, `report-${crypto.randomUUID()}.csv`);
  fs.writeFileSync(tmpPath, String(text ?? ""));

  try {
    onProgress("Reading Walmart report…");
    let { refunds, format, period } = loadRefunds(tmpPath);
    if (refunds.length === 0) return { noRefunds: true, format };
    // label by the payment period as Walmart's Statements page shows it (from the
    // filename's payment date) — the report's own Period columns run a day short,
    // and the refund-date-span fallback is misleading
    period = periodFromReportName(name) || period;

    onProgress(`Found ${refunds.length} refunded POs (${format} format). Checking against warehouse log…`);
    const warehouse = store.toReconcileRows(entries);
    const { seller, wfs } = findIssues(refunds, warehouse);

    const label =
      formatPeriod(period.start, period.end) ||
      String(name || "report")
        .replace(/\.csv$/i, "")
        .replace("Digital_World_Shop_10001467995_MP_", "")
        .replace("_reconciliationreport", "");

    // Duplicate guard: fingerprint the file and bail early (before the heavy
    // report build) if the exact same file — or any report for this same
    // period — was already imported, unless the user forces a re-import.
    const csvHash = crypto.createHash("sha256").update(String(text ?? "")).digest("hex");
    if (!force) {
      const dup = loadHistory().find((r) => r.csvHash === csvHash || r.label === label);
      if (dup) {
        return {
          alreadyImported: true,
          sameFile: dup.csvHash === csvHash,
          label: dup.label,
          ranAt: dup.ranAt,
          csvName: dup.csvName || "",
        };
      }
    }

    // Keep the ORIGINAL uploaded report, named by its period, so the source
    // of every import stays browsable (Settings → Open imported reports).
    // Re-importing a period overwrites its file — one per period.
    const importsDir = path.join(OUTPUTS_DIR, "Imported Walmart Reports");
    fs.mkdirSync(importsDir, { recursive: true });
    const importedPath = path.join(importsDir, `Walmart_Report_${label.replace(/[\\/:*?"<>|]/g, "-")}.csv`);
    fs.writeFileSync(importedPath, String(text ?? ""));

    // No workbook is written: the three-bucket summary lives in the run record
    // and shows in the app. "Download Excel" builds the file on demand (exportRun).
    onProgress("Summarizing…");
    const { rows, counts } = classify(seller, wfs);
    const summary = toSummary(rows);

    const result = {
      noRefunds: false, format, label,
      totalRefunds: refunds.length,
      sellerCount: seller.length,
      wfsCount: wfs.length,
      warehouseRows: warehouse.length,
      counts, summary, importedPath,
    };

    // re-running the same period replaces the old run — clear its side data first
    const replaced = loadHistory().find((r) => r.label === label);
    if (replaced) {
      wfsWatch.removeByRun(replaced.id);
      nrWatch.removeByRun(replaced.id);
      profitStore.deleteOrdersRun(replaced.id);
      // a real re-import supersedes the period's old archived file (e.g. a "(rebuilt)" one)
      if (replaced.importedPath && replaced.importedPath !== importedPath) {
        try { fs.unlinkSync(replaced.importedPath); } catch { /* already gone */ }
      }
    }

    const runId = crypto.randomUUID();
    saveRun({ id: runId, ranAt: new Date().toISOString(), csvName: name || "", csvHash, ...result });
    result.id = runId; // so the UI can offer "Download Excel" for this run right away

    wfsWatch.upsertFromRun(wfs, runId);

    const hasToken = (r, t) => r.Issues.split(", ").includes(t);
    const notReceivedRows = [
      ...[...seller, ...wfs].filter((r) => hasToken(r, "LOST")),
      ...seller.filter((r) => hasToken(r, "MISSING")),
    ];
    const settlements = loadSettlements(tmpPath);
    nrWatch.upsertFromRun(notReceivedRows, runId);
    nrWatch.recordSettlements(settlements);
    checkNotReceived();

    // unified Returns Not Received: every refunded PO that didn't arrive —
    // WFS not received + seller MISSING/LOST — tagged with its fulfillment type
    const rnrRows = [
      ...wfs.filter((r) => (r["Warehouse Count"] || 0) === 0),
      ...seller.filter((r) => hasToken(r, "MISSING") || hasToken(r, "LOST")),
    ];
    rnr.upsertFromRun(rnrRows, runId);

    // Stash this run's Walmart payouts on disk, then re-derive Reimbursed from
    // *all* runs (so it self-heals and never depends on import timing again).
    const orders = loadOrders(tmpPath);
    profitStore.saveOrders(runId, orders, loadDailySeries(tmpPath), loadStatement(tmpPath), loadTransactions(tmpPath), settlements);
    profitStore.registerProducts(orders);
    checkRnr();

    return result;
  } finally {
    fs.unlink(tmpPath, () => {});
  }
}

// ---------- WFS ----------

const listWfs = () => checkWfs();
const markWfsCase = (po) => { wfsWatch.markCase(po); return checkWfs(); };
const removeWfs = (po) => { wfsWatch.removeItem(po); return checkWfs(); };
const reopenWfs = (po) => { wfsWatch.reopenCase(po); return checkWfs(); };

const ALERT_EMAIL = "imran@digitalworldshopus.com";

// returns the mailto target for the current overdue list (or null if none)
function wfsEmailMailto() {
  const overdue = checkWfs().filter((i) => i.overdue);
  if (!overdue.length) return null;
  const total = overdue.reduce((acc, i) => acc + (i.netRefund || 0), 0);
  const lines = overdue.map(
    (i) =>
      `PO ${i.po} — ${i.item || "(no item name)"} — refunded ${i.refundDate}` +
      `${i.daysOld !== null ? ` (${i.daysOld} days ago)` : ""} — $${(i.netRefund || 0).toFixed(2)}`
  );
  const subject = `WFS returns overdue — open ${overdue.length} case${overdue.length === 1 ? "" : "s"} ($${total.toFixed(2)})`;
  const body =
    `These WFS refunds were never received at the warehouse within ${wfsWatch.WFS_OVERDUE_DAYS} days.\n` +
    `Open a case for each in Walmart Seller Center:\n\n${lines.join("\n")}\n`;
  return {
    count: overdue.length,
    mailto: `mailto:${ALERT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}

// ---------- Not Received tracker ----------

const nrList = () => ({ items: checkNotReceived(), summary: nrWatch.summary() });

function nrMarkReceived(po) {
  const item = nrWatch.load().find((i) => i.po === po);
  store.addEntry({
    po,
    dateReceived: new Date().toISOString().slice(0, 10),
    sku: item?.item || "",
    notes: "Marked received from the Not Received tracker",
  });
  return nrList();
}
const nrMarkReimbursed = (po, amount) => { nrWatch.markReimbursed(po, amount); return nrList(); };
const nrMarkLoss = (po) => { nrWatch.markLoss(po); return nrList(); };
const nrReopen = (po) => { nrWatch.reopen(po); return nrList(); };

// ---------- Returns Not Received (unified) ----------

const rnrList = () => checkRnr();

function rnrMarkReceived(po) {
  const item = rnr.load().find((i) => i.po === po);
  store.addEntry({
    po,
    dateReceived: new Date().toISOString().slice(0, 10),
    sku: item?.item || "",
    notes: "Marked received from Returns Not Received",
  });
  return checkRnr();
}
// Loss is now a portable decision: write the PO into the warehouse Loss list
// (pulling price/sku/customer off the RNR item) so it exports + syncs. The
// status then re-derives as "loss".
// Write-offs live inside Returns Not Received now — no longer added to the
// warehouse Loss list / returns file. They still show in the RNR Loss tab and
// the audit export.
function rnrMarkLoss(po) {
  rnr.markWrittenOff(po, true);
  return checkRnr();
}
const rnrUnmarkLoss = (po) => { rnr.markWrittenOff(po, false); store.removeLossByPo(po); return checkRnr(); };

// One-time: move write-offs that were previously pushed to the warehouse Loss
// list back onto each RNR item's own flag, so losses stop living in the
// warehouse returns file. Idempotent (only touches RNR-tagged warehouse losses).
function migrateRnrLossesOutOfWarehouse() {
  let losses;
  try { losses = store.loadLosses(); } catch { return; }
  const rnrLosses = (losses || []).filter((l) => /returns not received/i.test(l.notes || ""));
  if (!rnrLosses.length) return;
  const items = rnr.load();
  let changed = false;
  for (const l of rnrLosses) {
    const it = items.find((i) => i.po === l.po);
    if (it && !it.writtenOff) { it.writtenOff = true; it.writtenOffAt = l.addedAt || new Date().toISOString(); changed = true; }
    store.removeLossByPo(l.po);
  }
  if (changed) rnr.save(items);
}
const rnrRemove = (po) => { rnr.removeItem(po); return checkRnr(); };
// "Case opened" — a manual marker that you filed a case with Walmart (drops the
// item out of "needs action" and into the Open Cases filter).
const rnrMarkCase = (po, caseId) => { rnr.markCase(po, true, caseId); return checkRnr(); };
const rnrReopenCase = (po) => { rnr.markCase(po, false); return checkRnr(); };
const rnrSetCaseId = (po, caseId) => { rnr.setCaseId(po, caseId); return checkRnr(); };
const rnrMarkAdjustment = (po, on) => { rnr.markAdjustment(po, on); return checkRnr(); };
const rnrMarkApproved = (po, on) => { rnr.markApproved(po, on); return checkRnr(); };
const rnrSetNote = (po, note) => { rnr.setNote(po, note); return checkRnr(); };

// Import a corrections CSV (exported from another computer) and apply the manual
// markers to matching POs — cases, case IDs, approvals, notes, write-offs,
// adjustments. Authoritative per column; POs not in the file are left alone.
function importRnrCorrections(text) {
  const parsed = Papa.parse(String(text || "").replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" });
  const fields = parsed.meta.fields || [];
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const find = (...a) => fields.find((f) => a.includes(norm(f)));
  const col = {
    po: find("po", "ponumber"),
    caseOpened: find("caseopened"),
    caseId: find("caseid"),
    caseOpenedAt: find("caseopenedat", "caseopeneddate"),
    approved: find("approved"),
    approvedAt: find("approvedat", "approveddate"),
    loss: find("loss", "writtenoff", "writtenoffloss"),
    adjustment: find("adjustment", "partialadjustment"),
    pending: find("pendingreimbursement", "reimbursepending"),
    note: find("note", "notes"),
  };
  if (!col.po) throw new Error('The corrections file needs a "PO #" column.');
  const unwrap = (v) => { let s = String(v ?? "").trim(); const m = /^="(.*)"$/.exec(s); if (m) s = m[1]; return s; };
  const yes = (v) => /^(yes|y|true|1)$/i.test(String(v ?? "").trim());
  const toIso = (v) => { const s = unwrap(v); if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString(); };
  const items = rnr.load();
  let applied = 0, missing = 0;
  for (const r of parsed.data) {
    const po = unwrap(r[col.po]);
    if (!po) continue;
    const it = items.find((i) => i.po === po);
    if (!it) { missing++; continue; }
    if (col.caseId) it.caseId = unwrap(r[col.caseId]) || null;
    if (col.caseOpened) {
      it.caseOpened = yes(r[col.caseOpened]);
      if (it.caseOpened) it.caseOpenedAt = (col.caseOpenedAt && toIso(r[col.caseOpenedAt])) || it.caseOpenedAt || new Date().toISOString();
      else { it.caseOpenedAt = null; it.caseId = null; }
    }
    if (col.approved) {
      it.caseApproved = yes(r[col.approved]);
      it.caseApprovedAt = it.caseApproved ? ((col.approvedAt && toIso(r[col.approvedAt])) || it.caseApprovedAt || new Date().toISOString()) : null;
    }
    if (col.loss) it.writtenOff = yes(r[col.loss]);
    if (col.adjustment) {
      it.adjustment = yes(r[col.adjustment]);
      if (it.adjustment) { it.adjustmentAt = it.adjustmentAt || new Date().toISOString(); it.caseOpened = false; it.caseOpenedAt = null; it.caseId = null; }
    }
    if (col.pending) it.reimbursePending = yes(r[col.pending]);
    if (col.note) { const n = unwrap(r[col.note]); it.note = n || null; it.noteAt = n ? (it.noteAt || new Date().toISOString()) : null; }
    applied++;
  }
  rnr.save(items);
  return { applied, missing };
}

// Full audit export of every Returns Not Received item (all statuses) to a
// formatted .xlsx — a single sheet a manager can review, including the case /
// note / approval tracking.
async function exportRnrAudit(outPath) {
  const ExcelJS = require("exceljs");
  const { items } = checkRnr();

  const stageOf = (it) => {
    if (it.status === "received") return "Received";
    if (it.status === "loss") return "Loss (written off)";
    if (it.status === "reimbursed") {
      const partial = it.settlementSeen && it.settlementSeen < (it.amount || 0) - 0.01;
      return partial ? "Reimbursed (partial)" : "Reimbursed";
    }
    if (it.status === "reimbursed_pending") return "Pending reimbursement";
    if (it.adjustment) return "Partial adjustment";
    if (it.caseOpened) return it.caseIssue ? "Issue - approved unpaid" : (it.caseApproved ? "Approved" : "Case opened");
    if (it.lost) return "Lost";
    if (it.windowClosed) return "Dispute window closed";
    if (it.wfsDisputeOpen) return "Dispute open";
    if (it.wfsWaiting) return "Auto-reimburse (waiting)";
    return "Outstanding";
  };
  const windowText = (it) => {
    const dl = it.daysLeft;
    if (dl == null || it.caseOpened || it.status !== "outstanding" || it.adjustment) return "";
    if (it.lost) return "file now";
    if (it.windowClosed) return `closed ${-dl}d ago`;
    if (it.wfsWaiting) return `auto-reimburse in ${dl}d`;
    return `${dl}d left to file`;
  };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Returns Not Received");
  ws.columns = [
    { header: "PO #", key: "po", width: 20 },
    { header: "Type", key: "type", width: 8 },
    { header: "Product", key: "item", width: 42 },
    { header: "Refund date", key: "refundDate", width: 13 },
    { header: "Days old", key: "daysOld", width: 9 },
    { header: "Refund amount", key: "amount", width: 13 },
    { header: "Walmart paid", key: "paid", width: 12 },
    { header: "Stage", key: "stage", width: 22 },
    { header: "Dispute window", key: "window", width: 18 },
    { header: "Case opened", key: "caseOpened", width: 11 },
    { header: "Case ID", key: "caseId", width: 14 },
    { header: "Case opened date", key: "caseOpenedAt", width: 15 },
    { header: "Approved", key: "approved", width: 9 },
    { header: "Approved date", key: "approvedAt", width: 13 },
    { header: "Cycles since opened", key: "cycles", width: 16 },
    { header: "Adjustment", key: "adjustment", width: 10 },
    { header: "Needs action", key: "needsAction", width: 11 },
    { header: "Note", key: "note", width: 55 },
  ];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4C5B9E" } };
  header.alignment = { vertical: "middle" };
  header.height = 18;

  for (const it of items) {
    ws.addRow({
      po: String(it.po ?? ""),
      type: it.type || "",
      item: it.item || "",
      refundDate: it.refundDate || "",
      daysOld: it.daysOld ?? "",
      amount: it.amount ?? 0,
      paid: it.settlementSeen ?? 0,
      stage: stageOf(it),
      window: windowText(it),
      caseOpened: it.caseOpened ? "Yes" : "",
      caseId: it.caseId || "",
      caseOpenedAt: it.caseOpenedAt ? String(it.caseOpenedAt).slice(0, 10) : "",
      approved: it.caseApproved ? "Yes" : "",
      approvedAt: it.caseApprovedAt ? String(it.caseApprovedAt).slice(0, 10) : "",
      cycles: it.caseOpened ? (it.cyclesSinceCase ?? 0) : "",
      adjustment: it.adjustment ? "Yes" : "",
      needsAction: it.needsAction ? "Yes" : "",
      note: it.note || "",
    });
  }
  ws.getColumn("po").numFmt = "@";
  ws.getColumn("amount").numFmt = '"$"#,##0.00';
  ws.getColumn("paid").numFmt = '"$"#,##0.00';
  ws.getColumn("note").alignment = { wrapText: true, vertical: "top" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "R1" };

  await wb.xlsx.writeFile(outPath);
  return { ok: true, count: items.length };
}
// Manually mark a PO as expected-to-be-reimbursed (pending) before the payout
// posts; a real settlement in a later report auto-promotes it to confirmed.
const rnrMarkReimbursePending = (po) => { rnr.markReimbursePending(po, true); return checkRnr(); };
const rnrUnmarkReimbursePending = (po) => { rnr.markReimbursePending(po, false); return checkRnr(); };

// ---------- Monthly returns summary ----------
// For each calendar month (by refund date): total refunded $, how much came
// back (received), what was recovered from Walmart, what's written off (incl.
// partial-reimbursement gaps and lost-after-delivery), and what's still
// pending, split WFS / seller. "Received" is derived: total refunds minus the
// not-received ones — any refund never flagged by a reconcile came back.
// Month key ("YYYY-MM") from either an already-ISO ledger date or a
// report-format date (e.g. "05/14/2026").
function monthKeyOf(d) {
  const s = String(d || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7);
  const iso = toIsoDay(s);
  return iso ? iso.slice(0, 7) : null;
}

// The shared bucket math: total refunded (from refund transactions) split into
// received / reimbursed / loss (write-offs + partial gaps + lost-after-delivery)
// / pending (WFS vs seller) / adjustments, from the RNR items' current statuses.
function bucketTotals(refundTxs, items) {
  const t = { returns: 0, returnsCount: 0, notReceived: 0, received: 0, reimbursed: 0, loss: 0, pendingWfs: 0, pendingSeller: 0, adjustments: 0, lossCount: 0, pendingCount: 0 };
  for (const x of refundTxs) { t.returns += Math.abs(x.amount || 0); t.returnsCount++; }
  for (const it of items) {
    const amt = it.amount || 0;
    if (it.status === "received") continue; // came back — stays in the received bucket
    t.notReceived += amt;
    if (it.status === "loss") { t.loss += amt; t.lossCount++; }
    else if (it.status === "reimbursed") {
      const paid = Math.min(it.settlementSeen || 0, amt);
      t.reimbursed += paid;
      if (amt - paid > 0.01) t.loss += amt - paid; // partial reimbursement — the gap is a loss
    } else if (it.adjustment) t.adjustments += amt; // self-initiated partials — not chased
    else if (it.lost && /after delivery/i.test(String(it.reason || ""))) { t.loss += amt; t.lossCount++; }
    else {
      if (it.type === "WFS") t.pendingWfs += amt;
      else t.pendingSeller += amt;
      t.pendingCount++;
    }
  }
  t.received = Math.max(0, t.returns - t.notReceived);
  for (const k of Object.keys(t)) if (typeof t[k] === "number") t[k] = Math.round(t[k] * 100) / 100;
  return t;
}

const isRefundTx = (t) => String(t.type || "").toLowerCase() === "refund";
// A dispute you WON: a positive Dispute Settlement credit. Wins on not-received
// POs are already counted in the Reimbursed bucket — everything else (item came
// back but you cased it anyway and won) is a "dispute win" on top.
const isDisputeWinTx = (t) => (t.amount || 0) > 0 && /dispute/i.test(String(t.type || ""));
function disputeWinSkipSet(items) {
  return new Set(items.filter((i) => i.status !== "received").map((i) => i.po)); // counted in Reimbursed
}
function sumDisputeWins(txs, skip) {
  let amt = 0;
  const pos = new Set();
  for (const t of txs) {
    if (!isDisputeWinTx(t) || !t.po || skip.has(t.po)) continue;
    amt += t.amount;
    pos.add(t.po);
  }
  return { disputeWins: Math.round(amt * 100) / 100, disputeWinsCount: pos.size };
}

function rnrMonthlySummary() {
  const { items } = checkRnr();
  const skip = disputeWinSkipSet(items);
  const txByM = {}, itByM = {}, winByM = {};
  for (const t of allTransactions()) {
    const mk = monthKeyOf(t.date);
    if (!mk) continue;
    if (isRefundTx(t)) (txByM[mk] = txByM[mk] || []).push(t);
    else if (isDisputeWinTx(t)) (winByM[mk] = winByM[mk] || []).push(t);
  }
  for (const it of items) {
    const mk = monthKeyOf(it.refundDate);
    if (mk) (itByM[mk] = itByM[mk] || []).push(it);
  }
  const keys = [...new Set([...Object.keys(txByM), ...Object.keys(itByM), ...Object.keys(winByM)])].sort().reverse();
  return { months: keys.map((k) => ({ key: k, ...bucketTotals(txByM[k] || [], itByM[k] || []), ...sumDisputeWins(winByM[k] || [], skip) })) };
}

// Everything, across every imported report — the "All time" view.
function rnrAllTimeSummary() {
  const { items } = checkRnr();
  const tx = allTransactions();
  const refunds = tx.filter(isRefundTx);
  const wins = sumDisputeWins(tx, disputeWinSkipSet(items));
  return { key: "all", ...bucketTotals(refunds, items), ...wins };
}

// Same buckets per PAYMENT CYCLE (one imported report = one cycle). The refund
// total comes from that report's own transactions, so it matches the Walmart
// report for the period exactly; items attach via the run that flagged them.
function rnrCycleSummary() {
  const { items } = checkRnr();
  const skip = disputeWinSkipSet(items);
  const cycles = [];
  for (const r of loadHistory()) {
    const tx = profitStore.loadTransactionsRun(r.id) || [];
    const refunds = tx.filter(isRefundTx);
    const its = items.filter((i) => i.sourceRunId === r.id);
    const wins = sumDisputeWins(tx, skip);
    if (!refunds.length && !its.length && !wins.disputeWinsCount) continue;
    cycles.push({ key: r.id, label: r.label, ranAt: r.ranAt, ...bucketTotals(refunds, its), ...wins });
  }
  // newest period first — by the period START parsed from the label (import
  // times are arbitrary when reports were bulk-imported)
  const startOf = (c) => {
    const label = String(c.label || "");
    const first = label.split(" - ")[0].trim();
    const tailYear = /(\d{4})\s*$/.exec(label);
    const d = new Date(/\d{4}/.test(first) ? first : tailYear ? `${first}, ${tailYear[1]}` : first);
    return isNaN(d.getTime()) ? String(c.ranAt || "") : d.toISOString();
  };
  cycles.sort((a, b) => startOf(b).localeCompare(startOf(a)));
  return { cycles };
}

// Export one month's returns to a workbook: a Summary sheet plus one sheet per
// bucket — Received, Pending WFS, Pending Seller, Loss (incl. partial gaps and
// lost-after-delivery), Reimbursed (partials flagged), Adjustments. The bucket
// rules mirror rnrMonthlySummary exactly, so the sheets sum to the tiles.
async function exportRnrMonthly(kind, key, label, outPath) {
  const ExcelJS = require("exceljs");
  const { items } = checkRnr();

  // po -> product name, from the stored per-run orders
  const nameByPo = new Map();
  for (const r of loadHistory()) {
    const orders = profitStore.loadOrdersRun(r.id);
    if (!orders) continue;
    for (const o of orders) if (o.po && !nameByPo.has(o.po)) nameByPo.set(o.po, o.item || o.sku || "");
  }

  const rnrByPo = new Map(items.map((i) => [i.po, i]));
  // month: refund transactions across the deduped ledger, by refund date.
  // cycle: THAT report's own refund transactions — matches Walmart exactly.
  const refunds = kind === "cycle"
    ? (profitStore.loadTransactionsRun(key) || []).filter(isRefundTx)
    : kind === "all"
      ? allTransactions().filter(isRefundTx)
      : allTransactions().filter((t) => isRefundTx(t) && monthKeyOf(t.date) === key);
  const received = refunds.filter((t) => { const it = rnrByPo.get(t.po); return !it || it.status === "received"; });

  const monthItems = kind === "cycle"
    ? items.filter((i) => i.sourceRunId === key)
    : kind === "all"
      ? items
      : items.filter((i) => monthKeyOf(i.refundDate) === key);

  // dispute wins in this period (excluding POs already counted as Reimbursed)
  const winSkip = disputeWinSkipSet(items);
  const winTxs = (kind === "cycle"
    ? (profitStore.loadTransactionsRun(key) || [])
    : kind === "all"
      ? allTransactions()
      : allTransactions().filter((t) => monthKeyOf(t.date) === key)
  ).filter((t) => isDisputeWinTx(t) && t.po && !winSkip.has(t.po));
  const isLad = (i) => i.lost && /after delivery/i.test(String(i.reason || ""));
  const writeOffs = monthItems.filter((i) => i.status === "loss" || (i.status !== "reimbursed" && i.status !== "received" && !i.adjustment && isLad(i)));
  const reimb = monthItems.filter((i) => i.status === "reimbursed");
  const adj = monthItems.filter((i) => i.status !== "reimbursed" && i.status !== "received" && i.status !== "loss" && i.adjustment);
  const pending = monthItems.filter((i) => i.status !== "reimbursed" && i.status !== "received" && i.status !== "loss" && !i.adjustment && !isLad(i));
  const pendingW = pending.filter((i) => i.type === "WFS");
  const pendingS = pending.filter((i) => i.type !== "WFS");

  const stageOf = (i) => {
    if (i.status === "reimbursed_pending") return "Pending reimbursement";
    if (i.caseOpened) return i.caseIssue ? "Issue - unpaid" : (i.caseApproved ? "Approved" : "Case opened");
    if (i.lost) return "Lost";
    if (i.windowClosed) return "Dispute window closed";
    if (i.wfsDisputeOpen) return "Dispute open";
    if (i.wfsWaiting) return "Auto-reimburse (waiting)";
    return "Outstanding";
  };

  const wb = new ExcelJS.Workbook();
  const styleHeader = (ws) => {
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4C5B9E" } };
    h.height = 18;
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const money = '"$"#,##0.00';
  // Round every money value at write time — float sums like 117.33000000000001
  // display fine under the currency format but leak into the formula bar, other
  // tools reading the file, and penny-drift on SUMs.
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // ---- Summary ----
  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ header: "Bucket", key: "b", width: 26 }, { header: "Amount", key: "a", width: 14 }, { header: "POs", key: "c", width: 8 }];
  const m = bucketTotals(refunds, monthItems);
  sum.addRow({ b: `Returns — ${label}`, a: r2(m.returns), c: m.returnsCount || 0 });
  sum.addRow({ b: "Received (came back)", a: r2(m.received), c: received.length });
  sum.addRow({ b: "Reimbursed by Walmart", a: r2(m.reimbursed), c: reimb.length });
  const winTotal = r2(winTxs.reduce((a, t) => a + t.amount, 0));
  const winPos = new Set(winTxs.map((t) => t.po));
  if (winTotal > 0) sum.addRow({ b: "Dispute wins (item also received)", a: winTotal, c: winPos.size });
  sum.addRow({ b: "Loss (write-offs, partial gaps, lost after delivery)", a: r2(m.loss), c: writeOffs.length });
  sum.addRow({ b: "Pending — WFS", a: r2(m.pendingWfs), c: pendingW.length });
  sum.addRow({ b: "Pending — Seller", a: r2(m.pendingSeller), c: pendingS.length });
  if (m.adjustments) sum.addRow({ b: "Adjustments (self-initiated partials)", a: r2(m.adjustments), c: adj.length });
  sum.getColumn("a").numFmt = money;
  styleHeader(sum);

  // ---- Received ----
  const rec = wb.addWorksheet("Received");
  rec.columns = [
    { header: "PO #", key: "po", width: 20 }, { header: "Order #", key: "order", width: 20 },
    { header: "Refund date", key: "date", width: 12 }, { header: "Product", key: "item", width: 46 },
    { header: "Qty", key: "qty", width: 6 }, { header: "Refund amount", key: "amt", width: 14 },
  ];
  for (const t of received) {
    rec.addRow({ po: String(t.po || ""), order: String(t.order || ""), date: t.date || "", item: nameByPo.get(t.po) || t.itemId || "", qty: t.qty || "", amt: r2(Math.abs(t.amount || 0)) });
  }
  rec.getColumn("po").numFmt = "@"; rec.getColumn("order").numFmt = "@"; rec.getColumn("amt").numFmt = money;
  styleHeader(rec);

  // ---- item-bucket sheets share one shape ----
  const addItemSheet = (title, rows) => {
    const ws = wb.addWorksheet(title);
    ws.columns = [
      { header: "PO #", key: "po", width: 20 }, { header: "Type", key: "type", width: 8 },
      { header: "Product", key: "item", width: 46 }, { header: "Refund date", key: "date", width: 12 },
      { header: "Days old", key: "days", width: 9 }, { header: "Refund amount", key: "amt", width: 14 },
      { header: "Walmart paid", key: "paid", width: 12 }, { header: "Stage", key: "stage", width: 22 },
      { header: "Case ID", key: "caseId", width: 13 }, { header: "Note", key: "note", width: 44 },
    ];
    for (const i of rows) {
      ws.addRow({ po: String(i.po || ""), type: i.type || "", item: i.item || "", date: i.refundDate || "", days: i.daysOld ?? "", amt: r2(i.amount), paid: r2(i.settlementSeen), stage: stageOf(i), caseId: i.caseId || "", note: i.note || "" });
    }
    ws.getColumn("po").numFmt = "@"; ws.getColumn("amt").numFmt = money; ws.getColumn("paid").numFmt = money;
    ws.getColumn("note").alignment = { wrapText: true, vertical: "top" };
    styleHeader(ws);
    return ws;
  };
  addItemSheet("Pending - WFS", pendingW);
  addItemSheet("Pending - Seller", pendingS);
  addItemSheet("Loss", writeOffs);

  // ---- Reimbursed (partials flagged) ----
  const rw = wb.addWorksheet("Reimbursed");
  rw.columns = [
    { header: "PO #", key: "po", width: 20 }, { header: "Type", key: "type", width: 8 },
    { header: "Product", key: "item", width: 46 }, { header: "Refund date", key: "date", width: 12 },
    { header: "Refund amount", key: "amt", width: 14 }, { header: "Walmart paid", key: "paid", width: 12 },
    { header: "Gap (loss)", key: "gap", width: 11 }, { header: "Partial?", key: "partial", width: 8 },
    { header: "Kind", key: "kind", width: 12 }, { header: "Note", key: "note", width: 40 },
  ];
  for (const i of reimb) {
    const paid = r2(Math.min(i.settlementSeen || 0, i.amount || 0));
    const gap = r2(Math.max(0, (i.amount || 0) - paid));
    rw.addRow({ po: String(i.po || ""), type: i.type || "", item: i.item || "", date: i.refundDate || "", amt: r2(i.amount), paid, gap, partial: gap > 0.01 ? "Yes" : "", kind: i.settlementKind || "", note: i.note || "" });
  }
  rw.getColumn("po").numFmt = "@"; for (const k of ["amt", "paid", "gap"]) rw.getColumn(k).numFmt = money;
  styleHeader(rw);

  if (adj.length) addItemSheet("Adjustments", adj);

  // ---- Dispute wins (cases won on POs whose item also came back) ----
  if (winTxs.length) {
    const dw = wb.addWorksheet("Dispute wins");
    dw.columns = [
      { header: "PO #", key: "po", width: 20 }, { header: "Order #", key: "order", width: 20 },
      { header: "Date paid", key: "date", width: 12 }, { header: "Product", key: "item", width: 46 },
      { header: "Amount won", key: "amt", width: 13 },
    ];
    for (const t of winTxs) {
      dw.addRow({ po: String(t.po || ""), order: String(t.order || ""), date: t.date || "", item: nameByPo.get(t.po) || t.itemId || "", amt: r2(t.amount) });
    }
    dw.getColumn("po").numFmt = "@"; dw.getColumn("order").numFmt = "@"; dw.getColumn("amt").numFmt = money;
    styleHeader(dw);
  }

  await wb.xlsx.writeFile(outPath);
  return { ok: true, received: received.length, pending: pending.length, loss: writeOffs.length, reimbursed: reimb.length, disputeWins: winPos.size };
}

// ---------- Dispute-digest webhook (make.com) ----------
// When cases become fileable — seller returns nearing the 45-day deadline, WFS
// returns past 90 days unpaid — POST an email-ready digest to the user's
// make.com webhook. Make routes it to email; each seller PO deep-links to that
// return in Seller Center, WFS links to the Support Hub (no per-PO page).

const webhookPath = () => path.join(DATA_DIR, "webhook.json");
function webhookLoad() { try { return JSON.parse(fs.readFileSync(webhookPath(), "utf8")); } catch { return {}; } }
function webhookSaveFile(d) { fs.writeFileSync(webhookPath(), JSON.stringify(d, null, 2)); }
const webhookGet = () => { const d = webhookLoad(); return { url: d.url || "", lastSentAt: d.lastSentAt || null }; };
function webhookSet(url) { const d = webhookLoad(); d.url = String(url || "").trim(); webhookSaveFile(d); return webhookGet(); }

// Reproduces the Seller Center returns-search URL exactly as the site builds it:
// the appliedFilters JSON, double-URL-encoded, with the PO in "id".
function sellerReturnLink(po) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const end = new Date();
  const start = new Date(); start.setDate(start.getDate() - 180);
  const filters = {
    pageSize: 25, pageNum: 0, offset: 0, returnGroup: "ALL", filter: true,
    startDate: `${iso(start)}T00:00:00+00:00`, endDate: `${iso(end)}T23:59:59+00:00`,
    id: String(po), searchIdType: "PO_NO", limit: 25, resetFilter: true, tabIndex: 4,
  };
  return "https://seller.walmart.com/orders/returns?appliedFilters=" + encodeURIComponent(encodeURIComponent(JSON.stringify(filters))) + "&returnGroup=ALL";
}
const WFS_CASES_LINK = "https://seller.walmart.com/supporthub/your-cases?dateRange=last30days&returnUrl=%2Forders%2Freturns";

const SELLER_DIGEST_DAYS = 10; // include seller items with <= this many days left to file

function buildDisputeDigest() {
  const { items } = checkRnr();
  const fileable = (i) => i.status === "outstanding" && !i.caseOpened && !i.adjustment;
  const sellers = items
    .filter((i) => fileable(i) && i.type !== "WFS" && i.daysLeft != null && i.daysLeft > 0 && i.daysLeft <= SELLER_DIGEST_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const wfs = items.filter((i) => fileable(i) && i.wfsDisputeOpen).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  const all = [...sellers, ...wfs];
  if (!all.length) return null;

  const total = Math.round(all.reduce((a, i) => a + (i.amount || 0), 0) * 100) / 100;
  const fmt = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const trunc = (s, n = 34) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const pill = (text, urgent) =>
    `<span style="background:${urgent ? "#fdecec" : "#fef3df"};color:${urgent ? "#b3261e" : "#9a6a00"};font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;">${text}</span>`;
  const row = (i, last) => {
    const b = last ? "" : "border-bottom:1px solid #efece2;";
    const href = i.type === "WFS" ? WFS_CASES_LINK : sellerReturnLink(i.po);
    const p = i.type === "WFS" ? pill("file now", true) : pill(`${i.daysLeft}d left`, i.daysLeft <= 5);
    return `<tr>` +
      `<td style="padding:9px 8px;${b}"><a href="${href}" style="color:#0654ba;font-family:Consolas,monospace;font-size:12.5px;text-decoration:underline;">${esc(i.po)}</a></td>` +
      `<td style="padding:9px 8px;${b}color:#444;">${esc(trunc(i.item))}</td>` +
      `<td style="padding:9px 8px;${b}text-align:right;font-weight:600;">${fmt(i.amount || 0)}</td>` +
      `<td style="padding:9px 8px;${b}text-align:right;">${p}</td></tr>`;
  };
  const section = (label, list, pad) =>
    list.length
      ? `<div style="padding:${pad};">` +
        `<div style="font-size:11.5px;font-weight:600;letter-spacing:.05em;color:#8a8672;text-transform:uppercase;padding-bottom:6px;">${label} (${list.length})</div>` +
        `<table style="width:100%;border-collapse:collapse;font-size:13px;">${list.map((i, n) => row(i, n === list.length - 1)).join("")}</table></div>`
      : "";
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const subject = `Cases to open — ${all.length} return${all.length === 1 ? "" : "s"} · ${fmt(total)}`;
  const html =
    `<div style="width:600px;max-width:100%;margin:0 auto;background:#ffffff;border:1px solid #e5e0d5;border-radius:10px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">` +
    `<div style="background:#1c2f57;padding:16px 24px;">` +
    `<div style="color:#ffffff;font-size:16px;font-weight:500;">${esc(subject)}</div>` +
    `<div style="color:#b9c3dd;font-size:12px;margin-top:2px;">${today}</div></div>` +
    section("Seller", sellers, "16px 24px 4px") +
    section("WFS", wfs, "14px 24px 20px") +
    `</div>`;

  const key = crypto.createHash("sha1").update(all.map((i) => i.po).sort().join(",")).digest("hex");
  return {
    subject, html, total, count: all.length, key,
    items: all.map((i) => ({
      po: i.po, type: i.type, product: i.item || "", amount: i.amount || 0,
      refundDate: i.refundDate || "", daysLeft: i.daysLeft ?? null,
      link: i.type === "WFS" ? WFS_CASES_LINK : sellerReturnLink(i.po),
    })),
  };
}

// POST the digest to the webhook. Skips quietly when there's no URL, nothing to
// say, or the same set was already sent within ~20h (unless forced).
async function sendDisputeDigest({ force = false } = {}) {
  const cfg = webhookLoad();
  if (!cfg.url) return { sent: false, reason: "no_url" };
  const digest = buildDisputeDigest();
  if (!digest) return { sent: false, reason: "nothing_to_send" };
  const RESEND_MS = 20 * 60 * 60 * 1000;
  if (!force && cfg.lastKey === digest.key && Date.now() - (cfg.lastSentAt || 0) < RESEND_MS) {
    return { sent: false, reason: "already_sent" };
  }
  const resp = await fetch(cfg.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject: digest.subject, html: digest.html, count: digest.count, total: digest.total, items: digest.items }),
  });
  if (!resp.ok) return { sent: false, reason: `http_${resp.status}` };
  cfg.lastKey = digest.key;
  cfg.lastSentAt = Date.now();
  webhookSaveFile(cfg);
  return { sent: true, count: digest.count, total: digest.total };
}

// ---------- Order notes (manual, keyed by PO / order number) ----------
const orderNotesList = () => orderNotes.list();
const orderNotesAdd = (data) => orderNotes.add(data);
const orderNotesUpdate = (id, fields) => orderNotes.update(id, fields);
const orderNotesRemove = (id) => {
  // Attached images live as files next to notes.json — clean them up too.
  const n = orderNotes.list().find((x) => x.id === id);
  if (n && Array.isArray(n.images)) {
    for (const f of n.images) { try { fs.unlinkSync(noteImagePath(f)); } catch { /* already gone */ } }
  }
  return orderNotes.remove(id);
};

// Attached images are stored as files in <dataDir>/note-images; the note keeps
// only the filenames so notes.json stays small.
function noteImagesDir() {
  const d = path.join(DATA_DIR, "note-images");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const noteImagePath = (file) => path.join(noteImagesDir(), path.basename(String(file || "")));

function orderNotesAttachImage(id, name, base64) {
  const notes = orderNotes.list();
  const n = notes.find((x) => x.id === id);
  if (!n) return notes;
  const safe = String(name || "image.png").replace(/[^\w.-]+/g, "_").slice(-60) || "image.png";
  const file = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
  fs.writeFileSync(noteImagePath(file), Buffer.from(String(base64 || ""), "base64"));
  return orderNotes.update(id, { images: [...(n.images || []), file] });
}

function orderNotesRemoveImage(id, file) {
  const notes = orderNotes.list();
  const n = notes.find((x) => x.id === id);
  if (!n) return notes;
  try { fs.unlinkSync(noteImagePath(file)); } catch { /* already gone */ }
  return orderNotes.update(id, { images: (n.images || []).filter((f) => f !== file) });
}

function orderNotesImageData(file) {
  const p = noteImagePath(file);
  const ext = path.extname(p).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : ext === ".bmp" ? "image/bmp" : "image/jpeg";
  return { mime, base64: fs.readFileSync(p).toString("base64") };
}

// ---------- Warehouse Loss list ----------
const listLosses = () => store.loadLosses();
const deleteLoss = (id) => { store.deleteLoss(id); return { losses: store.loadLosses(), ...checkRnr() }; };

// mailto for everything that needs action now (WFS overdue + seller act-now/lost)
function rnrEmailMailto() {
  const need = rnr.refreshStatuses(warehousePoSet(), store.lostPoSet()).filter((i) => i.needsAction);
  if (!need.length) return null;
  const total = need.reduce((acc, i) => acc + (i.amount || 0), 0);
  const lines = need.map(
    (i) =>
      `PO ${i.po} [${i.type}] — ${i.item || "(no item name)"} — refunded ${i.refundDate}` +
      `${i.daysOld !== null ? ` (${i.daysOld} days ago)` : ""} — $${(i.amount || 0).toFixed(2)}`
  );
  const subject = `Returns not received — ${need.length} need action ($${total.toFixed(2)})`;
  const body =
    `These refunded POs never arrived at the warehouse and need action ` +
    `(WFS overdue / seller older than ${rnr.AGED_THRESHOLD_DAYS} days / lost):\n\n${lines.join("\n")}\n`;
  return {
    count: need.length,
    mailto: `mailto:${ALERT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}

// ---------- Profit ----------

// Build a cost resolver backed by the Pricing tab's master-SKU catalog: a Walmart
// listing's cost = the master SKU it's mapped to, priced by the purchase whose
// sold-from -> sold-to window covers the sale date (newest match wins; uncovered
// dates fall back to that SKU's latest cost). Listings not mapped to a master SKU
// resolve to null (strict — they show as missing cost in Profit). Returns null
// when no master SKUs exist yet, so a fresh setup keeps the old per-SKU costs.
function pricingCostResolver() {
  const pricing = pricingStore.get();
  const products = Array.isArray(pricing.products) ? pricing.products : [];
  if (!products.length) return null;
  const map = pricing.map && typeof pricing.map === "object" ? pricing.map : {};
  const byId = new Map(products.map((p) => [p.id, p]));
  const costForDate = (p, iso) => {
    const hist = Array.isArray(p.history) ? p.history : [];
    if (iso) {
      for (const h of hist) { // stored newest-first → first covering match is most recent
        if (h.cost == null) continue;
        const f = h.soldFrom || null, t = h.soldTo || null;
        if ((f || t) && (!f || iso >= f) && (!t || iso <= t)) return h.cost;
      }
    }
    return hist.length ? hist[0].cost : null; // latest cost
  };
  return (sku, iso) => {
    const pid = map[sku];
    if (pid == null) return null;
    const p = byId.get(pid);
    return p ? costForDate(p, iso) : null;
  };
}

function profitData() {
  const costs = profitStore.loadCosts();
  const names = profitStore.loadNames();
  const received = warehouseReceivedUnits();
  const resolver = pricingCostResolver();
  const skuUnits = {}; // total units sold per SKU, across every report
  const runs = loadHistory().map((r) => {
    const orders = profitStore.loadOrdersRun(r.id);
    if (!orders) return { id: r.id, label: r.label, ranAt: r.ranAt, available: false };
    for (const o of orders) {
      const key = String(o.sku ?? "").trim() || String(o.item ?? "").trim();
      if (key) skuUnits[key] = (skuUnits[key] || 0) + (o.saleUnits || 0);
    }
    const { totals } = profitStore.computeRun(orders, costs, received, resolver);
    return { id: r.id, label: r.label, ranAt: r.ranAt, available: true, totals };
  });
  return { costs, names, runs, skuUnits, vendors: profitStore.latestVendors() };
}

// Calendar-month view: merge every report's daily series + per-day profit into
// one timeline (safe to sum — reports never share transactions), then slice by
// month. Each month is returned chartDaily-shaped so the dashboard renders it
// the same way it renders a single report.
const isTransfer = (t) => t === "Instant Transfer";

function monthLabel(mk) {
  const [y, m] = mk.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function monthlyData() {
  const costs = profitStore.loadCosts();
  const received = warehouseReceivedUnits();
  const resolver = pricingCostResolver();
  const data = {};      // day -> { type: amount }
  const profitByDay = {}; // day -> { profit, orders, missingCost, revenue, saleUnits, refundUnits }
  const typeSet = new Set();

  for (const r of loadHistory()) {
    const daily = profitStore.loadDailyRun(r.id);
    const orders = profitStore.loadOrdersRun(r.id);
    if (daily) {
      for (const t of daily.types) typeSet.add(t);
      for (const day of daily.days) {
        const dst = (data[day] = data[day] || {});
        for (const [t, v] of Object.entries(daily.data[day] || {})) dst[t] = (dst[t] || 0) + v;
      }
    }
    if (orders) {
      const bd = profitStore.computeDailyProfit(orders, costs, received, resolver);
      for (const [day, p] of Object.entries(bd)) {
        const m = (profitByDay[day] = profitByDay[day] || { profit: 0, orders: 0, missingCost: 0, revenue: 0, saleUnits: 0, refundUnits: 0 });
        for (const k of Object.keys(m)) m[k] += p[k] || 0;
      }
    }
  }

  const allDays = Object.keys(data).sort();
  const types = [...typeSet].sort();
  const monthKeys = [...new Set(allDays.map((d) => d.slice(0, 7)))].sort();

  const totalsFor = (days) => {
    let revenue = 0, profit = 0, orders = 0, saleUnits = 0, refundUnits = 0, ordersMissingCost = 0;
    for (const d of days) {
      const p = profitByDay[d];
      if (p) { revenue += p.revenue; profit += p.profit; orders += p.orders; saleUnits += p.saleUnits; refundUnits += p.refundUnits; ordersMissingCost += p.missingCost; }
    }
    return { revenue, profit, orders, saleUnits, refundUnits, ordersMissingCost, margin: revenue !== 0 ? profit / revenue : null };
  };

  const months = monthKeys.map((mk) => {
    const days = allDays.filter((d) => d.startsWith(mk));
    return { key: mk, label: monthLabel(mk), days, types, data, profitByDay, totals: totalsFor(days) };
  });
  // previous-month comparison for the KPI deltas
  months.forEach((m, i) => { m.prevTotals = i > 0 ? months[i - 1].totals : null; });
  return { months };
}

const setCost = (item, cost) => { profitStore.setCost(item, cost); return true; };
// Append a purchase (cost + vendor + date) to a SKU's price history.
const addCost = (sku, cost, vendor, date) => profitStore.addCost(sku, cost, vendor, date);

// ---------- Pricing (draft): master-SKU product catalog ----------
const pricingGet = () => pricingStore.get();
const pricingSave = (data) => pricingStore.save(data);

// Per-listing (report SKU) lifetime + per-period revenue and cost-bearing units,
// so the Pricing tab can roll up profit per master SKU using that SKU's own cost.
// costUnits = units sold minus refunded units that came back to the warehouse
// (their cost is credited back) — same rule the Profit tab uses.
function listingStats() {
  const received = warehouseReceivedUnits();
  const okey = (o) => String(o.sku ?? "").trim() || String(o.item ?? "").trim();
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const bySku = {};
  const runs = loadHistory();
  for (const r of runs) {
    const orders = profitStore.loadOrdersRun(r.id);
    if (!orders) continue;
    for (const o of orders) {
      const sku = okey(o);
      if (!sku) continue;
      const cap = received.get(o.po);
      const returnedToStock = o.refundUnits > 0 && cap !== undefined ? Math.min(o.refundUnits, cap) : 0;
      const costUnits = (o.saleUnits || 0) - returnedToStock;
      const rev = o.netPayable || 0;
      const iso = toIsoDay(o.date) || null;
      const s = bySku[sku] || (bySku[sku] = { lifetime: { revenue: 0, saleUnits: 0, refundUnits: 0, costUnits: 0 }, _d: {} });
      s.lifetime.revenue += rev; s.lifetime.saleUnits += o.saleUnits || 0; s.lifetime.refundUnits += o.refundUnits || 0; s.lifetime.costUnits += costUnits;
      const key = (iso || "?") + "|" + r.id;
      const d = s._d[key] || (s._d[key] = { date: iso, periodId: r.id, revenue: 0, saleUnits: 0, refundUnits: 0, costUnits: 0 });
      d.revenue += rev; d.saleUnits += o.saleUnits || 0; d.refundUnits += o.refundUnits || 0; d.costUnits += costUnits;
    }
  }
  for (const sku of Object.keys(bySku)) {
    const s = bySku[sku];
    s.lifetime.revenue = round2(s.lifetime.revenue);
    s.days = Object.values(s._d)
      .map((d) => ({ date: d.date, periodId: d.periodId, revenue: round2(d.revenue), saleUnits: d.saleUnits, refundUnits: d.refundUnits, costUnits: d.costUnits }))
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    delete s._d;
  }
  const periods = runs
    .map((r) => ({ id: r.id, label: r.label, ranAt: r.ranAt }))
    .sort((a, b) => String(b.ranAt || "").localeCompare(String(a.ranAt || "")));
  return { bySku, periods };
}

// Import unit costs from a CSV (same shape as the cost Download: SKU, Product,
// Unit Cost). Tolerant header matching; strips the Excel ="..." text wrapper.
function importCostsCsv(text) {
  const parsed = Papa.parse(String(text || "").replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" });
  const fields = parsed.meta.fields || [];
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const find = (...aliases) => fields.find((f) => aliases.includes(norm(f)));
  const skuCol = find("sku", "partneritemid", "itemid", "returnedsku");
  const costCol = find("unitcost", "cost", "price");
  const nameCol = find("product", "productname", "name", "item");
  const vendorCol = find("vendor", "supplier", "source", "boughtfrom");
  if (!skuCol || !costCol) {
    throw new Error('CSV needs a "SKU" column and a "Unit Cost" (or "Cost") column.');
  }
  const unwrap = (v) => { const s = String(v ?? "").trim(); const m = /^="(.*)"$/.exec(s); return m ? m[1] : s; };
  const entries = parsed.data.map((r) => ({
    sku: unwrap(r[skuCol]),
    cost: unwrap(r[costCol]),
    name: nameCol ? unwrap(r[nameCol]) : "",
    vendor: vendorCol ? unwrap(r[vendorCol]) : "",
  }));
  return profitStore.importCosts(entries);
}
// Parse a QuickBooks "Inventory Valuation Detail" export (one item per file) and
// pull the transaction rows of a given Type (default: Purchase Order). Each row
// yields { date(ISO), vendor (the Name column), qty, cost (the Sales Price /
// unit-cost column), num }. The "Sales Price" column in this report is the unit
// cost paid. Returns { item, purchases, vendors, count }.
async function importQuickbooksPOs(filePath, typeFilter) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  const lower = String(filePath).toLowerCase();
  if (lower.endsWith(".csv")) await wb.csv.readFile(filePath);
  else await wb.xlsx.readFile(filePath);

  const wantType = String(typeFilter || "purchase order").toLowerCase().replace(/[^a-z0-9]/g, "");
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const cellText = (v) => {
    if (v == null) return "";
    if (typeof v === "object") {
      if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
      if (v.text != null) return String(v.text);
      if (v.result != null) return String(v.result);
      return "";
    }
    return String(v);
  };
  const cellNum = (v) => {
    if (v == null || v === "") return null;
    if (typeof v === "object") { return v.result != null ? Number(v.result) : null; }
    const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? null : n;
  };
  const cellDate = (v) => {
    if (v == null || v === "") return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "object" && v.result instanceof Date) return v.result.toISOString().slice(0, 10);
    return toIsoDay(cellText(v)) || null;
  };

  // A short, human label for the per-line variant (color etc.), so a file that
  // mixes e.g. Gray and Silver POs can be split by the SKU it belongs to.
  const variantOf = (memo) => {
    if (!memo) return "(unspecified)";
    const m = memo.match(/\b(gray|grey|silver|black|blue|gold|white|green|red|pink|purple|graphite|titanium|natural)\b/i);
    if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const w = String(memo).trim().split(/\s+/);
    return w[w.length - 1] || "(unspecified)";
  };

  let item = "";
  const purchases = [];
  const vendorSet = new Map(); // norm -> display
  const variantCount = new Map(); // label -> count

  wb.eachSheet((ws) => {
    // Locate the header row (Type / Date / Num / Name / Qty / Sales Price) and map columns.
    let header = null;
    const col = {};
    const maxScan = Math.min(ws.rowCount || 0, 50);
    for (let r = 1; r <= maxScan; r++) {
      const map = {};
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
        const t = norm(cellText(cell.value));
        if (t === "type") map.type = c;
        else if (t === "date") map.date = c;
        else if (t === "num") map.num = c;
        else if (t === "name") map.name = c;
        else if (t === "qty" || t === "quantity") map.qty = c;
        else if (t === "memo" || t === "description" || t === "desc") map.memo = c;
        else if (t === "salesprice" || t === "unitcost" || t === "cost" || t === "rate") map.price = c;
      });
      if (map.type && map.date && map.name && map.price) { header = r; Object.assign(col, map); break; }
    }
    if (!header) return;

    const get = (row, c) => (c ? row.getCell(c).value : null);
    for (let r = header + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const type = norm(cellText(get(row, col.type)));
      if (!type) {
        // Section/item label rows have descriptive text in a column left of Type.
        if (!item) {
          for (let c = 1; c < col.type; c++) {
            const txt = cellText(get(row, c)).trim();
            if (txt && /[A-Za-z]/.test(txt) && !/^(on hand|tot |total|on purchase|inventory)/i.test(txt)) { item = txt; break; }
          }
        }
        continue;
      }
      if (type !== wantType) continue;
      const cost = cellNum(get(row, col.price));
      const vendor = cellText(get(row, col.name)).trim();
      if (cost == null || !vendor) continue;
      const qty = cellNum(get(row, col.qty));
      const memo = cellText(get(row, col.memo)).trim();
      const variant = variantOf(memo);
      purchases.push({ date: cellDate(get(row, col.date)), vendor, qty: qty != null ? qty : null, cost, num: cellText(get(row, col.num)).trim() || null, memo, variant });
      if (!vendorSet.has(norm(vendor))) vendorSet.set(norm(vendor), vendor);
      variantCount.set(variant, (variantCount.get(variant) || 0) + 1);
    }
  });

  const variants = [...variantCount.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  return { item, purchases, vendors: [...vendorSet.values()], count: purchases.length, variants };
}
const costHistory = (sku) => profitStore.costHistoryFor(sku);
const editCost = (sku, index, cost) => ({ cost: profitStore.editCostAt(sku, index, cost) });
const deleteCost = (sku, index) => ({ cost: profitStore.deleteCostAt(sku, index) });

function profitDaily(runId) {
  const daily = profitStore.loadDailyRun(runId);
  if (!daily) return null;
  let profitByDay = {};
  const orders = profitStore.loadOrdersRun(runId);
  if (orders) profitByDay = profitStore.computeDailyProfit(orders, profitStore.loadCosts(), warehouseReceivedUnits(), pricingCostResolver());
  return { ...daily, profitByDay, statement: profitStore.loadStatementRun(runId) };
}

function profitOrders(runId) {
  const orders = profitStore.loadOrdersRun(runId);
  if (!orders) return null;
  return profitStore.computeRun(orders, profitStore.loadCosts(), warehouseReceivedUnits(), pricingCostResolver()).orders;
}

// ---------- Transactions ledger (deduped across all runs) ----------

// Deduped, date-sorted ledger across every run. Cached and rebuilt only when a
// run file changes — this is the hot path behind the Transactions tab (search
// runs it on each keystroke), and rebuilding it walked every run's cache. The
// returned array is read-only to callers (they filter/slice into new arrays).
let _allTxCache = null; // { sig, rows }
function allTransactions() {
  const ids = loadHistory().map((r) => r.id);
  const sig = profitStore.runsSignature(ids);
  if (_allTxCache && _allTxCache.sig === sig) return _allTxCache.rows;
  const seen = new Map();
  for (const id of ids) {
    const tx = profitStore.loadTransactionsRun(id);
    if (!tx) continue;
    for (const t of tx) if (!seen.has(t.key)) seen.set(t.key, t);
  }
  const rows = [...seen.values()].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  _allTxCache = { sig, rows };
  return rows;
}

// distinct transaction types present, for the Type filter
function transactionTypes() {
  const s = new Set();
  for (const t of allTransactions()) if (t.type) s.add(t.type);
  return [...s].sort();
}

// Per-SKU fee components, summed from each transaction's Amount Type breakdown.
// Enables "average commission / referral fee for this SKU" analysis. Only
// transactions imported with the breakdown contribute (older imports stored
// only the net — withBreakdown reports how many had detail).
function feesBySku(sku) {
  const key = String(sku ?? "").trim();
  const components = {};
  let transactions = 0, sales = 0, units = 0, withBreakdown = 0;
  for (const t of allTransactions()) {
    if (String(t.itemId ?? "").trim() !== key) continue;
    transactions++;
    if (t.type === "Sale") { sales++; units += t.qty || 0; }
    if (t.breakdown && typeof t.breakdown === "object") {
      withBreakdown++;
      for (const [at, amt] of Object.entries(t.breakdown)) components[at] = (components[at] || 0) + Number(amt || 0);
    }
  }
  return { sku: key, transactions, sales, units, withBreakdown, components };
}

// search/filter; returns up to `limit` matches plus the total count
function listTransactions({ q = "", field = "all", type = "", limit = 1000 } = {}) {
  const needle = String(q).trim().toLowerCase();
  let rows = allTransactions();
  if (type) rows = rows.filter((t) => t.type === type);
  if (needle) {
    rows = rows.filter((t) => {
      if (field === "po") return String(t.po).toLowerCase().includes(needle);
      if (field === "order") return String(t.order ?? "").toLowerCase().includes(needle);
      if (field === "item") return String(t.itemId).toLowerCase().includes(needle);
      if (field === "type") return String(t.type).toLowerCase().includes(needle);
      return [t.po, t.order, t.itemId, t.type].some((v) => String(v ?? "").toLowerCase().includes(needle));
    });
  }
  return { rows: rows.slice(0, limit), total: rows.length };
}

// Every charge line for ONE specific PO (or Customer Order #) across all of its
// transactions — the spreadsheet-style statement. Uses the raw per-line detail
// when available (preserves duplicate Amount Types), else the summed breakdown,
// else the transaction's net as a single line.
function transactionLines({ po = "", order = "" } = {}) {
  const wantPo = String(po).trim().toLowerCase();
  const wantOrder = String(order).trim().toLowerCase();
  if (!wantPo && !wantOrder) return { lines: [], total: 0, transactions: 0, po, order };
  const txs = allTransactions().filter(
    (t) =>
      (wantPo && String(t.po ?? "").toLowerCase() === wantPo) ||
      (wantOrder && String(t.order ?? "").toLowerCase() === wantOrder)
  );
  const lines = [];
  let total = 0;
  for (const t of txs) {
    const base = { po: t.po, order: t.order || "", date: t.date, type: t.type, itemId: t.itemId, qty: t.qty || 0 };
    if (Array.isArray(t.lines) && t.lines.length) {
      for (const l of t.lines) { lines.push({ ...base, amountType: l.at, amount: Number(l.amt || 0) }); total += Number(l.amt || 0); }
    } else if (t.breakdown && typeof t.breakdown === "object" && Object.keys(t.breakdown).length) {
      for (const [at, a] of Object.entries(t.breakdown)) { lines.push({ ...base, amountType: at, amount: Number(a || 0) }); total += Number(a || 0); }
    } else {
      lines.push({ ...base, amountType: t.type, amount: Number(t.amount || 0) }); total += Number(t.amount || 0);
    }
  }
  return { lines, total: Math.round(total * 100) / 100, transactions: txs.length, po, order };
}

module.exports = {
  configure,
  paths,
  CONDITIONS: store.CONDITIONS,
  loadHistory, listHistory, deleteHistory,
  checkWfs, checkNotReceived,
  listEntries, addEntry, updateEntry, deleteEntry,
  importWarehouseCsv, exportWarehouseCsvText,
  listLosses, deleteLoss,
  runReconcile, exportRun,
  listWfs, markWfsCase, removeWfs, reopenWfs, wfsEmailMailto,
  nrList, nrMarkReceived, nrMarkReimbursed, nrMarkLoss, nrReopen,
  rnrList, rnrMarkReceived, rnrMarkLoss, rnrUnmarkLoss, rnrRemove, rnrMarkCase, rnrReopenCase, rnrSetCaseId, rnrMarkAdjustment, rnrMarkApproved, rnrSetNote, rnrMarkReimbursePending, rnrUnmarkReimbursePending, rnrEmailMailto, exportRnrAudit, importRnrCorrections,
  orderNotesList, orderNotesAdd, orderNotesUpdate, orderNotesRemove, orderNotesAttachImage, orderNotesRemoveImage, orderNotesImageData, noteImagePath, backfillImportedReports, rnrMonthlySummary, rnrCycleSummary, rnrAllTimeSummary, exportRnrMonthly,
  webhookGet, webhookSet, buildDisputeDigest, sendDisputeDigest,
  profitData, monthlyData, setCost, addCost, importCostsCsv, importQuickbooksPOs, costHistory, editCost, deleteCost, profitDaily, profitOrders,
  pricingGet, pricingSave, listingStats,
  listTransactions, transactionLines, transactionTypes, feesBySku,
};
