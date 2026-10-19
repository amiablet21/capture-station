// Offline checks: made-up stock and sales through the real reorder maths
// (sales-export.js) and the bot's messages and commands. No Linnworks, no
// WhatsApp. Run: npm test
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  shoppingList, formatShoppingList, formatOutAlert, formatStock, formatHistory, settledBought,
  lastPaidPrices, parseCommand, matchSku, isConditionSku,
} from './lib/report.js';
import { senderAllowed, messageText, addressedText } from './lib/whatsapp.js';
import { Assistant, runTool, TOOLS } from './lib/assistant.js';
import { mergeCostFiles, DriveCosts } from './lib/drive.js';

const require = createRequire(import.meta.url);
const { buildSalesExport } = require('../src/main/sales-export.js');

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

// ---- a small warehouse ----
const LOC = 'loc-main';
const item = (sku, title, available, due = 0) => ({
  sku, title, category: '', dsPad: null,
  levels: [{ locationId: LOC, locationName: 'Default', stockLevel: available, inOrders: 0, due, minimumLevel: 0, available }],
});
const now = new Date(2026, 9, 19, 18, 0);
const daysAgo = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, 12).toISOString();
let oid = 0;
const sales = (sku, perDay, days = 30, source = 'WALMART') => {
  const out = [];
  for (let d = 0; d < days; d++) for (let i = 0; i < perDay; i++) out.push({ orderId: `o${++oid}`, sku, qty: 1, source, processedOn: daysAgo(d), revenue: 100 });
  return out;
};
const items = [
  item('S25-128GB-NAVY', 'Samsung Galaxy S25 128GB Navy Unlocked', 0),
  item('A15-64GB-BLK', 'Samsung Galaxy A15 64GB Black', 2),
  item('TAB-A9-GRY', 'Samsung Galaxy Tab A9 Grey', 10),
  item('PIXEL8-128-OBS', 'Google Pixel 8 128GB Obsidian', 500),
  item('S25-128GB-NAVY-OPENBOX', 'Samsung Galaxy S25 Open Box', 0),
  item('OLD-PHONE', 'Old phone', 3),
  item('IPHONE13-OUT-DUE', 'iPhone 13 (on a PO)', 0, 200),
];
const lines = [
  ...sales('S25-128GB-NAVY', 4),
  ...sales('A15-64GB-BLK', 2),
  ...sales('TAB-A9-GRY', 1),
  ...sales('PIXEL8-128-OBS', 1),
  ...sales('S25-128GB-NAVY-OPENBOX', 1, 5),
  ...sales('IPHONE13-OUT-DUE', 2),
];
const { rows, days } = buildSalesExport(items, lines, { now, days: 30, locationId: LOC, leadDays: 7, coverDays: 21 });
const row = (sku) => rows.find(r => r.sku === sku);

test('statuses come from the shared reorder maths', () => {
  assert.equal(row('S25-128GB-NAVY').status, 'Out of stock');
  assert.equal(row('A15-64GB-BLK').status, 'Order now');
  assert.equal(row('TAB-A9-GRY').status, 'Order soon');
  assert.equal(row('PIXEL8-128-OBS').status, 'Covered');
  assert.equal(row('OLD-PHONE').status, 'Not selling');
});

test('shopping list groups by urgency and skips condition SKUs', () => {
  const list = shoppingList(rows, {});
  assert.deepEqual(list.out.map(r => r.sku).sort(), ['IPHONE13-OUT-DUE', 'S25-128GB-NAVY']);
  assert.deepEqual(list.now.map(r => r.sku), ['A15-64GB-BLK']);
  assert.deepEqual(list.soon.map(r => r.sku), ['TAB-A9-GRY']);
  assert.ok(!JSON.stringify(list).includes('OPENBOX'));
  // 4/day x 28 days = 112, rounded up to 5
  assert.equal(list.out.find(r => r.sku === 'S25-128GB-NAVY').buy, 115);
});

test('message reads well and says "due in" for an out SKU a PO covers', () => {
  const text = formatShoppingList(shoppingList(rows, {}), { now, leadDays: 7 });
  assert.match(text, /To buy — Mon, Oct 19/);
  assert.match(text, /S25-128GB-NAVY .*buy 115/);
  assert.match(text, /IPHONE13-OUT-DUE .*due in 200/);
  assert.match(text, /A15-64GB-BLK .*2 left \(~1 day\)/);
  assert.match(text, /Total: /);
  console.log('\n' + text + '\n');
});

test('stale figures are flagged', () => {
  const text = formatShoppingList(shoppingList(rows, {}), { now, dataAt: now.getTime() - 3 * 3600000 });
  assert.match(text, /Figures from 3 hours ago/);
});

test('a bought note takes the SKU off the list and shows it on the way', () => {
  const bought = { 'S25-128GB-NAVY': { sku: 'S25-128GB-NAVY', qty: 120, price: 405, at: now.toISOString(), onHandAt: 0 } };
  const list = shoppingList(rows, bought);
  assert.ok(!list.out.some(r => r.sku === 'S25-128GB-NAVY'));
  assert.equal(list.onTheWay[0].sku, 'S25-128GB-NAVY');
  assert.match(formatShoppingList(list, { now }), /On the way[\s\S]*120 bought .* @ \$405/);
  // a partial buy leaves the rest on the list
  const partial = shoppingList(rows, { 'S25-128GB-NAVY': { ...bought['S25-128GB-NAVY'], qty: 15 } });
  assert.equal(partial.out.find(r => r.sku === 'S25-128GB-NAVY').buy, 100);
});

test('bought notes settle when stock arrives, a PO covers it, or it gets old', () => {
  const at = now.toISOString();
  const b = {
    'A15-64GB-BLK': { qty: 4, at, onHandAt: 0 }, // on hand now 2 >= 0 + 2: arrived
    'S25-128GB-NAVY': { qty: 50, at, onHandAt: 0 }, // nothing yet: stays
    'IPHONE13-OUT-DUE': { qty: 100, at, onHandAt: 0 }, // due 200 >= 100: on a PO
    'TAB-A9-GRY': { qty: 30, at: new Date(now.getTime() - 22 * 86400000).toISOString(), onHandAt: 10 },
  };
  assert.deepEqual(settledBought(rows, b, { now: now.getTime(), maxDays: 21 }).sort(), ['A15-64GB-BLK', 'IPHONE13-OUT-DUE', 'TAB-A9-GRY']);
});

test('commands parse', () => {
  assert.deepEqual(parseCommand('bought S25 30 @ 405'), { cmd: 'bought', sku: 'S25', qty: 30, price: 405, vendor: '' });
  assert.deepEqual(parseCommand('Bought s25 30 at $405.50'), { cmd: 'bought', sku: 's25', qty: 30, price: 405.5, vendor: '' });
  assert.deepEqual(parseCommand('bought S25 30'), { cmd: 'bought', sku: 'S25', qty: 30, price: null, vendor: '' });
  assert.deepEqual(parseCommand('bought S25 30 @ 405 from 2B Wireless'), { cmd: 'bought', sku: 'S25', qty: 30, price: 405, vendor: '2B Wireless' });
  assert.deepEqual(parseCommand('bought S25 30 from Ali'), { cmd: 'bought', sku: 'S25', qty: 30, price: null, vendor: 'Ali' });
  assert.deepEqual(parseCommand('history s25'), { cmd: 'history', sku: 's25' });
  assert.ok(parseCommand('bought S25').error);
  assert.ok(parseCommand('bought S25 0').error);
  assert.deepEqual(parseCommand('LIST'), { cmd: 'list' });
  assert.deepEqual(parseCommand('stock tab a9'), { cmd: 'stock', sku: 'tab a9' });
  assert.equal(parseCommand('list the phones please'), null); // ordinary chat is ignored
  assert.equal(parseCommand('thanks dad'), null);
});

test('SKU matching: exact, unique part, or ask', () => {
  assert.equal(matchSku(rows, 's25-128gb-navy').row.sku, 'S25-128GB-NAVY');
  assert.equal(matchSku(rows, 'TAB').row.sku, 'TAB-A9-GRY');
  assert.equal(matchSku(rows, 'S25').row.sku, 'S25-128GB-NAVY'); // the open box twin is never a match
  assert.match(matchSku(rows, 'A').error, /matches \d+ SKUs/);
  assert.match(matchSku(rows, 'NOKIA').error, /No SKU matches/);
});

test('stock and sell-out messages', () => {
  const s = formatStock(row('A15-64GB-BLK'));
  assert.match(s, /Available 2/);
  assert.match(s, /Sold: 14 this week · 60 in 30 days \(2\.0\/day/);
  assert.match(s, /Walmart 60/);
  assert.match(formatOutAlert([row('S25-128GB-NAVY')]), /Just sold out[\s\S]*S25-128GB-NAVY .*buy 115/);
});

test('condition SKUs', () => {
  assert.ok(isConditionSku('S25-OPENBOX'));
  assert.ok(isConditionSku('OPEN BOX-S25'));
  assert.ok(isConditionSku('S25-USED'));
  assert.ok(!isConditionSku('S25-UNUSED'));
});

test('only allowed people, whether WhatsApp shows the number or the privacy id', () => {
  const allowed = ['15551234567'];
  const pn = { key: { remoteJid: '123@g.us', participant: '15551234567@s.whatsapp.net' } };
  const lid = { key: { remoteJid: '123@g.us', participant: '99887766@lid', participantAlt: '15551234567@s.whatsapp.net' } };
  const stranger = { key: { remoteJid: '123@g.us', participant: '15550000000@s.whatsapp.net' } };
  assert.ok(senderAllowed(pn, allowed));
  assert.ok(senderAllowed(lid, allowed));
  assert.ok(!senderAllowed(stranger, allowed));
  assert.equal(messageText({ message: { ephemeralMessage: { message: { extendedTextMessage: { text: 'list' } } } } }), 'list');
});

// ---- last prices ----
const costs = mergeCostFiles([
  // station A set S25's cost, then station B changed it later; a torn last line is skipped
  '{"sku":"s25-128gb-navy","cost":399,"updated_at":"2026-10-01T10:00:00.000Z","station":"A","by":""}\n{"sku":"A15-64GB-BLK","cost":98,"updated_at":"2026-10-02T10:00:00.000Z","station":"A"}\n{"sku":"TAB',
  '{"sku":"S25-128GB-NAVY","cost":412,"updated_at":"2026-10-03T10:00:00.000Z","station":"B","by":"admin"}\n{"sku":"S25-128GB-NAVY","cost":380,"updated_at":"2026-09-01T10:00:00.000Z","station":"B"}\n',
]);

await test('costs: newest write per SKU across the station files wins', () => {
  assert.equal(costs.get('S25-128GB-NAVY').cost, 412);
  assert.equal(costs.get('A15-64GB-BLK').cost, 98);
  assert.equal(costs.size, 2);
});

const purchases = [
  { sku: 'A15-64GB-BLK', qty: 20, price: 95, vendor: 'Ali', at: '2026-09-20T15:00:00.000Z' },
  { sku: 'A15-64GB-BLK', qty: 25, price: 101.5, vendor: '2B Wireless', at: '2026-10-10T15:00:00.000Z' },
  { sku: 'TAB-A9-GRY', qty: 10, price: null, at: '2026-10-11T15:00:00.000Z' },
];
const prices = lastPaidPrices(costs, purchases);

await test('last price: the newer of DWS Stock cost and a bought note', () => {
  assert.deepEqual(prices.get('S25-128GB-NAVY'), { price: 412, at: '2026-10-03T10:00:00.000Z', source: 'cost', by: 'admin' });
  assert.equal(prices.get('A15-64GB-BLK').price, 101.5); // bought Oct 10, after the Oct 2 cost
  assert.equal(prices.get('A15-64GB-BLK').vendor, '2B Wireless');
  assert.equal(prices.has('TAB-A9-GRY'), false); // bought with no price: nothing to show
});

await test('the list shows last prices and a spend total that never guesses', () => {
  const text = formatShoppingList(shoppingList(rows, {}), { now, prices });
  assert.match(text, /S25-128GB-NAVY .*buy 115\* · last \$412/);
  assert.match(text, /A15-64GB-BLK .*buy 55\* · last \$101\.50/);
  // 115 x 412 + 55 x 101.5 = 52,962.5; TAB has no price
  assert.match(text, /Total: 190 units ≈ \$52,963 at last prices \(\+1 SKU with no price yet\)/);
  console.log('\n' + text + '\n');
});

await test('stock and history show where the price came from', () => {
  assert.match(formatStock(row('S25-128GB-NAVY'), null, prices.get('S25-128GB-NAVY')), /Last price: \$412 \(cost in DWS Stock, set Sat, Oct 3\)/);
  assert.match(formatStock(row('A15-64GB-BLK'), null, prices.get('A15-64GB-BLK')), /Last price: \$101\.50 \(bought Sat, Oct 10 from 2B Wireless\)/);
  const h = formatHistory(row('A15-64GB-BLK'), purchases, prices.get('A15-64GB-BLK'));
  assert.match(h, /Sat, Oct 10: 25 @ \$101\.50 from 2B Wireless\n• Sun, Sep 20: 20 @ \$95 from Ali/u);
  assert.match(formatHistory(row('S25-128GB-NAVY'), purchases, prices.get('S25-128GB-NAVY')), /No purchases noted[\s\S]*Cost in DWS Stock: \$412/);
});

await test('Drive: signs in with the service account and re-reads only changed files', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dws-bot-test-'));
  const keyFile = path.join(dir, 'key.json');
  fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'bot@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
  let modified = 't1';
  const downloads = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      const jwt = new URLSearchParams(String(opts.body)).get('assertion');
      const [h, c, sig] = jwt.split('.');
      const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'));
      const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
      assert.ok(ok, 'JWT signature verifies');
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/drive.readonly');
      assert.equal(claims.iss, 'bot@proj.iam.gserviceaccount.com');
      return json({ access_token: 'tok', expires_in: 3600 });
    }
    assert.equal(opts.headers.Authorization, 'Bearer tok');
    if (u.includes('alt=media')) {
      downloads.push(u);
      return new Response('{"sku":"S25-128GB-NAVY","cost":400,"updated_at":"2026-10-05T00:00:00.000Z"}\n');
    }
    const q = new URL(u).searchParams.get('q');
    assert.equal(q, "'FOLDER123' in parents and name contains 'costs-' and trashed = false");
    return json({ files: [{ id: 'f1', name: 'costs-ADMIN.jsonl', modifiedTime: modified }, { id: 'f2', name: 'costs-notes.txt', modifiedTime: 't1' }] });
  };
  try {
    const d = new DriveCosts({ keyFile, folderId: 'FOLDER123' });
    await d.refresh();
    assert.equal(d.costs.get('S25-128GB-NAVY').cost, 400);
    await d.refresh(); // unchanged: no new download
    assert.equal(downloads.length, 1);
    modified = 't2';
    await d.refresh(); // changed: downloaded again
    assert.equal(downloads.length, 2);
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- plain-language questions ----
const ctx = { rows, days, purchases, prices, bought: {}, dataAt: now.getTime() };

await test('assistant tools answer from the data', () => {
  const found = runTool('find_skus', { query: 's25 navy' }, ctx);
  assert.deepEqual(found.skus.map(r => r.sku), ['S25-128GB-NAVY', 'S25-128GB-NAVY-OPENBOX']);
  assert.equal(found.skus[1].condition, 'open box / used / scrap');
  const sku = runTool('get_sku', { sku: 'a15-64gb-blk' }, ctx);
  assert.equal(sku.sold30, 60);
  assert.equal(sku.series, undefined);
  assert.deepEqual(sku.lastPrice, { price: 101.5, from: 'noted purchase', date: '2026-10-10', seller: '2B Wireless' });
  const daily = runTool('daily_sales', { sku: 'TAB-A9-GRY' }, ctx);
  assert.equal(Object.keys(daily.days).length, 30);
  assert.equal(daily.days['2026-10-19'], 1);
  const hist = runTool('purchase_history', { sku: 'A15-64GB-BLK' }, ctx);
  assert.deepEqual(hist.purchases.map(p => [p.date, p.qty, p.seller]), [['2026-10-10', 25, '2B Wireless'], ['2026-09-20', 20, 'Ali']]);
  assert.match(runTool('purchase_history', { sku: 'S25-128GB-NAVY' }, ctx).note, /No purchases/);
  assert.equal(runTool('purchase_history', { sku: 'S25-128GB-NAVY' }, ctx).dwsStockCost.cost, 412);
  assert.deepEqual(runTool('shopping_list', {}, ctx).orderNow.map(r => r.sku), ['A15-64GB-BLK']);
  assert.equal(runTool('top_sellers', { by: 'units_30d', limit: 2 }, ctx).skus[0].sku, 'S25-128GB-NAVY');
  assert.match(runTool('get_sku', { sku: 'NOPE' }, ctx).error, /find_skus/);
  // every tool is strict with a closed schema
  for (const t of TOOLS) assert.ok(t.strict && t.input_schema.additionalProperties === false, t.name);
});

await test('assistant: tool loop, one results message per turn, history only appended', async () => {
  const calls = [];
  const replies = [
    { stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 50 }, content: [
      { type: 'thinking', thinking: '', signature: 'sig1' },
      { type: 'tool_use', id: 't1', name: 'find_skus', input: { query: 'a15' } },
      { type: 'tool_use', id: 't2', name: 'purchase_history', input: { sku: 'A15-64GB-BLK' } },
    ] },
    { stop_reason: 'end_turn', usage: { input_tokens: 1500, output_tokens: 80 }, content: [{ type: 'text', text: 'Last bought *Oct 10*: 25 @ $101.50 from 2B Wireless.' }] },
    { stop_reason: 'end_turn', usage: { input_tokens: 200, output_tokens: 20 }, content: [{ type: 'text', text: 'Ali, on Sep 20.' }] },
  ];
  const client = { beta: { messages: { create: async (p) => { calls.push(structuredClone(p)); return replies.shift(); } } } };
  const a = new Assistant({ model: 'claude-opus-5-5', effort: 'low', dailyLimit: 5, getContext: () => ctx, client });
  const answer = await a.ask('group1', 'when did we last buy the A15?', { who: 'Dad', now });
  assert.equal(answer, 'Last bought *Oct 10*: 25 @ $101.50 from 2B Wireless.');
  assert.equal(calls[0].model, 'claude-opus-5-5');
  assert.deepEqual(calls[0].output_config, { effort: 'low' });
  assert.equal(calls[0].fallbacks, 'default');
  assert.deepEqual(calls[0].betas, ['server-side-fallback-2026-07-01']);
  assert.equal(calls[0].thinking, undefined); // Opus 5.5 always thinks; effort sets the depth
  assert.match(calls[0].messages[0].content, /from Dad\]\nwhen did we last buy the A15\?$/);
  // the second request: question, the whole assistant turn as it came (thinking included), both results in ONE message
  const second = calls[1].messages;
  assert.equal(second.length, 3);
  assert.equal(second[1].content[0].type, 'thinking');
  assert.deepEqual(second[2].content.map(r => r.tool_use_id), ['t1', 't2']);
  assert.match(second[2].content[1].content, /2B Wireless/);
  // a follow-up continues the same conversation, earlier turns untouched
  await a.ask('group1', 'and before that?', { now });
  assert.deepEqual(calls[2].messages.slice(0, 4), calls[1].messages.concat([{ role: 'assistant', content: [{ type: 'text', text: 'Last bought *Oct 10*: 25 @ $101.50 from 2B Wireless.' }] }]));
  assert.equal(a.today().questions, 2);
  assert.ok(a.costToday() > 0);
});

await test('assistant: Haiku gets no fallbacks; refusals, errors and the daily limit are handled', async () => {
  const seen = [];
  const mk = (res) => ({ beta: { messages: { create: async (p) => { seen.push(p); if (res instanceof Error) throw res; return res; } } } });
  const h = new Assistant({ model: 'claude-haiku-5-5', effort: 'low', dailyLimit: 1, getContext: () => ctx,
    client: mk({ stop_reason: 'refusal', usage: {}, content: [] }) });
  assert.match(await h.ask('g', 'x', { now }), /can't help/);
  assert.equal(seen[0].fallbacks, undefined);
  assert.equal(seen[0].betas, undefined);
  assert.match(await h.ask('g', 'y', { now }), /daily limit/);
  assert.equal(h.sessions.get('g').messages.length, 0); // a refused turn is not kept
  const broken = new Assistant({ model: 'claude-opus-5-5', effort: 'low', dailyLimit: 5, getContext: () => ctx, client: mk(new Error('boom')) });
  assert.match(await broken.ask('g', 'z', { now }), /went wrong/);
});

await test('questions are only picked up when addressed to the bot', () => {
  const me = ['15550001111:7@s.whatsapp.net', '88990011@lid'];
  const plain = (text) => ({ key: {}, message: { conversation: text } });
  const ext = (text, contextInfo) => ({ key: {}, message: { extendedTextMessage: { text, contextInfo } } });
  assert.equal(addressedText(plain('bot when did we last buy S25?'), 'bot when did we last buy S25?', me), 'when did we last buy S25?');
  assert.equal(addressedText(plain('Bot, top sellers this week'), 'Bot, top sellers this week', me), 'top sellers this week');
  assert.equal(addressedText(plain('? how many A15 left'), '? how many A15 left', me), 'how many A15 left');
  assert.equal(addressedText(ext('@88990011 what sold today', { mentionedJid: ['88990011@lid'] }), '@88990011 what sold today', me), 'what sold today');
  assert.equal(addressedText(ext('and the 256?', { participant: '15550001111@s.whatsapp.net' }), 'and the 256?', me), 'and the 256?');
  assert.equal(addressedText(plain('thanks dad, call you later'), 'thanks dad, call you later', me), null);
  assert.equal(addressedText(plain('robot vacuum sold well'), 'robot vacuum sold well', me), null);
  assert.equal(addressedText(ext('see this', { participant: '15557654321@s.whatsapp.net' }), 'see this', me), null);
});

console.log(`\n${passed} passed`);
