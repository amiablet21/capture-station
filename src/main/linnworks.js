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
  // fulfilmentCenter is required in practice: without it Linnworks searches the
  // "Default" location only, so orders held in any other location come back empty.
  // Returns { orderId, numOrderId, reference, items:[{rowId, sku, title, quantity}], shippingInfo } or null.
  async findOpenOrder(reference, fulfilmentCenter) {
    const data = await this.call('Orders/GetOpenOrders', {
      entriesPerPage: 10,
      pageNumber: 1,
      fulfilmentCenter: fulfilmentCenter || '00000000-0000-0000-0000-000000000000',
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

  // Append an internal note to an order. SetOrderNotes overwrites the full
  // note list, so existing notes are fetched and preserved. Skips if a note
  // with identical text already exists (safe on sync retries).
  async addOrderNote(orderId, noteText) {
    let existing = [];
    try {
      existing = await this.call(`Orders/GetOrderNotes?orderId=${encodeURIComponent(orderId)}`, undefined, { method: 'GET' }) || [];
    } catch { existing = []; }
    if (existing.some(n => n && n.Note === noteText)) return null;
    return this.call('Orders/SetOrderNotes', {
      orderId,
      orderNotes: [
        ...existing,
        {
          OrderNoteId: '00000000-0000-0000-0000-000000000000',
          OrderId: orderId,
          NoteDate: new Date().toISOString(),
          Internal: true,
          Note: noteText,
          CreatedBy: 'Capture Station',
        },
      ],
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

  // All open orders at a location with the item info routing and the Stock
  // page's per-SKU order list need.
  async listOpenOrders(fulfilmentCenter) {
    const out = [];
    for (let page = 1; ; page++) {
      const data = await this.call('Orders/GetOpenOrders', {
        entriesPerPage: 200, pageNumber: page, fulfilmentCenter,
      });
      const hits = (data && data.Data) || [];
      for (const o of hits) {
        out.push({
          orderId: o.OrderId,
          numOrderId: o.NumOrderId,
          reference: o.GeneralInfo ? o.GeneralInfo.ReferenceNum : '',
          source: o.GeneralInfo ? (o.GeneralInfo.Source || '') : '',
          receivedDate: o.GeneralInfo ? (o.GeneralInfo.ReceivedDate || '') : '',
          items: (o.Items || []).filter(it => !it.IsService && !it.IsUnlinked).map(it => ({
            // for open-order items the stock item GUID is ItemId (StockItemId is zeros)
            stockItemId: it.ItemId,
            sku: it.SKU || it.ItemNumber || '',
            channelSku: it.ChannelSKU || '',
            title: it.Title || '',
            quantity: it.Quantity || 1,
          })),
        });
      }
      if (hits.length < 200) return out;
    }
  }

  // Full inventory with per-location stock levels and images (paged, 200 per call),
  // mirroring the columns of Linnworks' My Inventory grid.
  async listInventory() {
    const out = [];
    for (let page = 1; ; page++) {
      const items = await this.call('Stock/GetStockItemsFull', {
        keyword: '',
        loadCompositeParents: false,
        loadVariationParents: false,
        entriesPerPage: 200,
        pageNumber: page,
        dataRequirements: ['StockLevels', 'Images'],
        searchTypes: ['SKU', 'Title', 'Barcode'],
      });
      for (const it of items || []) {
        const img = (it.Images || []).find(i => i.IsMain) || (it.Images || [])[0] || null;
        out.push({
          stockItemId: it.StockItemId,
          sku: it.ItemNumber || '',
          title: it.ItemTitle || '',
          barcode: it.BarcodeNumber || '',
          category: it.CategoryName || '',
          purchasePrice: it.PurchasePrice || 0,
          retailPrice: it.RetailPrice || 0,
          image: img ? (img.Source || img.FullSource || '') : '',
          levels: (it.StockLevels || []).map(l => ({
            locationId: l.Location && l.Location.StockLocationId,
            locationName: l.Location && l.Location.LocationName,
            stockLevel: l.StockLevel || 0,
            inOrders: l.InOrders || 0,
            due: l.Due || 0,
            minimumLevel: l.MinimumLevel || 0,
            available: l.Available || 0,
          })),
        });
      }
      if (!items || items.length < 200) return out;
    }
  }

  // Available (StockLevel - InOrders) for one stock item at one location.
  async getAvailableAt(stockItemId, locationId) {
    const levels = await this.call(`Stock/GetStockLevel?stockItemId=${encodeURIComponent(stockItemId)}`, undefined, { method: 'GET' });
    const row = (levels || []).find(l => l.Location && l.Location.StockLocationId === locationId);
    return row ? (row.Available || 0) : 0;
  }

  // Set an absolute stock level for one SKU at one location.
  // Returns { stockLevel, inOrders, available } from Linnworks' response.
  async setStockLevel(sku, locationId, level) {
    const res = await this.call('Stock/SetStockLevel', {
      stockLevels: [{ SKU: sku, LocationId: locationId, Level: level }],
      changeSource: 'Capture Station stock page',
    });
    const row = (res || [])[0] || {};
    return {
      stockLevel: row.StockLevel ?? level,
      inOrders: row.InOrders ?? 0,
      available: row.Available ?? Math.max(0, level - (row.InOrders || 0)),
    };
  }

  // Upload a local image file to Linnworks' uploader, then attach it to a
  // stock item. Verified flow: Uploader/UploadFile -> FileId ->
  // Inventory/UploadImagesToInventoryItem.
  async addItemImage(stockItemId, fileBuffer, fileName, mimeType) {
    if (!this.session) await this.auth();
    await this.throttle();
    const form = new FormData();
    form.append('file', new Blob([fileBuffer], { type: mimeType || 'application/octet-stream' }), fileName || 'image.png');
    const res = await fetch(`${this.session.server}/api/Uploader/UploadFile?type=Image&expiredInHours=24`, {
      method: 'POST',
      headers: { Authorization: this.session.token },
      body: form,
    });
    const body = await res.text();
    if (!res.ok) {
      throw new LinnworksError(`UploadFile failed (${res.status}): ${trim(body)}`, { status: res.status, endpoint: 'Uploader/UploadFile' });
    }
    const up = JSON.parse(body);
    const fileId = ((Array.isArray(up) ? up[0] : up) || {}).FileId;
    if (!fileId) throw new LinnworksError('UploadFile returned no FileId');
    await this.call('Inventory/UploadImagesToInventoryItem', { inventoryItemId: stockItemId, imageIds: [fileId] });
    return { fileId };
  }

  // Attach an image by URL: Linnworks downloads it itself (handy for reusing
  // an existing listing's image). Some deployments expect a `request` wrapper.
  async addItemImageByUrl(sku, stockItemId, imageUrl) {
    const payload = { ItemNumber: sku, StockItemId: stockItemId, ImageUrl: imageUrl, IsMain: false };
    try {
      return await this.call('Inventory/AddImageToInventoryItem', payload);
    } catch {
      return this.call('Inventory/AddImageToInventoryItem', { request: payload });
    }
  }

  // Adjust stock levels by a delta per SKU at one location (negative = deduct).
  async changeStockLevels(entries, locationId, changeSource) {
    return this.call('Stock/UpdateStockLevelsBySKU', {
      stockLevels: entries.map(e => ({ SKU: e.sku, LocationId: locationId, Level: e.delta })),
      changeSource: changeSource || 'Capture Station',
    });
  }

  // Unpark orders: parked status is order tag 7; a null tag clears it.
  async unparkOrders(orderIds) {
    return this.call('Orders/ChangeOrderTag', { orderIds, tag: null });
  }

  async moveOrdersToLocation(orderIds, locationId) {
    return this.call('Orders/MoveToLocation', { orderIds, pkStockLocationId: locationId });
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
