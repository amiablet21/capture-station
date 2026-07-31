# Backlog

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
