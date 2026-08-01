# Backlog

## 0. Returns page (NEXT UP - design approved 2026-08-01, build next session)

Admin-side only (page toggles). Two moves:
1. The current Receiving worksheet relocates INTO the Stock page (button
   beside WFS Shipments, same dialog pattern). The third tab becomes
   **Returns**.
2. Returns flow: type/scan the original PO# or return tracking ->
   `ProcessedOrders/SearchProcessedOrders` finds the order (items, customer,
   ship date, tracking) -> per returned unit pick a condition:
   - New -> +1 original SKU at Digital World Shop
   - Open box / Used / Scrap -> +1 the MAPPED condition listing (the owner
     already keeps real OPEN BOX / USED / SCRAP listings; grading a return
     auto-redirects the qty there, making it immediately sellable)
   Condition map per sold SKU: auto-derived from the live inventory by
   suffix (`-OPENBOX`, `-USED`, `-SCRAP`); where no suffix match exists,
   the returns line shows a one-time SKU picker and the chosen mapping is
   persisted (config/db) and reused for every future return of that SKU.
   Stock bump via `Stock/UpdateStockLevelsBySKU` (delta, like WFS). Never
   silently guess a mapping. Every return writes a local log
   (new `returns` table + `returns.csv`, ledger cards grouped by day like
   receipts, condition on the right, scrap in red) and an internal note on
   the original order ("return received - graded open box").
   Note for build: verify which endpoint attaches notes to PROCESSED orders
   (open-order SetOrderNotes may not apply).
   Mockup approved: order card with RETURN stamp (mono ledger style), live
   "-> +1 SKU-OPENBOX" preview beside the condition dropdown.

Planned features, in the owner's words (2026-07-31). Not started yet.

## 1. Sales-velocity reorder alerts

Based on items selling fast: compute how many units each SKU sells per day on
average over trailing windows (7 days, 30 days). Derive a per-SKU reorder
threshold ("limiter"). When available stock at Digital World Shop falls below
it, email the owner: e.g. *"Under 100 units left — this SKU has sold X units
per day over the past 7 days; consider restocking."* Break sales out by channel
(Walmart / eBay / Temu) if identifiable.

Implementation notes:
- Sales history: Linnworks `ProcessedOrders/SearchProcessedOrders` with
  `DateField: processed`, aggregated per SKU and `Source`.
- The computed threshold could be written to the item's Minimum Level so
  Linnworks' own low-stock views agree.
- Email delivery mechanism TBD (owner's mailbox / SMTP).

## 1b. Draft POs from receiving sessions

Follow-up to the Receiving page: create the draft Linnworks PO from a session directly (verified endpoints: `Inventory/GetSuppliers`, `PurchaseOrder/Create_PurchaseOrder_Initial`, `PurchaseOrder/Add_PurchaseOrderItem`; `Cost` there is the line total, unit cost × qty). Dropped from v1.2 — the owner raises POs manually from the webhook notification.

## 2. Cleaner views for used and open-box listings

SKUs carry condition suffixes (e.g. `S25-128GB-NAVY-OPENBOX`). Add separate or
filtered views — most likely condition tabs/filters on the Stock page — so new
vs. used vs. open-box inventory reads cleanly instead of blending together.
