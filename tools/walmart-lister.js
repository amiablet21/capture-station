'use strict';

// HUBX -> Walmart lister: a STANDALONE tool (deliberately not part of Capture
// Station). It reads the real HUBX catalog, finds each item's existing page
// on Walmart, and attaches your offer to it via the Marketplace API's
// item-match feed. Dependency-free node, same pattern as hubx-sandbox.js.
//
//   node tools/walmart-lister.js        -> http://localhost:8788
//
// Credentials (both gitignored):
//   tools/hubx.env      HUBX_API_URL / HUBX_AUTH_URL / HUBX_CLIENT_ID / HUBX_CLIENT_SECRET
//   tools/walmart.env   WALMART_CLIENT_ID / WALMART_CLIENT_SECRET
//                       (Seller Center -> gear -> API Key Management; optional
//                        WALMART_API_URL, default marketplace.walmartapis.com)
//
// Without walmart.env the Walmart side runs in MOCK mode: searches return
// clearly-labeled fake candidates and feeds pretend to process, so the whole
// flow is testable before the keys exist. Matches + feed history persist in
// tools/walmart-lister-data.json (gitignored).

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8788;

const loadEnv = (file) => {
  const o = {};
  try {
    for (const l of fs.readFileSync(path.join(__dirname, file), 'utf8').split(/\r?\n/)) {
      const m = l.match(/^([A-Z_]+)=(.*)$/);
      if (m) o[m[1]] = m[2].trim();
    }
  } catch { /* absent is fine */ }
  return o;
};
const HUBX = loadEnv('hubx.env');
const WM = loadEnv('walmart.env');
const HUBX_OK = !!(HUBX.HUBX_CLIENT_ID && HUBX.HUBX_CLIENT_SECRET && HUBX.HUBX_API_URL);
const WM_OK = !!(WM.WALMART_CLIENT_ID && WM.WALMART_CLIENT_SECRET);
const WMBASE = WM.WALMART_API_URL || 'https://marketplace.walmartapis.com';

const DATA_FILE = path.join(__dirname, 'walmart-lister-data.json');
let DATA = { mappings: {}, feeds: [] }; // mappings keyed by hubx item id
try { DATA = { mappings: {}, feeds: [], ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch { /* first run */ }
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(DATA, null, 2));

/* ---------- HUBX client (same rules as the sandbox proxy: cached token,
   guard well under their 60 req/60s) ---------- */

let hxTok = { value: '', exp: 0 };
const hxHits = [];
const hxRate = () => {
  const n = Date.now();
  while (hxHits.length && n - hxHits[0] > 60000) hxHits.shift();
  if (hxHits.length >= 50) return false;
  hxHits.push(n);
  return true;
};
async function hubxToken() {
  if (hxTok.value && Date.now() < hxTok.exp - 60000) return hxTok.value;
  const r = await fetch(`${HUBX.HUBX_AUTH_URL}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: HUBX.HUBX_CLIENT_ID, client_secret: HUBX.HUBX_CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error(`HUBX auth ${r.status}`);
  const j = await r.json();
  hxTok = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return hxTok.value;
}
async function hubxGet(pathq) {
  if (!hxRate()) throw new Error('HUBX rate guard (60/min) — wait a few seconds');
  const t = await hubxToken();
  const r = await fetch(`${HUBX.HUBX_API_URL}${pathq}`, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) throw new Error(`HUBX ${r.status}`);
  return r.json();
}

/* ---------- Walmart client ---------- */

let wmTok = { value: '', exp: 0 };
async function wmToken() {
  if (wmTok.value && Date.now() < wmTok.exp - 60000) return wmTok.value;
  const r = await fetch(`${WMBASE}/v3/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${WM.WALMART_CLIENT_ID}:${WM.WALMART_CLIENT_SECRET}`).toString('base64'),
      'WM_SVC.NAME': 'Walmart Marketplace',
      'WM_QOS.CORRELATION_ID': `lister-${Date.now()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`Walmart auth ${r.status}`);
  const j = await r.json();
  wmTok = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 900) * 1000 };
  return wmTok.value;
}
async function wmCall(method, pathq, body) {
  const t = await wmToken();
  const r = await fetch(`${WMBASE}${pathq}`, {
    method,
    headers: {
      'WM_SEC.ACCESS_TOKEN': t,
      'WM_QOS.CORRELATION_ID': `lister-${Date.now()}`,
      'WM_SVC.NAME': 'Walmart Marketplace',
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

/* ---------- mock Walmart (until walmart.env exists): obviously-fake
   candidates so the matching UX is testable today ---------- */

const mockSearch = (q) => {
  const base = q.replace(/\s+/g, ' ').trim().slice(0, 70);
  const seed = [...q].reduce((a, c) => a + c.charCodeAt(0), 0);
  return [0, 1, 2].map(i => ({
    itemId: String(100000000 + ((seed * 7919 + i * 104729) % 899999999)),
    title: i === 0 ? base : i === 1 ? `${base} (Renewed)` : `${base} Bundle`,
    brand: q.split(' ')[0],
    gtin: '',
    price: null,
    mock: true,
  }));
};

/* ---------- plumbing ---------- */

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
});

/* ---------- mock feed lifecycle: RECEIVED -> INPROGRESS -> PROCESSED ---------- */

function mockProgress(feed) {
  setTimeout(() => { feed.status = 'INPROGRESS'; save(); }, 8000);
  setTimeout(() => {
    feed.status = 'PROCESSED';
    feed.itemsReceived = feed.skus.length;
    feed.itemsSucceeded = feed.skus.length;
    feed.itemsFailed = 0;
    save();
  }, 20000);
}
for (const f of DATA.feeds) if (f.mock && f.status !== 'PROCESSED') mockProgress(f);

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'walmart-lister.html')));
      return;
    }

    if (u.pathname === '/lister/mode') {
      json(res, 200, {
        hubx: HUBX_OK ? (HUBX.HUBX_ENV || 'sandbox') : 'missing',
        walmart: WM_OK ? 'live' : 'mock',
      });
      return;
    }

    // the HUBX catalog, filtered server-side to keep the page simple
    if (req.method === 'GET' && u.pathname === '/lister/hubx-catalog') {
      if (!HUBX_OK) { json(res, 503, { error: 'tools/hubx.env missing' }); return; }
      const page = Math.max(1, Number(u.searchParams.get('page')) || 1);
      const q = u.searchParams.get('search') || '';
      const data = await hubxGet(`/api/products?pageSize=100&pageNumber=${page}&onlyActive=true${q ? `&searchQuery=${encodeURIComponent(q)}` : ''}`);
      json(res, 200, data);
      return;
    }

    // find the item's existing page on Walmart
    if (req.method === 'GET' && u.pathname === '/lister/search') {
      const q = String(u.searchParams.get('q') || '').trim();
      if (!q) { json(res, 400, { error: 'q required' }); return; }
      if (!WM_OK) { json(res, 200, { mock: true, items: mockSearch(q) }); return; }
      const r = await wmCall('GET', `/v3/items/walmart/search?query=${encodeURIComponent(q)}`);
      if (r.status !== 200) { json(res, r.status, r.body); return; }
      const items = (r.body.items || []).map(it => ({
        itemId: String(it.itemId || ''), title: it.title || '', brand: it.brand || '',
        gtin: it.gtin || it.upc || '', price: it.price && it.price.amount || null, mock: false,
      }));
      json(res, 200, { mock: false, items });
      return;
    }

    // saved matches
    if (req.method === 'GET' && u.pathname === '/lister/mappings') { json(res, 200, DATA.mappings); return; }
    if (req.method === 'POST' && u.pathname === '/lister/mappings') {
      const m = JSON.parse(await readBody(req));
      if (!m.hubxId || !m.wmItemId || !m.sku) { json(res, 400, { error: 'hubxId, wmItemId and sku are required' }); return; }
      DATA.mappings[m.hubxId] = {
        hubxId: m.hubxId, mpn: m.mpn || '', description: m.description || '',
        wmItemId: String(m.wmItemId), wmTitle: m.wmTitle || '',
        sku: String(m.sku).toUpperCase(), price: Number(m.price) || 0, qty: Number(m.qty) || 1,
        cost: Number(m.cost) || 0, listed: false, savedAt: new Date().toISOString(),
      };
      save();
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && u.pathname === '/lister/mappings/delete') {
      const { hubxId } = JSON.parse(await readBody(req));
      delete DATA.mappings[hubxId];
      save();
      json(res, 200, { ok: true });
      return;
    }

    // build + submit the item-match feed from every unlisted saved match
    if (req.method === 'POST' && u.pathname === '/lister/submit') {
      const rows = Object.values(DATA.mappings).filter(m => !m.listed);
      if (!rows.length) { json(res, 400, { error: 'no unlisted matches to submit' }); return; }
      if (!WM_OK) {
        const feed = {
          feedId: `MOCK-FEED-${Date.now()}`, mock: true, status: 'RECEIVED',
          submittedAt: new Date().toISOString(), skus: rows.map(m => m.sku),
        };
        DATA.feeds.unshift(feed);
        rows.forEach(m => { m.listed = true; });
        save();
        mockProgress(feed);
        json(res, 200, { ok: true, feedId: feed.feedId, mock: true, items: rows.length });
        return;
      }
      // NOTE: MP_ITEM_MATCH spec 4.2 shape — if Walmart's feed validator wants
      // different fields, its per-item error report will say exactly what;
      // adjust here (this is the one endpoint we cannot dry-run without keys)
      const feedBody = {
        MPItemFeedHeader: { sellingChannel: 'marketplace', processMode: 'REPLACE', subset: 'EXTERNAL', locale: 'en', version: '4.2' },
        MPItem: rows.map(m => ({
          Item: {
            sku: m.sku,
            condition: 'New',
            productIdentifiers: { productIdType: 'ITEM_ID', productId: m.wmItemId },
            price: Number(m.price),
            ShippingWeight: 1,
          },
        })),
      };
      const r = await wmCall('POST', '/v3/feeds?feedType=MP_ITEM_MATCH', feedBody);
      if (r.status !== 200 || !r.body.feedId) { json(res, r.status || 502, r.body); return; }
      const feed = {
        feedId: r.body.feedId, mock: false, status: 'RECEIVED',
        submittedAt: new Date().toISOString(), skus: rows.map(m => m.sku),
      };
      DATA.feeds.unshift(feed);
      rows.forEach(m => { m.listed = true; });
      save();
      json(res, 200, { ok: true, feedId: feed.feedId, items: rows.length });
      return;
    }

    // feed history + live status refresh
    if (req.method === 'GET' && u.pathname === '/lister/feeds') {
      if (WM_OK) {
        for (const f of DATA.feeds.slice(0, 5)) {
          if (f.mock || f.status === 'PROCESSED' || f.status === 'ERROR') continue;
          const r = await wmCall('GET', `/v3/feeds/${encodeURIComponent(f.feedId)}?includeDetails=false`);
          if (r.status === 200 && r.body.feedStatus) {
            f.status = r.body.feedStatus;
            f.itemsReceived = r.body.itemsReceived;
            f.itemsSucceeded = r.body.itemsSucceeded;
            f.itemsFailed = r.body.itemsFailed;
          }
        }
        save();
      }
      json(res, 200, DATA.feeds.slice(0, 20));
      return;
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`HUBX -> Walmart lister up: http://localhost:${PORT}`);
  console.log(`HUBX: ${HUBX_OK ? `real (${HUBX.HUBX_ENV || 'sandbox'})` : 'MISSING tools/hubx.env'}   Walmart: ${WM_OK ? 'LIVE keys' : 'MOCK (add tools/walmart.env to go live)'}`);
});
