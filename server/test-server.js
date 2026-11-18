#!/usr/bin/env node
'use strict';
// Checks for DWS Server: runs a real server on a free port against a made-up
// returns-sync folder and exercises it the way the office would.
//
//   node server/test-server.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { start } = require('./dws-server');
const { importFolder } = require('./import-folder');
const { makeDemoFolder } = require('./demo-folder');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dws-server-test-'));
let passed = 0;
const ok = (name) => { passed++; console.log(`  ok  ${name}`); };

(async () => {
  const folder = makeDemoFolder(path.join(tmp, 'returns-sync'));
  const before = fs.readdirSync(folder).map((n) => { const s = fs.statSync(path.join(folder, n)); return `${n}:${s.size}:${s.mtimeMs}`; }).join('|');
  const srv = await start({ data: path.join(tmp, 'data'), port: 0, host: '127.0.0.1', quiet: true });
  const base = `http://127.0.0.1:${srv.port}`;
  const call = async (method, url, { token, body, cookie, noHeader } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (cookie) { headers.Cookie = `dws_sid=${cookie}`; if (!noHeader) headers['X-DWS'] = '1'; }
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = {}; try { json = await res.json(); } catch { /* none */ }
    return { status: res.status, json };
  };

  /* ---- import ---- */
  const res = importFolder(srv.db, folder);
  const n = (kind) => srv.db.list(kind, { limit: 1 }).total;
  assert.equal(n('return'), 14, '15 returns written, one deleted from another computer');
  assert.equal(srv.db.get('return', 'RETURNS-ROOM-PC:14').deleted, true);
  assert.equal(srv.db.get('return', 'RETURNS-ROOM-PC:3').data.note, 'screen cracked, graded scrap', 'the newer edit from the laptop wins');
  ok('returns combine across computers: newest edit wins, a delete stays deleted');
  assert.equal(res.counts['sale lines read (before removing repeats)'], 104);
  assert.equal(n('sale'), 40);
  ok('104 repeated sale lines become 40 sales, one per order');
  assert.equal(n('price_group'), 1);
  assert.equal(n('wm_run'), 2);
  assert.equal(n('packed_order'), 22);
  assert.equal(srv.db.get('wfs_shipment', 'STOCK-ROOM:18').data.items[0].qty, 50, 'the correction made on another computer is applied');
  assert.equal(srv.db.get('cost', 'S26-256GB-BLUE').data.cost, 645, 'newest cost wins');
  assert.equal(srv.db.get('wm_mark', '129034412212588').data.caseApproved, true);
  assert.equal(n('stock_change'), 13);
  ok('stock, orders, pricing and Recovery records land with the app\'s own rules');
  assert.deepEqual(res.notImported, ['rooms-IMRAN-MACBOOK-PRO.jsonl']);
  assert.ok(res.skipped.includes('returns-log.csv') && res.skipped.includes('Walmart Reports/'));
  assert.equal(res.torn.length, 1);
  ok('files it has no table for are named, and a half-written line is skipped');
  const again = importFolder(srv.db, folder);
  assert.deepEqual(Object.keys(again.counts).filter((k) => !/read/.test(k)), []);
  ok('importing the same folder twice adds nothing');
  const after = fs.readdirSync(folder).map((x) => { const s = fs.statSync(path.join(folder, x)); return `${x}:${s.size}:${s.mtimeMs}`; }).join('|');
  assert.equal(after, before);
  ok('the folder itself is untouched by the import');
  const hist = srv.db.history({ kind: 'return', id: 'RETURNS-ROOM-PC:3' });
  assert.deepEqual(hist.map((h) => h.action).sort(), ['create', 'edit']);
  assert.equal(hist.find((h) => h.action === 'edit').station, 'IMRAN-MACBOOK-PRO');
  ok('each return keeps its past: who added it and which computer edited it');

  /* ---- logins ---- */
  assert.equal((await call('GET', '/api/state')).json.needsSetup, true);
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('POST', '/api/setup', { body: { username: 'imran', name: 'Imran', password: 'short' } })).status, 400);
  assert.equal((await call('POST', '/api/setup', { body: { username: 'imran', name: 'Imran', password: 'owner-pass-1' } })).status, 200);
  assert.equal((await call('POST', '/api/setup', { body: { username: 'intruder', password: 'another-pass-1' } })).status, 409);
  ok('the first visit creates the owner login, and only once');
  assert.equal((await call('POST', '/api/login', { body: { username: 'imran', password: 'wrong-pass' } })).status, 401);
  const login = async (username, password, station) => (await call('POST', '/api/login', { body: { username, password, station } })).json.token;
  const owner = await login('imran', 'owner-pass-1', 'IMRAN-WORK-PC');
  for (const [username, role, extra] of [['rma', 'returns', []], ['stock', 'stockroom', []], ['nick', 'viewer', []], ['eric', 'viewer', ['costs']]]) {
    assert.equal((await call('POST', '/api/users', { token: owner, body: { username, name: username, password: `${username}-pass-123`, role, extra } })).status, 200);
  }
  const rma = await login('rma', 'rma-pass-123', 'RETURNS-ROOM-PC');
  const stock = await login('stock', 'stock-pass-123', 'STOCK-ROOM');
  const nick = await login('nick', 'nick-pass-123', 'NICK');
  const eric = await login('eric', 'eric-pass-123', 'ERIC-COMPUTER');
  assert.equal((await call('POST', '/api/users', { token: rma, body: { username: 'x1', password: 'whatever-123' } })).status, 403);
  assert.equal((await call('GET', '/api/users', { token: nick })).status, 403);
  ok('everyone has their own login; only the owner manages logins');

  /* ---- who can see and change what ---- */
  const newReturn = { created_at: new Date().toISOString(), order_number: '129130499990001', source: 'WALMART', customer: 'Test Buyer', note: '', items: [{ sku: 'X210-64GB-GRAY', condition: 'new', targetSku: 'X210-64GB-GRAY', qty: 1 }], tracking: '', received_by: 'RM', unmatched: false };
  assert.equal((await call('POST', '/api/records/return', { token: nick, body: { data: newReturn } })).status, 403);
  assert.equal((await call('POST', '/api/records/return', { token: stock, body: { data: newReturn } })).status, 403);
  const made = await call('POST', '/api/records/return', { token: rma, body: { data: newReturn } });
  assert.equal(made.status, 200);
  const rid = made.json.record.id;
  assert.ok(rid.startsWith('RETURNS-ROOM-PC:'));
  assert.equal((await call('GET', '/api/records/return', { token: nick })).json.total, 15);
  ok('the returns room adds returns; view-only and stock-room logins cannot');
  assert.equal((await call('GET', '/api/records/cost', { token: stock })).status, 403);
  assert.equal((await call('GET', '/api/records/wm_run', { token: rma })).status, 403);
  assert.equal((await call('GET', '/api/records/cost', { token: eric })).status, 200);
  assert.equal((await call('GET', '/api/records/cost', { token: owner })).json.total, 3);
  const areasFor = async (t) => (await call('GET', '/api/me', { token: t })).json.areas;
  assert.ok(!(await areasFor(rma)).some((a) => a.area === 'recovery'));
  assert.ok(!(await areasFor(nick)).flatMap((a) => a.kinds).some((k) => k.kind === 'cost'));
  assert.ok((await areasFor(owner)).some((a) => a.area === 'recovery'));
  ok('costs and Recovery are hidden unless a login is given them');
  assert.equal((await call('PUT', '/api/records/stock_change/STOCK-ROOM%3Ademo-1', { token: owner, body: { data: { sku: 'X' }, version: 1 } })).status, 405);
  ok('log lines (stock changes, sales) cannot be rewritten, even by the owner');

  /* ---- two people on one return ---- */
  const a = (await call('GET', `/api/records/return/${encodeURIComponent(rid)}`, { token: rma })).json;
  const b = (await call('GET', `/api/records/return/${encodeURIComponent(rid)}`, { token: owner })).json;
  const first = await call('PUT', `/api/records/return/${encodeURIComponent(rid)}`, { token: rma, body: { data: { ...a.data, note: 'box damaged' }, version: a.version } });
  assert.equal(first.status, 200);
  const second = await call('PUT', `/api/records/return/${encodeURIComponent(rid)}`, { token: owner, body: { data: { ...b.data, customer: 'Test Buyer Jr' }, version: b.version } });
  assert.equal(second.status, 409);
  assert.equal(second.json.conflict, 'changed');
  assert.equal(second.json.current.data.note, 'box damaged');
  assert.equal(second.json.current.updated_by, 'rma');
  assert.equal((await call('GET', `/api/records/return/${encodeURIComponent(rid)}`, { token: nick })).json.data.customer, 'Test Buyer', 'the late save changed nothing');
  ok('a save made from an out-of-date copy is refused and shown the other person\'s version');
  const third = await call('PUT', `/api/records/return/${encodeURIComponent(rid)}`, { token: owner, body: { data: { ...second.json.current.data, customer: 'Test Buyer Jr' }, version: second.json.current.version } });
  assert.equal(third.status, 200);
  assert.equal(third.json.record.data.note, 'box damaged');
  assert.equal(third.json.record.data.customer, 'Test Buyer Jr');
  ok('saving again on top of the latest version keeps both changes');
  const two = await Promise.all([1, 2].map((i) => call('POST', '/api/records/return', { token: i === 1 ? rma : owner, body: { data: { ...newReturn, order_number: `SAME-SECOND-${i}` } } })));
  assert.ok(two.every((r) => r.status === 200) && two[0].json.record.id !== two[1].json.record.id);
  ok('two people adding different returns at the same moment both go in');

  /* ---- history ---- */
  const h = (await call('GET', `/api/history?kind=return&id=${encodeURIComponent(rid)}`, { token: nick })).json.rows;
  assert.deepEqual(h.map((x) => `${x.action}:${x.user}:${x.station}`), ['edit:imran:IMRAN-WORK-PC', 'edit:rma:RETURNS-ROOM-PC', 'create:rma:RETURNS-ROOM-PC']);
  assert.equal(h[0].changed, 'customer');
  const entry = (await call('GET', `/api/history/${h[1].seq}`, { token: nick })).json;
  assert.equal(entry.before.note, '');
  assert.equal(entry.after.note, 'box damaged');
  assert.ok(!(await call('GET', '/api/history?limit=500', { token: nick })).json.rows.some((x) => x.action === 'user'));
  ok('every change is in the history with who, which computer, and before and after');
  const gone = await call('DELETE', `/api/records/return/${encodeURIComponent(rid)}?version=${third.json.record.version}`, { token: rma });
  assert.equal(gone.status, 200);
  assert.equal((await call('GET', `/api/records/return/${encodeURIComponent(rid)}`, { token: rma })).status, 404);
  assert.equal((await call('GET', `/api/history?kind=return&id=${encodeURIComponent(rid)}`, { token: owner })).json.rows[0].action, 'delete');
  ok('a deleted return leaves the list but stays in the history');

  /* ---- one computer at a time on an order ---- */
  assert.equal((await call('POST', '/api/claims/order', { token: rma, body: { po: 'PO-NEW-1' } })).status, 403);
  assert.equal((await call('POST', '/api/claims/order', { token: stock, body: { po: 'PO-NEW-1' } })).status, 200);
  const blocked = await call('POST', '/api/claims/order', { token: owner, body: { po: 'po-new-1' } });
  assert.equal(blocked.status, 409);
  assert.deepEqual([blocked.json.reason, blocked.json.by, blocked.json.station], ['claimed', 'stock', 'STOCK-ROOM']);
  assert.equal((await call('POST', '/api/claims/order', { token: stock, body: { po: 'PO-NEW-1' } })).status, 200, 'the holder may ask again');
  const labelled = await call('POST', '/api/claims/order', { token: owner, body: { po: '200010000000733' } });
  assert.equal(labelled.status, 409);
  assert.deepEqual([labelled.json.reason, labelled.json.by], ['labelled', 'STOCK-ROOM']);
  assert.equal((await call('POST', '/api/claims/order', { token: owner, body: { po: 'PO-211-90004111' } })).status, 200, 'a voided label does not block');
  assert.equal((await call('DELETE', '/api/claims/order/PO-NEW-1', { token: stock })).status, 200);
  assert.equal((await call('POST', '/api/claims/order', { token: owner, body: { po: 'PO-NEW-1' } })).status, 200);
  ok('an order is held by one computer; a PO# that already has a label is refused');

  /* ---- sign-in safety ---- */
  assert.equal((await call('POST', '/api/records/return', { cookie: rma, noHeader: true, body: { data: newReturn } })).status, 403);
  assert.equal((await call('POST', '/api/records/return', { cookie: rma, body: { data: newReturn } })).status, 200);
  ok('a browser sign-in only acts from the server\'s own page');
  assert.equal((await call('PUT', `/api/users/${(await call('GET', '/api/users', { token: owner })).json.users.find((u) => u.username === 'nick').id}`, { token: owner, body: { active: false } })).status, 200);
  assert.equal((await call('GET', '/api/me', { token: nick })).status, 401);
  assert.equal((await call('POST', '/api/login', { body: { username: 'nick', password: 'nick-pass-123' } })).status, 401);
  ok('switching a login off signs that person out everywhere');
  const me = (await call('GET', '/api/users', { token: owner })).json.users.find((u) => u.username === 'imran');
  assert.equal((await call('PUT', `/api/users/${me.id}`, { token: owner, body: { role: 'viewer' } })).status, 400);
  ok('the only owner login cannot be demoted or switched off');
  for (let i = 0; i < 8; i++) await call('POST', '/api/login', { body: { username: 'eric', password: 'nope-nope' } });
  assert.equal((await call('POST', '/api/login', { body: { username: 'eric', password: 'eric-pass-123' } })).status, 429);
  ok('eight wrong passwords lock that username for five minutes');

  /* ---- live updates and backup ---- */
  const ctl = new AbortController();
  const es = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${stock}` }, signal: ctl.signal });
  const reader = es.body.getReader();
  await reader.read(); // ": connected"
  await call('POST', '/api/records/return', { token: rma, body: { data: { ...newReturn, order_number: 'LIVE-1' } } });
  const chunk = new TextDecoder().decode((await reader.read()).value);
  assert.match(chunk, /"kind":"return".*"action":"create"/);
  ctl.abort();
  ok('other computers hear about a change as it happens');
  srv.runBackup();
  const backups = fs.readdirSync(path.join(tmp, 'data', 'backups'));
  assert.equal(backups.length, 1);
  assert.ok(fs.statSync(path.join(tmp, 'data', 'backups', backups[0])).size > 50000);
  ok('a backup writes a full copy of the database');

  await srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} checks passed.`);
})().catch((e) => { console.error('\nFAILED:', e.message, '\n', e.stack.split('\n').slice(1, 4).join('\n')); process.exit(1); });
