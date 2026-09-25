# Ship with Walmart via API — study and integration design

Status 2026-09-25: **implemented** in v1.29.0 as `src/main/walmart.js` (API
client) + `src/main/sww.js` (quotes, buy, bulk, void, print), `labels` and
`package_profiles` tables in `db.js`, the `sww` config block, the quote chip
and buy dialogs on the Capture page, and Settings > Ship with Walmart. The
headless smoke test used during the build lives outside the repo; the
first live order (dry run off, one label) is still the acceptance test.

Date: 2026-09-25 (schemas verified against developer.walmart.com the same
day). Question: can Capture Station buy Ship with Walmart (SWW) labels
through the Walmart Marketplace API instead of the packer printing each
label by hand in Seller Center, and how would that fit into the app?

Short answer: **yes**. SWW is a public part of the Marketplace API
(`/v3/shipping/labels/...`). Any seller with API keys can call it; no
solution-provider status is needed. The app already knows every open
Walmart PO (via Linnworks) and already validates carrier tracking, so a
"Buy label" step slots in between "order lands in the queue" and "tracking
is captured".

Still unverified (Marketplace Learn pages are login-gated): whether a label
purchase alone flips the PO to Shipped. Walmart's seller guide says "you
won't be charged until the item is marked as Shipped" and that cancelling
an unused label is free, which strongly implies purchase and ship are
separate steps. The design treats them as separate and confirms on the
first live order.

---

## 1. The SWW API (verified)

Base URL `https://marketplace.walmartapis.com` (sandbox:
`https://sandbox.walmartapis.com`). Carriers for US domestic: **USPS and
FedEx**. UPS is not offered through SWW. Yanwen (China to US) is paused.

Every call carries `WM_SEC.ACCESS_TOKEN`, `WM_QOS.CORRELATION_ID` (any
UUID), `WM_SVC.NAME` (any string, e.g. `Capture Station`) and `Accept`.

### Token

`POST /v3/token`, `Authorization: Basic base64(clientId:clientSecret)`,
`Content-Type: application/x-www-form-urlencoded`, body
`grant_type=client_credentials`. Response `{ access_token, token_type:
"Bearer", expires_in: 900 }`. Cache for 14 minutes, refresh on 401.

### Endpoints

| Step | Method + path | Notes |
|---|---|---|
| Carriers | `GET /v3/shipping/labels/carriers` | `{ carriers: [{ carrierId, shortName, carrierName }] }`. `shortName` is what every other call wants. |
| Package types | `GET /v3/shipping/labels/carriers/{shortName}/package-types` (or `ALL`) | `{ data: [{ id, packageTypeShortName, packageTypeDisplayName, length, width, height, dimensionUnit }] }`. `CUSTOM_PACKAGE` is the normal one. |
| Estimates | `POST /v3/shipping/labels/shipping-estimates` | Body below. Returns every service with price and delivery date. |
| Create label | `POST /v3/shipping/labels` | Body below. `Accept: application/json,application/pdf` returns the PDF, `application/json,image/png` a PNG, `application/json` JSON only. |
| Download label | `GET /v3/shipping/labels/carriers/{shortName}/trackings/{trackingNo}` | `Accept: application/pdf` or `image/png`, raw bytes in the body. |
| Label details by PO | `GET /v3/shipping/labels/purchase-orders/{purchaseOrderId}` | `{ data: [ { purchaseOrderId, trackingNo, boxItems, carrierName, carrierServiceType, trackingUrl, addOns } ] }`. |
| Discard label | `DELETE /v3/shipping/labels/carriers/{shortName}/trackings/{trackingNo}` | `{ data: "true" }`. Free while the order is not yet marked shipped. |

### Estimates request

```json
{
  "purchaseOrderId": "108812345678901",
  "packageType": "CUSTOM_PACKAGE",
  "boxDimensions": { "boxWeight": 1.2, "boxWeightUnit": "LB",
                     "boxLength": 10, "boxWidth": 8, "boxHeight": 4, "boxDimensionUnit": "IN" },
  "boxItems": [ { "lineNumber": "1", "sku": "CHANNEL-SKU", "quantity": 1 } ],
  "fromAddress": { "addressLines": ["..."], "city": "...", "state": "XX", "postalCode": "...", "countryCode": "US" },
  "toAddress":   { "addressLines": ["..."], "city": "...", "state": "XX", "postalCode": "...", "countryCode": "US" },
  "carriers": ["USPS", "FedEx"],
  "shipByDate": "2026-09-26T08:00:00Z",
  "deliverByDate": "2026-09-30T23:00:00Z",
  "includeServicesNotMeetingDeliveryPromise": true,
  "addOns": false
}
```

Response `data.estimates[]`: `name` (the value to send as
`carrierServiceType`, e.g. `FEDEX_GROUND`, `USPS_PRIORITY`), `displayName`,
`carrierName`, `deliveryDate`, `estimatedRate { amount, currency }`,
`isDeliveryPromiseFulfilled`, optional `addOns[]` (INSURANCE, SIGNATURE
with `charge`). `data.alertMessage` warns when nothing meets the promise.

Weight units: `LB`, `KG`, `OZ`. Dimension units: `IN`, `FT`, `CM`.

### Create label request

```json
{
  "purchaseOrderId": "108812345678901",
  "packageType": "CUSTOM_PACKAGE",
  "boxDimensions": { "boxWeight": 1.2, "boxWeightUnit": "LB",
                     "boxLength": 10, "boxWidth": 8, "boxHeight": 4, "boxDimensionUnit": "IN" },
  "boxItems": [ { "lineNumber": "1", "sku": "CHANNEL-SKU", "quantity": 1 } ],
  "fromAddress": { "contactName": "...", "companyName": "...", "addressLine1": "...", "addressLine2": "",
                   "city": "...", "state": "XX", "postalCode": "...", "country": "US",
                   "phone": "...", "email": "..." },
  "carrierName": "FedEx",
  "carrierServiceType": "FEDEX_GROUND",
  "shipOnDate": "2026-09-26",
  "addOns": ["SIGNATURE"]
}
```

Required: `purchaseOrderId`, `packageType`, `boxDimensions`
(`boxWeight`, `boxWeightUnit`; L/W/H + unit for `CUSTOM_PACKAGE`),
`boxItems[]` (`lineNumber`, `sku`, `quantity`), `fromAddress`
(`contactName`, `addressLine1`, `city`, `state`, `postalCode`, `country`,
`phone`), `carrierName` (carrier `shortName`), `carrierServiceType`
(estimate `name`). Optional: `addOns` (`SIGNATURE`, `INSURANCE`),
`shipOnDate` (yyyy-MM-dd), `hazmat`, `hasBattery`, `accountType: "OWN"`
for bring-your-own-account.

Response `data`: `purchaseOrderId`, `trackingNo`, `trackingUrl`,
`boxItems`, `carrierName`, `carrierFullName`, `carrierServiceType`
(display form, e.g. "FedEx 2Day"), `addOns[]` with charges. With a PDF
`Accept` the body is the label file; store the tracking from the JSON
part or fetch it right after via label details by PO.

Note the two address shapes differ: estimates use `addressLines[]` +
`countryCode`, create label uses `addressLine1/2` + `country`.

Errors come back as `errors[] { code, description, field, severity,
category, httpStatus, info }`.

### Order data the label call needs

`boxItems.lineNumber` is Walmart's own PO line number. Linnworks does not
carry it, so the module reads the PO from Walmart first:

`GET /v3/orders/{purchaseOrderId}` → `order.shippingInfo { methodCode,
estimatedShipDate, estimatedDeliveryDate, postalAddress { name, address1,
address2, city, state, postalCode, country } }` and
`order.orderLines.orderLine[] { lineNumber, item.sku, orderLineQuantity
{ amount }, orderLineStatuses[].status }` (Created, Acknowledged, Shipped,
Delivered, Cancelled). This also gives the to-address for estimates and the
dates for `shipByDate`/`deliverByDate`, so nothing has to be typed.

### Marking the order shipped

`POST /v3/orders/{purchaseOrderId}/shipping` with
`orderShipment.orderLines.orderLine[] { lineNumber, sellerOrderId,
orderLineStatuses.orderLineStatus[] { status: "Shipped", statusQuantity
{ unitOfMeasurement: "EACH", amount }, trackingInfo { shipDateTime (epoch
ms), carrierName { carrier: "FedEx" | "USPS" }, methodCode, trackingNumber,
trackingURL } } }`. Today Linnworks does this when the row is Processed.
Keep that as the single owner unless the first live test shows a gap.

### Shipment Protection API

`/v3/claims/shipment-protection/...` (file claim, list open, get, history,
documents). Only SWW labels are covered. Pairs naturally with the existing
`claims.js` later.

## 2. How it compares to today

Today: the queue row appears from Linnworks open orders, the packer clicks
the PO# to open Seller Center in the pane, buys the label there, prints it,
scans the barcode into the row, and Process pushes tracking to Linnworks
(which notifies Walmart).

With the API: the queue row appears, the packer (or the app, in bulk) buys
the label, it prints, and the row is filled with the returned tracking with
no scan. Process runs as today. Seller Center is never opened for a Walmart
order.

Gains: no manual label flow, no scan step, exact tracking, label cost
stored per PO, bulk purchase for the day's Walmart queue in one click.

Stays manual: eBay and Temu labels (out of scope), Walmart orders that need
UPS or an unusual package (bulk skips them and leaves the row for the
manual flow).

## 3. Prerequisites

1. **Walmart API keys.** Seller Center → API Integration
   (https://seller.walmart.com/api-key) → API Key Management → Developer
   Portal. Use the personal key pair (lock icon): Client ID + Client
   Secret. Give it Shipping and Orders access.
2. **SWW enabled** on the seller account (already, since labels are bought
   in Seller Center today). Labels bill through Walmart payments as now;
   the SWW Carrier Reconciliation Report shows final charges.
3. **Ship-from address** with contact name and phone (required fields).
4. **Package profiles**: weight + dims per SKU. Linnworks inventory carries
   weight/height/width/depth, so default from there and allow overrides.
5. **A label printer path** (§5).

## 4. Integration design: a `sww` module

Follow the existing pattern: one main-process module per external system
(`linnworks.js`, `shipfile.js`, `claims.js`), IPC handlers in `main.js`,
config in `config.js`, tables in `db.js`, UI in `renderer.js`.

### 4.1 `src/main/walmart.js` — API client

```
class WalmartClient {
  constructor({ clientId, clientSecret, sandbox })
  async auth()                               // POST /v3/token, cache 14 min
  async call(method, path, { body, accept }) // headers, one retry on 401,
                                             // throws { status, errors }
  getOrder(poId)                             // GET /v3/orders/{po}
  carriers()
  packageTypes(shortName = 'ALL')
  estimates(body)
  createLabel(body, format = 'pdf')          // returns { json, file: Buffer }
  downloadLabel(shortName, trackingNo, format)
  labelsByPo(poId)
  discardLabel(shortName, trackingNo)
  shipOrder(poId, lines)                     // POST /v3/orders/{po}/shipping
  testConnection()                           // carriers() is enough
}
```

Node's built-in `fetch`, no new dependency, same style as `linnworks.js`.
`sandbox: true` swaps the base URL so the whole flow can be exercised
without buying anything.

### 4.2 `src/main/sww.js` — orchestration

Mirrors `sync.js`: plan → (dry run or write) → log.

```
prepare(rowId)
  row must be channel 'walmart', no tracking, status pending, not WFS,
  not dropship-routed.
  po = client.getOrder(row.order_number)
    -> lines (lineNumber, sku, qty), to-address, methodCode, dates
    -> refuse if any line is already Shipped/Cancelled
  package = profile(sku) || linnworksDims(sku) || config.defaultPackage
  rates = client.estimates({...})   // sorted by amount
  pick = rule 'cheapest' | 'cheapest meeting promise' | fixed service
  return { po, package, rates, pick }

buyLabel({ rowId, service, package, dryRun })
  p = prepare(rowId) (or the edited values from the dialog)
  if dryRun: log the plan, return
  label = client.createLabel({...}, 'pdf')
  write PDF to Documents\Capture Station\labels\<po>-<tracking>.pdf
  db.insertLabel({ row_id, po, carrier, service, tracking, cost_cents,
                   package, file_path, status: 'bought' })
  rows.update(tracking = label.trackingNo, carrier)   // same path a scan
      takes, so duplicate/format guards, CSV mirror and green status hold
  print (§5)
  if config.sww.markShippedOnLabel: client.shipOrder(...)  // default off

buyLabelsBulk({ ids })   sequential, short delay, back off on 429,
                          per-row results in the footer like Sync
voidLabel({ rowId })      client.discardLabel; labels.status='voided';
                          clear row tracking via the existing undo path;
                          refuse if the row is already processed
reprint({ rowId })        print the stored PDF, never re-call the API
```

Dry run defaults ON, exactly like Linnworks sync, since every live
create-label call spends money.

### 4.3 `db.js` — new tables

```
CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  row_id INTEGER NOT NULL,
  po TEXT NOT NULL,
  carrier TEXT NOT NULL,        -- shortName
  service TEXT NOT NULL,        -- carrierServiceType name
  tracking TEXT NOT NULL,
  cost_cents INTEGER,
  package TEXT NOT NULL,        -- json: type, weight, dims
  file_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,         -- bought | printed | voided | failed
  created_at TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_labels_row ON labels(row_id);
CREATE TABLE IF NOT EXISTS package_profiles (
  sku TEXT PRIMARY KEY, weight_oz REAL, l_in REAL, w_in REAL, h_in REAL,
  package_type TEXT NOT NULL DEFAULT 'CUSTOM_PACKAGE'
);
```

Plus a daily `labels.csv` mirror next to the capture CSV.

### 4.4 `config.js`

```
sww: {
  enabled: false,
  dryRun: true,
  sandbox: false,
  clientId: '', clientSecret: '',      // encrypted like linnworks -> swwEnc
  fromAddress: { contactName, companyName, addressLine1, addressLine2,
                 city, state, postalCode, country: 'US', phone, email },
  defaultPackage: { type: 'CUSTOM_PACKAGE', weightOz: 16, l: 10, w: 8, h: 4 },
  serviceRule: 'cheapest',              // 'cheapest' | 'cheapest-on-time' | '<service name>'
  carriers: ['USPS', 'FedEx'],
  printer: '',                          // '' = OS default
  autoPrint: true,
  markShippedOnLabel: false,
}
```

Extend `encryptCreds`/`decryptCreds` to cover `sww` the way `linnworksEnc`
works. Capture-only stations ignore the section entirely, the same rule
the Linnworks credentials follow.

### 4.5 IPC handlers (`main.js`) and `preload.js` bridges

`sww:test`, `sww:prepare` (rowId → package + rates + pick), `sww:buy`,
`sww:buyBulk`, `sww:void`, `sww:reprint`, `sww:labels` (date range),
`sww:profileGet`, `sww:profileSet`.

### 4.6 Renderer

- **Row action** on pending Walmart rows: a "Label" button beside the
  inline tracking box. Opens a small dialog: package (profile pre-filled,
  editable), rate list from `sww:prepare` with the rule's pick highlighted,
  signature toggle, Buy. On success the row goes green with the tracking,
  the label prints, a toast shows carrier + cost.
- **Bulk**: with the Walmart chip active, "Buy labels" runs `sww:buyBulk`
  on every eligible pending row using its profile/default package. Skipped
  rows are listed in the footer for the manual flow.
- **Void** in the Edit dialog while the row is unsynced.
- **Settings > Ship with Walmart**: keys, Test connection, from address,
  default package, service rule, printer, dry run, sandbox, auto-print,
  mark-shipped toggle.
- **Labels log**: History filter or small tab: date, PO, carrier, service,
  tracking, cost, reprint.

### 4.7 Where it sits in the flow

```
Linnworks open orders ──► queue row (pending)
                              │
                 [Label]/[Buy labels] ──► sww.prepare ──► Walmart: GET order, estimates
                              │                              │
                              │                     sww.buyLabel ──► POST create label
                              │◄── tracking + PDF ───────────┘
                              ▼
                 row.tracking set (same path as a scan) ──► print label
                              │
                          Process ──► Linnworks: set tracking, despatch
                                            └──► Walmart gets Shipped + tracking
```

## 5. Printing

The pane's `browser:print` prints a web page, not a file. Options for the
4x6 label PDF:

1. **Silent PDF print through a helper**: bundle SumatraPDF (portable,
   ~10 MB, GPL) or the `pdf-to-printer` npm package which wraps it, and
   run `-print-to "<printer>" -silent`. Works with any thermal printer's
   Windows driver. The usual Electron answer.
2. **PNG label** (`Accept: image/png`) in a hidden BrowserWindow and
   `webContents.print({ silent: true, deviceName })` at 4x6 page size.
   Reliable, but barcode quality depends on DPI; test the scanner on it.
3. **Hidden BrowserWindow loading the PDF** and printing. Chromium's PDF
   viewer makes this flaky. Not recommended.

Go with option 1; keep the PDF on disk so reprint never re-calls the API.

## 6. Rollout plan

1. **Spike (half a day)**: create the API key, write `walmart.js`, run
   `carriers`, `packageTypes('ALL')`, `getOrder` on a real PO and one
   `estimates` call from `tools/` (like `tools/hubx-sandbox.js`). Then one
   sandbox `createLabel`.
2. **v1**: single-row Label dialog, dry run on, PDF to disk, manual print
   from the toast. One real order end to end; after Process, check in
   Seller Center whether the PO shows Shipped with the SWW tracking. That
   settles the "does purchase auto-ship" question and whether
   `markShippedOnLabel` is ever needed.
3. **v2**: silent print, bulk buy, void, labels log/CSV, package profiles.
4. **v3 (optional)**: auto-buy on row arrival for SKUs with a profile, and
   Shipment Protection claims from `claims.js`.

## 7. Risks and open points

- **Rates**: SWW is discounted but not always cheaper than a seller's own
  account. Keep the estimate step visible so the price is seen before Buy.
- **No UPS**: orders that go UPS today move to USPS/FedEx or stay manual.
- **Multi-box orders**: one box per create-label call; v1 does one box per
  PO and leaves the rest manual.
- **Double shipping update**: if both Linnworks and the app notify Walmart
  the second is a no-op within Walmart's 24-hour tracking edit window.
  Still keep one owner (Linnworks by default).
- **Rate limits**: Walmart throttles per endpoint; bulk buy runs
  sequentially and backs off on HTTP 429.
- **Voiding**: free while the order is not marked shipped, so void before
  Process, and void before re-buying for a repack.
- **Charges**: the seller guide says the label is charged when the order is
  marked Shipped, and a cancelled label that was still used is charged.
  Final amounts appear in the SWW Carrier Reconciliation Report.

## Sources

- Ship with Walmart overview: https://developer.walmart.com/us-marketplace/docs/buy-shipping
- Create label: https://developer.walmart.com/us-marketplace/reference/createlabel
- Shipping estimates: https://developer.walmart.com/us-marketplace/reference/getshippingestimate
- Supported carriers: https://developer.walmart.com/us-marketplace/reference/getcarriers
- Package types: https://developer.walmart.com/us-marketplace/reference/getcarrierpackagetypes
- Download label: https://developer.walmart.com/us-marketplace/reference/getlabelbytrackingandcarrier
- Label details by PO: https://developer.walmart.com/us-marketplace/docs/label-details-by-purchase-order-id
- Discard label: https://developer.walmart.com/us-marketplace/docs/discard-label
- Token API: https://developer.walmart.com/us-marketplace/reference/tokenapi
- Get an order: https://developer.walmart.com/us-marketplace/reference/getanorder
- Shipping updates: https://developer.walmart.com/us-marketplace/reference/shippingupdates
- Shipment Protection API: https://developer.walmart.com/us-marketplace/docs/shipment-protection-api-overview
- API keys: https://developer.walmart.com/us-marketplace/docs/get-started-as-a-seller
- Seller guides (login-gated): https://marketplacelearn.walmart.com/guides/Shipping%20&%20fulfillment/Ship%20with%20Walmart%20U.S.%20domestic/buy-shipping-labels-in-seller-center
