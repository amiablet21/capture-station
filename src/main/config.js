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
  // against a regex. Extend here (or later in Settings) e.g. with Used.
  stockViews: [{ label: 'Open Box', pattern: 'OPEN[\\s-]?BOX' }],
  // SHA-256 hex of the Settings PIN; empty = no PIN required.
  settingsPinHash: '',
  // Capture-only: hide all Linnworks sync UI; the station just records and
  // mirrors today's rows to a CSV after every change.
  captureOnly: true,
  // Per-install page flags. Capture is always on; capture-only mode overrides
  // all of these and shows Capture alone.
  pages: { stock: true, history: true, receiving: false },
  // Receiving sessions: local JSON audit trail of goods received; empty
  // folder = Documents\Capture Station\receiving.
  // webhookUrl: optional Make.com webhook POSTed on "Finish receiving".
  receiving: { folder: '', webhookUrl: '' },
  // Auto-drop Linnworks open orders onto the Capture page as pending rows.
  // excludeLocationNames: orders at these stock locations never enter the
  // queue (WFS = fulfilled by Walmart, no label to make here).
  orderImport: { enabled: true, excludeLocationNames: ['WFS FULFILLED'] },
  // Click a PO# -> open the order on its marketplace. {po} is replaced with
  // the order number. Empty template = clicking just selects the row.
  orderUrlTemplates: {
    walmart: 'https://seller.walmart.com/orders/manage-orders?orderGroups=All&poNumber={po}',
    ebay: 'https://www.ebay.com/sh/ord/details?orderid={po}',
    temu: '',
  },
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
