# DWS Hub — the shared sync server

DWS Hub replaces the Google Drive / OneDrive shared folder. It holds exactly what the folder held: one log file per record type per desktop (returns, captured orders, stock history, costs, WFS shipments, price changes, wholesale invoices, presence). Every desktop syncs with it directly:

- **Fast.** A change on one desktop reaches the others in about a second (Drive took 10–60 seconds, sometimes much longer).
- **Nothing is dropped.** Each desktop writes to a local copy first. If the internet or the server is down, the change waits on that computer and uploads when the connection is back.
- **No conflicts.** Each desktop still writes only its own files. Uploads are conditional, so a retried upload can never double a line.
- **Small.** One Node.js file (`dws-hub.js`) with no dependencies. The cheapest cloud server is plenty.

## Set it up on AWS Lightsail (about $5 a month)

1. Go to [lightsail.aws.amazon.com](https://lightsail.aws.amazon.com) and **Create instance**:
   - Platform **Linux/Unix**, blueprint **OS Only → Ubuntu 24.04 LTS**
   - Plan: the **$5** plan (512 MB) is enough
   - Name it `dws-hub`, then **Create instance**
2. Open the instance's **Networking** tab:
   - **Attach a static IP** (free while it is attached), so the address never changes
   - Under **IPv4 Firewall**, **Add rule → HTTPS** (port 443). Leave HTTP (port 80) open; it is needed to get the HTTPS certificate.
3. Open the **Connect** tab, click **Connect using SSH**, paste this line and press Enter:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/amiablet21/capture-station/main/server/install.sh | sudo bash
   ```

   After a minute it prints the **Server address** (`https://<your-ip>.sslip.io`) and the **Access key**. Keep the key private: anyone with it can read the logs.
4. Open the **Snapshots** tab and turn on **Automatic snapshots** (a daily backup of the whole server).

Using your own domain instead of `sslip.io`: point a DNS A record (for example `hub.yourdomain.com`) at the static IP, then run the script with the name on the end:

```bash
curl -fsSL https://raw.githubusercontent.com/amiablet21/capture-station/main/server/install.sh | sudo bash -s -- hub.yourdomain.com
```

## Move the desktops over

On each desktop, open **Settings › Shared sync**:

1. Choose **DWS server**.
2. Type the **Server address** and **Access key**, then press **Test server**. It should say "Connected".
3. Leave the station name as it is, and leave the old shared folder set, then **Save**.

The first time a desktop switches, every log in its old shared folder is sent up to the server once, so all the history comes along. Do the desktop with the most complete Drive folder first. The others then only send what the server is missing. Once every desktop is on the server, the Drive folder is no longer used and Google Drive can be removed from those computers.

## Looking after it

- **Update the hub:** run the same install line again. It keeps the data and the access key.
- **Is it running?** `sudo systemctl status dws-hub`. Live log: `sudo journalctl -u dws-hub -f`.
- **The access key:** `sudo cat /etc/dws-hub.env`. To change it, edit that file, run `sudo systemctl restart dws-hub`, then type the new key on every desktop.
- **The data:** plain files in `/var/lib/dws-hub/files`, the same files the Drive folder held. Copying that folder is a complete backup.

## Running it anywhere else

The installer works on any Ubuntu 24.04 server with ports 80 and 443 open (EC2, DigitalOcean, Hetzner, a PC in the warehouse). To run the hub by hand:

```bash
HUB_TOKEN=<a long random key> HUB_DATA=/path/to/data PORT=8787 HOST=0.0.0.0 node dws-hub.js
```

Without Caddy in front it speaks plain HTTP, so only do that on a private network (Tailscale, for example).

## Tests

`node server/test-hub.js` starts a hub on a free port and runs simulated desktops against it: the move from a Drive folder, live sync, half-written lines, the server going down and coming back, two copies of one file merging, and removing a station.
