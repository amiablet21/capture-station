'use strict';
// Walmart reconciliation report parsing — ported from the Walmart app's
// src/lib/parseReport.js (spec docs/recovery/SPEC.md §2). Behaviour kept
// identical, only the input moved from a file path to the CSV text:
//  - New format: rows with Transaction Type === "REFUNDED", grouped by
//    "Walmart.com PO #"; detected by the absence of a Period Start Date column
//  - Old format: rows with Transaction Type === "Refund", Amount Type rows
//    summed per PO
//  - Money fields sign-flipped so refunds display as positive amounts owed
//  - PO numbers always strings, never numbers
const { parseCsvText } = require('./csv');

// pd.to_numeric(errors="coerce").fillna(0)
function toNum(v) {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}

function detectFormat(columns) {
  return columns.includes('Period Start Date') ? 'old' : 'new';
}

function parseNewFormat(rows) {
  const refunds = rows.filter((r) => r['Transaction Type'] === 'REFUNDED');
  const map = new Map();
  for (const r of refunds) {
    const po = r['Walmart.com PO #'];
    if (!map.has(po)) {
      map.set(po, {
        'PO #': po,
        'Refunded Retail Sales': 0,
        'Net Refund (Payable Impact)': 0,
        Qty: 0,
        Item: r['Partner Item name'],
        SKU: String(r['Partner Item Id'] ?? '').trim(),
        'Refund Date': r['Transaction Date Time'],
        'Return Reason': r['Return Reason Description'],
        'Order #': r['Walmart.com Order #'],
        'Fulfillment Type': r['Fulfillment Type'],
      });
    }
    const g = map.get(po);
    g['Refunded Retail Sales'] += toNum(r['Refunded Retail Sales']);
    g['Net Refund (Payable Impact)'] += toNum(r['Payable to Partner from Sale']);
    g.Qty += 1; // new format: one refunded row per unit
  }
  return [...map.values()];
}

function parseOldFormat(rows) {
  const refunds = rows.filter((r) => r['Transaction Type'] === 'Refund');
  const map = new Map();
  for (const r of refunds) {
    const po = r['Purchase Order #'];
    if (!map.has(po)) {
      map.set(po, {
        'PO #': po,
        'Refunded Retail Sales': 0,
        'Net Refund (Payable Impact)': 0,
        Qty: 0,
        Item: r['Partner Item Name'],
        SKU: String(r['Partner Item Id'] ?? '').trim(),
        'Refund Date': r['Transaction Posted Timestamp'],
        'Return Reason': r['Transaction Reason Description'],
        'Order #': r['Customer Order #'],
        'Fulfillment Type': r['Fulfillment Type'],
      });
    }
    const g = map.get(po);
    const amount = toNum(r['Amount']);
    g['Net Refund (Payable Impact)'] += amount;
    if (r['Amount Type'] === 'Product Price') {
      g['Refunded Retail Sales'] += amount;
      g.Qty += Math.max(1, Math.trunc(Math.abs(Number(r['Ship Qty']))) || 1);
    }
  }
  return [...map.values()];
}

// strptime("%m/%d/%Y") equivalent; returns Date at local midnight or null
function parseRefundDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? ''));
  if (!m) return null;
  const [, mo, d, y] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  return dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}

function toIsoDay(s) {
  const d = parseRefundDate(String(s ?? '').slice(0, 10));
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Report period: old format carries explicit Period Start/End Date columns;
// otherwise fall back to the min/max refund date across the report.
function detectPeriod(rows, refunds) {
  const first = rows.find((r) => r['Period Start Date'] || r['Period End Date']);
  if (first) {
    const start = parseRefundDate(String(first['Period Start Date'] ?? '').slice(0, 10));
    const end = parseRefundDate(String(first['Period End Date'] ?? '').slice(0, 10));
    if (start && end) return { start, end, explicit: true };
  }
  // fallback: min/max refund date — misleading for new-format files (refund
  // rows reference dates far outside the payment period), so callers override
  let start = null;
  let end = null;
  for (const r of refunds) {
    const d = r.refundDateParsed;
    if (!d) continue;
    if (!start || d < start) start = d;
    if (!end || d > end) end = d;
  }
  return { start, end, explicit: false };
}

// ---------- Refunds (one record per PO) ----------
function parseRefunds(text) {
  const { rows, columns } = parseCsvText(text);
  const format = detectFormat(columns);
  const agg = format === 'new' ? parseNewFormat(rows) : parseOldFormat(rows);
  for (const r of agg) {
    r['PO #'] = String(r['PO #'] ?? '').trim();
    r['Refund Date'] = String(r['Refund Date'] ?? '').slice(0, 10);
    // Sign-flip: refunds show as positive amounts owed
    r['Refunded Retail Sales'] = -r['Refunded Retail Sales'];
    r['Net Refund (Payable Impact)'] = -r['Net Refund (Payable Impact)'];
    r.refundDateParsed = parseRefundDate(r['Refund Date']);
  }
  return { refunds: agg, format, period: detectPeriod(rows, agg), rows, columns };
}

// ---------- Walmart payouts ("Walmart paid you back") ----------
// Walmart paying YOU back for a refunded item: { po: { amount, date, kind } }.
// Three shapes, all credits: a Dispute Settlement (a case you won); claim
// payouts on an Adjustment line ("Shipping Protection Claim Payout"); the
// automatic lost-item reimbursement on Fee/Reimbursement (base $100, up to
// the sale value, capped $500 if insured). The negative "Walmart Shipping
// Label Service Charge" shares that Amount Type and is excluded by the sign.
const SETTLEMENT_RX = /dispute|claim|reimbursement|shipping protection|payout/i;

function parsePayouts(rows, format) {
  const byPo = {};
  for (const r of rows) {
    const tt = String(r['Transaction Type'] ?? '');
    const desc = String(r['Transaction Description'] ?? r['Transaction Reason Description'] ?? '');
    const at = String(r['Amount Type'] ?? '');
    if (!SETTLEMENT_RX.test(tt) && !SETTLEMENT_RX.test(desc) && !SETTLEMENT_RX.test(at)) continue;
    const po = String((format === 'old' ? r['Purchase Order #'] : r['Walmart.com PO #']) ?? '').trim();
    if (!po) continue;
    const amount = toNum(format === 'old' ? r['Amount'] : r['Payable to Partner from Sale']);
    if (amount <= 0) continue; // only credits TO you, never charges
    const kind = /dispute/i.test(tt) || /dispute/i.test(desc) ? 'dispute' : 'adjustment';
    if (!byPo[po]) {
      byPo[po] = {
        amount: 0,
        kind,
        date: String((format === 'old' ? r['Transaction Posted Timestamp'] : r['Transaction Date Time']) ?? '').slice(0, 10),
      };
    } else if (byPo[po].kind !== kind) {
      byPo[po].kind = 'mixed';
    }
    byPo[po].amount += amount;
  }
  return byPo;
}

// ---------- Per-transaction ledger ----------
// Minimal rows { po, order, type, date (ISO day), amount } — the summaries
// read the Refund rows and the positive /dispute/ rows (spec §2.4, §8).
const NEW_FORMAT_TYPE_LABELS = { SALE: 'Sale', REFUNDED: 'Refund' };

function parseLedger(rows, format) {
  const out = [];
  if (format === 'old') {
    const map = new Map();
    let n = 0;
    for (const r of rows) {
      const type = String(r['Transaction Type'] ?? '').trim();
      if (!type || type === 'PaymentSummary') continue;
      const po = String(r['Purchase Order #'] ?? '').trim();
      const key = String(r['Transaction Key'] ?? '').trim() || `${po}|${type}|${n++}`;
      if (!map.has(key)) {
        map.set(key, { key, po, order: String(r['Customer Order #'] ?? '').trim(), type, date: toIsoDay(r['Transaction Posted Timestamp']), amount: 0 });
      }
      const g = map.get(key);
      g.amount += toNum(r['Amount']);
      if (!g.order && r['Customer Order #']) g.order = String(r['Customer Order #']).trim();
    }
    return [...map.values()];
  }
  let n = 0;
  for (const r of rows) {
    const raw = String(r['Transaction Type'] ?? '').trim();
    if (!raw) continue;
    const po = String(r['Walmart.com PO #'] ?? '').trim();
    out.push({
      key: String(r['Transaction Key'] ?? '').trim() || `${po}|${raw}|${n++}`,
      po,
      order: String(r['Walmart.com Order #'] ?? r['Customer Order #'] ?? '').trim(),
      type: NEW_FORMAT_TYPE_LABELS[raw] || raw,
      date: toIsoDay(r['Transaction Date Time']),
      amount: toNum(r['Payable to Partner from Sale']),
    });
  }
  return out;
}

// Everything the import needs from one report text, parsed once.
function parseReport(text) {
  const parsed = parseRefunds(text);
  return {
    ...parsed,
    payouts: parsePayouts(parsed.rows, parsed.format),
    ledger: parseLedger(parsed.rows, parsed.format),
  };
}

module.exports = { parseReport, parseRefunds, parsePayouts, parseLedger, detectFormat, parseRefundDate, toIsoDay, toNum, SETTLEMENT_RX };
