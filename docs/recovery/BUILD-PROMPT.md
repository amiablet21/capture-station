# Paste this into your DWS Stock (capture-station) Claude session

Attach, or drop into the repo under `docs/recovery/`, the whole `recovery/` folder this file sits in. Then paste everything below the line.

---

Build a new page in this app called **Recovery**. It moves the one job of my separate Walmart accounting app into DWS Stock: I drop a Walmart payment-period report (the reconciliation CSV from Seller Center → Payments), the app checks every refunded order against the Returns log this app already keeps, and shows me the ones that never came back so I can chase them through Walmart's dispute windows and watch the payouts land.

Everything you need is in `docs/recovery/`:

- `SPEC.md` — the complete functional spec. Every parsing rule, matching rule, status, filter, action, export and alert, lifted from the working Walmart app's code. Section 13 is the design. **Read it in full before writing code.**
- `design/Main.dc.html` and `design/NotReceived.dc.html` — the two finished screens (Reconcile, Not received). Open them in a browser. Rebuild them in `src/renderer/styles.css` classes; the app's CSP forbids inline styles. Copy exact values from the files.
- `source/` — the Walmart app's original modules, for reference and for porting verbatim where they are pure: `parseReport.js` (both CSV formats, payouts, ledger), `reconcile.js` (the issue rules), `excel.js` (`classify` and the on-demand workbook), `rnrStore.js` (status derivation, dispute windows, case markers), `period.js` (labels), `core.js` (the orchestration: `runReconcile`, `checkRnr`, `aggregateSettlements`, `bucketTotals`, summaries, exports, the make.com digest) and `smoke.js` (the fixture and expected results in §11 of the spec). They use PapaParse and ExcelJS; this app has neither, so add `papaparse` and `exceljs` as dependencies (both pure JS, no native build) or replace them.

Decisions already made, do not reopen:

1. Tab name **Recovery**, one word, after Returns. Two sub-screens: **Reconcile** and **Not received**. Hidden until ticked in Settings → Pages (`pages.recovery`, default off, requires `pages.returns`). Never shown on capture-only stations.
2. The Returns log is the warehouse record. Match on `order_number` = the Walmart PO. Use the folded log across stations (`retsync.list()`) when sync is on, else the local `returns` table. Spec §2.5.
3. Storage in SQLite (`capture-station.db`), tables in spec §10.1. Sync through the existing retsync aux logs, `wmruns` and `wmmarks`, spec §10.3. No files are written on import; Excel is built on demand.
4. "Mark received" opens the existing receive popup prefilled with the PO, item name and SKU from the report, so the return is logged properly and stock moves. It never silently inserts a bare record.
5. Keep: archiving the original CSV per period (a folder under Documents, openable from Settings). Drop: the launch-time desktop notification and the corrections CSV import/export (sync replaces it; keep a plain CSV export of the current view).
6. The alert email address and the make.com webhook URL are Settings fields, not constants.
7. Look and wording: spec §13 and the two design files are final. No emoji or symbol glyphs, no colored left-border cards, no status pills; statuses are sentences with an 8 px colored dot.

Build in this order, and show me the page after step 4 and again after step 6:

1. Schema and migrations (§10.1). Port `parseReport.js`, `reconcile.js`, `classify` and `writeWorkbook` from `excel.js`, and the pure parts of `rnrStore.js` into `src/main/recovery/`. Make the fixture in §11 pass as a unit test (the app has an e2e harness in `src/main/e2e-test.js`; add the checks there in the same style).
2. The import pipeline (§3): period label, duplicate guard, classify against the Returns log, store the run with its refunds, payouts and ledger, upsert the not-received items.
3. Status derivation and the dispute-window decoration (§6.2, §6.3, `checkRnr` in `core.js`), the case markers (§6.4), the summary math (§8).
4. The Reconcile screen (§13.1): drop zone, period headline, the three numbers and bar, the tabbed table, earlier periods, Download Excel, Remove.
5. The Not received screen (§13.2): the refund-money bar with its scope switch, the Today card, the tabbed list with the WFS/Seller toggles and search, every status sentence and the row actions from §6.6, the three small dialogs (Open case with optional case ID, Write off confirm, Mark received → receive popup).
6. Sync (§10.3), the Settings fields, the make.com digest (§9.1) and the email list (§9.2), CSV export of the view, the audit workbook (§7).
7. The states in §13.3: empty, importing, duplicate-period prompt, all-clear.

While building, keep a list of anything in the spec that does not fit this codebase and tell me instead of guessing; §12 already lists the known gaps with my answers above. Version bump and README entry as this repo always does.
