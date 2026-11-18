# DWS Server: the office database

One program on one always-on office computer. Every DWS Stock computer shares its database, in place of each computer keeping its own files in the Google Drive folder.

- **One set of records** in five sections: Returns, Stock, Orders, Pricing, Recovery.
- **A login for each person**, with a role: Owner, Returns room, Stock room or View only. Costs and Recovery are hidden unless a login is given them.
- **A history of every change**: who, when, from which computer, and the record before and after.
- **No silent overwrites.** A save made from an out-of-date copy is refused and shown the other person's version; "Keep both" puts your changes on top of theirs.
- **One computer at a time on an order.** A PO# that already has a label is refused, and an order someone is working on is held for them.
- **A page to read it all**, in any browser on the office network, sized for a phone too.

## Where this stands

Built and tested: the server, the logins, the history, the page, and the importer that reads the existing Drive folder.

Not built yet: **DWS Stock itself does not talk to this server.** The desktops still share through Google Drive. Until that is done the server shows a copy of the Drive folder as of the last import.

Not tried yet: running on Windows, and importing the real folder. Both have only been run on a test machine with a made-up folder (`node server/demo-folder.js`).

## Run it on the office computer

1. Install **Node.js 22 or newer** (the LTS installer from nodejs.org).
2. Copy this `server` folder onto the computer, for example to `C:\DWS-Server`.
3. In that folder, start it:

   ```bash
   node dws-server.js
   ```

4. Open `http://localhost:8790` on that computer. The first visit creates the owner login.
5. Add a login for each person on the **Logins** tab.

From any other computer or phone on the office network, open `http://<office-computer-name>:8790`. Windows may ask whether to allow Node on the network the first time; allow it for private networks.

## Bring in the Drive folder

```bash
node import-folder.js "G:\My Drive\returns-sync"
```

It only reads the folder. Nothing in it is changed, moved or deleted. It combines every computer's files by the rules DWS Stock uses (newest change wins, an order logged by several computers counts once, a deleted record stays deleted), prints how many records of each kind came in, and names any file it has no table for. Running it again only adds what is new.

## Backups

The server writes a full copy of the database into `dws-data/backups` once a day and keeps the newest 14. That copy is on the same computer, so set a second place that leaves the building, such as a folder Google Drive syncs:

```bash
set DWS_BACKUP_DIR=G:\My Drive\DWS Server backups
```

The Logins tab shows when the last backup ran and has a **Back up now** button.

## Settings

All optional, as environment variables: `DWS_DATA` (folder for the database, default `./dws-data`), `DWS_PORT` (default 8790), `DWS_HOST` (default every computer on the network; `127.0.0.1` for this computer only), `DWS_BACKUP_DIR`.

## Limits to know

- It speaks plain HTTP. That is fine inside the office and **not** safe on the open internet: do not forward a router port to it. Reaching it from home or a phone outside the office needs a private connection (such as Tailscale) set up separately.
- If this computer is off, nothing is shared until it is back.
- The page can add and edit returns. Everything else is read-only on the page for now.

## Files

| File | What it is |
|---|---|
| `dws-server.js` | The server: sign-in, permissions, the record and history API, live updates, backups |
| `store.js` | The database: tables, the kinds of records and how each reads as a row, roles |
| `import-folder.js` | Reads a returns-sync folder into the database |
| `public/index.html` | The page |
| `demo-folder.js` | Writes a made-up returns-sync folder for trying things out |
| `test-server.js` | The checks: `node server/test-server.js` |
