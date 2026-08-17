# Handoff: Overview tab v2

## Overview
A new **Overview** tab for Capture Station, placed **before Capture** in the tab switcher (owner note in `variants/overview.html`, 2026-08-15). It gives the owner a morning read: orders today per marketplace, a smooth sales trend with a Day / Month / Year filter and hover tooltips, and three "money" cards — Missed sales, Buy soon, Send to WFS — that expand into a shared full-width SKU drawer.

This supersedes the pending `src/renderer/variants/overview.html` chart region (owner rejected bars and jagged polylines; kept the stat-card/drawer language).

## About the Design Files
`overview-v2.html` is a **design reference created in HTML** — a self-contained prototype in the same format as the repo's other `src/renderer/variants/*.html` files. It is not production code to copy verbatim: recreate it inside the app's existing renderer (`src/renderer/index.html` + `styles.css` + `renderer.js`, vanilla JS, CSP `script-src 'self'`). Its inline `<style>` deliberately mirrors `variants/_base.css` tokens, and the `<script>` is plain vanilla JS, so most of it ports directly.

Suggested repo placement: commit the file to `src/renderer/variants/overview-v2.html` (the repo's convention for approved designs), then implement.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii and interaction timings are final and match the app's existing design system (`styles.css` "Return Tracker" tokens). Recreate pixel-perfectly; all `--var` names below already exist in `src/renderer/styles.css`.

## Screens / Views

### Overview tab (single view)
Max-width 1160px, centered, padding `14px 22px 26px`, on `--canvas` (#F7F6F3).

**1. Tab switcher** — existing `.tabs` pill, with a new `Overview` tab as the FIRST tab (before Capture).

**2. Header row** (flex, gap 12, margin-bottom 12)
- `h1` "Overview" — 15px / 600
- date — 11.5px, `--faint`
- right-aligned segmented **range filter** (Day / Month / Year): container matches `.tabs` (background #EFEEEA, radius 10, padding 3, gap 2); buttons 11px/600, padding `4px 14px`, radius 8; active = white bg, `--text`, shadow `0 1px 3px rgba(47,52,55,.08)`; inactive = transparent, `--muted`.

**3. Two-panel grid** — `grid-template-columns: 340px 1fr; gap: 10px`
- **Orders today card** (white panel, 1px `--border`, radius 12, padding `14px 16px`):
  - label 10px/700 uppercase ls .06em `--faint`; number 38px/700 `--mono`; delta 10.5px `--accent-deep` ("▲ +9 vs yesterday")
  - three marketplace rows (grid `14px 1fr auto`, gap 8): 8px dot (Walmart #2E86D9, eBay #047857, Temu #C97B12), name 12px/600, count 14px/700 mono
  - share bar: flex, height 8, radius 999, gap 2; flex weights = order counts
- **Sales chart panel** (white panel, radius 12, padding `12px 14px`):
  - h4 "Sales" 11px/700 uppercase `--faint`, right-side sub 10.5px `--muted` (changes per range)
  - SVG chart, viewBox `0 0 680 190`, pads L36 R48 T14 B24 — see Interactions.

**4. Money cards row** — 3 equal columns, gap 10. Each card: white, radius 12, padding `12px 14px`, `cursor: pointer`, hover bg `--surface-2` (120ms `--ease`). Contents: label 10px/700 uppercase `--faint` with right chevron ▾/▴ (10px); number 27px/700 mono — Missed sales `--neg-text`, Buy soon `--amber-text`, Send to WFS `--accent-deep`; subline 10.5px `--muted`.

**5. Shared SKU drawer** — one full-width white panel under the cards row (margin-top 10). Only one open at a time; **default open = Missed sales**. Header h4 colored per type; standard app table (th 9.5px uppercase `--faint`, td 12px, hairline `--border-soft` row borders, row hover `--surface-2`); SKU cells mono 11px/600 #1F6C9F; value pills mono 10.5px/700 radius 999 padding `1px 9px` in soft badge colors (`--neg-soft`/`--neg-text`, `--amber-soft`/`--amber-text`, `--accent-soft`/`--accent-soft-text`). Buy-soon drawer ends with a muted "+ N more … open Stock filtered to Buy soon" link line.

## Interactions & Behavior

**Range filter** — swaps the chart dataset + sub-label; resets hover.
- Day: cumulative orders today per hour (8am→now)
- Month: orders per day, last 30 days
- Year: orders per month, last 12 months

**Chart** (the core owner requirement: smooth, never jagged, no bars)
- Line: catmull-rom → cubic-bézier smoothing (see `smoothPath()` in the reference), #047857, stroke-width 2.5, round caps
- Area fill under line: vertical gradient #047857 @16% → 0%
- Grid: 3 hairlines (#F0EFEC) at 0 / half / max; y-max = raw max rounded up to a half-power-of-10 unit
- Axis labels + all numerals: mono, 8.5–9px, `--faint`
- End of line: 3.5px dot + bold value label
- **Hover** (per x-value): invisible full-height hit slices (one per data point, `cursor: crosshair`); on enter show (a) dashed vertical guide #D8D6D0 `3 3`, (b) 4.5px dot with 2px white stroke, (c) dark tooltip — rect #2F3437, radius 6, height 21, white mono 10px text `"{period} · {n} orders"` (e.g. "Jul 24 · 44 orders"), clamped to chart bounds, floating 38px above the point. Tooltip + guide animate in with `ttPop`: 180ms `cubic-bezier(0.16,1,0.3,1)`, fade + 5px rise. Mouseleave on the SVG clears it.

**Money cards** — click toggles its drawer; opening one closes the others; clicking the open card's again closes it (chevron flips ▾/▴). Drawer entrance reuses the same 180ms `ttPop` animation. Drawer SKUs should click through to the Stock page filtered to that SKU (same behavior as Stock's "In orders" click-through).

## State Management
- `range: 'Day' | 'Month' | 'Year'` (default `'Day'`)
- `hoverI: number | null` — hovered data-point index; reset on range change
- `openDrawer: 'missed' | 'buy' | 'wfs' | null` (default `'missed'`)
- Data: aggregate from the existing SQLite captures/processed orders (day/month buckets) and the Stock page's velocity + minimum-level engine for Buy soon / Send to WFS / Missed sales. All figures in the reference are placeholder mock data.

## Design Tokens (all existing in `src/renderer/styles.css`)
- Canvas #F7F6F3 · surface #FFFFFF · surface-2 #F9F9F8 · border #EAEAEA · border-soft rgba(0,0,0,.06)
- Text #2F3437 · muted #787774 · faint #A5A29C
- Accent #047857 · deep #065F46 · soft #E3F2EB
- Negative #9F2F2D on #FDEBEC · amber #956400 on #FBF3DB · SKU link #1F6C9F
- Marketplace: Walmart #2E86D9 · eBay #047857 · Temu #C97B12
- Fonts: Geist (UI), Geist Mono (numbers/SKUs/axis) — already shipped in `src/renderer/fonts/`
- Radii: cards/panels 12 · pills 999 · segmented buttons 8 · tooltip rect 6
- Easing: `cubic-bezier(0.16,1,0.3,1)` (the app's `--ease`), 120–180ms

## Assets
None new. Fonts and tokens ship with the app already.

## Files
- `overview-v2.html` — the approved design, self-contained (open in any browser)

Explored alternatives (stat-card grid, stacked bars, ledger, marketplace lanes, emerald hero, in-card dropdowns) live in the design project's `Overview Dashboard.dc.html`, turns 1–4; 4a is this design.
