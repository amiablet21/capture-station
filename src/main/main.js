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
let testClipboardAllow = null; // e2e-written clipboard values (test isolation)
let unlistedCache = { at: 0, skus: null, detail: null, channels: [] }; // in-stock SKUs with no linked listing
let pendingNotice = ''; // startup housekeeping message, shown once the UI is up
const mappingCache = new Map(); // channel key -> { at, items } (10-min TTL)
let lastClipboardText = null; // null = not primed yet; prime with current content on start
let currentRowId = null;
const undoStack = []; // { type: 'createRow'|'setTracking'|'addSerial', rowId, prev? }
const ignoredLog = []; // debug ring buffer of non-matching clipboard text

// E2E and smoke runs are throwaway test boots that may coexist with a
// normal instance: isolated userData, no single-instance lock.
const IS_DEMO = process.env.CAPTURE_DEMO === '1'; // dummy-data review boot
const IS_TEST_RUN = process.env.CAPTURE_E2E === '1' || process.env.CAPTURE_SMOKE === '1' || IS_DEMO;

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
    returnUrlTemplates: cfg.returnUrlTemplates || {},
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
  const header = 'time,channel,order_number,items,tracking,carrier,notes,status,fail_reason,synced_at';
  const lines = rows.slice().reverse().map(r => [
    r.created_at, r.channel, r.order_number,
    (r.items || []).map(i => `${i.sku}${i.qty > 1 ? ` x${i.qty}` : ''}`).join('; '),
    r.tracking, r.carrier,
    // the substitution marker rides in the notes column (internal audit trail)
    [r.notes || '', r.sub_sku ? `SUB: ${r.sub_note || `shipped ${r.sub_sku}${r.sub_for ? ` instead of ${r.sub_for}` : ''}`} (×${r.sub_qty || 1})` : '']
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

// Pane zoom: buttons and Ctrl+wheel share one persisted factor, reapplied on
// every navigation so Chromium's per-site zoom memory can't drift from it.
let paneZoomSaveTimer = null;

function paneSetZoom(dir) {
  const wc = paneView.webContents;
  const cur = wc.getZoomFactor();
  const next = dir === 'reset' ? 1 : dir === 'in' ? cur * 1.1 : cur / 1.1;
  const factor = Math.round(Math.min(3, Math.max(0.3, next)) * 100) / 100;
  wc.setZoomFactor(factor);
  clearTimeout(paneZoomSaveTimer); // wheel spins fire in bursts - settle first
  paneZoomSaveTimer = setTimeout(() => config.save({ browserPane: { zoom: factor } }), 400);
  if (win && !win.isDestroyed()) win.webContents.send('browser:zoom', { factor });
  return factor;
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
  // Ctrl+wheel zooms (Chromium reports it as zoom-changed); the saved factor
  // survives restarts and is re-imposed after every navigation
  wc.on('zoom-changed', (_e, direction) => {
    paneSetZoom(direction === 'in' ? 'in' : 'out');
  });
  wc.on('did-navigate', () => {
    const z = Number((config.load().browserPane || {}).zoom) || 1;
    wc.setZoomFactor(z);
    if (win && !win.isDestroyed()) win.webContents.send('browser:zoom', { factor: z });
  });
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
    if (items.length) items.push({ type: 'separator' });
    items.push({ label: 'Print…', click: () => wc.print() });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
  // Owner privacy filter (2026-08-07): Seller Center's money/performance
  // pages stay hidden from whoever works the pane. The menu links vanish via
  // injected CSS, and any navigation that still reaches them (typed URL, SPA
  // route, popup) bounces back to the order list with a notice. This guards
  // the PANE only — a real browser outside the app is not covered.
  const HIDDEN_PANE_PATHS = [
    '/payments/statements',
    '/payments/capital',
    '/analytics/overview/executive-dashboard',
    '/analytics/sales-insights',
  ];
  const paneHiddenUrl = (u) => {
    try {
      const url = new URL(u);
      return url.hostname.replace(/^www\./, '') === 'seller.walmart.com'
        && HIDDEN_PANE_PATHS.some(p => url.pathname.startsWith(p));
    } catch { return false; }
  };
  const PANE_SAFE_URL = 'https://seller.walmart.com/orders/manage-orders';
  const paneBlockNote = () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:notice', { message: 'That Seller Center page is hidden in Capture Station' });
    }
  };
  wc.on('will-navigate', (e, u) => {
    if (paneHiddenUrl(u)) { e.preventDefault(); paneBlockNote(); }
  });
  wc.on('did-navigate', (_e, u) => {
    if (paneHiddenUrl(u)) { paneBlockNote(); wc.loadURL(PANE_SAFE_URL).catch(() => {}); }
  });
  wc.on('did-navigate-in-page', (_e, u, isMainFrame) => {
    if (isMainFrame && paneHiddenUrl(u)) { paneBlockNote(); wc.loadURL(PANE_SAFE_URL).catch(() => {}); }
  });
  wc.on('did-finish-load', () => {
    let host = '';
    try { host = new URL(wc.getURL()).hostname.replace(/^www\./, ''); } catch { /* not a page */ }
    if (host !== 'seller.walmart.com') return;
    wc.insertCSS(
      HIDDEN_PANE_PATHS.map(p => `a[href*="${p}"]`).join(', ') + ' { display: none !important; }'
    ).catch(() => { /* purely cosmetic — the nav block is the real gate */ });
  });
  // marketplace login flows open popups; allow them, same isolated session —
  // except popups aimed at hidden pages, which are refused outright
  wc.setWindowOpenHandler(({ url }) => {
    if (paneHiddenUrl(url)) { paneBlockNote(); return { action: 'deny' }; }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        webPreferences: { partition: PANE_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
      },
    };
  });
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
  // popups (packing slips, labels, login flows) need their own print paths:
  // there is no Chrome print preview in Electron, so a popup's in-page print
  // button can come up silent — Ctrl+P and right-click Print… both reach the
  // system dialog instead
  wc.on('did-create-window', (child) => {
    const cwc = child.webContents;
    cwc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.control || input.meta) && String(input.key).toLowerCase() === 'p') {
        event.preventDefault();
        cwc.print();
      }
    });
    cwc.on('context-menu', (_e, params) => {
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
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: 'Print…', click: () => cwc.print() });
      Menu.buildFromTemplate(items).popup({ window: child });
    });
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
      // detaching a FOCUSED native view strands keyboard focus: nothing in
      // the window receives keystrokes until the window refocuses. Hand
      // focus back to the app so dialog inputs type immediately.
      win.webContents.focus();
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
  // test isolation: whatever is on the DESKTOP's clipboard when a test run
  // launches is not test input — prime the watcher so it only reacts to
  // changes made during the run (a real PO# on the clipboard once seeded a
  // phantom row into an e2e queue check, 2026-08-05)
  if (IS_TEST_RUN) {
    try { lastClipboardText = clipboard.readText(); } catch { /* ignore */ }
  }
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
    // test isolation: the desktop clipboard stays live during a suite run
    // (the user keeps working) — only values the suite itself wrote count
    if (IS_TEST_RUN && text !== testClipboardAllow) return;
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

// Orders the router WANTED to move but Linnworks refused (locked/parked):
// refreshed after every routing pass from its error strings, surfaced as a
// PARKED chip on the row. Self-clears once the order unparks or moves.
let routerRefusedRefs = new Set();

// Marketplace deep links. kind 'return' uses the returns templates (falling
// back to the order link when a channel has none). Walmart's returns search
// is date-bounded, so {from}/{to} carry a rolling 180-day window — doubly
// encoded, because the whole filter blob is an encoded JSON string.
function buildMarketUrl(cfg, channel, po, kind) {
  const ch = String(channel || '').toLowerCase();
  const tpl = String(
    (kind === 'return' ? (cfg.returnUrlTemplates || {})[ch] : '')
    || (cfg.orderUrlTemplates || {})[ch] || ''
  ).trim();
  if (!tpl || !/^https:\/\//i.test(tpl)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const enc2 = (s) => encodeURIComponent(encodeURIComponent(s));
  const now = new Date();
  return tpl
    .replace('{po}', encodeURIComponent(String(po)))
    .replace('{from}', enc2(`${day(new Date(now.getTime() - 180 * 86400000))}T00:00:00+00:00`))
    .replace('{to}', enc2(`${day(now)}T23:59:59+00:00`));
}

function updateRouterRefusals(res) {
  const refused = new Set();
  for (const err of (res && res.errors) || []) {
    const m = /Order '(\d+)'/.exec(String(err));
    if (!m) continue;
    const numId = Number(m[1]);
    const hit = (openOrdersCache.data || []).find(o => o.numOrderId === numId);
    if (hit) refused.add(String(hit.reference).trim());
  }
  routerRefusedRefs = refused;
}

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
    const openParts = new Set(); // "ref#lwOrderId" for every live split part
    let added = 0;
    const meta = {};
    // SPLIT support (2026-08-07): Linnworks' fulfillment network may split
    // one marketplace order across locations — several open orders sharing
    // one reference. Group first; each part gets its own row and meta entry
    // (keyed ref#orderId), so parts ship and process independently.
    const byRef = new Map();
    for (const o of orders) {
      const ref = String(o.reference || '').trim();
      if (!ref) continue;
      if (excluded.has(String(o.locationName || '').trim().toLowerCase())) continue;
      if (!byRef.has(ref)) byRef.set(ref, []);
      byRef.get(ref).push(o);
    }
    for (const [ref, parts] of byRef) {
      openRefs.add(ref);
      const isSplit = parts.length > 1;
      parts.forEach((o, pi) => {
        const key = isSplit ? `${ref}#${o.orderId}` : ref;
        if (isSplit) openParts.add(key);
        meta[key] = {
          source: o.source || '',
          locationId: o.locationId || '',
          locationName: o.locationName || '',
          dropship: !!fallbackId && o.locationId === fallbackId,
          parked: routerRefusedRefs.has(ref),
          despatchBy: o.despatchBy || '',
          split: isSplit ? { part: pi + 1, of: parts.length } : null,
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
        let row;
        if (isSplit) {
          row = db.findByOrderAndPart(ref, o.orderId);
          if (!row) {
            // the order split AFTER an earlier import: the legacy row (no
            // part id yet) becomes the first part instead of a new one
            const legacy = db.findByOrderNumber(ref);
            if (legacy && !legacy.lw_order_id) {
              row = db.setRowPart(legacy.id, o.orderId);
              db.setRowItems(row.id, meta[key].items.map(i => ({ sku: i.sku || i.channelSku || i.title, qty: i.qty })));
            } else {
              row = db.createRow({ channel: sourceToChannel(o.source), orderNumber: ref, origin: 'linnworks', lwOrderId: o.orderId });
              added++;
            }
          }
        } else {
          row = db.findByOrderNumber(ref);
          if (!row) {
            row = db.createRow({ channel: sourceToChannel(o.source), orderNumber: ref, origin: 'linnworks', lwOrderId: o.orderId });
            added++;
          } else if (!row.lw_order_id) {
            row = db.setRowPart(row.id, o.orderId); // backfill for older rows
          }
        }
        // snapshot the item lines onto the row while the order is still open,
        // so the Items column survives after the order leaves the open book
        if (row && (!row.items || !row.items.length) && meta[key].items.length) {
          db.setRowItems(row.id, meta[key].items.map(i => ({ sku: i.sku || i.channelSku || i.title, qty: i.qty })));
        }
      });
    }
    // untouched imported rows whose order left open orders: cancelled or
    // handled elsewhere - remove them so the queue stays truthful. A split
    // part vanishes when ITS part id is gone AND it isn't the surviving
    // unsplit order (parts can merge back on the Linnworks side).
    let removed = 0;
    for (const row of db.untouchedImportedRows()) {
      const partGone = row.lw_order_id
        && openParts.size > 0
        && (byRef.get(row.order_number) || []).length > 1
        && !openParts.has(`${row.order_number}#${row.lw_order_id}`);
      const refGone = !openRefs.has(row.order_number);
      const mergedBack = row.lw_order_id
        && (byRef.get(row.order_number) || []).length === 1
        && (byRef.get(row.order_number) || [])[0].orderId !== row.lw_order_id
        && !!db.findByOrderAndPart(row.order_number, (byRef.get(row.order_number) || [])[0].orderId);
      if (refGone || partGone || mergedBack) {
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
      let ok = a >= row.sub_qty;
      // a per-line substitution (sub_for) replaces ONE line; the order still
      // needs the OTHER listed lines available at the primary to come home
      if (ok && row.sub_for) {
        for (const it of (order.items || [])) {
          if (it.isService || !it.stockItemId || it.stockItemId === ZERO_GUID) continue;
          if (String(it.sku || '').trim() === row.sub_for) continue; // replaced line
          const la = await client.getAvailableAt(it.stockItemId, primary);
          if (order.locationId === primary ? la < 0 : la < it.quantity) { ok = false; break; }
        }
      }
      desired = ok ? primary : sr.fallbackLocationId;
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
    updateRouterRefusals(res);
    if (res && (res.movedOut || res.movedBack || (res.errors && res.errors.length))) {
      // badges (DS/PARKED) follow the order list: refresh it NOW instead of
      // letting moved orders wear stale badges until the next import cycle
      openOrdersCache = { at: 0, data: null, promise: null };
      await runOrderImport();
      if (win && !win.isDestroyed()) win.webContents.send('routing:done', res);
    }
    // dropship pads ride the same cadence; nightly reorder pass piggybacks
    runPadMaintenance().catch(() => { /* next tick retries */ });
    runReorderAuto().catch(() => { /* next tick retries */ });
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

/* ---------- claim photos: LAN upload server ---------- */

// The phone scans a QR from the app and shoots straight into
// Documents\Capture Station\claim photos (kept 5 days). The QR token rotates
// every app session, so an old QR (or a photo of one) dies on restart.
let claimsRun = null; // { url, token, port, dir, todayCount, close }

async function startClaims() {
  const claims = require('./claims');
  const dir = path.join(app.getPath('documents'), 'Capture Station', 'claim photos');
  try {
    claimsRun = await claims.start({
      dir,
      // eBay lister QR capture: raw shots per draft SKU, swept after 14 days
      listingDir: path.join(app.getPath('documents'), 'Capture Station', 'listing photos'),
      onListingUpload: ({ sku, file }) => {
        if (win && !win.isDestroyed()) win.webContents.send('ebay:photoUploaded', { sku, file });
      },
      port: 0, // ephemeral — the QR carries the port, nobody types the URL
      // tap chips on the phone: today's received returns, newest first
      listToday: () => {
        const today = new Date().toDateString();
        const seen = new Set();
        const out = [];
        for (const r of db.listReturns(200)) {
          if (new Date(r.created_at).toDateString() !== today) continue;
          const po = String(r.order_number || '').trim();
          if (!po || seen.has(po)) continue;
          seen.add(po);
          const d = new Date(r.created_at);
          out.push({
            po,
            sku: (r.items[0] && r.items[0].sku) || '',
            tm: `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}${d.getHours() < 12 ? 'a' : 'p'}`,
          });
          if (out.length >= 12) break;
        }
        return out;
      },
      onUpload: ({ po, name, todayCount }) => {
        if (win && !win.isDestroyed()) win.webContents.send('claims:uploaded', { po, name, todayCount });
      },
    });
  } catch (err) {
    console.error('claims upload server failed to start:', err.message);
  }
}

/* ---------- DropShip program: pad engine ---------- */

// Keeps every enrolled SKU's DropShip level at its pad. One inventory fetch
// per pass; only mismatched levels get a delta. Pad 0 = hold the level at
// zero (listing dark) until the SKU is removed from the program.
let padRunning = false;

async function runPadMaintenance() {
  const cfg = config.load();
  const dsLoc = (cfg.stockRouting || {}).fallbackLocationId;
  if (cfg.captureOnly || !dsLoc || padRunning) return { skipped: true };
  padRunning = true;
  try {
    const client = new LinnworksClient(cfg.linnworks);
    const items = await client.listInventory();
    // the program lives in Linnworks (DropshipPad extended property), so
    // every install sees the same enrollment; local config just mirrors it
    // for the UI. Pads set before the property existed migrate up once.
    const pads = {};
    for (const it of items) {
      if (it.dsPad) pads[String(it.sku).toUpperCase()] = Math.max(0, Number(it.dsPad.value) || 0);
    }
    if (!cfg.dropshipPadsMigrated) {
      for (const [sku, qtyRaw] of Object.entries(cfg.dropshipPads || {})) {
        const key = String(sku).toUpperCase();
        if (key in pads) continue;
        const qty = Math.max(0, Number(qtyRaw) || 0);
        try {
          await client.setDropshipPad(key, qty);
          pads[key] = qty;
        } catch { /* SKU no longer in inventory - drop it */ }
      }
      config.save({ dropshipPadsMigrated: true, dropshipPads: pads });
    } else {
      config.save({ dropshipPads: pads });
    }
    if (!Object.keys(pads).length) return { ok: true, adjusted: 0 };
    const bySku = new Map(items.map(i => [String(i.sku).toUpperCase(), i]));
    const deltas = [];
    for (const [sku, qtyRaw] of Object.entries(pads)) {
      const target = Math.max(0, Number(qtyRaw) || 0);
      const it = bySku.get(String(sku).toUpperCase());
      if (!it) continue; // SKU no longer in inventory
      const lvl = (it.levels || []).find(l => l.locationId === dsLoc);
      const cur = lvl ? Number(lvl.stockLevel) || 0 : 0;
      if (cur !== target) deltas.push({ sku: it.sku, delta: target - cur });
    }
    if (deltas.length) {
      await client.changeStockLevels(deltas, dsLoc, 'Capture Station dropship pad');
    }
    return { ok: true, adjusted: deltas.length };
  } catch (e) {
    return { error: e.message };
  } finally {
    padRunning = false;
  }
}

/* ---------- reorder points from sales velocity ---------- */

// Min = perDay × leadTimeDays × 1.5 (rounded up). Guards: no suggestion
// before 14 days of sales history; dropship-enrolled SKUs with zero owned
// stock suggest 0 (the DS BUY signal owns that case, not the low-stock
// alarm). Pure math on the shared sales cache.
async function computeReorderStats() {
  const cfg = config.load();
  if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
  const rc = { leadTimeDays: 7, coverDays: 21, ...(cfg.reorder || {}) };
  const dsLoc = (cfg.stockRouting || {}).fallbackLocationId || '';
  const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const res = await querySales(day(new Date(Date.now() - 89 * 86400000)), day(new Date()));
  if (!res.ok) return res;
  const now = Date.now();
  const per = {};
  for (const l of res.lines) {
    const sku = String(l.sku || '').trim().toUpperCase();
    if (!sku) continue;
    const t = Date.parse(l.processedOn);
    if (Number.isNaN(t)) continue;
    const age = (now - t) / 86400000;
    const p = per[sku] || (per[sku] = { total7: 0, total30: 0, ds1: 0, ds7: 0, ds30: 0, ds90: 0, oldest: 0 });
    p.oldest = Math.max(p.oldest, age);
    if (age <= 7) p.total7 += l.qty;
    if (age <= 30) p.total30 += l.qty;
    if (l.locationId && l.locationId === dsLoc) {
      if (age <= 1) p.ds1 += l.qty;
      if (age <= 7) p.ds7 += l.qty;
      if (age <= 30) p.ds30 += l.qty;
      p.ds90 += l.qty;
    }
  }
  const pads = cfg.dropshipPads || {};
  const stats = {};
  for (const [sku, p] of Object.entries(per)) {
    const perDay = p.total30 / 30;
    stats[sku] = {
      ...p,
      perDay: Math.round(perDay * 10) / 10,
      trend: p.total7 / 7 > perDay * 1.15 ? 'up' : p.total7 / 7 < perDay * 0.85 ? 'down' : 'flat',
      tooNew: p.oldest < 14,
      suggestMin: p.oldest < 14 ? null : Math.ceil(perDay * rc.leadTimeDays * 1.5),
      buyQty: Math.ceil(perDay * (rc.coverDays + rc.leadTimeDays)),
      enrolled: sku in pads,
      pad: Number(pads[sku]) || 0,
    };
  }
  return { ok: true, stats, leadTimeDays: rc.leadTimeDays, coverDays: rc.coverDays, dsLocationId: dsLoc };
}

// nightly auto-apply + dropship BUY webhook crossings (once per day)
let lastReorderAutoDay = '';

async function runReorderAuto() {
  const cfg = config.load();
  const rc = cfg.reorder || {};
  const today = db.localDay();
  if (cfg.captureOnly || lastReorderAutoDay === today) return;
  lastReorderAutoDay = today;
  try {
    const res = await computeReorderStats();
    if (!res.ok) return;
    const client = new LinnworksClient(cfg.linnworks);
    const items = await client.listInventory();
    const changes = [];
    if (rc.auto) {
      for (const it of items) {
        const s = res.stats[String(it.sku).toUpperCase()];
        if (!s || s.tooNew || s.suggestMin === null) continue;
        const lvl = (it.levels || []).find(l => l.locationId === cfg.linnworks.locationId);
        if (!lvl) continue;
        // dropship SKUs with zero owned stock keep Min 0 (BUY signal owns them)
        const target = (s.pad > 0 && (Number(lvl.stockLevel) || 0) === 0) ? 0 : s.suggestMin;
        const cur = Number(lvl.minimumLevel) || 0;
        const diff = Math.abs(target - cur);
        if (diff >= 2 && (cur === 0 ? target > 0 : diff / cur > 0.2)) {
          try {
            await client.setStockMinimumLevel(it.stockItemId, cfg.linnworks.locationId, target);
            changes.push(`${it.sku} ${cur}→${target}`);
          } catch { /* one bad SKU never stops the pass */ }
        }
      }
    }
    // dropship BUY crossings: once per crossing, latched like low stock
    const alerted = { ...(cfg.dropshipAlerted || {}) };
    const crossings = [];
    for (const [sku, s] of Object.entries(res.stats)) {
      if (!(sku in (cfg.dropshipPads || {}))) continue;
      if (s.ds7 >= 25 && !alerted[sku]) {
        alerted[sku] = true;
        crossings.push(`${sku}: ${s.ds7}/week dropshipped — BUY ~${s.buyQty}`);
      } else if (s.ds7 < 10 && alerted[sku]) {
        delete alerted[sku]; // cooled off: re-arm
      }
    }
    config.save({ dropshipAlerted: alerted });
    if (changes.length || crossings.length) {
      const summary = [
        changes.length ? `Minimums updated for ${changes.length} SKUs: ${changes.slice(0, 4).join(', ')}${changes.length > 4 ? ` +${changes.length - 4} more` : ''}` : '',
        ...crossings.map(c => `DropShip alert: ${c}`),
      ].filter(Boolean).join('\n');
      if (win && !win.isDestroyed()) win.webContents.send('reorder:applied', { summary });
      const hook = ((cfg.lowStock || {}).webhookUrl || '').trim();
      if (hook && /^https:\/\//i.test(hook)) {
        try {
          await fetch(hook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'reorder-summary', summary, at: new Date().toISOString() }),
          });
        } catch { /* webhook is best effort */ }
      }
    }
  } catch { /* next day retries */ }
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
  // Permanently delete a stock item from Linnworks (guarded by a consent
  // dialog in the UI — this is irreversible)
  // Rename a Linnworks SKU in place: the stockItemId anchors everything, so
  // levels/history/links survive; string-matched config follows the rename
  ipcMain.handle('stock:renameSku', async (_e, { stockItemId, oldSku, newSku }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    if (!stockItemId) return { ok: false, error: 'Missing stock item id.' };
    const next = String(newSku || '').trim().toUpperCase();
    const prev = String(oldSku || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,49}$/.test(next)) return { ok: false, error: 'SKUs are letters, numbers, dashes and underscores.' };
    if (next === prev) return { ok: false, error: 'That is already the SKU.' };
    try {
      const client = new LinnworksClient(cfg.linnworks);
      const clash = await client.findStockItemIdBySku(next).catch(() => null);
      if (clash) return { ok: false, error: `${next} already exists in Linnworks.` };
      await client.renameSku(stockItemId, next);
      // string-matched local config follows the item to its new name
      const patch = {};
      if ((cfg.unlistedIgnore || []).includes(prev)) {
        patch.unlistedIgnore = cfg.unlistedIgnore.map(s => (s === prev ? next : s));
      }
      if (cfg.dropshipPads && prev in cfg.dropshipPads) {
        const pads = { ...cfg.dropshipPads };
        pads[next] = pads[prev];
        delete pads[prev];
        patch.dropshipPads = pads;
      }
      if (Object.keys(patch).length) config.save(patch);
      mappingCache.clear();
      unlistedCache = { at: 0, skus: null, detail: null, channels: [] };
      skuImageCache = { at: 0, map: null, skus: null, promise: null };
      return { ok: true, sku: next };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('stock:deleteSku', async (_e, { stockItemId, sku }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    if (!stockItemId) return { ok: false, error: 'Missing stock item id.' };
    try {
      const client = new LinnworksClient(cfg.linnworks);
      await client.call('Inventory/DeleteInventoryItems', { inventoryItemIds: [stockItemId] });
      mappingCache.clear();
      unlistedCache = { at: 0, skus: null, detail: null, channels: [] };
      // a deleted SKU leaves the dropship program implicitly
      const pads = { ...(cfg.dropshipPads || {}) };
      if (sku && String(sku).toUpperCase() in pads) {
        delete pads[String(sku).toUpperCase()];
        config.save({ dropshipPads: pads });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // A listing page for a channel SKU, in the pane or externally. With an
  // eBay item number (ChannelReferenceId) the exact product page opens;
  // otherwise the channel's SKU-search template.
  ipcMain.handle('listing:open', (_e, { sku, channel, external, refId }) => {
    const cfg = config.load();
    let url = '';
    if (String(channel || '').toLowerCase() === 'ebay' && /^\d{9,15}$/.test(String(refId || '').trim())) {
      url = `https://www.ebay.com/itm/${String(refId).trim()}`;
    } else {
      const tpl = String((cfg.listingUrlTemplates || {})[String(channel || '').toLowerCase()] || '').trim();
      if (!tpl || !/^https:\/\//i.test(tpl)) return { ok: false, error: 'No listing link set for this channel.' };
      url = tpl.replace('{sku}', encodeURIComponent(String(sku)));
    }
    if (external || cfg.captureOnly) {
      shell.openExternal(url);
      return { ok: true, external: true };
    }
    ensurePane().webContents.loadURL(url).catch(() => { /* nav errors show in-pane */ });
    return { ok: true };
  });
  // Which stock items carry a link on each channel — for the per-channel
  // "No eBay / No Walmart" stock filters. Derived from the item-level link
  // records via the shared unlisted scan (the channel scan feed lies).
  ipcMain.handle('mapping:linkedSets', async () => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    try {
      const c = await runUnlistedScan(cfg);
      return { ok: true, sets: c.sets || {} };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Channel mapping (the in-app Linnworks mapping screen): catalog feed,
  // link, unlink. The catalog is cached per channel — filtering is local.
  ipcMain.handle('mapping:channels', async () => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    try {
      const client = new LinnworksClient(cfg.linnworks);
      return { ok: true, channels: await client.getMappingChannels() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // Cross-check unlinked feed rows against Inventory's channel-SKU records
  // (the truth the Stock page uses). Candidates: unlinked listings whose SKU
  // exists as an inventory SKU - one bulk id lookup, then one throttled
  // per-item call each. Mutates the cached items so later opens keep it.
  async function overlayMappingLinks(cfg, key, items, channelId, source, subSource) {
    const unlinked = items.filter(i => !i.linked && i.sku);
    if (!unlinked.length) return;
    const client = new LinnworksClient(cfg.linnworks);
    const ids = await client.getStockItemIdsBySkus(unlinked.map(i => i.sku));
    for (const it of unlinked) {
      if (mappingCache.get(key)?.items !== items) return; // superseded fetch
      const id = ids.get(String(it.sku).toUpperCase());
      if (!id) continue;
      let records = [];
      try { records = await client.getChannelSkus(id); } catch { continue; }
      const hit = records.some(r =>
        r.source === source && r.subSource === subSource
        && String(r.sku).toUpperCase() === String(it.sku).toUpperCase());
      if (!hit) continue;
      it.linked = true;
      it.linkedItemId = id;
      if (win && !win.isDestroyed()) {
        win.webContents.send('mapping:overlay', { channelId, sku: it.sku, stockItemId: id });
      }
    }
  }

  ipcMain.handle('mapping:items', async (_e, { channelId, source, subSource, force }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const key = `${channelId}|${source}|${subSource}`;
    const hit = mappingCache.get(key);
    if (!force && hit && Date.now() - hit.at < 10 * 60 * 1000) {
      return { ok: true, items: hit.items, cached: true };
    }
    try {
      const client = new LinnworksClient(cfg.linnworks);
      const items = await client.getChannelItems(channelId, source, subSource);
      mappingCache.set(key, { at: Date.now(), items });
      // The scan feed lags: a link made in Linnworks' Product Details (or
      // seconds ago in this dialog) stays "not linked" until the channel's
      // next listing scan. Overlay the REAL link records in the background;
      // confirmed links stream to the dialog as they are found.
      overlayMappingLinks(cfg, key, items, channelId, source, subSource).catch(() => {});
      return { ok: true, items };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('mapping:link', async (_e, { channelSku, source, subSource, targetSku, channelRefId }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    try {
      const client = new LinnworksClient(cfg.linnworks);
      const stockItemId = await client.findStockItemIdBySku(targetSku);
      if (!stockItemId) return { ok: false, error: `${targetSku} not found in Linnworks.` };
      const already = (r) => r.source === source && r.subSource === subSource
        && String(r.sku).toUpperCase() === String(channelSku).toUpperCase();
      // duplicate guard: a repeat click (or a half-landed earlier attempt)
      // must not stack a second record
      try {
        if ((await client.getChannelSkus(stockItemId)).some(already)) {
          mappingCache.clear();
          return { ok: true, alreadyLinked: true };
        }
      } catch { /* pre-check is best-effort */ }
      try {
        await client.linkChannelSku(channelSku, source, subSource, stockItemId, channelRefId);
      } catch (e) {
        // Linnworks 500s "Could not update channel mappings" and STILL
        // creates the record (verified live) — trust the re-check, not
        // the status code
        const landed = (await client.getChannelSkus(stockItemId).catch(() => [])).some(already);
        if (!landed) throw e;
      }
      mappingCache.clear();
      unlistedCache = { at: 0, skus: null, detail: null, channels: [] }; // links change what is unlisted
      // Retro-link check (owner 2026-08-14): whether Linnworks attaches a NEW
      // link to open orders that already carried this channel SKU was an open
      // question — so it is verified per-mapping instead of assumed. Their
      // lines are re-read fresh; unlinked lines ship without deducting stock,
      // and the renderer warns with the exact unit count.
      let orders = null;
      try {
        const want = String(channelSku).toUpperCase();
        const match = (li) => String(li.channelSku || li.sku || '').toUpperCase() === want;
        const read = async () => {
          openOrdersCache = { at: 0, data: null, promise: null }; // linkage flags must be re-read
          const all = await getOpenOrdersCached(cfg);
          const lines = [];
          for (const o of all) {
            for (const li of o.items || []) {
              if (li.isService) continue;
              if (match(li)) lines.push(li);
              for (const ch of li.children || []) if (match(ch)) lines.push(ch);
            }
          }
          return lines;
        };
        let lines = await read();
        if (lines.some(l => l.unlinked)) {
          await new Promise(r => setTimeout(r, 2500)); // Linnworks may attach lazily
          lines = await read();
        }
        orders = {
          count: lines.length,
          units: lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0),
          pending: lines.filter(l => l.unlinked).length,
        };
      } catch { /* the link itself succeeded; the order check is best-effort */ }
      // the renderer patches its missing-listing sets with this id at once —
      // the scan feed lags far behind the real link records
      return { ok: true, stockItemId, orders };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('mapping:unlink', async (_e, { rowId }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    if (!rowId) return { ok: false, error: 'This listing carries no link id — rescan the channel in Linnworks.' };
    try {
      const client = new LinnworksClient(cfg.linnworks);
      await client.unlinkChannelSku(rowId);
      mappingCache.clear();
      unlistedCache = { at: 0, skus: null, detail: null, channels: [] };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Walmart shipped-orders file: pick the Seller Center download, fill
  // tracking onto matching queue rows in bulk (see shipfile.js)
  ipcMain.handle('ship:importFile', async () => {
    const pick = await dialog.showOpenDialog(win, {
      title: 'Import shipped orders (Walmart download)',
      filters: [{ name: 'Shipped orders', extensions: ['xlsx', 'csv'] }],
      properties: ['openFile'],
    });
    if (pick.canceled || !pick.filePaths[0]) return { ok: true, canceled: true };
    try {
      const shipfile = require('./shipfile.js');
      const records = shipfile.extractShipped(pick.filePaths[0]);
      const summary = shipfile.applyShipped(db, records);
      if (summary.filled) writeDailyCsv(); // the CSV mirror carries tracking
      pushState();
      return { ok: true, ...summary };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // focus rescue: a click on an app input while the native pane holds the
  // keyboard hands it back (the input then focuses normally)
  ipcMain.handle('app:focus', () => {
    if (win && !win.isDestroyed()) win.webContents.focus();
    return { ok: true };
  });
  ipcMain.handle('order:openExternal', (_e, { orderNumber, channel, kind }) => {
    const url = buildMarketUrl(config.load(), channel, orderNumber, kind);
    if (!url) return { ok: false, error: 'No marketplace link set for this channel.' };
    shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle('orders:refresh', async () => {
    // Refresh = "make everything right, now": run a routing pass first so
    // stock changes made OUTSIDE the app (Linnworks edits, marketplace
    // sales) take effect immediately instead of waiting the 5-minute tick
    const cfg = config.load();
    if (!cfg.captureOnly && cfg.stockRouting && cfg.stockRouting.enabled) {
      try {
        const routed = await runRouting();
        updateRouterRefusals(routed);
        if (routed && (routed.movedOut || routed.movedBack || (routed.errors && routed.errors.length))) {
          if (win && !win.isDestroyed()) win.webContents.send('routing:done', routed);
        }
      } catch { /* routing hiccups never block the refresh itself */ }
    }
    openOrdersCache = { at: 0, data: null, promise: null }; // force a fresh fetch
    await runOrderImport();
    // manual refresh also sweeps for new low-stock crossings (own throttle:
    // at most once per 5 minutes, so spamming Refresh stays cheap)
    runLowStockCheck(null, 5 * 60 * 1000).catch(() => { /* silent */ });
    return { ok: true };
  });
  // Per-order location move (same Orders/MoveToLocation call the router uses):
  // DS chip -> back to the warehouse; row action -> out to the fallback.
  // Unpark: clear the parked tag AND the lock in Linnworks so the stock
  // router can move the order again. The chip clears at once; the next
  // routing pass (or a manual refresh) does the actual moving.
  ipcMain.handle('orders:unpark', async (_e, { orderNumber }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode: no Linnworks access.' };
    const ref = String(orderNumber || '').trim();
    if (!ref) return { ok: false, error: 'Missing order number.' };
    try {
      const orders = await getOpenOrdersCached(cfg);
      const hit = (orders || []).find(o => String(o.reference).trim() === ref);
      if (!hit) return { ok: false, error: 'Order not found among open orders — refresh and try again.' };
      const client = new LinnworksClient(cfg.linnworks);
      await client.unparkOrder(hit.orderId);
      routerRefusedRefs.delete(ref);
      pushState();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

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
  ipcMain.handle('rows:substitute', async (_e, { id, sku, qty, note, clear, subFor }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode: no Linnworks access.' };
    const row = db.getRow(Number(id));
    if (!row) return { ok: false, error: 'Row not found.' };
    if (row.status === 'synced') return { ok: false, error: 'Already processed - the stock has moved.' };
    if (clear) {
      const cleared = db.setSubstitution(row.id, '', 0, '', '');
      pushState();
      // routing runs in the BACKGROUND: it pages the whole open-order book,
      // which took long enough to look like a frozen dialog. The row (and
      // its DS badge) update themselves when the pass finishes.
      reRouteAfterSubstitution(row.order_number).catch(() => { /* next tick retries */ });
      return { ok: true, row: cleared, moved: null };
    }
    const subSku = String(sku || '').trim();
    const subQty = Number(qty);
    if (!subSku) return { ok: false, error: 'Pick the SKU that actually shipped.' };
    if (!Number.isInteger(subQty) || subQty < 1) return { ok: false, error: 'Quantity must be a whole number of 1 or more.' };
    // sub_for: which listed line the substitute replaces — required on
    // multi-line orders (the renderer sends the clicked line's SKU)
    const updated = db.setSubstitution(row.id, subSku, subQty, String(note || '').trim().slice(0, 300), String(subFor || '').trim());
    pushState();
    // background routing (see the clear branch): the dialog closes at once
    reRouteAfterSubstitution(row.order_number).catch(() => { /* next tick retries */ });
    return { ok: true, row: updated, moved: null };
  });
  ipcMain.handle('rows:clearFailed', () => {
    const removed = db.clearFailedNotFound();
    if (removed && currentRowId && !db.getRow(currentRowId)) currentRowId = null;
    pushState();
    return { ok: true, removed };
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

  // Claim photos: QR + status for the Upload Photos corner button. The QR is
  // rendered here (qrcode lib) and handed over as a data URL; po locks the
  // phone page to one order so the row-level 📷 needs zero typing.
  ipcMain.handle('claims:info', async (_e, { po } = {}) => {
    if (!claimsRun) return { ok: false, error: 'The upload server is not running — restart the app.' };
    const url = claimsRun.url + (po ? `&po=${encodeURIComponent(String(po))}` : '');
    try {
      const qr = await require('qrcode').toDataURL(url, { margin: 1, width: 300, color: { dark: '#2f3437', light: '#ffffff' } });
      return { ok: true, url, qr, dir: claimsRun.dir, todayCount: claimsRun.todayCount() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('claims:openFolder', () => {
    if (!claimsRun) return { ok: false };
    shell.openPath(claimsRun.dir);
    return { ok: true };
  });

  /* ---------- eBay lister ---------- */

  // eBay 403s plain fetches (bot detection), so the listing page is read by a
  // real hidden Chromium window on the marketplace session (the seller's own
  // cookies ride along) and the specifics come straight off the DOM.
  async function fetchEbayListingDom(itemId) {
    const w = new BrowserWindow({
      show: false, width: 1100, height: 900,
      webPreferences: { partition: PANE_PARTITION, sandbox: true },
    });
    try {
      await w.loadURL(`https://www.ebay.com/itm/${encodeURIComponent(itemId)}`);
      await new Promise(r => setTimeout(r, 4000)); // lazy sections settle
      // specifics live in dl dt/dd pairs (verified live 2026-08-12); the
      // category id rides the deepest breadcrumb /b/ link
      return await w.webContents.executeJavaScript(`(() => {
        const specs = {};
        // seller-view rows (Views, Buyer ID, timings, shipping blocks) are
        // page furniture, not item specifics — keep them out of the card
        const junk = /^(condition|views|buyer id|duration|start time|end time|item number|bids|payments|shipping|returns|pickup|located in|seller|item location|quantity|sold|watchers)$/i;
        document.querySelectorAll('dl').forEach(dl => {
          const dts = [...dl.querySelectorAll('dt')];
          const dds = [...dl.querySelectorAll('dd')];
          dts.forEach((dt, i) => {
            const k = dt.innerText.trim().replace(/:$/, '');
            const v = (dds[i] ? dds[i].innerText : '').replace(/\\s*Read more[\\s\\S]*$/i, '').trim();
            if (k && v && !junk.test(k) && !specs[k]) specs[k] = v;
          });
        });
        const h1 = document.querySelector('h1');
        const title = (h1 ? h1.innerText.trim() : document.title.replace(/\\s*\\|\\s*eBay\\s*$/i, '')).trim();
        const priceEl = document.querySelector('.x-price-primary');
        const priceM = ((priceEl && priceEl.innerText) || '').match(/([\\d,]+\\.?\\d*)/);
        let categoryId = '';
        for (const a of [...document.querySelectorAll('a[href*="/b/"]')].reverse()) {
          const m = String(a.href).match(/\\/(\\d{3,8})\\//);
          if (m) { categoryId = m[1]; break; }
        }
        return {
          title,
          price: priceM ? Number(priceM[1].replace(/,/g, '')) : 0,
          categoryId,
          specs,
        };
      })()`, true);
    } finally {
      w.destroy();
    }
  }

  // Public catalog title lookup: an eBay search resolves a UPC (or a model
  // query) to the product's full marketing title — independent of the
  // seller's own listings. First real result tile wins.
  ipcMain.handle('listing:titleLookup', async (_e, { upc, query }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const q = String(upc || '').trim() || String(query || '').trim();
    if (!q) return { ok: false, error: 'No UPC on the item and nothing to search with.' };
    const w = new BrowserWindow({
      show: false, width: 1100, height: 900,
      webPreferences: { partition: PANE_PARTITION, sandbox: true },
    });
    try {
      await w.loadURL(`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`);
      await new Promise(r => setTimeout(r, 3000)); // result tiles settle
      const title = await w.webContents.executeJavaScript(`(() => {
        const bad = /^(shop on ebay|results matching|tell us what)/i;
        for (const el of document.querySelectorAll('.s-item__title, .s-card__title')) {
          const t = el.innerText.replace(/^New listing\\s*/i, '').trim();
          if (t && !bad.test(t) && t.length > 15) return t;
        }
        return '';
      })()`, true);
      if (!title) return { ok: false, error: 'No catalog match for that search.' };
      return { ok: true, title };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      w.destroy();
    }
  });

  // Copy the item specifics off the seller's own LIVE listing of the base
  // model: base SKU -> eBay link record (channelRefId = the item number) ->
  // public listing page -> "About this item" table. The renderer caches the
  // result per model in config.ebayModelCards, so this runs once per family.
  ipcMain.handle('ebay:specs', async (_e, { baseSku }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    try {
      const client = new LinnworksClient(cfg.linnworks);
      const channels = await client.getMappingChannels();
      const eb = channels.find(ch => /ebay/i.test(ch.source));
      if (!eb) return { ok: false, error: 'No eBay channel in Linnworks.' };
      const key = `${eb.id}|${eb.source}|${eb.subSource}`;
      let items = mappingCache.get(key)?.items;
      if (!items || Date.now() - mappingCache.get(key).at > 10 * 60 * 1000) {
        items = await client.getChannelItems(eb.id, eb.source, eb.subSource);
        mappingCache.set(key, { at: Date.now(), items });
      }
      const want = String(baseSku).trim().toUpperCase();
      const hit = items.find(i => String(i.sku).trim().toUpperCase() === want && i.channelRefId);
      if (!hit) return { ok: false, error: `No live eBay listing found for ${baseSku}.` };
      const parsed = await fetchEbayListingDom(hit.channelRefId);
      if (!parsed || !Object.keys(parsed.specs || {}).length) {
        return { ok: false, error: 'Could not read the specifics off the listing page.' };
      }
      return { ok: true, itemId: String(hit.channelRefId), ...parsed };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // QR for the lister's Photos row: the phone page is locked to the draft SKU
  ipcMain.handle('ebay:qr', async (_e, { sku }) => {
    if (!claimsRun || !claimsRun.listingUrl) return { ok: false, error: 'The upload server is not running — restart the app.' };
    if (!String(sku || '').trim()) return { ok: false, error: 'Type a SKU first.' };
    try {
      const url = claimsRun.listingUrl(sku);
      const qr = await require('qrcode').toDataURL(url, { margin: 1, width: 300, color: { dark: '#2f3437', light: '#ffffff' } });
      return { ok: true, url, qr };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('ebay:photosPick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Listing photos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    return { ok: true, files: r.canceled ? [] : r.filePaths };
  });

  // Export: host the chosen photos on the Linnworks item (eBay's CSV upload
  // fetches PicURL over the internet), build the CSV, save where the user
  // picks. Nothing touches eBay until they upload the file in Seller Hub.
  ipcMain.handle('ebay:export', async (_e, { listing, photoPaths }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    try {
      const { buildEbayCsv } = require('./ebaycsv.js');
      const client = new LinnworksClient(cfg.linnworks);
      let picUrls = [];
      if (photoPaths && photoPaths.length) {
        let stockItemId = listing.stockItemId;
        if (!stockItemId) stockItemId = await client.findStockItemIdBySku(listing.sku).catch(() => null);
        if (!stockItemId) return { ok: false, error: `${listing.sku} is not in Linnworks yet - create the SKU first so the photos have a home.` };
        // entries are plain paths (untouched photos) or {dataUrl, name}
        // (baked in the editor — the EDITED pixels are what eBay gets)
        const files = photoPaths.map((p, i) => {
          if (p && typeof p === 'object' && p.dataUrl) {
            const m = String(p.dataUrl).match(/^data:(image\/[a-z]+);base64,(.+)$/i);
            if (!m) throw new Error(`photo ${i + 1}: unreadable edited image`);
            return { buffer: Buffer.from(m[2], 'base64'), name: p.name || `photo-${i + 1}.jpg`, mime: m[1] };
          }
          const fp = typeof p === 'object' ? p.path : p;
          return {
            buffer: fs.readFileSync(fp),
            name: path.basename(fp),
            mime: /\.png$/i.test(fp) ? 'image/png' : /\.webp$/i.test(fp) ? 'image/webp' : 'image/jpeg',
          };
        });
        picUrls = await client.addItemImages(stockItemId, files);
      }
      // the description's photo section gets the hosted URLs (the preview
      // showed local files; buyers get the same images from Linnworks' CDN)
      // two-column grid (owner pick 2026-08-13); a single photo stays full width
      const gallery = picUrls.length
        ? `<h3>Photos</h3><div style="${picUrls.length > 1 ? 'display:grid;grid-template-columns:1fr 1fr;gap:10px;' : ''}">${picUrls.map(u => `<img src="${u}" style="max-width:100%;width:100%;border-radius:4px;" alt="" />`).join('')}</div>`
        : '';
      const description = String(listing.description || '').replace('{{PHOTO_GALLERY}}', gallery);
      const csv = buildEbayCsv([{ ...listing, description, picUrls }], cfg.ebayProfiles || {});
      const stamp = new Date();
      const name = `eBay-upload-${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}.csv`;
      const r = await dialog.showSaveDialog(win, {
        title: 'Save the eBay upload file',
        defaultPath: path.join(app.getPath('downloads'), name),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      fs.writeFileSync(r.filePath, '﻿' + csv, 'utf8'); // BOM: Seller Hub reads UTF-8 reliably
      return { ok: true, path: r.filePath, picCount: picUrls.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  /* ---------- Overview tab: orders + money cards (approved design v2) ---------- */

  // Order series come straight from SQLite (cheap, always fresh); the three
  // money cards ride the velocity engine — 28 days of processed lines + one
  // inventory read — and cache for 10 minutes.
  const OVERVIEW_TTL_MS = 10 * 60 * 1000;
  let overviewCache = { at: 0, money: null, promise: null };

  async function computeOverviewMoney(cfg) {
    const client = new LinnworksClient(cfg.linnworks);
    const to = new Date();
    const from = new Date(to.getTime() - 28 * 86400000);
    const sales = await querySales(
      `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`,
      `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}`
    );
    if (!sales.ok) throw new Error(sales.error || 'sales unavailable');
    // per-SKU: 4-week qty, revenue, last sale, channels
    const stats = {};
    const label = (src) => /walmart/i.test(src) ? 'Walmart' : /ebay/i.test(src) ? 'eBay' : /temu/i.test(src) ? 'Temu' : src;
    for (const l of sales.lines) {
      const k = String(l.sku).toUpperCase();
      if (!k) continue;
      const s = stats[k] = stats[k] || { qty: 0, revenue: 0, last: 0, channels: new Set() };
      s.qty += l.qty;
      s.revenue += l.revenue;
      const ts = Date.parse(l.processedOn) || 0;
      if (ts > s.last) s.last = ts;
      if (l.source) s.channels.add(label(l.source));
    }
    const items = await client.listInventory();
    const homeLoc = cfg.linnworks.locationId;
    const pads = {};
    for (const it of items) if (it.dsPad) pads[String(it.sku).toUpperCase()] = true;
    const lead = Number((cfg.reorder || {}).leadTimeDays) || 7;
    const missed = [];
    const buy = [];
    const wfs = [];
    const now = Date.now();
    const fmtDay = (ts) => {
      const d = new Date(ts);
      return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`;
    };
    for (const it of items) {
      const k = String(it.sku).toUpperCase();
      const s = stats[k];
      if (!s || s.qty < 2) continue; // no meaningful pace, no card
      const weekly = s.qty / 4;
      const perDay = weekly / 7;
      const avgPrice = s.qty ? s.revenue / s.qty : 0;
      const home = (it.levels || []).find(l => l.locationId === homeLoc) || {};
      const avail = Math.max(0, Number(home.available) || 0);
      const wfsLvl = (it.levels || []).find(l => /wfs/i.test(l.locationName || ''));
      const wfsAvail = wfsLvl ? Math.max(0, Number(wfsLvl.stockLevel) || 0) : 0;
      const padded = !!pads[k];
      // Missed: was selling, now nothing anywhere we ship from, not padded
      if (!padded && avail <= 0 && wfsAvail <= 0 && weekly >= 1) {
        const daysOut = Math.max(1, Math.round((now - s.last) / 86400000));
        missed.push({
          sku: it.sku, since: fmtDay(s.last), weekly: Math.round(weekly),
          channels: [...s.channels].join(' + ') || '—',
          value: Math.round(weekly * avgPrice * Math.min(4, daysOut / 7)),
        });
        continue;
      }
      // Buy soon: real shelf stock that runs out inside the lead window
      if (!padded && avail > 0 && perDay > 0) {
        const daysLeft = Math.floor(avail / perDay);
        if (daysLeft <= lead) {
          buy.push({
            sku: it.sku, avail, daysLeft,
            order: Math.max(1, Math.ceil(perDay * lead * 1.5 - avail)),
          });
        }
      }
      // Send to WFS: fast sellers whose 4-week pace outruns what WFS holds
      if (weekly >= 8 && avail > 0) {
        const send = Math.max(0, Math.round(weekly * 4 - wfsAvail));
        if (send > 0) {
          wfs.push({
            sku: it.sku, weekly: Math.round(weekly),
            coverDays: Math.floor(avail / perDay), send,
          });
        }
      }
    }
    missed.sort((a, b) => b.value - a.value);
    buy.sort((a, b) => a.daysLeft - b.daysLeft);
    wfs.sort((a, b) => b.weekly - a.weekly);
    return {
      missed: missed.slice(0, 6),
      missedTotal: missed.reduce((s, m) => s + m.value, 0),
      buy: buy.slice(0, 5),
      buyCount: buy.length,
      wfs: wfs.slice(0, 6),
      wfsUnits: wfs.slice(0, 6).reduce((s, w) => s + w.send, 0),
      leadDays: lead,
    };
  }

  ipcMain.handle('overview:data', async () => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const orders = {
      today: db.overviewToday(),
      series: {
        Day: db.overviewSeriesDay(),
        Month: db.overviewSeriesMonth(),
        Year: db.overviewSeriesYear(),
      },
    };
    let money = overviewCache.money;
    if (!money || Date.now() - overviewCache.at > OVERVIEW_TTL_MS) {
      if (!overviewCache.promise) {
        overviewCache.promise = computeOverviewMoney(cfg)
          .then(m => { overviewCache = { at: Date.now(), money: m, promise: null }; return m; })
          .catch(e => { overviewCache.promise = null; throw e; });
      }
      // stale view answers instantly while a refresh runs; first call waits
      if (!money) {
        try { money = await overviewCache.promise; } catch (e) { return { ok: true, orders, money: null, moneyError: e.message }; }
      } else {
        overviewCache.promise.catch(() => { /* stale money stands */ });
      }
    }
    return { ok: true, orders, money };
  });

  /* ---------- Temu lister: template intake + workbook export ---------- */

  const temuTemplatePath = () => path.join(app.getPath('userData'), 'temu-template.xlsx');

  ipcMain.handle('temu:state', () => {
    const cfg = config.load();
    return {
      ok: true,
      hasTemplate: fs.existsSync(temuTemplatePath()),
      template: cfg.temuTemplate || null,
      profiles: cfg.temuProfiles || {},
      packages: cfg.temuPackages || {},
      titles: cfg.temuTitles || {},
    };
  });

  // a typed title teaches the model family: stored with {storage}/{color}
  // tokens so every sibling SKU fills it in for itself
  ipcMain.handle('temu:titles', (_e, { model, title }) => {
    const cfg = config.load();
    const all = { ...(cfg.temuTitles || {}) };
    if (String(title || '').trim()) all[String(model).toUpperCase()] = String(title).trim();
    else delete all[String(model).toUpperCase()];
    config.save({ temuTitles: all });
    return { ok: true };
  });

  // The seller downloads Temu's category template once; the app keeps a copy
  // in userData and writes every export into a fresh copy of it.
  ipcMain.handle('temu:template', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Pick the Temu upload template (downloaded from Seller Central)',
      defaultPath: app.getPath('downloads'),
      properties: ['openFile'],
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    try {
      const { readTemplate } = require('./temuxlsx.js');
      const info = readTemplate(r.filePaths[0]); // throws when it is not a Temu template
      fs.copyFileSync(r.filePaths[0], temuTemplatePath());
      config.save({ temuTemplate: { name: path.basename(r.filePaths[0]), savedAt: new Date().toISOString() } });
      return { ok: true, name: path.basename(r.filePaths[0]), columns: info.columns.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('temu:packages', (_e, { model, pack }) => {
    const cfg = config.load();
    const all = { ...(cfg.temuPackages || {}) };
    if (pack) all[String(model).toUpperCase()] = pack;
    config.save({ temuPackages: all });
    return { ok: true };
  });

  // Export: host each variation's photos on its Linnworks item (Temu fetches
  // image URLs over the internet, same as eBay's PicURL), fill the template
  // copy, save to Documents. Nothing touches Temu until the seller uploads
  // the workbook in Seller Central.
  ipcMain.handle('temu:export', async (_e, { products }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    if (!fs.existsSync(temuTemplatePath())) return { ok: false, error: 'Pick the Temu template file first (gear button).' };
    try {
      const { fillWorkbook } = require('./temuxlsx.js');
      const client = new LinnworksClient(cfg.linnworks);
      for (const prod of products || []) {
        for (const v of prod.variations || []) {
          const paths = v.photoPaths || [];
          if (!paths.length) { v.images = v.images || []; continue; }
          let stockItemId = v.stockItemId;
          if (!stockItemId) stockItemId = await client.findStockItemIdBySku(v.sku).catch(() => null);
          if (!stockItemId) return { ok: false, error: `${v.sku} is not in Linnworks - photos need a home item.` };
          const files = paths.map((p, i) => {
            if (p && typeof p === 'object' && p.dataUrl) {
              const m = String(p.dataUrl).match(/^data:(image\/[a-z]+);base64,(.+)$/i);
              if (!m) throw new Error(`photo ${i + 1}: unreadable edited image`);
              return { buffer: Buffer.from(m[2], 'base64'), name: p.name || `photo-${i + 1}.jpg`, mime: m[1] };
            }
            const fp = typeof p === 'object' ? p.path : p;
            return {
              buffer: fs.readFileSync(fp),
              name: path.basename(fp),
              mime: /\.png$/i.test(fp) ? 'image/png' : /\.webp$/i.test(fp) ? 'image/webp' : 'image/jpeg',
            };
          });
          v.images = await client.addItemImages(stockItemId, files);
        }
      }
      const out = fillWorkbook(temuTemplatePath(), products, cfg.temuProfiles || {});
      const stamp = new Date();
      const name = `Temu-upload-${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}.xlsx`;
      const r = await dialog.showSaveDialog(win, {
        title: 'Save the Temu upload workbook',
        defaultPath: path.join(app.getPath('downloads'), name),
        filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      fs.writeFileSync(r.filePath, out);
      return { ok: true, path: r.filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Inline log editing: one UNIT of one return record. Record-level fields
  // (PO#, date, customer, tracking) apply to the whole record; SKU/condition
  // apply to the unit, splitting a qty>1 line when needed. Stock is
  // corrected only when the unit originally moved stock (targetSku set)
  // and its landing spot changes: -1 old target, +1 new target.
  ipcMain.handle('returns:editUnit', async (_e, { id, itemIndex, po, day, customer, tracking, sku, condition, note, units, receivedBy }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const rec = db.getReturn(Number(id));
    if (!rec) return { ok: false, error: 'Return not found.' };
    const newPo = String(po || '').trim();
    if (!newPo) return { ok: false, error: 'PO# is required.' };
    const newDay = String(day || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDay)) return { ok: false, error: 'Date must look like 2026-08-05.' };
    const createdAt = `${newDay}T${String(rec.created_at).split('T')[1] || '12:00:00.000Z'}`;
    const items = rec.items.slice();
    const ii = Number(itemIndex);
    const newSku = String(sku || '').trim();
    const newCond = String(condition || '').trim() || 'new';
    const newNote = String(note || '').trim().slice(0, 300);
    const newQty = Math.max(1, parseInt(units, 10) || 1);
    let recordNote = rec.note;
    let stockNote = '';
    try {
      if (ii >= 0) {
        const it = items[ii];
        if (!it) return { ok: false, error: 'Return line not found.' };
        if (!newSku) return { ok: false, error: 'Pick the returned SKU.' };
        const oldQty = Number(it.qty) || 1;
        let newTarget = it.targetSku || '';
        if (newSku !== it.sku || newCond !== it.condition) {
          if (newCond === 'new') newTarget = newSku;
          else {
            const skus = await getInventorySkus(cfg).catch(() => []);
            newTarget = (db.resolveConditionTargets(newSku, skus) || {})[newCond] || '';
            if (!newTarget && it.targetSku) {
              return { ok: false, error: `No ${newCond} listing mapped for ${newSku} — set it from the worksheet's condition menu first.` };
            }
          }
        }
        // stock corrections: target moved (swap old qty out, new qty in) or
        // quantity changed on the same target (delta the difference)
        if (it.targetSku) {
          const deltas = [];
          if (newTarget && newTarget !== it.targetSku) {
            deltas.push({ sku: it.targetSku, delta: -oldQty }, { sku: newTarget, delta: newQty });
            stockNote = `stock corrected: -${oldQty} ${it.targetSku}, +${newQty} ${newTarget}`;
          } else if (newQty !== oldQty) {
            deltas.push({ sku: it.targetSku, delta: newQty - oldQty });
            stockNote = `stock corrected: ${newQty > oldQty ? '+' : ''}${newQty - oldQty} ${it.targetSku}`;
          }
          if (deltas.length) {
            const client = new LinnworksClient(cfg.linnworks);
            await client.changeStockLevels(deltas, cfg.linnworks.locationId, 'Capture Station return edit');
          }
        }
        items[ii] = { ...it, sku: newSku, condition: newCond, targetSku: it.targetSku ? newTarget : '', note: newNote, qty: newQty };
      } else {
        // PO-only pseudo row: record fields, plus an item line if a SKU was
        // typed (log-only, no stock move — the unit never bumped stock)
        recordNote = newNote;
        if (newSku) items.push({ sku: newSku, condition: newCond, targetSku: '', qty: newQty, price: 0, note: '' });
      }
      db.saveReturn(rec.id, {
        orderNumber: newPo, createdAt,
        customer: String(customer || '').trim().slice(0, 120),
        tracking: String(tracking || '').trim().slice(0, 100),
        note: recordNote, items, unmatched: rec.unmatched,
        receivedBy: String(receivedBy || '').trim().slice(0, 60),
      });
      writeReturnsCsv();
      return { ok: true, stockNote };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('returns:deleteUnit', async (_e, { id, itemIndex, removeStock }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const rec = db.getReturn(Number(id));
    if (!rec) return { ok: false, error: 'Return not found.' };
    const ii = Number(itemIndex);
    let stockNote = '';
    try {
      if (ii < 0 || rec.items.length === 0) {
        db.deleteReturn(rec.id); // PO-only record: nothing ever moved stock
      } else {
        const it = rec.items[ii];
        if (!it) return { ok: false, error: 'Return line not found.' };
        const qty = Number(it.qty) || 1;
        if (removeStock && it.targetSku) {
          const client = new LinnworksClient(cfg.linnworks);
          await client.changeStockLevels(
            [{ sku: it.targetSku, delta: -qty }],
            cfg.linnworks.locationId, 'Capture Station return delete'
          );
          stockNote = `stock corrected: -${qty} ${it.targetSku}`;
        }
        const items = rec.items.slice();
        items.splice(ii, 1); // the row IS the line now — remove it whole
        if (items.length === 0) db.deleteReturn(rec.id);
        else {
          db.saveReturn(rec.id, {
            orderNumber: rec.order_number, createdAt: rec.created_at,
            customer: rec.customer, tracking: rec.tracking,
            note: rec.note, items, unmatched: rec.unmatched,
            receivedBy: rec.received_by,
          });
        }
      }
      writeReturnsCsv();
      return { ok: true, stockNote };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
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
  // Condition SKUs holding returned stock with no marketplace listing linked
  // yet: the employee's "go create the listing" list. Candidates = condition
  // naming (prefix or suffix) or saved mapping targets, with stock on hand;
  // each gets one GetInventoryItemChannelSKUs call, cached 10 minutes.
  // Every in-stock SKU with NO channel listing linked (not just returns
  // condition SKUs). One GetInventoryItemChannelSKUs call per in-stock item,
  // so the result is cached for an hour; `channels` is the set of sources
  // seen across the whole inventory (what "missing on" means here).
  // ONE scan feeds both surfaces: the Unlisted view (no listing anywhere)
  // and the per-channel missing sets — built from the item-level LINK
  // RECORDS, the only truthful source (the channel scan feed's LinkedItemId
  // is empty even on linked rows, verified live 2026-08-08).
  let unlistedScanRunning = null; // in-flight scan: boot timer + Refresh never race
  async function runUnlistedScan(cfg) {
    if (unlistedCache.detail && Date.now() - unlistedCache.at < 60 * 60 * 1000) return unlistedCache;
    if (unlistedScanRunning) return unlistedScanRunning;
    unlistedScanRunning = runUnlistedScanBody(cfg).finally(() => { unlistedScanRunning = null; });
    return unlistedScanRunning;
  }
  async function runUnlistedScanBody(cfg) {
    const client = new LinnworksClient(cfg.linnworks);
    const items = await client.listInventory();
    const ignore = new Set((cfg.unlistedIgnore || []).map(s => String(s).toUpperCase()));
    const inStock = items.filter(it => {
      if (!it.stockItemId) return false;
      if (ignore.has(String(it.sku).toUpperCase())) return false; // never-list SKUs
      const l = (it.levels || []).find(x => x.locationId === cfg.linnworks.locationId);
      return l && (Number(l.stockLevel) > 0 || Number(l.available) > 0);
    }).slice(0, 300);
    const universe = new Set();
    const detail = [];
    const sets = { walmart: [], ebay: [], temu: [] };
    const label = (src) => /walmart/i.test(src) ? 'walmart' : /ebay/i.test(src) ? 'ebay' : /temu/i.test(src) ? 'temu' : '';
    for (const it of inStock) {
      try {
        const channels = await client.getChannelSkus(it.stockItemId);
        for (const c of channels) {
          if (!c.source) continue;
          universe.add(String(c.source).toUpperCase());
          const l2 = label(c.source);
          if (l2 && !sets[l2].includes(it.stockItemId)) sets[l2].push(it.stockItemId);
        }
        if (channels.length) continue;
        const l = (it.levels || []).find(x => x.locationId === cfg.linnworks.locationId) || {};
        // "value idle" uses CHANNEL listing prices (owner request 2026-08-08
        // — Linnworks item retail prices are deliberately left empty here)
        let price = 0;
        try {
          const prices = await client.getChannelPrices(it.stockItemId);
          price = prices.reduce((m, p) => Math.max(m, p.price), 0);
        } catch { /* no stored channel price: the column shows an em-dash */ }
        detail.push({
          sku: String(it.sku).toUpperCase(),
          title: it.title || '',
          image: it.image || '',
          stockItemId: it.stockItemId, // the add-image button needs it
          avail: Math.max(Number(l.available) || 0, Number(l.stockLevel) || 0),
          retail: price,
        });
      } catch { /* one bad lookup never hides the rest */ }
    }
    detail.sort((a, b) => (b.avail * b.retail) - (a.avail * a.retail));
    unlistedCache = { at: Date.now(), skus: detail.map(d => d.sku), detail, channels: [...universe].sort(), sets, covered: inStock.map(i => i.stockItemId) };
    // the scan takes minutes: persist it so the NEXT boot shows cards at
    // once (stale-while-revalidate), and tell the renderer fresh data landed
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'unlisted-cache.json'), JSON.stringify(unlistedCache)); } catch { /* best effort */ }
    if (win && !win.isDestroyed()) win.webContents.send('unlisted:refreshed');
    return unlistedCache;
  }

  // Fast path: the full scan costs one throttled API call per in-stock SKU
  // (no truthful bulk endpoint exists), so it runs hourly at most. This
  // checks ONLY the items that scan never saw — the SKUs receiving/returns
  // just created — a handful of calls, seconds instead of minutes.
  async function runUnlistedDelta(cfg) {
    const stale = !unlistedCache.detail || Date.now() - unlistedCache.at > 60 * 60 * 1000;
    if (stale || !Array.isArray(unlistedCache.covered)) return runUnlistedScan(cfg);
    if (unlistedScanRunning) return unlistedScanRunning; // a full scan is already underway
    const client = new LinnworksClient(cfg.linnworks);
    const items = await client.listInventory();
    const ignore = new Set((cfg.unlistedIgnore || []).map(s => String(s).toUpperCase()));
    const inStock = items.filter(it => {
      if (!it.stockItemId) return false;
      if (ignore.has(String(it.sku).toUpperCase())) return false;
      const l = (it.levels || []).find(x => x.locationId === cfg.linnworks.locationId);
      return l && (Number(l.stockLevel) > 0 || Number(l.available) > 0);
    }).slice(0, 300);
    const covered = new Set(unlistedCache.covered);
    const freshItems = inStock.filter(it => !covered.has(it.stockItemId));
    // rows whose stock is gone (sold / corrected away) leave the list too
    const stillStocked = new Set(inStock.map(i => String(i.sku).toUpperCase()));
    const kept = unlistedCache.detail.filter(d => stillStocked.has(d.sku));
    let changed = kept.length !== unlistedCache.detail.length;
    const label = (src) => /walmart/i.test(src) ? 'walmart' : /ebay/i.test(src) ? 'ebay' : /temu/i.test(src) ? 'temu' : '';
    for (const it of freshItems) {
      try {
        const channels = await client.getChannelSkus(it.stockItemId);
        covered.add(it.stockItemId);
        changed = true;
        for (const c of channels) {
          if (!c.source) continue;
          const l2 = label(c.source);
          if (l2 && unlistedCache.sets && !unlistedCache.sets[l2].includes(it.stockItemId)) unlistedCache.sets[l2].push(it.stockItemId);
        }
        if (channels.length) continue;
        const l = (it.levels || []).find(x => x.locationId === cfg.linnworks.locationId) || {};
        let price = 0;
        try {
          const prices = await client.getChannelPrices(it.stockItemId);
          price = prices.reduce((m, p) => Math.max(m, p.price), 0);
        } catch { /* no stored channel price: the column shows an em-dash */ }
        kept.push({
          sku: String(it.sku).toUpperCase(),
          title: it.title || '',
          image: it.image || '',
          stockItemId: it.stockItemId,
          avail: Math.max(Number(l.available) || 0, Number(l.stockLevel) || 0),
          retail: price,
        });
      } catch { /* one bad lookup never hides the rest */ }
    }
    if (changed) {
      kept.sort((a, b) => (b.avail * b.retail) - (a.avail * a.retail));
      unlistedCache = { ...unlistedCache, skus: kept.map(d => d.sku), detail: kept, covered: [...covered] };
      try { fs.writeFileSync(path.join(app.getPath('userData'), 'unlisted-cache.json'), JSON.stringify(unlistedCache)); } catch { /* best effort */ }
      if (win && !win.isDestroyed()) win.webContents.send('unlisted:refreshed');
    }
    return unlistedCache;
  }

  function loadUnlistedDisk() {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'unlisted-cache.json'), 'utf8'));
      if (j && Array.isArray(j.detail)) unlistedCache = j;
    } catch { /* no saved scan yet */ }
  }

  ipcMain.handle('stock:unlisted', async (_e, { force } = {}) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    try {
      // cold boot: last session's scan answers INSTANTLY while a fresh scan
      // runs behind it ('unlisted:refreshed' swaps the cards when it lands)
      if (!unlistedCache.detail) loadUnlistedDisk();
      // Refresh must see SKUs created a minute ago. Young cache: only NEW
      // items can be missing, so the delta check answers in seconds — wait
      // for it and return an already-correct view. Stale cache: full rescan
      // in the background while the old view answers this call.
      if (force) {
        if (unlistedCache.detail && Date.now() - unlistedCache.at < 60 * 60 * 1000) {
          const c = await runUnlistedDelta(cfg);
          return { ok: true, skus: c.skus, detail: c.detail, channels: c.channels, ignored: cfg.unlistedIgnore || [] };
        }
        const prev = unlistedCache;
        unlistedCache = { at: 0, skus: null, detail: null, channels: [] };
        const scan = runUnlistedScan(cfg);
        if (prev.detail) {
          scan.catch(() => { if (!unlistedCache.detail) unlistedCache = prev; });
          return { ok: true, skus: prev.skus, detail: prev.detail, channels: prev.channels, ignored: cfg.unlistedIgnore || [], stale: true };
        }
        const c = await scan;
        return { ok: true, skus: c.skus, detail: c.detail, channels: c.channels, ignored: cfg.unlistedIgnore || [] };
      }
      if (unlistedCache.detail) {
        const stale = Date.now() - unlistedCache.at > 60 * 60 * 1000;
        if (stale) runUnlistedScan(cfg).catch(() => { /* the cards keep the stale view */ });
        return { ok: true, skus: unlistedCache.skus, detail: unlistedCache.detail, channels: unlistedCache.channels, ignored: cfg.unlistedIgnore || [], stale };
      }
      const c = await runUnlistedScan(cfg);
      return { ok: true, skus: c.skus, detail: c.detail, channels: c.channels, ignored: cfg.unlistedIgnore || [] };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // warm the listing scan shortly after boot so the cards never wait on a
  // page visit: SKUs created since the last scan get checked within seconds
  // (delta), and a stale cache triggers the full rescan behind the old view
  setTimeout(() => {
    const cfg = config.load();
    if (!cfg.captureOnly && cfg.linnworks && cfg.linnworks.applicationId) {
      loadUnlistedDisk();
      runUnlistedDelta(cfg).catch(() => { /* next visit retries */ });
    }
  }, 8000);

  // never-list toggle: claim bins and fakes leave the listings nag for good
  ipcMain.handle('stock:unlistedIgnore', (_e, { sku, remove }) => {
    const cfg = config.load();
    const key = String(sku || '').trim().toUpperCase();
    if (!key) return { ok: false, error: 'Missing SKU.' };
    const list = new Set((cfg.unlistedIgnore || []).map(s => String(s).toUpperCase()));
    if (remove) list.delete(key); else list.add(key);
    config.save({ unlistedIgnore: [...list].sort() });
    unlistedCache = { at: 0, skus: null, detail: null, channels: [] };
    return { ok: true, ignored: [...list].sort() };
  });
  // DropShip program + reorder points
  ipcMain.handle('dropship:setPad', async (_e, { sku, qty }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const key = String(sku || '').trim().toUpperCase();
    const n = Number(qty);
    if (!key) return { ok: false, error: 'Missing SKU.' };
    if (!Number.isInteger(n) || n < 0) return { ok: false, error: 'Pad must be a whole number of 0 or more.' };
    // Linnworks first (the program's source of truth), then the local mirror
    try {
      await new LinnworksClient(cfg.linnworks).setDropshipPad(key, n);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    config.save({ dropshipPads: { ...(cfg.dropshipPads || {}), [key]: n } });
    runPadMaintenance().catch(() => { /* next pass retries */ });
    return { ok: true };
  });
  ipcMain.handle('dropship:remove', async (_e, { sku }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const key = String(sku || '').trim().toUpperCase();
    const pads = { ...(cfg.dropshipPads || {}) };
    if (!(key in pads)) return { ok: false, error: 'Not in the program.' };
    const client = new LinnworksClient(cfg.linnworks);
    // zero the DropShip level first so nothing keeps selling from a pad
    try {
      await client.setDropshipPad(key, 0);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    pads[key] = 0;
    config.save({ dropshipPads: pads });
    await runPadMaintenance().catch(() => { /* best effort */ });
    // now leave the program: the property goes, every machine follows
    try {
      await client.setDropshipPad(key, null);
    } catch { /* property lingers at pad 0 - removing again retries */ }
    delete pads[key];
    config.save({ dropshipPads: pads });
    return { ok: true };
  });
  ipcMain.handle('dropship:stats', () => computeReorderStats());
  ipcMain.handle('reorder:apply', async (_e, { entries }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    const list = Array.isArray(entries) ? entries.slice(0, 500) : [];
    let applied = 0;
    const errors = [];
    try {
      const client = new LinnworksClient(cfg.linnworks);
      for (const e of list) {
        const min = Number(e.min);
        if (!e.stockItemId || !Number.isInteger(min) || min < 0) continue;
        try {
          await client.setStockMinimumLevel(e.stockItemId, cfg.linnworks.locationId, min);
          applied++;
        } catch (err) {
          errors.push(`${e.sku || e.stockItemId}: ${err.message}`);
        }
      }
      return { ok: true, applied, errors };
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
      // a hand-raised count on an unlisted SKU (found returns: OPEN-BOX /
      // USED / SCRAP) must reach the "needs listings" card at once, not
      // after the hour cache
      unlistedCache = { at: 0, skus: null, detail: null, channels: [] };
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
  // generic external open (default browser) — https only
  ipcMain.handle('app:openExternal', (_e, { url }) => {
    if (!/^https:\/\//i.test(String(url || ''))) return { ok: false, error: 'Only https links.' };
    shell.openExternal(String(url));
    return { ok: true };
  });
  ipcMain.handle('browser:open', (_e, { orderNumber, channel, url, kind }) => {
    const cfg = config.load();
    if (cfg.captureOnly) return { ok: false, error: 'Capture-only mode.' };
    let target = String(url || '');
    if (!target) {
      target = buildMarketUrl(cfg, channel, orderNumber, kind);
      if (!target) return { ok: false, error: 'No marketplace link set for this channel.' };
    }
    if (!/^https:\/\//i.test(target)) return { ok: false, error: 'Only https pages can load here.' };
    ensurePane().webContents.loadURL(target).catch(() => { /* nav errors show in-pane */ });
    return { ok: true };
  });
  // the pane header's globe: a native popup with the seller portals (native
  // so the marketplace page below can never draw over it); the current
  // site wears the checkmark
  ipcMain.handle('browser:platformMenu', () => {
    if (!paneView || !win || win.isDestroyed()) return { ok: false };
    const HOMES = [
      { label: 'Walmart Seller Center', key: 'walmart', url: 'https://seller.walmart.com/orders/manage-orders' },
      { label: 'eBay Seller Hub', key: 'ebay', url: 'https://www.ebay.com/sh/ord' },
      { label: 'Temu Seller Central', key: 'temu', url: 'https://seller.temu.com/' },
    ];
    let host = '';
    try { host = new URL(paneView.webContents.getURL()).hostname.toLowerCase(); } catch { /* blank pane */ }
    Menu.buildFromTemplate(HOMES.map(h => ({
      label: h.label,
      type: 'checkbox',
      checked: host.includes(h.key),
      click: () => { ensurePane().webContents.loadURL(h.url).catch(() => { /* nav errors show in-pane */ }); },
    }))).popup({ window: win });
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
  ipcMain.handle('browser:zoom', (_e, { dir }) => {
    if (!paneView) return { ok: false };
    return { ok: true, factor: paneSetZoom(dir) };
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
  win.webContents.on('did-finish-load', () => {
    if (!pendingNotice) return;
    win.webContents.send('app:notice', { message: pendingNotice });
    pendingNotice = '';
  });
  if (IS_DEMO) require('./demo.js').seedDemo(win, db);
  // Focus can strand on the native marketplace view (it is a separate
  // surface): the window looks active but keystrokes go nowhere and inputs
  // "stick". Whenever the WINDOW gains focus, hand the keyboard to the app's
  // own web contents — unless the pane is attached and deliberately in use.
  win.on('focus', () => {
    if (!paneAttached) win.webContents.focus();
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
              const res = db.backup();
              db.open();
              dialog.showMessageBox(win, {
                message: res.healthy
                  ? `Backup saved:\n${res.dest}`
                  : `The database failed its health check (${res.detail}) — the last good backup was kept untouched.\nA copy of the damaged file was saved for recovery:\n${res.dest}`,
              });
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

// Startup integrity gate: if the live db fails its health check, offer the
// newest healthy backup instead of limping along corrupt. The damaged file
// is quarantined beside the db either way; declining keeps the status quo.
function checkDbHealth() {
  const health = db.quickCheck();
  if (health.ok) return;
  const dir = path.join(app.getPath('userData'), 'backups');
  let good = null;
  try {
    const candidates = fs.readdirSync(dir)
      .filter(f => /^capture-station-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort()
      .reverse();
    for (const f of candidates) {
      if (db.checkFile(path.join(dir, f)).ok) { good = path.join(dir, f); break; }
    }
  } catch { /* no backups folder yet */ }
  const detail = String(health.detail || '').slice(0, 300);
  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    title: 'Capture Station',
    message: 'The local database failed its health check.',
    detail: good
      ? `Problem found: ${detail}\n\nRestore the most recent healthy backup?\n${path.basename(good)}\n\nThe damaged file is kept next to the database either way.`
      : `Problem found: ${detail}\n\nNo healthy backup was found. The app will continue, but some pages may fail until the database is repaired.`,
    buttons: good ? ['Restore backup', 'Continue anyway'] : ['Continue anyway'],
    defaultId: 0,
    cancelId: good ? 1 : 0,
  });
  if (good && choice === 0) {
    try {
      db.restoreFrom(good);
    } catch (e) {
      dialog.showErrorBox('Restore failed',
        `${e.message}\n\nUsually this means another Capture Station window is open and holding the database. Close every Capture Station window, then reopen the app and try again. Nothing was changed.`);
    }
  }
}

app.whenReady().then(() => {
  if (IS_TEST_RUN) {
    // isolated throwaway data dir for automated tests
    app.setPath('userData', path.join(app.getPath('temp'), `capture-station-e2e-${Date.now()}`));
    config.save({ csvFolder: path.join(app.getPath('userData'), 'csv') });
  }
  config.save({}); // re-persist so plaintext credentials migrate to encrypted storage
  checkDbHealth(); // corrupt db -> offer the newest healthy backup BEFORE anything reads it
  db.open();
  // one-time sweep: duplicate order rows minted while the db was damaged
  try {
    const dd = db.dedupeOrderRows();
    if (dd.removed || dd.conflicts) {
      pendingNotice = `Removed ${dd.removed} duplicate order row${dd.removed === 1 ? '' : 's'} left over from the database repair`
        + (dd.conflicts ? ` · ${dd.conflicts} kept for review (different tracking)` : '');
    }
  } catch { /* never block startup on housekeeping */ }
  writeDailyCsv();
  registerIpc();
  buildMenu();
  createWindow();
  startClipboardWatcher();
  startStockRouter();
  startOrderImporter();
  startLowStockWatcher();
  startClaims();

  if (process.env.CAPTURE_SMOKE === '1') {
    setTimeout(() => {
      console.log('SMOKE_OK');
      app.quit();
    }, 4000);
  }

  if (process.env.CAPTURE_E2E === '1') {
    // the suite gets a wrapped clipboard: every write is allowlisted for the
    // watcher, so the user's live copying during a run can't seed phantom rows
    const testClipboard = {
      writeText: (t) => { testClipboardAllow = String(t); clipboard.writeText(t); },
      // restoring the user's own clipboard must NOT count as test input —
      // their clipboard may hold a real PO# (it did, 2026-08-05)
      restoreText: (t) => { clipboard.writeText(t); },
      readText: () => clipboard.readText(),
    };
    require('./e2e-test')({ app, win, db, clipboard: testClipboard });
  }
});

app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => {
  if (clipboardTimer) clearInterval(clipboardTimer);
  // marketplace logins: force the cookie store to disk before exit
  if (paneView) session.fromPartition(PANE_PARTITION).cookies.flushStore().catch(() => { /* best effort */ });
  try { db.backup(); } catch { /* best effort on exit */ }
});
