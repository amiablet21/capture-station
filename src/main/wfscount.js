'use strict';
// WFS counts straight from Walmart (owner 2026-11-05: "much better idea").
// Linnworks' Walmart sync writes each WFS listing's count onto the linked
// item in turn, so an item behind several Walmart listings flips every 15
// minutes (X230-256GB-GRAY: 21 on -GLOBAL-1, then 0 from -GLOBAL and
// x230256gbGREY, then 21 again). Walmart's own fulfillment inventory,
// summed over every listing linked to the item, is the steady number.
// Pure - no Electron, no network - so it is testable with plain node.

const up = (s) => String(s || '').trim().toUpperCase();
const low = (s) => String(s || '').trim().toLowerCase();

// wfsRows: Walmart's /v3/fulfillment/inventory rows ({ sku, shipNodes });
// catalog: Linnworks' Walmart listing rows ({ sku, linkedItemId }).
// -> Map stockItemId (lower case) -> { stockLevel, available, listings }
// for each item linked to at least one WFS listing (0 when none hold stock)
function wfsByItem(wfsRows, catalog) {
  const linked = new Map();
  for (const r of catalog || []) if (r && r.sku && r.linkedItemId) linked.set(up(r.sku), low(r.linkedItemId));
  const out = new Map();
  for (const w of wfsRows || []) {
    const id = linked.get(up(w && w.sku));
    if (!id) continue;
    const nodes = Array.isArray(w.shipNodes) ? w.shipNodes : [];
    const onHand = nodes.reduce((t, n) => t + Math.max(0, Number(n && n.onHandQty) || 0), 0);
    const avail = nodes.reduce((t, n) => t + Math.max(0, Number(n && n.availToSellQty) || 0), 0);
    const e = out.get(id) || { stockLevel: 0, available: 0, listings: [] };
    e.stockLevel += onHand;
    e.available += avail;
    e.listings.push({ sku: String(w.sku), qty: onHand });
    out.set(id, e);
  }
  return out;
}

// Puts Walmart's counts on each item's WFS level, in place. Items behind no
// WFS listing keep Linnworks' number. Returns how many items changed.
function applyWfs(items, byItem) {
  if (!byItem || !byItem.size) return 0;
  let loc = null;
  for (const it of items || []) {
    const l = (it.levels || []).find(x => /wfs/i.test(x.locationName || ''));
    if (l) { loc = { locationId: l.locationId, locationName: l.locationName }; break; }
  }
  if (!loc) return 0;
  let changed = 0;
  for (const it of items) {
    const w = byItem.get(low(it.stockItemId));
    if (!w) continue;
    const levels = it.levels || (it.levels = []);
    let l = levels.find(x => x.locationId === loc.locationId);
    if (!l) {
      if (!w.stockLevel && !w.available) continue;
      l = { ...loc, stockLevel: 0, inOrders: 0, due: 0, minimumLevel: 0, available: 0 };
      levels.push(l);
    }
    if (l.stockLevel !== w.stockLevel || l.available !== w.available) changed += 1;
    l.stockLevel = w.stockLevel;
    l.available = w.available;
  }
  return changed;
}

module.exports = { wfsByItem, applyWfs };
