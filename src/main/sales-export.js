'use strict';
// SKUs + 30-day sales export (owner 2026-10-19: "export all the SKUs and the
// selling history for the last 30 days" to decide what to buy, handing the
// file to Claude). One row per Linnworks item, sold or not, with stock,
// pace, cover and a suggested order; a Daily sheet with the 30 local days
// per SKU that sold; an About sheet that says how every figure was made.
// Pure — no Electron, no network — so it is testable with plain node.

const { csvEscape } = require('./chskus-csv.js');

const chanKey = (src) => /walmart/i.test(src) ? 'walmart' : /ebay/i.test(src) ? 'ebay' : /temu/i.test(src) ? 'temu' : 'other';
const pad2 = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const round2 = (n) => Math.round(n * 100) / 100;
const sum = (a) => a.reduce((s, n) => s + n, 0);

// worst first: what to buy reads from the top of the sheet down
const STATUS_RANK = { 'Out of stock': 0, 'Order now': 1, 'Order soon': 2, 'On order': 3, Covered: 4, 'Not linked': 5, Dropship: 6, 'Not selling': 7 };

// items: listInventory() rows (+ cost); lines: processed-order lines
// (querySales) covering at least the window. opts: { locationId,
// locationName, now, days, leadDays, coverDays }
function buildSalesExport(items, lines, opts = {}) {
  const WINDOW = Number(opts.days) || 30;
  const now = opts.now ? new Date(opts.now) : new Date();
  const lead = Number(opts.leadDays) || 7;
  const cover = Number(opts.coverDays) || 21;
  // the window's local days, oldest first (calendar steps, so a DST change
  // never skips or doubles a day)
  const days = [];
  for (let i = WINDOW - 1; i >= 0; i--) days.push(localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  const dayIdx = Object.fromEntries(days.map((d, i) => [d, i]));
  // the Walmart-fed WFS location, found by name like the Overview does
  let wfsLoc = '';
  for (const it of items || []) {
    const l = (it.levels || []).find(x => /wfs/i.test(x.locationName || ''));
    if (l) { wfsLoc = String(l.locationId || '').toLowerCase(); break; }
  }
  const stats = new Map(); // SKU (upper) -> 30-day figures
  for (const l of lines || []) {
    const ts = Date.parse(l.processedOn);
    if (Number.isNaN(ts)) continue;
    const di = dayIdx[localDay(new Date(ts))];
    if (di === undefined) continue; // outside the window
    // a line not linked to a stock item carries Linnworks' placeholder SKU:
    // name it by the channel SKU instead, like the Overview's Sold today
    const name = String((l.unmapped ? (l.channelSku || l.title || l.sku) : (l.sku || l.channelSku)) || '').trim();
    if (!name) continue;
    const k = name.toUpperCase();
    const s = stats.get(k) || { sku: name, title: '', qty: 0, revenue: 0, last: 0, series: new Array(WINDOW).fill(0), split: { walmart: 0, ebay: 0, temu: 0, other: 0 }, wfsQty: 0 };
    const q = Number(l.qty) || 0;
    s.qty += q;
    s.revenue += Number(l.revenue) || 0;
    if (ts > s.last) s.last = ts;
    s.series[di] += q;
    s.split[chanKey(l.source || '')] += q;
    if (wfsLoc && String(l.locationId || '').toLowerCase() === wfsLoc) s.wfsQty += q;
    if (!s.title) s.title = l.title || '';
    stats.set(k, s);
  }

  const rowFor = (sku, title, category, it, s) => {
    const levels = (it && it.levels) || [];
    const home = (opts.locationId && levels.find(l => l.locationId === opts.locationId)) || (it ? levels[0] : null) || {};
    const wfsLvl = wfsLoc ? levels.find(l => String(l.locationId || '').toLowerCase() === wfsLoc) : null;
    const avail = Math.max(0, Number(home.available) || 0);
    const atWfs = wfsLvl ? Math.max(0, Number(wfsLvl.stockLevel) || 0) : 0;
    const due = Math.max(0, Number(home.due) || 0);
    const onHand = avail + atWfs;
    const series = s ? s.series : new Array(WINDOW).fill(0);
    const sold = s ? s.qty : 0;
    const last7 = sum(series.slice(-7));
    const last14 = sum(series.slice(-14));
    const perDay = sold / WINDOW;
    const daysLeft = it && perDay > 0 ? Math.floor(onHand / perDay) : '';
    // daily rate, last 14 days vs the days before them (the Overview's 20% rule)
    const r14 = last14 / 14;
    const rPrior = (sold - last14) / (WINDOW - 14);
    const trend = sold < 3 ? '' : r14 > rPrior * 1.2 ? 'Up' : r14 < rPrior * 0.8 ? 'Down' : 'Steady';
    const padded = !!(it && it.dsPad);
    // buy enough for lead + cover days of the 30-day pace, less what is on
    // hand and already due in, rounded up to 5 (the Overview's rule, plus Due)
    const need = perDay * (lead + cover) - onHand - due;
    const order = !it || padded ? '' : perDay > 0 && need > 0 ? Math.max(5, Math.ceil(need / 5) * 5) : 0;
    const status = !it ? 'Not linked'
      : padded ? 'Dropship'
        : sold === 0 ? 'Not selling'
          : onHand <= 0 ? 'Out of stock'
            : daysLeft > lead + cover ? 'Covered'
              // running short, but what is due in already covers it
              : order === 0 ? 'On order'
                : daysLeft <= lead ? 'Order now' : 'Order soon';
    const cost = it && Number(it.cost) > 0 ? round2(Number(it.cost)) : '';
    const avgPrice = sold > 0 && s.revenue > 0 ? round2(s.revenue / sold) : '';
    const outBy = daysLeft !== '' && daysLeft <= 365 ? localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysLeft)) : '';
    return {
      sku, title: title || '', category: category || '', status,
      available: avail, inOrders: Math.max(0, Number(home.inOrders) || 0), atWfs, onHand, due, min: Number(home.minimumLevel) || 0,
      sold30: sold, sold14: last14, sold7: last7, perDay: round2(perDay), trend, daysLeft, outBy, order,
      cost, orderCost: cost !== '' && order ? round2(cost * order) : '',
      avgPrice, margin: cost !== '' && avgPrice !== '' ? round2(avgPrice - cost) : '',
      revenue: s ? round2(s.revenue) : 0,
      walmart: s ? s.split.walmart : 0, ebay: s ? s.split.ebay : 0, temu: s ? s.split.temu : 0, other: s ? s.split.other : 0,
      wfsSold: s ? s.wfsQty : 0, lastSold: s && s.last ? localDay(new Date(s.last)) : '',
      series,
    };
  };

  const rows = [];
  const seen = new Set();
  for (const it of items || []) {
    if (!it || !it.sku) continue;
    const k = String(it.sku).toUpperCase();
    seen.add(k);
    rows.push(rowFor(it.sku, it.title, it.category, it, stats.get(k)));
  }
  // sold under a channel SKU no Linnworks item answers to
  for (const [k, s] of stats) if (!seen.has(k)) rows.push(rowFor(s.sku, s.title, '', null, s));
  rows.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]
    || (a.daysLeft === '' ? 1e9 : a.daysLeft) - (b.daysLeft === '' ? 1e9 : b.daysLeft)
    || b.perDay - a.perDay
    || a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: 'base' }));

  const count = (st) => rows.filter(r => r.status === st).length;
  const about = [
    ['Exported', `${localDay(now)} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`],
    ['Sales window', `${days[0]} to ${days[days.length - 1]} (${WINDOW} days, processed orders on every channel, local dates)`],
    ['Stock location', opts.locationName || '(default)'],
    ['Lead time (days)', lead],
    ['Cover (days)', cover],
    ['SKUs', rows.length],
    ['Units sold', sum(rows.map(r => r.sold30))],
    ['Out of stock / Order now / Order soon', `${count('Out of stock')} / ${count('Order now')} / ${count('Order soon')}`],
    ['', ''],
    ['Status', 'Out of stock: sold in the window, nothing on hand. Order now: runs out inside the lead time. Order soon: runs out inside lead + cover. On order: would run short, but Due in covers it. Covered: lasts longer. Not selling: no sales in the window. Dropship: stock is a dropship pad, not real units. Not linked: sold under a channel SKU no Linnworks item answers to.'],
    ['Available', 'Units free to sell at the stock location (in stock less in orders).'],
    ['At WFS', 'Units held at Walmart Fulfillment Services.'],
    ['On hand', 'Available + At WFS.'],
    ['Due in', 'Units on open purchase orders at the stock location.'],
    ['Per day', `Units sold in the window / ${WINDOW}.`],
    ['Trend', `Daily rate over the last 14 days against the ${WINDOW - 14} before: Up or Down past 20%, else Steady. Blank under 3 units.`],
    ['Days left', 'On hand / Per day. Out by is today plus Days left.'],
    ['Suggested order', 'Per day x (lead + cover) less On hand and Due in, rounded up to 5. 0 = covered.'],
    ['Avg price', 'Revenue / units sold. Revenue is before sales tax and before marketplace fees and shipping.'],
    ['Margin / unit', 'Avg price less Cost (before fees and shipping). Only on a station with the Cost page.'],
    ['Walmart / eBay / Temu / Other', 'Units sold on each channel in the window.'],
    ['Sold from WFS', 'Units Walmart shipped from WFS (included in Walmart).'],
    ['Daily sheet', 'Units sold per local day, one row per SKU that sold.'],
  ];
  return { rows, days, about };
}

function salesColumns(opts) {
  const cols = [
    { header: 'SKU', width: 28, kind: 'text', f: 'sku' },
    { header: 'Title', width: 48, kind: 'text', f: 'title' },
    { header: 'Category', width: 14, kind: 'text', f: 'category' },
    { header: 'Status', width: 13, kind: 'text', f: 'status' },
    { header: 'Available', width: 10, kind: 'int', f: 'available' },
    { header: 'In orders', width: 10, kind: 'int', f: 'inOrders' },
    { header: 'At WFS', width: 9, kind: 'int', f: 'atWfs' },
    { header: 'On hand', width: 9, kind: 'int', f: 'onHand' },
    { header: 'Due in', width: 8, kind: 'int', f: 'due' },
    { header: 'Min', width: 7, kind: 'int', f: 'min' },
    { header: 'Sold 30d', width: 9, kind: 'int', f: 'sold30' },
    { header: 'Sold 14d', width: 9, kind: 'int', f: 'sold14' },
    { header: 'Sold 7d', width: 9, kind: 'int', f: 'sold7' },
    { header: 'Per day', width: 9, kind: 'dec', f: 'perDay' },
    { header: 'Trend', width: 8, kind: 'center', f: 'trend' },
    { header: 'Days left', width: 10, kind: 'int', f: 'daysLeft' },
    { header: 'Out by', width: 11, kind: 'center', f: 'outBy' },
    { header: 'Suggested order', width: 10, kind: 'int', f: 'order' },
  ];
  if (opts.cost) cols.push({ header: 'Cost', width: 10, kind: 'money', f: 'cost' }, { header: 'Order cost', width: 11, kind: 'money', f: 'orderCost' });
  cols.push({ header: 'Avg price', width: 10, kind: 'money', f: 'avgPrice' });
  if (opts.cost) cols.push({ header: 'Margin / unit', width: 11, kind: 'money', f: 'margin' });
  cols.push(
    { header: 'Revenue 30d', width: 12, kind: 'money', f: 'revenue' },
    { header: 'Walmart', width: 9, kind: 'int', f: 'walmart' },
    { header: 'eBay', width: 8, kind: 'int', f: 'ebay' },
    { header: 'Temu', width: 8, kind: 'int', f: 'temu' },
    { header: 'Other', width: 8, kind: 'int', f: 'other' },
    { header: 'Sold from WFS', width: 10, kind: 'int', f: 'wfsSold' },
    { header: 'Last sold', width: 11, kind: 'center', f: 'lastSold' },
  );
  return cols;
}

// the three sheets as { name, columns, rows } (rows: arrays in column order)
function salesSheets(data, opts = {}) {
  const cols = salesColumns({ cost: !!opts.cost });
  const dayCols = [
    { header: 'SKU', width: 28, kind: 'text' },
    ...data.days.map(d => ({ header: d, width: 11, kind: 'int' })),
    { header: 'Total', width: 8, kind: 'int' },
  ];
  return [
    { name: 'SKUs', columns: cols, rows: data.rows.map(r => cols.map(c => r[c.f])) },
    { name: 'Daily', columns: dayCols, rows: data.rows.filter(r => r.sold30 > 0).map(r => [r.sku, ...r.series, r.sold30]) },
    { name: 'About', columns: [{ header: 'Field', width: 34, kind: 'text' }, { header: 'Value', width: 110, kind: 'text' }], rows: data.about },
  ];
}

function buildSalesExportXlsx(data, opts = {}) {
  const { buildWorkbookSheets } = require('./xlsxwrite.js');
  return buildWorkbookSheets(salesSheets(data, opts));
}
// CSV cannot hold three sheets: { skus, daily, about } — three files
function buildSalesExportCsv(data, opts = {}) {
  const file = (sh) => [sh.columns.map(c => csvEscape(c.header)).join(','), ...sh.rows.map(r => r.map(csvEscape).join(','))].join('\r\n') + '\r\n';
  const [skus, daily, about] = salesSheets(data, opts).map(file);
  return { skus, daily, about };
}

module.exports = { buildSalesExport, buildSalesExportXlsx, buildSalesExportCsv };
