'use strict';
// Three-bucket classification + the on-demand period workbook — ported from
// the Walmart app's src/lib/excel.js (spec docs/recovery/SPEC.md §5).
// classify() turns the reconcile rows into the owner-simple buckets
// (Received / Not received / WFS waiting), decorating each row with Days
// Ago, Status, Action and Note. A run keeps that summary in SQLite; nothing
// is written to disk unless the owner asks for the workbook, which
// buildRunWorkbook() builds from the same rows on demand (the app's own
// dependency-free xlsx writer stands in for ExcelJS).
const { buildWorkbookSheets } = require('../xlsxwrite');

// Trace columns for items you don't have — everything needed to chase one down
const TRACE_COLS = [
  'PO #', 'Order #', 'Refund Date', 'Days Ago', 'Item',
  'Refunded Retail Sales', 'Net Refund (Payable Impact)',
  'Return Reason', 'Fulfillment Type', 'Status', 'Action',
];

// Columns for items that DID arrive
const RECEIVED_COLS = [
  'PO #', 'Order #', 'Refund Date', 'Item',
  'Refunded Retail Sales', 'Warehouse Price', 'Warehouse Condition',
  'Fulfillment Type', 'Note',
];

const WIDTH_MAP = {
  'PO #': 20, 'Order #': 20, 'Refund Date': 14, 'Days Ago': 10, Item: 50,
  'Refunded Retail Sales': 16, 'Net Refund (Payable Impact)': 18,
  'Return Reason': 30, 'Fulfillment Type': 18,
  Status: 22, Action: 26, Note: 34,
  'Warehouse Count': 12, 'Warehouse Price': 14, 'Warehouse Condition': 18,
};
const MONEY_COLS = new Set(['Refunded Retail Sales', 'Net Refund (Payable Impact)', 'Warehouse Price']);
const TOTAL_COLS = new Set(['Refunded Retail Sales', 'Net Refund (Payable Impact)']);
const INT_COLS = new Set(['Days Ago', 'Warehouse Count']);

function sumNet(rows) {
  return rows.reduce((acc, r) => acc + (r['Net Refund (Payable Impact)'] || 0), 0);
}

function byNetDesc(a, b) {
  return (b['Net Refund (Payable Impact)'] || 0) - (a['Net Refund (Payable Impact)'] || 0);
}

const bucket = (rows) => ({ count: rows.length, total: Math.round(sumNet(rows) * 100) / 100 });

const MS_PER_DAY = 24 * 60 * 60 * 1000;
function daysAgo(row, today) {
  if (!row.refundDateParsed) return '';
  return Math.max(0, Math.floor((today - row.refundDateParsed) / MS_PER_DAY));
}

// Status strings on the stored rows — the workbook reads them back to
// rebuild the "act now" / "overdue" summary lines without the issue tokens.
const STATUS = {
  lost: 'Lost (per Walmart)',
  aged: 'Missing >30 days',
  missing: 'Missing (recent)',
  wfsOverdue: 'Overdue (>45 days)',
  wfsPending: 'Pending',
};
const isActNow = (r) => r.Status === STATUS.lost || r.Status === STATUS.aged;
const isWfsOverdue = (r) => r.Status === STATUS.wfsOverdue;

/**
 * Sort the reconcile rows into the three owner buckets and decorate them
 * with the owner-facing columns. Pure: no I/O.
 */
function classify(seller, wfs, today = new Date()) {
  const hasToken = (r, token) => String(r.Issues || '').split(', ').includes(token);
  const missingAll = seller.filter((r) => hasToken(r, 'MISSING'));
  const aged = missingAll.filter((r) => hasToken(r, 'AGED'));
  const missingRecent = missingAll.filter((r) => !hasToken(r, 'AGED'));
  const duplicates = seller.filter((r) => hasToken(r, 'DUPLICATE'));
  const mismatches = seller.filter((r) => hasToken(r, 'PRICE_MISMATCH'));
  const lost = [...seller, ...wfs].filter((r) => hasToken(r, 'LOST'));
  const wfsOverdue = wfs.filter((r) => r.Issues === 'WFS_OVERDUE');
  const wfsPending = wfs.filter((r) => r.Issues === 'WFS_PENDING');

  // ----- The three owner buckets -----
  const notReceivedRows = [...lost, ...aged, ...missingRecent];
  const wfsWaitingRows = [...wfsOverdue, ...wfsPending];
  const receivedRows = [
    ...seller.filter((r) => (r['Warehouse Count'] || 0) >= 1),
    ...wfs.filter((r) => /RECEIVED/.test(r.Issues)),
  ];
  const actionNowRows = [...lost, ...aged]; // dispute/case material today

  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  for (const r of notReceivedRows) {
    r['Days Ago'] = daysAgo(r, todayMidnight);
    if (hasToken(r, 'LOST')) {
      r.Status = STATUS.lost;
      r.Action = 'Open dispute / case now';
    } else if (hasToken(r, 'AGED')) {
      r.Status = STATUS.aged;
      r.Action = 'Open dispute now';
    } else {
      r.Status = STATUS.missing;
      r.Action = 'Watch for arrival';
    }
  }
  for (const r of wfsWaitingRows) {
    r['Days Ago'] = daysAgo(r, todayMidnight);
    if (r.Issues === 'WFS_OVERDUE') {
      r.Status = STATUS.wfsOverdue;
      r.Action = 'Open case with Walmart';
    } else {
      r.Status = STATUS.wfsPending;
      r.Action = 'Wait — within return window';
    }
  }
  for (const r of receivedRows) {
    const notes = [];
    if (hasToken(r, 'PRICE_MISMATCH')) notes.push('Price differs from refund');
    if (hasToken(r, 'DUPLICATE')) notes.push('Logged more than once');
    if (hasToken(r, 'LOST_BUT_RECEIVED')) notes.push('Marked lost but arrived — review refund');
    r.Note = notes.join(' · ');
  }

  // Action-needed first, biggest dollars first
  const nrRank = (r) => (hasToken(r, 'LOST') ? 0 : hasToken(r, 'AGED') ? 1 : 2);
  notReceivedRows.sort((a, b) => nrRank(a) - nrRank(b) || byNetDesc(a, b));
  wfsWaitingRows.sort((a, b) => (a.Issues === 'WFS_OVERDUE' ? 0 : 1) - (b.Issues === 'WFS_OVERDUE' ? 0 : 1) || byNetDesc(a, b));
  receivedRows.sort((a, b) => (b.Note ? 1 : 0) - (a.Note ? 1 : 0) || byNetDesc(a, b));

  const counts = {
    received: bucket(receivedRows),
    notReceived: bucket(notReceivedRows),
    wfsWaiting: bucket(wfsWaitingRows),
    actionNow: bucket(actionNowRows),
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

// The slice of each bucket a run stores: the display columns as plain
// values (plus SKU and Qty, which the receive popup and the tracker read).
const pickCols = (rows, cols) =>
  rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? '' : r[c]])));

function toSummary(rows) {
  return {
    notReceived: pickCols(rows.notReceived, [...TRACE_COLS, 'SKU', 'Qty']),
    wfsWaiting: pickCols(rows.wfsWaiting, [...TRACE_COLS, 'SKU', 'Qty']),
    // received rows also keep the net refund (not a Received-tab column) so
    // the bucket total can be summed from the stored summary
    received: pickCols(rows.received, [...RECEIVED_COLS, 'Net Refund (Payable Impact)', 'SKU', 'Qty', 'Return Reason']),
  };
}

const colKind = (col) => (MONEY_COLS.has(col) ? 'money' : INT_COLS.has(col) ? 'int' : 'text');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// one detail sheet: header, the rows, a TOTAL line under the money columns
function detailSheet(name, rows, columns) {
  const cols = columns.map((c) => ({ header: c, width: WIDTH_MAP[c] || 15, kind: colKind(c) }));
  const data = rows.map((row) => columns.map((c) => {
    let v = row[c];
    if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
    if (typeof v === 'number') return MONEY_COLS.has(c) ? r2(v) : v;
    return String(v).slice(0, 200);
  }));
  if (rows.length) {
    const total = columns.map((c, i) => (i === 0 ? 'TOTAL' : TOTAL_COLS.has(c) ? r2(sumNet(rows.map((r) => ({ 'Net Refund (Payable Impact)': r[c] })))) : ''));
    data.push(total);
  }
  return { name, columns: cols, rows: data };
}

/**
 * The period workbook (Summary + Not Received + WFS Waiting + Received)
 * from a stored summary, as a Buffer.
 */
function buildRunWorkbook(summary, reportLabel) {
  const notReceivedRows = summary.notReceived || [];
  const wfsWaitingRows = summary.wfsWaiting || [];
  const receivedRows = summary.received || [];
  const actionNowRows = notReceivedRows.filter(isActNow);
  const wfsOverdue = wfsWaitingRows.filter(isWfsOverdue);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const summarySheet = {
    name: 'Summary',
    columns: [{ header: `Reconciliation Report — ${reportLabel}`, width: 46, kind: 'text' }, { header: 'POs', width: 12, kind: 'int' }, { header: 'Refund $', width: 18, kind: 'money' }],
    rows: [
      ['Generated', stamp, ''],
      ['Refunded POs checked', receivedRows.length + notReceivedRows.length + wfsWaitingRows.length, ''],
      ['', '', ''],
      ['Received — in your warehouse', receivedRows.length, r2(sumNet(receivedRows))],
      ['Not received — you don\'t have these', notReceivedRows.length, r2(sumNet(notReceivedRows))],
      ['      of which: act now (lost / >30 days)', actionNowRows.length, r2(sumNet(actionNowRows))],
      ['WFS — waiting on Walmart', wfsWaitingRows.length, r2(sumNet(wfsWaitingRows))],
      ['      of which: overdue (>45 days, open case)', wfsOverdue.length, r2(sumNet(wfsOverdue))],
      ['', '', ''],
      ['Trace any individual item in the Not Received tab — sorted so the ones needing action are on top.', '', ''],
    ],
  };
  return buildWorkbookSheets([
    summarySheet,
    detailSheet('Not Received', notReceivedRows, TRACE_COLS),
    detailSheet('WFS Waiting', wfsWaitingRows, TRACE_COLS),
    detailSheet('Received', receivedRows, RECEIVED_COLS),
  ]);
}

module.exports = { classify, toSummary, buildRunWorkbook, TRACE_COLS, RECEIVED_COLS, STATUS, isActNow, isWfsOverdue };
