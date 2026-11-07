/**
 * Smoke test for the ported reconciliation logic — no Electron, no Google API.
 * Builds a synthetic new-format Walmart CSV + synthetic warehouse rows, runs the
 * full parse → reconcile → Excel pipeline, and asserts the issue classification.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { loadRefunds } = require("../src/lib/parseReport");
const store = require("../src/lib/warehouseStore");
const { parseImportCsv } = require("../src/lib/importCsv");
const { findIssues } = require("../src/lib/reconcile");
const { buildReport, classify, toSummary, writeWorkbook } = require("../src/lib/excel");
const { formatPeriod } = require("../src/lib/period");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wm-recon-"));

const fmtDate = (d) =>
  `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

const today = new Date();
const daysAgo = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
const recent = fmtDate(daysAgo(5));
const old = fmtDate(daysAgo(60));

// Synthetic new-format report:
//  PO 001 — refunded, in warehouse once, price matches            → OK
//  PO 002 — refunded, NOT in warehouse, recent                    → MISSING
//  PO 003 — refunded, NOT in warehouse, 60 days old               → MISSING, AGED
//  PO 004 — refunded, in warehouse twice                          → DUPLICATE
//  PO 005 — refunded $300, warehouse logged $250                  → PRICE_MISMATCH
//  PO 006 — WFS, recent, not in warehouse                         → WFS_PENDING
//  PO 007 — two refund rows (split refund), not in warehouse      → MISSING, amounts summed
//  PO 008 — WFS, 60 days old, not in warehouse                    → WFS_OVERDUE
//  PO 009 — WFS, in warehouse                                     → RECEIVED
const header =
  '"Walmart.com PO #","Walmart.com Order #","Transaction Type","Transaction Date Time","Partner Item name","Return Reason Description","Refunded Retail Sales","Payable to Partner from Sale","Fulfillment Type"';
const rows = [
  `"001","O1","REFUNDED","${recent}","Tablet A","Defective","-100.00","-96.00","Seller Fulfilled"`,
  `"002","O2","REFUNDED","${recent}","Tablet B","No Longer Wanted","-200.00","-192.00","Seller Fulfilled"`,
  `"003","O3","REFUNDED","${old}","Tablet C","Defective","-150.00","-144.00","Seller Fulfilled"`,
  `"004","O4","REFUNDED","${recent}","Tablet D","Wrong Item","-120.00","-115.20","Seller Fulfilled"`,
  `"005","O5","REFUNDED","${recent}","Tablet E","Defective","-300.00","-288.00","Seller Fulfilled"`,
  `"006","O6","REFUNDED","${recent}","Tablet F","No Longer Wanted","-80.00","-76.80","Walmart-fulfilled(WFS)"`,
  `"007","O7","REFUNDED","${recent}","Tablet G","Defective","-50.00","-48.00","Seller Fulfilled"`,
  `"007","O7","REFUNDED","${recent}","Tablet G","Defective","-25.00","-24.00","Seller Fulfilled"`,
  `"008","O8","REFUNDED","${old}","Tablet H","No Longer Wanted","-90.00","-86.40","Walmart-fulfilled(WFS)"`,
  `"009","O9","REFUNDED","${recent}","Tablet I","Defective","-60.00","-57.60","Walmart-fulfilled(WFS)"`,
  `"010","O10","REFUNDED","${recent}","Tablet J","Lost After Delivery","-110.00","-105.60","Seller Fulfilled"`,
  `"011","O11","REFUNDED","${recent}","Tablet K","Lost in Transit","-130.00","-124.80","Walmart-fulfilled(WFS)"`,
  `"001","O1","SALE","${recent}","Tablet A","","100.00","96.00","Seller Fulfilled"`,
  `"100","O100","SALE","${recent}","Tablet Z","","200.00","192.00","Seller Fulfilled"`,
];
const csvPath = path.join(tmp, "Digital_World_Shop_10001467995_MP_TEST_reconciliationreport.csv");
fs.writeFileSync(csvPath, [header, ...rows].join("\n"));

// Synthetic warehouse log entries, exercising the local store CRUD
store.init(tmp);
store.addEntry({ po: "001", dateReceived: recent, price: "$100.00", condition: "Open Box", sku: "SKU-A" });
store.addEntry({ po: "004", dateReceived: recent, price: "$120.00", condition: "New / Sealed", sku: "SKU-D" });
store.addEntry({ po: "004 ", dateReceived: recent, price: "", condition: "", sku: "SKU-D" });
store.addEntry({ po: "005", dateReceived: recent, price: "250", condition: "Damaged", sku: "SKU-E" });
store.addEntry({ po: "009", dateReceived: recent, price: "$60.00", condition: "Open Box", sku: "SKU-I" });
const doomed = store.addEntry({ po: "999", dateReceived: recent, price: "", condition: "", sku: "" }).at(-1);
store.deleteEntry(doomed.id);
assert.throws(() => store.addEntry({ po: "  " }), /PO # is required/, "blank PO rejected");

// PO#-only import: column A only, first cell "PO#", straight PO numbers below
{
  const poOnlyCsv = "PO#\n129111111111111\n119222222222222\n\n129333333333333\n";
  const { raws } = parseImportCsv(poOnlyCsv);
  assert.strictEqual(raws.length, 3, "blank line skipped, 3 PO rows parsed");
  assert.strictEqual(raws[0].po, "129111111111111", "PO read as string from column A");
  assert.strictEqual(raws[0].condition ?? "", "", "no condition column → empty");
  const before = store.load().length;
  const { added } = store.addMany(raws);
  assert.strictEqual(added, 3, "all 3 PO-only rows imported");
  const imported = store.load().slice(before);
  imported.forEach((e) => store.deleteEntry(e.id)); // keep the rest of the test unaffected
  assert.throws(() => parseImportCsv("Item,Price\nx,1"), /PO # column/, "CSV without PO column rejected");
}

(async () => {
  const { refunds, format, period } = loadRefunds(csvPath);
  assert.strictEqual(format, "new", "format detection");
  assert.strictEqual(refunds.length, 11, "11 unique refunded POs");

  // Period: oldest refund (60d ago) → newest (5d ago), e.g. "Apr 13 - Jun 7, 2026"
  assert.strictEqual(period.start.getTime(), daysAgo(60).getTime(), "period start = oldest refund");
  assert.strictEqual(period.end.getTime(), daysAgo(5).getTime(), "period end = newest refund");
  const label = formatPeriod(period.start, period.end);
  assert.match(label, /^[A-Z][a-z]{2} \d{1,2} - [A-Z][a-z]{2} \d{1,2}, \d{4}$/, "period label format");
  assert.strictEqual(formatPeriod(null, period.end), null, "unparseable period → null label");
  assert.strictEqual(
    formatPeriod(new Date(2025, 11, 28), new Date(2026, 0, 5)),
    "Dec 28, 2025 - Jan 5, 2026",
    "cross-year period label"
  );

  const po7 = refunds.find((r) => r["PO #"] === "007");
  assert.strictEqual(po7["Refunded Retail Sales"], 75, "split refund summed and sign-flipped");
  assert.strictEqual(po7["Net Refund (Payable Impact)"], 72, "net refund summed and sign-flipped");

  const warehouse = store.toReconcileRows(store.load());
  assert.strictEqual(warehouse.length, 5, "deleted entry gone, 5 rows remain");

  const { seller, wfs } = findIssues(refunds, warehouse);
  assert.strictEqual(seller.length, 7, "7 seller-fulfilled");
  assert.strictEqual(wfs.length, 4, "4 WFS");

  const wfsByPo = Object.fromEntries(wfs.map((r) => [r["PO #"], r.Issues]));
  assert.strictEqual(wfsByPo["006"], "WFS_PENDING", "recent WFS not received → pending");
  assert.strictEqual(wfsByPo["008"], "WFS_OVERDUE", "60-day-old WFS not received → overdue");
  assert.strictEqual(wfsByPo["009"], "RECEIVED", "WFS found in warehouse → received");
  assert.strictEqual(wfsByPo["011"], "LOST", "lost-in-transit WFS → LOST immediately, no 45-day wait");

  const issuesByPo = Object.fromEntries(seller.map((r) => [r["PO #"], r.Issues]));
  assert.strictEqual(issuesByPo["001"], "OK");
  assert.strictEqual(issuesByPo["002"], "MISSING");
  assert.strictEqual(issuesByPo["003"], "MISSING, AGED");
  assert.strictEqual(issuesByPo["004"], "DUPLICATE", "trims PO before counting");
  assert.strictEqual(issuesByPo["005"], "PRICE_MISMATCH");
  assert.strictEqual(issuesByPo["007"], "MISSING");
  assert.strictEqual(issuesByPo["010"], "LOST", "lost-after-delivery seller PO → LOST, not MISSING/AGED");

  const po5 = seller.find((r) => r["PO #"] === "005");
  assert.strictEqual(po5["Warehouse Condition"], "Damaged", "manually-marked condition carried through");

  const outPath = path.join(tmp, "Reconciliation_TEST.xlsx");
  const counts = await buildReport(seller, wfs, outPath, "TEST");

  // In-app summary (what a reconcile run now stores instead of writing a workbook)
  {
    const { rows, counts: c2 } = classify(seller, wfs);
    const summary = toSummary(rows);
    assert.strictEqual(c2.notReceived.count, counts.notReceived.count, "classify() matches buildReport() counts");
    assert.strictEqual(summary.notReceived.length, counts.notReceived.count, "summary rows per bucket");
    assert.strictEqual(summary.wfsWaiting.length, counts.wfsWaiting.count, "summary WFS rows");
    assert.strictEqual(summary.received.length, counts.received.count, "summary received rows");
    assert.ok(summary.notReceived.every((r) => typeof r["PO #"] === "string" && r.Status && r.Action), "summary rows carry Status/Action");
    assert.ok(summary.notReceived.every((r) => !("Issues" in r)), "summary rows keep only display columns");
    const onDemand = path.join(tmp, "on-demand.xlsx");
    await writeWorkbook(summary, onDemand, "TEST");
    assert.ok(fs.statSync(onDemand).size > 0, "workbook built from the stored summary");
  }
  assert.deepStrictEqual(
    {
      lost: counts.lost.count,
      aged: counts.agedMissing.count,
      missing: counts.missing.count,
      dup: counts.duplicates.count,
      mismatch: counts.mismatches.count,
      wfsOverdue: counts.wfsOverdue.count,
      wfsPending: counts.wfsPending.count,
    },
    { lost: 2, aged: 1, missing: 2, dup: 1, mismatch: 1, wfsOverdue: 1, wfsPending: 1 },
    "report counts — lost has its own bucket, excluded from missing/aged/pending"
  );
  assert.deepStrictEqual(
    {
      received: counts.received.count,
      notReceived: counts.notReceived.count,
      wfsWaiting: counts.wfsWaiting.count,
      actionNow: counts.actionNow.count,
    },
    { received: 4, notReceived: 5, wfsWaiting: 2, actionNow: 3 },
    "owner buckets — received(001,004,005,009), not-received(002,003,007,010,011), wfs-waiting(006,008)"
  );
  assert.ok(fs.statSync(outPath).size > 5000, "xlsx written");

  // Not Received tracker: strict physical status + reimburse/loss lifecycle
  const nrWatch = require("../src/lib/notReceivedWatch");
  nrWatch.init(tmp);
  const hasTok = (r, t) => r.Issues.split(", ").includes(t);
  const nrRows = [
    ...[...seller, ...wfs].filter((r) => hasTok(r, "LOST")),
    ...seller.filter((r) => hasTok(r, "MISSING")),
  ];
  nrWatch.upsertFromRun(nrRows, "run-1");
  assert.deepStrictEqual(
    nrWatch.load().map((i) => i.po).sort(),
    ["002", "003", "007", "010", "011"],
    "tracker holds every refunded PO never received (missing + lost, seller + WFS)"
  );
  // settlement money is recorded but NEVER changes physical status (strict)
  nrWatch.recordSettlements({ "010": { amount: 120.5, date: "2026-06-01" } });
  let nr = nrWatch.refreshStatuses(new Set(["002"])); // 002 physically arrives
  assert.strictEqual(nr.find((i) => i.po === "002").status, "received", "arrival auto-clears");
  assert.strictEqual(nr.find((i) => i.po === "010").status, "outstanding", "settlement money does not mark it received");
  assert.strictEqual(nr.find((i) => i.po === "010").settlementSeen, 120.5, "Walmart payment surfaced on the item");
  assert.strictEqual(nr.find((i) => i.po === "011").actNow, true, "lost item needs action immediately");
  // owner decisions stick through refreshes
  nrWatch.markReimbursed("010", 120.5);
  nrWatch.markLoss("007");
  nr = nrWatch.refreshStatuses(new Set(["002"]));
  assert.strictEqual(nr.find((i) => i.po === "010").status, "reimbursed", "reimbursed sticks");
  assert.strictEqual(nr.find((i) => i.po === "007").status, "loss", "loss sticks");
  const nrSum = nrWatch.summary();
  assert.strictEqual(nrSum.reimbursed.recovered, 120.5, "recovered money summed");
  assert.strictEqual(nrSum.outstanding.count, 2, "003 + 011 still outstanding");
  nrWatch.reopen("007");
  assert.strictEqual(nrWatch.load().find((i) => i.po === "007").status, "outstanding", "undo works");
  nrWatch.removeByRun("run-1");
  assert.strictEqual(nrWatch.load().length, 0, "deleting the run takes tracker items with it");

  // WFS watchlist lifecycle: track → receive → overdue → case opened → run deletion
  const wfsWatch = require("../src/lib/wfsWatch");
  wfsWatch.init(tmp);
  wfsWatch.upsertFromRun(wfs, "run-1");
  assert.deepStrictEqual(
    wfsWatch.load().map((i) => i.po).sort(),
    ["006", "008", "011"],
    "only not-received WFS tracked"
  );
  let watched = wfsWatch.refreshStatuses(new Set(["006"])); // 006 arrives later
  const w6 = watched.find((i) => i.po === "006");
  const w8 = watched.find((i) => i.po === "008");
  const w11 = watched.find((i) => i.po === "011");
  assert.strictEqual(w6.status, "received", "watchlist auto-clears once PO hits the warehouse log");
  assert.strictEqual(w8.status, "pending", "008 still pending");
  assert.strictEqual(w8.overdue, true, "008 is overdue (>45 days)");
  assert.strictEqual(w11.overdue, true, "lost item overdue immediately despite being only 5 days old");
  wfsWatch.markCase("008");
  watched = wfsWatch.refreshStatuses(new Set(["006"]));
  assert.strictEqual(watched.find((i) => i.po === "008").status, "case_opened", "case sticks");
  assert.strictEqual(watched.find((i) => i.po === "008").overdue, false, "case-opened items stop alerting");
  wfsWatch.reopenCase("008");
  watched = wfsWatch.refreshStatuses(new Set(["006"]));
  assert.strictEqual(watched.find((i) => i.po === "008").status, "pending", "undo returns it to pending");
  assert.strictEqual(watched.find((i) => i.po === "008").overdue, true, "and it alerts again");
  wfsWatch.removeItem("011");
  assert.ok(!wfsWatch.load().some((i) => i.po === "011"), "manual remove works");
  wfsWatch.removeByRun("run-1");
  assert.strictEqual(wfsWatch.load().length, 0, "deleting the source run clears its watch items");
  wfsWatch.upsertFromRun(wfs, "run-2");
  assert.strictEqual(wfsWatch.pruneOrphans(new Set(["run-2"])).length, 3, "items with a live run survive pruning");
  assert.strictEqual(wfsWatch.pruneOrphans(new Set()).length, 0, "orphaned items pruned once their run is gone");

  // Profit: order extraction + cost-based computation
  const { loadOrders } = require("../src/lib/parseReport");
  const profitStore = require("../src/lib/profitStore");
  profitStore.init(tmp);
  const orders = loadOrders(csvPath);
  const byPo = Object.fromEntries(orders.map((o) => [o.po, o]));
  assert.strictEqual(byPo["100"].saleUnits, 1, "pure sale captured");
  assert.strictEqual(byPo["100"].netPayable, 192, "sale payable kept raw (positive)");
  assert.strictEqual(byPo["001"].saleUnits, 1, "001 sold once");
  assert.strictEqual(byPo["001"].refundUnits, 1, "001 refunded once");
  assert.strictEqual(byPo["001"].netPayable, 0, "sale + refund net to zero");

  profitStore.registerProducts(orders);
  // these synthetic orders have no SKU, so cost keys fall back to the item name
  profitStore.setCost("Tablet Z", 120);
  profitStore.setCost("Tablet A", 70);
  profitStore.saveOrders("run-1", orders);
  const computed = profitStore.computeRun(
    profitStore.loadOrdersRun("run-1"),
    profitStore.loadCosts(),
    new Set(["001"]) // 001's return came back to the warehouse
  );
  const c100 = computed.orders.find((o) => o.po === "100");
  assert.strictEqual(c100.profit, 192 - 120, "sale profit = payable - cost");
  const c001 = computed.orders.find((o) => o.po === "001");
  assert.strictEqual(c001.cost, 0, "refunded + returned to stock → cost recovered");
  assert.strictEqual(c001.profit, 0, "net-zero order with recovered unit → zero profit");
  const c002 = computed.orders.find((o) => o.po === "002");
  assert.strictEqual(c002.cost, null, "no cost set → profit unknown, counted as missing");
  assert.ok(computed.totals.ordersMissingCost > 0, "missing-cost orders surfaced in totals");
  profitStore.deleteOrdersRun("run-1");
  assert.strictEqual(profitStore.loadOrdersRun("run-1"), null, "run order cache deletable");

  // SKU-keyed costs: two different item names sharing one SKU use one cost,
  // and a legacy name-keyed cost migrates onto the SKU.
  profitStore.setCost("Galaxy Tab A11 (old name)", 90); // legacy name-keyed entry
  const skuOrders = [
    { po: "S1", item: "Galaxy Tab A11 (old name)", sku: "SM-X133", saleUnits: 1, refundUnits: 0, netPayable: 150, date: recent },
    { po: "S2", item: "Galaxy Tab A11 (new listing name)", sku: "SM-X133", saleUnits: 1, refundUnits: 0, netPayable: 160, date: recent },
  ];
  profitStore.registerProducts(skuOrders);
  const costsAfter = profitStore.loadCosts();
  assert.strictEqual(costsAfter["SM-X133"], 90, "legacy name cost migrated onto the SKU key");
  assert.ok(!("Galaxy Tab A11 (old name)" in costsAfter), "old name key removed after migration");
  assert.strictEqual(profitStore.loadNames()["SM-X133"], "Galaxy Tab A11 (new listing name)", "SKU shows latest item name");
  const skuComputed = profitStore.computeRun(skuOrders, costsAfter, new Set());
  assert.strictEqual(skuComputed.orders.find((o) => o.po === "S1").cost, 90, "S1 priced by SKU");
  assert.strictEqual(skuComputed.orders.find((o) => o.po === "S2").cost, 90, "S2 (same SKU, different name) priced by the same SKU cost");

  // Old-format orders: Ship Qty drives units; adjustments count toward payable
  const oldCsv = [
    '"Period Start Date","Period End Date","Transaction Type","Purchase Order #","Customer Order #","Transaction Posted Timestamp","Partner Item Name","Transaction Reason Description","Amount","Amount Type","Ship Qty","Fulfillment Type"',
    `"04/19/2026","05/15/2026","Sale","500","O500","${recent}","Tablet M","","2404.87","Product Price","13","Seller Fulfilled"`,
    `"04/19/2026","05/15/2026","Sale","500","O500","${recent}","Tablet M","","-48.10","Commission on Product","13","Seller Fulfilled"`,
    `"04/19/2026","05/15/2026","Adjustment","500","O500","${recent}","Tablet M","","-64.35","Fee/Reimbursement","","Seller Fulfilled"`,
    `"04/19/2026","05/15/2026","Refund","501","O501","${recent}","Tablet N","No Longer Wanted","-180.00","Product Price","1","Seller Fulfilled"`,
  ].join("\n");
  const oldCsvPath = path.join(tmp, "old_format_reconciliationreport.csv");
  fs.writeFileSync(oldCsvPath, oldCsv);
  const oldOrders = loadOrders(oldCsvPath);
  const oldByPo = Object.fromEntries(oldOrders.map((o) => [o.po, o]));
  assert.strictEqual(oldByPo["500"].saleUnits, 13, "Ship Qty 13 → 13 units, not 1");
  assert.ok(Math.abs(oldByPo["500"].netPayable - 2292.42) < 0.001, "sale + commission + adjustment all in payable");
  assert.strictEqual(oldByPo["501"].refundUnits, 1, "refund units from Ship Qty");
  assert.strictEqual(oldByPo["501"].netPayable, -180, "refund payable negative");

  // Daily revenue series for the chart
  const { loadDailySeries } = require("../src/lib/parseReport");
  const daily = loadDailySeries(oldCsvPath);
  assert.deepStrictEqual(daily.types, ["Adjustment", "Refund", "Sale"], "types discovered from data");
  assert.strictEqual(daily.days.length, 1, "all synthetic rows share one day");
  const dayData = daily.data[daily.days[0]];
  assert.ok(Math.abs(dayData.Sale - 2356.77) < 0.001, "daily Sale = product price + commission");
  assert.strictEqual(dayData.Refund, -180, "daily Refund negative");
  assert.ok(Math.abs(dayData.Adjustment - -64.35) < 0.001, "daily Adjustment captured");

  // Per-day profit for the chart tooltip
  profitStore.setCost("Tablet M", 100);
  const profitByDay = profitStore.computeDailyProfit(oldOrders, profitStore.loadCosts(), new Set());
  const pd = profitByDay[daily.days[0]];
  assert.strictEqual(pd.orders, 2, "both POs posted that day");
  assert.strictEqual(pd.missingCost, 1, "Tablet N has no cost yet");
  assert.ok(Math.abs(pd.profit - (2292.42 - 13 * 100)) < 0.001, "day profit = payable - 13 units × cost");

  // Verify the workbook re-opens and has the expected tabs
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(outPath);
  const tabNames = wb.worksheets.map((w) => w.name);
  assert.deepStrictEqual(
    tabNames,
    ["Summary", "Not Received", "WFS Waiting", "Received"],
    "workbook tabs — owner buckets"
  );

  // ----- Returns redesign: one side-by-side file + derived RNR statuses -----
  const core = require("../src/lib/core");
  const rnr = require("../src/lib/rnrStore");
  const returnsTmp = fs.mkdtempSync(path.join(os.tmpdir(), "wm-returns-"));
  core.configure({ dataDir: returnsTmp, outputsDir: path.join(returnsTmp, "out") });

  // seed two receipts + one loss, then round-trip through the export CSV
  store.addEntry({ po: "RCV1", dateReceived: "2026-06-10", condition: "Open Box", price: "127.49", sku: "SM-X133", customer: "Jane E", tracking: "1Z999", notes: "Resellable" });
  store.addEntry({ po: "RCV2", dateReceived: "2026-06-09", condition: "Used / Good", price: "120.96", sku: "X620", customer: "Brenda T", tracking: "", notes: "Minor wear" });
  store.addLoss({ po: "LOST1", price: "87.00", sku: "A065M", customer: "M. Ehrenfeld", notes: "Lost in transit" });

  const exp1 = core.exportWarehouseCsvText();
  assert.strictEqual(exp1.count, 2, "two receipts exported");
  assert.strictEqual(exp1.lossCount, 1, "one loss exported");
  assert.ok(exp1.csv.split("\n")[0].includes("LOSS PO#"), "header carries the LOSS PO# marker");

  const before = { entries: store.load(), losses: store.loadLosses() };
  const imp = core.importWarehouseCsv(exp1.csv, "replace");
  assert.strictEqual(imp.added, 2, "round-trip re-imports 2 receipts");
  assert.strictEqual(imp.lossAdded, 1, "round-trip re-imports 1 loss");
  const after = { entries: store.load(), losses: store.loadLosses() };
  const recvShape = (e) => [e.po, e.dateReceived, e.condition, e.price, e.sku, e.customer, e.tracking, e.notes];
  const lossShape = (l) => [l.po, l.price, l.sku, l.customer, l.notes];
  assert.deepStrictEqual(after.entries.map(recvShape), before.entries.map(recvShape), "received list round-trips identically");
  assert.deepStrictEqual(after.losses.map(lossShape), before.losses.map(lossShape), "loss list round-trips identically");
  assert.deepStrictEqual([...store.lostPoSet()], ["LOST1"], "lostPoSet reflects the loss list");

  // a legacy single-column PO# file still imports into Received only
  const legacy = core.importWarehouseCsv("PO#\nLEG1\nLEG2\n", "add");
  assert.strictEqual(legacy.added, 2, "legacy PO-only file imports as received");
  assert.strictEqual(legacy.lossAdded, 0, "legacy file adds no losses");

  // RNR statuses are now DERIVED: received (warehouse) > loss (loss list) >
  // reimbursed (Dispute Settlement seen) > outstanding (none of the above)
  rnr.save([
    { po: "RCV1", type: "Seller", amount: 100, settlementSeen: null, status: "outstanding", refundDate: "2026-06-01", lost: false },
    { po: "LOST1", type: "WFS", amount: 87, settlementSeen: null, status: "outstanding", refundDate: "2026-06-01", lost: false },
    { po: "REIM1", type: "Seller", amount: 50, settlementSeen: 50, status: "outstanding", refundDate: "2026-06-01", lost: false },
    { po: "OPEN1", type: "Seller", amount: 60, settlementSeen: null, status: "outstanding", refundDate: "2026-06-01", lost: false },
  ]);
  const derived = rnr.refreshStatuses(new Set(["RCV1"]), store.lostPoSet());
  const statusByPo = Object.fromEntries(derived.map((i) => [i.po, i.status]));
  assert.strictEqual(statusByPo["RCV1"], "received", "in warehouse log → received");
  assert.strictEqual(statusByPo["LOST1"], "loss", "in loss list → loss");
  assert.strictEqual(statusByPo["REIM1"], "reimbursed", "dispute settlement seen → reimbursed");
  assert.strictEqual(statusByPo["OPEN1"], "outstanding", "nothing matched → outstanding");
  assert.strictEqual(rnr.summary().reimbursed.recovered, 50, "reimbursed recovered = settlement amount");

  // ----- Walmart payouts: lost-item Adjustment reimbursements count too -----
  const { loadSettlements } = require("../src/lib/parseReport");
  const payoutCsv = [
    '"Period Start Date","Period End Date","Transaction Type","Transaction Description","Purchase Order #","Customer Order #","Transaction Posted Timestamp","Amount","Amount Type","Return Reason Description","Partner Item Id"',
    `"04/01/2026","04/30/2026","Adjustment","Shipping Protection Claim Payout","L1","O-L1","${recent}","100.00","Fee/Reimbursement","","SKU-L1"`,
    `"04/01/2026","04/30/2026","Adjustment","Walmart Shipping Label Service Charge","L1","O-L1","${recent}","-11.12","Fee/Reimbursement","","SKU-L1"`,
    `"04/01/2026","04/30/2026","Dispute Settlement","Dispute won","L2","O-L2","${recent}","50.00","Fee/Reimbursement","","SKU-L2"`,
    `"04/01/2026","04/30/2026","Sale","Purchase","L3","O-L3","${recent}","200.00","Product Price","","SKU-L3"`,
  ].join("\n");
  const payoutPath = path.join(tmp, "lost_adjustment_reconciliationreport.csv");
  fs.writeFileSync(payoutPath, payoutCsv);
  const settled = loadSettlements(payoutPath);
  assert.strictEqual(settled["L1"]?.amount, 100, "positive lost-item Fee/Reimbursement adjustment captured");
  assert.strictEqual(settled["L1"]?.kind, "adjustment", "lost-item payout classified as an adjustment");
  assert.strictEqual(settled["L2"]?.amount, 50, "dispute settlement still captured");
  assert.strictEqual(settled["L2"]?.kind, "dispute", "dispute settlement classified as a dispute");
  assert.ok(!("L3" in settled), "ordinary sale is not a payout");
  assert.ok(!Object.values(settled).some((v) => v.amount < 0), "negative shipping-label charge never counted");

  // applySettlements is idempotent and SETS from the aggregate — so it both
  // tags new payouts AND clears stale ones that are no longer present.
  rnr.save([
    { po: "L1", type: "Seller", amount: 120, settlementSeen: null, status: "outstanding", refundDate: "2026-06-01", lost: true },
    { po: "STALE", type: "Seller", amount: 50, settlementSeen: 99, status: "outstanding", refundDate: "2026-06-01", lost: false },
  ]);
  rnr.applySettlements({ L1: { amount: 100, date: "2026-06-02", kind: "adjustment" } });
  const afterPay = rnr.refreshStatuses(new Set(), new Set());
  assert.strictEqual(afterPay.find((i) => i.po === "L1").status, "reimbursed", "payout flips L1 to reimbursed");
  assert.strictEqual(afterPay.find((i) => i.po === "L1").settlementSeen, 100, "settlementSeen set from aggregate");
  assert.strictEqual(afterPay.find((i) => i.po === "L1").settlementKind, "adjustment", "payout kind persisted on the item");
  assert.strictEqual(afterPay.find((i) => i.po === "STALE").settlementSeen, null, "stale settlement cleared when absent from aggregate");
  assert.strictEqual(afterPay.find((i) => i.po === "STALE").status, "outstanding", "and STALE reverts to outstanding");

  console.log("All smoke tests passed.");
  console.log(`Sample report: ${outPath}`);
})().catch((err) => {
  console.error("SMOKE TEST FAILED:", err.message);
  process.exit(1);
});
