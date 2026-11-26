/**
 * Walmart reconciliation report parsing.
 * Port of scripts/reconcile.py (parsing half) — keep behavior identical:
 *  - New format: rows with Transaction Type === "REFUNDED", grouped by "Walmart.com PO #"
 *  - Old format: rows with Transaction Type === "Refund", "Amount Type" rows summed per PO
 *  - Money fields sign-flipped so refunds display as positive amounts owed
 *  - PO numbers always strings, never numbers
 */
const fs = require("fs");
const Papa = require("papaparse");

// pd.to_numeric(errors="coerce").fillna(0)
function toNum(v) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseCsv(filepath) {
  const content = fs.readFileSync(filepath, "utf8").replace(/^﻿/, "");
  const result = Papa.parse(content, { header: true, skipEmptyLines: "greedy" });
  return { rows: result.data, columns: result.meta.fields || [] };
}

function detectFormat(columns) {
  return columns.includes("Period Start Date") ? "old" : "new";
}

function parseNewFormat(rows) {
  const refunds = rows.filter((r) => r["Transaction Type"] === "REFUNDED");
  const map = new Map();
  for (const r of refunds) {
    const po = r["Walmart.com PO #"];
    if (!map.has(po)) {
      map.set(po, {
        "PO #": po,
        "Refunded Retail Sales": 0,
        "Net Refund (Payable Impact)": 0,
        Qty: 0,
        Item: r["Partner Item name"],
        "Refund Date": r["Transaction Date Time"],
        "Return Reason": r["Return Reason Description"],
        "Order #": r["Walmart.com Order #"],
        "Fulfillment Type": r["Fulfillment Type"],
      });
    }
    const g = map.get(po);
    g["Refunded Retail Sales"] += toNum(r["Refunded Retail Sales"]);
    g["Net Refund (Payable Impact)"] += toNum(r["Payable to Partner from Sale"]);
    g.Qty += 1; // new format: one refunded row per unit
  }
  return [...map.values()];
}

function parseOldFormat(rows) {
  const refunds = rows.filter((r) => r["Transaction Type"] === "Refund");
  const map = new Map();
  for (const r of refunds) {
    const po = r["Purchase Order #"];
    if (!map.has(po)) {
      map.set(po, {
        "PO #": po,
        "Refunded Retail Sales": 0,
        "Net Refund (Payable Impact)": 0,
        Qty: 0,
        Item: r["Partner Item Name"],
        "Refund Date": r["Transaction Posted Timestamp"],
        "Return Reason": r["Transaction Reason Description"],
        "Order #": r["Customer Order #"],
        "Fulfillment Type": r["Fulfillment Type"],
      });
    }
    const g = map.get(po);
    const amount = toNum(r["Amount"]);
    g["Net Refund (Payable Impact)"] += amount;
    if (r["Amount Type"] === "Product Price") {
      g["Refunded Retail Sales"] += amount;
      g.Qty += Math.max(1, Math.trunc(Math.abs(Number(r["Ship Qty"]))) || 1);
    }
  }
  return [...map.values()];
}

// strptime("%m/%d/%Y") equivalent; returns Date at local midnight or null
function parseRefundDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const [, mo, d, y] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  return dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}

// Report period: old format carries explicit Period Start/End Date columns;
// otherwise fall back to the min/max refund date across the report.
function detectPeriod(rows, refunds) {
  const first = rows.find((r) => r["Period Start Date"] || r["Period End Date"]);
  if (first) {
    const start = parseRefundDate(String(first["Period Start Date"] ?? "").slice(0, 10));
    const end = parseRefundDate(String(first["Period End Date"] ?? "").slice(0, 10));
    if (start && end) return { start, end, explicit: true };
  }
  // fallback: min/max refund date — misleading for new-format files (refund rows
  // reference dates far outside the payment period), so callers may override it
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

// ---------- Per-order extraction for profit analysis ----------
// One record per PO with net payable across SALE and REFUNDED rows.

function parseOrdersNew(rows) {
  const map = new Map();
  for (const r of rows) {
    const type = r["Transaction Type"];
    if (type !== "SALE" && type !== "REFUNDED") continue;
    const po = String(r["Walmart.com PO #"] ?? "").trim();
    if (!po) continue;
    if (!map.has(po)) {
      map.set(po, {
        po,
        item: r["Partner Item name"] || "",
        sku: (r["Partner Item Id"] || r["Partner Item ID"] || r["SKU"] || "").trim(),
        fulfillment: r["Fulfillment Type"] || "",
        date: String(r["Transaction Date Time"] ?? "").slice(0, 10),
        saleUnits: 0,
        refundUnits: 0,
        netPayable: 0,
      });
    }
    const g = map.get(po);
    if (!g.item && r["Partner Item name"]) g.item = r["Partner Item name"];
    if (!g.sku && r["Partner Item Id"]) g.sku = String(r["Partner Item Id"]).trim();
    g.netPayable += toNum(r["Payable to Partner from Sale"]);
    if (type === "SALE") g.saleUnits++;
    else g.refundUnits++;
  }
  return [...map.values()];
}

function parseOrdersOld(rows) {
  const map = new Map();
  for (const r of rows) {
    const po = String(r["Purchase Order #"] ?? "").trim();
    if (!po) continue;
    const type = r["Transaction Type"];
    if (type === "PaymentSummary") continue; // account-level summary, not an order
    if (!map.has(po)) {
      map.set(po, {
        po,
        item: r["Partner Item Name"] || "",
        sku: (r["Partner Item Id"] || r["Partner Item ID"] || r["SKU"] || "").trim(),
        fulfillment: r["Fulfillment Type"] || "",
        date: String(r["Transaction Posted Timestamp"] ?? "").slice(0, 10),
        saleUnits: 0,
        refundUnits: 0,
        netPayable: 0,
      });
    }
    const g = map.get(po);
    if (!g.item && r["Partner Item Name"]) g.item = r["Partner Item Name"];
    if (!g.sku && r["Partner Item Id"]) g.sku = String(r["Partner Item Id"]).trim();
    // every PO-linked row counts toward payable impact: Sale, Refund,
    // Adjustment, Dispute Settlement, …
    g.netPayable += toNum(r["Amount"]);
    // units come from the Product Price line's Ship Qty — one row can be 13 units
    if (r["Amount Type"] === "Product Price") {
      const qty = Math.max(1, Math.trunc(Math.abs(Number(r["Ship Qty"]))) || 1);
      if (type === "Sale") g.saleUnits += qty;
      else if (type === "Refund") g.refundUnits += qty;
    }
  }
  return [...map.values()];
}

function loadOrders(filepath) {
  const { rows, columns } = parseCsv(filepath);
  const format = detectFormat(columns);
  return format === "new" ? parseOrdersNew(rows) : parseOrdersOld(rows);
}

// ---------- Per-transaction ledger (for the Transactions tab) ----------
// One row per logical transaction: { key, po, date, type, itemId, qty, amount }.
// Old format groups multi-line transactions by Transaction Key; new format is
// already one row per transaction.

function parseTransactionsOld(rows) {
  const map = new Map();
  let n = 0;
  for (const r of rows) {
    const type = String(r["Transaction Type"] ?? "").trim();
    if (!type || type === "PaymentSummary") continue;
    const po = String(r["Purchase Order #"] ?? "").trim();
    const key = String(r["Transaction Key"] ?? "").trim() || `${po}|${type}|${n++}`;
    if (!map.has(key)) {
      map.set(key, {
        key, po, type,
        order: String(r["Customer Order #"] ?? "").trim(),
        date: toIsoDay(r["Transaction Posted Timestamp"]),
        itemId: String(r["Partner Item Id"] ?? "").trim(),
        qty: 0,
        amount: 0,
        breakdown: {}, // Amount Type -> summed amount, for the per-transaction detail view
        lines: [], // every raw Amount Type row (preserves duplicates) for the per-PO statement
      });
    }
    const g = map.get(key);
    const amt = toNum(r["Amount"]);
    g.amount += amt;
    const at = String(r["Amount Type"] ?? "").trim() || "Other";
    g.breakdown[at] = (g.breakdown[at] || 0) + amt;
    g.lines.push({ at, amt });
    if (!g.order && r["Customer Order #"]) g.order = String(r["Customer Order #"]).trim();
    if (!g.itemId && r["Partner Item Id"]) g.itemId = String(r["Partner Item Id"]).trim();
    if (r["Amount Type"] === "Product Price") {
      g.qty += Math.max(1, Math.trunc(Math.abs(Number(r["Ship Qty"]))) || 1);
    }
  }
  return [...map.values()];
}

function parseTransactionsNew(rows) {
  const out = [];
  let n = 0;
  for (const r of rows) {
    const raw = String(r["Transaction Type"] ?? "").trim();
    if (!raw) continue;
    const po = String(r["Walmart.com PO #"] ?? "").trim();
    out.push({
      key: String(r["Transaction Key"] ?? "").trim() || `${po}|${raw}|${n++}`,
      po,
      order: String(r["Customer Order #"] ?? r["Customer Order Number"] ?? "").trim(),
      type: NEW_FORMAT_TYPE_LABELS[raw] || raw,
      date: toIsoDay(r["Transaction Date Time"]),
      itemId: String(r["Partner Item Id"] ?? r["Partner Item Id"] ?? "").trim(),
      qty: 1,
      amount: toNum(r["Payable to Partner from Sale"]),
      breakdown: null, // new format has no per-line Amount Type components
      lines: null,
    });
  }
  return out;
}

function loadTransactions(filepath) {
  const { rows, columns } = parseCsv(filepath);
  return detectFormat(columns) === "new" ? parseTransactionsNew(rows) : parseTransactionsOld(rows);
}

// ---------- Daily revenue series for the Profit chart ----------
// Returns { days: ["2026-04-19", …] sorted, types: ["Sale", …],
//           data: { "2026-04-19": { Sale: 1234.56, Refund: -78.9, … } } }

function toIsoDay(s) {
  const d = parseRefundDate(String(s ?? "").slice(0, 10));
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const NEW_FORMAT_TYPE_LABELS = { SALE: "Sale", REFUNDED: "Refund" };

function loadDailySeries(filepath) {
  const { rows, columns } = parseCsv(filepath);
  const format = detectFormat(columns);
  const data = {};
  const types = new Set();

  for (const r of rows) {
    let type;
    let day;
    let amount;
    if (format === "old") {
      type = String(r["Transaction Type"] ?? "").trim();
      if (!type || type === "PaymentSummary") continue;
      day = toIsoDay(r["Transaction Posted Timestamp"]);
      amount = toNum(r["Amount"]);
    } else {
      const raw = String(r["Transaction Type"] ?? "").trim();
      if (!raw) continue;
      type = NEW_FORMAT_TYPE_LABELS[raw] || raw;
      day = toIsoDay(r["Transaction Date Time"]);
      amount = toNum(r["Payable to Partner from Sale"]);
    }
    if (!day || amount === 0) continue;
    types.add(type);
    if (!data[day]) data[day] = {};
    data[day][type] = (data[day][type] || 0) + amount;
  }

  return { days: Object.keys(data).sort(), types: [...types].sort(), data };
}

// ---------- Statement / fee breakdown ----------
// Reconstructs the Walmart Seller Center statement view: Sales & Refunds by
// amount type, plus every fee/charge grouped by its reason description and
// bucketed (fulfillment / shipping & labels / adjustments). Old format only —
// the new format doesn't carry the per-line Amount Type / Reason columns.

function classifyFee(reason) {
  const r = reason.toLowerCase();
  if (/wfs|fulfillment|storage|inbound|lost\s*inventory|return\s*processing/.test(r)) return "fulfillment";
  if (/shipping label|return shipping|unused label|signature/.test(r)) return "shipping";
  return "adjustments";
}

const GROUP_LABELS = {
  fulfillment: "Fulfillment & WFS fees",
  shipping: "Shipping & label charges",
  adjustments: "Adjustments & other",
};

function loadStatement(filepath) {
  const { rows, columns } = parseCsv(filepath);
  if (detectFormat(columns) !== "old") return null; // breakdown needs old-format columns

  const sales = new Map();
  const refunds = new Map();
  const groups = { fulfillment: new Map(), shipping: new Map(), adjustments: new Map() };
  let paidOut = 0;

  const bump = (map, key, amt) => map.set(key, (map.get(key) || 0) + amt);

  for (const r of rows) {
    const tt = r["Transaction Type"];
    const amt = toNum(r["Amount"]);
    if (tt === "Sale") bump(sales, r["Amount Type"] || "Other", amt);
    else if (tt === "Refund") bump(refunds, r["Amount Type"] || "Other", amt);
    else if (tt === "Instant Transfer") paidOut += amt;
    else if (tt === "Service Fee" || tt === "Adjustment" || tt === "Dispute Settlement") {
      const reason = String(r["Transaction Reason Description"] || r["Transaction Description"] || tt).trim() || tt;
      bump(groups[classifyFee(reason)], reason, amt);
    }
  }

  const toLines = (map) =>
    [...map.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const total = (lines) => lines.reduce((a, l) => a + l.amount, 0);

  const salesLines = toLines(sales);
  const refundLines = toLines(refunds);
  const groupOut = ["fulfillment", "shipping", "adjustments"].map((key) => {
    const lines = toLines(groups[key]);
    return { key, label: GROUP_LABELS[key], lines, total: total(lines) };
  }).filter((g) => g.lines.length);

  const feesTotal = groupOut.reduce((a, g) => a + g.total, 0);
  const net = total(salesLines) + total(refundLines) + feesTotal;

  return {
    sales: { lines: salesLines, total: total(salesLines) },
    refunds: { lines: refundLines, total: total(refundLines) },
    groups: groupOut,
    feesTotal,
    paidOut,
    net,
  };
}

// ---------- Walmart payouts (Reimbursed) ----------
// Walmart paying YOU back for a refunded item. Returned as { po: { amount, date } }
// so Returns Not Received can tag the PO "Reimbursed". Three shapes, all credits:
//  - Dispute Settlement (Transaction Type contains "dispute")
//  - Claim payouts on an Adjustment line whose description says e.g.
//    "Shipping Protection Claim Payout"
//  - Lost-item reimbursements: for a return deemed Lost After Delivery / Lost in
//    Transit on a Walmart-bought label, Walmart auto-issues a positive
//    Adjustment with Amount Type "Fee/Reimbursement" (base $100, up to the sale
//    value capped at $500 if insured). This is the most they'll pay, so it
//    counts as the reimbursement even though it isn't a dispute settlement.
// The negative "Walmart Shipping Label Service Charge" shares that Amount Type
// but is filtered out by the amount > 0 (credits-only) check below.
const SETTLEMENT_RX = /dispute|claim|reimbursement|shipping protection|payout/i;

function loadSettlements(filepath) {
  const { rows, columns } = parseCsv(filepath);
  const format = detectFormat(columns);
  const byPo = {};
  for (const r of rows) {
    const tt = String(r["Transaction Type"] ?? "");
    const desc = String(r["Transaction Description"] ?? r["Transaction Reason Description"] ?? "");
    const at = String(r["Amount Type"] ?? "");
    if (!SETTLEMENT_RX.test(tt) && !SETTLEMENT_RX.test(desc) && !SETTLEMENT_RX.test(at)) continue;
    const po = String((format === "old" ? r["Purchase Order #"] : r["Walmart.com PO #"]) ?? "").trim();
    if (!po) continue;
    const amount = toNum(format === "old" ? r["Amount"] : r["Payable to Partner from Sale"]);
    if (amount <= 0) continue; // only credits TO you, never charges
    // A "Dispute Settlement" is a case you opened and won; everything else here
    // (Adjustment / Fee-Reimbursement / shipping-protection claim payout) is
    // Walmart's automatic lost-item payout.
    const kind = /dispute/i.test(tt) || /dispute/i.test(desc) ? "dispute" : "adjustment";
    if (!byPo[po]) {
      byPo[po] = {
        amount: 0,
        kind,
        date: String((format === "old" ? r["Transaction Posted Timestamp"] : r["Transaction Date Time"]) ?? "").slice(0, 10),
      };
    } else if (byPo[po].kind !== kind) {
      byPo[po].kind = "mixed";
    }
    byPo[po].amount += amount;
  }
  return byPo;
}

function loadRefunds(filepath) {
  const { rows, columns } = parseCsv(filepath);
  const format = detectFormat(columns);
  const agg = format === "new" ? parseNewFormat(rows) : parseOldFormat(rows);
  for (const r of agg) {
    r["PO #"] = String(r["PO #"] ?? "").trim();
    r["Refund Date"] = String(r["Refund Date"] ?? "").slice(0, 10);
    // Sign-flip: refunds show as positive amounts owed
    r["Refunded Retail Sales"] = -r["Refunded Retail Sales"];
    r["Net Refund (Payable Impact)"] = -r["Net Refund (Payable Impact)"];
    r.refundDateParsed = parseRefundDate(r["Refund Date"]);
  }
  return { refunds: agg, format, period: detectPeriod(rows, agg) };
}

module.exports = { loadRefunds, loadOrders, loadTransactions, loadDailySeries, loadSettlements, loadStatement, toIsoDay, parseRefundDate, detectFormat, toNum };
