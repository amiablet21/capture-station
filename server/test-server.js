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
const { importFolder, keepCurrent } = require('./import-folder');
const store = require('./store');
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

  /* ---- a payment period, opened up ---- */
  const stmt = (await call('GET', '/api/records/wm_run/run-oct-a/statement', { token: owner })).json;
  assert.equal(stmt.payable, 34011.04);
  assert.equal(stmt.paidTotal, 34011.04);
  assert.deepEqual(stmt.paid, [{ date: '2026-10-19', amount: 14011.04 }, { date: '2026-10-12', amount: 20000 }]);
  assert.deepEqual(stmt.sections.map((x) => [x.name, x.total]), [['Sales', 38260.37], ['Refunds', -2999.07], ['Fees', -1480.25], ['Adjustments', 229.99]]);
  assert.deepEqual(stmt.sections[1].lines[0].by.map((b) => b.label), ['Customer returns', 'Walmart Customer Care issued']);
  const runRow = (await call('GET', '/api/records/wm_run', { token: owner })).json.rows.find((r) => r.id === 'run-oct-a');
  assert.ok(runRow.cells.includes('$34,011.04'), 'the list shows what was payable without opening the period');
  assert.equal((await call('GET', '/api/records/wm_run/run-oct-b/statement', { token: owner })).json.hasLines, false);
  assert.equal((await call('GET', '/api/records/wm_run/run-oct-a/statement', { token: rma })).status, 403);
  assert.equal((await call('GET', '/api/records/wm_run/nope/statement', { token: owner })).status, 404);
  ok('a payment period opens into its statement: payable, paid to the bank, each section');
  // a period brought in before the totals were kept gets them when the server next starts
  {
    const file = path.join(tmp, 'older.sqlite');
    let old = store.open(file);
    old.importPut('wm_run', 'r1', { label: 'Sep 5 - Sep 19, 2026' }, { srcTs: 5, detail: JSON.stringify({ lines: [{ type: 'PaymentSummary', amount: 1200.5, count: 1 }] }) });
    old.close();
    const { DatabaseSync } = require('node:sqlite');
    const rawDb = new DatabaseSync(file); rawDb.exec("DELETE FROM meta WHERE k = 'runTotals'"); rawDb.close();
    old = store.open(file);
    assert.equal(old.get('wm_run', 'r1').data.stmt.payable, 1200.5);
    assert.equal(old.get('wm_run', 'r1').version, 1, 'filled in quietly: not a change to the record');
    old.close();
  }
  ok('periods already on the server get their totals without being brought in again');

  /* ---- the screens copied from DWS Stock ---- */
  const asOf = Date.UTC(2026, 10, 16);
  const sh = srv.db.stockHistory({ days: 30, now: asOf }).rows;
  const fix = sh.find((e) => e.gid === 'IMRAN-WORK-PC:demo-2');
  const fixed = sh.find((e) => e.gid === 'IMRAN-WORK-PC:demo-1');
  assert.deepEqual([fix.reason, fix.target.gid, fix.dataObj.toQty], ['edit-qty', 'IMRAN-WORK-PC:demo-1', 58], 'a correction points back at its line');
  assert.deepEqual([fixed.eff.qty, fixed.eff.corrected, fixed.marks.map((m) => m.kind).join()], [58, true, 'edit'], 'the corrected line says what it stands at now');
  assert.equal(sh.filter((e) => e.reason === 'sale').length, 40, 'one SOLD line per sale line');
  assert.equal(sh.filter((e) => e.reason === 'return').length, 8);
  assert.ok(sh.every((e, i) => i === 0 || sh[i - 1].created_at >= e.created_at), 'newest first');
  assert.equal(srv.db.stockHistory({ days: 0, now: asOf }).rows.length, 0, 'today means today');
  assert.equal(srv.db.stockHistory({ days: 30, now: asOf, sales: false }).rows.length, 13);
  {
    const d2 = store.open(path.join(tmp, 'costs.sqlite'));
    d2.importPut('stock_change', 'A:1', { gid: 'A:1', created_at: new Date(asOf).toISOString(), sku: 'X210-64GB-GRAY', delta: 0, reason: 'cost', data: JSON.stringify({ from: 100, to: 120 }) });
    assert.equal(d2.stockHistory({ days: 7, now: asOf }).rows.length, 0, 'cost lines hold dollar figures');
    assert.equal(d2.stockHistory({ days: 7, now: asOf, costs: true }).rows[0].dataObj.to, 120);
    d2.close();
  }
  assert.equal((await call('GET', '/api/stockhistory?days=30', { token: nick })).status, 200);
  assert.equal((await call('GET', '/api/stockhistory?days=30')).status, 401);
  ok('Stock history reads as it does in DWS Stock: sold, returned, corrections pointing at their lines');
  const fullRet = (await call('GET', '/api/records/return?full=1&limit=5000', { token: nick })).json;
  assert.equal(fullRet.rows[0].data.items[0].condition, 'new');
  assert.equal((await call('GET', '/api/records/return', { token: nick })).json.rows[0].data, undefined);
  assert.equal((await call('GET', '/api/records/label?full=1', { token: nick })).json.rows.find((r) => r.data.voided_at).data.reference, 'PO-211-90004111');
  ok('the Returns log and the Labels table get each record whole; the plain lists stay light');

  /* ---- the app's own pages, when the server runs inside DWS Stock ---- */
  assert.deepEqual((await call('GET', '/api/me', { token: owner })).json.app, [], 'on its own, the server has no app to ask');
  assert.equal((await call('GET', '/api/app/stock', { token: owner })).status, 404);
  {
    let asked = 0; let fail = false;
    const fake = (name) => {
      asked++;
      if (fail) throw new Error('Linnworks did not answer');
      if (name === 'stock') {
        return { ok: true, locationId: 'h', locationName: 'Digital World Shop', items: [{ sku: 'X210-64GB-GRAY', title: 'Tab', cost: 151.5, secret: 'x',
          levels: [{ locationId: 'h', locationName: 'Digital World Shop', stockLevel: 41, inOrders: 2, available: 39, minimumLevel: 25 }, { locationId: 'w', locationName: 'WFS FULFILLED', stockLevel: 21, inOrders: 0, available: 21, minimumLevel: 0 }] }] };
      }
      if (name === 'recovery') return { ok: true, runs: [{ id: 'r' }], items: [], logRows: 3, settings: { email: 'someone@example.com' } };
      return { ok: false, error: 'not a page the server asks for' };
    };
    const appData = path.join(tmp, 'data-app');
    const s3 = await start({ data: appData, port: 0, host: '127.0.0.1', quiet: true, app: fake });
    const at = (srvX) => `http://127.0.0.1:${srvX.port}`;
    const c3 = async (url, token, srvX = s3) => { const r = await fetch(at(srvX) + url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
    const post3 = (url, body, token) => fetch(at(s3) + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
    await post3('/api/setup', { username: 'boss', name: 'Boss', password: 'owner-pass-1' });
    const own3 = (await post3('/api/login', { username: 'boss', password: 'owner-pass-1', station: 'T' })).token;
    await post3('/api/users', { username: 'viewer', name: 'Viewer', password: 'viewer-pass-1', role: 'viewer', extra: [] }, own3);
    const view3 = (await post3('/api/login', { username: 'viewer', password: 'viewer-pass-1', station: 'T' })).token;
    assert.deepEqual((await c3('/api/me', own3)).json.app, ['stock', 'recovery']);
    assert.deepEqual((await c3('/api/me', view3)).json.app, ['stock'], 'Recovery needs the Recovery permission');
    const st = (await c3('/api/app/stock', own3)).json;
    assert.deepEqual([st.items[0].home, st.items[0].wfs, st.items[0].cost, st.wfsName], [[41, 2, 39, 25], [21, 0, 21, 0], 151.5, 'WFS FULFILLED']);
    assert.equal(st.items[0].secret, undefined, 'only what the page draws is sent');
    const stView = (await c3('/api/app/stock', view3)).json;
    assert.deepEqual([stView.costs, stView.items[0].cost], [false, undefined], 'costs go only to logins that may see costs');
    assert.equal(asked, 1, 'one answer serves everyone for a minute');
    assert.equal((await c3('/api/app/recovery', view3)).status, 403);
    assert.equal((await c3('/api/app/recovery', own3)).json.settings, undefined);
    assert.equal((await c3('/api/app/pricing', own3)).status, 404, 'the Pricing page is not offered');
    assert.equal((await c3('/api/app/stock')).status, 401);
    assert.equal((await c3('/api/app/settings', own3)).status, 404, 'only the two pages can be asked for');
    await s3.close();
    fail = true;
    const s4 = await start({ data: appData, port: 0, host: '127.0.0.1', quiet: true, app: fake });
    const bad = (await c3('/api/app/stock', own3, s4)).json;
    assert.deepEqual([bad.ok, bad.error], [false, 'Linnworks did not answer']);
    fail = false;
    assert.equal((await c3('/api/app/stock', own3, s4)).json.ok, true, 'a failure is not kept');
    await s4.close();
  }
  ok('inside DWS Stock the server shows the app\'s own stock and Recovery, by permission');

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
  /* ---- keeping itself current from the folder ---- */
  const kc = keepCurrent(srv.db, () => folder, { every: 3600000, first: 3600000 });
  await kc.run();
  assert.equal(kc.status.lastChange, '', 'everything in the folder is already here');
  assert.ok(kc.status.lastCheck);
  const histBefore = srv.db.history({ limit: 500 }).total;
  const runsBefore = n('wm_run');
  const salesBefore = n('sale');
  fs.appendFileSync(path.join(folder, 'wmruns-IMRAN-WORK-PC.jsonl'), `${JSON.stringify({ op: 'put', id: 'run-nov', ts: Date.now(), run: { id: 'run-nov', label: 'Oct 31 - Nov 14, 2026', ranAt: new Date().toISOString(), station: 'IMRAN-WORK-PC' }, refunds: [], payouts: [], ledger: [], orders: [], lines: [{ type: 'PaymentSummary', amount: 500, count: 1 }] })}\n`);
  fs.appendFileSync(path.join(folder, 'chansales-NICK.jsonl'), `${JSON.stringify({ id: 'n-new', ref: 'NEW-ORDER-1', ts: new Date().toISOString(), source: 'EBAY', lines: [{ c: 'X210-64GB-GRAY', q: 1 }] })}\n`);
  const seenBefore = JSON.parse(srv.db.meta.get('folderSeen'));
  await kc.run();
  assert.equal(n('wm_run'), runsBefore + 1);
  assert.equal(n('sale'), salesBefore + 1);
  assert.equal(srv.db.get('wm_run', 'run-nov').data.stmt.payable, 500);
  assert.equal(kc.status.lastCount, 2);
  assert.equal(srv.db.history({ limit: 500 }).total, histBefore, 'a top-up does not fill the history with "Imported" lines');
  const seenAfter = JSON.parse(srv.db.meta.get('folderSeen'));
  assert.deepEqual(Object.keys(seenAfter).filter((g) => seenAfter[g] !== seenBefore[g]).sort(), ['chansales', 'wmruns'], 'only the files that changed were read again');
  const stamp = kc.status.lastChange;
  await new Promise((r) => setTimeout(r, 5));
  await kc.run();
  assert.equal(kc.status.lastChange, stamp);
  const missing = keepCurrent(srv.db, () => path.join(tmp, 'no-such-folder'), { every: 3600000, first: 3600000 });
  await missing.run();
  assert.match(missing.status.error, /not set/);
  missing.stop(); kc.stop();
  ok('the server tops itself up from the folder: new periods and sales arrive on their own');

  srv.runBackup();
  const backups = fs.readdirSync(path.join(tmp, 'data', 'backups'));
  assert.equal(backups.length, 1);
  assert.ok(fs.statSync(path.join(tmp, 'data', 'backups', backups[0])).size > 50000);
  ok('a backup writes a full copy of the database');
  // a second folder (a Drive folder in real use) gets the copy too and is
  // kept to the newest 14; other files in it are left alone
  await srv.close();
  const secondDir = path.join(tmp, 'second-backups');
  fs.mkdirSync(secondDir);
  for (let d = 1; d <= 20; d++) fs.writeFileSync(path.join(secondDir, `dws-server-2026-01-${String(d).padStart(2, '0')}.sqlite`), 'old');
  fs.writeFileSync(path.join(secondDir, 'my-notes.txt'), 'not a backup');
  const srv2 = await start({ data: path.join(tmp, 'data'), port: 0, host: '127.0.0.1', quiet: true, backupDir: secondDir });
  srv2.runBackup();
  const kept = fs.readdirSync(secondDir).filter((x) => x.endsWith('.sqlite')).sort();
  assert.equal(kept.length, 14);
  assert.equal(kept[0], 'dws-server-2026-01-08.sqlite');
  assert.ok(fs.statSync(path.join(secondDir, kept[13])).size > 50000);
  assert.ok(fs.existsSync(path.join(secondDir, 'my-notes.txt')));
  ok('a second backup folder gets the copy and keeps only the newest 14');
  await srv2.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} checks passed.`);
  return;

  await srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} checks passed.`);
})().catch((e) => { console.error('\nFAILED:', e.message, '\n', e.stack.split('\n').slice(1, 4).join('\n')); process.exit(1); });
