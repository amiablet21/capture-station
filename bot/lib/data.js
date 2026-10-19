// Stock and the last 30 days of sales from Linnworks, through the same
// client and reorder maths DWS Stock uses, so the bot and the app agree.
// Sales are cached on disk and topped up incrementally: processed orders do
// not change, so only the last few hours are read again on each check.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LinnworksClient } = require('../../src/main/linnworks.js');
const { buildSalesExport } = require('../../src/main/sales-export.js');

const WINDOW_DAYS = 30;
const OVERLAP_MS = 3 * 3600 * 1000;

export class SalesData {
  constructor(cfg) {
    this.cfg = cfg;
    this.client = new LinnworksClient(cfg.linnworks);
    this.cacheFile = path.join(cfg.dataDir, 'sales-cache.json');
    this.cache = this.loadCache();
    this.rows = null; // last computed export rows
    this.at = 0;
    this.locationName = '';
    this.running = null;
  }

  loadCache() {
    try {
      const c = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      if (Array.isArray(c.lines) && Number(c.from) && Number(c.to)) return c;
    } catch { /* none yet */ }
    return { from: 0, to: 0, lines: [] };
  }

  saveCache() {
    const tmp = `${this.cacheFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.cache), 'utf8');
    fs.renameSync(tmp, this.cacheFile);
  }

  // one refresh at a time; callers share the one in flight
  refresh() {
    if (!this.running) this.running = this.doRefresh().finally(() => { this.running = null; });
    return this.running;
  }

  async doRefresh() {
    const now = new Date();
    // the first local day of the 30-day window
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (WINDOW_DAYS - 1)).getTime();
    const to = now.getTime();
    if (!this.cache.to || this.cache.from > from) {
      const lines = await this.client.listProcessedLines(new Date(from).toISOString(), new Date(to).toISOString());
      this.cache = { from, to, lines };
    } else {
      const since = this.cache.to - OVERLAP_MS;
      const fresh = await this.client.listProcessedLines(new Date(since).toISOString(), new Date(to).toISOString());
      const ids = new Set(fresh.map(l => l.orderId));
      const kept = this.cache.lines.filter(l => !ids.has(l.orderId) && Date.parse(l.processedOn) >= from);
      this.cache = { from, to, lines: kept.concat(fresh) };
    }
    this.saveCache();

    const items = await this.client.listInventory();
    const loc = this.findLocation(items);
    this.locationName = loc.name;
    const data = buildSalesExport(items, this.cache.lines, {
      now, days: WINDOW_DAYS, locationId: loc.id, locationName: loc.name,
      leadDays: this.cfg.leadDays, coverDays: this.cfg.coverDays,
    });
    this.rows = data.rows;
    this.at = Date.now();
    return this.rows;
  }

  // LINNWORKS_LOCATION by id or name, case-insensitive
  findLocation(items) {
    const want = this.cfg.location.toLowerCase();
    const seen = new Map();
    for (const it of items) {
      for (const l of it.levels || []) {
        if (l.locationId && !seen.has(l.locationId)) seen.set(l.locationId, l.locationName || '');
      }
    }
    for (const [id, name] of seen) {
      if (String(id).toLowerCase() === want || String(name).toLowerCase() === want) return { id, name };
    }
    const names = [...seen.values()].map(n => `"${n}"`).join(', ');
    throw new Error(`Linnworks location "${this.cfg.location}" not found. Set LINNWORKS_LOCATION to one of: ${names}`);
  }
}
