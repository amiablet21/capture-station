'use strict';
// Walmart Marketplace API client — the slice Ship with Walmart (SWW) needs:
// token, read a purchase order, rate estimates, buy / download / discard a
// label, and (optionally) the order shipping update. Same shape as
// linnworks.js: a small class, built-in fetch, no dependencies.
//
// Every call carries the four Walmart headers. The access token lives 15
// minutes; it is cached for 14 and refreshed once on a 401.
// Reference: https://developer.walmart.com/us-marketplace/docs/buy-shipping

const crypto = require('node:crypto');

const PROD = 'https://marketplace.walmartapis.com';
const SANDBOX = 'https://sandbox.walmartapis.com';
const SVC_NAME = 'Capture Station';
const TOKEN_TTL_MS = 14 * 60 * 1000;

class WalmartClient {
  constructor({ clientId, clientSecret, sandbox } = {}) {
    this.clientId = String(clientId || '').trim();
    this.clientSecret = String(clientSecret || '').trim();
    this.base = sandbox ? SANDBOX : PROD;
    this.token = null;
    this.tokenAt = 0;
  }

  static errorMessage(payload, status) {
    // Walmart wraps failures as { errors: [...] } or { error: [...] }
    const list = (payload && (payload.errors || payload.error)) || [];
    const first = Array.isArray(list) ? list[0] : list;
    if (first && (first.description || first.code)) {
      return `${first.description || ''}${first.code ? ` (${first.code})` : ''}`.trim();
    }
    if (payload && typeof payload === 'string' && payload.trim()) return payload.trim().slice(0, 300);
    return `Walmart API HTTP ${status}`;
  }

  async auth() {
    if (this.token && Date.now() - this.tokenAt < TOKEN_TTL_MS) return this.token;
    if (!this.clientId || !this.clientSecret) throw new Error('Walmart API key missing (Settings > Ship with Walmart).');
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch(`${this.base}/v3/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'WM_SVC.NAME': SVC_NAME,
        'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
      },
      body: 'grant_type=client_credentials',
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok || !data || !data.access_token) {
      if (res.status === 401) throw new Error('Walmart rejected the Client ID / Client Secret.');
      throw new Error(WalmartClient.errorMessage(data, res.status));
    }
    this.token = data.access_token;
    this.tokenAt = Date.now();
    return this.token;
  }

  headers(accept) {
    return {
      'WM_SEC.ACCESS_TOKEN': this.token,
      'WM_SVC.NAME': SVC_NAME,
      'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
      Accept: accept || 'application/json',
    };
  }

  // raw: true returns the body as a Buffer (label files); otherwise parsed JSON
  async call(method, path, { body, accept, raw = false, retry = true } = {}) {
    await this.auth();
    const headers = this.headers(accept);
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && retry) {
      this.token = null; // expired early or revoked: one fresh token, one retry
      return this.call(method, path, { body, accept, raw, retry: false });
    }
    if (res.status === 429) {
      const err = new Error('Walmart is rate-limiting this API key — try again in a moment.');
      err.status = 429;
      throw err;
    }
    if (raw) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok) {
        let payload = null;
        try { payload = JSON.parse(buf.toString('utf8')); } catch { payload = buf.toString('utf8'); }
        const err = new Error(WalmartClient.errorMessage(payload, res.status));
        err.status = res.status;
        throw err;
      }
      return buf;
    }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (!res.ok) {
      const err = new Error(WalmartClient.errorMessage(data, res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ---------- orders ---------- */

  // The PO as Walmart holds it: line numbers (needed on the label), ship-to
  // address, promised dates and per-line status.
  async getOrder(purchaseOrderId) {
    const data = await this.call('GET', `/v3/orders/${encodeURIComponent(purchaseOrderId)}`);
    const order = (data && data.order) || data;
    if (!order || !order.purchaseOrderId) throw new Error('Walmart returned no order for that PO#.');
    const si = order.shippingInfo || {};
    const addr = si.postalAddress || {};
    const lines = (((order.orderLines || {}).orderLine) || []).map(l => {
      const statuses = ((l.orderLineStatuses || {}).orderLineStatus) || [];
      const status = statuses.map(s => s.status).filter(Boolean);
      return {
        lineNumber: String(l.lineNumber || ''),
        sku: (l.item || {}).sku || '',
        productName: (l.item || {}).productName || '',
        qty: Number((l.orderLineQuantity || {}).amount) || 1,
        status, // e.g. ['Acknowledged'] — a line can carry several
        shipped: status.includes('Shipped') || status.includes('Delivered'),
        cancelled: status.includes('Cancelled'),
      };
    });
    return {
      purchaseOrderId: String(order.purchaseOrderId),
      customerOrderId: order.customerOrderId || '',
      orderDate: order.orderDate || null,
      methodCode: si.methodCode || '',
      estimatedShipDate: si.estimatedShipDate || null,
      estimatedDeliveryDate: si.estimatedDeliveryDate || null,
      shipTo: {
        name: addr.name || '',
        addressLines: [addr.address1, addr.address2].map(s => String(s || '').trim()).filter(Boolean),
        city: addr.city || '',
        state: addr.state || '',
        postalCode: String(addr.postalCode || ''),
        countryCode: (addr.country || 'US').toUpperCase() === 'USA' ? 'US' : (addr.country || 'US').toUpperCase(),
        phone: si.phone || '',
      },
      lines,
    };
  }

  // Mark lines shipped with carrier + tracking (Linnworks normally owns this;
  // used only when the "mark shipped on label" setting is on).
  async shipOrder(purchaseOrderId, { lines, carrier, trackingNumber, trackingUrl, methodCode, sellerOrderId }) {
    const body = {
      orderShipment: {
        orderLines: {
          orderLine: lines.map(l => ({
            lineNumber: String(l.lineNumber),
            sellerOrderId: String(sellerOrderId || purchaseOrderId).slice(0, 30),
            intentToCancelOverride: false,
            orderLineStatuses: {
              orderLineStatus: [{
                status: 'Shipped',
                statusQuantity: { unitOfMeasurement: 'EACH', amount: String(l.qty || 1) },
                trackingInfo: {
                  shipDateTime: Date.now(),
                  carrierName: { carrier },
                  methodCode: methodCode || 'Standard',
                  trackingNumber: String(trackingNumber),
                  trackingURL: trackingUrl || undefined,
                },
              }],
            },
          })),
        },
      },
    };
    return this.call('POST', `/v3/orders/${encodeURIComponent(purchaseOrderId)}/shipping`, { body });
  }

  /* ---------- Ship with Walmart ---------- */

  async carriers() {
    const data = await this.call('GET', '/v3/shipping/labels/carriers');
    return ((data && (data.carriers || (data.data && data.data.carriers))) || []).map(c => ({
      id: c.carrierId, shortName: c.shortName, name: c.carrierName,
    }));
  }

  async packageTypes(shortName = 'ALL') {
    const data = await this.call('GET', `/v3/shipping/labels/carriers/${encodeURIComponent(shortName)}/package-types`);
    return ((data && data.data) || []).map(p => ({
      id: p.id, shortName: p.packageTypeShortName, name: p.packageTypeDisplayName,
      length: p.length, width: p.width, height: p.height, unit: p.dimensionUnit,
    }));
  }

  // Every service Walmart can sell for this box, priced. `estimates[].name`
  // is the value the label call wants as carrierServiceType.
  async estimates(body) {
    const data = await this.call('POST', '/v3/shipping/labels/shipping-estimates', { body });
    const d = (data && data.data) || {};
    const list = (d.estimates || []).map(e => ({
      name: e.name,
      displayName: e.displayName || e.name,
      group: e.serviceTypeGroupName || '',
      groupName: e.serviceTypeGroupDisplayName || '',
      carrier: e.carrierName || '',
      carrierName: e.carrierDisplayName || e.carrierName || '',
      deliveryDate: e.deliveryDate || null,
      amount: Number((e.estimatedRate || {}).amount),
      currency: (e.estimatedRate || {}).currency || 'USD',
      onTime: e.isDeliveryPromiseFulfilled !== false,
      addOns: (e.addOns || []).map(a => ({ name: a.name, amount: Number((a.charge || {}).amount) || 0, status: a.status || '' })),
    })).filter(e => e.name && Number.isFinite(e.amount));
    return { estimates: list, alert: d.alertMessage || '' };
  }

  // Buys the label. JSON only here (tracking + service); the file comes from
  // downloadLabel, which keeps the two concerns and their error paths apart.
  async createLabel(body) {
    const data = await this.call('POST', '/v3/shipping/labels', { body });
    const d = (data && data.data) || data || {};
    if (!d.trackingNo) throw new Error('Walmart created no tracking number for the label.');
    return {
      purchaseOrderId: d.purchaseOrderId || body.purchaseOrderId,
      trackingNo: String(d.trackingNo),
      trackingUrl: d.trackingUrl || '',
      carrier: d.carrierName || body.carrierName,
      carrierFullName: d.carrierFullName || d.carrierName || body.carrierName,
      service: d.carrierServiceType || body.carrierServiceType,
      addOns: (d.addOns || []).map(a => ({ name: a.name, amount: Number((a.charge || {}).amount) || 0, status: a.status || '' })),
      boxItems: d.boxItems || body.boxItems,
    };
  }

  // format 'pdf' | 'png' -> Buffer of the label file
  async downloadLabel(carrierShortName, trackingNo, format = 'pdf') {
    const accept = format === 'png' ? 'image/png' : 'application/pdf';
    return this.call('GET',
      `/v3/shipping/labels/carriers/${encodeURIComponent(carrierShortName)}/trackings/${encodeURIComponent(trackingNo)}`,
      { accept, raw: true });
  }

  async labelsByPo(purchaseOrderId) {
    const data = await this.call('GET', `/v3/shipping/labels/purchase-orders/${encodeURIComponent(purchaseOrderId)}`);
    return ((data && data.data) || []).map(d => ({
      purchaseOrderId: d.purchaseOrderId,
      trackingNo: d.trackingNo,
      carrier: d.carrierName,
      service: d.carrierServiceType,
      trackingUrl: d.trackingUrl || '',
      addOns: d.addOns || [],
    }));
  }

  async discardLabel(carrierShortName, trackingNo) {
    const data = await this.call('DELETE',
      `/v3/shipping/labels/carriers/${encodeURIComponent(carrierShortName)}/trackings/${encodeURIComponent(trackingNo)}`);
    const ok = data && (data.data === true || data.data === 'true' || data === true);
    if (!ok) throw new Error(WalmartClient.errorMessage(data, 200));
    return true;
  }

  // The cheapest end-to-end check: a token plus the carrier list.
  async testConnection() {
    await this.auth();
    const carriers = await this.carriers();
    return { carriers, sandbox: this.base === SANDBOX };
  }
}

module.exports = { WalmartClient, PROD, SANDBOX };
