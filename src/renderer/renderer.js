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
    pages: { stock: true, history: true, receiving: false },
    csv: { path: 'C:\\Users\\packer\\Documents\\Capture Station\\capture-2026-07-30.csv', at: at(0), error: null },
    orderMeta: {},
    shipCutoff: '16:00',
    orderUrlTemplates: {},
  };
  window.api = {
    getState: async () => demo,
    submitScan: async () => ({ ok: false, error: 'Preview mode, scanning is inert.' }),
    nextOrder: async () => ({ ok: true }),
    addOrderAnyway: async () => ({ ok: true }),
    openOrderPage: async () => ({ ok: false }),
    browserLayout: async () => ({ ok: true, visible: false }),
    browserOpen: async () => ({ ok: false, error: 'Preview mode' }),
    browserOpenUrl: async () => ({ ok: false, error: 'Preview mode' }),
    browserNav: async () => ({ ok: false }),
    browserPrint: async () => ({ ok: true }),
    refreshOrders: async () => ({ ok: true }),
    moveOrder: async () => ({ ok: false, error: 'Preview mode' }),
    substituteRow: async () => ({ ok: false, error: 'Preview mode' }),
    clearFailedRows: async () => ({ ok: false }),
    returnsEditUnit: async () => ({ ok: false, error: 'Preview mode' }),
    returnsDeleteUnit: async () => ({ ok: false, error: 'Preview mode' }),
    stockUnlisted: async () => ({ ok: false, error: 'Preview mode' }),
    channelSkip: async () => ({ ok: false, error: 'Preview mode' }),
    shelfGet: async () => ({ ok: false, error: 'Preview mode' }),
    dropshipSetPad: async () => ({ ok: false, error: 'Preview mode' }),
    dropshipRemove: async () => ({ ok: false, error: 'Preview mode' }),
    dropshipStats: async () => ({ ok: false, error: 'Preview mode' }),
    reorderApply: async () => ({ ok: false, error: 'Preview mode' }),
    reopenRow: async () => ({ ok: true }),
    undo: async () => ({ ok: true, message: 'Preview mode' }),
    updateRow: async () => ({ ok: true }),
    deleteRow: async () => ({ ok: true }),
    runSync: async () => ({}),
    getConfig: async () => ({ linnworks: { applicationId: '', applicationSecret: '', token: '', locationId: '', locationName: '' }, dryRun: true, stockRouting: { enabled: false, fallbackLocationId: '', fallbackLocationName: '' }, settingsPinHash: '', pages: { stock: true, history: true, receiving: false }, receiving: { folder: '', webhookUrl: '' }, stockViews: [{ label: 'Open Box', pattern: 'OPEN[\\s-]?BOX', tint: 'blue' }, { label: 'Used', pattern: '(^|[^A-Za-z])USED($|[^A-Za-z])', tint: 'yellow' }, { label: 'Scrap', pattern: '(^|[^A-Za-z])SCRAP($|[^A-Za-z])', tint: 'red' }], orderPatterns: [], trackingPatterns: [], serialPatterns: [] }),
    setConfig: async () => ({}),
    exportCsv: async () => ({ ok: false }),
    openCsvFolder: async () => ({ ok: true }),
    chooseCsvFolder: async () => ({ ok: false, folder: '' }),
    testLinnworks: async () => ({ ok: false, error: 'Preview mode' }),
    getDebugLog: async () => [],
    getHistory: async () => demo.rows,
    getStock: async () => ({ ok: false, error: 'Preview mode' }),
    getStockOpenOrders: async () => ({ ok: false, error: 'Preview mode' }),
    setStockLevel: async () => ({ ok: false, error: 'Preview mode' }),
    setStockMin: async () => ({ ok: false, error: 'Preview mode' }),
    salesQuery: async () => ({ ok: false, error: 'Preview mode' }),
    getChannelSkus: async () => ({ ok: false, error: 'Preview mode' }),
    createSku: async () => ({ ok: false, error: 'Preview mode' }),
    addStockImage: async () => ({ ok: false, error: 'Preview mode' }),
    addStockImageUrl: async () => ({ ok: false, error: 'Preview mode' }),
    cancelStockImage: async () => ({ ok: true }),
    saveStockImage: async () => ({ ok: false, error: 'Preview mode' }),
    returnsLookup: async () => ({ ok: false, error: 'Preview mode' }),
    returnsCreate: async () => ({ ok: false, error: 'Preview mode' }),
    returnsList: async () => [],
    returnsTargets: async () => ({ ok: false, error: 'Preview mode' }),
    returnsMappings: async () => ({ ok: false, error: 'Preview mode' }),
    returnsMapSet: async () => ({ ok: false, error: 'Preview mode' }),
    returnsMapDelete: async () => ({ ok: false, error: 'Preview mode' }),
    wfsList: async () => [],
    wfsCreate: async () => ({ ok: false, error: 'Preview mode' }),
    wfsReceived: async () => ({ ok: false, error: 'Preview mode' }),
    wfsIgnore: async () => ({ ok: false, error: 'Preview mode' }),
    wfsUnignore: async () => ({ ok: false, error: 'Preview mode' }),
    overviewData: async () => ({ ok: false, error: 'Preview mode' }),
    receivingFinish: async () => ({ ok: false, error: 'Preview mode' }),
    receivingList: async () => ({ ok: true, folder: '', sessions: [] }),
    chooseReceivingFolder: async () => ({ ok: false, folder: '' }),
    returnsSyncChooseFolder: async () => ({ ok: false, folder: '' }),
    copyText: async () => ({ ok: true }),
    on: () => {},
  };
}

let state = null;
let channelFilter = 'all'; // marketplace chip on the capture list
let orderSort = 'new'; // capture list Order # header: 'new' | 'old' first
let trackSort = 'none'; // Tracking header: 'none' | 'untracked' | 'tracked'
let pendingConfirm = null; // { value, reason, duplicate }
let editingRowId = null;
let toastTimer = null;
const knownRowIds = new Set();
let firstRender = true;

const $ = (id) => document.getElementById(id);
// tracking is scanned/typed straight into the active row's inline input
function activeScanInput() {
  return document.getElementById('rowScanInput');
}

/* ---------- helpers ---------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// separator-blind search: "s24 fe" finds S24-FE-128GB-… (owner 2026-09-16,
// "search without needing to add the dash") — the query splits on spaces
// and dashes and every piece must appear somewhere in the target, so dashed
// queries keep working exactly as before
function skuMatch(hay, q) {
  if (!q) return true;
  const h = String(hay || '').toLowerCase();
  return String(q).toLowerCase().split(/[\s-]+/).every(t => !t || h.includes(t));
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

// No channel badge on order rows: the PO# format already tells the channel
// apart (owner request 2026-08-05). Filter chips keep the channel names.

function toast(msg, ms = 2200) {
  const el = $('toast');
  // the browser pane is a native layer that covers everything, toasts
  // included: center the toast over the sheet side instead, never under it
  const dock = $('bDock');
  el.style.left = dock && !dock.hidden
    ? `${dock.offsetWidth + (window.innerWidth - dock.offsetWidth) / 2}px`
    : '';
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
  camera: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M208,56H180.28L166.65,35.56A8,8,0,0,0,160,32H96a8,8,0,0,0-6.65,3.56L75.71,56H48A24,24,0,0,0,24,80V192a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V80A24,24,0,0,0,208,56Zm8,136a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V80a8,8,0,0,1,8-8H80a8,8,0,0,0,6.66-3.56L100.28,48h55.43l13.63,20.44A8,8,0,0,0,176,72h32a8,8,0,0,1,8,8ZM128,88a44,44,0,1,0,44,44A44.05,44.05,0,0,0,128,88Zm0,72a28,28,0,1,1,28-28A28,28,0,0,1,128,160Z"/></svg>',
  barcode: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M232,52V92a12,12,0,0,1-24,0V64H180a12,12,0,0,1,0-24h40A12,12,0,0,1,232,52ZM76,192H48V164a12,12,0,0,0-24,0v40a12,12,0,0,0,12,12H76a12,12,0,0,0,0-24Zm144-40a12,12,0,0,0-12,12v28H180a12,12,0,0,0,0,24h40a12,12,0,0,0,12-12V164A12,12,0,0,0,220,152ZM36,104A12,12,0,0,0,48,92V64H76a12,12,0,0,0,0-24H36A12,12,0,0,0,24,52V92A12,12,0,0,0,36,104ZM88,80A12,12,0,0,0,76,92v72a12,12,0,0,0,24,0V92A12,12,0,0,0,88,80Zm92,84V92a12,12,0,0,0-24,0v72a12,12,0,0,0,24,0ZM128,80a12,12,0,0,0-12,12v72a12,12,0,0,0,24,0V92A12,12,0,0,0,128,80Z"/></svg>',
  pencil: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M230.14,70.54,185.46,25.85a20,20,0,0,0-28.29,0L33.86,149.17A19.85,19.85,0,0,0,28,163.31V208a20,20,0,0,0,20,20H92.69a19.86,19.86,0,0,0,14.14-5.86L230.14,98.82a20,20,0,0,0,0-28.28ZM91,204H52V165l84-84,39,39ZM192,103,153,64l18.34-18.34,39,39Z"/></svg>',
  trash: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M216,48H180V36A28,28,0,0,0,152,8H104A28,28,0,0,0,76,36V48H40a12,12,0,0,0,0,24h4V208a20,20,0,0,0,20,20H192a20,20,0,0,0,20-20V72h4a12,12,0,0,0,0-24ZM100,36a4,4,0,0,1,4-4h48a4,4,0,0,1,4,4V48H100Zm88,168H68V72H188ZM116,104v64a12,12,0,0,1-24,0V104a12,12,0,0,1,24,0Zm48,0v64a12,12,0,0,1-24,0V104a12,12,0,0,1,24,0Z"/></svg>',
  swap: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M217,163.51a12,12,0,0,1,0,17l-32,32a12,12,0,0,1-17-17L179.51,184H48a12,12,0,0,1,0-24H179.51L168,148.49a12,12,0,0,1,17-17ZM71,124.49a12,12,0,0,0,17-17L76.49,96H208a12,12,0,0,0,0-24H76.49L88,60.49a12,12,0,1,0-17-17l-32,32a12,12,0,0,0,0,17Z"/></svg>',
  box: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M223.68,66.15,135.68,18a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32l80.34,44-29.77,16.3-80.35-44ZM128,120,47.66,76l33.9-18.56,80.34,44ZM40,90l80,43.78v85.79L40,175.82Zm176,85.78h0l-80,43.79V133.82l32-17.51V152a8,8,0,0,0,16,0V107.55L216,90v85.77Z"/></svg>',
  arrowOut: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M228,104a12,12,0,0,1-24,0V69l-59.51,59.52a12,12,0,0,1-17-17L187,52H152a12,12,0,0,1,0-24h64a12,12,0,0,1,12,12Zm-44,24a12,12,0,0,0-12,12v64H52V84h64a12,12,0,0,0,0-24H48A20,20,0,0,0,28,80V208a20,20,0,0,0,20,20H176a20,20,0,0,0,20-20V140A12,12,0,0,0,184,128Z"/></svg>',
  chartBar: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M228,200h-4V40a12,12,0,0,0-12-12H160a12,12,0,0,0-12,12V76H100A12,12,0,0,0,88,88v36H48a12,12,0,0,0-12,12v64H28a12,12,0,0,0,0,24H228a12,12,0,0,0,0-24ZM172,52h28V200H172ZM112,100h36V200H112ZM60,148H88v52H60Z"/></svg>',
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
      return '<input id="rowScanInput" class="row-scan-input mono" type="text" placeholder="Scan tracking…" autocomplete="off" spellcheck="false" />'
        + '<button class="tracking-cancel" data-act="cancelwait" title="Stop waiting for this order\'s tracking (Esc)">✕</button>';
    }
    return '<button class="tracking-add" data-act="open" title="Click, then scan or copy this order\'s tracking">+ Add tracking</button>';
  }
  const label = row.carrier ? `${esc(row.carrier)} ${esc(row.tracking)}` : esc(row.tracking);
  return `<span class="copyable" data-copy="${esc(row.tracking)}" title="Click to copy ${esc(row.tracking)}">${label}</span>`;
}

function notesCell(row) {
  if (!row.notes) return '<button class="note-add" data-act="note" title="Add a note (serial number, condition, anything)">+ Note</button>';
  return `<button class="note-text note-btn" data-act="note" title="${esc(row.notes)}&#10;Click to edit">${esc(row.notes)}</button>`;
}

/* ---------- ship-by / due chips ---------- */

function parseCutoffMin(cutoff) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(cutoff || '').trim());
  if (!m) return 16 * 60; // fall back to the 16:00 default
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

// '16:00' -> '4:00 PM' for the header line
function fmtCutoff(cutoff) {
  const min = parseCutoffMin(cutoff);
  const h = Math.floor(min / 60);
  const mm = String(min % 60).padStart(2, '0');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

// Pure so the e2e can pin `now`: null = no chip (no date / future date),
// otherwise { overdue, urgent, label }. urgent = within an hour of the
// cutoff or past it - the chip turns red before the carrier leaves.
function dueInfo(despatchBy, cutoff, now = new Date()) {
  if (!despatchBy) return null;
  const d = new Date(despatchBy);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2010) return null; // epoch placeholder = unset
  const key = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const dayKey = key(d);
  const nowKey = key(now);
  if (dayKey < nowKey) return { overdue: true, urgent: true, label: 'Overdue' };
  if (dayKey > nowKey) return null; // future days stay clean
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return { overdue: false, urgent: nowMin >= parseCutoffMin(cutoff) - 60, label: 'Due today' };
}

// Focus rescue for text inputs: with the native marketplace pane around,
// the OS-level keyboard can strand on it — the window looks active, a click
// lands on an input, but keystrokes vanish. Any pointerdown on an editable
// field pulls the keyboard back to the app first; the click then focuses
// the field normally.
document.addEventListener('pointerdown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
    api.appFocus();
  }
}, true);

// meta lookup: split parts key as "ref#lwOrderId", whole orders as the ref
function metaFor(row) {
  const m = (state && state.orderMeta) || {};
  return (row.lw_order_id && m[`${row.order_number}#${row.lw_order_id}`]) || m[row.order_number];
}

function rowDue(row) {
  const meta = metaFor(row);
  return meta ? dueInfo(meta.despatchBy, state.shipCutoff) : null;
}

function render() {
  if (!state) return;

  // per-install page flags (capture is always on); capture-only wins over all
  const pages = state.pages || { stock: true, history: true, returns: false };
  // the eBay lister rides the Returns flag: same installs, same people
  // Overview has its OWN flag (owner 2026-08-25: employees must not see the
  // money dashboard) — it still needs stock access to have data to show.
  // Listings split from the returns flag the same day ("I just need them to
  // process returns") so a returns-only station shows Returns alone.
  const lst = !!pages.returns && pages.listings !== false;
  const pageEnabled = { overview: !!pages.stock && pages.overview !== false, capture: true, stock: !!pages.stock, pricing: !!pages.stock && !!pages.pricing, shelf: !!pages.stock, returns: !!pages.returns, ebay: lst, temu: lst };
  if (activePage !== 'capture' && (state.captureOnly || !pageEnabled[activePage])) {
    showPage('capture'); // showPage re-renders
    return;
  }
  // the app opens on Overview (owner request 2026-08-17) wherever it exists
  if (!bootPageDone) {
    bootPageDone = true;
    if (!state.captureOnly && pageEnabled.overview && activePage === 'capture') {
      showPage('overview');
      return;
    }
  }
  $('tabOverview').hidden = !pages.stock || pages.overview === false;
  $('tabStock').hidden = !pages.stock;
  $('tabPricing').hidden = !pages.stock || !pages.pricing; // opt-in (owner 2026-09-18): off until ticked in Settings
  $('tabReturns').hidden = !pages.returns;
  $('tabListings').hidden = !(pages.returns && pages.listings !== false);
  $('pageTabs').hidden = state.captureOnly || !(pages.stock || pages.returns);
  $('historyBtn').hidden = !pages.history;

  $('orderCount').textContent = state.todayCount ?? state.rows.length;
  const openToday = (state.todayCount || 0) - (state.todayProcessed || 0);
  $('dayCountBox').title = `${state.todayProcessed || 0} processed · ${openToday} still open`;
  // capture stat, not a stock stat — but keep its SPACE so the header never
  // changes height/width when switching pages
  $('dayCountBox').classList.toggle('invisible', activePage !== 'capture');
  $('nextOrderBtn').disabled = !state.currentRowId;
  $('undoBtn').disabled = !state.canUndo;
  $('undoFooterBtn').hidden = state.captureOnly || activePage !== 'capture';
  $('undoFooterBtn').disabled = !state.canUndo;
  updateScanPanel();
  $('dryRunChip').hidden = !state.dryRun;

  // expected-input line
  const current = state.rows.find(r => r.id === state.currentRowId);
  const expectEl = $('expectLine');
  if (!current || state.expecting !== 'tracking') {
    expectEl.innerHTML = state.captureOnly
      ? 'Copy an order number, then scan its label'
      : 'Click a PO# below, then scan or copy its tracking';
  } else {
    expectEl.innerHTML = `Waiting for: <strong>TRACKING</strong> &middot; <span class="mono">${esc(shorten(current.order_number, 18))}</span> ${esc(channelLabel(current.channel))}`;
  }

  // footer: capture-only shows the CSV mirror, otherwise the sync controls
  const syncEl = $('syncStatus');
  $('syncBtn').hidden = state.captureOnly;
  // off-page: invisible but still occupying space, so the footer never jumps
  $('syncBtn').classList.toggle('invisible', activePage !== 'capture');
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

  // rows table, optionally narrowed by the Ctrl+F finder. Gutter numbers are
  // assigned AFTER sorting/filtering, by display position: top row carries
  // the highest number, bottom row is 1, always contiguous.
  const total = state.rows.length;
  let visible = state.rows.map((row) => ({ row }));

  // the queue keeps pure capture order (newest first) — due-date urgency
  // shows through the chips, the Due-today filter and the header counter,
  // never by re-sorting the rows
  const dueRank = ({ row }) => {
    const due = rowDue(row);
    return due ? (due.overdue ? 0 : 1) : 2;
  };
  const dueRows = visible.filter(v => dueRank(v) < 2);

  // header: how many must go out before today's carrier cutoff
  const dueOpen = dueRows.filter(({ row }) => row.status !== 'synced').length;
  $('dueHeader').hidden = activePage !== 'capture' || dueOpen === 0;
  $('dueHeader').textContent = dueOpen ? `${dueOpen} due by ${fmtCutoff(state.shipCutoff)}` : '';

  // marketplace filter chips, shown once there is more than one channel
  // (the "Due today" chip left at the owner's request 2026-08-06 — the
  // header count and per-row due chips still carry the urgency)
  const channels = [...new Set(state.rows.map(r => r.channel))];
  const chipBar = $('channelChips');
  if (activePage === 'capture' && state.rows.length && channels.length > 1) {
    if (channelFilter !== 'all' && !channels.includes(channelFilter)) channelFilter = 'all';
    const counts = {};
    for (const r of state.rows) counts[r.channel] = (counts[r.channel] || 0) + 1;
    chipBar.hidden = false;
    chipBar.innerHTML = [
      `<button class="chip-filter ${channelFilter === 'all' ? 'is-active' : ''}" data-ch="all">All · ${state.rows.length}</button>`,
      ...channels.map(c =>
        `<button class="chip-filter ${channelFilter === c ? 'is-active' : ''}" data-ch="${esc(c)}">${esc(channelLabel(c))} · ${counts[c]}</button>`),
    ].join('');
  } else {
    chipBar.hidden = true;
    channelFilter = 'all';
  }
  // one-click cleanup for rows whose orders already left Linnworks' open book
  const failedGone = state.rows.filter(r =>
    r.status === 'failed' && String(r.fail_reason || '').startsWith('Not found in open orders')).length;
  $('clearFailedBtn').hidden = activePage !== 'capture' || failedGone === 0;
  if (failedGone) $('clearFailedBtn').textContent = `Clear failed · ${failedGone}`;
  if (channelFilter !== 'all') visible = visible.filter(({ row }) => row.channel === channelFilter);

  // search bar: always available on the capture list, matches PO#, tracking,
  // notes, and the order's item SKUs / channel SKUs / titles
  $('findBar').hidden = activePage !== 'capture' || state.captureOnly && !state.rows.length;
  if (findQuery) {
    const q = findQuery.toLowerCase();
    const itemMatch = (row) => {
      const m = metaFor(row);
      return !!(m && m.items && m.items.some(i =>
        (i.sku || '').toLowerCase().includes(q)
        || (i.channelSku || '').toLowerCase().includes(q)
        || (i.title || '').toLowerCase().includes(q)));
    };
    visible = visible.filter(({ row }) =>
      row.order_number.toLowerCase().includes(q)
      || (row.tracking || '').toLowerCase().includes(q)
      || (row.notes || '').toLowerCase().includes(q)
      || itemMatch(row));
    $('findCount').textContent = visible.length === 0 ? 'no matches' : `${visible.length} of ${total}`;
  } else {
    $('findCount').textContent = '';
  }
  // header sorts: Order # flips age, Tracking groups by has/hasn't (stable,
  // so the age order holds inside each group)
  if (orderSort === 'old') visible = visible.slice().reverse();
  if (trackSort !== 'none') {
    const has = ({ row }) => (String(row.tracking || '').trim() ? 1 : 0);
    visible = visible.slice().sort((a, b) =>
      trackSort === 'tracked' ? has(b) - has(a) : has(a) - has(b));
  }
  const empty = visible.length === 0;
  $('rowsTable').hidden = empty;
  $('rowsEmpty').hidden = !empty || !!findQuery; // finder shows "no matches" itself
  // a half-typed scan must survive re-renders (state pushes rebuild the tbody)
  const prevInp = activeScanInput();
  const prevScan = prevInp ? { value: prevInp.value, focused: document.activeElement === prevInp } : null;
  // renumber by final display order: whatever sits on top gets the biggest
  // number (newest-first aesthetic), regardless of due sorting or filters
  visible = visible.map((v, i) => ({ ...v, num: visible.length - i }));
  $('rowsBody').innerHTML = visible.map(({ row, num }) => {
    const meta = metaFor(row);
    const hasLink = !!((state.orderUrlTemplates || {})[row.channel] || '').trim();
    const allItems = (meta && meta.items) || [];
    // items stack vertically, one per line; beyond four, "+N more" carries
    // the full list on hover so big orders never silently truncate
    const metaItems = allItems.slice(0, 4);
    const moreItems = allItems.slice(4);
    const moreHtml = moreItems.length
      ? `<span class="item-more" data-tip="${esc(moreItems.map(i => `${i.sku || i.channelSku || i.title || '?'} ×${i.qty}`).join(', '))}">+${moreItems.length} more</span>`
      : '';
    // "shipped a different item" swap rides on EACH item line: the clicked
    // line's SKU travels as sub_for, so the process-time stock correction
    // reverses only that line on multi-line orders
    const canSub = !state.captureOnly && row.status !== 'synced';
    const lineSub = (i) => canSub
      ? `<button class="btn-icon item-sub-btn" data-act="substitute" data-subfor="${esc(i.sku || i.channelSku || '')}"
           title="Shipped a different item instead of ${esc(i.sku || i.channelSku || 'this line')} — pick the substitute">${ICONS.swap}</button>`
      : '';
    const itemsHtml = metaItems.map(i => {
      const linked = !i.unmapped && i.sku;
      const label = linked ? i.sku : (i.channelSku || i.title || 'unknown item');
      // multi-unit lines wear a loud chip: a missed second unit = a refund
      const qty = i.qty > 1 ? `<span class="qty-chip" title="${i.qty} units of this item on the order">×${i.qty}</span>` : '';
      const thumb = i.img ? `<img class="item-thumb" src="${esc(i.img)}" loading="lazy" alt="" />` : '';
      const info = i.channelSku && i.channelSku !== label
        ? `<span class="item-info" data-tip="Channel SKU: ${esc(i.channelSku)}">i</span>` : '';
      return linked
        ? `<span class="item-entry">${thumb}${esc(label)}${qty}${info}${lineSub(i)}</span>`
        : `<span class="item-entry item-unmapped" data-tip="Not mapped in Linnworks - stock will NOT deduct when processed">${thumb}⚠ ${esc(label)}${qty}${info}${lineSub(i)}</span>`;
    }).join('') + moreHtml;
    // no live order metadata (processed / left the open book): fall back to
    // the item snapshot taken while the order was open
    const snapHtml = !allItems.length && Array.isArray(row.items) && row.items.length
      ? row.items.map(s => `<span class="item-entry item-snap" title="From the order as captured">${esc(s.sku)}${s.qty > 1 ? `<span class="qty-chip">×${s.qty}</span>` : ''}</span>`).join('')
      : '';
    const itemsCellHtml = itemsHtml || snapHtml;
    return `
    <tr class="${row.id === state.currentRowId ? 'is-current' : ''} ${!firstRender && !knownRowIds.has(row.id) ? 'is-new' : ''}" data-id="${row.id}">
      <td class="cell-gutter st-${esc(row.status)}" title="${esc(statusTitle(row))} · ${fmtTime(row.created_at)}">${num}</td>
      <td class="cell-order" title="Captured ${fmtTime(row.created_at)} · ${esc(channelLabel(row.channel))}">
        ${meta && meta.dropship ? '<span class="badge badge-dropship" title="Routed to the dropship location - the supplier ships this">DS</span>' : ''}
        ${meta && meta.parked ? `<button class="badge badge-parked badge-parked-btn" data-unpark="${esc(row.order_number)}" title="Parked or locked in Linnworks — the stock router cannot move it. Click to unpark.">PARKED ✕</button>` : ''}
        ${meta && meta.split ? `<span class="badge badge-split" title="Linnworks split this order across locations — this row is part ${meta.split.part} of ${meta.split.of} and ships separately (its own tracking, its own process)">${meta.split.part}/${meta.split.of}</span>` : ''}
        ${(() => { const due = rowDue(row); return due ? `<span class="due-chip ${due.urgent ? 'is-red' : 'is-amber'}" title="Despatch by ${esc(String((meta || {}).despatchBy).slice(0, 10))} · cutoff ${esc(fmtCutoff(state.shipCutoff))}">${due.label}</span>` : ''; })()}
        <span class="order-num ${hasLink ? 'order-link' : 'copyable" data-copy="' + esc(row.order_number)}" data-po="${esc(row.order_number)}" data-ch="${esc(row.channel)}" title="${hasLink ? 'Click: open on marketplace and select · Right-click: copy' : 'Click to copy'}">${esc(row.order_number)}</span>${
        row.status === 'failed' && row.fail_reason ? `<span class="fail-note" title="${esc(row.fail_reason)}">${esc(row.fail_reason)}</span>` : ''}</td>
      <td class="cell-items"><div class="items-stack">${itemsCellHtml}</div></td>
      <td class="cell-tracking">${trackingCell(row)}</td>
      <td class="cell-notes">${row.sub_sku
        ? `<button class="sub-pill" data-act="substitute" title="${esc(row.sub_note || `Shipped ${row.sub_sku} instead of ${row.sub_for || 'the listed item'}`)}&#10;Click to edit or remove">SUB ${row.sub_for ? `${esc(row.sub_for)} ` : ''}→ ${esc(row.sub_sku)}${row.sub_qty > 1 ? ` ×${row.sub_qty}` : ''}</button>` : ''}${notesCell(row)}</td>
      <td class="cell-actions">
        <span class="row-actions">
          ${row.id !== state.currentRowId && !row.tracking ? `<button class="btn-icon" data-act="open" title="Scan tracking">${ICONS.barcode}</button>` : ''}
          <button class="btn-icon" data-act="edit" title="Edit / add notes">${ICONS.pencil}</button>
          <button class="btn-icon is-danger" data-act="del" title="Delete">${ICONS.trash}</button>
        </span>
      </td>
    </tr>`;
  }).join('');
  knownRowIds.clear();
  state.rows.forEach(r => knownRowIds.add(r.id));
  firstRender = false;
  const inp = activeScanInput();
  if (inp && prevScan) {
    inp.value = prevScan.value;
    if (prevScan.focused) inp.focus();
  } else if (inp && !anyDialogOpen() && activePage === 'capture') {
    inp.focus(); // a row just became active: ready for the scanner immediately
  }
}

async function refresh() {
  state = await api.getState();
  render();
  if (bReady) applyBrowserPane();
}

/* ---------- scan flow ---------- */

// Sync mode: the top panel exists only to carry warnings, so it stays
// collapsed until one appears. Capture-only keeps the full guidance panel.
function updateScanPanel() {
  const captureOnly = !!(state && state.captureOnly);
  const warnOpen = !$('warnBanner').hidden;
  $('expectLine').hidden = !captureOnly;
  $('scanActions').hidden = !captureOnly;
  $('scanPanel').hidden = activePage !== 'capture' || (!captureOnly && !warnOpen);
}

function showWarn({ reason, danger, confirmable = true }) {
  const b = $('warnBanner');
  $('warnText').textContent = reason;
  $('warnAccept').hidden = !confirmable;
  b.classList.toggle('is-danger', !!danger);
  b.hidden = false;
  updateScanPanel();
}

function clearWarn() {
  $('warnBanner').hidden = true;
  pendingConfirm = null;
  updateScanPanel();
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

// header sort toggles (owner request 2026-08-07): Order # flips the age
// order; Tracking cycles missing-first -> added-first -> off
function syncSortHeads() {
  $('thOrder').textContent = orderSort === 'old' ? 'Order # · oldest first' : 'Order #';
  $('thTracking').textContent = trackSort === 'none' ? 'Tracking'
    : trackSort === 'untracked' ? 'Tracking · missing first' : 'Tracking · added first';
}
$('thOrder').addEventListener('click', () => {
  orderSort = orderSort === 'new' ? 'old' : 'new';
  syncSortHeads();
  render();
});
$('thTracking').addEventListener('click', () => {
  trackSort = trackSort === 'none' ? 'untracked' : trackSort === 'untracked' ? 'tracked' : 'none';
  syncSortHeads();
  render();
});

$('rowsBody').addEventListener('keydown', (e) => {
  const inp = e.target.closest('.row-scan-input');
  if (!inp) return;
  if (e.key === 'Escape') { e.preventDefault(); $('nextOrderBtn').click(); return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const value = inp.value.trim();
  inp.value = '';
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

$('undoFooterBtn').addEventListener('click', () => $('undoBtn').click());

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
  if (e.ctrlKey && (e.key === 'f' || e.key === 'F') && activePage === 'capture') {
    e.preventDefault();
    openFind();
  }
});

/* ---------- Ctrl+F row finder ---------- */

let findQuery = '';

function openFind() {
  $('findBar').hidden = false;
  $('findInput').focus();
  $('findInput').select();
}

function closeFind() {
  findQuery = '';
  $('findInput').value = '';
  $('findClose').hidden = true;
  render();
  focusScan();
}

$('findInput').addEventListener('input', () => {
  findQuery = $('findInput').value.trim();
  $('findClose').hidden = !$('findInput').value;
  render();
});

$('findInput').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});

$('findClose').addEventListener('click', closeFind);

// busy states are CLASSES, never textContent — these buttons are icons now,
// and a textContent swap would wipe the SVG and leave a word behind
// (owner 2026-09-16: "don't have the text. The refresh can spin around tho")
$('ordersRefreshBtn').addEventListener('click', async () => {
  const btn = $('ordersRefreshBtn');
  btn.disabled = true;
  btn.classList.add('is-spinning');
  await api.refreshOrders();
  await refresh();
  btn.disabled = false;
  btn.classList.remove('is-spinning');
  toast('Orders refreshed from Linnworks');
});

// Walmart shipped-orders upload: tracking fills onto matching rows in bulk
$('shipImportBtn').addEventListener('click', async () => {
  const btn = $('shipImportBtn');
  btn.disabled = true;
  btn.classList.add('is-busy');
  const res = await api.shipImport().catch(e => ({ ok: false, error: e.message }));
  btn.disabled = false;
  btn.classList.remove('is-busy');
  if (!res || res.canceled) return;
  if (!res.ok) { toast(res.error || 'Could not read that file.'); return; }
  await refresh();
  const bits = [`Tracking filled on ${res.filled} row${res.filled === 1 ? '' : 's'}`];
  if (res.already) bits.push(`${res.already} already had it`);
  if (res.notInQueue.length) bits.push(`${res.notInQueue.length} PO#${res.notInQueue.length === 1 ? '' : 's'} not in the queue`);
  if (res.conflicts.length) bits.push(`${res.conflicts.length} conflict${res.conflicts.length === 1 ? '' : 's'}`);
  toast(bits.join(' · '), 9000);
  // conflicts deserve more than a toast: the details land in the day note
  if (res.conflicts.length) {
    console.warn('shipped-file conflicts:', res.conflicts);
    alertDialog('Tracking conflicts', res.conflicts.join('\n'));
  }
});

// tiny reusable message dialog (native alert() blocks the renderer loop)
function alertDialog(title, body) {
  let dlg = $('appAlertDialog');
  if (!dlg) {
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="appAlertDialog" class="dlg"><div class="dlg-body">
        <h2 class="dlg-title" id="appAlertTitle"></h2>
        <pre class="dlg-note dlg-pre" id="appAlertBody"></pre>
        <div class="dlg-actions"><button id="appAlertClose" class="btn btn-primary">OK</button></div>
      </div></dialog>`);
    dlg = $('appAlertDialog');
    $('appAlertClose').addEventListener('click', () => dlg.close());
  }
  $('appAlertTitle').textContent = title;
  $('appAlertBody').textContent = body;
  dlg.showModal();
}

/* ---------- rows list actions ---------- */

// Per-order location move: warn-not-block when the warehouse shows no stock
// (the owner may have restocked seconds ago), then move and refresh the queue.
async function doOrderMove(orderNumber, target) {
  let res = await api.moveOrder(orderNumber, target, false);
  if (res.needsConfirm && res.warn) {
    if (!confirm(res.warn)) return;
    res = await api.moveOrder(orderNumber, target, true);
  }
  if (!res.ok) {
    toast(res.error || 'Move failed.');
    return;
  }
  toast(`Moved ${orderNumber} to ${res.toName}`);
  await refresh(); // the DS chip / row action flips with the fresh meta
}

async function copyFromApp(text) {
  await api.copyText(text);
  toast(`Copied ${text}`);
}

$('channelChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip-filter');
  if (!chip) return;
  channelFilter = chip.dataset.ch;
  render();
  focusScan();
});

$('clearFailedBtn').addEventListener('click', async () => {
  if (!confirm('Remove all rows whose orders already left Linnworks\' open orders?\nTheir capture history stays in the daily CSVs.')) { focusScan(); return; }
  const res = await api.clearFailedRows();
  if (res.ok) toast(`Removed ${res.removed} row${res.removed === 1 ? '' : 's'}`);
  await refresh();
  focusScan();
});

$('rowsBody').addEventListener('click', async (e) => {
  // PARKED chip: one click clears the parked tag + lock in Linnworks
  const unpark = e.target.closest('[data-unpark]');
  if (unpark) {
    unpark.disabled = true;
    const res = await api.unparkOrder(unpark.dataset.unpark).catch(err => ({ ok: false, error: err.message }));
    if (!res || !res.ok) {
      unpark.disabled = false;
      toast((res && res.error) || 'Could not unpark.');
      return;
    }
    toast(`${unpark.dataset.unpark} unparked — the stock router can move it again`);
    return; // pushState re-renders the list without the chip
  }
  // PO# with a marketplace link: select the row (so the tracking you copy
  // next lands here) and open the order page in the browser
  const link = e.target.closest('.order-link');
  if (link) {
    const tr = link.closest('tr');
    const row = state.rows.find(r => r.id === Number(tr.dataset.id));
    if (row && !row.tracking && row.id !== state.currentRowId) {
      await api.reopenRow(row.id);
      await refresh();
    }
    // the order opens in the SYSTEM browser (owner 2026-09-18: "I want to
    // open the browser, not the side browser... like the default" — this
    // reverses the 2026-09-16 pane routing); the pane keeps its own
    // navigation and stays as whatever it was showing
    api.openOrderPage(link.dataset.po, link.dataset.ch);
    return;
  }
  const btn = e.target.closest('[data-act]');
  const copyEl = e.target.closest('[data-copy]');
  if (!btn && copyEl) { copyFromApp(copyEl.dataset.copy); return; }
  if (!btn) return;
  const card = e.target.closest('tr');
  const id = Number(card.dataset.id);
  const row = state.rows.find(r => r.id === id);
  if (!row) return;

  if (btn.dataset.act === 'substitute') {
    // an item-line button names the line it replaces; the SUB pill edits the
    // existing substitution and keeps its stored line
    openSubDialog(row, btn.dataset.subfor || row.sub_for || '');
    return;
  }
  // Location-move actions stay PARKED (owner is rethinking the workflow);
  // the backend IPC (order:move) stays dormant so re-enabling is just
  // restoring these branches + buttons.
  if (btn.dataset.act === 'moveback' || btn.dataset.act === 'movedropship') {
    return;
  }
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

// right-click a linked PO# to copy it (left-click opens the marketplace)
$('rowsBody').addEventListener('contextmenu', (e) => {
  const link = e.target.closest('.order-link');
  if (!link) return;
  e.preventDefault();
  copyFromApp(link.dataset.po);
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
let pinNext = null; // what the PIN unlocks (settings by default)

function openPinPrompt() {
  $('pinInput').value = '';
  $('pinError').hidden = true;
  $('pinDialog').showModal();
  $('pinInput').focus();
}

// owner-only actions (never-list ✕, …) hide behind the Settings PIN when
// one is set; the unlock lasts the session, same as Settings
async function requireOwner(fn) {
  const cfg = await api.getConfig();
  if (cfg.settingsPinHash && !settingsUnlocked) {
    pinExpected = cfg.settingsPinHash;
    pinNext = fn;
    openPinPrompt();
    return;
  }
  fn();
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
  const next = pinNext || openSettings;
  pinNext = null;
  next();
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
  const pg = cfg.pages || {};
  $('setPageOverview').checked = pg.overview !== false;
  $('setPageStock').checked = pg.stock !== false;
  $('setPagePricing').checked = !!pg.pricing; // opt-in: default off
  $('setPageHistory').checked = pg.history !== false;
  $('setPageReturns').checked = !!pg.returns;
  $('setPageListings').checked = pg.listings !== false;
  const rcv = cfg.receiving || {};
  $('setRecvFolder').textContent = rcv.folder || 'Documents\\Capture Station\\receiving';
  const rsy = cfg.returnsSync || {};
  $('setRetSyncFolder').textContent = rsy.folder || 'off — returns stay on this desktop';
  $('setRetSyncStation').value = rsy.station || '';
  $('setRecvWebhook').value = rcv.webhookUrl || '';
  $('setLowWebhook').value = (cfg.lowStock || {}).webhookUrl || '';
  $('setAppId').value = cfg.linnworks.applicationId;
  $('setAppSecret').value = cfg.linnworks.applicationSecret;
  $('setToken').value = cfg.linnworks.token;
  const sel = $('setLocation');
  sel.innerHTML = cfg.linnworks.locationId
    ? `<option value="${esc(cfg.linnworks.locationId)}">${esc(cfg.linnworks.locationName || cfg.linnworks.locationId)}</option>`
    : '<option value="">Not selected, test connection first</option>';
  $('setDryRun').checked = !!cfg.dryRun;
  $('setShipCutoff').value = cfg.shipCutoff || '16:00';
  const rc = cfg.reorder || {};
  $('setReorderSuggest').checked = rc.suggest !== false;
  $('setReorderAuto').checked = !!rc.auto;
  $('setLeadDays').value = String(rc.leadTimeDays || 7);
  $('setCoverDays').value = String(rc.coverDays || 21);
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

$('chooseRecvBtn').addEventListener('click', async () => {
  const res = await api.chooseReceivingFolder();
  if (res.folder) $('setRecvFolder').textContent = res.folder;
});

$('chooseRetSyncBtn').addEventListener('click', async () => {
  // the station name must exist BEFORE the folder starts syncing — it names
  // this desktop's file. Save it from the field on the way in.
  const st = $('setRetSyncStation').value.trim().toUpperCase();
  if (!st) { toast('Give this station a name first — it labels every return it logs.'); $('setRetSyncStation').focus(); return; }
  await api.setConfig({ returnsSync: { station: st } });
  const res = await api.returnsSyncChooseFolder();
  if (res.folder) $('setRetSyncFolder').textContent = res.folder;
  if (res.ok) { retSyncToasted = false; loadRetPast(); }
});

$('clearRetSyncBtn').addEventListener('click', async () => {
  await api.setConfig({ returnsSync: { folder: '' } });
  $('setRetSyncFolder').textContent = 'off — returns stay on this desktop';
  retSyncInfo = null;
  renderRetSyncLine();
  loadRetPast();
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
    pages: {
      overview: $('setPageOverview').checked,
      stock: $('setPageStock').checked,
      pricing: $('setPagePricing').checked,
      history: $('setPageHistory').checked,
      returns: $('setPageReturns').checked,
      listings: $('setPageListings').checked,
    },
    receiving: { webhookUrl: $('setRecvWebhook').value.trim() },
    returnsSync: { station: $('setRetSyncStation').value.trim().toUpperCase() },
    lowStock: { webhookUrl: $('setLowWebhook').value.trim() },
    linnworks: {
      applicationId: $('setAppId').value.trim(),
      applicationSecret: $('setAppSecret').value.trim(),
      token: $('setToken').value.trim(),
      locationId: sel.value,
      locationName: sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '',
    },
    dryRun: $('setDryRun').checked,
    shipCutoff: /^\d{1,2}:\d{2}$/.test($('setShipCutoff').value.trim()) ? $('setShipCutoff').value.trim() : '16:00',
    stockRouting: {
      enabled: $('setRouting').checked,
      fallbackLocationId: $('setFallbackLoc').value,
      fallbackLocationName: $('setFallbackLoc').selectedOptions[0] ? $('setFallbackLoc').selectedOptions[0].textContent : '',
    },
    reorder: {
      suggest: $('setReorderSuggest').checked,
      auto: $('setReorderAuto').checked,
      leadTimeDays: Math.max(1, parseInt($('setLeadDays').value, 10) || 7),
      coverDays: Math.max(1, parseInt($('setCoverDays').value, 10) || 21),
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
    : `${summary.dryRun ? 'Dry run: ' : ''}${summary.synced} processed, ${summary.failed} failed of ${summary.total}`;
  $('syncDialogTitle').textContent = title;
  const list = $('syncDialogList');
  // failures first - they are what needs reading; clean rows are a glance
  const details = (summary.details || []).slice().sort((a, b) => (a.ok === b.ok ? 0 : a.ok ? 1 : -1));
  list.innerHTML = details.length === 0
    ? '<p class="dlg-note">Nothing to send. Rows are sent to Linnworks once they have a tracking number.</p>'
    : details.map(d => {
      const msg = d.message || '';
      const dropship = d.ok && /dropship/i.test(msg);
      const parked = d.ok && /parked/i.test(msg);
      // processed rows speak through chips; only failures and dry runs need prose
      const extra = (!d.ok || summary.dryRun) ? `<span class="sync-item-msg">${esc(msg)}</span>` : '';
      return `
      <div class="sync-item ${d.ok ? '' : 'is-fail'}">
        <span class="mono">${esc(d.orderNumber)}</span>
        <span class="history-status ${d.ok ? 'st-synced' : 'st-failed'}">${d.ok ? 'Processed' : 'Failed'}</span>
        ${dropship ? '<span class="history-status st-captured">Dropship</span>' : ''}
        ${parked ? '<span class="history-status st-pending">Was parked</span>' : ''}
        ${extra}
      </div>`;
    }).join('');
  $('syncDialog').showModal();
}

$('syncDialogClose').addEventListener('click', () => $('syncDialog').close());
$('syncDialog').addEventListener('close', () => focusScan());

/* ---------- page tabs: Capture / Stock ---------- */

let activePage = 'capture';
let bootPageDone = false; // first state render hops to Overview once

/* ----- page fade on switch (the gliding pill was removed at owner request) ----- */
const PAGE_SECTIONS = { overview: 'overviewPage', capture: 'rowsRow', stock: 'stockPage', returns: 'returnsPage', ebay: 'ebayPage', temu: 'temuPage' };
let showPageSettle = 0; // rapid tab flights only do heavy work where they land
function pageFadeIn(page) {
  const el = $(PAGE_SECTIONS[page] || 'rowsRow');
  if (!el) return;
  el.classList.remove('page-fadein');
  void el.offsetWidth; // restart the animation
  el.classList.add('page-fadein');
}

function showPage(page) {
  const switching = activePage !== page;
  activePage = page;
  if (page !== 'capture') {
    $('findBar').hidden = true; // render() re-shows on capture
  } else if (state) {
    // show the band INSTANTLY with its last-rendered chips — waiting for the
    // 120ms settle render made the filters pop in late (owner, 2026-08-17);
    // the settle render then refreshes the counts in place
    $('findBar').hidden = state.captureOnly && !state.rows.length;
  }
  updateScanPanel();
  $('overviewPage').hidden = page !== 'overview';
  $('rowsRow').hidden = page !== 'capture';
  $('stockPage').hidden = page !== 'stock';
  $('pricingPage').hidden = page !== 'pricing';
  $('shelfPage').hidden = page !== 'shelf';
  $('returnsPage').hidden = page !== 'returns';
  $('ebayPage').hidden = page !== 'ebay';
  $('temuPage').hidden = page !== 'temu';
  $('tabOverview').classList.toggle('is-active', page === 'overview');
  $('tabCapture').classList.toggle('is-active', page === 'capture');
  $('tabStock').classList.toggle('is-active', page === 'stock');
  $('tabPricing').classList.toggle('is-active', page === 'pricing');
  $('tabReturns').classList.toggle('is-active', page === 'returns' || page === 'shelf');
  $('tabListings').classList.toggle('is-active', page === 'ebay' || page === 'temu');
  if (page === 'ebay' || page === 'temu') {
    try { localStorage.setItem('listingsChannel', page); } catch { /* best effort */ }
  }
  // the VISUAL switch is instant (pill, fade, hidden flags); each page's
  // heavy entry work — table renders, data refreshes — waits until the user
  // SETTLES here for a beat, so flying across tabs never stacks re-renders
  // (owner hit the lag rapid-clicking, 2026-08-14)
  clearTimeout(showPageSettle);
  showPageSettle = setTimeout(() => {
    if (activePage !== page) return; // flew past this tab
    if (page === 'overview') {
      enterOverview();
    } else if (page === 'ebay') {
      enterEbay();
    } else if (page === 'temu') {
      enterTemu();
    } else if (page === 'stock') {
      $('stockSearch').value = '';
      $('stockSearchClear').hidden = true;
      loadStockViews();
      loadStock().then(() => {
        // the load takes a beat: never yank focus from a field the user has
        // meanwhile started typing in (a pad edit fed the search bar once)
        const ae = document.activeElement;
        if (activePage === 'stock' && (!ae || ae === document.body)) $('stockSearch').focus();
      });
    } else if (page === 'pricing') {
      enterPricing();
    } else if (page === 'shelf') {
      enterShelf();
    } else if (page === 'returns') {
      applySheetWidth($('retMain'), 'retSheetWidth');
      enterReturns();
    } else {
      focusScan();
    }
    if (state) render(); // footer buttons depend on the active page
  }, switching ? 120 : 0);
  if (bReady) applyBrowserPane(); // the pane only exists on the Capture page
  if (switching) pageFadeIn(page);
}

$('tabCapture').addEventListener('click', () => showPage('capture'));
$('tabStock').addEventListener('click', () => showPage('stock'));
$('tabPricing').addEventListener('click', () => showPage('pricing'));
// Returns is a dropdown (Returns log | Shelf): first click lands on the log
// as always; the caret — or a click while already on either page — opens the
// in-app menu (a <dialog>, so the native marketplace pane yields while it is
// open exactly like every other dialog — replaced the native popup, owner
// 2026-09-12 "make it a dropdown")
$('tabReturns').addEventListener('click', (e) => {
  const wantMenu = e.target.closest('.tab-caret') || activePage === 'returns' || activePage === 'shelf';
  if (!wantMenu) { showPage('returns'); return; }
  const dlg = $('returnsMenuDlg');
  const shelfOn = !!(state && state.pages && state.pages.stock);
  for (const b of dlg.querySelectorAll('.tab-menu-item')) {
    b.hidden = b.dataset.page === 'shelf' && !shelfOn;
    b.classList.toggle('is-current', activePage === b.dataset.page);
  }
  dlg.showModal();
  // anchor under the tab, clamped so a narrow window never clips the menu
  const r = $('tabReturns').getBoundingClientRect();
  dlg.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - dlg.offsetWidth - 8)))}px`;
  dlg.style.top = `${Math.round(r.bottom + 4)}px`;
});
// a click on an item picks it; a click on the backdrop (the dialog itself)
// dismisses; Esc closes natively
$('returnsMenuDlg').addEventListener('click', (e) => {
  const item = e.target.closest('.tab-menu-item');
  $('returnsMenuDlg').close();
  if (item) showPage(item.dataset.page);
});

/* ---------- Shelf: the returns sell-through radar ---------- */
// One row per condition SKU (returns only — the owner cut All stock/New
// 2026-09-12 along with the trend, sell-thru and money tiles), sorted
// stalest-first; Idle is the single tinted column. Sold / Avg sold at /
// Rate follow the Sold-in period picker, sold-out returns stay visible.
let shData = null;
let shView = ''; // '' = every condition | openbox | used | scrap | soldout
let shRange = 30; // the Sold-in period, days
let shSort = { key: 'idle', dir: -1 }; // idle | sold | avg | rate; -1 = biggest first
let shBusy = false;
const SH_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SH_GROUPS = [
  ['openbox', 'Open Box', (r) => r.cond === 'openbox'],
  ['used', 'Used', (r) => r.cond === 'used'],
  ['scrap', 'Scrap', (r) => r.cond === 'scrap'],
  ['soldout', 'Sold out', (r) => !r.units],
];
const SH_RANGES = [['This week', 7], ['30 days', 30], ['60 days', 60], ['90 days', 90]];

function enterShelf() {
  if (shData) renderShelf(); // stale numbers instantly, fresh ones follow
  loadShelf(false);
}

async function loadShelf(force) {
  if (shBusy) return;
  shBusy = true;
  $('shRefresh').disabled = true;
  if (!shData) { $('shEmpty').hidden = false; $('shEmpty').textContent = 'Crunching 90 days of sales…'; }
  const res = await api.shelfGet(force).catch(e => ({ ok: false, error: e.message }));
  shBusy = false;
  $('shRefresh').disabled = false;
  if (!res || !res.ok) {
    if (!shData) $('shEmpty').textContent = (res && res.error) || 'Could not load the shelf.';
    else toast((res && res.error) || 'Shelf refresh failed');
    return;
  }
  shData = res;
  if (activePage === 'shelf') renderShelf();
}

// r.sales is [[ts, qty, revenue], …] newest first, the full 90-day window
const shLastTs = (r) => (r.sales && r.sales.length ? r.sales[0][0] : 0);
const shIdleDays = (r) => {
  const t = shLastTs(r) || r.arrivedTs || 0;
  return t ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : Infinity;
};
const shDay = (ts) => {
  const d = new Date(ts);
  const yr = d.getFullYear() !== new Date().getFullYear() ? ` '${String(d.getFullYear()).slice(2)}` : '';
  return `${SH_MONTHS[d.getMonth()]} ${d.getDate()}${yr}`;
};

// aggregates inside the Sold-in period (newest-first lets the loop stop early)
function shStats(r) {
  const cut = Date.now() - shRange * 86400000;
  let sold = 0;
  let revenue = 0;
  for (const [ts, qty, rev] of r.sales || []) {
    if (ts < cut) break;
    sold += qty;
    revenue += rev;
  }
  const last = r.sales && r.sales[0];
  return {
    sold,
    revenue,
    avg: sold ? revenue / sold : 0,
    rate: sold / (shRange / 7),
    lastPrice: last ? (last[1] ? Math.round((last[2] / last[1]) * 100) / 100 : last[2]) : 0,
  };
}

// one tile: how many returns sold in the period and the weekly pace
// (the sales-$ / avg-price / dead-stock tiles were cut, owner 2026-09-12)
function renderShTiles(rows, fn) {
  let sold = 0;
  for (const r of rows.filter(fn)) sold += shStats(r).sold;
  const label = (SH_RANGES.find(x => x[1] === shRange) || SH_RANGES[1])[0].toLowerCase();
  $('shTiles').innerHTML = `
    <div class="sh-tile"><div class="sh-tile-l">Sold · ${label}</div><div class="sh-tile-b mono">${sold}</div><div class="sh-tile-f">${(sold / (shRange / 7)).toFixed(1)} per week</div></div>`;
}

function renderShelf() {
  if (!shData) return;
  const rows = shData.rows;
  // chips toggle: the active one clicks off back to every condition
  $('shChips').innerHTML = '<div class="stock-tray">' + SH_GROUPS.map(([key, label, fn]) =>
    `<button class="view-chip ${shView === key ? 'is-active' : ''}" data-shview="${key}">${label} · ${rows.filter(fn).length}</button>`).join('') + '</div>';
  $('shRangeChips').innerHTML = '<div class="stock-tray">' + SH_RANGES.map(([label, d]) =>
    `<button class="view-chip ${shRange === d ? 'is-active' : ''}" data-shrange="${d}">${label}</button>`).join('') + '</div>';
  const group = SH_GROUPS.find(g => g[0] === shView);
  const fn = group ? group[2] : () => true;
  renderShTiles(rows, fn);
  const q = $('shSearch').value.trim().toUpperCase();
  const stats = new Map();
  for (const r of rows) stats.set(r, shStats(r));
  const keyOf = {
    idle: (r) => shIdleDays(r),
    sold: (r) => stats.get(r).sold,
    avg: (r) => stats.get(r).avg,
    rate: (r) => stats.get(r).rate,
  }[shSort.key] || shIdleDays;
  const list = rows.filter(fn)
    .filter(r => !q || String(r.sku).toUpperCase().includes(q) || String(r.title).toUpperCase().includes(q))
    .sort((a, b) => (keyOf(b) - keyOf(a)) * -shSort.dir || String(a.sku).localeCompare(String(b.sku)));
  $('shTable').hidden = !list.length;
  $('shEmpty').hidden = !!list.length;
  if (!list.length) $('shEmpty').textContent = 'Nothing on the shelf matches.';
  const arr = (k) => shSort.key === k ? (shSort.dir < 0 ? ' ▼' : ' ▲') : '';
  $('shTable').innerHTML = `<tr><th class="gut">#</th><th>SKU</th><th class="r">Units</th><th class="r">Current price</th>`
    + `<th class="r sh-sort" data-shsort="sold" title="Units sold inside the period — click to sort">Sold${arr('sold')}</th>`
    + `<th class="r sh-sort" data-shsort="avg" title="Average realized price inside the period — click to sort">Avg sold at${arr('avg')}</th>`
    + `<th class="r sh-sort" data-shsort="rate" title="Units per week inside the period — click to sort">Rate${arr('rate')}</th>`
    + `<th class="r sh-sort" data-shsort="idle" title="Days since the last sale (or since arrival) — click to sort">Idle${arr('idle')}</th>`
    + `<th>Last sold</th></tr>`
    + list.map((r, i) => {
      const st = stats.get(r);
      const soldOut = !r.units;
      const idle = shIdleDays(r);
      const idleTxt = idle === Infinity ? `>${shData.windowDays}d` : `${idle}d`;
      const idleCls = idle === Infinity || idle >= 30 ? 'sh-bad' : idle >= 14 ? 'sh-warn' : '';
      const lastTs = shLastTs(r);
      // a sale OLDER than the current stock's arrival is history, not traction
      const ghost = lastTs && r.arrivedTs && lastTs < r.arrivedTs;
      return `<tr><td class="gut">${i + 1}</td>`
        + `<td class="mono" title="${esc(r.title)}">${esc(r.sku)}${soldOut ? ' <span class="sh-out">Sold out</span>' : ''}</td>`
        + `<td class="r mono">${r.units}</td>`
        + `<td class="r mono">${r.price ? `$${Number(r.price).toFixed(2)}` : '—'}</td>`
        + `<td class="r mono">${st.sold || '<span class="sh-dim">0</span>'}</td>`
        + `<td class="r mono">${st.sold ? `$${st.avg.toFixed(2)}` : '<span class="sh-dim">—</span>'}</td>`
        + `<td class="r mono">${st.sold ? `${st.rate.toFixed(1)}<span class="sh-dim">/wk</span>` : '<span class="sh-dim">—</span>'}</td>`
        + (soldOut ? '<td class="r mono sh-good" title="Sold through — nothing left to move">✓</td>' : `<td class="r mono ${idleCls}">${idleTxt}</td>`)
        + `<td class="mono ${lastTs ? 'sh-dim' : 'sh-never'}"${ghost ? ' title="Sold before the current stock arrived"' : ''}>`
        + (lastTs ? `${shDay(lastTs)} · $${Number(st.lastPrice).toFixed(2)}${ghost ? ' *' : ''}`
          : (r.arrivedTs ? `never · listed ${shDay(r.arrivedTs)}` : 'never')) + '</td></tr>';
    }).join('');
  const units = list.reduce((s, r) => s + r.units, 0);
  const value = list.reduce((s, r) => s + r.units * (r.price || 0), 0);
  const soldHere = list.reduce((s, r) => s + stats.get(r).sold, 0);
  $('shSum').textContent = `${list.length} SKU${list.length === 1 ? '' : 's'} · ${units.toLocaleString()} unit${units === 1 ? '' : 's'} · $${Math.round(value).toLocaleString()} at current prices · ${soldHere} sold in the last ${shRange} days`;
}

$('shChips').addEventListener('click', (e) => {
  const c = e.target.closest('[data-shview]');
  if (!c) return;
  shView = shView === c.dataset.shview ? '' : c.dataset.shview; // toggle off = all
  renderShelf();
});
$('shRangeChips').addEventListener('click', (e) => {
  const c = e.target.closest('[data-shrange]');
  if (!c) return;
  shRange = Number(c.dataset.shrange);
  renderShelf();
});
$('shTable').addEventListener('click', (e) => {
  const th = e.target.closest('th.sh-sort');
  if (!th) return;
  const k = th.dataset.shsort;
  if (shSort.key === k) shSort.dir = -shSort.dir;
  else shSort = { key: k, dir: -1 };
  renderShelf();
});
$('shSearch').addEventListener('input', renderShelf);
$('shRefresh').addEventListener('click', () => loadShelf(true));
$('stockShelfLink').addEventListener('click', () => { shView = ''; showPage('shelf'); });

// receiving lives on the Stock page now, as a dialog
/* ---------- "shipped different item" substitution dialog ---------- */

let subRowId = null;
let subNoteDirty = false; // stop regenerating once the user edits the note
let subForSku = ''; // the listed line being replaced ('' = whole order, legacy)

// the auto note the pill/CSV carry: pure, e2e-testable
function subDefaultNote(listedSku, shippedSku) {
  return `ordered ${listedSku || 'listed item'}, shipped ${shippedSku}`;
}

function subListedSku(row) {
  const meta = state ? metaFor(row) : null;
  const first = meta && meta.items && meta.items[0];
  return first ? (first.sku || first.channelSku || '') : '';
}

function openSubDialog(row, forSku) {
  subRowId = row.id;
  subNoteDirty = !!row.sub_note;
  const meta = metaFor(row);
  const items = (meta && meta.items) || [];
  // which listed line is being replaced: the clicked line, the stored one,
  // or (single-line orders) the only line there is
  subForSku = String(forSku || row.sub_for || subListedSku(row) || '').trim();
  const forLine = items.find(i => (i.sku || i.channelSku) === subForSku) || items[0];
  $('subOrderLine').textContent = `${row.order_number} · replacing: ${subForSku || 'listed item'}${items.length > 1 ? ` (1 of ${items.length} lines)` : ''}`;
  $('subSku').value = row.sub_sku || '';
  $('subQty').value = String(row.sub_qty || (forLine && forLine.qty) || 1);
  $('subNote').value = row.sub_note || '';
  $('subClear').hidden = !row.sub_sku;
  $('subResult').hidden = true;
  ensureInventory();
  $('subDialog').showModal();
  $('subSku').focus();
}

function subFeedback(msg) {
  const el = $('subResult');
  el.textContent = msg;
  el.hidden = !msg;
  el.className = 'dlg-note test-result is-fail';
}

function subRegenNote() {
  if (subNoteDirty || subRowId == null) return;
  const row = (state.rows || []).find(r => r.id === subRowId);
  const shipped = $('subSku').value.trim();
  $('subNote').value = shipped ? subDefaultNote(subForSku || subListedSku(row || {}), shipped) : '';
}

makeCombo($('subSku'), $('subComboList'), (item) => {
  $('subSku').value = item.sku;
  subRegenNote();
  $('subQty').focus();
  $('subQty').select();
}, { claims: (sku) => subPendingClaims(sku, subRowId) });
$('subSku').addEventListener('input', subRegenNote);
$('subNote').addEventListener('input', () => { subNoteDirty = true; });

$('subSave').addEventListener('click', async () => {
  const btn = $('subSave');
  if (btn.disabled) return;
  const sku = $('subSku').value.trim();
  const qty = Number($('subQty').value);
  if (!sku) { subFeedback('Pick the SKU that actually shipped.'); return; }
  if (recvLookup === 'ready' && !recvLookupExact(sku)) { subFeedback(`Unknown SKU: ${sku}. Pick one from the inventory.`); return; }
  if (!Number.isInteger(qty) || qty < 1) { subFeedback('Quantity must be a whole number of 1 or more.'); return; }
  // the app is the reservation system for substitutes: real stock that other
  // pending substitutions already claim cannot be promised twice (typed-in
  // SKUs would otherwise sneak past the greyed-out picker option)
  const invItem = recvLookup === 'ready' ? recvLookupExact(sku) : null;
  if (invItem) {
    const availHere = invAvailAtPrimary(invItem);
    const claimed = subPendingClaims(sku, subRowId);
    if (availHere !== null && availHere > 0 && claimed + qty > availHere) {
      subFeedback(`${claimed} of ${availHere} available ${invItem.sku} already promised to another order — only ${Math.max(0, availHere - claimed)} left to substitute.`);
      return;
    }
  }
  // a rejected IPC (or one returning nothing) used to kill this handler
  // mid-flight: the dialog just sat there with no message. Never again.
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const res = await api.substituteRow(subRowId, invItem ? invItem.sku : sku, qty, $('subNote').value.trim(), false, subForSku);
    if (!res || !res.ok) { subFeedback((res && res.error) || 'Could not save the substitution.'); return; }
    $('subDialog').close();
    const movedMsg = res.moved === 'primary'
      ? ' — order moved back to the warehouse'
      : res.moved === 'fallback' ? ' — order routed to dropship (substitute not in stock)' : '';
    const saved = res.row || {};
    toast(`Substitution saved: ${saved.sub_sku || sku} ×${saved.sub_qty || qty}${movedMsg}`);
    await refresh();
  } catch (e) {
    subFeedback(`Could not save: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
});

$('subClear').addEventListener('click', async () => {
  const res = await api.substituteRow(subRowId, '', 0, '', true).catch(e => ({ ok: false, error: e.message }));
  if (!res || !res.ok) { subFeedback((res && res.error) || 'Could not remove the substitution.'); return; }
  $('subDialog').close();
  const clearedMsg = res.moved === 'primary'
    ? ' — order moved back to the warehouse'
    : res.moved === 'fallback' ? ' — order routed to dropship (listed item not in stock)' : '';
  toast(`Substitution removed${clearedMsg}`);
  await refresh();
});

$('subCancel').addEventListener('click', () => $('subDialog').close());
$('subDialog').addEventListener('close', () => { subRowId = null; focusScan(); });

/* ---------- New SKU dialog ---------- */

let skuDialogCb = null; // onCreated(sku) - the returns mapping flows use this

// Pure and offline-testable: everything the dialog can catch before Linnworks.
function validateNewSku(f, items) {
  const sku = String(f.sku || '').trim().toUpperCase();
  if (!sku) return 'SKU is required.';
  if (!/^[A-Z0-9][A-Z0-9\-_./]*$/.test(sku)) return 'SKU can only use letters, numbers and - _ . /';
  if (!String(f.title || '').trim()) return 'Title is required.';
  const qty = f.qty === '' || f.qty == null ? 0 : Number(f.qty);
  if (!Number.isInteger(qty) || qty < 0) return 'Starting quantity must be a whole number of 0 or more.';
  if ((items || []).some(i => String(i.sku || '').toUpperCase() === sku)) return `${sku} already exists in the inventory.`;
  return '';
}

function skuFeedback(msg, ok = true) {
  const el = $('skuResult');
  el.textContent = msg;
  el.hidden = !msg;
  el.className = `dlg-note test-result${msg ? (ok ? ' is-ok' : ' is-fail') : ''}`;
}

function skuBusy(busy) {
  for (const id of ['skuSku', 'skuTitle', 'skuBarcode', 'skuQty', 'skuRetail', 'skuPurchase', 'skuCancel']) {
    $(id).disabled = busy;
  }
  $('skuCreate').disabled = busy;
  $('skuCreate').textContent = busy ? 'Creating…' : 'Create SKU';
}

function openNewSkuDialog(prefill = {}, onCreated = null) {
  skuDialogCb = onCreated;
  $('skuSku').value = String(prefill.sku || '').toUpperCase();
  $('skuTitle').value = prefill.title || '';
  $('skuBarcode').value = '';
  $('skuQty').value = '0';
  $('skuRetail').value = prefill.retailPrice ? String(prefill.retailPrice) : '';
  $('skuPurchase').value = '';
  $('skuLoc').textContent = (stockCache && stockCache.locationName) || 'the warehouse';
  ensureInventory(); // duplicate check wants the live list
  skuFeedback('');
  skuBusy(false);
  $('skuDialog').showModal();
  $('skuSku').focus();
}

// Tab out of the SKU field auto-fills an empty title: the BASE item's title
// plus the condition, or a humanized SKU when the base is unknown
function skuTitleSuggestion(sku) {
  const s = String(sku || '').trim().toUpperCase();
  if (!s) return '';
  const m = s.match(/^(OPEN-BOX|USED|SCRAP)-(.+)$/);
  const suffix = m ? ({ 'OPEN-BOX': ' - Open Box', USED: ' - Used', SCRAP: ' - For Parts' })[m[1]] : '';
  const base = m ? m[2] : s;
  const known = recvBySku && recvBySku.get(base.toLowerCase());
  if (known && known.title) return `${known.title}${suffix}`;
  const human = base.split('-').filter(Boolean)
    .map(p => (/\d/.test(p) ? p : p[0] + p.slice(1).toLowerCase())).join(' ');
  return `${human}${suffix}`;
}
$('skuSku').addEventListener('blur', () => {
  if (!$('skuTitle').value.trim() && $('skuSku').value.trim()) {
    $('skuTitle').value = skuTitleSuggestion($('skuSku').value);
  }
});

// SKUs live uppercase in Linnworks: normalize as the user types
$('skuSku').addEventListener('input', () => {
  const el = $('skuSku');
  const pos = el.selectionStart;
  el.value = el.value.toUpperCase();
  el.setSelectionRange(pos, pos);
});

$('skuCreate').addEventListener('click', async () => {
  const fields = {
    sku: $('skuSku').value.trim().toUpperCase(),
    title: $('skuTitle').value.trim(),
    barcode: $('skuBarcode').value.trim(),
    retailPrice: Number($('skuRetail').value) || 0,
    purchasePrice: Number($('skuPurchase').value) || 0,
    qty: $('skuQty').value.trim() === '' ? 0 : Number($('skuQty').value),
  };
  const err = validateNewSku(fields, recvItems || (stockCache && stockCache.items) || []);
  if (err) { skuFeedback(err, false); return; }
  skuBusy(true);
  const res = await api.createSku(fields);
  skuBusy(false);
  if (!res.ok) { skuFeedback(res.error || 'Could not create the SKU.', false); return; }
  toast(`Created ${res.sku}`);
  // the shared inventory caches see the new item straight away
  const item = {
    sku: res.sku, title: fields.title, barcode: fields.barcode,
    stockItemId: res.stockItemId, retailPrice: fields.retailPrice,
    purchasePrice: fields.purchasePrice, image: '', category: '', levels: [],
  };
  if (recvItems) {
    recvItems.push(item);
    if (recvBySku) recvBySku.set(res.sku.toLowerCase(), item);
    if (recvByBarcode && fields.barcode) recvByBarcode.set(fields.barcode.toLowerCase(), item);
  }
  const cb = skuDialogCb; // grab before close() clears it
  skuDialogCb = null;
  $('skuDialog').close();
  if (activePage === 'stock') loadStock(); // fresh grid shows the new item
  if (cb) cb(res.sku);
});

$('skuCancel').addEventListener('click', () => $('skuDialog').close());
$('skuDialog').addEventListener('close', () => { skuDialogCb = null; focusScan(); });
$('newSkuBtn').addEventListener('click', () => openNewSkuDialog());

$('recvBtn').addEventListener('click', () => {
  $('recvDialog').showModal();
  enterReceiving();
});
$('recvClose').addEventListener('click', () => $('recvDialog').close());

/* ---------- embedded marketplace browser pane ---------- */

// The pane is a native WebContentsView the main process docks over #bView's
// rectangle. The renderer reserves the space, reports the bounds, and hides
// the pane while any dialog is open (a native view draws above the DOM).
let bPane = { visible: false, width: 480 };
let bReady = false; // config loaded

async function initBrowserPane() {
  const cfg = await api.getConfig();
  const bp = cfg.browserPane || {};
  bPane.width = Math.max(280, Number(bp.width) || 480);
  bPane.visible = !!bp.visible;
  bReady = true;
  applyBrowserPane();
}

function browserAllowed() {
  return !!state && !state.captureOnly; // sync-mode Capture tool
}

function applyBrowserPane() {
  // one native pane, two homes: the dock element relocates between the
  // Capture list and the Returns sheets depending on the active page
  const onPage = activePage === 'capture' || activePage === 'returns';
  const show = bReady && browserAllowed() && bPane.visible && onPage;
  // Returns docks the pane at PAGE level so it spans the full window height,
  // not just the sheet row; Capture keeps it inside the list row.
  const host = activePage === 'returns' ? $('returnsPage') : $('rowsRow');
  const dock = $('bDock');
  const divider = $('bDivider');
  if (host && dock.parentElement !== host) {
    host.insertBefore(divider, host.firstChild);
    host.insertBefore(dock, divider);
  }
  dock.hidden = !show;
  divider.hidden = !show;
  $('rowsRow').classList.toggle('has-browser', show && activePage === 'capture');
  $('returnsPage').classList.toggle('has-browser', show && activePage === 'returns');
  // compact columns while the sheets share the window with the pane
  document.body.classList.toggle('ret-compact', show && activePage === 'returns');
  $('bExpand').hidden = !(bReady && browserAllowed() && activePage === 'capture' && !bPane.visible);
  if (show) {
    // display-clamp only (the saved width survives): a pane remembered from a
    // wide window must never crush the sheet — the band needs room for its
    // buttons (the vanished Refresh, 2026-08-21) and the list for its columns
    dock.style.width = `${Math.min(bPane.width, Math.max(320, window.innerWidth - 560))}px`;
    // (a negative-margin lift to the search bar was tried 2026-08-13 and
    // reverted same day: the native view overlapped the tab bar when the
    // toolbar wrapped — the pane stays below the toolbar)
    if (activePage === 'capture') { $('capMain').style.width = ''; $('rowsMain').style.width = ''; } // the sheet takes whatever remains
    else $('retMain').style.width = '';
    dock.style.marginTop = '';
  } else {
    dock.style.marginTop = '';
    // widths are a share of the row (v1.20.43), so re-applying after the
    // pane closes always fits — the old pixel clamp is gone.
    // capture's saved width belongs to capMain (band + sheet as ONE column
    // since 2026-08-17); pinning the inner rowsMain froze the grip drag —
    // the outer shell moved, the table did not (owner report 2026-08-25)
    applySheetWidth($('capMain'), 'captureSheetWidth');
    $('rowsMain').style.width = ''; // clear the stale inner pin once
    applySheetWidth($('retMain'), 'retSheetWidth');
    if (bLoad.active) bHideLoading(); // collapsing mid-load resets the panel
  }
  if (activePage === 'returns') renderRetLog(); // colspan follows the column count
  syncBrowserBounds();
}

// a freshly opened pane has NO page yet — a bare white rectangle that reads
// as a broken screen. Expanding with nothing loaded starts on Walmart
// Seller Center (the platform chips switch from there).
function bExpandPane() {
  bPane.visible = true;
  api.setConfig({ browserPane: { visible: true } });
  applyBrowserPane();
  const dom = $('bDomain').textContent;
  if (!dom || dom === '—') {
    bShowLoading(`Opening ${channelLabel('walmart')}`);
    api.browserOpenUrl(MARKET_HOME.walmart).then(res => {
      if (!res.ok) {
        bHideLoading();
        if (res.error) toast(res.error);
      }
    });
  }
}

/* ---------- whole-app zoom: Ctrl+scroll, persisted ---------- */
// (the marketplace pane keeps its own separate Ctrl+wheel zoom — this one
// scales the app's UI; the pane bounds re-sync because browserLayout scales
// by the live zoom factor in preload)
let uiZoomToast = 0;
function uiApplyZoom(z) {
  const applied = api.uiZoom(z);
  try { localStorage.setItem('uiZoom', String(applied)); } catch { /* best effort */ }
  if (bReady) syncBrowserBounds();
  clearTimeout(uiZoomToast);
  uiZoomToast = setTimeout(() => toast(`${Math.round(applied * 100)}%`, 900), 60);
}
window.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const curZ = api.uiZoomGet();
  uiApplyZoom(curZ + (e.deltaY < 0 ? 0.1 : -0.1));
}, { passive: false });
// Ctrl+0 snaps back to 100%
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === '0') { e.preventDefault(); uiApplyZoom(1); }
});
// the app menu's zoom items (Cmd/Ctrl +, −, 0) land here so the native
// pane's bounds re-sync — the raw Electron menu roles skipped that and the
// marketplace pane overlapped the sheet after a menu zoom (owner 2026-09-17)
api.on('ui:zoom', (d) => {
  const dir = (d && d.dir) || 'reset';
  uiApplyZoom(dir === 'reset' ? 1 : api.uiZoomGet() + (dir === 'in' ? 0.1 : -0.1));
});
try {
  const savedZ = Number(localStorage.getItem('uiZoom'));
  if (savedZ && Math.abs(savedZ - 1) > 0.01) api.uiZoom(savedZ);
} catch { /* default zoom */ }

// coalesce bounds updates (resize, divider drag, dialogs) into one per frame
let bSyncQueued = false;

function syncBrowserBounds() {
  if (bSyncQueued) return;
  bSyncQueued = true;
  requestAnimationFrame(() => {
    bSyncQueued = false;
    alignCaptureToolbar(); // the find bar tracks the sheet column's edges
    // the native view yields to dialogs, the DOM loading panel, AND divider
    // drags - while it is frontmost it swallows mousemove, killing the drag.
    // EXCEPTION: the receive popup docked beside the pane — the owner wants
    // the marketplace visible while receiving (2026-08-08)
    const blockingDialog = [...document.querySelectorAll('dialog[open]')]
      .some(d => !(d.id === 'retRecvDialog' && d.classList.contains('beside-pane')));
    if ($('bDock').hidden || blockingDialog || bLoad.active || bDrag) {
      api.browserLayout({ visible: false });
      return;
    }
    const r = $('bView').getBoundingClientRect();
    api.browserLayout({ visible: true, x: r.left, y: r.top, width: r.width, height: r.height });
  });
}

// dialogs float above the DOM but under a native view: hide the pane while
// any <dialog> is open, restore it on close
const _showModal = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function (...args) {
  const out = _showModal.apply(this, args);
  syncBrowserBounds();
  return out;
};
// capture-phase so it covers every dialog, including ones created later
// ('close' does not bubble; a startup querySelectorAll missed new dialogs)
document.addEventListener('close', (e) => {
  if (e.target instanceof HTMLDialogElement) syncBrowserBounds();
}, true);

new ResizeObserver(() => syncBrowserBounds()).observe($('bView'));
// belt and braces: anything that reflows the layout without tripping the
// observers (the menu zoom roles did, 2026-09-17) self-heals within a
// second — the native pane can never stay parked over the sheet
setInterval(() => { if (!$('bDock').hidden) syncBrowserBounds(); }, 1000);
window.addEventListener('resize', () => {
  // shrinking the window re-clamps the pane so the sheet side never vanishes
  if (!$('bDock').hidden) applyBrowserPane();
  else syncBrowserBounds();
});

$('bExpand').addEventListener('click', bExpandPane);

$('bCollapse').addEventListener('click', () => {
  bPane.visible = false;
  api.setConfig({ browserPane: { visible: false } });
  applyBrowserPane();
});

// divider drag, persisted to config like the sheet widths
let bDrag = null;

$('bDivider').addEventListener('mousedown', (e) => {
  e.preventDefault();
  bDrag = { startX: e.clientX, startW: $('bDock').offsetWidth };
  $('bDivider').classList.add('is-active');
  syncBrowserBounds(); // hide the native view for the duration of the drag
});

window.addEventListener('mousemove', (e) => {
  if (!bDrag) return;
  const max = Math.max(320, window.innerWidth - 560); // the sheet keeps real room (was 380 — too little for the band's buttons)
  bPane.width = Math.min(max, Math.max(280, bDrag.startW + (e.clientX - bDrag.startX)));
  $('bDock').style.width = `${bPane.width}px`;
  syncBrowserBounds();
});

window.addEventListener('mouseup', () => {
  if (!bDrag) return;
  bDrag = null;
  $('bDivider').classList.remove('is-active');
  api.setConfig({ browserPane: { width: bPane.width } });
  syncBrowserBounds(); // the native view returns at the new width
});

// double-click the divider: back to the default split, like the sheet grips
$('bDivider').addEventListener('dblclick', () => {
  bPane.width = 480;
  api.setConfig({ browserPane: { width: 480 } });
  applyBrowserPane();
});

// manual navs get the generic loading treatment
const bManualNav = (action) => {
  bShowLoading('Loading…');
  api.browserNav(action);
};
$('bBack').addEventListener('click', () => bManualNav('back'));
$('bFwd').addEventListener('click', () => bManualNav('forward'));
$('bReload').addEventListener('click', () => bManualNav('reload'));
$('bPrint').addEventListener('click', () => api.browserPrint());

// pane zoom: buttons here, Ctrl+wheel in main; the % chip resets to 100
$('bZoomIn').addEventListener('click', () => api.browserZoom('in'));
$('bZoomOut').addEventListener('click', () => api.browserZoom('out'));
$('bZoomPct').addEventListener('click', () => api.browserZoom('reset'));

api.on('browser:zoom', ({ factor }) => {
  const pct = Math.round((Number(factor) || 1) * 100);
  $('bZoomPct').textContent = `${pct}%`;
  $('bZoomPct').hidden = pct === 100; // chip only shows when zoomed
});

api.on('browser:state', (s) => {
  $('bDomain').textContent = s.domain || '—'; // domain only, never the raw URL
  $('bDomain').classList.toggle('is-loading', !!s.loading);
  $('bBack').disabled = !s.canGoBack;
  $('bFwd').disabled = !s.canGoForward;
  if (bLoad.active && !bLoad.failed && s.domain) $('bLoadDomain').textContent = s.domain;
});

// one-click marketplace homes: the pane's persistent session means the
// saved seller logins are already active
const MARKET_HOME = {
  walmart: 'https://seller.walmart.com/orders/manage-orders',
  ebay: 'https://www.ebay.com/sh/ord',
  temu: 'https://seller.temu.com/',
};

// the globe opens a NATIVE menu (chips replaced at the owner's request,
// 2026-08-07) — native because the marketplace page draws above the DOM
// and would cover an HTML dropdown
$('bGlobe').addEventListener('click', () => api.browserPlatformMenu());

/* pane loading screen: while a page loads, the native view hides and this
   DOM panel fills the reserved space (canvas bg, accent spinner, no URLs) */

const bLoad = { active: false, failed: false, timer: null };

function bShowLoading(label) {
  bLoad.active = true;
  bLoad.failed = false;
  clearTimeout(bLoad.timer);
  // guard: a page that never fires loadend must not leave the pane stuck
  bLoad.timer = setTimeout(() => { if (bLoad.active && !bLoad.failed) bHideLoading(); }, 20000);
  $('bLoadLabel').textContent = label;
  $('bLoadLabel').hidden = false;
  $('bLoadSpin').hidden = false;
  const dom = $('bDomain').textContent;
  $('bLoadDomain').textContent = dom === '—' ? '' : dom;
  $('bLoadErr').hidden = true;
  $('bLoadPanel').hidden = false;
  syncBrowserBounds();
}

function bHideLoading() {
  clearTimeout(bLoad.timer);
  bLoad.active = false;
  bLoad.failed = false;
  $('bLoadPanel').hidden = true;
  syncBrowserBounds();
}

function bShowLoadError(message) {
  if (!bLoad.active) return;
  bLoad.failed = true;
  clearTimeout(bLoad.timer);
  $('bLoadSpin').hidden = true;
  $('bLoadLabel').hidden = true;
  $('bLoadErrText').textContent = message || 'The page failed to load.';
  $('bLoadErr').hidden = false;
  syncBrowserBounds(); // the view stays hidden behind the error panel
}

api.on('browser:loadstart', ({ domain }) => {
  if ($('bDock').hidden) return;
  if (!bLoad.active) bShowLoading('Loading…'); // page-initiated / manual navs
  if (!bLoad.failed && domain) $('bLoadDomain').textContent = domain;
});

api.on('browser:loadend', () => {
  if (bLoad.active && !bLoad.failed) bHideLoading();
});

api.on('browser:loadfail', ({ desc, domain }) => {
  if ($('bDock').hidden) return;
  if (!bLoad.active) bShowLoading('Loading…');
  if (domain) $('bLoadDomain').textContent = domain;
  bShowLoadError(desc ? `Could not load the page (${desc}).` : 'Could not load the page.');
});

$('bLoadRetry').addEventListener('click', () => {
  bShowLoading('Loading…');
  api.browserNav('reload');
});

api.on('browser:download', ({ file, state: dlState }) => {
  toast(dlState === 'completed' ? `Downloaded ${file}` : `Download ${dlState}: ${file}`, 3500);
});

/* ---------- stock page ---------- */

let stockCache = null;

/* condition view chips: config-driven filters over SKU/title (AND with search) */

let stockViews = null; // loaded once from config.stockViews
// built-in "New" view: brand-new sealed stock has NO condition marker in the
// SKU/title, so it filters as "matches none of the configured views"
const STOCK_VIEW_NEW = { label: 'New', plain: true, tint: 'green' };
let stockActiveView = null; // null = All
let stockWfsActive = false; // WFS view: read-only levels at the Walmart-managed location
let stockLowActive = false; // Low stock view: Available below the minimum level
let stockDsActive = false; // DropShip program view: pads + velocity + BUY signals
let stockUnlistedActive = false; // in-stock SKUs no marketplace can sell
let chLinked = null; // { walmart: Set(stockItemId), ebay: Set, temu: Set } | null
let chSkuMap = null; // { stockItemId: [channel SKUs] } — the search box matches these too
let chLinkedLoading = false;

async function loadChLinked() {
  if (chLinkedLoading || chLinked || (state && state.captureOnly)) return;
  chLinkedLoading = true;
  try {
    const res = await api.mappingLinkedSets();
    if (res.ok) {
      chLinked = {};
      for (const [k, ids] of Object.entries(res.sets || {})) chLinked[k] = new Set(ids);
      chSkuMap = {};
      for (const [id, list] of Object.entries(res.chskus || {})) chSkuMap[id] = list.map(s => String(s));
      if (activePage === 'stock' && stockCache) { renderStockChips(); renderStock(); }
      if (activePage === 'ebay') renderEbayQueue(); // the queue reads the eBay link set
    }
  } finally {
    chLinkedLoading = false;
  }
}

// (the "MISSING LISTINGS  Walmart 2 · …" subline and its per-channel gap
// filter were removed at the owner's request 2026-09-12 — the Unlisted
// view with its per-row channel chips is the one listings nag now)
let dsPads = null; // { SKU: padQty } from config
let reorderStats = null; // per-SKU velocity / suggestions from dropship:stats
let reorderMeta = { leadTimeDays: 7, coverDays: 21 };
let reorderLoading = false;

async function loadReorderStats() {
  if (reorderLoading) return;
  reorderLoading = true;
  try {
    const cfg = await api.getConfig();
    dsPads = cfg.dropshipPads || {};
    const res = await api.dropshipStats();
    if (res.ok) {
      reorderStats = res.stats;
      reorderMeta = { leadTimeDays: res.leadTimeDays, coverDays: res.coverDays, suggest: (cfg.reorder || {}).suggest !== false };
    }
    if (activePage === 'stock' && stockCache) { renderStockChips(); renderStock(); }
  } finally {
    reorderLoading = false;
  }
}

// suggestion worth showing: exists, mature, and meaningfully different from
// the current Min. Dropship SKUs with zero owned stock suggest nothing —
// the DS BUY signal owns them, the low-stock alarm must stay silent.
function minSuggestionFor(it, l) {
  if (!reorderStats || !dsPads || reorderMeta.suggest === false) return null;
  const s = reorderStats[String(it.sku).toUpperCase()];
  if (!s || s.tooNew || s.suggestMin === null) return null;
  const pad = Number(dsPads[String(it.sku).toUpperCase()]) || 0;
  if (pad > 0 && (Number(l.stockLevel) || 0) === 0) return null;
  const cur = Number(l.minimumLevel) || 0;
  const diff = Math.abs(s.suggestMin - cur);
  if (diff < 2) return null;
  if (cur > 0 && diff / cur <= 0.2) return null;
  return s.suggestMin;
}

// Available < Min (and a minimum is actually set) at the primary warehouse
function stockIsLow(it) {
  if (!stockCache) return false;
  const l = (it.levels || []).find(x => x.locationId === stockCache.locationId);
  return !!(l && l.minimumLevel > 0 && l.available < l.minimumLevel);
}

function stockLowCount() {
  if (!stockCache) return 0;
  return (stockCache.items || []).filter(stockIsLow).length;
}

// The WFS FULFILLED location, discovered from the loaded inventory's level
// rows by name (no hardcoded GUID - survives a re-created location).
function stockWfsLocation() {
  if (!stockCache) return null;
  for (const it of stockCache.items || []) {
    for (const l of it.levels || []) {
      if (/wfs/i.test(l.locationName || '')) return { id: l.locationId, name: l.locationName };
    }
  }
  return null;
}

function stockViewMatch(it, pattern) {
  try {
    const re = new RegExp(pattern, 'i');
    return re.test(it.sku || '') || re.test(it.title || '');
  } catch {
    return true; // invalid user regex: filter nothing rather than everything
  }
}

async function loadStockViews() {
  if (stockViews === null) {
    const cfg = await api.getConfig();
    stockViews = (Array.isArray(cfg.stockViews) ? cfg.stockViews : [])
      .filter(v => v && v.label && v.pattern);
  }
  renderStockChips();
}

function renderStockChips() {
  const box = $('stockChips');
  const views = stockViews || [];
  const wfsLoc = stockWfsLocation();
  const lowCount = stockLowCount();
  box.hidden = views.length === 0 && !wfsLoc && !lowCount && !stockLowActive
    && (!state || state.captureOnly); // sync mode always shows the DropShip chip
  // the view chips share one main-menu style tray; Unlisted sits outside it
  // as the amber alert pill (it flags work, it isn't a view you live in)
  // NB: NOT "stock-tray" — that class is the per-row hover action tray and
  // ships visibility:hidden (the collision blanked this whole toolbar once)
  // Unlisted on: the condition chips slice the gap list, so each carries
  // its own gap count and the tray highlights the active slice
  let unlCnt = null;
  if (stockUnlistedActive) {
    const live = unlMissingRows().filter(d => d.missing.some(ch => !chanSkipKind(d.sku, ch)));
    const inView = (v) => live.filter(d => !v ? true : (v.plain
      ? !views.some(x => stockViewMatch(d, x.pattern))
      : stockViewMatch(d, v.pattern))).length;
    unlCnt = { all: inView(null), new: inView(STOCK_VIEW_NEW), views: views.map(v => inView(v)) };
  }
  // counts live in the tooltips, not the labels: inline counts widened the
  // tray whenever Unlisted toggled and shifted the whole band (owner
  // 2026-09-15, "it keeps adjusting the container") — the summary line
  // under the band still counts the active slice out loud
  box.innerHTML = '<div class="chip-tray">' + [
    `<button class="view-chip ${(stockUnlistedActive ? !stockActiveView : !(stockActiveView || stockWfsActive || stockLowActive || stockDsActive)) ? 'is-active' : ''}" data-view=""${unlCnt ? ` title="Every SKU missing a listing, any condition — ${unlCnt.all}"` : ''}>All</button>`,
    ...(views.length ? [
      `<button class="view-chip ${stockActiveView === STOCK_VIEW_NEW ? 'is-active' : ''} tint-green" data-view="new" title="${unlCnt ? `Only brand-new SKUs missing a listing — ${unlCnt.new}` : 'Show only brand-new items — SKUs without a condition marker'}">New</button>`,
    ] : []),
    ...views.map((v, i) =>
      `<button class="view-chip ${stockActiveView === v ? 'is-active' : ''}${v.tint ? ` tint-${esc(v.tint)}` : ''}" data-view="${i}" title="${unlCnt ? `Only ${esc(v.label)} SKUs missing a listing — ${unlCnt.views[i]}` : `Show only ${esc(v.label)} items`}">${esc(v.label)}</button>`),
    // (the Low stock chip was removed at the owner's request 2026-08-06 —
    // the low-stock ALERTS and red Available tints stay)
    ...(wfsLoc
      ? [`<button class="view-chip ${stockWfsActive ? 'is-active' : ''}" data-view="wfs" title="Stock at ${esc(wfsLoc.name)} — Walmart-managed, read-only (fed by Walmart's own connection)">WFS</button>`]
      : []),
    ...(!state || state.captureOnly ? [] : [
      `<button class="view-chip ${stockDsActive ? 'is-active' : ''}" data-view="ds" title="The dropship program: pads, sales pace, and BUY signals">DropShip${dsPads && Object.keys(dsPads).length ? ` · ${Object.keys(dsPads).length}` : ''}</button>`,
    ]),
  ].join('') + '</div>'
    // only exists while there is something to fix — in-stock SKUs no
    // marketplace can currently sell
    + ((unlistedDetail || chLinked) && unlActiveDetail().length
      ? `<button class="view-chip chip-unlisted ${stockUnlistedActive ? 'is-active' : ''}" data-view="unl" title="In-stock SKUs missing a marketplace listing on at least one channel — New included">Unlisted · ${unlActiveDetail().length}</button>`
      : '');
  // the Shelf pointer only appears with a condition view on — selling
  // history lives there, not as extra columns here (owner 2026-08-25)
  $('stockShelfLink').hidden = !(stockActiveView && stockActiveView !== STOCK_VIEW_NEW && !stockUnlistedActive);
}

$('stockChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.view-chip');
  if (!chip) return;
  const wasUnlisted = stockUnlistedActive;
  stockDsActive = false;
  stockUnlistedActive = false;
  if (chip.dataset.view === 'unl') {
    // the pill toggles: on = the gap list, off = back to the plain All view
    // (the condition chips no longer leave Unlisted, so the pill is the exit)
    stockUnlistedActive = !wasUnlisted;
    stockWfsActive = false;
    stockLowActive = false;
    stockActiveView = null;
  } else if (chip.dataset.view === 'wfs') {
    stockWfsActive = true;
    stockLowActive = false;
    stockActiveView = null;
    // sorted column may not exist in this view - fall back to units
    if (!['sku', 'stockLevel', 'home'].includes(stockSort.key)) stockSort = { key: 'stockLevel', dir: -1 };
  } else if (chip.dataset.view === 'low') {
    stockLowActive = true;
    stockWfsActive = false;
    stockActiveView = null;
    if (stockSort.key === 'home') stockSort = { key: 'stockLevel', dir: -1 };
  } else if (chip.dataset.view === 'ds') {
    stockDsActive = true;
    stockWfsActive = false;
    stockLowActive = false;
    stockActiveView = null;
    if (!reorderStats) loadReorderStats();
  } else {
    stockWfsActive = false;
    stockLowActive = false;
    // with Unlisted on, the condition chips SLICE the unlisted list instead
    // of leaving it — press the amber pill off to get the plain views back
    // (owner 2026-09-15, from the approved unlisted-cond-filter mockup)
    stockUnlistedActive = wasUnlisted;
    stockActiveView = chip.dataset.view === 'new' ? STOCK_VIEW_NEW
      : chip.dataset.view === '' ? null : (stockViews || [])[Number(chip.dataset.view)] || null;
    if (stockSort.key === 'home') stockSort = { key: 'stockLevel', dir: -1 };
  }
  renderStockChips();
  renderStock();
  $('stockList').scrollTop = 0; // a deliberate view change starts at the top
});

// remove a SKU from the dropship program: right-click its row in the view
$('stockList').addEventListener('contextmenu', (e) => {
  const row = e.target.closest('tr[data-dsrow]');
  if (!row) return;
  e.preventDefault();
  removeDsSku(row.dataset.dsrow);
});

$('minApplyAll').addEventListener('click', async () => {
  const btn = $('minApplyAll');
  let pending = [];
  try { pending = JSON.parse(btn.dataset.pending || '[]'); } catch { /* nothing queued */ }
  if (!pending.length) return;
  if (!confirm(`Write ${pending.length} suggested minimum${pending.length === 1 ? '' : 's'} to Linnworks?\nEach one becomes that SKU's low-stock alert threshold.`)) return;
  btn.disabled = true;
  btn.textContent = 'Applying…';
  const res = await api.reorderApply(pending);
  btn.disabled = false;
  if (!res.ok) { toast(res.error || 'Apply failed'); renderStock(); return; }
  toast(`Minimums applied to ${res.applied} SKU${res.applied === 1 ? '' : 's'}${res.errors.length ? ` — ${res.errors.length} failed` : ''}`);
  loadStock(); // fresh levels reflect the new Mins everywhere
});

api.on('reorder:applied', ({ summary }) => toast(summary, 7000));
api.on('app:notice', ({ message }) => toast(message, 7000));

// condition SKUs that just inherited the New listing's photo (background
// pass in main after each stock load): patch the cached items so the grid
// fills in the thumbnails without another refresh
api.on('stock:imgInherited', (d) => {
  const pairs = (d && d.pairs) || [];
  if (!stockCache || !pairs.length) return;
  const byUpper = new Map(pairs.map(p => [String(p.sku).toUpperCase(), p.image]));
  let touched = false;
  for (const it of stockCache.items || []) {
    const img = byUpper.get(String(it.sku).toUpperCase());
    if (img && !it.image) { it.image = img; touched = true; }
  }
  if (touched && activePage === 'stock') renderStock();
});

// e2e/screenshot helper: seed the stock sheet without Linnworks
function stockSeed(data) {
  stockCache = data;
  renderStock();
}

// column sort: key + direction, toggled by clicking headers
const STOCK_COLS = {
  sku: { label: 'SKU', get: r => r.sku, text: true },
  stockLevel: { label: 'In stock', get: r => r.l.stockLevel },
  inOrders: { label: 'In orders', get: r => r.l.inOrders },
  minimumLevel: { label: 'Min', get: r => r.l.minimumLevel },
  available: { label: 'Available', get: r => r.l.available },
  // WFS view only: your own warehouse count beside Walmart's
  home: { label: 'At warehouse', get: r => (r.home ? r.home.stockLevel : 0) },
};
let stockSort = { key: 'stockLevel', dir: -1 }; // default: highest stock first

// user-adjusted column widths, persisted across sessions
let stockColWidths = {};
try { stockColWidths = JSON.parse(localStorage.getItem('stockColWidths') || '{}'); } catch { /* fresh start */ }

// user-arranged column ORDER for the main sheet, persisted (owner request
// 2026-08-12: drag a header to move the column)
const STOCK_COL_DEFAULT = ['sku', 'stockLevel', 'inOrders', 'minimumLevel', 'available'];
let stockColOrder = STOCK_COL_DEFAULT.slice();
try {
  const saved = JSON.parse(localStorage.getItem('stockColOrder') || 'null');
  // tolerate old saves when columns are added/removed later
  if (Array.isArray(saved)) {
    stockColOrder = saved.filter(k => STOCK_COL_DEFAULT.includes(k));
    for (const k of STOCK_COL_DEFAULT) if (!stockColOrder.includes(k)) stockColOrder.push(k);
  }
} catch { /* fresh start */ }

// while the search box has text, columns hold the width they had when
// typing began — auto table layout re-measured every keystroke and the
// whole sheet shifted under the cursor (owner 2026-09-14)
let stockFreezeWidths = null;

function stockTh(key, extraClass = '', labelOverride = '') {
  const col = STOCK_COLS[key];
  const arrow = stockSort.key === key ? (stockSort.dir < 0 ? ' ▾' : ' ▴') : '';
  return `<th class="sortable ${extraClass}" draggable="true" data-sort="${key}" title="Click to sort · drag edge to resize · drag the header to move the column">${labelOverride || col.label}${arrow}<span class="col-grip" data-grip="${key}"></span></th>`;
}

// widths the sheet settled on THIS session, per column: the first render
// (the All view — every condition SKU included, so the widest content)
// pins the columns the user never dragged, and chip flips / searches /
// lazy badge loads stop re-deciding them. A fresh Linnworks load or a
// grip double-click re-measures.
let stockColAuto = {};

// THE root cause of every "columns reset / go wide / all equal" report:
// the page's CSP (style-src 'self') SILENTLY DROPS style="" attributes
// that arrive via innerHTML, so widths stockTh used to inline — dragged,
// frozen, or pinned — never applied on a re-render; under the is-frozen
// fixed table layout that left NO widths at all and the browser split
// the columns equally (owner 2026-09-16, "suddenly goes wide and makes
// the length of the columns all different"). Setting th.style from JS is
// the one styling path the CSP allows, so every width lands here, after
// every header rebuild.
function applyStockColWidths() {
  const ths = [...document.querySelectorAll('#stockList th[data-sort]')];
  ths.forEach(th => {
    const key = th.dataset.sort;
    const w = stockColAuto[key] || stockColWidths[key] || (stockFreezeWidths && stockFreezeWidths[key]);
    th.style.width = w ? `${w}px` : '';
    th.style.minWidth = w ? `${w}px` : '';
    th.style.maxWidth = w ? `${w}px` : '';
  });
  // first render after a load (or a column reset): freeze the geometry the
  // sheet ACTUALLY got. Auto layout stretches columns past their pins to
  // fill the window, and the is-frozen fixed layout scales pins its own
  // way — pinning the MEASURED widths is what makes browsing, searching
  // and chip-flipping agree pixel for pixel.
  if (ths.length && ths.some(th => !stockColAuto[th.dataset.sort])) {
    ths.forEach(th => { stockColAuto[th.dataset.sort] = th.offsetWidth; });
  }
}

async function loadStock() {
  $('stockList').innerHTML = '<div class="stock-loading"><span class="spinner" aria-label="Loading"></span></div>';
  $('stockSummary').textContent = '';
  loadStockDeltas(); // day-over-day sales deltas fill in lazily, never blocking
  loadReorderStats(); // pads + velocity + Min suggestions, same lazy pattern
  loadUnlisted(); // "not listed" markers on condition SKUs holding returns
  loadChLinked(); // per-channel link sets for the "No eBay/Walmart" chips
  const res = await api.getStock();
  if (!res.ok) {
    $('stockList').innerHTML = `<p class="dlg-note">${esc(res.error || 'Could not load stock.')}</p>`;
    return;
  }
  stockCache = res;
  stockColAuto = {}; // fresh inventory: let the columns re-measure once
  renderStockChips(); // the WFS + Low stock chips appear once data allows
  renderStock();
}

/* day-over-day sales delta beside each SKU: units sold today vs yesterday,
   from the Sales tab's processed-orders cache (a 2-day query is a subrange
   of any loaded Sales period, so it is usually served from memory) */

let stockDeltas = null; // { sku: { today, yesterday } } | null = not loaded

// local yyyy-mm-dd of a processed-order timestamp
function salesDayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// pure, e2e-testable: what the tiny delta renders as. null = render nothing.
function salesDeltaText(today, yesterday) {
  const t = Number(today) || 0;
  const y = Number(yesterday) || 0;
  if (!t && !y) return null;
  if (!y) return { text: 'new', cls: 'is-pos' }; // sold today, none yesterday
  const pct = Math.round(((t - y) / y) * 100);
  if (pct === 0) return { text: '0%', cls: 'is-flat' };
  return { text: `${pct > 0 ? '+' : ''}${pct}%`, cls: pct > 0 ? 'is-pos' : 'is-neg' };
}

let stockDeltasBusy = false;

async function loadStockDeltas() {
  if (stockDeltasBusy) return;
  stockDeltasBusy = true;
  try {
    const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = day(new Date());
    const yesterday = day(new Date(Date.now() - 86400000));
    const res = await api.salesQuery(yesterday, today);
    if (!res.ok) return; // capture-only / offline: the grid simply shows no deltas
    const map = {};
    for (const l of res.lines || []) {
      const d = salesDayKey(l.processedOn);
      if (d !== today && d !== yesterday) continue;
      const m = map[l.sku] || (map[l.sku] = { today: 0, yesterday: 0 });
      m[d === today ? 'today' : 'yesterday'] += Number(l.qty) || 0;
    }
    stockDeltas = map;
    if (activePage === 'stock' && stockCache) renderStock(); // fill in lazily
  } finally {
    stockDeltasBusy = false;
  }
}

function renderStock() {
  if (!stockCache) return;
  // an inline pad/stock edit is open and focused: redrawing the table now
  // would destroy it mid-type (the lazy delta/reorder/unlisted loaders all
  // land here) — the edit's own commit re-renders when it finishes
  const ae = document.activeElement;
  if (ae && ae.classList && ae.classList.contains('stock-edit')) return;
  // background refreshes (deltas, reorder stats, unlisted markers, link
  // sets) redraw this table: the sheet must stay where the user scrolled
  // it, not snap back to the top on every arrival
  const keepScroll = $('stockList').scrollTop;
  if (stockDsActive) { renderDropshipView(); $('stockList').scrollTop = keepScroll; return; }
  if (stockUnlistedActive) { renderUnlistedView(); $('stockList').scrollTop = keepScroll; return; }
  const q = $('stockSearch').value.trim().toLowerCase();
  // the search also answers to a marketplace's OWN SKU (owner request
  // 2026-09-16): the linked channel SKU strings ride the hourly unlisted
  // scan, so a link made minutes ago may need a Refresh to become findable
  const chSkuHit = (it) => {
    if (!q || !chSkuMap || !it.stockItemId) return '';
    return (chSkuMap[it.stockItemId] || []).find(s => skuMatch(s, q)) || '';
  };
  // WFS view reads the Walmart-managed location; everything else reads the
  // primary warehouse. WFS numbers are Walmart's own (read-only here).
  const wfsLoc = stockWfsActive ? stockWfsLocation() : null;
  const locId = wfsLoc ? wfsLoc.id : stockCache.locationId;
  const EMPTY_LVL = { stockLevel: 0, inOrders: 0, due: 0, minimumLevel: 0, available: 0 };
  const rows = stockCache.items
    .map(it => ({
      ...it,
      l: it.levels.find(x => x.locationId === locId) || EMPTY_LVL,
      // WFS view shows your own warehouse count alongside Walmart's
      home: wfsLoc ? (it.levels.find(x => x.locationId === stockCache.locationId) || EMPTY_LVL) : null,
    }))
    .filter(it => !wfsLoc || it.l.stockLevel || it.l.available)
    .filter(it => !stockLowActive || stockIsLow(it))
    .filter(it => !stockActiveView || (stockActiveView.plain
      ? !(stockViews || []).some(v => stockViewMatch(it, v.pattern))
      : stockViewMatch(it, stockActiveView.pattern)))
    .filter(it => !q
      || skuMatch(it.sku, q)
      || skuMatch(it.title, q)
      || skuMatch(it.barcode, q)
      || skuMatch(it.category, q)
      || !!chSkuHit(it))
    .sort((a, b) => {
      const col = STOCK_COLS[stockSort.key] || STOCK_COLS.stockLevel;
      const av = col.get(a);
      const bv = col.get(b);
      const cmp = col.text ? String(av).localeCompare(String(bv)) : (av - bv);
      return (cmp * stockSort.dir) || a.sku.localeCompare(b.sku);
    });
  const tip = document.querySelector('#stockHint .stock-tip');
  if (tip) tip.hidden = !!wfsLoc; // the WFS column is Walmart's, not correctable
  const units = rows.reduce((s, r) => s + r.l.stockLevel, 0);
  $('stockSummary').textContent = wfsLoc
    ? `${rows.length} SKUs · ${units.toLocaleString()} units at ${wfsLoc.name} — Walmart's counts; the warehouse column is yours`
    : stockLowActive
        ? `${rows.length} SKU${rows.length === 1 ? '' : 's'} below minimum · ${units.toLocaleString()} units left`
        : `${rows.length} SKUs · ${units.toLocaleString()} units${stockActiveView ? ` · ${stockActiveView.label} view` : ''}`;
  const imgCell = (r) => `<td class="cell-img"><button class="img-btn" data-imgsku="${esc(r.sku)}" data-sid="${esc(r.stockItemId || '')}" title="${r.image ? 'Click to add another image' : 'Click to add an image'}">${r.image ? `<img class="stock-img" src="${esc(r.image)}" loading="lazy" alt="" />` : '<span class="stock-img stock-img-none">+</span>'}</button></td>`;
  // tiny day-over-day sales delta beside the SKU, filled in once the sales
  // cache answers; nothing renders when there were no sales either day
  const deltaHtml = (r) => {
    const d = stockDeltas && stockDeltas[r.sku];
    const dt = d ? salesDeltaText(d.today, d.yesterday) : null;
    return dt
      ? `<span class="stock-delta mono ${dt.cls}" title="sold ${d.today} today vs ${d.yesterday} yesterday">${dt.text}</span>`
      : '';
  };
  // chart button: 30-day sales dialog; days-of-cover uses the warehouse
  // available (in WFS view r.home is the warehouse, elsewhere r.l is)
  // "+ DS" enrolls a SKU into the dropship program (pad 10) right from here
  const dsAdd = (r) => (state && !state.captureOnly && dsPads && !(String(r.sku).toUpperCase() in dsPads))
    ? `<button class="stock-ds-add" data-dssku="${esc(r.sku)}" title="Add to the dropship program: keeps 10 at DropShip so the listing stays live with zero warehouse stock">+ DS</button>`
    : '';
  // design B (owner pick 2026-08-08): actions live in a floating tray that
  // appears on row hover — chart, "DS" enrollment, delete — one click each
  const trayHtml = (r) => {
    const ds = (state && !state.captureOnly && dsPads && !(String(r.sku).toUpperCase() in dsPads))
      ? `<button class="stock-ds-add tray-ds" data-dssku="${esc(r.sku)}" title="Add to the dropship program: keeps 10 at DropShip so the listing stays live with zero warehouse stock">DS</button>`
      : '';
    const ren = (state && !state.captureOnly && r.stockItemId)
      ? `<button class="btn-icon stock-ren-btn" data-rensku="${esc(r.sku)}" data-rensid="${esc(r.stockItemId)}" title="Rename this SKU in Linnworks">${ICONS.pencil}</button>`
      : '';
    const del = (state && !state.captureOnly && r.stockItemId)
      ? `<button class="btn-icon is-danger stock-del-btn" data-delsku="${esc(r.sku)}" data-delsid="${esc(r.stockItemId)}" title="Delete this SKU from Linnworks…">${ICONS.trash}</button>`
      : '';
    return `<span class="stock-tray">
      <button class="btn-icon stock-sales-btn" data-salesku="${esc(r.sku)}" data-avail="${r.home ? r.home.stockLevel : r.l.available}" title="Sales history">${ICONS.chartBar}</button>
      ${ds}${ren}${del}</span>`;
  };
  // when the search matched a linked channel SKU and not the row's own
  // fields, the matching channel SKU shows beside the row so the hit
  // doesn't look like a mistake
  const chHitHtml = (r) => {
    if (!q || skuMatch(r.sku, q) || skuMatch(r.title, q)) return '';
    const hit = chSkuHit(r);
    return hit ? `<span class="stock-chhit" title="Matched this linked channel SKU">${esc(hit)}</span>` : '';
  };
  const skuCell = (r) => `<td class="mono"><span class="sku-link" data-chsku="${esc(r.sku)}" data-chsid="${esc(r.stockItemId || '')}" title="${esc(r.title)}&#10;Click to see linked channel SKUs">${esc(r.sku)}</span>${chHitHtml(r)}${unlistedSkus && unlistedSkus.has(String(r.sku).toUpperCase()) ? '<span class="badge-unlisted" title="Holds returned stock but no marketplace listing is linked — create the Walmart/eBay listing with EXACTLY this SKU and Linnworks links it automatically">not listed</span>' : ''}${deltaHtml(r)}${trayHtml(r)}</td>`;
  // WFS view: two columns that answer "do I need to send more?" - Walmart's
  // count (theirs, read-only) beside the warehouse count (yours, editable)
  // dead-end searches offer the missing SKU as a one-click create; inside a
  // condition view the suggestion wears that view's prefix (owner 2026-08-13:
  // typing S25-128GB-BLUE in Open Box should offer OPEN-BOX-S25-128GB-BLUE)
  const condPrefix = stockActiveView ? ({ 'open box': 'OPEN-BOX-', used: 'USED-', scrap: 'SCRAP-' })[String(stockActiveView.label).toLowerCase()] : '';
  const qUp = q.toUpperCase();
  const suggested = condPrefix && !qUp.startsWith(condPrefix) ? condPrefix + qUp : qUp;
  // every search ends in an add-new option, hits or not (owner 2026-09-14:
  // finding OPEN-BOX-S24 must not hide the way to create the plain S24)
  const addNewFoot = q && rows.length > 0 && !state.captureOnly
    ? `<p class="dlg-note stock-addnew"><button class="ebay-addbtn" data-quickadd="${esc(suggested)}">+ Add new listing — create ${esc(suggested)} in Linnworks</button></p>`
    : '';
  $('stockList').innerHTML = rows.length === 0
    ? `<p class="dlg-note">No SKUs match.${q && !state.captureOnly ? ` <button class="ebay-addbtn eb-ml8" data-quickadd="${esc(suggested)}">Create ${esc(suggested)} in Linnworks</button>` : ''}</p>`
    : wfsLoc
      ? `<table class="stock-table${stockFreezeWidths ? ' is-frozen' : ''}">
        <thead><tr>
          <th class="th-gutter">#</th>
          <th class="th-img"></th>
          ${stockTh('sku')}
          ${stockTh('stockLevel', 'num th-level', 'At WFS')}
          ${stockTh('home', 'num')}
        </tr></thead>
        <tbody>${rows.map((r, idx) => `
          <tr>
            <td class="cell-gutter">${idx + 1}</td>
            ${imgCell(r)}
            ${skuCell(r)}
            <td class="num cell-level"><span class="stock-num-ro" title="Walmart-managed count — corrections happen on Walmart's side">${r.l.stockLevel}</span></td>
            <td class="num ${r.home.stockLevel <= 0 ? 'stock-home-zero' : ''}"><button class="stock-num-btn" data-sku="${esc(r.sku)}" title="Your warehouse count — click to correct">${r.home.stockLevel}</button></td>
          </tr>`).join('')}</tbody>
      </table>${addNewFoot}`
      : (() => {
        // the data columns render in the USER'S order (drag a header to move)
        const TH_EXTRA = { sku: '', stockLevel: 'num th-level', inOrders: 'num', minimumLevel: 'num', available: 'num' };
        const cellFor = (key, r) => {
          switch (key) {
            case 'sku': return skuCell(r);
            case 'stockLevel': return `<td class="num cell-level"><button class="stock-num-btn" data-sku="${esc(r.sku)}" title="Click to correct the count">${r.l.stockLevel}</button></td>`;
            case 'inOrders': return `<td class="num"><button class="stock-num-btn stock-io-btn" data-iosku="${esc(r.sku)}" title="Click to see the open orders for ${esc(r.sku)}">${r.l.inOrders}</button></td>`;
            case 'minimumLevel': return `<td class="num cell-min"><button class="stock-num-btn stock-min-btn" data-minsid="${esc(r.stockItemId || '')}" data-minsku="${esc(r.sku)}" title="Minimum level — click to edit">${r.l.minimumLevel}</button>${(() => {
              const sug = minSuggestionFor(r, r.l);
              // the suggestion IS the button: dashed = proposal, click = apply
              return sug === null ? '' : `<button class="min-apply mono" title="Suggested reorder point: ${((reorderStats[String(r.sku).toUpperCase()] || {}).perDay || 0)}/day × ${reorderMeta.leadTimeDays}d lead × 1.5 — click to set Min to ${sug}" data-applysid="${esc(r.stockItemId || '')}" data-applysku="${esc(r.sku)}" data-applymin="${sug}">→ ${sug}</button>`;
            })()}</td>`;
            case 'available': return `<td class="num stock-avail ${stockIsLow(r) ? 'is-low' : ''}" ${stockIsLow(r) ? `title="Below the minimum of ${r.l.minimumLevel}"` : ''}>${r.l.available}</td>`;
            default: return '<td></td>';
          }
        };
        return `<table class="stock-table${stockFreezeWidths ? ' is-frozen' : ''}">
        <thead><tr>
          <th class="th-gutter">#</th>
          <th class="th-img"></th>
          ${stockColOrder.map(k => stockTh(k, TH_EXTRA[k])).join('')}
        </tr></thead>
        <tbody>${rows.map((r, idx) => `
          <tr class="${r.l.available <= 0 ? 'is-out' : ''}">
            <td class="cell-gutter">${idx + 1}</td>
            ${imgCell(r)}
            ${stockColOrder.map(k => cellFor(k, r)).join('')}
          </tr>`).join('')}</tbody>
      </table>${addNewFoot}`;
      })();
  applyStockColWidths();
  // one-click bulk apply for every differing suggested minimum
  const applyAll = $('minApplyAll');
  if (applyAll) {
    const pending = wfsLoc || !reorderStats ? [] : (stockCache.items || []).map(it => {
      const l = (it.levels || []).find(x => x.locationId === stockCache.locationId);
      if (!l || !it.stockItemId) return null;
      const sug = minSuggestionFor(it, l);
      return sug === null ? null : { stockItemId: it.stockItemId, sku: it.sku, min: sug };
    }).filter(Boolean);
    applyAll.hidden = pending.length === 0;
    if (pending.length) {
      applyAll.textContent = `Apply suggested minimums · ${pending.length}`;
      applyAll.dataset.pending = JSON.stringify(pending);
    }
  }
  $('stockList').scrollTop = keepScroll;
}

/* ---------- Unlisted view (in-stock SKUs missing a channel listing) ---------- */

// does this row's SKU/title sit in the active condition view? (New = plain:
// matches none of the configured condition patterns)
function stockCondOk(d) {
  if (!stockActiveView) return true;
  return stockActiveView.plain
    ? !(stockViews || []).some(v => stockViewMatch(d, v.pattern))
    : stockViewMatch(d, stockActiveView.pattern);
}

// CHANNELS column filter (owner 2026-09-17: "a small filter on the column
// … multi select"): the ticked channels keep only rows MISSING on every
// one of them. Persisted per desktop; the funnel glows while active.
let unlChanSel = [];
try { unlChanSel = JSON.parse(localStorage.getItem('unlChanSel') || '[]'); } catch { unlChanSel = []; }
const unlChanSelOk = (d) => unlChanSel.every(ch => d.missing.includes(ch));

function unlChanPopupToggle(anchor) {
  const old = document.querySelector('.unl-fpop');
  if (old) { old.remove(); return; }
  const pop = document.createElement('div');
  pop.className = 'unl-fpop';
  pop.innerHTML = '<h5>Show SKUs missing on</h5>'
    + unlChanKeys().map(ch => `
      <label class="unl-fchk"><input type="checkbox" data-fch="${ch}" ${unlChanSel.includes(ch) ? 'checked' : ''} /> ${channelLabel(ch)}</label>`).join('')
    + '<button type="button" class="unl-fclear">Clear filter</button>';
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.round(Math.max(8, Math.min(r.left - 10, window.innerWidth - 190)))}px`;
  pop.style.top = `${Math.round(r.bottom + 6)}px`;
  document.body.appendChild(pop);
  const away = (e) => {
    if (e.target.closest('.unl-fpop') || e.target.closest('#unlChanFilterBtn')) return;
    document.removeEventListener('mousedown', away, true);
    pop.remove();
  };
  document.addEventListener('mousedown', away, true);
  const save = () => {
    try { localStorage.setItem('unlChanSel', JSON.stringify(unlChanSel)); } catch { /* best effort */ }
    renderStock(); // rebuilds the sheet (and the funnel's active state)
  };
  pop.addEventListener('change', (e) => {
    const c = e.target.closest('[data-fch]');
    if (!c) return;
    unlChanSel = c.checked ? [...new Set([...unlChanSel, c.dataset.fch])] : unlChanSel.filter(x => x !== c.dataset.fch);
    save();
  });
  pop.addEventListener('click', (e) => {
    if (!e.target.closest('.unl-fclear')) return;
    unlChanSel = [];
    for (const c of pop.querySelectorAll('[data-fch]')) c.checked = false;
    save();
  });
}

$('stockList').addEventListener('click', (e) => {
  const f = e.target.closest('#unlChanFilterBtn');
  if (f) unlChanPopupToggle(f);
});

function renderUnlistedView() {
  const aa = $('minApplyAll');
  if (aa) aa.hidden = true;
  const q = $('stockSearch').value.trim().toLowerCase();
  const matches = unlMissingRows().filter(stockCondOk).filter(unlChanSelOk).filter(d => !q
    || d.sku.toLowerCase().includes(q)
    || (d.title || '').toLowerCase().includes(q));
  // rows whose every missing channel is bypassed step aside (restorable
  // below); most gaps first, then most units — or most units first when the
  // Avail header is toggled (owner 2026-09-14: "filter by most units")
  const rows = matches.filter(d => d.missing.some(ch => !chanSkipKind(d.sku, ch)))
    .sort(unlSortUnits
      ? (a, b) => b.avail - a.avail || b.missing.length - a.missing.length || a.sku.localeCompare(b.sku)
      : (a, b) => b.missing.length - a.missing.length || b.avail - a.avail || a.sku.localeCompare(b.sku));
  const parked = matches.filter(d => d.missing.every(ch => chanSkipKind(d.sku, ch)));
  $('stockSummary').textContent =
    `${rows.length} ${stockActiveView ? `${stockActiveView.label} ` : ''}SKU${rows.length === 1 ? '' : 's'} in stock missing a listing ${unlChanSel.length ? `on ${unlChanSel.map(channelLabel).join(' + ')}` : 'somewhere'}`;
  // per-row chips, EVERY channel: filled ✓ = already listed there (owner
  // 2026-09-14: show it, don't remove it), gold ✗ = missing (click: "I
  // can't sell it there"), greyed — = bypassed (click restores)
  const chnChips = (d) => unlChanKeys().map(ch => {
    const name = channelLabel(ch);
    if (!d.missing.includes(ch)) return `<span class="unl-chn is-listed" title="Already listed on ${name} — click the SKU to see the linked channel listings">${name} ✓</span>`;
    const kind = chanSkipKind(d.sku, ch);
    if (kind === 'sku') return `<button class="unl-chn is-skip" data-skipsku="${esc(d.sku)}" data-skipch="${ch}" data-skiprm="1" title="Skipped for this SKU — click to expect a ${name} listing again">${name} —</button>`;
    return `<button class="unl-chn" data-skipsku="${esc(d.sku)}" data-skipch="${ch}" title="No ${name} listing linked — click if you can't sell this SKU on ${name}, and it stops counting as missing there">${name} ✗</button>`;
  }).join('');
  // skipped and never-listed SKUs stay VISIBLE as dimmed rows at the bottom
  // (owner 2026-09-14: "I want to see the ones I removed and the ones I
  // skipped, so I don't forget") — never-list rows borrow their details
  // from the stock sheet when the SKU still exists there
  const ignoredRows = unlistedIgnored
    .filter(s => !q || String(s).toLowerCase().includes(q))
    .map(s => {
      const it = ((stockCache && stockCache.items) || []).find(i => String(i.sku).toUpperCase() === String(s).toUpperCase());
      const l = it && (it.levels || []).find(x => x.locationId === stockCache.locationId);
      return { sku: s, title: it ? it.title || '' : '', image: it ? it.image || '' : '', stockItemId: it ? it.stockItemId : '', avail: l ? Math.max(Number(l.stockLevel) || 0, Number(l.available) || 0) : null };
    })
    .filter(stockCondOk); // the dim rows follow the active slice too
  const rowHtml = (d, idx, mode) => `
        <tr${mode ? ` class="unl-dim is-${mode}"` : ''}>
          <td class="cell-gutter">${mode ? '·' : idx}</td>
          <td class="cell-img"><button class="img-btn" data-imgsku="${esc(d.sku)}" data-sid="${esc(d.stockItemId || '')}" title="${d.image ? 'Click to add another image' : 'Click to add an image'}">${d.image ? `<img class="stock-img" src="${esc(d.image)}" loading="lazy" alt="" />` : '<span class="stock-img stock-img-none">+</span>'}</button></td>
          <td class="mono"><span class="sku-link" data-chsku="${esc(d.sku)}" data-chsid="${esc(d.stockItemId || '')}" title="${esc(d.title)}&#10;Click to see linked channel SKUs">${esc(d.sku)}</span></td>
          <td class="num">${d.avail == null ? '—' : d.avail}</td>
          <td>${mode === 'ignored'
    ? `<span class="unl-dim-note">never listed</span>`
    : chnChips(d)}</td>
          <td class="cell-actions">${mode === 'ignored'
    ? `<button class="ret-todo-copy" data-unign="${esc(d.sku)}" title="Start asking for listings for ${esc(d.sku)} again">↩ restore</button>`
    : `<button class="ret-todo-copy" data-copy="${esc(d.sku)}" title="Copy the exact SKU — create the listing with this string and Linnworks links it automatically">copy</button>
            <button class="ret-todo-ign" data-ign="${esc(d.sku)}" title="Never list this SKU (claim bins, fakes) — moves it to the never-listed rows below">✕</button>`}</td>
        </tr>`;
  const dimCount = parked.length + ignoredRows.length;
  $('stockList').innerHTML = (rows.length === 0 && dimCount === 0)
    ? `<p class="dlg-note">Nothing here — every in-stock ${stockActiveView ? `${esc(stockActiveView.label)} ` : ''}SKU is listed on every channel it's expected on. 🎉</p>`
    : `${rows.length === 0 ? '<p class="dlg-note">Nothing expected is missing — the rows below are skipped or removed.</p>' : ''}<table class="stock-table unl-table">
      <thead><tr>
        <th class="th-gutter">#</th>
        <th class="th-img"></th>
        <th>SKU</th>
        <th class="num th-level unl-sort-th" data-unlsort title="${unlSortUnits ? 'Sorting by most units — click to sort by most gaps' : 'Click to sort by most units'}">Avail${unlSortUnits ? ' ↓' : ''}</th>
        <th class="th-chn">Channels
          <button type="button" id="unlChanFilterBtn" class="unl-funnel ${unlChanSel.length ? 'is-active' : ''}"
            title="${unlChanSel.length ? `Filtering: missing on ${esc(unlChanSel.map(channelLabel).join(' + '))} — click to change` : 'Filter by channel'}"><svg viewBox="0 0 24 24"><path d="M3 5h18l-7 8v5l-4 2v-7L3 5z"/></svg></button>
        </th>
        <th class="th-actions"></th>
      </tr></thead>
      <tbody>${rows.map((d, idx) => rowHtml(d, idx + 1, '')).join('')}</tbody>
      ${dimCount ? `<tbody class="unl-dim-body">
        <tr class="unl-sec-tr"><td colspan="6" class="unl-sec">Skipped or removed · ${dimCount} — kept here so nothing is forgotten</td></tr>
        ${parked.map(d => rowHtml(d, 0, 'parked')).join('')}
        ${ignoredRows.map(d => rowHtml(d, 0, 'ignored')).join('')}
      </tbody>` : ''}
    </table>
    <p class="dlg-note">Create the listing on the marketplace using <b>exactly</b> the SKU string — Linnworks links it automatically and the row leaves this view within the hour (or on restart). Greyed — chips restore with a click; never-listed rows come back with ↩.</p>`;
  // wear the main sheet's SKU width so the chip flip never shifts the
  // columns (owner 2026-09-21, "the formatting changes"); gutter/img/level
  // widths already match via CSS. th.style is the CSP-safe styling path.
  const skuW = stockColAuto.sku || stockColWidths.sku || 0;
  const skuTh = $('stockList').querySelector('.unl-table th:nth-child(3)');
  if (skuTh && skuW) {
    skuTh.style.width = `${skuW}px`;
    skuTh.style.minWidth = `${skuW}px`;
    skuTh.style.maxWidth = `${skuW}px`;
  }
}


/* ---------- DropShip program view (pads · pace · BUY signals) ---------- */

function renderDropshipView() {
  const aa = $('minApplyAll');
  if (aa) aa.hidden = true; // suggestions belong to the warehouse view
  const q = $('stockSearch').value.trim().toLowerCase();
  const pads = dsPads || {};
  const skus = Object.keys(pads).sort((a, b) => {
    const sa = (reorderStats || {})[a] || {};
    const sb = (reorderStats || {})[b] || {};
    return (sb.ds30 || 0) - (sa.ds30 || 0) || a.localeCompare(b);
  }).filter(sku => !q || sku.toLowerCase().includes(q));
  $('stockSummary').textContent = `${Object.keys(pads).length} SKU${Object.keys(pads).length === 1 ? '' : 's'} in the dropship program — pad, sales pace, and when to buy instead`;
  if (!Object.keys(pads).length) {
    $('stockList').innerHTML = '<p class="dlg-note">Nothing enrolled yet. Hover a SKU in the stock list and click “+ DS” to add it to the dropship program.</p>';
    return;
  }
  if (!reorderStats) {
    $('stockList').innerHTML = '<div class="stock-loading"><span class="spinner" aria-label="Loading"></span></div>';
    return;
  }
  const rowsHtml = skus.map((sku, idx) => {
    const it = (stockCache.items || []).find(i => String(i.sku).toUpperCase() === sku) || { sku, levels: [] };
    const l = (it.levels || []).find(x => x.locationId === stockCache.locationId) || { available: 0 };
    const s = reorderStats[sku] || { perDay: 0, trend: 'flat', ds1: 0, ds7: 0, ds30: 0, ds90: 0, buyQty: 0 };
    const pad = Number(pads[sku]) || 0;
    const buyNet = Math.max(0, (s.buyQty || 0) - Math.max(0, Number(l.available) || 0));
    const hot = s.ds7 >= 25;
    const warm = !hot && s.ds7 >= 10;
    const trendArrow = s.trend === 'up' ? '<span class="ds-up">▲</span>' : s.trend === 'down' ? '<span class="ds-dim">▼</span>' : '<span class="ds-dim">→</span>';
    const action = pad === 0
      ? `<span class="ds-pill is-off" title="Pad is 0: nothing offered at DropShip — listing dark until the supplier restocks. Click the pad to set it back.">PAD 0</span>`
      : (hot || warm) && buyNet > 0
        ? `<span class="ds-pill ${hot ? 'is-hot' : 'is-warm'}" title="${s.ds30} units dropshipped in 30 days. ${buyNet} ≈ ${s.perDay}/day × (${reorderMeta.coverDays}d cover + ${reorderMeta.leadTimeDays}d lead) − on hand — covers ${reorderMeta.coverDays} days at this rate.">BUY ${buyNet}</span>`
        : '<span class="ds-dim">—</span>';
    return `
      <tr class="${hot && pad > 0 ? 'ds-hot' : warm && pad > 0 ? 'ds-warm' : ''}" data-dsrow="${esc(sku)}" title="Right-click to remove from the program">
        <td class="cell-gutter">${idx + 1}</td>
        <td class="cell-img"><button class="img-btn" data-imgsku="${esc(it.sku)}" data-sid="${esc(it.stockItemId || '')}" title="${it.image ? 'Click to add another image' : 'Click to add an image'}">${it.image ? `<img class="stock-img" src="${esc(it.image)}" loading="lazy" alt="" />` : '<span class="stock-img stock-img-none">+</span>'}</button></td>
        <td class="mono"><span title="${esc(it.title || '')}">${esc(it.sku)}</span></td>
        <td class="num mono ${Number(l.available) > 0 ? '' : 'ds-dim'}" title="Digital World Shop: ${Number(l.stockLevel) || 0} in stock · ${Number(l.inOrders) || 0} in orders · ${Number(l.available) || 0} available">${Number(l.available) || 0}</td>
        <td class="num"><button class="stock-num-btn ds-pad-btn ${pad === 0 ? 'ds-pad-zero' : ''}" data-padsku="${esc(sku)}" title="Units the app keeps at DropShip — click to change; 0 = listing dark">${pad}</button></td>
        <td class="num mono" title="${s.ds1} today · ${s.ds7} in 7d · ${s.ds30} in 30d · ${s.ds90} in 90d dropshipped">${(s.perDay || 0).toFixed(1)}/day ${trendArrow}</td>
        <td class="num mono">${s.ds30 || 0}</td>
        <td>${action}</td>
        <td class="cell-actions"><button class="btn-icon is-danger ds-remove-btn" title="Remove ${esc(sku)} from the dropship program">${ICONS.trash}</button></td>
      </tr>`;
  }).join('');
  $('stockList').innerHTML = `
    <table class="stock-table ds-table">
      <thead><tr>
        <th class="th-gutter">#</th>
        <th class="th-img"></th>
        <th>SKU</th>
        <th class="num" title="Available at Digital World Shop right now">Warehouse</th>
        <th class="num">Pad</th>
        <th class="num">Per day</th>
        <th class="num">Past month</th>
        <th>Action</th>
        <th class="th-dsact"></th>
      </tr></thead>
      <tbody>${rowsHtml || '<tr><td colspan="9" class="ret-log-none">No enrolled SKU matches.</td></tr>'}</tbody>
    </table>`;
}

// shared by the row's trash button and right-click
function removeDsSku(sku) {
  if (!confirm(`Remove ${sku} from the dropship program?\nIts DropShip level is zeroed first — the listing goes dark unless the warehouse has stock.`)) return;
  (async () => {
    const res = await api.dropshipRemove(sku);
    if (!res.ok) { toast(res.error || 'Could not remove.'); return; }
    delete dsPads[sku];
    renderStockChips();
    renderStock();
    toast(`${sku} removed from the dropship program`);
  })();
}

// pad edit: same inline number pattern as stock counts
function beginPadEdit(btn) {
  const sku = btn.dataset.padsku;
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
    const res = await api.dropshipSetPad(sku, Number(val));
    if (!res.ok) { toast(res.error || 'Pad update failed'); restore(); return; }
    dsPads[sku] = Number(val);
    renderStock();
    toast(Number(val) === 0
      ? `${sku}: pad 0 — DropShip zeroed, listing goes dark`
      : `${sku}: pad set to ${val}`);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') { done = true; restore(); }
  });
  input.addEventListener('blur', () => commit());
  btn.replaceWith(input);
  input.focus();
  input.select();
}

// Inline edit of the In stock number: click -> type -> Enter saves to Linnworks.
/* ---------- global undo: Ctrl/Cmd+Z reverses the last reversible action
   (owner 2026-09-16, "for anything — like changing the stock qty").
   Routing: text fields keep the browser's native text undo; the eBay/Temu
   listers keep their own history (they bind Ctrl+Z themselves); the
   capture page routes to its undo engine; everywhere else pops this
   stack. Deleting a SKU and listings already live on eBay stay OUT —
   they are not reversible, which is why delete has its checkbox. */
const undoStack = []; // { label, run: async () => {} }, newest last
let undoBusy = false;

function pushUndo(label, run) {
  undoStack.push({ label, run });
  if (undoStack.length > 30) undoStack.shift(); // a session's worth, not a database
}

window.addEventListener('keydown', async (e) => {
  if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // native text undo wins
  if (anyDialogOpen()) return;
  if (activePage === 'ebay' || activePage === 'temu') return; // the lister's own Ctrl+Z history
  e.preventDefault();
  if (activePage === 'capture') {
    if ($('undoBtn').disabled) toast('Nothing to undo');
    else $('undoBtn').click();
    return;
  }
  if (undoBusy) return;
  const u = undoStack.pop();
  if (!u) { toast('Nothing to undo'); return; }
  undoBusy = true;
  try {
    await u.run();
    toast(`Undid: ${u.label}`);
  } catch (err) {
    toast(`Undo failed: ${err.message}`, 7000);
  } finally {
    undoBusy = false;
  }
});

// shared by the stock-count edit and its undo: write the level, fold the
// answer into the cache, repaint
async function applyStockLevel(sku, value) {
  // the cache's current level rides along so the shared history records
  // before → after for every hand edit (owner 2026-09-17: "everytime
  // someone adds stock, I want it in the history")
  let prev;
  const item0 = stockCache && stockCache.items.find(i => i.sku === sku);
  const l0 = item0 && (item0.levels || []).find(x => x.locationId === stockCache.locationId);
  if (l0) prev = Number(l0.stockLevel) || 0;
  const res = await api.setStockLevel(sku, value, prev);
  if (!res.ok) throw new Error(res.error || 'Stock update failed');
  const item = stockCache && stockCache.items.find(i => i.sku === sku);
  if (item) {
    let l = item.levels.find(x => x.locationId === stockCache.locationId);
    if (!l) { l = { locationId: stockCache.locationId }; item.levels.push(l); }
    l.stockLevel = res.stockLevel;
    l.inOrders = res.inOrders;
    l.available = res.available;
  }
  renderStock();
  return res;
}

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
    let res;
    try {
      res = await applyStockLevel(sku, Number(val));
    } catch (err) {
      toast(err.message);
      restore();
      return;
    }
    const prev = Number(current);
    pushUndo(`${sku} count back to ${prev}`, () => applyStockLevel(sku, prev));
    toast(`${sku}: stock set to ${res.stockLevel} — Ctrl+Z undoes`);
    // found returns raised by hand (OPEN-BOX/USED/SCRAP): re-scan so the
    // returns page's "needs listings" card hears about it right away
    loadUnlisted(true);
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

// Inline edit of the Min number: same interaction as the stock-level edit,
// writing through Stock/UpdateStockMinimumLevel.
function beginStockMinEdit(btn) {
  const sku = btn.dataset.minsku;
  const sid = btn.dataset.minsid;
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
    const res = await api.setStockMin(sid, Number(val));
    if (!res.ok) {
      toast(res.error || 'Minimum update failed');
      restore();
      return;
    }
    const item = stockCache && stockCache.items.find(i => i.sku === sku);
    if (item) {
      let l = item.levels.find(x => x.locationId === stockCache.locationId);
      if (!l) { l = { locationId: stockCache.locationId }; item.levels.push(l); }
      l.minimumLevel = res.minimumLevel;
    }
    renderStockChips(); // the Low stock count follows the new minimum
    renderStock();
    const prevMin = Number(current) || 0;
    pushUndo(`${sku} minimum back to ${prevMin}`, async () => {
      const r = await api.setStockMin(sid, prevMin);
      if (!r.ok) throw new Error(r.error || 'Minimum update failed');
      const it2 = stockCache && stockCache.items.find(i => i.sku === sku);
      if (it2) {
        const l2 = it2.levels.find(x => x.locationId === stockCache.locationId);
        if (l2) l2.minimumLevel = r.minimumLevel;
      }
      renderStockChips();
      renderStock();
    });
    toast(`${sku}: minimum set to ${res.minimumLevel}`);
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

$('stockRefresh').addEventListener('click', () => {
  chLinked = null; // Refresh re-derives the missing-listings sets too
  loadStock();
  loadUnlisted(true); // fresh scan: SKUs created a minute ago must appear
});
$('stockSearch').addEventListener('input', () => {
  $('stockSearchClear').hidden = !$('stockSearch').value;
  if (!$('stockSearch').value) {
    stockFreezeWidths = null; // box emptied: columns breathe again
  } else if (!stockFreezeWidths) {
    // first keystroke: capture the columns as they stand
    stockFreezeWidths = {};
    for (const th of document.querySelectorAll('#stockList th[data-sort]')) {
      stockFreezeWidths[th.dataset.sort] = th.offsetWidth;
    }
  }
  renderStock();
  $('stockList').scrollTop = 0; // a fresh filter reads from the top
});
// the same ✕ the capture find bar has: clears and refilters in place
$('stockSearchClear').addEventListener('click', () => {
  $('stockSearch').value = '';
  $('stockSearchClear').hidden = true;
  renderStock();
  $('stockSearch').focus();
});
// whole-sheet widths are saved as a SHARE of the surrounding row, not pixels
// (v1.20.43): a pixel width dragged on one monitor pinned the sheet wrong on
// every other screen — a share sizes itself to whatever computer the app is
// on, so the grip only ever needs adjusting once. Legacy pixel values (> 1)
// convert in place on first read.
function sheetFrac(el, key) {
  const raw = Number(localStorage.getItem(key)) || 0;
  if (!raw) return 0;
  if (raw <= 1) return raw;
  const room = el.parentElement ? el.parentElement.clientWidth : 0;
  if (!room) return 0; // page not laid out yet — fill for now, convert next read
  const frac = Math.min(1, raw / room);
  localStorage.setItem(key, String(frac));
  return frac;
}

function applySheetWidth(el, key) {
  const frac = sheetFrac(el, key);
  el.style.width = frac ? `${(frac * 100).toFixed(2)}%` : '';
}

function saveSheetFrac(el, key, w) {
  const room = el.parentElement ? el.parentElement.clientWidth : 0;
  if (!room) { localStorage.setItem(key, String(w)); return; } // px, converts on next read
  const frac = Math.min(1, w / room);
  // dragged all the way to the edge = "just fill" — drop the override so
  // the sheet rides the window from now on. The magnetic zone is the last
  // 8px only (it was 2% of the window — ~30px on a laptop — which swallowed
  // every small narrowing and sprang the sheet back: owner 2026-09-15,
  // "it keeps clicking into place")
  if (w >= room - 22) {
    localStorage.removeItem(key);
    el.style.width = '';
    return;
  }
  localStorage.setItem(key, String(frac));
  el.style.width = `${(frac * 100).toFixed(2)}%`; // % from here on: tracks window resizes
}

// the stock sheet's width grip retired (owner 2026-09-15, "remove this
// sliding bar"): the sheet always fills the window now. Any width a past
// drag stored is cleared so old installs snap back to full too.
localStorage.removeItem('stockSheetWidth');

// column resize: drag a header's right edge; double-click the edge to reset
let gripDrag = null;
let suppressSortUntil = 0;

$('stockList').addEventListener('mousedown', (e) => {
  const grip = e.target.closest('.col-grip');
  if (!grip) return;
  e.preventDefault();
  const th = grip.closest('th');
  gripDrag = { key: grip.dataset.grip, startX: e.clientX, startW: th.offsetWidth, th, w: 0, storeName: 'stock' };
});

window.addEventListener('mousemove', (e) => {
  if (!gripDrag) return;
  if (!e.buttons) { commitGripDrag(); return; } // the mouseup landed outside the window: save, don't wander
  const w = Math.max(50, gripDrag.startW + (e.clientX - gripDrag.startX));
  gripDrag.w = w;
  gripDrag.th.style.width = `${w}px`;
  gripDrag.th.style.minWidth = `${w}px`;
  gripDrag.th.style.maxWidth = `${w}px`;
});

function commitGripDrag() {
  if (!gripDrag) return;
  if (gripDrag.w) {
    if (gripDrag.storeName === 'capture') {
      captureColWidths[gripDrag.key] = gripDrag.w;
      localStorage.setItem('captureColWidths', JSON.stringify(captureColWidths));
    } else if (gripDrag.storeName === 'ret') {
      retColWidths[gripDrag.key] = gripDrag.w;
      localStorage.setItem('retColWidths', JSON.stringify(retColWidths));
      applyRetColsAll(); // the other returns sheet mirrors the same column
    } else {
      stockColWidths[gripDrag.key] = gripDrag.w;
      stockColAuto[gripDrag.key] = gripDrag.w; // the session pin follows the drag
      localStorage.setItem('stockColWidths', JSON.stringify(stockColWidths));
    }
    suppressSortUntil = Date.now() + 250;
  }
  gripDrag = null;
}

window.addEventListener('mouseup', commitGripDrag);

/* ---------- capture table column resizing ---------- */

let captureColWidths = {};
try { captureColWidths = JSON.parse(localStorage.getItem('captureColWidths') || '{}'); } catch { /* fresh start */ }

function applyCaptureWidth(th, key) {
  const w = captureColWidths[key];
  th.style.width = w ? `${w}px` : '';
  th.style.minWidth = w ? `${w}px` : '';
  th.style.maxWidth = w ? `${w}px` : '';
}

function initCaptureCols() {
  const keys = { 1: 'order', 2: 'items', 3: 'tracking', 4: 'notes' };
  $('rowsTable').querySelectorAll('thead th').forEach((th, i) => {
    const key = keys[i];
    if (!key) return;
    th.insertAdjacentHTML('beforeend', `<span class="col-grip" data-grip="${key}"></span>`);
    applyCaptureWidth(th, key);
  });
}
initCaptureCols();

// whole-list resize: drag the handle on the right edge (mirrors the Stock sheet)
// the search/chips toolbar tracks the sheet's width so they stay aligned
function alignCaptureToolbar() {
  // the find bar is docked INSIDE the sheet column (owner 2026-08-17) and
  // stretches with it natively — the old code pinned it to a PIXEL width
  // here, and nothing re-measured after a sheet-grip drag, so the band
  // stuck out past the sheet's edge (owner 2026-09-16, "the dragger is
  // broken"). Clearing the stale inline sizes is all that's left to do.
  $('findBar').style.width = '';
  $('findBar').style.marginLeft = '';
  $('findBar').style.marginRight = '';
}

let rowsDrag = null;
{
  applySheetWidth($('capMain'), 'captureSheetWidth');
  requestAnimationFrame(alignCaptureToolbar);
}

window.addEventListener('resize', () => requestAnimationFrame(alignCaptureToolbar));

$('rowsGrip').addEventListener('mousedown', (e) => {
  e.preventDefault();
  rowsDrag = { startX: e.clientX, startW: $('capMain').offsetWidth, w: 0 };
  $('rowsGrip').classList.add('is-active');
});

window.addEventListener('mousemove', (e) => {
  if (!rowsDrag) return;
  const w = Math.max(560, rowsDrag.startW + (e.clientX - rowsDrag.startX));
  rowsDrag.w = w;
  $('capMain').style.width = `${w}px`; // band + sheet resize as one
});

window.addEventListener('mouseup', () => {
  if (!rowsDrag) return;
  if (rowsDrag.w) saveSheetFrac($('capMain'), 'captureSheetWidth', rowsDrag.w);
  rowsDrag = null;
  $('rowsGrip').classList.remove('is-active');
});

$('rowsGrip').addEventListener('dblclick', () => {
  localStorage.removeItem('captureSheetWidth');
  $('capMain').style.width = '';
});

$('rowsTable').addEventListener('mousedown', (e) => {
  const grip = e.target.closest('.col-grip');
  if (!grip) return;
  e.preventDefault();
  const th = grip.closest('th');
  gripDrag = { key: grip.dataset.grip, startX: e.clientX, startW: th.offsetWidth, th, w: 0, storeName: 'capture' };
});

$('rowsTable').addEventListener('dblclick', (e) => {
  const grip = e.target.closest('.col-grip');
  if (!grip) return;
  delete captureColWidths[grip.dataset.grip];
  localStorage.setItem('captureColWidths', JSON.stringify(captureColWidths));
  applyCaptureWidth(grip.closest('th'), grip.dataset.grip);
});

$('stockList').addEventListener('dblclick', (e) => {
  const grip = e.target.closest('.col-grip');
  if (!grip) return;
  delete stockColWidths[grip.dataset.grip];
  delete stockColAuto[grip.dataset.grip]; // truly re-measure, not re-pin
  localStorage.setItem('stockColWidths', JSON.stringify(stockColWidths));
  suppressSortUntil = Date.now() + 250;
  renderStock();
});

$('stockList').addEventListener('click', async (e) => {
  const cp = e.target.closest('[data-copy]');
  if (cp) { copyFromApp(cp.dataset.copy); return; }
  const us = e.target.closest('th[data-unlsort]');
  if (us) {
    unlSortUnits = !unlSortUnits;
    localStorage.setItem('unlSortUnits', unlSortUnits ? '1' : '0');
    renderStock();
    return;
  }
  const skip = e.target.closest('[data-skipsku]');
  if (skip) {
    requireOwner(async () => {
      const res = await api.channelSkip(skip.dataset.skipsku, skip.dataset.skipch, !!skip.dataset.skiprm);
      if (!res.ok) { toast(res.error || 'Could not update.'); return; }
      chanSkips = res.chanSkips || {};
      toast(skip.dataset.skiprm
        ? `${skip.dataset.skipsku} counts as missing on ${channelLabel(skip.dataset.skipch)} again`
        : `${skip.dataset.skipsku} skipped on ${channelLabel(skip.dataset.skipch)}`);
      renderStockChips(); renderStock();
    });
    return;
  }
  const unskip = e.target.closest('[data-unskip]');
  if (unskip) {
    requireOwner(async () => {
      const sku = unskip.dataset.unskip;
      // clear every per-SKU skip; rule skips stay (change those in the rules)
      for (const ch of (chanSkips[String(sku).toUpperCase()] || [])) {
        const res = await api.channelSkip(sku, ch, true);
        if (res.ok) chanSkips = res.chanSkips || {};
      }
      toast(`${sku} back on the listings list`);
      renderStockChips(); renderStock();
    });
    return;
  }
  const ign = e.target.closest('[data-ign]');
  const unign = e.target.closest('[data-unign]');
  if (ign || unign) {
    const sku = (ign || unign).dataset.ign || (unign && unign.dataset.unign);
    requireOwner(async () => {
      const res = await api.unlistedIgnore(sku, !!unign);
      if (!res.ok) { toast(res.error || 'Could not update.'); return; }
      toast(unign ? `${sku} back on the listings list` : `${sku} will never ask for listings again`);
      unlistedSkus = null;
      unlistedDetail = null;
      await loadUnlisted();
      if (stockUnlistedActive) renderStock();
    });
    return;
  }
  const del = e.target.closest('.stock-del-btn');
  if (del) { openStockDelete(del.dataset.delsku, del.dataset.delsid); return; }
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
  const renBtn = e.target.closest('button.stock-ren-btn');
  if (renBtn) { openRenameDialog(renBtn.dataset.rensku, renBtn.dataset.rensid); return; }
  const quickAdd = e.target.closest('[data-quickadd]');
  if (quickAdd) {
    // fresh SKU straight from the dead-end search, grid refreshes on create
    openNewSkuDialog({ sku: quickAdd.dataset.quickadd }, () => loadStock());
    return;
  }
  const salesBtn = e.target.closest('button.stock-sales-btn');
  if (salesBtn) { openSalesDialog(salesBtn.dataset.salesku, Number(salesBtn.dataset.avail) || 0); return; }
  const padBtn = e.target.closest('button.ds-pad-btn');
  if (padBtn) { beginPadEdit(padBtn); return; }
  const dsRemove = e.target.closest('button.ds-remove-btn');
  if (dsRemove) {
    const row = dsRemove.closest('tr[data-dsrow]');
    if (row) removeDsSku(row.dataset.dsrow);
    return;
  }
  const dsAddBtn = e.target.closest('button.stock-ds-add');
  if (dsAddBtn) {
    (async () => {
      const sku = dsAddBtn.dataset.dssku;
      const res = await api.dropshipSetPad(sku, 10);
      if (!res.ok) { toast(res.error || 'Could not enroll.'); return; }
      dsPads[String(sku).toUpperCase()] = 10;
      renderStockChips();
      renderStock();
      toast(`${sku} added to the dropship program — pad 10 at DropShip`);
    })();
    return;
  }
  const minApply = e.target.closest('button.min-apply');
  if (minApply) {
    (async () => {
      const res = await api.reorderApply([{ stockItemId: minApply.dataset.applysid, sku: minApply.dataset.applysku, min: Number(minApply.dataset.applymin) }]);
      if (!res.ok || !res.applied) { toast((res.errors && res.errors[0]) || res.error || 'Could not apply.'); return; }
      const item = stockCache && stockCache.items.find(i => i.sku === minApply.dataset.applysku);
      const l = item && (item.levels || []).find(x => x.locationId === stockCache.locationId);
      if (l) l.minimumLevel = Number(minApply.dataset.applymin);
      renderStock();
      toast(`${minApply.dataset.applysku}: Min set to ${minApply.dataset.applymin}`);
    })();
    return;
  }
  const ioBtn = e.target.closest('button.stock-io-btn');
  if (ioBtn) { openOpenOrders(ioBtn.dataset.iosku); return; }
  const minBtn = e.target.closest('button.stock-min-btn');
  if (minBtn) { beginStockMinEdit(minBtn); return; }
  const skuLink = e.target.closest('.sku-link');
  if (skuLink) {
    if (!skuLink.dataset.chsid) { toast(`${skuLink.dataset.chsku} isn't in the loaded stock sheet — refresh Stock first.`); return; }
    openChannelSkus(skuLink.dataset.chsku, skuLink.dataset.chsid);
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

/* ---------- open orders per SKU (Stock page drill-down) ---------- */

const IO_CHANNELS = new Set(['walmart', 'ebay', 'temu']);

function ioChannelCell(source) {
  const s = String(source || '').trim();
  const key = s.toLowerCase();
  if (IO_CHANNELS.has(key)) return `<span class="badge badge-${key}">${esc(channelLabel(key))}</span>`;
  return s ? esc(s) : '<span class="cell-missing">—</span>';
}

function ioDate(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return `${String(iso).slice(0, 10)} ${fmtTime(iso)}`;
}

// Renders the dialog body; also called directly by the e2e screenshot seed.
// Orders sitting away from the primary warehouse (e.g. routed to DropShip)
// get a muted location pill so the count's spread is visible at a glance.
function ioRender(sku, orders, primaryLocationId) {
  $('ioTitle').textContent = `Open orders — ${sku}`;
  if (!orders.length) {
    $('ioBody').innerHTML = `
      <div class="io-empty">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M223.68,66.15,135.68,18a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32l80.34,44-29.77,16.3-80.35-44ZM128,120,47.66,76l33.9-18.56,80.34,44ZM40,90l80,43.78v85.79L40,175.82Zm176,85.78h0l-80,43.79V133.82l32-17.51V152a8,8,0,0,0,16,0V107.55L216,90v85.77Z"/></svg>
        <div class="rows-empty-title">No open orders</div>
        <div class="rows-empty-hint">No open order currently contains ${esc(sku)}. Orders show up here as soon as Linnworks downloads them.</div>
      </div>`;
    return;
  }
  const units = orders.reduce((a, o) => a + (o.quantity || 0), 0);
  $('ioBody').innerHTML = `
    <p class="dlg-note">${orders.length} order line${orders.length === 1 ? '' : 's'} · ${units} unit${units === 1 ? '' : 's'} reserved</p>
    <div class="io-sheet">
      <table class="rows-table">
        <thead><tr>
          <th class="th-gutter">#</th>
          <th>Channel</th>
          <th>Order #</th>
          <th>Channel SKU</th>
          <th class="th-num">Qty</th>
          <th>Date</th>
        </tr></thead>
        <tbody>${orders.map((o, idx) => `
          <tr>
            <td class="cell-gutter">${idx + 1}</td>
            <td>${ioChannelCell(o.source)}${o.locationName && primaryLocationId && o.locationId !== primaryLocationId
              ? `<span class="io-loc" title="Order is at ${esc(o.locationName)}, not the primary warehouse">${esc(o.locationName)}</span>` : ''}</td>
            <td class="mono">${o.reference
              ? `<span class="copyable" data-copy="${esc(o.reference)}" title="Click to copy ${esc(o.reference)}">${esc(o.reference)}</span>`
              : '<span class="cell-missing">—</span>'}</td>
            <td class="mono">${o.channelSku
              ? `<span class="copyable" data-copy="${esc(o.channelSku)}" title="Click to copy ${esc(o.channelSku)}">${esc(o.channelSku)}</span>`
              : '<span class="cell-missing">—</span>'}${o.via
              ? `<span class="io-via" title="This SKU is inside the bundle ${esc(o.via)} on this order">via ${esc(o.via)}</span>` : ''}</td>
            <td class="num-cell">${o.quantity > 1 ? `<span class="qty-chip" title="${o.quantity} units on this order">×${o.quantity}</span>` : (o.quantity || 0)}</td>
            <td class="mono io-date">${esc(ioDate(o.date))}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

async function openOpenOrders(sku) {
  $('ioTitle').textContent = `Open orders — ${sku}`;
  $('ioBody').innerHTML = '<div class="stock-loading io-loading"><span class="spinner" aria-label="Loading"></span></div>';
  $('ioDialog').showModal();
  const res = await api.getStockOpenOrders(sku);
  if (!$('ioDialog').open) return; // closed while the fetch was running
  if (!res.ok) {
    $('ioBody').innerHTML = `<p class="dlg-note test-result is-fail">${esc(res.error || 'Could not load open orders.')}</p>`;
    return;
  }
  ioRender(sku, res.orders || [], res.primaryLocationId || '');
}

$('ioBody').addEventListener('click', (e) => {
  const copyEl = e.target.closest('[data-copy]');
  if (copyEl) copyFromApp(copyEl.dataset.copy);
});

$('ioClose').addEventListener('click', () => $('ioDialog').close());
$('ioDialog').addEventListener('close', () => focusScan());

/* ---------- Returns page: log + receive popup (design C, 2026-08-07) ---------- */

const RET_CONDS = [
  { key: 'new', label: 'New' },
  { key: 'openbox', label: 'Open box' },
  { key: 'used', label: 'Used' },
  { key: 'scrap', label: 'Scrap' },
  // the customer sent back something else entirely (owner 2026-09-10):
  // the SKU cell holds what ACTUALLY came back — an existing listing
  // (stock moves onto it), a brand-new item, or plain text (log-only)
  { key: 'different', label: 'Different return' },
];
const RET_PREFIX = { openbox: 'OPEN-BOX-', used: 'USED-', scrap: 'SCRAP-' };

let retReceivedBy = ''; // last-used initials, config-backed default

function enterReturns() {
  loadRetPast();
  loadUnlisted(); // "not listed" markers on condition targets
  ensureInventory(); // the entry row's and popup's SKU combos need it
  api.getConfig().then(cfg => {
    if (!retReceivedBy && cfg.returnsReceivedBy) retReceivedBy = cfg.returnsReceivedBy;
    // the date cell follows today only while the receiver hasn't typed one
    if (retEntryTr && wsDateAuto) wsDateFill();
    // PO-format channel guessing for the log's open buttons
    retPoPatterns = (cfg.orderPatterns || []).map(p => {
      try { return { ch: p.channel, re: new RegExp(p.pattern) }; } catch { return null; }
    }).filter(Boolean);
    if (retLogAll) renderRetLog(); // buttons on rows rendered before the patterns arrived
  });
}

function retCondLabel(key) {
  const c = RET_CONDS.find(x => x.key === key);
  return c ? c.label : key;
}

// "2026-09-05…" -> "09/05/2026" (owner's sheet format, 2026-09-05)
function retDateUS(iso) {
  const p = String(iso || '').slice(0, 10).split('-');
  return p.length === 3 ? `${p[1]}/${p[2]}/${p[0]}` : '';
}

// "$1,234.50" / "1234.5" / "" -> a non-negative amount (0 = none)
function retMoney(v) {
  return Math.max(0, Number(String(v || '').replace(/[$,\s]/g, '')) || 0);
}

// the sku minus any condition affix it already carries — suggested names
// must never stack (OPEN-BOX-OPEN-BOX-…, owner 2026-09-09)
function retCondCore(sku) {
  const up = String(sku || '').toUpperCase();
  for (const pre of Object.values(RET_PREFIX)) {
    if (up.startsWith(pre) && up.length > pre.length) return up.slice(pre.length);
  }
  for (const suf of ['-OPENBOX', '-USED', '-SCRAP']) {
    if (up.endsWith(suf) && up.length > suf.length) return up.slice(0, up.length - suf.length);
  }
  return up;
}

// the name a missing condition SKU would be created under
function retSuggestCondSku(sku, cond) {
  return `${RET_PREFIX[cond] || ''}${retCondCore(sku)}`.toUpperCase();
}

/* ---------- Receive/Edit-return popup (design-A sheet) ---------- */
// Back to popup receiving (owner 2026-09-05, "make it a popup instead of
// on the line" — the in-sheet entry crowded the row): typing a PO# in the
// log's first cell opens THIS popup prefilled; the pencil on a log row
// opens the same popup in edit mode.

let rv = null; // open popup state; null = closed
let rvCreate = (payload) => api.returnsCreate(payload); // seam: e2e stubs the commit

function rvBlank() {
  return {
    orderId: null, source: '', unmatched: true,
    sku: '', title: '', price: 0, targets: null, condition: 'new',
    pick: '', items: [], received: [], itemIdx: -1, busy: false,
  };
}

function rvFeedback(msg, ok = false) {
  const el = $('rvFeedback');
  el.textContent = msg;
  el.hidden = !msg;
  el.className = `dlg-note test-result${msg ? (ok ? ' is-ok' : ' is-fail') : ''}`;
}

// receive mode, opened from the sheet's entry row (or its + gutter):
// whatever was typed there rides along; a PO still runs the lookup, and
// the order only fills the fields the receiver left blank
function retOpenRecv(po = '', seed = null) {
  rv = rvBlank();
  rvLastLookup = '';
  for (const id of ['rvPo', 'rvCust', 'rvTrk', 'rvSku', 'rvNote', 'rvPick', 'rvPrice']) $(id).value = '';
  $('rvQty').value = '1';
  $('rvBy').value = retReceivedBy;
  $('rvThumb').hidden = true;
  rvFeedback('');
  const s = seed || {};
  if (s.cust) $('rvCust').value = s.cust;
  if (s.trk) $('rvTrk').value = s.trk;
  if (s.sku) { $('rvSku').value = s.sku.toUpperCase(); rv.sku = s.sku.toUpperCase(); }
  if (s.units) $('rvQty').value = s.units;
  if (s.price) $('rvPrice').value = s.price;
  if (s.by) $('rvBy').value = s.by;
  if (s.note) $('rvNote').value = s.note;
  rvRenderCond();
  rvRenderOrder();
  rvThumbUpdate();
  ensureInventory();
  rvBesidePane();
  $('retRecvDialog').showModal();
  $('rvPo').value = String(po || '').trim();
  if ($('rvPo').value) {
    rvLastLookup = $('rvPo').value;
    rvLookup();
  } else if ($('rvSku').value) {
    $('rvSave').focus(); // everything typed already — Enter receives it
  } else if ($('rvCust').value || $('rvTrk').value || $('rvNote').value) {
    $('rvSku').focus(); // details came along; the SKU is the likely next key
  } else {
    $('rvPo').focus();
  }
}

// with the marketplace pane open (and room for both), the popup docks to
// the right so the pane STAYS VISIBLE while receiving
function rvBesidePane() {
  const paneOpen = !$('bDock').hidden;
  const room = window.innerWidth - (paneOpen ? $('bDock').offsetWidth : 0);
  $('retRecvDialog').classList.toggle('beside-pane', paneOpen && room >= 560);
}

function rvThumbUpdate() {
  const src = rv.sku ? invImg(rv.sku) : '';
  $('rvThumb').hidden = !src;
  if (src) $('rvThumb').src = src;
}

// Enter on the PO# (or a prefill from the sheet cell): processed-order
// lookup fills the popup; a multi-item order queues its remaining lines
async function rvLookup() {
  const po = $('rvPo').value.trim();
  if (!po || !rv || rv.busy) return;
  rv.busy = true;
  rvFeedback('Looking the order up…', true);
  const res = await api.returnsLookup(po);
  rv.busy = false;
  if (!res.ok) {
    rvFeedback(`${res.error || 'Not found.'} — enter the details by hand.`);
    rv.unmatched = true;
    rv.orderId = null;
    rv.source = '';
    $('rvCust').focus();
    return;
  }
  rvFeedback('');
  const o = res.order;
  rv.unmatched = false;
  rv.orderId = o.orderId;
  rv.source = o.source;
  $('rvPo').value = o.reference || po;
  // hand-typed details (seeded from the sheet's entry row) outrank the
  // order's — the lookup only fills what the receiver left blank
  if (!$('rvCust').value.trim()) $('rvCust').value = o.customer || '';
  if (!$('rvTrk').value.trim()) $('rvTrk').value = o.tracking || '';
  rv.items = o.items || [];
  rv.received = rv.items.map(() => false);
  const typedSku = $('rvSku').value.trim().toUpperCase();
  const typedAt = typedSku ? rv.items.findIndex(it => String(it.sku || '').toUpperCase() === typedSku) : -1;
  if (typedAt >= 0) rvLoadItemAt(typedAt);
  else if (typedSku) { /* keep the hand-typed line as-is */ }
  else if (rv.items.length) rvLoadItemAt(0);
  else rvLoadItem(null);
  rvRenderOrder();
  $('rvSku').focus();
}

// the Ordered row: every line the order contained, as clickable chips —
// the receiver picks what ACTUALLY came back; ✓ = already received.
// Nothing forces receiving every line, and Units can be fewer than ordered.
function rvRenderOrder() {
  const row = $('rvOrderRow');
  if (!rv || rv.unmatched || !rv.items.length) { row.hidden = true; return; }
  row.hidden = false;
  $('rvOrder').innerHTML = rv.items.map((it, i) => `
    <button type="button" class="rv-item ${i === rv.itemIdx ? 'on' : ''} ${rv.received[i] ? 'done' : ''}" data-i="${i}"
      title="${rv.received[i] ? 'Already received — click to receive more of it' : 'Click to receive this line'}">
      <span class="mono">${esc(it.sku)}</span> ×${it.quantity || 1}${rv.received[i] ? ' ✓' : ''}
    </button>`).join('');
}

$('rvOrder').addEventListener('click', (e) => {
  const b = e.target.closest('.rv-item');
  if (!b || !rv) return;
  rvLoadItemAt(Number(b.dataset.i));
  $('rvQty').focus();
});

function rvLoadItemAt(i) {
  rv.itemIdx = i;
  rvLoadItem(rv.items[i] || null);
}

function rvLoadItem(it) {
  if (it) {
    rv.sku = it.sku;
    rv.title = it.title || '';
    rv.price = it.price || 0;
    rv.targets = it.targets || null;
    $('rvSku').value = it.sku;
    $('rvQty').value = String(it.quantity || 1);
    $('rvPrice').value = Number(it.price) ? Number(it.price).toFixed(2) : '';
  } else {
    rv.itemIdx = -1;
    rv.sku = ''; rv.title = ''; rv.price = 0; rv.targets = null;
    $('rvSku').value = '';
    $('rvQty').value = '1';
    $('rvPrice').value = '';
  }
  rv.condition = 'new';
  rv.pick = '';
  $('rvPick').value = '';
  rvThumbUpdate();
  rvRenderCond();
  rvRenderOrder();
}

// pills + the live "stock lands on …" line. A missing target shows a
// small ⚠ RIGHT NEXT TO the pills (owner 2026-09-07) — pressing it opens
// the "no SKU for this yet — create it?" popover with Create + a manual
// pick, instead of the old always-visible fix row.
function rvRenderCond() {
  if (!rv) return;
  const t = $('rvTarget');
  const known = rv.sku ? (rv.condition === 'new' ? rv.sku : ((rv.targets || {})[rv.condition] || '')) : '';
  const resolved = known || rv.pick;
  const missing = !!rv.sku && !resolved;
  $('rvPills').innerHTML = RET_CONDS.map(c => `
    <button type="button" class="rv-pill is-${c.key} ${rv.condition === c.key ? 'on' : ''}" data-cond="${c.key}"
      role="radio" aria-checked="${rv.condition === c.key}">
      <span class="ret-dd-dot is-${c.key}"></span>${c.label}</button>`).join('')
    + (missing ? `<button type="button" id="rvWarnBtn" class="rv-warn" aria-label="No ${esc(retCondLabel(rv.condition).toLowerCase())} SKU yet"
        title="No ${esc(retCondLabel(rv.condition).toLowerCase())} SKU for ${esc(rv.sku)} yet — click to create it">⚠</button>` : '');
  rvFixClose(); // any re-render invalidates an open popover
  if (!rv.sku) { t.textContent = ''; t.className = 'rv-target'; return; }
  if (resolved) {
    t.className = 'rv-target';
    t.innerHTML = `stock lands on <span class="mono">${esc(resolved)}</span>${known ? '' : ' <span class="rv-onetime">(picked for this return)</span>'}${retUnlistedMark(resolved)}`;
    return;
  }
  t.textContent = '';
  t.className = 'rv-target';
}

// the ⚠ popover: message + Create + a manual pick, anchored to the button
function rvFixOpen() {
  const warn = $('rvWarnBtn');
  if (!warn || !rv || !rv.sku) return;
  const fix = $('rvFix');
  $('rvFixMsg').innerHTML = `There’s no <b>${esc(retCondLabel(rv.condition).toLowerCase())}</b> SKU for <span class="mono">${esc(rv.sku)}</span> yet — create it?`;
  const suggested = retSuggestCondSku(rv.sku, rv.condition);
  const btn = $('rvCreate');
  const canCreate = RET_PREFIX[rv.condition] && recvLookup === 'ready' && !recvLookupExact(suggested);
  btn.hidden = !canCreate;
  btn.disabled = false;
  btn.innerHTML = `Create <span class="mono">${esc(suggested)}</span>`;
  btn.dataset.sku = suggested;
  btn.title = 'Opens the New SKU sheet prefilled with this name and the base item’s title and price — adjust anything, hit Create, and this return routes into it.';
  $('rvPick').value = '';
  // the popup sheet clips absolute children: anchor to the viewport
  const r = warn.getBoundingClientRect();
  fix.style.left = `${Math.max(8, Math.min(r.left - 40, window.innerWidth - 348))}px`;
  fix.style.top = `${r.bottom + 6}px`;
  fix.hidden = false;
}

function rvFixClose() {
  $('rvFix').hidden = true;
}

$('rvPills').addEventListener('click', (e) => {
  if (e.target.closest('#rvWarnBtn')) {
    if ($('rvFix').hidden) rvFixOpen(); else rvFixClose();
    return;
  }
  const p = e.target.closest('.rv-pill');
  if (!p || !rv) return;
  rv.condition = p.dataset.cond;
  rv.pick = '';
  $('rvPick').value = '';
  rvRenderCond();
});

// clicking anywhere off the popover closes it
document.addEventListener('mousedown', (e) => {
  if (!$('rvFix').hidden && !e.target.closest('#rvFix') && !e.target.closest('#rvWarnBtn')) rvFixClose();
});

// "Make the condition SKU then and there" (owner 2026-09-05): the Create
// button opens the full New SKU sheet prefilled with the suggested
// prefix-name, title and the base item's price — everything editable —
// and on Create the fresh SKU is mapped to the condition and this return
// routes straight into it. Shared by the entry row and the edit popup.
function openCondSkuCreate(baseSku, cond, suggested, onMapped) {
  const parent = recvLookupExact(baseSku);
  openNewSkuDialog({
    sku: suggested,
    title: skuTitleSuggestion(suggested),
    retailPrice: Number(parent && parent.retailPrice) || 0,
  }, async (newSku) => {
    const map = await api.returnsMapSet(baseSku, cond, newSku);
    const target = (map.ok && map.targetSku) || newSku;
    toast(`${baseSku} ${cond} → ${target}`);
    onMapped(target);
  });
}

$('rvCreate').addEventListener('click', () => {
  if (!rv || !rv.sku) return;
  const baseSku = rv.sku;
  const cond = rv.condition;
  openCondSkuCreate(baseSku, cond, $('rvCreate').dataset.sku, (target) => {
    // the popup may have moved on (or closed) while the sheet was open
    if (!rv || rv.sku !== baseSku || rv.condition !== cond) return;
    rv.targets = { ...(rv.targets || {}), [cond]: target };
    rvRenderCond();
  });
});

$('rvPo').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  rvLookup();
});

// clicking off the PO# looks the order up by itself — no Enter needed
// (owner request 2026-08-11); one attempt per typed value
let rvLastLookup = '';
$('rvPo').addEventListener('blur', () => {
  const po = $('rvPo').value.trim();
  if (!rv || rv.busy || !po || po === rvLastLookup || !rv.unmatched) return;
  rvLastLookup = po;
  rvLookup();
});

// editing the PO after a match voids the match — a stale orderId must never
// ride along with a hand-changed number
$('rvPo').addEventListener('input', () => {
  if (!rv) return;
  rv.orderId = null;
  rv.source = '';
  rv.unmatched = true;
  rv.items = [];
  rv.received = [];
  rv.itemIdx = -1;
  rvRenderOrder();
});

$('rvSku').addEventListener('input', () => {
  if (!rv) return;
  rv.sku = $('rvSku').value.trim().toUpperCase();
  rv.targets = null; // typed text is not a picked item; targets re-resolve on pick
  rv.pick = '';
  $('rvPick').value = '';
  // a hand-typed SKU is no longer "that order line": receiving it must not
  // tick an ordered chip, and the ordered-qty hint no longer applies
  rv.itemIdx = -1;
  rvRenderOrder();
  rvThumbUpdate();
  rvRenderCond();
});

async function rvCommit() {
  if (!rv || rv.busy) return false;
  const po = $('rvPo').value.trim();
  const sku = $('rvSku').value.trim().toUpperCase();
  // no PO required (owner 2026-09-09): a return can be logged from any
  // detail — but an entry with nothing identifying it is a misclick
  if (!po && !sku && !$('rvCust').value.trim() && !$('rvTrk').value.trim() && !$('rvNote').value.trim()) {
    rvFeedback('Nothing to log — enter a PO#, SKU, customer, tracking # or note.');
    $('rvPo').focus();
    return false;
  }
  let target = '';
  let qty = 1;
  if (sku) {
    const known = rv.condition === 'new' ? sku : ((rv.targets || {})[rv.condition] || '');
    target = known || String(rv.pick || '').trim();
    if (!target) {
      rvFeedback(`No ${retCondLabel(rv.condition).toLowerCase()} listing for ${sku} — pick or create it first.`);
      return false;
    }
    if (recvLookup === 'ready' && !recvLookupExact(target)) {
      rvFeedback(`Unknown SKU: ${target}. Pick one from the inventory.`);
      return false;
    }
    qty = Number($('rvQty').value);
    if (!Number.isInteger(qty) || qty < 1) { rvFeedback('Units must be a whole number of 1 or more.'); return false; }
  }
  const by = $('rvBy').value.trim();
  if (by) retReceivedBy = by;
  rv.busy = true;
  $('rvSave').disabled = true;
  rvFeedback('Receiving…', true);
  const res = await rvCreate({
    orderId: rv.orderId || undefined,
    orderNumber: po,
    source: rv.source,
    customer: $('rvCust').value.trim(),
    tracking: $('rvTrk').value.trim(),
    receivedBy: by,
    unmatched: !!rv.unmatched,
    note: sku ? '' : $('rvNote').value.trim(),
    items: sku ? [{
      sku, condition: rv.condition, targetSku: target, qty,
      price: retMoney($('rvPrice').value) || rv.price,
      note: $('rvNote').value.trim(),
    }] : [],
  }).catch(e => ({ ok: false, error: e.message }));
  rv.busy = false;
  $('rvSave').disabled = false;
  if (!res || !res.ok) { rvFeedback((res && res.error) || 'Could not receive.'); return false; }
  rvFeedback('');
  toast(sku ? `Received ${qty} × ${target}` : `Logged return ${po}`);
  loadRetPast();
  return true;
}

// Receive commits the line. With other order lines still unreceived the
// popup STAYS OPEN on the next one; otherwise it closes.
$('rvSave').addEventListener('click', async () => {
  if (!(await rvCommit())) return;
  if (rv.itemIdx >= 0) rv.received[rv.itemIdx] = true;
  const next = rv.items.findIndex((_, i) => !rv.received[i]);
  if (next < 0) { $('retRecvDialog').close(); return; }
  $('rvNote').value = '';
  rvLoadItemAt(next); // refills price from the next line
  $('rvQty').focus();
});

$('rvCancel').addEventListener('click', () => $('retRecvDialog').close());
// the dialog's close event fires on a QUEUED task: when the popup is closed
// and reopened back-to-back (the e2e suite does; a fast hand could too), the
// stale event lands AFTER the reopen — nulling rv then wiped the fresh state
// and made rvCommit bail through its silent !rv guard (the [false,"",""]
// flake, 6 occurrences). Only wipe when the dialog is really closed.
$('retRecvDialog').addEventListener('close', () => { if (!$('retRecvDialog').open) rv = null; });

// live inventory suggestions in the popup's two SKU fields
makeCombo($('rvSku'), document.querySelector('.rv-combo .combo-list'), async (item) => {
  if (!rv) return;
  rv.sku = item.sku;
  rv.pick = '';
  $('rvPick').value = '';
  $('rvSku').value = item.sku;
  rvThumbUpdate();
  const tr = await api.returnsTargets(item.sku);
  if (tr.ok && rv) rv.targets = tr.targets;
  rvRenderCond();
});
makeCombo($('rvPick'), document.querySelector('.rv-pick-combo .combo-list'), (item) => {
  if (!rv) return;
  rv.pick = item.sku;
  $('rvPick').value = item.sku;
  rvRenderCond();
});

/* ---------- in-sheet receiving, NO POPUP (owner 2026-09-10) ---------- */
// The whole receive happens in the sheet's first row: type the PO# and
// Enter — the matched order fills the blank cells IN PLACE; the condition
// is a pill in the row (click for the 4-pill menu, ⚠ beside it when the
// graded listing is missing → an anchored popover creates or picks one);
// Enter again (or the + gutter) saves the return and clears the row.
// Esc clears a half-typed row. The <tr> is a singleton moved (not
// rebuilt) across renders so half-typed values survive every refresh.

let retEntryTr = null;
let wsEls = null; // { po, cust, trk, date, sku, units, price, by, note }
let ws = null;    // inline receive state (mirrors the old popup's rv)
let wsLookupApi = (po) => api.returnsLookup(po); // seam: e2e stubs the lookup

const WS_FIELDS = [
  ['po', 'Type PO# + Enter…', 'mono', 'PO number'],
  ['cust', '', '', 'Customer name'],
  ['trk', '', 'mono', 'Tracking number'],
  ['date', '', 'mono ws-date', 'Date received'],
  ['sku', '', 'mono', 'Returned SKU'],
  ['units', '', 'mono ws-num', 'Units'],
  ['price', '', 'mono ws-num', 'Price'],
  ['by', '', '', 'Received by'],
  ['note', '', '', 'Notes'],
];

// the date cell prefills with today but takes typing like every other
// cell (owner 2026-09-10); auto-updates across midnight only while unedited
let wsDateAuto = true;
function wsDateFill() {
  wsEls.date.value = retDateUS(new Date().toISOString());
  wsDateAuto = true;
}

function wsBlank() {
  return { orderId: null, source: '', unmatched: true, items: [], targets: null, condition: 'new', pick: '', busy: false, looked: '' };
}

// Different return keeps the ORDERED SKU in the cell and grows a second
// "→ what came back" line under it (owner 2026-09-10: same look as the
// log's arrow line) — this manages that extra input's life cycle
function wsRecvEl() { return retEntryTr ? retEntryTr.querySelector('#ws_recv') : null; }
function wsRecvVal() { const r = wsRecvEl(); return r ? r.value.trim() : ''; }

function wsSyncRecv() {
  let r = wsRecvEl();
  if (ws.condition !== 'different') { if (r) r.remove(); return; }
  if (r) return;
  wsEls.sku.insertAdjacentHTML('afterend', `<input id="ws_recv" class="ws-in mono ws-recv" type="text"
    placeholder="→ what came back…" autocomplete="off" spellcheck="false" aria-label="What actually came back" />`);
  r = wsRecvEl();
  r.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); wsReset(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    wsSave();
  });
  r.addEventListener('input', () => wsRenderCond());
}

function wsInput(key) {
  const [, ph, cls, label] = WS_FIELDS.find(f => f[0] === key);
  // #wsPo keeps its historic id (tests and muscle memory point at it)
  return `<input id="${key === 'po' ? 'wsPo' : `ws_${key}`}" class="ws-in ${cls}" type="text" placeholder="${ph}"
    autocomplete="off" spellcheck="false" aria-label="${label}" />`;
}

function retEntryRow() {
  if (retEntryTr) return retEntryTr;
  ws = wsBlank();
  const tr = document.createElement('tr');
  tr.className = 'ws-row';
  tr.innerHTML = `
    <td class="cell-gutter ws-gutter" id="wsPlus" title="Save this return" role="button">+</td>
    <td class="ws-cell">${wsInput('po')}</td>
    <td class="ws-cell">${wsInput('cust')}</td>
    <td class="ws-cell">${wsInput('trk')}</td>
    <td class="ws-cell">${wsInput('date')}</td>
    <td class="ws-cell">${wsInput('sku')}<div class="combo-list ws-skulist" hidden></div></td>
    <td class="ws-cell ws-cond-cell" id="wsCondCell"></td>
    <td class="ws-cell">${wsInput('units')}</td>
    <td class="ws-cell">${wsInput('price')}</td>
    <td class="ws-cell">${wsInput('by')}</td>
    <td class="ws-cell">${wsInput('note')}</td>
    <td class="cell-actions"></td>`;
  retEntryTr = tr;
  wsEls = { condCell: tr.querySelector('#wsCondCell') };
  for (const [key] of WS_FIELDS) wsEls[key] = tr.querySelector(key === 'po' ? '#wsPo' : `#ws_${key}`);
  wsDateFill();
  wsEls.date.addEventListener('input', () => { wsDateAuto = false; });
  wsRenderCond();
  // the SKU dropdown's own keys win while it shows options: Enter picks,
  // Esc closes the list — neither saves nor clears the row
  const skuList = tr.querySelector('.ws-skulist');
  const skuListLive = () => !skuList.hidden && !!skuList.querySelector('.combo-opt');
  for (const [key] of WS_FIELDS) {
    wsEls[key].addEventListener('keydown', (e) => {
      if (key === 'sku' && skuListLive() && (e.key === 'Enter' || e.key === 'Escape')) return;
      if (e.key === 'Escape') { e.preventDefault(); wsReset(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const po = wsEls.po.value.trim();
      // the PO cell's first Enter looks the order up; everything after saves
      if (key === 'po' && po && ws.looked !== po) wsLookup(po);
      else wsSave();
    });
  }
  // suggestions while typing a SKU, like every other picker in the app
  // (owner 2026-09-18: "why am I not seeing suggestions?") — SKU only,
  // no title line; picking resolves the condition targets and moves on
  makeCombo(wsEls.sku, skuList, (item) => {
    wsEls.sku.value = item.sku;
    ws.targets = null;
    ws.pick = '';
    ws.itemIdx = -1;
    wsResolveTargets();
    wsEls.units.focus();
    wsEls.units.select();
  }, { noTitle: true });
  // editing the PO after a match voids the match (a stale orderId must
  // never ride along); a re-typed SKU is no longer "that order line"
  wsEls.po.addEventListener('input', () => {
    ws.orderId = null; ws.source = ''; ws.unmatched = true;
    ws.items = []; ws.looked = '';
    wsSetPhase('idle'); // the edited PO is a new draft, not the loaded order
  });
  wsEls.sku.addEventListener('input', () => {
    ws.targets = null; ws.pick = '';
    wsRenderCond();
  });
  wsEls.sku.addEventListener('change', () => wsResolveTargets());
  tr.addEventListener('click', (e) => {
    if (e.target.closest('#wsCond')) { wsCondMenu(); return; }
    if (e.target.closest('#wsWarn')) { wsFixOpen(); return; }
    if (e.target.closest('#wsPlus')) wsSave();
  });
  return tr;
}

// the condition cell: the pill (click = 4-pill menu) and the ⚠ that shows
// when the graded listing is missing
function wsRenderCond() {
  if (!wsEls) return;
  wsSyncRecv();
  const sku = wsEls.sku.value.trim();
  const recv = wsRecvVal();
  const c = ws.condition;
  const resolved = c === 'new' ? sku : (((ws.targets || {})[c]) || ws.pick);
  // Different return: the ⚠ means "the → line isn't a listing" (saving is
  // still allowed — it logs with no stock move); other grades block on it
  const missing = c === 'different'
    ? (!!recv && recvLookup === 'ready' && !recvLookupExact(recv))
    : (!!sku && c !== 'new' && !resolved);
  const warnTitle = c === 'different'
    ? `${recv} isn't an inventory listing — it saves as log-only; click to create it or pick what came back`
    : `No ${retCondLabel(c).toLowerCase()} listing for ${sku} yet — click to create or pick one`;
  wsEls.condCell.innerHTML = `
    <button id="wsCond" type="button" class="ret-cond-ro is-${esc(c)}" title="Condition it came back in — click to change">
      <span class="ret-dd-dot is-${esc(c)}"></span>${esc(retCondLabel(c))}</button>
    ${missing ? `<button id="wsWarn" type="button" class="rv-warn" title="${esc(warnTitle)}">⚠</button>` : ''}`;
}

// non-new grades need a landing listing: resolve quietly whenever the SKU
// or condition settles, so the ⚠ only shows for real gaps
async function wsResolveTargets() {
  const sku = wsEls.sku.value.trim().toUpperCase();
  if (!sku || ws.condition === 'new' || ws.condition === 'different' || (ws.targets || {})[ws.condition]) { wsRenderCond(); return; }
  const tr = await api.returnsTargets(sku).catch(() => null);
  if (tr && tr.ok) ws.targets = { ...(tr.targets || {}), ...(ws.targets || {}) };
  wsRenderCond();
}

function wsCondMenu() {
  const old = document.querySelector('.ws-emenu');
  if (old) { old.remove(); return; }
  const anchor = wsEls.condCell.querySelector('#wsCond');
  const menu = document.createElement('div');
  menu.className = 'ws-emenu ret-emenu';
  menu.innerHTML = RET_CONDS.map(c => `
    <button type="button" class="ret-emi ${ws.condition === c.key ? 'is-sel' : ''}" data-cond="${c.key}">
      <span class="ret-dd-dot is-${c.key}"></span>${c.label}</button>`).join('');
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 150))}px`;
  menu.style.top = `${r.bottom + 4}px`;
  document.body.appendChild(menu);
  const away = (e) => {
    if (e.target.closest('.ws-emenu')) return;
    document.removeEventListener('mousedown', away, true);
    menu.remove();
  };
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cond]');
    if (!b) return;
    document.removeEventListener('mousedown', away, true);
    menu.remove();
    ws.condition = b.dataset.cond;
    wsRenderCond();
    wsResolveTargets();
    if (ws.condition === 'different') {
      // the ordered SKU stays put; typing goes into the new → line
      const r = wsRecvEl();
      if (r) r.focus();
    }
  });
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
}

// ⚠ popover (anchored, not a dialog): create the suggested listing or
// pick an existing one — same engine as everywhere else
function wsFixOpen() {
  const warn = wsEls.condCell.querySelector('#wsWarn');
  const diff = ws.condition === 'different';
  const sku = diff ? wsRecvVal().toUpperCase() : wsEls.sku.value.trim().toUpperCase();
  if (!warn || !sku) return;
  const fix = $('wsFix');
  if (!fix.hidden) { wsFixClose(); return; }
  $('wsFixMsg').innerHTML = diff
    ? `<span class="mono">${esc(sku)}</span> isn’t an inventory listing — it saves as a log-only line. Create it, or pick what actually came back:`
    : `There’s no <b>${esc(retCondLabel(ws.condition).toLowerCase())}</b> listing for <span class="mono">${esc(sku)}</span> yet — create it?`;
  const suggested = diff ? sku : retSuggestCondSku(sku, ws.condition);
  const btn = $('wsFixCreate');
  const canCreate = (diff || RET_PREFIX[ws.condition]) && !(recvLookup === 'ready' && recvLookupExact(suggested));
  btn.hidden = !canCreate;
  btn.innerHTML = `Create <span class="mono">${esc(suggested)}</span>`;
  btn.dataset.sku = suggested;
  $('wsFixPick').value = '';
  ensureInventory();
  const r = warn.getBoundingClientRect();
  fix.style.left = `${Math.max(8, Math.min(r.left - 40, window.innerWidth - 348))}px`;
  fix.style.top = `${r.bottom + 6}px`;
  fix.hidden = false;
}

function wsFixClose() { $('wsFix').hidden = true; }

document.addEventListener('mousedown', (e) => {
  if ($('wsFix').hidden) return;
  if (e.target.closest('#wsFix') || e.target.closest('#wsWarn')) return;
  wsFixClose();
}, true);

$('wsFixCreate').addEventListener('click', () => {
  const sku = wsEls.sku.value.trim().toUpperCase();
  const cond = ws.condition;
  wsFixClose();
  if (cond === 'different') {
    // a brand-new item IS what came back: create it, it fills the → line
    openNewSkuDialog({ sku: $('wsFixCreate').dataset.sku, title: skuTitleSuggestion($('wsFixCreate').dataset.sku) }, (newSku) => {
      const r = wsRecvEl();
      if (r) r.value = newSku;
      toast(`${newSku} created`);
      wsRenderCond();
    });
    return;
  }
  openCondSkuCreate(sku, cond, $('wsFixCreate').dataset.sku, (target) => {
    ws.targets = { ...(ws.targets || {}), [cond]: target };
    wsRenderCond();
  });
});

makeCombo($('wsFixPick'), document.querySelector('#wsFix .combo-list'), async (item) => {
  const sku = wsEls.sku.value.trim().toUpperCase();
  const cond = ws.condition;
  if (cond === 'different') {
    // picking IS the answer: that listing fills the → line
    const r = wsRecvEl();
    if (r) r.value = item.sku;
    wsFixClose();
    wsRenderCond();
    return;
  }
  const map = await api.returnsMapSet(sku, cond, item.sku);
  if (!map.ok) { toast(map.error || 'Could not save the mapping.'); return; }
  toast(`${sku} ${cond} → ${map.targetSku}`);
  ws.targets = { ...(ws.targets || {}), [cond]: map.targetSku };
  wsFixClose();
  wsRenderCond();
});

// the entry row's phase, worn where the eye already is (approved demo
// pending-entry.html, owner 2026-09-14): while the lookup runs the +
// becomes a loading circle (just the circle — no gray wash); a loaded,
// not-yet-saved row tints green and the gutter turns into a ✓, so the
// draft never reads as an already-saved row
function wsSetPhase(p) {
  if (!retEntryTr) return;
  retEntryTr.classList.toggle('is-ready', p === 'ready');
  const plus = retEntryTr.querySelector('#wsPlus');
  if (!plus) return;
  if (p === 'pending') {
    plus.innerHTML = '<span class="ws-spin" aria-label="Looking the order up"></span>';
    plus.title = 'Looking the order up…';
  } else if (p === 'ready') {
    plus.textContent = '✓';
    plus.title = 'Order loaded — Enter (or click here) saves this return';
  } else {
    plus.textContent = '+';
    plus.title = 'Save this return';
  }
}

// PO# + Enter: the matched order LOADS OVER the row (owner 2026-09-10,
// "as soon as you enter a PO# it will load and overwrite everything") —
// the sheet types like Excel, the lookup stamps the order's truth on it
async function wsLookup(po) {
  if (ws.busy) return;
  ws.busy = true;
  wsSetPhase('pending');
  const res = await wsLookupApi(po).catch(e => ({ ok: false, error: e.message }));
  ws.busy = false;
  ws.looked = po;
  if (!res || !res.ok) {
    wsSetPhase('idle');
    ws.unmatched = true; ws.orderId = null; ws.source = '';
    toast(`${(res && res.error) || 'Not found.'} — enter the details by hand.`);
    wsEls.cust.focus();
    return;
  }
  wsSetPhase('ready');
  const o = res.order;
  ws.unmatched = false;
  ws.orderId = o.orderId;
  ws.source = o.source;
  wsEls.po.value = o.reference || po;
  ws.looked = wsEls.po.value.trim();
  wsEls.cust.value = o.customer || '';
  wsEls.trk.value = o.tracking || '';
  ws.items = o.items || [];
  const typed = wsEls.sku.value.trim().toUpperCase();
  let line = typed
    ? ws.items.find(it => String(it.sku || '').toUpperCase() === typed
      || String(it.channelSku || '').toUpperCase() === typed) || null
    : null;
  const distinct = [...new Set(ws.items.map(it => String(it.sku || '').toUpperCase()))];
  if (!line && !typed && distinct.length === 1) line = ws.items[0];
  if (line) wsUseLine(line);
  else if (!typed && ws.items.length > 1) wsLineMenu(); // which line came back?
  wsEls.sku.focus();
}

function wsUseLine(line) {
  wsEls.sku.value = line.sku || '';
  ws.targets = line.targets || null;
  ws.pick = '';
  wsEls.units.value = String(line.quantity || 1);
  wsEls.price.value = Number(line.price) ? Number(line.price).toFixed(2) : '';
  wsRenderCond();
}

// a multi-line order: an anchored menu under the SKU cell picks the line
function wsLineMenu() {
  const old = document.querySelector('.ws-emenu');
  if (old) old.remove();
  const menu = document.createElement('div');
  menu.className = 'ws-emenu ret-emenu';
  const seen = new Set();
  menu.innerHTML = ws.items.filter(it => {
    const k = String(it.sku || '').toUpperCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((it, i) => `
    <button type="button" class="ret-emi" data-line="${ws.items.indexOf(it)}">
      <span class="mono">${esc(it.sku)}</span>&nbsp;×${it.quantity || 1}</button>`).join('');
  const r = wsEls.sku.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 260))}px`;
  menu.style.top = `${r.bottom + 4}px`;
  document.body.appendChild(menu);
  const away = (e) => {
    if (e.target.closest('.ws-emenu')) return;
    document.removeEventListener('mousedown', away, true);
    menu.remove();
  };
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-line]');
    if (!b) return;
    document.removeEventListener('mousedown', away, true);
    menu.remove();
    wsUseLine(ws.items[Number(b.dataset.line)]);
  });
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
}

function wsReset() {
  for (const [key] of WS_FIELDS) wsEls[key].value = '';
  wsDateFill();
  ws = wsBlank();
  wsSetPhase('idle');
  wsFixClose();
  const menu = document.querySelector('.ws-emenu');
  if (menu) menu.remove();
  wsRenderCond();
}

// Enter (or +) saves the row straight through returns:create — the same
// engine the popup used, popup not included
async function wsSave() {
  if (!ws || ws.busy) return;
  const v = {};
  for (const [key] of WS_FIELDS) v[key] = wsEls[key].value.trim();
  const sku = v.sku.toUpperCase();
  if (!v.po && !sku && !v.cust && !v.trk && !v.note) return; // a blank row is a stray Enter
  let receivedDay = '';
  if (v.date) {
    const m = v.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) { toast('Date must look like 09/10/2026.'); wsEls.date.focus(); return; }
    receivedDay = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  let target = '';
  let qty = 1;
  let received = '';
  if (sku || (ws.condition === 'different' && wsRecvVal())) {
    if (ws.condition === 'different') {
      // the → line holds what ACTUALLY came back: a real listing restocks
      // itself, plain text (e.g. GARBAGE) logs with no stock move
      received = wsRecvVal().toUpperCase();
      if (!received) {
        const r = wsRecvEl();
        if (r) r.focus();
        toast('Type what actually came back on the → line under the SKU.');
        return;
      }
      target = recvLookup === 'ready' && recvLookupExact(received) ? received : '';
    } else {
      target = ws.condition === 'new' ? sku : (((ws.targets || {})[ws.condition]) || String(ws.pick || '').trim());
      if (!target) {
        // one quiet resolve attempt before complaining (hand-typed SKUs)
        const tr = await api.returnsTargets(sku).catch(() => null);
        if (tr && tr.ok) {
          ws.targets = { ...(tr.targets || {}), ...(ws.targets || {}) };
          target = (ws.targets[ws.condition]) || '';
        }
      }
      if (!target) {
        wsRenderCond();
        toast(`No ${retCondLabel(ws.condition).toLowerCase()} listing for ${sku} — press the ⚠ to create or pick one.`);
        return;
      }
      if (recvLookup === 'ready' && !recvLookupExact(target)) {
        toast(`Unknown SKU: ${target}. Pick one from the inventory.`);
        return;
      }
    }
    qty = v.units ? Number(v.units) : 1;
    if (!Number.isInteger(qty) || qty < 1) { toast('Units must be a whole number of 1 or more.'); return; }
  }
  const by = v.by || retReceivedBy;
  if (by) retReceivedBy = by;
  ws.busy = true;
  const res = await rvCreate({
    orderId: ws.orderId || undefined,
    orderNumber: v.po,
    source: ws.source,
    customer: v.cust,
    tracking: v.trk,
    receivedBy: by,
    receivedDay, // the typed Date Received cell (empty = today)
    unmatched: !!ws.unmatched,
    note: (sku || received) ? '' : v.note,
    items: (sku || received) ? [{
      // no ordered SKU on record: what came back IS the line
      sku: sku || received,
      received: sku ? received : '',
      condition: ws.condition, targetSku: target, qty,
      price: retMoney(v.price),
      note: v.note,
    }] : [],
  }).catch(e => ({ ok: false, error: e.message }));
  ws.busy = false;
  if (!res || !res.ok) { toast((res && res.error) || 'Could not save the return.'); return; }
  toast((sku || received) ? `Received ${sku || received} ×${qty}` : `Logged ${v.po}`, 2500);
  wsReset();
  loadRetPast();
  wsEls.po.focus();
}


// marketplace link for a returns row: the order's Source ("WALMART", "EBAY"…)
// maps onto the same per-channel URL templates the Capture page's PO# links
// use; no template (or an unmatched return) = no button
function retChannel(source) {
  const key = String(source || '').trim().toLowerCase();
  const s = state || {};
  const hasLink = ((s.returnUrlTemplates || {})[key] || '').trim()
    || ((s.orderUrlTemplates || {})[key] || '').trim();
  return hasLink ? key : '';
}

// an unmatched row has no source, but the PO's FORMAT usually gives the
// marketplace away (owner 2026-09-18: "always have a link to the PO#") —
// the same Settings patterns that classify scanned order numbers decide
let retPoPatterns = null; // [{ch, re}] compiled once per returns visit
function retPoGuess(po) {
  for (const p of retPoPatterns || []) {
    if (p.re.test(po)) return retChannel(p.ch);
  }
  return '';
}

function retPoOpenBtn(po, source) {
  const ch = po ? (retChannel(source) || retPoGuess(String(po).trim())) : '';
  if (!ch) return '';
  return `<button class="btn-icon ret-po-open" data-po="${esc(po)}" data-ch="${ch}"
    title="Open the ${esc(channelLabel(ch))} return for ${esc(po)}">${ICONS.arrowOut}</button>`;
}


// pane open -> the RETURN loads beside the sheets; collapsed -> external.
// kind 'return' picks the marketplace's returns page (Walmart's returns
// search, eBay's return details), falling back to the order page.
function retOpenPo(po, ch) {
  if (!$('bDock').hidden) {
    bShowLoading(`Opening return ${po}`);
    api.browserOpen(po, ch, 'return').then(opened => {
      if (!opened.ok) {
        bHideLoading();
        if (opened.error) toast(opened.error);
      }
    });
  } else {
    api.openOrderPage(po, ch, 'return');
  }
}




// Returns log: one flat stack, every unit a row, newest first — log style
// (condition as a pastel badge, horizontal dividers only). Search filters
// the whole history live.
let retLogAll = null; // [{ r: record, i: item line, ii: item index (-1 = PO-only) }] per unit

// condition SKUs holding returned stock with NO marketplace listing linked
// yet — surfaced as "not listed" markers so the employee knows what to make
let unlistedSkus = null; // Set of UPPERCASE SKUs | null = not loaded
let unlistedDetail = null; // [{sku,title,image,avail}] most units first
let unlistedChannels = []; // sources seen across the inventory ("missing on")
let unlistedIgnored = []; // never-list SKUs (claim bins, fakes)
let unlistedLoading = false;
// channel bypass ("I can't sell this there" — owner 2026-09-12): click a
// channel chip on an Unlisted row to grey it out; the SKU stops counting
// as missing there (per-SKU only — the owner passed on condition rules)
let chanSkips = {}; // { 'SKU': ['walmart', …] }
// Avail header toggle: most units first instead of most gaps first
let unlSortUnits = localStorage.getItem('unlSortUnits') === '1';

// is this channel bypassed for this SKU? ('' = expected, 'sku' = skipped)
function chanSkipKind(sku, ch) {
  return (chanSkips[String(sku).toUpperCase()] || []).includes(ch) ? 'sku' : '';
}
// the channels the Unlisted view judges against, normalized to the three
// marketplace keys (raw sources arrive as 'EBAY', 'TEMU US', 'WALMART'…)
function unlChanKeys() {
  const keys = [];
  for (const c of unlistedChannels) {
    const k = /walmart/i.test(c) ? 'walmart' : /ebay/i.test(c) ? 'ebay' : /temu/i.test(c) ? 'temu' : '';
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys.length ? keys.sort() : ['ebay', 'temu', 'walmart'];
}
// Every in-stock SKU missing a listing on AT LEAST ONE channel — New
// included (owner 2026-09-14: "it should show every listing, new or open
// box or used"). Computed from the loaded stock sheet + the truthful link
// sets, zero extra API calls; each row carries its own missing-channel
// list so partially-listed items show only the gaps. Until the link sets
// land, the zero-listing scan stands in (those rows miss everywhere).
function unlMissingRows() {
  const chans = unlChanKeys();
  if (stockCache && chLinked && chans.some(ch => chLinked[ch])) {
    const ignored = new Set(unlistedIgnored.map(s => String(s).toUpperCase()));
    const out = [];
    for (const it of stockCache.items) {
      if (!it.stockItemId || ignored.has(String(it.sku).toUpperCase())) continue;
      const l = it.levels.find(x => x.locationId === stockCache.locationId);
      const avail = l ? Math.max(Number(l.stockLevel) || 0, Number(l.available) || 0) : 0;
      if (avail <= 0) continue;
      const missing = chans.filter(ch => chLinked[ch] && !chLinked[ch].has(it.stockItemId));
      if (!missing.length) continue;
      out.push({ sku: it.sku, title: it.title || '', image: it.image || '', stockItemId: it.stockItemId, avail, missing });
    }
    return out;
  }
  return (unlistedDetail || []).map(d => ({ ...d, missing: chans.slice() }));
}

// rows still worth nagging about: at least one missing channel not bypassed
function unlActiveDetail() {
  return unlMissingRows().filter(r => r.missing.some(ch => !chanSkipKind(r.sku, ch)));
}

// a background rescan finished in main: swap the fresh sets in wherever shown
api.on('unlisted:refreshed', () => {
  unlistedSkus = null;
  chLinked = null;
  loadUnlisted();
  loadChLinked();
});

async function loadUnlisted(force) {
  if (unlistedLoading || (state && state.captureOnly)) return;
  unlistedLoading = true;
  try {
    const res = await api.stockUnlisted(!!force);
    if (res.ok) {
      unlistedSkus = new Set(res.skus || []);
      unlistedDetail = res.detail || [];
      unlistedChannels = res.channels || [];
      unlistedIgnored = res.ignored || [];
      chanSkips = res.chanSkips || {};
      if (activePage === 'returns') { renderRetLog(); renderRetTodo(); }
      if (activePage === 'stock' && stockCache) { renderStockChips(); renderStock(); }
      if (activePage === 'ebay') renderEbayQueue();
    }
  } finally {
    unlistedLoading = false;
  }
}

/* ---------- Channel mapping (in-app Linnworks mapping screen) ---------- */
// Approved design: variants/channel-mapping-ours.html variation 1 — two
// excel-style sheets, select a listing on the left, Link on the right.
// The catalog comes from ChannelMapping/GetChannelItems (cached in main);
// filtering is local and instant.

const chmap = {
  channels: [], chan: null, items: [], sel: null,
  onlyUn: false, busy: '', fresh: '', local: false, // local = demo seed
  hasQty: true, // hide unlinked listings with 0 qty (dead listings) by default
};

function chmapChanLabel(c) {
  const s = String((c && c.source) || '').toLowerCase();
  if (s.includes('walmart')) return 'Walmart';
  if (s.includes('ebay')) return 'eBay';
  if (s.includes('temu')) return 'Temu';
  return (c && c.source) || '—';
}

async function chmapOpen() {
  $('chmapDialog').showModal();
  ensureInventory(); // the right sheet is the inventory cache
  if (chmap.local) { renderChmap(); return; }
  if (!chmap.channels.length) {
    chmap.busy = 'Loading channels…';
    renderChmap();
    const res = await api.mappingChannels();
    if (!res.ok) {
      chmap.busy = '';
      renderChmap();
      toast(res.error || 'Could not load the channel list.');
      return;
    }
    chmap.channels = res.channels;
    chmap.chan = chmap.channels.find(c => /walmart/i.test(c.source)) || chmap.channels[0] || null;
  }
  if (chmap.chan && !chmap.items.length) await chmapLoadItems();
  else renderChmap();
}

async function chmapLoadItems(force) {
  if (!chmap.chan) return;
  chmap.busy = `Loading the ${chmapChanLabel(chmap.chan)} catalog…`;
  chmap.sel = null;
  renderChmap();
  const res = await api.mappingItems(chmap.chan.id, chmap.chan.source, chmap.chan.subSource, !!force);
  chmap.busy = '';
  if (!res.ok) {
    chmap.items = [];
    renderChmap();
    toast(res.error || 'Could not load the listings.');
    return;
  }
  chmap.items = res.items;
  renderChmap();
}

function renderChmap() {
  if (!$('chmapDialog').open) return;
  $('chmapChanLbl').textContent = chmapChanLabel(chmap.chan);
  $('chmapSub').textContent = chmap.chan ? chmap.chan.subSource : '';
  $('chmapWmQ').placeholder = `Search ${chmapChanLabel(chmap.chan)} SKU or title…`;
  $('chmapOnlyUn').classList.toggle('on', chmap.onlyUn);
  $('chmapChanMenu').innerHTML = chmap.channels.map(c => `
    <button type="button" data-chid="${c.id}" class="${chmap.chan && c.id === chmap.chan.id ? 'on' : ''}">${esc(chmapChanLabel(c))}</button>`).join('');

  // linked GUID -> Linnworks SKU string, via the inventory cache
  const byId = new Map();
  if (recvItems) for (const it of recvItems) { if (it.stockItemId) byId.set(it.stockItemId, it.sku); }

  $('chmapHasQty').classList.toggle('on', chmap.hasQty);
  const q1 = $('chmapWmQ').value.trim().toLowerCase();
  const rows = chmap.items.filter(w => {
    if (chmap.onlyUn && w.linked) return false;
    // dead listings (0 qty on the channel) hide from the unlinked worklist;
    // linked rows stay visible either way
    if (chmap.hasQty && !w.linked && !(w.qty > 0)) return false;
    if (!q1) return true;
    const linkedSku = w.linkedSkuOverride || byId.get(w.linkedItemId) || '';
    return skuMatch(w.sku, q1) || skuMatch(w.title, q1) || skuMatch(linkedSku, q1);
  });
  const unlinked = chmap.items.filter(w => !w.linked).length;
  $('chmapWmCount').textContent = chmap.busy ? '' : `${unlinked} unlinked / ${chmap.items.length}`;
  $('chmapWmBody').innerHTML = chmap.busy
    ? `<tr><td colspan="3" class="chmap-none">${esc(chmap.busy)}</td></tr>`
    : rows.slice(0, 400).map(w => {
      const linkedSku = w.linkedSkuOverride || byId.get(w.linkedItemId) || (w.linked ? '(linked)' : '');
      return `
      <tr class="${chmap.sel === w.sku ? 'sel' : ''}" data-wm="${esc(w.sku)}">
        <td class="mono" title="${esc(w.title)}${w.wfs ? ' · Walmart-fulfilled (WFS) listing' : ''} · listed qty ${w.qty || 0}"><span class="chmap-copy" data-copy="${esc(w.sku)}" title="Click to copy ${esc(w.sku)}">${esc(w.sku)}</span>${w.qty > 0 ? ` <span class="chmap-qty">×${w.qty}</span>` : ''}</td>
        <td>${w.linked
          ? `<span class="mono chmap-grn${linkedSku && linkedSku !== '(linked)' ? ' chmap-copy' : ''}"${linkedSku && linkedSku !== '(linked)' ? ` data-copy="${esc(linkedSku)}" title="Click to copy ${esc(linkedSku)}"` : ''}>${esc(linkedSku)}</span>`
          : '<span class="chmap-lk">not linked</span>'}</td>
        <td class="chmap-act">${w.linked && w.rowId ? '<button class="pillbtn chmap-unlink" type="button">Unlink</button>' : ''}</td>
      </tr>`;
    }).join('')
      || `<tr><td colspan="3" class="chmap-none">No ${esc(chmapChanLabel(chmap.chan))} listing matches.</td></tr>`;

  const q2 = $('chmapLwQ').value.trim().toLowerCase();
  let inv = recvItems ? recvItems.filter(l => !q2
    || skuMatch(l.sku, q2)
    || skuMatch(l.title, q2)) : [];
  if (chmap.fresh) {
    const i = inv.findIndex(l => l.sku === chmap.fresh);
    if (i > 0) inv.unshift(inv.splice(i, 1)[0]);
  }
  $('chmapLwBody').innerHTML = recvLookup !== 'ready'
    ? '<tr><td colspan="2" class="chmap-none">Loading the inventory…</td></tr>'
    : inv.slice(0, 250).map(l => `
      <tr data-lw="${esc(l.sku)}" class="${l.sku === chmap.fresh ? 'chmap-fresh' : ''}">
        <td class="chmap-act2"><button class="pillbtn chmap-link" type="button" ${chmap.sel ? '' : 'disabled'}
          title="${chmap.sel ? `Link ${esc(chmap.sel)} → ${esc(l.sku)}` : 'Select a listing on the left first'}"><svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M137.54,186.36a8,8,0,0,1,0,11.31l-9.94,10A56,56,0,0,1,48,128.05l24-24a56,56,0,0,1,76.81-2.28,8,8,0,1,1-10.64,11.95A40,40,0,0,0,83.35,115.4l-24,24a40,40,0,0,0,56.57,56.56l9.94-9.94A8,8,0,0,1,137.54,186.36Zm70.08-138a56.08,56.08,0,0,0-79.22,0l-9.94,9.95a8,8,0,0,0,11.32,11.31l9.94-9.94a40,40,0,0,1,56.57,56.56l-24,24a40,40,0,0,1-54.85,1.6A8,8,0,1,0,106.8,153.8a56,56,0,0,0,76.81-2.26l24-24A56.08,56.08,0,0,0,207.62,48.38Z"/></svg>Link</button></td>
        <td class="mono" title="${esc(l.title || '')}"><span class="chmap-copy" data-copy="${esc(l.sku)}" title="Click to copy ${esc(l.sku)}">${esc(l.sku)}</span>${l.sku === chmap.fresh ? ' <span class="chmap-new">new</span>' : ''}</td>
      </tr>`).join('')
      || `<tr><td colspan="2" class="chmap-none">Nothing matches — press <b>+ New SKU</b> to create it.</td></tr>`;
}

$('chmapBtn').addEventListener('click', () => chmapOpen());
$('chmapClose').addEventListener('click', () => $('chmapDialog').close());
$('chmapOnlyUn').addEventListener('click', () => { chmap.onlyUn = !chmap.onlyUn; renderChmap(); });
$('chmapHasQty').addEventListener('click', () => { chmap.hasQty = !chmap.hasQty; renderChmap(); });

// links confirmed against Inventory's records (ahead of the channel scan)
// stream in and flip their rows to linked on the spot
api.on('mapping:overlay', (d) => {
  if (chmap.local || !chmap.chan || chmap.chan.id !== d.channelId) return;
  const it = chmap.items.find(w => w.sku === d.sku);
  if (it && !it.linked) {
    it.linked = true;
    it.linkedItemId = d.stockItemId;
    renderChmap();
  }
});
$('chmapWmQ').addEventListener('input', () => renderChmap());
$('chmapLwQ').addEventListener('input', () => renderChmap());

$('chmapChanBtn').addEventListener('click', () => {
  $('chmapChanMenu').hidden = !$('chmapChanMenu').hidden;
});
$('chmapChanMenu').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-chid]');
  if (!b) return;
  $('chmapChanMenu').hidden = true;
  const next = chmap.channels.find(c => c.id === Number(b.dataset.chid));
  if (!next || (chmap.chan && next.id === chmap.chan.id)) return;
  chmap.chan = next;
  chmap.items = [];
  if (!chmap.local) await chmapLoadItems();
  else renderChmap();
});
document.addEventListener('mousedown', (e) => {
  if (!$('chmapChanMenu').hidden && !e.target.closest('.chanwrap')) $('chmapChanMenu').hidden = true;
});

$('chmapWmBody').addEventListener('click', async (e) => {
  // clicking a SKU string copies it (owner 2026-09-16); the row still
  // selects/deselects underneath, so linking flows exactly as before
  const cp = e.target.closest('.chmap-copy');
  if (cp) copyFromApp(cp.dataset.copy);
  const tr = e.target.closest('tr[data-wm]');
  if (!tr) return;
  const item = chmap.items.find(x => x.sku === tr.dataset.wm);
  if (!item) return;
  if (e.target.closest('.chmap-unlink')) {
    if (chmap.local) {
      item.linked = false; item.linkedItemId = ''; item.linkedSkuOverride = '';
      toast(`${item.sku} unlinked`);
      renderChmap();
      return;
    }
    const res = await api.mappingUnlink(item.rowId);
    if (!res.ok) { toast(res.error || 'Could not unlink.'); return; }
    // mirror of the link path — but the item may hold ANOTHER link on the
    // same channel (a WFS listing, a second SKU), so the chip only flips to
    // unlisted when the remaining link records say the channel is really
    // empty (owner 2026-09-17: unlinking one of two Walmart SKUs wrongly
    // reverted the Walmart chip)
    if (item.linkedItemId && chLinked) {
      const label = chmapChanLabel(chmap.chan).toLowerCase();
      const id = item.linkedItemId;
      api.getChannelSkus(id).then((r) => {
        const still = !!(r && r.ok && (r.channels || []).some((c) => {
          const src = String(c.source || '');
          const l = /walmart/i.test(src) ? 'walmart' : /ebay/i.test(src) ? 'ebay' : /temu/i.test(src) ? 'temu' : '';
          return l === label;
        }));
        if (still || !chLinked || !chLinked[label]) return;
        chLinked[label].delete(id);
        renderStockChips();
        if (activePage === 'stock' && stockCache) renderStock();
      }).catch(() => { /* chip stays; the next full scan settles it */ });
    }
    item.linked = false;
    item.linkedItemId = '';
    item.linkedSkuOverride = '';
    item.rowId = '';
    toast(`${item.sku} unlinked`);
    renderChmap();
    loadUnlisted();
    return;
  }
  chmap.sel = chmap.sel === item.sku ? null : item.sku;
  renderChmap();
});

$('chmapLwBody').addEventListener('click', async (e) => {
  const cp = e.target.closest('.chmap-copy');
  if (cp) { copyFromApp(cp.dataset.copy); return; } // the Link pill keeps its own click
  const btn = e.target.closest('.chmap-link');
  if (!btn || btn.disabled || !chmap.sel) return;
  const target = e.target.closest('tr[data-lw]').dataset.lw;
  const item = chmap.items.find(x => x.sku === chmap.sel);
  if (!item) return;
  let linkedStockId = '';
  let lastMapOrders = null;
  if (!chmap.local) {
    btn.disabled = true;
    const res = await api.mappingLink(item.sku, chmap.chan.source, chmap.chan.subSource, target, item.channelRefId || '');
    if (!res.ok) { btn.disabled = false; toast(res.error || 'Could not link.'); return; }
    linkedStockId = res.stockItemId || '';
    lastMapOrders = res.orders || null;
  }
  item.linked = true;
  item.linkedSkuOverride = target;
  chmap.sel = null;
  // the retro-link check ran in main: say what actually happened to open
  // orders already carrying this channel SKU instead of guessing
  const ord = chmap.local ? null : lastMapOrders;
  if (!ord || ord.count === 0) {
    toast(`${item.sku} → ${target} linked`);
  } else if (ord.pending === 0) {
    toast(`${item.sku} → ${target} linked — ${ord.count} open order${ord.count === 1 ? '' : 's'} picked up the link, stock deducts when they ship`, 6000);
  } else {
    toast(`${item.sku} → ${target} linked — ${ord.pending} open order${ord.pending === 1 ? '' : 's'} did NOT pick up the link. If they ship that way, deduct ${ord.units} unit${ord.units === 1 ? '' : 's'} by hand.`, 9000);
  }
  renderChmap();
  if (!chmap.local) {
    // the missing-listings sets learn about the link IMMEDIATELY — the scan
    // feed they are built from lags by a full channel scan
    if (linkedStockId && chLinked) {
      const label = chmapChanLabel(chmap.chan).toLowerCase();
      if (chLinked[label]) chLinked[label].add(linkedStockId);
      renderStockChips();
      if (activePage === 'stock' && stockCache) renderStock();
    }
    chmapLoadItems(true); // silent re-pull picks up the new rowId for Unlink
    loadUnlisted();
  }
});

// + New SKU: minimal popup (SKU + title only, owner request 2026-08-07)
$('chmapNewSku').addEventListener('click', () => {
  $('chmapNfSku').value = $('chmapLwQ').value.trim().toUpperCase();
  $('chmapNfTitle').value = '';
  $('chmapNfNote').hidden = true;
  $('chmapNewDialog').showModal();
  $('chmapNfSku').focus();
});
$('chmapNfCancel').addEventListener('click', () => $('chmapNewDialog').close());
$('chmapNfGo').addEventListener('click', async () => {
  const sku = $('chmapNfSku').value.trim().toUpperCase();
  const title = $('chmapNfTitle').value.trim();
  const bad = validateNewSku({ sku, title, qty: 0 }, recvItems || []);
  const note = $('chmapNfNote');
  if (bad) { note.textContent = bad; note.hidden = false; note.className = 'dlg-note test-result is-fail'; return; }
  const btn = $('chmapNfGo');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  const res = chmap.local
    ? { ok: true, sku, stockItemId: `demo-${sku}` }
    : await api.createSku({ sku, title, qty: 0 });
  btn.disabled = false;
  btn.textContent = 'Create';
  if (!res.ok) { note.textContent = res.error || 'Could not create the SKU.'; note.hidden = false; note.className = 'dlg-note test-result is-fail'; return; }
  if (recvItems) {
    const it = { sku: res.sku || sku, title, stockItemId: res.stockItemId, levels: [], retailPrice: 0 };
    recvItems.unshift(it);
    if (recvBySku) recvBySku.set((res.sku || sku).toLowerCase(), it);
  }
  chmap.fresh = res.sku || sku;
  $('chmapNewDialog').close();
  toast(`${chmap.fresh} created in Linnworks — press Link to attach it`);
  renderChmap();
});

// jump from a to-do row straight to the Stock page's Unlisted view,
// filtered to that SKU (the Reminder banner left at the owner's request
// 2026-08-07 — the to-do card is the one surface on Returns)
function showUnlistedFor(sku) {
  stockUnlistedActive = true;
  stockWfsActive = false;
  stockLowActive = false;
  stockDsActive = false;
  stockActiveView = null;
  $('stockSearch').value = sku || '';
  $('stockSearchClear').hidden = !sku;
  showPage('stock');
  renderStockChips();
  renderStock();
}

// the to-do card: every created-but-unlisted condition SKU with how many
// units sit unsellable — copy grabs the exact string for Seller Center
// V1 (variants/returns-sheet-v2.html): the two cards wait behind chips on
// the log bar so the sheet starts at the top of the page; a chip click
// expands its card. Counts always render into the chips, the card bodies
// render regardless (the disputes resolve button must stay clickable for
// automation), only visibility is gated.
let retCardOpen = {
  todo: localStorage.getItem('retCardTodo') === '1',
  disp: localStorage.getItem('retCardDisp') === '1',
};
let retTodoCount = 0;
let retDispCount = 0;

function renderRetChips() {
  const box = $('retChips');
  if (!box) return;
  // the "⚠ N need listings" chip left this bar (owner 2026-09-17: "it gets
  // too crowded") — the Stock tab's Unlisted view is the one listings nag
  box.innerHTML = [
    retDispCount ? `<button type="button" class="ret-chip is-disp ${retCardOpen.disp ? 'is-on' : ''}" data-chip="disp"
      title="${retCardOpen.disp ? 'Hide' : 'Show'} the open disputes">${retDispCount} dispute${retDispCount === 1 ? '' : 's'} open</button>` : '',
  ].join('');
}

$('retChips').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-chip]');
  if (!chip) return;
  const k = chip.dataset.chip;
  retCardOpen[k] = !retCardOpen[k];
  localStorage.setItem(k === 'todo' ? 'retCardTodo' : 'retCardDisp', retCardOpen[k] ? '1' : '0');
  if (k === 'todo') renderRetTodo(); else renderRetDisputes();
  renderRetChips();
});

function renderRetTodo() {
  // the chip and its card left the Returns page (owner 2026-09-17: "it gets
  // too crowded") — the Stock tab's Unlisted view carries the listings nag;
  // callers stay wired so re-enabling is a matter of restoring this body
  const box = $('retTodo');
  if (box) box.hidden = true;
  retTodoCount = 0;
}

$('retTodo').addEventListener('click', async (e) => {
  if (e.target.closest('h4')) {
    localStorage.setItem('retTodoCol', $('retTodo').classList.contains('is-collapsed') ? '0' : '1');
    renderRetTodo();
    return;
  }
  const c = e.target.closest('[data-copy]');
  if (c) { copyFromApp(c.dataset.copy); return; }
  const ign = e.target.closest('[data-ign]');
  if (ign) {
    requireOwner(async () => {
      const res = await api.unlistedIgnore(ign.dataset.ign, false);
      if (!res.ok) { toast(res.error || 'Could not ignore.'); return; }
      toast(`${ign.dataset.ign} will never ask for listings again`);
      unlistedSkus = null;
      unlistedDetail = null;
      loadUnlisted();
    });
    return;
  }
  const g = e.target.closest('[data-goto]');
  if (g) {
    // straight to the eBay tab with this SKU's listing started (owner
    // request 2026-08-12 — was the Stock Unlisted view before)
    showPage('ebay');
    ebSelect(g.dataset.goto, false);
  }
});

// the log wears the SAME sheet as the worksheet (same columns, same
// gridlines, same order) — flat and searchable; the pencil opens the
// receive popup in edit mode (popup editing at the owner's request
// 2026-08-07, replacing the earlier inline row)
// "1,099.00" — right-aligned money without the $ (the column header says it)
function retMoneyText(v) {
  return Number(v) ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
}

// a "case: 12345" note renders as a small blue chip + the rest of the text.
// The chip is a button: click opens the marketplace's case screen directly
// (owner 2026-09-15, from the Walmart disputes URL), right-click copies.
function retNoteHtml(note, source) {
  const m = String(note || '').match(DISPUTE_RE);
  if (!m) return esc(note || '');
  const rest = String(note).replace(m[0], '').replace(/^[\s—·,:-]+|[\s—·,:-]+$/g, '');
  const ch = String(source || '').toLowerCase();
  return `<button type="button" class="ret-note-case mono ret-case-open" data-caseno="${esc(m[1])}" data-ch="${esc(ch)}"
    title="Open case ${esc(m[1])} on ${esc(channelLabel(ch))} · right-click to copy the number">case ${esc(m[1])}</button>${esc(rest)}`;
}

// open the marketplace's dispute case screen; a channel with no case URL
// template (or a failed open) falls back to copying the number
function retOpenCase(caseNo, ch) {
  const after = (res) => {
    if (res && res.ok) return;
    copyFromApp(caseNo);
    toast(`No case page set for ${channelLabel(ch)} — case ${caseNo} copied instead`, 4000);
  };
  if (!$('bDock').hidden) {
    bShowLoading(`Opening case ${caseNo}`);
    api.browserOpen(caseNo, ch, 'case').then((res) => {
      if (!res.ok) bHideLoading();
      after(res);
    });
  } else {
    api.openOrderPage(caseNo, ch, 'case').then(after);
  }
}

// every column edits IN PLACE (owner 2026-09-07, retiring the edit popup):
// data-edit names the field a click turns into an editor
function retLogRowHtml(r, i, ii, un, num) {
  const day = String(r.created_at).slice(0, 10);
  const note = i.note || r.note || '';
  return `
    <tr class="ret-past-tr${retFreshGids.has(String(r.id)) ? ' is-fresh' : ''}" data-rid="${r.id}" data-ii="${ii}" data-un="${un}">
      <td class="cell-gutter ${r.unmatched ? 'st-failed' : 'st-captured'}" title="${r.unmatched ? 'Not matched to a Linnworks order' : 'Matched processed order'}">${num}</td>
      <td class="mono ret-cell-po ret-ecell" data-edit="po" title="${esc(r.order_number)}${r.unmatched ? ' — not matched to a Linnworks order' : ''}">${r.order_number ? esc(r.order_number) : '<span class="cell-missing">—</span>'}${retPoOpenBtn(r.order_number, r.source)}</td>
      <td class="ret-cell-cust ret-ecell" data-edit="customer" title="${esc(r.customer || '')}">${r.customer ? esc(r.customer) : '<span class="cell-missing">—</span>'}</td>
      <td class="mono ret-cell-trk ret-ecell" data-edit="tracking" title="${esc(r.tracking || '')}">${r.tracking ? esc(shorten(r.tracking, 16)) : '<span class="cell-missing">—</span>'}</td>
      <td class="mono ret-cell-date ret-ecell" data-edit="day" title="Received ${esc(day)} ${fmtTime(r.created_at)}${r.received_by ? ` by ${esc(r.received_by)}` : ''}">${retDateUS(day)}</td>
      <td class="ret-cell-sku ret-ecell" data-edit="sku">${i.sku ? `<span class="mono">${esc(i.sku)}</span>` : '<span class="cell-missing">—</span>'}
        ${i.condition === 'different' && (i.received || i.targetSku)
    ? `<div class="ret-cell-target" title="${i.targetSku ? `What came back — stock landed on ${esc(i.targetSku)}` : 'What came back — not a listing, no stock moved'}">→ ${esc(i.received || i.targetSku)}${i.targetSku ? retUnlistedMark(i.targetSku) : ''}</div>`
    : (i.targetSku && i.targetSku !== i.sku ? `<div class="ret-cell-target" title="Stock landed on ${esc(i.targetSku)}">→ ${esc(i.targetSku)}${retUnlistedMark(i.targetSku)}</div>` : (i.sku && i.targetSku === i.sku ? retUnlistedMark(i.sku) : ''))}
      </td>
      <td class="ret-cell-cond ret-ecell" data-edit="condition">${i.sku ? `<span class="ret-cond-ro is-${esc(i.condition)}"><span class="ret-dd-dot is-${esc(i.condition)}"></span>${esc(retCondLabel(i.condition))}</span>` : '<span class="cell-missing">—</span>'}
      </td>
      <td class="ret-cell-units mono ret-ecell" data-edit="units">${Number(i.qty) || 1}</td>
      <td class="ret-cell-price mono ret-ecell" data-edit="price">${Number(i.price) ? retMoneyText(i.price) : '<span class="cell-missing">—</span>'}</td>
      <td class="ret-cell-by ret-ro-by ret-ecell" data-edit="receivedBy" title="Received by">${esc(r.received_by || '')}${
        r._st ? (r._actor && r._actor !== r._st
          ? `<span class="ret-by-sub is-edit" title="Last edited at ${esc(r._actor)}">✎ ${esc(r._actor)}</span>`
          : `<span class="ret-by-sub" title="Graded at ${esc(r._st)}">${esc(retSyncInfo && r._st === retSyncInfo.station ? 'this station' : r._st)}</span>`) : ''}</td>
      <td class="ret-cell-note ret-ro-note ret-ecell" data-edit="note" title="${esc(note)}">${retNoteHtml(note, r.source)}</td>
      <td class="cell-actions"><span class="ret-log-act">
        ${r.order_number ? `<button class="btn-icon ret-log-cam" data-campo="${esc(r.order_number)}" title="Upload photos for this PO — the QR opens locked to it">${ICONS.camera}</button>` : ''}
        <button class="btn-icon is-danger ret-log-del-btn" title="Delete this return">${ICONS.trash}</button>
      </span></td>
    </tr>`;
}

// amber marker on condition targets that hold returned stock but have no
// marketplace listing linked yet — the employee's "create the listing" cue
function retUnlistedMark(sku) {
  return unlistedSkus && unlistedSkus.has(String(sku || '').toUpperCase())
    ? '<span class="badge-unlisted" title="No marketplace listing is linked to this SKU yet — create the Walmart/eBay listing with EXACTLY this SKU and Linnworks links it automatically">not listed</span>'
    : '';
}

function renderRetLog() {
  if (!retLogAll) return;
  retMarkEditing(null); // a re-render closes any editor — the chip lifts
  const box = $('retPastBox');
  const q = $('retLogSearch').value.trim().toLowerCase();
  const rows = !q ? retLogAll : retLogAll.filter(({ r, i }) =>
    [r.order_number, r.customer, r.tracking, r.source, r.received_by, r.note,
     i.sku, i.targetSku, i.note, retCondLabel(i.condition)]
      .some(v => String(v || '').toLowerCase().includes(q)));
  $('retLogCount').textContent = retLogAll.length
    ? ` — ${rows.length}${q ? ` of ${retLogAll.length}` : ''} entr${rows.length === 1 ? 'y' : 'ies'}`
    : '';
  // numbered pages once the log outgrows one comfortable screen (owner
  // request 2026-08-13); search always spans the WHOLE log, then pages
  const RET_PAGE = 50;
  const pages = Math.max(1, Math.ceil(rows.length / RET_PAGE));
  if (retLogPage >= pages) retLogPage = pages - 1;
  const pageRows = rows.slice(retLogPage * RET_PAGE, (retLogPage + 1) * RET_PAGE);
  const compact = document.body.classList.contains('ret-compact');
  const noneMsg = retLogAll.length
    ? `Nothing matches “${esc(q)}”.`
    : 'No returns yet — type a PO# in the entry row above to receive the first one.';
  // the entry row survives the innerHTML swap: remember where focus was,
  // rebuild the sheet, move the SAME <tr> back in, put focus back
  const af = document.activeElement;
  const wsFocus = retEntryTr && retEntryTr.contains(af) ? af : null;
  let wsSel = null;
  try { if (wsFocus && wsFocus.selectionStart != null) wsSel = [wsFocus.selectionStart, wsFocus.selectionEnd]; } catch { /* number inputs refuse */ }
  box.innerHTML = `
    <div class="ret-sheet-scroll">
    <table class="recv-sheet-table ret-sheet ret-log-table">
      <thead>
        <tr>
          <th class="th-gutter">#</th>
          <th class="th-po">PO #</th>
          <th class="th-cust">Customer Name</th>
          <th class="th-trk">Tracking #</th>
          <th class="th-date">Date Received</th>
          <th class="th-rsku">Returned SKU</th>
          <th class="th-cond">Condition</th>
          <th class="th-units">Units</th>
          <th class="th-price">Price</th>
          <th class="th-by">Received By</th>
          <th class="th-note">Notes</th>
          <th class="th-actions"></th>
        </tr>
      </thead>
      <tbody class="ret-entry-body"></tbody>
      <tbody>${pageRows.map(({ r, i, ii, un }, idx) => retLogRowHtml(r, i, ii, un, retLogPage * RET_PAGE + idx + 1)).join('')
        || `<tr><td colspan="${compact ? 6 : 12}" class="ret-log-none">${noneMsg}</td></tr>`}</tbody>
    </table>
    </div>
    ${pages > 1 ? `<div class="ret-pager">${Array.from({ length: pages }, (_, p) =>
      `<button class="ret-page-btn ${p === retLogPage ? 'is-on' : ''}" data-retpage="${p}">${p + 1}</button>`).join('')}
      <span class="ret-pager-meta">${retLogPage * RET_PAGE + 1}–${Math.min(rows.length, (retLogPage + 1) * RET_PAGE)} of ${rows.length}</span></div>` : ''}`;
  box.querySelector('.ret-entry-body').appendChild(retEntryRow());
  retPaintPresence(); // chips survive the rebuild
  if (wsFocus) {
    wsFocus.focus();
    if (wsSel) { try { wsFocus.setSelectionRange(wsSel[0], wsSel[1]); } catch { /* number inputs refuse */ } }
  }
  applyRetCols(box.querySelector('table.ret-log-table')); // widths follow the worksheet
}

/* ---------- pending disputes (note protocol: "case: 12345") ---------- */
// Any return whose note carries a case number is an OPEN dispute; it leaves
// the card when the note also says resolved / closed / won / lost.

// STRICT protocol (owner, 2026-08-11): the note must literally say
// "Case: <number>" — colon required, anything else is just a note
const DISPUTE_RE = /(?:^|\W)case:\s*([A-Za-z0-9-]{3,})/i;
const DISPUTE_DONE_RE = /resolved|closed|won|lost/i;

function renderRetDisputes() {
  const box = $('retDisputes');
  if (!box || !retLogAll) return;
  const open = retLogAll.filter(({ r, i }) => {
    const note = String((i && i.note) || r.note || '');
    return DISPUTE_RE.test(note) && !DISPUTE_DONE_RE.test(note);
  });
  retDispCount = open.length;
  renderRetChips();
  if (!open.length) { box.hidden = true; return; }
  box.hidden = !retCardOpen.disp;
  const days = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  // same default rule as the listings card: >4 disputes starts collapsed
  const stored = localStorage.getItem('retDispCol');
  const col = stored === null ? open.length > 4 : stored === '1';
  box.classList.toggle('is-collapsed', col);
  box.innerHTML = `
    <h4 class="ret-card-h" title="Click to ${col ? 'expand' : 'collapse'}"><span class="ret-chev">${col ? '▸' : '▾'}</span>${open.length} pending dispute${open.length === 1 ? '' : 's'} to check</h4>
    ${open.map(({ r, i, ii }) => {
      const note = String((i && i.note) || r.note || '');
      const caseNo = (note.match(DISPUTE_RE) || [])[1] || '';
      const age = days(r.created_at);
      return `<div class="ret-todo-row">
        <span class="mono">${esc(r.order_number)}</span>${retPoOpenBtn(r.order_number, r.source)}
        <span class="mono ret-disp-sku">${esc((i && i.sku) || '')}</span>
        <button class="ret-todo-copy ret-case-open" data-caseno="${esc(caseNo)}" data-ch="${esc(String(r.source || '').toLowerCase())}"
          title="Open case ${esc(caseNo)} on ${esc(channelLabel(String(r.source || '').toLowerCase()))} · right-click to copy the number">case ${esc(caseNo)}</button>
        <span class="ret-todo-units ${age >= 7 ? 'ret-disp-old' : ''}">${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} open`}</span>
        ${ii >= 0 ? `<button class="ret-disp-done" data-dispdone="${r.id}|${ii}" title="Mark resolved — appends “resolved” to the note so it leaves this card (the log keeps everything)">✓ resolved</button>` : ''}
      </div>`;
    }).join('')}
    <div class="ret-todo-note">A return joins this card when its note contains <span class="mono">case: 12345</span>. Mark it ✓ when the marketplace closes the dispute.</div>`;
}

$('retDisputes').addEventListener('click', async (e) => {
  if (e.target.closest('h4')) {
    localStorage.setItem('retDispCol', $('retDisputes').classList.contains('is-collapsed') ? '0' : '1');
    renderRetDisputes();
    return;
  }
  const cs = e.target.closest('.ret-case-open');
  if (cs) { retOpenCase(cs.dataset.caseno, cs.dataset.ch); return; }
  const c = e.target.closest('[data-copy]');
  if (c) { copyFromApp(c.dataset.copy); return; }
  const open = e.target.closest('.ret-po-open');
  if (open) { retOpenPo(open.dataset.po, open.dataset.ch); return; }
  const done = e.target.closest('[data-dispdone]');
  if (!done) return;
  const cut = done.dataset.dispdone.lastIndexOf('|');
  const rid = done.dataset.dispdone.slice(0, cut);
  const ii = Number(done.dataset.dispdone.slice(cut + 1));
  const entry = (retLogAll || []).find(x => String(x.r.id) === rid && x.ii === ii);
  if (!entry) return;
  const { r, i } = entry;
  const res = await api.returnsEditUnit({
    id: r.id, itemIndex: ii,
    po: r.order_number, day: String(r.created_at).slice(0, 10),
    customer: r.customer || '', tracking: r.tracking || '',
    sku: i.sku || '', condition: i.condition || 'new',
    note: `${i.note || ''} — resolved`.trim(),
    units: String(Number(i.qty) || 1), receivedBy: r.received_by || '',
  }).catch(err => ({ ok: false, error: err.message }));
  if (!res || !res.ok) { toast((res && res.error) || 'Could not mark resolved.'); return; }
  toast(`Dispute on ${r.order_number} marked resolved`);
  loadRetPast();
});

// right-click a case chip (log note or disputes card) = copy the number
for (const host of ['retPastBox', 'retDisputes']) {
  $(host).addEventListener('contextmenu', (e) => {
    const cs = e.target.closest('.ret-case-open');
    if (!cs) return;
    e.preventDefault();
    copyFromApp(cs.dataset.caseno);
  });
}

/* shared returns folder (Google Drive / OneDrive / network share): every
   desktop pointed at the same folder shows ONE returns log. The sheet keeps
   its columns — sync shows as the station chips in the log bar, a station
   subline under Received By, and a green wash on rows arriving from other
   desktops (design signed off from the mockup, owner 2026-09-14). */
let retSyncInfo = null;   // { enabled, station, stations, folderOk, missed }
let retSyncToasted = false;
const retFreshGids = new Set(); // rows to wash on the next render

/* ---------- live presence (LAN): avatars, row chips, busy guard ----------
   Built to the owner-approved preview variants/ret-presence.html
   (2026-09-22). All styling lands via CSSOM — the CSP strips inline
   style attributes. */
let retPresence = { station: '', online: [], editing: {} };
let retEditingGid = null; // the row THIS station currently has open
let retBusyBypass = null; // gid allowed through the warning ("Edit anyway")
const RET_USER_COLORS = ['#047857', '#1F6C9F', '#7C3AED', '#9F2F2D', '#956400'];
function retUserColor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return RET_USER_COLORS[h % RET_USER_COLORS.length];
}
const retUserInitials = (name) => String(name).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';

api.on('presence:update', (snap) => {
  retPresence = snap && snap.online ? snap : { station: '', online: [], editing: {} };
  retPaintPresence();
});

function retMarkEditing(gid) {
  const g = gid ? String(gid) : null;
  if (retEditingGid === g) return;
  if (retEditingGid) api.presenceEditing(retEditingGid, false).catch(() => { /* beat catches up */ });
  retEditingGid = g;
  if (g) api.presenceEditing(g, true).catch(() => { /* beat catches up */ });
}

// paints WITHOUT re-rendering: chips land on the existing DOM. The bar's
// own Users pill already shows who's around — no second avatar cluster
// (owner 2026-09-22: "the right side is not necessary")
function retPaintPresence() {
  for (const el of document.querySelectorAll('.ret-user-chip')) el.remove();
  for (const tr of document.querySelectorAll('#retPastBox tr.ret-busy')) {
    tr.classList.remove('ret-busy');
    tr.style.removeProperty('--busy-color');
  }
  for (const [gid, who] of Object.entries(retPresence.editing || {})) {
    const tr = document.querySelector(`#retPastBox tr[data-rid="${CSS.escape(gid)}"]`);
    if (!tr) continue;
    tr.classList.add('ret-busy');
    tr.style.setProperty('--busy-color', retUserColor(who));
    const po = tr.querySelector('.ret-cell-po');
    if (po) {
      const chip = document.createElement('span');
      chip.className = 'ret-user-chip';
      chip.textContent = `${retUserInitials(who)} editing`;
      chip.title = `${who} has this return open`;
      chip.style.background = retUserColor(who);
      po.appendChild(chip);
    }
  }
}

// opening a row someone else has open: the one-line popup first
function retBusyGuard(entry, field) {
  const gid = String(entry.r.id);
  const who = (retPresence.editing || {})[gid];
  if (!who || retBusyBypass === gid) return false;
  $('retBusyTitle').textContent = `${who} is editing this return`;
  const dlg = $('retBusyDialog');
  $('retBusyEdit').onclick = () => {
    dlg.close();
    retBusyBypass = gid;
    setTimeout(() => { if (retBusyBypass === gid) retBusyBypass = null; }, 30 * 1000);
    const tr = document.querySelector(`#retPastBox tr[data-rid="${CSS.escape(gid)}"][data-ii="${entry.ii}"]`);
    const cell = tr && tr.querySelector(`[data-edit="${field}"]`);
    if (cell) retBeginEdit(cell, entry, field);
  };
  $('retBusyView').onclick = () => dlg.close();
  dlg.showModal();
  return true;
}

/* option A from variants/returns-stations.html (owner pick 2026-09-15):
   one people pill — stacked initials + "N desktops" + connection dot —
   with a click-open popover naming every desktop and when it was last
   active. The name row of chips it replaces got long fast. */
const RET_ST_IDLE_MS = 24 * 3600e3; // no file write in a day = gray avatar

function retStInitials(name) {
  const parts = String(name || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts[1] ? parts[1][0] : (parts[0][1] || ''))).toUpperCase();
}

// mtime of a station's file, spoken like a person would
function retStAgo(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 172800) return 'yesterday';
  return `${Math.round(s / 86400)}d ago`;
}

// every desktop wears its own color, identical on every machine: the name
// hashes to a palette slot (.ret-av.c0…c4 in styles.css). This desktop
// stays the solid emerald; a quiet-for-a-day desktop just dims.
function retStColor(name) {
  let h = 0;
  for (const ch of String(name)) h = ((h * 31) + ch.charCodeAt(0)) >>> 0;
  return `c${h % 5}`;
}

function retAvClass(st) {
  if (st.name === retSyncInfo.station) return 'is-you';
  return retStColor(st.name) + (Date.now() - (st.lastTs || 0) > RET_ST_IDLE_MS ? ' is-idle' : '');
}

function renderRetSyncLine() {
  const el = $('retSyncLine');
  if (!el) return;
  if (!retSyncInfo || !retSyncInfo.enabled) { el.hidden = true; retSyncPopClose(); return; }
  el.hidden = false;
  const sts = retSyncInfo.stations || [];
  el.innerHTML = `<button id="retSyncPill" type="button" class="ret-sync-pill" title="${retSyncInfo.folderOk
    ? 'Shared returns folder connected — click for the desktops'
    : 'Shared returns folder unreachable — check the path in Settings'}">
    <span class="ret-avstack">${sts.slice(0, 4).map(st => `<span class="ret-av ${retAvClass(st)}">${esc(retStInitials(st.name))}</span>`).join('')}</span>
    <b>Users</b>
    <span class="ret-sync-dot${retSyncInfo.folderOk ? '' : ' is-bad'}"></span></button>`;
  retSyncPopRefresh(); // an open popover follows fresh data
}

let retSyncPop = null;

function retSyncPopClose() {
  if (retSyncPop) { retSyncPop.remove(); retSyncPop = null; }
}

// quiet rows (owner 2026-09-15): a green dot marks the live desktop instead
// of an "active now" label, and every other desktop can be removed with the
// ✕ that shows on hover — first click arms it, the second deletes that
// station's file from the shared folder (its returns come back if that
// computer ever syncs again under the same name)
function retSyncPopHtml() {
  // this desktop speaks only through its solid emerald avatar — no YOU tag,
  // no dot (owner 2026-09-15: the highlight already says it)
  const rows = (retSyncInfo.stations || []).map(st => {
    const you = st.name === retSyncInfo.station;
    return `<div class="ret-pop-row"${you ? ' title="This desktop"' : ''}>
      <span class="ret-av ${retAvClass(st)}">${esc(retStInitials(st.name))}</span>
      <span class="ret-pop-name"><b>${esc(st.name)}</b></span>
      ${you ? '' : `
        <span class="ret-pop-when">${retStAgo(st.lastTs) || '—'}</span>
        <button type="button" class="ret-pop-x" data-strm="${esc(st.name)}"
          title="Remove ${esc(st.name)} from the shared log — its returns leave every desktop, and come back if that computer syncs again">✕</button>`}
    </div>`;
  }).join('');
  const foot = retSyncInfo.folderOk
    ? '<div class="ret-pop-foot"><span class="ret-sync-dot"></span>Shared folder connected</div>'
    : '<div class="ret-pop-foot is-bad"><span class="ret-sync-dot is-bad"></span>Shared folder unreachable — check the path in Settings</div>';
  return rows + foot;
}

function retSyncPopRefresh() {
  if (!retSyncPop) return;
  if (!retSyncInfo || !retSyncInfo.enabled) { retSyncPopClose(); return; }
  retSyncPop.innerHTML = retSyncPopHtml();
}

$('retSyncLine').addEventListener('click', (e) => {
  if (!e.target.closest('#retSyncPill')) return;
  if (retSyncPop) { retSyncPopClose(); return; }
  const pill = $('retSyncPill');
  retSyncPop = document.createElement('div');
  retSyncPop.className = 'ret-sync-pop';
  retSyncPop.innerHTML = retSyncPopHtml();
  // ✕ = two-step: first click arms ("remove?"), the second deletes the
  // station's file from the shared folder and the log refreshes
  retSyncPop.addEventListener('click', async (ev) => {
    const x = ev.target.closest('.ret-pop-x');
    if (!x) return;
    if (!x.classList.contains('is-armed')) {
      x.classList.add('is-armed');
      x.textContent = 'remove?';
      return;
    }
    const name = x.dataset.strm;
    const res = await api.returnsSyncRemoveStation(name).catch(err => ({ ok: false, error: err.message }));
    if (!res || !res.ok) { toast((res && res.error) || `Could not remove ${name}.`); return; }
    toast(`${name} removed from the shared log`);
    loadRetPast(); // fresh fold: the chip, the popover and the sheet all follow
  });
  document.body.appendChild(retSyncPop);
  const r = pill.getBoundingClientRect();
  const w = retSyncPop.offsetWidth || 300; // right-aligned to the pill, kept on screen
  retSyncPop.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  retSyncPop.style.top = `${r.bottom + 8}px`;
  const away = (ev) => {
    if (ev.target.closest('.ret-sync-pop') || ev.target.closest('#retSyncPill')) return;
    document.removeEventListener('mousedown', away, true);
    retSyncPopClose();
  };
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') retSyncPopClose();
});

// a peer's file synced in: refresh, wash the moved rows, say who did what
api.on('returns:syncChanged', (d) => {
  const changes = (d && d.changes) || [];
  if (!changes.length) return;
  for (const c of changes) retFreshGids.add(String(c.gid));
  if (activePage !== 'returns') return; // the next page open reloads anyway
  loadRetPast();
  const news = changes.filter(c => c.op === 'put' && c.kind === 'new').length;
  const edits = changes.length - news;
  const who = [...new Set(changes.map(c => c.actor))].join(', ');
  toast(`${who}: ${[news ? `${news} new return${news === 1 ? '' : 's'}` : '', edits ? `${edits} change${edits === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}`, 3500);
});

async function loadRetPast() {
  // shared-folder sync on: { rows, sync }; off: the legacy bare array
  const res = await api.returnsList();
  const returns = Array.isArray(res) ? res : (res && res.rows) || [];
  retSyncInfo = Array.isArray(res) ? null : (res && res.sync) || null;
  renderRetSyncLine();
  if (retSyncInfo && retSyncInfo.missed > 0 && !retSyncToasted) {
    retSyncToasted = true;
    toast(`Caught up from the shared folder — ${retSyncInfo.missed} change${retSyncInfo.missed === 1 ? '' : 's'} from other stations while this one was closed`, 5000);
  }
  retLogAll = [];
  for (const r of returns) {
    // a PO-only return has no item lines but still shows as one row (ii -1)
    if (!r.items.length) {
      retLogAll.push({ r, i: { sku: '', condition: '', targetSku: '', qty: 1, note: '' }, ii: -1, un: 0 });
      continue;
    }
    // one row per ITEM LINE — the Units column carries the quantity,
    // mirroring the worksheet exactly
    r.items.forEach((i, ii) => retLogAll.push({ r, i, ii, un: 0 }));
  }
  renderRetLog();
  renderRetDisputes();
  retFreshGids.clear(); // washed once; later re-renders stay calm
}

let retLogPage = 0;
$('retLogSearch').addEventListener('input', () => { retLogPage = 0; renderRetLog(); });
$('retPastBox').addEventListener('click', (e) => {
  const pg = e.target.closest('[data-retpage]');
  if (pg) { retLogPage = Number(pg.dataset.retpage); renderRetLog(); }
});

let retDelCtx = null; // { rid, ii, target } — pending delete confirmation

$('retPastBox').addEventListener('click', (e) => {
  const open = e.target.closest('.ret-po-open');
  if (open) { retOpenPo(open.dataset.po, open.dataset.ch); return; }
  const cs = e.target.closest('.ret-case-open');
  if (cs) { retOpenCase(cs.dataset.caseno, cs.dataset.ch); return; }
  const cam = e.target.closest('.ret-log-cam');
  if (cam) { openClaimsPop(cam.dataset.campo); return; }
  const tr = e.target.closest('tr[data-rid]');
  if (!tr) return;
  if (e.target.closest('.ret-log-del-btn')) {
    const entry = (retLogAll || []).find(x => String(x.r.id) === tr.dataset.rid && x.ii === Number(tr.dataset.ii));
    if (!entry) return;
    const qty = Number(entry.i.qty) || 1;
    retDelCtx = { rid: entry.r.id, ii: entry.ii, target: entry.i.targetSku || '' };
    $('retDelLine').textContent = [entry.r.order_number, entry.i.sku, entry.i.sku ? retCondLabel(entry.i.condition) : '', qty > 1 ? `×${qty}` : '']
      .filter(Boolean).join(' · ');
    $('retDelStockWrap').hidden = !retDelCtx.target;
    $('retDelStock').checked = !!retDelCtx.target;
    $('retDelTarget').textContent = retDelCtx.target ? `−${qty} ${retDelCtx.target}` : '';
    $('retDelDialog').showModal();
    return;
  }
  // click a cell -> edit it in place (owner 2026-09-07, the popup pencil
  // retired: "each column would be editable")
  const td = e.target.closest('td[data-edit]');
  if (td && !e.target.closest('button') && !td.querySelector('.ret-ein, .ret-emenu')) {
    const entry = (retLogAll || []).find(x => String(x.r.id) === tr.dataset.rid && x.ii === Number(tr.dataset.ii));
    if (entry) retBeginEdit(td, entry);
  }
});

/* ---------- in-place log editing ---------- */
// One editor at a time. Enter/blur saves through the SAME qty-aware
// corrections engine the popup used (returns:editUnit re-resolves the
// condition target and fixes stock); Esc cancels. The row re-renders from
// the server's truth after every save.

let retEditApi = (p) => api.returnsEditUnit(p); // seam: e2e stubs the save

// the full field set editUnit wants, taken from the row, with the edited
// value swapped in by the caller
function retEditPayload({ r, i, ii }) {
  return {
    id: r.id, itemIndex: ii,
    po: r.order_number || '', day: String(r.created_at).slice(0, 10),
    customer: r.customer || '', tracking: r.tracking || '',
    sku: i.sku || '', condition: i.condition || 'new',
    note: ii >= 0 ? (i.note || '') : (r.note || ''),
    units: String(Number(i.qty) || 1), receivedBy: r.received_by || '',
    price: Number(i.price) || 0, settle: Number(i.settle) || 0,
  };
}

async function retSaveEdit(entry, field, value) {
  const payload = retEditPayload(entry);
  if (field === 'day') {
    // the cell shows MM/DD/YYYY; editUnit wants YYYY-MM-DD
    const m = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) { toast('Date must look like 09/05/2026.'); renderRetLog(); return; }
    payload.day = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  } else if (field === 'price') {
    payload[field] = retMoney(value);
  } else if (field === 'units') {
    payload.units = String(value).trim();
  } else if (field === 'sku') {
    payload.sku = String(value).trim().toUpperCase();
  } else {
    payload[field] = String(value).trim();
  }
  const res = await retEditApi(payload).catch(e => ({ ok: false, error: e.message }));
  if (!res || !res.ok) {
    toast((res && res.error) || 'Could not save.');
    renderRetLog(); // the cell falls back to what the log really holds
    return;
  }
  toast(res.stockNote ? `Saved — ${res.stockNote}` : 'Saved', 2500);
  loadRetPast();
}

// the current cell text an editor starts from
function retEditValue({ r, i, ii }, field) {
  switch (field) {
    case 'po': return r.order_number || '';
    case 'customer': return r.customer || '';
    case 'tracking': return r.tracking || '';
    case 'day': return retDateUS(r.created_at);
    case 'sku': return i.sku || '';
    case 'units': return String(Number(i.qty) || 1);
    case 'price': return Number(i.price) ? Number(i.price).toFixed(2) : '';
    case 'receivedBy': return r.received_by || '';
    case 'note': return ii >= 0 ? (i.note || '') : (r.note || '');
    default: return '';
  }
}

function retBeginEdit(td, entry, field = td.dataset.edit) {
  if (retBusyGuard(entry, field)) return; // someone else is in this row
  // only one editor open: any other cell mid-edit falls back to display
  const other = $('retPastBox').querySelector('.ret-ein, .ret-emenu');
  if (other) renderRetLog();
  for (const stray of document.querySelectorAll('.ret-notebox, .ret-emenu-pop')) stray.remove();
  retMarkEditing(entry.r.id); // the chip on every other desktop
  if (field === 'condition') { retBeginCondEdit(td, entry); return; }
  if (field === 'note') { retBeginNoteEdit(td, entry); return; }
  const startVal = retEditValue(entry, field);
  const mono = ['po', 'tracking', 'day', 'sku', 'units', 'price', 'receivedBy'].includes(field);
  const isSku = field === 'sku';
  td.innerHTML = `<input class="ret-ein${mono ? ' mono' : ''}" type="text" autocomplete="off" spellcheck="false" />${isSku ? '<div class="combo-list" hidden></div>' : ''}`;
  const input = td.querySelector('input');
  input.value = startVal;
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const val = input.value;
    if (save && val.trim() !== startVal.trim()) retSaveEdit(entry, field, val);
    else renderRetLog();
  };
  // the SKU cell queries the inventory like every other picker — a PO
  // that arrived without its product still gets a searched, real SKU
  // (owner 2026-09-18). The combo's Enter picks; the fallback below
  // saves typed text when the lookup has nothing (offline, new SKU).
  if (isSku) {
    ensureInventory();
    // SKU only, no title line in the list (owner 2026-09-18) — titles
    // still match while typing, they just don't render
    makeCombo(input, td.querySelector('.combo-list'), (item) => { input.value = item.sku; finish(true); }, { noTitle: true });
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => { if (isSku) setTimeout(() => finish(true), 150); else finish(true); });
}

// the note edits in a floating box over the cell — the column is too
// narrow to read what you type (owner 2026-09-18). Enter saves,
// Shift+Enter makes a new line, Esc cancels.
function retBeginNoteEdit(td, entry) {
  const startVal = retEditValue(entry, 'note');
  const r = td.getBoundingClientRect();
  td.innerHTML = '<input class="ret-ein" type="text" hidden />'; // keeps the cell's edit ring on
  const box = document.createElement('div');
  box.className = 'ret-notebox';
  box.innerHTML = '<textarea class="ret-notein" rows="3" spellcheck="false"></textarea><div class="ret-notehint">Enter saves · Esc cancels</div>';
  document.body.appendChild(box);
  const w = Math.max(340, Math.min(r.width + 60, 480));
  box.style.width = `${w}px`;
  box.style.left = `${Math.max(8, Math.min(r.left - 6, window.innerWidth - w - 8))}px`;
  box.style.top = `${Math.max(8, Math.min(r.top - 8, window.innerHeight - 132))}px`;
  const input = box.querySelector('textarea');
  input.value = startVal;
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    box.remove();
    const val = input.value;
    if (save && val.trim() !== startVal.trim()) retSaveEdit(entry, 'note', val);
    else renderRetLog();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

// the condition cell edits through a small menu of the four pills
function retBeginCondEdit(td, entry) {
  if (!entry.i.sku) return; // a PO-only row has no line to grade
  // the menu FLOATS over the table (owner-picked pop-over, 2026-09-21) —
  // packed into the cell it stretched the whole row open
  const r = td.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'ret-emenu ret-emenu-pop';
  menu.innerHTML = RET_CONDS.map(c => `
    <button type="button" class="ret-emi ${entry.i.condition === c.key ? 'is-sel' : ''}" data-cond="${c.key}">
      <span class="ret-dd-dot is-${c.key}"></span>${c.label}</button>`).join('');
  document.body.appendChild(menu);
  const place = () => {
    const rr = td.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rr.left - 4, window.innerWidth - menu.offsetWidth - 8))}px`;
    const below = rr.bottom + 4;
    menu.style.top = `${below + menu.offsetHeight + 8 > window.innerHeight ? Math.max(8, rr.top - menu.offsetHeight - 4) : below}px`;
  };
  place();
  td.classList.add('is-econd'); // the cell keeps its edit ring while the menu floats
  // the menu follows its cell while anything scrolls (same drift the SKU
  // combo had, owner 2026-09-21)
  const follow = () => { if (document.contains(td)) place(); else cleanup(); };
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);
  const cleanup = () => {
    menu.remove();
    td.classList.remove('is-econd');
    document.removeEventListener('mousedown', away, true);
    window.removeEventListener('scroll', follow, true);
    window.removeEventListener('resize', follow);
  };
  const away = (e) => {
    if (e.target.closest('.ret-emenu-pop')) return;
    cleanup();
    renderRetLog();
  };
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cond]');
    if (!b) return;
    cleanup();
    if (b.dataset.cond === entry.i.condition) { renderRetLog(); return; }
    retCondEdit(entry, b.dataset.cond);
  });
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
}

// a graded condition first checks a landing exists; a missing one opens
// the create-or-pick dialog instead of bouncing off the server error
// (owner 2026-09-09: "if there isn't one, allow me to create it on this page")
async function retCondEdit(entry, cond) {
  if (cond === 'new') { retSaveEdit(entry, 'condition', cond); return; }
  // Different return: the server decides log-only vs restock from whether
  // the SKU is a real listing — no mapping to check here
  if (cond === 'different') { retSaveEdit(entry, 'condition', cond); return; }
  const tr = await api.returnsTargets(entry.i.sku).catch(() => null);
  // lookup unavailable: let the save try anyway, the server re-resolves
  if (!tr || !tr.ok) { retSaveEdit(entry, 'condition', cond); return; }
  if ((tr.targets || {})[cond]) { retSaveEdit(entry, 'condition', cond); return; }
  renderRetLog(); // the cell falls back to display while the dialog takes over
  openRetCondFix(entry, cond);
}

/* ---------- "no listing for this condition" dialog (log edits) ---------- */
let retCondCtx = null; // { entry, cond } while the dialog is open

function openRetCondFix(entry, cond) {
  retCondCtx = { entry, cond };
  const suggested = retSuggestCondSku(entry.i.sku, cond);
  const btn = $('retCondCreate');
  const canCreate = !!RET_PREFIX[cond] && !(recvLookup === 'ready' && recvLookupExact(suggested));
  btn.hidden = !canCreate;
  btn.innerHTML = `＋ Create <span class="mono">${esc(suggested)}</span>`;
  btn.dataset.sku = suggested;
  $('retCondPick').value = '';
  ensureInventory(); // the pick combo searches the live list
  $('retCondDialog').showModal();
}

$('retCondCreate').addEventListener('click', () => {
  if (!retCondCtx) return;
  const { entry, cond } = retCondCtx;
  $('retCondDialog').close();
  // the New SKU sheet opens prefilled; creating maps the condition and
  // the pending edit saves itself on top
  openCondSkuCreate(entry.i.sku, cond, $('retCondCreate').dataset.sku, () => {
    retSaveEdit(entry, 'condition', cond);
  });
});

makeCombo($('retCondPick'), document.querySelector('.retcond-combo .combo-list'), async (item) => {
  if (!retCondCtx) return;
  const { entry, cond } = retCondCtx;
  $('retCondDialog').close();
  const map = await api.returnsMapSet(entry.i.sku, cond, item.sku);
  if (!map.ok) { toast(map.error || 'Could not save the mapping.'); return; }
  toast(`${entry.i.sku} ${cond} → ${map.targetSku}`);
  retSaveEdit(entry, 'condition', cond);
});

$('retCondCancel').addEventListener('click', () => $('retCondDialog').close());
$('retCondDialog').addEventListener('close', () => { retCondCtx = null; });

$('retDelCancel').addEventListener('click', () => $('retDelDialog').close());
$('retDelConfirm').addEventListener('click', async () => {
  if (!retDelCtx) return;
  const res = await api.returnsDeleteUnit({
    id: retDelCtx.rid, itemIndex: retDelCtx.ii,
    removeStock: !!retDelCtx.target && $('retDelStock').checked,
  });
  $('retDelDialog').close();
  if (!res.ok) { toast(res.error || 'Could not delete.'); return; }
  toast(res.stockNote ? `Return deleted — ${res.stockNote}` : 'Return deleted');
  retDelCtx = null;
  loadRetPast();
});

/* ---------- condition-mapping editor ---------- */

let mapRows = null; // [{ baseSku, conds: { openbox|used|scrap: { sku, source } } }]
const MAP_CONDS = [['openbox', 'Open box'], ['used', 'Used'], ['scrap', 'Scrap']];

async function openMappings() {
  $('mapSearch').value = '';
  $('mapCount').textContent = '';
  $('mapList').innerHTML = '<div class="stock-loading"><span class="spinner" aria-label="Loading"></span></div>';
  $('mapDialog').showModal();
  ensureInventory(); // the cell editors need the picker data
  const res = await api.returnsMappings();
  if (!$('mapDialog').open) return;
  if (!res.ok) {
    $('mapList').innerHTML = `<p class="dlg-note test-result is-fail">${esc(res.error || 'Could not load mappings.')}</p>`;
    return;
  }
  mapRows = res.mappings || [];
  renderMapList();
}

function mapCellHtml(row, cond) {
  const c = row.conds[cond];
  if (!c) {
    return `<button class="map-set" data-base="${esc(row.baseSku)}" data-cond="${cond}"
      title="Pick the ${cond} listing for ${esc(row.baseSku)}">set…</button>`;
  }
  return `
    <button class="map-val" data-base="${esc(row.baseSku)}" data-cond="${cond}" title="Click to change">
      <span class="mono">${esc(c.sku)}</span><span class="map-tag is-${c.source}">${c.source}</span>
    </button>
    ${c.source === 'manual' ? `<button class="map-del btn-icon is-danger" data-base="${esc(row.baseSku)}" data-cond="${cond}"
      title="Remove the manual pick (falls back to auto)">✕</button>` : ''}`;
}

function renderMapList() {
  if (!mapRows) return;
  const q = $('mapSearch').value.trim().toLowerCase();
  const rows = mapRows.filter(r => !q
    || r.baseSku.toLowerCase().includes(q)
    || Object.values(r.conds).some(c => c && c.sku.toLowerCase().includes(q)));
  const shown = rows.slice(0, 200);
  $('mapCount').textContent = `${rows.length} SKU${rows.length === 1 ? '' : 's'} mapped${rows.length > shown.length ? ` · showing ${shown.length}` : ''}`;
  $('mapList').innerHTML = rows.length === 0
    ? `<p class="dlg-note">${q ? 'No mapping matches that filter.' : 'No mappings yet. They appear here from the -OPENBOX / -USED / -SCRAP listing names, or the first time a return needs a pick.'}</p>`
    : `<table class="map-table">
        <thead><tr>
          <th class="th-gutter">#</th>
          <th>Sold SKU</th>
          ${MAP_CONDS.map(([, label]) => `<th>${label}</th>`).join('')}
        </tr></thead>
        <tbody>${shown.map((r, idx) => `
          <tr>
            <td class="cell-gutter">${idx + 1}</td>
            <td class="mono map-base" title="${esc(r.baseSku)}">${esc(r.baseSku)}</td>
            ${MAP_CONDS.map(([cond]) => `<td class="map-cell" data-cellbase="${esc(r.baseSku)}" data-cellcond="${cond}">${mapCellHtml(r, cond)}</td>`).join('')}
          </tr>`).join('')}</tbody>
      </table>`;
}

// click a cell -> inline combobox editor; pick persists a manual override.
// Mappings only ever point at EXISTING inventory SKUs.
function beginMapEdit(td, base, cond) {
  td.innerHTML = `
    <div class="combo map-combo">
      <input class="input mono map-edit-input" type="text" placeholder="SKU, title or barcode…"
             autocomplete="off" spellcheck="false" />
      <div class="combo-list map-edit-list" hidden></div>
    </div>`;
  const input = td.querySelector('.map-edit-input');
  const list = td.querySelector('.map-edit-list');
  let done = false;
  const saveMapping = async (targetSku) => {
    const res = await api.returnsMapSet(base, cond, targetSku);
    if (!res.ok) {
      toast(res.error || 'Could not save the mapping.');
      renderMapList();
      return;
    }
    const row = mapRows.find(r => r.baseSku === base) || (mapRows.push({ baseSku: base, conds: {} }), mapRows[mapRows.length - 1]);
    row.conds[cond] = { sku: res.targetSku, source: 'manual' };
    renderMapList();
    toast(`${base} ${cond} → ${res.targetSku}`);
  };
  makeCombo(input, list, (item) => {
    if (done) return;
    done = true;
    saveMapping(item.sku);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { done = true; renderMapList(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (!done) { done = true; renderMapList(); } }, 200));
  input.focus();
}

$('mapList').addEventListener('click', async (e) => {
  const del = e.target.closest('.map-del');
  if (del) {
    const res = await api.returnsMapDelete(del.dataset.base, del.dataset.cond);
    if (!res.ok) { toast(res.error || 'Could not remove the mapping.'); return; }
    const row = mapRows.find(r => r.baseSku === del.dataset.base);
    if (row) {
      if (res.fallback) row.conds[del.dataset.cond] = { sku: res.fallback, source: 'auto' };
      else delete row.conds[del.dataset.cond];
      if (!Object.keys(row.conds).length) mapRows = mapRows.filter(r => r !== row);
    }
    renderMapList();
    toast(res.fallback ? `Back to auto: ${res.fallback}` : 'Manual pick removed');
    return;
  }
  const cellBtn = e.target.closest('.map-val, .map-set');
  if (cellBtn) {
    const td = cellBtn.closest('td.map-cell');
    if (td) beginMapEdit(td, cellBtn.dataset.base, cellBtn.dataset.cond);
  }
});

$('mapSearch').addEventListener('input', renderMapList);
$('mapClose').addEventListener('click', () => $('mapDialog').close());
$('mapDialog').addEventListener('close', () => focusScan());
// (the toolbar Mappings button is gone — mapping edits live in the
// condition dropdown, per SKU; openMappings stays for potential reuse)

/* ---------- Returns sheets resize (mirrors the Stock page grips) ---------- */

// whole-page width: ONE handle drives the worksheet AND the past-returns
// sheet (they share #retMain), persisted like the Stock sheet's width
let retSheetDrag = null;

$('retGrip').addEventListener('mousedown', (e) => {
  e.preventDefault();
  retSheetDrag = { startX: e.clientX, startW: $('retMain').offsetWidth, w: 0 };
  $('retGrip').classList.add('is-active');
});

window.addEventListener('mousemove', (e) => {
  if (!retSheetDrag) return;
  // the sheet is centered, so its right edge moves half as fast as its width:
  // double the mouse delta to keep the grip under the cursor
  const w = Math.max(560, retSheetDrag.startW + 2 * (e.clientX - retSheetDrag.startX));
  retSheetDrag.w = w;
  $('retMain').style.width = `${w}px`;
});

window.addEventListener('mouseup', () => {
  if (!retSheetDrag) return;
  if (retSheetDrag.w) saveSheetFrac($('retMain'), 'retSheetWidth', retSheetDrag.w);
  retSheetDrag = null;
  $('retGrip').classList.remove('is-active');
});

$('retGrip').addEventListener('dblclick', () => {
  localStorage.removeItem('retSheetWidth');
  $('retMain').style.width = '';
});

// per-column grips, shared by BOTH returns sheets: one stored width per
// column key keeps the worksheet and the past sheet pixel-identical
let retColWidths = {};
try { retColWidths = JSON.parse(localStorage.getItem('retColWidths') || '{}'); } catch { /* fresh start */ }

const RET_COL_KEYS = { 1: 'po', 2: 'cust', 3: 'trk', 4: 'date', 5: 'rsku', 6: 'cond', 7: 'units', 8: 'price', 9: 'by', 10: 'note' };

function applyRetCols(table) {
  if (!table) return;
  table.querySelectorAll('thead th').forEach((th, i) => {
    const key = RET_COL_KEYS[i];
    if (!key) return;
    if (!th.querySelector('.col-grip')) {
      th.insertAdjacentHTML('beforeend', `<span class="col-grip" data-grip="${key}"></span>`);
      th.title = 'Drag the edge to resize · double-click the edge to reset';
    }
    const w = retColWidths[key];
    th.style.width = w ? `${w}px` : '';
    th.style.minWidth = w ? `${w}px` : '';
    th.style.maxWidth = w ? `${w}px` : '';
  });
}

function applyRetColsAll() {
  // one sheet left (the log) — widths land on it after every render
  applyRetCols($('retPastBox').querySelector('table.ret-log-table'));
}

$('returnsPage').addEventListener('mousedown', (e) => {
  const grip = e.target.closest('.col-grip');
  if (!grip) return;
  e.preventDefault();
  const th = grip.closest('th');
  gripDrag = { key: grip.dataset.grip, startX: e.clientX, startW: th.offsetWidth, th, w: 0, storeName: 'ret' };
});

$('returnsPage').addEventListener('dblclick', (e) => {
  const grip = e.target.closest('.col-grip');
  if (!grip) return;
  delete retColWidths[grip.dataset.grip];
  localStorage.setItem('retColWidths', JSON.stringify(retColWidths));
  applyRetColsAll();
});

/* ---------- 30-day sales per stock item (Stock page chart dialog) ---------- */

// fixed channel order, entity-locked colors (validated for CVD safety);
// unknown sources fold into Other, never a new hue
const SALES_CHANNELS = [
  { key: 'walmart', label: 'Walmart', color: '#4A90D9' },
  { key: 'ebay', label: 'eBay', color: '#059669' },
  { key: 'temu', label: 'Temu', color: '#D97706' },
  { key: 'other', label: 'Other', color: '#8A8782' },
];

const SALES_RANGES = [7, 14, 30, 60, 90];

let salesDlg = null; // { sku, avail, range, seq, days, channels, on, table }

async function openSalesDialog(sku, avail) {
  salesDlg = { sku, avail, range: 30, seq: 0, days: null, channels: [], on: {}, table: false };
  $('salesSku').textContent = sku;
  $('salesDialog').showModal();
  loadSalesRange();
}

async function loadSalesRange() {
  const { sku, range } = salesDlg;
  const seq = ++salesDlg.seq; // a range/SKU switched mid-flight discards this load
  $('salesSub').textContent = '';
  $('salesBody').innerHTML = '<div class="stock-loading"><span class="spinner" aria-label="Loading"></span></div>';
  const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const res = await api.salesQuery(day(new Date(Date.now() - (range - 1) * 86400000)), day(new Date()));
  if (!salesDlg || salesDlg.seq !== seq || !$('salesDialog').open) return;
  if (!res.ok) {
    $('salesBody').innerHTML = `<p class="dlg-note">${esc(res.error || 'Could not load sales.')}</p>`;
    return;
  }
  // one bucket per local day, oldest → newest, zero-filled
  const days = [];
  const byKey = new Map();
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const bucket = {
      key: day(d),
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      walmart: 0, ebay: 0, temu: 0, other: 0,
    };
    days.push(bucket);
    byKey.set(bucket.key, bucket);
  }
  for (const l of res.lines || []) {
    if (l.sku !== sku) continue;
    const bucket = byKey.get(salesDayKey(l.processedOn));
    if (!bucket) continue;
    const ch = String(l.source || '').trim().toLowerCase();
    bucket[bucket[ch] !== undefined ? ch : 'other'] += Number(l.qty) || 0;
  }
  const channels = SALES_CHANNELS.filter(c => days.some(d => d[c.key] > 0));
  $('salesSub').textContent =
    `Linnworks processed orders · ${days[0].label} – ${days[days.length - 1].label}`;
  salesDlg.days = days;
  salesDlg.channels = channels;
  salesDlg.on = Object.fromEntries(channels.map(c => [c.key, true]));
  renderSalesDialog();
}

function salesTotals() {
  const { days, channels, on } = salesDlg;
  const dayTotal = (d) => channels.reduce((x, c) => x + (on[c.key] ? d[c.key] : 0), 0);
  const total = days.reduce((a, d) => a + dayTotal(d), 0);
  const last7 = days.slice(-7).reduce((a, d) => a + dayTotal(d), 0);
  return { dayTotal, total, avgRange: total / days.length, avg7: last7 / Math.min(7, days.length) };
}

function renderSalesDialog() {
  const { days, channels, on, avail, table, range } = salesDlg;
  const { dayTotal, total, avgRange, avg7 } = salesTotals();
  const rate = avg7 || avgRange;
  const max = Math.max(1, ...days.map(dayTotal));
  const step = max <= 6 ? 2 : max <= 12 ? 4 : Math.ceil(max / 4 / 5) * 5;
  const labelEvery = Math.max(1, Math.ceil(days.length / 7));
  // the CSP (style-src 'self') strips inline style attributes from innerHTML,
  // so geometry and channel colors travel as data-* and land via the CSSOM
  let grid = '';
  for (let v = step; v <= max; v += step) {
    grid += `<div class="sales-gridline" data-b="${(v / max) * 100}"><span>${v}</span></div>`;
  }
  const cols = days.map((d, i) => {
    const segs = channels.filter(c => on[c.key] && d[c.key] > 0);
    const topKey = segs.length ? segs[segs.length - 1].key : '';
    return `<div class="sales-col" data-i="${i}">` + segs.map(c =>
      `<div class="sales-seg ${c.key === topKey ? 'is-top' : ''}" data-h="${(d[c.key] / max) * 100}" data-gap="${segs.length > 1 ? 2 : 0}" data-c="${c.color}"></div>`).join('')
      + '</div>';
  }).join('');
  const xaxis = days.map((d, i) => `<span class="sales-xt">${i % labelEvery === 0 || i === days.length - 1 ? esc(d.label) : ''}</span>`).join('');
  const legend = channels.length ? channels.map(c =>
    `<span class="sales-lg ${on[c.key] ? '' : 'is-off'}" data-ch="${c.key}"><span class="sales-sw" data-c="${c.color}"></span>${c.label}</span>`).join('') : '';
  const ranges = SALES_RANGES.map(r =>
    `<button class="sales-range ${r === range ? 'is-active' : ''}" data-range="${r}">${r}d</button>`).join('');
  const tableHtml = `
    <div class="sales-tbl">
      <table>
        <thead><tr><th>Date</th>${channels.map(c => `<th class="num">${c.label}</th>`).join('')}<th class="num">Total</th></tr></thead>
        <tbody>${days.slice().reverse().map(d =>
          `<tr><td>${esc(d.label)}</td>${channels.map(c => `<td class="num mono">${d[c.key]}</td>`).join('')}<td class="num mono"><strong>${channels.reduce((x, c) => x + d[c.key], 0)}</strong></td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  $('salesBody').innerHTML = `
    ${channels.length === 0 ? `<p class="dlg-note">No sales for this SKU in the last ${range} days.</p>` : `
    <div class="sales-strip">
      <div class="sales-stat"><div class="v mono">${total}</div><div class="l">Units sold</div><div class="s">last ${range} days</div></div>
      <div class="sales-stat"><div class="v mono">${avgRange.toFixed(1)}</div><div class="l">Per day</div><div class="s">${range}-day average</div></div>
      <div class="sales-stat"><div class="v mono">${avg7.toFixed(1)}</div><div class="l">Per day</div><div class="s">last 7 days</div></div>
      <div class="sales-stat"><div class="v mono">${rate > 0 ? Math.round(avail / rate) : '—'}</div><div class="l">Days of cover</div><div class="s">${avail} available now</div></div>
    </div>`}
    <div class="sales-bar">
      <div class="sales-legend">${legend}</div>
      <div class="sales-ranges">${ranges}</div>
      ${channels.length ? `<button class="sales-tgl" id="salesTgl">${table ? 'Chart' : 'Table'}</button>` : ''}
    </div>
    ${channels.length === 0 ? '' : table ? tableHtml : `
    <div class="sales-plotwrap" id="salesPlotWrap">
      <div class="sales-plot ${days.length > 45 ? 'is-dense' : ''}" id="salesPlot">${grid}${cols}</div>
      <div class="sales-xaxis">${xaxis}</div>
      <div class="sales-tip" id="salesTip"></div>
    </div>`}`;
  applySalesStyles($('salesBody'));
}

// CSP-safe styling: inline style attributes are stripped by style-src 'self',
// CSSOM assignments are not
function applySalesStyles(root) {
  root.querySelectorAll('[data-b]').forEach(el => { el.style.bottom = `${el.dataset.b}%`; });
  root.querySelectorAll('[data-h]').forEach(el => { el.style.height = `calc(${el.dataset.h}% - ${el.dataset.gap || 0}px)`; });
  root.querySelectorAll('[data-c]').forEach(el => { el.style.background = el.dataset.c; });
}

$('salesBody').addEventListener('click', (e) => {
  if (!salesDlg) return;
  const rangeBtn = e.target.closest('.sales-range');
  if (rangeBtn) {
    const r = Number(rangeBtn.dataset.range);
    if (r && r !== salesDlg.range) { salesDlg.range = r; loadSalesRange(); }
    return;
  }
  const lg = e.target.closest('.sales-lg');
  if (lg) {
    const k = lg.dataset.ch;
    // never blank the whole chart: the last visible channel stays on
    if (salesDlg.on[k] && Object.values(salesDlg.on).filter(Boolean).length === 1) return;
    salesDlg.on[k] = !salesDlg.on[k];
    renderSalesDialog();
    return;
  }
  if (e.target.closest('#salesTgl')) {
    salesDlg.table = !salesDlg.table;
    renderSalesDialog();
  }
});

$('salesBody').addEventListener('mousemove', (e) => {
  if (!salesDlg || salesDlg.table) return;
  const tip = $('salesTip');
  if (!tip) return;
  const col = e.target.closest('.sales-col');
  if (!col) { tip.style.display = 'none'; return; }
  const d = salesDlg.days[Number(col.dataset.i)];
  const rows = salesDlg.channels.filter(c => salesDlg.on[c.key]).map(c =>
    `<div class="tr"><span class="sales-sw" data-c="${c.color}"></span>${c.label}<span class="n mono">${d[c.key]}</span></div>`).join('');
  const total = salesDlg.channels.reduce((x, c) => x + (salesDlg.on[c.key] ? d[c.key] : 0), 0);
  tip.innerHTML = `<b>${esc(d.label)}</b>${rows}<div class="tot">Total<span class="n mono">${total}</span></div>`;
  applySalesStyles(tip);
  tip.style.display = 'block';
  const wrap = $('salesPlotWrap').getBoundingClientRect();
  const cr = col.getBoundingClientRect();
  let x = cr.left - wrap.left + cr.width + 8;
  if (x + 150 > wrap.width) x = cr.left - wrap.left - 150;
  tip.style.left = `${x}px`;
  tip.style.top = '14px';
});

$('salesClose').addEventListener('click', () => $('salesDialog').close());

/* ---------- delete a Linnworks SKU (irreversible, consent-gated) ---------- */

let sdelCtx = null; // { sku, sid }

async function openStockDelete(sku, sid) {
  sdelCtx = { sku, sid };
  $('sdelSku').textContent = sku;
  $('sdelAck').checked = false;
  $('sdelGo').disabled = true;
  $('sdelGo').textContent = 'Delete SKU';
  // one fact only (owner 2026-09-16, "just show if there are connected
  // channel SKUs"): the live channel links, each named, or the all-clear
  $('sdelFacts').innerHTML = 'Checking connected channel SKUs…';
  $('stockDelDialog').showModal();
  const res = await api.getChannelSkus(sid);
  if (!sdelCtx || sdelCtx.sid !== sid) return; // dialog moved on
  const list = res.ok ? res.channels : null;
  $('sdelFacts').innerHTML = !list
    ? '<div class="sdel-links">Could not check connected channel SKUs.</div>'
    : list.length === 0
      ? '<div class="sdel-links is-clear">No channel SKUs connected.</div>'
      : `<div class="sdel-links is-warn">
          <div class="sdel-links-h">${list.length} connected channel SKU${list.length === 1 ? '' : 's'}</div>
          <div class="sdel-links-sub">The listing${list.length === 1 ? '' : 's'} will keep selling without stock sync.</div>
          ${list.map(c => `<div class="sdel-link-row"><span class="mono">${esc(c.sku || '')}</span><span class="sdel-link-ch">${esc(channelLabel((c.source || '').toLowerCase()) || c.source || '')}</span></div>`).join('')}
        </div>`;
}

$('sdelAck').addEventListener('change', () => { $('sdelGo').disabled = !$('sdelAck').checked; });
$('sdelCancel').addEventListener('click', () => $('stockDelDialog').close());
$('stockDelDialog').addEventListener('close', () => { sdelCtx = null; });
$('sdelGo').addEventListener('click', async () => {
  if (!sdelCtx || !$('sdelAck').checked) return;
  const { sku, sid } = sdelCtx;
  $('sdelGo').disabled = true;
  $('sdelGo').textContent = 'Deleting…';
  const res = await api.stockDeleteSku(sid, sku).catch(e => ({ ok: false, error: e.message }));
  if (!res || !res.ok) {
    $('sdelGo').textContent = 'Delete SKU';
    $('sdelGo').disabled = false;
    toast((res && res.error) || 'Could not delete the SKU.');
    return;
  }
  $('stockDelDialog').close();
  // every local cache forgets it immediately
  if (recvItems) {
    const i = recvItems.findIndex(x => x.stockItemId === sid);
    if (i >= 0) recvItems.splice(i, 1);
    if (recvBySku) recvBySku.delete(String(sku).toLowerCase());
  }
  if (dsPads) delete dsPads[String(sku).toUpperCase()];
  toast(`${sku} deleted from Linnworks`);
  loadStock();
});

/* ---------- linked channel SKUs per stock item ---------- */

let chsSweep = 0; // invalidates a stale background sweep after a re-open

async function openChannelSkus(sku, stockItemId) {
  $('chsTitle').textContent = `Channel SKUs linked to ${sku}`;
  $('chsList').innerHTML = '<div class="stock-loading"><span class="spinner" aria-label="Loading"></span></div>';
  $('chsDialog').showModal();
  const res = await api.getChannelSkus(stockItemId);
  if (!res.ok) {
    $('chsList').innerHTML = `<p class="dlg-note">${esc(res.error || 'Could not load channel SKUs.')}</p>`;
    return;
  }
  $('chsList').innerHTML = res.channels.length === 0
    ? '<p class="dlg-note">Nothing links here yet - no channel SKU is mapped to this item.</p>'
    : res.channels.map(c => `
      <div class="chs-row" data-sku="${esc(c.sku)}" data-src="${esc(c.source)}" data-sub="${esc(c.subSource)}">
        <span class="badge badge-${esc((c.source || '').toLowerCase())}">${esc(channelLabel((c.source || '').toLowerCase()))}</span>
        <span class="chs-sub">${esc(c.subSource)}</span>
        <button class="mono chs-sku chs-sku-link" data-lsku="${esc(c.sku)}" data-lch="${esc((c.source || '').toLowerCase())}"
          data-lref="${esc(c.refId || '')}"
          title="Open this listing on ${esc(channelLabel((c.source || '').toLowerCase()))} (right-click: copy the SKU)">${esc(c.sku)}</button>
        ${c.price != null
          ? `<span class="mono chs-price" title="${c.priceKind === 'default'
              ? 'Channel default price stored in Linnworks (no listing-specific price)'
              : 'Listing price stored in Linnworks'}">$${Number(c.price).toFixed(2)}${c.priceKind === 'default' ? '<span class="chs-price-def">def</span>' : ''}</span>`
          : '<span class="chs-price chs-price-none" title="No price stored in Linnworks for this listing">—</span>'}
        ${c.ignoreSync ? '<span class="history-status st-pending" title="Stock sync is turned off for this listing">sync off</span>' : ''}
      </div>`).join('');
  // A SKU renamed or ended ON the channel leaves its old link record behind
  // in Linnworks (owner 2026-09-16). Sweep sync-off rows against the
  // channel's current catalog in the background and drop the ones that are
  // truly gone. Only sync-off rows: the catalog scan lags, and a listing
  // created minutes ago must not blink out of the popup.
  const staleCandidates = res.channels
    .filter(c => c.ignoreSync && c.sku)
    .map(c => ({ sku: c.sku, source: c.source, subSource: c.subSource }));
  if (!staleCandidates.length) return;
  const my = ++chsSweep;
  api.channelSkusGone(staleCandidates).then((v) => {
    if (my !== chsSweep || !v || !v.ok || !v.gone || !v.gone.length) return;
    for (const g of v.gone) {
      for (const row of document.querySelectorAll('#chsList .chs-row')) {
        if (row.dataset.sku === g.sku && row.dataset.src === g.source && row.dataset.sub === g.subSource) row.remove();
      }
    }
    if (!document.querySelector('#chsList .chs-row')) {
      $('chsList').innerHTML = '<p class="dlg-note">Nothing links here yet - no channel SKU is mapped to this item.</p>';
    }
  }).catch(() => { /* the sweep is a cleanup, never an error */ });
}

// click a channel SKU -> that listing opens on its marketplace (pane if
// open, external browser otherwise); no template = copy the SKU instead
$('chsList').addEventListener('click', async (e) => {
  const b = e.target.closest('.chs-sku-link');
  if (!b) return;
  const external = $('bDock').hidden;
  const res = await api.listingOpen(b.dataset.lsku, b.dataset.lch, external, b.dataset.lref);
  if (!res.ok) {
    copyFromApp(b.dataset.lsku);
    toast(`${res.error || 'No listing link for this channel.'} SKU copied instead.`);
    return;
  }
  if (!res.external) {
    $('chsDialog').close(); // the pane is behind the dialog — reveal it
    bShowLoading(`Opening ${b.dataset.lsku}`);
  }
});
$('chsList').addEventListener('contextmenu', (e) => {
  const b = e.target.closest('.chs-sku-link');
  if (!b) return;
  e.preventDefault();
  copyFromApp(b.dataset.lsku);
  toast(`${b.dataset.lsku} copied`);
});

$('chsClose').addEventListener('click', () => $('chsDialog').close());

/* ---------- bulk stock update (owner 2026-09-17, reworked same day:
   "no excel import — I just want to write the SKU on the left column and
   on the right side the qty") ---------- */
// A typed two-column grid: SKU left, qty right, a fresh empty line appears
// as you go. Add mode piles received units on top; Set mode replaces the
// count. Every apply writes a history entry that syncs through the shared
// folder with the station name.

// segmented toggle (owner picked version 1): the pill switch + a hint that
// says what the quantities will mean
let bulkModeVal = 'add';
const bulkMode = () => bulkModeVal;
const BULK_HINTS = {
  add: 'received units — each qty goes on top of the current count',
  set: 'a correction or recount — each qty becomes the new count',
};
function bulkSetMode(m) {
  bulkModeVal = m === 'set' ? 'set' : 'add';
  document.querySelectorAll('#bulkSeg .view-chip').forEach(b => b.classList.toggle('is-active', b.dataset.bm === bulkModeVal));
  $('bulkModeHint').textContent = BULK_HINTS[bulkModeVal];
  bulkRefresh();
}
$('bulkSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-bm]');
  if (b) bulkSetMode(b.dataset.bm);
});

// the stock sheet answers "Now" live while typing; unknown SKUs go amber
function bulkStockOf(sku) {
  if (!stockCache || !sku) return null;
  const it = (stockCache.items || []).find(i => String(i.sku).toUpperCase() === sku);
  if (!it) return null;
  const l = (it.levels || []).find(x => x.locationId === stockCache.locationId);
  return { level: l ? Number(l.stockLevel) || 0 : 0 };
}

function bulkAddRow(sku, qty) {
  const row = document.createElement('div');
  row.className = 'bulk-g-row';
  row.innerHTML = `
    <span class="bulk-g-skuwrap">
      <input class="input mono bulk-g-sku" data-bf="sku" placeholder="SKU" autocomplete="off" spellcheck="false" />
      <div class="combo-list" hidden></div>
    </span>
    <input class="input mono bulk-g-qty" data-bf="qty" placeholder="0" autocomplete="off" inputmode="numeric" />
    <span class="bulk-g-now mono">—</span>
    <span class="bulk-g-after mono">—</span>
    <button type="button" class="bulk-g-x" title="Remove this line" tabindex="-1">✕</button>`;
  const skuIn = row.querySelector('[data-bf="sku"]');
  const qtyIn = row.querySelector('[data-bf="qty"]');
  skuIn.value = sku || '';
  qtyIn.value = qty || '';
  // the same SKU/title/barcode picker the returns sheets use (owner
  // 2026-09-17: "why does it not prefill or show me options")
  makeCombo(skuIn, row.querySelector('.combo-list'), (item) => {
    skuIn.value = item.sku;
    bulkRefresh();
    qtyIn.focus();
    qtyIn.select();
  }, {
    // dead-end search → the New SKU popup, prefilled; on create the row
    // fills and the fresh item flows into the grid's Now column
    addNew: (text) => openNewSkuDialog({ sku: text }, () => {
      skuIn.value = text;
      loadStock().then(() => bulkRefresh()).catch(() => bulkRefresh());
      qtyIn.focus();
    }),
  });
  $('bulkGridRows').appendChild(row);
  bulkRowCalc(row);
  return row;
}

function bulkRowCalc(row) {
  const skuIn = row.querySelector('[data-bf="sku"]');
  const sku = skuIn.value.trim().toUpperCase();
  const qs = row.querySelector('[data-bf="qty"]').value.trim();
  const qty = /^\d+$/.test(qs) ? Number(qs) : NaN;
  const hit = bulkStockOf(sku);
  skuIn.classList.toggle('bulk-g-bad', !!sku && !!stockCache && !hit);
  row.querySelector('.bulk-g-now').textContent = hit ? hit.level : '—';
  const afterEl = row.querySelector('.bulk-g-after');
  if (hit && Number.isInteger(qty)) {
    const after = bulkMode() === 'add' ? hit.level + qty : qty;
    afterEl.innerHTML = `<b>${after}</b>`;
    afterEl.classList.toggle('bulk-up', after > hit.level);
    afterEl.classList.toggle('bulk-down', after < hit.level);
  } else {
    afterEl.textContent = '—';
    afterEl.classList.remove('bulk-up', 'bulk-down');
  }
}

function bulkValidRows() {
  const out = [];
  for (const row of document.querySelectorAll('#bulkGridRows .bulk-g-row')) {
    const sku = row.querySelector('[data-bf="sku"]').value.trim().toUpperCase();
    const qs = row.querySelector('[data-bf="qty"]').value.trim();
    if (!sku || !/^\d+$/.test(qs)) continue;
    if (stockCache && !bulkStockOf(sku)) continue; // amber rows never apply
    out.push({ sku, qty: Number(qs) });
  }
  return out;
}

function bulkRefresh() {
  for (const row of document.querySelectorAll('#bulkGridRows .bulk-g-row')) bulkRowCalc(row);
  const rows = $('bulkGridRows');
  const last = rows.lastElementChild;
  if (!last || last.querySelector('[data-bf="sku"]').value.trim() || last.querySelector('[data-bf="qty"]').value.trim()) bulkAddRow();
  $('bulkApply').disabled = !bulkValidRows().length;
}

$('stockBulkBtn').addEventListener('click', () => {
  ensureInventory(); // the SKU picker's lookup data
  $('bulkGridRows').innerHTML = '';
  $('bulkNote').value = '';
  bulkAddRow();
  bulkSetMode('add'); // every open starts on the safe mode
  $('bulkApply').disabled = true;
  $('bulkDialog').showModal();
  const first = document.querySelector('#bulkGridRows [data-bf="sku"]');
  if (first) first.focus();
  if (!stockCache) loadStock().then(() => bulkRefresh()).catch(() => { /* Now column stays — */ });
  bulkHistLoad();
});
$('bulkCancel').addEventListener('click', () => $('bulkDialog').close());

$('bulkGridRows').addEventListener('input', () => bulkRefresh());
$('bulkGridRows').addEventListener('click', (e) => {
  const x = e.target.closest('.bulk-g-x');
  if (!x) return;
  x.closest('.bulk-g-row').remove();
  bulkRefresh();
});
// pasting two spreadsheet columns still fills the grid, one row per line
$('bulkGridRows').addEventListener('paste', (e) => {
  const text = e.clipboardData ? e.clipboardData.getData('text') : '';
  if (!text || (!text.includes('\n') && !text.includes('\t'))) return; // plain text pastes normally
  e.preventDefault();
  const startRow = e.target.closest('.bulk-g-row');
  if (startRow && !startRow.querySelector('[data-bf="sku"]').value.trim()) startRow.remove();
  for (const ln of text.split(/\r?\n/)) {
    const parts = ln.split(/[\t,]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length) bulkAddRow(String(parts[0]).toUpperCase(), parts[1] || '');
  }
  bulkRefresh();
});

$('bulkApply').addEventListener('click', async () => {
  const rows = bulkValidRows();
  if (!rows.length) return;
  const mode = bulkMode();
  $('bulkApply').disabled = true;
  $('bulkApply').textContent = 'Importing…';
  const res = await api.stockBulkApply({ mode, rows, file: '', note: $('bulkNote').value.trim() });
  $('bulkApply').textContent = 'Import';
  if (!res.ok) { toast(res.error || 'Import failed.'); $('bulkApply').disabled = false; return; }
  // one Ctrl+Z takes the WHOLE update back — through the same revert the
  // history buttons use, so the undo shows up in the history too
  pushUndo(`bulk import of ${res.entry.rows.length} SKU${res.entry.rows.length === 1 ? '' : 's'}`, async () => {
    const r = await api.stockBulkRevert(res.entry.id);
    if (!r.ok) throw new Error(r.error || 'Revert failed');
    loadStock();
    bulkHistLoad();
  });
  toast(`${res.entry.rows.length} SKU${res.entry.rows.length === 1 ? '' : 's'} ${mode === 'add' ? 'added to stock' : 'set to the typed counts'} · Ctrl+Z reverses the whole import`, 7000);
  $('bulkGridRows').innerHTML = '';
  bulkAddRow();
  $('bulkNote').value = '';
  loadStock();
  bulkHistLoad();
});

let bulkHistEntries = []; // the revert confirm names the entry from here

// units of entry `id`, line `rowIdx`, already moved to another SKU by fix
// entries — a reverted fix gave its units back, so it doesn't count
function bulkFixMoved(id, rowIdx) {
  const undone = new Set(bulkHistEntries.filter(x => x.revertOf).map(x => x.revertOf));
  return bulkHistEntries
    .filter(x => x.mode === 'fix' && x.fixOf === id && Number(x.fixRow) === Number(rowIdx) && !undone.has(x.id))
    .reduce((s, x) => s + (Number(x.fixQty) || 0), 0);
}

async function bulkHistLoad() {
  const box = $('bulkHist');
  const res = await api.stockBulkHistory().catch(() => null);
  bulkHistEntries = (res && res.ok && res.entries) || [];
  if (!bulkHistEntries.length) {
    box.innerHTML = '<p class="dlg-note">Nothing yet.</p>';
    return;
  }
  const reverted = new Set(bulkHistEntries.filter(e => e.revertOf).map(e => e.revertOf));
  box.innerHTML = bulkHistEntries.map((e, i) => {
    const rows = e.rows || [];
    const nSku = `${rows.length} SKU${rows.length === 1 ? '' : 's'}`;
    const units = rows.reduce((a, r) => a + Math.abs((Number(r.after) || 0) - (Number(r.before) || 0)), 0);
    const what = e.mode === 'add' ? `added ${units} unit${units === 1 ? '' : 's'} · ${nSku}`
      : e.mode === 'set' ? `set counts · ${nSku}`
        : e.mode === 'edit' ? `edited <span class="mono">${esc(rows[0] ? rows[0].sku : '')}</span> ${rows[0] && rows[0].before != null ? `${rows[0].before} → ` : '→ '}${rows[0] ? rows[0].after : ''}`
          : e.mode === 'fix' ? `moved ${e.fixQty || ''} unit${Number(e.fixQty) === 1 ? '' : 's'} <span class="mono">${esc(rows[0] ? rows[0].sku : '')}</span> → <span class="mono">${esc(rows[rows.length - 1] ? rows[rows.length - 1].sku : '')}</span>`
            : `↩ reversed an earlier change · ${nSku}`;
    const fixable = !reverted.has(e.id) && (e.mode === 'add' || e.mode === 'set' || e.mode === 'edit');
    const act = reverted.has(e.id)
      ? '<span class="bulk-h-rvtd">reverted ✓</span>'
      : `<button type="button" class="bulk-h-revert" data-brv="${esc(e.id)}" title="Reverse this change — subtracts what it added (or restores what it removed), leaving everything since alone">↩ Revert</button>`;
    return `
    <div class="bulk-h">
      <div class="bulk-h-line" data-bh="${i}">
        <b>${esc(new Date(e.ts).toLocaleString())}</b> · ${esc(e.station || '')} · ${what}${e.file ? ` · <span class="mono">${esc(e.file)}</span>` : ''}${e.note ? ` · <span class="bulk-h-note" title="${esc(e.note)}">“${esc(e.note)}”</span>` : ''}
        ${act}<span class="bulk-h-chev">▸</span>
      </div>
      <div class="bulk-h-body" hidden>
        <table class="bulk-table">
          <thead><tr><th>SKU</th><th class="num">Before</th><th class="num">${e.mode === 'add' ? 'Added' : e.mode === 'revert' || e.mode === 'fix' ? 'Change' : 'Set to'}</th><th class="num">After</th><th></th></tr></thead>
          <tbody>${rows.map((r, ri) => {
    const change = (Number(r.after) || 0) - (Number(r.before) || 0);
    const moved = fixable ? bulkFixMoved(e.id, ri) : 0;
    const avail = change - moved;
    const canFix = fixable && change > 0 && avail > 0;
    const cell = (canFix
      ? `<button type="button" class="bulk-h-fix" title="Wrong SKU? Change it in place — the units move to the SKU you pick">✎</button>` : '')
      + (moved > 0 ? `<span class="bulk-h-moved" title="${moved} unit${moved === 1 ? '' : 's'} moved to another SKU — see the “moved” entries above">↷ ${moved} moved</span>` : '');
    const q = (e.mode === 'add' || ((e.mode === 'revert' || e.mode === 'fix') && r.qty > 0)) ? `+${r.qty}` : r.qty;
    return `<tr><td class="mono bulk-h-sku"${canFix ? ` data-bfx="${esc(e.id)}" data-bfr="${ri}" title="Double-click to change which SKU these units went to"` : ''}>${esc(r.sku)}</td><td class="num mono">${r.before == null ? '—' : r.before}</td><td class="num mono">${q}</td><td class="num mono">${r.after == null ? '—' : r.after}</td><td class="bulk-h-fixcell">${cell}</td></tr>`;
  }).join('')}</tbody>
        </table>
        ${e.skipped && e.skipped.length ? `<p class="dlg-note bulk-warn">skipped (not in Linnworks): <span class="mono">${e.skipped.map(esc).join(', ')}</span></p>` : ''}
      </div>
    </div>`;
  }).join('');
}

let bulkRevPending = ''; // entry id awaiting the confirm popup

// In-place SKU correction (owner 2026-09-17: "double click within the
// history and just change it really quickly"): the SKU cell swaps into an
// input with suggestions + a small units box (prefilled with everything
// still movable). Enter applies the move, Esc cancels.
let bulkFixClose = null; // open editor's cleanup, one at a time

function bulkFixInlineOpen(td) {
  if (bulkFixClose) bulkFixClose();
  const entry = bulkHistEntries.find(x => x.id === td.dataset.bfx);
  const ri = Number(td.dataset.bfr);
  const row = entry && (entry.rows || [])[ri];
  if (!row) return;
  const change = (Number(row.after) || 0) - (Number(row.before) || 0);
  const avail = change - bulkFixMoved(entry.id, ri);
  if (avail < 1) { toast('Those units were already moved.'); return; }
  ensureInventory(); // the SKU picker's lookup data
  const orig = td.innerHTML;
  td.innerHTML = `
    <div class="bulk-h-fixwrap">
      <input class="input mono bulk-h-fixsku" type="text" autocomplete="off" spellcheck="false" aria-label="Correct SKU" />
      <input class="input mono bulk-h-fixqty" type="number" min="1" max="${avail}" step="1" value="${avail}" aria-label="Units to move" title="How many of the ${avail} unit${avail === 1 ? '' : 's'} to move" />
      <div class="combo-list" hidden></div>
    </div>`;
  const skuIn = td.querySelector('.bulk-h-fixsku');
  const qtyIn = td.querySelector('.bulk-h-fixqty');
  const listEl = td.querySelector('.combo-list');
  skuIn.value = String(row.sku);
  const close = () => {
    document.removeEventListener('mousedown', away, true);
    td.innerHTML = orig;
    bulkFixClose = null;
  };
  const away = (ev) => { if (!td.contains(ev.target) && !listEl.contains(ev.target)) close(); };
  const apply = async () => {
    const to = skuIn.value.trim().toUpperCase();
    const m = Number(qtyIn.value);
    if (!to || to === String(row.sku).toUpperCase()) { close(); return; } // unchanged — never mind
    if (!Number.isInteger(m) || m < 1 || m > avail) { toast(`Units must be a whole number between 1 and ${avail}.`); qtyIn.focus(); return; }
    skuIn.disabled = true; qtyIn.disabled = true;
    const res = await api.stockBulkFix(entry.id, ri, to, m);
    if (!res.ok) { skuIn.disabled = false; qtyIn.disabled = false; toast(res.error || 'Could not move the units.'); return; }
    close();
    toast(`Moved ${m} × ${row.sku} → ${to}`);
    loadStock();
    bulkHistLoad();
  };
  makeCombo(skuIn, listEl, (item) => { skuIn.value = item.sku; qtyIn.focus(); });
  const onKey = (ev) => {
    // preventDefault on Esc also keeps the bulk dialog itself open
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); return; }
    if (ev.key === 'Enter') { ev.preventDefault(); apply(); }
  };
  skuIn.addEventListener('keydown', onKey);
  qtyIn.addEventListener('keydown', onKey);
  document.addEventListener('mousedown', away, true);
  bulkFixClose = close;
  skuIn.focus();
  skuIn.select();
}

$('bulkHist').addEventListener('dblclick', (e) => {
  const td = e.target.closest('td.bulk-h-sku[data-bfx]');
  if (td && !td.querySelector('.bulk-h-fixwrap')) bulkFixInlineOpen(td);
});

$('bulkHist').addEventListener('click', (e) => {
  const fx = e.target.closest('.bulk-h-fix');
  if (fx) {
    const td = fx.closest('tr').querySelector('td.bulk-h-sku[data-bfx]');
    if (td && !td.querySelector('.bulk-h-fixwrap')) bulkFixInlineOpen(td);
    return;
  }
  const rv = e.target.closest('.bulk-h-revert');
  if (rv) {
    bulkRevPending = rv.dataset.brv;
    const entry = bulkHistEntries.find(x => x.id === bulkRevPending);
    const rows = (entry && entry.rows) || [];
    const units = rows.reduce((a, r) => a + Math.abs((Number(r.after) || 0) - (Number(r.before) || 0)), 0);
    $('bulkRevWhat').textContent = entry
      ? `${new Date(entry.ts).toLocaleString()} · ${entry.station || ''} · ${entry.mode === 'add' ? `added ${units} unit${units === 1 ? '' : 's'} across` : entry.mode === 'set' ? 'set counts on' : entry.mode === 'edit' ? 'edited' : 'reversed a change on'} ${rows.length === 1 ? rows[0].sku : `${rows.length} SKUs`}${entry.note ? ` · “${entry.note}”` : ''}`
      : '';
    $('bulkRevGo').disabled = false;
    $('bulkRevDialog').showModal();
    return;
  }
  const line = e.target.closest('.bulk-h-line');
  if (!line) return;
  const body = line.parentElement.querySelector('.bulk-h-body');
  body.hidden = !body.hidden;
  line.querySelector('.bulk-h-chev').textContent = body.hidden ? '▸' : '▾';
});

$('bulkRevCancel').addEventListener('click', () => $('bulkRevDialog').close());
$('bulkRevGo').addEventListener('click', async () => {
  if (!bulkRevPending) return;
  $('bulkRevGo').disabled = true;
  const res = await api.stockBulkRevert(bulkRevPending);
  $('bulkRevDialog').close();
  if (!res.ok) { toast(res.error || 'Could not revert.'); return; }
  toast('Reversed — the history keeps both entries.');
  loadStock();
  bulkHistLoad();
});

/* ---------- Pricing tab (owner 2026-09-18, design 'Pricing and Overview'):
   products × auto-generated channel columns. Walmart (repricer-owned)
   prices are display-only (grey); other channels click-to-edit. ---------- */

let prData = null;
let prQ = '';
const prExpanded = new Set(); // parent SKUs (upper) with the variations open
// Stock (server order) or Family — capacity siblings pulled together
// (owner-picked Option A of pr-family-variants.html, 2026-09-21)
let prSort = 'stock';
try { prSort = localStorage.getItem('prSort') === 'family' ? 'family' : 'stock'; } catch { /* default */ }
// the family = the SKU with its capacity token wildcarded, so
// X400-128GB-GRAY and X400-256GB-GRAY meet at X400-*-GRAY
const prFamKey = (sku) => {
  const s = String(sku).toUpperCase();
  const m = s.match(/\d+\s*[GT]B/);
  return m ? s.replace(m[0], '*') : s;
};
const prCapBadge = (sku) => {
  const m = String(sku).toUpperCase().match(/\d+\s*[GT]B/);
  return m ? `<span class="pr-capbadge">${m[0]}</span>` : '';
};
const PR_COLORS = ['#1F6C9F', '#956400', '#6A2E9E', '#9F2F2D', '#346538'];
// drag a channel header to rearrange the columns (owner 2026-09-21,
// "allow me to drag around and arrange the viewing"); order sticks per
// desktop. Colors follow the CHANNEL, not the column position.
let prChanOrder = [];
try { prChanOrder = JSON.parse(localStorage.getItem('prChanOrder') || '[]'); } catch { /* server order */ }
function prCols() {
  const base = (prData && prData.channels) || [];
  if (!Array.isArray(prChanOrder) || !prChanOrder.length) return base;
  const byKey = new Map(base.map(c => [c.key, c]));
  const out = [];
  for (const k of prChanOrder) { const c = byKey.get(k); if (c) { out.push(c); byKey.delete(k); } }
  for (const c of base) if (byKey.has(c.key)) out.push(c);
  return out;
}
function prChanColor(c) {
  const base = (prData && prData.channels) || [];
  return PR_COLORS[Math.max(0, base.findIndex(x => x.key === c.key)) % PR_COLORS.length];
}
const prMoney = (v) => (Number(v) > 0 ? `$${Number(v).toFixed(2)}` : '—');

async function enterPricing(force) {
  if (!prData) $('prBody').innerHTML = '<p class="dlg-note pr-note">Loading listings and prices…</p>';
  const res = await api.pricingList(!!force).catch(e => ({ ok: false, error: e.message }));
  if (activePage !== 'pricing') return;
  if (!res || !res.ok) {
    $('prBody').innerHTML = `<p class="dlg-note pr-note">${esc((res && res.error) || 'Could not load prices.')}</p>`;
    return;
  }
  prData = res;
  prRender();
}

function prGridCols() { return `44px minmax(230px, 1fr) repeat(${(prData.channels || []).length}, minmax(240px, 1.15fr))`; }

// one product's channel cells — shared by parent and variation rows, each
// with its own top-seller highlight (module-level so the variations toggle
// can build ONE group without re-rendering the whole table)
function prChCells(p) {
  const cols = prCols();
  const maxSold = Math.max(0, ...cols.flatMap(c => (p.channels[c.key] || []).map(l => l.sold)));
  return cols.map((c, ci) => {
    const lines = p.channels[c.key] || [];
    const inner = lines.map(l => `
        <div class="pr-line">
          <span class="pr-csku" title="${esc(l.csku)}${l.wfs ? ' · WFS' : ''}">${esc(l.csku)}</span>
          ${l.sold > 0 ? `<span class="pr-sold ${l.sold === maxSold ? 'pr-hot' : ''}" title="Sold through this listing in the last 60 days (counted since the tally began)">×${l.sold}</span>` : ''}
          ${c.fluctuates
    ? `<span class="pr-price-ro" title="The repricer owns this price — shown here, never written${l.approx ? '. The channel feed carried no price, so this is the Linnworks stored price.' : ''}">${prMoney(l.price)}</span>`
    : `<button type="button" class="pr-price" data-ci="${ci}" data-csku="${esc(l.csku)}" data-old="${l.price || 0}" title="Click to change — Enter pushes it to ${esc(c.source)} via Linnworks">${prMoney(l.price)}</button>`}
          <button type="button" class="pr-open" data-ci="${ci}" data-csku="${esc(l.csku)}" data-ref="${esc(l.refId)}" title="Open this listing in your browser">↗</button>
        </div>`).join('');
    return `<div class="pr-cell pr-ch">${lines.length ? inner : '<span class="pr-none">not listed</span>'}
        <button type="button" class="pr-add" data-ci="${ci}" title="Link a ${esc(c.source)} listing to this product — same link the Mappings dialog makes">+ channel SKU</button>
      </div>`;
  }).join('');
}

// the inside of one variation group (the rows + the footer), without the
// curtain wrapper — prRender and the toggle share it
function prGroupInner(p) {
  const parts = [];
  for (const v of p.variations || []) {
    parts.push(`
    <div class="pr-row pr-vrow" data-psku="${esc(v.sku)}" data-pid="${esc(v.stockItemId)}">
      <div class="pr-cell pr-num pr-velbow">└</div>
      <div class="pr-cell pr-prod">
        ${v.image ? `<img class="pr-thumb" src="${esc(v.image)}" alt="" loading="lazy" />` : '<div class="pr-thumb pr-thumb-empty"></div>'}
        <div class="pr-prodtxt">
          <span class="mono pr-psku">${esc(v.sku)}</span>
          <span class="pr-pstock">${v.stock} in stock</span>
        </div>
        <button type="button" class="pr-vx" data-vx="${esc(v.sku)}" title="Detach — ${esc(v.sku)} goes back to its own row">✕</button>
      </div>
      ${prChCells(v)}
    </div>`);
  }
  parts.push(`
    <div class="pr-vfoot">
      <button type="button" class="pr-varadd pr-varadd-foot" data-va="${esc(p.sku)}">+ variation</button>
    </div>`);
  return parts.join('');
}

function prRender() {
  if (!prData) return;
  const cols = prCols();
  const head = $('prHead');
  head.hidden = false;
  head.innerHTML = '<div class="pr-hc">#</div><div class="pr-hc">PRODUCT</div>'
    + cols.map((c, i) => `<div class="pr-hc pr-hch" draggable="true" data-ci="${i}" data-key="${esc(c.key)}" title="Drag to rearrange the channel columns">${esc(c.source.toUpperCase())}</div>`).join('');
  head.style.gridTemplateColumns = prGridCols();
  for (const el of head.querySelectorAll('.pr-hch')) el.style.color = prChanColor(cols[Number(el.dataset.ci)]);

  const q = prQ.trim();
  const matchOne = (p) => !q || skuMatch(p.sku, q)
    || cols.some(c => (p.channels[c.key] || []).some(l => skuMatch(l.csku, q)));
  const match = (p) => matchOne(p) || (p.variations || []).some(matchOne);
  const rows = (prData.products || []).filter(match);
  if (!rows.length) {
    $('prBody').innerHTML = `<p class="dlg-note pr-note">${q ? 'No SKUs match.' : 'No linked listings yet — link channel SKUs in Mappings and refresh.'}</p>`;
    return;
  }

  // one quiet chip on the row; the details live in a popover (owner picked
  // this over the stacked lines, 2026-09-20)
  const sugChip = (p) => {
    const n = (p.suggest || []).length;
    return n ? `<button type="button" class="pr-vschip" data-vsp="${esc(p.sku)}" title="Condition SKUs that look like ${esc(p.sku)} — click to review">✦ ${n} possible variation${n === 1 ? '' : 's'}</button>` : '';
  };

  // family sort: the leaders keep the biggest-stock order, but capacity
  // siblings (same model + color, different GB) ride directly under the
  // biggest one, marked with the emerald rail and a capacity badge
  const view = [];
  if (prSort === 'family') {
    const fams = new Map(); // key -> members, stock order preserved
    for (const p of rows) {
      const k = prFamKey(p.sku);
      if (!fams.has(k)) fams.set(k, []);
      fams.get(k).push(p);
    }
    let num = 0;
    for (const fam of fams.values()) {
      num++;
      fam.forEach((p, i) => view.push({
        p,
        num: i === 0 ? num : 0,
        fam: fam.length > 1 ? `pr-fam${i === 0 ? ' pr-fam-first' : ''}${i === fam.length - 1 ? ' pr-fam-last' : ''}` : '',
      }));
    }
  } else {
    rows.forEach((p, i) => view.push({ p, num: i + 1, fam: '' }));
  }

  $('prBody').innerHTML = view.map(({ p, num, fam }) => {
    const vars = p.variations || [];
    const vunits = vars.reduce((a, v) => a + (Number(v.stock) || 0), 0);
    const pU = String(p.sku).toUpperCase();
    // searching a condition SKU opens its group so the hit is visible
    const open = vars.length > 0 && (prExpanded.has(pU) || (q && !matchOne(p) && vars.some(matchOne)));
    const parts = [`
    <div class="pr-row ${fam}" data-psku="${esc(p.sku)}" data-pid="${esc(p.stockItemId)}">
      <div class="pr-cell pr-num">${num || ''}</div>
      <div class="pr-cell pr-prod">
        ${p.image ? `<img class="pr-thumb" src="${esc(p.image)}" alt="" loading="lazy" />` : '<div class="pr-thumb pr-thumb-empty"></div>'}
        <div class="pr-prodtxt">
          <span class="mono pr-psku">${esc(p.sku)}${fam ? prCapBadge(p.sku) : ''}</span>
          <span class="pr-pstock">${p.stock} in stock</span>
          ${vars.length
    ? `<button type="button" class="pr-vartog" data-vt="${esc(p.sku)}">${open ? '▾' : '▸'} ${vars.length} variation${vars.length === 1 ? '' : 's'} · ${vunits} unit${vunits === 1 ? '' : 's'}</button>`
    : `<button type="button" class="pr-varadd" data-va="${esc(p.sku)}" title="Group a condition SKU (open box / used / …) under this product">+ variation</button>`}
          ${sugChip(p)}
        </div>
      </div>
      ${prChCells(p)}
    </div>`];
    if (open) {
      // groups render open with no motion here — the curtain only plays on
      // a toggle click, which splices the one group in place (lag fix
      // 2026-09-20: a full re-render before the animation stuttered)
      parts.push(`<div class="pr-vgroup open${fam ? ' pr-fam' : ''}" data-vg="${esc(pU)}"><div class="pr-vclip">${prGroupInner(p)}</div></div>`);
    }
    return parts.join('');
  }).join('');
  for (const el of $('prBody').querySelectorAll('.pr-row')) el.style.gridTemplateColumns = prGridCols();
}

$('prSearch').addEventListener('input', () => { prQ = $('prSearch').value; prRender(); });
$('prRefresh').addEventListener('click', () => enterPricing(true));
const prSortPaint = () => {
  for (const b of document.querySelectorAll('#prSortSet button')) b.classList.toggle('is-on', b.dataset.prsort === prSort);
};
prSortPaint();
$('prSortSet').addEventListener('click', (e) => {
  const b = e.target.closest('[data-prsort]');
  if (!b || b.dataset.prsort === prSort) return;
  prSort = b.dataset.prsort;
  try { localStorage.setItem('prSort', prSort); } catch { /* remembered next time instead */ }
  prSortPaint();
  prRender();
});
// dragging a channel header drops it in front of the header it lands on
let prDragKey = null;
$('prHead').addEventListener('dragstart', (e) => {
  const h = e.target.closest('.pr-hch');
  if (!h) return;
  prDragKey = h.dataset.key;
  e.dataTransfer.effectAllowed = 'move';
});
$('prHead').addEventListener('dragover', (e) => {
  if (prDragKey && e.target.closest('.pr-hch')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
});
$('prHead').addEventListener('drop', (e) => {
  const h = e.target.closest('.pr-hch');
  const from = prDragKey;
  prDragKey = null;
  if (!h || !from || h.dataset.key === from) return;
  e.preventDefault();
  const order = prCols().map(c => c.key);
  order.splice(order.indexOf(h.dataset.key), 0, ...order.splice(order.indexOf(from), 1));
  prChanOrder = order;
  try { localStorage.setItem('prChanOrder', JSON.stringify(order)); } catch { /* this session only */ }
  prRender();
});

// click a price -> inline editor; Enter pushes via Linnworks
function prEditPrice(btn) {
  const row = btn.closest('.pr-row');
  const c = prCols()[Number(btn.dataset.ci)];
  if (!row || !c) return;
  const old = Number(btn.dataset.old) || 0;
  const wrap = document.createElement('span');
  wrap.className = 'pr-editwrap';
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.01';
  input.min = '0.01';
  input.className = 'input mono pr-editin';
  input.value = old ? old.toFixed(2) : '';
  wrap.appendChild(input);
  btn.replaceWith(wrap);
  const cancel = () => { wrap.replaceWith(btn); };
  const apply = async () => {
    const p = Number(input.value);
    if (!Number.isFinite(p) || p <= 0) { toast('Enter a price above zero.'); input.focus(); return; }
    if (Math.abs(p - old) < 0.005) { cancel(); return; }
    input.disabled = true;
    const res = await api.pricingSet({
      stockItemId: row.dataset.pid, stockSku: row.dataset.psku,
      source: c.source, subSource: c.subSource,
      channelSku: btn.dataset.csku, price: p, old,
    });
    if (!res.ok) { input.disabled = false; toast(res.error || 'Could not change the price.'); return; }
    toast(`${btn.dataset.csku} → $${p.toFixed(2)} — saved to Linnworks (goes live on ${c.source} when its price sync is on)`);
    enterPricing(true);
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancel(); }
    if (ev.key === 'Enter') { ev.preventDefault(); apply(); }
  });
  input.addEventListener('blur', () => { if (!input.disabled) setTimeout(() => { if (wrap.isConnected && !input.disabled) cancel(); }, 150); });
  input.focus();
  input.select();
}

// + channel SKU: an anchored picker of that channel's UNLINKED listings;
// picking one creates the real Linnworks mapping (mapping:link)
let prPickEl = null;
function prPickClose() {
  if (prPickEl) { prPickEl.remove(); prPickEl = null; }
  document.removeEventListener('mousedown', prPickAway, true);
}
function prPickAway(e) { if (prPickEl && !prPickEl.contains(e.target)) prPickClose(); }

async function prPickOpen(btn) {
  prPickClose();
  const row = btn.closest('.pr-row');
  const c = prCols()[Number(btn.dataset.ci)];
  if (!row || !c) return;
  const psku = row.dataset.psku;
  const r = btn.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'prpick';
  pop.innerHTML = `
    <div class="prpick-head">Link a <b>${esc(c.source)}</b> SKU to <span class="mono">${esc(psku)}</span></div>
    <input class="input mono prpick-in" type="text" placeholder="Search unlinked listings…" autocomplete="off" spellcheck="false" />
    <div class="prpick-list"><p class="dlg-note">Loading the ${esc(c.source)} catalog…</p></div>
    <div class="prpick-foot">Only listings not linked to anything yet · picking one maps it in Linnworks</div>`;
  document.body.appendChild(pop);
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 448))}px`;
  pop.style.top = r.bottom + 340 > window.innerHeight ? `${Math.max(8, r.top - 346)}px` : `${r.bottom + 6}px`;
  prPickEl = pop;
  document.addEventListener('mousedown', prPickAway, true);
  const input = pop.querySelector('.prpick-in');
  const listEl = pop.querySelector('.prpick-list');
  input.focus();
  const res = await api.mappingItems(c.id, c.source, c.subSource, false).catch(e => ({ ok: false, error: e.message }));
  if (!prPickEl) return;
  if (!res.ok) { listEl.innerHTML = `<p class="dlg-note">${esc(res.error || 'Could not load the catalog.')}</p>`; return; }
  const unlinked = (res.items || []).filter(i => !i.linked && i.sku);
  const renderList = () => {
    const q = input.value.trim();
    const hits = unlinked.filter(i => !q || skuMatch(i.sku, q) || skuMatch(i.title || '', q)).slice(0, 30);
    // SKUs only, one per line (owner 2026-09-21) — the title still matches
    // the search and waits in the hover tooltip
    listEl.innerHTML = hits.length
      ? hits.map(i => `
        <button type="button" class="prpick-opt" data-sku="${esc(i.sku)}" data-ref="${esc(i.channelRefId || '')}" title="${esc(i.title || '')}${i.price ? ` — $${Number(i.price).toFixed(2)}` : ''}">
          <span class="mono">${esc(i.sku)}</span>
        </button>`).join('')
      : `<p class="dlg-note">${q ? 'Nothing unlinked matches.' : `No unlinked ${esc(c.source)} listings.`}</p>`;
  };
  renderList();
  input.addEventListener('input', renderList);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); prPickClose(); } });
  listEl.addEventListener('click', async (ev) => {
    const opt = ev.target.closest('.prpick-opt');
    if (!opt) return;
    const csku = opt.dataset.sku;
    opt.disabled = true;
    const link = await api.mappingLink(csku, c.source, c.subSource, psku, opt.dataset.ref);
    if (!link.ok) { opt.disabled = false; toast(link.error || 'Could not link.'); return; }
    prPickClose();
    const ord = link.orders;
    if (ord && ord.pending > 0) {
      toast(`${csku} → ${psku} linked — ${ord.pending} open order${ord.pending === 1 ? '' : 's'} did NOT pick up the link. If they ship that way, deduct ${ord.units} unit${ord.units === 1 ? '' : 's'} by hand.`, 9000);
    } else {
      toast(`${csku} → ${psku} linked in Linnworks`);
    }
    enterPricing(true);
  });
}

$('prBody').addEventListener('click', (e) => {
  const price = e.target.closest('.pr-price');
  if (price) { prEditPrice(price); return; }
  const open = e.target.closest('.pr-open');
  if (open) {
    const c = prCols()[Number(open.dataset.ci)];
    // system browser, like the PO# links (owner 2026-09-18)
    api.listingOpen(open.dataset.csku, c ? c.source.toLowerCase() : '', true, open.dataset.ref)
      .then(r => { if (!r.ok && r.error) toast(r.error); });
    return;
  }
  const vt = e.target.closest('.pr-vartog');
  if (vt) {
    // the curtain splices ONE group in or out — never a full re-render,
    // which made the animation stutter on big tables (owner 2026-09-20)
    const k = vt.dataset.vt.toUpperCase();
    const parentRow = vt.closest('.pr-row');
    if (prExpanded.has(k)) {
      prExpanded.delete(k);
      const vg = $('prBody').querySelector(`.pr-vgroup[data-vg="${CSS.escape(k)}"]`);
      if (!vg) { prRender(); return; }
      vt.innerHTML = vt.innerHTML.replace('▾', '▸'); // caret answers instantly
      vg.classList.remove('open');
      vg.addEventListener('transitionend', () => vg.remove(), { once: true });
      setTimeout(() => vg.remove(), 420); // in case transitionend never fires
    } else {
      const p = ((prData && prData.products) || []).find(x => String(x.sku).toUpperCase() === k);
      if (!p || !parentRow) return;
      prExpanded.add(k);
      vt.innerHTML = vt.innerHTML.replace('▸', '▾');
      parentRow.insertAdjacentHTML('afterend',
        `<div class="pr-vgroup${parentRow.classList.contains('pr-fam') ? ' pr-fam' : ''}" data-vg="${esc(k)}"><div class="pr-vclip">${prGroupInner(p)}</div></div>`);
      const vg = parentRow.nextElementSibling;
      for (const el of vg.querySelectorAll('.pr-row')) el.style.gridTemplateColumns = prGridCols();
      // double rAF: the folded 0fr state paints first, then the unroll plays
      requestAnimationFrame(() => requestAnimationFrame(() => vg.classList.add('open')));
    }
    return;
  }
  const vx = e.target.closest('.pr-vx');
  if (vx) {
    api.pricingGroupRemove(vx.dataset.vx).then(r => {
      if (!r.ok) { toast(r.error || 'Could not detach.'); return; }
      toast(`${vx.dataset.vx} is back on its own row`);
      enterPricing();
    });
    return;
  }
  const va = e.target.closest('.pr-varadd');
  if (va) { prVarPickOpen(va); return; }
  const vsc = e.target.closest('.pr-vschip');
  if (vsc) { prSugPopOpen(vsc); return; }
  const add = e.target.closest('.pr-add');
  if (add) prPickOpen(add);
});

// the ✦ chip: an anchored popover over the naming suggestions — Add groups
// that SKU, ✕ mutes the pairing, the footer link mutes all of them at once
function prSugPopOpen(btn) {
  prPickClose();
  const parent = btn.dataset.vsp;
  const p = ((prData && prData.products) || []).find(x => String(x.sku) === parent);
  const sugs = (p && p.suggest) || [];
  if (!sugs.length) return;
  const condBadge = (s) => {
    if (/^OPEN.?BOX/i.test(s)) return '<span class="prsug-cond prsug-ob">Open box</span>';
    if (/^USED/i.test(s)) return '<span class="prsug-cond prsug-used">Used</span>';
    if (/^SCRAP/i.test(s)) return '<span class="prsug-cond prsug-scrap">Scrap</span>';
    return '';
  };
  const r = btn.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'prpick';
  pop.innerHTML = `
    <div class="prpick-head">Condition SKUs that look like <span class="mono">${esc(parent)}</span></div>
    ${sugs.map(s => `
    <div class="prsug-row" data-s="${esc(s)}">
      ${condBadge(s)}
      <span class="mono prsug-sku">${esc(s)}</span>
      <button type="button" class="prsug-add" title="Group ${esc(s)} under ${esc(parent)}">Add</button>
      <button type="button" class="prsug-x" title="Stop suggesting this pairing">✕</button>
    </div>`).join('')}
    <div class="prpick-foot prsug-foot"><button type="button" class="prsug-never">never suggest for this product</button></div>`;
  document.body.appendChild(pop);
  const h = pop.offsetHeight || 200;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 448))}px`;
  pop.style.top = r.bottom + h + 12 > window.innerHeight ? `${Math.max(8, r.top - h - 6)}px` : `${r.bottom + 6}px`;
  prPickEl = pop;
  document.addEventListener('mousedown', prPickAway, true);
  const gone = (row) => { row.remove(); if (!pop.querySelector('.prsug-row')) prPickClose(); };
  pop.addEventListener('click', async (ev) => {
    if (ev.target.closest('.prsug-never')) {
      ev.target.closest('.prsug-never').disabled = true;
      for (const el of pop.querySelectorAll('.prsug-row')) {
        await api.pricingGroupIgnore(parent, el.dataset.s).catch(() => { /* best effort */ });
      }
      prPickClose();
      enterPricing();
      return;
    }
    const row = ev.target.closest('.prsug-row');
    if (!row) return;
    const addBtn = ev.target.closest('.prsug-add');
    if (addBtn) {
      addBtn.disabled = true;
      const res = await api.pricingGroupAdd(parent, row.dataset.s);
      if (!res.ok) { addBtn.disabled = false; toast(res.error || 'Could not group.'); return; }
      prExpanded.add(parent.toUpperCase());
      toast(`${row.dataset.s} grouped under ${parent} — synced to every desktop`);
      gone(row);
      enterPricing();
    } else if (ev.target.closest('.prsug-x')) {
      const res = await api.pricingGroupIgnore(parent, row.dataset.s);
      if (!res.ok) { toast(res.error || 'Could not save that.'); return; }
      gone(row);
      enterPricing();
    }
  });
}

// + variation: an anchored picker over the FULL inventory (any SKU can be
// a variation — the naming convention only suggests, never restricts)
async function prVarPickOpen(btn) {
  prPickClose();
  const parent = btn.dataset.va;
  if (!parent || !prData) return;
  const grouped = new Set();
  for (const p of prData.products || []) {
    for (const v of p.variations || []) grouped.add(String(v.sku).toUpperCase());
  }
  const r = btn.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'prpick';
  pop.innerHTML = `
    <div class="prpick-head">Group a variation under <span class="mono">${esc(parent)}</span></div>
    <input class="input mono prpick-in" type="text" placeholder="Search inventory SKUs…" autocomplete="off" spellcheck="false" />
    <div class="prpick-list"><p class="dlg-note">Loading the inventory…</p></div>
    <div class="prpick-foot">Any inventory SKU can attach · ✕ on its row detaches it again</div>`;
  document.body.appendChild(pop);
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 448))}px`;
  pop.style.top = r.bottom + 340 > window.innerHeight ? `${Math.max(8, r.top - 346)}px` : `${r.bottom + 6}px`;
  prPickEl = pop;
  document.addEventListener('mousedown', prPickAway, true);
  const input = pop.querySelector('.prpick-in');
  const listEl = pop.querySelector('.prpick-list');
  input.focus();
  await ensureInventory();
  if (!prPickEl) return;
  const parentU = parent.toUpperCase();
  const pool = (recvItems || []).filter(i => i.sku
    && String(i.sku).toUpperCase() !== parentU
    && !grouped.has(String(i.sku).toUpperCase()));
  const renderList = () => {
    const q = input.value.trim();
    const hits = pool.filter(i => !q || skuMatch(i.sku, q) || skuMatch(i.title || '', q)).slice(0, 30);
    listEl.innerHTML = hits.length
      ? hits.map(i => `
        <button type="button" class="prpick-opt" data-sku="${esc(i.sku)}" title="${esc(i.title || '')}">
          <span class="mono">${esc(i.sku)}</span>
        </button>`).join('')
      : `<p class="dlg-note">${q ? 'No inventory SKU matches.' : 'Nothing to attach.'}</p>`;
  };
  renderList();
  input.addEventListener('input', renderList);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); prPickClose(); } });
  listEl.addEventListener('click', async (ev) => {
    const opt = ev.target.closest('.prpick-opt');
    if (!opt) return;
    opt.disabled = true;
    const res = await api.pricingGroupAdd(parent, opt.dataset.sku);
    if (!res.ok) { opt.disabled = false; toast(res.error || 'Could not group.'); return; }
    prPickClose();
    prExpanded.add(parentU);
    toast(`${opt.dataset.sku} grouped under ${parent} — synced to every desktop`);
    enterPricing();
  });
}

// the background stored-price fill finished a batch — repaint quietly
api.on('pricing:refreshed', () => { if (activePage === 'pricing') enterPricing(); });

/* price history: the centered popup */
async function prHistLoad() {
  const res = await api.pricingHistory().catch(() => null);
  const list = (res && res.ok && res.entries) || [];
  if (!list.length) { $('prHistBody').innerHTML = '<p class="dlg-note">Nothing yet.</p>'; return; }
  const reverted = new Set(list.filter(e => e.revertOf).map(e => e.revertOf));
  $('prHistBody').innerHTML = list.map(e => {
    const auto = e.mode === 'auto';
    const who = auto ? esc(e.source || 'channel') : esc(e.by || '—');
    const sub = auto ? 'repricer · seen on refresh' : esc(e.station || '');
    const act = auto ? '<span class="prh-auto">automatic</span>'
      : reverted.has(e.id) ? '<span class="prh-rvtd">reverted ✓</span>'
        : `<button type="button" class="prh-revert" data-prv="${esc(e.id)}" title="Push $${(Number(e.oldPrice) || 0).toFixed(2)} back to ${esc(e.source)}">↩ Revert</button>`;
    return `
    <div class="prh-row">
      <span class="mono prh-when">${esc(new Date(e.ts).toLocaleString())}</span>
      <span class="prh-who"><b>${who}</b><span>${sub}</span></span>
      <span class="mono prh-sku" title="${esc(e.stockSku || '')}">${esc(e.channelSku || '')}</span>
      <span class="mono prh-move">${Number(e.oldPrice) > 0 ? `<s>$${Number(e.oldPrice).toFixed(2)}</s>` : '—'} → <b>$${(Number(e.newPrice) || 0).toFixed(2)}</b></span>
      <span class="prh-act">${act}</span>
    </div>`;
  }).join('');
}

/* in-app updater: a new release lights the footer button; one click
   downloads the right installer and opens it (owner 2026-09-18) */
api.on('update:available', (d) => {
  const b = $('updateBtn');
  b.textContent = `Update to v${(d && d.version) || 'latest'}`;
  b.hidden = false;
});
$('updateBtn').addEventListener('click', async () => {
  const b = $('updateBtn');
  if (b.disabled) return;
  b.disabled = true;
  b.textContent = 'Downloading…';
  const res = await api.updateInstall();
  if (!res.ok) {
    b.disabled = false;
    b.textContent = 'Update — retry';
    toast(res.error || 'Could not download the update.');
    return;
  }
  b.textContent = 'Installer opened';
  toast(`Installer opened — run it through and the app comes back updated (saved to Downloads as ${res.file})`, 9000);
});

$('prHistBtn').addEventListener('click', () => { prHistLoad(); $('priceHistDialog').showModal(); });
$('prHistClose').addEventListener('click', () => $('priceHistDialog').close());
$('prHistBody').addEventListener('click', async (e) => {
  const rv = e.target.closest('.prh-revert');
  if (!rv) return;
  rv.disabled = true;
  const res = await api.pricingRevert(rv.dataset.prv);
  if (!res.ok) { rv.disabled = false; toast(res.error || 'Could not revert.'); return; }
  toast('Old price pushed back — the history keeps both entries.');
  prHistLoad();
  enterPricing(true);
});

/* ---------- product image dialog (idle / loading / success / error) ---------- */

let imgTarget = null; // { sku, sid, url (grid image), title, preview (fresh data URL) }
let imgState = 'idle'; // idle | loading | success | error
let imgLastTry = null; // { kind: 'url'|'file', url? } - what Retry re-runs

function fmtBytes(bytes) {
  if (!bytes) return '';
  const kb = bytes / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
}

// idle/loading swap the whole control row state in one place;
// the stage doubles as the file entry point, disabled while in flight
function imgControls(enabled) {
  $('imgUrl').disabled = !enabled;
  $('imgUrlAdd').disabled = !enabled;
  $('imgUrlAdd').textContent = enabled ? 'Add' : 'Adding…';
  $('imgDownload').disabled = !enabled;
  $('imgClose').textContent = enabled ? 'Close' : 'Cancel';
  $('imgStage').classList.toggle('is-clickable', enabled);
  $('imgStage').title = enabled ? 'Click to upload an image' : '';
}

function imgHint(msg, fail = false) {
  const el = $('imgFootHint');
  el.textContent = msg;
  el.style.color = fail ? 'var(--neg-text)' : '';
}

function imgStageIdle() {
  imgState = 'idle';
  imgControls(true);
  imgHint('The image saves to this SKU as soon as it is added.');
  const src = (imgTarget && (imgTarget.preview || imgTarget.url)) || '';
  $('imgStage').innerHTML = src
    ? `<img class="img-stage-img" src="${esc(src)}" alt="" />`
    : `<div class="img-empty">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M216,36H40A20,20,0,0,0,20,56V200a20,20,0,0,0,20,20H216a20,20,0,0,0,20-20V56A20,20,0,0,0,216,36Zm-4,24V158.75l-26.07-26.06a20,20,0,0,0-28.28,0L139.31,151,97.66,109.34a20.05,20.05,0,0,0-28.32,0L44,134.69V60ZM44,168.63l39.51-39.52L166.75,212H44Zm168,43.24-55.72-55.73L171.63,140,212,180.36v31.51ZM148,84a16,16,0,1,1,16,16A16,16,0,0,1,148,84Z"/></svg>
        <div>Click to upload, or drag an image here</div>
      </div>`;
}

// The raw URL never shows while in flight: the input is cleared and disabled,
// the stage line carries the source DOMAIN only (plus size when known).
function imgStageLoading(label, source) {
  imgState = 'loading';
  imgControls(false);
  imgHint('The image saves to this SKU when the download finishes.');
  $('imgUrl').value = '';
  $('imgStage').innerHTML = `
    <div class="img-shimmer"></div>
    <div class="img-load">
      <div class="img-spinner"></div>
      <b>${esc(label)}</b>
      <div class="img-bar is-indet"><i></i></div>
      <span class="img-src">${esc(source || '')}</span>
    </div>`;
}

function imgProgressUpdate(p) {
  if (imgState !== 'loading') return;
  const stage = $('imgStage');
  const label = stage.querySelector('.img-load b');
  const bar = stage.querySelector('.img-bar');
  const src = stage.querySelector('.img-src');
  if (label) label.textContent = p.phase === 'uploading' ? 'Saving to Linnworks…' : 'Downloading image…';
  if (bar) {
    if (p.total > 0) {
      bar.classList.remove('is-indet');
      bar.querySelector('i').style.width = `${Math.min(100, Math.round((p.received / p.total) * 100))}%`;
    } else {
      bar.classList.add('is-indet');
    }
  }
  if (src) src.textContent = [p.source, fmtBytes(p.received)].filter(Boolean).join(' · ');
}

function imgStageError(message) {
  imgState = 'error';
  imgControls(true);
  imgHint('The image saves to this SKU as soon as it is added.');
  if (imgLastTry && imgLastTry.kind === 'url') $('imgUrl').value = imgLastTry.url; // URL row re-enabled
  $('imgStage').innerHTML = `
    <div class="img-err">
      <b>${esc(message)}</b>
      <button id="imgRetry" class="btn btn-secondary">Retry</button>
    </div>`;
}

function imgStageSuccess(previewUrl) {
  imgState = 'success';
  imgControls(true);
  imgHint('The image saves to this SKU as soon as it is added.');
  $('imgUrl').value = '';
  $('imgClose').textContent = 'Done'; // press Done, the new image is there
  if (previewUrl) imgTarget.preview = previewUrl;
  const src = imgTarget.preview || imgTarget.url || '';
  $('imgStage').innerHTML = `
    ${src ? `<img class="img-stage-img" src="${esc(src)}" alt="" />` : ''}
    <span class="img-ok">Image added to ${esc(imgTarget.sku)}</span>`;
}

// the grid shows the NEW image immediately from the local copy — no full
// stock reload (that spinner was the "waiting" the owner flagged)
function imgPatchGrid(dataUrl) {
  if (!dataUrl) { loadStock(); return; }
  const sku = imgTarget.sku;
  if (stockCache) {
    const it = stockCache.items.find(i => i.sku === sku);
    if (it) it.image = dataUrl;
  }
  if (recvBySku) {
    const it2 = recvBySku.get(String(sku).toLowerCase());
    if (it2) it2.image = dataUrl;
  }
  if (unlistedDetail) {
    const u = unlistedDetail.find(x => x.sku === String(sku).toUpperCase());
    if (u) u.image = dataUrl;
  }
  if (activePage === 'stock' && stockCache) renderStock();
}

function openImgDialog(sku, sid, url) {
  const item = stockCache && stockCache.items.find(i => i.sku === sku);
  imgTarget = { sku, sid, url: url || '', title: item ? item.title : '', preview: '' };
  imgLastTry = null;
  $('imgSub').textContent = imgTarget.title ? `${sku} · ${imgTarget.title}` : sku;
  $('imgDownload').hidden = !url;
  $('imgUrl').value = '';
  imgStageIdle();
  $('imgDialog').showModal();
}

async function imgRunUrl(url) {
  imgLastTry = { kind: 'url', url };
  let domain = '';
  try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch { /* main validates too */ }
  imgStageLoading('Downloading image…', domain);
  const res = await api.addStockImageUrl(imgTarget.sku, imgTarget.sid, url);
  if (!$('imgDialog').open || imgState !== 'loading') return;
  if (res.canceled) { imgStageIdle(); $('imgUrl').value = url; return; }
  if (!res.ok) { imgStageError(res.error || 'Could not add the image.'); return; }
  imgStageSuccess(res.dataUrl || '');
  toast(`Image added to ${imgTarget.sku}`);
  imgPatchGrid(res.dataUrl || '');
}

// shared completion for the file/drop paths
function imgFinishFile(res) {
  if (!$('imgDialog').open || imgState !== 'loading') return;
  if (res.canceled) { imgStageIdle(); return; }
  if (!res.ok) { imgStageError(res.error || 'Upload failed.'); return; }
  imgStageSuccess(res.dataUrl || '');
  toast(`Image added to ${imgTarget.sku}`);
  imgPatchGrid(res.dataUrl || '');
}

async function imgRunFile() {
  imgLastTry = { kind: 'file' };
  imgStageLoading('Adding image…', '');
  imgFinishFile(await api.addStockImage(imgTarget.sku, imgTarget.sid));
}

async function imgRunDrop(filePath) {
  imgLastTry = { kind: 'drop', path: filePath };
  imgStageLoading('Adding image…', filePath.split(/[\\/]/).pop());
  imgFinishFile(await api.addStockImageFile(imgTarget.sku, imgTarget.sid, filePath));
}

api.on('image:progress', imgProgressUpdate);

$('imgUrlAdd').addEventListener('click', () => {
  if (!imgTarget) return;
  const url = $('imgUrl').value.trim();
  if (!/^https?:\/\//i.test(url)) {
    imgHint('Paste a full image URL starting with http(s)://', true);
    $('imgUrl').focus();
    return;
  }
  imgRunUrl(url);
});

$('imgUrl').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('imgUrlAdd').click(); }
});

// the stage is the file entry point: click to pick (Retry keeps priority),
// or drop an image file straight onto it. Both disabled while in flight.
$('imgStage').addEventListener('click', (e) => {
  if (imgState === 'loading' || !imgTarget) return;
  if (e.target.closest('#imgRetry') && imgLastTry) {
    if (imgLastTry.kind === 'url') imgRunUrl(imgLastTry.url);
    else if (imgLastTry.kind === 'drop') imgRunDrop(imgLastTry.path);
    else imgRunFile();
    return;
  }
  imgRunFile();
});

$('imgStage').addEventListener('dragover', (e) => {
  if (imgState === 'loading') return;
  e.preventDefault();
  $('imgStage').classList.add('is-drag');
});

$('imgStage').addEventListener('dragleave', () => $('imgStage').classList.remove('is-drag'));

$('imgStage').addEventListener('drop', (e) => {
  e.preventDefault();
  $('imgStage').classList.remove('is-drag');
  if (imgState === 'loading' || !imgTarget) return;
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  let filePath = '';
  try { filePath = api.getDroppedFilePath(file) || ''; } catch { /* not a real file */ }
  if (!filePath) { imgHint('Drag an image file from your computer (browser images: use the URL box).', true); return; }
  imgRunDrop(filePath);
});

$('imgDownload').addEventListener('click', async () => {
  if (!imgTarget || !imgTarget.url) return;
  const res = await api.saveStockImage(imgTarget.sku, imgTarget.url);
  if (res.canceled) return;
  if (!res.ok) { imgHint(res.error || 'Download failed.', true); return; }
  toast(`Saved ${res.path.split(/[\\/]/).pop()}`);
});

$('imgClose').addEventListener('click', () => {
  if (imgState === 'loading') { api.cancelStockImage(); return; } // Cancel aborts, stays open
  $('imgDialog').close();
});

// Esc / programmatic close while a download runs still aborts it
$('imgDialog').addEventListener('close', () => {
  if (imgState === 'loading') api.cancelStockImage();
  focusScan();
});

/* ---------- WFS shipments ---------- */

function wfsLineHtml() {
  return `
    <div class="wfs-line">
      <div class="wfs-combo">
        <input type="text" class="input mono wfs-sku" placeholder="Type a SKU…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-label="SKU" />
        <div class="combo-list" hidden></div>
      </div>
      <input type="text" class="input mono wfs-gtin" autocomplete="off" spellcheck="false" />
      <input type="number" class="input mono wfs-qty" min="1" step="1" />
      <button class="wfs-remove" title="Remove line" type="button">✕</button>
    </div>`;
}

// case-insensitive inventory lookup: the shared combo list first, the stock
// sheet's cache as backstop (same items, whichever loaded first)
function wfsFindSku(q) {
  const k = String(q || '').trim().toLowerCase();
  if (!k) return null;
  if (recvBySku && recvBySku.has(k)) return recvBySku.get(k);
  return stockCache ? stockCache.items.find(i => i.sku.toLowerCase() === k) || null : null;
}

function wfsAddLine() {
  $('wfsLines').insertAdjacentHTML('beforeend', wfsLineHtml());
  // each line gets the app's searchable combobox (SKU / title / barcode,
  // same as the receiving worksheet) — the bare <datalist> matched SKU text
  // only and wore the OS's own styling (owner 2026-09-12, "not good")
  const line = $('wfsLines').lastElementChild;
  const input = line.querySelector('.wfs-sku');
  makeCombo(input, line.querySelector('.combo-list'), (item) => {
    input.value = item.sku;
    const gtin = line.querySelector('.wfs-gtin');
    if (!gtin.value.trim()) gtin.value = item.barcode || '';
    wfsGrow();
    wfsTotals();
    line.querySelector('.wfs-qty').focus();
  });
}

// a fresh entry row appears only when the LAST row holds a real SKU (picked
// or typed in full) — growing whenever every row had any text duplicated
// the row at the first letter typed (owner report 2026-09-12)
function wfsGrow() {
  const last = $('wfsLines').lastElementChild;
  if (last && wfsFindSku(last.querySelector('.wfs-sku').value)) wfsAddLine();
}

// the footer total says exactly what Save will deduct, live
function wfsTotals() {
  const lines = [...$('wfsLines').querySelectorAll('.wfs-line')].map(l => ({
    sku: l.querySelector('.wfs-sku').value.trim(),
    qty: Number(l.querySelector('.wfs-qty').value) || 0,
  })).filter(l => l.sku);
  const units = lines.reduce((a, l) => a + Math.max(0, l.qty), 0);
  $('wfsTot').innerHTML = lines.length
    ? `<b>${lines.length}</b> SKU${lines.length === 1 ? '' : 's'} · <b>${units}</b> unit${units === 1 ? '' : 's'} leave the warehouse`
    : 'Nothing to send yet — type a SKU above';
}

// prefill (from the Overview's Send button): { lines: [{sku, gtin, qty}], from }
let wfsFromOverview = false;
async function openWfs(prefill) {
  // SKU suggestions ride the shared inventory list (combo shows "Loading…"
  // until it lands); GTIN autofill comes from the same items
  ensureInventory();
  wfsFromOverview = !!(prefill && prefill.lines);
  $('wfsFromOv').hidden = !wfsFromOverview;
  $('wfsFromOv').textContent = wfsFromOverview ? prefill.from || '' : '';
  $('wfsLines').innerHTML = '';
  for (const l of wfsFromOverview ? prefill.lines : []) {
    wfsAddLine();
    const row = $('wfsLines').lastElementChild;
    row.querySelector('.wfs-sku').value = l.sku;
    row.querySelector('.wfs-gtin').value = l.gtin || '';
    row.querySelector('.wfs-qty').value = l.qty;
  }
  wfsAddLine();
  $('wfsNote').value = wfsFromOverview ? prefill.note || '' : '';
  $('wfsResult').textContent = '';
  $('wfsResult').className = 'dlg-note test-result wfs-result';
  wfsTotals();
  await renderWfsPast();
  $('wfsDialog').showModal();
  // a pre-filled send is ready to save; focusing its SKU would pop the combo
  const first = wfsFromOverview ? $('wfsSave') : $('wfsLines').querySelector('input');
  if (first) first.focus();
}

// Pending until marked received on the Overview; 14+ days pending = Check
function wfsStatusBadge(s) {
  if (s.received_at) return '<span class="badge wfs-badge status-synced">Received</span>';
  const age = (Date.now() - Date.parse(s.created_at)) / 86400000;
  return age >= 14
    ? '<span class="badge wfs-badge badge-parked">Check</span>'
    : '<span class="badge wfs-badge status-pending">Pending</span>';
}

async function renderWfsPast() {
  const shipments = await api.wfsList();
  $('wfsPast').innerHTML = shipments.length === 0
    ? '<p class="dlg-note">No shipments logged yet.</p>'
    : shipments.map(s => `
      <div class="wfs-card" title="Saved ${esc(s.created_at.slice(0, 10))} ${fmtTime(s.created_at)}">
        <div class="wfs-card-h">
          <b>${retDateUS(s.created_at.slice(0, 10))}</b>
          ${s.station ? `<span class="wfs-card-st${s.mine ? ' is-me' : ''}" title="${s.mine ? 'Logged on this desktop' : `Logged on ${esc(s.station)}`}">${esc(s.station)}</span>` : ''}
          ${s.mine === false ? '' : wfsStatusBadge(s)}
          <span class="wfs-card-u">${s.items.reduce((a, i) => a + i.qty, 0)} units</span>
        </div>
        ${s.note ? `<div class="wfs-card-note" title="${esc(s.note)}">${esc(s.note)}</div>` : ''}
        ${s.items.map(i => `
          <div class="wfs-card-item">
            <span class="mono" title="${esc(i.gtin || '')}">${esc(i.sku)}</span>
            <span class="n">×${i.qty}</span>
          </div>`).join('')}
      </div>`).join('');
}

$('wfsBtn').addEventListener('click', () => openWfs());
$('wfsAddLine').addEventListener('click', () => { wfsAddLine(); $('wfsLines').lastElementChild.querySelector('input').focus(); });
$('wfsClose').addEventListener('click', () => $('wfsDialog').close());

$('wfsLines').addEventListener('click', (e) => {
  const rm = e.target.closest('.wfs-remove');
  if (!rm) return;
  rm.closest('.wfs-line').remove();
  if (!$('wfsLines').querySelector('.wfs-line')) wfsAddLine(); // the sheet always has an entry row
  wfsTotals();
});

// typing a full known SKU (without picking from the list) still pre-fills
// the GTIN and grows the sheet, exactly like a pick
$('wfsLines').addEventListener('input', (e) => {
  const skuInput = e.target.closest('.wfs-sku');
  if (skuInput) {
    const item = wfsFindSku(skuInput.value);
    if (item) {
      const gtin = skuInput.closest('.wfs-line').querySelector('.wfs-gtin');
      if (!gtin.value.trim()) gtin.value = item.barcode || '';
      wfsGrow();
    }
  }
  wfsTotals();
});

$('wfsSave').addEventListener('click', async () => {
  const out = $('wfsResult');
  out.className = 'dlg-note test-result wfs-result';
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
  if (stockCache || recvBySku) {
    // canonicalize casing so a hand-typed sku deducts the real item
    const unknown = [];
    for (const i of items) {
      const known = wfsFindSku(i.sku);
      if (known) i.sku = known.sku;
      else unknown.push(i);
    }
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
  wfsTotals();
  $('wfsNote').value = '';
  if (wfsFromOverview) {
    // back to the Overview, where the shipment now shows as Pending
    wfsFromOverview = false;
    $('wfsDialog').close();
    showPage('overview');
    return;
  }
  await renderWfsPast();
  loadStock(); // show the reduced warehouse counts
});

/* ---------- receiving page ---------- */

let recvLines = []; // { sku, title, qty, known }
let recvItems = null; // full inventory list for the combobox
let recvLocationId = ''; // primary location id, for unit counts on the to-do card
let recvBySku = null; // lowercased SKU -> inventory item
let recvByBarcode = null; // lowercased barcode -> inventory item
let recvLookup = 'idle'; // idle | loading | ready | unavailable
let recvPending = null; // { sku, qty } unknown SKU awaiting Add anyway / Discard
let recvPast = []; // past sessions from receiving:list
const recvOpenDays = new Set(); // expanded day groups in Past receipts
let recvTrackingRes = null; // compiled tracking patterns for the loose hint

// SKU lookup reuses the same Linnworks inventory fetch as the Stock page.
async function enterReceiving() {
  $('recvDate').textContent = `${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · auto`;
  renderRecv();
  loadRecvPast();
  $('recvSku').focus();
  if (recvTrackingRes === null) {
    // loose, non-blocking hint on the inbound tracking field
    const cfg = await api.getConfig();
    recvTrackingRes = [];
    for (const p of cfg.trackingPatterns || []) {
      try { recvTrackingRes.push({ carrier: p.carrier, re: new RegExp(p.pattern, 'i') }); } catch { /* bad user regex */ }
    }
  }
  if (recvLookup !== 'ready') {
    recvNote('Loading Linnworks SKUs…');
    const ok = await ensureInventory();
    recvNote(ok ? '' : `SKU lookup unavailable: ${invError}`, ok);
  }
}

// One shared inventory load for every SKU picker (receiving worksheet,
// unmatched-return path, mapping editor). Retries after a failure.
let invLoadPromise = null;
let invError = '';

function ensureInventory() {
  if (recvLookup === 'ready') return Promise.resolve(true);
  if (invLoadPromise) return invLoadPromise;
  recvLookup = 'loading';
  invLoadPromise = (async () => {
    const res = await api.getStock();
    if (res.ok) {
      recvItems = res.items;
      recvLocationId = res.locationId || '';
      recvBySku = new Map(res.items.map(i => [i.sku.toLowerCase(), i]));
      recvByBarcode = new Map(res.items.filter(i => i.barcode).map(i => [i.barcode.toLowerCase(), i]));
      recvLookup = 'ready';
      invError = '';
      // sheets rendered before the inventory arrived now get their images
      // and the to-do card gets its unit counts
      if (activePage === 'returns') { renderRetLog(); renderRetTodo(); }
      return true;
    }
    recvLookup = 'unavailable';
    invError = res.error || 'could not load inventory';
    invLoadPromise = null; // a later open retries
    return false;
  })();
  return invLoadPromise;
}

// Reusable searchable-SKU combobox (same look/behavior as the receiving
// worksheet's): filters the shared inventory by SKU, title or barcode.
// The worksheet's own instance stays as-is; new pickers attach this.
// Live warehouse availability for one inventory item (null = unknown).
function invAvailAtPrimary(it) {
  const lid = state && state.locations && state.locations.primaryId;
  if (!lid || !Array.isArray(it.levels)) return null;
  const lv = it.levels.find(l => l.locationId === lid);
  return lv ? (lv.available || 0) : 0;
}

// Units of a SKU already promised as the substitute on OTHER unprocessed
// rows. Linnworks cannot reserve a SKU that is not on an order line, so the
// app is the reservation system for pending substitutes.
function subPendingClaims(sku, excludeRowId) {
  const k = String(sku || '').trim().toLowerCase();
  if (!k) return 0;
  let n = 0;
  for (const r of (state && state.rows) || []) {
    if (r.id === excludeRowId || r.status === 'synced') continue;
    if ((r.sub_sku || '').toLowerCase() === k) n += r.sub_qty || 1;
  }
  return n;
}

function makeCombo(input, listEl, onPick, opts) {
  let matches = [];
  let hl = -1;
  const close = () => { listEl.hidden = true; matches = []; hl = -1; };
  const claimsOf = (it) => (opts && opts.claims ? opts.claims(it.sku) : 0);
  // blocked = real stock exists but every unit is already promised to another
  // pending substitution. Genuine zero stock stays pickable (the order simply
  // stays at dropship and the supplier ships the substitute).
  const blockedOf = (it) => {
    const a = invAvailAtPrimary(it);
    return a !== null && a > 0 && claimsOf(it) >= a;
  };
  // combos inside the returns sheets anchor to the viewport: the sheet's
  // scroll container clips absolute children, and toggling its overflow
  // while a list is open made the whole page shift (owner report 2026-08-06)
  const positionList = () => {
    // sheet containers clip absolute dropdowns (overflow:hidden): the
    // returns log, the receive popup's sheet AND the WFS shipment sheet
    // anchor to the viewport
    if (!input.closest('.ret-sheet-scroll') && !input.closest('.rv-sheet') && !input.closest('.wfs-sheet') && !input.closest('.bulk-grid') && !input.closest('.bulk-h-fixwrap')) return;
    const r = input.getBoundingClientRect();
    listEl.classList.add('is-fixed');
    listEl.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 368))}px`;
    listEl.style.minWidth = `${Math.max(260, Math.round(r.width))}px`;
    const below = r.bottom + 4;
    listEl.style.top = `${below + 260 > window.innerHeight ? Math.max(8, r.top - 264) : below}px`;
  };
  // fixed-position lists FOLLOW their input while anything scrolls — the
  // position was computed once at open, so the list stayed put while the
  // row moved (owner 2026-09-21, "I have to scroll down for the bar to
  // match"). Self-cleans once the input leaves the page.
  const follow = () => {
    if (!document.contains(input)) {
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
      return;
    }
    if (!listEl.hidden) positionList();
  };
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);
  const render = () => {
    if (recvLookup === 'loading') {
      listEl.innerHTML = '<div class="combo-note">Loading Linnworks SKUs…</div>';
    } else if (!matches.length) {
      // a dead-end search can end in "create it" (owner 2026-09-17) —
      // only where the caller opted in via opts.addNew
      const q = input.value.trim().toUpperCase();
      listEl.innerHTML = `<div class="combo-note">${recvLookup === 'ready' ? 'No SKU or title matches.' : 'SKU list unavailable - type the full SKU.'}</div>`
        + (opts && opts.addNew && q && recvLookup === 'ready'
          ? `<button class="combo-opt combo-addnew"><span class="mono">+ Create ${esc(q)}</span><span class="combo-opt-title">new SKU in Linnworks</span></button>`
          : '');
    } else {
      listEl.innerHTML = matches.map((it, i) => {
        const a = invAvailAtPrimary(it);
        const claimed = claimsOf(it);
        const blocked = blockedOf(it);
        const availTxt = a === null ? '' : `${a} avail${claimed ? ` · ${claimed} promised` : ''}`;
        return `
        <button class="combo-opt ${i === hl ? 'is-hl' : ''} ${blocked ? 'is-blocked' : ''}" data-i="${i}"
                title="${blocked ? 'Every unit is already promised as a substitute on another order — process that one first' : `${esc(it.sku)} — ${esc(it.title)}`}">
          <span class="mono">${esc(it.sku)}</span>
          ${opts && opts.noTitle ? '' : `<span class="combo-opt-title">${esc(it.title || '')}</span>`}
          ${availTxt ? `<span class="combo-avail ${a > 0 && !blocked ? '' : 'is-zero'}">${availTxt}</span>` : ''}
        </button>`;
      }).join('');
    }
    listEl.hidden = false;
    positionList();
    const hlEl = listEl.querySelector('.combo-opt.is-hl');
    if (hlEl) hlEl.scrollIntoView({ block: 'nearest' });
  };
  const open = () => {
    matches = comboFilter(input.value);
    hl = matches.length ? 0 : -1;
    render();
  };
  input.addEventListener('input', open);
  input.addEventListener('focus', () => { if (input.value.trim()) open(); });
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    const isOpen = !listEl.hidden;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) { open(); return; }
      if (!matches.length) return;
      hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      render();
      return;
    }
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const exact = recvLookupExact(input.value.trim());
    if (exact && !blockedOf(exact)) { close(); onPick(exact); return; }
    if (exact) return; // blocked: leave the list open, the tooltip says why
    // grab the match BEFORE close() — close() empties the matches array,
    // so reading it afterwards handed onPick undefined (Enter on a
    // highlighted, non-exact hit crashed every combo)
    if (isOpen && hl >= 0 && matches[hl] && !blockedOf(matches[hl])) { const it = matches[hl]; close(); onPick(it); }
  });
  listEl.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('.combo-opt');
    if (!opt) return;
    e.preventDefault();
    if (opt.classList.contains('combo-addnew')) {
      const q = input.value.trim().toUpperCase();
      close();
      if (opts && opts.addNew && q) opts.addNew(q);
      return;
    }
    const item = matches[Number(opt.dataset.i)];
    if (item && blockedOf(item)) return; // unclickable by design
    close();
    if (item) onPick(item);
  });
  return { close };
}

function recvNote(msg, ok = true) {
  const el = $('recvNote');
  el.textContent = msg;
  el.className = `test-result${msg ? (ok ? ' is-ok' : ' is-fail') : ''}`;
}

function clearRecvWarn() {
  $('recvWarn').hidden = true;
  recvPending = null;
}

function recvLookupExact(value) {
  const key = value.toLowerCase();
  return (recvBySku && recvBySku.get(key)) || (recvByBarcode && recvByBarcode.get(key)) || null;
}

// product image for a SKU from the shared inventory cache ('' = unknown)
function invImg(sku) {
  const it = recvBySku && recvBySku.get(String(sku || '').toLowerCase());
  return it && it.image ? it.image : '';
}

function recvAdd(sku, title, known, qty = 1) {
  const existing = recvLines.find(l => l.sku.toLowerCase() === sku.toLowerCase());
  if (existing) {
    existing.qty += qty;
    if (!existing.title && title) existing.title = title;
  } else {
    recvLines.push({ sku, title: title || '', qty, known: known !== false });
  }
  renderRecv();
}

// live entry row: clear inputs and start the next line
function recvResetEntry() {
  $('recvSku').value = '';
  $('recvQty').value = '';
  closeCombo();
  recvUpdateEntryTitle();
  $('recvSku').focus();
}

// title cell autofills as soon as the typed SKU/barcode resolves
function recvUpdateEntryTitle() {
  const el = $('recvEntryTitle');
  const raw = $('recvSku').value.trim();
  const item = raw ? recvLookupExact(raw) : null;
  if (item) {
    el.textContent = item.title || '—';
    el.classList.add('is-filled');
  } else {
    el.textContent = raw && recvLookup === 'ready' ? 'no exact SKU match yet…' : 'type a SKU, the title autofills…';
    el.classList.remove('is-filled');
  }
}

// Enter in the qty cell commits the line and starts a new entry row.
function recvCommitEntry() {
  clearRecvWarn();
  const raw = $('recvSku').value.trim();
  if (!raw) { $('recvSku').focus(); return; }
  const qtyRaw = $('recvQty').value.trim();
  const qty = qtyRaw === '' ? 1 : Number(qtyRaw); // empty qty = 1, like the placeholder says
  if (!Number.isInteger(qty) || qty < 1) {
    recvNote('Quantity must be a whole number of 1 or more.', false);
    $('recvQty').focus();
    return;
  }
  recvNote('');
  const item = recvLookupExact(raw);
  if (item) {
    recvAdd(item.sku, item.title, true, qty);
    recvResetEntry();
    return;
  }
  if (recvLookup !== 'ready') {
    recvAdd(raw, '', true, qty); // no inventory to check against: accept as typed
    recvResetEntry();
    return;
  }
  recvPending = { sku: raw, qty };
  $('recvWarnText').textContent = `UNKNOWN SKU: ${raw} is not in Linnworks inventory. Not added - check the label, or Add anyway.`;
  $('recvWarn').hidden = false;
}

/* searchable SKU combobox: type to filter the loaded inventory */

let comboMatches = [];
let comboHl = -1;

function comboFilter(q) {
  if (!recvItems) return [];
  q = q.trim().toLowerCase();
  if (!q) return recvItems.slice(0, 50);
  // ranked, closest first (owner 2026-09-21: typing the exact SKU listed it
  // LAST): exact SKU > SKU prefix > SKU contains > separator-blind SKU
  // ("x133 64gb gray" finds SM-X133-64GB-GRAY, owner 2026-09-17) > title/
  // barcode. Shorter SKUs win ties so the plain SKU beats its -CASE cousin.
  const scored = [];
  for (const it of recvItems) {
    const sku = it.sku.toLowerCase();
    let rank;
    if (sku === q) rank = 0;
    else if (sku.startsWith(q)) rank = 1;
    else if (sku.includes(q)) rank = 2;
    else if (skuMatch(it.sku, q)) rank = 3;
    else if ((it.title || '').toLowerCase().includes(q)
      || (it.barcode || '').toLowerCase().includes(q)
      || skuMatch(it.title || '', q)) rank = 4;
    else continue;
    scored.push({ it, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.it.sku.length - b.it.sku.length || a.it.sku.localeCompare(b.it.sku));
  return scored.slice(0, 50).map(s => s.it);
}

function openCombo() {
  comboMatches = comboFilter($('recvSku').value);
  comboHl = comboMatches.length ? 0 : -1;
  renderCombo();
}

function closeCombo() {
  $('recvComboList').hidden = true;
  $('recvSku').setAttribute('aria-expanded', 'false');
  comboMatches = [];
  comboHl = -1;
}

function renderCombo() {
  const list = $('recvComboList');
  if (recvLookup === 'loading') {
    list.innerHTML = '<div class="combo-note">Loading Linnworks SKUs…</div>';
  } else if (!comboMatches.length) {
    list.innerHTML = `<div class="combo-note">${recvLookup === 'ready' ? 'No SKU or title matches.' : 'SKU list unavailable - type the full SKU.'}</div>`;
  } else {
    list.innerHTML = comboMatches.map((it, i) => `
      <button class="combo-opt ${i === comboHl ? 'is-hl' : ''}" data-i="${i}" title="${esc(it.sku)} — ${esc(it.title)}">
        <span class="mono">${esc(it.sku)}</span>
        <span class="combo-opt-title">${esc(it.title || '')}</span>
      </button>`).join('');
  }
  list.hidden = false;
  $('recvSku').setAttribute('aria-expanded', 'true');
  const hl = list.querySelector('.combo-opt.is-hl');
  if (hl) hl.scrollIntoView({ block: 'nearest' });
}

function comboPick(item) {
  $('recvSku').value = item.sku;
  closeCombo();
  recvUpdateEntryTitle();
  $('recvQty').focus();
  $('recvQty').select();
}

$('recvSku').addEventListener('input', () => { openCombo(); recvUpdateEntryTitle(); });
$('recvSku').addEventListener('focus', () => { if ($('recvSku').value.trim()) openCombo(); });
$('recvSku').addEventListener('blur', () => setTimeout(closeCombo, 150));

$('recvSku').addEventListener('keydown', (e) => {
  const open = !$('recvComboList').hidden;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!open) { openCombo(); return; }
    if (!comboMatches.length) return;
    comboHl = (comboHl + (e.key === 'ArrowDown' ? 1 : -1) + comboMatches.length) % comboMatches.length;
    renderCombo();
    return;
  }
  if (e.key === 'Escape') { closeCombo(); return; }
  if (e.key === 'Tab' && !e.shiftKey) {
    // Tab moves to the qty cell; a highlighted suggestion is picked on the way
    if (open && comboHl >= 0 && comboMatches[comboHl] && !recvLookupExact($('recvSku').value.trim())) {
      e.preventDefault();
      comboPick(comboMatches[comboHl]);
      return;
    }
    closeCombo();
    return;
  }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const raw = $('recvSku').value.trim();
  if (!raw) return;
  // Enter moves to the qty cell (picking the highlighted suggestion if the
  // typed text is not already an exact SKU/barcode); Enter in qty commits.
  if (!recvLookupExact(raw) && open && comboHl >= 0 && comboMatches[comboHl] && recvLookup === 'ready') {
    comboPick(comboMatches[comboHl]);
    return;
  }
  closeCombo();
  recvUpdateEntryTitle();
  $('recvQty').focus();
  $('recvQty').select();
});

// mousedown (not click) so the option wins over the input's blur handler
$('recvComboList').addEventListener('mousedown', (e) => {
  const opt = e.target.closest('.combo-opt');
  if (!opt) return;
  e.preventDefault();
  comboPick(comboMatches[Number(opt.dataset.i)]);
});

$('recvQty').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  recvCommitEntry();
});

// loose validation hint on the inbound tracking number; never blocks
$('recvTracking').addEventListener('input', () => {
  const v = $('recvTracking').value.trim();
  const hint = $('recvTrackingHint');
  if (!v) { hint.textContent = ''; hint.classList.remove('is-ok'); return; }
  const m = (recvTrackingRes || []).find(p => p.re.test(v));
  hint.textContent = m ? `${m.carrier} format` : 'unrecognized format — saved as typed';
  hint.classList.toggle('is-ok', !!m);
});

function renderRecv() {
  const units = recvLines.reduce((s, l) => s + l.qty, 0);
  $('recvFinish').disabled = recvLines.length === 0;
  $('recvSummary').innerHTML =
    `${recvLines.length} SKU${recvLines.length === 1 ? '' : 's'} · <strong>${units}</strong> unit${units === 1 ? '' : 's'}`;
  $('recvEntryNum').textContent = recvLines.length + 1; // the live entry row is always next
  $('recvBody').innerHTML = recvLines.map((l, idx) => `
    <tr data-idx="${idx}">
      <td class="cell-gutter ${l.known === false ? 'st-failed' : 'st-captured'}" title="${l.known === false ? 'Not in Linnworks inventory' : 'Matched in Linnworks'}">${idx + 1}</td>
      <td class="mono cell-recv-sku">${invImg(l.sku) ? `<img class="sku-thumb" src="${esc(invImg(l.sku))}" loading="lazy" alt="" />` : ''}${esc(l.sku)}${l.known === false ? '<span class="unknown-note">not in Linnworks</span>' : ''}</td>
      <td class="cell-recv-title" title="${esc(l.title)}">${l.title ? esc(l.title) : '<span class="cell-missing">—</span>'}</td>
      <td class="num cell-level"><button class="stock-num-btn recv-qty-btn" data-idx="${idx}" title="Click to edit the quantity">${l.qty}</button></td>
      <td class="cell-actions">
        <span class="row-actions">
          <button class="btn-icon is-danger" data-act="del" data-idx="${idx}" title="Remove line">${ICONS.trash}</button>
        </span>
      </td>
    </tr>`).join('');
}

// inline qty edit, same interaction as the Stock page's level edit
function beginRecvQtyEdit(btn) {
  const idx = Number(btn.dataset.idx);
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.step = '1';
  input.value = recvLines[idx].qty;
  input.className = 'input stock-edit recv-qty-btn';
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const v = Number(input.value);
    if (Number.isInteger(v) && v > 0 && recvLines[idx]) recvLines[idx].qty = v;
    renderRecv();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { done = true; renderRecv(); }
  });
  input.addEventListener('blur', commit);
  btn.replaceWith(input);
  input.focus();
  input.select();
}

$('recvWarnAccept').addEventListener('click', () => {
  if (recvPending) recvAdd(recvPending.sku, '', false, recvPending.qty);
  clearRecvWarn();
  recvResetEntry();
});

$('recvWarnDiscard').addEventListener('click', () => { clearRecvWarn(); recvResetEntry(); });

$('recvBody').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act="del"]');
  if (btn) {
    recvLines.splice(Number(btn.dataset.idx), 1);
    renderRecv();
    return;
  }
  const qtyBtn = e.target.closest('button.recv-qty-btn');
  if (qtyBtn) beginRecvQtyEdit(qtyBtn);
});

$('recvFinish').addEventListener('click', async () => {
  if (!recvLines.length) return;
  clearRecvWarn();
  $('recvFinish').disabled = true;
  recvNote('Saving receipt…');
  const meta = {
    reference: $('recvRef').value.trim(),
    trackingNumber: $('recvTracking').value.trim(),
    notes: $('recvNotes').value.trim(),
  };
  const res = await api.receivingFinish(recvLines.map(({ sku, title, qty }) => ({ sku, title, qty })), meta);
  if (!res.ok) {
    recvNote(res.error || 'Could not save the receipt.', false);
    $('recvFinish').disabled = false;
    return;
  }
  const units = recvLines.reduce((s, l) => s + l.qty, 0);
  recvLines = [];
  $('recvRef').value = '';
  $('recvTracking').value = '';
  $('recvTrackingHint').textContent = '';
  $('recvTrackingHint').classList.remove('is-ok');
  $('recvNotes').value = '';
  renderRecv();
  toast(`Receipt saved: ${res.lines} SKU${res.lines === 1 ? '' : 's'}, ${units} unit${units === 1 ? '' : 's'}`);
  if (!res.webhook) recvNote(`Saved to ${res.path.split(/[\\/]/).pop()}`);
  else if (res.webhook.ok) recvNote('Saved and sent to Make.com');
  else recvNote(`Saved, but the webhook failed: ${res.webhook.error}`, false);
  loadRecvPast(); // the finished receipt appears in Past receipts
  $('recvSku').focus();
});

/* past receipts: read-only history of finished sessions */

const CARET_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M184.49,136.49l-80,80a12,12,0,0,1-17-17L159,128,87.51,56.49a12,12,0,1,1,17-17l80,80A12,12,0,0,1,184.49,136.49Z"/></svg>';

async function loadRecvPast() {
  const res = await api.receivingList();
  recvPast = (res && res.sessions) || [];
  renderRecvPast();
}

function recvSessStatus(s) {
  if (s.webhook) {
    return s.webhook.ok
      ? { cls: 'st-synced', label: 'Sent to Make.com', title: '' }
      : { cls: 'st-failed', label: 'Webhook failed', title: s.webhook.error || '' };
  }
  return { cls: 'st-pending', label: 'Saved', title: 'Session file saved; no webhook configured' };
}

function recvSessUnits(s) {
  return s.lines.reduce((a, l) => a + l.qty, 0);
}

function recvDayLabel(key) {
  const d = new Date(`${key}T12:00:00`);
  return Number.isNaN(d.getTime()) ? key : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// one receipt as a mono ledger card: head line + stamp, meta, ruled lines,
// units total, notes footer ("Design B")
function recvReceiptCardHtml(s) {
  const st = recvSessStatus(s);
  const stamp = st.cls === 'st-failed'
    ? { txt: 'WEBHOOK FAILED', cls: 'is-fail' }
    : { txt: 'RECEIVED', cls: '' };
  const head = [s.finishedAt ? fmtTime(s.finishedAt) : '—', s.station || ''].filter(Boolean).join(' · ');
  const meta = [
    s.reference ? `ref ${s.reference}` : '',
    s.trackingNumber ? `trk ${s.trackingNumber}` : '',
  ].filter(Boolean).join(' · ');
  return `
  <div class="recv-card" title="${esc(st.title)}">
    <div class="recv-card-head">
      <span>${esc(head)}</span>
      <span class="recv-stamp ${stamp.cls}">${stamp.txt}</span>
    </div>
    ${meta ? `<div class="recv-card-meta">${esc(meta)}</div>` : ''}
    <div class="recv-card-lines">
      ${s.lines.map(l => `
      <div class="recv-card-line">
        <span class="recv-card-sku" title="${esc(l.title || l.sku)}">${esc(l.sku)}</span>
        <span class="recv-card-qty">×&nbsp;&nbsp;${l.qty}</span>
      </div>`).join('')}
      <div class="recv-card-total">
        <span>${s.lines.length} line${s.lines.length === 1 ? '' : 's'}</span>
        <span>${recvSessUnits(s)} unit${recvSessUnits(s) === 1 ? '' : 's'}</span>
      </div>
    </div>
    ${s.notes ? `<div class="recv-card-note">${esc(s.notes)}</div>` : ''}
  </div>`;
}

function renderRecvPast() {
  const box = $('recvPastBox');
  if (!recvPast.length) {
    box.innerHTML = `
      <div class="recv-past-empty">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M136,80v43.47l36.12,21.67a12,12,0,0,1-12.24,20.58l-42-25.2A12,12,0,0,1,112,130.29V80a12,12,0,0,1,24,0Zm-8-52A100.2,100.2,0,0,0,57.91,57.06L48,66.75V56a12,12,0,0,0-24,0V96a12,12,0,0,0,12,12H76a12,12,0,0,0,0-24H65.16l9.53-9.31A76,76,0,1,1,52,128a12,12,0,0,0-24,0A100,100,0,1,0,128,28Z"/></svg>
        No receipts yet. Finished receipts are saved here for review.
      </div>`;
    return;
  }
  // group by LOCAL day (slicing the ISO string would use UTC and file
  // late-evening receipts under the next day)
  const days = new Map();
  for (const s of recvPast) {
    const d = new Date(s.finishedAt);
    const key = Number.isNaN(d.getTime())
      ? 'unknown'
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(s);
  }
  box.innerHTML = [...days.entries()].map(([day, list]) => {
    const open = recvOpenDays.has(day);
    const units = list.reduce((a, s) => a + recvSessUnits(s), 0);
    // aggregated per-SKU preview across the day's receipts
    const totals = new Map();
    for (const s of list) for (const l of s.lines) totals.set(l.sku, (totals.get(l.sku) || 0) + l.qty);
    const parts = [...totals.entries()].slice(0, 3).map(([sku, q]) => `${sku} ×${q}`);
    const preview = parts.join(', ') + (totals.size > 3 ? ' …' : '');
    return `
    <div class="recv-day-row ${open ? 'is-open' : ''}" data-day="${esc(day)}" title="Click to ${open ? 'collapse' : 'expand'} this day">
      <span class="recv-caret">${CARET_ICON}</span>
      <span class="recv-day-label">${esc(recvDayLabel(day))} · ${list.length} receipt${list.length === 1 ? '' : 's'}</span>
      <span class="recv-day-preview" title="${esc(preview)}">${esc(preview)}</span>
      <span class="recv-day-units">${units} units</span>
    </div>
    ${open ? `<div class="recv-cards">${list.map(recvReceiptCardHtml).join('')}</div>` : ''}`;
  }).join('');
}

$('recvPastBox').addEventListener('click', (e) => {
  const day = e.target.closest('.recv-day-row');
  if (day) {
    const key = day.dataset.day;
    if (recvOpenDays.has(key)) recvOpenDays.delete(key);
    else recvOpenDays.add(key);
    renderRecvPast();
  }
});

// seed helper for automated screenshots and tests (used by the e2e suite)
function recvSeed(lines) {
  recvLines = lines.map(l => ({ ...l }));
  recvNote('');
  clearRecvWarn();
  renderRecv();
}

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
            <span class="mono history-order copyable" data-copy="${esc(r.order_number)}" title="Click to copy · ${esc(channelLabel(r.channel))}">${esc(r.order_number)}</span>
            ${r.tracking
              ? `<span class="mono history-tracking copyable" data-copy="${esc(r.tracking)}" title="Click to copy ${esc(r.tracking)}">${esc(r.tracking)}</span>`
              : '<span class="mono history-tracking">—</span>'}
            <span class="history-status st-${esc(r.status)}" title="${esc(r.fail_reason || '')}">${esc(historyStatusLabel(r))}</span>
            ${r.sub_sku ? `<span class="sub-pill" title="${esc(r.sub_note || `Shipped ${r.sub_sku} instead of the listed item`)}">SUB → ${esc(r.sub_sku)}${r.sub_qty > 1 ? ` ×${r.sub_qty}` : ''}</span>` : ''}
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

// ANY open dialog counts — a hardcoded id list silently missed dialogs
// added later (the receive popup sat UNDER the marketplace pane, 2026-08-07)
function anyDialogOpen() {
  return !!document.querySelector('dialog[open]');
}

function focusScan() {
  if (anyDialogOpen() || activePage !== 'capture') return;
  const inp = activeScanInput();
  if (inp && document.activeElement !== inp) inp.focus();
}

window.addEventListener('click', (e) => {
  if (anyDialogOpen() || activePage !== 'capture') return;
  const tag = e.target.tagName;
  if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A', 'LABEL', 'OPTION'].includes(tag)) return;
  focusScan();
});

// keep the active row's inline input ready for the barcode scanner
setInterval(() => {
  if (!anyDialogOpen() && activePage === 'capture' && document.hasFocus()) {
    const inp = activeScanInput();
    const a = document.activeElement;
    if (inp && a !== inp
      && (!a || (a.tagName !== 'INPUT' && a.tagName !== 'TEXTAREA' && a.tagName !== 'SELECT' && a.tagName !== 'BUTTON'))) {
      inp.focus();
    }
  }
}, 1500);

window.addEventListener('focus', focusScan);

/* ---------- floating tooltip for [data-tip] ---------- */

const floatTip = document.createElement('div');
floatTip.className = 'float-tip';
floatTip.hidden = true;
document.body.appendChild(floatTip);

document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-tip]');
  if (!t) { floatTip.hidden = true; return; }
  floatTip.textContent = t.dataset.tip;
  floatTip.hidden = false;
  const r = t.getBoundingClientRect();
  const half = floatTip.offsetWidth / 2;
  const x = Math.max(half + 8, Math.min(r.left + r.width / 2, window.innerWidth - half - 8));
  floatTip.style.left = `${x}px`;
  floatTip.style.top = `${r.bottom + 6}px`;
});

document.addEventListener('mouseleave', () => { floatTip.hidden = true; });

/* ---------- main-process events ---------- */

api.on('state:changed', (s) => { state = s; render(); if (bReady) applyBrowserPane(); });

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

api.on('orders:imported', ({ added, removed }) => {
  const parts = [];
  if (added) parts.push(`${added} new order${added === 1 ? '' : 's'} from Linnworks`);
  if (removed) parts.push(`${removed} no longer open (removed)`);
  if (parts.length) toast(parts.join(' · '), 3500);
});

api.on('routing:done', (res) => {
  const parts = [];
  if (res.movedOut) parts.push(`${res.movedOut} order${res.movedOut === 1 ? '' : 's'} → dropship (no stock)`);
  if (res.movedBack) parts.push(`${res.movedBack} back (restocked)`);
  // refusals were previously swallowed: a locked/parked order silently
  // stayed put every pass — say so, it needs a human in Linnworks
  if (res.errors && res.errors.length) parts.push(`${res.errors.length} refused (locked or parked in Linnworks)`);
  if (parts.length) toast(`Stock routing: ${parts.join(', ')}`, 5000);
});

api.on('ui:open-settings', openSettings);
api.on('ui:open-debug', openDebug);
api.on('ui:open-history', openHistory);

/* ---------- boot ---------- */

refresh().then(() => focusScan());
initBrowserPane();

/* ---------- Upload Photos (claim photos) ---------- */
// Opened from the 📷 on a returns-log row: QR popover locked to that PO#.
// Photos land in Documents\Capture Station\claim photos (5-day shelf).
// (The generic corner button was retired 2026-08-12 — redundant per owner.)

async function openClaimsPop(po) {
  const pop = $('claimsPop');
  const res = await api.claimsInfo(po || '').catch((err) => ({ ok: false, error: err.message }));
  if (!res || !res.ok) {
    $('claimsErr').textContent = (res && res.error) || 'Could not reach the upload server.';
    $('claimsErr').hidden = false;
    $('claimsQr').removeAttribute('src');
  } else {
    $('claimsErr').hidden = true;
    $('claimsQr').src = res.qr;
  }
  $('claimsSub').innerHTML = po ? `<span class="mono">${esc(po)}</span>` : '';
  pop.hidden = false;
}

$('claimsFolder').addEventListener('click', () => api.claimsOpenFolder());
$('claimsClose').addEventListener('click', () => { $('claimsPop').hidden = true; });

// click-away closes the popover
document.addEventListener('click', (e) => {
  if ($('claimsPop').hidden) return;
  if (e.target.closest('#claimsPop') || e.target.closest('.ret-log-cam')) return;
  $('claimsPop').hidden = true;
});

api.on('claims:uploaded', ({ po, name, todayCount }) => {
  toast(`Photo saved: ${name}`, 3000);
});

/* ---------- eBay lister tab ---------- */
// Approved design: variants/ebay-lister.html. Queue = the unlisted scan
// filtered to condition SKUs; specifics copy once per model from the live
// NEW listing (config.ebayModelCards); Export writes the Seller Hub CSV.

const EB_PREFIX = { new: "", openbox: "OPEN-BOX", used: "USED", scrap: "SCRAP" };
const EB_CONDL = { new: "Brand New", openbox: "Open Box", used: "USED • TESTED & WORKING", scrap: "FOR PARTS OR REPAIR — NOT WORKING" };
const EB_BADGE = { new: "c-new", openbox: "c-open", used: "c-used", scrap: "c-scrap" };

let ebCur = null;      // the listing being built
let ebCfg = null;      // config snapshot (model cards + profiles)
let ebBusy = false;

function ebParseSku(sku) {
  const s = String(sku || "").toUpperCase();
  const cond = s.startsWith("OPEN-BOX-") ? "openbox" : s.startsWith("USED-") ? "used" : s.startsWith("SCRAP-") ? "scrap" : "";
  const base = s.replace(/^(OPEN-BOX|USED|SCRAP)-/, "");
  const m = base.match(/(\d+(?:GB|TB))/i);
  const parts = base.split("-").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  return {
    cond, base,
    model: m ? base.slice(0, Math.max(0, base.indexOf(m[1]) - 1)) : (parts[0] || ""),
    storage: m ? m[1] : "",
    color: last && !/GB|TB/i.test(last) ? last[0] + last.slice(1).toLowerCase() : "",
    // the SKU never spells the brand out — the model token implies it
    // (same heuristic the Temu tab uses)
    brand: /IPAD|IPHONE|APPLE/i.test(s) ? "Apple" : "Samsung",
  };
}

function ebTitleFor(baseTitle, cond) {
  const tag = cond === "new" ? "" : cond === "openbox" ? " - Open Box" : cond === "used" ? " - Used" : " - For Parts";
  // drop a trailing "New" (wrong for condition listings) and any old suffix,
  // then trim the BASE so the suffix always fits whole inside 80 chars
  const base = String(baseTitle || "")
    .replace(/\s*-\s*(Open Box|Used|For Parts)\s*$/i, "")
    .replace(/\s+New\s*$/i, "")
    .trim();
  return (base.slice(0, 80 - tag.length).trim() + tag) || base;
}

// junk the live-page reader may have cached before it learned better —
// cards clean themselves on every use
const EB_SPEC_JUNK = /^(condition|views|buyer id|duration|start time|end time|item number|bids|payments|shipping|returns|pickup|located in|seller|item location|quantity|sold|watchers)$/i;
function ebCleanSpecs(specs) {
  const out = {};
  for (const [k, v] of Object.entries(specs || {})) if (!EB_SPEC_JUNK.test(k)) out[k] = v;
  return out;
}

// mirror of main/ebaycsv.js buildDescription: the live preview IS the export
function ebDescription(forExport) {
  const c = {
    new: { label: "BRAND NEW • FACTORY SEALED", bg: "#2e7d32", fg: "#ffffff",
      blurb: "Item is brand new in its original, unopened retail packaging with the factory seal intact. All original contents are included. Never opened, never activated.",
      inc: "everything, factory sealed in the original retail box.", row: "New" },
    openbox: { label: "OPEN BOX", bg: "#6a1b9a", fg: "#ffffff",
      blurb: "Box has been opened, but the item is in like-new condition — no dents, scratches, or signs of wear. Fully tested and working. All included accessories are original. Original box may show light shelf wear.",
      inc: "the device + all original accessories, original box (may show light shelf wear).", row: "Open Box" },
    used: { label: "USED • TESTED & WORKING", bg: "#fbc02d", fg: "#222222",
      blurb: "Item has been previously used and may show cosmetic wear such as light scratches or scuffs (see photos for actual condition). Fully tested and 100% functional.",
      inc: "the device + accessories exactly as listed — original accessories may not be included. Wall charger not included.", row: "Used — Tested & Working" },
    scrap: { label: "FOR PARTS OR REPAIR — NOT WORKING", bg: "#c62828", fg: "#ffffff",
      blurb: "Item is sold as-is for parts or repair and does not function as intended. Sold with no guarantee of functionality. No returns for non-working condition — please review photos carefully before purchasing.",
      inc: "the device only — sold as-is.", row: "For Parts or Repair" },
  }[ebCur.cond];
  // Every element wears BOTH a class and the inline style: the app's CSP
  // strips inline styles, so the preview leans on .ebp-* rules; eBay's page
  // knows nothing of our classes and uses the inline styles. Same string.
  // Version (US vs Global/International) rides the description ONLY — it is
  // deliberately kept out of the CSV item specifics (owner, 2026-08-13)
  const specRows = [...Object.entries(ebCur.specs), ["Version", ebCur.version || "US"]]
    .filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => `<tr><td class="ebp-td" style="border:1px solid #ddd;padding:8px">${esc(k)}</td><td class="ebp-td" style="border:1px solid #ddd;padding:8px">${esc(v)}</td></tr>`).join("");
  return `
    <div class="ebp-head" style="border-bottom:3px solid #2361EB;padding:6px 0 8px;margin-bottom:12px;text-align:center">
      <div class="ebp-brand" style="font-size:17px;letter-spacing:4px;font-weight:700"><span class="ebp-blue" style="color:#2361EB">WIRELESS</span><span class="ebp-black" style="color:#16181C">TECHNO</span><span class="ebp-blue" style="color:#2361EB">STORE</span></div>
      <div class="ebp-tagline" style="font-size:8.5px;letter-spacing:2px;color:#5B6472;margin-top:2px">30-DAY MONEY BACK GUARANTEE &middot; FAST MESSAGING RESPONSE</div>
    </div>
    <h2 class="ebp-title">${esc(ebCur.title)}</h2>
    <p class="ebp-center" style="text-align:center;margin:6px 0"><span class="ebp-badge ebp-badge-${ebCur.cond}" style="display:inline-block;background:${c.bg};color:${c.fg};font-size:11px;font-weight:700;padding:2px 10px;border-radius:3px">${c.label}</span></p>
    <p class="ebp-center ebp-body" style="text-align:center;font-size:12px;color:#333">${c.blurb}</p>
    <table class="ebp-table" style="width:100%;border-collapse:collapse;font-size:11px;margin:8px 0;color:#333">
      <tr><th class="ebp-th" style="border:1px solid #ddd;padding:6px 8px;background:#f5f5f5;width:38%;text-align:left">Specification</th><th class="ebp-th" style="border:1px solid #ddd;padding:6px 8px;background:#f5f5f5;text-align:left">Details</th></tr>
      ${specRows}
      <tr><td class="ebp-td" style="border:1px solid #ddd;padding:8px">Condition</td><td class="ebp-td" style="border:1px solid #ddd;padding:8px">${c.row}</td></tr>
    </table>
    <p class="ebp-body" style="font-size:12px;color:#333;margin:6px 0"><b>Package Includes:</b> ${c.inc}</p>
    ${ebGallery(forExport)}
    <div class="ebp-foot" style="border-top:3px solid #2361EB;text-align:center;padding-top:6px;margin-top:10px;font-size:10.5px;color:#888"><b><span class="ebp-blue" style="color:#2361EB">Wireless</span><span class="ebp-black" style="color:#16181C">Techno</span><span class="ebp-blue" style="color:#2361EB">Store</span></b> — Every device inspected and tested before shipping</div>`;
}

// photo section inside the description: the preview shows the local files
// (with their edits); the export carries a token the main process swaps for
// the hosted Linnworks URLs once the photos are uploaded
function ebGallery(forExport) {
  if (!ebCur.photos.length) return forExport ? "" : "";
  if (forExport) return "{{PHOTO_GALLERY}}";
  return `<h3 class="ebp-h3" style="margin:10px 0 4px">Photos</h3>
    <div class="ebp-gallery">${ebCur.photos.map(p =>
      `<img src="${ebFileUrl(p.path)}" style="${ebThumbCss(p)}" alt="" />`).join("")}</div>`;
}

// SKUs "claimed" by an accepted export leave the queue at once; the claim
// clears itself when the scan stops reporting the SKU as unlisted (listing
// went live + linked), or after 14 days if the upload never happened
let ebClaimed = {};
try { ebClaimed = JSON.parse(localStorage.getItem("ebayClaimed") || "{}"); } catch { /* fresh start */ }
function ebClaim(skus) {
  const now = Date.now();
  for (const s of skus) ebClaimed[String(s).toUpperCase()] = now;
  try { localStorage.setItem("ebayClaimed", JSON.stringify(ebClaimed)); } catch { /* best effort */ }
}

function ebQueueRows() {
  const rows = [];
  const cutoff = Date.now() - 14 * 86400000;
  // EVERY in-stock SKU with no eBay listing, New included (owner 2026-09-17:
  // "the listings page will show all listings not listed on eBay or Temu").
  // Needs the stock sheet + the truthful link sets; until they load, the
  // zero-listing scan stands in (those SKUs are missing everywhere anyway).
  const src = (stockCache && chLinked && chLinked.ebay)
    ? unlMissingRows().filter(d => d.missing.includes('ebay') && !chanSkipKind(d.sku, 'ebay'))
    : (unlistedDetail || []);
  for (const d of src) {
    const p = ebParseSku(d.sku);
    const claim = ebClaimed[String(d.sku).toUpperCase()];
    if (claim && claim > cutoff) continue; // exported — off the to-do list
    rows.push({ sku: d.sku, cond: p.cond || "new", qty: Math.max(1, Number(d.avail) || 1), stockItemId: d.stockItemId, title: d.title || "" });
  }
  return rows;
}

// condition chips over the queue (owner 2026-09-17: "just a filter for the
// conditions" — the sheet redesign was passed on, the one-column queue
// stays). Session-only; All on every open.
let ebQFilter = '';

function renderEbayQueue() {
  const box = $("ebQueue");
  const all = ebQueueRows();
  const chips = $("ebQChips");
  if (chips) {
    const counts = { new: 0, openbox: 0, used: 0, scrap: 0 };
    for (const r of all) if (counts[r.cond] != null) counts[r.cond] += 1;
    if (ebQFilter && !counts[ebQFilter]) ebQFilter = ''; // the filtered slice emptied out
    const chip = (key, label, n) => `<button type="button" class="eb-qchip ${ebQFilter === key ? 'is-on' : ''}" data-qcond="${key}">${label} · ${n}</button>`;
    chips.innerHTML = all.length ? [
      chip('', 'All', all.length),
      counts.new ? chip('new', 'New', counts.new) : '',
      counts.openbox ? chip('openbox', 'Open Box', counts.openbox) : '',
      counts.used ? chip('used', 'Used', counts.used) : '',
      counts.scrap ? chip('scrap', 'Parts', counts.scrap) : '',
    ].join('') : '';
  }
  const rows = ebQFilter ? all.filter(r => r.cond === ebQFilter) : all;
  if (!rows.length) {
    box.innerHTML = `<div class="ebay-qempty">${all.length
      ? 'Nothing in this condition — pick another chip.'
      : 'Nothing waiting — every in-stock SKU has an eBay listing. Press New listing to start one from scratch.'}</div>`;
    return;
  }
  box.innerHTML = rows.map(r => `
    <div class="ebay-qrow ${ebCur && ebCur.sku === r.sku ? "is-on" : ""}" data-sku="${esc(r.sku)}">
      <span class="sku">${esc(r.sku)}${ebDrafts[r.sku] ? '<span class="ebay-qdraft" title="Draft in progress — click to resume">draft</span>' : ""}</span>
      <span class="sub"><span class="ebay-qcond ${EB_BADGE[r.cond]}">${EB_CONDL[r.cond]}</span><span>${r.qty} unit${r.qty === 1 ? "" : "s"}</span></span>
    </div>`).join("");
}

async function ebLoadCfg() {
  if (!ebCfg) ebCfg = await api.getConfig().catch(() => ({}));
  return ebCfg;
}

// pick a queue row (or scratch): fill the form, resolve the model card
async function ebSelect(sku, scratch) {
  const p = ebParseSku(sku);
  const q = ebQueueRows().find(r => r.sku === sku);
  ebHist = []; ebHistIdx = -1; // history is per-listing
  // a saved draft resumes exactly where it was left
  const draft = !scratch && sku && ebDrafts[sku];
  if (draft) {
    ebCur = JSON.parse(JSON.stringify(draft));
    renderEbayQueue();
    renderEbayForm();
    return;
  }
  ebCur = {
    sku, scratch: !!scratch,
    // queue rows carry their real condition (a base SKU is New); a scratch
    // SKU typed by hand keeps the old open-box default until parsed
    cond: (q && q.cond) || p.cond || (scratch ? "openbox" : "new"),
    stockItemId: (q && q.stockItemId) || "",
    title: "", price: "", qty: q ? q.qty : 1,
    specs: {}, vars: [], photos: [],
    src: "", item: "",
  };
  if (sku && !scratch) ebAutoSiblings();
  renderEbayQueue();
  renderEbayForm();
  if (!sku || scratch) return;
  const cfg = await ebLoadCfg();
  const card = (cfg.ebayModelCards || {})[p.model];
  if (card) {
    ebApplyCard(card, p);
    renderEbayForm();
    return;
  }
  // no card yet: read the live NEW listing once, save the card for good
  $("ebSpecSrc").innerHTML = "⏳ reading your live eBay listing for " + esc(p.base) + "…";
  const res = await api.ebaySpecs(p.base).catch(e => ({ ok: false, error: e.message }));
  if (ebCur.sku !== sku) return; // user moved on
  if (res && res.ok) {
    const newCard = { title: res.title, item: res.itemId, categoryId: res.categoryId, price: res.price, specs: res.specs };
    ebCfg.ebayModelCards = { ...(ebCfg.ebayModelCards || {}), [p.model]: newCard };
    api.setConfig({ ebayModelCards: ebCfg.ebayModelCards }).catch(() => {});
    ebApplyCard(newCard, p);
  } else {
    ebCur.src = "manual";
    ebCur.title = ebTitleFor(`${p.brand} ${p.model} ${p.storage} ${p.color}`.trim(), ebCur.cond);
    ebCur.specs = ebManualSpecs(p);
    ebCur.err = (res && res.error) || "no listing found";
    // public catalog rescue: the item's UPC resolves to a real marketing
    // title even when we have no live listing of the model anywhere.
    // The brand rides the query — "A15 128GB Black" alone matched iPhone 13
    // listings (the A15 Bionic chip), minting Apple titles on Samsung drafts
    const inv = recvBySku && recvBySku.get(String(sku).toLowerCase());
    const upc = (inv && inv.barcode) || "";
    api.titleLookup(upc, `${p.brand} ${p.model} ${p.storage} ${p.color}`.trim()).then(lk => {
      if (!lk || !lk.ok || !lk.title || !ebCur || ebCur.sku !== sku || ebCur.src !== "manual") return;
      ebCur.title = ebTitleFor(lk.title, ebCur.cond);
      ebCur.err = "";
      ebCur.src = "catalog";
      renderEbayForm();
    }).catch(() => { /* the manual title stands */ });
  }
  renderEbayForm();
}

function ebApplyCard(card, p) {
  ebCur.src = "ebay";
  ebCur.item = card.item || "";
  ebCur.categoryId = card.categoryId || "";
  ebCur.title = ebTitleFor(card.title, ebCur.cond);
  ebCur.price = card.price ? (Math.max(1, card.price * 0.92)).toFixed(2) : "";
  ebCur.specs = ebCleanSpecs(card.specs);
  // the SKU knows better than the card for these three
  if (p.storage) ebCur.specs["Storage Capacity"] = p.storage;
  if (p.color) ebCur.specs["Color"] = p.color;
}

// manual mode opens with the FULL standard spec sheet already laid out —
// eBay's usual phone/tablet specifics, empty fields simply stay off the
// listing (owner request 2026-08-12: no add-specific clicking)
const EB_SPEC_TEMPLATE = ['Brand', 'Model', 'MPN', 'Storage Capacity', 'Color', 'Screen Size', 'Processor', 'RAM Size', 'Type', 'Internet Connectivity', 'Operating System', 'Network', 'Connectivity', 'Display Type', 'Maximum Resolution', 'Features', 'Charger Included', 'Country of Origin'];
function ebManualSpecs(p) {
  const s = {};
  for (const k of EB_SPEC_TEMPLATE) s[k] = '';
  s.Brand = p.brand;
  s.Model = p.model;
  s['Storage Capacity'] = p.storage;
  s.Color = p.color;
  return s;
}

function ebVarSku(v) {
  if (v.sku) return v.sku; // auto-filled siblings carry their real SKU
  const p = ebParseSku(ebCur.sku);
  const prefix = EB_PREFIX[ebCur.cond] ? `${EB_PREFIX[ebCur.cond]}-` : ""; // New has no prefix
  return v.storage && v.color
    ? `${prefix}${p.model}-${String(v.storage).toUpperCase()}-${String(v.color).toUpperCase()}`
    : "";
}

// queue siblings (same model + condition) land in the variations already
// filled — ✕ ejects one back to its own place in the queue
function ebAutoSiblings() {
  if (!ebCur || !ebCur.sku) return;
  const p = ebParseSku(ebCur.sku);
  if (!p.model) return; // New SKUs pair too (cond '' matches cond '')
  for (const r of ebQueueRows()) {
    if (r.sku === ebCur.sku) continue;
    const ps = ebParseSku(r.sku);
    if (ps.cond !== p.cond || ps.model !== p.model) continue;
    if (ebCur.vars.some(v => ebVarSku(v) === r.sku)) continue;
    ebCur.vars.push({ sku: r.sku, storage: ps.storage, color: ps.color, price: "", qty: r.qty, auto: true });
    // one product, one draft: absorbing a sibling retires its own draft
    // immediately (owner, 2026-08-13) — ejecting it later rebuilds fresh
    if (ebDrafts[r.sku]) {
      delete ebDrafts[r.sku];
      try { localStorage.setItem("ebayDrafts", JSON.stringify(ebDrafts)); } catch { /* best effort */ }
    }
  }
}

// family members ALREADY live on eBay: ghost cards, never exported.
// Best-effort — needs the inventory cache + the eBay link set loaded.
function ebLiveFamily() {
  if (!ebCur || !ebCur.sku || !recvItems || !chLinked || !chLinked.ebay) return [];
  const p = ebParseSku(ebCur.sku);
  if (!p.model) return [];
  const pre = EB_PREFIX[p.cond || ebCur.cond]; // New has no prefix
  const prefix = pre ? `${pre}-${p.model}-` : `${p.model}-`;
  const inListing = new Set([ebCur.sku, ...ebCur.vars.map(v => ebVarSku(v))]);
  const out = [];
  for (const it of recvItems) {
    const sku = String(it.sku).toUpperCase();
    if (!sku.startsWith(prefix) || inListing.has(sku)) continue;
    if (!it.stockItemId || !chLinked.ebay.has(it.stockItemId)) continue;
    const ps = ebParseSku(sku);
    out.push({ sku, storage: ps.storage, color: ps.color });
  }
  return out;
}

function renderEbayForm() {
  const has = !!ebCur;
  $("ebSku").value = has ? ebCur.sku : "";
  $("ebSku").readOnly = !has || !ebCur.scratch;
  $("ebTitle").value = has ? ebCur.title : "";
  $("ebTitleN").textContent = ($("ebTitle").value || "").length;
  document.querySelectorAll(".ebay-condbtn").forEach(b => b.classList.toggle("is-on", has && b.dataset.cond === ebCur.cond));
  $("ebVersion").value = has ? (ebCur.version || "US") : "US";
  $("ebVersion").disabled = !has;
  $("ebPrice").value = has ? ebCur.price : "";
  $("ebPriceHint").textContent = has && ebCur.src === "ebay" && ebCur.price ? "your live listing price − 8% — edit freely" : "";
  $("ebQty").value = has ? ebCur.qty : "";
  // specifics grid: all card specs, editable; amber when empty in manual mode
  const EB_CORE_SPECS = ["Brand", "Model", "Storage Capacity", "Color"];
  $("ebSpecs").innerHTML = !has ? "" : Object.entries(ebCur.specs).map(([k, v]) => `
    <span class="ebay-spec"><label>${esc(k)}</label><input class="input ${ebCur.src === "manual" && !v && EB_CORE_SPECS.includes(k) ? "is-missing" : ""}" data-spec="${esc(k)}" value="${esc(v)}" /></span>`).join("")
    + `<span class="ebay-spec ebay-spec-add"><button class="ebay-addbtn eb-m0" id="ebSpecAdd">add specific</button></span>`;
  $("ebSpecSrc").innerHTML = !has ? "" : ebCur.src === "ebay"
    ? `✓ copied from your live NEW listing <span class="mono">${esc(ebCur.item)}</span>`
    : ebCur.src === "manual"
      ? `<span style="color:var(--badge-yellow-text);font-weight:600">⚠ ${esc(ebCur.err || "no NEW listing found")}</span> — fill once, saved for every future ${esc(ebParseSku(ebCur.sku).model || "")} return`
      : "";
  // variations
  // auto-filled queue siblings render as compact cards; hand-added ones stay
  // editable; family members already live on eBay show as ghost cards
  $("ebVars").innerHTML = !has ? "" : ebCur.vars.map((v, vi) => v.auto ? `
    <span class="ebay-varcard is-auto">
      <span class="vline"><span>${esc(v.storage)} · ${esc(v.color)}</span><span class="vsku is-ok">${esc(v.sku)}</span>
        <input data-vf="price" data-vi="${vi}" value="${esc(v.price)}" placeholder="${esc(ebCur.price || "price")}" title="Price for this variation (blank = the listing price)" class="input mono eb-w76" />
        <input data-vf="qty" data-vi="${vi}" value="${esc(v.qty)}" title="Units" class="input mono eb-w50" /></span>
      <button class="ebay-varx" data-varx="${vi}" title="Not this one — it keeps its own place in the queue">✕</button>
    </span>` : `
    <span class="ebay-varcard">
      <span class="vgrid">
        <span class="ebay-spec"><label>Storage</label><input class="input mono" data-vf="storage" data-vi="${vi}" value="${esc(v.storage)}" /></span>
        <span class="ebay-spec"><label>Color</label><input class="input mono" data-vf="color" data-vi="${vi}" value="${esc(v.color)}" /></span>
        <span class="ebay-spec"><label>Price</label><input class="input mono" data-vf="price" data-vi="${vi}" value="${esc(v.price)}" /></span>
        <span class="ebay-spec"><label>Qty</label><input class="input mono" data-vf="qty" data-vi="${vi}" value="${esc(v.qty)}" /></span>
      </span>
      <span class="vsku ${ebVarSku(v) ? "is-ok" : "is-empty"}">${ebVarSku(v) || "(fills in from storage + color)"}</span>
      <button class="ebay-varx" data-varx="${vi}">✕</button>
    </span>`).join("")
    + ebLiveFamily().map(g => `
    <span class="ebay-varcard is-live">
      <span class="vline"><span>${esc(g.storage)} · ${esc(g.color)}</span><span class="vsku">${esc(g.sku)}</span>
        <span class="ebay-livetag">live on eBay</span>
        <button class="ebay-liveopen" data-liveopen="${esc(g.sku)}" title="Already listed — add stock there instead of a twin">open ↗</button></span>
    </span>`).join("")
    + `<button class="ebay-addbtn eb-m0 eb-selfstart" id="ebVarAdd">add variation</button>`
    + (has && ebCur.vars.some(v => v.auto) ? `<span class="ebay-fhint">siblings from the queue auto-filled — ✕ ejects one back; exporting removes every included SKU from the queue</span>` : "");
  // photos: objects carrying edit params; thumbs preview the edits live.
  // Click a thumb to edit, ✕ removes, 📷 opens the phone QR for this draft.
  // the app CSP strips style attributes from injected HTML — thumbnails are
  // painted via CSSOM right after render (owner hit blank thumbs 2026-08-13)
  $("ebShots").innerHTML = !has ? "" : ebCur.photos.map((p, i) => `
    <span class="ebay-shot ${i === 0 ? "is-main" : ""}" data-shoti="${i}" title="Click to edit"><button class="x" data-shotx="${i}">✕</button><button class="cp" data-shotc="${i}" title="Copy this photo (with its edits) — then paste with Ctrl+V straight into eBay's photo box">⧉</button></span>`).join("")
    + `<button class="qrbtn" id="ebShotQr" title="Shoot on the phone — QR for this draft">${ICONS.camera}</button>`
    + `<button class="ebay-addbtn eb-m0" id="ebShotAdd">add photos</button>`
    + (ebCur.photos.some(ebPhotoEdited) ? `<span class="ebay-fhint eb-fullrow">✎ edits bake into the exported photos</span>` : "");
  if (has) {
    document.querySelectorAll("#ebShots .ebay-shot[data-shoti]").forEach(el => {
      const p = ebCur.photos[Number(el.dataset.shoti)];
      if (!p) return;
      el.style.backgroundImage = `url("file:///${String(p.path).replace(/\\/g, "/").replace(/"/g, "")}")`;
      el.style.filter = ebFilter(p);
      el.style.transform = `rotate(${p.rot}deg)`;
    });
  }
  // preview + export note
  $("ebPrev").innerHTML = has ? ebDescription() : `<div class="ebay-prev-empty">Pick a SKU from the queue, or press New listing.</div>`;
  const missing = [];
  if (has && !ebCur.photos.length) missing.push("no photos yet");
  if (has && !ebCur.categoryId) missing.push("no eBay category (copied from a live listing) — fill it on eBay after upload");
  $("ebExportNote").textContent = has && missing.length ? missing.join(" · ") : "";
  $("ebExport").disabled = !has;
  $("ebLwList").disabled = !has;
  if (!ebLw.configs) ebLwLoadConfigs(); else ebLwFillSelect(); // tracks the condition toggles
  ebHistPush();  // every rendered state is one undo step
  ebSaveDraft(); // and the draft survives restarts / tab switches
}

/* ----- drafts: one per SKU, resumed on selection ----- */
let ebDrafts = {};
try { ebDrafts = JSON.parse(localStorage.getItem("ebayDrafts") || "{}"); } catch { /* fresh start */ }
function ebSaveDraft() {
  if (!ebCur || !ebCur.sku) return;
  ebDrafts[ebCur.sku] = JSON.parse(JSON.stringify(ebCur));
  try { localStorage.setItem("ebayDrafts", JSON.stringify(ebDrafts)); } catch { /* storage full: drafts are a convenience */ }
}

/* ----- undo / redo across the whole form ----- */
let ebHist = [];
let ebHistIdx = -1;
let ebHistNav = false;
function ebHistBtns() {
  $("ebUndo").disabled = ebHistIdx <= 0;
  $("ebRedo").disabled = ebHistIdx >= ebHist.length - 1;
}
function ebHistPush() {
  if (!ebCur || ebHistNav) { ebHistBtns(); return; }
  const snap = JSON.stringify(ebCur);
  if (ebHist[ebHistIdx] === snap) { ebHistBtns(); return; }
  ebHist = ebHist.slice(0, ebHistIdx + 1);
  ebHist.push(snap);
  ebHistIdx++;
  ebHistBtns();
}
function ebHistGo(delta) {
  const next = ebHistIdx + delta;
  if (next < 0 || next >= ebHist.length) return;
  ebHistIdx = next;
  ebHistNav = true;
  ebCur = JSON.parse(ebHist[next]);
  renderEbayQueue();
  renderEbayForm();
  ebHistNav = false;
  ebSaveDraft();
  ebHistBtns();
}
// blur on the free-typed fields lands one clean history step + draft save
["ebTitle", "ebPrice", "ebQty"].forEach(id => $(id).addEventListener("change", () => { if (ebCur) renderEbayForm(); }));
$("ebVersion").addEventListener("change", (e) => {
  if (!ebCur) return;
  ebCur.version = e.target.value;
  renderEbayForm(); // preview + history + draft in one go
});
$("ebUndo").addEventListener("click", () => ebHistGo(-1));
$("ebRedo").addEventListener("click", () => ebHistGo(1));
document.addEventListener("keydown", (e) => {
  if (activePage !== "ebay" || anyDialogOpen()) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return; // native text undo wins
  if (e.ctrlKey && e.key.toLowerCase() === "z") { e.preventDefault(); ebHistGo(-1); }
  if (e.ctrlKey && e.key.toLowerCase() === "y") { e.preventDefault(); ebHistGo(1); }
});

/* ----- discard: throw the draft away, rebuild fresh ----- */
$("ebDiscard").addEventListener("click", () => {
  if (!ebCur) return;
  const sku = ebCur.sku;
  const scratch = ebCur.scratch;
  if (sku) {
    delete ebDrafts[sku];
    try { localStorage.setItem("ebayDrafts", JSON.stringify(ebDrafts)); } catch { /* best effort */ }
  }
  ebHist = []; ebHistIdx = -1;
  if (scratch || !sku) $("ebScratch").click();
  else ebSelect(sku, false);
  toast("Draft discarded — rebuilt fresh");
});

function enterEbay() {
  ebLoadCfg();
  if (!unlistedDetail) loadUnlisted();
  ensureInventory(); // ghost cards need sku -> stockItemId
  loadChLinked();    // ...and the eBay link set
  // the queue is now "everything missing an eBay listing", which reads the
  // stock sheet — load it here too, then swap the fuller queue in
  if (!stockCache) loadStock().then(() => { if (activePage === 'ebay') renderEbayQueue(); }).catch(() => {});
  renderEbayQueue();
  renderEbayForm();
}

$("ebQueue").addEventListener("click", (e) => {
  const r = e.target.closest(".ebay-qrow");
  if (r) ebSelect(r.dataset.sku, false);
});
$("ebQChips").addEventListener("click", (e) => {
  const c = e.target.closest("[data-qcond]");
  if (!c) return;
  ebQFilter = c.dataset.qcond;
  renderEbayQueue();
});
$("ebScratch").addEventListener("click", () => {
  ebSelect("", true);
  $("ebSku").readOnly = false;
  $("ebSku").placeholder = "type any SKU — OPEN-BOX-…, USED-…, SCRAP-…";
  $("ebSku").focus();
});
$("ebSku").addEventListener("change", (e) => {
  if (!ebCur || !ebCur.scratch) return;
  const sku = e.target.value.trim().toUpperCase();
  const p = ebParseSku(sku);
  ebCur.sku = sku;
  if (p.cond) ebCur.cond = p.cond;
  ebCur.specs = ebManualSpecs(p);
  ebCur.src = "manual";
  ebCur.err = "from-scratch listing";
  ebCur.title = ebTitleFor(`${p.brand} ${p.model} ${p.storage} ${p.color}`.trim(), ebCur.cond);
  renderEbayForm();
});
$("ebTitle").addEventListener("input", (e) => { if (ebCur) { ebCur.title = e.target.value; $("ebTitleN").textContent = e.target.value.length; $("ebPrev").innerHTML = ebDescription(); } });
$("ebPrice").addEventListener("input", (e) => { if (ebCur) ebCur.price = e.target.value; });
$("ebQty").addEventListener("input", (e) => { if (ebCur) ebCur.qty = e.target.value; });
document.querySelector(".ebay-condrow").addEventListener("click", (e) => {
  const b = e.target.closest(".ebay-condbtn");
  if (!b || !ebCur) return;
  ebCur.cond = b.dataset.cond;
  ebCur.title = ebTitleFor(ebCur.title, ebCur.cond);
  renderEbayForm();
});
$("ebSpecs").addEventListener("change", (e) => {
  const f = e.target.closest("[data-spec]");
  if (f && ebCur) { ebCur.specs[f.dataset.spec] = e.target.value; $("ebPrev").innerHTML = ebDescription(); }
});
// window.prompt does not exist in Electron (the button silently no-opped,
// owner report 2026-08-12) — the button becomes an inline name field instead
$("ebSpecs").addEventListener("click", (e) => {
  const btn = e.target.closest("#ebSpecAdd");
  if (!btn || !ebCur) return;
  const cell = btn.parentElement;
  cell.innerHTML = `<label>New specific</label><input class="input" id="ebSpecNew" placeholder="e.g. Processor" />`;
  const inp = cell.querySelector("#ebSpecNew");
  inp.focus();
  inp.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && inp.value.trim()) {
      const name = inp.value.trim();
      if (!(name in ebCur.specs)) ebCur.specs[name] = "";
      renderEbayForm();
      const field = document.querySelector(`#ebSpecs [data-spec="${CSS.escape(name)}"]`);
      if (field) field.focus();
    } else if (ev.key === "Escape") {
      renderEbayForm();
    }
  });
  inp.addEventListener("blur", () => { if (!inp.value.trim()) renderEbayForm(); });
});
$("ebVars").addEventListener("click", (e) => {
  const lo = e.target.closest("[data-liveopen]");
  if (lo) { api.listingOpen(lo.dataset.liveopen, "ebay", true); return; }
  if (e.target.closest("#ebVarAdd") && ebCur) { ebCur.vars.push({ storage: "", color: "", price: "", qty: 1 }); renderEbayForm(); return; }
  const x = e.target.closest("[data-varx]");
  if (x && ebCur) { ebCur.vars.splice(Number(x.dataset.varx), 1); renderEbayForm(); }
});
$("ebVars").addEventListener("change", (e) => {
  const f = e.target.closest("[data-vf]");
  if (f && ebCur) { ebCur.vars[Number(f.dataset.vi)][f.dataset.vf] = e.target.value.trim(); renderEbayForm(); }
});
$("ebShots").addEventListener("click", async (e) => {
  if (e.target.closest("#ebShotAdd") && ebCur) {
    const r = await api.ebayPhotosPick();
    if (r && r.ok && r.files.length) { ebCur.photos.push(...r.files.map(ebPhotoObj)); renderEbayForm(); }
    return;
  }
  if (e.target.closest("#ebShotQr") && ebCur) { ebOpenQr(); return; }
  const x = e.target.closest("[data-shotx]");
  if (x && ebCur) { e.stopPropagation(); ebCur.photos.splice(Number(x.dataset.shotx), 1); renderEbayForm(); return; }
  // copy one photo (edits baked) onto the clipboard — pasting with Ctrl+V
  // into eBay's photo box uploads it without exporting files (owner
  // 2026-09-18). Clipboards hold one image, so it goes photo by photo.
  const cp = e.target.closest("[data-shotc]");
  if (cp && ebCur) {
    e.stopPropagation();
    const p = ebCur.photos[Number(cp.dataset.shotc)];
    if (!p) return;
    try {
      const baked = (await ebBakePhotos([p]))[0];
      const res = await api.copyImage(typeof baked === "string" ? { path: baked } : { dataUrl: baked.dataUrl });
      toast(res && res.ok ? "Photo copied — paste it into eBay's photo box with Ctrl+V (⌘V on the Mac)" : (res && res.error) || "Could not copy the photo.");
    } catch (err) {
      toast(`Could not copy the photo: ${err.message}`);
    }
    return;
  }
  const th = e.target.closest("[data-shoti]");
  if (th && ebCur) ebEditOpen(Number(th.dataset.shoti));
});
// the form's state as the payload the export AND the Linnworks publish
// both send — one assembly, no drift between the two paths
function ebBuildListingPayload() {
  const vars = ebCur.vars.filter(v => v.storage && v.color).map(v => ({
    sku: ebVarSku(v),
    details: `Storage=${v.storage};Color=${v.color}`,
    price: v.price || ebCur.price, qty: Number(v.qty) || 1,
  }));
  if (vars.length) {
    // the primary SKU is itself one of the variations — without this row its
    // own price/qty would fall off the parent listing
    const ps = ebParseSku(ebCur.sku);
    vars.unshift({
      sku: ebCur.sku,
      details: `Storage=${ps.storage || ebCur.specs["Storage Capacity"] || ""};Color=${ps.color || ebCur.specs["Color"] || ""}`,
      price: ebCur.price, qty: Number(ebCur.qty) || 1,
    });
  }
  const listing = {
    sku: ebCur.sku, stockItemId: ebCur.stockItemId, categoryId: ebCur.categoryId || "",
    title: ebCur.title, cond: ebCur.cond,
    // untouched template fields stay off the listing entirely
    specs: Object.fromEntries(Object.entries(ebCur.specs).filter(([, v]) => String(v || "").trim())),
    description: ebDescription(true).replace(/\n\s*/g, " "),
    price: ebCur.price, qty: Number(ebCur.qty) || 1,
    variations: vars,
  };
  return { vars, listing };
}

$("ebExport").addEventListener("click", async () => {
  if (!ebCur || ebBusy) return;
  if (!ebCur.sku) { toast("Type a SKU first."); return; }
  ebBusy = true;
  $("ebExport").textContent = "Exporting…";
  const { vars, listing } = ebBuildListingPayload();
  let photos;
  try {
    photos = await ebBakePhotos(ebCur.photos); // edited pixels, not originals
  } catch (err) {
    ebBusy = false;
    $("ebExport").textContent = "Export eBay CSV";
    toast(`Could not process a photo: ${err.message}`);
    return;
  }
  const res = await api.ebayExport(listing, photos).catch(err => ({ ok: false, error: err.message }));
  ebBusy = false;
  $("ebExport").textContent = "Export eBay CSV";
  if (res && res.ok) {
    // accepting removes every included SKU from the queue and its draft
    const included = [...new Set([ebCur.sku, ...vars.map(v => v.sku)])].filter(Boolean);
    ebClaim(included);
    for (const s of included) delete ebDrafts[s];
    try { localStorage.setItem("ebayDrafts", JSON.stringify(ebDrafts)); } catch { /* best effort */ }
    toast(`Saved ${res.path.split(/[\\/]/).pop()} — ${included.length > 1 ? `${included.length} SKUs left the queue · ` : ""}upload it at Seller Hub → Reports → Upload${res.picCount ? ` (${res.picCount} photos hosted)` : ""}`, 6000);
    ebCur = null;
    renderEbayQueue();
    renderEbayForm();
  } else if (res && !res.canceled) {
    toast(res.error || "Export failed.");
  }
});
// where the exported file gets uploaded: Seller Hub -> Reports -> Upload
$("ebUploadPage").addEventListener("click", () => api.openExternalUrl("https://www.ebay.com/sh/reports/uploads"));

/* ---------- Linnworks-native eBay publishing (owner 2026-09-16) ----------
   "List on eBay" hands the SAME payload the CSV export builds to Linnworks'
   configurator pipeline: template from the condition's configurator, the
   form's fields overlaid, pushed through Linnworks' stored eBay connection.
   Variations still ride the CSV path. Configurator picks persist per
   condition (they carry the eBay condition, so one per condition). */
let ebLw = { configs: null, byCond: {}, subSource: '' };

async function ebLwLoadConfigs() {
  if (ebLw.configs || (state && state.captureOnly)) { ebLwFillSelect(); return; }
  ebLw.configs = []; // one load per session; a failure leaves the select disabled
  const res = await api.ebayLwConfigs().catch(() => null);
  if (res && res.ok) {
    ebLw.configs = res.configs || [];
    ebLw.byCond = (res.saved && res.saved.byCond) || {};
    ebLw.subSource = (res.saved && res.saved.subSource) || '';
  }
  ebLwFillSelect();
}

function ebLwFillSelect() {
  const sel = $('ebLwConfig');
  const cond = ebCur ? ebCur.cond : 'new';
  const list = ebLw.configs || [];
  sel.innerHTML = `<option value="">configurator for ${esc(cond)}…</option>` + list.map(c =>
    `<option value="${esc(c.id)}"${ebLw.byCond[cond] === c.id ? ' selected' : ''}>${esc(c.name || c.site || String(c.id).slice(0, 8))}${c.condition ? ` · ${esc(String(c.condition))}` : ''}${c.account ? ` · ${esc(c.account)}` : ''}</option>`).join('');
  sel.disabled = !list.length;
}

$('ebLwConfig').addEventListener('change', async () => {
  const cond = ebCur ? ebCur.cond : 'new';
  ebLw.byCond[cond] = $('ebLwConfig').value;
  const chosen = (ebLw.configs || []).find(c => c.id === $('ebLwConfig').value);
  if (chosen && chosen.account) ebLw.subSource = chosen.account;
  await api.setConfig({ ebayLw: { subSource: ebLw.subSource, byCond: ebLw.byCond } }).catch(() => { /* re-picked next session */ });
});

$('ebLwList').addEventListener('click', async () => {
  if (!ebCur || ebBusy) return;
  if (!ebCur.sku) { toast('Type a SKU first.'); return; }
  const configId = ebLw.byCond[ebCur.cond];
  if (!configId) { toast(`Pick the Linnworks configurator for ${ebCur.cond} first — the dropdown beside this button.`); return; }
  const { vars, listing } = ebBuildListingPayload();
  if (vars.length) { toast('Variation listings still go through Export eBay CSV for now.'); return; }
  ebBusy = true;
  $('ebLwList').textContent = 'Listing…';
  const done = (msg, ms) => { ebBusy = false; $('ebLwList').textContent = 'List on eBay'; if (msg) toast(msg, ms || 8000); };
  let photos;
  try {
    photos = await ebBakePhotos(ebCur.photos);
  } catch (err) { done(`Could not process a photo: ${err.message}`); return; }
  const res = await api.ebayLwPublish(listing, photos, configId, ebLw.subSource).catch(err => ({ ok: false, error: err.message }));
  if (!res || !res.ok) { done((res && res.error) || 'Linnworks refused the listing.', 9000); return; }
  // give Linnworks a beat to talk to eBay, then read the verdict
  await new Promise(r => setTimeout(r, 4000));
  const st = await api.ebayLwStatus(res.templateId, res.subSource).catch(() => null);
  if (st && st.ok && st.error) { done(`Linnworks: ${st.error}`, 9000); return; }
  const sku = ebCur.sku;
  ebClaim([sku]);
  delete ebDrafts[sku];
  try { localStorage.setItem('ebayDrafts', JSON.stringify(ebDrafts)); } catch { /* best effort */ }
  const status = st && st.ok ? st.status : '';
  done(status === 'OK'
    ? `${sku} is live on eBay${st.listingIds && st.listingIds.length ? ` · #${st.listingIds[0]}` : ''}`
    : `${sku} handed to Linnworks (${status || 'listing'}) — eBay usually confirms within a minute`);
  ebCur = null;
  renderEbayQueue();
  renderEbayForm();
});
$("ebGear").addEventListener("click", async () => {
  const cfg = await ebLoadCfg();
  const p = cfg.ebayProfiles || {};
  $("ebgShip").value = p.shipping || "";
  $("ebgRet").value = p.returns || "";
  $("ebgPay").value = p.payment || "";
  $("ebgLoc").value = p.location || "";
  $("ebgDisp").value = p.dispatchDays ?? 1;
  $("ebGearDialog").showModal();
});
$("ebgCancel").addEventListener("click", () => $("ebGearDialog").close());
// the names live at Seller Hub -> Account settings -> Business Policies;
// the marketplace pane doesn't exist on this page, so open the real browser
$("ebgOpen").addEventListener("click", () => api.openExternalUrl("https://www.ebay.com/bp/manage"));
$("ebgSave").addEventListener("click", async () => {
  ebCfg.ebayProfiles = {
    shipping: $("ebgShip").value.trim(), returns: $("ebgRet").value.trim(),
    payment: $("ebgPay").value.trim(), location: $("ebgLoc").value.trim(),
    dispatchDays: Math.max(0, Number($("ebgDisp").value) || 1),
  };
  await api.setConfig({ ebayProfiles: ebCfg.ebayProfiles }).catch(() => {});
  $("ebGearDialog").close();
  toast("eBay listing settings saved");
});
// Listings is a dropdown (eBay lister | Temu lister), the same pattern as
// Returns ▾ (owner picked option A, 2026-09-17 — the floating pill row is
// gone): first click lands on the last-used lister; the caret — or a click
// while already on either lister — opens the menu
$("tabListings").addEventListener("click", (e) => {
  const wantMenu = e.target.closest(".tab-caret") || activePage === "ebay" || activePage === "temu";
  if (!wantMenu) {
    let ch = "ebay";
    try { if (localStorage.getItem("listingsChannel") === "temu") ch = "temu"; } catch { /* default */ }
    showPage(ch);
    return;
  }
  const dlg = $("listingsMenuDlg");
  for (const b of dlg.querySelectorAll(".tab-menu-item")) b.classList.toggle("is-current", activePage === b.dataset.page);
  dlg.showModal();
  const r = $("tabListings").getBoundingClientRect();
  dlg.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - dlg.offsetWidth - 8)))}px`;
  dlg.style.top = `${Math.round(r.bottom + 4)}px`;
});
$("listingsMenuDlg").addEventListener("click", (e) => {
  const item = e.target.closest(".tab-menu-item");
  $("listingsMenuDlg").close();
  if (item) showPage(item.dataset.page);
});

/* ---------- eBay lister: photo objects, QR capture, editor ---------- */
// Approved designs: variants/ebay-photos-qr.html (phone = capture only) and
// variants/ebay-photo-editor.html (Canva-style editing on the PC).

function ebPhotoObj(path) {
  return { path, bright: 100, con: 100, warm: 0, rot: 0, crop: "free" };
}
function ebPhotoEdited(p) {
  return p.bright !== 100 || p.con !== 100 || p.warm !== 0 || p.rot !== 0 || p.crop !== "free";
}
function ebFileUrl(p) {
  return "file:///" + esc(String(p).replace(/\\/g, "/"));
}
function ebFilter(p) {
  return `brightness(${p.bright}%) contrast(${p.con}%) sepia(${Math.max(0, p.warm) / 100}) hue-rotate(${Math.min(0, p.warm) * 0.6}deg)`;
}
function ebThumbCss(p) {
  return `filter:${ebFilter(p)};transform:rotate(${p.rot}deg)`;
}

/* ----- QR: phone shoots straight into this draft ----- */
async function ebOpenQr() {
  if (!ebCur || !ebCur.sku) { toast("Type a SKU first."); return; }
  const res = await api.ebayQr(ebCur.sku).catch(err => ({ ok: false, error: err.message }));
  if (!res || !res.ok) { toast((res && res.error) || "QR unavailable."); return; }
  $("ebQrImg").src = res.qr;
  $("ebQrSku").innerHTML = `<span class="mono">${esc(ebCur.sku)}</span>`;
  $("ebQrPop").hidden = false;
}
$("ebQrClose").addEventListener("click", () => { $("ebQrPop").hidden = true; });
document.addEventListener("click", (e) => {
  if ($("ebQrPop").hidden) return;
  if (e.target.closest("#ebQrPop") || e.target.closest("#ebShotQr") || e.target.closest("#tmShotQr")) return;
  $("ebQrPop").hidden = true;
});
api.on("ebay:photoUploaded", ({ sku, file }) => {
  if (!ebCur || String(ebCur.sku).toUpperCase() !== String(sku).toUpperCase()) return;
  ebCur.photos.push(ebPhotoObj(file));
  renderEbayForm();
  toast(`Photo from the phone added to ${sku}`, 2500);
});

/* ----- editor: edits live on the photo object, baked at export ----- */
let ebedIdx = 0;
let ebedHist = [];
let ebedHi = 0;

function ebedSnap() {
  ebedHist = ebedHist.slice(0, ebedHi + 1);
  ebedHist.push(JSON.stringify(ebCur.photos));
  ebedHi++;
  ebedHistBtns();
}
function ebedHistBtns() {
  $("ebedUndo").disabled = ebedHi === 0;
  $("ebedRedo").disabled = ebedHi === ebedHist.length - 1;
}
function ebedRestore() {
  ebCur.photos.splice(0, ebCur.photos.length, ...JSON.parse(ebedHist[ebedHi]));
  ebedHistBtns();
  if (ebedIdx >= ebCur.photos.length) ebedIdx = Math.max(0, ebCur.photos.length - 1);
  ebedPaint();
}

function ebEditOpen(i) {
  if (!ebCur || !ebCur.photos.length) return;
  ebedIdx = Math.min(i, ebCur.photos.length - 1);
  ebedHist = [JSON.stringify(ebCur.photos)];
  ebedHi = 0;
  ebedHistBtns();
  ebedPaint();
  $("ebEditDialog").showModal();
}

function ebedPaint() {
  const list = ebCur.photos;
  if (!list.length) { $("ebEditDialog").close(); renderEbayForm(); return; }
  const p = list[ebedIdx];
  const img = $("ebedImg");
  img.src = ebFileUrl(p.path).replace(/&#039;/g, "'");
  img.style.filter = ebFilter(p);
  img.style.transform = `rotate(${p.rot}deg) scale(${p.rot % 180 ? 0.72 : 1})`;
  $("ebedN").textContent = ebedIdx + 1;
  $("ebedM").textContent = list.length;
  $("ebedBright").value = p.bright; $("ebedBrightV").textContent = p.bright - 100;
  $("ebedCon").value = p.con; $("ebedConV").textContent = p.con - 100;
  $("ebedWarm").value = p.warm; $("ebedWarmV").textContent = p.warm;
  document.querySelectorAll(".ebed-chip").forEach(c => c.classList.toggle("is-on", c.dataset.crop === p.crop));
  $("ebedMain").textContent = ebedIdx === 0 ? "★ This is the main photo" : "★ Use as main photo";
  $("ebedStrip").innerHTML = list.map((q, i) => `
    <span class="ebed-th ${i === ebedIdx ? "is-on" : ""} ${i === 0 ? "is-main" : ""}" data-ebedth="${i}"></span>`).join("");
  // CSP strips inline styles from injected HTML: paint the strip via CSSOM
  document.querySelectorAll("#ebedStrip .ebed-th").forEach(el => {
    const q = list[Number(el.dataset.ebedth)];
    if (!q) return;
    el.style.backgroundImage = `url("file:///${String(q.path).replace(/\\/g, "/").replace(/"/g, "")}")`;
    el.style.filter = ebFilter(q);
    el.style.transform = `rotate(${q.rot}deg)`;
  });
}

const ebedWire = (id, key) => {
  $(id).addEventListener("input", (e) => {
    const p = ebCur && ebCur.photos[ebedIdx];
    if (!p) return;
    p[key] = Number(e.target.value);
    ebedPaint();
  });
  $(id).addEventListener("change", () => ebedSnap());
};
ebedWire("ebedBright", "bright");
ebedWire("ebedCon", "con");
ebedWire("ebedWarm", "warm");

$("ebedRot").addEventListener("click", () => {
  const p = ebCur && ebCur.photos[ebedIdx]; if (!p) return;
  p.rot = (p.rot + 90) % 360; ebedSnap(); ebedPaint();
});
document.querySelectorAll(".ebed-chip").forEach(c => c.addEventListener("click", () => {
  const p = ebCur && ebCur.photos[ebedIdx]; if (!p) return;
  p.crop = c.dataset.crop; ebedSnap(); ebedPaint();
}));
$("ebedMain").addEventListener("click", () => {
  if (!ebCur || ebedIdx === 0) return;
  const [p] = ebCur.photos.splice(ebedIdx, 1);
  ebCur.photos.unshift(p);
  ebedIdx = 0; ebedSnap(); ebedPaint();
});
$("ebedDel").addEventListener("click", () => {
  if (!ebCur) return;
  ebCur.photos.splice(ebedIdx, 1);
  if (ebedIdx >= ebCur.photos.length) ebedIdx = Math.max(0, ebCur.photos.length - 1);
  ebedSnap(); ebedPaint();
});
$("ebedReset").addEventListener("click", () => {
  const p = ebCur && ebCur.photos[ebedIdx]; if (!p) return;
  Object.assign(p, { bright: 100, con: 100, warm: 0, rot: 0, crop: "free" });
  ebedSnap(); ebedPaint();
});
$("ebedStrip").addEventListener("click", (e) => {
  const t = e.target.closest("[data-ebedth]");
  if (t) { ebedIdx = Number(t.dataset.ebedth); ebedPaint(); }
});
$("ebedUndo").addEventListener("click", () => { if (ebedHi > 0) { ebedHi--; ebedRestore(); } });
$("ebedRedo").addEventListener("click", () => { if (ebedHi < ebedHist.length - 1) { ebedHi++; ebedRestore(); } });
$("ebEditDialog").addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "z") { e.preventDefault(); $("ebedUndo").click(); }
  if (e.ctrlKey && e.key.toLowerCase() === "y") { e.preventDefault(); $("ebedRedo").click(); }
});
$("ebedDone").addEventListener("click", () => { $("ebEditDialog").close(); renderEbayForm(); });

/* ----- bake: apply the edits to real pixels for export ----- */
function ebLoadImage(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not read ${path.split("\\").pop()}`));
    img.src = "file:///" + String(path).replace(/\\/g, "/");
  });
}

async function ebBakePhotos(photos) {
  const out = [];
  for (const p of photos) {
    if (!ebPhotoEdited(p)) { out.push(p.path); continue; }
    const img = await ebLoadImage(p.path);
    // crop from the center first, in source pixels
    let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
    if (p.crop === "1:1") {
      const side = Math.min(sw, sh);
      sx = (sw - side) / 2; sy = (sh - side) / 2; sw = side; sh = side;
    } else if (p.crop === "4:3") {
      if (sw / sh > 4 / 3) { const w = sh * 4 / 3; sx = (sw - w) / 2; sw = w; }
      else { const h = sw * 3 / 4; sy = (sh - h) / 2; sh = h; }
    }
    const rot = ((p.rot % 360) + 360) % 360;
    const cvs = document.createElement("canvas");
    cvs.width = rot % 180 ? sh : sw;
    cvs.height = rot % 180 ? sw : sh;
    const ctx = cvs.getContext("2d");
    ctx.filter = ebFilter(p);
    ctx.translate(cvs.width / 2, cvs.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
    out.push({ dataUrl: cvs.toDataURL("image/jpeg", 0.92), name: (p.path.split("\\").pop() || "photo").replace(/\.[a-z0-9]+$/i, "") + "-edited.jpg" });
  }
  return out;
}

/* ---------- stock columns: drag a header to rearrange ---------- */
// HTML5 drag on the th; the resize grip keeps its own mousedown (dragging
// from the grip is suppressed so resizing never turns into a move)
let stockDragKey = null;
$("stockList").addEventListener("dragstart", (e) => {
  const th = e.target.closest("th.sortable");
  // dragstart targets the draggable TH even when the pointer sits on the
  // grip, so asking the event where the drag began never detected a resize:
  // mid-resize the native drag took over, ate the mouseup that saves the
  // width, and could reorder columns by accident. The grip's mousedown sets
  // gripDrag before any dragstart can fire — that is the real signal.
  if (gripDrag || !th || !stockColOrder.includes(th.dataset.sort)) { e.preventDefault(); return; }
  stockDragKey = th.dataset.sort;
  e.dataTransfer.effectAllowed = "move";
  try { e.dataTransfer.setData("text/plain", stockDragKey); } catch { /* some drivers need it */ }
});
$("stockList").addEventListener("dragover", (e) => {
  const th = e.target.closest("th.sortable");
  if (!th || !stockDragKey || !stockColOrder.includes(th.dataset.sort)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  document.querySelectorAll(".stock-table th.col-drop").forEach(x => x.classList.remove("col-drop"));
  if (th.dataset.sort !== stockDragKey) th.classList.add("col-drop");
});
$("stockList").addEventListener("dragleave", (e) => {
  const th = e.target.closest("th.sortable");
  if (th) th.classList.remove("col-drop");
});
$("stockList").addEventListener("drop", (e) => {
  const th = e.target.closest("th.sortable");
  if (!th || !stockDragKey) return;
  e.preventDefault();
  const to = th.dataset.sort;
  if (stockColOrder.includes(to) && to !== stockDragKey) {
    const arr = stockColOrder.filter(k => k !== stockDragKey);
    arr.splice(arr.indexOf(to) + (arr.indexOf(to) < stockColOrder.indexOf(stockDragKey) ? 0 : 1), 0, stockDragKey);
    stockColOrder = arr;
    localStorage.setItem("stockColOrder", JSON.stringify(stockColOrder));
    renderStock();
  }
  stockDragKey = null;
});
$("stockList").addEventListener("dragend", () => {
  stockDragKey = null;
  document.querySelectorAll(".stock-table th.col-drop").forEach(x => x.classList.remove("col-drop"));
});

/* ---------- rename a Linnworks SKU (stock hover tray pencil) ---------- */
let rnCtx = null;
function openRenameDialog(sku, stockItemId) {
  rnCtx = { sku, stockItemId };
  $("rnOld").textContent = sku;
  $("rnNew").value = sku;
  $("rnErr").hidden = true;
  $("renameDialog").showModal();
  $("rnNew").focus();
  $("rnNew").select();
}
$("rnCancel").addEventListener("click", () => $("renameDialog").close());
// delete lives here too (owner 2026-09-16) — it hands off to the existing
// guarded delete dialog, which live-checks linked listings and warns
$("rnDelete").addEventListener("click", () => {
  if (!rnCtx) return;
  const { sku, stockItemId } = rnCtx;
  $("renameDialog").close();
  openStockDelete(sku, stockItemId);
});
$("rnNew").addEventListener("input", () => { $("rnNew").value = $("rnNew").value.toUpperCase(); });
$("rnNew").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("rnSave").click(); } });
$("rnSave").addEventListener("click", async () => {
  if (!rnCtx) return;
  const next = $("rnNew").value.trim().toUpperCase();
  $("rnSave").disabled = true;
  const res = await api.stockRenameSku(rnCtx.stockItemId, rnCtx.sku, next).catch(err => ({ ok: false, error: err.message }));
  $("rnSave").disabled = false;
  if (!res || !res.ok) {
    $("rnErr").textContent = (res && res.error) || "Rename failed.";
    $("rnErr").hidden = false;
    return;
  }
  // local caches follow immediately; the grid reloads for everything else
  if (stockCache) {
    const it = stockCache.items.find(i => i.sku === rnCtx.sku);
    if (it) it.sku = res.sku;
  }
  if (recvBySku && recvBySku.has(rnCtx.sku.toLowerCase())) {
    const it = recvBySku.get(rnCtx.sku.toLowerCase());
    recvBySku.delete(rnCtx.sku.toLowerCase());
    it.sku = res.sku;
    recvBySku.set(res.sku.toLowerCase(), it);
  }
  $("renameDialog").close();
  const oldSku = rnCtx.sku;
  const sid = rnCtx.stockItemId;
  pushUndo(`rename ${res.sku} back to ${oldSku}`, async () => {
    const r = await api.stockRenameSku(sid, res.sku, oldSku);
    if (!r || !r.ok) throw new Error((r && r.error) || 'Rename back failed');
    loadStock();
  });
  toast(`${oldSku} renamed to ${res.sku} — links and history followed`);
  rnCtx = null;
  loadStock();
});

/* ---------- returns-history import (owner 2026-09-09) ---------- */
// pick the sheet -> parse preview -> Linnworks lookups (progress bar) ->
// one Import press writes the entries. Seams so e2e can stub the ipc.
let retImp = null; // { entries, stats } while the dialog is open
let retImpPick = () => api.returnsImportPick();
let retImpResolve = (entries) => api.returnsImportResolve(entries);
let retImpCommit = (entries) => api.returnsImportCommit(entries);

function retImpStatHtml(parse, resolve) {
  const li = (txt) => `<div class="retimp-line">${txt}</div>`;
  let h = li(`<b>${parse.rows}</b> rows → <b>${parse.entries}</b> entries · <b>${parse.units}</b> units`);
  if (parse.skippedDup) h += li(`${parse.skippedDup} already in the log — skipped`);
  if (parse.noPo) h += li(`${parse.noPo} without a PO# — imported as unmatched`);
  if (resolve) {
    h += li(`<b>${resolve.found}</b> of ${resolve.orders} orders matched in Linnworks`);
    if (resolve.trackingFilled) h += li(`tracking filled from the order on <b>${resolve.trackingFilled}</b>`);
    h += li(`SKUs: <b>${resolve.skuFromOrder}</b> from the order · <b>${resolve.skuKnown}</b> already Linnworks names`
      + (resolve.skuUnknown ? ` · <b>${resolve.skuUnknown}</b> unknown (imported as written, flagged)` : ''));
  }
  return h;
}

// the Import button is retired (owner 2026-09-14, history already in) —
// the whole flow stays wired so it can come back with one button
const retImportBtn = $('retImportBtn');
if (retImportBtn) retImportBtn.addEventListener('click', async () => {
  const picked = await retImpPick().catch(e => ({ ok: false, error: e.message }));
  if (!picked || picked.canceled) return;
  if (!picked.ok) { toast(picked.error || 'Could not read that file.'); return; }
  retImp = { entries: picked.entries, parse: picked.stats, resolve: null };
  $('retImpStats').innerHTML = retImpStatHtml(picked.stats, null);
  $('retImpNote').textContent = 'Everything imports as Open box, dated today, no stock changes.';
  $('retImpGo').disabled = true;
  const bar = $('retImpBar');
  bar.hidden = false;
  bar.querySelector('.retimp-fill').style.width = '0%';
  bar.querySelector('.retimp-bar-txt').textContent = 'Looking the orders up in Linnworks…';
  $('retImpDialog').showModal();
  const res = await retImpResolve(picked.entries).catch(e => ({ ok: false, error: e.message }));
  if (!retImp) return; // dialog was cancelled mid-lookup
  bar.hidden = true;
  if (!res || !res.ok) {
    // no Linnworks: the sheet's own data still imports, just unenriched
    $('retImpNote').textContent = `${res && res.error ? res.error + ' — ' : ''}orders not looked up; the sheet imports as-is.`;
  } else {
    retImp.entries = res.entries;
    retImp.resolve = res.stats;
    $('retImpStats').innerHTML = retImpStatHtml(retImp.parse, res.stats);
  }
  $('retImpGo').disabled = !retImp.entries.length;
});

api.on('returns:importProgress', ({ done, total }) => {
  const bar = $('retImpBar');
  if (bar.hidden || !total) return;
  bar.querySelector('.retimp-fill').style.width = `${Math.round((done / total) * 100)}%`;
  bar.querySelector('.retimp-bar-txt').textContent = `Looking the orders up in Linnworks… ${done} / ${total}`;
});

$('retImpGo').addEventListener('click', async () => {
  if (!retImp || !retImp.entries.length) return;
  $('retImpGo').disabled = true;
  $('retImpGo').textContent = 'Importing…';
  const res = await retImpCommit(retImp.entries).catch(e => ({ ok: false, error: e.message }));
  $('retImpGo').textContent = 'Import';
  if (!res || !res.ok) {
    $('retImpGo').disabled = false;
    toast((res && res.error) || 'Import failed.');
    return;
  }
  $('retImpDialog').close();
  toast(`Imported ${res.made} entries (${res.units} units)`, 4000);
  loadRetPast();
  loadUnlisted(true);
  retFixOpenIfNeeded(); // walk the condition SKUs with no listing yet
});

$('retImpCancel').addEventListener('click', () => $('retImpDialog').close());
$('retImpDialog').addEventListener('close', () => { retImp = null; });

/* ---------- missing-listings slider (owner 2026-09-09) ---------- */
// After an import, log units graded openbox/used/scrap may have no
// listing to land on. One popup walks them a SKU at a time: Create the
// suggested listing, pick an existing one, or Skip — ‹ › to move around.
// Each fix relinks every log entry of that SKU through returns:listingGaps.
let retFix = null; // { gaps, idx, tally } while the slider runs
let retFixPending = null; // gap parked while the New SKU sheet is open
let retFixGapsApi = () => api.returnsListingGaps(); // seam: e2e stubs it

async function retFixOpenIfNeeded() {
  const res = await retFixGapsApi().catch(() => null);
  if (!res || !res.ok) return;
  if (res.relinked) loadRetPast(); // mappings caught up with old entries
  if (!res.gaps.length) return;
  retFix = { gaps: res.gaps, idx: 0, tally: { created: 0, picked: 0, skipped: 0 } };
  ensureInventory(); // the pick combo and create suggestions want it
  retFixShow();
}

const retFixCur = () => (retFix ? retFix.gaps[retFix.idx] : null);
const retFixLeft = () => (retFix ? retFix.gaps.filter(g => !g.state) : []);

function retFixShow() {
  if (!retFix) return;
  const total = retFix.gaps.length;
  const handled = total - retFixLeft().length;
  const done = !retFixLeft().length;
  $('retFixBody').hidden = done;
  $('retFixDone').hidden = !done;
  $('retFixCreate').hidden = done;
  $('retFixSkip').hidden = done;
  $('retFixClose').hidden = !done;
  $('retFixPrev').disabled = done;
  $('retFixNext').disabled = done;
  $('retFixFill').style.width = `${Math.round((handled / total) * 100)}%`;
  $('retFixIcon').textContent = done ? '✓' : '!';
  $('retFixIcon').classList.toggle('is-done', done);
  if (done) {
    const t = retFix.tally;
    $('retFixN').textContent = `${total} / ${total}`;
    $('retFixDoneH').textContent = `All ${total} handled`;
    $('retFixTally').innerHTML = [
      t.created ? `<span class="retfix-chip is-created">${t.created} created</span>` : '',
      t.picked ? `<span class="retfix-chip is-picked">${t.picked} picked</span>` : '',
      t.skipped ? `<span class="retfix-chip is-skipped">${t.skipped} skipped</span>` : '',
    ].join('');
  } else {
    const g = retFixCur();
    $('retFixN').textContent = `${retFix.idx + 1} / ${total}`;
    $('retFixSku').textContent = g.sku;
    $('retFixCond').innerHTML = `<span class="ret-cond-ro is-${esc(g.condition)}"><span class="ret-dd-dot is-${esc(g.condition)}"></span>${esc(retCondLabel(g.condition))}</span>`;
    $('retFixCtx').textContent = [`${g.units} unit${g.units === 1 ? '' : 's'}`,
      g.entries > 1 ? `${g.entries} entries` : '', g.customer].filter(Boolean).join(' · ');
    const suggested = retSuggestCondSku(g.sku, g.condition);
    const canCreate = !!RET_PREFIX[g.condition] && !(recvLookup === 'ready' && recvLookupExact(suggested));
    $('retFixCreate').hidden = !canCreate;
    $('retFixCreate').innerHTML = `＋ Create <span class="mono">${esc(suggested)}</span>`;
    $('retFixCreate').dataset.sku = suggested;
    $('retFixPick').value = '';
  }
  if (!$('retFixDialog').open) $('retFixDialog').showModal();
}

// move to the nearest unhandled gap, searching forward (dir 1) or back
function retFixStep(dir) {
  if (!retFix) return;
  const n = retFix.gaps.length;
  for (let k = 1; k <= n; k++) {
    const i = (retFix.idx + dir * k + n * k) % n;
    if (!retFix.gaps[i].state) { retFix.idx = i; break; }
  }
  retFixShow();
}

function retFixSettle(state) {
  const g = retFixCur();
  if (!g || g.state) return;
  g.state = state;
  retFix.tally[state === 'created' ? 'created' : state === 'picked' ? 'picked' : 'skipped']++;
  retFixStep(1);
}

$('retFixPrev').addEventListener('click', () => retFixStep(-1));
$('retFixNext').addEventListener('click', () => retFixStep(1));
$('retFixSkip').addEventListener('click', () => retFixSettle('skipped'));

$('retFixCreate').addEventListener('click', () => {
  const g = retFixCur();
  if (!g) return;
  retFixPending = g;
  $('retFixDialog').close(); // the New SKU sheet takes the stage
  openCondSkuCreate(g.sku, g.condition, $('retFixCreate').dataset.sku, async () => {
    retFixPending = null;
    if (!retFix) return;
    await retFixGapsApi().catch(() => {}); // relink this SKU's log entries
    loadRetPast();
    retFixSettle('created');
  });
});

// the New SKU sheet closed without creating: bring the slider back where
// it was (the created path clears retFixPending before this timer looks)
$('skuDialog').addEventListener('close', () => {
  if (!retFix || !retFixPending) return;
  setTimeout(() => {
    if (retFix && retFixPending) { retFixPending = null; retFixShow(); }
  }, 250);
});

makeCombo($('retFixPick'), document.querySelector('.retfix-combo .combo-list'), async (item) => {
  const g = retFixCur();
  if (!g) return;
  const map = await api.returnsMapSet(g.sku, g.condition, item.sku);
  if (!map.ok) { toast(map.error || 'Could not save the mapping.'); return; }
  toast(`${g.sku} ${g.condition} → ${map.targetSku}`);
  await retFixGapsApi().catch(() => {}); // relink this SKU's log entries
  loadRetPast();
  retFixSettle('picked');
});

$('retFixClose').addEventListener('click', () => $('retFixDialog').close());
$('retFixDialog').addEventListener('close', () => {
  // parked for the New SKU sheet = still running, everything else ends it
  if (!retFixPending) retFix = null;
});

/* ---------- page refresh buttons (Returns + eBay), mirroring Stock ---------- */
$("retRefreshBtn").addEventListener("click", () => {
  loadRetPast();
  loadUnlisted(true); // fresh scan: cards update the moment it lands
  toast("Refreshing the log and listing scan…", 2000);
});
$("ebRefresh").addEventListener("click", () => {
  chLinked = null;
  loadChLinked();
  loadUnlisted(true);
  toast("Re-scanning listings…", 2000);
});

/* ==================== Overview tab ==================== */
// Three columns (owner 2026-09-22; approved design variants/overview-3col.html,
// C1, with Sold moved to the left): Sold today (every SKU and its units,
// Excel-style), Send to WFS (with Send | Ignore per SKU and the shipments on
// their way), Running low (with an order quantity from the sales pace).

let ovData = null;
let ovFetching = false;

const OV_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const OV_WDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ovTone = (days) => days < 5 ? 'r' : days < 10 ? 'a' : 'g';
const ovShortDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${OV_MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
};

function enterOverview() {
  const d = new Date();
  $('ovDate').textContent = `${OV_WDAYS[d.getDay()]}, ${OV_MONTHS[d.getMonth()]} ${d.getDate()}`;
  ovRenderAll();
  ovFetch();
}

async function ovFetch() {
  if (ovFetching) return;
  ovFetching = true;
  try {
    const r = await api.overviewData().catch(() => null);
    if (r && r.ok) {
      ovData = r;
      if (activePage === 'overview') ovRenderAll();
    }
  } finally {
    ovFetching = false;
  }
}

// refresh every minute on the page, and right after a capture lands
setInterval(() => { if (activePage === 'overview') ovFetch(); }, 60000);
api.on('order:detected', () => { if (activePage === 'overview') setTimeout(ovFetch, 800); });
api.on('orders:imported', () => { if (activePage === 'overview') ovFetch(); });

function ovRenderAll() {
  ovRenderWfs();
  ovRenderSold();
  ovRenderLow();
  // bar widths go through the CSSOM: the CSP blocks inline style attributes
  $('ovCols').querySelectorAll('.ov-bar i[data-w]').forEach(i => { i.style.width = `${i.dataset.w}%`; });
}

function ovRenderWfs() {
  const box = $('ovWfs');
  const plan = ovData && ovData.wfsPlan;
  if (!plan || !plan.ready) {
    const err = ovData && ovData.moneyError;
    box.innerHTML = `<h4 class="ov-h-g">Send to WFS</h4><div class="ov-empty">${err ? esc(err) : 'Crunching WFS sales…'}</div>`;
    return;
  }
  const rowsHtml = plan.rows.map((r, i) => {
    const weekly = Math.round(r.perDay * 7);
    // every Walmart WFS listing that sold this item in the last 30 days, with
    // its own pace; listings with no sales in the window never show
    const chs = (r.chSkus || []).filter(c => c.sku.toUpperCase() !== r.sku.toUpperCase());
    const chHtml = chs.length
      ? `<span class="ov-meta ov-chs">${chs.map(c => `<span title="Walmart channel SKU · ${c.weekly}/wk at WFS">${esc(c.sku)} <b>${c.weekly}/wk</b></span>`).join('')}</span>`
      : '';
    return `<tr><td class="ov-rank">${i + 1}</td>
      <td><span class="ov-sku" data-ovsku="${esc(r.sku)}" title="${weekly}/wk at WFS · ${r.atWfs} at WFS${r.flightUnits ? ` · ${r.flightUnits} on the way` : ''}">${esc(r.sku)}</span>${chHtml}
        <div class="ov-bar"><i class="${ovTone(r.coverDays)}" data-w="${Math.min(100, r.coverDays / plan.triggerDays * 100)}"></i></div></td>
      <td class="rr"><span class="ov-pill ${ovTone(r.coverDays)}">Send +${r.send}</span><span class="ov-meta">${r.coverDays.toFixed(1)}d left</span></td>
      <td class="ov-actcell"><span class="ov-stack"><button class="btn btn-secondary" data-ovsend="${esc(r.sku)}">Send</button><button class="btn btn-ghost" data-ovignore="${esc(r.sku)}">Ignore</button></span></td></tr>`;
  }).join('');
  const undo = plan.ignored.length
    ? `<div class="ov-undo">${plan.ignored.length} ignored for ${plan.ignoreDays} days (${plan.ignored.map(r => esc(r.sku)).join(', ')})<a data-ovunignore>Undo</a></div>` : '';
  const badge = { pending: ['status-pending', 'Pending'], check: ['badge-parked', 'Check'], received: ['status-synced', 'Received'] };
  const onWay = plan.flight.filter(f => f.status !== 'received').reduce((a, f) => a + f.units, 0);
  const flightHtml = plan.flight.map(f => {
    const [cls, label] = badge[f.status];
    const first = f.items[0] || { sku: '' };
    const when = f.status === 'check'
      ? `sent ${ovShortDate(f.createdAt)} · check Seller Center`
      : `${f.units} sent ${ovShortDate(f.createdAt)}${f.note ? ` · ${esc(f.note)}` : ''}`;
    return `<tr><td class="ov-rank"></td>
      <td><span class="ov-sku" data-ovsku="${esc(first.sku)}">${esc(first.sku)}</span>${f.items.length > 1 ? ` <span class="ov-dim">+${f.items.length - 1} more</span>` : ''}<span class="ov-meta">${when}</span></td>
      <td class="rr"><span class="badge ov-badge ${cls}">${label}</span>
        ${f.status === 'received' ? `<a class="ov-link" data-ovunrecv="${f.id}">Undo</a>` : `<span class="ov-act"><button class="btn btn-ghost" data-ovrecv="${f.id}">Mark received</button></span>`}</td></tr>`;
  }).join('');
  box.innerHTML = `<h4 class="ov-h-g">Send to WFS</h4>
    ${plan.rows.length ? `<table class="ov-t"><tbody>${rowsHtml}</tbody></table>` : '<div class="ov-empty">Every WFS seller has enough on hand or on the way.</div>'}
    ${undo}
    ${plan.flight.length ? `<div class="ov-sec">On the way to WFS<span class="n">${onWay.toLocaleString()} units</span></div><table class="ov-t"><tbody>${flightHtml}</tbody></table>` : ''}
    <div class="ov-more">Send = WFS pace × ${plan.targetDays} days − at WFS − on the way</div>`;
}

function ovRenderSold() {
  const box = $('ovSold');
  const sold = ovData && ovData.sold;
  const today = ovData && ovData.orders && ovData.orders.today;
  if (!sold) {
    box.innerHTML = `<div><div class="k">Units sold today</div><div class="ov-empty">${ovData ? 'Could not reach Linnworks for today’s orders.' : 'Loading today…'}</div></div>`;
    return;
  }
  const grid = sold.rows.length
    ? `<div class="ov-xgrid ov-xgrid-full ov-soldgrid">
        <div class="ov-xhead"><span class="xrn">#</span><span>SKU</span><span>Units</span></div>
        ${sold.rows.map((r, i) => `<div class="ov-feedrow"><span class="xrn">${i + 1}</span><span class="xsku" title="${esc(r.sku)}" data-ovsku="${esc(r.sku)}">${esc(r.sku)}</span><span class="xu">${r.units}</span></div>`).join('')}
        <div class="ov-feedrow tot"><span class="xrn"></span><span>Total · ${sold.rows.length} SKU${sold.rows.length === 1 ? '' : 's'}</span><span class="xu">${sold.units}</span></div>
      </div>`
    : '<div class="ov-empty">Nothing sold yet today.</div>';
  const chans = [['walmart', 'Walmart'], ['ebay', 'eBay'], ['temu', 'Temu']];
  box.innerHTML = `
    <div><div class="k">Units sold today</div>
      <div class="big mono">${sold.units.toLocaleString()}</div>
      <div class="delta">${today ? `${today.total} order${today.total === 1 ? '' : 's'} · ` : ''}${sold.rows.length} SKU${sold.rows.length === 1 ? '' : 's'}</div></div>
    ${grid}
    <div class="ov-chcells">${chans.map(([k, n]) => `
      <div class="ov-chcell"><div class="cn cn-${k}">${n}</div><div class="cv">${((sold.byChannel || {})[k] || 0).toLocaleString()}</div></div>`).join('')}
    </div>`;
}

function ovRenderLow() {
  const box = $('ovLow');
  const m = ovData && ovData.money;
  if (!m || !m.low) {
    const err = ovData && ovData.moneyError;
    box.innerHTML = `<h4 class="ov-h-a">Running low</h4><div class="ov-empty">${err ? esc(err) : 'Crunching the sales history…'}</div>`;
    return;
  }
  const total = m.low.reduce((a, r) => a + r.order, 0);
  const rows = m.low.map(r => {
    const meta = [`${r.avail} on shelf`, r.atWfs ? `${r.atWfs} at WFS` : '', `${r.perDay.toFixed(1)}/day`, `out ~${esc(r.outOn)}`].filter(Boolean).join(' · ');
    return `<tr><td><span class="ov-sku" data-ovsku="${esc(r.sku)}">${esc(r.sku)}</span><span class="ov-meta">${meta}${r.faster ? ' · <span class="ov-faster">selling faster</span>' : ''}</span>
        <div class="ov-bar"><i class="${ovTone(r.daysLeft)}" data-w="${Math.min(100, r.daysLeft / m.leadDays * 100)}"></i></div></td>
      <td class="rr"><span class="ov-pill a">${r.order}</span><span class="ov-meta">${r.daysLeft}d left</span></td></tr>`;
  }).join('');
  box.innerHTML = `<h4 class="ov-h-a">Running low · order ${total.toLocaleString()}<span class="sub">${m.leadDays}-day lead time</span></h4>
    ${m.low.length ? `<table class="ov-t"><tbody>${rows}</tbody></table>` : '<div class="ov-empty">Nothing runs out inside the lead time.</div>'}
    ${m.lowCount > m.low.length ? `<div class="ov-more">+ ${m.lowCount - m.low.length} more — <a data-ovlow>open Stock</a></div>` : ''}
    <div class="ov-more">Order = daily pace × (${m.leadDays}-day lead + ${m.coverDays} days) − stock · <a data-ovlow>open Stock</a></div>`;
}

// SKU click-through: Stock page filtered to that SKU (search prefilled after
// the page's settle-enter clears it)
function ovOpenStock(sku, lowView) {
  stockUnlistedActive = false;
  stockWfsActive = false;
  stockLowActive = !!lowView;
  stockDsActive = false;
  stockActiveView = null;
  showPage('stock');
  setTimeout(() => {
    if (activePage !== 'stock') return;
    $('stockSearch').value = sku || '';
    $('stockSearchClear').hidden = !sku;
    renderStockChips();
    renderStock();
  }, 260);
}

// Send: the Stock page with the WFS Shipments dialog pre-filled; saving
// there returns here, where the shipment shows as Pending
function ovSendToWfs(sku) {
  const r = ((ovData && ovData.wfsPlan && ovData.wfsPlan.rows) || []).find(x => x.sku === sku);
  if (!r) return;
  showPage('stock');
  setTimeout(() => {
    if (activePage !== 'stock') return;
    openWfs({
      lines: [{ sku: r.sku, gtin: r.gtin, qty: r.send }],
      note: (r.chSkus || []).length ? `WFS: ${r.chSkus.map(c => c.sku).join(', ')}` : '',
      from: `From Overview · ${r.sku} sells ${Math.round(r.perDay * 7)}/wk at WFS and has ${r.coverDays.toFixed(1)} days there${r.flightUnits ? ' counting what is on the way' : ''} — ${r.send} brings it to ${ovData.wfsPlan.targetDays} days`,
    });
  }, 300);
}

$('ovCols').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-ovsend],[data-ovignore],[data-ovunignore],[data-ovrecv],[data-ovunrecv],[data-ovsku],[data-ovlow]');
  if (!t) return;
  if (t.dataset.ovsend) { ovSendToWfs(t.dataset.ovsend); return; }
  if (t.dataset.ovsku !== undefined) { if (t.dataset.ovsku) ovOpenStock(t.dataset.ovsku); return; }
  if (t.hasAttribute('data-ovlow')) { ovOpenStock('', true); return; }
  if (t.dataset.ovignore) {
    const r = ovData.wfsPlan.rows.find(x => x.sku === t.dataset.ovignore);
    await api.wfsIgnore(t.dataset.ovignore, r ? r.perDay : 0);
  } else if (t.hasAttribute('data-ovunignore')) {
    await api.wfsUnignore();
  } else if (t.dataset.ovrecv) {
    await api.wfsReceived(Number(t.dataset.ovrecv), true);
  } else if (t.dataset.ovunrecv) {
    await api.wfsReceived(Number(t.dataset.ovunrecv), false);
  }
  await ovFetch();
});

$('tabOverview').addEventListener('click', () => showPage('overview'));
$('ovRefreshBtn').addEventListener('click', async () => {
  const b = $('ovRefreshBtn');
  if (b.classList.contains('is-spinning')) return;
  b.classList.add('is-spinning');
  const started = Date.now();
  await ovFetch();
  setTimeout(() => b.classList.remove('is-spinning'), Math.max(0, 700 - (Date.now() - started)));
});
// phone dashboard QR (owner request 2026-08-17)
$('ovPhoneBtn').addEventListener('click', async () => {
  const r = await api.overviewPhone().catch(() => null);
  if (!r || !r.ok) { toast((r && r.error) || 'Phone dashboard unavailable'); return; }
  // Tailscale-only by owner call (2026-08-17: the WiFi QR was unnecessary);
  // the LAN address stands in only if Tailscale is ever signed out
  $('phoneQr').src = r.tsQr || r.qr;
  $('phoneUrl').textContent = r.tsUrl || r.url;
  $('phoneQrLbl').textContent = r.tsQr ? 'Anywhere · Tailscale' : 'Shop WiFi (Tailscale is signed out)';
  $('phoneDialog').showModal();
});
$('phoneClose').addEventListener('click', () => $('phoneDialog').close());

// page-width grip, same feel as the Stock sheet's: drag the right rail, the
// centered layout grows both ways so the rail tracks the cursor at 2x
let ovDrag = null;
{
  const savedW = Number(localStorage.getItem('overviewPageWidth')) || 0;
  if (savedW) $('ovWrap').style.width = `${savedW}px`;
}
$('ovGrip').addEventListener('mousedown', (e) => {
  e.preventDefault();
  ovDrag = { startX: e.clientX, startW: $('ovWrap').offsetWidth, w: 0 };
  $('ovGrip').classList.add('is-active');
});
window.addEventListener('mousemove', (e) => {
  if (!ovDrag) return;
  const w = Math.max(900, ovDrag.startW + (e.clientX - ovDrag.startX) * 2);
  ovDrag.w = w;
  $('ovWrap').style.width = `${w}px`;
});
window.addEventListener('mouseup', () => {
  if (!ovDrag) return;
  if (ovDrag.w) localStorage.setItem('overviewPageWidth', String(ovDrag.w));
  ovDrag = null;
  $('ovGrip').classList.remove('is-active');
});
$('ovGrip').addEventListener('dblclick', () => {
  localStorage.removeItem('overviewPageWidth');
  $('ovWrap').style.width = '';
});

/* ==================== Temu lister tab ==================== */
// Fill Temu's own upload workbook from NEW in-stock SKUs (Temu sells new
// only). Approved design: variants/temu-lister.html — the eBay three-panel
// skeleton with an upload-sheet preview instead of a buyer preview.

let tmCur = null;
let tmState = { hasTemplate: false, template: null, profiles: {}, packages: {} };
let tmClaimed = {};
try { tmClaimed = JSON.parse(localStorage.getItem("temuClaimed") || "{}"); } catch { /* fresh start */ }
let tmDrafts = {};
try { tmDrafts = JSON.parse(localStorage.getItem("temuDrafts") || "{}"); } catch { /* fresh start */ }

// Temu's fixed menus for phones (24388) and tablets (4080) — copied from the
// template's dropdown sheets; the export writes these exact strings
const TM_COLORS = ["Black", "White", "Red", "Orange", "Yellow", "Green", "Blue"];
const TM_COLOR_MAP = { BLACK: "Black", JETBLACK: "Black", JBLK: "Black", BLK: "Black", GRAPHITE: "Black", GRAY: "Black", GREY: "Black", TITANIUM: "Black", PHANTOM: "Black", WHITE: "White", SILVER: "White", CREAM: "White", BEIGE: "White", GOLD: "White", PLATINUM: "White", SHADOW: "White", RED: "Red", BURGUNDY: "Red", CORAL: "Red", PINK: "Red", ROSE: "Red", ORANGE: "Orange", PEACH: "Orange", YELLOW: "Yellow", LEMON: "Yellow", GREEN: "Green", MINT: "Green", LIME: "Green", OLIVE: "Green", BLUE: "Blue", NAVY: "Blue", ICYBLUE: "Blue", ICEBLUE: "Blue", SKYBLUE: "Blue", VIOLET: "Blue", PURPLE: "Blue", LAVENDER: "Blue", SILVERBLUE: "Blue" };
function tmColorFor(text) {
  const t = String(text || "").toUpperCase().replace(/[^A-Z]/g, "");
  for (const [k, v] of Object.entries(TM_COLOR_MAP)) if (t.includes(k)) return v;
  return "Black";
}
const TM_SPECS = {
  phone: [
    ["os", "OS", ["Android", "Ios"]],
    ["cell", "Cellular", ["4g", "5g", "3g", "2g", "none"]],
    ["sim", "SIM slots", ["1", "2", "0"]],
    ["power", "Power", ["USB Charging", "Battery Powered/USB Dual Use", "Battery Powered"]],
    ["battery", "Battery", ["Rechargeable Battery", "Without Battery"]],
    ["wireless", "Wireless", ["With Wi-Fi function", "Including 2.4G/3G/4G/5G and other func", "NFC"]],
  ],
  tablet: [
    ["os", "OS", ["Android", "Ios", "Windows", "Chromeos"]],
    ["cell", "Cellular", ["none", "4g", "5g", "3g", "2g"]],
    ["power", "Power", ["USB Charging", "Battery Powered/USB Dual Use", "Battery Powered"]],
    ["battery", "Battery", ["Rechargeable Battery", "Without Battery"]],
    ["wireless", "Wireless", ["With Wi-Fi function", "Including 2.4G/3G/4G/5G and other func", "NFC"]],
    ["material", "Material", ["Plastic", "Aluminum", "Aluminum Alloy", "Stainless Steel"]],
    ["age", "Age group", ["14 Years+", "18 Years+", "6 Years+", "3 Years+"]],
  ],
};
const TM_SPEC_IDS = { os: "318", cell: "162", sim: "461", power: "1067", battery: "2153", wireless: "2149", material: "1920", age: "1117" };

function tmGuessCat(sku, title) {
  const t = `${sku} ${title}`.toUpperCase();
  if (/IPAD|\bTAB\b|TABLET|SM-?[TX]\d|^[TX]\d{3}/.test(t)) return "tablet";
  return "phone";
}

/* ----- titles: template + one-typed-title-per-model memory ----- */
const tmNice = (w) => String(w || "").toLowerCase().replace(/(^|[ -])([a-z])/g, (m, a, b) => a + b.toUpperCase());
function tmTitleCtx(cur) {
  const p = ebParseSku(cur.sku);
  return {
    brand: tmNice(cur.brand || ""), model: p.model || cur.sku,
    storage: p.storage || cur.rom || "", ram: cur.ram || "",
    color: tmNice(cur.colorSrc || cur.color || ""),
    type: cur.cat === "tablet" ? "Tablet" : "Phone",
  };
}
function tmFillTitle(tpl, ctx) {
  return String(tpl || "")
    .replace(/\{brand\}/g, ctx.brand).replace(/\{model\}/g, ctx.model)
    .replace(/\{storage\}/g, ctx.storage).replace(/\{ram\}/g, ctx.ram)
    .replace(/\{color\}/g, ctx.color).replace(/\{type\}/g, ctx.type)
    .replace(/\s+/g, " ").trim();
}
function tmAutoTitle(cur) {
  const ctx = tmTitleCtx(cur);
  const learned = (tmState.titles || {})[String(ctx.model).toUpperCase()];
  if (learned) return tmFillTitle(learned, ctx);
  return tmFillTitle((tmState.profiles && tmState.profiles.titleTemplate) || "{brand} {model} {storage} {color} {type} - Brand New Sealed", ctx);
}
// a marketing title from anywhere (his live eBay listing, a typed one)
// becomes a model template: storage numbers and color words turn into tokens
function tmTemplateFromTitle(title) {
  let t = String(title || "")
    .replace(/\s*-\s*(Open Box|Used|For Parts)\s*$/i, "")
    .replace(/\b\d+\s?(GB|TB)\b/ig, "{storage}")
    .replace(/\b(black|jet ?black|white|red|orange|yellow|green|blue|gray|grey|silver|navy|graphite|gold|pink|violet|purple|mint|beige|cream|titanium|shadow)\b/ig, "{color}");
  return t.replace(/\{storage\}([\s,/]*\{storage\})+/g, "{storage}")
    .replace(/\{color\}([\s,/]*\{color\})+/g, "{color}")
    .replace(/\s+/g, " ").trim();
}

// no learned title yet: borrow the model's title from his live eBay listing
// (the same card the eBay lister copies) — fetched once, remembered for good
async function tmFetchTitle(cur) {
  const p = ebParseSku(cur.sku);
  if (!p.model) return;
  const cfg2 = await ebLoadCfg();
  let card = (cfg2.ebayModelCards || {})[p.model];
  if (!card) {
    const res = await api.ebaySpecs(p.base).catch(() => null);
    if (res && res.ok && res.title) {
      card = { title: res.title, item: res.itemId, categoryId: res.categoryId, price: res.price, specs: res.specs };
      ebCfg.ebayModelCards = { ...(ebCfg.ebayModelCards || {}), [p.model]: card };
      api.setConfig({ ebayModelCards: ebCfg.ebayModelCards }).catch(() => {});
    }
  }
  if (!card || !card.title) {
    // no listing of ours anywhere — ask the public catalog by UPC (or by a
    // model query when the item carries no barcode)
    const lk = await api.titleLookup(cur.barcode || "", `${cur.brand} ${p.model} ${p.storage}`.trim()).catch(() => null);
    if (lk && lk.ok && lk.title) card = { title: lk.title };
  }
  if (!card || !card.title || tmCur !== cur) return;
  const tpl = tmTemplateFromTitle(card.title);
  tmState.titles = { ...(tmState.titles || {}), [String(p.model).toUpperCase()]: tpl };
  api.temuTitles(p.model, tpl).catch(() => {});
  if (cur.titleAuto) {
    cur.title = tmAutoTitle(cur);
    renderTmForm();
  }
}

// a typed title teaches the model: the storage and color words become tokens
// so every sibling color/size fills the same title for itself
function tmLearnTitle(cur, title) {
  const ctx = tmTitleCtx(cur);
  let t = String(title || "").trim();
  if (!t || !ctx.model) return;
  if (ctx.storage) t = t.replace(new RegExp(ctx.storage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "{storage}");
  if (ctx.color) t = t.replace(new RegExp(ctx.color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "{color}");
  tmState.titles = { ...(tmState.titles || {}), [String(ctx.model).toUpperCase()]: t };
  api.temuTitles(ctx.model, t).catch(() => {});
}

function tmClaim(skus) {
  const now = Date.now();
  for (const s of skus) tmClaimed[String(s).toUpperCase()] = now;
  try { localStorage.setItem("temuClaimed", JSON.stringify(tmClaimed)); } catch { /* best effort */ }
}

function tmSaveDraft() {
  if (!tmCur || !tmCur.sku) return;
  tmDrafts[tmCur.sku] = JSON.parse(JSON.stringify(tmCur));
  try { localStorage.setItem("temuDrafts", JSON.stringify(tmDrafts)); } catch { /* best effort */ }
}

function tmQueueRows() {
  const out = [];
  if (!recvItems) return out;
  const cutoff = Date.now() - 14 * 86400000;
  for (const it of recvItems) {
    const lvl = (it.levels || []).find(l => l.locationId === recvLocationId) || {};
    const avail = Math.max(Number(lvl.available) || 0, Number(lvl.stockLevel) || 0);
    if (avail <= 0) continue;
    const p = ebParseSku(it.sku);
    if (p.cond) continue; // condition SKUs never appear — Temu is new-only
    if (stockViews && stockViews.some(v => stockViewMatch(it, v.pattern))) continue;
    if (chLinked && chLinked.temu && chLinked.temu.has(it.stockItemId)) continue;
    const claim = tmClaimed[String(it.sku).toUpperCase()];
    if (claim && claim > cutoff) continue;
    out.push({ sku: it.sku, stockItemId: it.stockItemId, title: it.title || "", qty: avail, cat: tmGuessCat(it.sku, it.title), barcode: it.barcode || "", price: Number(it.retailPrice) || 0 });
  }
  out.sort((a, b) => b.qty - a.qty);
  return out;
}

function renderTmQueue() {
  const box = $("tmQueue");
  const rows = tmQueueRows();
  box.innerHTML = !recvItems
    ? `<div class="ebay-qempty">Loading the inventory…</div>`
    : rows.length === 0
      ? `<div class="ebay-qempty">Every new in-stock SKU already has a Temu listing.</div>`
      : rows.map(r => `
        <div class="ebay-qrow ${tmCur && tmCur.sku === r.sku ? "is-on" : ""}" data-tmq="${esc(r.sku)}">
          <span class="ebay-qsku mono">${esc(r.sku)}</span>
          <span class="ebay-qmeta"><span class="ebay-qcond c-new">${r.cat === "tablet" ? "Tablet" : "Phone"}</span> ${r.qty} unit${r.qty === 1 ? "" : "s"}${tmDrafts[r.sku] ? " · <b>draft</b>" : ""}</span>
        </div>`).join("");
}

// siblings: same model, NEW, still in the queue — pre-filled as variations
function tmSiblings(sku) {
  const p = ebParseSku(sku);
  if (!p.model) return [];
  return tmQueueRows().filter(r => {
    if (r.sku === sku) return false;
    const ps = ebParseSku(r.sku);
    return ps.model === p.model;
  }).map(r => {
    const ps = ebParseSku(r.sku);
    return { sku: r.sku, stockItemId: r.stockItemId, rom: ps.storage || "", color: tmColorFor(ps.color || r.sku), colorSrc: ps.color || "", qty: r.qty, price: "", auto: true, barcode: r.barcode };
  });
}

function tmSelect(sku, fresh) {
  const item = recvBySku && recvBySku.get(String(sku).toLowerCase());
  const draft = !fresh && tmDrafts[sku];
  if (draft) { tmCur = JSON.parse(JSON.stringify(draft)); renderTmQueue(); renderTmForm(); return; }
  const p = ebParseSku(sku);
  const cat = tmGuessCat(sku, (item && item.title) || "");
  const title = ""; // filled from the template below (Linnworks titles are empty here)
  const apple = /IPAD|IPHONE|APPLE/i.test(`${sku} ${title}`);
  const five = /5G/i.test(`${sku} ${title}`);
  const model = p.model || sku;
  const pack = (tmState.packages || {})[String(model).toUpperCase()] || {};
  tmCur = {
    sku, stockItemId: (item && item.stockItemId) || "", scratch: !item,
    cat, title, brand: apple ? "APPLE" : "SAMSUNG", origin: "Vietnam",
    os: apple ? "Ios" : "Android",
    cell: cat === "tablet" ? (five ? "5g" : /LTE|CELL/i.test(`${sku} ${title}`) ? "4g" : "none") : (five ? "5g" : "4g"),
    sim: "1", power: "USB Charging", battery: "Rechargeable Battery",
    wireless: "With Wi-Fi function", material: "Plastic", age: "14 Years+",
    ram: cat === "tablet" ? "4GB" : "8GB", rom: p.storage || "64GB",
    color: tmColorFor(p.color || sku), colorSrc: p.color || "",
    base: item && item.retailPrice ? String(item.retailPrice) : "", list: "",
    qty: "", photos: [], vars: tmSiblings(sku),
    barcode: (item && item.barcode) || "",
  };
  const lvl = item && (item.levels || []).find(l => l.locationId === recvLocationId);
  if (lvl) tmCur.qty = String(Math.max(Number(lvl.available) || 0, Number(lvl.stockLevel) || 0));
  tmCur.title = tmAutoTitle(tmCur);
  tmCur.titleAuto = true; // regenerates while untouched; a typed title wins
  renderTmQueue();
  renderTmForm();
  // no saved title for this model yet: borrow it from his live eBay listing
  const modelKey = String(ebParseSku(sku).model || "").toUpperCase();
  if (modelKey && !(tmState.titles || {})[modelKey] && !tmCur.scratch) tmFetchTitle(tmCur);
}

function tmRows() { // upload-sheet rows: primary first, then included siblings
  if (!tmCur) return [];
  const ram = tmCur.ram || "8GB";
  const rows = [{
    sku: tmCur.sku, stockItemId: tmCur.stockItemId, color: tmCur.color,
    ramrom: `${ram}+${tmCur.rom || "64GB"}`, qty: tmCur.qty, base: tmCur.base,
    list: tmCur.list, barcode: tmCur.barcode,
  }];
  for (const v of tmCur.vars || []) {
    rows.push({
      sku: v.sku, stockItemId: v.stockItemId, color: v.color,
      ramrom: `${ram}+${v.rom || tmCur.rom || "64GB"}`, qty: v.qty,
      base: v.price || tmCur.base, list: tmCur.list, barcode: v.barcode,
    });
  }
  return rows;
}

function renderTmForm() {
  const has = !!tmCur;
  $("tmSku").value = has ? tmCur.sku : "";
  $("tmSku").readOnly = !(has && tmCur.scratch && !tmCur.sku);
  $("tmTitle").value = has ? tmCur.title : "";
  $("tmTitleHint").textContent = !has ? ""
    : tmCur.titleAuto
      ? ((tmState.titles || {})[String(ebParseSku(tmCur.sku).model || "").toUpperCase()]
        ? "from the saved title for this model — edit to reteach it"
        : "from the title template (⚙) — type once and this model remembers")
      : "your title — saved for every future " + esc(ebParseSku(tmCur.sku).model || "") + " listing";
  $("tmBrand").value = has ? tmCur.brand : "SAMSUNG";
  $("tmOrigin").value = has ? tmCur.origin : "Vietnam";
  $("tmCatPhone").classList.toggle("is-on", has && tmCur.cat === "phone");
  $("tmCatTablet").classList.toggle("is-on", has && tmCur.cat === "tablet");
  // spec selects for the active category
  $("tmSpecs").innerHTML = !has ? "" : TM_SPECS[tmCur.cat].map(([key, label, opts]) => `
    <span class="ebay-spec"><label>${esc(label)}</label>
      <select class="input" data-tmspec="${key}">${opts.map(o => `<option ${tmCur[key] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></span>`).join("");
  // RAM / ROM
  const rams = ["2GB", "3GB", "4GB", "6GB", "8GB", "12GB", "16GB"];
  const roms = ["16GB", "32GB", "64GB", "128GB", "256GB", "512GB", "1TB"];
  $("tmRam").innerHTML = rams.map(r => `<option ${has && tmCur.ram === r ? "selected" : ""}>${r}</option>`).join("");
  $("tmRom").innerHTML = roms.map(r => `<option ${has && tmCur.rom === r ? "selected" : ""}>${r}</option>`).join("");
  $("tmColor").innerHTML = TM_COLORS.map(c => `<option ${has && tmCur.color === c ? "selected" : ""}>${c}</option>`).join("");
  $("tmColorHint").textContent = has && tmCur.colorSrc && tmColorFor(tmCur.colorSrc) === tmCur.color
    ? `${tmCur.colorSrc} → ${tmCur.color} (nearest Temu color — only 7 allowed)` : "Temu allows only these 7 colors";
  $("tmBase").value = has ? tmCur.base : "";
  $("tmList").value = has ? tmCur.list : "";
  $("tmQty").value = has ? tmCur.qty : "";
  const model = has ? (ebParseSku(tmCur.sku).model || tmCur.sku) : "";
  const pack = (tmState.packages || {})[String(model).toUpperCase()] || {};
  if (has) {
    if (!$("tmWt").value && pack.weightLb) $("tmWt").value = pack.weightLb;
    if (!$("tmLen").value && pack.lenIn) $("tmLen").value = pack.lenIn;
    if (!$("tmWid").value && pack.widIn) $("tmWid").value = pack.widIn;
    if (!$("tmHei").value && pack.heiIn) $("tmHei").value = pack.heiIn;
  } else {
    ["tmWt", "tmLen", "tmWid", "tmHei"].forEach(id => { $(id).value = ""; });
  }
  $("tmPackHint").textContent = has ? `saved for ${model} — reused next time` : "saved per model — reused next time";
  // variations
  $("tmVars").innerHTML = !has ? "" : (tmCur.vars || []).map((v, vi) => `
    <span class="ebay-varcard is-auto">
      <span class="vline"><span>${v.colorSrc ? `<span class="tm-cmap-from">${esc(v.colorSrc)}</span>` : ""}${esc(v.color)} · ${esc(v.rom || "")}</span><span class="vsku is-ok">${esc(v.sku)}</span>
        <select class="input eb-w76" data-tmvcolor="${vi}" title="Temu color for this variation">${TM_COLORS.map(c => `<option ${v.color === c ? "selected" : ""}>${c}</option>`).join("")}</select>
        <input data-tmvprice="${vi}" value="${esc(v.price)}" placeholder="${esc(tmCur.base || "price")}" title="Base price for this variation (blank = the listing price)" class="input mono eb-w76" />
        <input data-tmvqty="${vi}" value="${esc(v.qty)}" title="Units" class="input mono eb-w50" /></span>
      <button class="ebay-varx" data-tmvarx="${vi}" title="Not this one — it keeps its own place in the queue">✕</button>
    </span>`).join("")
    + ((tmCur.vars || []).length ? `<span class="ebay-fhint">siblings from the queue auto-filled — ✕ ejects one; exporting removes every included SKU from the queue</span>` : `<span class="ebay-fhint">no queue siblings for this model — single-SKU product</span>`);
  // photos (shared across the variations; painted via CSSOM — CSP)
  $("tmShots").innerHTML = !has ? "" : (tmCur.photos || []).map((p, i) => `
    <span class="ebay-shot ${i === 0 ? "is-main" : ""}" data-tmshoti="${i}"><button class="x" data-tmshotx="${i}">✕</button></span>`).join("")
    + `<button class="qrbtn" id="tmShotQr" title="Shoot on the phone — QR for this draft">${ICONS.camera}</button>`
    + `<button class="ebay-addbtn eb-m0" id="tmShotAdd">add photos</button>`;
  if (has) {
    document.querySelectorAll("#tmShots .ebay-shot[data-tmshoti]").forEach(el => {
      const p = tmCur.photos[Number(el.dataset.tmshoti)];
      if (p) el.style.backgroundImage = `url("file:///${String(p.path).replace(/\\/g, "/").replace(/"/g, "")}")`;
    });
  }
  renderTmSheet();
  const missing = [];
  if (has && !tmState.hasTemplate) missing.push("no template picked yet (⚙)");
  if (has && !(tmCur.photos || []).length) missing.push("no photos yet");
  if (has && (!tmCur.base || !tmCur.list)) missing.push("base + list price required");
  if (has && !($("tmWt").value && $("tmLen").value && $("tmWid").value && $("tmHei").value)) missing.push("package weight + size required");
  $("tmExportNote").textContent = has && missing.length ? missing.join(" · ") : "";
  $("tmSavedNote").textContent = has && tmCur.sku ? "draft saved" : "";
  $("tmExport").disabled = !has;
  tmHistPush(); // every rendered state is one undo step
  tmSaveDraft();
}

/* ----- undo / redo across the Temu form, mirroring the eBay lister ----- */
let tmHist = [];
let tmHistIdx = -1;
let tmHistNav = false;
function tmHistBtns() {
  $("tmUndo").disabled = tmHistIdx <= 0;
  $("tmRedo").disabled = tmHistIdx >= tmHist.length - 1;
}
function tmHistPush() {
  if (!tmCur || tmHistNav) { tmHistBtns(); return; }
  const snap = JSON.stringify(tmCur);
  if (tmHist[tmHistIdx] === snap) { tmHistBtns(); return; }
  tmHist = tmHist.slice(0, tmHistIdx + 1);
  tmHist.push(snap);
  tmHistIdx++;
  tmHistBtns();
}
function tmHistGo(delta) {
  const next = tmHistIdx + delta;
  if (next < 0 || next >= tmHist.length) return;
  tmHistIdx = next;
  tmHistNav = true;
  tmCur = JSON.parse(tmHist[next]);
  renderTmQueue();
  renderTmForm();
  tmHistNav = false;
  tmSaveDraft();
  tmHistBtns();
}

function renderTmSheet() {
  const rows = tmRows();
  $("tmSheetN").textContent = tmCur ? `1 product · ${rows.length} row${rows.length === 1 ? "" : "s"}` : "";
  $("tmSheet").innerHTML = !tmCur
    ? `<div class="tm-sheet-empty">Pick a SKU from the queue, or press New listing.</div>`
    : `<table><tr><th>Contribution SKU</th><th>Color</th><th>RAM+ROM</th><th>Qty</th><th>Base $</th><th>List $</th></tr>
      ${rows.map(r => `<tr><td>${esc(r.sku)}</td><td>${esc(r.color)}</td><td>${esc(r.ramrom)}</td><td>${esc(r.qty)}</td><td>${esc(r.base)}</td><td>${esc(r.list)}</td></tr>`).join("")}</table>`;
}

function enterTemu() {
  api.temuState().then(s => { if (s && s.ok) tmState = s; renderTmForm(); }).catch(() => {});
  Promise.all([ensureInventory(), loadStockViews()]).then(() => { renderTmQueue(); if (tmCur) renderTmForm(); });
  loadChLinked();
  renderTmQueue();
  renderTmForm();
}

$("tmQueue").addEventListener("click", (e) => {
  const row = e.target.closest("[data-tmq]");
  if (row) tmSelect(row.dataset.tmq, false);
});
$("tmRefresh").addEventListener("click", () => {
  chLinked = null;
  loadChLinked();
  ensureInventory().then(renderTmQueue);
  toast("Re-scanning the Temu link set…", 2000);
});
$("tmScratch").addEventListener("click", () => {
  tmCur = { sku: "", stockItemId: "", scratch: true, cat: "phone", title: "", brand: "SAMSUNG", origin: "Vietnam", os: "Android", cell: "4g", sim: "1", power: "USB Charging", battery: "Rechargeable Battery", wireless: "With Wi-Fi function", material: "Plastic", age: "14 Years+", ram: "8GB", rom: "64GB", color: "Black", colorSrc: "", base: "", list: "", qty: "", photos: [], vars: [], barcode: "" };
  renderTmQueue();
  renderTmForm();
  $("tmSku").readOnly = false;
  $("tmSku").placeholder = "type any SKU — new items only";
  $("tmSku").focus();
});
$("tmSku").addEventListener("change", () => {
  if (!tmCur || !tmCur.scratch) return;
  const sku = $("tmSku").value.trim().toUpperCase();
  if (sku) tmSelect(sku, true);
});
$("tmDiscard").addEventListener("click", () => {
  if (!tmCur) return;
  const sku = tmCur.sku;
  if (sku) {
    delete tmDrafts[sku];
    try { localStorage.setItem("temuDrafts", JSON.stringify(tmDrafts)); } catch { /* best effort */ }
  }
  if (sku && !tmCur.scratch) tmSelect(sku, true);
  else { tmCur = null; renderTmQueue(); renderTmForm(); }
});
document.querySelectorAll("[data-tmcat]").forEach(btn => btn.addEventListener("click", () => {
  if (!tmCur) { toast("Pick a SKU from the queue first, or press New listing."); return; }
  tmCur.cat = btn.dataset.tmcat;
  if (tmCur.titleAuto) tmCur.title = tmAutoTitle(tmCur);
  renderTmForm();
}));
$("tmUndo").addEventListener("click", () => tmHistGo(-1));
$("tmRedo").addEventListener("click", () => tmHistGo(1));
document.addEventListener("keydown", (e) => {
  if (activePage !== "temu" || anyDialogOpen()) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return; // native text undo wins
  if (e.ctrlKey && e.key.toLowerCase() === "z") { e.preventDefault(); tmHistGo(-1); }
  if (e.ctrlKey && e.key.toLowerCase() === "y") { e.preventDefault(); tmHistGo(1); }
});
["tmTitle", "tmBrand", "tmOrigin", "tmBase", "tmList", "tmQty"].forEach(id => $(id).addEventListener("change", () => {
  if (!tmCur) return;
  const typed = $("tmTitle").value.trim();
  if (id === "tmTitle" && typed && typed !== tmCur.title) {
    tmCur.titleAuto = false;
    tmLearnTitle(tmCur, typed); // one typed title serves the whole model
  }
  tmCur.title = typed;
  tmCur.brand = $("tmBrand").value;
  tmCur.origin = $("tmOrigin").value;
  tmCur.base = $("tmBase").value.trim();
  tmCur.list = $("tmList").value.trim();
  tmCur.qty = $("tmQty").value.trim();
  if (tmCur.titleAuto) tmCur.title = tmAutoTitle(tmCur); // brand changes re-fill
  renderTmForm();
}));
["tmRam", "tmRom", "tmColor"].forEach(id => $(id).addEventListener("change", () => {
  if (!tmCur) return;
  tmCur.ram = $("tmRam").value;
  tmCur.rom = $("tmRom").value;
  tmCur.color = $("tmColor").value;
  if (tmCur.titleAuto) tmCur.title = tmAutoTitle(tmCur);
  renderTmForm();
}));
$("tmSpecs").addEventListener("change", (e) => {
  const sel = e.target.closest("[data-tmspec]");
  if (!sel || !tmCur) return;
  tmCur[sel.dataset.tmspec] = sel.value;
  tmSaveDraft();
});
["tmWt", "tmLen", "tmWid", "tmHei"].forEach(id => $(id).addEventListener("change", () => {
  if (!tmCur) return;
  const model = ebParseSku(tmCur.sku).model || tmCur.sku;
  const pack = { weightLb: $("tmWt").value.trim(), lenIn: $("tmLen").value.trim(), widIn: $("tmWid").value.trim(), heiIn: $("tmHei").value.trim() };
  tmState.packages = { ...(tmState.packages || {}), [String(model).toUpperCase()]: pack };
  api.temuPackages(model, pack).catch(() => {});
  renderTmForm();
}));
$("tmVars").addEventListener("click", (e) => {
  const x = e.target.closest("[data-tmvarx]");
  if (x && tmCur) { tmCur.vars.splice(Number(x.dataset.tmvarx), 1); renderTmForm(); }
});
$("tmVars").addEventListener("change", (e) => {
  if (!tmCur) return;
  const c = e.target.closest("[data-tmvcolor]");
  const p = e.target.closest("[data-tmvprice]");
  const q = e.target.closest("[data-tmvqty]");
  if (c) tmCur.vars[Number(c.dataset.tmvcolor)].color = c.value;
  if (p) tmCur.vars[Number(p.dataset.tmvprice)].price = p.value.trim();
  if (q) tmCur.vars[Number(q.dataset.tmvqty)].qty = q.value.trim();
  renderTmForm();
});
$("tmShots").addEventListener("click", async (e) => {
  if (e.target.closest("#tmShotQr") && tmCur) {
    const res = await api.ebayQr(tmCur.sku).catch(err => ({ ok: false, error: err.message }));
    if (!res || !res.ok) { toast((res && res.error) || "QR unavailable."); return; }
    $("ebQrImg").src = res.qr;
    $("ebQrSku").innerHTML = `<span class="mono">${esc(tmCur.sku)}</span>`;
    $("ebQrPop").hidden = false;
    return;
  }
  if (e.target.closest("#tmShotAdd") && tmCur) {
    const r = await api.ebayPhotosPick();
    if (r && r.files && r.files.length) {
      for (const p of r.files) tmCur.photos.push({ path: p });
      renderTmForm();
    }
    return;
  }
  const x = e.target.closest("[data-tmshotx]");
  if (x && tmCur) { tmCur.photos.splice(Number(x.dataset.tmshotx), 1); renderTmForm(); }
});
api.on("ebay:photoUploaded", ({ sku, file }) => {
  if (activePage !== "temu" || !tmCur || String(tmCur.sku).toUpperCase() !== String(sku).toUpperCase()) return;
  tmCur.photos.push({ path: file });
  renderTmForm();
  toast(`Photo from the phone added to ${sku}`, 2500);
});
$("tmGear").addEventListener("click", async () => {
  const s = await api.temuState().catch(() => null);
  if (s && s.ok) tmState = s;
  $("tmTplState").textContent = tmState.hasTemplate
    ? `Template saved: ${(tmState.template && tmState.template.name) || "temu-template.xlsx"}`
    : "No template yet — download the Cell Phones/Tablets template from Temu Seller Central (Add Products via Upload), then pick it here.";
  $("tmShipTpl").value = (tmState.profiles && tmState.profiles.shippingTemplate) || "FREE SHIPPING";
  $("tmHandling").value = (tmState.profiles && tmState.profiles.handlingTime) || "1 Day";
  $("tmTitleTpl").value = (tmState.profiles && tmState.profiles.titleTemplate) || "{brand} {model} {storage} {color} {type} - Brand New Sealed";
  $("tmGearDialog").showModal();
});
$("tmTplPick").addEventListener("click", async () => {
  const r = await api.temuTemplate();
  if (r && r.ok) {
    tmState.hasTemplate = true;
    tmState.template = { name: r.name };
    $("tmTplState").textContent = `Template saved: ${r.name} (${r.columns} columns)`;
    toast(`Temu template saved — ${r.columns} columns read`);
  } else if (r && !r.canceled) {
    toast(r.error || "That file is not a Temu template.");
  }
});
$("tmGearSave").addEventListener("click", async () => {
  const profiles = {
    shippingTemplate: $("tmShipTpl").value.trim() || "FREE SHIPPING",
    handlingTime: $("tmHandling").value,
    titleTemplate: $("tmTitleTpl").value.trim() || "{brand} {model} {storage} {color} {type} - Brand New Sealed",
  };
  tmState.profiles = profiles;
  await api.setConfig({ temuProfiles: profiles }).catch(() => {});
  $("tmGearDialog").close();
  renderTmForm();
});
$("tmGearClose").addEventListener("click", () => $("tmGearDialog").close());
$("tmUploadPage").addEventListener("click", () => api.openExternalUrl("https://seller.temu.com/"));

$("tmExport").addEventListener("click", async () => {
  if (!tmCur) return;
  if (!tmState.hasTemplate) { toast("Pick the Temu template file first (⚙)."); return; }
  if (!tmCur.sku) { toast("Type a SKU first."); return; }
  if (!tmCur.base || !tmCur.list) { toast("Base and list price are both required."); return; }
  const wt = $("tmWt").value.trim(), len = $("tmLen").value.trim(), wid = $("tmWid").value.trim(), hei = $("tmHei").value.trim();
  if (!wt || !len || !wid || !hei) { toast("Package weight and size are required."); return; }
  const specs = {};
  for (const [key] of TM_SPECS[tmCur.cat]) specs[TM_SPEC_IDS[key]] = tmCur[key];
  const photoPaths = (tmCur.photos || []).map(p => p.path);
  const variations = tmRows().map(r => ({
    sku: r.sku, goods: tmCur.sku, stockItemId: r.stockItemId, color: r.color,
    ramrom: r.ramrom, qty: r.qty || "1", base: r.base, list: r.list,
    weightLb: wt, lenIn: len, widIn: wid, heiIn: hei,
    photoPaths, upc: r.barcode,
  }));
  const product = {
    category: tmCur.cat === "tablet" ? "4080" : "24388",
    name: tmCur.title || tmCur.sku,
    brand: tmCur.brand, origin: tmCur.origin, description: "",
    variationTheme: tmCur.cat === "tablet" ? "RAM+ROM × Color" : "Color × RAM+ROM",
    specs, variations,
  };
  $("tmExport").disabled = true;
  $("tmExport").textContent = "Exporting…";
  const res = await api.temuExport([product]).catch(err => ({ ok: false, error: err.message }));
  $("tmExport").disabled = false;
  $("tmExport").textContent = "Export Temu workbook";
  if (!res || !res.ok) {
    if (!res || !res.canceled) toast((res && res.error) || "Export failed.");
    return;
  }
  const skus = variations.map(v => v.sku);
  tmClaim(skus);
  for (const s of skus) delete tmDrafts[s];
  try { localStorage.setItem("temuDrafts", JSON.stringify(tmDrafts)); } catch { /* best effort */ }
  toast(`Saved ${res.path} — upload it in Temu Seller Central. ${skus.length} SKU${skus.length === 1 ? "" : "s"} left the queue.`, 8000);
  tmCur = null;
  renderTmQueue();
  renderTmForm();
});
