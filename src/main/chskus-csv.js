'use strict';
// Channel-SKU export: merge one marketplace's scanned catalog feed with the
// item-level link records into CSV rows — the MAPPED listings only (owner
// 2026-09-30: "the mapped channel SKUs, not every Walmart SKU"). Pure — no Electron, no network — so it is testable
// with plain node. The feed carries title / qty / price / WFS for every
// listing Linnworks has seen on the channel, linked or not; the link
// records say WHICH inventory SKU a listing points at (the feed's
// LinkedItemId is empty even on linked rows), and keep a listing the
// flickering feed dropped in the file.

const LABELS = { walmart: 'Walmart', ebay: 'eBay', temu: 'Temu' };

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Condition of one listing, the way the Stock page's chips slice the grid:
// the first config stockView whose regex hits the SKU or title wins (Open
// Box / Used / Scrap by default); nothing hits = New. The inventory item is
// tested first, the channel listing as the fallback.
function conditionOf(views, ...subjects) {
  for (const v of views || []) {
    if (!v || !v.pattern) continue;
    let re;
    try { re = new RegExp(v.pattern, 'i'); } catch { continue; }
    for (const s of subjects) {
      if (s && (re.test(s.sku || '') || re.test(s.title || ''))) return v.label || '';
    }
  }
  return 'New';
}

// items: listInventory() rows ({ stockItemId, sku, title })
// feeds: [{ channel: { source, subSource }, rows: getChannelItems() rows }]
// recs:  { stockItemId: [{ sku, source, subSource }] } (the unlisted scan's chrecs)
// opts:  { views: config.stockViews, condition: 'New' | a view label | '' (all),
//          locationId: the primary stock location — the In stock column is
//          the Linnworks level there, NOT the marketplace's listed qty (owner
//          2026-10-05: a listing the feed skipped came out blank); every
//          channel SKU of one inventory item carries the same number }
function buildChannelSkuRows(channelKey, items, feeds, recs, opts = {}) {
  const views = Array.isArray(opts.views) ? opts.views : [];
  const want = String(opts.condition || '').trim().toLowerCase();
  const key = String(channelKey || '').toLowerCase();
  const isChan = (src) => new RegExp(key, 'i').test(String(src || ''));
  const byId = new Map((items || []).filter(it => it && it.stockItemId).map(it => [it.stockItemId, it]));
  const rows = new Map(); // subSource|CHANNEL SKU -> row (twin accounts stay apart)
  const rowKey = (sub, sku) => `${String(sub || '').toLowerCase()}|${String(sku || '').toUpperCase()}`;
  for (const { channel, rows: feed } of feeds || []) {
    if (!channel || !isChan(channel.source)) continue;
    for (const f of feed || []) {
      if (!f || !f.sku) continue;
      const linkedItem = f.linkedItemId ? byId.get(f.linkedItemId) : null;
      rows.set(rowKey(channel.subSource, f.sku), {
        channelSku: f.sku,
        inventorySku: linkedItem ? linkedItem.sku : '',
        item: linkedItem || null,
        title: f.title || (linkedItem ? linkedItem.title || '' : ''),
        qty: f.qty ?? '',
        price: f.price || '',
        wfs: f.wfs ? 'yes' : '',
        linked: (f.linked || linkedItem) ? 'yes' : 'no',
        source: channel.source,
        subSource: channel.subSource || '',
        inScan: 'yes',
      });
    }
  }
  for (const [stockItemId, list] of Object.entries(recs || {})) {
    const it = byId.get(stockItemId);
    for (const r of list || []) {
      if (!r || !r.sku || !isChan(r.source)) continue;
      const k = rowKey(r.subSource, r.sku);
      const hit = rows.get(k);
      if (hit) {
        hit.linked = 'yes';
        if (!hit.item && it) hit.item = it;
        if (!hit.inventorySku && it) hit.inventorySku = it.sku;
        if (!hit.title && it) hit.title = it.title || '';
      } else {
        rows.set(k, {
          channelSku: r.sku,
          inventorySku: it ? it.sku : '',
          item: it || null,
          title: it ? it.title || '' : '',
          qty: '',
          price: '',
          wfs: '',
          linked: 'yes',
          source: r.source,
          subSource: r.subSource || '',
          inScan: 'no',
        });
      }
    }
  }
  // MAPPED listings only (owner 2026-09-30: "the mapped channel SKUs, not
  // every Walmart SKU"): a feed row nothing points at is not in the file
  const out = [...rows.values()].filter(r => r.linked === 'yes');
  const levelOf = (it) => {
    if (!it || !Array.isArray(it.levels) || !it.levels.length) return '';
    const lv = (opts.locationId && it.levels.find(l => l.locationId === opts.locationId)) || it.levels[0];
    return lv ? Number(lv.stockLevel) || 0 : '';
  };
  for (const r of out) {
    r.condition = conditionOf(views, r.item, { sku: r.channelSku, title: r.title });
    r.inStock = levelOf(r.item);
    r.cost = r.item && Number(r.item.cost) > 0 ? Math.round(Number(r.item.cost) * 100) / 100 : ''; // the software's cost, not Linnworks'
    delete r.item;
  }
  // the Stock page's active chip narrows the file the same way it narrows the grid
  return (want ? out.filter(r => r.condition.toLowerCase() === want) : out)
    .sort((a, b) => a.inventorySku.localeCompare(b.inventorySku, undefined, { numeric: true, sensitivity: 'base' })
      || a.channelSku.localeCompare(b.channelSku, undefined, { numeric: true, sensitivity: 'base' }));
}

const HEADER = ['Inventory SKU', 'Channel SKU', 'Title', 'Condition', 'In stock', 'Price', 'WFS', 'Source', 'SubSource'];

// opts.cost: add the Cost column (only a station with the Cost tick asks)
function buildChannelSkuCsv(rows, opts = {}) {
  const head = opts.cost ? [...HEADER.slice(0, 5), 'Cost', ...HEADER.slice(5)] : HEADER;
  const lines = [head.join(',')];
  for (const r of rows) {
    const cells = [r.inventorySku, r.channelSku, r.title, r.condition, r.inStock, r.price, r.wfs, r.source, r.subSource];
    if (opts.cost) cells.splice(5, 0, r.cost);
    lines.push(cells.map(csvEscape).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// The same rows as a styled workbook (owner 2026-09-30: the CSV "is too
// plain" — a CSV cannot carry formatting): navy bold header, Arial 10,
// sized columns, frozen header row, autofilter, $ prices.
const XLSX_COLUMNS = [
  { header: 'Inventory SKU', width: 26, kind: 'text' },
  { header: 'Channel SKU', width: 26, kind: 'text' },
  { header: 'Title', width: 60, kind: 'text' },
  { header: 'Condition', width: 11, kind: 'text' },
  { header: 'In stock', width: 11, kind: 'int' },
  { header: 'Price', width: 10, kind: 'money' },
  { header: 'WFS', width: 6, kind: 'center' },
  { header: 'Source', width: 11, kind: 'text' },
  { header: 'SubSource', width: 19, kind: 'text' },
];
function buildChannelSkuXlsx(rows, sheetName, opts = {}) {
  const { buildWorkbook } = require('./xlsxwrite.js');
  const columns = opts.cost ? [...XLSX_COLUMNS.slice(0, 5), { header: 'Cost', width: 10, kind: 'money' }, ...XLSX_COLUMNS.slice(5)] : XLSX_COLUMNS;
  return buildWorkbook({
    sheetName: sheetName || 'Channel SKUs',
    columns,
    rows: rows.map(r => {
      const cells = [r.inventorySku, r.channelSku, r.title, r.condition, r.inStock, r.price, r.wfs, r.source, r.subSource];
      if (opts.cost) cells.splice(5, 0, r.cost);
      return cells;
    }),
  });
}


/* ---------- Linnworks SKU export (owner 2026-10-09): every inventory item
   with its channel mappings. Two sheets: SKUs (one row per item, a column
   per marketplace with the mapped channel SKUs) and Mappings (one row per
   link). items: listInventory() rows (+ cost); feeds: every mapping channel's
   scanned catalog; recs: the unlisted scan's link records; extra: per-item
   getChannelSkus() rows for items the scan did not cover
   ({ stockItemId: [{ sku, source, subSource, refId, listedQuantity }] }) ---------- */
const CHANNEL_KEY = (src) => /walmart/i.test(src) ? 'walmart' : /ebay/i.test(src) ? 'ebay' : /temu/i.test(src) ? 'temu' : 'other';
const CHANNEL_NAME = { walmart: 'Walmart', ebay: 'eBay', temu: 'Temu', other: 'Other' };

function buildSkuExport(items, feeds, recs, extra, opts = {}) {
  const byId = new Map((items || []).filter(it => it && it.stockItemId).map(it => [it.stockItemId, it]));
  const maps = new Map(); // stockItemId|channel key|sub|CHSKU -> mapping row
  const mkey = (id, ch, sub, sku) => `${id}|${ch}|${String(sub || '').toLowerCase()}|${String(sku || '').toUpperCase()}`;
  const put = (it, source, subSource, sku, more) => {
    if (!it || !sku) return;
    const ch = CHANNEL_KEY(source);
    const k = mkey(it.stockItemId, ch, subSource, sku);
    const row = maps.get(k) || { inventorySku: it.sku, stockItemId: it.stockItemId, channel: CHANNEL_NAME[ch], ch, account: subSource || '', channelSku: sku, title: '', qty: '', price: '', wfs: '', listingId: '' };
    for (const [f, v] of Object.entries(more || {})) if (v !== '' && v != null && (row[f] === '' || row[f] == null)) row[f] = v;
    maps.set(k, row);
  };
  // the catalog feeds know titles, listed qty, price, WFS and the listing id
  const feedByChSku = new Map(); // channel key|sub|CHSKU -> feed row (for link records the feed also saw)
  for (const { channel, rows } of feeds || []) {
    if (!channel) continue;
    const ch = CHANNEL_KEY(channel.source);
    for (const f of rows || []) {
      if (!f || !f.sku) continue;
      feedByChSku.set(`${ch}|${String(channel.subSource || '').toLowerCase()}|${String(f.sku).toUpperCase()}`, f);
      const it = f.linkedItemId ? byId.get(f.linkedItemId) : null;
      if (it) put(it, channel.source, channel.subSource, f.sku, { title: f.title, qty: f.qty, price: f.price || '', wfs: f.wfs ? 'yes' : '', listingId: f.channelRefId || '' });
    }
  }
  // the link records say which item a listing points at
  const fromRecs = (recMap) => {
    for (const [stockItemId, list] of Object.entries(recMap || {})) {
      const it = byId.get(stockItemId);
      if (!it) continue;
      for (const r of list || []) {
        if (!r || !r.sku || !r.source) continue;
        const f = feedByChSku.get(`${CHANNEL_KEY(r.source)}|${String(r.subSource || '').toLowerCase()}|${String(r.sku).toUpperCase()}`);
        put(it, r.source, r.subSource, r.sku, {
          title: f ? f.title : '', qty: f ? f.qty : (r.listedQuantity ?? ''), price: f ? (f.price || '') : '',
          wfs: f && f.wfs ? 'yes' : '', listingId: (f && f.channelRefId) || r.refId || '',
        });
      }
    }
  };
  fromRecs(recs);
  fromRecs(extra);
  const mapRows = [...maps.values()].sort((a, b) => a.inventorySku.localeCompare(b.inventorySku, undefined, { numeric: true, sensitivity: 'base' })
    || a.channel.localeCompare(b.channel) || a.channelSku.localeCompare(b.channelSku, undefined, { numeric: true, sensitivity: 'base' }));
  const hasOther = mapRows.some(r => r.ch === 'other');
  const byItem = new Map();
  for (const r of mapRows) { const l = byItem.get(r.stockItemId) || []; l.push(r); byItem.set(r.stockItemId, l); }
  const levelOf = (it) => {
    if (!it || !Array.isArray(it.levels) || !it.levels.length) return null;
    return (opts.locationId && it.levels.find(l => l.locationId === opts.locationId)) || it.levels[0];
  };
  const skuRows = (items || []).filter(it => it && it.sku).map(it => {
    const lv = levelOf(it) || {};
    const ms = byItem.get(it.stockItemId) || [];
    const col = (ch) => ms.filter(m => m.ch === ch).map(m => m.channelSku).join(' | ');
    return {
      sku: it.sku, title: it.title || '', barcode: it.barcode || '', category: it.category || '',
      inStock: Number(lv.stockLevel) || 0, inOrders: Number(lv.inOrders) || 0, available: Number(lv.available) || 0, min: Number(lv.minimumLevel) || 0,
      cost: Number(it.cost) > 0 ? Math.round(Number(it.cost) * 100) / 100 : '',
      walmart: col('walmart'), ebay: col('ebay'), temu: col('temu'), other: col('other'), mappings: ms.length,
    };
  }).sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: 'base' }));
  return { skuRows, mapRows, hasOther };
}

function skuExportColumns(opts) {
  const cols = [
    { header: 'SKU', width: 28, kind: 'text', f: 'sku' },
    { header: 'Title', width: 52, kind: 'text', f: 'title' },
    { header: 'Barcode', width: 16, kind: 'text', f: 'barcode' },
    { header: 'Category', width: 16, kind: 'text', f: 'category' },
    { header: 'In stock', width: 10, kind: 'int', f: 'inStock' },
    { header: 'In orders', width: 10, kind: 'int', f: 'inOrders' },
    { header: 'Available', width: 10, kind: 'int', f: 'available' },
    { header: 'Min', width: 8, kind: 'int', f: 'min' },
  ];
  if (opts.cost) cols.push({ header: 'Cost', width: 10, kind: 'money', f: 'cost' });
  cols.push({ header: 'Walmart SKU', width: 30, kind: 'text', f: 'walmart' }, { header: 'eBay SKU', width: 30, kind: 'text', f: 'ebay' }, { header: 'Temu SKU', width: 30, kind: 'text', f: 'temu' });
  if (opts.other) cols.push({ header: 'Other SKU', width: 30, kind: 'text', f: 'other' });
  cols.push({ header: 'Mappings', width: 10, kind: 'int', f: 'mappings' });
  return cols;
}
const MAP_COLUMNS = [
  { header: 'Inventory SKU', width: 28, kind: 'text', f: 'inventorySku' },
  { header: 'Channel', width: 10, kind: 'text', f: 'channel' },
  { header: 'Account', width: 20, kind: 'text', f: 'account' },
  { header: 'Channel SKU', width: 30, kind: 'text', f: 'channelSku' },
  { header: 'Channel title', width: 52, kind: 'text', f: 'title' },
  { header: 'Listed qty', width: 10, kind: 'int', f: 'qty' },
  { header: 'Price', width: 10, kind: 'money', f: 'price' },
  { header: 'WFS', width: 6, kind: 'center', f: 'wfs' },
  { header: 'Listing ID', width: 18, kind: 'text', f: 'listingId' },
];
function buildSkuExportXlsx(data, opts = {}) {
  const { buildWorkbookSheets } = require('./xlsxwrite.js');
  const skuCols = skuExportColumns({ cost: !!opts.cost, other: data.hasOther });
  return buildWorkbookSheets([
    { name: 'SKUs', columns: skuCols, rows: data.skuRows.map(r => skuCols.map(c => r[c.f])) },
    { name: 'Mappings', columns: MAP_COLUMNS, rows: data.mapRows.map(r => MAP_COLUMNS.map(c => r[c.f])) },
  ]);
}
// CSV cannot hold two sheets: { skus, mappings } — two files
function buildSkuExportCsv(data, opts = {}) {
  const skuCols = skuExportColumns({ cost: !!opts.cost, other: data.hasOther });
  const file = (cols, rows) => [cols.map(c => c.header).join(','), ...rows.map(r => cols.map(c => csvEscape(r[c.f])).join(','))].join('\r\n') + '\r\n';
  return { skus: file(skuCols, data.skuRows), mappings: file(MAP_COLUMNS, data.mapRows) };
}

module.exports = { LABELS, conditionOf, buildChannelSkuRows, buildChannelSkuCsv, buildChannelSkuXlsx, buildSkuExport, buildSkuExportXlsx, buildSkuExportCsv };
