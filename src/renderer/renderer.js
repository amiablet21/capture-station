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
    receivingFinish: async () => ({ ok: false, error: 'Preview mode' }),
    receivingList: async () => ({ ok: true, folder: '', sessions: [] }),
    chooseReceivingFolder: async () => ({ ok: false, folder: '' }),
    copyText: async () => ({ ok: true }),
    on: () => {},
  };
}

let state = null;
let channelFilter = 'all'; // marketplace chip on the capture list
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
  const pageEnabled = { capture: true, stock: !!pages.stock, returns: !!pages.returns };
  if (activePage !== 'capture' && (state.captureOnly || !pageEnabled[activePage])) {
    showPage('capture'); // showPage re-renders
    return;
  }
  $('tabStock').hidden = !pages.stock;
  $('tabReturns').hidden = !pages.returns;
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
        ${meta && meta.parked ? '<span class="badge badge-parked" title="Parked or locked in Linnworks — the stock router cannot move it. Unpark it in Linnworks if that is unintended.">PARKED</span>' : ''}
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

$('ordersRefreshBtn').addEventListener('click', async () => {
  const btn = $('ordersRefreshBtn');
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  await api.refreshOrders();
  await refresh();
  btn.disabled = false;
  btn.textContent = 'Refresh';
  toast('Orders refreshed from Linnworks');
});

// Walmart shipped-orders upload: tracking fills onto matching rows in bulk
$('shipImportBtn').addEventListener('click', async () => {
  const btn = $('shipImportBtn');
  btn.disabled = true;
  btn.textContent = 'Importing…';
  const res = await api.shipImport().catch(e => ({ ok: false, error: e.message }));
  btn.disabled = false;
  btn.textContent = 'Import shipped';
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
    // pane open -> the order loads beside the list; collapsed -> external browser
    if (!$('bDock').hidden) {
      bShowLoading(`Opening order ${link.dataset.po}`);
      const opened = await api.browserOpen(link.dataset.po, link.dataset.ch);
      if (!opened.ok) {
        bHideLoading();
        if (opened.error) toast(opened.error);
      }
    } else {
      api.openOrderPage(link.dataset.po, link.dataset.ch);
    }
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
  const pg = cfg.pages || {};
  $('setPageStock').checked = pg.stock !== false;
  $('setPageHistory').checked = pg.history !== false;
  $('setPageReturns').checked = !!pg.returns;
  const rcv = cfg.receiving || {};
  $('setRecvFolder').textContent = rcv.folder || 'Documents\\Capture Station\\receiving';
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
      stock: $('setPageStock').checked,
      history: $('setPageHistory').checked,
      returns: $('setPageReturns').checked,
    },
    receiving: { webhookUrl: $('setRecvWebhook').value.trim() },
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

function showPage(page) {
  activePage = page;
  if (page !== 'capture') $('findBar').hidden = true; // render() re-shows on capture
  updateScanPanel();
  $('rowsRow').hidden = page !== 'capture';
  $('stockPage').hidden = page !== 'stock';
  $('returnsPage').hidden = page !== 'returns';
  $('tabCapture').classList.toggle('is-active', page === 'capture');
  $('tabStock').classList.toggle('is-active', page === 'stock');
  $('tabReturns').classList.toggle('is-active', page === 'returns');
  if (page === 'stock') {
    const savedW = Number(localStorage.getItem('stockSheetWidth')) || 0;
    $('stockList').style.width = savedW ? `${savedW}px` : '';
    $('stockSearch').value = '';
    loadStockViews();
    loadStock().then(() => $('stockSearch').focus());
  } else if (page === 'returns') {
    const savedW = Number(localStorage.getItem('retSheetWidth')) || 0;
    $('retMain').style.width = savedW ? `${savedW}px` : '';
    enterReturns();
  } else {
    focusScan();
  }
  if (state) render(); // footer buttons depend on the active page
  if (bReady) applyBrowserPane(); // the pane only exists on the Capture page
}

$('tabCapture').addEventListener('click', () => showPage('capture'));
$('tabStock').addEventListener('click', () => showPage('stock'));
$('tabReturns').addEventListener('click', () => showPage('returns'));

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
  $('retBExpand').hidden = !(bReady && browserAllowed() && activePage === 'returns' && !bPane.visible);
  if (show) {
    dock.style.width = `${bPane.width}px`;
    if (activePage === 'capture') $('rowsMain').style.width = ''; // the sheet takes whatever remains
    else $('retMain').style.width = '';
  } else {
    // a saved width wider than the window leaves the sheet overflowing with
    // a stray horizontal scrollbar after the pane closes: clamp to the room
    // actually available, and fall back to "fill" when it does not fit
    const fit = (el, key) => {
      const saved = Number(localStorage.getItem(key)) || 0;
      const room = (el.parentElement ? el.parentElement.clientWidth : 0) - 20;
      el.style.width = saved && room > 0 && saved <= room ? `${saved}px` : '';
    };
    fit($('rowsMain'), 'captureSheetWidth');
    fit($('retMain'), 'retSheetWidth');
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

$('retBExpand').addEventListener('click', bExpandPane);

// coalesce bounds updates (resize, divider drag, dialogs) into one per frame
let bSyncQueued = false;

function syncBrowserBounds() {
  if (bSyncQueued) return;
  bSyncQueued = true;
  requestAnimationFrame(() => {
    bSyncQueued = false;
    alignCaptureToolbar(); // the find bar tracks the sheet column's edges
    // the native view yields to dialogs AND to the DOM loading panel
    if ($('bDock').hidden || anyDialogOpen() || bLoad.active) {
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
window.addEventListener('resize', () => syncBrowserBounds());

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
});

window.addEventListener('mousemove', (e) => {
  if (!bDrag) return;
  const max = Math.max(320, window.innerWidth - 380); // the sheet keeps room
  bPane.width = Math.min(max, Math.max(280, bDrag.startW + (e.clientX - bDrag.startX)));
  $('bDock').style.width = `${bPane.width}px`;
  syncBrowserBounds();
});

window.addEventListener('mouseup', () => {
  if (!bDrag) return;
  bDrag = null;
  $('bDivider').classList.remove('is-active');
  api.setConfig({ browserPane: { width: bPane.width } });
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
let stockActiveView = null; // null = All
let stockWfsActive = false; // WFS view: read-only levels at the Walmart-managed location
let stockLowActive = false; // Low stock view: Available below the minimum level
let stockDsActive = false; // DropShip program view: pads + velocity + BUY signals
let stockUnlistedActive = false; // in-stock SKUs no marketplace can sell
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
  box.innerHTML = [
    `<button class="view-chip ${stockActiveView || stockWfsActive || stockLowActive || stockDsActive || stockUnlistedActive ? '' : 'is-active'}" data-view="">All</button>`,
    ...views.map((v, i) =>
      `<button class="view-chip ${stockActiveView === v ? 'is-active' : ''}${v.tint ? ` tint-${esc(v.tint)}` : ''}" data-view="${i}" title="Show only ${esc(v.label)} items">${esc(v.label)}</button>`),
    // (the Low stock chip was removed at the owner's request 2026-08-06 —
    // the low-stock ALERTS and red Available tints stay)
    ...(wfsLoc
      ? [`<button class="view-chip ${stockWfsActive ? 'is-active' : ''}" data-view="wfs" title="Stock at ${esc(wfsLoc.name)} — Walmart-managed, read-only (fed by Walmart's own connection)">WFS</button>`]
      : []),
    ...(!state || state.captureOnly ? [] : [
      `<button class="view-chip ${stockDsActive ? 'is-active' : ''}" data-view="ds" title="The dropship program: pads, sales pace, and BUY signals">DropShip${dsPads && Object.keys(dsPads).length ? ` · ${Object.keys(dsPads).length}` : ''}</button>`,
    ]),
    // only exists while there is something to fix — in-stock SKUs no
    // marketplace can currently sell
    ...(unlistedDetail && unlistedDetail.length ? [
      `<button class="view-chip chip-unlisted ${stockUnlistedActive ? 'is-active' : ''}" data-view="unl" title="In-stock SKUs with no marketplace listing linked — value sitting idle">Unlisted · ${unlistedDetail.length}</button>`,
    ] : []),
  ].join('');
}

$('stockChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.view-chip');
  if (!chip) return;
  stockDsActive = false;
  stockUnlistedActive = false;
  if (chip.dataset.view === 'unl') {
    stockUnlistedActive = true;
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
    stockActiveView = chip.dataset.view === '' ? null : (stockViews || [])[Number(chip.dataset.view)] || null;
    if (stockSort.key === 'home') stockSort = { key: 'stockLevel', dir: -1 };
  }
  renderStockChips();
  renderStock();
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

function stockTh(key, extraClass = '', labelOverride = '') {
  const col = STOCK_COLS[key];
  const arrow = stockSort.key === key ? (stockSort.dir < 0 ? ' ▾' : ' ▴') : '';
  const w = stockColWidths[key];
  const style = w ? ` style="width:${w}px;min-width:${w}px;max-width:${w}px"` : '';
  return `<th class="sortable ${extraClass}" data-sort="${key}"${style} title="Click to sort · drag edge to resize">${labelOverride || col.label}${arrow}<span class="col-grip" data-grip="${key}"></span></th>`;
}

async function loadStock() {
  $('stockList').innerHTML = '<div class="stock-loading"><span class="spinner" aria-label="Loading"></span></div>';
  $('stockSummary').textContent = '';
  loadStockDeltas(); // day-over-day sales deltas fill in lazily, never blocking
  loadReorderStats(); // pads + velocity + Min suggestions, same lazy pattern
  loadUnlisted(); // "not listed" markers on condition SKUs holding returns
  const res = await api.getStock();
  if (!res.ok) {
    $('stockList').innerHTML = `<p class="dlg-note">${esc(res.error || 'Could not load stock.')}</p>`;
    return;
  }
  stockCache = res;
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
  if (stockDsActive) { renderDropshipView(); return; }
  if (stockUnlistedActive) { renderUnlistedView(); return; }
  const q = $('stockSearch').value.trim().toLowerCase();
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
    .filter(it => !stockActiveView || stockViewMatch(it, stockActiveView.pattern))
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
  const skuCell = (r) => `<td class="mono"><span class="sku-link" data-chsku="${esc(r.sku)}" data-chsid="${esc(r.stockItemId || '')}" title="${esc(r.title)}&#10;Click to see linked channel SKUs">${esc(r.sku)}</span>${unlistedSkus && unlistedSkus.has(String(r.sku).toUpperCase()) ? '<span class="badge-unlisted" title="Holds returned stock but no marketplace listing is linked — create the Walmart/eBay listing with EXACTLY this SKU and Linnworks links it automatically">not listed</span>' : ''}${deltaHtml(r)}<button class="btn-icon stock-sales-btn" data-salesku="${esc(r.sku)}" data-avail="${r.home ? r.home.stockLevel : r.l.available}" title="Sales history">${ICONS.chartBar}</button>${dsAdd(r)}</td>`;
  // WFS view: two columns that answer "do I need to send more?" - Walmart's
  // count (theirs, read-only) beside the warehouse count (yours, editable)
  $('stockList').innerHTML = rows.length === 0
    ? '<p class="dlg-note">No SKUs match.</p>'
    : wfsLoc
      ? `<table class="stock-table">
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
      </table>`
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
            ${imgCell(r)}
            ${skuCell(r)}
            <td class="num cell-level"><button class="stock-num-btn" data-sku="${esc(r.sku)}" title="Click to correct the count">${r.l.stockLevel}</button></td>
            <td class="num"><button class="stock-num-btn stock-io-btn" data-iosku="${esc(r.sku)}" title="Click to see the open orders for ${esc(r.sku)}">${r.l.inOrders}</button></td>
            <td class="num cell-min"><button class="stock-num-btn stock-min-btn" data-minsid="${esc(r.stockItemId || '')}" data-minsku="${esc(r.sku)}" title="Minimum level — click to edit">${r.l.minimumLevel}</button>${(() => {
              const sug = minSuggestionFor(r, r.l);
              // the suggestion IS the button: dashed = proposal, click = apply
              return sug === null ? '' : `<button class="min-apply mono" title="Suggested reorder point: ${((reorderStats[String(r.sku).toUpperCase()] || {}).perDay || 0)}/day × ${reorderMeta.leadTimeDays}d lead × 1.5 — click to set Min to ${sug}" data-applysid="${esc(r.stockItemId || '')}" data-applysku="${esc(r.sku)}" data-applymin="${sug}">→ ${sug}</button>`;
            })()}</td>
            <td class="num stock-avail ${stockIsLow(r) ? 'is-low' : ''}" ${stockIsLow(r) ? `title="Below the minimum of ${r.l.minimumLevel}"` : ''}>${r.l.available}</td>
          </tr>`).join('')}</tbody>
      </table>`;
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
}

/* ---------- Unlisted view (in-stock SKUs no marketplace can sell) ---------- */

function renderUnlistedView() {
  const aa = $('minApplyAll');
  if (aa) aa.hidden = true;
  const q = $('stockSearch').value.trim().toLowerCase();
  const rows = (unlistedDetail || []).filter(d => !q
    || d.sku.toLowerCase().includes(q)
    || (d.title || '').toLowerCase().includes(q));
  const idle = rows.reduce((s, d) => s + d.avail * d.retail, 0);
  $('stockSummary').textContent =
    `${rows.length} SKU${rows.length === 1 ? '' : 's'} in stock with no listing · ${fmtMoney(idle)} sitting idle`;
  const missChips = unlistedChannels.length
    ? unlistedChannels.map(c => `<span class="unl-chn">${esc(channelLabel(String(c).toLowerCase()) || c)} ✗</span>`).join('')
    : '<span class="unl-chn">no channels linked</span>';
  $('stockList').innerHTML = rows.length === 0
    ? '<p class="dlg-note">Nothing here — every in-stock SKU has a marketplace listing. 🎉</p>'
    : `<table class="stock-table">
      <thead><tr>
        <th class="th-gutter">#</th>
        <th class="th-img"></th>
        <th>SKU</th>
        <th class="num th-level">Avail</th>
        <th>Missing on</th>
        <th class="num">Value idle</th>
        <th class="th-actions"></th>
      </tr></thead>
      <tbody>${rows.map((d, idx) => `
        <tr>
          <td class="cell-gutter">${idx + 1}</td>
          <td class="cell-img">${d.image ? `<img class="stock-img" src="${esc(d.image)}" loading="lazy" alt="" />` : '<span class="stock-img stock-img-none"></span>'}</td>
          <td class="mono"><span title="${esc(d.title)}">${esc(d.sku)}</span></td>
          <td class="num">${d.avail}</td>
          <td>${missChips}</td>
          <td class="num mono" title="available × retail price">${d.retail ? fmtMoney(d.avail * d.retail) : '—'}</td>
          <td class="cell-actions"><button class="ret-todo-copy" data-copy="${esc(d.sku)}" title="Copy the exact SKU — create the listing with this string and Linnworks links it automatically">copy</button></td>
        </tr>`).join('')}</tbody>
    </table>
    <p class="dlg-note">Create the listing on the marketplace using <b>exactly</b> the SKU string — Linnworks links it automatically and the row leaves this view within the hour (or on restart).</p>`;
}

function fmtMoney(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString();
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
        <td class="cell-img">${it.image ? `<img class="stock-img" src="${esc(it.image)}" loading="lazy" alt="" />` : '<span class="stock-img stock-img-none"></span>'}</td>
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
  gripDrag = { key: grip.dataset.grip, startX: e.clientX, startW: th.offsetWidth, th, w: 0, storeName: 'stock' };
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
    if (gripDrag.storeName === 'capture') {
      captureColWidths[gripDrag.key] = gripDrag.w;
      localStorage.setItem('captureColWidths', JSON.stringify(captureColWidths));
    } else if (gripDrag.storeName === 'ret') {
      retColWidths[gripDrag.key] = gripDrag.w;
      localStorage.setItem('retColWidths', JSON.stringify(retColWidths));
      applyRetColsAll(); // the other returns sheet mirrors the same column
    } else {
      stockColWidths[gripDrag.key] = gripDrag.w;
      localStorage.setItem('stockColWidths', JSON.stringify(stockColWidths));
    }
    suppressSortUntil = Date.now() + 250;
  }
  gripDrag = null;
});

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
  const w = $('rowsMain').offsetWidth;
  if (!w) return;
  $('findBar').style.width = `${w}px`;
  if (!$('bDock').hidden) {
    // browser pane open: the bar hugs the order-sheet column (same left
    // edge as the sheet, past the divider), tracking pane resizes
    $('findBar').style.marginLeft = `${Math.round($('rowsMain').getBoundingClientRect().left)}px`;
    $('findBar').style.marginRight = '0';
  } else {
    $('findBar').style.marginLeft = ''; // collapsed: centered as before
    $('findBar').style.marginRight = '';
  }
}

let rowsDrag = null;
{
  const savedW = Number(localStorage.getItem('captureSheetWidth')) || 0;
  if (savedW) $('rowsMain').style.width = `${savedW}px`;
  requestAnimationFrame(alignCaptureToolbar);
}

window.addEventListener('resize', () => requestAnimationFrame(alignCaptureToolbar));

$('rowsGrip').addEventListener('mousedown', (e) => {
  e.preventDefault();
  rowsDrag = { startX: e.clientX, startW: $('rowsMain').offsetWidth, w: 0 };
  $('rowsGrip').classList.add('is-active');
});

window.addEventListener('mousemove', (e) => {
  if (!rowsDrag) return;
  const w = Math.max(560, rowsDrag.startW + (e.clientX - rowsDrag.startX));
  rowsDrag.w = w;
  $('rowsMain').style.width = `${w}px`;
  alignCaptureToolbar();
});

window.addEventListener('mouseup', () => {
  if (!rowsDrag) return;
  if (rowsDrag.w) localStorage.setItem('captureSheetWidth', String(rowsDrag.w));
  rowsDrag = null;
  $('rowsGrip').classList.remove('is-active');
});

$('rowsGrip').addEventListener('dblclick', () => {
  localStorage.removeItem('captureSheetWidth');
  $('rowsMain').style.width = '';
  requestAnimationFrame(alignCaptureToolbar);
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
  localStorage.setItem('stockColWidths', JSON.stringify(stockColWidths));
  suppressSortUntil = Date.now() + 250;
  renderStock();
});

$('stockList').addEventListener('click', (e) => {
  const cp = e.target.closest('[data-copy]');
  if (cp) { copyFromApp(cp.dataset.copy); return; }
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
  if (skuLink) { openChannelSkus(skuLink.dataset.chsku, skuLink.dataset.chsid); return; }
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
];
const RET_PREFIX = { openbox: 'OPEN-BOX-', used: 'USED-', scrap: 'SCRAP-' };

let retReceivedBy = ''; // last-used initials, config-backed default

function enterReturns() {
  $('retHint').textContent = '';
  loadRetPast();
  loadUnlisted(); // "not listed" markers on condition targets
  ensureInventory(); // the popup's SKU combos need it
  api.getConfig().then(cfg => {
    if (!retReceivedBy && cfg.returnsReceivedBy) retReceivedBy = cfg.returnsReceivedBy;
  });
}

function retCondLabel(key) {
  const c = RET_CONDS.find(x => x.key === key);
  return c ? c.label : key;
}

/* ---------- Receive-a-return popup (design-A sheet) ---------- */
// Replaces the staged worksheet: every Receive commits ONE item line through
// the unchanged returns:create engine (a PO-only line logs without stock).

let rv = null; // open popup state; null = closed

function rvBlank() {
  return {
    orderId: null, source: '', unmatched: true,
    sku: '', title: '', price: 0, targets: null, condition: 'new',
    pick: '', items: [], received: [], itemIdx: -1, busy: false,
    edit: null, // { rid, ii } = editing a log line instead of receiving
  };
}

function rvFeedback(msg, ok = false) {
  const el = $('rvFeedback');
  el.textContent = msg;
  el.hidden = !msg;
  el.className = `dlg-note test-result${msg ? (ok ? ' is-ok' : ' is-fail') : ''}`;
}

function retOpenRecv() {
  rv = rvBlank();
  for (const id of ['rvPo', 'rvCust', 'rvTrk', 'rvSku', 'rvNote', 'rvPick']) $(id).value = '';
  $('rvQty').value = '1';
  $('rvBy').value = retReceivedBy;
  $('rvThumb').hidden = true;
  $('rvMatched').hidden = true;
  $('rvDayRow').hidden = true;
  $('rvTitle').textContent = 'Receive a return';
  $('rvSave').textContent = 'Receive';
  rvFeedback('');
  rvRenderCond();
  rvRenderOrder();
  ensureInventory();
  $('retRecvDialog').showModal();
  $('rvPo').focus();
}

function rvThumbUpdate() {
  const src = rv.sku ? invImg(rv.sku) : '';
  $('rvThumb').hidden = !src;
  if (src) $('rvThumb').src = src;
}

// the SAME popup edits a log line ("more coherent that way" — owner,
// 2026-08-07, reversing the earlier edit-on-the-line preference): fields
// prefill from the row, Save runs the qty-aware stock corrections
function retOpenEdit({ r, i, ii }) {
  rv = rvBlank();
  rv.edit = { rid: r.id, ii };
  rv.unmatched = !!r.unmatched;
  rv.sku = String(i.sku || '').toUpperCase();
  rv.condition = i.condition || 'new';
  $('rvPo').value = r.order_number || '';
  $('rvCust').value = r.customer || '';
  $('rvTrk').value = r.tracking || '';
  $('rvSku').value = i.sku || '';
  $('rvQty').value = String(Number(i.qty) || 1);
  $('rvBy').value = r.received_by || '';
  $('rvNote').value = ii >= 0 ? (i.note || '') : (r.note || '');
  $('rvPick').value = '';
  $('rvDay').value = String(r.created_at).slice(0, 10);
  $('rvDayRow').hidden = false;
  $('rvMatched').hidden = true;
  $('rvTitle').textContent = 'Edit return';
  $('rvSave').textContent = 'Save changes';
  rvFeedback('');
  rvRenderOrder();
  rvThumbUpdate();
  rvRenderCond();
  // target previews for the pills; the save path re-resolves server-side
  if (rv.sku) {
    api.returnsTargets(rv.sku).then(tr => {
      if (tr.ok && rv && rv.edit) { rv.targets = tr.targets; rvRenderCond(); }
    });
  }
  ensureInventory();
  $('retRecvDialog').showModal();
}

// Enter on the PO#: processed-order lookup fills the sheet; a multi-item
// order queues its remaining lines for "Receive & next"
async function rvLookup() {
  const po = $('rvPo').value.trim();
  if (!po || !rv || rv.busy || rv.edit) return; // edit mode: the PO is just text
  rv.busy = true;
  rvFeedback('Looking the order up…', true);
  const res = await api.returnsLookup(po);
  rv.busy = false;
  if (!res.ok) {
    rvFeedback(`${res.error || 'Not found.'} — enter the details by hand.`);
    rv.unmatched = true;
    rv.orderId = null;
    rv.source = '';
    $('rvMatched').hidden = true;
    $('rvCust').focus();
    return;
  }
  rvFeedback('');
  const o = res.order;
  rv.unmatched = false;
  rv.orderId = o.orderId;
  rv.source = o.source;
  $('rvPo').value = o.reference || po;
  $('rvCust').value = o.customer || '';
  $('rvTrk').value = o.tracking || '';
  rv.items = o.items || [];
  rv.received = rv.items.map(() => false);
  if (rv.items.length) rvLoadItemAt(0); else rvLoadItem(null);
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
  } else {
    rv.itemIdx = -1;
    rv.sku = ''; rv.title = ''; rv.price = 0; rv.targets = null;
    $('rvSku').value = '';
    $('rvQty').value = '1';
  }
  rv.condition = 'new';
  rv.pick = '';
  $('rvPick').value = '';
  const cust = $('rvCust').value.trim();
  $('rvMatched').textContent = `matched${cust ? ` · ${cust}` : ''}`;
  $('rvMatched').hidden = rv.unmatched;
  rvThumbUpdate();
  rvRenderCond();
  rvRenderOrder();
}

// pills + the live "stock lands on …" line; a missing target opens the
// inline fix: pick an existing listing, or create the prefix-named SKU
function rvRenderCond() {
  if (!rv) return;
  $('rvPills').innerHTML = RET_CONDS.map(c => `
    <button type="button" class="rv-pill is-${c.key} ${rv.condition === c.key ? 'on' : ''}" data-cond="${c.key}"
      role="radio" aria-checked="${rv.condition === c.key}">
      <span class="ret-dd-dot is-${c.key}"></span>${c.label}</button>`).join('');
  const t = $('rvTarget');
  const fix = $('rvFix');
  if (!rv.sku) { t.textContent = ''; t.className = 'rv-target'; fix.hidden = true; return; }
  const known = rv.condition === 'new' ? rv.sku : ((rv.targets || {})[rv.condition] || '');
  const resolved = known || rv.pick;
  if (resolved) {
    t.className = 'rv-target';
    t.innerHTML = `stock lands on <span class="mono">${esc(resolved)}</span>${known ? '' : ' <span class="rv-onetime">(picked for this return)</span>'}${retUnlistedMark(resolved)}`;
    fix.hidden = true;
    return;
  }
  t.className = 'rv-target is-missing';
  t.innerHTML = `⚠ no ${esc(retCondLabel(rv.condition).toLowerCase())} listing for <span class="mono">${esc(rv.sku)}</span> yet — pick one or create it:`;
  fix.hidden = false;
  const suggested = `${RET_PREFIX[rv.condition] || ''}${rv.sku}`.toUpperCase();
  const btn = $('rvCreate');
  const canCreate = RET_PREFIX[rv.condition] && recvLookup === 'ready' && !recvLookupExact(suggested);
  btn.hidden = !canCreate;
  btn.disabled = false;
  btn.innerHTML = `Create <span class="mono">${esc(suggested)}</span>`;
  btn.dataset.sku = suggested;
  btn.title = `Creates the Linnworks item with this exact name (title and price copied from ${rv.sku}), maps it, and routes this return into it. Create the marketplace listings later with the same SKU and they link automatically.`;
}

$('rvPills').addEventListener('click', (e) => {
  const p = e.target.closest('.rv-pill');
  if (!p || !rv) return;
  rv.condition = p.dataset.cond;
  rv.pick = '';
  $('rvPick').value = '';
  rvRenderCond();
});

$('rvCreate').addEventListener('click', async () => {
  if (!rv || !rv.sku) return;
  const btn = $('rvCreate');
  const suggested = btn.dataset.sku;
  const cond = rv.condition;
  btn.disabled = true;
  btn.textContent = 'Creating…';
  const parent = recvLookupExact(rv.sku);
  const condLabel = { openbox: 'Open Box', used: 'Used', scrap: 'Scrap' }[cond] || '';
  const res = await api.createSku({
    sku: suggested,
    title: `${(parent && parent.title) || rv.sku} - ${condLabel}`,
    retailPrice: Number(parent && parent.retailPrice) || 0,
    qty: 0,
  });
  if (!res.ok) {
    toast(res.error || 'Could not create the SKU.');
    rvRenderCond();
    return;
  }
  // the fresh SKU joins the local inventory caches so every combo sees it
  if (recvItems) {
    const item = { sku: res.sku, title: `${(parent && parent.title) || rv.sku} - ${condLabel}`, stockItemId: res.stockItemId, levels: [], retailPrice: Number(parent && parent.retailPrice) || 0 };
    recvItems.push(item);
    if (recvBySku) recvBySku.set(res.sku.toLowerCase(), item);
  }
  const map = await api.returnsMapSet(rv.sku, cond, res.sku);
  if (map.ok && rv) {
    rv.targets = { ...(rv.targets || {}), [cond]: map.targetSku };
    toast(`${rv.sku} ${cond} → ${map.targetSku}`);
  }
  rvRenderCond();
});

$('rvPo').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  rvLookup();
});

// editing the PO after a match voids the match — a stale orderId must never
// ride along with a hand-changed number
$('rvPo').addEventListener('input', () => {
  if (!rv || rv.edit) return;
  rv.orderId = null;
  rv.source = '';
  rv.unmatched = true;
  rv.items = [];
  rv.received = [];
  rv.itemIdx = -1;
  $('rvMatched').hidden = true;
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
  if (!po) { rvFeedback('PO# is required.'); $('rvPo').focus(); return false; }
  const sku = $('rvSku').value.trim().toUpperCase();
  if (rv.edit) {
    // edit mode: the qty-aware corrections engine re-resolves the target
    const eqty = Number($('rvQty').value);
    if (sku && (!Number.isInteger(eqty) || eqty < 1)) { rvFeedback('Units must be a whole number of 1 or more.'); return false; }
    rv.busy = true;
    $('rvSave').disabled = true;
    rvFeedback('Saving…', true);
    const res = await api.returnsEditUnit({
      id: rv.edit.rid, itemIndex: rv.edit.ii,
      po, day: $('rvDay').value.trim(), customer: $('rvCust').value.trim(),
      tracking: $('rvTrk').value.trim(), sku,
      condition: rv.condition, note: $('rvNote').value.trim(),
      units: $('rvQty').value.trim(), receivedBy: $('rvBy').value.trim(),
    }).catch(e => ({ ok: false, error: e.message }));
    rv.busy = false;
    $('rvSave').disabled = false;
    if (!res || !res.ok) { rvFeedback((res && res.error) || 'Could not save.'); return false; }
    rvFeedback('');
    toast(res.stockNote ? `Return updated — ${res.stockNote}` : 'Return updated');
    loadRetPast();
    return true;
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
  const res = await api.returnsCreate({
    orderId: rv.orderId || undefined,
    orderNumber: po,
    source: rv.source,
    customer: $('rvCust').value.trim(),
    tracking: $('rvTrk').value.trim(),
    receivedBy: by,
    unmatched: !!rv.unmatched,
    note: sku ? '' : $('rvNote').value.trim(),
    items: sku ? [{ sku, condition: rv.condition, targetSku: target, qty, price: rv.price, note: $('rvNote').value.trim() }] : [],
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
// popup STAYS OPEN on the next one ("Receive & next" retired 2026-08-07,
// owner request — one button does the sensible thing); otherwise it closes.
$('rvSave').addEventListener('click', async () => {
  if (!(await rvCommit())) return;
  if (rv.itemIdx >= 0) rv.received[rv.itemIdx] = true;
  const next = rv.items.findIndex((_, i) => !rv.received[i]);
  if (next < 0) { $('retRecvDialog').close(); return; }
  $('rvNote').value = '';
  rvLoadItemAt(next);
  $('rvQty').focus();
});

$('rvCancel').addEventListener('click', () => $('retRecvDialog').close());
$('retRecvDialog').addEventListener('close', () => { rv = null; });
$('retAddBtn').addEventListener('click', () => retOpenRecv());

// live inventory suggestions in the popup's two SKU fields
makeCombo($('rvSku'), document.querySelector('.rv-combo .combo-list'), async (item) => {
  if (!rv) return;
  rv.sku = item.sku;
  rv.title = item.title || '';
  if (!rv.price) rv.price = Number(item.retailPrice) || 0;
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

function retPoOpenBtn(po, source) {
  const ch = po ? retChannel(source) : '';
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
let unlistedDetail = null; // [{sku,title,image,avail,retail}] sorted by idle value
let unlistedChannels = []; // sources seen across the inventory ("missing on")
let unlistedLoading = false;

async function loadUnlisted() {
  if (unlistedLoading || (state && state.captureOnly)) return;
  unlistedLoading = true;
  try {
    const res = await api.stockUnlisted();
    if (res.ok) {
      unlistedSkus = new Set(res.skus || []);
      unlistedDetail = res.detail || [];
      unlistedChannels = res.channels || [];
      if (activePage === 'returns') { renderRetLog(); renderRetTodo(); }
      if (activePage === 'stock' && stockCache) { renderStockChips(); renderStock(); }
    }
  } finally {
    unlistedLoading = false;
  }
}

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
  showPage('stock');
  renderStockChips();
  renderStock();
}

// the to-do card: every created-but-unlisted condition SKU with how many
// units sit unsellable — copy grabs the exact string for Seller Center
function renderRetTodo() {
  const box = $('retTodo');
  if (!box) return;
  if (!unlistedSkus || unlistedSkus.size === 0) { box.hidden = true; return; }
  const rows = [...unlistedSkus].map(sku => {
    const it = recvBySku && recvBySku.get(sku.toLowerCase());
    const lvl = it && (it.levels || []).find(l => l.locationId === recvLocationId);
    return { sku, units: lvl ? Number(lvl.stockLevel) || 0 : null };
  }).sort((a, b) => (b.units || 0) - (a.units || 0));
  box.hidden = false;
  box.innerHTML = `
    <h4>${rows.length} in-stock SKU${rows.length === 1 ? '' : 's'} still need${rows.length === 1 ? 's' : ''} marketplace listings</h4>
    ${rows.map(r => `<div class="ret-todo-row">
      <button class="ret-todo-sku mono" data-goto="${esc(r.sku)}" title="Open the Stock page's Unlisted view filtered to this SKU">${esc(r.sku)}</button>
      <button class="ret-todo-copy" data-copy="${esc(r.sku)}" title="Copy the exact SKU for Seller Center / eBay">copy</button>
      <span class="ret-todo-units">${r.units === null ? '' : `${r.units} unit${r.units === 1 ? '' : 's'} waiting`}</span>
    </div>`).join('')}
    <div class="ret-todo-note">Create the listing on Walmart/eBay using exactly this SKU string — Linnworks links it automatically and the row leaves this list on the next refresh.</div>`;
}

$('retTodo').addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]');
  if (c) { copyFromApp(c.dataset.copy); return; }
  const g = e.target.closest('[data-goto]');
  if (g) showUnlistedFor(g.dataset.goto);
});

// the log wears the SAME sheet as the worksheet (same columns, same
// gridlines, same order) — flat and searchable; the pencil opens the
// receive popup in edit mode (popup editing at the owner's request
// 2026-08-07, replacing the earlier inline row)
function retLogRowHtml(r, i, ii, un, num) {
  const day = String(r.created_at).slice(0, 10);
  return `
    <tr class="ret-past-tr" data-rid="${r.id}" data-ii="${ii}" data-un="${un}">
      <td class="cell-gutter ${r.unmatched ? 'st-failed' : 'st-captured'}" title="${r.unmatched ? 'Not matched to a Linnworks order' : 'Matched processed order'}">${num}</td>
      <td class="mono ret-cell-po" title="${esc(r.order_number)}${r.unmatched ? ' — not matched to a Linnworks order' : ''}">${r.order_number ? esc(r.order_number) : '<span class="cell-missing">—</span>'}${retPoOpenBtn(r.order_number, r.source)}</td>
      <td class="ret-cell-cust" title="${esc(r.customer || '')}">${r.customer ? esc(r.customer) : '<span class="cell-missing">—</span>'}</td>
      <td class="mono ret-cell-trk" title="${esc(r.tracking || '')}">${r.tracking ? esc(shorten(r.tracking, 16)) : '<span class="cell-missing">—</span>'}</td>
      <td class="mono ret-cell-date" title="Received ${esc(day)} ${fmtTime(r.created_at)}${r.received_by ? ` by ${esc(r.received_by)}` : ''}">${esc(day.slice(5))} ${fmtTime(r.created_at)}</td>
      <td class="ret-cell-sku">${i.sku ? `<span class="mono">${esc(i.sku)}</span>` : '<span class="cell-missing">—</span>'}</td>
      <td class="ret-cell-cond">
        ${i.sku ? `<span class="ret-cond-ro"><span class="ret-dd-dot is-${esc(i.condition)}"></span>${esc(retCondLabel(i.condition))}</span>` : '<span class="cell-missing">—</span>'}
        ${i.targetSku && i.targetSku !== i.sku ? `<div class="ret-cell-target" title="Stock landed on ${esc(i.targetSku)}">→ ${esc(i.targetSku)}${retUnlistedMark(i.targetSku)}</div>` : (i.sku && i.targetSku === i.sku ? retUnlistedMark(i.sku) : '')}
      </td>
      <td class="ret-cell-units mono">${Number(i.qty) || 1}</td>
      <td class="ret-cell-by ret-ro-by" title="Received by">${esc(r.received_by || '')}</td>
      <td class="ret-cell-note ret-ro-note" title="${esc(i.note || r.note || '')}">${esc(i.note || r.note || '')}</td>
      <td class="cell-actions"><span class="ret-log-act">
        <button class="btn-icon ret-log-edit-btn" title="Edit this return">${ICONS.pencil}</button>
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
  const box = $('retPastBox');
  if (!retLogAll.length) {
    $('retLogCount').textContent = '';
    box.innerHTML = '<div class="recv-past-empty">No returns yet. Type a PO# in the worksheet above to receive one.</div>';
    return;
  }
  const q = $('retLogSearch').value.trim().toLowerCase();
  const rows = !q ? retLogAll : retLogAll.filter(({ r, i }) =>
    [r.order_number, r.customer, r.tracking, r.source, r.received_by, r.note,
     i.sku, i.targetSku, i.note, retCondLabel(i.condition)]
      .some(v => String(v || '').toLowerCase().includes(q)));
  $('retLogCount').textContent = ` — ${rows.length}${q ? ` of ${retLogAll.length}` : ''} entr${rows.length === 1 ? 'y' : 'ies'}`;
  box.innerHTML = `
    <div class="ret-sheet-scroll">
    <table class="recv-sheet-table ret-sheet ret-log-table">
      <thead>
        <tr>
          <th class="th-gutter">#</th>
          <th class="th-po">PO#</th>
          <th class="th-cust">Customer</th>
          <th class="th-trk">Tracking #</th>
          <th class="th-date">Received</th>
          <th class="th-rsku">Returned SKU</th>
          <th class="th-cond">Condition</th>
          <th class="th-units">Units</th>
          <th class="th-by">By</th>
          <th class="th-note">Notes / dispute</th>
          <th class="th-actions"></th>
        </tr>
      </thead>
      <tbody>${rows.map(({ r, i, ii, un }, idx) => retLogRowHtml(r, i, ii, un, idx + 1)).join('')
        || `<tr><td colspan="${document.body.classList.contains('ret-compact') ? 6 : 11}" class="ret-log-none">Nothing matches “${esc(q)}”.</td></tr>`}</tbody>
    </table>
    </div>`;
  applyRetCols(box.querySelector('table.ret-log-table')); // widths follow the worksheet
}

async function loadRetPast() {
  const returns = await api.returnsList();
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
}

$('retLogSearch').addEventListener('input', () => renderRetLog());

let retDelCtx = null; // { rid, ii, target } — pending delete confirmation

$('retPastBox').addEventListener('click', (e) => {
  const open = e.target.closest('.ret-po-open');
  if (open) { retOpenPo(open.dataset.po, open.dataset.ch); return; }
  const tr = e.target.closest('tr[data-rid]');
  if (!tr) return;
  if (e.target.closest('.ret-log-edit-btn')) {
    const entry = (retLogAll || []).find(x => x.r.id === Number(tr.dataset.rid) && x.ii === Number(tr.dataset.ii));
    if (entry) retOpenEdit(entry);
    return;
  }
  if (e.target.closest('.ret-log-del-btn')) {
    const entry = (retLogAll || []).find(x => x.r.id === Number(tr.dataset.rid) && x.ii === Number(tr.dataset.ii));
    if (!entry) return;
    const qty = Number(entry.i.qty) || 1;
    retDelCtx = { rid: entry.r.id, ii: entry.ii, target: entry.i.targetSku || '' };
    $('retDelLine').textContent = [entry.r.order_number, entry.i.sku, entry.i.sku ? retCondLabel(entry.i.condition) : '', qty > 1 ? `×${qty}` : '']
      .filter(Boolean).join(' · ');
    $('retDelStockWrap').hidden = !retDelCtx.target;
    $('retDelStock').checked = !!retDelCtx.target;
    $('retDelTarget').textContent = retDelCtx.target ? `−${qty} ${retDelCtx.target}` : '';
    $('retDelDialog').showModal();
  }
});

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
  if (retSheetDrag.w) localStorage.setItem('retSheetWidth', String(retSheetDrag.w));
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

const RET_COL_KEYS = { 1: 'po', 2: 'cust', 3: 'trk', 4: 'date', 5: 'rsku', 6: 'cond', 7: 'units', 8: 'by', 9: 'note' };

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

/* ---------- linked channel SKUs per stock item ---------- */

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
      <div class="chs-row">
        <span class="badge badge-${esc((c.source || '').toLowerCase())}">${esc(channelLabel((c.source || '').toLowerCase()))}</span>
        <span class="chs-sub">${esc(c.subSource)}</span>
        <span class="mono chs-sku">${esc(c.sku)}</span>
        ${c.price != null
          ? `<span class="mono chs-price" title="${c.priceKind === 'default'
              ? 'Channel default price stored in Linnworks (no listing-specific price)'
              : 'Listing price stored in Linnworks'}">$${Number(c.price).toFixed(2)}${c.priceKind === 'default' ? '<span class="chs-price-def">def</span>' : ''}</span>`
          : '<span class="chs-price chs-price-none" title="No price stored in Linnworks for this listing">—</span>'}
        ${c.ignoreSync ? '<span class="history-status st-pending" title="Stock sync is turned off for this listing">sync off</span>' : ''}
      </div>`).join('');
}

$('chsClose').addEventListener('click', () => $('chsDialog').close());

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
  if (previewUrl) imgTarget.preview = previewUrl;
  const src = imgTarget.preview || imgTarget.url || '';
  $('imgStage').innerHTML = `
    ${src ? `<img class="img-stage-img" src="${esc(src)}" alt="" />` : ''}
    <span class="img-ok">Image added to ${esc(imgTarget.sku)}</span>`;
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
  loadStock(); // refresh the grid thumbnail
}

// shared completion for the file/drop paths
function imgFinishFile(res) {
  if (!$('imgDialog').open || imgState !== 'loading') return;
  if (res.canceled) { imgStageIdle(); return; }
  if (!res.ok) { imgStageError(res.error || 'Upload failed.'); return; }
  imgStageSuccess(res.dataUrl || '');
  toast(`Image added to ${imgTarget.sku}`);
  loadStock();
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
    if (!input.closest('.ret-sheet-scroll')) return;
    const r = input.getBoundingClientRect();
    listEl.classList.add('is-fixed');
    listEl.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 368))}px`;
    listEl.style.minWidth = `${Math.max(260, Math.round(r.width))}px`;
    const below = r.bottom + 4;
    listEl.style.top = `${below + 260 > window.innerHeight ? Math.max(8, r.top - 264) : below}px`;
  };
  const render = () => {
    if (recvLookup === 'loading') {
      listEl.innerHTML = '<div class="combo-note">Loading Linnworks SKUs…</div>';
    } else if (!matches.length) {
      listEl.innerHTML = `<div class="combo-note">${recvLookup === 'ready' ? 'No SKU or title matches.' : 'SKU list unavailable - type the full SKU.'}</div>`;
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
          <span class="combo-opt-title">${esc(it.title || '')}</span>
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
    if (isOpen && hl >= 0 && matches[hl] && !blockedOf(matches[hl])) { close(); onPick(matches[hl]); }
  });
  listEl.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('.combo-opt');
    if (!opt) return;
    e.preventDefault();
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
  const out = [];
  for (const it of recvItems) {
    if (!q
      || it.sku.toLowerCase().includes(q)
      || (it.title || '').toLowerCase().includes(q)
      || (it.barcode || '').toLowerCase().includes(q)) {
      out.push(it);
      if (out.length >= 50) break;
    }
  }
  return out;
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
