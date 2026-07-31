# Capture Station

Windows Electron app for a packing station, built for reselling on Walmart, eBay and Temu with labels bought on the marketplace sites. Captures order number + tracking (clipboard or USB scanner), pushes completed captures to Linnworks (set tracking, attach notes, process/despatch), and gives the warehouse a live stock view. SQLite storage, daily CSV mirrors, fully silent; all feedback is visual.

## v1.1.0 highlights

- **Process button**: manual push to Linnworks; parked orders are auto-unparked (tag 7 cleared) and stamped "was parked"; dropship orders process at the fallback location.
- **Stock routing**: every 5 min, open orders the warehouse can't cover move to the DropShip location; they move back when stock is replenished (see `src/main/router.js`).
- **Stock page**: live inventory grid (sortable, resizable, filterable), inline stock-level corrections, per-SKU image management (file / URL / download), and a WFS shipment log that deducts shipped units from the warehouse (`wfs-shipments.csv`). Condition view chips (All / Open Box, config-driven via `stockViews`, combine with the search box) filter the grid, and clicking a SKU's "In orders" count opens the actual open orders containing it (channel, order #, channel SKU, qty, date; one-minute cached fetch).
- **Copy-mistake guards**: exact-length order patterns, fragment detection for order and tracking numbers, clipboard tracking capture, click-to-copy without duplicate banners.
- **History**: processed orders only, with a parked-only filter.
- **Hardening**: Linnworks credentials encrypted at rest (DPAPI via safeStorage), optional Settings PIN, dev menu items stripped from packaged builds.
- **Per-install pages**: Settings > "Pages on this station" toggles the Stock tab, History button and the Receiving tab per machine (Capture is always on; capture-only mode overrides everything and shows Capture alone).
- **Receiving page** (off by default): a PO worksheet. Header bar with optional Reference and inbound Tracking number (loosely validated against the tracking patterns, never blocking) plus the automatic date; a spreadsheet whose last row is always the live entry row — type a SKU (suggestions filter the live Linnworks inventory by SKU/title/barcode, title autofills), Tab/Enter to the qty cell, Enter commits the line and starts the next. Unknown SKUs warn with an Add-anyway option; repeat SKUs merge; committed lines stay editable/deletable. A shipment-level Notes box sits under the sheet. "Finish receipt" writes `receiving-session-<timestamp>.json` (`{ id, station, finishedAt, reference, trackingNumber, notes, lines, status }`) to a configurable folder (default `Documents\Capture Station\receiving`) and POSTs the same JSON to an optional Make.com webhook (Settings > Receiving); the webhook outcome is stamped back into the file. **Past receipts** below are grouped by day — expand a day to its receipts, and a receipt to its lines with reference/tracking/notes.

## Modes

**Capture-only (default).** For the packing-station PC: no Linnworks access at all. The Sync button is hidden, auto-sync is disabled, and every capture is mirrored live into a daily CSV at `Documents\Capture Station\capture-YYYY-MM-DD.csv` (folder changeable in Settings). The packer sees the day's rows in the app and can open the CSV any time via "Open CSV folder". If the CSV is open and locked in Excel, the app says so in the footer and retries on the next change; the SQLite database always has the full data.

**Sync mode.** Untick "Capture only" in Settings to bring back the Sync to Linnworks button, dry-run mode and scheduled auto-sync. Intended for the owner's own use, not the packing station.

## Daily flow

1. Highlight the order/PO number on the marketplace page and press Ctrl+C. The app recognizes the format (Walmart 13-15 digits, eBay `NN-NNNNN-NNNNN`, Temu `PO-…`), opens a numbered row, and shows a toast. Anything else on the clipboard is ignored.
2. Zap the shipping label's tracking barcode. The app validates it (UPS `1Z…`, USPS, FedEx), fills the row, and the order is complete.
3. Copy the next order number. Repeat.

Duplicate order numbers get a loud red banner and are not re-added. Scans that don't look like tracking ask before saving. "Undo last" reverts the last capture (undoing a tracking scan reopens that order). Hover a row for Edit / Delete; the Edit dialog has a free-text **Notes** field for anything extra (serial numbers, condition, etc.) which also lands in the CSV's notes column.

The list is a spreadsheet: numbered row gutter (tinted by status: green = complete, gray = waiting for tracking, red = failed sync), then Order # / Tracking / Notes columns with gridlines.

## Running

```
npm install
npm start
```

Build the installer (`dist/Capture Station Setup x.y.z.exe`):

```
npm run dist
```

Storage: SQLite (Electron's built-in `node:sqlite`) in the userData folder (`%APPDATA%/capture-station`). The DB is backed up automatically to `userData/backups` on every app close (14 kept). `File > Export Today to CSV` exports a copy anywhere.

## Linnworks setup (sync mode only)

1. Create an API application at the Linnworks developer portal, install it, and get: Application ID, Application Secret, Install Token. Docs: https://apidocs.linnworks.net/docs/generating-an-api-key
2. The token needs order permissions including `GlobalPermissions.OrderBook.DespatchConsoleNode` (for processing orders).
3. In the app: Settings > untick Capture only > enter the three values > Test connection > pick the stock location > Save.
4. **Dry run is ON by default.** Dry-run syncs look up each order (read-only) and log what would happen without writing anything. Turn it off only after a first live test on one order passes.

Sync per row: find open order by channel reference number (`Orders/GetOpenOrders`) -> set tracking (`Orders/SetOrderShippingInfo`, preserves existing postal service/weights) -> process (`Orders/ProcessOrderByOrderOrReferenceId` with `ScansPerformed: true`). Calls are throttled under the 150/min API limit. Failed rows (e.g. order not yet in Linnworks) retry automatically on the next sync. (Serial attachment via `CreateSerialisedValuesForOrderItems` remains in the codebase but is unused since serial tracking was retired.)

## Configurable patterns (Settings)

- Order numbers: `walmart = ^\d{15}$` (exactly 15 so clipped copies are rejected), `ebay = ^\d{2}-\d{5}-\d{5}$`, `temu = ^PO-\d{3}-\d{5,}$`
- Tracking: UPS `^1Z…`, USPS `^9[2345]\d{20,24}$`, FedEx digit formats

Verify the eBay and Temu formats against real orders before relying on them; edit in Settings if they differ.

## Tests

```
$env:CAPTURE_E2E="1"; .\node_modules\electron\dist\electron.exe .
```

Runs an automated end-to-end suite (clipboard ingest, scan validation, duplicates, undo, notes editing, CSV mirror) against a throwaway data directory and exits non-zero on failure. Set `CAPTURE_E2E_SHOT=<path.png>` to also save a window screenshot.
