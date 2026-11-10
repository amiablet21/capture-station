#!/usr/bin/env node
'use strict';
// DWS Hub: the shared-log server every DWS Stock desktop syncs through,
// in place of a Google Drive / OneDrive folder (owner 2026-11-09: "rather
// rent like AWS" — Drive kept dropping and lagging).
//
// It stores exactly what the shared folder held: one append-only file per
// record type per station (returns-FRONT-DESK.jsonl, stocklog-…, costs-…,
// presence-….json). The contract the app was built on carries over:
//   - a station only ever writes its OWN files, so two desktops can never
//     collide on one file;
//   - appends are CONDITIONAL (?at=<size>&gen=<gen>): an append lands only
//     when the station's idea of the file matches the server's, so a
//     retried upload can never double a line;
//   - every file has a generation id, renewed when it is replaced or
//     deleted, so readers know to fetch it whole instead of the tail.
// Desktops long-poll /v1/list, so a change on one reaches the others in
// about a second.
//
// No dependencies: Node 18+. Configure with environment variables:
//   HUB_TOKEN  required. The access key every desktop is given.
//   HUB_DATA   folder for the files (default ./hub-data)
//   PORT       default 8787
//   HOST       default 127.0.0.1 (put Caddy / a TLS proxy in front);
//              0.0.0.0 to listen on every interface (Tailscale-only boxes)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TOKEN = String(process.env.HUB_TOKEN || '').trim();
const DATA = path.resolve(process.env.HUB_DATA || path.join(process.cwd(), 'hub-data'));
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 64 * 1024 * 1024; // a first-time history upload can be a few MB
const MAX_WAIT_S = 30;

// <lowercase-prefix>-<STATION>.jsonl | .json — the only names the app
// writes into the shared folder. The case split is what makes the station
// part unambiguous ("wholesale-customers-FRONT-DESK.jsonl").
const NAME_RE = /^[a-z]+(?:-[a-z]+)*-[A-Z0-9][A-Z0-9-]{0,40}\.jsonl?$/;

const FILES = path.join(DATA, 'files');
const META = path.join(DATA, 'meta.json');

let meta = { seq: 0, files: {} }; // name -> { gen, size, mtime }
const waiters = new Set();

function newGen() {
  return Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}

function saveMeta() {
  const tmp = META + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(meta));
  fs.renameSync(tmp, META);
}

function loadMeta() {
  fs.mkdirSync(FILES, { recursive: true });
  try { meta = JSON.parse(fs.readFileSync(META, 'utf8')); } catch { meta = { seq: 0, files: {} }; }
  if (!meta.files || typeof meta.files !== 'object') meta.files = {};
  meta.seq = Number(meta.seq) || 0;
  // the disk is the truth: a crash between a write and saveMeta, or files
  // copied in by hand (a migration), are picked up here
  const onDisk = new Set();
  for (const name of fs.readdirSync(FILES)) {
    if (!NAME_RE.test(name)) continue;
    onDisk.add(name);
    const st = fs.statSync(path.join(FILES, name));
    const m = meta.files[name];
    if (!m) meta.files[name] = { gen: newGen(), size: st.size, mtime: st.mtimeMs };
    else if (m.size !== st.size) { m.size = st.size; m.mtime = st.mtimeMs; }
  }
  for (const name of Object.keys(meta.files)) if (!onDisk.has(name)) delete meta.files[name];
  meta.seq++;
  saveMeta();
}

function listing() {
  return {
    seq: meta.seq,
    files: Object.entries(meta.files).map(([name, m]) => ({ name, size: m.size, gen: m.gen, mtime: m.mtime })),
  };
}

function changed() {
  meta.seq++;
  saveMeta();
  const body = listing();
  for (const w of waiters) w(body);
  waiters.clear();
}

function authOk(req) {
  const h = String(req.headers.authorization || '');
  const got = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  const a = crypto.createHash('sha256').update(got).digest();
  const b = crypto.createHash('sha256').update(TOKEN).digest();
  return got.length > 0 && crypto.timingSafeEqual(a, b);
}

function send(res, code, obj, headers) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': body.length, 'cache-control': 'no-store', ...(headers || {}) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BODY) { reject(Object.assign(new Error('Body too large'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function fileOf(name) { return path.join(FILES, name); }

async function handle(req, res) {
  const url = new URL(req.url, 'http://hub');
  const parts = url.pathname.split('/').filter(Boolean); // ['v1', op, name?]

  if (req.method === 'GET' && url.pathname === '/v1/health') return send(res, 200, { ok: true, app: 'dws-hub' });
  if (parts[0] !== 'v1') return send(res, 404, { error: 'Not found' });
  if (!authOk(req)) return send(res, 401, { error: 'Wrong access key' });

  const op = parts[1];
  const name = parts[2] ? decodeURIComponent(parts[2]) : '';

  // GET /v1/list?since=<seq>&wait=<s>: the listing; waits for a change when
  // the caller is already up to date (the desktops' near-instant updates)
  if (op === 'list' && req.method === 'GET') {
    const since = Number(url.searchParams.get('since'));
    const wait = Math.min(MAX_WAIT_S, Math.max(0, Number(url.searchParams.get('wait')) || 0));
    if (!wait || !Number.isFinite(since) || since !== meta.seq) return send(res, 200, listing());
    let done = false;
    const finish = (body) => { if (done) return; done = true; waiters.delete(finish); clearTimeout(timer); send(res, 200, body); };
    const timer = setTimeout(() => finish(listing()), wait * 1000);
    waiters.add(finish);
    req.on('close', () => { if (!done) { done = true; waiters.delete(finish); clearTimeout(timer); } });
    return;
  }

  if (op !== 'file' && op !== 'append') return send(res, 404, { error: 'Not found' });
  if (!NAME_RE.test(name)) return send(res, 400, { error: 'Bad file name' });
  const m = meta.files[name];

  // GET /v1/file/<name>?from=<offset>&gen=<gen>: the bytes from an offset
  if (op === 'file' && req.method === 'GET') {
    if (!m) return send(res, 404, { error: 'No such file' });
    const gen = url.searchParams.get('gen');
    if (gen && gen !== m.gen) return send(res, 409, { error: 'File was replaced', gen: m.gen, size: m.size });
    const from = Math.max(0, Number(url.searchParams.get('from')) || 0);
    if (from > m.size) return send(res, 409, { error: 'Offset past end', gen: m.gen, size: m.size });
    const len = m.size - from;
    const buf = Buffer.alloc(len);
    if (len) {
      const fd = fs.openSync(fileOf(name), 'r');
      try { fs.readSync(fd, buf, 0, len, from); } finally { fs.closeSync(fd); }
    }
    res.writeHead(200, {
      'content-type': 'application/octet-stream', 'content-length': len, 'cache-control': 'no-store',
      'x-gen': m.gen, 'x-size': String(m.size),
    });
    return res.end(buf);
  }

  // POST /v1/append/<name>?at=<size>&gen=<gen>: whole lines onto the end,
  // only when the caller's size and generation match (no double appends)
  if (op === 'append' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.length && body[body.length - 1] !== 0x0a) return send(res, 400, { error: 'Append whole lines only' });
    const at = Number(url.searchParams.get('at'));
    const gen = url.searchParams.get('gen') || '';
    if (!m) {
      if (at !== 0) return send(res, 409, { error: 'No such file', gen: '', size: 0 });
      fs.writeFileSync(fileOf(name), body);
      meta.files[name] = { gen: newGen(), size: body.length, mtime: Date.now() };
    } else {
      if (gen !== m.gen || at !== m.size) return send(res, 409, { error: 'Out of date', gen: m.gen, size: m.size });
      if (body.length) fs.appendFileSync(fileOf(name), body);
      m.size += body.length;
      m.mtime = Date.now();
    }
    if (body.length || !m) changed();
    const now = meta.files[name];
    return send(res, 200, { gen: now.gen, size: now.size });
  }

  // PUT /v1/file/<name>: replace the whole file (first upload, or a
  // presence beacon); a new generation tells readers to refetch it whole
  if (op === 'file' && req.method === 'PUT') {
    const body = await readBody(req);
    const tmp = fileOf(name) + '.tmp';
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, fileOf(name));
    meta.files[name] = { gen: newGen(), size: body.length, mtime: Date.now() };
    changed();
    return send(res, 200, { gen: meta.files[name].gen, size: body.length });
  }

  // DELETE /v1/file/<name>: forget a station (Returns › sync popover ✕)
  if (op === 'file' && req.method === 'DELETE') {
    if (m) {
      fs.rmSync(fileOf(name), { force: true });
      delete meta.files[name];
      changed();
    }
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: 'Method not allowed' });
}

function main() {
  if (TOKEN.length < 16) {
    console.error('HUB_TOKEN must be set to an access key of at least 16 characters.');
    process.exit(1);
  }
  loadMeta();
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!res.headersSent) send(res, e.code === 413 ? 413 : 500, { error: e.message });
      else res.destroy();
    });
  });
  server.requestTimeout = 0; // long polls
  server.headersTimeout = 60 * 1000;
  server.keepAliveTimeout = 65 * 1000;
  server.listen(PORT, HOST, () => {
    console.log(`dws-hub listening on ${HOST}:${PORT}, data in ${DATA} (${Object.keys(meta.files).length} files)`);
  });
}

if (require.main === module) main();
module.exports = { NAME_RE };
