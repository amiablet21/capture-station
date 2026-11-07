/**
 * Three-bucket classification + optional Excel writer.
 *
 * classify() turns the reconcile rows into the owner-simple buckets (Received /
 * Not Received / WFS Waiting), decorating each row with Days Ago, Status, Action
 * and Note. A reconcile run keeps that summary in its history record and shows
 * it in the app; nothing is written to disk unless the owner asks for the
 * workbook, which writeWorkbook() builds from the same rows on demand.
 * The fine-grained issue taxonomy (LOST/AGED/DUPLICATE/…) still drives the
 * Status / Action / Note columns inside each tab, it just no longer gets a
 * tab per issue.
 */
const ExcelJS = require("exceljs");

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
const HEADER_FONT = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const TOTAL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" } };
const THIN = { style: "thin", color: { argb: "FFCCCCCC" } };
const BORDER = { left: THIN, right: THIN, top: THIN, bottom: THIN };
const MONEY_FMT = "$#,##0.00";
const MONEY_COLS = new Set(["Refunded Retail Sales", "Net Refund (Payable Impact)", "Warehouse Price"]);
const TOTAL_COLS = new Set(["Refunded Retail Sales", "Net Refund (Payable Impact)"]);

const WIDTH_MAP = {
  "PO #": 20, "Order #": 20, "Refund Date": 14, "Days Ago": 10, Item: 50,
  "Refunded Retail Sales": 16, "Net Refund (Payable Impact)": 18,
  "Return Reason": 30, "Fulfillment Type": 18,
  Status: 22, Action: 26, Note: 34,
  "Warehouse Count": 12, "Warehouse Price": 14, "Warehouse Condition": 18,
};

// Trace columns for items you don't have — everything needed to chase one down
const TRACE_COLS = [
  "PO #", "Order #", "Refund Date", "Days Ago", "Item",
  "Refunded Retail Sales", "Net Refund (Payable Impact)",
  "Return Reason", "Fulfillment Type", "Status", "Action",
];

// Columns for items that DID arrive
const RECEIVED_COLS = [
  "PO #", "Order #", "Refund Date", "Item",
  "Refunded Retail Sales", "Warehouse Price", "Warehouse Condition",
  "Fulfillment Type", "Note",
];

function colLetter(i) {
  let s = "";
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function writeDetailSheet(wb, sheetName, rows, columns) {
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });

  columns.forEach((h, idx) => {
    const c = ws.getCell(1, idx + 1);
    c.value = h;
    c.font = HEADER_FONT;
    c.fill = HEADER_FILL;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = BORDER;
  });

  rows.forEach((row, rIdx) => {
    columns.forEach((col, cIdx) => {
      let val = row[col];
      if (val === null || val === undefined || (typeof val === "number" && !Number.isFinite(val))) {
        val = "";
      } else if (typeof val !== "number") {
        val = String(val).slice(0, 200);
      }
      const cell = ws.getCell(rIdx + 2, cIdx + 1);
      cell.value = val;
      cell.border = BORDER;
      cell.font = { name: "Arial", size: 10 };
      if (MONEY_COLS.has(col)) cell.numFmt = MONEY_FMT;
    });
  });

  if (rows.length > 0) {
    const tr = rows.length + 2;
    ws.getCell(tr, 1).value = "TOTAL";
    columns.forEach((col, cIdx) => {
      const cell = ws.getCell(tr, cIdx + 1);
      if (TOTAL_COLS.has(col)) {
        const letter = colLetter(cIdx + 1);
        cell.value = { formula: `SUM(${letter}2:${letter}${tr - 1})` };
        cell.numFmt = MONEY_FMT;
      }
      cell.fill = TOTAL_FILL;
      cell.font = { name: "Arial", bold: true };
      cell.border = BORDER;
    });
    ws.autoFilter = `A1:${colLetter(columns.length)}${rows.length + 1}`;
  }

  columns.forEach((col, cIdx) => {
    ws.getColumn(cIdx + 1).width = WIDTH_MAP[col] || 15;
  });
}

function sumNet(rows) {
  return rows.reduce((acc, r) => acc + (r["Net Refund (Payable Impact)"] || 0), 0);
}

function byNetDesc(a, b) {
  return (b["Net Refund (Payable Impact)"] || 0) - (a["Net Refund (Payable Impact)"] || 0);
}

const bucket = (rows) => ({ count: rows.length, total: sumNet(rows) });

const MS_PER_DAY = 24 * 60 * 60 * 1000;
function daysAgo(row, today) {
  if (!row.refundDateParsed) return "";
  return Math.max(0, Math.floor((today - row.refundDateParsed) / MS_PER_DAY));
}

// Status strings on the stored rows — writeWorkbook() reads them back to
// rebuild the "act now" / "overdue" summary lines without the issue tokens.
const STATUS = {
  lost: "Lost (per Walmart)",
  aged: "Missing >30 days",
  missing: "Missing (recent)",
  wfsOverdue: "Overdue (>45 days)",
  wfsPending: "Pending",
};
const isActNow = (r) => r.Status === STATUS.lost || r.Status === STATUS.aged;
const isWfsOverdue = (r) => r.Status === STATUS.wfsOverdue;

/**
 * Sort the reconcile rows into the three owner buckets and decorate them with
 * the owner-facing columns. Pure: no I/O.
 *
 * Returns { rows: { received, notReceived, wfsWaiting }, counts } where rows
 * are sorted "needs action first, biggest dollars first", and counts is the
 * { count, total } map stored on every run (owner buckets + legacy keys).
 */
function classify(seller, wfs, today = new Date()) {
  const hasToken = (r, token) => r.Issues.split(", ").includes(token);
  const missingAll = seller.filter((r) => hasToken(r, "MISSING"));
  const aged = missingAll.filter((r) => hasToken(r, "AGED"));
  const missingRecent = missingAll.filter((r) => !hasToken(r, "AGED"));
  const duplicates = seller.filter((r) => hasToken(r, "DUPLICATE"));
  const mismatches = seller.filter((r) => hasToken(r, "PRICE_MISMATCH"));
  const lost = [...seller, ...wfs].filter((r) => hasToken(r, "LOST"));
  const wfsOverdue = wfs.filter((r) => r.Issues === "WFS_OVERDUE");
  const wfsPending = wfs.filter((r) => r.Issues === "WFS_PENDING");

  // ----- The three owner buckets -----
  const notReceivedRows = [...lost, ...aged, ...missingRecent];
  const wfsWaitingRows = [...wfsOverdue, ...wfsPending];
  const receivedRows = [
    ...seller.filter((r) => (r["Warehouse Count"] || 0) >= 1),
    ...wfs.filter((r) => /RECEIVED/.test(r.Issues)),
  ];
  const actionNowRows = [...lost, ...aged]; // dispute/case material today

  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // Decorate rows with the owner-facing columns
  for (const r of notReceivedRows) {
    r["Days Ago"] = daysAgo(r, todayMidnight);
    if (hasToken(r, "LOST")) {
      r.Status = STATUS.lost;
      r.Action = "Open dispute / case now";
    } else if (hasToken(r, "AGED")) {
      r.Status = STATUS.aged;
      r.Action = "Open dispute now";
    } else {
      r.Status = STATUS.missing;
      r.Action = "Watch for arrival";
    }
  }
  for (const r of wfsWaitingRows) {
    r["Days Ago"] = daysAgo(r, todayMidnight);
    if (r.Issues === "WFS_OVERDUE") {
      r.Status = STATUS.wfsOverdue;
      r.Action = "Open case with Walmart";
    } else {
      r.Status = STATUS.wfsPending;
      r.Action = "Wait — within return window";
    }
  }
  for (const r of receivedRows) {
    const notes = [];
    if (hasToken(r, "PRICE_MISMATCH")) notes.push("Price differs from refund");
    if (hasToken(r, "DUPLICATE")) notes.push("Logged more than once");
    if (hasToken(r, "LOST_BUT_RECEIVED")) notes.push("Marked lost but arrived — review refund");
    r.Note = notes.join(" · ");
  }

  // Action-needed first, biggest dollars first
  const nrRank = (r) => (hasToken(r, "LOST") ? 0 : hasToken(r, "AGED") ? 1 : 2);
  notReceivedRows.sort((a, b) => nrRank(a) - nrRank(b) || byNetDesc(a, b));
  wfsWaitingRows.sort((a, b) => (a.Issues === "WFS_OVERDUE" ? 0 : 1) - (b.Issues === "WFS_OVERDUE" ? 0 : 1) || byNetDesc(a, b));
  receivedRows.sort((a, b) => (b.Note ? 1 : 0) - (a.Note ? 1 : 0) || byNetDesc(a, b));

  const counts = {
    // owner buckets
    received: bucket(receivedRows),
    notReceived: bucket(notReceivedRows),
    wfsWaiting: bucket(wfsWaitingRows),
    actionNow: bucket(actionNowRows),
    // legacy fine-grained keys — history records and older UI paths still read these
    lost: bucket(lost),
    agedMissing: bucket(aged),
    missing: bucket(missingRecent),
    duplicates: bucket(duplicates),
    mismatches: bucket(mismatches),
    wfsOverdue: bucket(wfsOverdue),
    wfsPending: bucket(wfsPending),
  };

  return { rows: { received: receivedRows, notReceived: notReceivedRows, wfsWaiting: wfsWaitingRows }, counts };
}

// The slice of each bucket that a run keeps in its history record: just the
// columns the summary tables and the on-demand workbook show, as plain values.
const pickCols = (rows, cols) =>
  rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? "" : r[c]])));

function toSummary(rows) {
  return {
    notReceived: pickCols(rows.notReceived, TRACE_COLS),
    wfsWaiting: pickCols(rows.wfsWaiting, TRACE_COLS),
    // received rows also keep the net refund (not a Received-tab column) so
    // the bucket total can be summed from the stored summary
    received: pickCols(rows.received, [...RECEIVED_COLS, "Net Refund (Payable Impact)"]),
  };
}

/**
 * Write the workbook (Summary + three detail tabs) from a stored summary —
 * { notReceived, wfsWaiting, received } row arrays as toSummary() shapes them.
 */
async function writeWorkbook(summary, outputPath, reportLabel) {
  const notReceivedRows = summary.notReceived || [];
  const wfsWaitingRows = summary.wfsWaiting || [];
  const receivedRows = summary.received || [];
  const actionNowRows = notReceivedRows.filter(isActNow);
  const wfsOverdue = wfsWaitingRows.filter(isWfsOverdue);

  const wb = new ExcelJS.Workbook();

  // ----- Summary -----
  const ws = wb.addWorksheet("Summary");
  ws.getCell("A1").value = `Reconciliation Report — ${reportLabel}`;
  ws.getCell("A1").font = { name: "Arial", bold: true, size: 14 };
  ws.mergeCells("A1:C1");
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  ws.getCell("A3").value = "Generated";
  ws.getCell("B3").value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  ws.getCell("A4").value = "Refunded POs checked";
  ws.getCell("B4").value = receivedRows.length + notReceivedRows.length + wfsWaitingRows.length;

  ws.getCell("A6").value = "Where is it?";
  ws.getCell("B6").value = "POs";
  ws.getCell("C6").value = "Refund $";
  ["A6", "B6", "C6"].forEach((addr) => {
    ws.getCell(addr).font = HEADER_FONT;
    ws.getCell(addr).fill = HEADER_FILL;
  });

  const summaryRows = [
    ["✔ Received — in your warehouse", receivedRows, "FFE2EFDA"],
    ["✘ Not received — you don't have these", notReceivedRows, "FFFCE4E4"],
    ["      of which: act now (lost / >30 days)", actionNowRows, "FFF8CBAD"],
    ["⏳ WFS — waiting on Walmart", wfsWaitingRows, "FFFFF2CC"],
    ["      of which: overdue (>45 days, open case)", wfsOverdue, "FFF8CBAD"],
  ];
  summaryRows.forEach(([label, rows, color], i) => {
    const r = i + 7;
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 2).value = rows.length;
    ws.getCell(r, 3).value = sumNet(rows);
    ws.getCell(r, 3).numFmt = MONEY_FMT;
    for (let c = 1; c <= 3; c++) {
      ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    }
  });
  ws.getCell("A13").value = "Trace any individual item in the Not Received tab — sorted so the ones needing action are on top.";
  ws.getCell("A13").font = { name: "Arial", italic: true, size: 10 };
  ws.getColumn(1).width = 44;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 18;

  writeDetailSheet(wb, "Not Received", notReceivedRows, TRACE_COLS);
  writeDetailSheet(wb, "WFS Waiting", wfsWaitingRows, TRACE_COLS);
  writeDetailSheet(wb, "Received", receivedRows, RECEIVED_COLS);

  await wb.xlsx.writeFile(outputPath);
}

// Classify and write in one go (used by the smoke test). Returns the counts.
async function buildReport(seller, wfs, outputPath, reportLabel) {
  const { rows, counts } = classify(seller, wfs);
  await writeWorkbook(toSummary(rows), outputPath, reportLabel);
  return counts;
}

module.exports = { classify, toSummary, writeWorkbook, buildReport, TRACE_COLS, RECEIVED_COLS };
