#!/usr/bin/env node
'use strict';
// Writes a made-up returns-sync folder in the exact file formats DWS Stock
// uses, for trying the server and for its tests. Every name, order number
// and price in it is invented.
//
//   node server/demo-folder.js <folder to create>

const fs = require('node:fs');
const path = require('node:path');

function makeDemoFolder(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'Walmart Reports'), { recursive: true });
  const put = (name, rows) => fs.writeFileSync(path.join(dir, name), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  const day = (n, h = 14, m = 5) => new Date(Date.UTC(2026, 10, n, h, m)).toISOString();
  const t = (n, h = 14, m = 5) => Date.UTC(2026, 10, n, h, m);

  const people = ['Dana Whitfield', 'Marcus Oyelaran', 'Priya Raman', 'Tom Castellano', 'Elena Brandt', 'Jorge Medina', 'Aiko Tanabe', 'Sam Ferreira'];
  const skus = ['X210-64GB-GRAY', 'X210-128GB-GRAY', 'X306-128GB-GREEN', 'S26-256GB-BLUE', 'S26-ULTRA-512GB-BLACK', 'A15-64GB-BLACK', 'BUDS-3-WHITE', 'X620-128GB-GRAY'];
  const ret = (id, n, who, source, order, sku, cond, price, extra = {}) => ({
    v: 1, op: 'put', gid: `RETURNS-ROOM-PC:${id}`, ts: t(n), actor: 'RETURNS-ROOM-PC',
    rec: { created_at: day(n), order_number: order, source, customer: who, note: '', items: [{ sku, condition: cond, received: '', targetSku: cond === 'new' ? sku : `OPEN-BOX-${sku}`, qty: 1, price, settle: 0, note: '' }],
      unmatched: false, tracking: `1Z999AA1${String(1000000 + id * 7919).slice(0, 8)}`, received_by: 'RM', ...extra },
  });

  /* returns: mostly the returns room; one edited from the owner's laptop, one deleted */
  const returnsRoom = [];
  for (let i = 1; i <= 14; i++) {
    const src = ['WALMART', 'WALMART', 'EBAY', 'TEMU US'][i % 4];
    const order = src === 'WALMART' ? `1291304${String(61550000 + i * 3137)}` : src === 'EBAY' ? `03-1${5000 + i}-3${1000 + i}` : `PO-211-${String(90000000 + i * 4111)}`;
    returnsRoom.push(ret(i, 2 + (i % 12), people[i % people.length], src, order, skus[i % skus.length], i % 3 === 0 ? 'openbox' : 'new', 149.99 + i * 10));
  }
  put('returns-RETURNS-ROOM-PC.jsonl', returnsRoom);
  put('returns-STOCK-ROOM.jsonl', [
    { v: 1, op: 'put', gid: 'STOCK-ROOM:1', ts: t(9, 20), actor: 'STOCK-ROOM', rec: { created_at: day(9, 20), order_number: '129130461554781', source: 'WALMART', customer: 'Carol Lindqvist', note: '', items: [{ sku: 'X210-64GB-GRAY', condition: 'new', targetSku: 'X210-64GB-GRAY', qty: 1, price: 229.99 }], unmatched: false, tracking: '528884437205', received_by: 'IS' } },
  ]);
  const edited = JSON.parse(JSON.stringify(returnsRoom[2]));
  edited.ts = t(13, 16); edited.actor = 'IMRAN-MACBOOK-PRO'; edited.rec.note = 'screen cracked, graded scrap'; edited.rec.items[0].condition = 'scrap';
  put('returns-IMRAN-MACBOOK-PRO.jsonl', [edited, { v: 1, op: 'del', gid: 'RETURNS-ROOM-PC:14', ts: t(14, 9), actor: 'IMRAN-MACBOOK-PRO' }]);
  put('returns-NICK.jsonl', []);

  /* stock */
  // the reasons DWS Stock itself writes: a hand-set count, a WFS shipment, a
  // return (with what was ordered when it landed on a graded twin), a bulk
  // receive, and a correction that points back at the line it corrects
  const sl = (st, i, n, sku, delta, after, reason, note, by, extra = {}) => ({ gid: `${st}:demo-${i}`, created_at: day(n, 15, i), day: day(n).slice(0, 10), sku, location_id: 'loc-1', delta, level_after: after, reason, change_source: `${by} - ${note}`, ref: '', note, computer: st, by, link_kind: '', link_gid: '', data: '', ...extra });
  put('stocklog-STOCK-ROOM.jsonl', [sl('STOCK-ROOM', 1, 5, 'X210-64GB-GRAY', null, 41, 'set', 'set to 41', 'IS'), sl('STOCK-ROOM', 2, 6, 'S26-256GB-BLUE', -2, 58, 'other', 'damaged in the stock room', 'IS'), sl('STOCK-ROOM', 3, 7, 'X306-128GB-GREEN', -50, 120, 'wfs', '', 'IS', { ref: 'WFS-1107' })]);
  put('stocklog-RETURNS-ROOM-PC.jsonl', returnsRoom.slice(0, 8).map((r, i) => { const it = r.rec.items[0]; return sl('RETURNS-ROOM-PC', i + 1, 3 + i, it.targetSku, 1, 10 + i, 'return', it.targetSku === it.sku ? it.condition : `ordered ${it.sku}`, 'RM', { ref: r.rec.order_number }); }));
  put('stocklog-IMRAN-WORK-PC.jsonl', [sl('IMRAN-WORK-PC', 1, 4, 'S26-ULTRA-512GB-BLACK', 60, 60, 'bulk-add', 'pallet received', 'IM'),
    sl('IMRAN-WORK-PC', 2, 11, 'S26-ULTRA-512GB-BLACK', -2, 58, 'edit-qty', 'counted 58 on the pallet', 'IM', { link_kind: 'edit', link_gid: 'IMRAN-WORK-PC:demo-1', data: JSON.stringify({ fromQty: 60, toQty: 58, fromSku: 'S26-ULTRA-512GB-BLACK', toSku: 'S26-ULTRA-512GB-BLACK' }) })]);
  put('stockimports-IMRAN-WORK-PC.jsonl', [{ id: 'imp-1', ts: day(11, 19), station: 'IMRAN-WORK-PC', mode: 'edit', file: '', rows: [{ sku: 'BUDS-3-WHITE', before: 0, qty: 1, after: 1 }], skipped: [] }]);
  put('costs-NICK.jsonl', [{ sku: 'S26-256GB-BLUE', cost: 655, updated_at: day(6), station: 'NICK', by: '' }, { sku: 'X620-128GB-GRAY', cost: 438, updated_at: day(7), station: 'NICK', by: '' }]);
  put('costs-IMRAN-MACBOOK-PRO.jsonl', [{ sku: 'S26-256GB-BLUE', cost: 645, updated_at: day(12), station: 'IMRAN-MACBOOK-PRO', by: 'IM' }, { sku: 'S26-ULTRA-512GB-BLACK', cost: 1018, updated_at: day(8), station: 'IMRAN-MACBOOK-PRO', by: 'IM' }]);
  put('wfs-STOCK-ROOM.jsonl', [{ id: 18, ts: day(7), note: '10/28/2026', items: [{ sku: 'X306-128GB-GREEN', channelSku: '', gtin: '', qty: 40 }] }, { id: 19, ts: day(8), note: 'second box', items: [{ sku: 'A15-64GB-BLACK', qty: 20 }] }]);
  put('wfsedit-IMRAN-WORK-PC.jsonl', [{ key: 'STOCK-ROOM:18', ts: t(10), note: '10/28/2026', items: [{ sku: 'X306-128GB-GREEN', channelSku: '', gtin: '', qty: 50 }] }]);

  /* orders: the stock room packs; the laptop packed two */
  const cap = (st, id, n, ch, order, sku, tracking, status = 'synced') => ({ op: 'put', id, ts: t(n, 17, id), row: { order_number: order, lw_order_id: `lw-${id}`, channel: ch, items: [{ sku, qty: 1 }], tracking, carrier: 'UPS', notes: '', status, created_at: day(n, 16, id), synced_at: day(n, 17, id), day: day(n).slice(0, 10), sub_sku: '', sub_qty: 0, sub_for: '', sub_note: '' } });
  const caps = [];
  for (let i = 1; i <= 22; i++) caps.push(cap('STOCK-ROOM', i, 3 + (i % 12), ['walmart', 'ebay', 'temu'][i % 3], `2000${String(10000000000 + i * 733)}`, skus[i % skus.length], `1Z777BB2${String(2000000 + i * 911)}`));
  caps.push({ op: 'del', id: 22, ts: t(15, 9) });
  put('captures-STOCK-ROOM.jsonl', caps);
  put('captures-IMRAN-MACBOOK-PRO.jsonl', [cap('IMRAN-MACBOOK-PRO', 1, 9, 'walmart', '200099887766554', 'BUDS-3-WHITE', '1Z777BB29990001')]);
  const lab = (id, n, ref, tracking, voided = '') => ({ op: 'put', id, ts: t(n, 16, id), row: { created_at: day(n, 16, id), day: day(n).slice(0, 10), kind: 'ship', reference: ref, from_po: 1, source: 'ups', account_id: 'a', account_name: 'DWS UPS', service_code: '03', service_name: 'UPS Ground', tracking, carrier: 'UPS', cost: 9.84, value: 0, weight: 1, dims: '8x6x4', party_name: 'Customer', test: 0, voided_at: voided, row_id: id, part: '' } });
  put('shiplabels-STOCK-ROOM.jsonl', [lab(1, 12, caps[0].row.order_number, caps[0].row.tracking), lab(2, 12, caps[1].row.order_number, caps[1].row.tracking), lab(3, 13, 'PO-211-90004111', '1Z777BB20000003', day(13, 18))]);
  put('shippkgs-IMRAN-WORK-PC.jsonl', [{ id: 'p1', ts: day(4), station: 'IMRAN-WORK-PC', key: 'X210-128GB-GRAY', pkg: { box: 'Phone box', weight: 1, length: 8, width: 6, height: 4 } }, { id: 'p2', ts: day(5), station: 'IMRAN-WORK-PC', key: 'X210-128GB-GRAY', pkg: { box: 'Tablet box', weight: 1, length: 13, width: 10, height: 4 } }]);

  /* pricing: the same orders logged by four computers */
  const sales = [];
  for (let i = 1; i <= 40; i++) sales.push({ id: `s-${i}`, ts: day(1 + (i % 14), 12, i), ref: `SALE-${1000 + i}`, source: ['WALMART', 'EBAY', 'TEMU US'][i % 3], lines: [{ c: `${skus[i % skus.length]}-WM`, q: 1 + (i % 2) }] });
  put('chansales-STOCK-ROOM.jsonl', sales);
  put('chansales-IMRAN-MACBOOK-PRO.jsonl', sales.slice(0, 36).map((s) => ({ ...s, id: `m-${s.id}` })));
  put('chansales-NICK.jsonl', sales.slice(10, 30).map((s) => ({ ...s, id: `n-${s.id}` })));
  put('chansales-ERIC-COMPUTER.jsonl', sales.slice(20, 28).map((s) => ({ ...s, id: `e-${s.id}` })));
  put('pricechanges-IMRAN-MACBOOK-PRO.jsonl', [{ id: 'pc-1', ts: day(10), station: 'IMRAN-MACBOOK-PRO', mode: 'set', sku: 'S26-256GB-BLUE-WM', channel: 'WALMART', from: 699, to: 679, by: 'IM' }]);
  put('pricegroups-IMRAN-WORK-PC.jsonl', [
    { id: 'g1', ts: day(2), station: 'IMRAN-WORK-PC', op: 'add', parent: 'A15-64GB-BLACK', child: 'OPEN-BOX-A15-64GB-BLACK' },
    { id: 'g2', ts: day(2, 15), station: 'IMRAN-WORK-PC', op: 'add', parent: 'A15-64GB-BLACK', child: 'USED-A15-64GB-BLACK' },
    { id: 'g3', ts: day(3), station: 'IMRAN-WORK-PC', op: 'remove', parent: 'A15-64GB-BLACK', child: 'USED-A15-64GB-BLACK' },
  ]);

  /* recovery */
  const run = (id, label, n, st) => ({ op: 'put', id, ts: t(n), run: { id, label, ranAt: day(n), csvName: `MP_${label}.csv`, csvHash: `h-${id}`, format: 'v1', totalRefunds: 31, sellerCount: 19, wfsCount: 12, logRows: 14, counts: {}, summary: {}, station: st, by: 'IM' },
    refunds: [{ po: '129034412212588', order_no: 'W-1', item: 'Phone', sku: 'X210-64GB-GRAY', qty: 1, net: -229.99 }], payouts: [], ledger: [], orders: [], lines: [] });
  // one period carries its statement lines, as a report imported today does
  const L = (type, amountType, desc, amount, count, date) => ({ run_id: 'run-oct-a', type, amountType, desc, amount, count, date: date || '', pos: '' });
  const withLines = { ...run('run-oct-a', 'Oct 3 - Oct 17, 2026', 8, 'IMRAN-MACBOOK-PRO'), lines: [
    L('Sale', 'Product Price', 'Purchase', 41250.4, 212), L('Sale', 'Commission on Product', 'Purchase', -3300.03, 212), L('Sale', 'Shipping', 'Purchase', 310, 31),
    L('Refund', 'Product Price', 'Return Refund', -2759.88, 12), L('Refund', 'Product Price', 'Walmart Customer Care Refund', -459.98, 2), L('Refund', 'Commission on Product', 'Return Refund', 220.79, 12),
    L('Service Fee', '', 'WFS Fulfillment fee', -1480.25, 96), L('Adjustment', '', 'WFS Lost Inventory', 229.99, 1),
    L('Instant Transfer', '', 'Deposit', -20000, 1, '2026-10-12'), L('Instant Transfer', '', 'Deposit', -14011.04, 1, '2026-10-19'),
    L('PaymentSummary', '', '', 34011.04, 1),
  ] };
  put('wmruns-IMRAN-MACBOOK-PRO.jsonl', [withLines, run('run-old', 'Sep 19 - Oct 3, 2026', 5, 'IMRAN-MACBOOK-PRO'), { op: 'del', id: 'run-old', ts: t(6) }]);
  put('wmruns-IMRAN-WORK-PC.jsonl', [run('run-oct-b', 'Oct 17 - Oct 31, 2026', 11, 'IMRAN-WORK-PC')]);
  const mark = (po, n, patch) => ({ caseOpened: false, caseOpenedAt: null, caseId: null, caseApproved: false, caseApprovedAt: null, writtenOff: false, writtenOffAt: null, note: null, paidOut: 0, po, updated_at: day(n), station: 'IMRAN-HOMEDESKTOP', by: '', removed: false, ...patch });
  put('wmmarks-IMRAN-HOMEDESKTOP.jsonl', [mark('129034412212588', 7, { caseOpened: true, caseOpenedAt: day(7), caseId: 'C-55120' }), mark('129034412212588', 12, { caseOpened: true, caseOpenedAt: day(7), caseId: 'C-55120', caseApproved: true, caseApprovedAt: day(12), paidOut: 229.99 }), mark('129034412299001', 7, { writtenOff: true, writtenOffAt: day(7) })]);
  put('wmexpenses-IMRAN-MACBOOK-PRO.jsonl', [{ id: 'exp-1', date: '2026-10-01', category: 'Software', note: '', sku: '', amount: 500, updated_at: day(3), station: 'IMRAN-MACBOOK-PRO', by: '', removed: false }]);

  /* things in the real folder that are not record files */
  fs.writeFileSync(path.join(dir, 'presence-STOCK-ROOM.json'), JSON.stringify({ station: 'STOCK-ROOM', addrs: ['10.0.0.12'], port: 51234 }));
  fs.writeFileSync(path.join(dir, 'presence-token.txt'), 'demo-token-not-a-real-secret');
  fs.writeFileSync(path.join(dir, 'returns-log.csv'), 'date,station,order_number\n');
  put('rooms-IMRAN-MACBOOK-PRO.jsonl', [{ id: 'r1', ts: day(1), name: 'Front room' }]);
  fs.appendFileSync(path.join(dir, 'stocklog-STOCK-ROOM.jsonl'), '{"gid":"STOCK-ROOM:half-wri'); // a line still being written
  return dir;
}

module.exports = { makeDemoFolder };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('Usage: node server/demo-folder.js <folder to create>'); process.exit(1); }
  console.log('Demo folder written to', makeDemoFolder(path.resolve(dir)));
}
