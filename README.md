# DWS Stock

Windows Electron app for a packing station (formerly Capture Station), built for reselling on Walmart, eBay and Temu with labels bought on the marketplace sites. Captures order number + tracking (clipboard or USB scanner), pushes completed captures to Linnworks (set tracking, attach notes, process/despatch), and gives the warehouse a live stock view. SQLite storage, daily CSV mirrors, fully silent; all feedback is visual.

## v1.31.4 highlights

- **Phone dashboard on the new Overview.** The phone's Overview now matches the desktop: the three counts, the Needs attention queue (tap a row for 30-day units, per day, pace, days left or suggested order, marketplace split, and a jump to that SKU in Stock), the watch-list toggle, and Sold today with the share bar and the top SKUs. The Missed / Buy soon / To WFS tiles are gone. The sales card, chart and latest orders moved below under a Sales heading. While the desktop is still reading sales, the phone asks again every few seconds instead of once a minute. The home-screen name is DWS Stock.

## v1.31.3 highlights

- **Sold today header stays put.** The units total, orders and SKU counts, the marketplace share bar and the column labels are pinned; only the SKU rows scroll, with the Total row fixed under them.

## v1.31.2 highlights

- New icon: the lowercase "dws." wordmark on a navy gradient tile (owner's final pick).

## v1.31.1 highlights

- **Updates happen in the app on the Mac too.** The Mac build is unsigned, so the standard updater refused it; the app now downloads the DMG itself, and "Restart to update" swaps the app bundle in Applications and relaunches, clearing quarantine on the way. The first move onto this version still goes through the DMG (the older app does not know the new route); every version after it arrives in place, on both platforms.
- **Update card.** A new release shows "Version X is available (you have Y)" with Update now and Close. Update now shows the download percentage and the app restarts itself the moment the build is on disk. Close keeps the footer button as the quiet way back in.

## v1.31.0 highlights

- **The app is now DWS Stock**, with a new icon. Window title, installer name (`DWS-Stock-Setup-1.31.0.exe`, `DWS-Stock-1.31.0.dmg`), Start menu / Applications entry, phone dashboard and in-app wording all follow. Installing over Capture Station replaces it (same app identity), and the first launch carries the station's database, settings and caches across to the new data folder, so nothing is set up again. The stock-log reason strings Linnworks shows ("Capture Station return" and friends) are unchanged on purpose: every station's history matching keys on them.

## v1.30.11 highlights

- **Overview fits the window.** The header and the three counts stay put, and the Needs-attention and Sold-today cards take the rest of the height and scroll inside themselves, with their headers and the total row pinned. Nothing runs under the footer any more, on a short laptop screen or a tall monitor.

## v1.30.10 highlights

- In-place updater: a failed attempt (manifest missing, dropped connection) now falls back to the installer download for 20 minutes and then tries the in-place path again, instead of staying on installers until the app is restarted.

## v1.30.9 highlights

- **Returns worksheet works again.** Since the wholesale invoices arrived (v1.29.1) the invoice sheet's save function carried the same name as the returns worksheet's, and the later one replaced it for the whole app: Enter or the + gutter on a return ran the invoice save, so the return never saved. Renamed; the returns sheet looks the PO up and saves as before.
- **Overview Watch rows.** Dropship-padded SKUs (no shelf stock by design) no longer appear anywhere on the Overview, and a Watch row at zero now says "Out of stock · slow seller, N sold in 30 days" so it is clear why it is not in the red group.

## v1.30.8 highlights

- Release fix: the Mac build job swept the Windows updater manifest (`latest.yml`) off the v1.30.6 and v1.30.7 releases after the Windows job had uploaded it. The Mac job now keeps it. This is the first release the in-place updater can actually read, so install it by hand once; the next one arrives in place.

## v1.30.7 highlights

- The Overview's green page-width drag bar is gone; the page sits at its designed width.

## v1.30.6 highlights

- **Updates install themselves on Windows.** When a new release is out, the app downloads it in the background and the footer button turns into "Restart to update vX". One click closes the app and brings it back on the new version, about twenty seconds, no installer to click through. The Check for updates button and the half-hour check both feed it. The Mac build is unsigned, so the Mac keeps downloading the DMG and opening it.
- Releases now carry `latest.yml`, the manifest the in-app updater reads, and the Windows installer is named without spaces (`Capture-Station-Setup-1.30.6.exe`). The first move onto this version is a normal install; every version after it arrives in place.

## v1.30.5 highlights

- **The marketplace pane can no longer spill over the capture list.** The native browser view is now clipped to its own dock and stopped at the sheet's left edge no matter what the layout measures, the main process clamps it to the window as well, and a window resize, maximize or zoom change asks the page to re-measure right away.

## v1.30.4 highlights

- **The Stock page lands at once.** Clicking a SKU on the Overview (or a reminder on Returns) puts the SKU in the search box and draws the grid from the last visit immediately; Linnworks' fresh levels replace it a moment later. Only the first open of a session shows the spinner, and a failed refresh keeps the last grid with a note instead of a blank page.
- The app keeps the inventory for one minute between Stock page visits, so bouncing between tabs no longer re-walks Linnworks every time. Any stock move, Min, cost, rename, delete or new SKU made through the app drops that copy on the spot, and the Refresh button always goes to Linnworks.

## v1.30.3 highlights

- **Check for updates button** in the footer, next to the sync line. It asks GitHub right then and says what it found: you are current, an update is ready (the green Update button lights up and installs it), or the release exists but its installer is still building. Carried over from a parallel branch that never reached main.
- The automatic check runs every 30 minutes instead of every 4 hours (plus once, 20 seconds after launch).

## v1.30.2 highlights

- **The Overview's first-open loading state moves.** A sheen sweeps the progress bar, the headline's dots cycle, and the current checklist step's ring breathes while the 30-day sales pass runs. All of it switches off under the system's reduced-motion setting.

## v1.30.1 highlights

- **Overview watch list is more of the same rows.** The footer link now reveals the SKUs under 28 days of cover as ordinary rows (grey "Watch" badge, SKU and name, "11 days left", expandable chart) under the Needs attention rows, instead of a compact three-column grid.
- **Selling fast is ordered by pace.** The fastest sellers (most units a day) come first; the "Up N%" phrase stays.
- **Condition SKUs stay off the Overview.** Open box, used and scrap listings (prefix or suffix naming, or any SKU a saved condition mapping points at) are resold returns, so they never appear in the queue or the watch list.

## v1.30.0 highlights

- **New Overview: the status queue** (design 1a from Claude Design, owner-approved 2026-10-08; handoff notes in `docs/design-handoffs/overview-1a-status-queue.md`). Three big counts — out of stock, running low, selling fast — and one urgency-ordered list under "Needs attention": every SKU that is out and still selling (most recent sale first), then every SKU that runs out inside the lead time, then everything selling 20%+ faster than two weeks ago. A row shows a badge, the SKU with a "Hot" tag past 1 a day, the item's name, and one phrase ("Out since Oct 5", "3 days left", "Up 42%"). Click a row to open its 30-day sales chart with the 30-day average and the last 14 days shaded, this week / this month / per day / pace, and the split by marketplace; hover the chart for any day's units. A footer link reveals the rest under 28 days of cover. Sold today stays on the right. Send to WFS is gone from the Overview.
- The page has an all-clear state ("Nothing out, nothing running low"), a first-open loading state with a progress bar and a three-step checklist, and an error banner that keeps the last good figures and says when it retries.
- The Overview's LOW ignores still apply (an "N ignored · Undo" footer shows when any are active); rows carry no Order or Ignore buttons by the owner's request.

## v1.29.14 highlights

- **Returns log pager is two arrows** (‹ 1–50 of 204 ›) instead of a row of numbered buttons.
- **Returns search finds the model and the condition.** The search box also matches the Linnworks title behind each SKU ("Tab A9", "Galaxy A15") and the condition in either spelling ("open box" or "openbox"), on top of PO, SKU, customer, tracking, received-by and notes.
- Overview mockups for the stock board that replaces Send to WFS (`variants/ov-stock-watch.html`, `ov-stock-3ways.html`, `ov-stock-simple.html`), awaiting the owner's pick.

## v1.29.13 highlights

- **Stock history opens at once.** The dialog (and the all-SKU History) used to wait for 30 days of processed orders from Linnworks before showing anything. Now the logged changes appear immediately from the local log, with "reading 30 days of sales…" in the sub-line until the SOLD lines join.
- **The sales cache stays warm.** Past its 10-minute age the cache is no longer thrown away; only the last day is re-read for orders processed since, so a history open after a quiet spell takes seconds, not minutes. The Overview's sales pass benefits the same way.
- **The shared log is read incrementally.** Each open only parses what other stations appended since the last pass, instead of re-reading every station's whole stock-log file over the network and re-offering every line to the database.

## v1.29.12 highlights

- **Cost lives in the software only.** Costs are no longer written to Linnworks' purchase price. Each SKU's cost is kept in the app (one row per SKU, newest write wins) and shared through the log folder as `costs-STATION.jsonl`, so every computer with the shared folder sees the same cost. The COST history lines are unchanged.
- **Moving off Linnworks.** The first time a Cost station starts on this version it reads every COST line, keeps the latest value as the software's cost, and puts each item's Linnworks purchase price back to what it was before the app first touched it (0 for nearly all). An item whose Linnworks price was changed by hand since is left alone. Runs once, retries next start if Linnworks is unreachable.
- The New SKU sheet's cost field saves to the software too; Linnworks gets a purchase price of 0. The channel-SKU export's Cost column reads the software's cost.

## v1.29.11 highlights

- **Returns log entry row lines up again.** The wholesale invoice sheet (v1.29.1) reused two style names the returns entry row already owned, so that row turned into a flex strip of tiny boxes under the wrong headers. The invoice sheet's styles are renamed; the entry row sits under its columns as before.

## v1.29.10 highlights

- **Cost edits stay put.** The cost button and the box it turns into are the same size and the column is fixed, so clicking a cost no longer shifts the sheet.
- **Click off to save a cost.** Type the number and click anywhere (or Tab, or straight into the next row's cost); the cell updates in place as each save lands. Enter still works. Escape cancels.
- Costs are the item's purchase price in Linnworks, so every station sees the same number the next time it opens the Stock page; the COST history line rides the shared log folder like every other stock change. Nothing goes through Google Drive.

## v1.29.9 highlights

- **The Overview works again.** The dial-rows design (v1.29.x) dropped a one-line definition from the Send to WFS panel, so the page threw the moment the sales pass finished and every station sat on "Crunching WFS sales…" forever. Restored.
- **The Overview answers in seconds, always.** The 30-day sales pass no longer holds the reply; it runs behind the page and the two money columns show what it is doing (which page of orders, how long so far) with the page filling in by itself when it finishes. Today's numbers get an 8-second budget before the station's own captures stand in. When Linnworks refuses (rate limit, bad credentials) the columns and the header say so instead of waiting silently, and the pass is retried a minute later or on Refresh.
- Linnworks rate limits (429) no longer kill a long walk: the client waits out the window and continues, a few times. At boot the year-of-history pass now waits for the money pass instead of racing it on the same endpoint.

## v1.29.8 highlights

- **Cost column** on the Stock page (Settings › Pages on this station › Cost, off by default): the item's Linnworks purchase price right after the SKU, click to edit in place like Min. Every change is a COST line in the SKU's Stock history (before → after, computer, time) that rides the shared folder, and Cost joins the history's action filter; a "Cost now" tile shows the current cost and what it was. Unticked stations see no column, no tile and no COST lines. The channel-SKU export gains a Cost column when run from a ticked station.
- **Wholesale invoices** (Stock page › Actions › Wholesale invoices…, per-station opt-in under Settings › Pages on this station, off by default). The list opens first; New invoice is a QuickBooks-shaped sheet: customer (saved as you go, picked from a dropdown next time), invoice number and date, lines of SKU / description / qty / rate / amount, note, ship via, totals. Only SKU and qty are required; rate and shipping can stay blank. Saving deducts the units from the primary location (same path as WFS shipments) and every line lands in the SKU's Stock history as a WHOLESALE entry; Void puts the units back and keeps the invoice as a struck-through record. Each line has a serial-numbers popup: scan or type, Enter saves that serial at once, ✕ removes one, duplicates are flagged, Export CSV. Print saves the invoice as a PDF. Customers, invoices and serials ride the shared log folder (`wholesale-customers-STATION.jsonl`, `wholesale-invoices-…`, `wholesale-serials-…`, newest snapshot wins) so every desktop sees one list; `wholesale-orders.csv` mirrors the lines beside the daily CSVs.
- Folds in the parallel branches of the same week: the Stock band's Actions menu (Mappings, WFS Shipments, Bulk import, channel-SKU CSV exports), the Overview dial rows for Send to WFS and Running low, sold prices without sales tax, and the eBay lister CSV eBay accepts.

## v1.3.0 highlights

- **Capture is a work queue**: Linnworks open orders auto-drop as pending rows (every 5 min; WFS location excluded); untouched rows auto-remove when an order leaves open orders (cancellations). Marketplace filter chips, persistent search (PO#/SKU/channel SKU/title/tracking/notes), stacked item lines with thumbnails, ⚠ unmapped-listing flags, channel-SKU info dots, DS badges on dropship-routed rows.
- **Click a PO#** to select the row and open the order on its marketplace (per-channel URL templates); tracking is scanned/typed into the row's inline box (global scan box and clipboard auto-capture removed in sync mode; capture-only stations unchanged).
- **Returns page**: look up the processed order, grade each unit New/Open box/Used/Scrap, and stock auto-redirects to the mapped condition listing (suffix auto-derive + remembered one-time picks). Returns ledger + `returns.csv`, note on the original order.
- **Receiving moved into the Stock page** (dialog beside WFS Shipments). Since v1.28.25 the Stock band's Bulk import, Mappings, WFS Shipments and channel-SKU exports sit behind one **Actions ▾** menu. Stock SKUs click through to their linked channel SKUs.
- Resizable everything: sheet-width handles and per-column grips on Capture and Stock, all persisted.

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

Build the installer (`dist/DWS-Stock-Setup-x.y.z.exe`):

```
npm run dist
```

Storage: SQLite (Electron's built-in `node:sqlite`) in the userData folder (`%APPDATA%/capture-station`). The DB is backed up automatically to `userData/backups` on every app close (14 kept). `File > Export Today to CSV` exports a copy anywhere.

**Channel SKU export.** Stock page > **Actions ▾** > Export Walmart / eBay / Temu SKUs (or `File > Export Channel SKUs`) saves the marketplace listings that are mapped to a Linnworks item to an Excel workbook (styled header, sized columns, frozen header row, filters; pick CSV in the save dialog for a plain file): inventory SKU, channel SKU, title, condition (New / Open Box / Used / Scrap, classified by the same `stockViews` patterns as the Stock chips), listed qty, price, WFS flag, source/sub-source. With a condition chip active on the Stock page the Actions-menu exports cover only that slice (file name carries the condition). Unmapped listings are left out. Sync mode only.

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
