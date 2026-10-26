// Returns Log: a readable, always-current Google Sheet of returns-log.csv
// (owner 2026-10-26: "the structure for it looks weird"). DWS Stock keeps
// rewriting returns-log.csv in the shared returns-sync folder; this script,
// bound to a Sheet in that same folder, redraws two tabs from it every 15
// minutes: Returns (one row per returned item, newest first) and Summary.
//
// Install once: open the Sheet > Extensions > Apps Script, paste this file
// over Code.gs, save, pick "setup" in the function list, press Run and allow
// the access it asks for. The Returns menu in the Sheet has Refresh now.
// The CSV stays the source of truth: edits made in the Sheet are redrawn.

const CSV_NAME = 'returns-log.csv';
const TZ = 'America/New_York';
const REFRESH_MINUTES = 15;

const CONDITION = { new: 'New', openbox: 'Open Box', used: 'Used', scrap: 'Scrap' };
const CHANNEL = { WALMART: 'Walmart', EBAY: 'eBay', 'TEMU US': 'Temu', TEMU: 'Temu' };

const COLUMNS = [
  // [header, width px, kind]
  ['Date', 150, 'date'],
  ['Order #', 140, 'text'],
  ['Channel', 80, 'text'],
  ['Customer', 170, 'text'],
  ['Tracking', 170, 'text'],
  ['SKU returned', 210, 'text'],
  ['Condition', 90, 'text'],
  ['Restocked as', 230, 'text'],
  ['Qty', 50, 'int'],
  ['Price', 85, 'money'],
  ['Value', 90, 'money'],
  ['Received by', 90, 'text'],
  ['Station', 150, 'text'],
  ['Last edited on', 150, 'text'],
  ['Notes', 220, 'text'],
  ['Check', 140, 'text'],
];

/* ---------- entry points ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Returns').addItem('Refresh now', 'refreshNow').addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'refresh') ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger('refresh').timeBased().everyMinutes(REFRESH_MINUTES).create();
  refreshNow();
}

function refreshNow() { refresh_(true); }
function refresh() { refresh_(false); }

/* ---------- the redraw ---------- */

function refresh_(force) {
  const ss = SpreadsheetApp.getActive();
  const file = findCsv_(ss);
  const stamp = String(file.getLastUpdated().getTime());
  const props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty('csvStamp') === stamp) return; // nothing new since the last pass

  const text = file.getBlob().getDataAsString('UTF-8').replace(/^﻿/, '');
  const rows = buildRows_(Utilities.parseCsv(text));
  drawReturns_(ss, rows);
  drawSummary_(ss, rows, file.getLastUpdated());
  props.setProperty('csvStamp', stamp);
}

// returns-log.csv beside this Sheet (the newest copy, should the sync
// service ever leave a duplicate behind)
function findCsv_(ss) {
  let best = null;
  const parents = DriveApp.getFileById(ss.getId()).getParents();
  while (parents.hasNext()) {
    const files = parents.next().getFilesByName(CSV_NAME);
    while (files.hasNext()) {
      const f = files.next();
      if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
    }
  }
  if (!best) throw new Error(`No ${CSV_NAME} in this Sheet's folder - keep the Sheet in returns-sync.`);
  return best;
}

// CSV grid -> one object per returned item, newest first. Columns are found
// by name, so a new column in the app's export does not break the sheet.
function buildRows_(grid) {
  if (!grid.length) return [];
  const head = grid[0].map(h => String(h).trim().toLowerCase());
  const at = (r, name) => { const i = head.indexOf(name); return i < 0 ? '' : String(r[i] == null ? '' : r[i]).trim(); };
  const out = [];
  for (const r of grid.slice(1)) {
    const when = new Date(at(r, 'date'));
    if (isNaN(when)) continue; // blank or torn line
    const qty = Number(at(r, 'qty'));
    const price = Number(at(r, 'price'));
    const cond = at(r, 'condition').toLowerCase();
    const source = at(r, 'source').toUpperCase();
    const sku = at(r, 'sku');
    out.push({
      when,
      order: at(r, 'order_number'),
      channel: CHANNEL[source] || (source ? source.charAt(0) + source.slice(1).toLowerCase() : ''),
      customer: at(r, 'customer'),
      tracking: at(r, 'tracking'),
      sku,
      condition: CONDITION[cond] || cond,
      target: at(r, 'target_sku'),
      qty: qty > 0 ? qty : '',
      price: price > 0 ? price : '',
      value: qty > 0 && price > 0 ? Math.round(qty * price * 100) / 100 : '',
      by: at(r, 'received_by'),
      station: at(r, 'station'),
      edited: at(r, 'last_edit_station'),
      note: at(r, 'note'),
      check: at(r, 'unmatched').toLowerCase() === 'yes' ? '⚠ No order match' : (!sku ? '⚠ No SKU' : ''),
    });
  }
  return out.sort((a, b) => b.when - a.when);
}

function rowValues_(r) {
  return [r.when, r.order, r.channel, r.customer, r.tracking, r.sku, r.condition, r.target,
    r.qty, r.price, r.value, r.by, r.station, r.edited, r.note, r.check];
}

function drawReturns_(ss, rows) {
  const sh = sheet_(ss, 'Returns', 0);
  const n = COLUMNS.length;
  const total = rows.length + 1;
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getBandings().forEach(b => b.remove());
  sh.clear();
  fit_(sh, total, n);

  // text columns first, so order and tracking numbers stay digits (not 1.29E+14)
  COLUMNS.forEach(([, w, kind], i) => {
    sh.setColumnWidth(i + 1, w);
    const col = sh.getRange(1, i + 1, total, 1);
    if (kind === 'text') col.setNumberFormat('@');
    if (kind === 'date') col.setNumberFormat('mmm d, yyyy  h:mm am/pm');
    if (kind === 'money') col.setNumberFormat('$#,##0.00');
    if (kind === 'int') col.setNumberFormat('0');
    if (kind !== 'text') col.setHorizontalAlignment('right');
  });
  sh.getRange(1, 1, 1, n).setValues([COLUMNS.map(c => c[0])])
    .setFontWeight('bold').setFontColor('#ffffff').setVerticalAlignment('middle');
  sh.setRowHeight(1, 30);
  if (rows.length) sh.getRange(2, 1, rows.length, n).setValues(rows.map(rowValues_));

  const all = sh.getRange(1, 1, total, n);
  all.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor('#1f3a5f').setFirstRowColor('#ffffff').setSecondRowColor('#f4f6f9');
  all.createFilter();
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);

  const condCol = sh.getRange(2, 7, Math.max(1, rows.length), 1);
  const checkCol = sh.getRange(2, n, Math.max(1, rows.length), 1);
  const chip = (text, bg, fg) => SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text)
    .setBackground(bg).setFontColor(fg).setBold(true).setRanges([condCol]).build();
  sh.setConditionalFormatRules([
    chip('New', '#d9f2e3', '#1e6b3a'),
    chip('Open Box', '#dbe8fb', '#1d4f91'),
    chip('Used', '#fdf0c8', '#8a6200'),
    chip('Scrap', '#f9d9d6', '#a12a1f'),
    SpreadsheetApp.newConditionalFormatRule().whenCellNotEmpty()
      .setBackground('#fde7cf').setFontColor('#9a4b00').setBold(true).setRanges([checkCol]).build(),
  ]);
}

/* ---------- summary ---------- */

// Monday of the item's week, in New York
function weekOf_(d) {
  const dow = Number(Utilities.formatDate(d, TZ, 'u')); // 1 = Monday .. 7 = Sunday
  return Utilities.formatDate(new Date(d.getTime() - (dow - 1) * 86400000), TZ, 'yyyy-MM-dd');
}

function summarize_(rows, now) {
  const units = (rs) => rs.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const value = (rs) => Math.round(rs.reduce((s, r) => s + (Number(r.value) || 0), 0) * 100) / 100;
  const recent = rows.filter(r => now - r.when <= 30 * 86400000);
  const group = (rs, key) => {
    const m = {};
    for (const r of rs) { const k = key(r) || 'Not recorded'; (m[k] = m[k] || []).push(r); }
    return Object.keys(m).map(k => [k, m[k]]);
  };
  const weeks = group(rows, r => weekOf_(r.when)).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 12);
  return {
    totals: [
      ['Last 30 days', recent.length, units(recent), value(recent), recent.filter(r => r.check).length],
      ['All time', rows.length, units(rows), value(rows), rows.filter(r => r.check).length],
    ],
    weeks: weeks.map(([k, rs]) => [k, rs.length, units(rs), value(rs)]),
    channels: group(recent, r => r.channel).map(([k, rs]) => [k, units(rs), value(rs)]).sort((a, b) => b[1] - a[1]),
    conditions: group(recent, r => r.condition).map(([k, rs]) => [k, units(rs), value(rs)]).sort((a, b) => b[1] - a[1]),
    skus: group(recent.filter(r => r.sku), r => r.sku).map(([k, rs]) => [k, units(rs), value(rs)]).sort((a, b) => b[1] - a[1]).slice(0, 15),
  };
}

function drawSummary_(ss, rows, csvUpdated) {
  const sh = sheet_(ss, 'Summary', 1);
  sh.clear();
  sh.setConditionalFormatRules([]);
  const s = summarize_(rows, new Date());
  const updated = Utilities.formatDate(csvUpdated, TZ, "MMM d, yyyy 'at' h:mm a");
  sh.getRange('A1').setValue('Returns summary').setFontSize(16).setFontWeight('bold');
  sh.getRange('A2').setValue(`From returns-log.csv, last changed ${updated} (Eastern). Redrawn every ${REFRESH_MINUTES} minutes.`).setFontColor('#6b7280');

  let row = 4;
  const block = (title, head, data, money) => {
    sh.getRange(row, 1).setValue(title).setFontWeight('bold').setFontSize(12);
    row++;
    sh.getRange(row, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#e8edf4');
    if (data.length) {
      const r = sh.getRange(row + 1, 1, data.length, head.length).setValues(data);
      for (const c of money) sh.getRange(row + 1, c, data.length, 1).setNumberFormat('$#,##0.00');
      r.setHorizontalAlignment('left');
    } else {
      sh.getRange(row + 1, 1).setValue('None').setFontColor('#6b7280');
    }
    row += Math.max(1, data.length) + 2;
  };
  block('Totals', ['Period', 'Returns', 'Units', 'Value', 'Need checking'], s.totals, [4]);
  block('By week (week starting Monday)', ['Week of', 'Returns', 'Units', 'Value'], s.weeks, [4]);
  block('By channel, last 30 days', ['Channel', 'Units', 'Value'], s.channels, [3]);
  block('By condition, last 30 days', ['Condition', 'Units', 'Value'], s.conditions, [3]);
  block('Most returned SKUs, last 30 days', ['SKU', 'Units', 'Value'], s.skus, [3]);
  sh.setColumnWidth(1, 230);
  for (let c = 2; c <= 5; c++) sh.setColumnWidth(c, 110);
}

/* ---------- helpers ---------- */

function sheet_(ss, name, index) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    // the first run takes over the blank tab a new Sheet starts with
    const blank = ss.getSheets().find(x => x.getLastRow() <= 1 && !['Returns', 'Summary'].includes(x.getName()));
    sh = blank ? blank.setName(name) : ss.insertSheet(name);
  }
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(index + 1);
  return sh;
}

// exactly `rows` x `cols`, so no stale rows linger under a shorter log
function fit_(sh, rows, cols) {
  const r = sh.getMaxRows(), c = sh.getMaxColumns();
  if (r < rows) sh.insertRowsAfter(r, rows - r);
  else if (r > rows + 1) sh.deleteRows(rows + 2, r - rows - 1);
  if (c < cols) sh.insertColumnsAfter(c, cols - c);
  else if (c > cols) sh.deleteColumns(cols + 1, c - cols);
}
