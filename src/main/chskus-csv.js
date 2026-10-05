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
    delete r.item;
  }
  // the Stock page's active chip narrows the file the same way it narrows the grid
  return (want ? out.filter(r => r.condition.toLowerCase() === want) : out)
    .sort((a, b) => a.inventorySku.localeCompare(b.inventorySku, undefined, { numeric: true, sensitivity: 'base' })
      || a.channelSku.localeCompare(b.channelSku, undefined, { numeric: true, sensitivity: 'base' }));
}

const HEADER = ['Inventory SKU', 'Channel SKU', 'Title', 'Condition', 'In stock', 'Price', 'WFS', 'Source', 'SubSource'];

function buildChannelSkuCsv(rows) {
  const lines = [HEADER.join(',')];
  for (const r of rows) {
    lines.push([r.inventorySku, r.channelSku, r.title, r.condition, r.inStock, r.price, r.wfs, r.source, r.subSource].map(csvEscape).join(','));
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
function buildChannelSkuXlsx(rows, sheetName) {
  const { buildWorkbook } = require('./xlsxwrite.js');
  return buildWorkbook({
    sheetName: sheetName || 'Channel SKUs',
    columns: XLSX_COLUMNS,
    rows: rows.map(r => [r.inventorySku, r.channelSku, r.title, r.condition, r.inStock, r.price, r.wfs, r.source, r.subSource]),
  });
}

module.exports = { LABELS, conditionOf, buildChannelSkuRows, buildChannelSkuCsv, buildChannelSkuXlsx };
