'use strict';
// Stock-based order routing between the primary location and a dropship
// fallback. Orders the primary location cannot cover (Available < 0 after
// reservations) move to the fallback; once the primary is replenished,
// unshipped fallback orders move back. Runs periodically from main.js.

const config = require('./config');
const db = require('./db');
const { LinnworksClient } = require('./linnworks');

let running = false;
let lastResult = null;

function isRunning() { return running; }
function getLastResult() { return lastResult; }

async function runRouting() {
  if (running) return { skipped: true };
  const cfg = config.load();
  const r = cfg.stockRouting || {};
  const primary = cfg.linnworks.locationId;
  if (cfg.captureOnly || !r.enabled || !r.fallbackLocationId || !primary) return { skipped: true };
  running = true;
  try {
    const client = new LinnworksClient(cfg.linnworks);
    await client.auth();

    // availability at the primary location, cached per stock item and adjusted
    // as planned moves free or consume reservations
    const avail = new Map();
    const availAt = async (id) => {
      if (!avail.has(id)) avail.set(id, await client.getAvailableAt(id, primary));
      return avail.get(id);
    };

    // Routing decisions only make sense for lines linked to a real stock item.
    // Judge by the live link (a real stock item id), NOT the IsUnlinked flag:
    // that flag is a snapshot from download time and stays stale after a line
    // is mapped (see docs/unlinked-orders-investigation.md).
    const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
    const routable = (o) => o.items.filter(it =>
      !it.isService && it.stockItemId && it.stockItemId !== ZERO_GUID);

    // DropShip program: only enrolled SKUs (pad > 0) may route to the
    // fallback — the supplier does not carry everything. A short order with
    // an unenrolled line stays home and screams via the low-stock alert.
    const pads = cfg.dropshipPads || {};
    const enrolled = (sku) => (Number(pads[String(sku || '').trim().toUpperCase()]) || 0) > 0;

    // Substitution intents on unprocessed rows: the order's lines still
    // reserve the LISTED item in Linnworks, but routing must follow what will
    // actually ship - a silver order substituted to in-stock black belongs at
    // the warehouse even though silver reads short.
    const subs = new Map();
    for (const row of db.activeRows()) {
      if (row.sub_sku && row.sub_qty > 0) {
        subs.set(String(row.order_number).trim(), { sku: row.sub_sku, qty: row.sub_qty });
      }
    }
    const subIdCache = new Map(); // sku (lower) -> stockItemId | null
    const subItemId = async (sku) => {
      const k = String(sku).toLowerCase();
      if (!subIdCache.has(k)) {
        try { subIdCache.set(k, await client.findStockItemIdBySku(sku)); }
        catch { subIdCache.set(k, null); } // unresolvable: fall back to listed lines
      }
      return subIdCache.get(k);
    };

    // 1) primary orders the stock cannot cover -> fallback. Newest first, so
    // the orders that pushed availability negative are the ones that leave.
    const toFallback = [];
    const primaryOrders = await client.listOpenOrders(primary);
    primaryOrders.sort((a, b) => b.numOrderId - a.numOrderId);
    for (const o of primaryOrders) {
      const items = routable(o);
      const sub = subs.get(String(o.reference || '').trim());
      const subId = sub ? await subItemId(sub.sku) : null;
      if (subId) {
        // judged by the substitute alone: if it covers the order, the order
        // stays home and claims that stock so competing substitutions see it
        const a = await availAt(subId);
        if (a >= sub.qty) { avail.set(subId, a - sub.qty); continue; }
        if (!enrolled(sub.sku)) continue; // supplier can't ship the substitute
        toFallback.push(o);
        for (const it of items) {
          avail.set(it.stockItemId, (await availAt(it.stockItemId)) + it.quantity);
        }
        continue;
      }
      if (!items.length) continue;
      let short = false;
      for (const it of items) {
        if ((await availAt(it.stockItemId)) < 0) { short = true; break; }
      }
      if (short && items.every(it => enrolled(it.sku))) {
        toFallback.push(o);
        for (const it of items) {
          avail.set(it.stockItemId, (await availAt(it.stockItemId)) + it.quantity);
        }
      }
    }

    // 2) fallback orders the primary can now fully cover -> back to primary.
    // Oldest first, so the longest-waiting orders reclaim stock first.
    const toPrimary = [];
    const fallbackOrders = await client.listOpenOrders(r.fallbackLocationId);
    fallbackOrders.sort((a, b) => a.numOrderId - b.numOrderId);
    for (const o of fallbackOrders) {
      const items = routable(o);
      const sub = subs.get(String(o.reference || '').trim());
      const subId = sub ? await subItemId(sub.sku) : null;
      if (subId) {
        if ((await availAt(subId)) < sub.qty) continue;
        toPrimary.push(o);
        avail.set(subId, avail.get(subId) - sub.qty);
        // moving home re-reserves the LISTED lines at the warehouse too
        for (const it of items) {
          avail.set(it.stockItemId, (await availAt(it.stockItemId)) - it.quantity);
        }
        continue;
      }
      if (!items.length) continue;
      let fits = true;
      for (const it of items) {
        if ((await availAt(it.stockItemId)) < it.quantity) { fits = false; break; }
      }
      if (fits) {
        toPrimary.push(o);
        for (const it of items) {
          avail.set(it.stockItemId, avail.get(it.stockItemId) - it.quantity);
        }
      }
    }

    let movedOut = 0;
    let movedBack = 0;
    const errors = [];
    if (toFallback.length) {
      const res = await client.moveOrdersToLocation(toFallback.map(o => o.orderId), r.fallbackLocationId);
      movedOut = res && res.OrdersMoved ? res.OrdersMoved.length : 0;
      if (res && res.Errors) errors.push(...res.Errors);
    }
    if (toPrimary.length) {
      const res = await client.moveOrdersToLocation(toPrimary.map(o => o.orderId), primary);
      movedBack = res && res.OrdersMoved ? res.OrdersMoved.length : 0;
      if (res && res.Errors) errors.push(...res.Errors);
    }

    lastResult = {
      at: new Date().toISOString(),
      movedOut,
      movedBack,
      outRefs: toFallback.map(o => o.reference),
      backRefs: toPrimary.map(o => o.reference),
      errors,
    };
    return lastResult;
  } catch (e) {
    lastResult = { at: new Date().toISOString(), error: e.message };
    return lastResult;
  } finally {
    running = false;
  }
}

module.exports = { runRouting, isRunning, getLastResult };
