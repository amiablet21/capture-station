// DWS Stock's item costs, read from the shared Google Drive folder the
// stations sync: each station appends to costs-<STATION>.jsonl, one
// { sku, cost, updated_at, station, by } per line, newest updated_at wins
// (src/main/main.js syncCosts). The bot reads through a Google service
// account that has VIEW access to that one folder only. No libraries: the
// service account's sign-in is a JWT signed with node's crypto.
import fs from 'node:fs';
import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3/files';
const b64url = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// every costs file's text → SKU (upper) → newest { sku, cost, at, by, station }
export function mergeCostFiles(texts) {
  const out = new Map();
  for (const text of texts) {
    for (const line of String(text || '').split('\n')) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; } // a half-written last line
      const sku = String(r && r.sku || '').trim().toUpperCase();
      const at = String(r && r.updated_at || '');
      if (!sku || !at) continue;
      const cur = out.get(sku);
      if (cur && cur.at >= at) continue;
      out.set(sku, { sku, cost: Math.max(0, Number(r.cost) || 0), at, by: String(r.by || ''), station: String(r.station || '') });
    }
  }
  return out;
}

export class DriveCosts {
  // the service account's key: the downloaded JSON file, or its contents
  // pasted into a setting (Railway)
  constructor({ keyFile, keyJson, folderId }) {
    const where = keyJson ? 'GOOGLE_KEY_JSON' : keyFile;
    try { this.key = JSON.parse(keyJson || fs.readFileSync(keyFile, 'utf8')); } catch (e) { throw new Error(`${where} is not readable JSON: ${e.message}`); }
    if (!this.key.client_email || !this.key.private_key) throw new Error(`${where} is not a service account key (no client_email / private_key)`);
    this.folderId = folderId;
    this.token = null; // { value, exp }
    this.files = new Map(); // file id -> { modifiedTime, text }
    this.costs = new Map();
    this.at = 0;
  }

  get email() { return this.key.client_email; }

  async accessToken() {
    if (this.token && this.token.exp - 60000 > Date.now()) return this.token.value;
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({
      iss: this.key.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: TOKEN_URL, iat: now, exp: now + 3600,
    }));
    const sig = b64url(crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(this.key.private_key));
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}` }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error(`Google sign-in failed (${res.status}): ${j.error_description || j.error || 'no token'}`);
    this.token = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
    return this.token.value;
  }

  async get(url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await this.accessToken()}` }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Google Drive answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }

  // re-download only the files that changed since the last read
  async refresh() {
    const q = `'${this.folderId}' in parents and name contains 'costs-' and trashed = false`;
    const listed = [];
    let pageToken = '';
    do {
      const u = new URL(API);
      u.search = new URLSearchParams({
        q, fields: 'nextPageToken,files(id,name,modifiedTime)', pageSize: '100',
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(pageToken ? { pageToken } : {}),
      });
      const j = await (await this.get(u)).json();
      listed.push(...(j.files || []).filter(f => /^costs-.+\.jsonl$/i.test(f.name)));
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    if (!listed.length) throw new Error(`no costs-*.jsonl files in the Drive folder (is it shared with ${this.email}?)`);
    const next = new Map();
    for (const f of listed) {
      const had = this.files.get(f.id);
      if (had && had.modifiedTime === f.modifiedTime) { next.set(f.id, had); continue; }
      const text = await (await this.get(`${API}/${f.id}?alt=media&supportsAllDrives=true`)).text();
      next.set(f.id, { modifiedTime: f.modifiedTime, text });
    }
    this.files = next;
    this.costs = mergeCostFiles([...next.values()].map(f => f.text));
    this.at = Date.now();
    return this.costs;
  }
}
