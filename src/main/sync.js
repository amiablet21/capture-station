'use strict';
// Sync orchestration: find order -> set tracking -> attach serials -> process.
// Dry-run mode does the read-only lookup and logs planned writes without writing.

const db = require('./db');
const config = require('./config');
const { LinnworksClient } = require('./linnworks');

let running = false;

function isRunning() { return running; }

async function testConnection(creds) {
  const client = new LinnworksClient(creds);
  await client.auth();
  const locations = await client.getLocations();
  return { server: client.session.server, locations };
}

// Split a row's serials across the order's item lines by quantity, in item order.
// Single-line orders (the normal case) get everything.
function distributeSerials(items, serials) {
  const out = [];
  const notes = [];
  let cursor = 0;
  const lines = items.filter(it => it.quantity > 0);
  lines.forEach((it, idx) => {
    const isLast = idx === lines.length - 1;
    const take = isLast ? serials.length - cursor : Math.min(it.quantity, serials.length - cursor);
    if (take > 0) {
      out.push({ orderItemRowId: it.rowId, serials: serials.slice(cursor, cursor + take), sku: it.sku });
      cursor += take;
    }
  });
  const totalQty = lines.reduce((a, b) => a + b.quantity, 0);
  if (serials.length !== totalQty) {
    notes.push(`serial count (${serials.length}) differs from order quantity (${totalQty})`);
  }
  if (lines.length > 1) {
    notes.push(`multi-line order: serials assigned to lines in sequence, check mapping`);
  }
  return { assignments: out, notes };
}

async function runSync({ onProgress = () => {}, trigger = 'manual', ids = null } = {}) {
  if (running) return { error: 'Sync already running' };
  running = true;
  try {
    const cfg = config.load();
    const dryRun = !!cfg.dryRun;
    // ids: optional subset chosen in the UI; empty/absent means everything eligible
    const wanted = Array.isArray(ids) && ids.length ? new Set(ids) : null;
    const rows = db.rowsToSync().filter(r => !wanted || wanted.has(r.id));
    const details = [];
    let synced = 0;
    let failed = 0;

    if (rows.length === 0) {
      const summary = finish({ synced, failed, total: 0, dryRun, trigger, details });
      return summary;
    }

    const client = new LinnworksClient(cfg.linnworks);
    onProgress({ current: 0, total: rows.length, message: 'Signing in to Linnworks' });
    await client.auth();

    let locationId = cfg.linnworks.locationId;
    if (!locationId) {
      const locations = await client.getLocations();
      if (locations.length === 1) {
        locationId = locations[0].id;
        config.save({ linnworks: { locationId, locationName: locations[0].name } });
      } else {
        throw new Error(
          `No stock location selected. Open Settings and pick one of: ${locations.map(l => l.name).join(', ')}`
        );
      }
    }

    // The capture queue imports open orders from EVERY stock location, so the
    // per-row lookup must be able to search them all (fetched once per run).
    let allLocations = [];
    try { allLocations = await client.getLocations(); } catch { /* lookup falls back to primary + fallback */ }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      onProgress({ current: i + 1, total: rows.length, message: `Order ${row.order_number}` });
      try {
        const result = await syncRow(client, row, locationId, dryRun, allLocations);
        details.push({ id: row.id, orderNumber: row.order_number, ...result });
        if (result.ok) synced++; else failed++;
      } catch (e) {
        db.markFailed(row.id, e.message);
        details.push({ id: row.id, orderNumber: row.order_number, ok: false, message: e.message });
        failed++;
      }
    }

    return finish({ synced, failed, total: rows.length, dryRun, trigger, details });
  } catch (e) {
    return finish({ error: e.message, synced: 0, failed: 0, total: 0, dryRun: !!config.load().dryRun, trigger, details: [] });
  } finally {
    running = false;
  }
}

async function syncRow(client, row, locationId, dryRun, allLocations) {
  // Resolve the order across every stock location. The v1.3 capture queue
  // imports open orders from ALL locations, so an order sitting at, say,
  // DropShip is a perfectly normal queue row - the old primary+fallback-only
  // lookup wrongly failed those with "Not found in open orders".
  // Search order: primary first, then the routing fallback (keeps the
  // dropship labeling), then every remaining location.
  const sr = config.load().stockRouting || {};
  const fallbackId = sr.fallbackLocationId;
  let order = await client.findOpenOrder(row.order_number, locationId);
  let foundAt = { id: locationId, name: '' }; // '' = the primary warehouse
  if (!order) {
    const seen = new Set([locationId]);
    const targets = [];
    if (fallbackId && !seen.has(fallbackId)) {
      targets.push({ id: fallbackId, name: sr.fallbackLocationName || 'fallback' });
      seen.add(fallbackId);
    }
    for (const l of allLocations || []) {
      if (!seen.has(l.id)) {
        targets.push(l);
        seen.add(l.id);
      }
    }
    for (const t of targets) {
      order = await client.findOpenOrder(row.order_number, t.id);
      if (order) { foundAt = t; break; }
    }
  }
  if (!order) {
    // Not open anymore. Usually Linnworks already processed it by itself:
    // label bought on the channel -> Walmart marks it shipped -> channel
    // sync despatches the order before our sync gets there. Reconfirm
    // against processed orders and complete the row instead of failing it;
    // orders missing from BOTH books (e.g. cancelled) still fail loudly.
    let done = null;
    try { done = await client.findProcessedOrder(row.order_number, { light: true }); }
    catch { /* lookup hiccup: treat as unconfirmed, fall through to retry */ }
    if (done) {
      const when = done.processedOn ? ` ${String(done.processedOn).slice(0, 10)}` : '';
      if (dryRun) return { ok: true, dryRun: true, message: `DRY RUN: already processed on Linnworks${when} - would complete the row` };
      const marker = 'processed via channel sync';
      if (!(row.notes || '').includes(marker)) {
        db.updateRow(row.id, { notes: row.notes ? `${row.notes} | ${marker}` : marker });
      }
      db.markSynced(row.id);
      return { ok: true, message: `Already processed on Linnworks${when} - row completed` };
    }
    if (!dryRun) db.markFailed(row.id, 'Not found in open orders (retries next sync)');
    return { ok: false, message: 'Not found in open orders (retries next sync)' };
  }
  // Orders are processed AT the location they actually sit at: the primary
  // warehouse's stock/history stay untouched and Linnworks reporting shows
  // where each order really shipped from.
  const foundAtFallback = !!fallbackId && foundAt.id === fallbackId && foundAt.id !== locationId;
  const processLocationId = foundAt.id;
  const locLabel = foundAt.id === locationId ? '' : (foundAtFallback ? 'DROPSHIP' : (foundAt.name || 'other location'));

  const { assignments, notes } = distributeSerials(order.items, row.serials);
  // serial tracking is retired: rows carry no serials, so serial-count
  // mismatch notes are meaningless noise unless serials actually exist
  const serialNotes = row.serials.length ? notes : [];

  if (dryRun) {
    const plan = [];
    if (row.tracking) plan.push(`set tracking ${row.tracking}`);
    if (row.notes) plan.push(`add order note "${row.notes.slice(0, 60)}"`);
    if (assignments.length) {
      plan.push(`attach ${row.serials.length} serial(s) to ${assignments.length} line(s)`);
    }
    plan.push(locLabel ? `process at ${locLabel} location, mark shipped` : 'process at warehouse, mark shipped');
    if (row.sub_sku && row.sub_qty > 0) {
      plan.push(`substitution: deduct ${row.sub_qty} × ${row.sub_sku} at the warehouse instead of ${row.sub_for || 'the listed item'}, note it on the order`);
    }
    const note = serialNotes.length ? ` [${serialNotes.join('; ')}]` : '';
    return { ok: true, dryRun: true, message: `DRY RUN, would: ${plan.join(', then ')}${note}` };
  }

  if (row.tracking) {
    await client.setTracking(order.orderId, order.shippingInfo, row.tracking);
  }
  if (row.notes) {
    await client.addOrderNote(order.orderId, row.notes);
  }
  // Substitutions leave the marketplace's order lines untouched (editing them
  // can break the despatch upload), so the audit trail lives in a note.
  // addOrderNote dedupes by text, so sync retries never double it up.
  if (row.sub_sku && row.sub_qty > 0) {
    await client.addOrderNote(
      order.orderId,
      `SUBSTITUTION: ${row.sub_note || `shipped ${row.sub_sku} ×${row.sub_qty} instead of ${row.sub_for || 'the listed item'}`}`
    );
  }
  if (assignments.length > 0) {
    await client.createSerials(assignments);
  }

  // Substitution reversals must know each listed line's PHYSICAL level
  // before despatch: Linnworks floors deductions at zero, so restoring the
  // full quantity when stock was already 0 would mint phantom units.
  let preLevels = null;
  if (row.sub_sku && row.sub_qty > 0 && processLocationId === locationId) {
    preLevels = {};
    for (const it of order.items) {
      if (it.isService || it.unlinked || !it.sku || !it.stockItemId) continue;
      // per-line substitution: only the replaced line's deduction is reversed
      if (row.sub_for && String(it.sku).trim() !== row.sub_for) continue;
      try { preLevels[it.sku] = await client.getLevelAt(it.stockItemId, locationId); }
      catch { preLevels[it.sku] = null; /* unknown: reverse the full qty as before */ }
    }
  }

  let proc = await client.processOrder(row.order_number, processLocationId);

  // Parked orders refuse to process. Unpark, note it on the row so it can be
  // reviewed later (visible in the Notes column / History / CSV), and retry.
  if (proc.processedState !== 'PROCESSED' && /parked/i.test(proc.message || '')) {
    await client.unparkOrders([order.orderId]);
    const marker = 'was parked';
    if (!(row.notes || '').includes(marker)) {
      db.updateRow(row.id, { notes: row.notes ? `${row.notes} | ${marker}` : marker });
    }
    proc = await client.processOrder(row.order_number, processLocationId);
    if (proc.processedState === 'PROCESSED') {
      db.markSynced(row.id);
      const subMsg = await applySubstitution(client, row, order, locationId, processLocationId, preLevels);
      return { ok: true, message: `Processed (was parked - unparked automatically)${subMsg}` };
    }
  }

  switch (proc.processedState) {
    case 'PROCESSED': {
      db.markSynced(row.id);
      const subMsg = await applySubstitution(client, row, order, locationId, processLocationId, preLevels);
      const note = serialNotes.length ? ` [${serialNotes.join('; ')}]` : '';
      return { ok: true, message: `Processed${foundAtFallback ? ' (dropship)' : (locLabel ? ` (at ${locLabel})` : '')}${subMsg}${note}` };
    }
    case 'NOT_FOUND':
      db.markFailed(row.id, 'Order not found at processing step (retries next sync)');
      return { ok: false, message: 'Not found at processing step (retries next sync)' };
    case 'SCAN_REQUIRED':
      db.markFailed(row.id, `Linnworks demands interactive scan: ${proc.message || 'SCAN_REQUIRED'}`);
      return { ok: false, message: `SCAN_REQUIRED: ${proc.message || 'check SKU serial settings in Linnworks'}` };
    default:
      db.markFailed(row.id, proc.message || proc.processedState);
      return { ok: false, message: `${proc.processedState}: ${proc.message || 'unknown error'}` };
  }
}

// "Shipped different item": after processing, correct the stock movement.
// Processing at the primary deducted the LISTED lines there - reverse that;
// processing anywhere else (dropship etc.) deducted nothing at the primary.
// Either way the substituted SKU is what left the shelf, so deduct it at the
// primary warehouse via the same UpdateStockLevelsBySKU delta path as WFS.
async function applySubstitution(client, row, order, primaryLocationId, processLocationId, preLevels) {
  if (!row.sub_sku || !(row.sub_qty > 0)) return '';
  try {
    if (processLocationId === primaryLocationId) {
      // Restore only what despatch actually deducted. Deduction floors at
      // zero, so a line whose pre-despatch level was L loses min(qty, L) -
      // reversing the full qty when L was 0 would mint phantom units.
      // With sub_for set only THAT line is reversed: the other lines really
      // did ship as listed, their deduction stands.
      const reversals = order.items
        .filter(it => !it.isService && !it.unlinked && it.sku)
        .filter(it => !row.sub_for || String(it.sku).trim() === row.sub_for)
        .map(it => {
          const pre = preLevels ? preLevels[it.sku] : null;
          const deducted = (pre === null || pre === undefined) ? it.quantity : Math.min(it.quantity, Math.max(0, pre));
          return { sku: it.sku, delta: deducted };
        })
        .filter(r => r.delta > 0);
      if (reversals.length) {
        await client.changeStockLevels(reversals, primaryLocationId, 'Capture Station substitution (listed item not shipped)');
      }
    }
    await client.changeStockLevels(
      [{ sku: row.sub_sku, delta: -row.sub_qty }],
      primaryLocationId,
      'Capture Station substitution (item actually shipped)'
    );
    return ` (substituted ${row.sub_sku} ×${row.sub_qty})`;
  } catch (e) {
    // the order IS processed; only the stock correction failed - say so loudly
    return ` (SUBSTITUTION STOCK ADJUST FAILED: ${e.message} - fix levels for ${row.sub_sku} by hand)`;
  }
}

function finish(summary) {
  const record = {
    at: new Date().toISOString(),
    synced: summary.synced,
    failed: summary.failed,
    total: summary.total,
    dryRun: summary.dryRun,
    trigger: summary.trigger,
    error: summary.error || null,
  };
  config.save({ lastSync: record });
  return { ...record, details: summary.details };
}

module.exports = { runSync, testConnection, isRunning, distributeSerials };
