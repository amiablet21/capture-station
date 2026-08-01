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

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      onProgress({ current: i + 1, total: rows.length, message: `Order ${row.order_number}` });
      try {
        const result = await syncRow(client, row, locationId, dryRun);
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

async function syncRow(client, row, locationId, dryRun) {
  let order = await client.findOpenOrder(row.order_number, locationId);
  let foundAtFallback = false;
  // Dropship orders live at the fallback location (stock routing put them
  // there). They are processed AT that location: the primary warehouse's
  // stock and history stay untouched, and Linnworks reporting shows which
  // orders were dropshipped.
  const fallbackId = (config.load().stockRouting || {}).fallbackLocationId;
  if (!order && fallbackId && fallbackId !== locationId) {
    order = await client.findOpenOrder(row.order_number, fallbackId);
    if (order) foundAtFallback = true;
  }
  if (!order) {
    // Order may not have downloaded into Linnworks yet, or is already processed.
    if (!dryRun) db.markFailed(row.id, 'Not found in open orders (retries next sync)');
    return { ok: false, message: 'Not found in open orders (retries next sync)' };
  }
  const processLocationId = foundAtFallback ? fallbackId : locationId;

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
    plan.push(foundAtFallback ? 'process at DROPSHIP location, mark shipped' : 'process at warehouse, mark shipped');
    const note = serialNotes.length ? ` [${serialNotes.join('; ')}]` : '';
    return { ok: true, dryRun: true, message: `DRY RUN, would: ${plan.join(', then ')}${note}` };
  }

  if (row.tracking) {
    await client.setTracking(order.orderId, order.shippingInfo, row.tracking);
  }
  if (row.notes) {
    await client.addOrderNote(order.orderId, row.notes);
  }
  if (assignments.length > 0) {
    await client.createSerials(assignments);
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
      return { ok: true, message: 'Processed (was parked - unparked automatically)' };
    }
  }

  switch (proc.processedState) {
    case 'PROCESSED': {
      db.markSynced(row.id);
      const note = serialNotes.length ? ` [${serialNotes.join('; ')}]` : '';
      return { ok: true, message: `Processed${foundAtFallback ? ' (dropship)' : ''}${note}` };
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
