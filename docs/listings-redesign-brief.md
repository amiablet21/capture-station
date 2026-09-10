# Listings (eBay) page — redesign brief for Claude Design

Context document for redesigning the **Listings › eBay** tab of Capture Station.
Everything a design session needs is in this one file: what the product is, what
the page does today, the full design system it must match, and the hard
constraints the mockups have to respect.

> **Process rule (owner):** the eBay tab's three-panel layout is LOCKED in
> production. Nothing ships from this brief directly — produce **mockup
> variants** for sign-off first. Approved mockups get implemented afterward in
> the real app.

---

## 1. The product

**Capture Station** is a production Electron desktop app (currently v1.20.x)
used daily by a phone-reselling operation. The business buys phone/tablet stock,
sells new units on Walmart/eBay/Temu through Linnworks, and re-lists returned
units on eBay under condition SKUs. The app has tabs for Overview (money
dashboard), Capture (serial scanning), Stock, Returns, and **Listings**.

**Listings** is where returned inventory gets turned into eBay listings (and a
Temu sub-tab does the same for new stock — out of scope here, but the redesign
should not paint it into a corner: both sub-tabs share the page chrome and the
`eBay | Temu` toggle pill at the top).

The user is the owner plus employees at stations. It is a keyboard-and-mouse
desktop tool, data-dense, used for hours at a time. Think "cockpit", not
"landing page".

## 2. The page today — three panels, left to right

### Panel A — "To list on eBay" (queue)

- A scrollable list of condition SKUs waiting to be listed, fed by a Linnworks
  scan of unlisted stock. Buttons: **Refresh**, **New listing** (from-scratch).
- Each row: monospace SKU (`OPEN-BOX-S25-FE-256GB-ICYBLUE`), a condition badge
  (Open Box = blue, Used = yellow, For Parts/Scrap = red), unit count, and a
  small `DRAFT` tag when a saved draft exists for that SKU.
- Clicking a row loads/resumes it in Panel B. Exported SKUs leave the queue.

### Panel B — "Listing" (the form)

Header row: undo / redo buttons, **Discard**, and a settings gear.

Fields, top to bottom:

- **SKU** (read-only unless from-scratch).
- **Title** — free text with a *live character counter out of 80* (eBay's hard
  cap). Today the counter is plain text under the field; at 80/80 it matters a
  lot (the app auto-trims titles to fit condition suffixes like " - Used").
- **Condition** — four toggle buttons: New / Open Box / Used / Parts.
- **Version** — US / Global dropdown ("shown in the listing description only").
- **Specifics** — a two-column grid of ~18 labeled inputs (Brand, Model, MPN,
  Storage Capacity, Color, Screen Size, Processor, RAM Size, Type, Internet
  Connectivity, Operating System, Network, Connectivity, Display Type, Maximum
  Resolution, Features, Charger Included, Country of Origin) plus an "add
  specific" button. Empty fields simply stay off the listing — the owner wants
  the full sheet laid out with no add-specific clicking for the core set.
  Empty *core* fields (Brand/Model/Storage/Color) get an amber "missing" tint
  in manual mode.
- **Source line** under the specifics — one of three states:
  - `✓ copied from your live NEW listing <item#>` (specs scraped from the
    seller's own live listing, cached per model),
  - amber `⚠ no NEW listing found — fill once, saved for every future <model>
    return` (manual mode),
  - a transient `⏳ reading your live eBay listing…` loading state.
- **Variations** — cards for sibling SKUs (same model + condition) that were
  auto-absorbed from the queue (compact card: storage · color, SKU, per-var
  price + qty inputs, ✕ to eject), hand-added variation cards (editable
  storage/color/price/qty), and "ghost" cards for family members *already live
  on eBay* (`live on eBay` tag + `open ↗` button — never exported).
- **Photos** — thumbnail strip; click a thumb to open a photo editor
  (crop/rotate/filter), ✕ removes, a camera/QR button opens a phone-capture QR
  for shooting photos on a phone, plus "add photos". First photo is tagged as
  the main shot.
- **Price / Qty** and an **Export** button (writes an eBay Seller Hub CSV) with
  a note line for missing bits ("no photos yet", "no eBay category…").

### Panel C — "Buyer sees" (description preview)

A live, pixel-faithful preview of the HTML description the export uploads to
eBay: WirelessTechnoStore branded header, the listing title, a condition badge
(BRAND NEW / OPEN BOX / USED • TESTED & WORKING / FOR PARTS), a condition
blurb, a Specification/Details table (the filled specifics + Version +
Condition), "Package Includes", a photo gallery, and a branded footer.

**Important:** this preview's *inner* design is the seller's eBay branding, not
app UI. The same HTML string is exported verbatim to eBay (with inline styles,
since eBay knows nothing of app CSS). Redesign the **frame** it sits in (panel
chrome, width behavior, scroll) freely, but the description contents itself is
a separate design surface — flag ideas for it separately rather than silently
restyling it.

## 3. Data flow worth knowing (drives UI states)

- Selecting a queue SKU: resume draft if one exists → else try the cached
  per-model card → else scrape the user's own live NEW listing → else fall to
  manual mode + a public eBay catalog title lookup by UPC/brand-model query.
  Each stage has a visible state (draft tag, ✓ / ⚠ / ⏳ source line).
- Drafts persist in localStorage per SKU; every rendered state is an undo step.
- The queue, variations, and ghost cards all derive from the same
  SKU grammar: `[OPEN-BOX|USED|SCRAP]-<MODEL>-<STORAGE>-<COLOR>`.

## 4. Design system — must match exactly

The whole app follows the Return Tracker design system ("Linear-style
utilitarian minimalism", dials: variance 4 / motion 3 / density 7). Full
tokens below; treat them as law.

### Principles

1. **One accent, locked** — emerald carries every interactive element. No
   second accent. Semantic green/red only for profit/loss money values.
2. **Warm monochrome canvas** — off-white/white/gray; color is scarce and
   semantic (condition badges, money).
3. **Hairlines, not shadows** — structure from `1px #EAEAEA` borders and
   background steps; shadows ≤ 0.05 opacity, hover-lift/floating only.
4. **Compact cockpit density** — 13px base type, ~34px table rows, uppercase
   10.5px column headers.
5. **Quiet motion** — 150–250ms, one easing, transform/opacity only, nothing
   loops. **No sounds, ever.**
6. **Mono for data** — SKUs, serials, order #s, money in monospace with
   `tabular-nums`.

### Color tokens

```css
:root {
  --canvas: #F7F6F3;        /* app background — warm bone */
  --surface: #FFFFFF;       /* cards, tables, inputs */
  --surface-2: #F9F9F8;     /* table headers, hover rows, modal footers */
  --border: #EAEAEA;        /* the only border color */
  --border-soft: rgba(0,0,0,0.06);

  --text: #2F3437;          /* charcoal, never pure black */
  --muted: #787774;
  --faint: #A5A29C;

  --accent: #047857;        /* emerald — the one accent */
  --accent-hover: #065F46;
  --accent-soft: #E3F2EB;
  --accent-soft-text: #065F46;

  --pos-bg: #EDF3EC;  --pos-text: #346538;   /* profit/loss ONLY */
  --neg-bg: #FDEBEC;  --neg-text: #9F2F2D;

  --badge-blue-bg: #E1F3FE;   --badge-blue-text: #1F6C9F;   /* Open Box */
  --badge-yellow-bg: #FBF3DB; --badge-yellow-text: #956400; /* Used */
  --badge-red-bg: #FDEBEC;    --badge-red-text: #9F2F2D;    /* Scrap/Parts */
}
```

Dark surfaces exactly once: toasts invert (`#2F3437` bg, `#F7F6F3` text).

### Typography

| Role | Font | Spec |
|---|---|---|
| UI / body | Geist (variable) | 13px / 400–500, lh 1.6 |
| Page title | Geist | 16px / 600, ls −0.02em |
| Section title | Geist | 13.5px / 600 |
| Stat numbers | Geist Mono | 21px / 600, ls −0.02em |
| SKUs, money | Geist Mono | 12.5px, tabular-nums |
| Table/panel headers | Geist | 10.5px / 600, UPPERCASE, ls 0.06em, `--faint` |
| Badges | Geist | 10.5px / 600, UPPERCASE, ls 0.05em |

Fallbacks: `'Segoe UI Variable', 'Segoe UI', sans-serif` / `'Cascadia Mono',
monospace`. Never Inter/Roboto; never pure black.

### Shape, components, motion

- Radius: 8px cards/tables, 6px buttons/inputs, 12px modals, 999px pills
  (badges/count chips only).
- Primary button: emerald bg, white text, no shadow/gradient; ghost button:
  hairline border, muted text. Icon buttons 26px, borderless, tint on hover.
- Inputs: label above, focus = accent border + 3px `--accent-soft` ring.
- Tables/lists: sticky `--surface-2` header; row hover `--surface-2`; row
  actions hidden until hover.
- Empty states are composed: icon + bold title + one sentence that says how to
  populate the view.
- Icons: Phosphor **bold** only, 14–15px. **No emoji anywhere** (current page
  has a few — 📷/✎/✕ — replacing them is fair game and welcome).
- Easing `cubic-bezier(0.16, 1, 0.3, 1)`; modal 200ms fade+rise; hovers
  120–150ms.
- Microcopy: plain and specific, sentence case (uppercase only for
  micro-labels). No marketing clichés.

## 5. Hard technical constraints

- Electron, vanilla JS/HTML/CSS — no framework. Final implementation lives in
  `src/renderer/index.html`, `renderer.js`, `styles.css`.
- **CSP strips inline styles from injected HTML.** Anything rendered via
  `innerHTML` must be styled with classes (or CSSOM after render). Mockups can
  do what they like, but any design that depends on per-element inline styles
  in generated content won't survive implementation.
- `window.prompt` does not exist in Electron — inline editing / dialogs only.
- Desktop-only, resizable window; the three panels currently flex with the
  window. Panel A and C scroll independently of B.
- Existing mockups live in `src/renderer/variants/` (e.g. `ebay-lister.html`
  was the original mockup for this page) — new variants belong there too.

## 6. What "a little better" means — open problems

The owner's ask is to improve the page, not reinvent it. Known friction worth
exploring in variants:

1. **Title feedback** — the 80-char counter is easy to miss; at the cap the
   auto-trim behavior is invisible. A clearer counter/limit treatment (and a
   visible hint when the condition suffix will be appended) would help.
2. **Specifics sprawl** — 18 mostly-empty inputs dominate Panel B. Ideas:
   core four (Brand/Model/Storage/Color) elevated, the long tail collapsed or
   compacted; keep the owner's "no add-specific clicking" rule for the sheet.
3. **Source-state legibility** — the ✓ / ⚠ / ⏳ provenance line (live listing
   vs. catalog vs. manual) is load-bearing information rendered as a small text
   line. It deserves a clearer treatment, especially the manual/amber state
   ("fill once, saved for every future <model> return" is a key promise).
4. **Queue scanability** — long SKU list; grouping by model family or
   condition, and clearer draft/exported affordances, are open ideas.
5. **Variations region** — three visually different card types (auto sibling,
   manual, live-ghost) share one strip; hierarchy between them is muddy.
6. **Photos strip** — small thumbs, emoji buttons, main-photo marker is
   subtle; the phone-QR flow is a hidden gem worth surfacing.
7. **Export confidence** — the export note ("no photos yet · no eBay
   category…") is easy to miss next to a always-enabled-looking button.

Constraints on scope: keep three panels (queue → form → preview) unless a
variant makes an overwhelming case otherwise; keep the eBay/Temu toggle; every
existing capability listed in §2 must remain reachable.

## 7. Deliverable

Artboard mockups (desktop, ~1550px wide content area) of the full page — a
couple of distinct variants exploring the §6 problems, all strictly on the §4
system. Sign-off happens on the mockups; implementation follows separately.
