'use strict';
// Walmart Marketplace API for Ship with Walmart labels on Walmart orders
// (owner 2026-10-20): Walmart's own rates beside our UPS accounts, the label
// bought through Walmart and tied to the PO. The seller's own key pair
// (Seller Center → API Key Management) authenticates with client
// credentials; tokens last 15 minutes.
// Shapes per developer.walmart.com (US Marketplace): Token API, Orders
// (GET /v3/orders/{po}), Ship with Walmart shipping-estimates / labels /
// labels/carriers/{carrier}/trackings/{tracking} (download + discard).

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
  const errs = arr(body && (body.errors || (body.error && arr(body.error))));
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

  async discard(carrier, tracking) {
    const body = await this.call('DELETE', `/v3/shipping/labels/carriers/${encodeURIComponent(carrier)}/trackings/${encodeURIComponent(tracking)}`);
    if (body && body.data !== undefined && String(body.data) !== 'true') throw new WalmartError('Walmart did not void the label.');
    return true;
  }
}
WalmartClient.tokens = new Map();
WalmartClient.testHost = ''; // the e2e suite's fake Walmart

module.exports = {
  WalmartClient, WalmartError, EXCLUDED,
  parseOrder, parseEstimates, dayOf, buildEstimateRequest, buildLabelRequest, parseLabel,
};
