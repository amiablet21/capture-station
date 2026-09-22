// LAN presence for the shared returns log (owner-approved preview
// variants/ret-presence.html, built 2026-09-22). Stations discover each
// other through the SAME shared folder the log already syncs by — each one
// writes presence-<station>.json with its LAN address, and a folder-held
// token gates the HTTP chatter so only folder members can talk. On top of
// that discovery the stations speak directly:
//   · heartbeats every 3s  -> truthful "online now" + who has which row open
//   · edit pings on save   -> peers poke their folder rescan immediately,
//     beating the cloud-drive latency (the folder stays the ONLY source of
//     truth — a ping carries no data, it just says "look soon")
// Every failure here degrades to exactly the pre-presence behavior.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let server = null;
let port = 0;
let folder = '';
let station = '';
let token = '';
let onUpdate = () => {};
let onRemoteEdit = () => {};
let announceTimer = null;
let hbTimer = null;
let myEditing = new Set(); // row gids this station has open in an editor
const peers = new Map(); // station -> { addrs, port, editing, lastOk, fails }

const enabled = () => !!(folder && station);

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces() || {})) {
    for (const ni of list || []) {
      if (ni && ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function readToken() {
  const fp = path.join(folder, 'presence-token.txt');
  try { return fs.readFileSync(fp, 'utf8').trim(); } catch { /* first station mints it */ }
  const t = crypto.randomBytes(16).toString('hex');
  try { fs.writeFileSync(fp, t, { flag: 'wx' }); } catch { /* raced another station */ }
  try { return fs.readFileSync(fp, 'utf8').trim(); } catch { return t; }
}

function announce() {
  try {
    fs.writeFileSync(path.join(folder, `presence-${station}.json`),
      JSON.stringify({ station, addrs: lanIps(), port, ts: Date.now() }));
  } catch { /* folder briefly away — next tick retries */ }
}

function readPeerFiles() {
  let names = [];
  try { names = fs.readdirSync(folder).filter(f => /^presence-.+\.json$/.test(f)); } catch { return; }
  for (const f of names) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8'));
      if (!j || !j.station || j.station === station || !j.port) continue;
      // a file older than a day is an uninstalled/renamed station — ignore
      if (Date.now() - (j.ts || 0) > 24 * 3600 * 1000) continue;
      const p = peers.get(j.station) || { editing: [], lastOk: 0, fails: 0 };
      p.addrs = Array.isArray(j.addrs) ? j.addrs : [];
      p.port = j.port;
      peers.set(j.station, p);
    } catch { /* half-synced file — next scan */ }
  }
}

const isOnline = (p) => p.lastOk && Date.now() - p.lastOk < 12 * 1000;

function snapshot() {
  const online = [];
  const editing = {};
  for (const [name, p] of peers) {
    if (!isOnline(p)) continue;
    online.push(name);
    for (const gid of p.editing || []) editing[gid] = name;
  }
  return { station, online, editing };
}

let lastSnap = '';
function emitUpdate() {
  const snap = snapshot();
  const s = JSON.stringify(snap);
  if (s === lastSnap) return;
  lastSnap = s;
  try { onUpdate(snap); } catch { /* renderer gone */ }
}

function post(addr, prt, pathName, body, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.request({
      host: addr, port: prt, path: pathName, method: 'POST',
      headers: { 'content-type': 'application/json' },
      timeout: timeoutMs || 1200,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(res.statusCode === 200 ? JSON.parse(data) : null); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end(JSON.stringify(body));
  });
}

async function heartbeatAll() {
  if (!enabled()) return;
  readPeerFiles();
  const body = { t: token, station, editing: [...myEditing] };
  await Promise.all([...peers.entries()].map(async ([name, p]) => {
    for (const addr of p.addrs || []) {
      const r = await post(addr, p.port, '/p', body);
      if (r && r.station === name) {
        p.lastOk = Date.now();
        p.fails = 0;
        p.editing = Array.isArray(r.editing) ? r.editing : [];
        p.goodAddr = addr;
        return;
      }
    }
    p.fails = (p.fails || 0) + 1;
  }));
  emitUpdate();
}

function startServer() {
  server = http.createServer((req, res) => {
    if (req.method !== 'POST' || (req.url !== '/p' && req.url !== '/e')) {
      res.writeHead(404); res.end(); return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 64 * 1024) req.destroy(); });
    req.on('end', () => {
      let j = null;
      try { j = JSON.parse(raw); } catch { /* not ours */ }
      if (!j || j.t !== token || !j.station || j.station === station) {
        res.writeHead(403); res.end(); return;
      }
      const p = peers.get(j.station) || { addrs: [], port: 0, editing: [], fails: 0 };
      p.lastOk = Date.now();
      if (req.url === '/p') p.editing = Array.isArray(j.editing) ? j.editing : [];
      peers.set(j.station, p);
      if (req.url === '/e') {
        try { onRemoteEdit(Array.isArray(j.gids) ? j.gids : []); } catch { /* poke only */ }
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ station, editing: [...myEditing] }));
      emitUpdate();
    });
  });
  server.on('error', () => { /* presence stays off, everything else works */ });
  server.listen(0, '0.0.0.0', () => {
    port = server.address().port;
    announce();
    heartbeatAll();
  });
}

function stop() {
  clearInterval(announceTimer);
  clearInterval(hbTimer);
  if (server) { try { server.close(); } catch { /* going down anyway */ } server = null; }
  peers.clear();
  myEditing.clear();
  lastSnap = '';
}

function configure(opts) {
  stop();
  folder = String((opts && opts.folder) || '').trim();
  station = String((opts && opts.station) || '').trim();
  onUpdate = (opts && opts.onUpdate) || (() => {});
  onRemoteEdit = (opts && opts.onRemoteEdit) || (() => {});
  if (!enabled()) return;
  token = readToken();
  startServer();
  announceTimer = setInterval(announce, 30 * 1000);
  hbTimer = setInterval(heartbeatAll, 3 * 1000);
}

function setEditing(gid, on) {
  if (!enabled() || !gid) return;
  if (on) myEditing.add(String(gid)); else myEditing.delete(String(gid));
  heartbeatAll(); // the chip appears/vanishes on the next beat — make it now
}

// "I just saved" — peers poke their folder rescan without waiting for the
// cloud drive. Fire and forget.
function pushEdit(gids) {
  if (!enabled()) return;
  const body = { t: token, station, gids: (gids || []).map(String) };
  for (const p of peers.values()) {
    if (!isOnline(p) || !p.goodAddr) continue;
    post(p.goodAddr, p.port, '/e', body, 900);
  }
}

module.exports = { configure, stop, setEditing, pushEdit, snapshot };
