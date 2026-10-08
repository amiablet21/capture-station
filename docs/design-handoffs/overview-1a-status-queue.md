# Handoff: Overview page — variant 1a "Three numbers, one queue"

## Overview
Redesign of the **Overview** tab in Capture Station (Electron, v1.29.14). The owner approved variant **1a**. The page is now about stock levels. It shows three big counts (out / running low / selling fast) and one urgency-ordered list. Clicking a row expands it to show a 30-day sales chart, week/month totals, and a split by marketplace. The "Send to WFS" column is **removed entirely**. "Units sold today" stays as a right-hand card.

This replaces the three-column layout described in `overview-redesign-brief.md` (included). Read §3 (data), §5 (tokens) and §6 (constraints) of that brief. They still apply.

## About the design files
`OverviewStatusQueue.dc.html` is a **design reference built in HTML**: a working prototype of the intended look and behaviour, not production code. Rebuild it in the app's existing renderer, using its own components, stylesheet tokens and patterns. Notes:
- The prototype uses inline `style="…"`. The app's CSP forbids that. Move every style into the stylesheet as classes. Values that change at runtime (chart points, tooltip x/y) must be set from code, e.g. `el.style.setProperty` or SVG attributes.
- All numbers in the prototype are **fake but consistent** (each SKU's per-day series sums to its `recent`/`prior`, and its marketplace split sums to `sold30`). Wire the real data instead.
- To view it, open the file in a browser with `support.js` next to it. Use the `state` prop (normal / clear / loading / error) to see each state.

## Fidelity
**High-fidelity.** Colours, type, spacing and motion are final. Match them pixel-for-pixel where the design system allows.

---

## Layout (sheet)
- Sheet: `max-width: 1160px` (the existing draggable width stays: 980–1500px), padding `22px 28px 30px`, background Canvas `#F7F6F3`.
- Base font Geist / Segoe UI 12.5px, colour `#2F3437`. All numbers and SKUs: Geist Mono with `font-variant-numeric: tabular-nums`.
- Top to bottom: **Header** → (Error banner) → **Counts line** (or All-clear / Loading block) → **Body grid**.
- Body grid: `grid-template-columns: minmax(0,1fr) 316px; gap: 16px; align-items: start`. Left: **Needs attention** card. Right: **Sold today** card.

### 1. Header (unchanged in substance)
- Flex row, `align-items: baseline; gap: 12px; margin-bottom: 22px`.
- "Overview": 20px / 600 / letter-spacing −0.01em.
- Date "Thursday, October 8": Muted `#787774`.
- On the right (`margin-left: auto`): "Updated 9:14 AM" (Faint `#A5A29C`, 12px, nowrap) and a 28×28 round refresh button (1px `#EAEAEA` border, white; hover bg `#F9F9F8`, icon colour `#787774` → `#2F3437`). The icon is a 13px circular arrow.

### 2. Counts line (readable across the room)
- Flex, `align-items: baseline; gap: 44px; margin-bottom: 20px`. Plain type, **no tiles, no boxes**.
- Each count: number in Geist Mono 38px / 500 / line-height 1, then a 14px label with a 10px gap.
  - `N` **out of stock**: `#9F2F2D`
  - `N` **running low**: `#956400`
  - `N` **selling fast**: `#1F6C9F`
- Counts come from the current list (minus ignored). "Selling fast" = fast-only rows **plus** low rows whose `faster` flag is set.

### 3. Needs attention card
- White, 1px `#EAEAEA`, radius 12px, overflow hidden.
- Card header (padding `13px 18px`): label "NEEDS ATTENTION" (10.5px / 500 / uppercase / letter-spacing .07em / Muted). On the right, "Lead time 7 days · target 28 days on hand" (11px Faint) — use the real settings values.
- **Rows** (one list, ordered): all **Out** (most recently out first, or by missed sales) → all **Low** sorted by `daysLeft` ascending → all **Fast-only** (fast but not low). Show **every** qualifying SKU, not a top N.
- Row separator: `border-top: 1px solid rgba(0,0,0,.06)`.
- Collapsed row: `grid-template-columns: 52px minmax(0,1fr) minmax(0,1fr) 12px; gap: 16px; padding: 13px 18px; align-items: center; cursor: pointer`. Hover bg `#FBFBFA`. Expanded row bg `#FBFBFA`.
  1. **Badge** (10.5px / 500, padding `2px 7px`, radius 4):
     - Out: bg `#FDEBEC`, text `#9F2F2D`
     - Low: bg `#FBF3DB`, text `#956400`
     - Fast: bg `#E1F3FE`, text `#1F6C9F`
  2. **SKU + title**:
     - SKU: Geist Mono 12px / 500, ellipsis. Hover colour `#047857`. Clicking the SKU opens the Stock page filtered to it; stop propagation so the row doesn't toggle.
     - **Hot tag** directly after the SKU when `perDay > 1` (threshold should be a constant or setting; default 1): bg `#FCEADF`, text `#B4501B`, 10px / 500, padding `1px 5px 1px 3px`, radius 4, 11px flame icon + "Hot". Tooltip "Hot — sells more than 1 a day".
     - Title below: 11.5px Muted, margin-top 2px, ellipsis.
  3. **One status phrase**, 13px, nothing else (the owner asked for this simplification):
     - Out: `Out since Oct 5` (the `last` date)
     - Low: `3 days left` / `1 day left`
     - Fast: `Up 68%` ((recent/14) ÷ (prior/16) − 1)
  4. **Chevron**: 12px, Faint. Rotates 180° when open, `transition: transform .25s cubic-bezier(.2,.7,.2,1)`.
- **No Order button and no Ignore link on rows** (removed at the owner's request for now). Keep the ignore logic in code if it's cheap; the "N ignored · Undo" footer slot exists.
- **Footer** (padding `10px 18px`, 12px): an accent link "12 more under 28 days of cover →" toggles an inline Watch list below the rows (bg `#F9F9F8`, 3-column grid, `gap 8px 20px`, each item is a mono SKU and "11d · Oct 19").

### 4. Expanded row panel (new)
Only **one row is open at a time**. Clicking an open row closes it.
- Outer: bg `#FBFBFA`. Inner grid: `grid-template-columns: minmax(0,1fr) 250px; gap: 28px 48px; padding: 14px 26px 26px 86px` (left padding lines up with the SKU column).
- **Left: chart**
  - Legend row (flex, gap 16px, margin-bottom 22px):
    - Label "UNITS SOLD PER DAY · LAST 30 DAYS" (10px / 500 / uppercase / .07em / Muted).
    - On the right, the key: a dashed 14px line "30-day average" and a 10×10 `#F1F0EC` swatch "Last 14 days" (11px Faint).
  - Chart box: height **140px**. SVG `viewBox 0 0 600 120`, `preserveAspectRatio="none"`, width 100%.
    - Band showing the last 14 days: rect from x=310 to 600, fill `#F1F0EC`.
    - Area under the line: fill `#E3F2EB` at 0.8 opacity.
    - Line: stroke `#047857`, 1.75px, round joins, `vector-effect: non-scaling-stroke`.
    - 30-day average: dashed `3 3`, 1px, `#A5A29C`.
    - Y scale: `y = 116 − v/max × 104`, where max is the series peak. Label at top-left: "`max`/day", mono 10px Faint.
  - X labels under the chart (margin-top 10px, mono 10.5px Faint): "Sep 9" · "Sep 24" · "Today" (i.e. day −29, −14, 0).
- **Right: four figures** in a 2×2 grid (`gap 24px; padding-top 38px`). Each has a label (10px uppercase .06em Faint), a value (mono), and a note (11px Faint).
  - THIS WEEK: sum of the last 7 days, 22px / 500. Note "last 7 days".
  - THIS MONTH: `sold30`, 22px / 500. Note "last 30 days".
  - PER DAY: `perDay` to 1 decimal, 15px / 500. Note "30-day avg".
  - PACE: `+42%`, 15px / 500. Colour `#1F6C9F` if ≥ +20%, `#9F2F2D` if ≤ −20%, otherwise Text. Note (mono) "15.0 vs 10.6".
- **Bottom, full width: by marketplace.**
  - Container: `border-top: 1px solid rgba(0,0,0,.06); padding-top: 18px`, flex, gap 36px.
  - Label "BY MARKETPLACE · 30 DAYS" (10px / 500 uppercase / Muted).
  - Then **always all three**, even when zero, in order Walmart, eBay, Temu. Each is an 8px dot (`#2E86D9` / `#047857` / `#C97B12`), the name (12px), units (mono 500) and share (mono 11px Faint, e.g. "62%").
  - A marketplace with 0 sales: dot `#D6D4CF`, text Faint.

### 5. Sold today card (contents unchanged, restyled)
- White, 1px `#EAEAEA`, radius 12.
- Top block (padding `14px 18px`):
  - Label "SOLD TODAY".
  - Big number in mono 34px / 500, then "units".
  - "27 orders · 9 SKUs" (12px Muted) and a delta chip "+6 vs yesterday" (bg `#EDF3EC`, text `#346538`, 11px / 500).
  - Share bar: 6px high, radius 3, 2px gaps, segment widths set from code (Walmart / eBay / Temu colours).
  - Legend: 7px dots, 11.5px.
- Table:
  - Header row (bg `#F9F9F8`, top and bottom borders, 10px uppercase Faint): `# | SKU | Units`, columns `22px minmax(0,1fr) 44px`.
  - Rows: mono 11.5px, padding `5px 18px`, hover `#F9F9F8`. Clicking a SKU opens Stock.
  - Total row: 500 weight.

---

## States
1. **Normal**: as above.
2. **All clear** (nothing out, nothing low). Replace the counts line with:
   - A 38px circle (bg `#E3F2EB`) with an 18px check in `#047857`.
   - "Nothing out, nothing running low" (22px / 500).
   - Subline (Muted): "Every SKU has more than 7 days on the shelf — longer than a new order takes to land."
   - Card label becomes "SELLING FAST — NO ACTION NEEDED YET" and lists only the fast rows (still expandable).
3. **Loading** (first open on a station):
   - Header note reads "Started 9:12 AM".
   - In place of the counts: "Reading 30 days of sales…" (20px / 500), then "page 3 of 15" (mono 13px Muted). Below that, a 340×4px progress track (`#EAEAEA`) with an accent fill set from code, and "1m 42s elapsed" (mono 11.5px Faint).
   - The card shows a three-step checklist:
     - done: "Live inventory read · 412 SKUs" (check in an accent-soft circle)
     - current: "Sales history, last 30 days · page 3 of 15" (accent ring with a dot)
     - pending: "Work out what's out, low and selling fast" (grey ring, Faint text)
   - Then the note: "This long read only happens the first time a station opens the Overview. After that, stock levels refresh every 10 minutes in the background. Today's sales are already in."
   - Sold today renders normally, since it arrives first.
4. **Error**:
   - One line under the header, bg `#FDEBEC`, text `#9F2F2D`, radius 6, padding `8px 12px`: "Linnworks refused the request (rate limit). Showing figures from 9:04 AM — retrying in 48s, or press Refresh."
   - The last good data stays visible, and the header note shows the stale time.

## Interactions and motion
- **Row click**: toggles the expanded panel; only one open at a time.
- **Opening animation**:
  - The panel height grows from `grid-template-rows: 0fr → 1fr` over 280ms, `cubic-bezier(.2,.7,.2,1)`. The inner wrapper has `overflow: hidden; min-height: 0`.
  - The content fades and rises (opacity 0 → 1, translateY −8px → 0) over 320ms, same easing, 50ms delay.
  - The chart line and area draw left to right: a clip rect goes `scaleX(0 → 1)` from the left over 800ms, `cubic-bezier(.3,.7,.3,1)`, 150ms delay.
  - Closing is instant in the prototype; a reverse animation is fine.
- **Chart hover**: a transparent overlay tracks the mouse and snaps to the nearest of the 30 days:
  - A 1px vertical guide `rgba(47,52,55,.22)`.
  - A 9px dot (white fill, 2px `#047857` border) on the line.
  - A dark tooltip above the chart: bg `#2F3437`, white 11px text, radius 6, padding `4px 8px`, shadow `0 2px 8px rgba(0,0,0,.12)`. It reads "Tue, Oct 3" in `#C9C7C2` followed by "14 units" in mono 500; the last day reads "Today".
  - The tooltip is clamped at the left and right edges. It hides on mouse leave.
  - Cursor: crosshair.
- **SKU click** (rows, watch list, sold-today table) → Stock page filtered to that SKU.
- **Refresh** → re-fetch; the "Updated" time changes.

## Data (wiring notes)
Everything comes from brief §3. **Three small additions** are needed:
1. **Daily units per SKU for 30 days** (array of 30 integers, oldest first) — for the chart and "This week". Derive it from the same processed orders already walked for `sold30`. No new API call.
2. **Units per marketplace per SKU for 30 days** `{walmart, ebay, temu}` — today only `channels` (names) exists.
3. **Selling-fast group**: "now X/day, was Y/day" (brief §3 already describes this as a small addition).

Group rules are unchanged from brief §3:
- **Out & still selling**: avail 0, atWfs 0, ≥1 sale a week.
- **Running low**: daysLeft ≤ lead time; `faster` when the last 14 days run 20%+ above the 16 before.
- **Selling fast**: pace +20% with ≥3 units in the last 14 days.
- **Watch**: everything else under lead + cover days.

## State
- `openSku` (string or null): which row is expanded.
- `hover` `{sku, dayIndex}` or null: chart tooltip.
- `showWatch` (bool).
- `ignored` (kept from the existing feature, even though there's no button on rows right now).
- Page state: `loading | error | ready`, with `ready` deriving All-clear when the out and low groups are both empty.

## Design tokens used
- Canvas `#F7F6F3` · Surface `#FFFFFF` · Surface-2 `#F9F9F8` · expanded/hover row `#FBFBFA` · 14-day band `#F1F0EC`
- Border `#EAEAEA` · Border-soft `rgba(0,0,0,.06)` · disabled dot `#D6D4CF`
- Text `#2F3437` · Muted `#787774` · Faint `#A5A29C` · tooltip date `#C9C7C2`
- Accent `#047857` / hover `#065F46` · Accent soft `#E3F2EB`
- Positive `#EDF3EC` / `#346538` · Negative `#FDEBEC` / `#9F2F2D` · Yellow `#FBF3DB` / `#956400` · Blue `#E1F3FE` / `#1F6C9F`
- **New:** Hot `#FCEADF` / `#B4501B`
- Marketplaces: Walmart `#2E86D9` · eBay `#047857` · Temu `#C97B12`
- Radii: cards 12, buttons and banners 6, badges 4
- Type: big counts 38 · sold-today number 34 · panel figures 22 / 15 · body 12.5–13 · table 11.5 · labels 10–10.5 uppercase
- Shadows: only on the chart tooltip (popover)

## Assets
No images. Inline SVG icons only: refresh, chevron, check, flame. The paths are in the prototype file.

## Files
- `OverviewStatusQueue.dc.html`: the 1a prototype (open with `support.js` next to it; `state` prop switches states).
- `support.js`: runtime needed to open the prototype in a browser. Not for the app.
- `overview-redesign-brief.md`: the original brief (data fields, rules, constraints).
