'use strict';
// Hub sync (owner 2026-11-09: off Google Drive, onto a rented server).
//
// The rest of the app keeps working on a plain local folder, exactly as it
// did on the Drive folder: retsync.js / presence.js read and append the same
// <prefix>-<STATION>.jsonl files. This module is the "sync service" that
// Drive used to be, talking to server/dws-hub.js instead:
//   - THIS station's files (…-<STATION>.jsonl / .json) are uploaded as
//     they grow: only the new whole lines, as a conditional append, so a
//     retry can never double a line and nothing written while offline is
//     lost (the local folder always accepts the write; it uploads later);
//   - every other station's file is downloaded as it grows (only the new
//     bytes), or whole when the server says it was replaced;
//   - the server is long-polled, so another desktop's change lands here in
//     about a second instead of Drive's ten to sixty.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// the same rule the server enforces: lowercase prefix, uppercase station
const NAME_RE = /^([a-z]+(?:-[a-z]+)*)-([A-Z0-9][A-Z0-9-]{0,40})\.(jsonl|json)$/;

let base = '';     // https://hub.example.com
let key = '';
let station = '';
let dir = '';      // the local mirror folder retsync/presence work on
let statePath = '';
let state = { seq: -1, files: {} }; // name -> { gen, size } as last synced
let running = false;
let runId = 0;
let watcher = null;
let pushTimer = null;
let queue = Promise.resolve(); // one sync step at a time
let status = { configured: false, online: false, lastOk: 0, lastError: '', files: 0 };
let onStatus = () => {};

const isOwn = (name) => { const m = name.match(NAME_RE); return !!m && m[2] === station; };
const syncable = (name) => NAME_RE.test(name);

function setStatus(patch) {
  status = { ...status, ...patch };
  try { onStatus(status); } catch { /* UI only */ }
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state = (s && s.base === base && s.station === station) ? s : { seq: -1, files: {} };
  } catch { state = { seq: -1, files: {} }; }
  state.files = state.files || {};
}
function saveState() {
  try { fs.writeFileSync(statePath, JSON.stringify({ ...state, base, station })); } catch { /* next save */ }
}

/* ---------- HTTP ---------- */

async function call(method, p, { body, timeoutMs = 20000, raw = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(base + p, {
      method,
      headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/octet-stream' } : {}) },
      body,
      signal: ctl.signal,
    });
    if (raw && res.ok) {
      return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), gen: res.headers.get('x-gen') || '', size: Number(res.headers.get('x-size')) || 0 };
    }
    let json = null;
    try { json = await res.json(); } catch { /* empty */ }
    if (res.status === 401) throw Object.assign(new Error('The server refused the access key'), { status: 401 });
    return { status: res.status, json: json || {} };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The server did not answer in time');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const enc = encodeURIComponent;

// whole lines only: a line the app is still writing waits for the next pass
function completePart(buf) {
  const cut = buf.lastIndexOf(0x0a);
  return cut < 0 ? Buffer.alloc(0) : buf.subarray(0, cut + 1);
}
function readLocal(name) {
  try { return fs.readFileSync(path.join(dir, name)); } catch { return null; }
}
function writeLocalWhole(name, buf) {
  const fp = path.join(dir, name);
  const tmp = fp + '.hubtmp';
  try { fs.writeFileSync(tmp, buf); fs.renameSync(tmp, fp); }
  catch { fs.writeFileSync(fp, buf); try { fs.rmSync(tmp, { force: true }); } catch { /* gone */ } }
}
const splitLines = (buf) => buf.toString('utf8').split('\n').filter(l => l.length);

/* ---------- this station's files: upload ---------- */

async function putWhole(name, buf) {
  const r = await call('PUT', `/v1/file/${enc(name)}`, { body: buf, timeoutMs: 120000 });
  if (r.status !== 200) throw new Error(r.json.error || `Upload failed (${r.status})`);
  state.files[name] = { gen: r.json.gen, size: r.json.size };
  saveState();
}

async function appendBytes(name, at, gen, buf) {
  const r = await call('POST', `/v1/append/${enc(name)}?at=${at}&gen=${enc(gen)}`, { body: buf, timeoutMs: 120000 });
  if (r.status === 200) {
    state.files[name] = { gen: r.json.gen, size: r.json.size };
    saveState();
    return true;
  }
  if (r.status === 409) return false; // the server moved: the caller merges
  throw new Error(r.json.error || `Upload failed (${r.status})`);
}

// The server's copy and ours disagree (first contact after a migration,
// the server lost the file, or two desktops share a station name). Keep
// every line from both: the server's file stays a prefix so the other
// desktops' incremental reads stay valid, our missing lines go on the end.
async function mergeOwn(name, srv) {
  if (!srv) {
    const local = completePart(readLocal(name) || Buffer.alloc(0));
    await putWhole(name, local);
    return;
  }
  const got = await call('GET', `/v1/file/${enc(name)}?from=0`, { raw: true, timeoutMs: 120000 });
  if (got.status !== 200) throw new Error(`Download failed (${got.status})`);
  const server = got.buf;
  let local = completePart(readLocal(name) || Buffer.alloc(0));
  let extra;
  if (local.length >= server.length && local.subarray(0, server.length).equals(server)) {
    extra = local.subarray(server.length);
  } else {
    const have = new Set(splitLines(server));
    const lines = splitLines(local).filter(l => !have.has(l));
    extra = Buffer.from(lines.length ? lines.join('\n') + '\n' : '', 'utf8');
  }
  if (extra.length) {
    const ok = await appendBytes(name, server.length, got.gen, extra);
    if (!ok) return; // moved again under us: the next pass retries
  } else {
    state.files[name] = { gen: got.gen, size: server.length };
    saveState();
  }
  const merged = Buffer.concat([server, extra]);
  // re-read now, in the same tick as the write: the app appends with sync
  // calls on this thread, so nothing can land between this read and write
  local = readLocal(name) || Buffer.alloc(0);
  if (local.length >= merged.length && local.subarray(0, merged.length).equals(merged)) return;
  const have = new Set(splitLines(merged));
  const newer = splitLines(local).filter(l => !have.has(l));
  writeLocalWhole(name, Buffer.concat([merged, Buffer.from(newer.length ? newer.join('\n') + '\n' : '', 'utf8')]));
}

async function pushOwn(name, srv) {
  const local = readLocal(name);
  if (local === null) {
    // a fresh install under an existing station name: take its history back
    if (srv) await pullWhole(name);
    return;
  }
  const st = state.files[name];
  // presence beacons are rewritten in place, not appended: send them whole
  if (name.endsWith('.json')) {
    if (srv && st && st.gen === srv.gen && st.hash === hashOf(local)) return;
    await putWhole(name, local);
    state.files[name].hash = hashOf(local);
    saveState();
    return;
  }
  const part = completePart(local);
  // the usual case: the server holds exactly what this desktop last sent,
  // and the file has only grown since — send the new lines
  if (srv && st && st.gen === srv.gen && st.size === srv.size && part.length >= srv.size) {
    if (part.length === srv.size) return; // nothing new
    if (await appendBytes(name, srv.size, srv.gen, part.subarray(srv.size))) return;
  }
  await mergeOwn(name, srv);
}
const hashOf = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

/* ---------- other stations' files: download ---------- */

async function pullWhole(name) {
  const got = await call('GET', `/v1/file/${enc(name)}?from=0`, { raw: true, timeoutMs: 120000 });
  if (got.status === 404) return;
  if (got.status !== 200) throw new Error(`Download failed (${got.status})`);
  writeLocalWhole(name, got.buf);
  state.files[name] = { gen: got.gen, size: got.buf.length };
  saveState();
}

async function pullForeign(name, srv) {
  const st = state.files[name];
  let size = -1;
  try { size = fs.statSync(path.join(dir, name)).size; } catch { /* not here yet */ }
  if (st && st.gen === srv.gen && st.size === size && srv.size >= size) {
    if (srv.size === size) return;
    const got = await call('GET', `/v1/file/${enc(name)}?from=${size}&gen=${enc(srv.gen)}`, { raw: true, timeoutMs: 120000 });
    if (got.status === 200) {
      fs.appendFileSync(path.join(dir, name), got.buf);
      state.files[name] = { gen: got.gen, size: size + got.buf.length };
      saveState();
      return;
    }
  }
  await pullWhole(name);
}

/* ---------- one pass ---------- */

async function reconcile(list) {
  const srv = new Map(list.files.map(f => [f.name, f]));
  let local = [];
  try { local = fs.readdirSync(dir).filter(syncable); } catch { /* recreated below */ }
  const names = new Set([...local, ...srv.keys()]);
  for (const name of names) {
    if (!syncable(name)) continue;
    const s = srv.get(name) || null;
    if (isOwn(name)) { await pushOwn(name, s); continue; }
    if (s) { await pullForeign(name, s); continue; }
    // gone from the server (a station was removed): it leaves here too —
    // but only a file this module brought in, never one it has not synced
    if (state.files[name]) {
      try { fs.rmSync(path.join(dir, name), { force: true }); } catch { /* next pass */ }
      delete state.files[name];
      saveState();
    }
  }
  state.seq = list.seq;
  saveState();
  setStatus({ online: true, lastOk: Date.now(), lastError: '', files: srv.size });
}

function serial(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

async function pass(waitS) {
  const r = await call('GET', `/v1/list?since=${state.seq}&wait=${waitS}`, { timeoutMs: (waitS + 15) * 1000 });
  if (r.status !== 200) throw new Error(r.json.error || `Server said ${r.status}`);
  await serial(() => reconcile(r.json));
}

// this station wrote something: upload it now rather than at the next poll
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    if (!running) return;
    serial(async () => {
      const r = await call('GET', '/v1/list?since=-1&wait=0');
      if (r.status !== 200) throw new Error(r.json.error || `Server said ${r.status}`);
      const srv = new Map(r.json.files.map(f => [f.name, f]));
      let local = [];
      try { local = fs.readdirSync(dir).filter(n => syncable(n) && isOwn(n)); } catch { return; }
      for (const name of local) await pushOwn(name, srv.get(name) || null);
      setStatus({ online: true, lastOk: Date.now(), lastError: '' });
    }).catch((e) => setStatus({ online: false, lastError: e.message }));
  }, 300);
}

async function loop(id) {
  let backoff = 2000;
  while (running && id === runId) {
    try {
      await pass(25);
      backoff = 2000;
    } catch (e) {
      setStatus({ online: false, lastError: e.message });
      await new Promise(r => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60000);
    }
  }
}

function stop() {
  running = false;
  runId++;
  clearTimeout(pushTimer);
  if (watcher) { try { watcher.close(); } catch { /* gone */ } watcher = null; }
  setStatus({ configured: false, online: false });
}

// Start (or re-point) the sync. Resolves after the first full pass, or
// after `firstPassMs` when the server is out of reach — the app then runs
// on what the local folder already holds and catches up when it can.
function configure(opts) {
  stop();
  base = String((opts && opts.url) || '').trim().replace(/\/+$/, '');
  if (base && !/^https?:\/\//i.test(base)) base = 'https://' + base;
  key = String((opts && opts.key) || '').trim();
  station = String((opts && opts.station) || '').trim();
  dir = String((opts && opts.dir) || '');
  statePath = String((opts && opts.statePath) || path.join(dir, '..', 'hub-state.json'));
  onStatus = (opts && opts.onStatus) || (() => {});
  if (!base || !key || !station || !dir) return Promise.resolve(false);
  fs.mkdirSync(dir, { recursive: true });
  // presence.js gates its LAN chatter with a folder-held token; every
  // desktop on the same hub derives the same one from the access key
  try {
    fs.writeFileSync(path.join(dir, 'presence-token.txt'),
      crypto.createHash('sha256').update('dws-presence:' + key).digest('hex').slice(0, 32));
  } catch { /* presence stays off */ }
  loadState();
  running = true;
  const id = ++runId;
  setStatus({ configured: true, online: false, lastError: '' });
  try {
    watcher = fs.watch(dir, { persistent: false }, (_ev, name) => {
      if (name && syncable(String(name)) && isOwn(String(name))) schedulePush();
    });
    watcher.on('error', () => { /* the poll still uploads every pass */ });
  } catch { /* same */ }
  // a desktop that has synced before can start on its local copy at once;
  // a first start waits for the hub so its own history is not rebuilt
  // from scratch beside the copy the hub already holds
  const warm = state.seq >= 0;
  const first = pass(0).catch((e) => setStatus({ online: false, lastError: e.message }));
  const timeout = new Promise(r => setTimeout(r, warm ? 0 : (Number(opts.firstPassMs) || 8000)));
  return Promise.race([first, timeout]).then(() => {
    if (running && id === runId) loop(id);
    return true;
  });
}

// the Returns sync popover's ✕: forget a station on every desktop
async function deleteRemote(name) {
  if (!running || !syncable(name)) return { ok: false };
  return serial(async () => {
    const r = await call('DELETE', `/v1/file/${enc(name)}`);
    if (r.status !== 200) return { ok: false, error: r.json.error || `Server said ${r.status}` };
    // this desktop's own file stays: it uploads again on the next pass
    if (!isOwn(name)) { try { fs.rmSync(path.join(dir, name), { force: true }); } catch { /* next pass */ } }
    delete state.files[name];
    saveState();
    return { ok: true };
  });
}

// Settings › Test: can this address and key reach a hub?
async function test(url, k) {
  let b = String(url || '').trim().replace(/\/+$/, '');
  if (b && !/^https?:\/\//i.test(b)) b = 'https://' + b;
  if (!b || !String(k || '').trim()) return { ok: false, error: 'Enter the server address and the access key.' };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const h = await fetch(b + '/v1/health', { signal: ctl.signal });
    const hj = await h.json().catch(() => ({}));
    if (!h.ok || hj.app !== 'dws-hub') return { ok: false, error: 'That address answers, but it is not a DWS Hub.' };
    const r = await fetch(b + '/v1/list?since=-1&wait=0', { headers: { authorization: `Bearer ${String(k).trim()}` }, signal: ctl.signal });
    if (r.status === 401) return { ok: false, error: 'The server refused the access key.' };
    const j = await r.json();
    const stations = new Set((j.files || []).map(f => (String(f.name).match(NAME_RE) || [])[2]).filter(Boolean));
    return { ok: true, files: (j.files || []).length, stations: [...stations].sort() };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'The server did not answer in time.' : `Could not reach the server: ${e.message}` };
  } finally {
    clearTimeout(t);
  }
}

// Moving off Drive: every sync file in the old folder joins the hub. A file
// the hub lacks (or holds less of) is sent whole — these are append-only
// logs, so the longer copy is the more complete one. Safe to run from
// every desktop; the first one does the work, the rest find it done.
async function importFolder(from, { url, key: k } = {}) {
  const b = String(url || base).trim().replace(/\/+$/, '');
  const kk = String(k || key).trim();
  if (!from || !b || !kk) return { ok: false, error: 'Nothing to import.' };
  let names = [];
  try { names = fs.readdirSync(from).filter(n => syncable(n) && n.endsWith('.jsonl')); }
  catch (e) { return { ok: false, error: `Could not read the old folder: ${e.message}` }; }
  const listRes = await fetch(b + '/v1/list?since=-1&wait=0', { headers: { authorization: `Bearer ${kk}` } });
  if (!listRes.ok) return { ok: false, error: `Server said ${listRes.status}` };
  const srv = new Map(((await listRes.json()).files || []).map(f => [f.name, f]));
  let sent = 0;
  for (const name of names) {
    let buf;
    try { buf = completePart(fs.readFileSync(path.join(from, name))); } catch { continue; }
    const s = srv.get(name);
    if (s && s.size >= buf.length) continue;
    const r = await fetch(b + `/v1/file/${enc(name)}`, { method: 'PUT', headers: { authorization: `Bearer ${kk}` }, body: buf });
    if (r.ok) sent++;
  }
  return { ok: true, sent, total: names.length };
}

module.exports = { configure, stop, deleteRemote, test, importFolder, getStatus: () => status, NAME_RE };
