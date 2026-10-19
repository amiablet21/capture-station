// Offline checks: made-up stock and sales through the real reorder maths
// (sales-export.js) and the bot's messages and commands. No Linnworks, no
// WhatsApp. Run: npm test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  shoppingList, formatShoppingList, formatOutAlert, formatStock, settledBought,
  parseCommand, matchSku, isConditionSku,
} from './lib/report.js';
import { senderAllowed, messageText } from './lib/whatsapp.js';

const require = createRequire(import.meta.url);
const { buildSalesExport } = require('../src/main/sales-export.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

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
const { rows } = buildSalesExport(items, lines, { now, days: 30, locationId: LOC, leadDays: 7, coverDays: 21 });
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
  assert.deepEqual(parseCommand('bought S25 30 @ 405'), { cmd: 'bought', sku: 'S25', qty: 30, price: 405 });
  assert.deepEqual(parseCommand('Bought s25 30 at $405.50'), { cmd: 'bought', sku: 's25', qty: 30, price: 405.5 });
  assert.deepEqual(parseCommand('bought S25 30'), { cmd: 'bought', sku: 'S25', qty: 30, price: null });
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

console.log(`\n${passed} passed`);
