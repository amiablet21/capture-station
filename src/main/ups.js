'use strict';
// UPS REST APIs for the Ship tab (owner 2026-10-19): rates from both
// companies' UPS accounts side by side, then one label on the account picked.
// Endpoints and shapes per UPS's published OpenAPI specs
// (github.com/UPS-API/api-documentation: OAuthClientCredentials, Rating,
// Shipping — version v2409). Each account is its own UPS developer app:
// client ID + secret for the OAuth token, the 6-character shipper number
// for billing and negotiated rates.

const crypto = require('node:crypto');

const HOSTS = { live: 'https://onlinetools.ups.com', test: 'https://wwwcie.ups.com' };
const VERSION = 'v2409';

// the domestic services a packing station actually buys; anything else UPS
// offers still shows, by its code
const SERVICE_NAMES = {
  '01': 'UPS Next Day Air',
  '02': 'UPS 2nd Day Air',
  '03': 'UPS Ground',
  '12': 'UPS 3 Day Select',
  '13': 'UPS Next Day Air Saver',
  '14': 'UPS Next Day Air Early',
  '59': 'UPS 2nd Day Air A.M.',
  '75': 'UPS Heavy Goods',
  '92': 'UPS SurePost Less than 1 lb',
  '93': 'UPS Ground Saver',
};
// services the owner never ships with (2026-10-19): UPS Ground Saver and the
// SurePost family it replaced never appear among the rates
const EXCLUDED_CODES = new Set(['92', '93']);
// fallback transit days when UPS sends no estimate (Ground is zone-based)
const SERVICE_DAYS = { '01': 1, '13': 1, '14': 1, '02': 2, '59': 2, '12': 3, '03': 5 };

const STATES = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT',
  DELAWARE: 'DE', 'DISTRICT OF COLUMBIA': 'DC', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL',
  INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
  MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT',
  NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY',
  'PUERTO RICO': 'PR', GUAM: 'GU', 'VIRGIN ISLANDS': 'VI',
};

class UpsError extends Error {}

// "New Jersey" / "nj" / "N.J." -> "NJ"; anything unrecognised is passed on
// as typed so UPS can say what is wrong with it
function stateCode(s) {
  const t = String(s || '').trim().toUpperCase().replace(/\./g, '');
  if (/^[A-Z]{2}$/.test(t)) return t;
  return STATES[t] || t;
}

function zip(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length > 5 ? d.slice(0, 9) : d;
}

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const phoneDigits = (s) => String(s || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '').slice(0, 15);

// what a party needs before UPS will take it; '' = good to go
function addressProblem(a) {
  if (!a) return 'No address';
  if (!clip(a.name, 35) && !clip(a.company, 35)) return 'Name is missing';
  if (!clip(a.line1, 35)) return 'Street is missing';
  if (!clip(a.city, 30)) return 'City is missing';
  if (!/^[A-Z]{2}$/.test(stateCode(a.state))) return 'State should be two letters (NJ)';
  if (!/^\d{5}(\d{4})?$/.test(zip(a.zip))) return 'ZIP should be 5 digits';
  return '';
}

// a party in UPS's shape. The person goes on Name with the company as
// AttentionName's counterpart — UPS prints Name big, so a business address
// reads "Company / Attn: person"
function party(a, { phoneFallback = '', residential = false } = {}) {
  const company = clip(a.company, 35);
  const person = clip(a.name, 35);
  const out = {
    Name: company || person,
    AttentionName: person || company,
    Address: {
      AddressLine: [clip(a.line1, 35), clip(a.line2, 35)].filter(Boolean),
      City: clip(a.city, 30),
      StateProvinceCode: stateCode(a.state),
      PostalCode: zip(a.zip),
      CountryCode: 'US',
    },
  };
  const ph = phoneDigits(a.phone) || phoneDigits(phoneFallback);
  if (ph.length >= 10) out.Phone = { Number: ph };
  if (residential) out.Address.ResidentialAddressIndicator = '';
  return out;
}

// a business name on the address means a commercial delivery; a bare person
// is a home (residential rates and surcharges apply)
const isResidential = (a) => !clip(a && a.company, 35);

function weightLb(w) {
  const n = Math.round((Number(w) || 0) * 10) / 10;
  return String(Math.max(0.1, n));
}

function pkgDims(p) {
  const l = Math.round(Number(p.length) || 0);
  const w = Math.round(Number(p.width) || 0);
  const h = Math.round(Number(p.height) || 0);
  if (!(l > 0 && w > 0 && h > 0)) return null;
  return { UnitOfMeasurement: { Code: 'IN' }, Length: String(l), Width: String(w), Height: String(h) };
}

function declaredValue(v) {
  const n = Math.round((Number(v) || 0) * 100) / 100;
  return n > 0 ? { DeclaredValue: { CurrencyCode: 'USD', MonetaryValue: n.toFixed(2) } } : null;
}

// who is where on a label. Ship: our ship-from -> the customer. Return: the
// customer -> our return address, on a UPS Print Return Label. The Shipper
// is always us (the paying account at our warehouse address).
function legs({ kind, shipFrom, returnTo, other }) {
  if (kind === 'return') {
    return {
      shipper: shipFrom,
      from: party(other, { phoneFallback: shipFrom.phone }),
      to: party(returnTo, { phoneFallback: shipFrom.phone }),
    };
  }
  return {
    shipper: shipFrom,
    from: party(shipFrom),
    to: party(other, { residential: isResidential(other) }),
  };
}

function shipperOf(account, shipFrom) {
  const p = party(shipFrom);
  return { ...p, ShipperNumber: clip(account.accountNumber, 10).toUpperCase() };
}

function yyyymmdd(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function buildRateRequest({ account, kind, shipFrom, returnTo, other, pkg, value }) {
  const { from, to } = legs({ kind, shipFrom, returnTo, other });
  const p = {
    PackagingType: { Code: '02' },
    PackageWeight: { UnitOfMeasurement: { Code: 'LBS' }, Weight: weightLb(pkg.weight) },
  };
  const dims = pkgDims(pkg);
  if (dims) p.Dimensions = dims;
  const dv = declaredValue(value);
  if (dv) p.PackageServiceOptions = dv;
  return {
    RateRequest: {
      Request: { TransactionReference: { CustomerContext: 'DWS Stock rates' } },
      Shipment: {
        Shipper: shipperOf(account, shipFrom),
        ShipFrom: from,
        ShipTo: to,
        PaymentDetails: { ShipmentCharge: [{ Type: '01', BillShipper: { AccountNumber: clip(account.accountNumber, 10).toUpperCase() } }] },
        ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
        NumOfPieces: '1',
        Package: [p],
        DeliveryTimeInformation: { PackageBillType: '03', Pickup: { Date: yyyymmdd() } },
      },
    },
  };
}

// the label's description is ALWAYS generic: no product name, model or SKU
// ever prints on a label (owner 2026-10-19)
const LABEL_DESC = { ship: 'Merchandise', return: 'Merchandise return' };

function buildShipRequest({ account, kind, shipFrom, returnTo, other, pkg, value, serviceCode, reference }) {
  const { from, to } = legs({ kind, shipFrom, returnTo, other });
  const p = {
    Packaging: { Code: '02' },
    PackageWeight: { UnitOfMeasurement: { Code: 'LBS' }, Weight: weightLb(pkg.weight) },
  };
  const dims = pkgDims(pkg);
  if (dims) p.Dimensions = dims;
  const dv = declaredValue(value);
  if (dv) p.PackageServiceOptions = dv;
  // Ref 1 prints on the label (the PO#); package-level is the one valid
  // for US-to-US shipments
  const ref = clip(reference, 35);
  if (ref) p.ReferenceNumber = [{ Value: ref }];
  const shipment = {
    Description: kind === 'return' ? LABEL_DESC.return : LABEL_DESC.ship,
    Shipper: shipperOf(account, shipFrom),
    ShipFrom: from,
    ShipTo: to,
    PaymentInformation: { ShipmentCharge: [{ Type: '01', BillShipper: { AccountNumber: clip(account.accountNumber, 10).toUpperCase() } }] },
    ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
    Service: { Code: String(serviceCode) },
    Package: [p],
  };
  if (kind === 'return') {
    // 9 = UPS Print Return Label: we print it, the customer drops it off.
    // UPS requires a description of a return package (it prints as DESC)
    shipment.ReturnService = { Code: '9' };
    p.Description = LABEL_DESC.return;
  }
  return {
    ShipmentRequest: {
      Request: { RequestOption: 'nonvalidate', TransactionReference: { CustomerContext: clip(reference, 35) || 'DWS Stock' } },
      Shipment: shipment,
      LabelSpecification: { LabelImageFormat: { Code: 'GIF' }, HTTPUserAgent: 'Mozilla/4.5' },
    },
  };
}

// v2409 always returns arrays for repeating containers, but older shapes
// sent a lone object — accept both
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const money = (m) => {
  const n = Number(m && m.MonetaryValue);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

function parseRates(body) {
  const out = [];
  for (const r of arr(body && body.RateResponse && body.RateResponse.RatedShipment)) {
    const code = String((r.Service && r.Service.Code) || '');
    if (EXCLUDED_CODES.has(code)) continue;
    const list = money(r.TotalCharges);
    const negotiated = money(r.NegotiatedRateCharges && r.NegotiatedRateCharges.TotalCharge);
    const tt = r.TimeInTransit && r.TimeInTransit.ServiceSummary;
    const est = tt && tt.EstimatedArrival;
    const arrival = est && est.Arrival && /^\d{8}$/.test(String(est.Arrival.Date || '')) ? String(est.Arrival.Date) : '';
    const days = Number((est && est.BusinessDaysInTransit) || (r.GuaranteedDelivery && r.GuaranteedDelivery.BusinessDaysInTransit)) || SERVICE_DAYS[code] || null;
    out.push({
      code,
      name: SERVICE_NAMES[code] || `UPS service ${code}`,
      // the account's own (negotiated) price is what it actually pays
      price: negotiated ?? list,
      listPrice: list,
      arrival: arrival ? `${arrival.slice(0, 4)}-${arrival.slice(4, 6)}-${arrival.slice(6, 8)}` : '',
      days,
    });
  }
  return out.filter(r => r.price !== null).sort((a, b) => a.price - b.price);
}

function parseShip(body) {
  const res = body && body.ShipmentResponse && body.ShipmentResponse.ShipmentResults;
  if (!res) throw new UpsError('UPS sent back no shipment.');
  const pkg = arr(res.PackageResults)[0] || {};
  const label = pkg.ShippingLabel || {};
  const charge = money(res.NegotiatedRateCharges && res.NegotiatedRateCharges.TotalCharge)
    ?? money(res.ShipmentCharges && res.ShipmentCharges.TotalCharges);
  return {
    shipmentId: String(res.ShipmentIdentificationNumber || ''),
    tracking: String(pkg.TrackingNumber || res.ShipmentIdentificationNumber || ''),
    labelGif: String(label.GraphicImage || ''),
    charge,
  };
}

function errorText(body, status) {
  const errs = arr(body && body.response && body.response.errors);
  if (errs.length) return errs.map(e => String(e.message || e.code || '').trim()).filter(Boolean).join(' · ');
  if (body && body.error_description) return String(body.error_description);
  return `UPS answered ${status}`;
}

class UpsClient {
  // host: only the automated tests point the client at a fake UPS
  constructor(account, { test = false, host = '' } = {}) {
    this.account = account || {};
    this.host = host || UpsClient.testHost || (test ? HOSTS.test : HOSTS.live);
  }

  // one token per host + credentials, cached for the app session (a
  // changed secret or account number must never ride an older token)
  tokenKey() {
    const { clientId, clientSecret, accountNumber } = this.account;
    const h = crypto.createHash('sha256').update(`${clientId}|${clientSecret}|${String(accountNumber).toUpperCase()}`).digest('hex');
    return `${this.host}|${h}`;
  }

  // tokens last hours
  async token() {
    const { clientId, clientSecret, accountNumber } = this.account;
    if (!clientId || !clientSecret) throw new UpsError('Client ID and secret are not set (Settings › UPS labels).');
    if (!accountNumber) throw new UpsError('UPS account number is not set (Settings › UPS labels).');
    const key = this.tokenKey();
    const hit = UpsClient.tokens.get(key);
    if (hit && hit.until > Date.now() + 60000) return hit.token;
    const res = await fetch(`${this.host}/security/v1/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-merchant-id': String(accountNumber).toUpperCase(),
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.access_token) {
      throw new UpsError(res.status === 401 ? 'UPS did not accept the client ID / secret.' : errorText(body, res.status));
    }
    const ttl = Math.max(300, Number(body.expires_in) || 3600) * 1000;
    UpsClient.tokens.set(key, { token: body.access_token, until: Date.now() + ttl });
    return body.access_token;
  }

  async call(method, pathname, payload, retried = false) {
    const token = await this.token();
    const res = await fetch(`${this.host}/api${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        transId: crypto.randomUUID().replace(/-/g, ''),
        transactionSrc: 'DWSStock',
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(45000),
    });
    const body = await res.json().catch(() => null);
    if (res.status === 401 && !retried) {
      UpsClient.tokens.delete(this.tokenKey());
      return this.call(method, pathname, payload, true);
    }
    if (!res.ok) throw new UpsError(errorText(body, res.status));
    return body;
  }

  async rates(input) {
    const body = await this.call('POST', `/rating/${VERSION}/Shoptimeintransit`, buildRateRequest({ ...input, account: this.account }));
    return parseRates(body);
  }

  async ship(input) {
    const body = await this.call('POST', `/shipments/${VERSION}/ship`, buildShipRequest({ ...input, account: this.account }));
    return parseShip(body);
  }

  async void(shipmentId) {
    const id = encodeURIComponent(String(shipmentId || '').trim().toUpperCase());
    const body = await this.call('DELETE', `/shipments/${VERSION}/void/cancel/${id}`);
    const st = body && body.VoidShipmentResponse && body.VoidShipmentResponse.SummaryResult
      && body.VoidShipmentResponse.SummaryResult.Status;
    if (st && String(st.Code) !== '1') throw new UpsError(String(st.Description || 'UPS did not void the label.'));
    return true;
  }
}
UpsClient.tokens = new Map();
UpsClient.testHost = ''; // the e2e suite's fake UPS

// a label image's own pixel size and type: UPS sends a GIF lying on its
// side (print and preview turn it upright when wide), Walmart a PNG
function imageInfo(b64) {
  try {
    const b = Buffer.from(String(b64 || '').slice(0, 44), 'base64');
    if (b.toString('ascii', 0, 3) === 'GIF') return { type: 'gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    if (b.length >= 24 && b.readUInt32BE(0) === 0x89504E47) return { type: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    return null;
  } catch {
    return null;
  }
}
const gifSize = (b64) => { const i = imageInfo(b64); return i ? { width: i.width, height: i.height } : null; };

module.exports = {
  UpsClient, UpsError, SERVICE_NAMES, stateCode, zip, addressProblem, isResidential,
  buildRateRequest, buildShipRequest, parseRates, parseShip, gifSize, imageInfo,
};
