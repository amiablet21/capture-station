'use strict';
// WFS Inventory Reconciliation report (Seller Center → WFS → Reports →
// Inventory Reconciliation). One row per SKU per fulfillment center — per
// day on a daily download — with the units that moved in the period:
// starting quantity, received, sold, customer returns, lost, found,
// damaged, removed, returned to seller, transferred, ending quantity.
//
// Walmart publishes no header list for this file, so each column is matched
// by name against the spellings below (case, spaces and punctuation
// ignored), then by keyword. A column that matches nothing is reported back
// so it can be added here; nothing is invented for a column the file lacks.
const { parseCsvText } = require('./csv');

const QTY_FIELDS = ['start', 'recv', 'sold', 'cret', 'lost', 'found', 'dmg', 'removed', 'rts', 'moved', 'other', 'end'];

const ALIASES = {
  gtin: ['gtin', 'gtin14', 'upc'],
  itemId: ['walmartitemid', 'itemid', 'wmtitemid'],
  sku: ['vendorsku', 'sku', 'sellersku', 'partnersku', 'partneritemid', 'skuid', 'itemsku'],
  name: ['productname', 'itemname', 'name', 'title', 'productdescription', 'itemdescription', 'description'],
  fc: ['fulfillmentcenter', 'fulfillmentcentername', 'fulfillmentcenterid', 'fc', 'fcname', 'fcid', 'facility', 'facilityname', 'shipnode', 'nodeid'],
  startDate: ['startdate', 'fromdate', 'periodstartdate', 'reportstartdate', 'begindate'],
  endDate: ['enddate', 'todate', 'periodenddate', 'reportenddate'],
  date: ['date', 'day', 'reportdate', 'transactiondate', 'activitydate', 'inventorydate'],
  start: ['startingquantity', 'startingqty', 'startquantity', 'startqty', 'startingunits', 'startinginventory', 'startingbalance', 'beginningquantity', 'beginningqty', 'beginningunits', 'beginninginventory', 'beginningbalance', 'openingquantity', 'openingbalance'],
  end: ['endingquantity', 'endingqty', 'endquantity', 'endqty', 'endingunits', 'endinginventory', 'endingbalance', 'closingquantity', 'closingbalance'],
  recv: ['received', 'receivedquantity', 'receivedqty', 'receivedunits', 'unitsreceived'],
  sold: ['sold', 'soldquantity', 'soldqty', 'soldunits', 'unitssold'],
  cret: ['customerreturns', 'customerreturned', 'customerreturnquantity', 'returned', 'returns', 'returnedunits', 'unitsreturned'],
  lost: ['lost', 'lostquantity', 'lostqty', 'lostunits', 'unitslost'],
  found: ['found', 'foundquantity', 'foundqty', 'foundunits', 'unitsfound'],
  dmg: ['damaged', 'damagedquantity', 'damagedqty', 'damagedunits', 'unitsdamaged'],
  removed: ['removed', 'removedquantity', 'removedqty', 'removedunits', 'unitsremoved', 'disposed', 'liquidated', 'destroyed'],
  rts: ['returnedtoseller', 'returntoseller', 'returnedtosellerquantity', 'returnedtosellerunits', 'unitsreturnedtoseller', 'rts'],
  moved: ['transferred', 'transferredquantity', 'transferredqty', 'transferredunits', 'unitstransferred', 'transfers', 'transfer'],
  other: ['otheradjustments', 'otheradjustment', 'adjustments', 'adjustment', 'adjusted', 'inventoryadjustments'],
};
// second pass: a header that names the movement among other words
// ("Units Returned To Seller", "Qty Lost (FC)"); order matters — the
// specific phrases come before the words they contain
const KEYWORDS = [
  [/returnedtoseller|returntoseller/, 'rts'],
  [/customerreturn/, 'cret'],
  [/^(starting|beginning|opening)/, 'start'],
  [/^(ending|closing)/, 'end'],
  [/receiv/, 'recv'],
  [/sold/, 'sold'],
  [/lost/, 'lost'],
  [/found/, 'found'],
  [/damag/, 'dmg'],
  [/remov|dispos|liquidat|destroy/, 'removed'],
  [/transfer/, 'moved'],
  [/adjust/, 'other'],
];

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// header -> field, first column wins; returns { map: field -> header, unknown: [header] }
function mapColumns(columns) {
  const map = {};
  const used = new Set();
  for (const col of columns) {
    const n = norm(col);
    for (const [field, names] of Object.entries(ALIASES)) {
      if (!map[field] && names.includes(n)) { map[field] = col; used.add(col); break; }
    }
  }
  for (const col of columns) {
    if (used.has(col)) continue;
    const n = norm(col);
    if (!n || /date|time/.test(n)) continue;
    for (const [rx, field] of KEYWORDS) {
      if (!map[field] && rx.test(n)) { map[field] = col; used.add(col); break; }
    }
  }
  const unknown = columns.filter((c) => c && !used.has(c));
  return { map, unknown };
}

// "1,234" / " 12 " / "" / "(3)" -> number; blank is 0
function qty(v) {
  let s = String(v ?? '').trim().replace(/,/g, '');
  if (!s) return 0;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) s = `-${paren[1]}`;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// YYYY-MM-DD, MM/DD/YYYY, M/D/YY (a time after it is ignored) -> "YYYY-MM-DD"
function isoDay(v) {
  const s = String(v ?? '').trim();
  let y; let m; let d;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (r) { [, y, m, d] = r.map(Number); } else {
    r = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(s);
    if (!r) return null;
    [, m, d, y] = r.map(Number);
    if (y < 100) y += 2000;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// two dates in the file name, when the file carries none of its own
function periodFromName(name) {
  const s = String(name || '');
  const iso = s.match(/(\d{4}-\d{2}-\d{2})/g);
  if (iso && iso.length >= 2) return { start: iso[0], end: iso[1] };
  const us = s.match(/(\d{2})(\d{2})(\d{4})/g);
  if (us && us.length >= 2) {
    const f = (t) => isoDay(`${t.slice(0, 2)}/${t.slice(2, 4)}/${t.slice(4)}`);
    const a = f(us[0]); const b = f(us[1]);
    if (a && b) return { start: a, end: b };
  }
  return null;
}

const gtinKey = (g) => String(g || '').replace(/\D/g, '').replace(/^0+/, '');

/**
 * Parse the report text.
 * @returns {{ period: {start,end}|null, fields: string[], unknown: string[], columns: string[],
 *   rows: {gtin,itemId,sku,name,fc,q}[], rawRows: number }}
 * One row per SKU per fulfillment center: on a daily file the starting
 * quantity is the first day's and the ending quantity the last day's, the
 * movements are summed.
 */
function parseWfsInventory(text, name = '') {
  const { rows, columns } = parseCsvText(text);
  if (!columns.length) throw new Error('That file is empty.');
  const { map, unknown } = mapColumns(columns);
  const fields = QTY_FIELDS.filter((f) => map[f]);
  if (!(map.sku || map.gtin) || fields.length < 2) {
    throw new Error(`This does not look like the WFS Inventory Reconciliation report (Seller Center → WFS → Reports). Its columns are: ${columns.join(', ')}`);
  }
  const get = (r, f) => (map[f] ? r[map[f]] : '');

  let pStart = null; let pEnd = null;
  const groups = new Map();
  for (const r of rows) {
    const sku = String(get(r, 'sku') || '').trim();
    const gtin = String(get(r, 'gtin') || '').trim();
    if (!sku && !gtin) continue; // a totals line or a note
    const dFrom = isoDay(get(r, 'startDate')) || isoDay(get(r, 'date'));
    const dTo = isoDay(get(r, 'endDate')) || isoDay(get(r, 'date')) || dFrom;
    if (dFrom && (!pStart || dFrom < pStart)) pStart = dFrom;
    if (dTo && (!pEnd || dTo > pEnd)) pEnd = dTo;
    const fc = String(get(r, 'fc') || '').trim();
    const key = `${(gtinKey(gtin) || sku.toUpperCase())}|${fc}`;
    let g = groups.get(key);
    if (!g) {
      g = { gtin, itemId: String(get(r, 'itemId') || '').trim(), sku, name: String(get(r, 'name') || '').trim(), fc, q: {}, first: null, last: null };
      for (const f of fields) g.q[f] = 0;
      groups.set(key, g);
    }
    if (!g.sku && sku) g.sku = sku;
    if (!g.name) g.name = String(get(r, 'name') || '').trim();
    for (const f of fields) {
      if (f === 'start' || f === 'end') continue;
      g.q[f] += qty(get(r, f));
    }
    // the opening balance of the earliest row, the closing of the latest
    const from = dFrom || ''; const to = dTo || '';
    if (map.start && (g.first === null || from < g.first)) { g.first = from; g.q.start = qty(get(r, 'start')); }
    if (map.end && (g.last === null || to >= g.last)) { g.last = to; g.q.end = qty(get(r, 'end')); }
  }
  const out = [...groups.values()].map(({ first, last, ...g }) => g);
  if (!out.length) throw new Error('The report has no item rows.');
  const period = pStart && pEnd ? { start: pStart, end: pEnd } : periodFromName(name);
  return { period, fields, unknown, columns, map, rows: out, rawRows: rows.length };
}

module.exports = { parseWfsInventory, mapColumns, isoDay, gtinKey, QTY_FIELDS };
