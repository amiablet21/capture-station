# DWS Stock WhatsApp bot — setup

The bot lives in a WhatsApp group with you and your dad. Every evening it
posts the shopping list (what to buy, how many). It posts right away when a
fast seller sells out, and it answers a few commands. It runs on a small
cloud server, so none of your computers has to stay on.

```
Linnworks API ──► bot on a cloud server ──► WhatsApp group (you + dad + bot)
                   (always on)          ◄── replies: bought / stock / list
```

The figures come from Linnworks, worked out with the same reorder maths as
DWS Stock's **Export SKUs + 30-day sales**. The bot and the app always agree.

Allow about 45 minutes. You need:
- the spare phone with WhatsApp set up on the spare number
- your Linnworks app details (step 1)
- a card for the server (about $5–6 a month)

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

## 2. Create the server

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

## 3. Lock the server down

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

## 4. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs
node --version   # should say v22.something
```

## 5. Get the bot's code

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

## 6. Settings

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

## 7. Link the spare number

```bash
npm run link
```

It prints an 8-character code. On the **spare phone**: WhatsApp →
**Settings → Linked devices → Link a device → Link with phone number
instead**, and type the code. The terminal says `linked` and exits.

(If `BOT_PHONE` is empty, it shows a QR code to scan instead.)

## 8. Start it for good

```bash
exit                                   # back to root
cp /home/dwsbot/capture-station/bot/dws-bot.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now dws-bot
journalctl -u dws-bot -f               # watch it; Ctrl+C to stop watching
```

You should see `connected` and then `running: checks every 15 min…`. It now
starts by itself after reboots and restarts itself if it ever crashes.

## 9. The group

1. On your phone, make a WhatsApp group with your dad and the spare number.
2. Send `setup` in the group. The bot introduces itself.
3. Send `list` to see today's list right away.

If the bot doesn't answer, send `whoami` in the group. It replies with the
ids WhatsApp shows for you. Add those digits to `ALLOWED_NUMBERS`, then
`systemctl restart dws-bot`.

---

## Using it

| Send | What happens |
|---|---|
| `list` | the shopping list now |
| `stock S25` | stock, sales this week / 30 days, days left, marketplace split |
| `bought S25 30 @ 405` | notes the purchase (price optional). The SKU leaves the list until it arrives |
| `cancel S25` | removes a purchase note |
| `status` | when it last read Linnworks, and any error |
| `help` | this list |

You can type part of a SKU. If it matches several, the bot asks which one.
Ordinary chat in the group is ignored.

**What it posts on its own:**
- **Every evening at `DAILY_TIME`:** the shopping list, in three groups.
  🔴 out of stock, 🟠 order now (runs out within the lead time), and
  🟡 order soon. Then 🚚 on the way (your `bought` notes).
- **Right away:** when a SKU selling `HOT_PER_DAY` or more (default 0.5 a
  day) sells out. Once per sell-out.
- **If Linnworks stops answering for an hour,** and again when it's back.

**A `bought` note clears itself** when the stock arrives (on hand goes up),
when a Linnworks purchase order covers it (Due in), or after `BOUGHT_DAYS`
(21 days by default).

Open box, used and scrap SKUs never appear, the same as on the Overview.

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

**If it gets logged out:** the bot stops and waits. On the server, as
`dwsbot`, run `cd ~/capture-station/bot && npm run link` again. Then, as
root, run `systemctl restart dws-bot`.

**Updating the bot** (when I've changed it):

```bash
su - dwsbot
cd capture-station && git pull && cd bot && npm ci --omit=dev
exit
systemctl restart dws-bot
```

## If something ever goes wrong (off switch)

1. **Linnworks:** delete the bot's app or installation. It can no longer read anything.
2. **WhatsApp:** on the spare phone, Linked devices → log out the server.
3. **Server:** `systemctl stop dws-bot`, or delete the server on the
   Hetzner or DigitalOcean site.

DWS Stock keeps working as normal throughout. The bot only reads.
