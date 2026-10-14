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
    // 500 sells here; its refund lands in the next period's (old-format) report
    `"500","O500","SALE","${recent}","Tablet M","SKU-A","","100.00","96.00","Seller Fulfilled"`,
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
  check('recovery: ledger carries Refund rows mapped from REFUNDED', parsed.ledger.filter((t) => t.type === 'Refund').length === 12 && parsed.ledger.filter((t) => t.type === 'Sale').length === 3);

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
  const fakeSync = { enabled: () => false, stationName: () => 'TEST', appendAux: (p, e) => { auxLog.push([p, e]); return true; }, readAuxNew: () => [], auxBackfill: () => {}, auxEnsure: () => false, list: () => [] };
  const cfg = { recovery: { email: 'owner@example.com', webhookUrl: '' } };
  recovery.configure({
    retsync: fakeSync, listReturns: () => returns, config: { load: () => cfg, save: (p) => Object.assign(cfg.recovery, p.recovery || {}) },
    archiveDir: path.join(tmp, 'archive'), archiveDirs: () => [path.join(tmp, 'archive-before-sync')], station: 'TEST', by: 'IM',
    costs: () => ({ 'SKU-A': { cost: 70 }, 'INV-Z': { cost: 120 }, 'SKU-B': { cost: 0 } }), channelMap: () => new Map([['SKU-Z', 'INV-Z']]),
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
    check('recovery: a lost-after-delivery refund still outstanding counts as lost', st.items.find((i) => i.po === '010').lostAmount === 105.6 && st.items.find((i) => i.po === '011').lostAmount === 0);
    // on Profit a "lost" refund inside its window is pending, not costed
    // (owner 2026-10-14): give 010 a sold unit, read its line, put it back
    db.prepare("UPDATE wm_orders SET sku = 'SKU-A', sale_units = 1 WHERE run_id = ? AND po = '010'").run(res.id);
    const prL = recovery.profit('cycle', res.id);
    const l010 = prL.skus.flatMap((x) => x.lines || []).find((l) => l.po === '010');
    check('recovery: profit — a lost-reason refund still inside its window is pending, not charged', !!l010 && l010.pending === true && /pending/.test(l010.situation) && l010.tone === 'amber', l010);
    db.prepare("UPDATE wm_orders SET sku = 'SKU-J', sale_units = 0 WHERE run_id = ? AND po = '010'").run(res.id);

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
      `"06/01/2026","06/14/2026","Refund","Walmart Customer Care Refund","500","O500","${recent}","Tablet M","SKU-M","No Longer Wanted","-180.00","Product Price","1","Seller Fulfilled"`,
      `"06/01/2026","06/14/2026","Dispute Settlement","Dispute won","001","O1","${recent}","Tablet A","SKU-A","","30.00","Fee/Reimbursement","","Seller Fulfilled"`,
      `"06/01/2026","06/14/2026","Adjustment","Refund for unused label","003","O3","${recent}","Tablet C","SKU-C","","7.85","Fee/Reimbursement","","Seller Fulfilled"`,
      `"06/01/2026","06/14/2026","Adjustment","Walmart Shipping Label Service Charge","003","O3","${recent}","Tablet C","SKU-C","","11.97","Fee/Reimbursement","","Seller Fulfilled"`,
      `"06/01/2026","06/14/2026","Adjustment","Shipping Protection Claim Payout","011","O11","${recent}","Tablet K","SKU-K","","100.00","Fee/Reimbursement","","Walmart-fulfilled(WFS)"`,
      `"06/01/2026","06/14/2026","Instant Transfer","Funds paid out upon request","","","${recent}","","","","-5000.00","Net Payable","",""`,
    ].join('\n');
    const p2 = parseReport.parseReport(payoutCsv);
    check('recovery: old-format payouts — positive credit kept, negative label charge dropped', p2.payouts['010'] && p2.payouts['010'].amount === 120.5 && p2.payouts['010'].kind === 'dispute' && !('500' in p2.payouts), p2.payouts);
    check('recovery: an unused-label credit or a label-charge reversal is not a payout', !('003' in p2.payouts), p2.payouts);
    check('recovery: a shipping-protection claim payout is', p2.payouts['011'] && p2.payouts['011'].amount === 100 && p2.payouts['011'].kind === 'adjustment', p2.payouts);
    const res2 = await recovery.importReport({ name: 'old_format_reconciliationreport.csv', text: payoutCsv });
    check('recovery: old-format import labels from its Period columns', res2.ok === true && res2.label === 'Jun 1 - Jun 14, 2026', res2);
    // the same weeks under another name (owner 2026-10-14): a renamed download
    // whose Period columns run a day short is the period already imported —
    // it asks to replace, keeps the known label, and leaves no twin behind
    const renamed = payoutCsv.replace(/"06\/01\/2026","06\/14\/2026"/g, '"06/02/2026","06/13/2026"');
    const twinAsk = await recovery.importReport({ name: 'JUNE_1_-_14.csv', text: renamed });
    const runsBefore = recovery.state().runs.length;
    const twinDone = await recovery.importReport({ name: 'JUNE_1_-_14.csv', text: renamed, force: true });
    const runsAfter = recovery.state().runs.length;
    check('recovery: a renamed file covering the same weeks replaces that period under its known name', twinAsk.alreadyImported === true && twinAsk.label === 'Jun 1 - Jun 14, 2026' && twinDone.ok === true && twinDone.label === 'Jun 1 - Jun 14, 2026' && runsAfter === runsBefore, { twinAsk, twinDone: twinDone && twinDone.label, runsBefore, runsAfter });
    res2.id = twinDone.id; // the period's run id moved with the replacement
    // the owner's own expenses (v1.32.40): dated, taken off profit in their period, in the statement
    const ex = recovery.addExpense({ date: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`, amount: 12.5, category: 'Shipping labels', note: 'UPS' });
    const prx = recovery.profit('all');
    check('recovery: expenses — added, totalled and taken off profit', ex.ok && prx.expenses.count === 1 && prx.expenses.total === 12.5 && prx.netProfit === Math.round((prx.profit - 12.5) * 100) / 100 && recovery.statement('all').sections.some((s) => s.name === 'Your expenses' && s.total === -12.5), { ex, exp: prx.expenses, net: prx.netProfit, profit: prx.profit });
    check('recovery: expenses — a bad amount is refused', recovery.addExpense({ date: '2026-10-01', amount: 0 }).ok === false);
    const rmx = recovery.removeExpense(ex.id);
    check('recovery: expenses — removed everywhere', rmx.ok && recovery.profit('all').expenses.count === 0 && auxLog.some(([p, e]) => p === 'wmexpenses' && e.id === ex.id && e.removed), { rmx, log: auxLog.filter(([p]) => p === 'wmexpenses').length });
    // the statement as Walmart lays it out (v1.32.39)
    // a payout typed by hand (owner 2026-10-14): the row moves to Walmart paid, the gap is what is still lost, outside money reaches profit
    const beforePay = recovery.profit('all').profit;
    const pay = recovery.mark('006', 'paidOut', { amount: 50, by: 'Shipping protection', on: '2026-10-10' });
    const it006 = recovery.state().items.find((x) => x.po === '006');
    const afterPay = recovery.profit('all');
    check('recovery: paid out by hand — reimbursed with the gap, insurance money added to profit', pay.ok && it006 && it006.status === 'reimbursed' && it006.settlementSeen === 50 && /Shipping protection/.test(it006.settlementKind || '') && it006.lostAmount === Math.round((it006.amount - 50) * 100) / 100 && afterPay.recovered === 50 && Math.round((afterPay.profit - beforePay) * 100) / 100 >= 50 - 0.01, { pay, it006: it006 && { status: it006.status, seen: it006.settlementSeen, kind: it006.settlementKind, lost: it006.lostAmount, amount: it006.amount }, recovered: afterPay.recovered, d: afterPay.profit - beforePay });
    recovery.mark('006', 'undoPaidOut', {});
    const ss = recovery.syncStatus();
    check('recovery: sync status — answers with sync off, and resync is safe', ss.ok && ss.enabled === false && recovery.resync().ok, ss);
    const sts = recovery.statements();
    check('recovery: statements — one per imported period, newest first, each with its sections', sts.ok && sts.statements.length >= 2 && sts.statements[0].id === res2.id && sts.statements.every((x) => Array.isArray(x.sections) && typeof x.activity === 'number'), { n: sts.statements.length, first: sts.statements[0] && sts.statements[0].label });
    const stm = recovery.statement('cycle', res2.id);
    const secOf = (n) => stm.sections.find((s) => s.name === n);
    check('recovery: statement — refunds, adjustments and the transfer land in their sections', stm.ok && stm.hasLines && secOf('Refunds') && secOf('Refunds').lines.some((l) => l.label === 'Product price' && l.amount === -180 && l.by.length === 1 && l.by[0].label === 'Walmart Customer Care issued' && l.by[0].amount === -180) && secOf('Adjustments') && secOf('Adjustments').lines.some((l) => /Dispute/.test(l.label) && l.amount === 150.5) && secOf('Adjustments').lines.some((l) => /Label Service Charge/.test(l.label)) && stm.paid.length === 1 && stm.paid[0].amount === 5000, { sections: stm.sections, paid: stm.paid });
    returns = [...returns, mk('002', 200, 'Open Box', 6)];
    st = recovery.state();
    check('recovery: settlement money makes 010 reimbursed with the payout visible', st.items.find((i) => i.po === '010').status === 'reimbursed' && st.items.find((i) => i.po === '010').settlementSeen === 120.5);
    const k11 = st.items.find((i) => i.po === '011');
    check('recovery: a $100 claim on a $124.80 lost item = partial, the gap is lost', k11.status === 'reimbursed' && k11.lostAmount === 24.8 && /24\.80 lost/.test(k11.statusText.clause), k11 && [k11.status, k11.lostAmount, k11.statusText]);
    check('recovery: a PO logged in the Returns log leaves the list', !st.items.some((i) => i.po === '002'));
    check('recovery: 500 joins the tracker from the second period', st.items.some((i) => i.po === '500' && i.sourceRunId === res2.id));
    check('recovery: runs sorted newest period first', st.runs[0].label === 'Jun 1 - Jun 14, 2026');

    // summaries (§8)
    const all = recovery.summary('all');
    check('recovery: all-time refunds = 12 new-format rows + 1 old-format', all.returnsCount === 13 && all.reimbursed === 205.6 && all.loss === 96.8, all);
    check('recovery: dispute win on a received PO counted separately', all.disputeWinsCount === 1 && all.disputeWins === 30, all);
    const cyc = recovery.summary('cycle', res.id);
    check('recovery: this-period scope reads that run\'s own ledger', cyc.returnsCount === 12 && cyc.label === 'May 16 - May 30, 2026', cyc);
    check('recovery: month keys listed newest first', st.months.length >= 1 && /^\d{4}-\d{2}$/.test(st.months[0]));

    // profit: 001 sold and refunded but back in stock -> cost recovered; 100 via the channel map
    const pr = recovery.profit('cycle', res.id);
    const z = pr.skus.find((g) => g.sku === 'SKU-Z');
    const a = pr.skus.find((g) => g.sku === 'SKU-A');
    const b0 = pr.skus.find((g) => g.sku === 'SKU-B');
    check('recovery: profit — a $0 cost reads as no cost set, never as 100% margin', b0 && b0.costKnown === false && b0.profit === undefined || (b0 && !b0.costKnown), b0 && { known: b0.costKnown, cost: b0.unitCost });
    check('recovery: profit — SKU-Z costed through the channel map', z && z.payout === 192 && z.cogs === 120 && z.profit === 72 && z.margin === 37.5, z);
    check('recovery: profit — a refunded unit that came back recovers its cost', a && a.payout === -84 && a.unitsBack === 1 && a.cogs === 0 && a.lines.find((l) => l.po === '001').back, a);
    check('recovery: profit — orders without a cost are counted, not costed', pr.missing.orders === 10 && pr.missing.skus === 10 && pr.orders === 13, pr.missing);
    // 500 sold in this period, refunded in the next (owner 2026-10-12: the
    // standing is judged on the whole PO; the relief lands on the sale row)
    const l500 = a && a.lines.find((l) => l.po === '500');
    const pr2nd = recovery.profit('cycle', res2.id);
    check('recovery: profit — a refund posted in a later period goes home to the sale: one line, pending, not costed, at risk', l500 && l500.pending && l500.saleUnits === 1 && l500.refundUnits === 1 && l500.net === -84 && /in a later period/.test(l500.situation) && a.unitsPending === 1 && a.atRisk === 70, l500 && { l500, pend: a.unitsPending, risk: a.atRisk });
    check('recovery: profit — the later period no longer carries that refund', !pr2nd.skus.some((g) => g.lines.some((l) => l.po === '500')), pr2nd.skus.map((g) => g.lines.map((l) => l.po)));
    check('recovery: profit — the headline profit and margin leave uncosted payout out', pr.profit === Math.round((pr.costedPayout - pr.cogs) * 100) / 100 && Math.abs(pr.payout - pr.costedPayout - pr.missing.payout) < 0.01 && (pr.costedPayout <= 0 || pr.margin === Math.round((pr.profit / pr.costedPayout) * 1000) / 10), { profit: pr.profit, costed: pr.costedPayout, cogs: pr.cogs, missing: pr.missing.payout, margin: pr.margin });
    const gz = pr.groups.find((x) => x.sku === 'INV-Z'); const ga = pr.groups.find((x) => x.sku === 'SKU-A'); const gb = pr.groups.find((x) => x.sku === 'SKU-B');
    check('recovery: profit — listings grouped under their Linnworks SKU, unmapped ones on their own', gz && gz.mapped && gz.listings.length === 1 && gz.listings[0].sku === 'SKU-Z' && gz.payout === z.payout && gz.profit === z.profit && ga && ga.mapped && gb && !gb.mapped && z.inv === 'INV-Z', { gz, ga: ga && ga.mapped, gb: gb && gb.mapped, zinv: z && z.inv });
    check('recovery: profit — each SKU lists its POs with a situation', z && Array.isArray(z.lines) && z.lines.length === z.orders && z.lines.every((l) => l.po && l.situation && l.tone), z && z.lines);
    check('recovery: profit — goods price carried per order, commission unknown in the new layout', typeof pr.gross === 'number' && pr.gross > 0 && pr.commissionPct === null && z && z.avgPrice !== null, { gross: pr.gross, pct: pr.commissionPct, z });
    // the two Reconcile marks (v1.32.20)
    const m1 = rnr.applyMarker(null, 'receivedManual', { on: '2026-09-01' }, '2026-10-12T10:00:00.000Z');
    check('recovery: marks — received before the log carries the day it came back', m1.receivedManual && m1.receivedOn === '2026-09-01' && !m1.neverShipped, m1);
    const m2 = rnr.applyMarker(m1, 'neverShipped', {}, '2026-10-12T10:00:00.000Z');
    check('recovery: marks — never shipped clears received-before-the-log', m2.neverShipped && !m2.receivedManual && !m2.receivedOn, m2);
    check('recovery: marks — derived statuses', rnr.deriveStatus({ po: 'X', receivedManual: true }, new Set()) === 'received' && rnr.deriveStatus({ po: 'X', neverShipped: true }, new Set()) === 'never_shipped');
    const mf = recovery.markFile('PO Number,Date received\n003,09/02/2026\n007,\n999999999999999,\nabc,');
    check('recovery: markFile finds the PO column and matches the tracker', mf.ok && mf.found === 3 && mf.matched.length === 2 && mf.matched[0].on === '2026-09-02' && mf.unmatched.length === 1, mf);
    const mf2 = recovery.markFile('003\n007\n');
    check('recovery: markFile reads a headerless list', mf2.ok && mf2.found === 2 && mf2.matched.length === 2, mf2);
    const mm = recovery.markMany([{ po: '003', on: '2026-09-02' }], 'receivedManual', {});
    const st2 = recovery.state();
    const it2 = st2.items.find((i) => i.po === '003');
    check('recovery: a marked PO reads received before the log and stays visible for the Marked tab', mm.count === 1 && it2 && it2.status === 'received' && it2.receivedManual && it2.receivedOn === '2026-09-02', it2 && { status: it2.status, rm: it2.receivedManual, on: it2.receivedOn });
    recovery.mark('003', 'undoReceivedManual', {});
    check('recovery: profit workbook builds', recovery.profitWorkbook('all').buffer.readUInt32LE(0) === 0x04034b50);
    db.prepare('UPDATE wm_orders SET gross = NULL, commission = NULL').run();
    const pr2 = recovery.profit('all');
    check('recovery: profit — orders stored before v1.32.13 get their price back from the archived CSV', pr2.gross === pr.gross && pr2.gross > 0, { before: pr.gross, after: pr2.gross });
    // pending returns are not costed yet (owner 2026-10-12): 006 (WFS) was
    // refunded 5 days ago (Walmart's 90 days still running), 003 (seller) 60
    // days ago (window passed) — give both a sold unit of SKU-A ($70, goods
    // price $90) and see where the cost lands; 007 is written off above
    db.prepare("UPDATE wm_orders SET sku = 'SKU-A', sale_units = 1, gross = 90 WHERE run_id = ? AND po IN ('003', '006')").run(res.id);
    const pr3 = recovery.profit('cycle', res.id);
    const a3 = pr3.skus.find((g) => g.sku === 'SKU-A');
    const l6 = a3 && a3.lines.find((l) => l.po === '006'); const l3 = a3 && a3.lines.find((l) => l.po === '003');
    check('recovery: profit — a return inside its window is pending: not costed, carried at risk', a3 && a3.unitsPending === 2 && a3.atRisk === 140 && l6 && l6.pending && /pending/.test(l6.situation) && l6.tone === 'amber', a3 && { pend: a3.unitsPending, risk: a3.atRisk, l6 });
    check('recovery: profit — a return past its window is lost: costed', a3 && a3.unitsLost === 1 && a3.cogs === 70 && l3 && !l3.pending && /cost charged/.test(l3.situation) && l3.tone === 'red', a3 && { lost: a3.unitsLost, cogs: a3.cogs, l3 });
    // a refund of a sale before the first statement (owner 2026-10-14): 002
    // (refund only, pending, $192) is left out of profit, 010 (refund only,
    // paid back by Walmart → lost) is counted; the statement total carries both
    db.prepare("UPDATE wm_orders SET sku = 'SKU-A' WHERE run_id = ? AND po IN ('002', '010')").run(res.id);
    const pr3b = recovery.profit('cycle', res.id); const a3b = pr3b.skus.find((g) => g.sku === 'SKU-A');
    const l2o = a3b && a3b.lines.find((l) => l.po === '002'); const l10o = a3b && a3b.lines.find((l) => l.po === '010');
    check('recovery: profit — a pre-tracking refund is left out of profit while the unit is back or pending, counted once lost',
      l2o && l2o.notCounted === true && /sold before the first statement/.test(l2o.situation) && /not counted against profit/.test(l2o.situation) && l10o && l10o.notCounted === false && /· counted against profit/.test(l10o.situation)
      && pr3b.heldOut.amount === 192 && pr3b.heldOut.orders === 1 && pr3b.payout === pr3.payout && Math.abs(pr3b.payout - pr3b.costedPayout - pr3b.missing.payout + 192) < 0.01
      && a3b.heldOut === 192 && a3b.payout === Math.round((a3b.statementPayout + 192) * 100) / 100 && a3b.profit === Math.round((a3b.payout - a3b.cogs) * 100) / 100 && (a3b.margin === null || a3b.margin === Math.round((a3b.profit / a3b.payout) * 1000) / 10) && pr3b.profit === Math.round((pr3b.costedPayout - pr3b.cogs) * 100) / 100 && a3b.atRisk === 140 && pr3b.lostUnits === 1,
      { l2o, l10o, held: pr3b.heldOut, payout: pr3b.payout, costed: pr3b.costedPayout, miss: pr3b.missing.payout, a3: a3b && { payout: a3b.payout, cogs: a3b.cogs, profit: a3b.profit, heldOut: a3b.heldOut, risk: a3b.atRisk } });
    const per3b = pr3b.periods.find((x) => x.id === res.id);
    check('recovery: profit — the period trend leaves the same refund out', per3b && per3b.heldOut === 192 && per3b.profit === pr3b.profit, per3b);
    db.prepare("UPDATE wm_orders SET sku = 'SKU-B' WHERE run_id = ? AND po = '002'").run(res.id);
    db.prepare("UPDATE wm_orders SET sku = 'SKU-J' WHERE run_id = ? AND po = '010'").run(res.id);
    check('recovery: profit — the strip totals carry at risk and lost units', pr3.atRisk.amount === 140 && pr3.atRisk.units === 2 && pr3.lostUnits === 1 && pr3.atRisk.orders >= 1, pr3.atRisk);
    const per3 = pr3.periods.find((x) => x.id === res.id);
    check('recovery: profit — the period trend applies the same rule', per3 && per3.atRisk === 140 && per3.cogs === pr3.cogs && per3.heldOut === 0 && per3.profit === pr3.profit, per3);
    // a goods price known on some orders only: goods sold and avg price read
    // the priced orders, and the strip says how many are missing
    db.prepare("UPDATE wm_orders SET gross = NULL WHERE run_id = ? AND po = '100'").run(res.id);
    const pr4 = recovery.profit('cycle', res.id);
    check('recovery: profit — goods sold and avg price count priced orders only', pr4.priced.unpriced === 1 && pr4.priced.orders === 4 && pr4.gross === 380 && pr4.avgPrice === 95, { priced: pr4.priced, avg: pr4.avgPrice, gross: pr4.gross });
    // the archive moved folders (sync turned on after the import): the
    // price backfill still finds the statement in the earlier folder
    const archived = path.join(tmp, 'archive', 'Walmart_Report_May 16 - May 30, 2026.csv');
    const moved = path.join(tmp, 'archive-before-sync', 'Walmart_Report_May 16 - May 30, 2026.csv');
    fs.mkdirSync(path.dirname(moved), { recursive: true }); fs.renameSync(archived, moved);
    db.prepare('UPDATE wm_orders SET gross = NULL, commission = NULL WHERE run_id = ?').run(res.id);
    const pr5 = recovery.profit('cycle', res.id);
    check('recovery: profit — the price backfill reads an archive from the folder used before sync', pr5.gross > 0 && pr5.priced.unpriced === 0, { gross: pr5.gross, priced: pr5.priced });
    fs.renameSync(moved, archived);
    // exports
    check('recovery: audit workbook builds', recovery.auditWorkbook().readUInt32LE(0) === 0x04034b50);
    check('recovery: summary workbook builds', recovery.summaryWorkbook('all').buffer.readUInt32LE(0) === 0x04034b50);
    const csv = recovery.viewCsv(['010', '011']);
    check('recovery: view CSV keeps the PO as text and names the status', csv.split('\r\n').length === 3 && csv.includes('="010"') && csv.includes('Paid back in full'), csv);
    const dg = recovery.digest();
    check('recovery: digest picks WFS dispute-open and seller <=10 days only (none here)', dg === null, dg && dg.items);
    const mt = recovery.mailto();
    check('recovery: mailto lists the needs-action items (010 and 011 are paid back now)', mt.ok === true && mt.count === 1 && mt.mailto.startsWith('mailto:owner%40example.com?'), mt);

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
    // replacing a period in place (owner 2026-10-12: a re-imported period
    // read "no goods price"): the archive stays and the orders keep their price
    const replaced = await recovery.importReport({ name, text: csvText, force: true });
    const prR = recovery.profit('cycle', replaced.id);
    check('recovery: replacing a period keeps its archive and its goods price', replaced.ok && replaced.replaced && replaced.priced === true && fs.existsSync(path.join(tmp, 'archive', 'Walmart_Report_May 16 - May 30, 2026.csv')) && prR.gross > 0 && prR.priced.unpriced === 0, { replaced: replaced && [replaced.ok, replaced.replaced, replaced.priced, replaced.archived], gross: prR.gross, priced: prR.priced });

    // empty Returns log refuses the import
    returns = [];
    let refused = '';
    try { await recovery.importReport({ name: 'x_reconciliationreport.csv', text: csvText, force: true }); } catch (e) { refused = e.message; }
    check('recovery: empty Returns log refuses the import', /returns log is empty/i.test(refused), refused);

    db.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  })();
};
