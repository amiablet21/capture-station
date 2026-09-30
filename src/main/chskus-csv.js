'use strict';
// Channel-SKU export: merge one marketplace's scanned catalog feed with the
// item-level link records into CSV rows (owner 2026-09-30: "a list of all
// the channel SKUs"). Pure — no Electron, no network — so it is testable
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

// items: listInventory() rows ({ stockItemId, sku, title })
// feeds: [{ channel: { source, subSource }, rows: getChannelItems() rows }]
// recs:  { stockItemId: [{ sku, source, subSource }] } (the unlisted scan's chrecs)
function buildChannelSkuRows(channelKey, items, feeds, recs) {
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
        if (!hit.inventorySku && it) hit.inventorySku = it.sku;
        if (!hit.title && it) hit.title = it.title || '';
      } else {
        rows.set(k, {
          channelSku: r.sku,
          inventorySku: it ? it.sku : '',
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
  return [...rows.values()].sort((a, b) => a.channelSku.localeCompare(b.channelSku, undefined, { numeric: true, sensitivity: 'base' }));
}

const HEADER = ['Channel SKU', 'Inventory SKU', 'Title', 'Listed qty', 'Price', 'WFS', 'Linked', 'Source', 'SubSource', 'In channel scan'];

function buildChannelSkuCsv(rows) {
  const lines = [HEADER.join(',')];
  for (const r of rows) {
    lines.push([r.channelSku, r.inventorySku, r.title, r.qty, r.price, r.wfs, r.linked, r.source, r.subSource, r.inScan].map(csvEscape).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = { LABELS, buildChannelSkuRows, buildChannelSkuCsv };
