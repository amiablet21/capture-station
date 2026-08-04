'use strict';
const { app, BrowserWindow, Menu, ipcMain, clipboard, dialog, shell, WebContentsView, session } = require('electron');
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
    orderMeta,
    orderUrlTemplates: cfg.orderUrlTemplates || {},
    shipCutoff: cfg.shipCutoff || '16:00',
    locations: {
      primaryId: cfg.linnworks.locationId || '',
      primaryName: cfg.linnworks.locationName || '',
      fallbackName: (cfg.stockRouting || {}).fallbackLocationName || '',
      fallbackSet: !!(cfg.stockRouting || {}).fallbackLocationId
        && (cfg.stockRouting || {}).fallbackLocationId !== cfg.linnworks.locationId,
    },
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
    // the substitution marker rides in the notes column (internal audit trail)
    [r.notes || '', r.sub_sku ? `SUB: ${r.sub_note || `shipped ${r.sub_sku}`} (×${r.sub_qty || 1})` : '']
      .filter(Boolean).join(' | '),
    r.status, r.fail_reason, r.synced_at,
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

/* ---------- embedded marketplace browser pane (Capture page) ---------- */

// A WebContentsView docked beside the capture sheet so the packer opens the
// order's marketplace page (and prints the shipping label) without leaving
// the app. Own persistent session: seller logins survive restarts. Fully
// isolated from app internals - no preload, no node, sandboxed.
const PANE_PARTITION = 'persist:marketplace';
let paneView = null;
let paneAttached = false;

function paneUniquePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let i = 1; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

function sendPaneState() {
  if (!win || win.isDestroyed() || !paneView) return;
  const wc = paneView.webContents;
  let domain = '';
  try { domain = new URL(wc.getURL()).hostname.replace(/^www\./, ''); } catch { /* about:blank */ }
  win.webContents.send('browser:state', {
    domain, // domain only: raw URLs never reach the UI
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
  });
}

function ensurePane() {
  if (paneView) return paneView;
  const ses = session.fromPartition(PANE_PARTITION);
  // Marketplaces distrust the default Electron UA token and expire those
  // logins aggressively: present as the Chrome build this actually is.
  ses.setUserAgent(ses.getUserAgent()
    .replace(/\sElectron\/\S+/i, '')
    .replace(/\s(?:capture[- ]?station|Capture ?Station)\/\S+/i, ''));
  // Login cookies are written lazily; a hard shutdown can lose a fresh
  // sign-in. Flush every 5 minutes (and again at quit) so they stick.
  if (!ensurePane.flushTimer) {
    ensurePane.flushTimer = setInterval(() => ses.cookies.flushStore().catch(() => {}), 5 * 60 * 1000);
  }
  // shipping labels: downloads land in Downloads, the renderer gets a toast
  ses.removeAllListeners('will-download');
  ses.on('will-download', (_e, item) => {
    try {
      item.setSavePath(paneUniquePath(app.getPath('downloads'), item.getFilename() || 'download'));
    } catch { /* Electron picks a path itself */ }
    item.once('done', (_ev, dlState) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('browser:download', { file: path.basename(item.getSavePath()), state: dlState });
      }
    });
  });
  paneView = new WebContentsView({
    webPreferences: {
      partition: PANE_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const wc = paneView.webContents;
  // same copy/paste menu inside the marketplace pane — WITHOUT priming the
  // clipboard watcher: tracking numbers copied here are meant to be captured
  wc.on('context-menu', (_e, params) => {
    const items = [];
    if (params.isEditable) {
      items.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
      );
    } else if ((params.selectionText || '').trim()) {
      items.push({ role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
  // marketplace login flows open popups; allow them, same isolated session
  wc.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      autoHideMenuBar: true,
      webPreferences: { partition: PANE_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
    },
  }));
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']) {
    wc.on(ev, sendPaneState);
  }
  // loading-screen lifecycle: the renderer swaps the native view for a DOM
  // panel while a page loads (domain only, never the raw URL)
  const paneDomain = (u) => {
    try { return new URL(u || wc.getURL()).hostname.replace(/^www\./, ''); } catch { return ''; }
  };
  const sendPane = (channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  wc.on('did-start-loading', () => sendPane('browser:loadstart', { domain: paneDomain() }));
  wc.on('did-finish-load', () => sendPane('browser:loadend', { ok: true }));
  wc.on('did-stop-loading', () => sendPane('browser:loadend', { ok: true, fallback: true }));
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted (redirects, next nav)
    sendPane('browser:loadfail', { code, desc: String(desc || ''), domain: paneDomain(url) });
  });
  // Ctrl+P inside the pane -> Electron print dialog (window.print() from the
  // page itself already opens it natively)
  wc.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && String(input.key).toLowerCase() === 'p') {
      event.preventDefault();
      wc.print();
    }
  });
  return paneView;
}

// The renderer owns the pane's geometry: it reserves layout space and reports
// the rectangle (and hides the pane while any dialog is open, since a native
// view always draws above the DOM).
function layoutPane(b) {
  if (!win || win.isDestroyed()) return { ok: false };
  const visible = !!b.visible && !config.load().captureOnly; // sync-mode tool
  if (!visible) {
    if (paneView && paneAttached) {
      win.contentView.removeChildView(paneView);
      paneAttached = false;
    }
    return { ok: true, visible: false };
  }
  ensurePane();
  if (!paneAttached) {
    win.contentView.addChildView(paneView);
    paneAttached = true;
  }
  paneView.setBounds({
    x: Math.max(0, Math.round(b.x || 0)),
    y: Math.max(0, Math.round(b.y || 0)),
    width: Math.max(0, Math.round(b.width || 0)),
    height: Math.max(0, Math.round(b.height || 0)),
  });
  sendPaneState();
  return { ok: true, visible: true };
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

// POST a JSON body to a webhook: 10s timeout, one retry (receiving sessions
// and low-stock alerts share this).
async function postJsonWebhook(url, session) {
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
  const webhook = url ? await postJsonWebhook(url, session) : null; // null = not configured
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

// Mirror the returns ledger to a CSV beside the other exports.
function writeReturnsCsv() {
  try {
    const folder = csvFolder();
    fs.mkdirSync(folder, { recursive: true });
    const lines = ['date,order_number,source,customer,tracking,sku,condition,target_sku,qty,price,received_by,note,unmatched'];
    for (const r of db.listReturns(1000).slice().reverse()) {
      // a PO-only return has no item lines: one placeholder row keeps it in the CSV
      const its = r.items.length ? r.items : [{ sku: '', condition: '', targetSku: '', qty: '', price: null, note: '' }];
      for (const it of its) {
        lines.push([
          r.created_at, r.order_number, r.source, r.customer, r.tracking || '',
          it.sku, it.condition, it.targetSku, it.qty,
          it.price != null ? it.price : '', r.received_by || '',
          it.note || r.note || '', r.unmatched ? 'yes' : '',
        ].map(csvEscape).join(','));
      }
    }
    fs.writeFileSync(path.join(folder, 'returns.csv'), lines.join('\r\n'), 'utf8');
  } catch { /* CSV locked in Excel: the DB still has the log */ }
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
    // Clipboard auto-capture belongs to capture-only stations, where copying
    // IS the input method. In sync mode the queue is fed by the Linnworks
    // import and tracking goes into the row's inline box - a background
    // clipboard reader would only invite accidental captures.
    if (!config.load().captureOnly) return;
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

/* ---------- open-order auto-import (Capture work queue) ---------- */

// Linnworks open orders drop onto the Capture page as pending rows, so the
// packer's list IS the to-do list: click the PO#, make the label, copy the
// tracking. Rows the user never touched disappear again if their order
// leaves open orders (cancelled / processed elsewhere).
let orderMeta = {}; // reference -> { source, locationId, locationName, items: [{sku, qty}] }

// sku -> main image URL, from the inventory list (cached 10 min): gives the
// capture queue its item thumbnails without hammering the API
let skuImageCache = { at: 0, map: null, skus: null, promise: null };

async function loadInventoryCache(cfg) {
  if (skuImageCache.map && Date.now() - skuImageCache.at < 10 * 60 * 1000) return skuImageCache;
  if (skuImageCache.promise) return skuImageCache.promise;
  skuImageCache.promise = (async () => {
    try {
      const client = new LinnworksClient(cfg.linnworks);
      const items = await client.listInventory();
      const map = {};
      const skus = [];
      for (const it of items) {
        if (it.sku) skus.push(it.sku);
        if (it.image) map[it.sku] = it.image;
      }
      skuImageCache = { at: Date.now(), map, skus, promise: null };
      return skuImageCache;
    } catch {
      skuImageCache.promise = null;
      return skuImageCache;
    }
  })();
  return skuImageCache.promise;
}

async function getSkuImages(cfg) {
  return (await loadInventoryCache(cfg)).map || {};
}

async function getInventorySkus(cfg) {
  return (await loadInventoryCache(cfg)).skus || [];
}

function sourceToChannel(source) {
  const s = String(source || '').toLowerCase();
  if (s.includes('walmart')) return 'walmart';
  if (s.includes('ebay')) return 'ebay';
  if (s.includes('temu')) return 'temu';
  return s || 'other';
}

async function runOrderImport() {
  const cfg = config.load();
  if (cfg.captureOnly || !(cfg.orderImport && cfg.orderImport.enabled)) return;
  if (!cfg.linnworks.applicationId) return;
  try {
    const orders = await getOpenOrdersCached(cfg);
    const skuImages = await getSkuImages(cfg);
    const fallbackId = (cfg.stockRouting || {}).fallbackLocationId || '';
    // orders at excluded locations (e.g. WFS FULFILLED, shipped by Walmart)
    // never enter the queue; leaving them out of openRefs also cleans up any
    // untouched rows previously imported from there
    const excluded = new Set(((cfg.orderImport || {}).excludeLocationNames || [])
      .map(n => String(n).trim().toLowerCase()).filter(Boolean));
    const openRefs = new Set();
    let added = 0;
    const meta = {};
    for (const o of orders) {
      const ref = String(o.reference || '').trim();
      if (!ref) continue;
      if (excluded.has(String(o.locationName || '').trim().toLowerCase())) continue;
      openRefs.add(ref);
      meta[ref] = {
        source: o.source || '',
        locationId: o.locationId || '',
        locationName: o.locationName || '',
        dropship: !!fallbackId && o.locationId === fallbackId,
        despatchBy: o.despatchBy || '',
        items: (o.items || []).filter(it => !it.isService).map(it => {
          const linked = it.stockItemId && it.stockItemId !== ZERO_GUID;
          return {
            sku: it.sku || '',
            channelSku: it.channelSku || '',
            title: it.title || '',
            qty: it.quantity || 1,
            unmapped: !linked,
            img: (it.sku && skuImages[it.sku]) || '',
          };
        }),
      };
      if (!db.findByOrderNumber(ref)) {
        db.createRow({ channel: sourceToChannel(o.source), orderNumber: ref, origin: 'linnworks' });
        added++;
      }
    }
    // untouched imported rows whose order left open orders: cancelled or
    // handled elsewhere - remove them so the queue stays truthful
    let removed = 0;
    for (const row of db.untouchedImportedRows()) {
      if (!openRefs.has(row.order_number)) {
        if (currentRowId === row.id) currentRowId = null;
        db.deleteRow(row.id);
        removed++;
      }
    }
    orderMeta = meta;
    if (added || removed) {
      if (win && !win.isDestroyed()) win.webContents.send('orders:imported', { added, removed });
    }
    pushState();
  } catch { /* offline or auth hiccup: next pass retries */ }
}

// Saving or clearing a substitution changes where the order belongs, so the
// badge should flip immediately (same instant feel as stock corrections).
// Judged by the substitute's availability when one is set; by the listed
// lines when cleared. Best-effort: a routing hiccup never fails the save.
async function reRouteAfterSubstitution(orderNumber) {
  const cfg = config.load();
  const sr = cfg.stockRouting || {};
  const primary = cfg.linnworks.locationId;
  if (cfg.captureOnly || !sr.enabled || !sr.fallbackLocationId || !primary) return { moved: null };
  const ref = String(orderNumber || '').trim();
  try {
    const orders = await getOpenOrdersCached(cfg);
    const order = orders.find(o => String(o.reference).trim() === ref);
    if (!order) return { moved: null };
    const client = new LinnworksClient(cfg.linnworks);
    const row = db.findByOrderNumber(ref);
    let desired;
    if (row && row.sub_sku && row.sub_qty > 0) {
      const subId = await client.findStockItemIdBySku(row.sub_sku);
      if (!subId) return { moved: null }; // unresolvable SKU: leave it be
      const a = await client.getAvailableAt(subId, primary);
      desired = a >= row.sub_qty ? primary : sr.fallbackLocationId;
    } else {
      // cleared: judge the listed lines the same way the router does
      const lines = (order.items || []).filter(it =>
        !it.isService && it.stockItemId && it.stockItemId !== ZERO_GUID);
      if (!lines.length) return { moved: null };
      let ok = true;
      for (const it of lines) {
        const a = await client.getAvailableAt(it.stockItemId, primary);
        // at the primary the order already reserves its lines (short = a < 0);
        // at the fallback it does not, so coming home needs a >= quantity
        if (order.locationId === primary ? a < 0 : a < it.quantity) { ok = false; break; }
      }
      desired = ok ? primary : sr.fallbackLocationId;
    }
    if (desired === order.locationId) return { moved: null };
    const res = await client.moveOrdersToLocation([order.orderId], desired);
    const moved = res && res.OrdersMoved ? res.OrdersMoved.length : 0;
    if (!moved) return { moved: null };
    openOrdersCache = { at: 0, data: null, promise: null };
    await runOrderImport(); // refresh meta so the DS badge flips now
    return { moved: desired === primary ? 'primary' : 'fallback' };
  } catch {
    return { moved: null };
  }
}

function startOrderImporter() {
  const tick = () => { runOrderImport(); };
  setTimeout(tick, 5000);
  setInterval(tick, 5 * 60 * 1000);
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

/* ---------- low-stock watcher ---------- */

// Alerts once per SKU when Available crosses below the minimum level at the
// primary warehouse (db.lowStockCrossings is the pure engine). The latch is
// persisted to userData so restarts never respam; recovering above the
// minimum re-arms the alert. Silent and visual-only in the app — the webhook
// (Settings) is the notification channel, skipped when empty.
let lowStockRunning = false;
let lowStockLastAt = 0;

function lowStockStatePath() {
  return path.join(app.getPath('userData'), 'lowstock-state.json');
}

function loadLowStockState() {
  try {
    const s = JSON.parse(fs.readFileSync(lowStockStatePath(), 'utf8'));
    return { below: (s && typeof s.below === 'object' && s.below) || {} };
  } catch {
    return { below: {} };
  }
}

function saveLowStockState(below) {
  try {
    fs.writeFileSync(lowStockStatePath(), JSON.stringify({ below, at: new Date().toISOString() }, null, 2), 'utf8');
  } catch { /* best effort; the next pass rewrites it */ }
}

// items = pre-fetched inventory (stock:get piggybacks its own fetch);
// omitted = fetch fresh. minIntervalMs guards the manual-refresh path.
async function runLowStockCheck(itemsOpt, minIntervalMs = 0) {
  const cfg = config.load();
  if (cfg.captureOnly || !cfg.linnworks.applicationId || !cfg.linnworks.locationId) return;
  if (lowStockRunning) return;
  if (minIntervalMs && Date.now() - lowStockLastAt < minIntervalMs) return;
  lowStockRunning = true;
  try {
    let inv = itemsOpt;
    if (!inv) {
      const client = new LinnworksClient(cfg.linnworks);
      inv = await client.listInventory();
    }
    lowStockLastAt = Date.now();
    const locId = cfg.linnworks.locationId;
    const items = inv.map(it => {
      const l = (it.levels || []).find(x => x.locationId === locId) || {};
      return { sku: it.sku, title: it.title || '', available: l.available || 0, min: l.minimumLevel || 0 };
    });
    const prev = loadLowStockState();
    const { below, crossed } = db.lowStockCrossings(items, prev.below);
    saveLowStockState(below);
    const url = ((cfg.lowStock || {}).webhookUrl || '').trim();
    if (url) {
      for (const it of crossed) {
        await postJsonWebhook(url, {
          sku: it.sku, title: it.title, available: it.available, min: it.min,
          at: new Date().toISOString(),
        });
      }
    }
  } catch { /* silent: the next scheduled pass retries */ }
  finally { lowStockRunning = false; }
}

function startLowStockWatcher() {
  setTimeout(() => runLowStockCheck(), 15000);
  setInterval(() => runLowStockCheck(), 15 * 60 * 1000);
}

/* ---------- Sales page: processed-order line cache ---------- */

// SearchProcessedOrders + GetOrdersById are heavy (150/min): fetched item
// lines are cached in memory per range and overlapping requests reuse or
// extend the cache instead of re-paging the whole window.
const SALES_CACHE_TTL_MS = 10 * 60 * 1000;
let salesCache = { from: 0, to: 0, at: 0, lines: [] }; // epoch-ms range

function salesSlice(f, t) {
  return salesCache.lines.filter(l => {
    const ts = Date.parse(l.processedOn);
    return !Number.isNaN(ts) && ts >= f && ts <= t;
  });
}

// merge a fetched segment, skipping orders the cache already holds
// (boundary overlap between segments duplicates whole orders, never lines)
function salesMerge(segment) {
  const have = new Set(salesCache.lines.map(l => l.orderId));
  for (const l of segment) {
    if (!have.has(l.orderId)) salesCache.lines.push(l);
  }
}

async function querySales(from, to, force) {
  const cfg = config.load();
  if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode: no Linnworks access.' };
  const f = Date.parse(`${from}T00:00:00`);
  const t = Date.parse(`${to}T23:59:59.999`);
  if (Number.isNaN(f) || Number.isNaN(t) || f > t) return { ok: false, error: 'Pick a valid date range.' };
  if (t - f > 366 * 24 * 3600 * 1000) return { ok: false, error: 'Range too long — one year at most.' };
  try {
    const client = new LinnworksClient(cfg.linnworks);
    if (force || Date.now() - salesCache.at > SALES_CACHE_TTL_MS) {
      salesCache = { from: 0, to: 0, at: 0, lines: [] };
    }
    if (salesCache.at && f >= salesCache.from && t <= salesCache.to) {
      return { ok: true, lines: salesSlice(f, t), cached: true };
    }
    if (salesCache.at && t >= salesCache.from && f <= salesCache.to) {
      // overlap: fetch only the missing head / tail segments
      if (f < salesCache.from) {
        salesMerge(await client.listProcessedLines(new Date(f).toISOString(), new Date(salesCache.from).toISOString()));
      }
      if (t > salesCache.to) {
        salesMerge(await client.listProcessedLines(new Date(salesCache.to).toISOString(), new Date(t).toISOString()));
      }
      salesCache.from = Math.min(salesCache.from, f);
      salesCache.to = Math.max(salesCache.to, t);
      salesCache.at = Date.now();
    } else {
      const lines = await client.listProcessedLines(new Date(f).toISOString(), new Date(t).toISOString());
      salesCache = { from: f, to: t, at: Date.now(), lines };
    }
    return { ok: true, lines: salesSlice(f, t) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
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
  ipcMain.handle('order:openExternal', (_e, { orderNumber, channel }) => {
    const cfg = config.load();
    const tpl = (cfg.orderUrlTemplates || {})[channel] || '';
    if (!tpl || !/^https:\/\//i.test(tpl)) return { ok: false, error: 'No marketplace link set for this channel.' };
    const url = tpl.replace('{po}', encodeURIComponent(String(orderNumber)));
    shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle('orders:refresh', async () => {
    openOrdersCache = { at: 0, data: null, promise: null }; // force a fresh fetch
    await runOrderImport();
    // manual refresh also sweeps for new low-stock crossings (own throttle:
    // at most once per 5 minutes, so spamming Refresh stays cheap)
    runLowStockCheck(null, 5 * 60 * 1000).catch(() => { /* silent */ });
    return { ok: true };
  });
  // Per-order location move (same Orders/MoveToLocation call the router uses):
  // DS chip -> back to the warehouse; row action -> out to the fallback.
  ipcMain.handle('orders:move', async (_e, { orderNumber, target, force }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode: no Linnworks access.' };
    const ref = String(orderNumber || '').trim();
    if (!ref) return { ok: false, error: 'Missing order number.' };
    const sr = cfg.stockRouting || {};
    const primaryId = cfg.linnworks.locationId;
    const toId = target === 'primary' ? primaryId : sr.fallbackLocationId;
    const toName = target === 'primary'
      ? (cfg.linnworks.locationName || 'the warehouse')
      : (sr.fallbackLocationName || 'the fallback location');
    if (!toId) {
      return {
        ok: false,
        error: target === 'primary'
          ? 'No stock location selected (Settings).'
          : 'No fallback location selected (Settings > Sync).',
      };
    }
    try {
      const client = new LinnworksClient(cfg.linnworks);
      const orders = await getOpenOrdersCached(cfg);
      const order = orders.find(o => String(o.reference).trim() === ref);
      if (!order) return { ok: false, error: 'Order not found in open orders - refresh and retry.' };
      if (order.locationId === toId) return { ok: false, error: `Order is already at ${toName}.` };
      // moving back to the warehouse: warn, never block - the owner may have
      // restocked seconds ago and Linnworks still shows zero
      if (target === 'primary' && !force) {
        const short = [];
        for (const it of order.items) {
          if (it.isService || it.unlinked || !it.stockItemId || it.stockItemId === ZERO_GUID) continue;
          const avail = await client.getAvailableAt(it.stockItemId, primaryId);
          if (avail < it.quantity) short.push(it.sku || it.channelSku || 'item');
        }
        if (short.length) {
          return {
            ok: false, needsConfirm: true,
            warn: `${toName} shows no available stock for ${short.join(', ')} — move anyway?`,
          };
        }
      }
      const res = await client.moveOrdersToLocation([order.orderId], toId);
      const moved = res && res.OrdersMoved ? res.OrdersMoved.length : 0;
      if (!moved) {
        const errs = ((res && res.Errors) || []).join('; ');
        return { ok: false, error: errs || 'Linnworks did not move the order.' };
      }
      openOrdersCache = { at: 0, data: null, promise: null }; // location changed
      await runOrderImport(); // refresh meta + queue so the chip updates
      return { ok: true, toName };
    } catch (e) {
      return { ok: false, error: e.message };
    }
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
  // "Shipped different item": save the substitution intent on the row.
  // Stock is corrected at process time; a SUBSTITUTION note goes on the
  // Linnworks order; routing follows the substitute's availability at once.
  ipcMain.handle('rows:substitute', async (_e, { id, sku, qty, note, clear }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode: no Linnworks access.' };
    const row = db.getRow(Number(id));
    if (!row) return { ok: false, error: 'Row not found.' };
    if (row.status === 'synced') return { ok: false, error: 'Already processed - the stock has moved.' };
    if (clear) {
      const cleared = db.setSubstitution(row.id, '', 0, '');
      pushState();
      const routed = await reRouteAfterSubstitution(row.order_number);
      return { ok: true, row: cleared, moved: routed.moved };
    }
    const subSku = String(sku || '').trim();
    const subQty = Number(qty);
    if (!subSku) return { ok: false, error: 'Pick the SKU that actually shipped.' };
    if (!Number.isInteger(subQty) || subQty < 1) return { ok: false, error: 'Quantity must be a whole number of 1 or more.' };
    const updated = db.setSubstitution(row.id, subSku, subQty, String(note || '').trim().slice(0, 300));
    pushState();
    const routed = await reRouteAfterSubstitution(row.order_number);
    return { ok: true, row: updated, moved: routed.moved };
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
      // fresh levels for free: run the low-stock crossing check on them
      runLowStockCheck(items).catch(() => { /* silent */ });
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
  ipcMain.handle('returns:lookup', async (_e, { ref }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const reference = String(ref || '').trim();
    if (!reference) return { ok: false, error: 'Enter the original PO# / order number.' };
    try {
      const client = new LinnworksClient(cfg.linnworks);
      const order = await client.findProcessedOrder(reference);
      if (!order) return { ok: false, error: 'No processed order found for that number.' };
      // resolve each item's condition targets via the shared mapping engine
      // (manual picks beat the -OPENBOX/-USED/-SCRAP suffix auto-derivation)
      const skus = await getInventorySkus(cfg);
      for (const it of order.items) {
        it.targets = db.resolveConditionTargets(it.sku, skus);
      }
      return { ok: true, order, skus };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('returns:create', async (_e, payload) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const items = ((payload && payload.items) || [])
      .map(i => ({
        sku: String(i.sku || '').trim(),
        condition: String(i.condition || '').trim(),
        targetSku: String(i.targetSku || '').trim(),
        qty: Number(i.qty),
        price: Math.max(0, Math.round((Number(i.price) || 0) * 100) / 100),
        note: String(i.note || '').trim().slice(0, 300),
      }))
      .filter(i => i.sku && Number.isInteger(i.qty) && i.qty > 0);
    // the PO# is the only mandatory field: a bare reference is a valid log
    // entry; lines carry stock moves only when both SKU and target are known
    if (!String(payload.orderNumber || '').trim()) return { ok: false, error: 'A PO# is required.' };
    const stockItems = items.filter(i => i.targetSku);
    try {
      const client = new LinnworksClient(cfg.linnworks);
      if (stockItems.length) {
        await client.changeStockLevels(
          stockItems.map(i => ({ sku: i.targetSku, delta: i.qty })),
          cfg.linnworks.locationId,
          'Capture Station return'
        );
      }
      // remember non-new mappings so the next return of this SKU is one click
      for (const i of stockItems) {
        if (i.condition !== 'new' && i.targetSku !== i.sku) {
          db.saveConditionMapping(i.sku, i.condition, i.targetSku);
        }
      }
      const receivedBy = String(payload.receivedBy || '').trim().slice(0, 60);
      const id = db.createReturn({
        orderNumber: String(payload.orderNumber || ''),
        source: String(payload.source || ''),
        customer: String(payload.customer || ''),
        note: String(payload.note || '').slice(0, 500),
        items,
        unmatched: !!payload.unmatched, // arrived without a Linnworks order
        tracking: String(payload.tracking || '').trim().slice(0, 100),
        receivedBy,
      });
      // the worksheet's "Received by" remembers the last-used initials
      if (receivedBy) config.save({ returnsReceivedBy: receivedBy });
      writeReturnsCsv();
      // best effort: stamp the original order (processed orders may refuse)
      let noted = false;
      if (payload.orderId) {
        try {
          const summary = items.map(i => `${i.sku} -> ${i.condition}${i.targetSku ? ` (${i.targetSku})` : ''} x${i.qty}`).join('; ') || 'no items recorded';
          await client.addOrderNote(payload.orderId, `Return received: ${summary}${payload.note ? ` | ${payload.note}` : ''}`);
          noted = true;
        } catch { /* order note is a bonus, not a requirement */ }
      }
      return { ok: true, id, noted };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('returns:list', () => db.listReturns());
  // Condition targets for one SKU (the unmatched-return path picks the SKU
  // first, so it needs the same engine the order lookup uses per item).
  ipcMain.handle('returns:targets', async (_e, { sku }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const base = String(sku || '').trim();
    if (!base) return { ok: false, error: 'Missing SKU.' };
    try {
      const skus = await getInventorySkus(cfg);
      return { ok: true, targets: db.resolveConditionTargets(base, skus), skus };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // All known mappings for the editor: auto-derived rows from the live
  // inventory's suffix listings, overlaid with the persisted manual picks.
  ipcMain.handle('returns:mappings', async () => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    try {
      const skus = await getInventorySkus(cfg);
      const bySkuUpper = new Map(skus.map(s => [s.toUpperCase(), s]));
      const rows = new Map(); // baseSku -> { baseSku, conds: { cond: { sku, source } } }
      const ensure = (base) => {
        if (!rows.has(base)) rows.set(base, { baseSku: base, conds: {} });
        return rows.get(base);
      };
      for (const s of skus) {
        for (const [cond, suf] of Object.entries(db.CONDITION_SUFFIX)) {
          const t = bySkuUpper.get(`${s}${suf}`.toUpperCase());
          if (t) ensure(s).conds[cond] = { sku: t, source: 'auto' };
        }
      }
      for (const [base, conds] of Object.entries(db.getConditionMap())) {
        for (const [cond, target] of Object.entries(conds)) {
          ensure(base).conds[cond] = { sku: target, source: 'manual' };
        }
      }
      const mappings = [...rows.values()].sort((a, b) => a.baseSku.localeCompare(b.baseSku));
      return { ok: true, mappings, skus };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('returns:mapSet', async (_e, { baseSku, condition, targetSku }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const base = String(baseSku || '').trim();
    const cond = String(condition || '').trim();
    const target = String(targetSku || '').trim();
    if (!base || !target) return { ok: false, error: 'Missing SKU.' };
    if (!Object.hasOwn(db.CONDITION_SUFFIX, cond)) return { ok: false, error: 'Unknown condition.' };
    try {
      // normalize casing against live inventory when it resolves there
      const skus = await getInventorySkus(cfg);
      const match = skus.find(s => s.toUpperCase() === target.toUpperCase());
      db.saveConditionMapping(base, cond, match || target);
      return { ok: true, targetSku: match || target };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('returns:mapDelete', async (_e, { baseSku, condition }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const base = String(baseSku || '').trim();
    const cond = String(condition || '').trim();
    if (!base || !Object.hasOwn(db.CONDITION_SUFFIX, cond)) return { ok: false, error: 'Unknown mapping.' };
    try {
      db.deleteConditionMapping(base, cond);
      const skus = await getInventorySkus(cfg);
      // report what the mapping falls back to (auto suffix listing, if any)
      return { ok: true, fallback: db.resolveConditionTargets(base, skus)[cond] || '' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // force = the page's Refresh button: bust the cache and re-page
  ipcMain.handle('sales:query', (_e, { from, to, force }) => querySales(from, to, !!force));
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
  // Create a new inventory item, optionally with a starting level at the
  // primary location (via the existing UpdateStockLevelsBySKU delta path).
  ipcMain.handle('stock:createSku', async (_e, payload) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const sku = String((payload && payload.sku) || '').trim().toUpperCase();
    const title = String((payload && payload.title) || '').trim().slice(0, 300);
    const barcode = String((payload && payload.barcode) || '').trim().slice(0, 60);
    const retailPrice = Math.max(0, Math.round((Number(payload && payload.retailPrice) || 0) * 100) / 100);
    const purchasePrice = Math.max(0, Math.round((Number(payload && payload.purchasePrice) || 0) * 100) / 100);
    const qty = Number((payload && payload.qty) ?? 0);
    if (!sku) return { ok: false, error: 'SKU is required.' };
    if (!/^[A-Z0-9][A-Z0-9\-_./]*$/.test(sku)) return { ok: false, error: 'SKU can only use letters, numbers and - _ . /' };
    if (!title) return { ok: false, error: 'Title is required.' };
    if (!Number.isInteger(qty) || qty < 0) return { ok: false, error: 'Starting quantity must be a whole number of 0 or more.' };
    try {
      const client = new LinnworksClient(cfg.linnworks);
      // second line of defense behind the dialog's live duplicate check
      const existing = await getInventorySkus(cfg);
      if (existing.some(s => String(s).toUpperCase() === sku)) {
        return { ok: false, error: `${sku} already exists in Linnworks.` };
      }
      const { stockItemId } = await client.createInventoryItem({ sku, title, barcode, retailPrice, purchasePrice });
      if (qty > 0) {
        await client.changeStockLevels([{ sku, delta: qty }], cfg.linnworks.locationId, 'Capture Station new SKU');
      }
      skuImageCache = { at: 0, map: null, skus: null, promise: null }; // inventory changed
      return { ok: true, sku, stockItemId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('stock:channelSkus', async (_e, { stockItemId }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    try {
      const client = new LinnworksClient(cfg.linnworks);
      const channels = await client.getChannelSkus(stockItemId);
      // best effort: stored channel prices ride along; a listing-specific
      // (Source+SubSource) row wins over the channel's default row
      let prices = [];
      try { prices = await client.getChannelPrices(stockItemId); } catch { /* dialog still works without prices */ }
      const norm = (s) => String(s || '').trim().toLowerCase();
      for (const c of channels) {
        const exact = prices.find(p => norm(p.source) === norm(c.source) && norm(p.subSource) === norm(c.subSource));
        const def = prices.find(p => norm(p.source) === norm(c.source) && !norm(p.subSource));
        const hit = exact || def;
        c.price = hit ? hit.price : null;
        c.priceKind = exact ? 'channel' : def ? 'default' : null;
      }
      return { ok: true, channels };
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
      // a corrected count can change routing decisions (e.g. "actually we DO
      // have some"): re-route and re-import right away instead of waiting
      // for the 5-minute passes
      (async () => {
        await runRouting();
        openOrdersCache = { at: 0, data: null, promise: null };
        await runOrderImport();
      })().catch(() => { /* the scheduled passes will catch up */ });
      return { ok: true, ...updated };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // Minimum (reorder alert) level for one SKU at the primary warehouse.
  ipcMain.handle('stock:setMin', async (_e, { stockItemId, level }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode: no Linnworks access.' };
    const n = Number(level);
    if (!stockItemId) return { ok: false, error: 'Missing stock item.' };
    if (!Number.isInteger(n) || n < 0) return { ok: false, error: 'Enter a whole number of 0 or more.' };
    try {
      const client = new LinnworksClient(cfg.linnworks);
      await client.setStockMinimumLevel(stockItemId, cfg.linnworks.locationId, n);
      return { ok: true, minimumLevel: n };
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
  // embedded marketplace browser pane
  ipcMain.handle('browser:layout', (_e, b) => layoutPane(b || {}));
  ipcMain.handle('browser:open', (_e, { orderNumber, channel, url }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    let target = String(url || '');
    if (!target) {
      const tpl = (cfg.orderUrlTemplates || {})[channel] || '';
      if (!tpl || !/^https:\/\//i.test(tpl)) return { ok: false, error: 'No marketplace link set for this channel.' };
      target = tpl.replace('{po}', encodeURIComponent(String(orderNumber)));
    }
    if (!/^https:\/\//i.test(target)) return { ok: false, error: 'Only https pages can load here.' };
    ensurePane().webContents.loadURL(target).catch(() => { /* nav errors show in-pane */ });
    return { ok: true };
  });
  ipcMain.handle('browser:nav', (_e, { action }) => {
    if (!paneView) return { ok: false };
    const wc = paneView.webContents;
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'reload') wc.reload();
    return { ok: true };
  });
  ipcMain.handle('browser:print', () => {
    if (paneView) paneView.webContents.print();
    return { ok: true };
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
  // right-click copy/paste menu, standard across the whole app; in-app copies
  // prime the clipboard watcher so they never re-ingest as order captures
  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.isEditable) {
      items.push(
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', enabled: params.editFlags.canCut,
          click: () => { win.webContents.cut(); lastClipboardText = params.selectionText; } },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', enabled: params.editFlags.canCopy,
          click: () => { win.webContents.copy(); lastClipboardText = params.selectionText; } },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', enabled: params.editFlags.canPaste,
          click: () => win.webContents.paste() },
        { type: 'separator' },
        { label: 'Select all', accelerator: 'CmdOrCtrl+A', click: () => win.webContents.selectAll() },
      );
    } else if ((params.selectionText || '').trim()) {
      items.push({ label: 'Copy', accelerator: 'CmdOrCtrl+C',
        click: () => { win.webContents.copy(); lastClipboardText = params.selectionText; } });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
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
  startOrderImporter();
  startLowStockWatcher();

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
  // marketplace logins: force the cookie store to disk before exit
  if (paneView) session.fromPartition(PANE_PARTITION).cookies.flushStore().catch(() => { /* best effort */ });
  try { db.backup(); } catch { /* best effort on exit */ }
});
