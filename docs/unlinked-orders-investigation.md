# Open orders "unlinked" flag — investigation notes (2026-07-31)

Status: **app fixed; one open question about Linnworks data to verify manually.**

## Symptom

On the Stock page, a SKU showed a nonzero "In orders" count, but clicking it
opened an empty "No open orders" popup. Seen on `X210-128GB-GRAY` (count 4)
and `S25-FE-128GB-JETBLACK` (count 2).

## What was actually wrong in the app (fixed in v1.2.1)

1. **Single-location fetch.** The popup pulled open orders from the primary
   warehouse only. 43 of 84 open orders lived at other locations (mostly
   "WFS FULFILLED") and were invisible. Now every stock location is swept and
   merged, with a location pill shown on non-primary rows.
2. **Unlinked lines were skipped.** The affected order lines come back from
   `Orders/GetOpenOrders` with `IsUnlinked=true`, and the old code dropped
   such lines. Now lines are matched by internal SKU **or** channel SKU
   regardless of that flag, so the popup shows everything behind the count.
3. Composite/bundle child SKUs are also matched now ("via PARENT-SKU" note).

Verified read-only against the live account: the fixed popup returns exactly
the orders the grid counts (X210: refs 119121310758122, 119121310507810,
119121310540001, 119121299660483 · S25-FE: refs 119121310078834,
119121299095230).

Also relevant: the app loads its backend at launch — after updating, fully
quit and reopen or the old logic keeps running.

## The open question (Linnworks data, not the app)

The API reports those lines as `IsUnlinked=true` **while also carrying the
correct internal SKU** (e.g. `SKU=S25-FE-128GB-JETBLACK`,
`ChannelSKU=S25-FE-128GB-BLACK-INTRL`). The owner confirms these channel SKUs
were mapped in Channel Mapping over a month ago.

Two possible readings:

- **Stale flag (most likely, harmless):** the flag is a leftover stamp from
  when the order downloaded; the line is genuinely linked (it knows the
  internal SKU), stock deducts normally on processing, nothing to do.
- **Genuinely unlinked (needs action):** the line has no stock item attached;
  processing would remove the order from open orders **without deducting
  stock**, silently overstating inventory.

### How to verify (20 seconds)

Open one affected order in Linnworks Open Orders (e.g. Walmart ref ending
078834) and look at the item line:

- Line looks normal (title + SKU, no chain-link/warning icon) → linked, flag
  is noise, process as usual.
- Line shows the unlinked indicator → click the link icon, attach the SKU,
  then process.

### Things noticed along the way (worth checking someday)

- Two Walmart integrations exist (SubSource `10001467995` and
  `wirelesstechnostore`); channel mappings are **per integration** and do not
  carry across.
- Walmart re-lists items with suffixed channel SKUs (`A9+ 64GB NAVY (2)`,
  `A9+ 64GB 5G (1)`); each distinct string needs its own mapping (exact
  match). Several A9+/X210 listings still showed "+ Create" (unmapped) in the
  mapping screen on 2026-07-31.
- Mapping a channel SKU applies to future order downloads; already-downloaded
  open orders keep the link state from download time unless relinked.

The app's popup now displays each line's channel SKU, which makes unmapped or
oddly-named listings easy to spot from inside Capture Station.
