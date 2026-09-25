'use strict';
// Ship with Walmart orchestration: quote every open Walmart order on the
// Capture page (rates + the recommended service), buy the label on click or
// in bulk, keep the files, print, void. Mirrors sync.js: plan -> (dry run or
// write) -> log. main.js owns the row state; this module reports back
// through hooks (applyTracking / onQuotes) instead of touching the window.
//
// Flow per row:  Walmart GET order (line numbers, ship-to, promised dates)
//             -> POST shipping-estimates (every service, priced)
//             -> pick by rule                       [quote, cached 2 h]
//             -> POST create label -> download PDF + PNG -> print
//             -> tracking onto the row (same path a scan takes)

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow } = require('electron');
const db = require('./db');
const config = require('./config');
const { WalmartClient } = require('./walmart');

const QUOTE_TTL_MS = 2 * 60 * 60 * 1000;
const ORDER_TTL_MS = 10 * 60 * 1000;
const BETWEEN_CALLS_MS = 300;

let hooks = {
  applyTracking: () => {}, // (row, tracking, carrier) -> updated row
  onQuotes: () => {}, // (snapshot) -> renderer refresh
  getWin: () => null,
  log: () => {},
};

function init(h) { hooks = { ...hooks, ...(h || {}) }; }

const quotes = new Map(); // rowId -> quote (see quoteRow)
const orders = new Map(); // po -> { at, order }
let clientCache = null; // { key, client }
let refreshing = false;
let bulkRunning = false;

/* ---------- config helpers ---------- */

function swwCfg(cfg) { return (cfg || config.load()).sww || {}; }

function isEnabled(cfg) {
  cfg = cfg || config.load();
  const s = swwCfg(cfg);
  return !cfg.captureOnly && !!s.enabled && !!String(s.clientId || '').trim() && !!String(s.clientSecret || '').trim();
}

function getClient(cfg) {
  const s = swwCfg(cfg);
  const key = `${s.clientId}|${s.clientSecret}|${s.sandbox ? 1 : 0}`;
  if (!clientCache || clientCache.key !== key) {
    clientCache = { key, client: new WalmartClient({ clientId: s.clientId, clientSecret: s.clientSecret, sandbox: !!s.sandbox }) };
  }
  return clientCache.client;
}

function labelsFolder() {
  const cfg = config.load();
  const base = cfg.csvFolder || path.join(app.getPath('documents'), 'Capture Station');
  return path.join(base, 'labels');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Walmart carrier short names -> the carrier names the app's tracking
// patterns use (rows carry 'UPS' / 'USPS' / 'FedEx')
function carrierLabel(shortName) {
  const s = String(shortName || '').toUpperCase();
  if (s.includes('FEDEX') || s === 'FDX') return 'FedEx';
  if (s.includes('USPS')) return 'USPS';
  if (s.includes('UPS')) return 'UPS';
  return String(shortName || '');
}

function money(cents) {
  return Number.isFinite(cents) ? `$${(cents / 100).toFixed(2)}` : '';
}

/* ---------- package ---------- */

// Weight + box for a row: per-SKU package profiles when every line has
// one (weights add up, the biggest box wins), else the default box.
function packageFor(cfg, row) {
  const s = swwCfg(cfg);
  const def = s.defaultPackage || {};
  const fallback = {
    type: def.type || 'CUSTOM_PACKAGE',
    weightOz: Number(def.weightOz) || 16,
    l: Number(def.l) || 10, w: Number(def.w) || 8, h: Number(def.h) || 4,
    source: 'default',
  };
  const items = Array.isArray(row.items) ? row.items.filter(i => i && i.sku) : [];
  if (!items.length) return fallback;
  let weightOz = 0;
  let l = 0, w = 0, h = 0;
  for (const it of items) {
    const p = db.getPackageProfile(it.sku);
    if (!p) return fallback;
    weightOz += (Number(p.weight_oz) || 0) * (Number(it.qty) || 1);
    l = Math.max(l, Number(p.l_in) || 0);
    w = Math.max(w, Number(p.w_in) || 0);
    h = Math.max(h, Number(p.h_in) || 0);
  }
  if (!(weightOz > 0) || !(l > 0) || !(w > 0) || !(h > 0)) return fallback;
  return { type: 'CUSTOM_PACKAGE', weightOz: Math.round(weightOz * 10) / 10, l, w, h, source: 'profile' };
}

function cleanPackage(pkg, fallback) {
  const num = (v, d) => { const n = Number(v); return n > 0 ? Math.round(n * 100) / 100 : d; };
  return {
    type: (pkg && pkg.type) || fallback.type || 'CUSTOM_PACKAGE',
    weightOz: num(pkg && pkg.weightOz, fallback.weightOz),
    l: num(pkg && pkg.l, fallback.l),
    w: num(pkg && pkg.w, fallback.w),
    h: num(pkg && pkg.h, fallback.h),
    source: pkg && pkg.source ? pkg.source : 'edited',
  };
}

function boxDimensions(pkg) {
  const out = { boxWeight: pkg.weightOz, boxWeightUnit: 'OZ' };
  if (pkg.type === 'CUSTOM_PACKAGE') {
    out.boxDimensionUnit = 'IN';
    out.boxLength = pkg.l;
    out.boxWidth = pkg.w;
    out.boxHeight = pkg.h;
  }
  return out;
}

function samePackage(a, b) {
  return !!a && !!b && a.type === b.type && a.weightOz === b.weightOz && a.l === b.l && a.w === b.w && a.h === b.h;
}

/* ---------- from address ---------- */

function fromAddress(cfg) {
  const a = swwCfg(cfg).fromAddress || {};
  const missing = ['contactName', 'addressLine1', 'city', 'state', 'postalCode', 'phone']
    .filter(k => !String(a[k] || '').trim());
  return { address: a, missing };
}

function fromForEstimate(a) {
  return {
    addressLines: [a.addressLine1, a.addressLine2].map(s => String(s || '').trim()).filter(Boolean),
    city: a.city, state: a.state, postalCode: String(a.postalCode || ''), countryCode: (a.country || 'US').toUpperCase(),
  };
}

function fromForLabel(a) {
  const out = {
    contactName: a.contactName, addressLine1: a.addressLine1, city: a.city, state: a.state,
    postalCode: String(a.postalCode || ''), country: (a.country || 'US').toUpperCase(), phone: a.phone,
  };
  if (String(a.companyName || '').trim()) out.companyName = a.companyName;
  if (String(a.addressLine2 || '').trim()) out.addressLine2 = a.addressLine2;
  if (String(a.email || '').trim()) out.email = a.email;
  return out;
}

/* ---------- rate choice ---------- */

// 'cheapest' | 'cheapest-on-time' | exact service name. Always falls back
// to the cheapest so a row is never left without a recommendation.
function pickRate(rates, rule) {
  if (!rates || !rates.length) return null;
  const byPrice = rates.slice().sort((a, b) => a.amount - b.amount);
  const r = String(rule || 'cheapest-on-time');
  if (r === 'cheapest') return byPrice[0];
  const onTime = byPrice.filter(x => x.onTime);
  if (r === 'cheapest-on-time') return onTime[0] || byPrice[0];
  return rates.find(x => x.name === r) || onTime[0] || byPrice[0];
}

/* ---------- quotes ---------- */

function rowEligible(row) {
  return !!row && row.channel === 'walmart' && !String(row.tracking || '').trim()
    && row.status !== 'synced' && !!String(row.order_number || '').trim();
}

async function getOrderCached(client, po, force) {
  const hit = orders.get(po);
  if (!force && hit && Date.now() - hit.at < ORDER_TTL_MS) return hit.order;
  const order = await client.getOrder(po);
  orders.set(po, { at: Date.now(), order });
  return order;
}

function publicQuote(q) {
  if (!q) return null;
  return {
    at: q.at, busy: !!q.busy, error: q.error || '',
    pkg: q.pkg, rates: q.rates || [], pick: q.pick || '', alert: q.alert || '',
    methodCode: q.methodCode || '', deliverBy: q.deliverBy || null,
    shipToName: q.shipToName || '', shipToCity: q.shipToCity || '', lines: q.lineCount || 0,
    stale: !!q.at && Date.now() - q.at > QUOTE_TTL_MS,
  };
}

function snapshotQuotes() {
  const out = {};
  for (const [id, q] of quotes) out[id] = publicQuote(q);
  return out;
}

function emitQuotes() {
  try { hooks.onQuotes(snapshotQuotes()); } catch { /* renderer gone */ }
}

// One row: Walmart order -> estimate -> pick. Errors land on the quote so
// the row can show them (and retry on click) instead of vanishing.
async function quoteRow(row, { force = false, pkg = null } = {}) {
  const cfg = config.load();
  if (!isEnabled(cfg) || !rowEligible(row)) { quotes.delete(row.id); return null; }
  const s = swwCfg(cfg);
  const prev = quotes.get(row.id);
  const wantPkg = pkg ? cleanPackage(pkg, packageFor(cfg, row)) : packageFor(cfg, row);
  if (!force && prev && !prev.error && Date.now() - prev.at < QUOTE_TTL_MS && samePackage(prev.pkg, wantPkg)) return prev;
  const q = { rowId: row.id, po: row.order_number, at: prev ? prev.at : 0, busy: true, pkg: wantPkg, rates: prev ? prev.rates : [], pick: prev ? prev.pick : '' };
  quotes.set(row.id, q);
  try {
    const client = getClient(cfg);
    const order = await getOrderCached(client, row.order_number, force);
    const openLines = order.lines.filter(l => !l.shipped && !l.cancelled);
    if (!openLines.length) throw new Error('Every line on this PO is already shipped or cancelled on Walmart.');
    const { address, missing } = fromAddress(cfg);
    if (missing.length) throw new Error(`Ship-from address incomplete (Settings > Ship with Walmart): ${missing.join(', ')}.`);
    const body = {
      purchaseOrderId: order.purchaseOrderId,
      packageType: wantPkg.type,
      boxDimensions: boxDimensions(wantPkg),
      boxItems: openLines.map(l => ({ lineNumber: l.lineNumber, sku: l.sku, quantity: l.qty })),
      fromAddress: fromForEstimate(address),
      toAddress: {
        addressLines: order.shipTo.addressLines, city: order.shipTo.city, state: order.shipTo.state,
        postalCode: order.shipTo.postalCode, countryCode: order.shipTo.countryCode,
      },
      includeServicesNotMeetingDeliveryPromise: true,
      addOns: !!s.signature,
    };
    if (Array.isArray(s.carriers) && s.carriers.length) body.carriers = s.carriers;
    if (order.estimatedShipDate) body.shipByDate = new Date(order.estimatedShipDate).toISOString();
    if (order.estimatedDeliveryDate) body.deliverByDate = new Date(order.estimatedDeliveryDate).toISOString();
    const { estimates, alert } = await client.estimates(body);
    if (!estimates.length) throw new Error(alert || 'Walmart returned no shipping services for this box.');
    const pick = pickRate(estimates, s.serviceRule);
    Object.assign(q, {
      at: Date.now(), busy: false, error: '', rates: estimates, pick: pick ? pick.name : '', alert,
      order, lines: openLines, lineCount: openLines.length,
      methodCode: order.methodCode, deliverBy: order.estimatedDeliveryDate,
      shipToName: order.shipTo.name, shipToCity: `${order.shipTo.city}, ${order.shipTo.state}`,
    });
  } catch (e) {
    Object.assign(q, { at: Date.now(), busy: false, error: e.message || String(e) });
    hooks.log(`SWW quote ${row.order_number}: ${q.error}`);
  }
  quotes.set(row.id, q);
  return q;
}

// Background pass after every order import: quote what is new or stale,
// newest first, one call at a time (Walmart throttles per key).
async function refreshQuotes({ force = false, ids = null } = {}) {
  const cfg = config.load();
  if (!isEnabled(cfg)) { if (quotes.size) { quotes.clear(); emitQuotes(); } return { quoted: 0 }; }
  if (refreshing) return { quoted: 0, busy: true };
  refreshing = true;
  let quoted = 0;
  try {
    const wanted = Array.isArray(ids) && ids.length ? new Set(ids.map(Number)) : null;
    const rows = db.activeRows().filter(r => rowEligible(r) && (!wanted || wanted.has(r.id)));
    // drop quotes for rows that left the queue or got tracking
    const live = new Set(rows.map(r => r.id));
    for (const id of [...quotes.keys()]) if (!live.has(id)) quotes.delete(id);
    for (const row of rows) {
      const prev = quotes.get(row.id);
      const fresh = prev && !prev.error && Date.now() - prev.at < QUOTE_TTL_MS && samePackage(prev.pkg, packageFor(cfg, row));
      if (fresh && !force) continue;
      await quoteRow(row, { force });
      quoted++;
      emitQuotes();
      await sleep(BETWEEN_CALLS_MS);
    }
  } finally {
    refreshing = false;
    emitQuotes();
  }
  return { quoted };
}

function dropQuote(rowId) { quotes.delete(Number(rowId)); }

/* ---------- buy ---------- */

async function saveLabelFiles(client, label) {
  const folder = labelsFolder();
  fs.mkdirSync(folder, { recursive: true });
  const stem = path.join(folder, `${label.purchaseOrderId}-${label.trackingNo}`.replace(/[^\w.-]+/g, '_'));
  const out = { pdf: '', png: '', error: '' };
  for (const fmt of ['pdf', 'png']) {
    try {
      const buf = await client.downloadLabel(label.carrier, label.trackingNo, fmt);
      const file = `${stem}.${fmt}`;
      fs.writeFileSync(file, buf);
      out[fmt] = file;
    } catch (e) {
      out.error = out.error || e.message;
    }
  }
  return out;
}

// One label for one row. service = estimate name (defaults to the pick),
// pkg = edited box (defaults to the quote's). dryRun logs and buys nothing.
async function buyLabel({ rowId, service, pkg, signature, dryRun } = {}) {
  const cfg = config.load();
  const s = swwCfg(cfg);
  if (!isEnabled(cfg)) return { ok: false, error: 'Ship with Walmart is off (Settings).' };
  const row = db.getRow(Number(rowId));
  if (!row) return { ok: false, error: 'Row not found.' };
  if (row.channel !== 'walmart') return { ok: false, error: 'Only Walmart orders can use Ship with Walmart.' };
  if (String(row.tracking || '').trim()) return { ok: false, error: 'This order already has tracking — void the label first to re-buy.' };
  if (row.status === 'synced') return { ok: false, error: 'Already processed.' };
  const dry = dryRun === undefined ? !!s.dryRun : !!dryRun;
  const { address, missing } = fromAddress(cfg);
  if (missing.length) return { ok: false, error: `Ship-from address incomplete: ${missing.join(', ')} (Settings > Ship with Walmart).` };

  let q = quotes.get(row.id);
  const wantPkg = pkg ? cleanPackage(pkg, packageFor(cfg, row)) : (q && q.pkg) || packageFor(cfg, row);
  if (!q || q.error || !q.rates.length || !samePackage(q.pkg, wantPkg) || Date.now() - q.at > QUOTE_TTL_MS) {
    q = await quoteRow(row, { force: true, pkg: wantPkg });
    emitQuotes();
  }
  if (!q || q.error) return { ok: false, error: (q && q.error) || 'Could not quote this order.' };
  const rate = (service && q.rates.find(r => r.name === service)) || q.rates.find(r => r.name === q.pick) || pickRate(q.rates, s.serviceRule);
  if (!rate) return { ok: false, error: 'No shipping service available for this order.' };
  const wantSig = signature === undefined ? !!s.signature : !!signature;
  const sigRate = wantSig ? (rate.addOns || []).find(a => a.name === 'SIGNATURE') : null;
  const costCents = Math.round((rate.amount + (sigRate ? sigRate.amount : 0)) * 100);

  const body = {
    purchaseOrderId: q.order.purchaseOrderId,
    packageType: q.pkg.type,
    boxDimensions: boxDimensions(q.pkg),
    boxItems: q.lines.map(l => ({ lineNumber: l.lineNumber, sku: l.sku, quantity: l.qty })),
    fromAddress: fromForLabel(address),
    carrierName: rate.carrier,
    carrierServiceType: rate.name,
    shipOnDate: db.localDay(),
  };
  if (wantSig) body.addOns = ['SIGNATURE'];

  const plan = {
    po: row.order_number, carrier: rate.carrier, service: rate.name, serviceName: rate.displayName,
    cost: money(costCents), costCents, pkg: q.pkg, signature: wantSig, deliveryDate: rate.deliveryDate,
  };
  if (dry) {
    hooks.log(`SWW dry run ${row.order_number}: would buy ${rate.displayName} for ${plan.cost}`);
    return { ok: true, dryRun: true, plan, message: `Dry run: would buy ${rate.displayName} for ${plan.cost}` };
  }

  const client = getClient(cfg);
  let label;
  try {
    label = await client.createLabel(body);
  } catch (e) {
    hooks.log(`SWW buy ${row.order_number} failed: ${e.message}`);
    return { ok: false, error: e.message, plan };
  }
  const files = await saveLabelFiles(client, label);
  const rec = db.insertLabel({
    rowId: row.id, po: row.order_number, carrier: label.carrier, service: rate.name,
    serviceName: label.service || rate.displayName, tracking: label.trackingNo, trackingUrl: label.trackingUrl,
    costCents, pkg: q.pkg, filePdf: files.pdf, filePng: files.png, status: 'bought',
  });
  if (files.error) db.setLabelStatus(rec.id, 'bought', `label file: ${files.error}`);
  // tracking onto the row through main.js: same guards, CSV mirror, undo
  const carrier = carrierLabel(label.carrier);
  let updated = null;
  try { updated = hooks.applyTracking(row, label.trackingNo, carrier); } catch (e) { hooks.log(`SWW tracking apply ${row.order_number}: ${e.message}`); }
  quotes.delete(row.id);
  orders.delete(row.order_number);
  hooks.log(`SWW bought ${row.order_number}: ${label.carrier} ${rate.displayName} ${label.trackingNo} ${plan.cost}`);

  let printed = null;
  if (s.autoPrint) printed = await printLabel(rec, cfg);

  let shipNote = '';
  if (s.markShippedOnLabel) {
    try {
      await client.shipOrder(q.order.purchaseOrderId, {
        lines: q.lines, carrier: carrier === 'FedEx' ? 'FedEx' : carrier, trackingNumber: label.trackingNo,
        trackingUrl: label.trackingUrl, methodCode: q.order.methodCode || 'Standard',
      });
      shipNote = 'marked shipped on Walmart';
    } catch (e) {
      shipNote = `Walmart ship update failed: ${e.message}`;
      hooks.log(`SWW ship update ${row.order_number}: ${e.message}`);
    }
  }
  const printMsg = printed ? (printed.ok ? 'printed' : `print failed: ${printed.error}`) : '';
  return {
    ok: true, plan, row: updated, label: db.getLabel(rec.id), printed, shipNote,
    message: [`${label.carrier} ${rate.displayName} ${plan.cost}`, printMsg, shipNote].filter(Boolean).join(' · '),
  };
}

// Sequential bulk buy over the chosen rows; each result carries the row so
// the dialog can show it live. choices: { rowId: { service, signature, pkg } }
async function buyBulk({ ids, choices = {}, dryRun, onProgress = () => {} } = {}) {
  if (bulkRunning) return { ok: false, error: 'A bulk label run is already going.' };
  bulkRunning = true;
  const results = [];
  try {
    const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
    let n = 0;
    for (const rowId of list) {
      n++;
      const row = db.getRow(rowId);
      const po = row ? row.order_number : String(rowId);
      onProgress({ current: n, total: list.length, po, phase: 'buying' });
      const c = choices[rowId] || {};
      let res = await buyLabel({ rowId, service: c.service, signature: c.signature, pkg: c.pkg, dryRun });
      if (!res.ok && /rate-limiting/i.test(res.error || '')) {
        await sleep(3000);
        res = await buyLabel({ rowId, service: c.service, signature: c.signature, pkg: c.pkg, dryRun });
      }
      const entry = {
        rowId, po, ok: !!res.ok, dryRun: !!res.dryRun, message: res.ok ? res.message : (res.error || 'failed'),
        cost: res.plan ? res.plan.cost : '', tracking: res.label ? res.label.tracking : '',
        printed: res.printed ? !!res.printed.ok : null,
      };
      results.push(entry);
      onProgress({ current: n, total: list.length, po, phase: 'done', result: entry });
      await sleep(BETWEEN_CALLS_MS);
    }
  } finally {
    bulkRunning = false;
  }
  const bought = results.filter(r => r.ok && !r.dryRun).length;
  const failed = results.filter(r => !r.ok).length;
  const totalCents = results.filter(r => r.ok).reduce((a, r) => a + (Number(String(r.cost).replace(/[^0-9.]/g, '')) * 100 || 0), 0);
  return { ok: true, results, bought, failed, total: results.length, totalCost: money(Math.round(totalCents)), dryRun: results.some(r => r.dryRun) };
}

function isBulkRunning() { return bulkRunning; }

/* ---------- void / reprint ---------- */

async function voidLabel({ rowId } = {}) {
  const cfg = config.load();
  if (!isEnabled(cfg)) return { ok: false, error: 'Ship with Walmart is off (Settings).' };
  const row = db.getRow(Number(rowId));
  if (!row) return { ok: false, error: 'Row not found.' };
  if (row.status === 'synced') return { ok: false, error: 'Already processed — the order is marked shipped, Walmart no longer voids the label.' };
  const label = db.labelForRow(row.id);
  if (!label) return { ok: false, error: 'No Ship with Walmart label on this row.' };
  try {
    await getClient(cfg).discardLabel(label.carrier, label.tracking);
  } catch (e) {
    hooks.log(`SWW void ${row.order_number}: ${e.message}`);
    return { ok: false, error: e.message };
  }
  db.setLabelStatus(label.id, 'voided', '');
  let updated = null;
  if (String(row.tracking || '').trim() === label.tracking) {
    try { updated = hooks.applyTracking(row, '', ''); } catch { /* row stays */ }
  }
  hooks.log(`SWW voided ${row.order_number}: ${label.tracking}`);
  return { ok: true, row: updated, message: `Label voided — ${label.tracking}` };
}

async function reprint({ rowId, labelId } = {}) {
  const label = labelId ? db.getLabel(Number(labelId)) : db.labelForRow(Number(rowId));
  if (!label) return { ok: false, error: 'No label to print.' };
  if (label.status === 'voided') return { ok: false, error: 'That label was voided.' };
  const cfg = config.load();
  // files missing (moved folder / other desktop): fetch them again, no re-buy
  if (!(label.file_pdf && fs.existsSync(label.file_pdf)) && !(label.file_png && fs.existsSync(label.file_png))) {
    if (!isEnabled(cfg)) return { ok: false, error: 'Label file is missing and Ship with Walmart is off.' };
    const files = await saveLabelFiles(getClient(cfg), { purchaseOrderId: label.po, trackingNo: label.tracking, carrier: label.carrier });
    if (!files.pdf && !files.png) return { ok: false, error: files.error || 'Could not download the label again.' };
    db.setLabelFiles(label.id, files.pdf, files.png);
    return printLabel(db.getLabel(label.id), cfg);
  }
  return printLabel(label, cfg);
}

/* ---------- printing ---------- */

// SumatraPDF when configured (true silent PDF print); otherwise the PNG in a
// hidden window at 4x6. Both are fire-and-forget from the packer's view.
async function printLabel(label, cfg) {
  cfg = cfg || config.load();
  const s = swwCfg(cfg);
  const printer = String(s.printer || '').trim();
  let res;
  if (s.sumatraPath && fs.existsSync(s.sumatraPath) && label.file_pdf && fs.existsSync(label.file_pdf)) {
    res = printViaSumatra(s.sumatraPath, printer, label.file_pdf);
  } else if (label.file_png && fs.existsSync(label.file_png)) {
    res = await printPng(label.file_png, printer);
  } else if (label.file_pdf && fs.existsSync(label.file_pdf)) {
    res = { ok: false, error: 'Only the PDF label is on disk — set SumatraPDF in Settings to print PDFs silently.' };
  } else {
    res = { ok: false, error: 'No label file on disk.' };
  }
  if (res.ok) db.setLabelStatus(label.id, 'printed', '');
  else { db.setLabelStatus(label.id, label.status === 'printed' ? 'printed' : 'bought', `print: ${res.error}`); hooks.log(`SWW print ${label.po}: ${res.error}`); }
  return res;
}

function printViaSumatra(exe, printer, file) {
  try {
    const args = printer ? ['-print-to', printer] : ['-print-to-default'];
    args.push('-silent', '-exit-when-done', file);
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => { /* reported through the next reprint */ });
    child.unref();
    return { ok: true, via: 'sumatra' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function printPng(file, printer) {
  return new Promise((resolve) => {
    const html = path.join(path.dirname(file), `${path.basename(file, '.png')}.print.html`);
    try {
      fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><title>label</title>
<style>@page{size:4in 6in;margin:0}html,body{margin:0;padding:0;background:#fff}img{width:4in;height:6in;display:block;object-fit:contain}</style>
</head><body><img src="${path.basename(file)}" alt=""></body></html>`, 'utf8');
    } catch (e) {
      resolve({ ok: false, error: e.message });
      return;
    }
    let done = false;
    const finish = (r) => { if (done) return; done = true; try { w.destroy(); } catch { /* gone */ } resolve(r); };
    const w = new BrowserWindow({ show: false, width: 420, height: 640, webPreferences: { sandbox: true, contextIsolation: true } });
    const timer = setTimeout(() => finish({ ok: false, error: 'print timed out' }), 45000);
    w.webContents.once('did-finish-load', () => {
      const opts = { silent: true, printBackground: true, margins: { marginType: 'none' }, pageSize: { width: 101600, height: 152400 } };
      if (printer) opts.deviceName = printer;
      w.webContents.print(opts, (ok, reason) => {
        clearTimeout(timer);
        finish(ok ? { ok: true, via: 'window' } : { ok: false, error: reason || 'print failed' });
      });
    });
    w.webContents.once('did-fail-load', (_e, _c, desc) => { clearTimeout(timer); finish({ ok: false, error: desc || 'label page failed to load' }); });
    w.loadFile(html).catch(e => { clearTimeout(timer); finish({ ok: false, error: e.message }); });
  });
}

async function listPrinters() {
  const win = hooks.getWin();
  if (!win || win.isDestroyed()) return [];
  try {
    const list = await win.webContents.getPrintersAsync();
    return list.map(p => ({ name: p.name, isDefault: !!p.isDefault, description: p.description || '' }));
  } catch { return []; }
}

/* ---------- state for the renderer ---------- */

function snapshot(cfg, rows) {
  cfg = cfg || config.load();
  const s = swwCfg(cfg);
  const enabled = isEnabled(cfg);
  const ids = (rows || []).map(r => r.id);
  return {
    enabled,
    configured: !!String(s.clientId || '').trim(),
    dryRun: !!s.dryRun,
    sandbox: !!s.sandbox,
    autoPrint: s.autoPrint !== false,
    signature: !!s.signature,
    serviceRule: s.serviceRule || 'cheapest-on-time',
    quoting: refreshing,
    bulkRunning,
    quotes: enabled ? snapshotQuotes() : {},
    labels: enabled ? db.labelsForRows(ids) : {},
  };
}

async function testConnection(creds) {
  const cfg = config.load();
  const s = { ...swwCfg(cfg), ...(creds || {}) };
  const client = new WalmartClient({ clientId: s.clientId, clientSecret: s.clientSecret, sandbox: !!s.sandbox });
  const res = await client.testConnection();
  return { ok: true, carriers: res.carriers, sandbox: res.sandbox };
}

function resetClient() { clientCache = null; orders.clear(); }

module.exports = {
  init, isEnabled, refreshQuotes, quoteRow, dropQuote, buyLabel, buyBulk, isBulkRunning, voidLabel, reprint,
  printLabel, listPrinters, snapshot, testConnection, resetClient, packageFor, pickRate, carrierLabel, labelsFolder,
};
