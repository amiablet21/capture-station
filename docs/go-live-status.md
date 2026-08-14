# Go-live status and session brief — 2026-08-14

Written for cross-machine continuity: everything decided and verified on the main
station today, so any session on any computer can `git pull` and know the state.
Owner's instruction: going live with Linnworks stock sync SOON (possibly tonight).

## Go-live gate: CLEAR as of 2026-08-14 evening

Verified by live read-only audits against Linnworks (script pattern: electron run
with userData pointed at the installed app's folder; DPAPI creds decrypt fine):

- **52 DropShip pads** in place (all = 10). Owner added ~15 himself today
  (S26/ZFold/X930-GRAY families). Pads live in the DropshipPad extended property;
  the app writes them as real stock at the DropShip location on its tick.
- **17 Walmart channel links carry Ignore/sync-off** — every WFS-fulfilled
  listing is protected (the leak: without the tick, Linnworks stamps the OWN-
  warehouse count over Walmart's WFS-managed listing quantity). Set by hand via
  My Inventory → item → Channel SKU tab → Ignore checkbox → Save.
- **Channel Locations verified**: eBay/Temu/Walmart all sync inventory from
  Digital World Shop ONLY; WFS location OFF everywhere; DropShip location ON for
  Walmart only (owner: "I only dropship on Walmart"). Pads therefore protect
  Walmart listings only — BY DESIGN.
- **Counts clean**: HKOS9BLKAM-1 (=20), X230-…-EARPLUGS (=20) fixed by owner;
  iPad bundle IPAD-11-128GB-BLUE-BUNDLE-1 set level 6 (6 open orders, avail 0),
  base iPad level 3 (3 open orders, avail 0) — all 9 physical iPads allocated,
  owner confirms he holds them. (Composite item suggested for the bundle later —
  one pool — but explicit levels are correct for launch.)
- **Owner-confirmed intentional**: x110gray (Walmart listing on SM-X133-64GB-GREY
  stock) and T227U (LTE-named listing on WiFi SM-T220 stock) are fine as-is;
  x610256gb-grey and X400-128GB-BLACK-INTL-VER channel-SKU names are wrong TEXT
  but correct links. Temu X520-128GB-GRAY going to 0 is CORRECT (its only stock
  is in WFS).
- **Expected on first sync**: WALMART "x610256gb grey" (1 listed) and TEMU
  "X520-128GB-GRAY" (20 listed) drop to zero honestly — seeing that happen is
  the launch spot-check's proof of life.

### Launch protocol
Quiet hour → enable stock sync in Linnworks → spot-check a dozen listings across
Walmart/eBay/Temu → watch first orders in Capture Station. Known accepted risks:
last-unit race on 1-of-1 condition SKUs; marketplace takedown lag; pads are a
deliberate overstatement (NO-STOCK order flag proposed, not built). Retro-link
behavior is now VERIFIED PER MAPPING in-app (mapping toast reports whether open
orders picked up a new link or need hand deduction).

## App releases today (all shipped + installed on the main station)
- v1.17.10 revert of the pane lift (native view overlapped tab bar).
- v1.17.11 channel-SKU click opens the exact eBay item page (ChannelReferenceId).
- v1.17.12 green New chip on Stock (SKUs matching no condition pattern).
- v1.17.13 Refresh truly forces the unlisted rescan (young disk cache was
  swallowing it). v1.17.14 delta scan: new SKUs get NOT LISTED marks in seconds
  (cache gained `covered`; hourly full scan unchanged).
- v1.17.15 mapping retro-link verification (see above).
- v1.18.0-1.18.5 TEMU LISTER on the new one-tab "Listings" (eBay/Temu pills):
  queue of NEW in-stock SKUs w/o Temu link (Temu is NEW-ONLY per owner), fixed
  Temu menus, 7-color mapper, RAM+ROM axis, per-model package memory, workbook
  export writes a copy of the seller-downloaded Temu template
  (src/main/temuxlsx.js — dependency-free zip patcher; template picked once via
  tab ⚙ → userData/temu-template.xlsx). Titles SELF-WRITE: typed-per-model
  (learned, tokenized) > own live eBay listing (model card) > public catalog UPC
  lookup (listing:titleLookup hidden-window eBay search) > ⚙ template. FIRST
  REAL TEMU UPLOAD still untested — start ≤15 products, tune on Temu's report.
- v1.19.0 Walmart pill (UPC attach-offer flow) — REMOVED again at owner request
  in v1.19.2 ("unnecessary"; flow stays in Seller Center; code in git history).
  v1.19.1 fixed the new-page routing (checklist: pageEnabled + showPage toggle +
  tab active + enter fn + listingsChannel).
- Release chains are now gated on E2E_ALL_PASS (popup-close test flakes under
  post-install load; suite must be green standalone).

## HUBX (dropship supplier) — separate project, owner-parked
Customer API docs read in full (hubxteam.atlassian.net/wiki/spaces/HDP): OAuth
client-credentials (NO KEYS YET — Customer Management Team issues), catalog w/
live availability + MOQ/MXQ + tier prices + EXW warehouse, orders ship DIRECT TO
BUYER w/ tracking + per-unit serials back. Local sandbox committed:
`node tools/hubx-sandbox.js` → localhost:8787 playground (drifting stock, order
lifecycle, MOQ chips, tick-to-build Walmart bulk sheet w/ margin math → CSV to
Downloads; export columns are provisional — owner said "format has to be a
little different", exact columns not yet specified). Vision discussed: live pads
from HUBX availability, auto-ordering on dropship orders, eBay dropshipping
(allowed: wholesale source; MOQ-1 items only; needs DropShip location ON for
eBay channel). Owner: "this project is separate, we can deal with later."

## Next agreed work (in order)
1. Support the go-live (spot-checks, first-morning triage).
2. First real Temu workbook upload tuning.
3. INSIGHTS tab (mockup first): fast sellers → send to WFS; was-selling-now-zero
   (missed sales); low-stock buy recommendations w/ estimated qty; dead stock.
   Include a WFS-guard chip (item holds WFS stock but Walmart link still syncs).
4. HUBX integration when keys arrive.

House rules unchanged: mockups in src/renderer/variants shown before UI builds;
three-panel lister layout locked; no emoji in buttons; quiet flat design; always
git pull first; auto-launch app after installs; accumulate vs instant-release —
this session ran instant patch releases at owner's pace.
