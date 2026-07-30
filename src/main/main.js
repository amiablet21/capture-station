'use strict';
const { app, BrowserWindow, Menu, ipcMain, clipboard, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const config = require('./config');
const db = require('./db');
const { runSync, testConnection, isRunning } = require('./sync');

let win = null;
let clipboardTimer = null;
let lastClipboardText = null; // null = not primed yet; prime with current content on start
let currentRowId = null;
const undoStack = []; // { type: 'createRow'|'setTracking'|'addSerial', rowId, prev? }
const ignoredLog = []; // debug ring buffer of non-matching clipboard text
let lastAutoSyncDay = '';

if (process.env.CAPTURE_E2E === '1') {
  // keep compositing while the window is occluded so capturePage works in tests
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

// E2E runs against its own userData dir, so it may coexist with a normal instance.
if (process.env.CAPTURE_E2E !== '1') {
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
    rows: db.todayRows(),
    currentRowId,
    expecting: current && !current.tracking ? 'tracking' : null,
    canUndo: undoStack.length > 0,
    lastSync: cfg.lastSync,
    dryRun: !!cfg.dryRun,
    autoSync: cfg.autoSync,
    syncRunning: isRunning(),
    captureOnly: !!cfg.captureOnly,
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
    if (!channel) {
      ignoredLog.push({ at: new Date().toISOString(), text: trimmed.slice(0, 120) });
      if (ignoredLog.length > 200) ignoredLog.shift();
      if (win && !win.isDestroyed()) win.webContents.send('clipboard:ignored', { text: trimmed.slice(0, 120) });
      return;
    }
    ingestOrder(channel, trimmed);
  };
  clipboardTimer = setInterval(poll, config.load().clipboardPollMs || 300);
}

function ingestOrder(channel, orderNumber) {
  const existing = db.findByOrderNumber(orderNumber);
  if (existing) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('order:duplicate', { orderNumber, existing });
    }
    return;
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

function handleScan({ text, force }) {
  const value = String(text || '').trim();
  if (!value) return { ok: false, error: 'Empty scan.' };
  if (!currentRowId) {
    return { ok: false, error: 'No open order. Copy the order number from the marketplace page first.' };
  }
  const row = db.getRow(currentRowId);
  if (!row) { currentRowId = null; return { ok: false, error: 'Open order disappeared. Copy the order number again.' }; }

  const carrier = classifyTracking(value);
  if (!carrier && !force) {
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

async function triggerSync(trigger) {
  if (isRunning()) return { error: 'Sync already running' };
  pushState();
  const summary = await runSync({
    trigger,
    onProgress: (p) => { if (win && !win.isDestroyed()) win.webContents.send('sync:progress', p); },
  });
  if (win && !win.isDestroyed()) win.webContents.send('sync:done', summary);
  pushState();
  return summary;
}

function startAutoSyncScheduler() {
  setInterval(() => {
    const cfg = config.load();
    if (cfg.captureOnly) return;
    if (!cfg.autoSync || !cfg.autoSync.enabled) return;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = db.localDay(now);
    if (hhmm === cfg.autoSync.time && lastAutoSyncDay !== today) {
      lastAutoSyncDay = today;
      triggerSync('scheduled');
    }
  }, 20000);
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
  ipcMain.handle('sync:run', () => {
    if (config.load().captureOnly) return { error: 'Capture-only mode: syncing is turned off.' };
    return triggerSync('manual');
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
        { label: 'Ignored Clipboard Log', click: () => win && win.webContents.send('ui:open-debug') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- lifecycle ---------- */

app.whenReady().then(() => {
  if (process.env.CAPTURE_E2E === '1') {
    // isolated throwaway data dir for automated tests
    app.setPath('userData', path.join(app.getPath('temp'), `capture-station-e2e-${Date.now()}`));
    config.save({ csvFolder: path.join(app.getPath('userData'), 'csv') });
  }
  db.open();
  writeDailyCsv();
  registerIpc();
  buildMenu();
  createWindow();
  startClipboardWatcher();
  startAutoSyncScheduler();

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
