# DWS Stock WhatsApp bot — setup

The bot lives in a WhatsApp group with you and your dad. Every evening it
posts the shopping list (what to buy, how many). It posts right away when a
fast seller sells out, and it answers a few commands. It runs on
Railway, a hosting service, so none of your computers has to stay on.

```
Linnworks API ──► bot on Railway ──────────► WhatsApp group (you + dad + bot)
                   (always on)          ◄── replies: bought / stock / list
```

The figures come from Linnworks, worked out with the same reorder maths as
DWS Stock's **Export SKUs + 30-day sales**. The bot and the app always agree.

Allow about 20 minutes. You need:
- the spare phone with WhatsApp set up on the spare number
- your Linnworks app details (step 1)
- a card for Railway (about $5 a month)

---

## 1. Linnworks login for the bot

The bot needs three values: **Application ID**, **Application Secret** and
**Installation token**.

- **Best:** a separate Linnworks app just for the bot, made in the Linnworks
  developer portal the same way DWS Stock's was. Give it only **read**
  permissions (inventory and processed orders). If it ever leaks, it can't
  change anything, and you can delete it without touching DWS Stock.
- **Quick start:** use the same three values DWS Stock uses (its Settings),
  and switch to a separate app later.

## 2. Put the bot on Railway

Railway runs the bot for you: nothing to log into and no commands to type.
About $5 a month on the Hobby plan.

1. **Sign up** at **railway.com** with **Sign in with GitHub**, and pick the
   **Hobby** plan. In your account settings, turn on **two-step login**:
   whoever controls this account controls the bot.
2. **New Project → Deploy from GitHub repo →** `capture-station`. Allow
   Railway access to that repo when GitHub asks.
3. Click the new service, open **Settings → Source**, and set the **branch**
   the bot's code is on (until it's merged into main, that's
   `claude/determined-brahmagupta-fcuyye`).
4. **Variables → Raw Editor**, paste this, fill in your values, and save:
   ```
   RAILWAY_DOCKERFILE_PATH=bot/Dockerfile
   LINNWORKS_APP_ID=
   LINNWORKS_APP_SECRET=
   LINNWORKS_TOKEN=
   LINNWORKS_LOCATION=Default
   TZ=America/New_York
   DAILY_TIME=19:00
   ALLOWED_NUMBERS=15551234567,15557654321
   BOT_PHONE=
   NAMES=15551234567=Me,15557654321=Dad
   ```
   | Setting | What to put |
   |---|---|
   | `LINNWORKS_…` | the three values from step 1 |
   | `LINNWORKS_LOCATION` | your warehouse location's name in Linnworks |
   | `TZ` | your time zone, e.g. `America/New_York`, `America/Chicago`, `America/Los_Angeles` |
   | `DAILY_TIME` | when the list arrives, e.g. `19:00` |
   | `ALLOWED_NUMBERS` | your number and your dad's, country code first, comma separated |
   | `BOT_PHONE` | the spare number, same format |
   | `NAMES` | optional: names for those numbers, used in answers and the purchase log |
5. **Add a volume** (where the WhatsApp login and purchase log are kept, so
   they survive restarts and updates). Right-click the project canvas (or
   press Ctrl/⌘+K) → **Volume**, attach it to the bot's service, and set the
   **mount path** to `/data`.
6. **Settings → Restart Policy → Always.** Leave networking alone: the bot
   needs no public address.
7. **Deploy** (Railway may already be building). Open **Deployments → View
   logs**. After the build, the log says
   `WhatsApp is not linked yet: the link code follows` and shows an
   8-character code.
8. On the **spare phone**: WhatsApp → **Settings → Linked devices → Link a
   device → Link with phone number instead**, and type the code. If it
   expired, a new one appears in the log within a minute.
9. The log then says `connected`, and after a minute or two (the first read
   of 30 days of orders):
   `Linnworks: 812 SKUs at Default · to buy: 3 out of stock, 5 order now, 9 order soon`.
   Check that against DWS Stock's Overview. If it says the location wasn't
   found, it lists the names it found: put the right one in
   `LINNWORKS_LOCATION`.

**Updates** arrive by themselves: when the bot's code changes on that
branch, Railway rebuilds and restarts it. The login and data on the volume
stay. Optional: **Settings → Watch Paths** `/bot/**` makes Railway rebuild
only for bot changes, not for every DWS Stock app change.

## 3. The group

1. On your phone, make a WhatsApp group with your dad and the spare number.
2. Send `setup` in the group. The bot introduces itself.
3. Send `list` to see today's list right away.

If the bot doesn't answer, send `whoami` in the group. It replies with the
ids WhatsApp shows for you. Add those digits to `ALLOWED_NUMBERS` (Railway
restarts the bot by itself; on your own server, `systemctl restart dws-bot`).

---

## Using it

| Send | What happens |
|---|---|
| `list` | the shopping list now |
| `stock S25` | stock, sales this week / 30 days, days left, marketplace split |
| `bought S25 30 @ 405 from Ali` | notes the purchase (price and seller optional). The SKU leaves the list until it arrives |
| `history S25` | when it was bought, how many, at what price, from whom |
| `cancel S25` | takes back the last purchase noted for that SKU |
| `status` | when it last read Linnworks, and any error |
| `help` | this list |

You can type part of a SKU. If it matches several, the bot asks which one.
Ordinary chat in the group is ignored.

**Or just ask in plain words** (once the next-but-one section is set up).
Start with `bot`, put `?` in front, @mention the bot, or reply to one of its
messages:

> bot when did we last buy the navy S25, and from who?
> ? what are the top 5 sellers this week
> bot is the A15 selling faster than last month?

It looks the answer up in the same data (stock, 30 days of sales, the
purchase log, last prices). It never makes numbers up: if something was
never recorded, it says so. It can't change anything. Questions follow on
from each other for 30 minutes, so "and the 256GB?" works.

**What it posts on its own:**
- **Every evening at `DAILY_TIME`:** the shopping list, in three groups.
  🔴 out of stock, 🟠 order now (runs out within the lead time), and
  🟡 order soon. Then 🚚 on the way (your `bought` notes).
- **Right away:** when a SKU selling `HOT_PER_DAY` or more (default 0.5 a
  day) sells out. Once per sell-out.
- **If Linnworks stops answering for an hour,** and again when it's back.

**Last prices** show on the list (`buy 30 · last $412`), with a spend total
at those prices, and in `stock` and `history`. Each SKU uses the newer of
its cost in DWS Stock (once the next section is set up) and the latest
`bought … @ price`. A SKU with no price yet is counted, never guessed.

**A `bought` note clears itself** when the stock arrives (on hand goes up),
when a Linnworks purchase order covers it (Due in), or after `BOUGHT_DAYS`
(21 days by default).

Open box, used and scrap SKUs never appear, the same as on the Overview.

## Last prices from DWS Stock (optional, about 15 minutes)

Without this, prices come only from `bought … @ price` notes. With it, the
bot also reads the costs DWS Stock keeps in your shared Drive folder. It
signs in as its own Google "service account" that can **view that one
folder and nothing else** in your Drive.

1. Go to **console.cloud.google.com**, signed in with the Google account
   that owns the shared folder. Create a project (any name, e.g. "DWS bot").
2. **APIs & Services → Library**: search **Google Drive API** → **Enable**.
3. **IAM & Admin → Service accounts → Create service account**. Name it
   `dws-bot` and skip the optional steps. Note its email
   (`dws-bot@….iam.gserviceaccount.com`).
4. Open it → **Keys → Add key → Create new key → JSON**. A file downloads.
   **Treat it like a password.**
5. In Google Drive, open the **shared folder** DWS Stock syncs (the one with
   the `costs-….jsonl` files). **Share** it with the service account's
   email as **Viewer**, and untick "Notify".
6. Copy the folder's link from the address bar
   (`https://drive.google.com/drive/folders/…`).
7. **On Railway:** open the downloaded key file in a text editor, copy all
   of it, and paste it as the value of a new variable `GOOGLE_KEY_JSON`.
   Add `DRIVE_FOLDER_ID` = the link from step 6. Railway restarts the bot,
   and `status` in the group shows how many costs it read. Then delete the
   downloaded file. (Steps 8–9 are for your own server instead.)

   **On your own server:** copy the key file over Tailscale, from your computer:
   ```bash
   scp ~/Downloads/THE-KEY-FILE.json root@SERVER-NAME:/home/dwsbot/capture-station/bot/google-key.json
   ssh root@SERVER-NAME "chown dwsbot: /home/dwsbot/capture-station/bot/google-key.json && chmod 600 /home/dwsbot/capture-station/bot/google-key.json"
   ```
   Then delete the downloaded copy from your computer.
8. In `bot/.env`, set:
   ```
   GOOGLE_KEY_FILE=google-key.json
   DRIVE_FOLDER_ID=https://drive.google.com/drive/folders/…   (the link from step 6)
   ```
9. As `dwsbot`, run `npm run preview` (it should say "N costs from Drive"),
   then, as root, `systemctl restart dws-bot`. `status` in the group shows
   how many costs it read.

**If Google refuses:**
- *"Key creation is disabled"* in step 4 means your Google Workspace has the
  policy that blocks service-account keys. The Workspace admin can allow it
  for this one project under **IAM → Organization policies**.
- *"no costs-*.jsonl files … is it shared?"* means the folder isn't shared
  with the service account's email, or Workspace sharing settings block
  sharing outside your domain. Check step 5.

**Off switch:** remove the service account from the folder's sharing, or
delete its key in the Cloud console.

## Plain-language questions (optional, about 5 minutes)

The bot uses Claude, through Anthropic's API, to understand questions. You
pay Anthropic per question.

1. Go to **console.anthropic.com**, sign up or sign in, and add a payment
   method (**Settings → Billing**). Setting a monthly spend limit there is a
   good idea.
2. **Settings → API keys → Create key**. Name it `dws-bot` and copy it.
   **Treat it like a password.**
3. Add the variable `ANTHROPIC_API_KEY` = the key (Railway → Variables; on
   your own server, in `bot/.env`, then `systemctl restart dws-bot`).
   Railway restarts the bot by itself.
4. Ask in the group, e.g. `bot what's selling fastest this week?`

**Cost.** `status` in the group shows today's questions and the
approximate spend. Two settings control it:
- `CLAUDE_MODEL`: `claude-opus-5-5` (the default) answers best.
  `claude-haiku-5-5` costs a small fraction per question and handles simple
  lookups well. Try it if the bill matters more than the odd harder
  question.
- `AI_DAILY_LIMIT` (default 200) caps questions per day. Past it, the bot
  says so, and the commands keep working.

What gets sent to Anthropic: the question, plus the stock, sales and
purchase figures the bot looks up to answer it. Customer names and
addresses are never included, because the bot doesn't have them.

**Off switch:** delete the key in the Anthropic console, or remove
`ANTHROPIC_API_KEY` from `.env` and restart. The commands keep working.

## Looking after it

- **Keep the spare phone charged and open WhatsApp on it about once a
  week.** WhatsApp logs out linked devices when the phone is unused for
  around two weeks.
- **Check the linked devices on the spare phone now and then:**
  WhatsApp → Linked devices. There should be exactly one entry, the server.
  Log out anything else.
- **Optional:** put a Make.com webhook (or any https webhook) in
  `ALERT_WEBHOOK_URL`, with an email step behind it. The bot calls it if
  WhatsApp ever logs it out, so it can't go quiet without you knowing.

**If it gets logged out:** on Railway the bot restarts and shows a new link
code in the logs: link it as in step 2.8. On your own server the bot stops and waits. On the server, as
`dwsbot`, run `cd ~/capture-station/bot && npm run link` again. Then, as
root, run `systemctl restart dws-bot`.

**Updating the bot on your own server** (on Railway it's automatic):

```bash
su - dwsbot
cd capture-station && git pull && cd bot && npm ci --omit=dev
exit
systemctl restart dws-bot
```

## If something ever goes wrong (off switch)

1. **Linnworks:** delete the bot's app or installation. It can no longer read anything.
   **Drive:** remove the service account from the shared folder.
   **Anthropic:** delete the bot's API key in the console.
2. **WhatsApp:** on the spare phone, Linked devices → log out the server.
3. **Railway:** remove the service (or on your own server,
   `systemctl stop dws-bot`).

DWS Stock keeps working as normal throughout. The bot only reads.

---

## Alternative: your own server

If you'd rather run it on a server you manage (Hetzner, DigitalOcean), these
steps replace step 2. Settings then go in `bot/.env` (copy
`.env.example`) instead of Railway's Variables.

### A. Create the server

1. Sign up at **Hetzner Cloud** (CX22, about €4–5/month) or **DigitalOcean**
   (Basic droplet, $6/month).
2. **Turn on two-step login for that account first.** Whoever controls this
   account controls the bot.
3. Create a server with **Ubuntu 24.04**, the smallest size, in the region
   nearest you.
4. When it asks for an SSH key, add yours. This replaces a password. If you
   don't have one, run `ssh-keygen -t ed25519` on your computer and paste in
   the contents of the `.pub` file it makes.
5. Note the server's IP address.

### B. Lock the server down

From your computer:

```bash
ssh root@SERVER_IP
```

Then on the server:

```bash
# updates, and automatic security updates from now on
apt update && apt -y upgrade
apt -y install unattended-upgrades git ufw
dpkg-reconfigure -f noninteractive unattended-upgrades

# Tailscale: only your own devices will be able to log in
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --ssh
```

`tailscale up` prints a link. Open it and log in to the same Tailscale
account your phone dashboard uses. Then **close this session and log back in
over Tailscale**, using the server's name in your Tailscale admin page:

```bash
ssh root@SERVER-NAME
```

Now close every port to the outside world:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0
ufw enable
```

From here on, the server can only be reached from your Tailscale devices.
The bot only makes outgoing connections, so it doesn't need any open ports.
If you ever lock yourself out, use the web console on the Hetzner or
DigitalOcean site.

### C. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs
node --version   # should say v22.something
```

### D. Get the bot's code

The bot runs as its own user, with a **read-only key** to the repository.
This works even after the repository is made private.

```bash
adduser --disabled-password --gecos "" dwsbot
su - dwsbot
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```

Copy the line it prints. On GitHub, open the repository → **Settings →
Deploy keys → Add deploy key**, paste it in, and **leave "Allow write
access" unticked**. Then, still on the server:

```bash
git clone git@github.com:amiablet21/capture-station.git
cd capture-station/bot
npm ci --omit=dev
```

(Until this branch is merged, add `-b claude/determined-brahmagupta-fcuyye`
to the `git clone` line.)

### E. Settings

```bash
cp .env.example .env
chmod 600 .env        # only the bot's user can read it
nano .env
```

Fill in:

| Setting | What to put |
|---|---|
| `LINNWORKS_APP_ID`, `LINNWORKS_APP_SECRET`, `LINNWORKS_TOKEN` | from step 1 |
| `LINNWORKS_LOCATION` | your warehouse location's name in Linnworks (DWS Stock's stock location) |
| `TZ` | your time zone, e.g. `America/New_York`, `America/Chicago`, `America/Los_Angeles` |
| `DAILY_TIME` | when the list arrives, e.g. `19:00` |
| `ALLOWED_NUMBERS` | your number and your dad's, country code first, comma separated, e.g. `15551234567,15557654321` |
| `BOT_PHONE` | the spare number, same format |

Save with Ctrl+O, Enter, then Ctrl+X.

**Check Linnworks before involving WhatsApp:**

```bash
npm run preview
```

The first run reads 30 days of orders, which takes a few minutes. It then
prints the shopping list in the terminal. It should match what the
Overview in DWS Stock shows. If it says the location wasn't found, it lists
the names it found. Put the right one in `LINNWORKS_LOCATION`.

### F. Link the spare number

```bash
npm run link
```

It prints an 8-character code. On the **spare phone**: WhatsApp →
**Settings → Linked devices → Link a device → Link with phone number
instead**, and type the code. The terminal says `linked` and exits.

(If `BOT_PHONE` is empty, it shows a QR code to scan instead.)

### G. Start it for good

```bash
exit                                   # back to root
cp /home/dwsbot/capture-station/bot/dws-bot.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now dws-bot
journalctl -u dws-bot -f               # watch it; Ctrl+C to stop watching
```

You should see `connected` and then `running: checks every 15 min…`. It now
starts by itself after reboots and restarts itself if it ever crashes.

