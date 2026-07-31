'use strict';
/* global api */

if (!window.api) {
  // Browser preview without Electron: static demo data, all actions inert.
  const now = Date.now();
  const at = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const demo = {
    rows: [
      { id: 4, created_at: at(2), channel: 'ebay', order_number: '02-13457-88190', tracking: '', carrier: '', serials: [], notes: '', status: 'pending', fail_reason: '', synced_at: '' },
      { id: 3, created_at: at(9), channel: 'temu', order_number: 'PO-211-19077242886152', tracking: '', carrier: '', serials: [], notes: 'customer wants blue case', status: 'pending', fail_reason: '', synced_at: '' },
      { id: 2, created_at: at(21), channel: 'walmart', order_number: '119121297240391', tracking: '9234890188836109551834', carrier: 'USPS', serials: [], notes: '', status: 'captured', fail_reason: '', synced_at: '' },
      { id: 1, created_at: at(34), channel: 'walmart', order_number: '119121297218456', tracking: '1Z59E67A031142877', carrier: 'UPS', serials: [], notes: 'IMEI 351007743310296', status: 'captured', fail_reason: '', synced_at: '' },
    ],
    currentRowId: 4,
    todayCount: 4,
    expecting: 'tracking',
    canUndo: true,
    lastSync: { at: at(5), synced: 12, failed: 1, total: 13, dryRun: true, error: null },
    dryRun: true,
    syncRunning: false,
    captureOnly: true,
    csv: { path: 'C:\\Users\\packer\\Documents\\Capture Station\\capture-2026-07-30.csv', at: at(0), error: null },
  };
  window.api = {
    getState: async () => demo,
    submitScan: async () => ({ ok: false, error: 'Preview mode, scanning is inert.' }),
    nextOrder: async () => ({ ok: true }),
    addOrderAnyway: async () => ({ ok: true }),
    reopenRow: async () => ({ ok: true }),
    undo: async () => ({ ok: true, message: 'Preview mode' }),
    updateRow: async () => ({ ok: true }),
    deleteRow: async () => ({ ok: true }),
    runSync: async () => ({}),
    getConfig: async () => ({ linnworks: { applicationId: '', applicationSecret: '', token: '', locationId: '', locationName: '' }, dryRun: true, stockRouting: { enabled: false, fallbackLocationId: '', fallbackLocationName: '' }, settingsPinHash: '', orderPatterns: [], trackingPatterns: [], serialPatterns: [] }),
    setConfig: async () => ({}),
    exportCsv: async () => ({ ok: false }),
    openCsvFolder: async () => ({ ok: true }),
    chooseCsvFolder: async () => ({ ok: false, folder: '' }),
    testLinnworks: async () => ({ ok: false, error: 'Preview mode' }),
    getDebugLog: async () => [],
    getHistory: async () => demo.rows,
    getStock: async () => ({ ok: false, error: 'Preview mode' }),
    setStockLevel: async () => ({ ok: false, error: 'Preview mode' }),
    addStockImage: async () => ({ ok: false, error: 'Preview mode' }),
    addStockImageUrl: async () => ({ ok: false, error: 'Preview mode' }),
    saveStockImage: async () => ({ ok: false, error: 'Preview mode' }),
    wfsList: async () => [],
    wfsCreate: async () => ({ ok: false, error: 'Preview mode' }),
    copyText: async () => ({ ok: true }),
    on: () => {},
  };
}

let state = null;
let pendingConfirm = null; // { value, reason, duplicate }
let editingRowId = null;
let toastTimer = null;
const knownRowIds = new Set();
let firstRender = true;

const $ = (id) => document.getElementById(id);
const scanInput = $('scanInput');

/* ---------- helpers ---------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function shorten(s, n = 12) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function channelLabel(c) {
  return { walmart: 'Walmart', ebay: 'eBay', temu: 'Temu' }[c] || c;
}

function toast(msg, ms = 2200) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  el.classList.remove('is-out');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('is-out');
    toastTimer = setTimeout(() => { el.hidden = true; el.classList.remove('is-out'); }, 200);
  }, ms);
}

// Phosphor bold icons (MIT), 256 viewBox
const ICONS = {
  barcode: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M232,52V92a12,12,0,0,1-24,0V64H180a12,12,0,0,1,0-24h40A12,12,0,0,1,232,52ZM76,192H48V164a12,12,0,0,0-24,0v40a12,12,0,0,0,12,12H76a12,12,0,0,0,0-24Zm144-40a12,12,0,0,0-12,12v28H180a12,12,0,0,0,0,24h40a12,12,0,0,0,12-12V164A12,12,0,0,0,220,152ZM36,104A12,12,0,0,0,48,92V64H76a12,12,0,0,0,0-24H36A12,12,0,0,0,24,52V92A12,12,0,0,0,36,104ZM88,80A12,12,0,0,0,76,92v72a12,12,0,0,0,24,0V92A12,12,0,0,0,88,80Zm92,84V92a12,12,0,0,0-24,0v72a12,12,0,0,0,24,0ZM128,80a12,12,0,0,0-12,12v72a12,12,0,0,0,24,0V92A12,12,0,0,0,128,80Z"/></svg>',
  pencil: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M230.14,70.54,185.46,25.85a20,20,0,0,0-28.29,0L33.86,149.17A19.85,19.85,0,0,0,28,163.31V208a20,20,0,0,0,20,20H92.69a19.86,19.86,0,0,0,14.14-5.86L230.14,98.82a20,20,0,0,0,0-28.28ZM91,204H52V165l84-84,39,39ZM192,103,153,64l18.34-18.34,39,39Z"/></svg>',
  trash: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M216,48H180V36A28,28,0,0,0,152,8H104A28,28,0,0,0,76,36V48H40a12,12,0,0,0,0,24h4V208a20,20,0,0,0,20,20H192a20,20,0,0,0,20-20V72h4a12,12,0,0,0,0-24ZM100,36a4,4,0,0,1,4-4h48a4,4,0,0,1,4,4V48H100Zm88,168H68V72H188ZM116,104v64a12,12,0,0,1-24,0V104a12,12,0,0,1,24,0Zm48,0v64a12,12,0,0,1-24,0V104a12,12,0,0,1,24,0Z"/></svg>',
};

/* ---------- rendering ---------- */

function statusTitle(row) {
  const map = {
    pending: 'Waiting for scans',
    captured: 'Ready',
    synced: 'Synced to Linnworks',
    failed: row.fail_reason || 'Failed',
  };
  return map[row.status] || row.status;
}

function trackingCell(row) {
  if (!row.tracking) {
    if (state && row.id === state.currentRowId) {
      return '<span class="tracking-now">Scan tracking now&hellip;</span>'
        + '<button class="tracking-cancel" data-act="cancelwait" title="Stop waiting for this order\'s tracking">✕</button>';
    }
    return '<button class="tracking-add" data-act="open" title="Click, then scan or type this order\'s tracking">+ Add tracking</button>';
  }
  const label = row.carrier ? `${esc(row.carrier)} ${esc(row.tracking)}` : esc(row.tracking);
  return `<span class="copyable" data-copy="${esc(row.tracking)}" title="Click to copy ${esc(row.tracking)}">${label}</span>`;
}

function notesCell(row) {
  if (!row.notes) return '<button class="note-add" data-act="note" title="Add a note (serial number, condition, anything)">+ Note</button>';
  return `<button class="note-text note-btn" data-act="note" title="${esc(row.notes)}&#10;Click to edit">${esc(row.notes)}</button>`;
}

function render() {
  if (!state) return;

  $('orderCount').textContent = state.todayCount ?? state.rows.length;
  $('dayCountBox').hidden = activePage !== 'capture'; // capture stat, not a stock stat
  $('nextOrderBtn').disabled = !state.currentRowId;
  $('undoBtn').disabled = !state.canUndo;
  $('dryRunChip').hidden = !state.dryRun;

  // expected-input line
  const current = state.rows.find(r => r.id === state.currentRowId);
  const expectEl = $('expectLine');
  if (!current || state.expecting !== 'tracking') {
    expectEl.innerHTML = 'Copy an order number, then scan its label';
  } else {
    expectEl.innerHTML = `Waiting for: <strong>TRACKING</strong> &middot; <span class="mono">${esc(shorten(current.order_number, 18))}</span> ${esc(channelLabel(current.channel))}`;
  }

  // footer: capture-only shows the CSV mirror, otherwise the sync controls
  const syncEl = $('syncStatus');
  $('syncBtn').hidden = state.captureOnly || activePage !== 'capture';
  $('pageTabs').hidden = state.captureOnly;
  $('openCsvBtn').hidden = !state.captureOnly;
  if (activePage !== 'capture') $('dryRunChip').hidden = true;
  if (state.captureOnly) {
    $('dryRunChip').hidden = true;
    if (state.csv && state.csv.error) {
      syncEl.textContent = state.csv.error;
      syncEl.classList.add('is-fail');
    } else if (state.csv) {
      const name = state.csv.path.split(/[\\/]/).pop();
      syncEl.textContent = `Saving to ${name}`;
      syncEl.classList.remove('is-fail');
    } else {
      syncEl.textContent = '';
    }
  } else if (state.syncRunning) {
    syncEl.textContent = 'Syncing…';
    syncEl.classList.remove('is-fail');
  } else if (state.lastSync) {
    const t = fmtTime(state.lastSync.at);
    if (state.lastSync.error) {
      syncEl.textContent = `Last sync ${t}: ${state.lastSync.error}`;
      syncEl.classList.add('is-fail');
    } else {
      const dry = state.lastSync.dryRun ? ' (dry run)' : '';
      syncEl.textContent = `Last sync ${t}: ${state.lastSync.synced} synced, ${state.lastSync.failed} failed${dry}`;
      syncEl.classList.toggle('is-fail', state.lastSync.failed > 0);
    }
  } else {
    syncEl.textContent = 'Never synced';
    syncEl.classList.remove('is-fail');
  }
  $('syncBtn').disabled = !!state.syncRunning;

  // rows table
  const empty = state.rows.length === 0;
  $('rowsTable').hidden = empty;
  $('rowsEmpty').hidden = !empty;
  const total = state.rows.length;
  $('rowsBody').innerHTML = state.rows.map((row, idx) => `
    <tr class="${row.id === state.currentRowId ? 'is-current' : ''} ${!firstRender && !knownRowIds.has(row.id) ? 'is-new' : ''}" data-id="${row.id}">
      <td class="cell-gutter st-${esc(row.status)}" title="${esc(statusTitle(row))} · ${fmtTime(row.created_at)}">${total - idx}</td>
      <td class="cell-order" title="Captured ${fmtTime(row.created_at)}">
        <span class="badge badge-${esc(row.channel)}">${esc(channelLabel(row.channel))}</span>
        <span class="order-num copyable" data-copy="${esc(row.order_number)}" title="Click to copy">${esc(row.order_number)}</span>${
        row.status === 'failed' && row.fail_reason ? `<span class="fail-note" title="${esc(row.fail_reason)}">${esc(row.fail_reason)}</span>` : ''}</td>
      <td class="cell-tracking">${trackingCell(row)}</td>
      <td class="cell-notes">${notesCell(row)}</td>
      <td class="cell-actions">
        <span class="row-actions">
          ${row.id !== state.currentRowId && !row.tracking ? `<button class="btn-icon" data-act="open" title="Scan tracking">${ICONS.barcode}</button>` : ''}
          <button class="btn-icon" data-act="edit" title="Edit / add notes">${ICONS.pencil}</button>
          <button class="btn-icon is-danger" data-act="del" title="Delete">${ICONS.trash}</button>
        </span>
      </td>
    </tr>`).join('');
  knownRowIds.clear();
  state.rows.forEach(r => knownRowIds.add(r.id));
  firstRender = false;
}

async function refresh() {
  state = await api.getState();
  render();
}

/* ---------- scan flow ---------- */

function showWarn({ reason, danger, confirmable = true }) {
  const b = $('warnBanner');
  $('warnText').textContent = reason;
  $('warnAccept').hidden = !confirmable;
  b.classList.toggle('is-danger', !!danger);
  b.hidden = false;
}

function clearWarn() {
  $('warnBanner').hidden = true;
  pendingConfirm = null;
}

async function submitScan(value, force) {
  const res = await api.submitScan(value, force);
  if (res.ok) {
    clearWarn();
    state = await api.getState();
    render();
    return;
  }
  if (res.needsConfirm) {
    pendingConfirm = { value: res.value };
    showWarn({ reason: res.reason, danger: !!res.duplicate });
    return;
  }
  showWarn({ reason: res.error || 'Scan rejected.', danger: !!res.clipped, confirmable: false });
}

scanInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const value = scanInput.value.trim();
  scanInput.value = '';
  if (!value) return;
  clearWarn();
  submitScan(value, false);
});

$('warnAccept').addEventListener('click', async () => {
  if (!pendingConfirm) return clearWarn();
  const pc = pendingConfirm;
  clearWarn();
  if (pc.kind === 'order') {
    await api.addOrderAnyway(pc.channel, pc.value);
    await refresh();
  } else {
    submitScan(pc.value, true);
  }
  focusScan();
});

$('warnDiscard').addEventListener('click', () => { clearWarn(); focusScan(); });

$('nextOrderBtn').addEventListener('click', async () => {
  clearWarn();
  await api.nextOrder();
  await refresh();
  focusScan();
});

$('undoBtn').addEventListener('click', async () => {
  const res = await api.undo();
  if (res.ok && res.message) toast(res.message);
  await refresh();
  focusScan();
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) {
    e.preventDefault();
    $('undoBtn').click();
  }
});

/* ---------- rows list actions ---------- */

async function copyFromApp(text) {
  await api.copyText(text);
  toast(`Copied ${text}`);
}

$('rowsBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  const copyEl = e.target.closest('[data-copy]');
  if (!btn && copyEl) { copyFromApp(copyEl.dataset.copy); return; }
  if (!btn) return;
  const card = e.target.closest('tr');
  const id = Number(card.dataset.id);
  const row = state.rows.find(r => r.id === id);
  if (!row) return;

  if (btn.dataset.act === 'open') {
    await api.reopenRow(id);
    await refresh();
    focusScan();
  } else if (btn.dataset.act === 'cancelwait') {
    await api.nextOrder();
    await refresh();
    focusScan();
  } else if (btn.dataset.act === 'edit') {
    openEdit(row);
  } else if (btn.dataset.act === 'note') {
    openNotes(row);
  } else if (btn.dataset.act === 'del') {
    if (confirm(`Delete capture for order ${row.order_number}?`)) {
      await api.deleteRow(id);
      await refresh();
    }
    focusScan();
  }
});

/* ---------- edit dialog ---------- */

function openEdit(row) {
  editingRowId = row.id;
  $('editOrder').value = row.order_number;
  $('editChannel').value = row.channel;
  $('editTracking').value = row.tracking;
  $('editNotes').value = row.notes || '';
  $('editDialog').showModal();
}

$('editForm').addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value === 'cancel') { editingRowId = null; return; }
  await api.updateRow(editingRowId, {
    order_number: $('editOrder').value.trim(),
    channel: $('editChannel').value,
    tracking: $('editTracking').value.trim(),
    notes: $('editNotes').value.trim(),
  });
  editingRowId = null;
  await refresh();
});

$('editDialog').addEventListener('close', () => focusScan());

/* ---------- notes dialog ---------- */

let notesRowId = null;

function openNotes(row) {
  notesRowId = row.id;
  $('notesTitle').textContent = `Note for ${row.order_number}`;
  $('notesText').value = row.notes || '';
  $('notesDialog').showModal();
  $('notesText').focus();
}

$('notesForm').addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value === 'cancel') { notesRowId = null; return; }
  await api.updateRow(notesRowId, { notes: $('notesText').value.trim() });
  notesRowId = null;
  await refresh();
});

$('notesDialog').addEventListener('close', () => focusScan());

/* ---------- settings dialog ---------- */

function patternsToText(list, key) {
  return (list || []).map(p => `${p[key]} = ${p.pattern}`).join('\n');
}

function textToPatterns(text, key) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const i = l.indexOf('=');
    if (i < 1) return null;
    return { [key]: l.slice(0, i).trim(), pattern: l.slice(i + 1).trim() };
  }).filter(Boolean);
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

let settingsUnlocked = false; // stays unlocked for the rest of the session
let pinExpected = '';

function openPinPrompt() {
  $('pinInput').value = '';
  $('pinError').hidden = true;
  $('pinDialog').showModal();
  $('pinInput').focus();
}

$('pinForm').addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  e.preventDefault();
  const hash = await sha256Hex($('pinInput').value.trim());
  if (hash !== pinExpected) {
    $('pinError').hidden = false;
    $('pinInput').value = '';
    $('pinInput').focus();
    return;
  }
  settingsUnlocked = true;
  $('pinDialog').close();
  openSettings();
});

$('pinDialog').addEventListener('close', () => focusScan());

async function openSettings() {
  const cfg = await api.getConfig();
  if (cfg.settingsPinHash && !settingsUnlocked) {
    pinExpected = cfg.settingsPinHash;
    openPinPrompt();
    return;
  }
  $('setCaptureOnly').checked = !!cfg.captureOnly;
  $('setCsvFolder').textContent = cfg.csvFolder || 'Documents\\Capture Station';
  $('setAppId').value = cfg.linnworks.applicationId;
  $('setAppSecret').value = cfg.linnworks.applicationSecret;
  $('setToken').value = cfg.linnworks.token;
  const sel = $('setLocation');
  sel.innerHTML = cfg.linnworks.locationId
    ? `<option value="${esc(cfg.linnworks.locationId)}">${esc(cfg.linnworks.locationName || cfg.linnworks.locationId)}</option>`
    : '<option value="">Not selected, test connection first</option>';
  $('setDryRun').checked = !!cfg.dryRun;
  const sr = cfg.stockRouting || {};
  $('setRouting').checked = !!sr.enabled;
  const fsel = $('setFallbackLoc');
  fsel.innerHTML = sr.fallbackLocationId
    ? `<option value="${esc(sr.fallbackLocationId)}">${esc(sr.fallbackLocationName || sr.fallbackLocationId)}</option>`
    : '<option value="">Not selected, test connection first</option>';
  $('setOrderPatterns').value = patternsToText(cfg.orderPatterns, 'channel');
  $('setTrackingPatterns').value = patternsToText(cfg.trackingPatterns, 'carrier');
  $('setPin').value = '';
  $('setPinClear').checked = false;
  $('testConnResult').textContent = '';
  $('testConnResult').className = 'test-result';
  $('settingsDialog').showModal();
}

$('settingsBtn').addEventListener('click', openSettings);

$('testConnBtn').addEventListener('click', async () => {
  const out = $('testConnResult');
  out.className = 'test-result';
  out.textContent = 'Connecting…';
  const res = await api.testLinnworks({
    applicationId: $('setAppId').value.trim(),
    applicationSecret: $('setAppSecret').value.trim(),
    token: $('setToken').value.trim(),
  });
  if (!res.ok) {
    out.textContent = res.error;
    out.classList.add('is-fail');
    return;
  }
  out.textContent = `Connected: ${res.server.replace('https://', '')}`;
  out.classList.add('is-ok');
  for (const id of ['setLocation', 'setFallbackLoc']) {
    const sel = $(id);
    const prev = sel.value;
    sel.innerHTML = res.locations.map(l =>
      `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
    if (res.locations.some(l => l.id === prev)) sel.value = prev;
  }
});

$('chooseCsvBtn').addEventListener('click', async () => {
  const res = await api.chooseCsvFolder();
  if (res.folder) $('setCsvFolder').textContent = res.folder;
});

$('settingsSave').addEventListener('click', async () => {
  const sel = $('setLocation');
  const pinVal = $('setPin').value.trim();
  const pinPatch = $('setPinClear').checked
    ? { settingsPinHash: '' }
    : (pinVal ? { settingsPinHash: await sha256Hex(pinVal) } : {});
  await api.setConfig({
    ...pinPatch,
    captureOnly: $('setCaptureOnly').checked,
    linnworks: {
      applicationId: $('setAppId').value.trim(),
      applicationSecret: $('setAppSecret').value.trim(),
      token: $('setToken').value.trim(),
      locationId: sel.value,
      locationName: sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '',
    },
    dryRun: $('setDryRun').checked,
    stockRouting: {
      enabled: $('setRouting').checked,
      fallbackLocationId: $('setFallbackLoc').value,
      fallbackLocationName: $('setFallbackLoc').selectedOptions[0] ? $('setFallbackLoc').selectedOptions[0].textContent : '',
    },
    orderPatterns: textToPatterns($('setOrderPatterns').value, 'channel'),
    trackingPatterns: textToPatterns($('setTrackingPatterns').value, 'carrier'),
  });
  $('settingsDialog').close();
  await refresh();
  toast('Settings saved');
});

$('settingsCancel').addEventListener('click', () => $('settingsDialog').close());
$('settingsDialog').addEventListener('close', () => focusScan());

/* ---------- sync ---------- */

$('syncBtn').addEventListener('click', async () => {
  $('syncBtn').disabled = true;
  $('syncStatus').textContent = 'Syncing…';
  await api.runSync(); // results arrive via sync:done event
});

$('openCsvBtn').addEventListener('click', async () => {
  await api.openCsvFolder();
  focusScan();
});

function showSyncResults(summary) {
  const title = summary.error
    ? `Sync failed: ${summary.error}`
    : `${summary.dryRun ? 'Dry run: ' : ''}${summary.synced} synced, ${summary.failed} failed of ${summary.total}`;
  $('syncDialogTitle').textContent = title;
  const list = $('syncDialogList');
  const details = summary.details || [];
  list.innerHTML = details.length === 0
    ? '<p class="dlg-note">Nothing to send. Rows are sent to Linnworks once they have a tracking number.</p>'
    : details.map(d => `
      <div class="sync-item ${d.ok ? '' : 'is-fail'}">
        <span class="mono">${esc(d.orderNumber)}</span>
        <span class="sync-item-msg">${esc(d.message)}</span>
      </div>`).join('');
  $('syncDialog').showModal();
}

$('syncDialogClose').addEventListener('click', () => $('syncDialog').close());
$('syncDialog').addEventListener('close', () => focusScan());

/* ---------- page tabs: Capture / Stock ---------- */

let activePage = 'capture';

function showPage(page) {
  activePage = page;
  $('scanPanel').hidden = page !== 'capture';
  document.querySelector('main.rows').hidden = page !== 'capture';
  $('stockPage').hidden = page !== 'stock';
  $('tabCapture').classList.toggle('is-active', page === 'capture');
  $('tabStock').classList.toggle('is-active', page === 'stock');
  if (page === 'stock') {
    const savedW = Number(localStorage.getItem('stockSheetWidth')) || 0;
    $('stockList').style.width = savedW ? `${savedW}px` : '';
    $('stockSearch').value = '';
    loadStock().then(() => $('stockSearch').focus());
  } else {
    focusScan();
  }
  if (state) render(); // footer buttons depend on the active page
}

$('tabCapture').addEventListener('click', () => showPage('capture'));
$('tabStock').addEventListener('click', () => showPage('stock'));

/* ---------- stock page ---------- */

let stockCache = null;

// column sort: key + direction, toggled by clicking headers
const STOCK_COLS = {
  sku: { label: 'SKU', get: r => r.sku, text: true },
  stockLevel: { label: 'In stock', get: r => r.l.stockLevel },
  inOrders: { label: 'In orders', get: r => r.l.inOrders },
  minimumLevel: { label: 'Min', get: r => r.l.minimumLevel },
  available: { label: 'Available', get: r => r.l.available },
};
let stockSort = { key: 'stockLevel', dir: -1 }; // default: highest stock first

// user-adjusted column widths, persisted across sessions
let stockColWidths = {};
try { stockColWidths = JSON.parse(localStorage.getItem('stockColWidths') || '{}'); } catch { /* fresh start */ }

function stockTh(key, extraClass = '') {
  const col = STOCK_COLS[key];
  const arrow = stockSort.key === key ? (stockSort.dir < 0 ? ' ▾' : ' ▴') : '';
  const w = stockColWidths[key];
  const style = w ? ` style="width:${w}px;min-width:${w}px;max-width:${w}px"` : '';
  return `<th class="sortable ${extraClass}" data-sort="${key}"${style} title="Click to sort · drag edge to resize">${col.label}${arrow}<span class="col-grip" data-grip="${key}"></span></th>`;
}

async function loadStock() {
  $('stockList').innerHTML = '<div class="stock-loading"><span class="spinner" aria-label="Loading"></span></div>';
  $('stockSummary').textContent = '';
  const res = await api.getStock();
  if (!res.ok) {
    $('stockList').innerHTML = `<p class="dlg-note">${esc(res.error || 'Could not load stock.')}</p>`;
    return;
  }
  stockCache = res;
  renderStock();
}

function renderStock() {
  if (!stockCache) return;
  const q = $('stockSearch').value.trim().toLowerCase();
  const locId = stockCache.locationId;
  const rows = stockCache.items
    .map(it => ({ ...it, l: it.levels.find(x => x.locationId === locId) || { stockLevel: 0, inOrders: 0, due: 0, minimumLevel: 0, available: 0 } }))
    .filter(it => !q
      || it.sku.toLowerCase().includes(q)
      || it.title.toLowerCase().includes(q)
      || (it.barcode || '').toLowerCase().includes(q)
      || (it.category || '').toLowerCase().includes(q))
    .sort((a, b) => {
      const col = STOCK_COLS[stockSort.key] || STOCK_COLS.stockLevel;
      const av = col.get(a);
      const bv = col.get(b);
      const cmp = col.text ? String(av).localeCompare(String(bv)) : (av - bv);
      return (cmp * stockSort.dir) || a.sku.localeCompare(b.sku);
    });
  const units = rows.reduce((s, r) => s + r.l.stockLevel, 0);
  $('stockSummary').textContent = `${rows.length} SKUs · ${units.toLocaleString()} units`;
  $('stockList').innerHTML = rows.length === 0
    ? '<p class="dlg-note">No SKUs match.</p>'
    : `<table class="stock-table">
        <thead><tr>
          <th class="th-gutter">#</th>
          <th class="th-img"></th>
          ${stockTh('sku')}
          ${stockTh('stockLevel', 'num th-level')}
          ${stockTh('inOrders', 'num')}
          ${stockTh('minimumLevel', 'num')}
          ${stockTh('available', 'num')}
        </tr></thead>
        <tbody>${rows.map((r, idx) => `
          <tr class="${r.l.available <= 0 ? 'is-out' : ''}">
            <td class="cell-gutter">${idx + 1}</td>
            <td class="cell-img"><button class="img-btn" data-imgsku="${esc(r.sku)}" data-sid="${esc(r.stockItemId || '')}" title="${r.image ? 'Click to add another image' : 'Click to add an image'}">${r.image ? `<img class="stock-img" src="${esc(r.image)}" loading="lazy" alt="" />` : '<span class="stock-img stock-img-none">+</span>'}</button></td>
            <td class="mono copyable" data-copy="${esc(r.sku)}" title="${esc(r.title)}&#10;Click to copy">${esc(r.sku)}</td>
            <td class="num cell-level"><button class="stock-num-btn" data-sku="${esc(r.sku)}" title="Click to correct the count">${r.l.stockLevel}</button></td>
            <td class="num">${r.l.inOrders}</td>
            <td class="num">${r.l.minimumLevel}</td>
            <td class="num stock-avail">${r.l.available}</td>
          </tr>`).join('')}</tbody>
      </table>`;
}

// Inline edit of the In stock number: click -> type -> Enter saves to Linnworks.
function beginStockEdit(btn) {
  const sku = btn.dataset.sku;
  const current = btn.textContent.trim();
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.value = current;
  input.className = 'input stock-edit';
  let done = false;
  const restore = () => { if (input.parentNode) input.replaceWith(btn); };
  const commit = async () => {
    if (done) return;
    done = true;
    const val = input.value.trim();
    if (val === '' || Number(val) === Number(current)) { restore(); return; }
    input.disabled = true;
    const res = await api.setStockLevel(sku, Number(val));
    if (!res.ok) {
      toast(res.error || 'Stock update failed');
      restore();
      return;
    }
    const item = stockCache && stockCache.items.find(i => i.sku === sku);
    if (item) {
      let l = item.levels.find(x => x.locationId === stockCache.locationId);
      if (!l) { l = { locationId: stockCache.locationId }; item.levels.push(l); }
      l.stockLevel = res.stockLevel;
      l.inOrders = res.inOrders;
      l.available = res.available;
    }
    renderStock();
    toast(`${sku}: stock set to ${res.stockLevel}`);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { done = true; restore(); }
  });
  input.addEventListener('blur', commit);
  btn.replaceWith(input);
  input.focus();
  input.select();
}

$('stockRefresh').addEventListener('click', loadStock);
$('stockSearch').addEventListener('input', renderStock);
// whole-sheet resize: drag the handle on the right edge of the table
let sheetDrag = null;

$('sheetGrip').addEventListener('mousedown', (e) => {
  e.preventDefault();
  sheetDrag = { startX: e.clientX, startW: $('stockList').offsetWidth, w: 0 };
  $('sheetGrip').classList.add('is-active');
});

window.addEventListener('mousemove', (e) => {
  if (!sheetDrag) return;
  const w = Math.max(480, sheetDrag.startW + (e.clientX - sheetDrag.startX));
  sheetDrag.w = w;
  $('stockList').style.width = `${w}px`;
});

window.addEventListener('mouseup', () => {
  if (!sheetDrag) return;
  if (sheetDrag.w) localStorage.setItem('stockSheetWidth', String(sheetDrag.w));
  sheetDrag = null;
  $('sheetGrip').classList.remove('is-active');
});

$('sheetGrip').addEventListener('dblclick', () => {
  localStorage.removeItem('stockSheetWidth');
  $('stockList').style.width = '';
});

// column resize: drag a header's right edge; double-click the edge to reset
let gripDrag = null;
let suppressSortUntil = 0;

$('stockList').addEventListener('mousedown', (e) => {
  const grip = e.target.closest('.col-grip');
  if (!grip) return;
  e.preventDefault();
  const th = grip.closest('th');
  gripDrag = { key: grip.dataset.grip, startX: e.clientX, startW: th.offsetWidth, th, w: 0 };
});

window.addEventListener('mousemove', (e) => {
  if (!gripDrag) return;
  const w = Math.max(50, gripDrag.startW + (e.clientX - gripDrag.startX));
  gripDrag.w = w;
  gripDrag.th.style.width = `${w}px`;
  gripDrag.th.style.minWidth = `${w}px`;
  gripDrag.th.style.maxWidth = `${w}px`;
});

window.addEventListener('mouseup', () => {
  if (!gripDrag) return;
  if (gripDrag.w) {
    stockColWidths[gripDrag.key] = gripDrag.w;
    localStorage.setItem('stockColWidths', JSON.stringify(stockColWidths));
    suppressSortUntil = Date.now() + 250;
  }
  gripDrag = null;
});

$('stockList').addEventListener('dblclick', (e) => {
  const grip = e.target.closest('.col-grip');
  if (!grip) return;
  delete stockColWidths[grip.dataset.grip];
  localStorage.setItem('stockColWidths', JSON.stringify(stockColWidths));
  suppressSortUntil = Date.now() + 250;
  renderStock();
});

$('stockList').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (th) {
    if (e.target.closest('.col-grip') || Date.now() < suppressSortUntil) return;
    const key = th.dataset.sort;
    if (stockSort.key === key) {
      stockSort.dir *= -1;
    } else {
      stockSort = { key, dir: STOCK_COLS[key].text ? 1 : -1 }; // text A→Z, numbers high→low
    }
    renderStock();
    return;
  }
  const numBtn = e.target.closest('button.stock-num-btn');
  if (numBtn) { beginStockEdit(numBtn); return; }
  const imgBtn = e.target.closest('button.img-btn');
  if (imgBtn) {
    const item = stockCache && stockCache.items.find(i => i.sku === imgBtn.dataset.imgsku);
    openImgDialog(imgBtn.dataset.imgsku, imgBtn.dataset.sid, item ? item.image : '');
    return;
  }
  const copyEl = e.target.closest('[data-copy]');
  if (copyEl) copyFromApp(copyEl.dataset.copy);
});

/* ---------- image chooser ---------- */

let imgTarget = null; // { sku, sid, url }

function openImgDialog(sku, sid, url) {
  imgTarget = { sku, sid, url: url || '' };
  $('imgTitle').textContent = `Image for ${sku}`;
  $('imgDownload').hidden = !url;
  $('imgUrl').value = '';
  $('imgResult').hidden = true;
  $('imgDialog').showModal();
}

function imgFeedback(msg, ok) {
  const el = $('imgResult');
  el.textContent = msg;
  el.hidden = false;
  el.style.color = ok ? '' : 'var(--neg-text)';
}

$('imgFromFile').addEventListener('click', async () => {
  if (!imgTarget) return;
  const res = await api.addStockImage(imgTarget.sku, imgTarget.sid);
  if (res.canceled) return;
  if (!res.ok) { imgFeedback(res.error || 'Upload failed.', false); return; }
  toast(`Image added to ${imgTarget.sku}`);
  $('imgDialog').close();
  loadStock();
});

$('imgUrlAdd').addEventListener('click', async () => {
  if (!imgTarget) return;
  const url = $('imgUrl').value.trim();
  if (!url) { imgFeedback('Paste an image URL first.', false); return; }
  imgFeedback('Adding…', true);
  const res = await api.addStockImageUrl(imgTarget.sku, imgTarget.sid, url);
  if (!res.ok) { imgFeedback(res.error || 'Failed.', false); return; }
  toast(`Image added to ${imgTarget.sku}`);
  $('imgDialog').close();
  loadStock();
});

$('imgDownload').addEventListener('click', async () => {
  if (!imgTarget || !imgTarget.url) return;
  const res = await api.saveStockImage(imgTarget.sku, imgTarget.url);
  if (res.canceled) return;
  if (!res.ok) { imgFeedback(res.error || 'Download failed.', false); return; }
  toast(`Saved ${res.path.split(/[\\/]/).pop()}`);
});

$('imgClose').addEventListener('click', () => $('imgDialog').close());

/* ---------- WFS shipments ---------- */

function wfsLineHtml() {
  return `
    <div class="wfs-line">
      <input type="text" class="input mono wfs-sku" list="skuOptions" placeholder="SKU" autocomplete="off" spellcheck="false" />
      <input type="text" class="input mono wfs-gtin" placeholder="GTIN / Walmart ID" autocomplete="off" spellcheck="false" />
      <input type="number" class="input wfs-qty" min="1" step="1" placeholder="Qty" />
      <button class="btn-icon is-danger wfs-remove" title="Remove line">✕</button>
    </div>`;
}

function wfsAddLine() {
  $('wfsLines').insertAdjacentHTML('beforeend', wfsLineHtml());
}

async function openWfs() {
  // SKU suggestions + GTIN autofill come from the loaded stock sheet
  if (stockCache) {
    $('skuOptions').innerHTML = stockCache.items.map(i => `<option value="${esc(i.sku)}"></option>`).join('');
  }
  $('wfsLines').innerHTML = '';
  wfsAddLine();
  $('wfsNote').value = '';
  $('wfsResult').textContent = '';
  $('wfsResult').className = 'test-result';
  await renderWfsPast();
  $('wfsDialog').showModal();
}

async function renderWfsPast() {
  const shipments = await api.wfsList();
  $('wfsPast').innerHTML = shipments.length === 0
    ? '<p class="dlg-note">No shipments logged yet.</p>'
    : shipments.map(s => `
      <div class="wfs-shipment">
        <div class="wfs-shipment-head">
          <span class="mono">${esc(s.created_at.slice(0, 10))} ${fmtTime(s.created_at)}</span>
          ${s.note ? `<span class="wfs-note">${esc(s.note)}</span>` : ''}
          <span class="wfs-units">${s.items.reduce((a, i) => a + i.qty, 0)} units</span>
        </div>
        ${s.items.map(i => `
          <div class="wfs-item">
            <span class="mono">${esc(i.sku)}</span>
            <span class="mono wfs-gtin-txt">${esc(i.gtin || '—')}</span>
            <span class="wfs-qty-txt">×${i.qty}</span>
          </div>`).join('')}
      </div>`).join('');
}

$('wfsBtn').addEventListener('click', openWfs);
$('wfsAddLine').addEventListener('click', wfsAddLine);
$('wfsClose').addEventListener('click', () => $('wfsDialog').close());

$('wfsLines').addEventListener('click', (e) => {
  const rm = e.target.closest('.wfs-remove');
  if (rm) rm.closest('.wfs-line').remove();
});

// picking a known SKU pre-fills the GTIN from the item's barcode
$('wfsLines').addEventListener('input', (e) => {
  const skuInput = e.target.closest('.wfs-sku');
  if (!skuInput || !stockCache) return;
  const item = stockCache.items.find(i => i.sku === skuInput.value.trim());
  if (item) {
    const gtin = skuInput.closest('.wfs-line').querySelector('.wfs-gtin');
    if (!gtin.value.trim()) gtin.value = item.barcode || '';
  }
});

$('wfsSave').addEventListener('click', async () => {
  const out = $('wfsResult');
  out.className = 'test-result';
  const items = [...$('wfsLines').querySelectorAll('.wfs-line')].map(line => ({
    sku: line.querySelector('.wfs-sku').value.trim(),
    gtin: line.querySelector('.wfs-gtin').value.trim(),
    qty: Number(line.querySelector('.wfs-qty').value),
  })).filter(i => i.sku || i.gtin || i.qty);
  if (!items.length || items.some(i => !i.sku || !Number.isInteger(i.qty) || i.qty <= 0)) {
    out.textContent = 'Every line needs a SKU and a whole-number quantity.';
    out.classList.add('is-fail');
    return;
  }
  if (stockCache) {
    const unknown = items.filter(i => !stockCache.items.some(s => s.sku === i.sku));
    if (unknown.length) {
      out.textContent = `Unknown SKU: ${unknown.map(u => u.sku).join(', ')}`;
      out.classList.add('is-fail');
      return;
    }
  }
  $('wfsSave').disabled = true;
  out.textContent = 'Saving…';
  const res = await api.wfsCreate($('wfsNote').value.trim(), items);
  $('wfsSave').disabled = false;
  if (!res.ok) {
    out.textContent = res.error || 'Failed.';
    out.classList.add('is-fail');
    return;
  }
  out.textContent = 'Saved — stock deducted.';
  out.classList.add('is-ok');
  $('wfsLines').innerHTML = '';
  wfsAddLine();
  $('wfsNote').value = '';
  await renderWfsPast();
  loadStock(); // show the reduced warehouse counts
});

/* ---------- history dialog ---------- */

function historyStatusLabel(row) {
  switch (row.status) {
    case 'synced': return `Processed ${row.synced_at ? fmtTime(row.synced_at) : ''}`.trim();
    case 'captured': return 'Ready';
    case 'pending': return 'No tracking';
    case 'failed': return 'Failed';
    default: return row.status;
  }
}

let historyCache = [];

async function openHistory() {
  historyCache = await api.getHistory();
  $('historyParkedOnly').checked = false;
  renderHistory();
  $('historyDialog').showModal();
}

function renderHistory() {
  const parkedOnly = $('historyParkedOnly').checked;
  const rows = parkedOnly
    ? historyCache.filter(r => (r.notes || '').includes('was parked'))
    : historyCache;
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push(r);
  }
  $('historyList').innerHTML = rows.length === 0
    ? `<p class="dlg-note">${parkedOnly ? 'No parked orders on record.' : 'Nothing processed yet. Orders appear here once they are pushed to Linnworks.'}</p>`
    : [...byDay.entries()].map(([day, list]) => `
      <div class="history-day">
        <div class="history-day-head">${esc(day)} &middot; ${list.length} order${list.length === 1 ? '' : 's'}</div>
        ${list.map(r => `
          <div class="history-item">
            <span class="history-time mono">${fmtTime(r.created_at)}</span>
            <span class="badge badge-${esc(r.channel)}">${esc(channelLabel(r.channel))}</span>
            <span class="mono history-order copyable" data-copy="${esc(r.order_number)}" title="Click to copy">${esc(r.order_number)}</span>
            ${r.tracking
              ? `<span class="mono history-tracking copyable" data-copy="${esc(r.tracking)}" title="Click to copy ${esc(r.tracking)}">${esc(r.tracking)}</span>`
              : '<span class="mono history-tracking">—</span>'}
            <span class="history-status st-${esc(r.status)}" title="${esc(r.fail_reason || '')}">${esc(historyStatusLabel(r))}</span>
            ${r.notes ? `<span class="history-notes" title="${esc(r.notes)}">${esc(r.notes)}</span>` : ''}
          </div>`).join('')}
      </div>`).join('');
}

$('historyParkedOnly').addEventListener('change', renderHistory);
$('historyBtn').addEventListener('click', openHistory);
$('historyList').addEventListener('click', (e) => {
  const copyEl = e.target.closest('[data-copy]');
  if (copyEl) copyFromApp(copyEl.dataset.copy);
});
$('historyClose').addEventListener('click', () => $('historyDialog').close());
$('historyDialog').addEventListener('close', () => focusScan());

/* ---------- debug dialog ---------- */

async function openDebug() {
  const log = await api.getDebugLog();
  $('debugList').innerHTML = log.length === 0
    ? '<p class="dlg-note">Nothing ignored yet.</p>'
    : log.map(x => `
      <div class="debug-item">
        <span class="debug-time">${fmtTime(x.at)}</span>
        <span class="mono">${esc(x.text)}</span>
      </div>`).join('');
  $('debugDialog').showModal();
}

$('debugClose').addEventListener('click', () => $('debugDialog').close());
$('debugDialog').addEventListener('close', () => focusScan());

/* ---------- focus guard ---------- */

function anyDialogOpen() {
  return ['editDialog', 'notesDialog', 'settingsDialog', 'syncDialog', 'debugDialog', 'historyDialog', 'pinDialog', 'wfsDialog', 'imgDialog'].some(id => $(id).open);
}

function focusScan() {
  if (!anyDialogOpen() && activePage === 'capture') scanInput.focus();
}

function updateFocusPill() {
  const pill = $('focusPill');
  const ready = document.hasFocus() && document.activeElement === scanInput;
  pill.classList.toggle('is-ready', ready);
  pill.classList.toggle('is-away', !ready);
  pill.textContent = ready ? 'Ready to scan' : 'Click app to focus';
}

window.addEventListener('click', (e) => {
  if (anyDialogOpen() || activePage !== 'capture') return;
  const tag = e.target.tagName;
  if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A', 'LABEL', 'OPTION'].includes(tag)) return;
  focusScan();
});

setInterval(() => {
  if (!anyDialogOpen() && activePage === 'capture' && document.hasFocus() && document.activeElement !== scanInput) {
    const a = document.activeElement;
    if (!a || (a.tagName !== 'INPUT' && a.tagName !== 'TEXTAREA' && a.tagName !== 'SELECT' && a.tagName !== 'BUTTON')) {
      scanInput.focus();
    }
  }
  updateFocusPill();
}, 1500);

window.addEventListener('focus', () => { focusScan(); updateFocusPill(); });
window.addEventListener('blur', updateFocusPill);
scanInput.addEventListener('focus', updateFocusPill);
scanInput.addEventListener('blur', updateFocusPill);

/* ---------- main-process events ---------- */

api.on('state:changed', (s) => { state = s; render(); });

api.on('order:detected', ({ row }) => {
  clearWarn();
  toast(`New order: ${row.order_number} (${channelLabel(row.channel)})`);
});

api.on('tracking:detected', ({ row, carrier }) => {
  clearWarn();
  toast(`Tracking added: ${carrier} ${shorten(row.tracking, 20)} → ${row.order_number}`);
});

api.on('tracking:clipped', ({ message }) => {
  pendingConfirm = null;
  showWarn({ reason: message, danger: true, confirmable: false });
});

api.on('order:similar', ({ channel, orderNumber, similar }) => {
  pendingConfirm = { kind: 'order', channel, value: orderNumber };
  showWarn({
    reason: `POSSIBLE COPY MISTAKE: ${orderNumber} looks like a piece of ${similar.order_number} (captured ${fmtTime(similar.created_at)}). Not added. If it really is a different order, Save anyway.`,
    danger: true,
  });
  const card = document.querySelector(`tr[data-id="${similar.id}"]`);
  if (card) card.scrollIntoView({ block: 'center' });
});

api.on('order:duplicate', ({ orderNumber, existing }) => {
  // duplicate order has no save-anyway; use "Scan more" on the existing row instead
  pendingConfirm = null;
  showWarn({
    reason: `DUPLICATE ORDER: ${orderNumber} was already captured at ${fmtTime(existing.created_at)} (${existing.status}). Not added.`,
    danger: true,
    confirmable: false,
  });
  const card = document.querySelector(`tr[data-id="${existing.id}"]`);
  if (card) card.scrollIntoView({ block: 'center' });
});

api.on('sync:progress', (p) => {
  $('syncStatus').textContent = `Syncing ${p.current}/${p.total}: ${p.message}`;
});

api.on('sync:done', (summary) => {
  showSyncResults(summary);
  refresh();
});

api.on('routing:done', (res) => {
  const parts = [];
  if (res.movedOut) parts.push(`${res.movedOut} order${res.movedOut === 1 ? '' : 's'} → dropship (no stock)`);
  if (res.movedBack) parts.push(`${res.movedBack} back (restocked)`);
  if (parts.length) toast(`Stock routing: ${parts.join(', ')}`, 4000);
});

api.on('ui:open-settings', openSettings);
api.on('ui:open-debug', openDebug);
api.on('ui:open-history', openHistory);

/* ---------- boot ---------- */

refresh().then(() => focusScan());
