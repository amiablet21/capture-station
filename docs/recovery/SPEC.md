# Recovery page for DWS Stock — build spec

*Name:* the tab is **Recovery** (one word, like Capture / Stock / Returns). It replaces the working title "Recovery" used earlier in this conversation; the two screens are **Reconcile** and **Not received**.

**Purpose.** Move the Walmart accounting app's one job into DWS Stock as a new page:
drop a Walmart payment-period report → see every refunded order that never came
back (**Returns not received**), chase it through the dispute window, and watch
Walmart's payouts land. The Returns log DWS Stock already keeps becomes the
warehouse record it checks against, so returns are logged once.

Everything below is the behavior of the Walmart accounting app
(`walmart-reconciliation-app` v1.4.4) as built, with the places where DWS Stock
already provides the piece called out. Rules marked **(owner decision)** were
settled with the owner and should not be re-litigated. Open questions are
collected in §12.

Source files this was lifted from (read them for exact code when in doubt):
`src/lib/parseReport.js`, `src/lib/reconcile.js`, `src/lib/excel.js` (`classify`),
`src/lib/rnrStore.js`, `src/lib/core.js` (`runReconcile`, `checkRnr`,
`aggregateSettlements`, `bucketTotals`, `rnr*Summary`, `exportRnrMonthly`,
`exportRnrAudit`, `importRnrCorrections`, `buildDisputeDigest`,
`sendDisputeDigest`, `rnrEmailMailto`, `periodFromReportName`), and the RNR
section of `src/renderer/renderer.js` (`rnrMatchesFilter`, `rnrBadge`,
`rnrActionCell`, `renderRnr`, `renderMsum`).

---

## 1. Placement in DWS Stock

- **One page, "Recovery".** Either its own tab after Returns, or an entry in
  the Returns tab dropdown (Returns log | Shelf | **Recovery**). Hidden until
  ticked in Settings → Pages, exactly like Pricing (`pages.recovery`, default off;
  requires `pages.returns` since it reads the Returns log).
- **Admin-side only.** Capture-only stations never see it.
- **Storage:** SQLite tables in `capture-station.db` (§10) plus retsync aux logs so
  every desktop sees the same imported periods and the same manual markers (§10.3).
  This replaces the Walmart app's corrections-CSV export/import dance.
- **No files are written** when a period is imported. Excel is on demand only.
- **Design (settled):** the Claude Design canvas
  https://claude.ai/artifact/Equgknt33s5P1XmaNPEnBG — two artboards, Reconcile
  and Not received. Static copies of both artboards live in
  `design/`. §13 describes the layout; it supersedes the
  Walmart app's own tile-and-table layout wherever the two differ.

---

## 2. Inputs

### 2.1 The Walmart reconciliation report (one CSV per payment period)

Downloaded from Seller Center → Payments. Filename pattern
`Digital_World_Shop_10001467995_MP_<MMDDYYYY>_reconciliationreport.csv`. Two
layouts exist; detect by column: **old format** has a `Period Start Date` column,
otherwise **new format**. Strip a leading UTF‑8 BOM before parsing. Parse with
`header: true`, skip empty lines. **PO numbers are always strings** (13–15 digits,
never coerced to numbers).

| Standard field | New format column | Old format derivation |
|---|---|---|
| PO # | `Walmart.com PO #` | `Purchase Order #` |
| Order # | `Walmart.com Order #` | `Customer Order #` |
| Refund Date | `Transaction Date Time` (first 10 chars, `MM/DD/YYYY`) | `Transaction Posted Timestamp` (same) |
| Item | `Partner Item name` | `Partner Item Name` |
| SKU | `Partner Item Id` | `Partner Item Id` |
| Return Reason | `Return Reason Description` | `Transaction Reason Description` |
| Refunded Retail Sales | sum of `Refunded Retail Sales` over the PO's `REFUNDED` rows | sum of `Amount` where `Transaction Type = Refund` **and** `Amount Type = Product Price` |
| Net Refund (Payable Impact) | sum of `Payable to Partner from Sale` over the PO's `REFUNDED` rows | sum of **every** `Amount` row with `Transaction Type = Refund` for that PO |
| Qty | one `REFUNDED` row = one unit | `Ship Qty` on the `Product Price` line (one line can be 13 units); `max(1, trunc(abs(qty)))` |
| Fulfillment Type | `Fulfillment Type` | `Fulfillment Type` |

Refund rows: new format `Transaction Type === "REFUNDED"`; old format
`Transaction Type === "Refund"`. Group by PO (one record per PO; split refunds on
the same PO are summed). After grouping, **sign-flip** both money fields so a refund
shows as a positive amount owed; parse the refund date to a local-midnight Date
(`refundDateParsed`, null if unparseable). **Net Refund (Payable Impact) is the
number that matters** — it matches the figure on the Walmart payment statement.
**If the report has no refunds, say so and import nothing.**

Fulfillment values: `"Seller Fulfilled"` vs `"Walmart-fulfilled(WFS)"`. Type
helper: `/wfs|walmart-fulfilled/i` → `WFS`, else `Seller`.

### 2.2 Period label (what the run is called)

1. From the filename: `MP_MMDDYYYY` is the **payment date**. The statement period
   Walmart shows is `paid − 17 days` → `paid − 3 days` (verified against the owner's
   Statements page; e.g. paid Jun 2 ↔ "May 16 - May 30"). This is authoritative.
2. Else old-format `Period Start Date`/`Period End Date` columns.
3. Else min/max refund date across the report (misleading for new-format files).
4. Else the filename with the `Digital_World_Shop_10001467995_MP_` prefix and
   `_reconciliationreport` suffix removed.

Format: `Apr 19 - May 15, 2026`; across years `Dec 28, 2025 - Jan 5, 2026`.
Labels must stay filesystem-safe (letters, digits, space, comma, hyphen).

### 2.3 Walmart payouts in the same file ("Walmart paid you back")

Scan **every row** (not just refunds). A row is a payout when `Transaction Type`,
`Transaction Description` / `Transaction Reason Description`, or `Amount Type`
matches `/dispute|claim|reimbursement|shipping protection|payout/i`, **and the
amount is positive** (credits to you only; the negative "Walmart Shipping Label
Service Charge" shares the Fee/Reimbursement amount type and is excluded by the
sign). Amount = `Amount` (old) / `Payable to Partner from Sale` (new). Group by PO:
`{ amount (sum), date (first seen, 10 chars), kind }` where `kind` is `dispute`
if type/description contains "dispute", else `adjustment`; a PO with both →
`mixed`. Three real-world shapes: Dispute Settlement (a case you won); claim
payouts on an Adjustment line ("Shipping Protection Claim Payout"); automatic
lost-item reimbursements on `Fee/Reimbursement` (base $100, up to sale value,
capped $500 if insured).

### 2.4 Per-transaction ledger (kept per run, feeds the summaries)

Minimal rows: `{ po, order, type, date (ISO day), amount }`. Old format: group by
`Transaction Key` (fallback `po|type|n`), skip `PaymentSummary`, type as-is,
amount = sum of `Amount`. New format: one row per CSV row, type mapped
`SALE→Sale`, `REFUNDED→Refund`, amount = `Payable to Partner from Sale`. The
summaries (§8) use `type === "Refund"` rows and positive `/dispute/i` rows.

### 2.5 The Returns log (DWS Stock's `returns` table — replaces the Walmart app's warehouse log)

The Walmart app matched against its own `warehouse.json`. In DWS Stock use the
**fold of every station's returns** (`retsync.list()` when sync is on, else the
local `returns` table). For each return record, the PO is `order_number`; the
items carry `price`, `condition`, `qty`. Derive, per PO:

- `count` = number of return **records** whose `order_number` equals the PO
  (trimmed). Multi-unit items inside one record are one record.
- `price` = the first non-null item `price` in log order.
- `condition` = the first non-empty item `condition`.
- `warehousePoSet` = set of all POs with `count ≥ 1`.

Records with an empty `order_number` (unmatched / bulk WFS removal boxes) cannot
match and are ignored here (§12 gap 1).

Refuse to import a period when the Returns log is completely empty (every PO
would be flagged missing). Message: *"Your returns log is empty — log returns
first, otherwise every PO would be flagged as missing."*

---

## 3. Import a payment period (Step 1)

1. Read the CSV; parse refunds (§2.1). No refunds → stop with the message above.
2. Compute the label (§2.2) and `csvHash = sha256(file text)`.
3. **Duplicate guard (owner decision):** if any stored run has the same `csvHash`
   **or** the same label, stop and ask: *"This exact file was already imported as
   "<label>" (<ran when>)"* or *"A report for <label> was already imported (<ran
   when>). Re-import and replace it?"* → Re-import / Skip. A forced re-import
   replaces the run with that label.
4. Archive the original CSV as `Walmart_Report_<label>.csv` (one per period,
   overwritten on re-import) in a folder the user can open from Settings. Optional
   in DWS Stock; keep if cheap.
5. Classify every refunded PO against the Returns log (§4) and keep the resulting
   three-bucket summary on the run (§5). **Do not write a workbook.**
6. Parse payouts (§2.3) and the ledger (§2.4); store them on the run.
7. If a run with the same label existed: delete its RNR items (`sourceRunId`),
   its ledger and payouts, then save the new run (`id = uuid`, `ranAt = now`,
   `csvName`, `csvHash`, label, counts, summary, refund count, seller/WFS counts,
   returns-log size).
8. Add not-received POs to the RNR tracker (§6.1).
9. Recompute every RNR status (§6.2) and send the dispute digest if due (§9.1).

Progress text while running: "Reading Walmart report…" → "Found N refunded POs
(<format> format). Checking against returns log…" → "Summarizing…". Done line:
*"Done — <label> is summarized below. Nothing was written to disk; use Download
Excel if you want a workbook."*

**Deleting a run** removes its RNR items, ledger, payouts and archived CSV
(**owner decision:** confirm first: *"Delete the "<label>" run? Its not-received
data is removed too."*).

---

## 4. Matching rules (`findIssues`)

Constants: `AGED_THRESHOLD_DAYS = 30`, `WFS_OVERDUE_DAYS = 45`,
`PRICE_MISMATCH_TOLERANCE = 1.00` (dollars). `isLostReason(row)` =
`/lost/i.test(Return Reason)` ("Lost in Transit", "Lost After Delivery").
`daysOld = floor((todayMidnight − refundDateParsed) / 1 day)`.

Split refunds into **seller** (`Fulfillment Type === "Seller Fulfilled"`) and
**wfs** (`=== "Walmart-fulfilled(WFS)"`). Any other value is dropped.

**Seller-fulfilled** — `Issues` is a comma-joined list, or `"OK"`:

| Condition | Tag |
|---|---|
| `count === 0` and lost reason | `LOST` (case can be opened immediately, no aging clock) |
| `count === 0`, not lost | `MISSING`; plus `AGED` if `daysOld > 30` |
| `count > 1` | `DUPLICATE` (logged more than once — review) |
| `count ≥ 1` and lost reason | `LOST_BUT_RECEIVED` (marked lost yet it arrived — review the refund) |
| `count ≥ 1` and `price` known and `abs(price − Refunded Retail Sales) > 1.00` | `PRICE_MISMATCH` |

**WFS** — exactly one of: `LOST` (count 0 + lost reason), `WFS_OVERDUE` (count 0,
`daysOld > 45`), `WFS_PENDING` (count 0 otherwise), `RECEIVED` (count ≥ 1), or
`RECEIVED, LOST_BUT_RECEIVED`.

Every row also gets `Warehouse Count`, `Warehouse Price`, `Warehouse Condition`.

These are the same rules as the original Google‑Sheets‑era Python script
(`walmart-reconciliation/scripts/reconcile.py`): MISSING, AGED (>30 d), DUPLICATE,
PRICE_MISMATCH (>$1), WFS listed for reference. The app added LOST,
LOST_BUT_RECEIVED and the WFS pending/overdue split. Nothing from the spreadsheet
workflow is missing.

---

## 5. The three-bucket summary shown after an import (`classify`)

| Bucket | Rows | Order |
|---|---|---|
| **Not received** | seller `LOST` + WFS `LOST`, then seller `AGED`, then seller `MISSING` (recent) | lost → aged → recent, then biggest Net Refund first |
| **WFS waiting** | `WFS_OVERDUE` then `WFS_PENDING` | overdue first, then biggest first |
| **Received** | seller with `count ≥ 1`, WFS with `RECEIVED` | rows with a Note first, then biggest first |
| *Act now* (sub-count of Not received) | lost + aged | |

Row decoration: Not received / WFS waiting get `Days Ago`, `Status`, `Action`:
`Lost (per Walmart)` / `Open dispute / case now`; `Missing >30 days` / `Open
dispute now`; `Missing (recent)` / `Watch for arrival`; `Overdue (>45 days)` /
`Open case with Walmart`; `Pending` / `Wait — within return window`. Received rows
get `Note`: "Price differs from refund" · "Logged more than once" · "Marked lost
but arrived — review refund" (joined with " · ").

Stored columns — not received / WFS waiting: `PO #, Order #, Refund Date, Days
Ago, Item, Refunded Retail Sales, Net Refund (Payable Impact), Return Reason,
Fulfillment Type, Status, Action`; received: `PO #, Order #, Refund Date, Item,
Refunded Retail Sales, Warehouse Price, Warehouse Condition, Fulfillment Type,
Note` (+ Net Refund for totals). Counts per bucket = `{ count, total }` where total
sums Net Refund; also keep the fine-grained counts (lost, agedMissing, missing,
duplicates, mismatches, wfsOverdue, wfsPending).

UI (see §13.1): the three bucket counts are three large numbers in one card with
a proportional bar of the period's refund dollars under them; the three buckets
are **tabs on one table** (Not received · WFS waiting · Received), not three
stacked tables; the table's last column, "What to do", renders Status + Action as
one sentence ("Open a case now — lost per Walmart"). **Download Excel** builds a
workbook (Summary sheet: Received / Not received / of which act now / WFS waiting
/ of which overdue, with counts and $; then Not Received, WFS Waiting, Received
sheets with the columns above, money formatted, TOTAL row, autofilter, frozen
header). Earlier periods are a short list under the drop target, each with an
Excel link; Remove period sits in the period card.

---

## 6. Returns not received tracker (Step 2)

### 6.1 Items

After every import, add one item per not-received PO that is not already tracked
(**known POs keep their markers — re-importing never resets a decision**). Source
rows: WFS rows with `Warehouse Count === 0` (pending, overdue or lost) and seller
rows tagged `MISSING` or `LOST`.

```
{ po, order, item, qty, refundDate ("MM/DD/YYYY"), amount (Net Refund), reason,
  lost (bool), type ("WFS"|"Seller"), sourceRunId, addedAt,
  settlementSeen|settlementDate|settlementKind (derived, §6.2),
  // manual markers (local decisions, synced via aux log):
  caseOpened, caseOpenedAt, caseId, caseApproved, caseApprovedAt,
  adjustment, adjustmentAt, reimbursePending, reimbursePendingAt,
  writtenOff, writtenOffAt, note, noteAt }
```

Items whose `sourceRunId` no longer exists are pruned on every refresh.

### 6.2 Status — derived on every load, never stored sticky (owner decision)

Priority order:

1. `received` — PO is in `warehousePoSet` (the Returns log). **Received items
   leave the list entirely.**
2. `loss` — `writtenOff` flag (legacy: PO in a warehouse Loss list).
3. `reimbursed` — `settlementSeen > 0`.
4. `reimbursed_pending` — manual `reimbursePending` flag.
5. `outstanding` — everything else.

`settlementSeen` is re-derived every refresh from **all runs' payouts** summed per
PO (`aggregateSettlements`: amount summed, date = first seen, kind = `mixed` when
runs disagree). Money never changes physical status; it just becomes visible.

### 6.3 Dispute-window decoration (computed, not stored)

Constants: `SELLER_DISPUTE_DAYS = 45`, `WFS_REIMBURSE_DAYS = 90`,
`FILE_WINDOW_DAYS = 45` (WFS hard deadline = 135 d), `FILE_SOON_DAYS = 10`.

`chaseable = status === "outstanding" && !caseOpened && !adjustment`. If chaseable
and `daysOld` known:

- `lost` → `needsAction = true` (act immediately).
- WFS: `days < 90` → `wfsWaiting`, `daysLeft = 90 − days` (Walmart auto-reimburses
  within ~90 d, no action); `90 ≤ days < 135` → `wfsDisputeOpen`, `daysLeft = 135 −
  days`, `needsAction`; `≥ 135` → `windowClosed`, `daysLeft` negative, `needsAction`.
- Seller: `daysLeft = 45 − days`; `≤ 0` → `windowClosed` + `needsAction`; else
  `needsAction = daysLeft ≤ 10`.

Chaseable + lost with no date → `needsAction`.

### 6.4 Case workflow (manual markers)

- **Open case** (asks for an optional Walmart case ID): `caseOpened = true`,
  `caseOpenedAt` set once, `caseId`; clears `adjustment` (**mutually exclusive**).
  Drops the item out of "needs action" and into the Open cases filter.
- **Undo case**: clears `caseOpened/At`, `caseId`, `caseApproved/At`.
- **Mark approved / Undo approval** (only on an open case): Walmart emailed that
  they will pay; `caseApprovedAt` restarts the payment clock.
- **Case ID** editable any time without touching `caseOpenedAt`.
- **Payment cycles since opened** (`cyclesSinceCase`): number of imported runs whose
  **period end date** (parsed from the label) is after `caseApprovedAt` if approved
  else `caseOpenedAt`. Keyed to the period end, not import time, so backfilling old
  periods on a new computer does not count cycles that never elapsed.
- **`caseIssue`** = open case, still outstanding, `cyclesSinceCase ≥ 2` → forced
  `needsAction` ("Issue · unpaid — follow up with Walmart").
- **Mark adjustment / Undo**: a self-initiated partial refund that is not a real
  return (missing part, billing correction). Not chased, not a loss; clears any
  case markers. Lives in the Partial adjustments filter.
- **Pending reimbursement / Undo**: you expect Walmart to pay before the cycle
  posts; shows under Reimbursed as pending; auto-promotes to confirmed when a payout
  appears in a later import.
- **Loss / Un-mark loss** (confirm first): `writtenOff` flag. Written-off items stay
  in the Loss filter and the audit export only.
- **Received ✓** (confirm first): creates a Returns-log entry for the PO so the
  status derives to `received` and the item leaves the list. In DWS Stock this
  should open the normal **receive popup prefilled with the PO** so a condition,
  SKU and stock move are recorded properly (§12 gap 2).
- **Add / Edit note**: free text pinned to the PO (`note`, `noteAt`); a "Note"
  button on the row shows it on hover.
- **Remove** (rarely used): drop the item from the tracker.

### 6.5 Filters, sort, search

Each item lives in exactly one filter (**owner decision**):

| Filter | Rule |
|---|---|
| All | `outstanding && !caseOpened && !adjustment` (your un-actioned to-do) |
| WFS | All ∧ `type === "WFS"` |
| Seller | All ∧ `type === "Seller"` |
| Open cases | `outstanding && caseOpened` |
| Partial adjustments | `outstanding && adjustment` |
| Loss | `status === "loss"` |
| Reimbursed | `reimbursed` or `reimbursed_pending` |

In the settled design (§13.2) these are **underlined tabs on the table** — To do
(= All) · Cases · Adjustments · Reimbursed · Lost — each with its count in mono,
plus two text toggles, "WFS only" / "Seller only", that narrow whichever tab is
active (so WFS and Seller are modifiers, not tabs). Search matches PO, product
name, case ID and note (case-insensitive substring). Sort: `needsAction` first,
then oldest refund first. The page sub-tab carries the `needsAction` count in red
mono; the "Today" card shows to file now / waiting / cases open with totals.

### 6.6 Columns and the status badge

Columns (§13.2): **PO** (mono, with the type — WFS / Seller — and the case ID as
a muted second line) · **Item** · **Refunded** (`Mon D · Nd`) · **Amount** ·
**Paid back** (`settlementSeen` or "—", date on hover) · **Status** · actions.
Status is **plain text with an 8 px colored dot**, not a pill: a bold lead phrase
in the tone color, then a muted dash clause. The table below gives the lead
phrase and clause for each state; the tooltip column is the hover text.

| State | Lead phrase — clause | Dot / tone | Tooltip |
|---|---|---|---|
| outstanding, adjustment | `Adjustment` — self-initiated partial refund | navy | not a return to chase |
| outstanding, case, `caseIssue` | `Unpaid after N cycles` — opened <Mon D> | amber `#D4A531`, text `#956400` | "<Approved\|Case opened> but no reimbursement after N payment cycles — follow up" |
| outstanding, case, approved | `Approved <Mon D>` — awaiting payout | green `#346538` | "Walmart approved <date> — awaiting payout" |
| outstanding, case | `Case opened <Mon D>` — case <id> | blue `#4F6FA3` | "Case filed <date>" |
| outstanding, lost | `Lost` — file now | red `#9F2F2D` | you can open a case immediately |
| outstanding, WFS waiting | `Walmart pays back by day 90` — N to go | blue `#4F6FA3` | expect it in the settlement report within N days; no action yet |
| outstanding, WFS dispute open | `Dispute open` — N days to file | red | no auto-reimbursement showed up; file within N days (closes 135 d after the return) |
| outstanding, window closed | `Window closed N days ago` — write off? | grey `#787774` | can no longer file — write it off as a loss |
| outstanding, seller | `N days left to file` | red if needsAction else amber | dispute window closes in N days — 45 days from the refund |
| reimbursed_pending | `Pending reimbursement` — marked <Mon D> | amber | auto-confirms when a payout appears in an imported report |
| reimbursed | `Paid back in full` / `Paid back $X of $Y` — seen <Mon D> | green | partial when `settlementSeen < amount − 0.01`; `kind` (dispute / adjustment / mixed) on hover |
| loss | `Written off` — <Mon D> | grey | |

Open cases show the case ID on the PO's second line ("Seller · case WM-4471982";
click to edit, "add case ID" when empty); the cycles count and opened/approved
date are the status clause (see above).

Row actions: one contextual button plus a "⋯" menu. The button is **filled navy
only when the row needs action now** (Open case on lost / dispute-open / closed
rows); otherwise it is an outlined button (Open case on a seller row still inside
its window, Mark approved on an open case) or absent (WFS waiting, reimbursed,
loss, adjustment).

| State | Primary | Menu |
|---|---|---|
| outstanding, plain | **Open case** | Received ✓ · Loss · Mark adjustment · Add/Edit note |
| outstanding, case | — | Mark approved / Undo approval · Undo case · Received ✓ · Loss · note |
| outstanding, adjustment | — | Undo adjustment · Received ✓ · Loss · note |
| reimbursed | — | Received ✓ · Loss · note |
| reimbursed_pending | — | Undo reimburse · note |
| loss | — | Un-mark loss · note |
| received | (row is gone) | |

---

## 7. Exports and portability

- **Download CSV (this view):** `PO #, Type, Product, Refund Date, Days Old, Refund
  Amount, Walmart Paid, Status, Needs Action`. Write the PO as `="129…"` so Excel
  keeps 15-digit POs as text.
- **Audit workbook** (`Returns_Not_Received_Audit.xlsx`): every item with Stage
  (`Received`, `Loss (written off)`, `Reimbursed[ (partial)]`, `Pending
  reimbursement`, `Partial adjustment`, `Issue - approved unpaid`, `Approved`, `Case
  opened`, `Lost`, `Dispute window closed`, `Dispute open`, `Auto-reimburse
  (waiting)`, `Outstanding`), Dispute window text (`file now`, `closed Nd ago`,
  `auto-reimburse in Nd`, `Nd left to file`), case fields, cycles, adjustment, needs
  action, note. Frozen header, autofilter, money formats, PO column text.
- **Corrections CSV** (export/import between computers): `PO #, Case opened, Case
  ID, Case opened at, Approved, Approved at, Loss, Adjustment, Pending
  reimbursement, Note`; only POs with at least one marker are exported. Import is
  authoritative per column for matching POs; unknown POs are counted and skipped.
  **In DWS Stock the aux sync log makes this unnecessary — keep only if wanted as a
  backup.**

---

## 8. Summary tiles (Report / Month / All time)

Bucket math (`bucketTotals(refundTxs, items)`), rounded to cents:

- `returns` = Σ |amount| of refund ledger rows in scope; `returnsCount` = rows.
- For each RNR item in scope (skip `received`): `notReceived += amount`; then
  `loss` += amount if status `loss`; `reimbursed` += min(settlementSeen, amount)
  if `reimbursed`, and the gap (`amount − paid > 0.01`) adds to `loss`;
  `adjustments` += amount if `adjustment`; `loss` += amount if `lost` and reason
  matches `/after delivery/i`; else `pendingWfs` / `pendingSeller` += amount.
- `received = max(0, returns − notReceived)`.
- **Dispute wins** = positive `/dispute/i` ledger rows for POs that are **not**
  tracked as not-received (those are already in Reimbursed): amount and PO count.

Scopes: **This period** (= Report: one imported run = one payment cycle; refunds
from that run's own ledger, items by `sourceRunId`; newest period first by the
label's start date); **Month** (calendar month of the refund date across the
deduped ledger, items by refund-date month); **All time**.

Presentation (§13.2): **not tiles.** One headline, `$<returns> refunded ·
<scope label>`, then a single proportional bar whose segments are, in order,
received (navy `#1E3A66`), reimbursed (`#4F6FA3`), pending WFS (`#D4A531`),
pending seller (`#E9CF83`), loss (`#9F2F2D`), each segment's flex = its dollars;
under it a legend of mono amounts with plain labels: "came back", "Walmart paid
back", "waiting on WFS", "being chased", "lost". Dispute wins and adjustments,
when non-zero, are two extra legend entries (no bar segment: wins are not part of
the refund total; adjustments are a sixth segment in `#A5A29C` if the owner wants
them visible). **Download Excel** writes Summary + Received + Pending WFS +
Pending Seller + Loss + Reimbursed (+ Dispute wins) sheets whose rows sum to the
legend.

---

## 9. Alerts

### 9.1 Dispute digest → make.com webhook (Settings)
Built on every import and at launch; also "Send now". Items included: fileable
(`outstanding && !caseOpened && !adjustment`) seller items with `0 < daysLeft ≤
10` (soonest first), plus WFS items with `wfsDisputeOpen`. Nothing → no send.
POST JSON `{ subject, html, count, total, items }` where subject = *"Cases to open
— N returns · $X"* and `html` is a 600 px card: navy header, Seller and WFS
sections, each row = PO link, product, amount, pill (`Nd left`, red when ≤ 5;
WFS `file now`). Seller PO link = Seller Center returns search URL with the PO
(double-URL-encoded `appliedFilters` JSON, 180-day range); WFS link = the support
hub cases page. Dedupe: `key = sha1(sorted POs)`; skip if same key sent within 20
hours unless forced.

### 9.2 Email list
"Email me this list" opens a `mailto:` to the owner's address with every
`needsAction` item (PO, type, item, refund date, days ago, amount).

### 9.3 Desktop notification at launch (legacy WFS watch)
At app start: if any WFS item is overdue (> 45 d, not received), show *"N WFS
returns overdue — not received within 45 days ($X) — open cases with Walmart"*.
Optional in DWS Stock (**§12 gap 5**).

---

## 10. Storage in DWS Stock

### 10.1 Tables
```
wm_runs       (id TEXT PK, label, ran_at, csv_name, csv_hash, format,
               total_refunds, seller_count, wfs_count, log_rows,
               counts JSON, summary JSON, station, by)
wm_refunds    (run_id, po, order_no, item, sku, qty, refund_date, retail, net,
               reason, fulfillment, issues, wh_count, wh_price, wh_condition)
wm_payouts    (run_id, po, amount, date, kind)
wm_ledger     (run_id, po, order_no, type, date, amount)
wm_items      (po PK, order_no, item, qty, refund_date, amount, reason, lost,
               type, source_run_id, added_at,
               case_opened, case_opened_at, case_id, case_approved,
               case_approved_at, adjustment, adjustment_at, reimburse_pending,
               reimburse_pending_at, written_off, written_off_at, note, note_at,
               updated_at, station, by)
```
`settlementSeen/Date/Kind`, `status`, `daysOld`, `daysLeft`, flags and
`cyclesSinceCase` are computed on read, never stored.

### 10.2 Reading the Returns log
`warehousePoSet`, counts, first price and first condition per PO from
`retsync.list()` (all stations) or `db.listReturns(∞)` — see §2.5.

### 10.3 Sync (retsync aux logs, like `costs` and `pricechanges`)
- `wmruns`: one `put` event per import carrying the run row **and** its refunds,
  payouts and ledger (a few hundred rows; fine as one JSON line); `del` on remove.
  Fold newest-per-run-id. Every station rebuilds its tables from the fold.
- `wmmarks`: one `put` per manual marker change carrying the whole marker set for
  that PO (`{ po, caseOpened, …, note, updated_at, station, by }`); newest wins.
- Duplicate guard (§3.3) runs against the folded runs so two desktops cannot both
  import the same period.

---

## 11. Test fixture (from the Walmart app's smoke test — port it)

Synthetic new-format CSV (refund dates: "recent" = 5 d ago, "old" = 60 d ago) and
Returns log entries for POs 001, 004 (twice), 005 (price 250), 009:

| PO | Fulfillment | Reason | Retail | In log | Expected |
|---|---|---|---|---|---|
| 001 | Seller | Defective | 100 | once, $100 | `OK` |
| 002 | Seller | No Longer Wanted | 200 | no | `MISSING` |
| 003 | Seller | Defective (old) | 150 | no | `MISSING, AGED` |
| 004 | Seller | Wrong Item | 120 | twice | `DUPLICATE` (trim PO before counting) |
| 005 | Seller | Defective | 300 | once, $250, Damaged | `PRICE_MISMATCH`; condition "Damaged" carried |
| 006 | WFS | No Longer Wanted | 80 | no | `WFS_PENDING` |
| 007 | Seller | Defective, two rows 50 + 25 | 75 | no | `MISSING`; retail 75, net 72 (summed, sign-flipped) |
| 008 | WFS | No Longer Wanted (old) | 90 | no | `WFS_OVERDUE` |
| 009 | WFS | Defective | 60 | once | `RECEIVED` |
| 010 | Seller | Lost After Delivery | 110 | no | `LOST` (not MISSING/AGED) |
| 011 | WFS | Lost in Transit | 130 | no | `LOST` immediately, no 45-day wait |

11 unique refunded POs; 7 seller, 4 WFS. A settlement of $120.50 for PO 010 shows
as `settlementSeen` and makes it `reimbursed`; marking PO 002 received in the
log clears it; deleting the run removes its tracker items.

---

## 12. Gaps and decisions to settle with the owner

1. **Returns without a PO.** DWS Stock's arrival-driven log allows entries with no
   `order_number` (WFS removal boxes, pre-Linnworks returns). Those can never
   match a refund. Options: leave them unmatched (today's behavior), or add a
   "link to PO" field later. Recommend: leave.
2. **"Received ✓" from the refunds page.** The Walmart app just wrote a bare PO
   into its log. In DWS Stock a return moves stock, so this button should open the
   existing receive popup prefilled with the PO (and the item name / SKU from the
   report) rather than silently creating a record. Confirm.
3. **PO vs Linnworks order lookup.** DWS Stock returns are keyed by the Walmart PO
   in `order_number`; the report's PO is the same number, so matching is direct.
   Confirm no station types the Walmart *order* number instead.
4. **Price mismatch source.** The Walmart app compared the logged price to
   `Refunded Retail Sales`. DWS Stock's item `price` is "what we refunded / sale
   price" per the receive sheet; confirm that is the comparable figure.
5. **Launch notification for overdue WFS** (§9.3): keep, or rely on the digest?
6. **Archiving the original CSV** (§3.4): keep (a folder under Documents) or drop,
   since the run keeps everything it parsed.
7. **Corrections CSV** (§7): drop in favor of sync, or keep as a backup export.
8. **Owner email address** for the mailto list and webhook URL: both move to
   Settings (today the address is a constant in code).
9. **Legacy data.** Existing `rnr.json` / `history.json` / `orders/*.json` from
   the Walmart app can be migrated by re-importing the archived period CSVs
   (`Documents/Walmart Reconciliation Reports/Imported Walmart Reports/`) and
   importing a corrections CSV once. Confirm that is acceptable rather than a
   one-off migration script.
10. **What is intentionally not carried over:** Profit tab (COGS, charts, KPI
    dashboard), Transactions ledger UI, Pricing draft, AI Analyst, Notes ledger,
    the standalone Warehouse Returns UI and its two-block CSV, the web server
    mode. Costs already live in DWS Stock (`item_costs`).

---

## 13. The settled design (editorial ledger)

Canvas: https://claude.ai/artifact/Equgknt33s5P1XmaNPEnBG · static copies:
`design/Main.dc.html` (Reconcile) and
`design/NotReceived.dc.html` (Not received). Rebuild
in the app's stylesheet (no inline styles — CSP); copy exact values from the
files, do not snap them to a grid.

**Shared frame.** DWS Stock's top bar and tab pill; "Recovery" is the
active tab. Page sheet `max-width: 1100px`, `padding: 28px 28px 48px`, vertical
`gap: 32px`. Page header: `h1` 22 px / 600 / −0.015em; beside it two underlined
sub-tabs, **Reconcile** and **Not received** (13 px; active = 600 + 2 px
navy underline; the needs-action count after the second in red mono 11 px); the
primary button for the screen on the right. Type: Geist 13 px body, Geist Mono
with tabular numerals for every number, PO and date; section labels 11 px / 500 /
uppercase / 0.08em / `#787774`. Surfaces white with 1 px `#EAEAEA`, radius 12 px,
no shadows; row separators `rgba(0,0,0,.06)`. Colors: navy `#1E3A66`, soft navy
`#E4EAF4`, text `#2F3437`, muted `#787774`, faint `#A5A29C`, red `#9F2F2D`, amber
dot `#D4A531` / amber text `#956400`, green `#346538`, light navy `#4F6FA3`, pale
amber `#E9CF83`. **No emoji or symbol glyphs; no colored left borders; no pills
for status.**

### 13.1 Reconcile
Two-column top section (`grid: repeat(auto-fit, minmax(min(420px,100%),1fr))`,
gap 40 px):
- Left: label LATEST PERIOD; the period name at 30 px / 600 / −0.02em; a muted
  line "Imported <when> · N refunds checked against M returns in the log"; the
  drop target (white, 1.5 px dashed `#D6D2C9`, radius 10, 34 px navy-soft icon
  tile, "Drop the next period's CSV here", "Seller Center → Payments · nothing is
  written to disk", **Browse…** outlined); then EARLIER PERIODS as a hairline list
  (name · open count in mono · Excel link).
- Right card (padding 24/26): three numbers in a 3-column grid, Geist Mono 36 px /
  500 — received (navy), not received (red), WFS waiting (amber text) — each with
  its label and mono dollar line; a 10 px proportional bar (navy / red / `#D4A531`)
  with "$<total> refunded this period" and "N need action today" under it; a
  hairline, then **Download Excel** (outlined) and **Remove period** (text).

Table card: tab row (Not received · WFS waiting · Received, counts in mono, the
active count red when > 0) with a faint sort note on the right; columns PO (mono
12.5 px / 500 with WFS/Seller as an 11 px muted second line) · Item · Refunded
(`Mon D` mono + "· N days ago") · Net refund · Reason (muted) · What to do (dot +
bold lead + muted clause; see §5 wording: "Open a case now — lost per Walmart",
"Open a dispute now — missing over 30 days", "Watch for arrival — N days to
file", "Open a case with Walmart — overdue", "Wait — pays back by day 90").
Rows `padding: 13px`; header cells 11 px uppercase. Footer line links to the
Not received screen.

### 13.2 Not received
Two-column top section, same grid:
- Left: label WHERE THE REFUND MONEY WENT with the scope switch (This period ·
  Month · All time) on the right; headline `$3,161.24` (mono 30 px / 500) +
  "refunded · <scope label>" (16 px / 500 muted); the 14 px five-segment bar; a
  legend grid (`minmax(150px,1fr)`) of 10 px square swatches, mono amounts, plain
  labels.
- Right card "TODAY": three numbers, mono 36 px — to file now (red), waiting
  (amber text), cases open (navy) — with labels and dollar totals; a hairline and
  the two-sentence rule reminder ("Seller refunds must be disputed within 45 days.
  WFS refunds pay themselves back by day 90; if not, you have until day 135 to
  file.").

List card: tab row To do · Cases · Adjustments · Reimbursed · Lost (counts in
mono; To do's count red), then on the right "WFS only" / "Seller only" text
toggles and the search field (220 px); columns PO (type and case ID on the second
line) · Item · Refunded (`Mon D · Nd`) · Amount · Paid back · Status (dot + lead +
clause per §6.6) · actions (filled **Open case** only where action is due;
outlined otherwise; "⋯" always). Rows `padding: 14px`. Footer line: "Received POs
never appear here. They leave the list the moment the Returns log has them."

### 13.3 States not drawn yet
Empty (no period imported), importing (progress line under the drop target),
the duplicate-period prompt (a dialog: "A report for <label> was already imported
(<when>). Re-import and replace?" with Re-import / Skip), and all-clear (the Today
card shows 0 to file now; the list's To do tab is empty with the line "Nothing to
file — N returns are waiting on Walmart"). Build them in the same vocabulary.

