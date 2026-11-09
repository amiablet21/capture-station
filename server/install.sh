#!/usr/bin/env bash
# DWS Hub installer for a fresh Ubuntu 24.04 server (AWS Lightsail / EC2).
# Installs the hub as a service, puts Caddy in front of it for HTTPS
# (automatic Let's Encrypt certificate), and prints the server address and
# access key to type into DWS Stock › Settings › Shared sync.
#
#   curl -fsSL https://raw.githubusercontent.com/amiablet21/capture-station/main/server/install.sh | sudo bash
#
# With your own domain (point its DNS A record at the server first):
#   curl -fsSL …/install.sh | sudo bash -s -- hub.example.com
# Without one, the address is <your-ip>.sslip.io, which needs no setup.
#
# Safe to run again: it updates the hub program and keeps the data and the
# access key.
set -euo pipefail

REF="${DWS_REF:-main}"
DOMAIN="${1:-${DWS_DOMAIN:-}}"
SRC="https://raw.githubusercontent.com/amiablet21/capture-station/${REF}/server/dws-hub.js"

if [ "$(id -u)" != "0" ]; then echo "Run this with sudo." >&2; exit 1; fi
export DEBIAN_FRONTEND=noninteractive

echo "== Packages"
apt-get update -y
apt-get install -y curl gnupg ca-certificates openssl debian-keyring debian-archive-keyring apt-transport-https nodejs

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR}" -lt 18 ]; then
  echo "== Node ${NODE_MAJOR} is too old, installing Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null 2>&1; then
  echo "== Caddy (HTTPS)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "== DWS Hub"
id dws-hub >/dev/null 2>&1 || useradd --system --home /var/lib/dws-hub --shell /usr/sbin/nologin dws-hub
mkdir -p /opt/dws-hub /var/lib/dws-hub
chown dws-hub:dws-hub /var/lib/dws-hub
chmod 700 /var/lib/dws-hub
curl -fsSL "${SRC}" -o /opt/dws-hub/dws-hub.js.new
node --check /opt/dws-hub/dws-hub.js.new
mv /opt/dws-hub/dws-hub.js.new /opt/dws-hub/dws-hub.js

if [ ! -f /etc/dws-hub.env ]; then
  umask 077
  echo "HUB_TOKEN=$(openssl rand -hex 24)" > /etc/dws-hub.env
fi
chmod 600 /etc/dws-hub.env

cat > /etc/systemd/system/dws-hub.service <<'UNIT'
[Unit]
Description=DWS Hub (shared log server for DWS Stock)
After=network-online.target
Wants=network-online.target

[Service]
User=dws-hub
EnvironmentFile=/etc/dws-hub.env
Environment=HUB_DATA=/var/lib/dws-hub
Environment=HOST=127.0.0.1
Environment=PORT=8787
ExecStart=/usr/bin/env node /opt/dws-hub/dws-hub.js
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/dws-hub
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

if [ -z "${DOMAIN}" ]; then
  if [ -f /etc/dws-hub.domain ]; then
    DOMAIN="$(cat /etc/dws-hub.domain)"
  else
    IP="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
    DOMAIN="${IP//./-}.sslip.io"
  fi
fi
echo "${DOMAIN}" > /etc/dws-hub.domain

cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
	encode gzip
	reverse_proxy 127.0.0.1:8787 {
		flush_interval -1
	}
}
CADDY

systemctl daemon-reload
systemctl enable dws-hub >/dev/null 2>&1
systemctl restart dws-hub
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy

echo "== Checking"
ok=""
for _ in $(seq 1 30); do
  if curl -fsS "https://${DOMAIN}/v1/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 3
done

KEY="$(sed -n 's/^HUB_TOKEN=//p' /etc/dws-hub.env)"
echo
echo "================================================================"
if [ -n "${ok}" ]; then
  echo " DWS Hub is running."
else
  echo " DWS Hub is installed, but https://${DOMAIN} does not answer yet."
  echo " Check that ports 80 and 443 are open in the server's firewall"
  echo " (Lightsail: Networking tab › IPv4 Firewall › add HTTPS), then"
  echo " run this script again."
fi
echo
echo " In DWS Stock › Settings › Shared sync, choose \"DWS server\":"
echo "   Server address:  https://${DOMAIN}"
echo "   Access key:      ${KEY}"
echo
echo " Keep the access key private: anyone with it can read the logs."
echo "================================================================"
