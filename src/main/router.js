'use strict';
// Stock-based order routing between the primary location and a dropship
// fallback. Orders the primary location cannot cover (Available < 0 after
// reservations) move to the fallback; once the primary is replenished,
// unshipped fallback orders move back. Runs periodically from main.js.

const config = require('./config');
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

    // 1) primary orders the stock cannot cover -> fallback. Newest first, so
    // the orders that pushed availability negative are the ones that leave.
    const toFallback = [];
    const primaryOrders = await client.listOpenOrders(primary);
    primaryOrders.sort((a, b) => b.numOrderId - a.numOrderId);
    for (const o of primaryOrders) {
      if (!o.items.length) continue;
      let short = false;
      for (const it of o.items) {
        if ((await availAt(it.stockItemId)) < 0) { short = true; break; }
      }
      if (short) {
        toFallback.push(o);
        for (const it of o.items) {
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
      if (!o.items.length) continue;
      let fits = true;
      for (const it of o.items) {
        if ((await availAt(it.stockItemId)) < it.quantity) { fits = false; break; }
      }
      if (fits) {
        toPrimary.push(o);
        for (const it of o.items) {
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
