# Ship with Walmart via API — study and integration design

Date: 2026-09-25. Question: can Capture Station buy Ship with Walmart (SWW)
labels through the Walmart Marketplace API instead of the packer printing
each label by hand in Seller Center, and how would that fit into the app?

Short answer: **yes**. Walmart exposes SWW as a public part of the
Marketplace API (`/v3/shipping/labels/...`). Any seller with API keys can
call it; no solution-provider status is needed. The app already knows every
open Walmart PO (via Linnworks) and already validates carrier tracking, so a
"Buy label" step slots in between "order lands in the queue" and "tracking
is captured".

Note on sources: developer.walmart.com is blocked from the environment this
study ran in, so field-level details below come from Walmart's own page
summaries in search results, the MX/CA variants of the same API mirrored in
the highsidelabs `walmart-api-php` SDK, and integrator docs (Easyship,
ShippingEasy, GeekSeller). The US request body must be confirmed against
the live reference before coding (links at the bottom). Anything marked
**verify** is exactly that.

---

## 1. What the SWW API offers

Base URL `https://marketplace.walmartapis.com`. All calls need the standard
Marketplace headers (see §3). Carriers for US domestic: **USPS and FedEx**
(FedEx only for international). UPS is not offered through SWW.

| Step | Method + path | Purpose |
|---|---|---|
| 1 | `GET /v3/shipping/labels/carriers` | Carriers SWW supports (returns `carrierId`, `shortName`, `carrierName`). |
| 2 | `GET /v3/shipping/labels/carriers/{carrierShortName}/package-types` | Package types per carrier, or `ALL`. Returns `packageTypeShortName`, display name, dims. |
| 3 | `.../v3/shipping/labels/shipping-estimates` | Cheapest rates for the shipment from address + package dims/weight. Walmart's overview calls it GET, the reference page shows POST. **verify** |
| 4 | `POST /v3/shipping/labels` | Buys the label. Body: `purchaseOrderId`, `fromAddress`, `packageType`, `boxDimensions` (`boxWeight`, `boxWeightUnit`, L/W/H + unit for `CUSTOM_PACKAGE`), `boxItems` (`sku`, `quantity`), `carrierName`, `carrierServiceType`. The `Accept` header picks the output: `application/json,application/pdf` gives a PDF, `application/json,image/png` a PNG, `application/json` only JSON. Response carries `trackingNo`, `carrierName`, `carrierServiceType`, `trackingUrl`, `shippingDocuments`. |
| 5 | `GET /v3/shipping/labels/carriers/{carrierShortName}/trackings/{trackingNo}` | Re-download a label (same `Accept` rules). |
| 6 | `GET /v3/shipping/labels/purchase-orders/{purchaseOrderId}` | Label details for a PO: tracking, service, shipment-protection and signature add-ons. |
| 7 | `DELETE /v3/shipping/labels/carriers/{carrierShortName}/trackings/{trackingNo}` | Discard (void) a label. |

Related APIs worth knowing:

- **Shipment Protection API** manages claims on SWW labels lost or damaged
  in transit (Walmart refunds the customer up to $100, handles the carrier
  claim, and keeps seller metrics unaffected; extra cover up to $500 can be
  bought). This pairs with the existing `claims.js`.
- **Orders API "Shipping updates"** (`POST /v3/orders/{purchaseOrderId}/shipping`)
  marks lines shipped with carrier + tracking. Walmart's own SWW overview
  says that after handing the package to the carrier the seller still needs
  to update the order "through Seller Center or the Shipping Updates API".
  Integrators (Easyship, ShippingEasy) explicitly call it after buying the
  label. So the app must **not** assume a label purchase ships the order.
  **verify** on a test order whether the SWW purchase already sets
  tracking on the PO; either way calling Shipping updates is harmless.
- Once the order is marked shipped the label cannot be voided. Void before
  shipping.

The "Generate label (New)" and "Download label (New)" pages under
`/v3/fulfillment/...` are a different product (WFS inbound and multi-parcel
"booked shipments"), not seller-fulfilled SWW. Ignore them for this feature.

## 2. How it compares to today

Today: the queue row appears from Linnworks open orders, the packer clicks
the PO# to open Seller Center in the pane, buys the label there, prints it,
scans the barcode into the row, and Process pushes tracking to Linnworks
(which in turn notifies Walmart).

With the API: the queue row appears, the packer (or the app, automatically)
buys the label, the label prints, and the row is filled with the returned
tracking without a scan. Process runs as today. Seller Center is never
opened for a Walmart order.

What you gain: no manual label flow, no scan step, exact tracking with no
copy mistakes, cost of every label stored per PO (useful for margin math),
bulk purchase for a whole day's Walmart queue in one click.

What stays manual: eBay and Temu labels (different APIs, out of scope),
Walmart orders needing an unusual package (bulk mode should skip those and
leave the row for the manual flow).

## 3. Prerequisites

1. **Walmart API keys.** Seller Center → Settings → API key management →
   create a key for "your own application". This gives a Client ID and
   Client Secret. Set the *Shipping* scope (and *Orders* if the app is to
   call Shipping updates) to full access.
2. **SWW enabled** on the seller account (it is, since labels are bought in
   Seller Center today). Labels bill to the seller's Walmart payments as
   they do today.
3. **Token flow.** `POST /v3/token` with `Authorization: Basic base64(clientId:clientSecret)`,
   body `grant_type=client_credentials`, headers `WM_SVC.NAME`,
   `WM_QOS.CORRELATION_ID` (any UUID), `Accept: application/json`. The
   returned `access_token` lives 15 minutes and goes into
   `WM_SEC.ACCESS_TOKEN` on every call, together with `WM_SVC.NAME`,
   `WM_QOS.CORRELATION_ID` and `Accept`.
4. **Ship-from address** and **package profiles** (weight + dims per SKU).
   Linnworks inventory carries weight/height/width/depth per item, so the
   app can default from there and let the owner override in Settings.
5. **A label printer path** (see §5).

## 4. Integration design: a `sww` module

Follow the existing pattern: one main-process module per external system
(`linnworks.js`, `shipfile.js`, `claims.js`), IPC handlers in `main.js`,
config in `config.js`, tables in `db.js`, UI in `renderer.js`.

### 4.1 `src/main/walmart.js` — API client

Small class, same shape as `LinnworksClient`:

```
class WalmartClient {
  constructor({ clientId, clientSecret })   // creds decrypted from config
  async auth()                              // POST /v3/token, cache 14 min
  async call(method, path, { body, accept }) // headers, retry once on 401,
                                            // throws { status, code, message }
  carriers()                                // GET carriers
  packageTypes(carrier = 'ALL')
  estimates(req)                            // shipping-estimates
  createLabel(req, format = 'pdf')          // returns { json, file: Buffer }
  labelByPo(poId)                           // label details by PO
  downloadLabel(carrier, tracking, format)
  discardLabel(carrier, tracking)
  shipOrder(poId, lines, carrier, tracking, methodCode) // Orders shipping update
  testConnection()                          // GET /v3/token/detail
}
```

Use Node's built-in `fetch`/`https`, no new dependency, matching how
`linnworks.js` is written. Handle the multi-media response: with
`Accept: application/json,application/pdf` the body is the label file and
tracking comes back in the JSON part or response headers. **verify** the
exact shape on the first live call and store both.

### 4.2 `src/main/sww.js` — orchestration

Mirrors `sync.js`: plan → (dry run or write) → log.

```
buyLabel({ rowId, serviceOverride, packageOverride, dryRun })
  1. row = db.row(rowId); must be channel 'walmart', no tracking yet,
     status pending, not WFS, not dropship-routed (DS badge).
  2. order = Linnworks open order for the PO (already cached for the queue):
     items -> boxItems [{ sku: walmart channel SKU, quantity }],
     weight/dims -> package profile lookup (SKU profile > Linnworks dims >
     config default box).
  3. estimate = client.estimates(...) ; pick by config rule
     (cheapest / cheapest that meets the order's promised ship method).
  4. if dryRun: log the plan, return.
  5. label = client.createLabel({ purchaseOrderId, fromAddress, packageType,
     boxDimensions, boxItems, carrierName, carrierServiceType }, 'pdf')
  6. db.insertLabel({ row_id, po, carrier, service, tracking, cost,
     file_path, status: 'bought' }); write PDF to
     Documents\Capture Station\labels\<po>-<tracking>.pdf
  7. rows.update(tracking = label.trackingNo, carrier = carrier) — the same
     path a scan takes today, so duplicate/format guards, the CSV mirror
     and the green status all behave unchanged.
  8. print (see §5).
  9. optional: client.shipOrder(...) if config.sww.markShippedOnLabel.
     Default OFF: keep Walmart notified through Linnworks Process as today
     so there is a single owner of "shipped". Turn on only if the test in
     §1 shows Walmart does not pick tracking up from Linnworks fast enough.
buyLabelsBulk({ ids }) — loops buyLabel, stops on the first hard error,
     collects per-row results for the footer summary (same UX as Sync).
voidLabel({ rowId }) — client.discardLabel, labels.status = 'voided',
     clear row tracking (reuse the existing undo path), refuse if the row is
     already processed/synced.
```

Dry-run must default ON, exactly like Linnworks sync, since every live
create-label call spends money.

### 4.3 `db.js` — one new table

```
CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  row_id INTEGER NOT NULL,
  po TEXT NOT NULL,
  carrier TEXT NOT NULL,        -- shortName from carriers API
  service TEXT NOT NULL,        -- carrierServiceType
  tracking TEXT NOT NULL,
  cost_cents INTEGER,
  package TEXT NOT NULL,        -- json: type, weight, dims
  file_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,         -- bought | printed | voided | failed
  created_at TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_labels_row ON labels(row_id);
```

Plus `package_profiles(sku PRIMARY KEY, weight_oz, l_in, w_in, h_in, package_type)`
for the per-SKU override, and a daily `labels.csv` mirror next to the
capture CSV (the app mirrors every table it owns to CSV; keep that habit).

### 4.4 `config.js`

```
sww: {
  enabled: false,
  dryRun: true,
  clientId: '', clientSecret: '',      // encrypted like linnworks -> swwEnc
  fromAddress: { contactName, companyName, addressLine1, addressLine2,
                 city, state, postalCode, country: 'US', phone, email },
  defaultPackage: { type: 'CUSTOM_PACKAGE', weightOz: 16, l: 10, w: 8, h: 4 },
  serviceRule: 'cheapest',              // or a fixed carrierServiceType
  labelFormat: 'pdf',                   // 'pdf' | 'png' (ZPL not offered by SWW; verify)
  printer: '',                          // printer name; '' = OS default
  autoPrint: true,
  markShippedOnLabel: false,
  autoBuy: false,                       // buy when the row lands (v2)
}
```

Extend `encryptCreds` / `decryptCreds` to cover `sww` the same way
`linnworksEnc` is done today. Capture-only stations must ignore the whole
section (no API access on the packing PC), the same rule the Linnworks
credentials follow.

### 4.5 IPC handlers (`main.js`)

`sww:test`, `sww:carriers`, `sww:estimate` (rowId, package → rates),
`sww:buy` (rowId, chosen service), `sww:buyBulk` (ids), `sww:void` (rowId),
`sww:reprint` (rowId), `sww:labels` (day range for a log view),
`sww:profileGet/Set` (SKU package profile). Add the matching bridges in
`preload.js`.

### 4.6 Renderer

- **Row action** on Walmart rows without tracking: a "Label" button next to
  the inline tracking box. Click opens a small dialog: package (profile
  pre-filled, editable), rate list from `sww:estimate` with the rule's pick
  highlighted, Buy. On success the row goes green with the tracking, the
  label prints, and a toast shows carrier + cost.
- **Bulk**: with the Walmart chip active, "Buy labels" in the toolbar runs
  `sww:buyBulk` on every eligible pending row (single-package orders using
  the default/profile package). Rows it skipped are listed in the footer so
  the packer does those by hand.
- **Void** in the row's Edit dialog while the row is unsynced.
- **Settings > Ship with Walmart**: keys, Test connection, from address,
  default package, service rule, printer, dry run, auto-print, the two
  advanced toggles.
- **Labels log** (History page filter or a small tab): date, PO, carrier,
  service, tracking, cost, reprint.

### 4.7 Where it sits in the flow

```
Linnworks open orders ──► queue row (pending)
                              │
                 [Label]/[Buy labels] ──► sww.buyLabel ──► Walmart SWW API
                              │                              │
                              │◄── tracking + PDF ───────────┘
                              ▼
                 row.tracking set (same path as a scan) ──► print label
                              │
                          Process ──► Linnworks: set tracking, despatch
                                            └──► Walmart gets shipped+tracking
```

## 5. Printing

The pane's `browser:print` handler prints a web page, not a file. Options
for the label PDF, in order of preference:

1. **Silent PDF print through a helper**: bundle SumatraPDF (portable,
   ~10 MB, GPL) or use the `pdf-to-printer` npm package (which wraps it)
   and run `-print-to "<printer>" -silent`. Works with any 4x6 thermal
   printer's Windows driver. This is the usual Electron answer.
2. **Hidden BrowserWindow** loading the PDF and calling
   `webContents.print({ silent: true, deviceName })`. Chromium's PDF viewer
   makes this flaky (blank pages, no page-size control). Not recommended.
3. **PNG label** (`Accept: image/png`) in a hidden window and
   `print({ silent: true })` with a 4x6 page size. Works reliably but
   raster quality on barcodes depends on DPI; test the scanner on it.

Ask for the label as PDF and go with option 1. Keep the PDF on disk so
reprint never re-calls the API.

## 6. Rollout plan

1. **Spike (half a day)**: create the API key, write `walmart.js`, run
   `testConnection`, `carriers`, `packageTypes('ALL')` and one `estimates`
   call from `tools/` (like `tools/hubx-sandbox.js`). This settles every
   **verify** above, including the real create-label body and whether the
   PO auto-ships.
2. **v1**: single-row Label dialog, dry run on, PDF to disk, manual print
   from the toast. Run one real order end to end, then compare what
   Walmart shows in Seller Center (tracking, shipped state) after Process.
3. **v2**: silent print, bulk buy, void, labels log/CSV, package profiles.
4. **v3 (optional)**: auto-buy on row arrival for SKUs with a profile, and
   hook the Shipment Protection API into `claims.js`.

## 7. Risks and open points

- **Rates**: SWW rates are discounted but are not always cheaper than a
  seller's own UPS/FedEx account. Keep the estimate step visible so the
  packer can see the price before Buy; `serviceRule: cheapest` is the
  default, not a lock-in.
- **No UPS**: orders that today go UPS must move to USPS/FedEx, or stay on
  the manual flow (the row's Label button simply is not used).
- **Multi-box orders**: SWW create-label is one box per call; v1 supports
  one box per PO and leaves the rest manual.
- **Double shipping update**: if both Linnworks and the app notify Walmart,
  the second call is a no-op update within Walmart's 24-hour tracking edit
  window. Still, keep one owner (Linnworks by default).
- **Rate limits**: Walmart throttles per endpoint; bulk buy should run
  sequentially with a short delay and back off on HTTP 429.
- **Voiding**: only possible before the order is marked shipped, so the
  app must refuse void once Process has run, and the packer should void
  before re-buying a label for a repack.

## Sources

- Walmart Developer Portal, Ship with Walmart overview:
  https://developer.walmart.com/us-marketplace/docs/buy-shipping and
  https://developer.walmart.com/doc/us/mp/us-mp-sww/
- Create label reference: https://developer.walmart.com/us-marketplace/reference/createlabel
- Shipping estimates reference: https://developer.walmart.com/us-marketplace/reference/getshippingestimate
- Discard label: https://developer.walmart.com/us-marketplace/docs/discard-label
- Label details by PO: https://developer.walmart.com/us-marketplace/lang-fr_CA/docs/label-details-by-purchase-order-id
- Shipping & fulfillment API index: https://developer.walmart.com/us-marketplace/docs/shipping-fulfilment
- Shipment Protection API: https://developer.walmart.com/us-marketplace/docs/shipment-protection-api-overview
- Orders API (Shipping updates): https://developer.walmart.com/api/us/mp/orders
- Marketplace Learn, SWW overview and bulk label buying:
  https://marketplacelearn.walmart.com/guides/Seller%20Fulfillment%20Services/Ship%20with%20Walmart/Ship-with-Walmart-Overview
  https://marketplacelearn.walmart.com/guides/Shipping%20&%20fulfillment/Ship%20with%20Walmart%20U.S.%20domestic/buy-shipping-labels-in-seller-center-in-bulk
- Same API, MX/CA variants with full request/response models (highsidelabs SDK):
  https://github.com/highsidelabs/walmart-api-php/blob/main/docs/Apis/MP/MX/InternationalShippingApi.md
- Integrator behaviour (label then explicit ship update): https://support.easyship.com/hc/en-us/articles/19223245306002-Connect-your-Walmart-Store
  and https://support.shippingeasy.com/hc/en-us/articles/4405325043355-Walmart
- GeekSeller announcement of SWW via API: https://www.geekseller.com/blog/walmart-us-sellers-can-now-print-shipping-labels-via-the-seller-center-or-walmart-api/
