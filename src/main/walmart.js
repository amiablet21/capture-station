'use strict';
// Walmart Marketplace API client — the Dispute Settlement column's feed.
// Auth is the OAuth client-credentials token (POST /v3/token with the
// Developer Portal Client ID + Secret); the settlement for a return is the
// refund Walmart reports on the return's lines (Returns API). The PO# the
// station stores is Walmart's purchaseOrderId, so the lookup is two calls:
// GET /v3/orders/{po} -> customerOrderId -> GET /v3/returns?customerOrderId.

const crypto = require('crypto');

const BASE = 'https://marketplace.walmartapis.com';
const MIN_CALL_SPACING_MS = 350; // polite spacing, well under Walmart's TPM

class WalmartError extends Error {
  constructor(message, { status, endpoint } = {}) {
    super(message);
    this.name = 'WalmartError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

class WalmartClient {
  constructor({ clientId, clientSecret } = {}) {
    this.creds = { clientId, clientSecret };
    this.session = null; // { token, expiresAt }
    this.lastCallAt = 0;
  }

  async throttle() {
    const wait = this.lastCallAt + MIN_CALL_SPACING_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this.lastCallAt = Date.now();
  }

  baseHeaders() {
    return {
      Accept: 'application/json',
      'WM_SVC.NAME': 'Walmart Marketplace',
      'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
    };
  }

  async auth() {
    const { clientId, clientSecret } = this.creds;
    if (!clientId || !clientSecret) {
      throw new WalmartError('Walmart API credentials are not configured (Settings).');
    }
    await this.throttle();
    const res = await fetch(`${BASE}/v3/token`, {
      method: 'POST',
      headers: {
        ...this.baseHeaders(),
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new WalmartError(`Walmart auth failed (${res.status}): ${trim(body)}`, { status: res.status, endpoint: 'token' });
    }
    const data = JSON.parse(body);
    if (!data.access_token) {
      throw new WalmartError(`Walmart auth response missing access_token: ${trim(body)}`, { endpoint: 'token' });
    }
    // renew a minute early so a token never expires mid-request
    this.session = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 900) * 1000 - 60000 };
    return this.session;
  }

  // GET helper. A 404 means "no such order / no returns" — that is data
  // (null), not an error; anything else non-OK throws.
  async get(pathq) {
    if (!this.session || Date.now() >= this.session.expiresAt) await this.auth();
    await this.throttle();
    const res = await fetch(`${BASE}${pathq}`, {
      method: 'GET',
      headers: { ...this.baseHeaders(), 'WM_SEC.ACCESS_TOKEN': this.session.token },
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.text();
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new WalmartError(`Walmart ${pathq.split('?')[0]} failed (${res.status}): ${trim(body)}`, { status: res.status, endpoint: pathq });
    }
    try { return JSON.parse(body); } catch { return null; }
  }

  // purchaseOrderId (the station's PO#) -> Walmart customerOrderId
  async customerOrderId(po) {
    const j = await this.get(`/v3/orders/${encodeURIComponent(String(po).trim())}?productInfo=false`);
    return (j && j.order && j.order.customerOrderId) || '';
  }

  async returnsForCustomerOrder(customerOrderId) {
    const j = await this.get(`/v3/returns?customerOrderId=${encodeURIComponent(customerOrderId)}`);
    return (j && j.returnOrders) || [];
  }

  // The whole trip for one PO#: [{ sku, amount, status }] per refunded line.
  async settlementForPo(po) {
    const coid = await this.customerOrderId(po);
    if (!coid) return [];
    return extractSettlement(await this.returnsForCustomerOrder(coid));
  }
}

// "{currencyAmount: 126.99}" | 126.99 | "126.99" -> a number
function moneyOf(v) {
  if (v == null) return 0;
  if (typeof v === 'object') return Number(v.currencyAmount) || 0;
  return Number(v) || 0;
}

// Sum every *Amount money field under a refund subtree (shapes vary across
// Walmart's return payloads; refund amounts are negative from the seller's
// side, so everything is absolute-valued).
function refundWalk(node) {
  let sum = 0;
  const seen = new Set();
  const walk = (n) => {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    for (const [k, v] of Object.entries(n)) {
      if (/amount$/i.test(k)) sum += Math.abs(moneyOf(v));
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(node);
  return sum;
}

// Walmart returnOrders -> [{ sku, amount, status }] per line that has real
// refund evidence. Priority per line: the explicit totalRefundAmount, then
// the refund subtree, and only for lines whose status says the refund
// actually happened, the expected-charge total (charges[] exists on every
// return line from day one — filling from it early would stamp a
// settlement on disputes that are still open).
function extractSettlement(returnOrders) {
  const lines = [];
  for (const ro of returnOrders || []) {
    for (const l of ro.returnOrderLines || []) {
      const sku = String((l.item && l.item.sku) || l.sku || '').trim();
      const status = String(l.status || l.currentRefundStatus || ro.status || '');
      let amt = Math.abs(moneyOf(l.totalRefundAmount));
      if (!amt) amt = refundWalk(l.refund || l.refundLines || l.refundCharges);
      if (!amt && /refund|complet|settl/i.test(status) && Array.isArray(l.charges)) {
        amt = l.charges.reduce((s, c) => s + Math.abs(moneyOf(c.chargeAmount || (c.charge && c.charge.chargeAmount))), 0);
      }
      amt = Math.round(amt * 100) / 100;
      if (amt) lines.push({ sku, amount: amt, status });
    }
  }
  return lines;
}

function trim(s) {
  return String(s || '').replace(/\s+/g, ' ').slice(0, 300);
}

module.exports = { WalmartClient, WalmartError, extractSettlement };
