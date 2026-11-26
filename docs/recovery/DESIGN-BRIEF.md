# Design brief — "Recovery" page for DWS Stock

Paste everything below this line into Claude Design, and attach the files listed at the end.

---

Design a new page called **Recovery** for DWS Stock, an Electron desktop app a small reseller uses at the warehouse and office. It joins the existing tabs Capture · Stock · Returns. Build it as a high-fidelity HTML prototype in the app's existing design system, plus a short handoff README in the same format as `overview-1a-status-queue.md` (attached), so a developer can rebuild it pixel-for-pixel inside the app.

## What the page does (two steps, nothing else)

1. **Import a payment period.** The owner drops a Walmart "reconciliation report" CSV (one per two-week payment period, e.g. "Sep 13 – Sep 27, 2026"). The app reads every refunded order in it and checks each one against the Returns log the warehouse already keeps. Nothing is written to disk. If the same period was imported before, ask "re-import and replace?".
2. **Show what was not received.** Every refunded order that never physically came back, with a status that tells the owner exactly what to do and by when, and the actions to do it. Orders that did come back disappear from this list automatically.

Secondary: a per-period summary (received / not received / WFS waiting, counts and dollars), a list of imported periods, and a "Download Excel" for people who want a file.

## The data on each row

- PO number (13–15 digits, always monospace), fulfillment type **WFS** or **Seller**, product name, refund date and days since, refund amount, "Walmart paid" (what Walmart has reimbursed so far, usually blank), return reason (e.g. Lost in Transit), order number.
- Manual markers the owner sets: case opened (with a Walmart case ID and the date), approved, partial adjustment, pending reimbursement, written off, a free-text note.

## Every status a row can be in (design all of them)

| State | What the row says (bold lead — muted clause) | Dot |
|---|---|---|
| Lost by Walmart | **Lost** — file now | red |
| Seller, inside the 45-day window | **33 days left to file** | amber (red when ≤10 days) |
| Seller, window passed | **Window closed 13 days ago** — write off? | grey |
| WFS, first 90 days | **Walmart pays back by day 90** — 78 to go | light navy, calm |
| WFS, day 90–135 unpaid | **Dispute open** — 35 days to file | red |
| WFS, past 135 days | **Window closed** | grey |
| Case opened | **Case opened Aug 22** — case WM-4471982 | light navy |
| Case approved by Walmart | **Approved Sep 29** — awaiting payout | green |
| Case unpaid after 2 payment cycles | **Unpaid after 2 cycles** — opened Aug 22 | amber, pulls back into "needs action" |
| Partial adjustment (not a real return) | **Adjustment** — self-initiated partial refund | navy |
| Pending reimbursement (owner expects it) | **Pending reimbursement** — marked Oct 3 | amber |
| Reimbursed (seen in a report) | **Paid back in full** / **Paid back $100.00 of $575.04** — seen Sep 27 | green |
| Written off | **Written off** — Sep 1 | grey |

Actions per row: a single contextual primary action (usually **Open case**, which asks for an optional case ID) and an overflow menu with Received, Loss (write off), Mark adjustment, Mark approved, Undo…, Add note.

Tabs on the list: To do (the un-actioned list, default) · Cases · Adjustments · Reimbursed · Lost, each with a mono count; "WFS only" / "Seller only" text toggles narrow the active tab. Search by PO, product, case ID or note. Sort: needs-action first, then oldest refund first. The page sub-tab carries the needs-action count.

## States to design

Empty (no period imported yet), importing (progress line), duplicate-period prompt, the normal list, one expanded row, the all-clear state (nothing needs action), and the period summary for a period with zero problems.

## Design system (must match the app — see `styles.css` tokens and the attached Overview handoff)

- Canvas `#F7F6F3`, surfaces white with 1px `#EAEAEA` hairlines, radius 8–12px, no drop shadows beyond the tab pill. Light mode only.
- Type: Geist 12.5–13px for text, Geist Mono with tabular numerals for every number, PO and SKU. Labels 10.5px uppercase, letter-spacing .07em, muted `#787774`.
- One accent, navy `#1E3A66` (soft `#E4EAF4`). Semantic: red `#9F2F2D` on `#FDEBEC`, amber `#956400` on `#FBF3DB`, blue `#1F6C9F` on `#E1F3FE`, green `#346538` on `#EDF3EC`, purple `#6A2E9E` on `#F1E9F8` for the WFS pill.
- Compact "cockpit" density: rows about 44px, no hero sections, no illustrations, no marketing copy.
- Sheet width 1160px centered (the app lets the user drag it between 980 and 1500px).
- The prototype may use inline styles, but the app's CSP forbids them, so the handoff must move every style into classes.

## The direction is settled — extend it, don't replace it

The look is decided: an **editorial ledger**. Each screen has one headline (the
period, or the refund total), a few large Geist Mono numbers, one proportional
bar of where the refund dollars went, one table with underlined tabs instead of
stacked tables or chip rows, statuses as plain sentences with a small colored dot
(no pills), and generous air. No emoji or symbol glyphs, no colored left-border
cards, no KPI tile grids. The two finished screens are on this canvas (attach
them or open the link): https://claude.ai/artifact/Equgknt33s5P1XmaNPEnBG —
static copies are `design/Main.dc.html` and
`design/NotReceived.dc.html`. Section 13 of the spec describes
every measurement and color.

Your job is the rest, in that same vocabulary:

1. The four states not drawn yet: empty (no period imported), importing, the
   duplicate-period prompt, and all-clear.
2. The row overflow menu ("⋯") and the three small dialogs: Open case (optional
   case ID), Write off (confirm), Mark received (opens the existing receive popup
   prefilled with the PO).
3. The phone-width behavior of both screens (the top sections stack; tables scroll
   in a box).
4. The handoff README.

## Attached

- `SPEC.md`: the full functional spec with every rule, status wording and tooltip. Use the exact wording from it; section 13 is the design.
- `design/`: the two finished screens.
- `overview-1a-status-queue.md`: the handoff format the developer expects.

## Deliverable

1. One HTML prototype with the states above switchable (a `state` prop or buttons), fake but internally consistent numbers, matching the two finished screens pixel-for-pixel where they overlap.
2. A handoff README: layout grid, every measurement and color, row anatomy, interaction notes, and the list of states.

---

**Attach:** `SPEC.md`, the two files in `design/`, and from the capture-station repo: `docs/design-handoffs/overview-1a-status-queue.md` and `src/renderer/styles.css`.
