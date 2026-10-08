# Overview page — redesign brief for Claude Design

Context document for redesigning the **Overview** tab of Capture Station.
Everything a design session needs is in this one file: what the product is,
what the page does today, exactly which data is available to draw from, the
design system the mockups must match, and the hard constraints.

> **Process rule (owner):** produce **mockup variants** for sign-off first —
> nothing ships from this brief directly. Approved mockups get implemented
> afterward in the real app by the coding session, pixel-for-pixel where the
> design system allows.
>
> **Scope (owner, 2026-10-08):** a full visual REDESIGN of the page. The old
> three-column arrangement is NOT locked; rethink the layout freely. What IS
> locked: the page is about **stock levels** — warnings, running low, selling
> fast — the "Send to WFS" column is **gone for good** ("it is not accurate
> anyway"), the data in §3 is all there is, the design system in §5 is law,
> and the owner wants it **simple**: "I don't want it to look complicated."

---

## 1. The product

**Capture Station** is a production Electron desktop app (currently v1.29.14)
used daily by a phone-and-tablet reselling operation. The business buys stock,
sells new units on Walmart / eBay / Temu through Linnworks (the inventory and
order system), and re-lists returned units on eBay under condition SKUs. The
app has tabs for **Overview**, Capture (serial scanning at the packing bench),
Stock (the inventory sheet), Pricing, Returns, and Listings.

Several desktop stations run the app at once (packing bench, stock room,
office). Settings decide which pages each station shows. The Overview is the
owner's morning glance: "what sold, and what do I need to order before it
bites me." It is a keyboard-and-mouse desktop tool used for hours at a time —
data-dense, calm, "cockpit" not "landing page".

A SKU looks like `X133-64GB-GRAY` (model-storage-colour). Condition SKUs for
returns look like `OPEN-BOX-X133-64GB-GRAY`. Quantities are whole units;
money is US dollars.

## 2. The page today

A centred sheet, 1160px wide by default (the owner can drag the right edge
wider or narrower; the width is remembered). Header row: **Overview** title,
the date ("Thursday, October 8"), an "Updated 9:14 AM" note on the right, and
a small round refresh icon button.

Below it, three cards side by side:

1. **Units sold today** — big number of units, "27 orders · 9 SKUs · +6 vs
   yesterday", a thin share bar in the three marketplace colours, a legend
   (Walmart 26 · eBay 11 · Temu 4), then a small table `# | SKU | Units` of
   today's sold SKUs with a Total row. Clicking a SKU opens the Stock page
   filtered to it. This card is fine in substance; it may be restyled or
   re-laid out, but its contents stay.
2. **Send to WFS** — Walmart fulfilment suggestions. **REMOVE ENTIRELY.** Do
   not design for it, do not leave a slot for it.
3. **Running low** — rows per SKU with a ring dial of days-left, SKU, "63 sold
   · 10 at WFS", an **Order 60** button and an **Ignore** link. This is the
   idea to keep and grow: the page should be *about* this.

What the owner said, verbatim, when asked for the new direction:

> "For the overview page, I want to remove the send to WFS column, it is not
> accurate anyway. I just want the stock level stuff. Maybe like warnings and
> such and running low, selling fast or something like this."
>
> "Also make it more simplified, I don't want it to look complicated."

Five proposals were already shown and rejected (runway bars with a signal
strip of four count tiles; a wall of tinted tiles with sparklines; a four-week
run-out calendar with Gantt bars; a numbers-first ledger table; a plain
three-group list; and three side-by-side cards). Take that as a hint about
what NOT to repeat: no dials, no hatched bars, no four-tile strips, no dense
tables. Find a different, calmer idea.

## 3. The data — everything the page can show

All numbers come from the last **30 days** of processed orders plus a live
read of inventory, computed by the app and refreshed every 10 minutes (today's
numbers every minute). Per SKU the app knows:

| Field | Meaning | Example |
|---|---|---|
| `sku` | the Linnworks SKU | `X133-64GB-GRAY` |
| `title` | the item's name | `Samsung Galaxy Tab A9 64GB Gray` |
| `avail` | units on the shelf now (available, not in open orders) | `38` |
| `atWfs` | units sitting at Walmart's warehouse (informational only) | `10` |
| `sold30` | units sold on every channel in the last 30 days | `379` |
| `perDay` | average units per day over 30 days | `12.6` |
| `recent` / `prior` | units sold in the last 14 days vs the 16 before — the pace trend | `210` / `169` |
| `daysLeft` | on-hand ÷ per-day, whole days | `3` |
| `outOn` | the calendar day it runs out at this pace | `Oct 11` |
| `last` | when it last sold (for items at zero) | `Oct 5` |
| `channels` | which marketplaces sold it | `Walmart + eBay` |
| `order` | suggested order quantity = pace × (lead + cover days) − stock, rounded up to 5 | `320` |
| `cost` | the unit cost (only on stations with the Cost tick; may be hidden) | `$98.40` |

Two settings shape the thresholds: **lead time** (days until a new order
lands, default 7) and **cover days** (how many days of stock to hold beyond
the lead, default 21). So the "target" on hand is 28 days of sales.

Groups the app can compute today, and the exact rule behind each:

- **Out & still selling** — `avail = 0` and `atWfs = 0`, and the SKU sold at
  least 1 a week over the last 30 days. Carries `last` (last sale) and a rough
  missed-sales value per week.
- **Running low** — `daysLeft ≤ lead time` (runs out before a new order could
  arrive). Carries `order`, `outOn`, and a `faster` flag when the last 14 days
  ran 20%+ above the 16 before.
- **Selling fast** — pace up 20%+ over the last 14 days vs the 16 before, with
  at least 3 units in the recent window, regardless of stock. Can carry "now
  X/day, was Y/day" and the days-left at the *new* pace. (Small code addition;
  fine to design for.)
- **Watch** — everything else under 28 days of cover. Usually the longest list;
  the design may hide it behind a count or a link.

Also available for the "sold today" part: today's unit count, order count,
per-marketplace split (Walmart / eBay / Temu), yesterday's total for a "+6 vs
yesterday" delta, and the per-SKU units-sold-today list.

Not available, do not design around: profit, margins, supplier names,
purchase orders, shipment tracking, anything per-hour, anything per-listing.

## 4. Interactions the design must keep

- **Click a SKU** anywhere → opens the Stock page filtered to that SKU.
- **Order N** → opens the Stock page on that SKU with the suggested quantity
  (it does not place an order anywhere; it is a nudge with a number). The
  number must be visible without hovering.
- **Ignore for 7 days** on any warning row → the row leaves the page; an
  "N ignored · Undo" line appears somewhere unobtrusive. An ignore lapses
  early if the SKU's pace grows 50%+.
- **Refresh** icon button and the "Updated 9:14 AM" note stay in the header.
- Counts (how many out / low / fast) must be readable at a glance from across
  the room, without reading rows.

## 5. The design system — law

The app has one visual language and the Overview must look like the rest of
it. These are the real tokens from the app's stylesheet:

```
Canvas            #F7F6F3        (page background)
Surface           #FFFFFF        (cards)
Surface-2         #F9F9F8        (table headers, hover rows)
Border            #EAEAEA        Border-soft rgba(0,0,0,.06)
Text              #2F3437        Muted #787774        Faint #A5A29C
Accent (emerald)  #047857        hover #065F46
Accent soft       #E3F2EB  text #065F46
Positive          bg #EDF3EC  text #346538
Negative          bg #FDEBEC  text #9F2F2D
Badge blue        bg #E1F3FE  text #1F6C9F
Badge yellow      bg #FBF3DB  text #956400
Badge purple      bg #F1E9F8  text #6A2E9E
Marketplaces      Walmart #2E86D9   eBay #047857   Temu #C97B12
Radii             cards 8px (Overview cards use 12px), controls 6px, modals 12px
Fonts             UI: Geist / Segoe UI, sans-serif · numbers & SKUs: Geist Mono
Sizes             body 12.5px, table 11–12px, card labels 10–11px uppercase
                  letter-spaced, one big number per card at 30–36px
Buttons           solid accent for the primary action, "ghost" text buttons
                  for secondary (Ignore), 6px radius, 11–12px type
```

Rules of thumb that the rest of the app follows:

- Light theme only. Flat, no shadows except on popovers. Hairline borders.
- Warning colour is used sparingly: red = out / money being lost now, yellow =
  act this week, blue = information / trend, green = fine or the accent.
- Numbers and SKUs are always monospace with tabular figures.
- Nothing decorative. Every pixel of colour means something.
- Dense is fine; cluttered is not. Whitespace comes from spacing, not from
  hiding data behind clicks.

## 6. Hard constraints

- Desktop only, 1160px default sheet width, usable down to 980px and up to
  1500px when the owner drags it. No mobile layout needed (a separate phone
  page mirrors the numbers and is out of scope).
- The app's Content Security Policy forbids inline `style="…"` attributes in
  the real build; mockups may use them, but any width/percentage bar must be
  something the implementation can set from code (it can).
- No external icon fonts. Simple inline SVG icons are fine.
- Must handle, and the mockups must show, these states:
  1. **Normal** — a few items in each group (2 out, 4 low, 3 fast is a
     realistic morning).
  2. **All clear** — nothing out, nothing low. The page should feel like good
     news, not like something is missing.
  3. **Loading** — the first open on a station walks 30 days of orders, which
     can take a few minutes. The app reports a stage ("Reading 30 days of
     sales… page 3 of 15") and elapsed time; sold-today numbers arrive first.
     Design a waiting state that says what is happening without a bare spinner.
  4. **Error** — Linnworks refused (rate limit, bad credentials). One line of
     plain text; it retries in a minute or on Refresh.
- English only. Dates as "Oct 11". Money as "$1,380".

## 7. Deliverable

Two or three distinct **mockup variants** of the whole page at 1160px, each
showing the Normal state, plus the All-clear and Loading states for the
variant you recommend. Use realistic data from §3 (the examples in the table
are real-shaped). HTML on the tokens above is ideal because it can be copied
into the app's `src/renderer/variants/` folder and built from directly;
images are acceptable.

The owner will pick one and hand it back to the coding session to implement.
