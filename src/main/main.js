'use strict';
const { app, BrowserWindow, Menu, ipcMain, clipboard, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const config = require('./config');
const db = require('./db');
const { runSync, testConnection, isRunning } = require('./sync');
const { runRouting } = require('./router');
const { LinnworksClient } = require('./linnworks');

let win = null;
let clipboardTimer = null;
let lastClipboardText = null; // null = not primed yet; prime with current content on start
let currentRowId = null;
const undoStack = []; // { type: 'createRow'|'setTracking'|'addSerial', rowId, prev? }
const ignoredLog = []; // debug ring buffer of non-matching clipboard text

// E2E and smoke runs are throwaway test boots that may coexist with a
// normal instance: isolated userData, no single-instance lock.
const IS_TEST_RUN = process.env.CAPTURE_E2E === '1' || process.env.CAPTURE_SMOKE === '1';

if (process.env.CAPTURE_E2E === '1') {
  // keep compositing while the window is occluded so capturePage works in tests
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

if (!IS_TEST_RUN) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    });
  }
}

/* ---------- state ---------- */

function buildState() {
  const cfg = config.load();
  const current = currentRowId ? db.getRow(currentRowId) : null;
  if (!current) currentRowId = null;
  return {
    // Sync mode: processed rows leave the active list (see History); the list
    // also carries over unpushed rows from previous days so nothing is missed.
    // Capture-only mode: plain view of today's captures, as before.
    rows: cfg.captureOnly ? db.todayRows() : db.activeRows(),
    todayCount: db.todayRows().length,
    todayProcessed: db.todayRows().filter(r => r.status === 'synced').length,
    currentRowId,
    expecting: current && !current.tracking ? 'tracking' : null,
    canUndo: undoStack.length > 0,
    lastSync: cfg.lastSync,
    dryRun: !!cfg.dryRun,
    syncRunning: isRunning(),
    captureOnly: !!cfg.captureOnly,
    pages: cfg.pages,
    csv: lastCsv,
  };
}

function pushState() {
  writeDailyCsv();
  if (win && !win.isDestroyed()) win.webContents.send('state:changed', buildState());
}

/* ---------- continuous daily CSV mirror ---------- */

let lastCsv = null; // { path, at, error }

function csvFolder() {
  return config.load().csvFolder || path.join(app.getPath('documents'), 'Capture Station');
}

function buildCsvContent(rows) {
  const header = 'time,channel,order_number,tracking,carrier,notes,status,fail_reason,synced_at';
  const lines = rows.slice().reverse().map(r => [
    r.created_at, r.channel, r.order_number, r.tracking, r.carrier,
    r.notes || '', r.status, r.fail_reason, r.synced_at,
  ].map(csvEscape).join(','));
  return [header, ...lines].join('\r\n');
}

function writeDailyCsv() {
  const folder = csvFolder();
  const file = path.join(folder, `capture-${db.localDay()}.csv`);
  try {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(file, buildCsvContent(db.todayRows()), 'utf8');
    lastCsv = { path: file, at: new Date().toISOString(), error: null };
  } catch (e) {
    // most common cause: the file is open and locked in Excel
    lastCsv = { path: file, at: lastCsv ? lastCsv.at : null, error: e.code === 'EBUSY' ? 'CSV locked, close it in Excel' : e.message };
  }
}

// Mirror the WFS shipment log to a CSV beside the daily capture CSVs.
function writeWfsCsv() {
  try {
    const folder = csvFolder();
    fs.mkdirSync(folder, { recursive: true });
    const lines = ['date,note,sku,gtin,qty'];
    for (const s of db.listWfsShipments(1000).slice().reverse()) {
      for (const it of s.items) {
        lines.push([s.created_at, s.note, it.sku, it.gtin, it.qty].map(csvEscape).join(','));
      }
    }
    fs.writeFileSync(path.join(folder, 'wfs-shipments.csv'), lines.join('\r\n'), 'utf8');
  } catch { /* CSV locked in Excel: the DB still has the log */ }
}

/* ---------- open-orders cache (Stock page per-SKU order list) ---------- */

// GetOpenOrders pages through the whole order book, so clicking several SKUs
// in a row reuses one fetch for a minute instead of re-paging every time.
// The fetch covers EVERY stock location (stock routing parks orders at the
// dropship location, and the grid's "In orders" number spans all locations),
// deduped by orderId and tagged with the location they sit at.
const OPEN_ORDERS_TTL_MS = 60 * 1000;
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
let openOrdersCache = { at: 0, data: null, promise: null };

async function getOpenOrdersCached(cfg) {
  if (openOrdersCache.data && Date.now() - openOrdersCache.at < OPEN_ORDERS_TTL_MS) {
    return openOrdersCache.data;
  }
  if (openOrdersCache.promise) return openOrdersCache.promise; // fetch already in flight
  openOrdersCache.promise = (async () => {
    try {
      const client = new LinnworksClient(cfg.linnworks);
      let locations = [];
      try { locations = await client.getLocations(); } catch { /* fall back to Default only */ }
      // real locations first (their names win the dedupe), zero-GUID Default last
      const targets = [...locations, { id: ZERO_GUID, name: 'Default' }];
      const byOrderId = new Map();
      for (const loc of targets) {
        const orders = await client.listOpenOrders(loc.id);
        for (const o of orders) {
          if (!byOrderId.has(o.orderId)) {
            byOrderId.set(o.orderId, { ...o, locationId: loc.id, locationName: loc.name });
          }
        }
      }
      const data = [...byOrderId.values()];
      openOrdersCache = { at: Date.now(), data, promise: null };
      return data;
    } catch (e) {
      openOrdersCache.promise = null; // failed fetches are not cached
      throw e;
    }
  })();
  return openOrdersCache.promise;
}

/* ---------- product image add (download in-app: progress, cancel) ---------- */

let imgAbort = null; // AbortController for the in-flight image download

function sendImgProgress(p) {
  if (win && !win.isDestroyed()) win.webContents.send('image:progress', p);
}

// Magic-byte sniff so a 200 OK that is actually an HTML page never gets
// attached to a stock item as its "image".
function imageKind(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
  if (buf.slice(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

// Download an image URL ourselves (instead of letting Linnworks fetch it):
// gives real progress, a cancel button, size/type validation, and keeps the
// raw URL out of the UI. Uploads via the verified Uploader flow afterwards.
async function addImageFromUrl(cfg, { sku, stockItemId, url }) {
  let domain = '';
  try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch { /* fetch will reject it */ }
  imgAbort = new AbortController();
  const userSignal = imgAbort.signal;
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { Accept: 'image/*,*/*;q=0.8' },
      signal: AbortSignal.any([userSignal, AbortSignal.timeout(30000)]),
    });
    if (!res.ok) return { ok: false, error: `Download failed (HTTP ${res.status})` };
    const total = Number(res.headers.get('content-length')) || 0;
    const ctype = String(res.headers.get('content-type') || '').toLowerCase();
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    let lastTick = 0;
    sendImgProgress({ phase: 'downloading', source: domain, received: 0, total });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      received += value.length;
      if (received > 8 * 1024 * 1024) {
        imgAbort.abort();
        return { ok: false, error: 'Image is larger than 8 MB - use a smaller one.' };
      }
      const now = Date.now();
      if (now - lastTick > 120) {
        lastTick = now;
        sendImgProgress({ phase: 'downloading', source: domain, received, total });
      }
    }
    const buf = Buffer.concat(chunks);
    const kind = imageKind(buf) || (ctype.startsWith('image/') ? ctype.split(';')[0].slice(6) : null);
    if (!kind) return { ok: false, error: 'That link is not an image.' };
    sendImgProgress({ phase: 'uploading', source: domain, received: buf.length, total: buf.length });
    const client = new LinnworksClient(cfg.linnworks);
    const ext = kind === 'jpeg' ? 'jpg' : kind;
    const mime = `image/${kind}`;
    await client.addItemImage(stockItemId, buf, `${sku || 'item'}.${ext}`, mime);
    return { ok: true, bytes: buf.length, domain, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  } catch (e) {
    if (userSignal.aborted) return { ok: false, canceled: true };
    if (e.name === 'TimeoutError' || (e.cause && e.cause.name === 'TimeoutError')) {
      return { ok: false, error: 'Download timed out after 30s.' };
    }
    return { ok: false, error: e.message };
  } finally {
    imgAbort = null;
  }
}

/* ---------- receiving sessions ---------- */

// A receiving session is the list of goods checked in at the warehouse door.
// Finishing writes a JSON audit file locally and (optionally) notifies the
// owner via a Make.com webhook; POs are raised manually in Linnworks from that.

function receivingFolder() {
  const cfg = config.load();
  return (cfg.receiving && cfg.receiving.folder)
    || path.join(app.getPath('documents'), 'Capture Station', 'receiving');
}

// POST the finished session to the Make.com webhook: 10s timeout, one retry.
async function postReceivingWebhook(url, session) {
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return { ok: true };
      lastError = `webhook responded ${res.status}`;
    } catch (e) {
      lastError = e.name === 'TimeoutError' ? 'webhook timed out after 10s' : e.message;
    }
  }
  return { ok: false, error: lastError };
}

async function finishReceiving(payload) {
  const lines = ((payload && payload.lines) || [])
    .map(l => ({
      sku: String(l.sku || '').trim().slice(0, 100),
      title: String(l.title || '').trim().slice(0, 300),
      qty: Number(l.qty),
    }))
    .filter(l => l.sku && Number.isInteger(l.qty) && l.qty > 0);
  if (!lines.length) return { ok: false, error: 'Add at least one line with a SKU and quantity.' };

  const now = new Date();
  const session = {
    id: `rcv-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    station: os.hostname(),
    finishedAt: now.toISOString(),
    // shipment-level extras from the worksheet header/notes (empty when unused)
    reference: String((payload && payload.reference) || '').trim().slice(0, 200),
    trackingNumber: String((payload && payload.trackingNumber) || '').trim().slice(0, 100),
    notes: String((payload && payload.notes) || '').trim().slice(0, 1000),
    lines,
    status: 'pending',
  };
  const folder = receivingFolder();
  // ISO timestamp in the filename, with ':' swapped out for Windows
  const file = path.join(folder, `receiving-session-${now.toISOString().replace(/:/g, '-')}.json`);
  try {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf8');
  } catch (e) {
    return { ok: false, error: `Could not save the session file: ${e.message}` };
  }

  const url = ((config.load().receiving || {}).webhookUrl || '').trim();
  const webhook = url ? await postReceivingWebhook(url, session) : null; // null = not configured
  if (webhook) {
    // audit the webhook outcome into the session file for the history list
    try {
      session.webhook = { ...webhook, at: new Date().toISOString() };
      fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf8');
    } catch { /* file already saved; webhook result still returned live */ }
  }
  return { ok: true, id: session.id, path: file, lines: lines.length, webhook };
}

// Past receipts: parse every session file in the folder, newest first.
// Malformed or unreadable files are skipped rather than breaking the list.
function listReceivingSessions(limit = 200) {
  const folder = receivingFolder();
  let names = [];
  try {
    names = fs.readdirSync(folder).filter(f => /^receiving-session-.+\.json$/i.test(f));
  } catch {
    return { ok: true, folder, sessions: [] }; // folder missing = nothing received yet
  }
  const sessions = [];
  for (const name of names) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
      if (!s || typeof s !== 'object') continue;
      sessions.push({
        file: name,
        id: String(s.id || ''),
        station: String(s.station || ''),
        finishedAt: String(s.finishedAt || ''),
        reference: String(s.reference || ''),
        trackingNumber: String(s.trackingNumber || ''),
        notes: String(s.notes || ''),
        status: String(s.status || 'pending'),
        webhook: s.webhook && typeof s.webhook === 'object'
          ? { ok: !!s.webhook.ok, error: String(s.webhook.error || '') }
          : null,
        lines: (Array.isArray(s.lines) ? s.lines : []).map(l => ({
          sku: String((l && l.sku) || ''),
          title: String((l && l.title) || ''),
          qty: Number(l && l.qty) || 0,
        })),
      });
    } catch { /* malformed JSON: skip this file */ }
  }
  sessions.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
  return { ok: true, folder, sessions: sessions.slice(0, limit) };
}

/* ---------- clipboard watcher ---------- */

function matchOrder(text) {
  const cfg = config.load();
  for (const p of config.compile(cfg.orderPatterns)) {
    if (p.re.test(text)) return p.channel;
  }
  return null;
}

function startClipboardWatcher() {
  const poll = () => {
    let text;
    try { text = clipboard.readText(); } catch { return; }
    if (lastClipboardText === null) { lastClipboardText = text; return; } // ignore whatever was copied before launch
    if (text === lastClipboardText) return;
    lastClipboardText = text;
    const trimmed = (text || '').trim();
    if (!trimmed || trimmed.length > 200) return;
    const channel = matchOrder(trimmed);
    if (channel) {
      ingestOrder(channel, trimmed);
      return;
    }
    // Copied tracking fills the open row, so tracking can be copied from the
    // marketplace page just like the order number (no scanner needed).
    if (currentRowId) {
      if (classifyTracking(trimmed)) {
        const res = handleScan({ text: trimmed, force: false });
        if (res.ok && win && !win.isDestroyed()) {
          win.webContents.send('tracking:detected', { row: res.row, carrier: res.carrier });
        }
        return;
      }
      const clipped = detectClippedTracking(trimmed);
      if (clipped) {
        if (win && !win.isDestroyed()) {
          win.webContents.send('tracking:clipped', {
            message: `POSSIBLE COPY MISTAKE: ${trimmed} ${clipped}. Not saved - copy it again.`,
          });
        }
        return;
      }
    }
    ignoredLog.push({ at: new Date().toISOString(), text: trimmed.slice(0, 120) });
    if (ignoredLog.length > 200) ignoredLog.shift();
    if (win && !win.isDestroyed()) win.webContents.send('clipboard:ignored', { text: trimmed.slice(0, 120) });
  };
  clipboardTimer = setInterval(poll, config.load().clipboardPollMs || 300);
}

function ingestOrder(channel, orderNumber, { force = false } = {}) {
  const existing = db.findByOrderNumber(orderNumber);
  if (existing) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('order:duplicate', { orderNumber, existing });
    }
    return;
  }
  if (!force) {
    const similar = db.findSimilarOrder(orderNumber);
    if (similar) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('order:similar', { channel, orderNumber, similar });
      }
      return;
    }
  }
  const row = db.createRow({ channel, orderNumber });
  currentRowId = row.id;
  undoStack.push({ type: 'createRow', rowId: row.id });
  if (win && !win.isDestroyed()) win.webContents.send('order:detected', { row });
  pushState();
}

/* ---------- scan classification ---------- */

function classifyTracking(text) {
  const cfg = config.load();
  for (const p of config.compile(cfg.trackingPatterns)) {
    if (p.re.test(text)) return p.carrier;
  }
  return null;
}

// A value one character away from a valid tracking format is almost certainly
// a clipped copy/scan (e.g. "ZF98..." = UPS missing its leading 1), not some
// unknown carrier. These are rejected outright instead of offering Save anyway.
function detectClippedTracking(value) {
  if (value.length < 10 || classifyTracking(value)) return null;
  const front1 = classifyTracking('1' + value);
  if (front1) return `looks like ${front1} tracking missing its first character`;
  const front9 = classifyTracking('9' + value);
  if (front9) return `looks like ${front9} tracking missing its first character`;
  if (/^1Z[A-HJ-NP-Z0-9]{15}$/i.test(value)) return 'looks like UPS tracking missing its last character';
  return null;
}

function handleScan({ text, force }) {
  const value = String(text || '').trim();
  if (!value) return { ok: false, error: 'Empty scan.' };
  if (!currentRowId) {
    // No row waiting for tracking: an order number typed/pasted into the scan
    // box opens a new order, same as copying it from the marketplace page.
    // (With a row open, tracking wins - a 15-digit PO and FedEx tracking are
    // format-identical, and the open row means a label scan is expected.)
    const channel = matchOrder(value);
    if (channel) {
      const existing = db.findByOrderNumber(value);
      if (existing) {
        return { ok: false, clipped: true, error: `DUPLICATE ORDER: ${value} was already captured (${existing.status}). Not added.` };
      }
      const similar = db.findSimilarOrder(value);
      if (similar) {
        return { ok: false, clipped: true, error: `POSSIBLE COPY MISTAKE: ${value} looks like a piece of ${similar.order_number}. Not added - check the number.` };
      }
      ingestOrder(channel, value, { force: true });
      return { ok: true, kind: 'order' };
    }
    return { ok: false, error: 'No open order. Copy the order number from the marketplace page first.' };
  }
  const row = db.getRow(currentRowId);
  if (!row) { currentRowId = null; return { ok: false, error: 'Open order disappeared. Copy the order number again.' }; }

  const carrier = classifyTracking(value);
  if (!carrier && !force) {
    const clipped = detectClippedTracking(value);
    if (clipped) {
      return {
        ok: false, clipped: true,
        error: `POSSIBLE COPY MISTAKE: ${value} ${clipped}. Not saved - copy or scan it again.`,
      };
    }
    return {
      ok: false, needsConfirm: true, kind: 'tracking', value,
      reason: 'That does not match any known tracking format (UPS 1Z…, USPS, FedEx). Save it as tracking anyway?',
    };
  }
  const updated = db.setTracking(row.id, value, carrier || '');
  undoStack.push({ type: 'setTracking', rowId: row.id, prev: { tracking: row.tracking, carrier: row.carrier } });
  currentRowId = null; // order complete: copy the next PO# to continue
  pushState();
  return { ok: true, kind: 'tracking', carrier: carrier || '', row: updated };
}

function handleUndo() {
  const action = undoStack.pop();
  if (!action) return { ok: false, error: 'Nothing to undo.' };
  const row = db.getRow(action.rowId);
  let message = '';
  switch (action.type) {
    case 'createRow':
      if (row) db.deleteRow(row.id);
      if (currentRowId === action.rowId) currentRowId = null;
      message = row ? `Removed order ${row.order_number}` : 'Removed order';
      break;
    case 'setTracking':
      if (row) {
        db.setTracking(row.id, action.prev.tracking || '', action.prev.carrier || '');
        currentRowId = row.id; // reopen so the corrected label can be scanned
        message = `Cleared tracking on ${row.order_number}`;
      }
      break;
  }
  pushState();
  return { ok: true, message };
}

/* ---------- CSV export ---------- */

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCsv() {
  const rows = db.todayRows();
  const day = db.localDay();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export today to CSV',
    defaultPath: path.join(app.getPath('documents'), `capture-${day}.csv`),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, buildCsvContent(rows), 'utf8');
  return { ok: true, path: filePath, count: rows.length };
}

/* ---------- sync ---------- */

async function triggerSync(trigger, ids) {
  if (isRunning()) return { error: 'Sync already running' };
  pushState();
  const summary = await runSync({
    trigger,
    ids,
    onProgress: (p) => { if (win && !win.isDestroyed()) win.webContents.send('sync:progress', p); },
  });
  if (win && !win.isDestroyed()) win.webContents.send('sync:done', summary);
  pushState();
  return summary;
}

/* ---------- stock routing scheduler ---------- */

// Periodically move out-of-stock orders to the fallback location and pull
// them back once the primary is replenished (see router.js). Silent unless
// something actually moved.
function startStockRouter() {
  const tick = async () => {
    const cfg = config.load();
    if (cfg.captureOnly || !cfg.stockRouting || !cfg.stockRouting.enabled) return;
    const res = await runRouting();
    if (res && (res.movedOut || res.movedBack)) {
      if (win && !win.isDestroyed()) win.webContents.send('routing:done', res);
    }
  };
  setTimeout(tick, 8000); // shortly after launch
  setInterval(tick, 5 * 60 * 1000);
}

/* ---------- IPC ---------- */

function registerIpc() {
  ipcMain.handle('state:get', () => buildState());
  ipcMain.handle('scan:submit', (_e, payload) => handleScan(payload || {}));
  ipcMain.handle('order:next', () => {
    currentRowId = null;
    pushState();
    return { ok: true };
  });
  ipcMain.handle('order:forceAdd', (_e, { channel, orderNumber }) => {
    ingestOrder(channel, orderNumber, { force: true });
    return { ok: true };
  });
  ipcMain.handle('order:open', (_e, id) => {
    const row = db.getRow(id);
    if (!row) return { ok: false, error: 'Row not found' };
    currentRowId = row.id;
    pushState();
    return { ok: true, row };
  });
  ipcMain.handle('undo', () => handleUndo());
  ipcMain.handle('rows:update', (_e, { id, fields }) => {
    fields = fields || {};
    if (typeof fields.tracking === 'string' && fields.carrier === undefined) {
      fields.carrier = classifyTracking(fields.tracking) || '';
    }
    const row = db.updateRow(id, fields);
    pushState();
    return { ok: !!row, row };
  });
  ipcMain.handle('rows:delete', (_e, id) => {
    if (currentRowId === id) currentRowId = null;
    db.deleteRow(id);
    // drop undo entries pointing at the deleted row
    for (let i = undoStack.length - 1; i >= 0; i--) {
      if (undoStack[i].rowId === id) undoStack.splice(i, 1);
    }
    pushState();
    return { ok: true };
  });
  ipcMain.handle('sync:run', (_e, payload) => {
    if (config.load().captureOnly) return { error: 'Capture-only mode: syncing is turned off.' };
    return triggerSync('manual', payload && payload.ids);
  });
  ipcMain.handle('csv:openFolder', () => {
    writeDailyCsv();
    if (lastCsv && !lastCsv.error) shell.showItemInFolder(lastCsv.path);
    else shell.openPath(csvFolder());
    return { ok: true };
  });
  ipcMain.handle('csv:chooseFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose CSV folder',
      defaultPath: csvFolder(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths[0]) return { ok: false, folder: csvFolder() };
    config.save({ csvFolder: filePaths[0] });
    pushState();
    return { ok: true, folder: filePaths[0] };
  });
  ipcMain.handle('config:get', () => config.load());
  ipcMain.handle('config:set', (_e, patch) => {
    const cfg = config.save(patch || {});
    pushState();
    return cfg;
  });
  ipcMain.handle('csv:export', () => exportCsv());
  ipcMain.handle('linnworks:test', async (_e, creds) => {
    try {
      const result = await testConnection(creds || config.load().linnworks);
      return { ok: true, ...result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('debug:get', () => ignoredLog.slice().reverse());
  ipcMain.handle('history:get', () => db.historyRows());
  ipcMain.handle('stock:get', async () => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode: no Linnworks access.' };
    try {
      const client = new LinnworksClient(cfg.linnworks);
      const items = await client.listInventory();
      return {
        ok: true,
        locationId: cfg.linnworks.locationId,
        locationName: cfg.linnworks.locationName || 'warehouse',
        items,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // Open orders containing one SKU, for the Stock page's "In orders" drill-down.
  ipcMain.handle('stock:openOrders', async (_e, { sku }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode: no Linnworks access.' };
    const wanted = String(sku || '').trim().toLowerCase();
    if (!wanted) return { ok: false, error: 'Missing SKU.' };
    try {
      const orders = await getOpenOrdersCached(cfg);
      const hits = [];
      for (const o of orders) {
        for (const line of o.items) {
          if (line.isService) continue; // service lines never reserve stock
          const base = {
            source: o.source,
            reference: o.reference,
            date: o.receivedDate,
            locationId: o.locationId || '',
            locationName: o.locationName || '',
          };
          // channel-SKU-mapped AND unlinked lines count: the grid's InOrders does
          if ((line.sku || '').toLowerCase() === wanted || (line.channelSku || '').toLowerCase() === wanted) {
            hits.push({ ...base, channelSku: line.channelSku, quantity: line.quantity });
            continue;
          }
          // composite/bundle children: the SKU reserves stock via the parent line
          for (const child of line.children || []) {
            if ((child.sku || '').toLowerCase() === wanted || (child.channelSku || '').toLowerCase() === wanted) {
              hits.push({ ...base, channelSku: child.channelSku, quantity: child.quantity, via: line.sku });
            }
          }
        }
      }
      hits.sort((a, b) => String(b.date).localeCompare(String(a.date))); // newest first
      return {
        ok: true,
        sku,
        orders: hits,
        primaryLocationId: cfg.linnworks.locationId || '',
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // filePath set = drag-and-drop onto the stage; unset = OS file picker
  ipcMain.handle('stock:addImage', async (_e, { sku, stockItemId, filePath }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    if (!stockItemId) return { ok: false, error: 'Missing stock item id.' };
    let fp = filePath ? String(filePath) : '';
    if (!fp) {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: `Choose an image for ${sku}`,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
        properties: ['openFile'],
      });
      if (canceled || !filePaths[0]) return { ok: false, canceled: true };
      fp = filePaths[0];
    }
    try {
      const buf = fs.readFileSync(fp);
      if (buf.length > 8 * 1024 * 1024) return { ok: false, error: 'Image is larger than 8 MB - use a smaller file.' };
      const kind = imageKind(buf);
      if (!kind) return { ok: false, error: 'That file is not an image.' };
      const mime = `image/${kind}`;
      sendImgProgress({ phase: 'uploading', source: path.basename(fp), received: buf.length, total: buf.length });
      const client = new LinnworksClient(cfg.linnworks);
      await client.addItemImage(stockItemId, buf, path.basename(fp), mime);
      return { ok: true, bytes: buf.length, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('stock:addImageUrl', (_e, { sku, stockItemId, url }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, error: 'Paste a full image URL starting with http(s)://' };
    if (!stockItemId) return { ok: false, error: 'Missing stock item id.' };
    return addImageFromUrl(cfg, { sku, stockItemId, url: String(url) });
  });
  ipcMain.handle('stock:cancelImage', () => {
    if (imgAbort) imgAbort.abort();
    return { ok: true };
  });
  ipcMain.handle('stock:saveImage', async (_e, { sku, url }) => {
    if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, error: 'This SKU has no image yet.' };
    const ext = (String(url).match(/\.(png|jpe?g|gif|webp)(\?|$)/i) || [, 'jpg'])[1].toLowerCase();
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: `Save image of ${sku}`,
      defaultPath: path.join(app.getPath('pictures'), `${sku}.${ext}`),
      filters: [{ name: 'Image', extensions: [ext] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      const res = await fetch(url);
      if (!res.ok) return { ok: false, error: `Download failed (${res.status})` };
      fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('wfs:list', () => db.listWfsShipments());
  ipcMain.handle('wfs:create', async (_e, payload) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const note = String((payload && payload.note) || '').slice(0, 500);
    const items = ((payload && payload.items) || [])
      .map(i => ({ sku: String(i.sku || '').trim(), gtin: String(i.gtin || '').trim(), qty: Number(i.qty) }))
      .filter(i => i.sku && Number.isInteger(i.qty) && i.qty > 0);
    if (!items.length) return { ok: false, error: 'Add at least one line with a SKU and quantity.' };
    try {
      // stock leaves the physical warehouse; WFS FULFILLED is fed by the
      // Linnworks WFS connection itself, so only the primary is adjusted
      const client = new LinnworksClient(cfg.linnworks);
      await client.changeStockLevels(
        items.map(i => ({ sku: i.sku, delta: -i.qty })),
        cfg.linnworks.locationId,
        'Capture Station WFS shipment'
      );
      const id = db.createWfsShipment({ note, items });
      writeWfsCsv();
      return { ok: true, id };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('stock:set', async (_e, { sku, level }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const n = Number(level);
    if (!sku || !Number.isInteger(n) || n < 0) return { ok: false, error: 'Enter a whole number of 0 or more.' };
    try {
      const client = new LinnworksClient(cfg.linnworks);
      const updated = await client.setStockLevel(String(sku), cfg.linnworks.locationId, n);
      return { ok: true, ...updated };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // Receiving is file + webhook only (no Linnworks), so it works in any mode;
  // the page itself is hidden unless pages.receiving is enabled.
  ipcMain.handle('receiving:finish', (_e, payload) => finishReceiving(payload));
  ipcMain.handle('receiving:list', () => listReceivingSessions());
  ipcMain.handle('receiving:chooseFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose receiving session folder',
      defaultPath: receivingFolder(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths[0]) return { ok: false, folder: receivingFolder() };
    config.save({ receiving: { folder: filePaths[0] } });
    pushState();
    return { ok: true, folder: filePaths[0] };
  });
  ipcMain.handle('clipboard:copy', (_e, text) => {
    const value = String(text ?? '');
    clipboard.writeText(value);
    // Prime the watcher so copying from inside the app never re-ingests
    // (which would otherwise flash the duplicate banner at the packer).
    lastClipboardText = value;
    return { ok: true };
  });
}

/* ---------- window & menu ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 860,
    height: 1000,
    minWidth: 430,
    minHeight: 640,
    backgroundColor: '#f7f7f6',
    title: 'Capture Station',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
  if (process.env.CAPTURE_SMOKE === '1') {
    win.webContents.on('console-message', (_e, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
  }
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Export Today to CSV', accelerator: 'CmdOrCtrl+E', click: () => exportCsv() },
        {
          label: 'Back Up Database Now',
          click: () => {
            try {
              const dest = db.backup();
              db.open();
              dialog.showMessageBox(win, { message: `Backup saved:\n${dest}` });
            } catch (e) {
              dialog.showErrorBox('Backup failed', e.message);
            }
          },
        },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => win && win.webContents.send('ui:open-settings') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'History', accelerator: 'CmdOrCtrl+H', click: () => win && win.webContents.send('ui:open-history') },
        { label: 'Ignored Clipboard Log', click: () => win && win.webContents.send('ui:open-debug') },
        { type: 'separator' },
        // dev-only tools stay out of installed builds (warehouse machines)
        ...(app.isPackaged ? [] : [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }]),
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- lifecycle ---------- */

app.whenReady().then(() => {
  if (IS_TEST_RUN) {
    // isolated throwaway data dir for automated tests
    app.setPath('userData', path.join(app.getPath('temp'), `capture-station-e2e-${Date.now()}`));
    config.save({ csvFolder: path.join(app.getPath('userData'), 'csv') });
  }
  config.save({}); // re-persist so plaintext credentials migrate to encrypted storage
  db.open();
  writeDailyCsv();
  registerIpc();
  buildMenu();
  createWindow();
  startClipboardWatcher();
  startStockRouter();

  if (process.env.CAPTURE_SMOKE === '1') {
    setTimeout(() => {
      console.log('SMOKE_OK');
      app.quit();
    }, 4000);
  }

  if (process.env.CAPTURE_E2E === '1') {
    require('./e2e-test')({ app, win, db, clipboard });
  }
});

app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => {
  if (clipboardTimer) clearInterval(clipboardTimer);
  try { db.backup(); } catch { /* best effort on exit */ }
});
