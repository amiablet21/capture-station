'use strict';
// Linnworks from the command line, for Claude Code sessions and anyone
// comfortable in a terminal (owner 2026-10-26: "continue on Claude Code" -
// the buy list, the duplicate check and the pallet receiving done by hand
// that night, kept as commands so every session works the same way).
//
//   npm run lw -- <command> [args]
//
//   stock SKU...                 levels per location (SKU* matches a prefix)
//   history SKU [--since D] [--all]
//                                that SKU's stock changes (orders hidden unless --all)
//   changes [--since D] [--min N] [--wfs]
//                                every manual change on every SKU (the duplicate check)
//   receive SKU=QTY... [--file F] --by NAME [--note T] [--since D] [--quick]
//           [--create] [--force] [--stocklog PATH] [--yes]
//                                book a delivery in: preview first, writes only with --yes
//   price SKU [--days N]         average selling price, by channel and by week
//   buylist [--pace N] [--bf-start D] [--until D] [--min-week N] [--csv PATH]
//                                ranked buy list for a sales peak (Black Friday by default)
//
// Credentials come from LINNWORKS_APP_ID / LINNWORKS_APP_SECRET /
// LINNWORKS_TOKEN; the stock location from LINNWORKS_LOCATION (a name or an
// id, default "Digital World Shop"). Times print in US Eastern: Linnworks
// keeps UTC, the business runs on New York time.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LinnworksClient } = require('../../src/main/linnworks.js');

const TZ = 'America/New_York';
const NOT_NEW = /OPEN[\s-]?BOX|USED|SCRAP|REFURB/i;
const DAY_MS = 86400000;

/* ---------- plumbing ---------- */

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const [k, v] = a.slice(2).split(/=(.*)/s);
    if (v !== undefined) opt[k] = v;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) opt[k] = argv[++i];
    else opt[k] = true;
  }
  return { pos, opt };
}

function client() {
  const { LINNWORKS_APP_ID: applicationId, LINNWORKS_APP_SECRET: applicationSecret, LINNWORKS_TOKEN: token } = process.env;
  if (!applicationId || !applicationSecret || !token) {
    throw new Error('Set LINNWORKS_APP_ID, LINNWORKS_APP_SECRET and LINNWORKS_TOKEN (environment secrets, never a file in the repo).');
  }
  return new LinnworksClient({ applicationId, applicationSecret, token });
}

// Linnworks history dates sometimes come without a zone; they are UTC
function lwDate(s) {
  const str = String(s || '');
  return new Date(Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(str) ? str : `${str}Z`));
}
const etFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const et = (d) => etFmt.format(d instanceof Date ? d : lwDate(d));
const etDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD

// "2026-10-20" = that day's midnight in New York, as a Date
function etMidnight(day) {
  const guess = new Date(`${day}T00:00:00Z`);
  const offset = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' })) - new Date(guess.toLocaleString('en-US', { timeZone: TZ }));
  return new Date(guess.getTime() + offset);
}
const daysAgo = (n) => etDay(new Date(Date.now() - n * DAY_MS));

function sinceDate(opt, fallbackDays) {
  const day = opt.since || daysAgo(fallbackDays);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`--since takes a date like 2026-10-20, not "${day}"`);
  return etMidnight(day);
}

function table(rows, head) {
  const all = [head, ...rows].map(r => r.map(c => String(c ?? '')));
  const w = head.map((_, i) => Math.max(...all.map(r => r[i].length)));
  const line = (r) => r.map((c, i) => (/^[+-]?[\d,.$]+$/.test(c) ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ').trimEnd();
  return [line(all[0]), w.map(n => '-'.repeat(n)).join('  '), ...all.slice(1).map(line)].join('\n');
}

async function inventory(c) {
  const items = await c.listInventory();
  return { items, bySku: new Map(items.map(it => [String(it.sku).toUpperCase(), it])) };
}

// the stock location, from LINNWORKS_LOCATION (name or id) as items report it
function resolveLocation(items) {
  const want = String(process.env.LINNWORKS_LOCATION || 'Digital World Shop').toLowerCase();
  for (const it of items) {
    const l = (it.levels || []).find(x => String(x.locationId).toLowerCase() === want || String(x.locationName || '').toLowerCase() === want);
    if (l) return { id: l.locationId, name: l.locationName };
  }
  throw new Error(`No stock location named "${want}" - set LINNWORKS_LOCATION to a location name or id.`);
}
const wfsLevel = (it) => (it.levels || []).find(l => /wfs/i.test(l.locationName || ''));

async function itemHistory(c, stockItemId, locationId, since) {
  const out = [];
  for (let page = 1; page <= 25; page++) {
    const r = await c.call('Stock/GetItemChangesHistory', { stockItemId, locationId, entriesPerPage: 200, pageNumber: page });
    const rows = (r && r.Data) || [];
    out.push(...rows);
    if (rows.length < 200 || lwDate(rows[rows.length - 1].Date) < since) break;
  }
  return out.filter(x => lwDate(x.Date) >= since);
}

const isOrder = (x) => /^Order \d+/.test(x.Note || '');
const isReturn = (x) => /\breturn\b/i.test(x.Note || '');

// every manual change since `since` on every SKU, oldest first: what the
// duplicate check reads (WFS left out by default - the Walmart sync rewrites
// it every 15 minutes)
async function manualChanges(c, items, since, { min = 5, wfs = false, returns = false, onItem } = {}) {
  const out = [];
  let n = 0;
  for (const it of items) {
    if (onItem) onItem(++n, items.length);
    for (const l of it.levels || []) {
      if (/dropship/i.test(l.locationName || '')) continue;
      if (!wfs && /wfs/i.test(l.locationName || '')) continue;
      const rows = await itemHistory(c, it.stockItemId, l.locationId, since);
      for (const x of rows) {
        if (isOrder(x) || (!returns && isReturn(x)) || Math.abs(Number(x.ChangeQty)) < min) continue;
        out.push({ at: lwDate(x.Date), sku: it.sku, location: l.locationName, qty: Number(x.ChangeQty), level: Number(x.Level), note: x.Note || '' });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
const progress = (label) => (i, n) => { if (process.stderr.isTTY) process.stderr.write(`\r${label} ${i}/${n}   `); if (i === n && process.stderr.isTTY) process.stderr.write('\n'); };

/* ---------- commands ---------- */

async function cmdStock({ pos }) {
  if (!pos.length) throw new Error('Usage: stock SKU... (SKU* matches a prefix)');
  const c = client();
  const { items } = await inventory(c);
  const rows = [];
  for (const q of pos) {
    const pre = q.endsWith('*');
    const want = q.replace(/\*$/, '').toUpperCase();
    const hits = items.filter(it => (pre ? String(it.sku).toUpperCase().startsWith(want) : String(it.sku).toUpperCase() === want));
    if (!hits.length) rows.push([q, '(not in Linnworks)', '', '', '', '']);
    for (const it of hits) {
      for (const l of it.levels || []) {
        if (!Number(l.stockLevel) && !Number(l.due) && /default/i.test(l.locationName || '')) continue;
        rows.push([it.sku, l.locationName, l.stockLevel, l.inOrders, l.available, l.due]);
      }
    }
  }
  console.log(table(rows, ['SKU', 'Location', 'In stock', 'In orders', 'Available', 'Due in']));
}

async function cmdHistory({ pos, opt }) {
  if (pos.length !== 1) throw new Error('Usage: history SKU [--since 2026-10-01] [--all]');
  const c = client();
  const since = sinceDate(opt, 14);
  const { bySku } = await inventory(c);
  const it = bySku.get(pos[0].toUpperCase());
  if (!it) throw new Error(`${pos[0]} is not in Linnworks`);
  const rows = [];
  for (const l of it.levels || []) {
    for (const x of await itemHistory(c, it.stockItemId, l.locationId, since)) {
      if (!opt.all && isOrder(x)) continue;
      rows.push([lwDate(x.Date), l.locationName, Number(x.ChangeQty), Number(x.Level), x.Note || '']);
    }
  }
  rows.sort((a, b) => a[0] - b[0]);
  console.log(`${it.sku} since ${etDay(since)} (US Eastern)${opt.all ? '' : ', orders hidden'}\n`);
  console.log(rows.length ? table(rows.map(r => [et(r[0]), r[1], (r[2] > 0 ? '+' : '') + r[2], r[3], r[4]]), ['When', 'Location', 'Change', 'Level', 'Note']) : 'No changes.');
}

async function cmdChanges({ opt }) {
  const c = client();
  const since = sinceDate(opt, 7);
  const { items } = await inventory(c);
  const list = await manualChanges(c, items, since, { min: Number(opt.min) || 5, wfs: !!opt.wfs, returns: !!opt.returns, onItem: progress('Reading history') });
  console.log(`Manual stock changes of ${Number(opt.min) || 5}+ units since ${etDay(since)} (US Eastern), all ${items.length} SKUs${opt.wfs ? '' : ', WFS left out'}\n`);
  console.log(list.length ? table(list.map(x => [et(x.at), x.sku, x.location, (x.qty > 0 ? '+' : '') + x.qty, x.level, x.note]), ['When', 'SKU', 'Location', 'Change', 'Level', 'Note']) : 'None.');
}

// receive lines from SKU=QTY args, or a file of SKU,QTY lines (CSV) or [{sku, qty}] (JSON)
function receiveLines(pos, opt) {
  const raw = [...pos];
  if (opt.file) {
    const text = fs.readFileSync(opt.file, 'utf8');
    if (/\.json$/i.test(opt.file)) for (const r of JSON.parse(text)) raw.push(`${r.sku}=${r.qty}`);
    else for (const ln of text.split(/\r?\n/)) { const [s, q] = ln.split(','); if (s && /^\d+$/.test(String(q).trim())) raw.push(`${s.trim()}=${q.trim()}`); }
  }
  const lines = raw.map(a => {
    const m = String(a).match(/^([^=]+)=(\d+)$/);
    if (!m) throw new Error(`"${a}" is not SKU=QTY`);
    return { sku: m[1].trim().toUpperCase(), qty: Number(m[2]) };
  });
  if (!lines.length) throw new Error('Nothing to receive: pass SKU=QTY pairs or --file');
  const dup = lines.find((l, i) => lines.findIndex(o => o.sku === l.sku) !== i);
  if (dup) throw new Error(`${dup.sku} is listed twice - add the quantities into one line`);
  return lines;
}

const near = (a, b) => Math.abs(a - b) <= b * 0.2;
const stationOf = (by) => String(by).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

async function cmdReceive({ pos, opt }) {
  const lines = receiveLines(pos, opt);
  const c = client();
  const since = sinceDate(opt, 10);
  const { items, bySku } = await inventory(c);
  const loc = resolveLocation(items);

  // every manual add since `since`: on the line's own SKU it may be this
  // delivery already booked (an add later taken back by a reversal of the
  // same qty does not count); on another SKU, a near quantity may be the
  // same units booked under the wrong SKU (skipped with --quick, it reads
  // every SKU). WFS and DropShip are left out: the Walmart sync and the pad
  // rewrite them all day and receiving never lands there.
  const adds = new Map();
  for (const l of lines) {
    const it = bySku.get(l.sku);
    if (!it) continue;
    const moves = [];
    for (const lv of it.levels || []) {
      if (/dropship|wfs/i.test(lv.locationName || '')) continue;
      for (const x of await itemHistory(c, it.stockItemId, lv.locationId, since)) {
        if (!isOrder(x) && !isReturn(x)) moves.push({ at: lwDate(x.Date), location: lv.locationName, qty: Number(x.ChangeQty), level: Number(x.Level), note: x.Note || '' });
      }
    }
    moves.sort((a, b) => a.at - b.at);
    const found = moves.filter(m => m.qty > 0);
    for (const a of found) {
      a.reversed = moves.some(m => m.qty === -a.qty && m.at >= a.at && /revers|in error/i.test(m.note));
    }
    adds.set(l.sku, found);
  }
  let elsewhere = [];
  if (!opt.quick) {
    const all = await manualChanges(c, items, since, { onItem: progress('Checking every SKU') });
    // a +N with a -N on another SKU in the same couple of minutes is stock
    // moved between SKUs (new to open box and the like), not a delivery
    const moved = (x) => all.some(y => y.qty === -x.qty && y.sku !== x.sku && Math.abs(y.at - x.at) <= 120000);
    elsewhere = all.filter(x => x.qty > 0 && !/wfs/i.test(x.location) && !lines.some(l => l.sku === String(x.sku).toUpperCase()) && !moved(x));
  }

  console.log(`Receiving at ${loc.name}. Checked adds since ${etDay(since)} (US Eastern)${opt.quick ? ' on these SKUs only' : ' on every SKU'}.\n`);
  const plan = [];
  for (const l of lines) {
    const it = bySku.get(l.sku);
    const home = it && (it.levels || []).find(x => x.locationId === loc.id);
    const own = adds.get(l.sku) || [];
    const live = own.filter(a => !a.reversed);
    const exact = live.filter(a => a.qty === l.qty);
    const similar = live.filter(a => a.qty !== l.qty && near(a.qty, l.qty));
    const other = elsewhere.filter(x => near(x.qty, l.qty));
    let verdict;
    if (!it) verdict = opt.create ? 'NEW SKU - will be created' : 'NOT IN LINNWORKS - pass --create to make it';
    else if (exact.length) verdict = 'ALREADY ADDED - same qty booked';
    else if (similar.length) verdict = 'CHECK - a similar qty was booked';
    else if (live.length) verdict = 'CHECK - other adds on this SKU';
    else verdict = 'OK - nothing booked yet';
    plan.push({ ...l, it, now: home ? Number(home.stockLevel) : 0, verdict, blocked: !it ? !opt.create : !verdict.startsWith('OK') });
    console.log(`${l.sku}  +${l.qty}  (now ${home ? home.stockLevel : 0})  ${verdict}`);
    for (const a of own) console.log(`    ${et(a.at)}  ${a.location}  +${a.qty} -> ${a.level}  ${a.note}${a.reversed ? '  (reversed later)' : ''}`);
    for (const x of other) console.log(`    similar on ${x.sku}: ${et(x.at)}  +${x.qty} -> ${x.level}  ${x.note}`);
  }

  const blocked = plan.filter(p => p.blocked);
  if (!opt.yes) {
    console.log(`\nNothing written. ${blocked.length ? `Settle the ${blocked.length} flagged line(s) first (drop them, or --force once you are sure). ` : ''}Re-run with --by NAME --yes to book it in.`);
    return;
  }
  if (typeof opt.by !== 'string' || !opt.by.trim()) throw new Error('--by NAME is required to write (it labels the change in Linnworks)');
  if (blocked.length && !opt.force) throw new Error(`Not written: ${blocked.map(p => p.sku).join(', ')} flagged above. Drop them, or pass --force once you are sure they are not duplicates.`);

  const source = `${opt.by} - ${opt.note || `received ${etDay(new Date())}`}`.slice(0, 100);
  const stationName = stationOf(opt.by);
  const logRows = [];
  for (const p of plan) {
    if (!p.it && !opt.create) continue;
    if (!p.it) {
      await c.createInventoryItem({ sku: p.sku, title: p.sku });
      let id = null;
      for (let i = 0; i < 6 && !id; i++) { id = await c.findStockItemIdBySku(p.sku); if (!id) await new Promise(r => setTimeout(r, 1500)); }
      if (!id) throw new Error(`${p.sku} was created but Linnworks does not find it yet - check before re-running (it must not be created twice)`);
    }
    const res = await c.changeStockLevels([{ sku: p.sku, delta: p.qty }], loc.id, source);
    const after = (Array.isArray(res) ? res : []).find(r => String(r.SKU || '').toUpperCase() === p.sku);
    const level = after ? Number(after.StockLevel ?? after.Level) : p.now + p.qty;
    console.log(`Booked ${p.sku} +${p.qty} -> ${level}`);
    logRows.push({
      gid: `${stationName}:${crypto.randomUUID()}`, created_at: new Date().toISOString(), day: etDay(new Date()),
      sku: p.sku, location_id: loc.id, delta: p.qty, level_after: level,
      reason: p.it ? 'bulk-add' : 'new-sku', change_source: source, ref: '', note: p.it ? (opt.note || '') : 'listing created with opening stock',
      computer: stationName, by: String(opt.by), link_kind: '', link_gid: '', data: '',
    });
  }
  // DWS Stock's history panel only shows what a station logged in the shared
  // folder: append there (G:\My Drive\returns-sync\stocklog-<NAME>.jsonl on a
  // synced PC), or write the file and upload it to that folder
  const jsonl = logRows.map(r => JSON.stringify(r)).join('\n') + '\n';
  if (opt.stocklog) {
    fs.appendFileSync(opt.stocklog, jsonl);
    console.log(`\nHistory rows appended to ${opt.stocklog}`);
  } else {
    const out = path.resolve(`stocklog-${stationName}.jsonl`);
    fs.appendFileSync(out, jsonl);
    console.log(`\nHistory rows written to ${out} - put them in returns-sync/stocklog-${stationName}.jsonl so DWS Stock shows them.`);
  }
}

async function cmdPrice({ pos, opt }) {
  if (pos.length !== 1) throw new Error('Usage: price SKU [--days 30]');
  const days = Number(opt.days) || 30;
  const sku = pos[0].toUpperCase();
  const c = client();
  const from = etMidnight(daysAgo(days - 1));
  const lines = (await c.listProcessedLines(from.toISOString(), new Date().toISOString()))
    .filter(l => !l.unmapped && String(l.sku).toUpperCase() === sku);
  if (!lines.length) { console.log(`No sales of ${sku} in the last ${days} days.`); return; }
  const sum = (ls) => {
    const paid = ls.filter(l => Number(l.revenue) > 0);
    const q = paid.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    const r = paid.reduce((s, l) => s + (Number(l.revenue) || 0), 0);
    return { units: ls.reduce((s, l) => s + (Number(l.qty) || 0), 0), zero: ls.length - paid.length, avg: q ? `$${(r / q).toFixed(2)}` : '-' };
  };
  const group = (key) => { const m = new Map(); for (const l of lines) { const k = key(l); m.set(k, [...(m.get(k) || []), l]); } return m; };
  const all = sum(lines);
  console.log(`${sku}, last ${days} days (from ${etDay(from)}): ${all.units} units, average ${all.avg} per unit before tax, fees and shipping${all.zero ? ` (${all.zero} order line(s) at $0 left out of the average)` : ''}\n`);
  console.log(table([...group(l => l.source)].map(([k, ls]) => { const s = sum(ls); return [k, s.units, s.avg, s.zero || '']; }), ['Channel', 'Units', 'Avg price', '$0 lines']));
  const monday = (l) => { const d = new Date(`${etDay(new Date(l.processedOn))}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  console.log('');
  console.log(table([...group(monday)].sort().map(([k, ls]) => { const s = sum(ls); return [k, s.units, s.avg]; }), ['Week of', 'Units', 'Avg price']));
}

// The buy list for a sales peak (owner 2026-10-26, Black Friday): pace is
// the best of the 14/30/60-day averages, so a stockout does not drag it
// down; need = normal pace until the peak, `pace` times it through the
// peak; buy = need less on hand (location + WFS) and due in, up to a 5.
async function cmdBuylist({ opt }) {
  const pace = Number(opt.pace) || 10;
  const year = Number(etDay(new Date()).slice(0, 4));
  const bfStart = opt['bf-start'] || `${year}-11-20`;
  const until = opt.until || `${year}-11-30`;
  const minWeek = Number(opt['min-week']) || 0;
  const today = etDay(new Date());
  const dayCount = (a, b) => Math.round((etMidnight(b) - etMidnight(a)) / DAY_MS);
  const normalDays = Math.max(0, dayCount(today, bfStart) - 1); // tomorrow .. the day before the peak
  const peakDays = dayCount(bfStart, until) + 1;
  if (peakDays <= 0) throw new Error('--until must be on or after --bf-start');

  const c = client();
  const { items } = await inventory(c);
  const loc = resolveLocation(items);
  const from = etMidnight(daysAgo(59));
  process.stderr.write('Reading 60 days of processed orders...\n');
  const lines = await c.listProcessedLines(from.toISOString(), new Date().toISOString());
  const sold = new Map(); // SKU -> units in the last 14 / 30 / 60 days
  for (const l of lines) {
    if (l.unmapped) continue;
    const age = Math.floor((Date.now() - Date.parse(l.processedOn)) / DAY_MS);
    const s = sold.get(String(l.sku).toUpperCase()) || { d14: 0, d30: 0, d60: 0 };
    const q = Number(l.qty) || 0;
    s.d60 += q; if (age < 30) s.d30 += q; if (age < 14) s.d14 += q;
    sold.set(String(l.sku).toUpperCase(), s);
  }
  const exclude = opt.exclude ? new RegExp(opt.exclude, 'i') : null;
  const rows = [];
  for (const it of items) {
    if (NOT_NEW.test(it.sku) || (exclude && exclude.test(it.sku))) continue;
    const s = sold.get(String(it.sku).toUpperCase());
    if (!s) continue;
    const rate = Math.max(s.d14 / 14, s.d30 / 30, s.d60 / 60);
    const home = (it.levels || []).find(l => l.locationId === loc.id) || {};
    const onHand = Math.max(0, Number(home.available) || 0) + Math.max(0, Number((wfsLevel(it) || {}).stockLevel) || 0);
    const gap = Math.ceil(rate * (normalDays + peakDays * pace)) - onHand - Math.max(0, Number(home.due) || 0);
    const buy = gap > 0 ? Math.max(5, Math.ceil(gap / 5) * 5) : 0;
    if (!buy) continue;
    const week = rate * 7;
    if (week < minWeek) continue;
    const daysLeft = onHand / rate;
    const tier = onHand <= 0 ? (week >= 1 ? 1 : 5) : daysLeft <= 14 ? 2 : daysLeft <= normalDays ? 3 : 4;
    rows.push({ sku: it.sku, ds: it.dsPad ? 'DS' : '', week, onHand, daysLeft, tier, buy });
  }
  const groups = { 1: 'Out of stock now', 2: 'Runs out within 2 weeks', 3: `Runs out before ${bfStart}`, 4: 'Has stock, short for the peak', 5: 'Out of stock, slow (under 1 a week)' };
  rows.sort((a, b) => a.tier - b.tier || (a.tier === 1 || a.tier === 5 ? b.week - a.week : a.daysLeft - b.daysLeft || b.week - a.week));
  const fmtWeek = (w) => (w >= 10 ? Math.round(w) : Math.round(w * 10) / 10);
  console.log(`Buy list at ${loc.name} + WFS: normal pace to ${bfStart}, ${pace}x pace ${bfStart} to ${until}${minWeek ? `, ${minWeek}+ a week only` : ''}. ${rows.length} SKUs, ${rows.reduce((s, r) => s + r.buy, 0).toLocaleString()} units.\n`);
  let rank = 0;
  for (const t of [1, 2, 3, 4, 5]) {
    const g = rows.filter(r => r.tier === t);
    if (!g.length) continue;
    console.log(`${groups[t]}\n${table(g.map(r => [++rank, r.sku, r.ds, fmtWeek(r.week), r.onHand, r.buy]), ['#', 'SKU', '', 'Sold/week', 'Left', 'Buy'])}\n`);
  }
  if (opt.csv) {
    rank = 0;
    const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = ['Rank,SKU,Dropship,Sold per week,On hand,Group,Suggested buy', ...rows.map(r => [++rank, r.sku, r.ds ? 'Yes' : '', fmtWeek(r.week), r.onHand, groups[r.tier], r.buy].map(esc).join(','))];
    fs.writeFileSync(opt.csv, csv.join('\n') + '\n');
    console.log(`Saved ${opt.csv}`);
  }
}

/* ---------- main ---------- */

const COMMANDS = { stock: cmdStock, history: cmdHistory, changes: cmdChanges, receive: cmdReceive, price: cmdPrice, buylist: cmdBuylist };

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const run = COMMANDS[cmd];
  if (!run) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//')).slice(5, 23).map(l => l.slice(3)).join('\n'));
    process.exitCode = cmd ? 1 : 0;
    return;
  }
  await run(parseArgs(rest));
}

if (require.main === module) {
  main().catch(e => { console.error(`Error: ${e.message}`); process.exitCode = 1; });
}

module.exports = { parseArgs, lwDate, etMidnight, etDay, receiveLines, stationOf };
