# DWS Stock

Windows Electron app for a packing station (formerly Capture Station), built for reselling on Walmart, eBay and Temu with labels bought on the marketplace sites. Captures order number + tracking (clipboard or USB scanner), pushes completed captures to Linnworks (set tracking, attach notes, process/despatch), and gives the warehouse a live stock view. SQLite storage, daily CSV mirrors, fully silent; all feedback is visual.

## v1.32.74 highlights

- **The Profit strip stays one row.** Its numbers and words scale with the window, so a seven-figure Goods sold fits its cell on a narrower screen instead of running into the next one.

## v1.32.72 highlights

- **A click off the rows clears the yellow highlight on Reconcile.** Click a row to highlight it as before; click anywhere else on the page and every highlight comes off. Clicks inside a row, a menu or a dialog leave it.

## v1.32.71 highlights

- **The drag bar beside the Orders list is gone.** The list is always full width; a width saved earlier is dropped.

## v1.32.70 highlights

- **Orders head, version C.** The channels are a segment pill beside the title (like Period / Month / Year on Profit), the search and the icon cluster sit on the same line, and there is no rule under the title.
- **One history icon everywhere.** The clock from the Orders head is now also the price-history control on Pricing (the eye is gone), the footer History button carries it, and the receipts panel uses the same glyph. Stock rows already used it.

## v1.32.69 highlights

- **The Orders head is one line.** Title, channel tabs, search and the icon cluster sit on the rule, the active tab's underline sits on that rule, and the table starts the card. The card head appears only in History (for the date range) or when there are failed rows to clear.
- **No sub-line under the order number.** The "Walmart · captured 15:00 · + Note" line left; a note still shows as a small chip when an order has one, and the pencil on hover adds or edits it.

## v1.32.68 highlights

- **Capture is now Orders, in the Recovery style** (owner picked design B). A head with the channels as sub-tabs (All, Walmart, eBay, Temu with their counts) and the icon cluster, then one card: "Captured today" and the search on its head, the table under it. Each order carries its channel and capture time on a sub-line; the Notes column is gone (the note rides that sub-line, "+ Note" appears on hover), and so is the "due by 5:00 PM" headline. History rows keep their processed time and station on the same sub-line.

## v1.32.67 highlights

- **An expense can run from one day to another.** Give it a To date (a month of software, a week of labels) and each period, month or year takes its share by days; the row shows the share and the full amount on hover.
- **Expenses can be edited.** Edit on the Expenses tab opens the same dialog with the entry filled in; Save changes it in place on every desktop.
- **The Walmart paid cell is one line again.** The tie-out detail (pre-tracking refunds left out, statement lines on no order kept aside) moved to the cell's hover.

## v1.32.66 highlights

- **No margin without a sale.** A SKU that sold nothing in the scope (only a label credit, or only a refund of an older sale) shows a dash for margin instead of 100%.

## v1.32.65 highlights

- **A SKU's margin is on the counted money.** A pre-tracking refund left out of profit is now left out of the SKU row's Walmart paid too, so profit and margin read off the same number (a row read 106.9% because profit added the refunds back while Walmart paid still subtracted them). The row carries a small asterisk and the hover gives Walmart's own figure.
- **A refund left out of profit is struck through.** On a PO line whose sale was before your first statement and whose unit is back or pending, the Walmart paid amount shows in grey with a line through it, and the hover says why. The figure is still Walmart's own.

## v1.32.64 highlights

- **The unmapped-listing triangle sits on the centre of the SKU text** instead of hanging below it on the By SKU rows.

## v1.32.63 highlights

- **By SKU is grouped by Linnworks SKU only.** The Linnworks / Walmart switch is gone; the Walmart listings sit under each group as before. The search reads the Linnworks SKU, the product name and every Walmart (channel) SKU.
- **An audit guide for the Profit page.** docs/recovery/PROFIT-LOGIC.md spells out every rule in plain words and three checks to run against Walmart's own numbers. The Walmart paid cell now also shows the statement lines on no order (storage, ads, adjustments) kept aside, so Walmart paid ties back to the statement's Activity.

## v1.32.62 highlights

- **A refund of a sale made before your first statement no longer drags profit down while the unit is back.** Its sale income was never counted, so the whole refund used to land on profit even with the unit back on the shelf. It is now left out of profit while the return is back in stock, pending or never shipped, and counted only once it is lost. The line says "not counted against profit" or "counted against profit", the Walmart paid cell says how much was left out, and Walmart paid itself still matches the statement to the cent.
- **A "Lost in transit" or "Lost after delivery" refund waits out its window like any other return before its cost is charged.** Reconcile still chases it from day one; only the costing waits (seller-fulfilled 45 days, WFS 135 days).

## v1.32.61 highlights

- **A renamed statement gets Walmart's own period name.** The downloaded report carries the period on its summary rows — one per week paid and one for the whole statement — plus the odd adjustment row with a window of its own; the app now takes the widest of them, so SEPT_5_-_19.csv imports as "Sep 5 – Sep 19, 2026" exactly as Walmart names it, and lands on the period already in the list. Checked against the owner's three September files: three periods, no twins, 2546 orders priced, Goods sold above Walmart paid.

## v1.32.60 highlights

- **A renamed statement replaces its period instead of doubling it** (owner dropped SEPT_5_-_19.csv and got "Sep 3 – Oct 2" and "Aug 26 – Sep 18" beside the periods they should have replaced). Walmart's downloaded file carries the period on its weekly summary rows only, so a file without Walmart's own name is now named from the span of all those rows; and a file whose weeks overlap a period already imported (60% or more of the shorter span) is that period — it asks to replace, keeps the known label, and every stray twin covering those weeks goes with it.
- **The drop zone never goes quiet** (owner: "I dropped it but nothing happened"). A stuck busy flag used to swallow later drops in silence; it now says so, lets go after two minutes, and a file dropped anywhere else on the window is caught rather than opened in it.

## v1.32.59 highlights

- **Composites work** (owner: the case listing X210-64GB-GRAY-CASE-USBC draws from X210-64GB-GRAY). The Stock page lists a composite parent again — it had vanished the moment the item became a composite — with a navy "composite" tag and a read-only count that is what its parts can cover; a count typed on it is refused ("adjust the parts instead"). A composite's sale credits its parts: the tablet's pace on Overview counts the case listing's sales, so Buy now orders tablets for both and never the composite. Was selling and the six-month store count the parts the same way.
- The Shared folder readout moved off the Import screen into Settings → Shared folder (owner: "I would prefer that we didn't have it there").
- The listing count on a Profit SKU row is a faint "×2" on the baseline, not a pill (owner: "more subtle", "not centered").

## v1.32.58 highlights

- A mark takes the yellow highlight off its row (owner: "in the marked section, it randomly highlights some rows" — a row highlighted while being worked on kept its yellow after Received, Never shipped, Loss or Paid out moved it to Marked). Undo, a case ID or a note leave the highlight alone.

## v1.32.57 highlights

- **Paid out, by hand** (owner: "Case approved, and then I write the amount I was paid out by my insurance shield or by Walmart, and if less money was paid out, there is some minor loss"). The ⋯ menu on Reconcile gains "Paid out…": the amount, who paid (Walmart, Shipping protection, UPS, FedEx, USPS, Other) and the day. The row moves to Walmart paid with that payout and "Still lost" shows the gap — refund minus what was paid — so a short payout reads as the small loss it is. A payout from Walmart is a placeholder until the next statement carries the real line, which then takes over, so nothing is counted twice; money from insurance or a carrier is outside Walmart's statements, so it is added to Profit on that PO ("Shipping protection paid $150.00" on the PO line, and under Cost of goods on the strip). An open case is marked approved by it. Change or undo from the same menu; it syncs like every other mark.

## v1.32.56 highlights

- **Was selling, on Overview** (owner: "used to sell minimum 10 units a month, now out of stock … I want like a slider"). A sixth chip beside Buy now. A slider sets the monthly minimum (5 to 200) and a switch picks "out of stock" (nothing at the warehouse or WFS) or "not selling" (no sale in 14 days). Each row says "Used to sell 412 a month · Jun – Aug · out since Sep 28 · 16 days" with a seven-month bar chart, the current month in red. Monthly pace is the best 3 of the last 6 completed months averaged, so one good month does not qualify a SKU and one bad month does not disqualify it. Those six months are read from Linnworks once, behind the Overview's normal pass, one month per walk, and kept on disk; until all six are in, the bar says how many have been read. The slider and the switch are remembered per computer; Download this list as Excel writes the rows with a column per month.

## v1.32.55 highlights

- **A Shared folder readout on Import** (owner, on a new computer: "why did it not save my previous Mark received from a file?"). Under the drop zones the app lists what the shared folder holds for Recovery — each station's periods, marks and expenses files with their line counts and last write, this computer's own in navy, an unreadable file in red — and what this desktop holds (periods, marks and how many were made here). "Re-read every file" forgets how far each file was read and takes every file from the top. With sync off it says so and points at Settings → Sync.

## v1.32.54 highlights

- The Import list's rows carry only Remove (owner: "the Reconcile and Excel things are not necessary"). Clicking the period's name still opens it on Reconcile.
- **A batch re-import replaces** (owner dropped all seven files and got "9 already in the list, left as is"). When files in a batch belong to periods already imported, the app asks once — "Replace 7 periods already in the list?" — and on Replace swaps each one in place, marks kept. Files that are not payment reports (an inventory reconciliation, say) are reported as failed and ignored.

## v1.32.53 highlights

- Profit's Linnworks SKU rows drop the "1 Walmart listing" words (owner: "compress it"); a SKU with several listings shows a small count pill instead, and the SKU cell never wraps.

## v1.32.52 highlights

- The Days left, Units, Net refund and Still lost headers are wider so the filter funnel no longer sits on the words (owner: "the filter is kind of glitching right here").

## v1.32.51 highlights

- **Column filters on Reconcile** (owner: "a clickable filter for each column"). Every header carries a small funnel — faint until hovered, navy when that column is filtered. Click it for a tick-list of the column's values with counts (a search box on long lists): PO #, Type, Item, Units, Refunded by month, Net refund / Walmart paid / Still lost by dollar band, Days left by window (passed, this week, 8–14, 15–29, 30+), Reason with an Issued by section, Mark. Picks stack across columns; a bar under the tabs shows each one as a chip with an ×, Clear all and "N of M rows". Switching tabs clears them. Clicking the header text still sorts.

## v1.32.50 highlights

- **Loss is a mark** (owner: "I need a loss section … perhaps in the marked column"). The ⋯ menu on Reconcile offers Loss beside Received and Never shipped; after a confirm the row moves to the Marked tab with a red Loss chip, the date, what Walmart already paid on it, and "cost charged on Profit". Undo from the same menu. On the Profit page the unit's cost stays charged on the row that sold it ("Refunded · Marked as loss · Oct 13 · cost charged"), it counts in "lost units costed" under Cost of goods, and the refund already sits in Walmart paid. A loss with a partial payout only counts the gap as lost.

## v1.32.49 highlights

- **Who issued the refund** (owner: "does it say who issued the refund?", design A). Reconcile's Reason cell ends with one word from the statement's own description: Customer in grey, Seller in navy, Customer Care in amber; hover for Walmart's wording. On the Statement tab the Refunds line splits by issuer — Customer returns, Seller issued, Walmart Customer Care issued — with counts and dollars; new-format imports keep the description from now on.
- The Profit page's unmapped-listing triangle stands alone; the "not in the Pricing map" words are gone (owner: "unnecessary"). Hover the triangle for the note.

## v1.32.48 highlights

- **Case flag on Reconcile** (owner: "if I open up a case, I want to be able to mark them so I can come back to it", design B). The ⋯ menu's "Case opened…" takes an optional Walmart case ID and marks the row: a navy bar on its edge, a flag beside the PO, "· case 14d" after the reason. Click the flag for the case card: when it was opened and from which station, the ID with copy, the refund and what is still lost, and the ways out — open the case on Walmart, change the ID, close the case. The mark syncs to every desktop like Received and Never shipped; the yellow click-highlight stays per computer.

## v1.32.47 highlights

- The PO# menu's Transaction page opens Seller Center's PO search (`payments/transactions?searchType=poNo&searchValue=…`) instead of the free-text search box (owner: "make the transaction searches like this"). Saved settings still on the old link move over on their own; Settings → Recovery can still change it.

## v1.32.46 highlights

- The ⋯ menu on Reconcile no longer carries Highlight row / Remove highlight (owner: "unnecessary"); a click on the row still toggles the highlight.

## v1.32.45 highlights

- **The Statement tab lists every statement** (owner: "click on a statement and just have a dropdown with all the information"). One row per imported period, newest first, with Sales, Refunds, Fees, Adjustments, Activity, Total payable and Paid to you across; click a row and it drops down to Walmart's sections, one to one. The scope pill does not apply to this tab.
- The Refunded column on By SKU keeps "232 · 83 back" on one line (owner: "it looks weird and compressed").
- Hover a PO line's situation on the Profit page and the full sentence shows (owner: "I want to hover my mouse over and read, this is too long").
- The "re-import" notes say which one period's file to bring in again; it is never everything.

## v1.32.44 highlights

- **Nothing on the screen shifts any more** (owner: "this keeps shifting", "it keeps expanding", "just make it set"). The Profit scope control is now a date pill of a set width on the left ("Sep 13 – Sep 27, 2026 ▾", "October 2026 ▾") beside a segmented Period / Month / Year / All time switch whose names never change. The Cmd+F find box is a set 440px however much you type and whatever the count says.
- **The Overview filters are a segmented control** like the page tabs (owner: "the filters look ugly"): one soft track, a white pill on the one you are on, the Buy now count in quiet grey. A clash with the "vs yesterday" chip in the Sold today card had been painting them green.
- The warning triangle on an unmapped Profit row is drawn, not typed, so it sits dead centre in its circle.

## v1.32.43 highlights

- **Marks and expenses reach every desktop even when the first write missed** (owner: a file of marks did not show up on the other computers). A station's own marks file in the shared folder is rebuilt whenever it holds fewer lines than the marks the station has — an append that failed while the folder was unreachable, or marks made before sync was on — so the other desktops pick them up on their next refresh. Same for expenses. Nothing needs re-uploading.

## v1.32.42 highlights

- **Fee wording on every PO line** (owner: "include if this is a shipping label charge"). A PO that sold or refunded and also carries a fee line now says so at the end of its situation, in Walmart's words: "… · Walmart Shipping Label Service Charge", "… · Walmart Return Shipping Charge". Periods imported before the wording existed fill in from their archived file.

## v1.32.41 highlights

- The eye now sits beside the scope pill and blurs the dashboard strip only (owner: "just the top part, not everything below"); the tables, statement and PO drop-downs stay readable.

## v1.32.40 highlights

- **Expenses on Profit** (owner: "outside shipping labels, packing stuff"). An Expenses tab lists your own costs with date, category, note, optional SKU and who entered it; **+ Add expense** opens a small form. Expenses come off profit in the period they fall in: a new Expenses cell on the strip, Profit now reads after expenses, the Statement tab gains a "Your expenses" section, and the workbook an Expenses sheet. Entries sync through the shared folder like marks; Remove takes one off every desktop.
- **Margin shading on the SKU table** (owner's ask): under 10% red, 10 to 15% yellow, 15% or better green, on the Linnworks group, its listings and the flat view alike; the column still sorts.
- **The eye** (owner's ask): a button beside the scope pill blurs the dashboard strip's numbers (just the top part, the tables stay readable) for a screen share or a visitor. Press it again to show them. Remembered per computer.

## v1.32.39 highlights

- **Statement tab on Profit** (owner: "a 1 to 1 of what I see on Walmart"). The payment statement laid out as Walmart's Payments page lays it out: Sales and Refunds by line (product price, net tax collected, other taxes, net commission, net tax withheld, Walmart funded savings), Fees and Adjustments by Walmart's own description (shipping label service charge, return shipping charge, dispute settlement, shipping protection claim…), Paid to you by day, each with its total, plus the period's total payable. This period reads the statement 1:1; Month, Year and All time add statements up. Periods imported before this version fill in from their archived file, or on re-import.

## v1.32.38 highlights

- **Highlight a row on Reconcile** (owner: "see which one I am working on" while switching to the Walmart tabs). Click anywhere on a row to turn it yellow; click again to clear. The ⋯ menu has Highlight row / Remove highlight too. Highlights stay through tab switches, sorting and restarts, per computer.

## v1.32.37 highlights

- **Walmart paid tab on Reconcile** (owner: a lost-in-transit PO with a partial payout was nowhere on Reconcile). Every PO Walmart paid something on — a shipping protection claim, a dispute, a reversal — in full or in part, with what was paid and when, the payout's kind, and a **Still lost** column for the gap. Sorted by the gap, largest first, so the ones worth a UPS claim or a case sit at the top. The ⋯ menu works there as on the other tabs.

## v1.32.36 highlights

- The ⋯ menu on Reconcile offers **Received** and **Never shipped** only; "Received before the log" is gone from the menu (owner: unnecessary with Received). Earlier marks keep working and read "Received" on the Marked tab. The file import on the Import screen still takes a list of PO numbers with an optional date.

## v1.32.35 highlights

- **Buy now by units, across every SKU** (owner: "we should buy if we have less than 30–50 units left"). The cut now scans every selling SKU, not just the attention queue: under the unit floor OR under the target days on hand, at the set pace or better. Settings › Reorder gains "Buy now when under (units)", 50 by default, and "selling at least (a day)", 1 by default. The BUY quantity brings the SKU to the larger of the floor and the target's worth of sales, less what is on hand. A SKU with no other flag shows a green Stock badge.
- The Needs attention header keeps one label whatever chip is on, so the chips no longer shift when clicked.

## v1.32.34 highlights

- **A return goes home to the period that sold the unit** (owner: "margin should be based on products sold and their COGS, not the returns"). A refund usually posts in a later statement than its sale; it now counts in the sale's period, and the two halves merge into one line per PO. A unit sold, refunded and back on the shelf reads $0 in the period it sold; a kept unit reads its real margin; a unit never back is costed where it sold. The later period no longer shows a loss for phones sold earlier. All time is unchanged. A refund whose sale predates the first imported statement stays where it posted and says so.
- **Buy now on the Overview** (owner's pick). Chips in the Needs attention header: All, Buy now, Out, Low, Fast. Buy now lists every SKU selling at least one a day with under the target days on hand, out-of-stock sellers included, soonest-out first, each with a BUY quantity: sales per day × target days − on hand at the warehouse and WFS. Red when inside the lead time, yellow otherwise. The count row gains "to buy now" and the footer downloads the list as Excel.

## v1.32.33 highlights

- **Find on page (Ctrl+F / Cmd+F) types properly again** (owner: "I can't type one letter at a time"). Chromium's own find also matched the text in the find box and kept taking the selection. Find now runs in the page itself: matches are painted with the browser's highlight API, pale for every match and amber for the current one, the box keeps its focus, and the bar's own text is never a match.

## v1.32.32 highlights

- **Received, from the ⋯ menu on Reconcile** (owner's ask). Marks the PO received today. It is a mark only: nothing is written to the Returns log and no Linnworks quantity moves. Profit treats it as back in stock. The Marked tab shows "Received · came back <date>" and can undo it. Received before the log and Never shipped stay as they were.
- **The statement's own wording on fee lines.** A PO row that is only a fee or a reversal reads with Walmart's words, such as "Walmart Return Shipping Charge" or "Customer Return Reversal", instead of a generic adjustment. Takes effect when a period is re-imported.

## v1.32.31 highlights

- **A $0 cost no longer reads as 100% margin.** A cleared cost ($0.00) counts as no cost set, so the listing shows "no cost set" and stays out of profit until a real cost is typed.
- **Clearer PO lines.** A refund row whose sale was in another period no longer says "not costed yet" or "cost charged" — those words belong to the row that sold the unit. A PO row that is only a Walmart adjustment (no units sold or refunded, a label charge or fee) reads "Walmart adjustment on this PO" instead of "Sold, kept".

## v1.32.30 highlights

- **A return of an earlier period's sale now recovers its cost** (owner: "why is my margin so low" on August). A PO's sale and its refund usually land in different payment periods, so the app held them as two rows and judged each on its own: the sale row never saw the refund, so a unit that came back, or was still pending, kept its full cost charged forever, while the refund row carried the payout hit with no relief. The standing is now judged on the whole PO across every period. The relief (back in stock, pending, never shipped) lands on the row that sold the unit, in that period, and the refund row keeps its payout hit in its own period. Each PO's line says "refund in another period" or "sold in another period" when that is the case.

## v1.32.29 highlights

- **Re-importing a period kept losing its archived file.** Replacing a period wrote the new file first and then, cleaning up the old run, deleted the period's archive — the file it had just written. The old run is now replaced before the file is archived, so the archive stays and the goods-price backfill has something to read.
- A period whose stored orders carry no goods price at all (zero on every order, not only missing) is backfilled from its archive like a pre-v1.32.13 period, and the import message says when a file itself carries no goods price.

## v1.32.28 highlights

- **Bulk import of payment reports** (owner's ask). Drop several statement CSVs on the Import screen at once, or pick several in the Browse dialog. They import one after another, oldest period first, with a running "Importing 2 of 7" line and a summary at the end. A period already in the list is skipped in a batch; drop it alone to be asked about replacing it.
- The new statement layout's goods price is read from its own column or the first price-like column on a SALE row, so a period in that layout is less likely to read "no goods price".

## v1.32.27 highlights

- **Type a cost on the Profit table** (owner: listings whose Linnworks mapping was removed when they shut down still need a cost). Click "no cost set" in the Unit cost column, type the cost, press Enter. It is saved under that SKU in the same cost store the Stock page's Cost column uses, syncs through the shared folder, and Profit recalculates at once. Same station gate as the Cost column (Settings › Pages › Cost).
- **⚠ on unmapped listings.** A Walmart listing the Pricing page does not map to a Linnworks SKU carries a yellow ⚠ beside its SKU, in both the grouped and the flat view, like Capture's unmapped-condition mark.

## v1.32.26 highlights

- **Profit grouped by Linnworks SKU** (owner: "organize it by Linnworks channel SKU"). The By SKU table now lists Linnworks SKUs from the Pricing page's channel map, with the totals of every Walmart listing under them. Open a group for its listings, open a listing for its POs. A listing the map does not know stays on its own row marked "not in the Pricing map". A pill in the tab row switches to the flat Walmart SKU view. The workbook's By SKU sheet gains a Linnworks SKU column.
- **Profit and margin count costed orders only** (owner: "why are my margins so high"). Payout from a listing with no cost set used to land in Profit as if it were pure margin ($170,664 of it in one period). It is now left out and reported in the No cost set cell; the margin is profit over the payout of costed orders. The By period tab and workbook follow the same rule.

## v1.32.25 highlights

- **Goods price found in every archive folder.** A period imported before sync moved the archive folder (or on a computer whose Documents folder holds the file) showed "price not in this period yet" because the backfill looked in one folder only. It now checks the current folder, the Documents folder and the shared folder, and looks again on every refresh, so turning sync on or copying a statement in fills the price without a restart. A period still without a file says so on the strip and the By period tab: re-import it on the Import screen.

## v1.32.24 highlights

- **Pending returns are not costed yet** (owner: "if a return is pending, why would you deduct from the profit just yet?"). A refunded unit inside its window (45 days seller, Walmart's 90 days or the 135-day filing window for WFS, a case open, or parked) keeps its cost out of Cost of goods and shows in a new **At risk** cell instead. It is costed the day the window closes with no case, when it is marked lost or written off, or when Walmart pays instead. Back in stock and Never shipped work as before. Each PO's line in the SKU drop-down says which it is.
- **Goods sold, avg price and commission count priced orders only.** Periods imported before the price columns existed, with no archive on hand, used to drag goods sold down while their payout counted in full (September read Walmart paid $903k against $545k goods sold). The strip now says "N of M orders priced, re-import the rest" and the By period tab marks those periods.
- The two Profit charts are gone (owner: "not even necessary").

## v1.32.23 highlights

- **Units sorts least to greatest** on the first click (owner's ask); a second click flips it. Money and Days left keep their own first directions.

## v1.32.22 highlights

- **Every Reconcile header sorts** (owner: "clickable column headers, not buttons"). Click PO #, Type, Item, Units, Refunded, Net refund, Days left or Reason to sort; click again to flip. Untouched, Not received and WFS pending run soonest-to-file first, so the red and amber rows sit at the top; the Marked tab runs newest refund first. Switching tabs resets the sort.

## v1.32.21 highlights

- **Days left on Reconcile** (owner: "timers for each of the not received"). A column after Net refund counts the days left in each PO's window: 45 days from the refund for seller returns, 135 for WFS, 90 for WFS pending. The cell shades like Excel conditional formatting: white with 30 or more days, paler to darker yellow under 30, red at 0, and the number keeps counting into the negatives once the window has passed. Hover the cell for which window it is.
- The checkbox column and its selection bar are gone from Reconcile (owner: the file import does the bulk work). The ⋯ on a row still offers **Received before the log** and **Never shipped**, and the Import screen still takes a file of PO numbers.

## v1.32.20 highlights

- **Two marks on Reconcile** (owner: returns that came back before the software existed, and refunds on orders that never shipped). The ⋯ on a row offers **Received before the log** and **Never shipped**; a checkbox column with a selection bar marks many at once (shift-click for a range, the header box for the whole tab). A **Marked** tab shows every marked PO with which station set it and when, and undoes it. Received before the log takes the PO off Not received and recovers its cost in Profit, like a logged return would; Never shipped takes it off and charges no cost, since nothing left the warehouse. The Returns sheet is never touched. Marks live in the app's database and the shared folder's mark log, and show in the audit workbook.
- **Mark received from a file** on the Import screen: drop a CSV or text file of PO numbers (any header; an optional date column); it says how many are on the list before it marks them.

## v1.32.19 highlights

- Reconcile gains a **Units** column per PO (owner: "include the units for each of the PO#s"): the refunded units on that order, from the report's own quantity.

## v1.32.18 highlights

- **Reconcile, barebones** (owner: "I quite literally just want to see the item we have not yet received back… then I will tell you what more to add"). Recovery is Import · Reconcile · Profit. Reconcile is two tabs and seven columns: **Not received** — every return not back yet, seller and WFS past its 90 days — and **WFS pending** — every WFS refund still inside its 90 days. PO # · Type · Item · Refunded · Net refund · Reason. No period row, no strip, no chips, no actions; a PO # still opens the Walmart menu. The Not received screen, its strip and its filters are gone (the engine behind them stays, for when they come back).

## v1.32.17 highlights

- **Search looks across every chip** on Not received (owner: a PO typed under Seller came back "Nothing matches" because that PO sat under Reimbursed). Type a PO, SKU or case ID and the row shows whichever chip it lives under; its Action column says what state it is in.

## v1.32.16 highlights

- **A SKU on Profit opens its POs** (owner: "a dropdown where I can see all the relevant PO#s for each item"). The caret on a By SKU row drops a list of that SKU's orders: PO (click it for the Walmart menu), date, units, refunded, Walmart paid, and a situation — Sold, kept · Refunded, back in stock, cost recovered · Refunded, Open case now · Refunded, Partial payout… Refunds come first; long lists show five sales and a "show all".
- A closed dispute window reads **Closed · 7 days** (owner's wording) instead of the sentence.

## v1.32.15 highlights

- **Not received in the Profit language** (owner: "make this page also look better"). The scope pill with Download Excel beside it, a strip of where the refund money went (refunded, came back, Walmart paid back, waiting on WFS, being chased, lost in red), then one grid: PO # · Type · SKU · Reason · Refunded · Amount · Paid back · Lost · Action · Deadline. The status sentence is now an action of a word or two ("Open case", "File with WFS", "Wait", "Partial payout", "Write off?") and a deadline date; the long form lives on hover. The fold and the Today card are gone; their numbers sit in the strip.
- **Click a column header to sort** (owner: "pressing PO# in Loss, greatest to least"): PO # on the Loss chip sorts by the lost dollars biggest first; Amount, Paid back and Lost by their dollars; Refunded by date; Deadline soonest first; a second click flips.
- **Who issued the refund** is read from the statement's Transaction Description (Return Refund, Seller Initiated Returns, Walmart Customer Care Refund) and shows on hover over the Reason cell; older periods fill in from their archived CSV.
- **Return page** joins Order page and Transaction page on a PO # click, using the Seller Center returns search the Returns page already opens.
- **Find on this page** with Ctrl+F (Command+F on Mac): a small bar top right, matches highlighted by Chromium itself, a count, Enter / Shift+Enter to step, Esc to close. Works on every page.
- **Changing a chip or sorting no longer scrolls the page back to the top.**
- The Recovery searches wear the Stock page's pill with the magnifier; Profit's Excel export is a tray icon beside it; the sales chart reads in percentages, not cents.

## v1.32.14 highlights

- **Profit as a dashboard** (owner: "make it better with graphs", Design 3 of three). A strip of five totals (goods sold, Walmart paid, cost of goods, profit with its change against the last period, listings with no cost), then two charts: **where the sales money went** (cost of goods, refunds and fees, commission, profit, each as a share of goods sold) and **profit by SKU** (the top earners in navy, the losers in red; a bar click finds the SKU in the table). The scope control is one pill like the page tabs: its active segment names the period, month or year and opens the picker (owner: "make the drop down better and in tune with the design"). The header's Download Excel is gone; an Excel button sits with the table.
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
