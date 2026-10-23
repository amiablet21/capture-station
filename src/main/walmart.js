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
  async call(method, pathname, payload, { accept = 'application/json', retried = false, waited = 0 } = {}) {
    const token = await this.token();
    const res = await fetch(`${this.host}${pathname}`, {
      method,
      headers: this.headers({ 'WM_SEC.ACCESS_TOKEN': token, Accept: accept, 'Content-Type': 'application/json' }),
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(45000),
    });
    if (res.status === 401 && !retried) {
      WalmartClient.tokens.clear();
      return this.call(method, pathname, payload, { accept, retried: true, waited });
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
        return this.call(method, pathname, payload, { accept, retried, waited: waited + 1 });
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

module.exports = {
  WalmartClient, WalmartError, EXCLUDED,
  parseOrder, parseEstimates, dayOf, buildEstimateRequest, buildLabelRequest, parseLabel, errorText,
  idParam, toGtin14, normalizeSearch, buildMatchFeed, parseFeedStatus, isFinal, MATCH_CONDITIONS,
  parseItemStatus, parseProductPage, parseOffers, parseVariants, parseVariantSet,
  parseInsight, insightRows, parseRepricerReport, parseStrategy, buildStrategy, buildRepricerFeed, parseIncentive, buildIncentiveFeed, buildWalmartFundedFeed, NO_STRATEGY, addOrderSales,
};
