'use strict';
// The Recovery fixture (spec docs/recovery/SPEC.md §11), ported from the
// Walmart app's smoke test: a synthetic new-format report and a Returns
// log, run through parse -> reconcile -> classify -> store -> tracker. The
// e2e suite calls run(check) with its own check(); `node -e` can call it
// with a console check too, since nothing here needs Electron.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

module.exports = function run(check) {
  const parseReport = require('./parseReport');
  const { findIssues, returnsToWarehouseRows } = require('./reconcile');
  const { classify, toSummary, buildRunWorkbook } = require('./classify');
  const { formatPeriod, periodFromReportName, parsePeriodLabel } = require('./period');
  const rnr = require('./rnr');
  const store = require('./store');
  const recovery = require('./index');

  const fmtDate = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  const today = new Date();
  const daysAgo = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  const recent = fmtDate(daysAgo(5));
  const old = fmtDate(daysAgo(60));

  const header = '"Walmart.com PO #","Walmart.com Order #","Transaction Type","Transaction Date Time","Partner Item name","Partner Item Id","Return Reason Description","Refunded Retail Sales","Payable to Partner from Sale","Fulfillment Type"';
  const rows = [
    `"001","O1","REFUNDED","${recent}","Tablet A","SKU-A","Defective","-100.00","-96.00","Seller Fulfilled"`,
    `"002","O2","REFUNDED","${recent}","Tablet B","SKU-B","No Longer Wanted","-200.00","-192.00","Seller Fulfilled"`,
    `"003","O3","REFUNDED","${old}","Tablet C","SKU-C","Defective","-150.00","-144.00","Seller Fulfilled"`,
    `"004","O4","REFUNDED","${recent}","Tablet D","SKU-D","Wrong Item","-120.00","-115.20","Seller Fulfilled"`,
    `"005","O5","REFUNDED","${recent}","Tablet E","SKU-E","Defective","-300.00","-288.00","Seller Fulfilled"`,
    `"006","O6","REFUNDED","${recent}","Tablet F","SKU-F","No Longer Wanted","-80.00","-76.80","Walmart-fulfilled(WFS)"`,
    `"007","O7","REFUNDED","${recent}","Tablet G","SKU-G","Defective","-50.00","-48.00","Seller Fulfilled"`,
    `"007","O7","REFUNDED","${recent}","Tablet G","SKU-G","Defective","-25.00","-24.00","Seller Fulfilled"`,
    `"008","O8","REFUNDED","${old}","Tablet H","SKU-H","No Longer Wanted","-90.00","-86.40","Walmart-fulfilled(WFS)"`,
    `"009","O9","REFUNDED","${recent}","Tablet I","SKU-I","Defective","-60.00","-57.60","Walmart-fulfilled(WFS)"`,
    `"010","O10","REFUNDED","${recent}","Tablet J","SKU-J","Lost After Delivery","-110.00","-105.60","Seller Fulfilled"`,
    `"011","O11","REFUNDED","${recent}","Tablet K","SKU-K","Lost in Transit","-130.00","-124.80","Walmart-fulfilled(WFS)"`,
    `"001","O1","SALE","${recent}","Tablet A","SKU-A","","100.00","96.00","Seller Fulfilled"`,
    `"100","O100","SALE","${recent}","Tablet Z","SKU-Z","","200.00","192.00","Seller Fulfilled"`,
  ];
  const csvText = '﻿' + [header, ...rows].join('\r\n') + '\r\n';

  // the Returns log: 001 once ($100), 004 twice (one with a trailing space),
  // 005 once ($250, Damaged), 009 once
  const mk = (po, price, condition, i) => ({ id: i, created_at: new Date(Date.now() - (10 - i) * 60000).toISOString(), order_number: po, items: [{ sku: 'X', condition, qty: 1, price }], unmatched: false });
  let returns = [mk('001', 100, 'Open Box', 1), mk('004', 120, 'New / Sealed', 2), mk('004 ', null, '', 3), mk('005', 250, 'Damaged', 4), mk('009', 60, 'Open Box', 5)];

  // ----- parse -----
  const parsed = parseReport.parseReport(csvText);
  check('recovery: new format detected, BOM stripped', parsed.format === 'new' && parsed.columns[0] === 'Walmart.com PO #', parsed.columns[0]);
  check('recovery: 11 unique refunded POs', parsed.refunds.length === 11, parsed.refunds.length);
  const po7 = parsed.refunds.find((r) => r['PO #'] === '007');
  check('recovery: split refund summed and sign-flipped', po7 && po7['Refunded Retail Sales'] === 75 && po7['Net Refund (Payable Impact)'] === 72, po7);
  check('recovery: period fallback = min/max refund date', parsed.period.start.getTime() === daysAgo(60).getTime() && parsed.period.end.getTime() === daysAgo(5).getTime());
  check('recovery: cross-year label', formatPeriod(new Date(2025, 11, 28), new Date(2026, 0, 5)) === 'Dec 28, 2025 - Jan 5, 2026');
  const fromName = periodFromReportName('Digital_World_Shop_10001467995_MP_06022026_reconciliationreport.csv');
  check('recovery: filename payment date -> paid-17..paid-3', formatPeriod(fromName.start, fromName.end) === 'May 16 - May 30, 2026', fromName);
  const pl = parsePeriodLabel('Dec 28, 2025 - Jan 5, 2026');
  check('recovery: label parses back to dates', pl.start.getFullYear() === 2025 && pl.end.getMonth() === 0 && pl.end.getDate() === 5, pl);
  check('recovery: ledger carries Refund rows mapped from REFUNDED', parsed.ledger.filter((t) => t.type === 'Refund').length === 12 && parsed.ledger.filter((t) => t.type === 'Sale').length === 2);

  // ----- reconcile -----
  const warehouse = returnsToWarehouseRows(returns);
  check('recovery: 5 warehouse rows from 5 log records', warehouse.length === 5, warehouse.length);
  const { seller, wfs } = findIssues(parsed.refunds, warehouse);
  check('recovery: 7 seller / 4 WFS', seller.length === 7 && wfs.length === 4);
  const sIss = Object.fromEntries(seller.map((r) => [r['PO #'], r.Issues]));
  const wIss = Object.fromEntries(wfs.map((r) => [r['PO #'], r.Issues]));
  check('recovery: seller issues per spec §11',
    sIss['001'] === 'OK' && sIss['002'] === 'MISSING' && sIss['003'] === 'MISSING, AGED' && sIss['004'] === 'DUPLICATE'
      && sIss['005'] === 'PRICE_MISMATCH' && sIss['007'] === 'MISSING' && sIss['010'] === 'LOST', sIss);
  check('recovery: WFS issues per spec §11', wIss['006'] === 'WFS_PENDING' && wIss['008'] === 'WFS_OVERDUE' && wIss['009'] === 'RECEIVED' && wIss['011'] === 'LOST', wIss);
  check('recovery: condition carried through', seller.find((r) => r['PO #'] === '005')['Warehouse Condition'] === 'Damaged');

  // ----- classify -----
  const { rows: brows, counts } = classify(seller, wfs);
  check('recovery: fine-grained counts', counts.lost.count === 2 && counts.agedMissing.count === 1 && counts.missing.count === 2 && counts.duplicates.count === 1
    && counts.mismatches.count === 1 && counts.wfsOverdue.count === 1 && counts.wfsPending.count === 1, counts);
  check('recovery: owner buckets 4 / 5 / 2, act now 3', counts.received.count === 4 && counts.notReceived.count === 5 && counts.wfsWaiting.count === 2 && counts.actionNow.count === 3, counts);
  const summary = toSummary(brows);
  check('recovery: summary rows carry Status/Action, no Issues', summary.notReceived.every((r) => typeof r['PO #'] === 'string' && r.Status && r.Action && !('Issues' in r)));
  check('recovery: not received sorted lost -> aged -> recent, biggest first',
    summary.notReceived.map((r) => r['PO #']).join(',') === '011,010,003,002,007', summary.notReceived.map((r) => r['PO #']));
  const wbBuf = buildRunWorkbook(summary, 'TEST');
  check('recovery: period workbook builds (zip signature)', Buffer.isBuffer(wbBuf) && wbBuf.length > 2000 && wbBuf.readUInt32LE(0) === 0x04034b50, wbBuf.length);

  // ----- store + orchestration on a throwaway db -----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-selftest-'));
  const db = new DatabaseSync(path.join(tmp, 'test.db'));
  store.ensureSchema(db);
  const auxLog = [];
  const fakeSync = { enabled: () => false, stationName: () => 'TEST', appendAux: (p, e) => { auxLog.push([p, e]); return true; }, readAuxNew: () => [], auxBackfill: () => {}, list: () => [] };
  const cfg = { recovery: { email: 'owner@example.com', webhookUrl: '' } };
  recovery.configure({
    retsync: fakeSync, listReturns: () => returns, config: { load: () => cfg, save: (p) => Object.assign(cfg.recovery, p.recovery || {}) },
    archiveDir: path.join(tmp, 'archive'), station: 'TEST', by: 'IM',
  });

  return (async () => {
    const progress = [];
    const name = 'Digital_World_Shop_10001467995_MP_06022026_reconciliationreport.csv';
    const res = await recovery.importReport({ name, text: csvText }, (t) => progress.push(t));
    check('recovery: import ok with the filename period label', res.ok === true && res.label === 'May 16 - May 30, 2026' && res.totalRefunds === 11, res);
    check('recovery: progress text in order', progress.length === 3 && /^Reading/.test(progress[0]) && /Found 11 refunded POs \(new format\)/.test(progress[1]) && /^Summarizing/.test(progress[2]), progress);
    check('recovery: original CSV archived per period', fs.existsSync(path.join(tmp, 'archive', 'Walmart_Report_May 16 - May 30, 2026.csv')));
    check('recovery: a wmruns put event went to the shared folder', auxLog.some(([p, e]) => p === 'wmruns' && e.op === 'put' && e.refunds.length === 11));

    const dup = await recovery.importReport({ name, text: csvText });
    check('recovery: duplicate guard — same file', dup.alreadyImported === true && dup.sameFile === true && dup.label === 'May 16 - May 30, 2026', dup);
    const dup2 = await recovery.importReport({ name, text: csvText + '\r\n' });
    check('recovery: duplicate guard — same period, different file', dup2.alreadyImported === true && dup2.sameFile === false, dup2);

    let st = recovery.state();
    check('recovery: state lists the run with its counts', st.runs.length === 1 && st.runs[0].counts.notReceived.count === 5 && st.runs[0].open === 7, st.runs[0] && st.runs[0].counts);
    check('recovery: tracker holds every not-received PO (missing + lost + WFS waiting)',
      st.items.map((i) => i.po).sort().join(',') === '002,003,006,007,008,010,011', st.items.map((i) => i.po));
    const by = Object.fromEntries(st.items.map((i) => [i.po, i]));
    check('recovery: lost items need action immediately', by['010'].needsAction === true && by['011'].needsAction === true && by['011'].type === 'WFS');
    check('recovery: seller inside the 45-day window, not yet urgent', by['002'].daysLeft === 40 && by['002'].needsAction === false && by['002'].status === 'outstanding', by['002']);
    check('recovery: seller past 45 days = window closed', by['003'].windowClosed === true && by['003'].needsAction === true && by['003'].daysLeft === -15, by['003']);
    check('recovery: WFS inside 90 days waits', by['006'].wfsWaiting === true && by['006'].daysLeft === 85 && by['006'].needsAction === false, by['006']);
    check('recovery: sort = needs action first, then oldest refund', st.items[0].needsAction && st.items.findIndex((i) => !i.needsAction) > st.items.filter((i) => i.needsAction).length - 1);
    check('recovery: Today card counts', st.today.toFile.count === 3 && st.today.waiting.count === 4 && st.today.cases.count === 0, st.today);

    // status sentences (§6.6)
    check('recovery: status sentence — lost', rnr.statusText(by['010']).lead === 'Lost' && rnr.statusText(by['010']).clause === 'file now' && rnr.statusText(by['010']).tone === 'red');
    check('recovery: status sentence — WFS waiting', rnr.statusText(by['006']).lead === 'Walmart pays back by day 90' && rnr.statusText(by['006']).clause === '85 to go');
    check('recovery: status sentence — window closed', rnr.statusText(by['003']).lead === 'Window closed 15 days ago' && rnr.statusText(by['003']).tone === 'grey');
    check('recovery: status sentence — seller countdown', rnr.statusText(by['002']).lead === '40 days left to file' && rnr.statusText(by['002']).tone === 'amber');
    check('recovery: what-to-do sentence for a stored row', rnr.whatToDo(summary.notReceived[0]).lead === 'Open a case now' && rnr.whatToDo(summary.notReceived[2]).lead === 'Open a dispute now');

    // markers
    recovery.mark('002', 'case', { caseId: 'WM-1' });
    st = recovery.state();
    const c2 = st.items.find((i) => i.po === '002');
    check('recovery: open case leaves the to-do list and keeps its id', c2.caseOpened === true && c2.caseId === 'WM-1' && rnr.filterOf(c2) === 'cases' && c2.needsAction === false, c2);
    check('recovery: a wmmarks event went to the shared folder', auxLog.some(([p, e]) => p === 'wmmarks' && e.po === '002' && e.caseOpened === true));
    recovery.mark('002', 'adjustment');
    check('recovery: adjustment clears the case (mutually exclusive)', (() => { const i = recovery.state().items.find((x) => x.po === '002'); return i.adjustment && !i.caseOpened && !i.caseId && rnr.filterOf(i) === 'adjustments'; })());
    recovery.mark('002', 'undoAdjustment');
    recovery.mark('007', 'writeOff');
    recovery.mark('008', 'pending');
    st = recovery.state();
    check('recovery: write off -> loss, pending -> reimbursed_pending', st.items.find((i) => i.po === '007').status === 'loss' && st.items.find((i) => i.po === '008').status === 'reimbursed_pending');
    check('recovery: a written-off PO stays only in the Lost tab', rnr.filterOf(st.items.find((i) => i.po === '007')) === 'lost');
    recovery.mark('010', 'note', { note: 'called rep' });
    check('recovery: note pinned', recovery.state().items.find((i) => i.po === '010').note === 'called rep');

    // a payout in a later period makes 010 reimbursed; marking 002 received clears it
    const payoutCsv = [
      '"Period Start Date","Period End Date","Transaction Type","Transaction Description","Purchase Order #","Customer Order #","Transaction Posted Timestamp","Partner Item Name","Partner Item Id","Transaction Reason Description","Amount","Amount Type","Ship Qty","Fulfillment Type"',
      `"06/01/2026","06/14/2026","Dispute Settlement","Dispute won","010","O10","${recent}","Tablet J","SKU-J","","120.50","Fee/Reimbursement","","Seller Fulfilled"`,
      `"06/01/2026","06/14/2026","Adjustment","Walmart Shipping Label Service Charge","010","O10","${recent}","Tablet J","SKU-J","","-11.12","Fee/Reimbursement","","Seller Fulfilled"`,
      `"06/01/2026","06/14/2026","Refund","","500","O500","${recent}","Tablet M","SKU-M","No Longer Wanted","-180.00","Product Price","1","Seller Fulfilled"`,
      `"06/01/2026","06/14/2026","Dispute Settlement","Dispute won","001","O1","${recent}","Tablet A","SKU-A","","30.00","Fee/Reimbursement","","Seller Fulfilled"`,
    ].join('\n');
    const p2 = parseReport.parseReport(payoutCsv);
    check('recovery: old-format payouts — positive credit kept, negative label charge dropped', p2.payouts['010'] && p2.payouts['010'].amount === 120.5 && p2.payouts['010'].kind === 'dispute' && !('500' in p2.payouts), p2.payouts);
    const res2 = await recovery.importReport({ name: 'old_format_reconciliationreport.csv', text: payoutCsv });
    check('recovery: old-format import labels from its Period columns', res2.ok === true && res2.label === 'Jun 1 - Jun 14, 2026', res2);
    returns = [...returns, mk('002', 200, 'Open Box', 6)];
    st = recovery.state();
    check('recovery: settlement money makes 010 reimbursed with the payout visible', st.items.find((i) => i.po === '010').status === 'reimbursed' && st.items.find((i) => i.po === '010').settlementSeen === 120.5);
    check('recovery: a PO logged in the Returns log leaves the list', !st.items.some((i) => i.po === '002'));
    check('recovery: 500 joins the tracker from the second period', st.items.some((i) => i.po === '500' && i.sourceRunId === res2.id));
    check('recovery: runs sorted newest period first', st.runs[0].label === 'Jun 1 - Jun 14, 2026');

    // summaries (§8)
    const all = recovery.summary('all');
    check('recovery: all-time refunds = 12 new-format rows + 1 old-format', all.returnsCount === 13 && all.reimbursed === 105.6 && all.loss === 72, all);
    check('recovery: dispute win on a received PO counted separately', all.disputeWinsCount === 1 && all.disputeWins === 30, all);
    const cyc = recovery.summary('cycle', res.id);
    check('recovery: this-period scope reads that run\'s own ledger', cyc.returnsCount === 12 && cyc.label === 'May 16 - May 30, 2026', cyc);
    check('recovery: month keys listed newest first', st.months.length >= 1 && /^\d{4}-\d{2}$/.test(st.months[0]));

    // exports
    check('recovery: audit workbook builds', recovery.auditWorkbook().readUInt32LE(0) === 0x04034b50);
    check('recovery: summary workbook builds', recovery.summaryWorkbook('all').buffer.readUInt32LE(0) === 0x04034b50);
    const csv = recovery.viewCsv(['010', '011']);
    check('recovery: view CSV keeps the PO as text and names the status', csv.split('\r\n').length === 3 && csv.includes('="010"') && csv.includes('Paid back in full'), csv);
    const dg = recovery.digest();
    check('recovery: digest picks WFS dispute-open and seller <=10 days only (none here)', dg === null, dg && dg.items);
    const mt = recovery.mailto();
    check('recovery: mailto lists the needs-action items (010 is paid back now)', mt.ok === true && mt.count === 2 && mt.mailto.startsWith('mailto:owner%40example.com?'), mt);

    // sync apply: a put from another desktop lands with its items; an older
    // copy after a delete does not resurrect the run
    const ev = { op: 'put', id: 'remote-1', ts: Date.now() - 5000, run: { id: 'remote-1', label: 'Jul 1 - Jul 14, 2026', ranAt: new Date().toISOString(), csvName: 'r.csv', csvHash: 'h', format: 'new', totalRefunds: 1, sellerCount: 1, wfsCount: 0, logRows: 5, counts: {}, summary: {}, station: 'OTHER', by: '' },
      refunds: [{ po: '777', order_no: 'O777', item: 'Tablet R', sku: 'SKU-R', qty: 1, refund_date: recent, retail: 50, net: 48, reason: 'Defective', fulfillment: 'Seller Fulfilled', issues: 'MISSING', wh_count: 0 }], payouts: [], ledger: [] };
    recovery._internal.applyRunEvent(ev);
    check('recovery: a synced run adds its tracker items', recovery.state().items.some((i) => i.po === '777'));
    recovery._internal.applyRunEvent({ op: 'del', id: 'remote-1', ts: Date.now() });
    recovery._internal.applyRunEvent(ev);
    check('recovery: a late older put cannot resurrect a deleted run', !recovery.state().runs.some((r) => r.id === 'remote-1') && !recovery.state().items.some((i) => i.po === '777'));

    // delete the first run: its items go, its markers stay for a re-import
    const del = recovery.removeRun(res.id);
    st = recovery.state();
    check('recovery: deleting a run removes its tracker items', del.ok && !st.items.some((i) => i.sourceRunId === res.id) && st.runs.length === 1, st.items.map((i) => i.po));
    check('recovery: archived CSV removed with the run', !fs.existsSync(path.join(tmp, 'archive', 'Walmart_Report_May 16 - May 30, 2026.csv')));
    const again = await recovery.importReport({ name, text: csvText });
    check('recovery: re-import keeps earlier markers (note on 010, write-off on 007)', again.ok && recovery.state().items.find((i) => i.po === '010').note === 'called rep' && recovery.state().items.find((i) => i.po === '007').status === 'loss');

    // empty Returns log refuses the import
    returns = [];
    let refused = '';
    try { await recovery.importReport({ name: 'x_reconciliationreport.csv', text: csvText, force: true }); } catch (e) { refused = e.message; }
    check('recovery: empty Returns log refuses the import', /returns log is empty/i.test(refused), refused);

    db.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  })();
};
