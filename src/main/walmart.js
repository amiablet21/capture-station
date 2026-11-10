'use strict';
// Walmart Marketplace API for Ship with Walmart labels on Walmart orders
// (owner 2026-10-20): Walmart's own rates beside our UPS accounts, the label
// bought through Walmart and tied to the PO. The seller's own key pair
// (Seller Center → API Key Management) authenticates with client
// credentials; tokens last 15 minutes.
// Shapes per developer.walmart.com (US Marketplace): Token API, Orders
// (GET /v3/orders/{po}), Ship with Walmart shipping-estimates / labels /
// labels/carriers/{carrier}/trackings/{tracking} (download + discard).
// The Walmart tab (owner 2026-10-22 / 23) rides the same keys: UPC lookup
// (proving a UPC read off walmart.com is the picked item), the MP_ITEM_MATCH
// 4.2 offer feed, its per-SKU status, the new offer's stock and live status;
// Pricing Insights + the repricer (strategies, repricerFeeds), single price
// updates; price incentives (reduced referral fee enrollment, Walmart-funded
// opt in / out). Shapes per developer.walmart.com's OpenAPI specs.

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
  // the repricer answers { status, errorMessage }
  if (body && body.errorMessage) return clip(body.errorMessage, 300);
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
  async call(method, pathname, payload, { accept = 'application/json', retried = false, waited = 0, extra = null } = {}) {
    const token = await this.token();
    const res = await fetch(`${this.host}${pathname}`, {
      method,
      headers: this.headers({ 'WM_SEC.ACCESS_TOKEN': token, Accept: accept, 'Content-Type': 'application/json', ...(extra || {}) }),
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(45000),
    });
    if (res.status === 401 && !retried) {
      WalmartClient.tokens.clear();
      return this.call(method, pathname, payload, { accept, retried: true, waited, extra });
    }
    // over Walmart's per-API request limit (owner 2026-10-23, Pricing: "You
    // have exceeded your API calls threshold"): wait for the next refill
    // when it is close, twice at most, else say when to try again
    if (res.status === 429) {
      const next = Number(res.headers.get('x-next-replenishment-time'));
      const after = Number(res.headers.get('retry-after'));
      const ms = Number.isFinite(next) && next > Date.now() ? next - Date.now() : Number.isFinite(after) && after > 0 ? after * 1000 : 3000 * (waited + 1);
      if (waited < 2 && ms <= 20000) {
        await new Promise(r => setTimeout(r, ms + 250));
        return this.call(method, pathname, payload, { accept, retried, waited: waited + 1, extra });
      }
      const err = new WalmartError(`Walmart's limit on requests was reached. ${ms > 90000 ? `Try again after ${new Date(Date.now() + ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` : 'Try again in a minute.'}`);
      err.rateLimited = true;
      err.retryAt = Date.now() + ms;
      throw err;
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

  // Payment Reports API (owner 2026-11-10: the payment periods arrive in
  // Recovery without a manual import): the settlement dates Walmart has a
  // reconciliation report for, as MMDDYYYY strings (the payment date, the
  // same date Seller Center's download puts after "MP_" in its file name)
  async reconReportDates() {
    const body = await this.call('GET', '/v3/report/reconreport/availableReconFiles?reportVersion=v1');
    return arr(body && body.availableApReportDates).map(String).filter(d => /^\d{8}$/.test(d));
  }

  // one settlement's reconciliation report as CSV text. Walmart streams a
  // zip holding the CSV (a plain CSV body is taken as is)
  async reconReport(date) {
    const q = `reportVersion=v1&reportDate=${encodeURIComponent(date)}`;
    const res = await this.call('GET', `/v3/report/reconreport/reconFile?${q}`, null, { accept: 'application/octet-stream' });
    const buf = res && res.buffer;
    if (!buf || !buf.length) throw new WalmartError(`Walmart sent an empty report for ${date}.`);
    if (buf.readUInt32LE(0) === 0x04034b50) {
      const zip = require('./shipfile.js').readZip(buf);
      const name = [...zip.entries.keys()].find(n => /\.csv$/i.test(n)) || [...zip.entries.keys()][0];
      if (!name) throw new WalmartError(`Walmart's report for ${date} was an empty zip.`);
      return { name, text: zip.read(name).toString('utf8').replace(/^﻿/, '') };
    }
    return { name: '', text: buf.toString('utf8').replace(/^﻿/, '') };
  }

  async order(po) {
    const body = await this.call('GET', `/v3/orders/${encodeURIComponent(String(po).trim())}`);
    const o = parseOrder(body);
    if (!o) throw new WalmartError(`Walmart has no order ${po}.`);
    if (!o.lines.length) throw new WalmartError(`Walmart order ${po} has no lines to ship.`);
    return o;
  }

  // WFS stock, one row per Walmart listing ({ sku, shipNodes: [{ onHandQty,
  // availToSellQty }] }) - the app's WFS counts come from here, not from
  // Linnworks' WFS location (owner 2026-11-05, see wfscount.js)
  async wfsInventory() {
    const out = [];
    for (let offset = 0; offset < 30000; offset += 300) {
      const body = await this.call('GET', `/v3/fulfillment/inventory?limit=300&offset=${offset}`);
      const page = arr(body && body.payload && body.payload.inventory);
      out.push(...page);
      if (page.length < 300) break;
    }
    return out;
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

  // identifier lookup: 0 or 1 item (12 digits -> upc, 13 -> ean, 14 -> gtin)
  async lookupUpc(code) {
    const id = idParam(code);
    if (!id) return null;
    return normalizeSearch(await this.call('GET', `/v3/items/walmart/search?${id.param}=${id.value}`))[0] || null;
  }

  // GTIN / UPC an item number carries, via Get an item (productIdType=
  // ITEM_ID). Walmart documents it for the seller's own "partner catalog",
  // so for an item the seller does not sell yet it may answer nothing —
  // callers treat [] as "try another way". Codes still need proving.
  async itemIdentifiers(itemId) {
    const id = String(itemId || '').replace(/\D/g, '');
    if (!id) return [];
    const body = await this.call('GET', `/v3/items/${encodeURIComponent(id)}?productIdType=ITEM_ID`);
    const rows = arr((body && (body.ItemResponse || body.itemResponse || body.items)) || body);
    const codes = [];
    for (const r of rows) {
      // the 12-digit UPC first: it is what the box shows and Linnworks keeps
      for (const v of [r && r.upc, r && r.gtin]) {
        const d = String(v || '').replace(/\D/g, '');
        if (d.length >= 8 && d.length <= 14 && !codes.includes(d)) codes.push(d);
      }
    }
    return codes;
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

  /* ----- Pricing: repricer + Buy Box (owner 2026-10-23) ----- */

  // every listing's price, Buy Box price / win rate and repricer setup in
  // one paged answer (Pricing Insights; the item report takes 15-45 min).
  // The owner's first run (2026-10-23) came back with no rows, so the rows
  // are looked for wherever the answer keeps them, paging stops when a page
  // brings nothing new, and the raw first answer is kept for diagnosis.
  async pricingInsights(extra = {}) {
    const rows = [];
    const seen = new Set();
    this.insightsPartial = false;
    for (let page = 0; page < 200; page++) {
      let j;
      try {
        j = await this.call('POST', '/v3/price/getPricingInsights', { pageNumber: page, ...extra });
      } catch (e) {
        // the limit hit part-way: keep the pages already read
        if (!e.rateLimited || !rows.length) throw e;
        this.insightsPartial = true;
        break;
      }
      if (page === 0) this.lastInsights = j;
      const list = insightRows(j).map(parseInsight).filter(r => r && !seen.has(r.sku));
      list.forEach(r => seen.add(r.sku));
      rows.push(...list);
      const pc = (j && j.pageContext) || {};
      const total = Number(pc.totalCount ?? pc.totalElements ?? pc.totalItems ?? j.totalCount ?? j.totalElements);
      if (page === 0) this.insightsPageSize = list.length;
      // the last page: told by the total, or a page shorter than the first
      // (owner 2026-10-23: asking past the end ran into Walmart's limit)
      if (!list.length || (Number(pc.totalPages) > 0 && page + 1 >= Number(pc.totalPages))
        || (total > 0 && rows.length >= total) || list.length < this.insightsPageSize) break;
    }
    return rows;
  }

  // the same, asked SKU by SKU (100 at a time) for the given SKUs
  async insightsBySku(skus) {
    const rows = [];
    for (let i = 0; i < skus.length; i += 100) {
      rows.push(...await this.pricingInsights({ searchCriteria: { searchField: 'SKU', searchValue: skus.slice(i, i + 100) } }));
    }
    return rows;
  }

  // every item in the seller's catalog (Get all items, 200 a page by
  // cursor): SKU, title, price, published status, GTIN, item id when given
  async allItems() {
    const out = [];
    let cursor = '*';
    for (let i = 0; i < 200 && cursor; i++) {
      const j = await this.call('GET', `/v3/items?limit=200&nextCursor=${encodeURIComponent(cursor)}`);
      const list = arr(j && (j.ItemResponse || j.itemResponse || j.items));
      for (const it of list) {
        if (!it || !it.sku) continue;
        out.push({
          sku: String(it.sku), title: clip(it.productName, 300),
          price: money2(it.price && typeof it.price === 'object' ? it.price.amount : it.price),
          published: String(it.publishedStatus || '').toUpperCase(),
          gtin: String(it.gtin || it.upc || '').replace(/\D/g, ''), itemId: String(it.itemId || it.itemID || ''),
        });
      }
      const next = j && j.nextCursor;
      cursor = list.length && next && next !== cursor ? next : '';
    }
    return out;
  }

  // the on-request Item report (v3 has Repricer Strategy, Minimum / Maximum
  // Seller Allowed Price and Repricer Status per SKU): Pricing Insights
  // doesn't say which strategy an item is on (owner 2026-10-23). Walmart
  // takes 15-45 minutes to make it
  async requestItemReport() {
    const j = await this.call('POST', '/v3/reports/reportRequests?reportType=ITEM&reportVersion=v3', {});
    if (!j || !j.requestId) throw new WalmartError('Walmart took the report request but returned no request id.');
    return String(j.requestId);
  }

  async reportStatus(requestId) {
    const j = await this.call('GET', `/v3/reports/reportRequests/${encodeURIComponent(requestId)}`);
    return String((j && j.requestStatus) || '').toUpperCase();
  }

  // the finished report's file (a zip of one CSV, or the CSV itself)
  async reportFile(requestId) {
    const j = await this.call('GET', `/v3/reports/downloadReport?requestId=${encodeURIComponent(requestId)}`);
    const url = j && (j.downloadURL || j.downloadUrl);
    if (!url || !/^https?:\/\//i.test(url)) throw new WalmartError('Walmart gave no download link for the report.');
    const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new WalmartError(`The report download failed (${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  }

  async strategies() {
    const j = await this.call('GET', '/v3/repricer/strategies');
    this.lastStrategies = j;
    return arr(j && j.strategyCollections).map(parseStrategy).filter(Boolean);
  }

  // create (no id) or update a strategy; answers the saved one
  async saveStrategy(s) {
    const body = buildStrategy(s);
    const j = s.id
      ? await this.call('PUT', `/v3/repricer/strategy/${encodeURIComponent(s.id)}`, body)
      : await this.call('POST', '/v3/repricer/strategy', body);
    return parseStrategy(j) || { ...s };
  }

  async deleteStrategy(id) {
    return this.call('DELETE', `/v3/repricer/strategy/${encodeURIComponent(id)}`);
  }

  // [{ sku, strategy (name, or '' to take it out), min, max }] -> feed id
  async repricerFeed(items) {
    const j = await this.call('POST', '/v3/repricerFeeds', buildRepricerFeed(items));
    if (!j || !j.feedId) throw new WalmartError('Walmart took the repricer change but returned no feed id.');
    return j.feedId;
  }

  async setPrice(sku, amount) {
    return this.call('PUT', '/v3/price', {
      sku: String(sku),
      pricing: [{ currentPriceType: 'BASE', currentPrice: { currency: 'USD', amount: Math.round(Number(amount) * 100) / 100 } }],
    });
  }

  /* ----- Incentives (owner 2026-10-23) ----- */

  // type REDUCED_REFERRAL | WALMART_FUNDED, status ELIGIBLE | ENROLLED
  async incentives(type, status) {
    const rows = [];
    for (let offset = 0; offset < 20000; offset += 200) {
      const j = await this.call('GET', `/v3/price/incentives?limit=200&offset=${offset}&incentiveType=${encodeURIComponent(type)}&incentiveStatus=${encodeURIComponent(status)}&sortBy=EXPIRATION_DATE&sortOrder=ASC`);
      const list = arr(j && j.items);
      rows.push(...list.map(parseIncentive).filter(Boolean));
      const total = Number(j && j.pageContext && j.pageContext.totalCount);
      if (list.length < 200 || (total && rows.length >= total)) break;
    }
    return rows;
  }

  // what each SKU sold for over the last `days` days, from the Orders API
  // (seller-fulfilled and WFS): { SKU: { gmv, units } }. Walmart's
  // incentives answer has no GMV (owner 2026-10-23: "include the GMV")
  async salesBySku(days = 90) {
    const out = {};
    const since = new Date(Date.now() - days * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    for (const node of ['SellerFulfilled', 'WFSFulfilled']) {
      let next = `?limit=200&createdStartDate=${encodeURIComponent(since)}&shipNodeType=${node}`;
      for (let i = 0; i < 500 && next; i++) {
        let j;
        try { j = await this.call('GET', `/v3/orders${next}`); } catch (e) { if (i === 0 && node !== 'SellerFulfilled') break; throw e; }
        const list = (j && j.list) || {};
        addOrderSales(out, arr(list.elements && list.elements.order));
        const cur = list.meta && list.meta.nextCursor;
        next = cur && String(cur).startsWith('?') && cur !== next ? String(cur) : '';
      }
    }
    return out;
  }

  // reduced referral fee: [{ sku, incentiveId }] enroll (true) or leave
  async incentiveEnroll(items, enroll) {
    const j = await this.call('POST', '/v3/feeds?feedType=INCENTIVE_ENROLLMENT', buildIncentiveFeed(items, enroll));
    if (!j || !j.feedId) throw new WalmartError('Walmart took the enrollment but returned no feed id.');
    return j.feedId;
  }

  // Walmart-funded discounts: [sku] opted in (true) or out
  async walmartFundedOpt(skus, optIn) {
    const j = await this.call('POST', '/v3/feeds?feedType=WALMART_FUNDED_INCENTIVES_ENROLLMENT', buildWalmartFundedFeed(skus, optIn));
    if (!j || !j.feedId) throw new WalmartError('Walmart took the change but returned no feed id.');
    return j.feedId;
  }

  // the whole catalog in or out of Walmart-funded discounts; Walmart locks
  // the setting for 4 hours after a change (isDisabled)
  async walmartFundedAll(on) {
    const j = await this.call('PUT', `/v3/price/incentives/wfpreference?autoEnrollEnabled=${on ? 'true' : 'false'}`);
    return { on: !!(j && j.autoEnrollEnabled), locked: !!(j && j.isDisabled) };
  }

  // one of the seller's own items by SKU: is it live on walmart.com?
  async itemStatus(sku) {
    return parseItemStatus(await this.call('GET', `/v3/items/${encodeURIComponent(String(sku))}`));
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
      // star average ("4.7") and review count ("198") arrive as strings;
      // 0 / 0 = no reviews yet
      rating: Math.min(5, Math.max(0, Number(it.customerRating) || 0)),
      reviews: Math.max(0, Math.floor(Number(it.properties && it.properties.numReviews) || 0)),
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

// Get an item (by SKU) -> { published, lifecycle, reasons[] }. The item can
// come bare, in an ItemResponse list, or wrapped once more; the unpublished
// reasons as a list or as { reason: [...] }.
function parseItemStatus(j) {
  const it = arr((j && (j.ItemResponse || j.itemResponse || j.items)) || j)[0] || {};
  const raw = it.unpublishedReasons;
  const reasons = arr(raw && !Array.isArray(raw) && typeof raw === 'object' ? raw.reason : raw)
    .map(r => clip(typeof r === 'string' ? r : r && (r.reason || r.description || r.message), 300)).filter(Boolean);
  return {
    published: String(it.publishedStatus || '').toUpperCase(),
    lifecycle: String(it.lifecycleStatus || '').toUpperCase(),
    reasons,
  };
}

/* ---------- Pricing + incentives: pure builders + parsers (tested in e2e) ---------- */

const money2 = (v) => { const n = Number(v); return Number.isFinite(n) && v !== null && v !== '' ? Math.round(n * 100) / 100 : null; };
// the repricer's "take it out" value (Walmart's reserved strategy name)
const NO_STRATEGY = 'No Strategy/Delete from Repricer';

// the rows of a Pricing Insights answer: pricingInsightsResponseList, or the
// first list of SKU objects found one or two levels down
function insightRows(j) {
  if (!j || typeof j !== 'object') return [];
  if (Array.isArray(j.pricingInsightsResponseList)) return j.pricingInsightsResponseList;
  const lists = [];
  for (const v of Object.values(j)) {
    if (Array.isArray(v)) lists.push(v);
    else if (v && typeof v === 'object') for (const w of Object.values(v)) if (Array.isArray(w)) lists.push(w);
  }
  return lists.find(l => l.length && l[0] && typeof l[0] === 'object' && 'sku' in l[0]) || [];
}

// one Pricing Insights row -> what the Pricing tab shows. buyBoxWinRate
// arrives as a string ("0.0", "87.5"): a percentage.
// the first value that is set: a field Walmart may spell several ways
const first = (...v) => v.find(x => x !== undefined && x !== null && x !== '');

function parseInsight(r) {
  if (!r || !r.sku) return null;
  const rate = Number(r.buyBoxWinRate);
  return {
    sku: String(r.sku),
    title: clip(r.itemName, 300),
    price: money2(r.currentPrice),
    bbPrice: money2(r.buyBoxBasePrice),
    bbTotal: money2(r.buyBoxTotalPrice),
    winRate: Number.isFinite(rate) && r.buyBoxWinRate !== null && r.buyBoxWinRate !== '' ? Math.max(0, Math.min(100, rate)) : null,
    competitor: money2(r.competitorPrice),
    // the documented name first; live answers (owner 2026-10-23: every item
    // read as "No strategy" while Seller Center shows 131 on IMRAN BUY BOX)
    // may name it otherwise, so look for the likely alternatives too
    strategy: clip(first(r.repricerStrategyName, r.repricerStrategy, r.strategyName, r.repricerStrategyCollectionName,
      r.repricer && (r.repricer.strategyName || r.repricer.repricerStrategy || r.repricer.name)), 120),
    strategyType: clip(r.repricerStrategyType, 60),
    repricerStatus: clip(r.repricerStatus, 60),
    min: money2(first(r.repricerMinPrice, r.minimumSellerAllowedPrice, r.repricerMinimumPrice, r.minPrice, r.repricer && r.repricer.minPrice)),
    max: money2(first(r.repricerMaxPrice, r.maximumSellerAllowedPrice, r.repricerMaximumPrice, r.maxPrice, r.repricer && r.repricer.maxPrice)),
    suggested: money2(r.suggestedPrice),
    fulfillment: clip(r.fulfillment, 40),
    stock: r.inventoryCount === null || r.inventoryCount === undefined ? null : Number(r.inventoryCount) || 0,
  };
}

// a strategy collection -> { id, name, enabled, count, type, unit, value }
function parseStrategy(s) {
  if (!s || !s.repricerStrategy) return null;
  const rule = arr(s.strategies)[0] || {};
  return {
    id: String(s.strategyCollectionId || ''),
    name: clip(s.repricerStrategy, 120),
    enabled: s.enabled !== false,
    count: Number(first(s.assignedCount, s.assignedItemCount, s.itemCount, s.itemsCount, s.totalItems)) || 0,
    type: String(rule.strategyType || 'Buy Box Price'),
    unit: String(rule.adjustmentType || 'UNIT').toUpperCase() === 'PERCENTAGE' ? '%' : '$',
    value: Number(rule.adjustmentValue) || 0,
  };
}

function buildStrategy(s) {
  return {
    repricerStrategy: clip(s.name, 120),
    enabled: s.enabled !== false,
    enableRepricerForPromotion: false,
    restoreSellerPriceWithoutTarget: false,
    enableBuyboxMeetExternal: false,
    compareWith3pOfferOnly: false,
    strategies: [{
      strategyType: s.type === 'Competitive Price' ? 'Competitive Price' : 'Buy Box Price',
      adjustmentType: s.unit === '%' ? 'PERCENTAGE' : 'UNIT',
      adjustmentValue: Math.max(0, Math.round((Number(s.value) || 0) * 100) / 100),
    }],
  };
}

// items reference strategies by NAME; '' takes the item off the repricer
function buildRepricerFeed(items) {
  return {
    ItemFeedHeader: { processMode: 'REPLACE', subset: 'EXTERNAL', mart: 'WALMART_US', sellingChannel: 'repricerstrategy', version: '1.1', locale: 'en' },
    Item: arr(items).map(i => ({
      Strategy: {
        sku: String(i.sku),
        repricerStrategy: i.strategy ? String(i.strategy) : NO_STRATEGY,
        ...(i.strategy && money2(i.min) !== null ? { minimumSellerAllowedPrice: Math.max(0.01, money2(i.min)) } : {}),
        ...(i.strategy && money2(i.max) !== null ? { maximumSellerAllowedPrice: Math.max(0.01, money2(i.max)) } : {}),
      },
    })),
  };
}

// orders -> per-SKU item sales (the PRODUCT charge of each line that was
// not cancelled), added into `out` as { SKU: { gmv, units } }
function addOrderSales(out, orders) {
  for (const o of arr(orders)) {
    for (const l of arr(o && o.orderLines && o.orderLines.orderLine)) {
      const sku = String((l.item && l.item.sku) || '').toUpperCase();
      if (!sku) continue;
      const sts = arr(l.orderLineStatuses && l.orderLineStatuses.orderLineStatus);
      if (sts.length && sts.every(x => /cancel/i.test(String(x.status || '')))) continue;
      let amt = 0;
      for (const ch of arr(l.charges && l.charges.charge)) {
        if (/^product$/i.test(String(ch.chargeType || ''))) amt += Number(ch.chargeAmount && ch.chargeAmount.amount) || 0;
      }
      const row = out[sku] || (out[sku] = { gmv: 0, units: 0 });
      row.gmv = Math.round((row.gmv + amt) * 100) / 100;
      row.units += Number(l.orderLineQuantity && l.orderLineQuantity.amount) || 1;
    }
  }
  return out;
}

// epoch-ms strings -> YYYY-MM-DD ('' when unset)
function parseIncentive(r) {
  if (!r || !(r.skuId || r.sku)) return null;
  return {
    sku: String(r.skuId || r.sku),
    itemId: String(r.itemId || ''),
    title: clip(r.productName, 300),
    url: /^https:\/\//i.test(String(r.productUrl || '')) ? String(r.productUrl) : '',
    image: /^https:\/\//i.test(String(r.productImageUrl || '')) ? String(r.productImageUrl) : '',
    price: money2(r.currentPrice),
    target: money2(r.targetPrice),
    ship: money2(r.shippingPrice),
    type: String(r.incentiveType || '').toUpperCase(),
    status: String(r.incentiveStatus || '').toUpperCase(),
    baseFee: money2(r.baseReferralFee),
    reducedFee: money2(r.reducedReferralFee),
    auto: String(r.enrollmentType || '').toUpperCase() === 'AUTO',
    stock: r.inventoryCount === null || r.inventoryCount === undefined ? null : Number(r.inventoryCount) || 0,
    starts: dayOf(r.startDate),
    expires: dayOf(r.expirationDate),
    enrolledOn: dayOf(r.enrollmentDate),
    incentiveId: String(r.incentiveId || ''),
  };
}

const programHeader = (feedType, version) => ({
  requestId: crypto.randomUUID(), requestBatchId: crypto.randomUUID(), processMode: 'REPLACE', subset: 'EXTERNAL',
  sellingChannel: 'online', version, locale: 'en', feedDate: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), feedType,
});

function buildIncentiveFeed(items, enroll) {
  return {
    ProgramActionFeedHeader: programHeader('INCENTIVE_ENROLLMENT', '5.0.20250322-01_07_46'),
    ProgramAction: arr(items).map(i => ({
      ItemIdentifiers: { sku: String(i.sku) },
      Programs: { IncentivesEnrollment: {
        referralFeeIncentiveEnrollment: enroll ? 'Y' : 'N',
        incentiveType: 'Reduced Referral Fee',
        ...(i.incentiveId ? { incentiveId: String(i.incentiveId) } : {}),
      } },
    })),
  };
}

function buildWalmartFundedFeed(skus, optIn) {
  return {
    ProgramActionFeedHeader: programHeader('PROGRAM_ACTIONS', '5.0.20240805-15_25_31'),
    ProgramAction: arr(skus).map(sku => ({
      ItemIdentifiers: { sku: String(sku) },
      Programs: { WalmartFundedIncentivesEnrollment: { walmartFundedIncentivesEnrollment: optIn ? 'Opt-in' : 'Opt-out' } },
    })),
  };
}

// What a walmart.com product page says about the item, read off the page
// the Walmart tab's browser shows (owner 2026-10-23: sellers, who has the
// Buy Box, rating). json = the page's ld+json and __NEXT_DATA__ texts,
// body = its visible text. Every value is optional: Walmart reshuffles its
// pages, and a missing value is shown as unknown, never guessed.
function parseProductPage({ json = [], body = '', title = '', image = '' } = {}) {
  const all = arr(json).join('\n');
  const num = (re, src = all) => { const m = re.exec(src); return m ? Number(m[1]) : null; };
  const str = (re, src = all) => { const m = re.exec(src); return m ? clip(m[1].replace(/\\u0026/g, '&').replace(/\\"/g, '"'), 120) : ''; };
  const text = String(body || '');
  // "Compare all 14 sellers" counts everyone; "More seller options (13)"
  // and additionalOfferCount count the others beside the Buy Box offer
  let sellers = num(/compare all\s+(\d+)\s+sellers/i, text);
  if (sellers === null) { const more = num(/more seller options\s*\((\d+)\)/i, text); if (more !== null) sellers = more + 1; }
  if (sellers === null) { const more = num(/"additionalOfferCount"\s*:\s*(\d+)/); if (more !== null) sellers = more + 1; }
  const rating = num(/"averageRating"\s*:\s*"?(\d(?:\.\d+)?)/) ?? num(/"ratingValue"\s*:\s*"?(\d(?:\.\d+)?)/);
  const reviews = num(/"numberOfReviews"\s*:\s*"?(\d+)/) ?? num(/"reviewCount"\s*:\s*"?(\d+)/);
  const price = num(/"currentPrice"\s*:\s*\{[^{}]*?"price"\s*:\s*(\d+(?:\.\d+)?)/) ?? num(/"price"\s*:\s*"?(\d+(?:\.\d{1,2})?)"?\s*,\s*"priceCurrency"/);
  let seller = str(/"sellerDisplayName"\s*:\s*"((?:[^"\\]|\\.){1,80})"/) || str(/"sellerName"\s*:\s*"((?:[^"\\]|\\.){1,80})"/);
  if (!seller) { const m = /sold (?:and shipped )?by\s+([^\n]{2,60})/i.exec(text); if (m) seller = clip(m[1], 60); }
  return {
    title: clip(title, 300) || str(/"name"\s*:\s*"((?:[^"\\]|\\.){1,300})"/),
    image: /^https:\/\//i.test(image) ? String(image) : '',
    brand: str(/"brand"\s*:\s*(?:\{[^{}]*?"name"\s*:\s*)?"((?:[^"\\]|\\.){1,60})"/),
    price: price && price > 0 ? Math.round(price * 100) / 100 : 0,
    rating: rating !== null ? Math.min(5, Math.max(0, rating)) : null,
    reviews: reviews !== null ? Math.max(0, Math.floor(reviews)) : null,
    sellers: sellers !== null && sellers > 0 ? sellers : null,
    buyBoxSeller: seller,
  };
}

// every seller's offer a walmart.com product page (or its "Compare all
// sellers" page) carries: [{ seller, price, condition, ship, arrives }].
// Offers are found by shape (a seller name beside a price) and anything
// about another item number (carousels, accessories) is skipped
function parseOffers(json = [], itemId = '') {
  const out = [];
  const seen = new Set();
  const money = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
  const priceOf = (o) => {
    const pi = o.priceInfo || {};
    for (const v of [pi.currentPrice && pi.currentPrice.price, pi.currentPrice && pi.currentPrice.priceString, o.price && typeof o.price === 'object' ? o.price.price : o.price, o.offerPrice]) {
      const n = money(v);
      if (n) return n;
    }
    return null;
  };
  // a value somewhere inside an offer, by key name, a few levels down
  const find = (o, keyRe, ok, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 4) return undefined;
    for (const [k, v] of Object.entries(o)) {
      if (keyRe.test(k) && ok(v)) return v;
    }
    for (const [k, v] of Object.entries(o)) {
      if (/^(variantsMap|variantCriteria|similar|related|recommend)/i.test(k)) continue; // other versions / items
      if (Array.isArray(v) && v.some(x => x && typeof x === 'object' && (x.sellerName || x.sellerDisplayName || x.seller))) continue; // other sellers' offers
      const r = find(v, keyRe, ok, depth + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  };
  // a condition's name; Walmart's bare codes (owner 2026-10-23: a "1" tag)
  // read as New for 1 and are otherwise left out
  const conditionOf = (o) => {
    const c = (o.conditionV2 && (o.conditionV2.name || o.conditionV2.code)) || (o.condition && typeof o.condition === 'object' ? (o.condition.name || o.condition.code) : o.condition) || o.offerCondition || o.itemCondition || '';
    const m = /schema\.org\/(\w+?)Condition/i.exec(String(c));
    const t = m ? m[1] : String(c).trim();
    if (/^\d+$/.test(t)) return t === '1' ? 'New' : '';
    return clip(/^new$/i.test(t) ? 'New' : /^used$/i.test(t) ? 'Pre-Owned' : /^refurbished$/i.test(t) ? 'Restored' : t.replace(/_/g, ' '), 40);
  };
  const shipOf = (o) => {
    const v = find(o, /^(ship|shipping)(Price|Fee|Charge|Cost|Amount)$/i, x => x !== null && x !== undefined);
    if (v === undefined) return null;
    const n = Number(String(v && typeof v === 'object' ? (v.price ?? v.amount ?? '') : v).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };
  // "Tue, Oct 28": a date Walmart sends as a timestamp or ISO text is
  // shown as a day, and only when it is a real one in the next two months
  // (owner 2026-10-23: "arrives +058781-05-04T01:35:57.000-04:00");
  // wording ("Tomorrow", "Oct 28") is kept as it is
  const arrivesOf = (o) => {
    const v = find(o, /^(deliveryDate|arrivalDate|deliveryText|fulfillmentText|displayArrivalDate|arrivalText|displayDeliveryDate)$/i, x => (typeof x === 'string' && x.trim()) || (typeof x === 'number' && x > 0));
    if (v === undefined) return '';
    const t = String(v).trim().replace(/^arrives\s*/i, '');
    const dateLike = typeof v === 'number' || /^\d{10,}$/.test(t) || /^[+-]?\d{4,6}-\d{2}-\d{2}/.test(t);
    if (!dateLike) return clip(t, 40);
    const d = new Date(/^\d+$/.test(t) ? Number(t) * (t.length <= 10 ? 1000 : 1) : t);
    const ms = d.getTime() - Date.now();
    if (Number.isNaN(ms) || ms < -86400000 || ms > 62 * 86400000) return '';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 16) return;
    if (Array.isArray(o)) { for (const v of o) walk(v, depth + 1); return; }
    const other = o.usItemId && itemId && String(o.usItemId) !== String(itemId);
    if (other) return;
    const sellerObj = o.seller && typeof o.seller === 'object' ? o.seller : null;
    const seller = o.sellerDisplayName || o.sellerName || (sellerObj && (sellerObj.name || sellerObj.displayName)) || '';
    const price = typeof seller === 'string' && seller.trim() ? priceOf(o) : null;
    if (price) {
      const row = { seller: clip(seller, 80), price, condition: conditionOf(o), ship: shipOf(o), arrives: arrivesOf(o) };
      const key = `${row.seller.toLowerCase()}|${row.price}|${row.condition.toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); out.push(row); }
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  for (const t of arr(json)) {
    let data = null;
    try { data = JSON.parse(t); } catch { continue; }
    walk(data, 0);
  }
  // one row per seller and condition: the ld+json copy of the Buy Box
  // offer has no condition, so it folds into the full one
  return out.filter(r => r.condition || !out.some(x => x !== r && x.condition && x.seller.toLowerCase() === r.seller.toLowerCase() && x.price === r.price));
}

// a product's other versions (colour, storage...) from its page JSON, the
// way Walmart lays them out (owner 2026-10-23: "the variants are not
// organized properly"): axes [{ name: 'Capacity', values: ['256GB', ...] }]
// in Walmart's order, and each version's item number, one value per axis,
// price, stock. variantCriteria names the choices, variantsMap gives each
// version's item number, price and stock
function parseVariantSet(json = [], itemId = '') {
  let crit = null;
  let map = null;
  const look = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 14 || (crit && map)) return;
    if (Array.isArray(o)) { for (const v of o) look(v, depth + 1); return; }
    if (!crit && Array.isArray(o.variantCriteria) && o.variantCriteria.length) crit = o.variantCriteria;
    if (!map && o.variantsMap && typeof o.variantsMap === 'object' && !Array.isArray(o.variantsMap)) map = o.variantsMap;
    for (const v of Object.values(o)) if (v && typeof v === 'object') look(v, depth + 1);
  };
  for (const t of arr(json)) {
    try { look(JSON.parse(t), 0); } catch { /* not JSON */ }
    if (crit && map) break;
  }
  if (!crit) return { axes: [], list: [] };
  const axisName = (c) => clip(c.name || String(c.id || '').replace(/^actual_/, '').replace(/_/g, ' ').replace(/^\w/, m => m.toUpperCase()), 30);
  // value id -> [axis index, value name]; item -> value per axis (fallback)
  const axes = [];
  const byId = new Map();
  const byItem = new Map();
  for (const c of crit) {
    const values = [];
    const ai = axes.length;
    for (const v of arr(c && c.variantList)) {
      const name = clip(v && (v.name || v.value), 40);
      if (!name) continue;
      if (!values.includes(name)) values.push(name);
      if (v.id) byId.set(String(v.id), [ai, name]);
      for (const p of arr(v.products)) {
        const id = String(p && typeof p === 'object' ? p.usItemId || p.id || '' : p || '');
        if (!/^\d{5,}$/.test(id)) continue;
        const dims = byItem.get(id) || byItem.set(id, []).get(id);
        dims[ai] = name;
      }
    }
    if (values.length) axes.push({ name: axisName(c), values });
  }
  const list = [];
  const seen = new Set();
  const add = (id, dims, v) => {
    if (!/^\d{5,}$/.test(id) || seen.has(id)) return;
    seen.add(id);
    const pi = (v && v.priceInfo) || {};
    const price = Number((pi.currentPrice && pi.currentPrice.price) ?? '');
    const status = String((v && v.availabilityStatus) || '');
    list.push({ itemId: id, dims: axes.map((_, i) => dims[i] || ''), price: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null,
      inStock: !/OUT_OF_STOCK|NOT_AVAILABLE/i.test(status), current: id === String(itemId) });
  };
  for (const [key, v] of Object.entries(map || {})) {
    const id = String((v && v.usItemId) || key);
    const dims = [];
    for (const x of arr(v && v.variants)) { const hit = byId.get(String(x)); if (hit) dims[hit[0]] = hit[1]; }
    add(id, dims.length ? dims : (byItem.get(id) || []), v);
  }
  if (!list.length) for (const [id, dims] of byItem) add(id, dims, null);
  return { axes, list: list.filter(v => v.dims.some(Boolean)) };
}
// the versions alone, each with its labels (one per axis)
function parseVariants(json = [], itemId = '') {
  return parseVariantSet(json, itemId).list.map(v => ({ ...v, labels: v.dims.filter(Boolean) }));
}

// the Item report's rows -> { SKU: { strategy, min, max, status } } for
// every SKU with a repricer strategy; headers matched loosely
function parseRepricerReport(rows) {
  const out = {};
  const hi = arr(rows).findIndex(r => r.some(c => /^sku$/i.test(String(c).trim())) && r.some(c => /repricer\s*strategy/i.test(String(c))));
  if (hi < 0) return null;
  const h = rows[hi].map(c => String(c).trim().toLowerCase());
  const col = (re) => h.findIndex(c => re.test(c));
  const iSku = col(/^sku$/), iStrat = col(/repricer\s*strategy/), iMin = col(/minimum.*price|min.*allowed/), iMax = col(/maximum.*price|max.*allowed/), iSt = col(/repricer\s*status/);
  const money = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return String(v ?? '').trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
  for (const r of rows.slice(hi + 1)) {
    const sku = String(r[iSku] || '').trim();
    const strategy = String(r[iStrat] || '').trim();
    if (!sku || !strategy || /^(n\/?a|none|-|no strategy)$/i.test(strategy)) continue;
    out[sku.toUpperCase()] = { strategy: clip(strategy, 120), min: iMin >= 0 ? money(r[iMin]) : null, max: iMax >= 0 ? money(r[iMax]) : null, status: iSt >= 0 ? clip(r[iSt], 40) : '' };
  }
  return out;
}

// WFS inbound shipments (owner 2026-10-27, the Overview's "Sent to WFS"
// tab): Get Inbound Shipments lists every shipping plan's shipment with its
// status and unit counts; Get Inbound Shipment Items names the channel SKUs
// on one shipment. Walmart's reference and its older overview pages disagree
// on the path prefix (/v3/fulfillment/... vs /v3/...), so the client tries
// the documented one first and falls back once on a 404.
// Walmart's status enums, worded the way Seller Center's Shipping Plans
// page shows them (checked against a live account 2026-10-27:
// AWAITING_DELIVERY draws as "Awaiting transit" there)
const WFS_STATUS = {
  AWAITING_DELIVERY: 'Awaiting transit',
  PENDING_SHIPMENT_DETAILS: 'Needs shipment details',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  RECEIVING_IN_PROGRESS: 'Receiving in progress',
  RECEIVING: 'Receiving',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
  CANCELED: 'Cancelled',
};
function wfsStatusLabel(raw) {
  const s = clip(raw, 60);
  if (!s) return '';
  if (WFS_STATUS[s]) return WFS_STATUS[s];
  const t = s.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// live shape (2026-10-27): { headers: {offset,limit,totalCount},
// payload: [ { inboundOrderId, shipmentId, shipToAddress:{fcName,city,
// stateCode,...}, status:"AWAITING_DELIVERY", createdDate,
// shipmentUnits, receivedUnits, expectedDeliveryDate,
// updatedExpectedDeliveryDate, trackingNo:[...], carrierName } ] }
function parseInboundShipments(body) {
  const data = (body && (body.payload || body.data || body)) || {};
  const list = Array.isArray(data) ? data : arr(data.shipments || data.inboundShipments || data.data || data.elements);
  return list.map(s => {
    const addr = s.shipToAddress || s.destinationAddress || {};
    const place = [addr.fcName || addr.name, [addr.city, addr.stateCode || addr.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    return {
      id: clip(s.shipmentId || s.id, 40),
      orderId: clip(s.inboundOrderId || s.orderId || s.planId, 40),
      status: wfsStatusLabel(s.status || s.shipmentStatus),
      created: dayOf(s.createdDate || s.createdDtm || s.creationDate),
      // Walmart revises the ETA after the label is bought; the revised date
      // is the one Seller Center shows
      eta: dayOf(s.updatedExpectedDeliveryDate || s.expectedDeliveryDate || s.expectedDeliveryDtm || s.estimatedDeliveryDate),
      shipTo: clip(s.fulfillmentCenterName || place || s.fcName, 90),
      carrier: clip(s.carrierName || s.carrier, 40),
      tracking: clip(arr(s.trackingNo)[0] || s.trackingNumber, 60),
      unitsExpected: Number(s.shipmentUnits ?? s.expectedQty ?? s.shippedQty ?? s.shippedUnits ?? s.totalQuantity) || 0,
      unitsReceived: Number(s.receivedUnits ?? s.receivedQty) || 0,
    };
  }).filter(s => s.id || s.orderId);
}

// live shape (2026-10-27): payload: [ { inboundOrderId, shipmentId, gtin,
// sku, itemDesc, itemQty, receivedQty, damagedQty, ... } ]
function parseInboundItems(body) {
  const data = (body && (body.payload || body.data || body)) || {};
  const list = Array.isArray(data) ? data : arr(data.shipmentItems || data.items || data.data || data.elements);
  return list.map(it => ({
    sku: clip(it.sku || it.vendorSku || it.itemSku, 80),
    desc: clip(it.itemDesc || it.productName || it.description || it.itemDescription, 120),
    gtin: clip(it.gtin || it.upc, 20),
    expected: Number(it.itemQty ?? it.expectedQty ?? it.shippedQty ?? it.quantity) || 0,
    received: Number(it.receivedQty ?? it.receivedUnits) || 0,
  })).filter(it => it.sku);
}

WalmartClient.prototype.inboundShipments = async function ({ limit = 50, offset = 0 } = {}) {
  const body = await this.call('GET', `/v3/fulfillment/inbound-shipments?limit=${limit}&offset=${offset}`);
  return parseInboundShipments(body);
};

WalmartClient.prototype.inboundShipmentItems = async function (shipmentId) {
  const q = `shipmentId=${encodeURIComponent(shipmentId)}&limit=300&offset=0`;
  let body;
  try {
    body = await this.call('GET', `/v3/fulfillment/inbound-shipment-items?${q}`);
  } catch (e) {
    if (!/404|not found/i.test(String(e.message))) throw e;
    body = await this.call('GET', `/v3/shipment-items?${q}`);
  }
  return parseInboundItems(body);
};

/* ---------- Send to WFS from a Stock row (owner 2026-11-07) ----------
   Create Inbound Shipment, its errors, cancel, the receiving (box) labels,
   and Convert items for WFS. Shapes per developer.walmart.com (US): the
   createshipment / getinboundordererrors / cancelshipment /
   createinboundshipmentlabelv2 references, and the OMNI_WFS "Convert
   existing item to WFS" spec 5.0.20260829-12_49_39-api (Consolidated
   schema, Oct 2026). */

// an inbound order's arrival day as the date-time Walmart takes
const wfsDay = (day) => `${String(day || '').slice(0, 10)}T00:00:00.000Z`;

function inboundAddress(a, countryCode = 'US') {
  const out = {
    addressLine1: clip(a.line1, 60),
    city: clip(a.city, 40),
    stateCode: clip(a.state, 2).toUpperCase(),
    countryCode,
    postalCode: String(a.zip || '').trim(),
  };
  if (a.line2) out.addressLine2 = clip(a.line2, 60);
  return out;
}

// Walmart's item prep services (Seller Center's "Add prep")
const WFS_PREP = ['LABEL', 'BAG', 'TAPE', 'WRAP'];
const boxOk = (b) => b && ['l', 'w', 'h', 'lb'].every(k => Number(b[k]) > 0);
const r2 = (v) => Math.round(Number(v) * 100) / 100;

// { orderId, returnTo, arriveBy (YYYY-MM-DD), its, lines: [{ sku, gtin,
// desc, qty, perBox, prep, box: { l, w, h, lb } }] } -> the Create Inbound
// Shipment body. itemQty is the units, vendorPackQty the boxes and
// innerPackQty the units in each box, so a line must fill whole boxes
// (checked by the caller). its picks Inventory Transfer Service ("Y") or
// distributing it yourself ("N", Walmart's default); prep adds an item prep
// service; a box size and weight go in the shipping summary, sides sorted
// longest first the way Walmart asks for them.
function buildInboundOrder({ orderId, returnTo, arriveBy, its, lines }, countryCode = 'US') {
  const items = arr(lines).map(l => {
    const o = {
      productId: toGtin14(l.gtin),
      productType: 'GTIN',
      sku: String(l.sku).slice(0, 50),
      itemDesc: clip(l.desc || l.sku, 150),
      itemQty: Number(l.qty),
      vendorPackQty: Math.round(Number(l.qty) / Number(l.perBox)),
      innerPackQty: Number(l.perBox),
      expectedDeliveryDate: wfsDay(arriveBy),
    };
    if (WFS_PREP.includes(l.prep)) o.addOnServices = [{ serviceType: l.prep }];
    return o;
  });
  const body = {
    inboundOrderId: clip(orderId, 100),
    inboundServices: { inventoryTransferService: its ? 'Y' : 'N' },
    returnAddress: inboundAddress(returnTo || {}, countryCode),
    orderItems: items,
  };
  const boxes = arr(lines).filter(l => boxOk(l.box)).map((l, i) => {
    const [longest, median, shortest] = [l.box.l, l.box.w, l.box.h].map(Number).sort((a, b) => b - a);
    return {
      totalNoOfUnits: Number(l.qty),
      noOfBoxes: Math.round(Number(l.qty) / Number(l.perBox)),
      weight: r2(l.box.lb),
      longestSide: r2(longest),
      medianSide: r2(median),
      shortestSide: r2(shortest),
      weightUnit: 'LB',
      lengthUnit: 'IN',
      items: [{ productId: items[i].productId, productType: 'GTIN', sku: items[i].sku, gtin: items[i].productId, unitsPerBox: Number(l.perBox) }],
    };
  });
  if (boxes.length) body.shippingSummary = { boxes };
  return body;
}

// what to fix before anything is sent: [] when the order can go
function inboundProblems({ returnTo, arriveBy, lines }) {
  const p = [];
  const a = returnTo || {};
  if (!a.line1 || !a.city || !a.state || !a.zip) p.push('Set the return address (Settings › Shipping, Ship from).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(arriveBy || ''))) p.push('Pick the date it should arrive at Walmart.');
  if (!arr(lines).length) p.push('Nothing to send.');
  for (const l of arr(lines)) {
    const qty = Number(l.qty), per = Number(l.perBox);
    if (!toGtin14(l.gtin)) p.push(`${l.sku}: no UPC / GTIN to send it under.`);
    if (!Number.isInteger(qty) || qty < 1) p.push(`${l.sku}: enter the units to send.`);
    else if (!Number.isInteger(per) || per < 1) p.push(`${l.sku}: enter the units in each box.`);
    else if (qty % per) p.push(`${l.sku}: ${qty} units don't fill whole boxes of ${per}. Use ${Math.floor(qty / per) * per || per} or ${Math.ceil(qty / per) * per}.`);
    if (l.box && !boxOk(l.box)) p.push(`${l.sku}: enter the box size and weight.`);
    else if (l.box && Number(l.box.lb) > 150) p.push(`${l.sku}: a box can weigh 150 lb at most.`);
  }
  return p;
}

// Walmart's answer -> the shipments it split the order into, each with its
// warehouse; a FAIL answer (sometimes with HTTP 200) throws its errors
function parseInboundCreate(body) {
  const failed = body && (String(body.status || '').toUpperCase() === 'FAIL' || (arr(body.errors).length && !body.payload));
  if (failed) throw new WalmartError(errorText(body, 400));
  const list = arr(body && (body.payload || body.data || body.shipments));
  return list.map(s => {
    const a = s.shipToAddress || {};
    return {
      id: clip(s.shipmentId || s.id, 40),
      shipTo: clip([a.fcName, [a.city, a.stateCode].filter(Boolean).join(', ')].filter(Boolean).join(' · '), 90),
      address: [a.addressLine1, a.addressLine2, [a.city, a.stateCode, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).map(x => clip(x, 80)).join(', '),
      to: { name: clip(a.fcName, 60), line1: clip(a.addressLine1, 60), line2: clip(a.addressLine2, 60), city: clip(a.city, 40), state: clip(a.stateCode, 2), zip: String(a.postalCode || '').trim() },
      eta: dayOf(s.expectedDeliveryDate),
      items: arr(s.shipmentItems).map(i => ({ sku: clip(i.vendorSku || i.sku, 80), qty: Number(i.itemQty) || 0 })).filter(i => i.sku),
    };
  }).filter(s => s.id);
}

// GET inbound-shipment-errors for one order -> the error lines Walmart kept
function parseInboundErrors(body) {
  const out = [];
  for (const o of arr(body && (body.payload || body.data))) {
    for (const e of arr(o && o.errors)) {
      const t = [e.field ? `${e.field}: ` : '', e.description || e.code || ''].join('').trim();
      if (t) out.push(clip(t, 300));
    }
  }
  return out;
}

// the OMNI_WFS spec this app builds against (the header must name it)
const OMNI_WFS_VERSION = '5.0.20260829-12_49_39-api';
// product types offered when converting; any spec product type works
const WFS_PRODUCT_TYPES = ['Tablet Computers', 'Cell Phones', 'Laptop Computers', 'Smart Watches', 'Headphones', 'Cell Phone Cases', 'Tablet Holders, Carriers & Cases'];
const WFS_CONDITIONS = ['New', 'New with defects', 'New without box', 'Open Box', 'Pre-Owned: Fair', 'Pre-Owned: Good', 'Pre-Owned: Like New', 'Restored: Fair', 'Restored: Good', 'Restored: Like New', 'Restored: Premium'];
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

// what the convert form is missing: [] when it can go
function convertProblems(c) {
  const p = [];
  if (!c || !c.sku) return ['No listing picked.'];
  if (!toGtin14(c.gtin)) p.push('The listing\'s UPC / GTIN.');
  if (!(num(c.price) > 0)) p.push('The listing\'s price.');
  if (!c.productName) p.push('Product name.');
  if (!c.brand) p.push('Brand.');
  if (!/^https?:\/\//i.test(String(c.imageUrl || ''))) p.push('Main image link.');
  if (!WFS_CONDITIONS.includes(c.condition)) p.push('Condition.');
  if (!c.productType) p.push('Product type.');
  for (const [k, label] of [['length', 'Length'], ['width', 'Width'], ['height', 'Height'], ['weight', 'Weight']]) {
    if (!(num(c[k]) > 0)) p.push(`${label} of one boxed unit.`);
  }
  if (!c.origin) p.push('Country of origin.');
  if (c.battery === 'lithium-ion') {
    if (!(num(c.wh) > 0)) p.push('Battery watt-hours.');
    if (!(num(c.batteryGrams) > 0)) p.push('Battery weight (grams).');
    if (!(num(c.cells) >= 1)) p.push('Battery cell count.');
    if (!c.batteryModel) p.push('Battery model.');
    if (!/^https?:\/\//i.test(String(c.sdsUrl || ''))) p.push('Link to the battery\'s safety data sheet (SDS).');
  }
  return p;
}

// convert form -> the OMNI_WFS feed body for one existing listing. Required
// by the spec: Visible (per product type: productName, brand,
// isProp65WarningRequired, mainImageUrl, netContent, condition), Orderable
// (sku, ids, price, stateRestrictions, electronicsIndicator,
// batteryTechnologyType, isChemical/isAerosol/isPesticide; a lithium-ion
// battery adds hasBatteries, batterySize, safetyDataSheet,
// numberOfHazardousComponents and lithiumIonBatteries) and TradeItem (sku,
// countryOfOriginAssembly, each: inches and pounds).
function buildConvertFeed(c) {
  const lithium = c.battery === 'lithium-ion';
  const round = (v, d = 2) => Math.round(num(v) * 10 ** d) / 10 ** d;
  const orderable = {
    sku: String(c.sku).slice(0, 50),
    productIdentifiers: { productIdType: 'GTIN', productId: toGtin14(c.gtin) },
    price: round(c.price),
    stateRestrictions: [{ stateRestrictionsText: 'None' }],
    electronicsIndicator: c.electronics === false ? 'No' : 'Yes',
    batteryTechnologyType: lithium ? 'Lithium Ion' : 'Does Not Contain a Battery',
    isChemical: 'No',
    isAerosol: 'No',
    isPesticide: 'No',
  };
  if (lithium) {
    Object.assign(orderable, {
      hasBatteries: 'Yes',
      batterySize: 'Proprietary Device Specific',
      safetyDataSheet: [String(c.sdsUrl).trim().slice(0, 2500)],
      numberOfHazardousComponents: 1,
      lithiumIonBatteries: {
        ionNumberOfBatteries: 1,
        ionNumberOfBatteryCells: Math.max(1, Math.round(num(c.cells))),
        ionBatteryFormFactor: 'Battery',
        ionBatteryModel: clip(c.batteryModel, 400),
        batteryWattHour: round(c.wh),
        ionIncludedBatteryPackaging: 'Contained In',
        ionBatteryWeight: round(c.batteryGrams),
      },
    });
  }
  return {
    SupplierItemFeedHeader: { businessUnit: 'WALMART_US', locale: 'en', version: OMNI_WFS_VERSION },
    SupplierItem: [{
      Visible: {
        [c.productType]: {
          productName: clip(c.productName, 200),
          brand: clip(c.brand, 60),
          isProp65WarningRequired: 'No',
          mainImageUrl: String(c.imageUrl).trim(),
          netContent: { productNetContentMeasure: 1, productNetContentUnit: 'Each' },
          condition: c.condition,
        },
      },
      Orderable: orderable,
      TradeItem: {
        sku: String(c.sku).slice(0, 50),
        countryOfOriginAssembly: [c.origin],
        each: { eachDepth: round(c.length), eachWidth: round(c.width), eachHeight: round(c.height), eachWeight: round(c.weight, 3) },
      },
    }],
  };
}

// a seller's own item by SKU -> what the convert form can start from
function parseItemFacts(j) {
  const it = arr((j && (j.ItemResponse || j.itemResponse || j.items)) || j)[0] || {};
  const price = it.price && typeof it.price === 'object' ? it.price.amount : it.price;
  return {
    sku: String(it.sku || ''),
    productName: clip(it.productName, 200),
    brand: clip(it.brand, 60),
    gtin: String(it.gtin || it.upc || '').replace(/\D/g, ''),
    price: money2(price),
    productType: clip(it.productType, 80),
    condition: clip(it.condition, 40),
    imageUrl: /^https?:\/\//i.test(String(it.mainImageUrl || '')) ? String(it.mainImageUrl) : '',
    itemId: String(it.itemId || it.wpid || ''),
  };
}

// Create Inbound Shipment. Walmart's samples disagree on the return
// address's country ("USA" in the request sample, "US" in the response):
// a refusal naming the country is retried once with the other spelling.
WalmartClient.prototype.createInboundShipment = async function (order) {
  try {
    return parseInboundCreate(await this.call('POST', '/v3/fulfillment/inbound-shipments', buildInboundOrder(order, 'US')));
  } catch (e) {
    if (!/country/i.test(String(e.message))) throw e;
    return parseInboundCreate(await this.call('POST', '/v3/fulfillment/inbound-shipments', buildInboundOrder(order, 'USA')));
  }
};
WalmartClient.prototype.inboundErrors = async function (orderId) {
  const q = `inboundOrderId=${encodeURIComponent(orderId)}&limit=10&offset=0`;
  return parseInboundErrors(await this.call('GET', `/v3/fulfillment/inbound-shipment-errors?${q}`));
};
WalmartClient.prototype.cancelInboundOrder = async function (orderId) {
  const body = await this.call('DELETE', `/v3/fulfillment/inbound-shipments/${encodeURIComponent(orderId)}`);
  if (body && String(body.status || '').toUpperCase() === 'FAIL') throw new WalmartError(errorText(body, 400));
  return true;
};
// the receiving labels for one shipment's boxes (a 4x6 PDF, one per box)
WalmartClient.prototype.shipmentLabels = async function (shipmentId, boxes) {
  const body = { shipmentId: String(shipmentId), labelSize: 'X4_6', labelFormat: 'PDF', loadTypes: [{ loadType: 'SINGLE SKU', count: Math.max(1, Math.round(Number(boxes) || 1)) }] };
  const r = await this.call('POST', '/v3/fulfillment/shipment-label', body, { accept: 'application/pdf' });
  if (!r || !r.buffer || r.buffer.length < 100) throw new WalmartError('Walmart sent back no label file.');
  return r.buffer;
};
// one listing's WFS stock straight from Walmart (Get WFS Inventory filtered
// by sku): its on-hand count, or null when Walmart sent back no WFS record
// for that SKU
WalmartClient.prototype.wfsInventoryFor = async function (sku) {
  const body = await this.call('GET', `/v3/fulfillment/inventory?sku=${encodeURIComponent(String(sku))}&limit=10&offset=0`);
  const row = arr(body && body.payload && body.payload.inventory).find(r => String((r && r.sku) || '').toUpperCase() === String(sku).toUpperCase());
  if (!row) return null;
  return arr(row.shipNodes).reduce((t, n) => t + Math.max(0, Number(n && n.onHandQty) || 0), 0);
};
WalmartClient.prototype.itemFacts = async function (sku) {
  return parseItemFacts(await this.call('GET', `/v3/items/${encodeURIComponent(String(sku))}`));
};
WalmartClient.prototype.submitConvertFeed = async function (form) {
  const body = await this.call('POST', '/v3/feeds?feedType=OMNI_WFS', buildConvertFeed(form));
  if (!body || !body.feedId) throw new WalmartError(`Walmart took the request but returned no feed id${body ? ` (${errorText(body, 200)})` : ''}.`);
  return String(body.feedId);
};

/* ---------- WFS inbound: preview, Walmart's preferred carrier, tracking
   (owner 2026-11-07: "I want the same exact thing from Walmart on here" -
   Seller Center's Distribution, Shipping, Contact and Review steps). Shapes
   from Walmart's API reference (developer.walmart.com, us-marketplace:
   inboundpreview, createquote, submitbookingquotes, generatelabel,
   downloadlabel, printbilloflading, voidcarrierratequotes,
   updateshipmenttrackingdetails). Where the reference and its own examples
   disagree, the examples are followed (they are real requests). ---------- */

// the carrier calls ("New" in Walmart's docs) name the API version and market
const WPC_HEADERS = { WM_GLOBAL_VERSION: '3.1', WM_MARKET: 'US' };
const WPC_TYPE = { PARCEL: 'Parcel', LTL: 'LTL', FTL: 'FTL' };
const digits = (v) => String(v || '').replace(/\D/g, '');

// Fetch Inbound Preview: the same order as Create Inbound Shipment, wrapped
function buildInboundPreview(order, countryCode = 'US') {
  const o = buildInboundOrder(order, countryCode);
  return {
    header: { headerAttributes: { buId: '0', martId: '0' } },
    payload: { inboundOrderId: clip(o.inboundOrderId, 50), returnAddress: o.returnAddress, orderItems: o.orderItems },
  };
}
// the preview -> { its: { fee, to, units } | null, self: [{ to, units }] }:
// "inbound" is the ITS route (one transfer station and its fee),
// "selfMirroring" the split Walmart makes when you distribute it yourself
function parseInboundPreview(body) {
  const failed = body && String(body.status || '').toUpperCase() === 'FAIL';
  if (failed) throw new WalmartError(errorText(body, 400));
  const out = { its: null, self: [] };
  const where = (p) => {
    const a = p.shipToAddress || {};
    return clip([a.fcName, [a.city, a.stateCode].filter(Boolean).join(', ')].filter(Boolean).join(' · '), 80);
  };
  const units = (p) => arr(p.shipmentItems).reduce((t, i) => t + (Number(i.itemQty) || 0), 0);
  for (const o of arr(body && body.payload)) {
    for (const pv of arr(o && o.previews)) {
      const list = arr(pv && pv.preview);
      if (/^inbound$/i.test(String(pv.previewType || ''))) {
        const fee = list.reduce((t, p) => t + (Number(p.totalNetTransferCharge) || 0), 0);
        out.its = { fee: Math.round(fee * 100) / 100, to: list.map(where).filter(Boolean).join(', '), units: list.reduce((t, p) => t + units(p), 0) };
      } else if (/self/i.test(String(pv.previewType || ''))) {
        out.self = list.map(p => ({ to: where(p), units: units(p) }));
      }
    }
  }
  return out;
}

// an address in the carrier calls' spelling
function wpcPlace(a, kind) {
  a = a || {};
  const o = {
    addressLine1: clip(a.line1, 60),
    addressLine2: clip(a.line2 || '', 60),
    city: clip(a.city, 40),
    stateOrProvince: clip(a.state, 2).toUpperCase(),
    country: 'US',
    postalCode: String(a.zip || '').trim().slice(0, 10),
    locationType: kind === 'origin' ? 'VNDR' : 'DC',
  };
  if (kind === 'origin') {
    if (digits(a.phone)) o.phone = digits(a.phone).slice(-10);
    o.locationName = clip(a.company || a.name || '', 60);
  } else if (a.name) o.locationName = clip(a.name, 60);
  return o;
}
// the booking's spelling of the same address
function wpcBookPlace(a, kind) {
  a = a || {};
  const o = {
    locationType: kind === 'origin' ? 'VNDR' : 'DC',
    addressLine1: clip(a.line1, 60),
    addressLine2: clip(a.line2 || '', 60),
    city: clip(a.city, 40),
    state: clip(a.state, 2).toUpperCase(),
    countryCode: 'US',
    postalCode: String(a.zip || '').trim().slice(0, 10),
    locationName: clip(kind === 'origin' ? (a.company || a.name || '') : (a.name || ''), 60),
  };
  // the warehouse's dock hours: weekdays 8 to 5
  if (kind === 'origin') o.operationHours = [1, 2, 3, 4, 5].map(d => ({ dayOfWeekCode: d, operationType: 'OPR', openStrTime: '08:00:00', closeStrTime: '17:00:00' }));
  return o;
}
const boxCount = (boxes) => arr(boxes).reduce((t, b) => t + (Number(b.n) || 0), 0);
// one entry per box for a parcel quote (Walmart takes no count there)
function parcelPackages(boxes) {
  const out = [];
  for (const b of arr(boxes)) {
    for (let i = 0; i < Number(b.n); i++) {
      out.push({ packageSequenceNumber: out.length + 1, weight: r2(b.lb), weightUOM: 'lb', length: r2(b.l), width: r2(b.w), height: r2(b.h), lengthUOM: 'in', packageType: 'SINGLE SKU' });
    }
  }
  return out;
}
// pallets: one line per pallet for LTL, one counted line for FTL
function palletPackages(p, counted) {
  const n = Math.max(1, Math.round(Number(p.pallets) || 1));
  const one = { isStackable: p.stackable !== false, length: r2(p.pl || 48), width: r2(p.pw || 40), height: r2(p.ph), weight: r2(p.plb), weightUOM: 'lb', lengthUOM: 'in', packageType: 'PALLET' };
  if (counted) return [{ ...one, noOfPackages: n, packageSequenceNumber: 1 }];
  return Array.from({ length: n }, (_, i) => ({ ...one, packageSequenceNumber: i + 1, noOfPackages: 1 }));
}
// the pickup day's window, 8 to 5 on the warehouse's clock
const pickupTs = (day, hh) => new Date(`${day}T${hh}:00:00`).toISOString();
const splitName = (n) => { const w = String(n || '').trim().split(/\s+/).filter(Boolean); return { firstName: w[0] || '', lastName: w.slice(1).join(' ') || w[0] || '' }; };

// what a carrier quote still needs: [] when it can be asked for
function quoteProblems(p) {
  const out = [];
  if (!p || !p.shipmentId) return ['No shipment picked.'];
  if (!WPC_TYPE[p.mode]) out.push('Pick small parcel, LTL or FTL.');
  const boxes = arr(p.boxes);
  if (!boxes.length) out.push('Enter the boxes.');
  for (const bx of boxes) {
    if (!(Number.isInteger(Number(bx.n)) && Number(bx.n) > 0)) { out.push('Enter how many cases.'); break; }
    if (!['l', 'w', 'h', 'lb'].every(k => Number(bx[k]) > 0)) { out.push('Enter each case\'s size and weight.'); break; }
    if (p.mode === 'PARCEL' && Number(bx.lb) > 150) { out.push('A small parcel case can weigh 150 lb at most; use LTL.'); break; }
  }
  if (p.mode === 'PARCEL' && boxCount(boxes) > 500) out.push('Small parcel takes 500 cases at most; use LTL.');
  const f = p.shipFrom || {};
  if (!f.line1 || !f.city || !f.state || !f.zip) out.push('Set the ship-from address (Settings › Shipping).');
  if (p.mode === 'LTL' || p.mode === 'FTL') {
    if (!(Number(p.pallets) >= 1)) out.push('Enter the pallets.');
    if (!(Number(p.ph) > 0) || !(Number(p.plb) > 0)) out.push('Enter each pallet\'s height and weight.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.ready || ''))) out.push('Pick the pickup day.');
    const c = p.contact || {};
    if (!c.name || digits(c.phone).length < 10 || !/@/.test(String(c.email || ''))) out.push('Enter the pickup contact\'s name, phone and email.');
    const t = p.shipTo || {};
    if (!t.line1 || !t.zip) out.push('Walmart sent no address for this warehouse; book it in Seller Center.');
  }
  return out;
}

// Create Carrier Rate Quote (New): POST /v3/fulfillment/inbound-shipments-quote
function buildCarrierQuote(p) {
  const type = WPC_TYPE[p.mode];
  const origin = wpcPlace(p.shipFrom, 'origin');
  const to = p.shipTo && p.shipTo.line1 ? wpcPlace(p.shipTo, 'destination') : null;
  if (type === 'Parcel') {
    const unit = { origin, unitDetails: { shipmentPackages: parcelPackages(p.boxes) } };
    if (to) unit.destination = to;
    return { payload: { shipmentId: String(p.shipmentId), quoteType: type, units: [unit] } };
  }
  const c = p.contact || {};
  const nm = splitName(c.name);
  const unitDetails = {
    declaredValue: r2(p.value || 0),
    noOfSingleSkuBoxes: boxCount(p.boxes),
    noOfMixedSkuBoxes: 0,
    totalPalletCount: Math.max(1, Math.round(Number(p.pallets) || 1)),
    shipmentPackages: palletPackages(p, type === 'FTL'),
  };
  const body = {
    payload: {
      shipmentId: String(p.shipmentId), quoteType: type,
      pickUpFromDate: pickupTs(p.ready, '08'), pickUpToDate: pickupTs(p.ready, '17'),
      contactDetails: { FirstName: nm.firstName, LastName: nm.lastName, email: String(c.email || '').trim(), phoneNo: digits(c.phone).slice(-10) },
      units: [{ origin, destination: to, unitDetails }],
    },
  };
  if (type === 'FTL') {
    body.payload.equipmentDetails = [{ length: { unitOfMeasure: 'FT', measurementValue: 53 }, protectionLevel: 'Dry', type: 'VAN53' }];
    Object.assign(body.payload.units[0], { sequenceNbr: 1, mode: 'TL', serviceLevel: 'WFS' });
    unitDetails.freightClass = 50;
  }
  return body;
}
const num2 = (...vals) => { for (const v of vals) { const n = Number(v); if (v !== null && v !== undefined && v !== '' && Number.isFinite(n)) return Math.round(n * 100) / 100; } return null; };
// the quote answer -> { quoteId, carrier, total, eta, expires, schedule }
function parseCarrierQuote(body) {
  const failed = body && (String(body.status || '').toUpperCase() === 'ERROR' || String(body.status || '').toUpperCase() === 'FAIL' || (arr(body.errors).length && !body.payload));
  if (failed) throw new WalmartError(errorText(body, 400));
  const p = (body && body.payload) || {};
  const q = arr(p.rateQuotes)[0] || null;
  if (q) {
    return {
      quoteId: String(q.quoteId || ''),
      carrier: clip((q.carrier && (q.carrier.carrierName || q.carrier.carrierId)) || '', 60),
      total: num2(q.netCharge, q.totalCharge, p.netCharge),
      eta: dayOf(q.estimatedDeliveryDateTime || q.transitTime),
      expires: dayOf(q.expiryDate),
      schedule: null,
    };
  }
  // a full truckload answers in its own shape
  const ag = arr(p.aggregates)[0] || {};
  const sc = arr(p.schedule)[0] || null;
  if (!p.quoteId && !ag.totalCharge && p.netCharge == null) throw new WalmartError('Walmart sent back no quote for this shipment.');
  return {
    quoteId: String(p.quoteId || ''),
    carrier: 'Walmart truckload',
    total: num2(p.netCharge, ag.totalCharge && ag.totalCharge.measurementValue),
    eta: dayOf(sc && sc.maxDueTs),
    expires: dayOf(p.expiryDate),
    schedule: sc,
  };
}

// Create Booking (New): accepting the quote's charges
function buildCarrierBooking(p, quote, at = new Date()) {
  const type = WPC_TYPE[p.mode];
  const base = { termsAcceptedTime: at.toISOString(), quoteType: type, quoteId: String((quote && quote.quoteId) || '') };
  if (type === 'Parcel') {
    return { payload: { shipmentId: String(p.shipmentId), bookingDetails: { ...base, unitDetails: [{ noOfSingleSkuBoxes: boxCount(p.boxes), noOfMixedSkuBoxes: 0 }] } } };
  }
  const c = p.contact || {};
  const nm = splitName(c.name);
  const f = p.shipFrom || {};
  const details = {
    ...base,
    pickupDetails: type === 'LTL'
      ? { businessLocationName: clip(f.company || f.name || '', 60), pickupDateInfo: [{ pickupDate: String(p.ready), readyTime: '08:00:00', closeTime: '17:00:00', priority: 1 }] }
      : { businessLocationName: clip(f.company || f.name || '', 60), pickUpWindow: 'Morning 8 AM to 12 PM' },
    shipperInfo: {
      contactInfo: { primaryContactPhoneNumber: digits(c.phone).slice(-10), primaryContactEmailAddress: String(c.email || '').trim() },
      name: clip(c.name, 60), firstName: nm.firstName, lastName: nm.lastName, requesterType: 'IWFS',
    },
    locations: { origin: wpcBookPlace(f, 'origin'), destination: wpcBookPlace(p.shipTo, 'destination') },
    unitDetails: [{
      declaredValue: r2(p.value || 0),
      totalPalletCount: Math.max(1, Math.round(Number(p.pallets) || 1)),
      noOfSingleSkuBoxes: boxCount(p.boxes),
      noOfMixedSkuBoxes: 0,
      shipmentPackages: palletPackages(p, type === 'FTL'),
    }],
  };
  if (type === 'FTL') {
    if (quote && quote.schedule) details.schedule = quote.schedule;
    Object.assign(details.unitDetails[0], { equipmentCode: 'VAN53', equipmentType: 'DRYV', length: 53, protectionLevel: 'DRY' });
  }
  return { payload: { shipmentId: String(p.shipmentId), bookingDetails: details } };
}
const okStatus = (body) => {
  if (body && /^(FAIL|ERROR)$/i.test(String(body.status || ''))) throw new WalmartError(errorText(body, 400));
  return true;
};

WalmartClient.prototype.inboundPreview = async function (order) {
  try {
    return parseInboundPreview(await this.call('POST', '/v3/fulfillment/inbound-preview', buildInboundPreview(order, 'US')));
  } catch (e) {
    if (!/country/i.test(String(e.message))) throw e;
    return parseInboundPreview(await this.call('POST', '/v3/fulfillment/inbound-preview', buildInboundPreview(order, 'USA')));
  }
};
WalmartClient.prototype.carrierQuote = async function (p) {
  return parseCarrierQuote(await this.call('POST', '/v3/fulfillment/inbound-shipments-quote', buildCarrierQuote(p), { extra: WPC_HEADERS }));
};
WalmartClient.prototype.carrierBook = async function (p, quote) {
  okStatus(await this.call('POST', '/v3/fulfillment/inbound-shipments-booking', buildCarrierBooking(p, quote), { extra: WPC_HEADERS }));
  return { carrier: (quote && quote.carrier) || '' };
};
WalmartClient.prototype.cancelCarrierBooking = async function (shipmentId, mode) {
  const q = `shipmentId=${encodeURIComponent(shipmentId)}&mode=${encodeURIComponent(WPC_TYPE[mode] || mode)}`;
  return okStatus(await this.call('DELETE', `/v3/fulfillment/inbound-shipments-booking?${q}`, null, { extra: WPC_HEADERS }));
};
// the carrier's paperwork as a PDF: a parcel's labels (asked for, then
// fetched once Walmart has drawn them: 202 while it works), a pallet
// shipment's bill of lading
WalmartClient.prototype.carrierLabels = async function (shipmentId, mode) {
  const id = encodeURIComponent(String(shipmentId));
  if (mode === 'LTL' || mode === 'FTL') {
    const r = await this.call('GET', `/v3/fulfillment/inbound-shipments-bol?shipmentId=${id}&mode=${WPC_TYPE[mode]}`, null, { accept: 'application/pdf', extra: WPC_HEADERS });
    if (!r || !r.buffer || r.buffer.length < 100) throw new WalmartError('Walmart has no bill of lading for this shipment yet. Try again in a few minutes.');
    return r.buffer;
  }
  const gen = (labelType) => this.call('POST', '/v3/fulfillment/generate-label', { payload: { shipmentId: String(shipmentId), labelType, shipDate: new Date().toISOString() } }, { extra: WPC_HEADERS });
  try { await gen('Carrier'); } catch (e) {
    if (!/label ?type/i.test(String(e.message))) throw e;
    await gen('Parcel');
  }
  for (let i = 0; i < 10; i++) {
    const r = await this.call('GET', `/v3/fulfillment/download-label?shipmentId=${id}&labelType=Carrier&labelSize=X4_6`, null, { accept: 'application/pdf', extra: WPC_HEADERS });
    if (r && r.status === 200 && r.buffer && r.buffer.length > 100) return r.buffer;
    await new Promise(res => setTimeout(res, 3000));
  }
  throw new WalmartError('Walmart is still drawing the labels. Try again in a minute.');
};
// your own carrier: the tracking numbers go on the shipment
WalmartClient.prototype.shipmentTracking = async function (shipmentId, carrierName, numbers) {
  return okStatus(await this.call('POST', '/v3/fulfillment/shipment-tracking', { shipmentId: String(shipmentId), carrierName: clip(carrierName, 40), trackingInfo: arr(numbers).slice(0, 100).map(String) }));
};

module.exports = {
  WalmartClient, WalmartError, EXCLUDED,
  buildInboundOrder, inboundProblems, parseInboundCreate, parseInboundErrors, WFS_PREP,
  quoteProblems, buildInboundPreview, parseInboundPreview, buildCarrierQuote, parseCarrierQuote, buildCarrierBooking,
  buildConvertFeed, convertProblems, parseItemFacts, OMNI_WFS_VERSION, WFS_PRODUCT_TYPES, WFS_CONDITIONS,
  parseInboundShipments, parseInboundItems,
  parseOrder, parseEstimates, dayOf, buildEstimateRequest, buildLabelRequest, parseLabel, errorText,
  idParam, toGtin14, normalizeSearch, buildMatchFeed, parseFeedStatus, isFinal, MATCH_CONDITIONS,
  parseItemStatus, parseProductPage, parseOffers, parseVariants, parseVariantSet,
  parseInsight, insightRows, parseRepricerReport, parseStrategy, buildStrategy, buildRepricerFeed, parseIncentive, buildIncentiveFeed, buildWalmartFundedFeed, NO_STRATEGY, addOrderSales,
};
