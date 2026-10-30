# Capture Station / DWS Stock

Electron app for Digital World Shop's packing stations: captures orders and tracking, pushes them to Linnworks, and gives the warehouse a live stock view. The owner works through Claude Code on this repo for Linnworks jobs as well as app changes. This file holds the rules for both.

## Linnworks from a session

`npm run lw -- <command>` runs `tools/linnworks/lw.js`. It reuses the app's own client (`src/main/linnworks.js`). Run it with no command for the full usage.

| Command | What it does |
|---|---|
| `stock SKU...` | Levels per location. `X135*` matches a prefix. |
| `history SKU --since 2026-10-20` | Stock changes on one SKU. Orders are hidden unless `--all`. |
| `changes --since 2026-10-20` | Every manual change of 5+ units on every SKU. This is the duplicate check. |
| `receive SKU=QTY... --by NAME` | Books a delivery in. It previews first and writes only with `--yes`. |
| `price SKU --days 30` | Average selling price by channel and by week. |
| `buylist --pace 10 --min-week 5` | Ranked buy list for a sales peak (Black Friday by default). |

Credentials come only from the environment: `LINNWORKS_APP_ID`, `LINNWORKS_APP_SECRET` and `LINNWORKS_TOKEN` (and `LINNWORKS_LOCATION`, default "Digital World Shop"). Never write them to a file, a commit or a message.

## Rules for changing stock

Writes reach Walmart, eBay and Temu listings within minutes, so:

1. **Check before adding.** Run `receive` without `--yes` first, with `--since` set to the day the goods arrived. It shows every add on those SKUs since then, flags the same or a similar quantity (within 20%), notices reversals, and looks for a similar add under any other SKU. Show the user the preview.
2. **Ask before every write.** Writes include stock changes, new SKUs and reversals. List exactly what will change (SKU, +qty, the level before and after) and wait for a clear yes. A yes for one delivery does not cover the next.
3. **Never re-add a flagged line on your own.** "ALREADY ADDED" or "CHECK" means ask the user. Someone may have counted the shelf instead, for example a stock page "set to 73" covering a pallet of 90. Use `--force` only after the user rules it out.
4. **Label every change** with `--by` (who it is for, e.g. `--by "IMRAN PERSONAL"`) and `--note` (e.g. `"pallet received Wed Oct 21"`). The label becomes the change source in Linnworks.
5. **New SKUs** (`--create`) must be named exactly as the marketplace listing will be, or Linnworks will not link them. Ask for the name when in doubt.
6. **Read back** the level after a write and report it.

## Stock history in the app

DWS Stock's history panel does not read Linnworks. It reads `stocklog-<STATION>.jsonl` files in the shared Google Drive folder **returns-sync** (`G:\My Drive\returns-sync` on the PCs). A change made from this tool shows there only once its rows are in that folder:

- **On a PC synced to the Drive folder:** pass `--stocklog "G:\My Drive\returns-sync\stocklog-<NAME>.jsonl"` to append directly.
- **In a cloud session:** `receive` writes `stocklog-<NAME>.jsonl` locally (git-ignored). Upload its lines to that folder through the Google Drive connector. Append to an existing file rather than replacing it.

Other files there: `stockimports-<STATION>.jsonl` (the app's bulk-import history, the receiving record), `captures-`, `returns-`, `chansales-`, `presence-` and more. Each station only appends to its own files, and every station reads all of them.

## How the business reads the numbers

- **Times:** say them in **US Eastern** (America/New_York). Linnworks stores UTC; the tool converts.
- **Locations:** **Digital World Shop** is the real warehouse stock. **WFS FULFILLED** is units at Walmart's warehouse; they only sell on Walmart, and the Walmart sync rewrites them every 15 minutes, so ignore WFS in duplicate checks. **DropShip** holds dropship pad quantities, not real units. **Default** is empty.
- **"On hand"** means Digital World Shop available plus WFS.
- **SKUs:** `MODEL-STORAGE-COLOR` (e.g. `X135-64GB-GRAY`). `OPEN-BOX-`, `USED-` and `SCRAP-` prefixes are graded stock. "Brand new" means none of those. Stock is often moved from a new SKU to its `OPEN-BOX-` twin (a +N and a −N at the same moment); that is not a delivery.
- **Sales:** prices are ex-tax and before marketplace fees and shipping. Some Temu lines arrive at $0 and are left out of averages.
- **Buy lists:** the Overview's What to buy tab (`src/main/buyplan.js`) and `npm run lw -- buylist` use the same rules; change both together. Pace is the best of the 14, 30 and 60-day averages. The peak multiplier (10× for Black Friday unless told otherwise) applies from the Friday before Thanksgiving week through Cyber Monday. The owner has set aside A15, T220 and Silver Shadow SKUs; pass `--exclude 'SILVER-?SHADOW|^A15-|T220'` unless told otherwise.

## The app

- `src/main`: Electron main process (Linnworks client, SQLite db, shared-folder sync in `retsync.js`).
- `src/renderer`: the UI.
- Releases build from `.github/workflows`, and the README's highlights list each release.
