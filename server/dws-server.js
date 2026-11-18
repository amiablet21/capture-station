#!/usr/bin/env node
'use strict';
// DWS Server: the office computer every DWS Stock desktop shares one
// database through (owner 2026-11-18). It replaces "a file per computer in
// a Google Drive folder" with one set of records, a login per person, and a
// history of every change.
//
//   node server/dws-server.js
//
// then open http://<this computer>:8790 from any computer in the office.
// The first visit creates the owner login.
//
// No dependencies: Node 22.5 or newer (it uses Node's built-in SQLite).
// Settings, all optional, as environment variables:
//   DWS_DATA        folder for the database and its backups (default ./dws-data)
//   DWS_PORT        default 8790
//   DWS_HOST        default 0.0.0.0 (every computer on the office network);
//                   127.0.0.1 keeps it to this computer only
//   DWS_BACKUP_DIR  a second place for the nightly backup, e.g. a folder
//                   that Google Drive syncs, so a copy leaves the building
//
// It speaks plain HTTP, which is fine on the office network and NOT fine on
// the open internet: do not forward a router port to it.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const DATA = path.resolve(process.env.DWS_DATA || path.join(process.cwd(), 'dws-data'));
const PORT = Number(process.env.DWS_PORT) || 8790;
const HOST = process.env.DWS_HOST || '0.0.0.0';
const BACKUP_DIR = process.env.DWS_BACKUP_DIR || '';
const PAGE = path.join(__dirname, 'public', 'index.html');
const COOKIE = 'dws_sid';
const MAX_BODY = 2 * 1024 * 1024;

function start({ data = DATA, port = PORT, host = HOST, backupDir = BACKUP_DIR, quiet = false } = {}) {
  const db = store.open(path.join(data, 'dws-server.sqlite'));
  const log = (...a) => { if (!quiet) console.log(new Date().toISOString(), ...a); };

  /* ---------- sign-in throttle: 8 wrong tries locks that name for 5 minutes ---------- */
  const tries = new Map();
  const locked = (key) => { const t = tries.get(key); return !!t && t.n >= 8 && Date.now() - t.at < 5 * 60000; };
  const miss = (key) => { const t = tries.get(key); tries.set(key, { n: t && Date.now() - t.at < 5 * 60000 ? t.n + 1 : 1, at: Date.now() }); };

  /* ---------- live updates (Server-Sent Events) ---------- */
  const streams = new Set();
  db.onChange((ev) => {
    for (const s of streams) {
      if (ev.kind && !store.canRead(s.user, ev.kind)) continue;
      try { s.res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch { streams.delete(s); }
    }
  });
  const beat = setInterval(() => { for (const s of streams) { try { s.res.write(': hb\n\n'); } catch { streams.delete(s); } } }, 25000);
  beat.unref();

  /* ---------- nightly backup ---------- */
  function runBackup() {
    try {
      const dest = db.backup(path.join(data, 'backups'));
      if (backupDir) {
        fs.mkdirSync(backupDir, { recursive: true });
        fs.copyFileSync(dest, path.join(backupDir, path.basename(dest)));
        // the second folder keeps the newest 14 too, or a Drive folder would
        // grow by a full copy every day forever
        const old = fs.readdirSync(backupDir).filter((n) => /^dws-server-\d{4}-\d{2}-\d{2}\.sqlite$/.test(n)).sort().reverse().slice(14);
        for (const n of old) fs.rmSync(path.join(backupDir, n), { force: true });
      }
      db.meta.set('lastBackup', new Date().toISOString());
      db.meta.set('lastBackupError', '');
      log('backup written', dest, backupDir ? `and copied to ${backupDir}` : '');
    } catch (e) { db.meta.set('lastBackupError', `${new Date().toISOString()} ${e.message}`); log('backup FAILED', e.message); }
  }
  const backupTimer = setInterval(() => {
    const last = Date.parse(db.meta.get('lastBackup') || '') || 0;
    if (Date.now() - last > 20 * 3600000 && new Date().getHours() >= 1) runBackup();
  }, 30 * 60000);
  backupTimer.unref();

  /* ---------- request helpers ---------- */
  const send = (res, status, body, headers = {}) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(text);
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
  const tokenOf = (req) => {
    const auth = String(req.headers.authorization || '');
    if (auth.startsWith('Bearer ')) return { token: auth.slice(7).trim(), cookie: false };
    for (const part of String(req.headers.cookie || '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) return { token: decodeURIComponent(v.join('=')), cookie: true };
    }
    return { token: '', cookie: false };
  };

  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, { error: 'Bad address.' }); }
    const p = url.pathname;
    const seg = p.split('/').filter(Boolean).map(decodeURIComponent);

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      try {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'" });
        return res.end(fs.readFileSync(PAGE));
      } catch { return send(res, 500, 'The page file is missing.'); }
    }
    if (seg[0] !== 'api') return send(res, 404, { error: 'Not found.' });

    // a browser sign-in travels in a cookie, so anything that changes data
    // must come from this server's own page: other sites cannot set the header
    const { token, cookie } = tokenOf(req);
    if (req.method !== 'GET' && cookie && req.headers['x-dws'] !== '1') return send(res, 403, { error: 'Refused.' });
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && origin !== `http://${req.headers.host}`) return send(res, 403, { error: 'Refused.' });

    let body = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      try { body = await readBody(req); } catch (e) { return send(res, e.message === 'too large' ? 413 : 400, { error: 'That request could not be read.' }); }
    }

    try {
      /* ---- before sign-in ---- */
      if (seg[1] === 'state' && req.method === 'GET') return send(res, 200, { needsSetup: db.userCount() === 0 });
      if (seg[1] === 'setup' && req.method === 'POST') {
        if (db.userCount() > 0) return send(res, 409, { error: 'The owner login already exists.' });
        db.createUser({ username: body.username, name: body.name, password: body.password, role: 'owner' }, { user: String(body.username || ''), station: '' });
        log('owner login created:', body.username);
        return send(res, 200, { ok: true });
      }
      if (seg[1] === 'login' && req.method === 'POST') {
        const key = String(body.username || '').trim().toLowerCase();
        if (locked(key)) return send(res, 429, { error: 'Too many wrong tries. Wait 5 minutes.' });
        const out = db.login(body.username, body.password, body.station);
        if (!out) { miss(key); return send(res, 401, { error: 'Wrong username or password.' }); }
        tries.delete(key);
        return send(res, 200, { ok: true, token: out.token, user: out.user },
          { 'Set-Cookie': `${COOKIE}=${out.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 30}` });
      }

      /* ---- everything else needs a signed-in person ---- */
      const sess = db.session(token);
      if (!sess) return send(res, 401, { error: 'Sign in first.' });
      const user = sess.user;
      const actor = { user: user.username, station: sess.station };
      const isAdmin = store.can(user, 'admin');

      if (seg[1] === 'logout' && req.method === 'POST') { db.logout(token); return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` }); }
      if (seg[1] === 'me' && req.method === 'GET') {
        return send(res, 200, { user: db.publicUser(user), station: sess.station, areas: db.overview(user),
          roles: isAdmin ? Object.entries(store.ROLES).map(([id, r]) => ({ id, label: r.label, perms: r.perms })) : undefined,
          perms: isAdmin ? store.PERMS : undefined,
          backup: isAdmin ? { last: db.meta.get('lastBackup') || '', error: db.meta.get('lastBackupError') || '', second: !!backupDir } : undefined });
      }

      if (seg[1] === 'events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        const s = { res, user };
        streams.add(s);
        req.on('close', () => streams.delete(s));
        return undefined;
      }

      if (seg[1] === 'records' && seg[2]) {
        const kind = seg[2];
        if (!store.KINDS[kind]) return send(res, 404, { error: 'No such table.' });
        if (!store.canRead(user, kind)) return send(res, 403, { error: 'Your login cannot see this.' });
        const id = seg[3];
        if (req.method === 'GET' && !id) return send(res, 200, db.list(kind, { q: url.searchParams.get('q') || '', limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') }));
        if (req.method === 'GET') { const r = db.get(kind, id); return r && !r.deleted ? send(res, 200, r) : send(res, 404, { error: 'Not found.' }); }
        if (!store.canWrite(user, kind)) return send(res, 403, { error: 'Your login cannot change this.' });
        if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) { if (req.method !== 'DELETE') return send(res, 400, { error: 'Nothing to save.' }); }
        if (req.method === 'POST' && !id) { const out = db.create(kind, body.data, actor, body.id); return send(res, out.ok ? 200 : 409, out); }
        if (store.KINDS[kind].fixed) return send(res, 405, { error: 'This is a log: lines are added, never changed.' });
        if (req.method === 'PUT' && id) { const out = db.update(kind, id, body.data, body.version, actor); return send(res, out.ok ? 200 : 409, out); }
        if (req.method === 'DELETE' && id) { const out = db.remove(kind, id, url.searchParams.get('version'), actor); return send(res, out.ok ? 200 : 409, out); }
        return send(res, 405, { error: 'Not allowed.' });
      }

      if (seg[1] === 'history' && req.method === 'GET') {
        if (seg[2]) {
          const e = db.historyEntry(seg[2]);
          if (!e || (e.kind && !store.canRead(user, e.kind)) || (e.action === 'user' && !isAdmin)) return send(res, 404, { error: 'Not found.' });
          return send(res, 200, e);
        }
        const rows = db.history({ area: url.searchParams.get('area') || '', kind: url.searchParams.get('kind') || '', id: url.searchParams.get('id') || '',
          q: url.searchParams.get('q') || '', limit: url.searchParams.get('limit'), before: url.searchParams.get('before'), canSee: (k) => store.canRead(user, k) });
        return send(res, 200, { rows: rows.filter((r) => r.action !== 'user' || isAdmin) });
      }

      if (seg[1] === 'claims' && seg[2] === 'order') {
        if (!store.can(user, 'orders')) return send(res, 403, { error: 'Your login cannot work on orders.' });
        if (req.method === 'POST') { const out = db.claimOrder(body.po, actor); return send(res, out.ok ? 200 : 409, out); }
        if (req.method === 'DELETE' && seg[3]) return send(res, 200, db.releaseOrder(seg[3], actor, isAdmin));
      }

      if (seg[1] === 'users') {
        if (!isAdmin) return send(res, 403, { error: 'Only an owner manages logins.' });
        if (req.method === 'GET') return send(res, 200, { users: db.listUsers() });
        if (req.method === 'POST') return send(res, 200, { ok: true, user: db.createUser(body, actor) });
        if (req.method === 'PUT' && seg[2]) return send(res, 200, { ok: true, user: db.updateUser(Number(seg[2]), body, actor) });
      }
      if (seg[1] === 'backup' && req.method === 'POST') {
        if (!isAdmin) return send(res, 403, { error: 'Only an owner runs a backup.' });
        runBackup();
        return send(res, 200, { ok: true, last: db.meta.get('lastBackup') || '', error: db.meta.get('lastBackupError') || '' });
      }
      return send(res, 404, { error: 'Not found.' });
    } catch (e) {
      // a message written for the person (a taken username, a short password) goes back as is
      const friendly = /^[A-Z][^{}<>]{3,120}\.$/.test(e.message || '');
      if (!friendly) log('error', req.method, p, e.stack || e.message);
      return send(res, friendly ? 400 : 500, { error: friendly ? e.message : 'Something went wrong on the server.' });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const at = server.address();
      log(`DWS Server is running. Open http://localhost:${at.port} on this computer.`);
      resolve({
        port: at.port, db, runBackup,
        close: () => new Promise((done) => {
          clearInterval(beat); clearInterval(backupTimer);
          for (const s of streams) { try { s.res.end(); } catch { /* gone */ } }
          server.close(() => { db.close(); done(); });
          server.closeAllConnections();
        }),
      });
    });
  });
}

module.exports = { start };

if (require.main === module) {
  start().catch((e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Is DWS Server already running?` : e.message);
    process.exit(1);
  });
}
