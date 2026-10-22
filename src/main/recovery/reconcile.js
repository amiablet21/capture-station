'use strict';
// Issue detection — ported verbatim from the Walmart app's src/lib/reconcile.js
// (spec docs/recovery/SPEC.md §4). Seller Fulfilled checks: MISSING, AGED
// (missing + >30 days), DUPLICATE, PRICE_MISMATCH (>$1). WFS refunds are
// checked against the Returns log too: WFS_PENDING until received,
// WFS_OVERDUE after 45 days. Lost in Transit / Lost After Delivery refunds
// are flagged LOST immediately — a case can be opened right away.
const AGED_THRESHOLD_DAYS = 30;
const WFS_OVERDUE_DAYS = 45;
const PRICE_MISMATCH_TOLERANCE = 1.0; // dollars

const isLostReason = (row) => /lost/i.test(String(row['Return Reason'] ?? ''));

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// `warehouse` rows: [{ 'PO #', priceNum (number|null), condition }] — one
// row per Returns-log record (a multi-unit record is one row, spec §2.5)
function findIssues(refunds, warehouse, today = new Date()) {
  const seller = refunds.filter((r) => r['Fulfillment Type'] === 'Seller Fulfilled');
  const wfs = refunds.filter((r) => r['Fulfillment Type'] === 'Walmart-fulfilled(WFS)');

  const whCounts = new Map();
  const whPrices = new Map(); // first non-null price per PO, in log order
  const whConditions = new Map(); // first non-empty condition per PO
  for (const row of warehouse) {
    const po = String(row['PO #'] ?? '').trim();
    if (!po) continue;
    whCounts.set(po, (whCounts.get(po) || 0) + 1);
    if (row.priceNum !== null && row.priceNum !== undefined && !whPrices.has(po)) {
      whPrices.set(po, row.priceNum);
    }
    if (row.condition && !whConditions.has(po)) {
      whConditions.set(po, row.condition);
    }
  }

  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  for (const row of seller) {
    const po = row['PO #'];
    const count = whCounts.get(po) || 0;
    const issues = [];

    if (count === 0) {
      if (isLostReason(row)) {
        issues.push('LOST'); // case can be opened immediately — skip the aging clock
      } else {
        issues.push('MISSING');
        if (row.refundDateParsed) {
          const daysOld = Math.floor((todayMidnight - row.refundDateParsed) / MS_PER_DAY);
          if (daysOld > AGED_THRESHOLD_DAYS) issues.push('AGED');
        }
      }
    } else if (count > 1) {
      issues.push('DUPLICATE');
    }
    if (count >= 1 && isLostReason(row)) {
      issues.push('LOST_BUT_RECEIVED'); // marked lost yet it arrived — review the refund
    }

    // Price mismatch only relevant if it WAS received
    if (count >= 1) {
      const whPrice = whPrices.get(po);
      if (whPrice !== undefined && Math.abs(whPrice - row['Refunded Retail Sales']) > PRICE_MISMATCH_TOLERANCE) {
        issues.push('PRICE_MISMATCH');
      }
    }

    row.Issues = issues.length ? issues.join(', ') : 'OK';
    row['Warehouse Count'] = count;
    row['Warehouse Price'] = whPrices.get(po) ?? null;
    row['Warehouse Condition'] = whConditions.get(po) ?? null;
  }

  for (const row of wfs) {
    const po = row['PO #'];
    const count = whCounts.get(po) || 0;

    if (count === 0) {
      if (isLostReason(row)) {
        row.Issues = 'LOST'; // lost units never arrive — actionable immediately
      } else {
        let overdue = false;
        if (row.refundDateParsed) {
          const daysOld = Math.floor((todayMidnight - row.refundDateParsed) / MS_PER_DAY);
          overdue = daysOld > WFS_OVERDUE_DAYS;
        }
        row.Issues = overdue ? 'WFS_OVERDUE' : 'WFS_PENDING';
      }
    } else {
      row.Issues = isLostReason(row) ? 'RECEIVED, LOST_BUT_RECEIVED' : 'RECEIVED';
    }
    row['Warehouse Count'] = count;
    row['Warehouse Price'] = whPrices.get(po) ?? null;
    row['Warehouse Condition'] = whConditions.get(po) ?? null;
  }

  return { seller, wfs };
}

// The Returns log (db.listReturns rows or the retsync fold) as reconcile
// rows: one per record whose order_number is set; price = the first
// non-null item price, condition = the first non-empty item condition.
function returnsToWarehouseRows(returns) {
  const out = [];
  // oldest first so "first in log order" means the earliest logged line
  const rows = (returns || []).slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  for (const r of rows) {
    const po = String(r.order_number || '').trim();
    if (!po) continue; // unmatched / bulk WFS boxes can never match a refund (§12 gap 1)
    const items = Array.isArray(r.items) ? r.items : [];
    let priceNum = null;
    let condition = '';
    for (const it of items) {
      if (priceNum === null && it && it.price !== null && it.price !== undefined && it.price !== '') {
        const n = Number(String(it.price).replace(/[$,\s]/g, ''));
        if (Number.isFinite(n)) priceNum = n;
      }
      if (!condition && it && it.condition) condition = String(it.condition);
    }
    out.push({ 'PO #': po, priceNum, condition });
  }
  return out;
}

module.exports = { findIssues, isLostReason, returnsToWarehouseRows, AGED_THRESHOLD_DAYS, WFS_OVERDUE_DAYS, PRICE_MISMATCH_TOLERANCE };
