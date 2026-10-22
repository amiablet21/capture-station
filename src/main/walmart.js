'use strict';
// Walmart Marketplace API for Ship with Walmart labels on Walmart orders
// (owner 2026-10-20): Walmart's own rates beside our UPS accounts, the label
// bought through Walmart and tied to the PO. The seller's own key pair
// (Seller Center → API Key Management) authenticates with client
// credentials; tokens last 15 minutes.
// Shapes per developer.walmart.com (US Marketplace): Token API, Orders
// (GET /v3/orders/{po}), Ship with Walmart shipping-estimates / labels /
// labels/carriers/{carrier}/trackings/{tracking} (download + discard).
// List on Walmart (owner 2026-10-22) rides the same keys: catalog search by
// name, UPC lookup, the MP_ITEM_MATCH 4.2 offer feed, its per-SKU status
// and the new offer's stock. Walmart's search gives out no UPCs, so the
// caller brings one (Linnworks barcode or a scan) and proves it by lookup.

const crypto = require('node:crypto');

const HOST = 'https://marketplace.walmartapis.com';
const SVC = 'Walmart Marketplace';

// carriers and services the owner never ships with (2026-10-19): USPS, UPS
// Ground Saver / SurePost, FedEx Ground Economy (SmartPost) — never offered
const EXCLUDED = /USPS|GROUND[\s_-]*SAVER|SURE[\s_-]*POST|GROUND[\s_-]*ECONOMY|SMART[\s_-]*POST/i;

class WalmartError extends Error {}

const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function errorText(body, status) {
  // item / feed APIs wrap the list as {errors: {error: [...]}}
  const wrapped = body && body.errors && !Array.isArray(body.errors) && body.errors.error;
  const errs = arr(wrapped || (body && (body.errors || (body.error && arr(body.error)))));
  const msg = errs.map(e => clip(e.description || e.message || e.info || e.code, 300)).filter(Boolean).join(' · ');
  if (msg) return msg;
  if (body && body.error_description) return String(body.error_description);
  return `Walmart answered ${status}`;
}

// a date Walmart sends (epoch ms or ISO) as a local YYYY-MM-DD, '' if unset
function dayOf(v) {
  if (v === undefined || v === null || v === '') return '';
  const d = new Date(/^\d+$/.test(String(v)) ? Number(v) : v);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2010) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// a Walmart order as the label calls need it: every line's number, SKU and
// quantity, the ship-to, and the delivery date Walmart promised the buyer
function parseOrder(body) {
  const o = (body && (body.order || (body.list && body.list.elements && arr(body.list.elements.order)[0]))) || body;
  if (!o || !o.purchaseOrderId) return null;
  const lines = arr(o.orderLines && o.orderLines.orderLine).map(l => ({
    lineNumber: String(l.lineNumber || ''),
    sku: String((l.item && l.item.sku) || ''),
    quantity: Number(l.orderLineQuantity && l.orderLineQuantity.amount) || 1,
  })).filter(l => l.lineNumber && l.sku);
  const a = (o.shippingInfo && o.shippingInfo.postalAddress) || {};
  return {
    purchaseOrderId: String(o.purchaseOrderId),
    orderedOn: dayOf(o.orderDate),
    deliverBy: dayOf(o.shippingInfo && o.shippingInfo.estimatedDeliveryDate),
    shipBy: dayOf(o.shippingInfo && o.shippingInfo.estimatedShipDate),
    lines,
    shipTo: {
      name: clip(a.name, 60),
      line1: clip(a.address1, 60),
      line2: clip(a.address2, 60),
      city: clip(a.city, 40),
      state: clip(a.state, 2).toUpperCase(),
      zip: String(a.postalCode || '').trim(),
    },
  };
}

function parseEstimates(body) {
  const out = [];
  for (const e of arr(body && body.data && body.data.estimates)) {
    const name = String(e.name || '');
    const label = String(e.displayName || name);
    const carrier = String(e.carrierName || '');
    if (EXCLUDED.test(`${name} ${label} ${carrier}`)) continue;
    const price = Number(e.estimatedRate && e.estimatedRate.amount);
    if (!Number.isFinite(price)) continue;
    out.push({
      code: name, // the carrierServiceType the label is bought with
      name: label,
      carrier,
      price: Math.round(price * 100) / 100,
      arrival: String(e.deliveryDate || '').slice(0, 10),
      days: null,
    });
  }
  return out.sort((a, b) => a.price - b.price);
}

const boxDimensions = (pkg) => ({
  boxDimensionUnit: 'IN',
  boxWeightUnit: 'LB',
  boxWeight: Math.max(0.1, Math.round((Number(pkg.weight) || 0) * 10) / 10),
  boxLength: Math.max(1, Math.round(Number(pkg.length) || 1)),
  boxWidth: Math.max(1, Math.round(Number(pkg.width) || 1)),
  boxHeight: Math.max(1, Math.round(Number(pkg.height) || 1)),
});

// only line number, SKU and quantity travel — never a product name
const boxItems = (lines) => lines.map(l => ({ lineNumber: l.lineNumber, sku: l.sku, quantity: l.quantity }));

const walmartAddress = (a) => ({
  postalCode: String(a.zip || '').trim(),
  countryCode: 'US',
  addressLines: [clip(a.line1, 60), clip(a.line2, 60)].filter(Boolean),
  city: clip(a.city, 40),
  state: clip(a.state, 2).toUpperCase(),
});

function buildEstimateRequest({ order, pkg, shipFrom }) {
  return {
    packageType: 'CUSTOM_PACKAGE',
    purchaseOrderId: order.purchaseOrderId,
    boxItems: boxItems(order.lines),
    boxDimensions: boxDimensions(pkg),
    fromAddress: walmartAddress(shipFrom),
    toAddress: walmartAddress(order.shipTo),
    includeServicesNotMeetingDeliveryPromise: true,
  };
}

function buildLabelRequest({ order, pkg, shipFrom, returnTo, carrierName, serviceType }) {
  const from = {
    contactName: clip(shipFrom.name || shipFrom.company, 60),
    companyName: clip(shipFrom.company || shipFrom.name, 60),
    addressLine1: clip(shipFrom.line1, 60),
    addressLine2: clip(shipFrom.line2, 60),
    city: clip(shipFrom.city, 40),
    state: clip(shipFrom.state, 2).toUpperCase(),
    postalCode: String(shipFrom.zip || '').trim(),
    country: 'US',
    phone: String(shipFrom.phone || '').replace(/\D/g, ''),
  };
  if (shipFrom.email) from.email = clip(shipFrom.email, 120);
  if (!from.addressLine2) delete from.addressLine2;
  const req = {
    packageType: 'CUSTOM_PACKAGE',
    boxDimensions: boxDimensions(pkg),
    boxItems: boxItems(order.lines),
    fromAddress: from,
    purchaseOrderId: order.purchaseOrderId,
    carrierName,
    carrierServiceType: serviceType,
  };
  if (returnTo && returnTo.line1 && returnTo.zip) {
    req.returnAddress = {
      contactName: clip(returnTo.name || returnTo.company, 60),
      addressLine1: clip(returnTo.line1, 60),
      city: clip(returnTo.city, 40),
      state: clip(returnTo.state, 2).toUpperCase(),
      postalCode: String(returnTo.zip || '').trim(),
      country: 'US',
      phone: String(returnTo.phone || shipFrom.phone || '').replace(/\D/g, ''),
    };
  }
  return req;
}

function parseLabel(body) {
  const d = body && body.data;
  if (!d || !d.trackingNo) throw new WalmartError('Walmart sent back no tracking number.');
  return {
    tracking: String(d.trackingNo),
    carrier: String(d.carrierName || ''),
    service: String(d.carrierServiceType || ''),
    trackingUrl: String(d.trackingUrl || ''),
  };
}

class WalmartClient {
  // host: only the automated tests point the client at a fake Walmart
  constructor({ clientId, clientSecret } = {}, { host = '' } = {}) {
    this.creds = { clientId: String(clientId || '').trim(), clientSecret: String(clientSecret || '').trim() };
    this.host = host || WalmartClient.testHost || HOST;
  }

  headers(extra = {}) {
    return { 'WM_SVC.NAME': SVC, 'WM_QOS.CORRELATION_ID': crypto.randomUUID(), ...extra };
  }

  async token() {
    const { clientId, clientSecret } = this.creds;
    if (!clientId || !clientSecret) throw new WalmartError('Walmart Client ID and secret are not set (Settings › Shipping).');
    const key = `${this.host}|${crypto.createHash('sha256').update(`${clientId}|${clientSecret}`).digest('hex')}`;
    const hit = WalmartClient.tokens.get(key);
    if (hit && hit.until > Date.now() + 30000) return hit.token;
    const res = await fetch(`${this.host}/v3/token`, {
      method: 'POST',
      headers: this.headers({
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.access_token) {
      throw new WalmartError(res.status === 401 ? 'Walmart did not accept the Client ID / secret.' : errorText(body, res.status));
    }
    const ttl = Math.max(60, Number(body.expires_in) || 900) * 1000;
    WalmartClient.tokens.set(key, { token: body.access_token, until: Date.now() + ttl });
    return body.access_token;
  }

  // accept: 'application/json' answers parsed JSON; anything else a Buffer
  async call(method, pathname, payload, { accept = 'application/json', retried = false } = {}) {
    const token = await this.token();
    const res = await fetch(`${this.host}${pathname}`, {
      method,
      headers: this.headers({ 'WM_SEC.ACCESS_TOKEN': token, Accept: accept, 'Content-Type': 'application/json' }),
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(45000),
    });
    if (res.status === 401 && !retried) {
      WalmartClient.tokens.clear();
      return this.call(method, pathname, payload, { accept, retried: true });
    }
    if (accept !== 'application/json' && res.ok) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new WalmartError(errorText(body, res.status));
    return body;
  }

  // the carriers Walmart sells labels for on this account (Supported
  // carriers API); the docs say FedEx and USPS today (owner 2026-10-21: show
  // it on Test, so UPS is noticed the day Walmart adds it)
  async carriers() {
    const body = await this.call('GET', '/v3/shipping/labels/carriers');
    const list = arr((body && (body.data || body.carriers || body.carrierList)) || body);
    return [...new Set(list.map(c => clip(c && (c.shortName || c.carrierName || c.name), 40)).filter(Boolean))];
  }

  async order(po) {
    const body = await this.call('GET', `/v3/orders/${encodeURIComponent(String(po).trim())}`);
    const o = parseOrder(body);
    if (!o) throw new WalmartError(`Walmart has no order ${po}.`);
    if (!o.lines.length) throw new WalmartError(`Walmart order ${po} has no lines to ship.`);
    return o;
  }

  async estimates(input) {
    return parseEstimates(await this.call('POST', '/v3/shipping/labels/shipping-estimates', buildEstimateRequest(input)));
  }

  async createLabel(input) {
    return parseLabel(await this.call('POST', '/v3/shipping/labels', buildLabelRequest(input)));
  }

  // the label as a PNG; Walmart may still be drawing it right after the
  // purchase (202), so it is asked again a few times
  async downloadLabel(carrier, tracking) {
    const path = `/v3/shipping/labels/carriers/${encodeURIComponent(carrier)}/trackings/${encodeURIComponent(tracking)}`;
    for (let i = 0; i < 4; i++) {
      const r = await this.call('GET', path, null, { accept: 'image/png' });
      if (r.status === 200 && r.buffer.length > 100) return r.buffer.toString('base64');
      await new Promise(res => setTimeout(res, 1500));
    }
    throw new WalmartError('Walmart has not finished the label image yet. Try Reprint in a moment.');
  }

  /* ----- List on Walmart ----- */

  // keyword search of Walmart's catalog: up to 40 published items
  async searchByName(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    return normalizeSearch(await this.call('GET', `/v3/items/walmart/search?query=${encodeURIComponent(q)}`));
  }

  // identifier lookup: 0 or 1 item (12 digits -> upc, 13 -> ean, 14 -> gtin)
  async lookupUpc(code) {
    const id = idParam(code);
    if (!id) return null;
    return normalizeSearch(await this.call('GET', `/v3/items/walmart/search?${id.param}=${id.value}`))[0] || null;
  }

  async submitMatchFeed(offers) {
    const body = await this.call('POST', '/v3/feeds?feedType=MP_ITEM_MATCH', buildMatchFeed(offers));
    if (!body || !body.feedId) throw new WalmartError(`Walmart took the upload but returned no feed id${body ? ` (${errorText(body, 200)})` : ''}.`);
    return body.feedId;
  }

  // every page of per-SKU results (50 per page with details)
  async feedStatus(feedId) {
    let first = null;
    const rows = [];
    for (let offset = 0; offset < 10000; offset += 50) {
      const j = await this.call('GET', `/v3/feeds/${encodeURIComponent(feedId)}?includeDetails=true&offset=${offset}&limit=50`);
      if (!first) first = j;
      const page = arr(j && j.itemDetails && j.itemDetails.itemIngestionStatus);
      rows.push(...page);
      if (page.length < 50) break;
    }
    return parseFeedStatus({ ...(first || {}), itemDetails: { itemIngestionStatus: rows } });
  }

  // an offer set up by match carries no quantity of its own
  async setInventory(sku, amount) {
    return this.call('PUT', `/v3/inventory?sku=${encodeURIComponent(sku)}`,
      { sku, quantity: { unit: 'EACH', amount: Math.max(0, Math.floor(Number(amount) || 0)) } });
  }

  async discard(carrier, tracking) {
    const body = await this.call('DELETE', `/v3/shipping/labels/carriers/${encodeURIComponent(carrier)}/trackings/${encodeURIComponent(tracking)}`);
    if (body && body.data !== undefined && String(body.data) !== 'true') throw new WalmartError('Walmart did not void the label.');
    return true;
  }
}
WalmartClient.tokens = new Map();
// the e2e suite's fake Walmart (CAPTURE_WALMART_BASE: a stand-in for
// driving the app by hand in test runs)
WalmartClient.testHost = process.env.CAPTURE_WALMART_BASE || '';

/* ---------- List on Walmart: pure builders + parsers (tested in e2e) ---------- */

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
  return arr(j && j.items).filter(it => it && it.itemId).map(it => {
    const amount = it.price && it.price.amount != null ? Number(it.price.amount) : 0;
    return {
      itemId: String(it.itemId),
      title: String(it.title || ''),
      brand: String(it.brand || ''),
      image: (arr(it.images)[0] || {}).url || '',
      price: Number.isFinite(amount) ? amount : 0,
      productType: String(it.productType || ''),
      // walmart.com's product page for an item id (convention, not in the docs)
      url: `https://www.walmart.com/ip/${encodeURIComponent(String(it.itemId))}`,
    };
  });
}

// the offer conditions an MP_ITEM_MATCH feed takes without extra ids
// (Restored grades also need restoredProductIdentifier, spec 5.x only).
// Everything but New needs Walmart's Pre-Owned approval and a photo.
const MATCH_CONDITIONS = ['New', 'Pre-Owned: Like New', 'Pre-Owned: Good', 'Pre-Owned: Fair', 'Remanufactured', 'New with defects'];

// offers -> MP_ITEM_MATCH 4.2 payload (official schema: no businessUnit in
// the 4.2 header; condition / price / ShippingWeight / sku / ids required;
// mainImageUrl required for every condition but New)
function buildMatchFeed(offers) {
  return {
    MPItemFeedHeader: { sellingChannel: 'mpsetupbymatch', locale: 'en', version: '4.2', processMode: 'REPLACE', subset: 'EXTERNAL' },
    MPItem: arr(offers).map(o => ({
      Item: {
        sku: String(o.sku).slice(0, 50),
        productIdentifiers: { productIdType: 'GTIN', productId: toGtin14(o.upc) },
        price: Math.round(Number(o.price) * 100) / 100,
        ShippingWeight: Math.round(Number(o.shipLb) * 1000) / 1000,
        condition: o.condition || 'New',
        ...(o.condition && o.condition !== 'New' && o.mainImageUrl ? { mainImageUrl: String(o.mainImageUrl) } : {}),
      },
    })),
  };
}

// feed status JSON -> { status, counts, items: { sku: { status, errors[], wpid, itemId } } }
function parseFeedStatus(j) {
  const items = {};
  for (const r of arr(j && j.itemDetails && j.itemDetails.itemIngestionStatus)) {
    if (!r || !r.sku) continue;
    const errs = arr(r.ingestionErrors && r.ingestionErrors.ingestionError)
      .map(e => [e.field ? `${e.field}: ` : '', e.description || e.code || e.type || ''].join('').trim())
      .filter(Boolean);
    items[String(r.sku)] = {
      status: String(r.ingestionStatus || 'INPROGRESS').toUpperCase(),
      errors: errs,
      wpid: r.wpid || '',
      itemId: r.itemid || r.itemId || '',
    };
  }
  return {
    status: String((j && j.feedStatus) || 'RECEIVED').toUpperCase(),
    counts: {
      received: Number(j && j.itemsReceived) || 0,
      succeeded: Number(j && j.itemsSucceeded) || 0,
      failed: Number(j && j.itemsFailed) || 0,
      processing: Number(j && j.itemsProcessing) || 0,
    },
    items,
    feedErrors: arr(j && j.ingestionErrors && j.ingestionErrors.ingestionError).map(e => e.description || e.code || '').filter(Boolean),
  };
}

// a SKU is settled once Walmart says SUCCESS or any *_ERROR
const isFinal = (s) => s === 'SUCCESS' || /ERROR$/.test(String(s || ''));

module.exports = {
  WalmartClient, WalmartError, EXCLUDED,
  parseOrder, parseEstimates, dayOf, buildEstimateRequest, buildLabelRequest, parseLabel, errorText,
  idParam, toGtin14, normalizeSearch, buildMatchFeed, parseFeedStatus, isFinal, MATCH_CONDITIONS,
};
