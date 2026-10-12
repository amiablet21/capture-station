# DWS Stock

Windows Electron app for a packing station (formerly Capture Station), built for reselling on Walmart, eBay and Temu with labels bought on the marketplace sites. Captures order number + tracking (clipboard or USB scanner), pushes completed captures to Linnworks (set tracking, attach notes, process/despatch), and gives the warehouse a live stock view. SQLite storage, daily CSV mirrors, fully silent; all feedback is visual.

## v1.32.14 highlights

- **Price and commission fill in by themselves** for periods imported before v1.32.13 (owner: "why is the avg commission and avg price not showing"). Opening Profit re-reads each such period's archived CSV from the shared folder or this computer and stores the goods price and commission; no re-import needed. A period whose archive is nowhere keeps "—".
- **A report whose SKU column has another name** ("Partner Item ID", "SKU", "Item ID") is read all the same, so its orders no longer pile up under "(no SKU)".
- The Imported periods list keeps its gutter narrow and each count with its dollars on one line (owner: "this looks weird").

## v1.32.13 highlights

- **Profit shows the price and Walmart's cut** (owner: "can you not see from the file what the commission rate is?"). Two new columns on By SKU, Avg price and Commission, come straight from the report's Product Price and Commission on Product lines, so a SKU reads price → commission → Walmart paid → cost → profit; the legend adds the commission total and its % of goods sold. Periods imported before this show "—" until re-imported. The old report layout carries both; the new layout carries the price only.
- **Click a Profit column header to sort** (owner: "filter by most to least"): numbers start biggest first, text A→Z, a second click flips, rows with no value sit last. Both the By SKU and By period tables.
- **Download the whole Returns log** from a tray icon next to Refresh on the Returns page: one Excel sheet, one line per returned item, every station's entries when sync is on.
- **Not received no longer folds** (owner: "I don't want it to collapse"): Monthly summary and Returns Not Received are plain titles, always open.

## v1.32.12 highlights

- **Reconcile as a sheet** (owner: "super scrunched … make the whole thing excel-y like the Capture sheet", Design A of three). One toolbar row holds the period picker with Download Excel and Remove period; the import note is gone. Under it a five-cell strip spreads the period across the full width: refunded total with its bar, received, not received, WFS waiting, and a Today cell with how many need action, how many are still open and how many resolved since. Every Recovery table is now a grid: a numbered gutter, cell borders both ways, one line per row on Reconcile (PO # · Type · Item · Refunded · Net refund · Reason · What to do).
- **A PO # opens on Walmart** (owner: "order page or transaction page"). Clicking a PO on Reconcile or Not received shows Order page · Transaction page · Copy PO #. The order page uses the Seller Center link the Capture sheet already uses; the transaction page is a new Payments link with {po} in it, editable under Settings → Recovery if Seller Center's address differs.

## v1.32.11 highlights

- **Import is its own Recovery screen** (owner: "an import tab that does not mix with the reconcile tab"). Import holds the drop target and every imported period in one list, newest first: imported when and by which station, refunds, received / not received / WFS waiting with their dollars, how many are still open today, and Reconcile · Excel · Remove. The header's Import button is gone. Reconcile reads one period, picked from a dropdown, and says how many of its not-received are still open today against how many resolved since.

## v1.32.10 highlights

- **Recovery at the Capture sheet's density** (owner: "it looks like it was zoomed in 110–120%"). No zoom was left; the design's own air was the difference. Cells sit at 7px padding on 34px rows, headers at 10.5px, the big numbers at 26px, headlines and the period name at 22px, section titles at 14px, chips and controls a size smaller, and the gaps between sections halved.

## v1.32.9 highlights

- **Not received in the Walmart app's structure** (owner: "that is what I used before and it worked well"): a collapsible **Monthly summary** with Report · Month · Year · All time, the period picker and Download Excel in its header, and a collapsible **Returns Not Received** with the search in its header, a row of count chips (All · WFS · Seller · Open cases · Partial adjustments · Loss · Reimbursed) and the old columns (PO # · Type · Product · Refunded · Amount · Walmart paid · Status).
- **The loss is visible.** The Loss chip lists every item carrying lost dollars, not only write-offs: a partial reimbursement shows "Paid back $100.00 of $153.59 — $53.59 lost" and its lost figure under the PO; a lost-after-delivery refund still outstanding counts too. The chip's rows add up to the money story's "lost".
- **Payout matching tightened** after a real report: "Refund for unused label" credits and label-charge reversals no longer count as Walmart paying a return back (a Dispute Settlement, a Shipping Protection claim payout or a lost-item reimbursement does). Profit's "other Walmart lines" no longer include the transfers to the bank.

## v1.32.8 highlights

- **Steadier scope filters on Recovery.** This period · Month · Year · All time stay put on the label row, and a picker on its own row under them (which period, month or year) is always there, so the headline, bar and legend never jump when the scope changes; the legend keeps a fixed three-column grid. Year is new. Picking a period here also selects it on Reconcile and Profit.

## v1.32.7 highlights

- **Profit, a third Recovery screen.** What Walmart paid for the orders in a period, a month or all time (each order's payout net of Walmart's fees, with its refund taken off) against the cost of the units sold, from the Stock page's Cost column; a refunded unit that came back to the warehouse recovers its cost. A headline profit with margin, a cost-vs-profit bar, orders / units / back-in-stock, a By SKU table (sold, refunded, paid, unit cost, profit, margin; listings without a cost are flagged, not guessed) and a By period table; Download Excel writes the three as sheets. The Walmart SKU reaches the inventory cost directly or through the Pricing page's channel mappings. Each import now keeps its per-order sales; periods imported before this read them back from their archived CSV when it is on this computer, else they ask to be re-imported.
- The Recovery sheet stops at 1440px and centers (it spanned the whole window in v1.32.6).

## v1.32.6 highlights

- **Recovery sits at 1:1 like Capture.** No scaling: the design's 13px type as drawn, and the sheet spans the window with Capture's 24px margins instead of a centered column. The extra width goes to the tables (set column proportions, the SKU column up to 520px so names wrap less) and the money story; the right-hand cards keep a sensible width. The Overview keeps its window scale.

## v1.32.5 highlights

- **Recovery asks for an access code.** Clicking the tab asks for a code once per app session (9419 to start); change or remove it in Settings → Recovery.
- **Imported reports land in the shared folder.** With the shared folder on, each period's original CSV is kept in a Walmart Reports folder inside it, so it reaches Drive and every desktop; with sync off it stays under Documents on this computer. Settings shows which.

## v1.32.4 highlights

- **Recovery rows lead with the channel SKU.** Both tables show the Walmart SKU (Partner Item Id) in mono as the row's line, with the product name under it in grey; search matches the SKU too.
- The window scale tops out at the 18% first approved (reached around 2150px) and grows more slowly before it; a very wide monitor no longer pushes Overview and Recovery to 35%.

## v1.32.3 highlights

- Recovery → Not received: the top section splits 3:2 so the refund-money story (headline, bar, legend) has the room its content needs and the Today card no longer carries empty space; the legend cells are wider with more air between them. They stack under 960px.

## v1.32.2 highlights

- **Overview and Recovery follow the window.** Both pages scale as one piece with the window width instead of a fixed size: the design's exact measurements at 1280px and below, about 20% larger on a 2000px monitor, 35% at most on very wide screens. Resizing the window re-fits them. The Recovery menus and dialogs ride the same scale.

## v1.32.1 highlights

- The Recovery page reads larger (owner 2026-10-12: "everything just seems super condensed" on a wide window). The whole ledger is scaled up 18% as one piece, so every measurement keeps its ratio to the design, and it may use 1280px of width before centering.

## v1.32.0 highlights

- **Recovery page.** Drop a Walmart payment-period report (the reconciliation CSV from Seller Center → Payments) and every refunded order is checked against the Returns log; the ones that never came back are listed with their dispute window so they can be chased, and Walmart's payouts show up against them as later periods are imported. Two screens: **Reconcile** (the period's received / not received / WFS waiting with a tabbed table, earlier periods, Download Excel, Remove period) and **Not received** (where the refund money went for this period / a month / all time, the Today card, the tracker with Open case · Mark approved · adjustment · pending reimbursement · write off · note · Mark received, which opens the normal receive popup prefilled). Opt-in in Settings → Pages (needs Returns); never on a capture-only station. Imports and markers ride the shared folder (`wmruns-` / `wmmarks-<STATION>.jsonl`) so every desktop sees the same periods and decisions. Settings → Recovery holds the alert email, the make.com digest webhook and the folder where each period's original CSV is kept. Spec, design and the source it was ported from: `docs/recovery/`.

## v1.31.23 highlights

- Dismiss is a red-outlined button (owner pick C), and the expanded row's bottom spacing is tighter.

## v1.31.22 highlights

- **Dismiss on the Overview.** Open a row and "Dismiss for 7 days" sits at the right of the marketplace line. The SKU leaves the list for a week (sooner if it starts selling half again as fast), and the "N ignored · Undo" footer brings every dismissed SKU back. Watch rows have no dismiss.

## v1.31.21 highlights

- **The Tracking column holds its width.** Opening the scan box on a row no longer widens the column: header and cells share one fixed width and the box fits inside it. Long tracking numbers trim with an ellipsis rather than pushing the Notes column.

## v1.31.20 highlights

- Top-left is the icon alone, no name (owner call).

## v1.31.19 highlights

- The app icon sits top-left with the name beside it (owner request).

## v1.31.18 highlights

- The Min column is gone from the Stock grid (owner: unnecessary). Minimums still drive the Low chip and the below-minimum tint on Available.

## v1.31.17 highlights

- **Updates download only when you press Update now.** The app still checks on its own and the chip turns navy with "v1.31.17 available", but nothing downloads until Update now in the chip's menu. Then the percentage fills in and the app restarts itself once the build is on disk. Windows and Mac alike.

## v1.31.16 highlights

- **Export Linnworks SKUs** (Stock → Actions): every inventory item with its channel mappings. An Excel workbook with two sheets: **SKUs** (one row per item: SKU, title, barcode, category, in stock, in orders, available, min, cost on a Cost station, then the mapped Walmart / eBay / Temu SKUs — several on one channel joined with " | " — and a Mappings count) and **Mappings** (one row per link: inventory SKU, channel, account, channel SKU, channel title, listed qty, price, WFS, listing ID). CSV saves the two sheets as two files. Items the unlisted scan skipped (zero stock) get their link records read one by one, with progress on the Actions button, so out-of-stock SKUs carry their mappings too.

## v1.31.15 highlights

- Overview row panel: the figures read Per day, This week, This month, Pace (owner order).

## v1.31.14 highlights

- The Cost column on the Stock page looks like every other column: no tinted cells, no amber header. Its fixed width stays, so opening a cost still never shifts the table.

## v1.31.13 highlights

- **Smaller update menu** (owner pick, size 1): 230px wide with 12px rows; up to date reads "You have v1.31.13 · Up to date ✓".
- **Mac in-place download retries and explains itself.** A dropped download is retried three times before the installer route stands in, and when the installer route is used the update menu says why ("the in-place download failed N min ago (reason); it is tried again 20 min after that"). An update log is kept in the temp folder for diagnosis.

## v1.31.12 highlights

- **Tab switches feel instant.** Process, the day count, Undo, the marketplace chips, the search band and the due header now flip on the click itself when you move between Overview and Capture. They used to wait for the 120ms settle timer plus a full re-render of the capture list (150ms with 30 rows, closer to half a second with 300). The heavy render now also waits for one painted frame, and the other pages skip the capture re-render altogether.

## v1.31.11 highlights

- **Update chip, design C (owner pick).** The footer's version chip carries a small dot that says the state: grey while idle, a navy halo while a new build downloads (with the percentage after the version), solid navy once it is on disk ("v1.31.12 ready"). Pressing the chip opens a short menu above it: the version you have, the one available or downloaded, Update now / Restart now, Close. Nothing opens on its own.

## v1.31.10 highlights

- The version chip in the footer is a plain square-cornered button like History beside it. The secondary button hover tint is navy now too (it was the last green left).

## v1.31.9 highlights

- **Version chip.** The footer's "Check for updates" is now a chip that reads the version you are on (`v1.31.9`); press it to check. The panel above it has a fixed width and no entrance animation, so it opens in the same spot every time (it used to slide sideways on each press).

## v1.31.8 highlights

- **Navy accent.** The app's green accent is now the icon's navy: buttons, links, hover highlights, focus rings, the row markers, the DS chip, the SKU underline, menu highlights and the loading bar. Semantic greens stay green (synced, done, "new" condition, positive deltas), as do the marketplace colours.

## v1.31.7 highlights

- The phone button on the Overview is hidden for now (owner call). The phone page itself is untouched and can come back by un-hiding the button.

## v1.31.6 highlights

- **Updates live in the footer button only.** Nothing pops up on its own any more. Click the bottom-right button and a small panel opens above it: "You're up to date (v1.31.6)", or "Version X is available (you have Y)" with Update now, which shows the download percentage and restarts the app once the build is on disk. Downloads still run quietly in the background and the button text follows ("Downloading 42%", "Restart to update vX").

## v1.31.5 highlights

- **Phone button is back.** The Overview header has the phone button again (it went missing in the v1.30.0 redesign): it shows the Tailscale QR code and link for the phone dashboard.

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
