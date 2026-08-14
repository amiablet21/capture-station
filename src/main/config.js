'use strict';
// Config stored in userData/config.json. Credentials never hardcoded.
// Linnworks API credentials are encrypted at rest with the OS user's key
// (Electron safeStorage / Windows DPAPI): config.json holds `linnworksEnc`
// and is useless if copied to another machine or user account.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SECRET_FIELDS = ['applicationId', 'applicationSecret', 'token'];

function encryptCreds(linnworks) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const secrets = {};
    for (const f of SECRET_FIELDS) secrets[f] = linnworks[f] || '';
    return safeStorage.encryptString(JSON.stringify(secrets)).toString('base64');
  } catch {
    return null;
  }
}

function decryptCreds(b64) {
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(b64, 'base64')));
  } catch {
    return null;
  }
}

const DEFAULTS = {
  // Order-number patterns, tested against trimmed clipboard text (full match).
  orderPatterns: [
    // Exactly 15 digits: a partial highlight (14 digits or fewer) must NOT match,
    // otherwise a clipped Ctrl+C creates a bogus order that fails at sync time.
    { channel: 'walmart', pattern: '^\\d{15}$' },
    { channel: 'ebay', pattern: '^\\d{2}-\\d{5}-\\d{5}$' },
    { channel: 'temu', pattern: '^PO-\\d{3}-\\d{5,}$' },
  ],
  trackingPatterns: [
    { carrier: 'UPS', pattern: '^1Z[A-HJ-NP-Z0-9]{16}$' },
    { carrier: 'USPS', pattern: '^9[2345]\\d{20,24}$' },
    { carrier: 'FedEx', pattern: '^\\d{12}$|^\\d{15}$|^\\d{20,22}$' },
  ],
  serialPatterns: [
    { type: 'IMEI', pattern: '^\\d{15}$' },
    { type: 'Serial', pattern: '^[A-Za-z0-9\\-/\\.]{6,30}$' },
  ],
  linnworks: {
    applicationId: '',
    applicationSecret: '',
    token: '',
    locationId: '',
    locationName: '',
  },
  dryRun: true,
  // Route open orders the primary location can't cover to a fallback
  // (dropship) location; move them back when the primary is replenished.
  stockRouting: { enabled: false, fallbackLocationId: '', fallbackLocationName: '' },
  // Condition views on the Stock page: filter chips matching SKU or title
  // against a regex. Word-boundary guards keep USED from matching UNUSED.
  // tint = muted badge palette for the active chip (blue/yellow/red).
  stockViews: [
    { label: 'Open Box', pattern: 'OPEN[\\s-]?BOX', tint: 'blue' },
    { label: 'Used', pattern: '(^|[^A-Za-z])USED($|[^A-Za-z])', tint: 'yellow' },
    { label: 'Scrap', pattern: '(^|[^A-Za-z])SCRAP($|[^A-Za-z])', tint: 'red' },
  ],
  // SHA-256 hex of the Settings PIN; empty = no PIN required.
  settingsPinHash: '',
  // Capture-only: hide all Linnworks sync UI; the station just records and
  // mirrors today's rows to a CSV after every change.
  captureOnly: true,
  // Per-install page flags. Capture is always on; capture-only mode overrides
  // all of these and shows Capture alone. (Receiving lives inside the Stock
  // page; the third tab is Returns.)
  pages: { stock: true, history: true, returns: false },
  // Low-stock alerting: optional webhook POSTed once per SKU when Available
  // crosses below the minimum level (re-armed when it recovers above).
  lowStock: { webhookUrl: '' },
  // Receiving sessions: local JSON audit trail of goods received; empty
  // folder = Documents\Capture Station\receiving.
  // webhookUrl: optional Make.com webhook POSTed on "Finish receiving".
  receiving: { folder: '', webhookUrl: '' },
  // Daily carrier cutoff (24h HH:MM): "Due today" chips turn red as it nears.
  shipCutoff: '16:00',
  // Auto-drop Linnworks open orders onto the Capture page as pending rows.
  // excludeLocationNames: orders at these stock locations never enter the
  // queue (WFS = fulfilled by Walmart, no label to make here).
  orderImport: { enabled: true, excludeLocationNames: ['WFS FULFILLED'] },
  // Click a PO# -> open the order on its marketplace. {po} is replaced with
  // the order number. Empty template = clicking just selects the row.
  orderUrlTemplates: {
    walmart: 'https://seller.walmart.com/orders/manage-orders?orderGroups=All&poNumber={po}',
    ebay: 'https://www.ebay.com/sh/ord/details?orderid={po}',
    // Temu's order page keys off the parent order number; the session and
    // referrer params in a copied URL are disposable
    temu: 'https://seller.temu.com/order-detail.html?parent_order_sn={po}',
  },
  // Same idea for RETURNS: the Returns page's PO# buttons open the return,
  // not the order. {from}/{to} are filled with a rolling 180-day window
  // (Walmart's returns search is date-bounded). Empty = fall back to the
  // order link above.
  returnUrlTemplates: {
    walmart: 'https://seller.walmart.com/orders/returns?appliedFilters=%257B%2522pageSize%2522%253A25%252C%2522pageNum%2522%253A0%252C%2522offset%2522%253A0%252C%2522returnGroup%2522%253A%2522ALL%2522%252C%2522filter%2522%253Atrue%252C%2522startDate%2522%253A%2522{from}%2522%252C%2522endDate%2522%253A%2522{to}%2522%252C%2522id%2522%253A%2522{po}%2522%252C%2522searchIdType%2522%253A%2522PO_NO%2522%252C%2522limit%2522%253A25%252C%2522resetFilter%2522%253Atrue%252C%2522tabIndex%2522%253A4%257D&returnGroup=ALL',
    ebay: 'https://www.ebay.com/mesh/ord/details?orderid={po}',
    temu: '', // no return seen yet — falls back to the order page
  },
  // Click a channel SKU in the Stock popup -> open that listing on the
  // marketplace, searched by the channel SKU. {sku} is replaced.
  listingUrlTemplates: {
    walmart: 'https://seller.walmart.com/items-and-inventory/manage-items?searchQuery={sku}',
    ebay: 'https://www.ebay.com/sh/lst/active?keyword={sku}&source=filterbar&action=search',
    temu: '', // Temu seller search URL unknown yet — clicking copies the SKU
  },
  // SKUs deliberately excluded from the "needs marketplace listings"
  // machinery (claim bins, fakes, write-offs — never to be listed)
  unlistedIgnore: [],
  // eBay lister: per-model spec cards (copied once from a live NEW listing or
  // typed once by hand) + the business-policy names the CSV references
  ebayModelCards: {},
  // owner's live policy names (renamed on eBay 2026-08-12) — the CSV
  // references business policies by exact name
  ebayProfiles: {
    shipping: 'FREE SHIPPING',
    returns: '30-Day Returns - Buyer Pays',
    payment: 'eBay Managed Payments - Immediate',
    location: 'Fairfield, NJ',
    dispatchDays: 1,
  },
  // Temu lister: the seller-downloaded upload template lives in userData
  // (temu-template.xlsx); these name what the export references
  temuProfiles: { shippingTemplate: 'FREE SHIPPING', handlingTime: '1 Day' },
  temuTemplate: null, // { name, savedAt } once a template file is picked
  temuPackages: {}, // per model family: { weightLb, lenIn, widIn, heiIn }
  // "Received by" initials on the Returns worksheet: last-used value becomes
  // the default for the next return.
  returnsReceivedBy: '',
  // DropShip program: SKUs the supplier can fulfil, each with a pad — the
  // level the app keeps topped up at the DropShip location so the listing
  // stays live with zero warehouse stock. Pad 0 = listing dark (supplier
  // out). Router only sends orders to DropShip when every line is enrolled
  // with a pad > 0.
  // The program itself lives in Linnworks (DropshipPad extended property on
  // each enrolled item) so every install sees it; this map is the local
  // mirror the UI reads, refreshed on every pad pass.
  dropshipPads: {}, // { SKU: qty }
  // one-time: pads set before the extended property existed migrate up
  dropshipPadsMigrated: false,
  // Reorder points from sales velocity: Min = perDay × leadTimeDays × 1.5,
  // buy quantity ≈ perDay × (coverDays + leadTimeDays). suggest shows them
  // in the Min column; auto applies them nightly (only when ±20% off).
  reorder: { suggest: true, auto: false, leadTimeDays: 7, coverDays: 21 },
  // one-per-crossing latch for dropship BUY alerts (like lowStockBelow)
  dropshipAlerted: {},
  // Embedded marketplace browser pane on the Capture page (sync mode only):
  // width and open/collapsed state survive restarts.
  browserPane: { visible: false, width: 480, zoom: 1 },
  csvFolder: '', // empty = Documents\Capture Station
  clipboardPollMs: 300,
  lastSync: null, // { at, synced, failed, dryRun }
};

let cached = null;

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load() {
  if (cached) return cached;
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    /* first run or corrupt file: fall back to defaults */
  }
  if (stored.linnworksEnc) {
    const secrets = decryptCreds(stored.linnworksEnc);
    if (secrets) stored.linnworks = { ...(stored.linnworks || {}), ...secrets };
    delete stored.linnworksEnc;
  }
  // migration: Temu shipped with no order URL; fill in the real one for
  // configs saved before it was known (a blank means "never set", not
  // "deliberately cleared" — clearing it just makes the PO# copy instead)
  if (stored.orderUrlTemplates && !String(stored.orderUrlTemplates.temu || '').trim()) {
    stored.orderUrlTemplates.temu = DEFAULTS.orderUrlTemplates.temu;
  }
  // migration: the eBay listing search needs the filterbar form (the bare
  // ?q= form ignored the query, owner-verified 2026-08-11)
  if (stored.listingUrlTemplates
      && stored.listingUrlTemplates.ebay === 'https://www.ebay.com/sh/lst/active?q={sku}') {
    stored.listingUrlTemplates.ebay = DEFAULTS.listingUrlTemplates.ebay;
  }
  // migration: eBay lister profiles saved before the real policy names were
  // set on eBay hold empty strings — empty means "never configured", so the
  // owner's live policy names take over
  if (stored.ebayProfiles
      && !String(stored.ebayProfiles.shipping || '').trim()
      && !String(stored.ebayProfiles.returns || '').trim()
      && !String(stored.ebayProfiles.payment || '').trim()) {
    stored.ebayProfiles = structuredClone(DEFAULTS.ebayProfiles);
  }
  // migration: the Receiving tab became Returns (receiving moved into Stock)
  if (stored.pages && stored.pages.returns === undefined && stored.pages.receiving !== undefined) {
    stored.pages.returns = !!stored.pages.receiving;
  }
  // migration: stock condition views gained Used and Scrap - add any default
  // view a saved config is missing (dedupe by label), and backfill tints
  if (Array.isArray(stored.stockViews)) {
    for (const def of DEFAULTS.stockViews) {
      const mine = stored.stockViews.find(v => v && String(v.label || '').toLowerCase() === def.label.toLowerCase());
      if (!mine) stored.stockViews.push(structuredClone(def));
      else if (!mine.tint) mine.tint = def.tint;
    }
  }
  cached = deepMerge(structuredClone(DEFAULTS), stored);
  return cached;
}

function save(patch) {
  const cfg = deepMerge(load(), patch || {});
  cached = cfg;
  const persisted = structuredClone(cfg);
  const enc = encryptCreds(cfg.linnworks);
  if (enc) {
    persisted.linnworksEnc = enc;
    for (const f of SECRET_FIELDS) persisted.linnworks[f] = '';
  }
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(persisted, null, 2), 'utf8');
  return cfg;
}

function deepMerge(base, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      deepMerge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

// Compile a pattern list, skipping invalid regexes rather than crashing capture.
function compile(list) {
  const out = [];
  for (const entry of list || []) {
    try {
      out.push({ ...entry, re: new RegExp(entry.pattern, 'i') });
    } catch {
      /* invalid user regex: skip */
    }
  }
  return out;
}

module.exports = { load, save, compile, DEFAULTS };
