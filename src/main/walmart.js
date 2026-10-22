'use strict';
// Walmart Marketplace API client for List on Walmart (owner 2026-10-22).
// The seller's own keys (client credentials) -> 15-minute bearer token ->
//   catalog item search by name (GET /v3/items/walmart/search?query=)
//   identifier lookup by UPC/EAN/GTIN (same endpoint, 0 or 1 item)
//   offer-only setup feed (POST /v3/feeds?feedType=MP_ITEM_MATCH, spec 4.2)
//   feed status per SKU (GET /v3/feeds/{id}?includeDetails=true)
//   stock for a new offer (PUT /v3/inventory?sku=)
// Request/response shapes verified against developer.walmart.com's
// OpenAPI pages and the official MP_ITEM_MATCH 4.2 schema (2026-10-22).
// Walmart's search response carries NO UPC, so the UPC an offer needs comes
// from the caller (Linnworks barcode or a scan), proven by identifier lookup.
// The pure builders/parsers at the bottom are exported for the e2e suite.

const crypto = require('node:crypto');

const HOSTS = { prod: 'https://marketplace.walmartapis.com', sandbox: 'https://sandbox.walmartapis.com' };
const SVC = 'Walmart Marketplace';

class WalmartError extends Error {
  constructor(message, { status, endpoint } = {}) {
    super(message);
    this.status = status;
    this.endpoint = endpoint;
  }
}

class WalmartClient {
  constructor({ clientId, clientSecret, sandbox } = {}) {
    this.clientId = String(clientId || '').trim();
    this.clientSecret = String(clientSecret || '').trim();
    this.sandbox = !!sandbox;
    // CAPTURE_WALMART_BASE: a local stand-in for Walmart in test runs only
    this.base = process.env.CAPTURE_WALMART_BASE || (this.sandbox ? HOSTS.sandbox : HOSTS.prod);
    this.token = null; // { value, until }
  }

  configured() {
    return !!(this.clientId && this.clientSecret);
  }

  async auth() {
    if (!this.configured()) throw new WalmartError('Add your Walmart API Client ID and Client secret in Settings first.');
    if (this.token && Date.now() < this.token.until) return this.token.value;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch(`${this.base}/v3/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'WM_SVC.NAME': SVC,
        'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new WalmartError(res.status === 401 || res.status === 400
        ? 'Walmart refused the keys — check the Client ID and Client secret (and the Sandbox tick: sandbox keys only work in the sandbox).'
        : `Walmart sign-in failed (${res.status}): ${errText(text)}`, { status: res.status, endpoint: 'token' });
    }
    const j = JSON.parse(text);
    if (!j.access_token) throw new WalmartError('Walmart sign-in returned no token.');
    // renew a minute early so a long batch never runs on an expiring token
    this.token = { value: j.access_token, until: Date.now() + Math.max(60, (Number(j.expires_in) || 900) - 60) * 1000 };
    return this.token.value;
  }

  async call(method, path, { query, body } = {}) {
    const token = await this.auth();
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    const headers = {
      'WM_SEC.ACCESS_TOKEN': token,
      'WM_SVC.NAME': SVC,
      'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      // token bucket: one patient retry, then report it plainly
      if (res.status === 429 && attempt === 0) { await new Promise(r => setTimeout(r, 4000)); continue; }
      if (!res.ok) {
        const ep = path.replace(/\?.*$/, '');
        if (res.status === 429) throw new WalmartError('Walmart says too many requests right now — wait a minute and try again.', { status: 429, endpoint: ep });
        throw new WalmartError(`Walmart ${ep} failed (${res.status}): ${errText(text)}`, { status: res.status, endpoint: ep });
      }
      if (!text) return {};
      try { return JSON.parse(text); } catch { throw new WalmartError(`Walmart ${path} returned something unreadable.`); }
    }
  }

  async test() {
    await this.auth();
    return { ok: true, sandbox: this.sandbox };
  }

  // keyword search of Walmart's catalog: up to 40 published items
  async searchByName(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    return normalizeSearch(await this.call('GET', '/v3/items/walmart/search', { query: { query: q } }));
  }

  // identifier lookup: 0 or 1 item. 12 digits -> upc, 13 -> ean, 14 -> gtin;
  // 8 / 11 digit UPCs are widened to the 12-digit form Walmart expects
  async lookupUpc(code) {
    const id = idParam(code);
    if (!id) return null;
    const items = normalizeSearch(await this.call('GET', '/v3/items/walmart/search', { query: { [id.param]: id.value } }));
    return items[0] || null;
  }

  async submitMatchFeed(offers) {
    const res = await this.call('POST', '/v3/feeds', { query: { feedType: 'MP_ITEM_MATCH' }, body: buildMatchFeed(offers) });
    if (!res.feedId) throw new WalmartError(`Walmart took the upload but returned no feed id${res.errors ? `: ${errText(JSON.stringify(res.errors))}` : ''}.`);
    return res.feedId;
  }

  // every page of per-SKU results (50 per page with details)
  async feedStatus(feedId) {
    const path = `/v3/feeds/${encodeURIComponent(feedId)}`;
    let first = null;
    const rows = [];
    for (let offset = 0; offset < 10000; offset += 50) {
      const j = await this.call('GET', path, { query: { includeDetails: 'true', offset, limit: 50 } });
      if (!first) first = j;
      const page = (((j || {}).itemDetails || {}).itemIngestionStatus) || [];
      rows.push(...page);
      if (page.length < 50) break;
    }
    return parseFeedStatus({ ...(first || {}), itemDetails: { itemIngestionStatus: rows } });
  }

  async setInventory(sku, amount) {
    return this.call('PUT', '/v3/inventory', {
      query: { sku },
      body: { sku, quantity: { unit: 'EACH', amount: Math.max(0, Math.floor(Number(amount) || 0)) } },
    });
  }
}

/* ---------- pure helpers (tested in e2e-test.js) ---------- */

function errText(text) {
  try {
    const j = JSON.parse(text);
    const list = (j.errors && (j.errors.error || j.errors)) || j.error || [];
    const arr = Array.isArray(list) ? list : [list];
    const msg = arr.map(e => (e && (e.description || e.info || e.message || e.code)) || '').filter(Boolean).join('; ');
    if (msg) return msg.slice(0, 300);
  } catch { /* not JSON */ }
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'no details';
}

// digits only -> the search parameter Walmart takes for it
function idParam(code) {
  let d = String(code || '').replace(/\D/g, '');
  if (d.length === 8 || d.length === 11) d = d.padStart(12, '0');
  if (d.length === 12) return { param: 'upc', value: d };
  if (d.length === 13) return { param: 'ean', value: d };
  if (d.length === 14) return { param: 'gtin', value: d };
  return null;
}

// any 8/11/12/13/14-digit barcode as the 14-digit GTIN the feed accepts
function toGtin14(code) {
  let d = String(code || '').replace(/\D/g, '');
  if (d.length === 8 || d.length === 11) d = d.padStart(12, '0');
  if (![12, 13, 14].includes(d.length)) return '';
  return d.padStart(14, '0');
}

// DEFAULT-format search response -> what the dialog shows. Numbers arrive
// as strings and price can be missing; {} means no match.
function normalizeSearch(j) {
  return ((j && j.items) || []).filter(it => it && it.itemId).map(it => {
    const amount = it.price && it.price.amount != null ? Number(it.price.amount) : 0;
    return {
      itemId: String(it.itemId),
      title: String(it.title || ''),
      brand: String(it.brand || ''),
      image: ((it.images || [])[0] || {}).url || '',
      price: Number.isFinite(amount) ? amount : 0,
      productType: String(it.productType || ''),
      // walmart.com's product page for an item id (convention, not in the docs)
      url: `https://www.walmart.com/ip/${encodeURIComponent(String(it.itemId))}`,
    };
  });
}

// offers -> MP_ITEM_MATCH 4.2 payload (the official schema: header takes no
// businessUnit in 4.2; condition / price / ShippingWeight / sku / ids required)
function buildMatchFeed(offers) {
  return {
    MPItemFeedHeader: { sellingChannel: 'mpsetupbymatch', locale: 'en', version: '4.2', processMode: 'REPLACE', subset: 'EXTERNAL' },
    MPItem: (offers || []).map(o => ({
      Item: {
        sku: String(o.sku).slice(0, 50),
        productIdentifiers: { productIdType: 'GTIN', productId: toGtin14(o.upc) },
        price: Math.round(Number(o.price) * 100) / 100,
        ShippingWeight: Math.round(Number(o.shipLb) * 1000) / 1000,
        condition: o.condition || 'New',
      },
    })),
  };
}

// feed status JSON -> { status, counts, items: { sku: { status, errors[], wpid, itemId } } }
function parseFeedStatus(j) {
  const items = {};
  for (const r of (((j || {}).itemDetails || {}).itemIngestionStatus) || []) {
    if (!r || !r.sku) continue;
    const errs = (((r.ingestionErrors || {}).ingestionError) || [])
      .map(e => [e.field ? `${e.field}: ` : '', e.description || e.code || e.type || ''].join('').trim())
      .filter(Boolean);
    items[String(r.sku)] = {
      status: String(r.ingestionStatus || 'INPROGRESS').toUpperCase(),
      errors: errs,
      wpid: r.wpid || '',
      itemId: r.itemid || r.itemId || '',
    };
  }
  const feedErrs = (((j || {}).ingestionErrors || {}).ingestionError || []).map(e => e.description || e.code || '').filter(Boolean);
  return {
    status: String((j && j.feedStatus) || 'RECEIVED').toUpperCase(),
    counts: {
      received: Number(j && j.itemsReceived) || 0,
      succeeded: Number(j && j.itemsSucceeded) || 0,
      failed: Number(j && j.itemsFailed) || 0,
      processing: Number(j && j.itemsProcessing) || 0,
    },
    items,
    feedErrors: feedErrs,
  };
}

// a SKU is settled once Walmart says SUCCESS or any *_ERROR
const isFinal = (s) => s === 'SUCCESS' || /ERROR$/.test(String(s || ''));

module.exports = { WalmartClient, WalmartError, _test: { normalizeSearch, buildMatchFeed, parseFeedStatus, toGtin14, idParam, errText, isFinal } };
