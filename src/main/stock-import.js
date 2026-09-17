'use strict';

// Bulk stock import (owner 2026-09-17): a SKU + Qty sheet either ADDS to
// the stock room's levels (newly received inventory) or SETS them exactly
// (a correction / recount). This module only parses the file — the apply
// and the history live in main.js.

const { fileSheets } = require('./shipfile');

// header row: a SKU column and a quantity column, matched loosely so a
// re-exported or hand-made sheet still reads
function findHeader(rows) {
  for (let h = 0; h < Math.min(rows.length, 10); h++) {
    const row = rows[h] || [];
    const idx = (re) => row.findIndex(c => c && re.test(String(c).trim()));
    const sku = idx(/^(linnworks\s*)?sku$|item\s*sku/i);
    const qty = idx(/^(qty|quantity|units|count|stock|level|received)$/i);
    if (sku !== -1 && qty !== -1) return { header: h, sku, qty };
  }
  return null;
}

function parseStockRows(rows) {
  const found = findHeader(rows);
  const out = [];
  const bad = [];
  const push = (skuRaw, qtyRaw, line) => {
    const sku = String(skuRaw == null ? '' : skuRaw).trim().toUpperCase();
    const qs = String(qtyRaw == null ? '' : qtyRaw).trim().replace(/,/g, '');
    if (!sku && !qs) return; // an empty line
    const qty = /^\d+(\.0+)?$/.test(qs) ? Math.round(Number(qs)) : NaN;
    if (!sku || !Number.isInteger(qty) || qty < 0) {
      bad.push({ line, sku: sku || '(blank)', qty: qs || '(blank)' });
      return;
    }
    out.push({ sku, qty });
  };
  if (found) {
    rows.slice(found.header + 1).forEach((r, i) => push((r || [])[found.sku], (r || [])[found.qty], found.header + 2 + i));
  } else {
    // headerless two-column sheet: SKU in the first cell, number in the second
    rows.forEach((r, i) => { if (r && (r[0] != null || r[1] != null)) push(r[0], r[1], i + 1); });
    if (!out.length) return null;
    if (!out.some(o => /[A-Z]/.test(o.sku))) return null; // numbers only: not a SKU sheet
  }
  if (!out.length && !bad.length) return null;
  // the same SKU on several lines counts together (two piles, one total)
  const byKey = new Map();
  let dups = 0;
  for (const o of out) {
    const e = byKey.get(o.sku);
    if (e) { e.qty += o.qty; dups++; } else byKey.set(o.sku, { ...o });
  }
  return { rows: [...byKey.values()], bad, dups };
}

function parseStockFile(filePath) {
  let fallback = null;
  for (const rows of fileSheets(filePath)) {
    const r = parseStockRows(rows);
    if (r && r.rows.length) return r;
    if (r && !fallback) fallback = r;
  }
  if (fallback) return fallback;
  throw new Error('No SKU / Qty columns found in that file.');
}

module.exports = { parseStockFile, parseStockRows };
