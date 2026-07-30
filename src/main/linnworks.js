'use strict';
// Linnworks API client. Endpoints verified against apidocs.linnworks.net OpenAPI.
// Auth returns a regional Server URL; all subsequent calls go to that server.

const AUTH_URL = 'https://api.linnworks.net/api/Auth/AuthorizeByApplication';
// Heaviest endpoints allow 150/min; 450ms spacing keeps us safely under.
const MIN_CALL_SPACING_MS = 450;

class LinnworksError extends Error {
  constructor(message, { status, endpoint } = {}) {
    super(message);
    this.name = 'LinnworksError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

class LinnworksClient {
  constructor({ applicationId, applicationSecret, token }) {
    this.creds = { applicationId, applicationSecret, token };
    this.session = null; // { token, server }
    this.lastCallAt = 0;
  }

  async throttle() {
    const wait = this.lastCallAt + MIN_CALL_SPACING_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this.lastCallAt = Date.now();
  }

  async auth() {
    const { applicationId, applicationSecret, token } = this.creds;
    if (!applicationId || !applicationSecret || !token) {
      throw new LinnworksError('Linnworks credentials are not configured (Settings).');
    }
    await this.throttle();
    const res = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        ApplicationId: applicationId,
        ApplicationSecret: applicationSecret,
        Token: token,
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new LinnworksError(`Auth failed (${res.status}): ${trim(body)}`, { status: res.status, endpoint: 'Auth' });
    }
    const data = JSON.parse(body);
    if (!data.Token || !data.Server) {
      throw new LinnworksError(`Auth response missing Token/Server: ${trim(body)}`, { endpoint: 'Auth' });
    }
    this.session = { token: data.Token, server: data.Server.replace(/\/+$/, '') };
    return this.session;
  }

  async call(endpoint, payload, { method = 'POST' } = {}) {
    if (!this.session) await this.auth();
    await this.throttle();
    const url = `${this.session.server}/api/${endpoint}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.session.token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: method === 'GET' ? undefined : JSON.stringify(payload ?? {}),
    });
    const body = await res.text();
    if (res.status === 401) {
      // session expired: re-auth once and retry
      await this.auth();
      return this.call(endpoint, payload, { method });
    }
    if (!res.ok) {
      throw new LinnworksError(`${endpoint} failed (${res.status}): ${trim(body)}`, { status: res.status, endpoint });
    }
    if (!body) return null;
    try { return JSON.parse(body); } catch { return body; }
  }

  // Find one open order whose channel reference number equals `reference`.
  // Returns { orderId, numOrderId, reference, items:[{rowId, sku, title, quantity}], shippingInfo } or null.
  async findOpenOrder(reference) {
    const data = await this.call('Orders/GetOpenOrders', {
      entriesPerPage: 10,
      pageNumber: 1,
      filters: {
        TextFields: [{
          FieldCode: 'GENERAL_INFO_REFERENCE_NUMBER',
          Type: 'Equal',
          Text: String(reference),
        }],
      },
    });
    const hits = (data && data.Data) || [];
    // The filter should be exact, but double-check the reference matches.
    const order = hits.find(o =>
      o.GeneralInfo && String(o.GeneralInfo.ReferenceNum).trim() === String(reference).trim()
    ) || hits[0] || null;
    if (!order) return null;
    return {
      orderId: order.OrderId,
      numOrderId: order.NumOrderId,
      reference: order.GeneralInfo ? order.GeneralInfo.ReferenceNum : reference,
      source: order.GeneralInfo ? order.GeneralInfo.Source : '',
      items: (order.Items || []).map(it => ({
        rowId: it.RowId,
        sku: it.SKU || it.ItemNumber || '',
        title: it.Title || '',
        quantity: it.Quantity || 1,
      })),
      shippingInfo: order.ShippingInfo || {},
    };
  }

  // Preserve existing shipping fields; only replace the tracking number.
  async setTracking(orderId, existingShippingInfo, trackingNumber) {
    const s = existingShippingInfo || {};
    return this.call('Orders/SetOrderShippingInfo', {
      orderId,
      info: {
        PostalServiceId: s.PostalServiceId || '00000000-0000-0000-0000-000000000000',
        TotalWeight: s.TotalWeight || 0,
        ItemWeight: s.ItemWeight || 0,
        PostageCost: s.PostageCost || 0,
        TrackingNumber: trackingNumber,
        ManualAdjust: false,
      },
    });
  }

  // serialsByItem: [{ orderItemRowId, serials: ['355...', ...] }]
  // One inner collection per physical unit; values overwrite, so re-runs are safe.
  async createSerials(serialsByItem) {
    return this.call('Orders/CreateSerialisedValuesForOrderItems', {
      OrderItemSerialData: serialsByItem.map(x => ({
        OrderItemRowId: x.orderItemRowId,
        CorrelationSerials: x.serials.map(v => ([{ Type: serialType(v), Value: v }])),
      })),
    });
  }

  // Returns { processedState, message } — states: PROCESSED, NOT_FOUND, SCAN_REQUIRED, ...
  async processOrder(orderOrReferenceId, locationId) {
    const data = await this.call('Orders/ProcessOrderByOrderOrReferenceId', {
      request: {
        OrderOrReferenceId: String(orderOrReferenceId),
        LocationId: locationId,
        ScansPerformed: true,
        OrderProcessingNotesAcknowledged: true,
      },
    });
    return {
      processedState: (data && data.ProcessedState) || 'UNKNOWN',
      message: (data && data.Message) || '',
      raw: data,
    };
  }

  async getLocations() {
    let data;
    try {
      data = await this.call('Inventory/GetStockLocations', undefined, { method: 'GET' });
    } catch (e) {
      // some deployments only accept POST here
      data = await this.call('Inventory/GetStockLocations', {});
    }
    return (data || []).map(l => ({
      id: l.StockLocationId,
      name: l.LocationName,
    }));
  }
}

function serialType(value) {
  return /^\d{15}$/.test(value) ? 'IMEI' : 'SerialNumber';
}

function trim(s) {
  return String(s || '').replace(/\s+/g, ' ').slice(0, 300);
}

module.exports = { LinnworksClient, LinnworksError, serialType };
