'use strict';
// Config stored in userData/config.json. Credentials never hardcoded.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  // Order-number patterns, tested against trimmed clipboard text (full match).
  orderPatterns: [
    { channel: 'walmart', pattern: '^\\d{13,15}$' },
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
  autoSync: { enabled: false, time: '17:00' },
  // Capture-only: hide all Linnworks sync UI; the station just records and
  // mirrors today's rows to a CSV after every change.
  captureOnly: true,
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
  cached = deepMerge(structuredClone(DEFAULTS), stored);
  return cached;
}

function save(patch) {
  const cfg = deepMerge(load(), patch || {});
  cached = cfg;
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
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
