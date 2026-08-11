'use strict';
// Linnworks API client. Endpoints verified against apidocs.linnworks.net OpenAPI.
// Auth returns a regional Server URL; all subsequent calls go to that server.

const crypto = require('crypto');

const AUTH_URL = 'https://api.linnworks.net/api/Auth/AuthorizeByApplication';
// Heaviest endpoints allow 150/min; 450ms spacing keeps us safely under.
const MIN_CALL_SPACING_MS = 450;

// The DropShip program's source of truth: an extended property with this
// name on each enrolled stock item, value = pad qty. Living in Linnworks
// means every Capture Station install sees the same program.
const DS_PAD_PROP = 'DropshipPad';

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
        // for open-order items the stock item GUID is ItemId (StockItemId is zeros)
        stockItemId: it.ItemId,
        sku: it.SKU || it.ItemNumber || '',
        title: it.Title || '',
        quantity: it.Quantity || 1,
        // substitution reversal must skip lines that never deducted stock
        isService: !!it.IsService,
        unlinked: !!it.IsUnlinked,
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
          despatchBy: o.GeneralInfo ? (o.GeneralInfo.DespatchByDate || '') : '',
          // ALL lines are returned, flagged: unlinked lines still reserve stock
          // (they carry a SKU and count in InOrders), so the Stock page's
          // per-SKU order list must see them. Consumers that need a live stock
          // item (the router) filter on the flags themselves.
          items: (o.Items || []).map(it => ({
            // for open-order items the stock item GUID is ItemId (StockItemId is zeros)
            stockItemId: it.ItemId,
            sku: it.SKU || it.ItemNumber || '',
            channelSku: it.ChannelSKU || '',
            title: it.Title || '',
            quantity: it.Quantity || 1,
            isService: !!it.IsService,
            unlinked: !!it.IsUnlinked,
            // composite/bundle lines carry their children (recursive OrderItem
            // shape) — a bundle's child SKU reserves stock without ever being
            // a top-level line, so per-SKU searches must see them
            children: (it.CompositeSubItems || []).map(c => ({
              sku: c.SKU || c.ItemNumber || '',
              channelSku: c.ChannelSKU || '',
              quantity: c.Quantity || 1,
              unlinked: !!c.IsUnlinked,
            })),
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
        dataRequirements: ['StockLevels', 'Images', 'ExtendedProperties'],
        searchTypes: ['SKU', 'Title', 'Barcode'],
      });
      for (const it of items || []) {
        const img = (it.Images || []).find(i => i.IsMain) || (it.Images || [])[0] || null;
        // NB the API's property-name field really is spelt "ProperyName"
        const pad = (it.ItemExtendedProperties || [])
          .find(p => (p.ProperyName || p.PropertyName) === DS_PAD_PROP);
        out.push({
          dsPad: pad ? { rowId: pad.pkRowId, value: pad.PropertyValue || '' } : null,
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

  // Write one SKU's dropship pad to the program's source of truth (the
  // DropshipPad extended property). qty null = remove the SKU from the
  // program. Field spelling "ProperyName" is the API's own.
  async setDropshipPad(sku, qty) {
    const found = await this.call('Inventory/GetStockItemIdsBySKU', { request: { SKUS: [sku] } });
    const hit = ((found && found.Items) || [])[0];
    if (!hit || !hit.StockItemId) throw new LinnworksError(`${sku} is not in Linnworks inventory.`);
    const id = hit.StockItemId;
    const rows = await this.call(
      `Inventory/GetInventoryItemExtendedProperties?inventoryItemId=${encodeURIComponent(id)}`,
      undefined, { method: 'GET' }
    );
    const row = (rows || []).find(r => (r.ProperyName || r.PropertyName) === DS_PAD_PROP);
    if (qty === null) {
      if (row) {
        await this.call('Inventory/DeleteInventoryItemExtendedProperties', {
          inventoryItemId: id,
          inventoryItemExtendedPropertyIds: [row.pkRowId],
        });
      }
      return;
    }
    const prop = {
      pkRowId: row ? row.pkRowId : crypto.randomUUID(),
      fkStockItemId: id,
      ProperyName: DS_PAD_PROP,
      PropertyValue: String(qty),
      PropertyType: 'Attribute',
    };
    if (row) {
      if (row.PropertyValue === String(qty)) return; // already right
      await this.call('Inventory/UpdateInventoryItemExtendedProperties', {
        inventoryItemExtendedProperties: [prop],
      });
    } else {
      await this.call('Inventory/CreateInventoryItemExtendedProperties', {
        inventoryItemExtendedProperties: [prop],
      });
    }
  }

  // Channel integrations (Walmart / eBay / Temu…): id + source + subsource.
  // The objects are property bags; unwrap PropertyValue where present.
  async getMappingChannels() {
    const raw = await this.call('Inventory/GetChannels', undefined, { method: 'GET' });
    const val = (v) => (v && typeof v === 'object' && 'PropertyValue' in v) ? v.PropertyValue : v;
    return (raw || []).map(c => ({
      id: Number(val(c.PkChannelId)) || 0,
      source: String(val(c.Source) || ''),
      subSource: String(val(c.SubSource) || ''),
    })).filter(c => c.id && c.source);
  }

  // The channel's SCANNED listing catalog — the same feed Linnworks' own
  // mapping screen uses, unlinked listings included. Paged until dry.
  async getChannelItems(channelId, source, subSource) {
    const out = [];
    const seen = new Set(); // the server caps pages at its own size (50 seen
    // live, whatever EntriesPerPage asks for) - so a short page is NOT the
    // last page. Page until empty, dedupe in case the cursor is ignored.
    const PAGE = 200;
    for (let page = 1; page <= 200; page++) {
      const rows = await this.call('ChannelMapping/GetChannelItems', {
        channelOptions: {
          ChannelId: channelId,
          Source: source,
          SubSource: subSource,
          Page: page, // NOT PageNumber - that spelling is silently ignored
          EntriesPerPage: PAGE,
        },
      });
      if (!rows || !rows.length) break;
      let fresh = 0;
      for (const r of rows) {
        const key = `${r.ChannelSKURowId || ''}|${r.SKU || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fresh += 1;
        out.push({
          sku: r.SKU || '',
          title: r.Title || '',
          qty: Number(r.Quantity) || 0, // listed qty on the channel
          wfs: !!r.WFS,
          linked: !!r.IsLinked,
          linkedItemId: r.LinkedItemId && r.LinkedItemId !== '00000000-0000-0000-0000-000000000000' ? r.LinkedItemId : '',
          rowId: r.ChannelSKURowId && r.ChannelSKURowId !== '00000000-0000-0000-0000-000000000000' ? r.ChannelSKURowId : '',
          ignoreSync: !!r.IgnoreSync,
          // the marketplace's own listing id (eBay item number / Walmart
          // item id) — the create call binds the listing with it
          channelRefId: r.ChannelReferenceId || r.ItemNumber || '',
        });
      }
      if (!fresh) break; // page cursor ignored - nothing new, stop
    }
    return out;
  }

  // Create a channel-SKU → stock-item link. Orders/UpdateLinkItem is the
  // route that actually works (verified live 2026-08-08): the documented
  // CreateInventoryItemChannelSKUs 500s "Could not update channel mappings"
  // for eBay and only sometimes lands. pkStockId zeroed = create-by-key
  // (source + subSource + channelSKU).
  async linkChannelSku(channelSku, source, subSource, stockItemId) {
    await this.call('Orders/UpdateLinkItem', {
      pkStockId: '00000000-0000-0000-0000-000000000000',
      pkStockItemId: stockItemId,
      source,
      subSource,
      channelSKU: channelSku,
    });
  }

  async unlinkChannelSku(channelSkuRowId) {
    await this.call('Inventory/DeleteInventoryItemChannelSKUs', {
      inventoryItemChannelSKUIds: [channelSkuRowId],
    });
  }

  // Resolve a SKU to its stock item GUID (exact ItemNumber match, case-blind).
  // Substitution routing needs this: rows store the substitute as a SKU string
  // but availability reads (Stock/GetStockLevel) are keyed by stock item id.
  async findStockItemIdBySku(sku) {
    const wanted = String(sku || '').trim().toLowerCase();
    if (!wanted) return null;
    let items;
    try {
      items = await this.call('Stock/GetStockItemsFull', {
        keyword: String(sku).trim(),
        loadCompositeParents: false,
        loadVariationParents: false,
        entriesPerPage: 50,
        pageNumber: 1,
        dataRequirements: ['StockLevels'],
        searchTypes: ['SKU'],
      });
    } catch (e) {
      // an unknown keyword is a 400 ("No items found with given filter"),
      // not an empty list - that is a miss, not an error
      if (/no items found/i.test(e.message || '')) return null;
      throw e;
    }
    const hit = (items || []).find(it => String(it.ItemNumber || '').trim().toLowerCase() === wanted);
    return hit ? hit.StockItemId : null;
  }

  // Physical StockLevel for one stock item at one location (what despatch
  // deducts from - it floors at zero, so reversals must know the pre-level).
  async getLevelAt(stockItemId, locationId) {
    const levels = await this.call(`Stock/GetStockLevel?stockItemId=${encodeURIComponent(stockItemId)}`, undefined, { method: 'GET' });
    const row = (levels || []).find(l => l.Location && l.Location.StockLocationId === locationId);
    return row ? (row.StockLevel || 0) : 0;
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

  // Find a PROCESSED order by its channel reference (for returns): search,
  // then pull the full order for its item lines.
  // opts.light: skip the per-order items fetch (the sync's already-processed
  // reconfirmation only needs existence + the processed date)
  async findProcessedOrder(reference, opts) {
    const search = await this.call('ProcessedOrders/SearchProcessedOrders', {
      request: {
        SearchTerm: String(reference),
        DateField: 'processed',
        FromDate: '2000-01-01T00:00:00Z',
        ToDate: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        PageNumber: 1,
        ResultsPerPage: 20,
      },
    });
    const rows = (search && search.ProcessedOrders && search.ProcessedOrders.Data) || [];
    const hit = rows.find(o => String(o.cShortOrderId || o.ReferenceNum || '').trim() === String(reference).trim()) || rows[0];
    if (!hit) return null;
    const out = {
      orderId: hit.pkOrderID,
      numOrderId: hit.nOrderId,
      reference: String(reference),
      source: hit.Source || '',
      customer: hit.cFullName || '',
      processedOn: hit.dProcessedOn || '',
      tracking: hit.PostalTrackingNumber || '',
      items: [],
    };
    if (opts && opts.light) return out;
    try {
      const full = await this.call('Orders/GetOrdersById', { pkOrderIds: [hit.pkOrderID] });
      const order = (full || [])[0];
      out.items = ((order && order.Items) || []).filter(it => !it.IsService).map(it => ({
        sku: it.SKU || it.ItemNumber || '',
        title: it.Title || '',
        quantity: it.Quantity || 1,
        // sold price per unit for the returns sheet: PricePerUnit when the
        // channel provides it, otherwise the line total divided down
        price: Math.round(((Number(it.PricePerUnit) > 0
          ? Number(it.PricePerUnit)
          : (Number(it.CostIncTax) || 0) / (it.Quantity || 1))) * 100) / 100,
      }));
    } catch { /* items stay empty; the UI lets the user pick the SKU */ }
    return out;
  }

  // Sales page: every processed-order item line in a date window.
  // Verified against apidocs.linnworks.net: SearchProcessedOrders takes a
  // `request` wrapper (SearchTerm, DateField 'processed', FromDate/ToDate,
  // PageNumber, ResultsPerPage) and returns paged HEADERS only (pkOrderID,
  // Source, dProcessedOn, TotalPages, no item lines) — the per-item SKU /
  // Quantity / CostIncTax come from Orders/GetOrdersById, batched.
  // Both endpoints are heavy (150/min); the shared throttle spaces the calls.
  async listProcessedLines(fromIso, toIso) {
    const headers = [];
    for (let page = 1; ; page++) {
      const data = await this.call('ProcessedOrders/SearchProcessedOrders', {
        request: {
          SearchTerm: '',
          DateField: 'processed',
          FromDate: fromIso,
          ToDate: toIso,
          PageNumber: page,
          ResultsPerPage: 200,
        },
      });
      const po = (data && data.ProcessedOrders) || {};
      const hits = po.Data || [];
      for (const o of hits) {
        headers.push({
          orderId: o.pkOrderID,
          source: o.Source || '',
          processedOn: o.dProcessedOn || '',
        });
      }
      if (!hits.length || page >= (po.TotalPages || 1)) break;
    }
    const headById = new Map(headers.map(h => [h.orderId, h]));
    const lines = [];
    for (let i = 0; i < headers.length; i += 50) {
      const ids = headers.slice(i, i + 50).map(h => h.orderId);
      const full = await this.call('Orders/GetOrdersById', { pkOrderIds: ids });
      for (const order of full || []) {
        const head = headById.get(order.OrderId) || {};
        const source = head.source || (order.GeneralInfo ? order.GeneralInfo.Source : '') || '';
        // which location despatched it (drives dropship-velocity stats).
        // Verified live 2026-08-08: the REAL field is FulfilmentLocationId —
        // the old FulfilledLocationId guesses never existed, so every order
        // read as zero-GUID and dropship velocity counted nothing.
        const locationId = order.FulfilmentLocationId
          || order.FulfilledLocationId || order.FulfilledLocation
          || (order.GeneralInfo && order.GeneralInfo.Location) || '';
        for (const it of order.Items || []) {
          if (it.IsService) continue;
          const qty = it.Quantity || 1;
          lines.push({
            orderId: order.OrderId,
            source,
            locationId,
            processedOn: head.processedOn || '',
            sku: it.SKU || it.ItemNumber || '',
            title: it.Title || '',
            qty,
            // line revenue: the channel's line total (inc tax) when present,
            // otherwise the unit price times quantity
            revenue: Math.round((Number(it.CostIncTax) > 0
              ? Number(it.CostIncTax)
              : (Number(it.PricePerUnit) || 0) * qty) * 100) / 100,
          });
        }
      }
    }
    return lines;
  }

  // Set the minimum (reorder alert) level for one stock item at one location.
  // Verified: POST Stock/UpdateStockMinimumLevel { stockItemId, locationId,
  // minimumLevel } returns 204 No Content.
  async setStockMinimumLevel(stockItemId, locationId, minimumLevel) {
    return this.call('Stock/UpdateStockMinimumLevel', { stockItemId, locationId, minimumLevel });
  }

  // Bulk SKU -> StockItemId (one call). Unknown SKUs are simply absent.
  async getStockItemIdsBySkus(skus) {
    const data = await this.call('Inventory/GetStockItemIdsBySKU', { request: { SKUS: skus } });
    const map = new Map();
    for (const it of (data && data.Items) || []) {
      if (it.SKU && it.StockItemId) map.set(String(it.SKU).toUpperCase(), it.StockItemId);
    }
    return map;
  }

  // Channel SKUs linked to a stock item (what Channel Mapping points here).
  async getChannelSkus(stockItemId) {
    const data = await this.call(`Inventory/GetInventoryItemChannelSKUs?inventoryItemId=${encodeURIComponent(stockItemId)}`, undefined, { method: 'GET' });
    return (data || []).map(c => ({
      sku: c.SKU || '',
      source: c.Source || '',
      subSource: c.SubSource || '',
      listedQuantity: c.ListedQuantity ?? null,
      ignoreSync: !!c.IgnoreSync,
    }));
  }

  // Channel prices stored in Linnworks for a stock item (Listing Descriptions:
  // one row per Source/SubSource; a row with an empty SubSource is that
  // channel's default price). These are what Linnworks pushes to channels —
  // NOT read back from the marketplace.
  async getChannelPrices(stockItemId) {
    const data = await this.call(`Inventory/GetInventoryItemPrices?inventoryItemId=${encodeURIComponent(stockItemId)}`, undefined, { method: 'GET' });
    return (data || []).map(p => ({
      source: p.Source || '',
      subSource: p.SubSource || '',
      price: Number(p.Price),
    })).filter(p => Number.isFinite(p.price));
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

  // Create a bare stock item. Verified: POST Inventory/AddInventoryItem with
  // { inventoryItem: StockItem } returns 204 No Content, so the StockItemId
  // GUID is generated client-side and returned for follow-up calls.
  // MinimumLevel null = the account's default; TaxRate -1 = country rate.
  async createInventoryItem({ sku, title, barcode, retailPrice, purchasePrice }) {
    const stockItemId = globalThis.crypto.randomUUID();
    await this.call('Inventory/AddInventoryItem', {
      inventoryItem: {
        StockItemId: stockItemId,
        ItemNumber: sku,
        ItemTitle: title,
        BarcodeNumber: barcode || '',
        RetailPrice: Number(retailPrice) || 0,
        PurchasePrice: Number(purchasePrice) || 0,
        MinimumLevel: null,
        TaxRate: -1,
      },
    });
    return { stockItemId };
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
