'use strict';

// HUBX Customer API sandbox: a local, dependency-free replica of the three
// documented surfaces (auth token, catalog, orders) so the integration can be
// explored and built with ZERO risk — no credentials, no real orders. Shapes
// mirror hubxteam.atlassian.net/wiki/spaces/HDP exactly; the real API is a
// base-URL + credential swap away.
//
//   node tools/hubx-sandbox.js        -> http://localhost:8787 (playground)
//
// Behavior simulated: client_credentials -> bearer token; paged catalog with
// availability/price tiers/EXW; ≤50-item metadata/inventory/price refresh;
// order validation (stock + expected price) -> 202 + async lifecycle
// Open -> Processing (carrier/tracking/serials assigned) -> Closed;
// cancellation while Open; stock drifts on its own like a live marketplace.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8787;
const TOKENS = new Set();

/* ---------- seeded catalog: shaped like his dropship reality ---------- */

let nextId = 1000;
const item = (mpn, desc, qty, price, tiers, exw, lead, moq) => ({
  id: `HXI-${nextId++}`,
  manufacturer: desc.startsWith('Apple') ? 'Apple' : 'Samsung',
  description: desc,
  mpn,
  moq: moq || 1,
  mxq: 500,
  unitPrice: price,
  partNumber: mpn,
  leadTimeDays: lead,
  availability: qty,
  exw,
  isActive: true,
  attributes: [{ name: 'Condition', value: 'New', comment: 'Factory sealed' }],
  comments: [],
  prices: tiers.map(([fromQty, unitPrice]) => ({ fromQty, unitPrice })),
});

const CATALOG = [
  item('SM-S938UZKEXAA', 'Samsung Galaxy S26 Ultra 256GB Titanium Black US Spec', 64, 918, [[1, 918], [10, 905], [25, 894]], 'Miami', 2),
  item('SM-S938UZWEXAA', 'Samsung Galaxy S26 Ultra 256GB Titanium White US Spec', 41, 921, [[1, 921], [10, 908]], 'Miami', 2),
  item('SM-S938UZBEXAA', 'Samsung Galaxy S26 Ultra 512GB Titanium Black US Spec', 22, 1041, [[1, 1041], [10, 1026]], 'Connecticut', 3),
  item('SM-S931UZKAXAA', 'Samsung Galaxy S26 256GB Black US Spec', 118, 641, [[1, 641], [10, 630], [50, 619]], 'Miami', 2),
  item('SM-S931UZBAXAA', 'Samsung Galaxy S26 256GB Blue US Spec', 73, 643, [[1, 643], [10, 632]], 'Miami', 2),
  item('SM-S926BZKGINS', 'Samsung Galaxy S26 Plus 512GB Black Intl Spec', 35, 744, [[5, 744], [10, 733]], 'Dubai', 5, 5),
  item('SM-F966UZKEXAA', 'Samsung Galaxy Z Fold7 512GB Jet Black US Spec', 17, 1418, [[1, 1418], [5, 1401]], 'Miami', 2),
  item('SM-S731ULBEXAA', 'Samsung Galaxy S25 FE 128GB Jet Black US Spec', 96, 431, [[10, 431], [50, 414]], 'Connecticut', 2, 10),
  item('SM-X930NZAEXAR', 'Samsung Galaxy Tab S11 256GB Gray Wi-Fi', 28, 689, [[1, 689], [10, 676]], 'Miami', 3),
  item('SM-X133NZAAXAR', 'Samsung Galaxy Tab A9+ Lite 64GB Gray Wi-Fi', 240, 84, [[25, 84], [100, 78]], 'Miami', 2, 25),
  item('MPXY3LL/A', 'Apple iPad 11th Gen 128GB Blue Wi-Fi', 55, 271, [[5, 271], [10, 266]], 'Miami', 2, 5),
  item('SM-R640WHT', 'Samsung Galaxy Buds 3 White', 130, 61, [[10, 61], [25, 58]], 'Connecticut', 1, 10),
];

/* ---------- orders ---------- */

let orderSeq = 4200;
const ORDERS = []; // internal shape close to the documented GetOrders row

const CARRIERS = ['UPS', 'FedEx'];
const rand = (n) => Math.floor(Math.random() * n);
const serial = () => `R58${String(Date.now()).slice(-6)}${String(rand(999)).padStart(3, '0')}`;

function progressOrder(o) {
  // Open -> Processing (tracking + serials) after ~20s, Closed after ~60s
  setTimeout(() => {
    if (o.status !== 'Open') return;
    o.status = 'Processing';
    const carrier = CARRIERS[rand(CARRIERS.length)];
    o.shipmentInformation = {
      shippingDate: new Date().toISOString(),
      carrier,
      transportationMode: 'Ground',
      trackingNumber: carrier === 'UPS'
        ? `1Z999AA1${String(rand(1e8)).padStart(8, '0')}`
        : String(rand(1e12)).padStart(12, '0'),
      eta: '2 days',
      shippingComments: 'Sandbox shipment',
    };
    for (const d of o.orderDetails) {
      d.serialNumbers = Array.from({ length: d.quantity }, serial);
    }
  }, 20000);
  setTimeout(() => { if (o.status === 'Processing') o.status = 'Closed'; }, 60000);
}

/* ---------- market drift: availability moves like a live book ---------- */

setInterval(() => {
  for (const it of CATALOG) {
    if (Math.random() < 0.35) it.availability = Math.max(0, it.availability - rand(4));
    if (Math.random() < 0.06) it.availability += 20 + rand(40); // restock drop
    if (Math.random() < 0.05) { // price wobble ±1%
      const bump = 1 + (Math.random() - 0.5) * 0.02;
      it.unitPrice = Math.round(it.unitPrice * bump * 100) / 100;
      it.prices = it.prices.map(p => ({ fromQty: p.fromQty, unitPrice: Math.round(p.unitPrice * bump * 100) / 100 }));
    }
  }
}, 15000);

/* ---------- plumbing ---------- */

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
});

const authed = (req) => {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') && TOKENS.has(h.slice(7));
};

const pub = (it) => ({
  id: it.id, manufacturer: it.manufacturer, description: it.description,
  mpn: it.mpn, moq: it.moq, mxq: it.mxq, unitPrice: it.unitPrice,
  partNumber: it.partNumber, leadTimeDays: it.leadTimeDays,
  availability: it.availability, exw: it.exw, isActive: it.isActive,
  attributes: it.attributes, comments: it.comments, prices: it.prices,
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  // playground
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'hubx-playground.html')));
    return;
  }

  // POST /connect/token — client_credentials -> bearer (any id/secret works
  // here; the real server checks them, the flow is identical)
  if (req.method === 'POST' && u.pathname === '/connect/token') {
    const body = await readBody(req);
    const p = new URLSearchParams(body);
    if (p.get('grant_type') !== 'client_credentials' || !p.get('client_id') || !p.get('client_secret')) {
      json(res, 400, { error: 'invalid_request', error_description: 'grant_type must be client_credentials with client_id and client_secret' });
      return;
    }
    const tok = 'sbx.' + Buffer.from(`${p.get('client_id')}.${Date.now()}`).toString('base64url');
    TOKENS.add(tok);
    json(res, 200, { expires_in: 3600, access_token: tok, token_type: 'Bearer', scope: 'customerapi' });
    return;
  }

  if (!u.pathname.startsWith('/api/')) { json(res, 404, { error: 'not found' }); return; }
  if (!authed(req)) { json(res, 401, { error: 'invalid_token', error_description: 'get a token from /connect/token first' }); return; }

  // GET /api/products — paged catalog
  if (req.method === 'GET' && u.pathname === '/api/products') {
    const pageNumber = Math.max(1, Number(u.searchParams.get('pageNumber')) || 1);
    const pageSize = Math.min(100, Number(u.searchParams.get('pageSize')) || 100);
    const onlyActive = u.searchParams.get('onlyActive') === 'true';
    const q = String(u.searchParams.get('searchQuery') || '').toLowerCase();
    let rows = CATALOG.filter(it => !onlyActive || (it.isActive && it.availability > 0));
    if (q) rows = rows.filter(it => `${it.mpn} ${it.partNumber} ${it.description}`.toLowerCase().includes(q));
    const totalCount = rows.length;
    const page = rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    json(res, 200, {
      pagination: { pageSize, pageNumber, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)), totalCount, currentPageSize: page.length },
      products: page.map(pub),
    });
    return;
  }

  // POST /api/products | /inventory | /price — ≤50-id refreshers
  if (req.method === 'POST' && /^\/api\/products(\/inventory|\/price)?$/.test(u.pathname)) {
    let ids;
    try { ids = JSON.parse(await readBody(req)); } catch { json(res, 400, { error: 'body must be a JSON string array of item ids' }); return; }
    if (!Array.isArray(ids) || ids.length > 50) { json(res, 400, { error: 'You may not exceed 50 items in this request.' }); return; }
    const rows = CATALOG.filter(it => ids.includes(it.id));
    if (u.pathname.endsWith('/inventory')) json(res, 200, rows.map(it => ({ id: it.id, availability: it.availability, moq: it.moq, mxq: it.mxq })));
    else if (u.pathname.endsWith('/price')) json(res, 200, rows.map(it => ({ id: it.id, unitPrice: it.unitPrice, prices: it.prices })));
    else json(res, 200, rows.map(pub));
    return;
  }

  // POST /api/orders/getorders — status filter + pagination
  if (req.method === 'POST' && u.pathname === '/api/orders/getorders') {
    let body = {};
    try { body = JSON.parse(await readBody(req) || '{}'); } catch { /* defaults */ }
    const status = String(body.status || '').trim();
    const pageSize = Math.max(1, Number(body.pagination && body.pagination.pageSize) || 20);
    const pageNumber = Math.max(1, Number(body.pagination && body.pagination.pageNumber) || 1);
    let rows = [...ORDERS].reverse();
    if (status) rows = rows.filter(o => o.status.toLowerCase() === status.toLowerCase());
    const totalCount = rows.length;
    const page = rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    json(res, 200, {
      orders: page,
      pagination: { pageSize, pageNumber, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)), totalCount, currentPageSize: page.length },
    });
    return;
  }

  // POST /api/orders/{orderNumber}/cancellation
  const cancel = u.pathname.match(/^\/api\/orders\/([^/]+)\/cancellation$/);
  if (req.method === 'POST' && cancel) {
    const o = ORDERS.find(x => x.hubxDocumentNumber === decodeURIComponent(cancel[1]));
    if (!o) { json(res, 409, { metadata: { errorList: [`Order Number ${cancel[1]} was not found`], errorType: '409' }, success: false }); return; }
    if (o.status !== 'Open') { json(res, 409, { metadata: { errorList: [`Order Number ${o.hubxDocumentNumber} is closed`], errorType: '409' }, success: false }); return; }
    o.status = 'Canceled';
    for (const d of o.orderDetails) { // stock returns
      const it = CATALOG.find(x => x.id === d.itemId);
      if (it) it.availability += d.quantity;
    }
    json(res, 202, { metadata: { hubxDocumentNumber: o.hubxDocumentNumber }, success: true });
    return;
  }

  // POST /api/orders — validate against LIVE stock + expected price
  if (req.method === 'POST' && u.pathname === '/api/orders') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, 400, { error: 'invalid JSON' }); return; }
    const errors = [];
    if (!String(body.purchaseOrdernumber || body.purchaseOrderNumber || '').trim()) errors.push('PurchaseOrderNumber is mandatory');
    const details = body.details || [];
    if (!details.length) errors.push('Details must contain at least one line');
    const addr = body.shippingAddress || {};
    if (!body.shippingAddressCode && !(addr.line1 && addr.city && addr.state && addr.zipCode && addr.country)) {
      errors.push('ShippingAddress must be complete when no ShippingAddressCode is given');
    }
    details.forEach((d, i) => {
      const it = CATALOG.find(x => x.id === d.vendorPartNumber);
      if (!it) { errors.push(`unknown item on line ${i + 1}`); return; }
      if (String(d.unitOfMeasure || '') !== 'Each') errors.push(`UnitOfMeasure must be "Each" on line ${i + 1}`);
      if (!(d.quantity > 0)) errors.push(`quantity must be positive on line ${i + 1}`);
      if (d.quantity > it.availability) errors.push(`not enough inventory on line ${i + 1}`);
      const tier = [...it.prices].reverse().find(t => d.quantity >= t.fromQty) || { unitPrice: it.unitPrice };
      if (Number(d.unitPrice) < tier.unitPrice) errors.push(`price changed on line ${i + 1}: expected ${tier.unitPrice}`);
      if (d.quantity < it.moq) errors.push(`below minimum order quantity (${it.moq}) on line ${i + 1}`);
    });
    if (errors.length) { json(res, 409, { metadata: { errorList: errors, errorType: '409' }, success: false }); return; }
    const doc = `HUBX-${orderSeq++}`;
    const o = {
      hubxDocumentNumber: doc,
      erpDocumentNumber: `SO-${orderSeq}`,
      cardCode: 'C-SANDBOX', contactCode: 0, salespersonCode: 0, userCode: 0,
      status: 'Open',
      comments: body.comments || '',
      terms: body.terms || 'prepay',
      billingAddressCode: body.billingAddressCode || '',
      shippingAddressCode: body.shippingAddressCode || '',
      billingAddress: body.billingAddress ? `${body.billingAddress.line1}, ${body.billingAddress.city}` : '',
      shippingAddress: addr.line1 ? `${addr.line1}, ${addr.city} ${addr.state} ${addr.zipCode}` : '',
      companyName: addr.companyName || '',
      recipientName: addr.recipientName || '',
      recipientPhoneNumber: addr.recipientPhoneNumber || '',
      shippingCost: Number(body.shippingCost) || 0,
      documentDate: new Date().toISOString(),
      shipmentInformation: null,
      orderDetails: details.map((d, i) => {
        const it = CATALOG.find(x => x.id === d.vendorPartNumber);
        it.availability -= d.quantity;
        return {
          id: `L-${doc}-${i + 1}`, lineNum: i + 1, itemId: it.id, hubxItemCode: it.partNumber,
          itemDescription: it.description, quantity: d.quantity, price: Number(d.unitPrice),
          warranty: '30 days', condition: 'New', leadTimeDays: it.leadTimeDays,
          serialNumbers: [], buyerPartNumber: d.buyerPartNumber || '',
        };
      }),
      txnId: `T-${Date.now()}`, customerId: 'SANDBOX',
      externalReference: String(body.purchaseOrdernumber || body.purchaseOrderNumber),
      id: `O-${doc}`, version: '1',
    };
    ORDERS.push(o);
    progressOrder(o);
    json(res, 202, { metadata: { hubxDocumentNumber: doc }, success: true, orderStatus: 'Accepted' });
    return;
  }

  // sandbox-only helper (not part of the HUBX API): write the Walmart bulk
  // sheet the playground builds straight into Downloads
  if (req.method === 'POST' && u.pathname === '/sandbox/export-walmart') {
    let rows;
    try { rows = JSON.parse(await readBody(req)); } catch { json(res, 400, { error: 'bad body' }); return; }
    if (!Array.isArray(rows) || !rows.length) { json(res, 400, { error: 'nothing selected' }); return; }
    const q = (v) => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
    const csv = [
      ['SKU', 'Product Name', 'Brand', 'MPN', 'Product ID Type', 'Product ID', 'Price', 'Quantity', 'Condition'].join(','),
      ...rows.map(r => [r.sku, r.name, r.brand, r.mpn, r.idType || '', r.id || '', r.price, r.qty, 'New'].map(q).join(',')),
    ].join('\n') + '\n';
    const file = path.join(require('os').homedir(), 'Downloads',
      `Walmart-from-HUBX-${new Date().toISOString().slice(5, 10).replace('-', '')}.csv`);
    fs.writeFileSync(file, '﻿' + csv, 'utf8');
    json(res, 200, { ok: true, path: file, rows: rows.length });
    return;
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`HUBX sandbox up: http://localhost:${PORT}`);
  console.log('Auth: POST /connect/token (any client_id/client_secret works here)');
});
