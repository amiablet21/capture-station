'use strict';
// The Overview's What to buy list (owner 2026-10-30: "build it into the
// What to buy tab" - the Black Friday buy-list PDF the owner approved,
// variants/ov-buylist.html). Ranked in three tables: Buy now (out of stock,
// or out within two weeks), Buy next (runs out before the peak starts) and
// Then (has stock, but not enough for the peak). Same rules as
// tools/linnworks/lw.js buylist. Pure - no Electron, no Linnworks - so it is
// testable with plain node.

const DAY_MS = 86400000;
const NOT_NEW = /OPEN[\s-]?BOX|USED|SCRAP|REFURB/i;
const BUY_NOW_DAYS = 14;

const DEFAULTS = {
  minWeek: 5, // only SKUs selling at least this many a week
  peakName: 'Black Friday',
  peakStart: '11-20', // MM-DD: the Friday before Thanksgiving week...
  peakEnd: '11-30', // ...through Cyber Monday (owner 2026-10-26)
  peakMultiplier: 10, // "it will probably sell like 10 a day" from 1 a day
  exclude: 'SILVER-?SHADOW|^A15-|T220', // set aside by the owner 2026-10-26
};

// the reorder settings, with the buy list's defaults filled in
function buySettings(reorder = {}) {
  const r = reorder || {};
  const num = (v, d) => (v === '' || v == null || !Number.isFinite(Number(v)) ? d : Number(v));
  return {
    minWeek: Math.max(0, num(r.buyMinWeek, DEFAULTS.minWeek)),
    peakName: String(r.peakName || DEFAULTS.peakName).trim() || DEFAULTS.peakName,
    peakStart: /^\d{2}-\d{2}$/.test(String(r.peakStart || '')) ? r.peakStart : DEFAULTS.peakStart,
    peakEnd: /^\d{2}-\d{2}$/.test(String(r.peakEnd || '')) ? r.peakEnd : DEFAULTS.peakEnd,
    peakMultiplier: Math.max(1, num(r.peakMultiplier, DEFAULTS.peakMultiplier)),
    exclude: r.buyExclude == null ? DEFAULTS.exclude : String(r.buyExclude),
  };
}

const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayCount = (a, b) => Math.round((midnight(b) - midnight(a)) / DAY_MS);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

// This year's peak against today: the normal-pace days before it and the
// peak days still ahead. Once it has passed (or before the year's dates
// make sense) the list falls back to the reorder target (lead + cover).
function peakWindow(now, s, targetDays) {
  const [sm, sd] = s.peakStart.split('-').map(Number);
  const [em, ed] = s.peakEnd.split('-').map(Number);
  const start = new Date(now.getFullYear(), sm - 1, sd);
  const end = new Date(now.getFullYear(), em - 1, ed);
  const today = midnight(now);
  if (end < start || today > end) {
    return { on: false, normalDays: targetDays, peakDays: 0, startLabel: '', endLabel: '' };
  }
  const normalDays = Math.max(0, dayCount(today, start) - 1); // tomorrow .. the day before the peak
  const peakDays = dayCount(today > start ? today : start, end) + 1;
  return { on: true, normalDays, peakDays, startLabel: label(start), endLabel: label(end) };
}

// rows: one per SKU sold in the last 60 days -
//   { sku, title, avail, atWfs, due, d14, d30, d60, padded, composite }
// opts: { now, leadDays, coverDays, reorder, isCondition(sku) }
function buildBuyPlan(rows, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const s = buySettings(opts.reorder);
  const target = (Number(opts.leadDays) || 7) + (Number(opts.coverDays) || 21);
  const win = peakWindow(now, s, target);
  let exclude = null;
  try { exclude = s.exclude.trim() ? new RegExp(s.exclude, 'i') : null; } catch { exclude = null; }
  const isCondition = typeof opts.isCondition === 'function' ? opts.isCondition : () => false;
  const out = { now: [], next: [], then: [] };
  const slow = [];
  for (const r of rows || []) {
    const sku = String(r.sku || '');
    if (!sku || r.composite || NOT_NEW.test(sku) || isCondition(sku) || (exclude && exclude.test(sku))) continue;
    // the best of the 14-, 30- and 60-day averages, so a stockout does not
    // drag the pace down
    const rate = Math.max((Number(r.d14) || 0) / 14, (Number(r.d30) || 0) / 30, (Number(r.d60) || 0) / 60);
    if (!(rate > 0)) continue;
    const left = Math.max(0, Number(r.avail) || 0) + Math.max(0, Number(r.atWfs) || 0);
    const due = Math.max(0, Number(r.due) || 0);
    const gap = Math.ceil(rate * (win.normalDays + win.peakDays * (win.on ? s.peakMultiplier : 0))) - left - due;
    const buy = gap > 0 ? Math.max(5, Math.ceil(gap / 5) * 5) : 0;
    if (!buy) continue; // stocked enough: off the list
    const week = rate * 7;
    const daysLeft = left / rate;
    const row = {
      sku, title: r.title || '', dropship: !!r.padded,
      week: week >= 10 ? Math.round(week) : Math.round(week * 10) / 10,
      left, due, buy, daysLeft: Math.floor(daysLeft),
    };
    Object.defineProperty(row, 'exact', { value: daysLeft }); // sorts on the unrounded days
    if (week < s.minWeek) { if (left <= 0) slow.push(row); continue; }
    if (left <= 0 || daysLeft <= BUY_NOW_DAYS) out.now.push(row);
    else if (daysLeft <= win.normalDays) out.next.push(row);
    else out.then.push(row);
  }
  // out of stock first (fastest sellers on top), then soonest out
  out.now.sort((a, b) => (a.left > 0) - (b.left > 0) || (a.left <= 0 ? b.week - a.week : a.exact - b.exact || b.week - a.week));
  out.next.sort((a, b) => a.exact - b.exact || b.week - a.week);
  out.then.sort((a, b) => a.exact - b.exact || b.week - a.week);
  slow.sort((a, b) => b.week - a.week);
  const sections = [
    { key: 'now', title: 'Buy now', why: `Out of stock, or out within ${BUY_NOW_DAYS / 7} weeks`, rows: out.now },
    { key: 'next', title: 'Buy next', why: win.on ? `Runs out before ${s.peakName} week starts (${win.startLabel})` : `Runs out within ${target} days`, rows: out.next },
    { key: 'then', title: 'Then', why: `Has stock today, but not enough for ${s.peakName} week`, rows: out.then },
  ].filter(sec => sec.rows.length || sec.key === 'now');
  let rank = 0;
  for (const sec of sections) for (const r of sec.rows) r.rank = ++rank;
  const listed = sections.flatMap(sec => sec.rows);
  return {
    sections, slow,
    skus: listed.length,
    units: listed.reduce((t, r) => t + r.buy, 0),
    settings: { ...s, targetDays: target, peakOn: win.on, normalDays: win.normalDays, peakDays: win.peakDays, peakStartLabel: win.startLabel, peakEndLabel: win.endLabel },
  };
}

module.exports = { buildBuyPlan, buySettings, peakWindow, DEFAULTS };
