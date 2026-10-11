'use strict';
// Returns not received — the pure half of the Walmart app's rnrStore.js and
// core.js (spec docs/recovery/SPEC.md §6–§9): status derivation, the
// dispute-window decoration, case markers, the summary math, the status
// sentences, exports and the dispute digest. No I/O here: everything takes
// rows and returns rows, so the store and the e2e checks share one brain.
const crypto = require('node:crypto');
const { parseRefundDate, toIsoDay } = require('./parseReport');
const { isLostReason } = require('./reconcile');
const { buildWorkbookSheets } = require('../xlsxwrite');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Two very different Walmart timelines by fulfillment type:
//  - Seller-fulfilled: you must FILE a dispute within 45 days of the refund.
//  - WFS: a not-received return AUTO-reimburses within ~90 days; a dispute
//    window of 45 days opens after that (hard deadline 135 d).
const SELLER_DISPUTE_DAYS = 45;
const WFS_REIMBURSE_DAYS = 90;
const FILE_WINDOW_DAYS = 45;
const WFS_DEADLINE = WFS_REIMBURSE_DAYS + FILE_WINDOW_DAYS; // 135
const FILE_SOON_DAYS = 10;

const typeOf = (fulfillment) => (/wfs|walmart-fulfilled/i.test(String(fulfillment || '')) ? 'WFS' : 'Seller');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// a tracker item from a classified refund row (§6.1)
function itemFromRow(r, sourceRunId, nowIso) {
  return {
    po: String(r['PO #'] || '').trim(),
    order: r['Order #'] || '',
    item: r.Item || '',
    sku: r.SKU || '',
    qty: Number(r.Qty) || 0,
    refundDate: r['Refund Date'] || '',
    amount: r2(r['Net Refund (Payable Impact)'] || 0),
    reason: r['Return Reason'] || '',
    lost: isLostReason(r),
    type: typeOf(r['Fulfillment Type']),
    sourceRunId: sourceRunId || null,
    addedAt: nowIso || new Date().toISOString(),
  };
}

// which classified rows join the tracker: WFS rows with no warehouse count
// (pending, overdue or lost) and seller rows tagged MISSING or LOST
function trackerRows(seller, wfs) {
  const hasToken = (r, t) => String(r.Issues || '').split(', ').includes(t);
  return [
    ...wfs.filter((r) => (r['Warehouse Count'] || 0) === 0),
    ...seller.filter((r) => hasToken(r, 'MISSING') || hasToken(r, 'LOST')),
  ];
}

// Sum every run's payouts into one { po: { amount, date, kind } }. A given
// payout lives in exactly one report (distinct periods), so summing across
// runs never double-counts; runs disagreeing on kind -> "mixed".
function aggregateSettlements(payoutRows) {
  const byPo = {};
  for (const v of payoutRows || []) {
    const po = String(v.po || '').trim();
    if (!po || !(Number(v.amount) > 0)) continue;
    if (!byPo[po]) byPo[po] = { amount: 0, date: v.date || null, kind: v.kind || null };
    else if (v.kind && byPo[po].kind && byPo[po].kind !== v.kind) byPo[po].kind = 'mixed';
    else if (v.kind && !byPo[po].kind) byPo[po].kind = v.kind;
    byPo[po].amount += Number(v.amount);
    if (!byPo[po].date && v.date) byPo[po].date = v.date;
  }
  for (const v of Object.values(byPo)) v.amount = r2(v.amount);
  return byPo;
}

function daysOld(refundDate, today) {
  const parsed = parseRefundDate(refundDate);
  if (!parsed) return null;
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((midnight - parsed) / MS_PER_DAY);
}

// Priority: physically received wins; then written off; then paid back by
// Walmart; then expected; otherwise still outstanding (§6.2).
function deriveStatus(it, warehousePoSet) {
  if (warehousePoSet.has(it.po)) return 'received';
  if (it.writtenOff) return 'loss';
  if ((it.settlementSeen || 0) > 0) return 'reimbursed';
  if (it.reimbursePending) return 'reimbursed_pending';
  return 'outstanding';
}

/**
 * Decorate every item with its derived status, settlement, dispute-window
 * flags, needsAction and the payment-cycle counter. `cycleEnds` are the
 * period end dates (ms) of every imported run.
 */
function decorate(items, { warehousePoSet = new Set(), settlements = {}, cycleEnds = [], today = new Date() } = {}) {
  return items.map((raw) => {
    const s = settlements[raw.po];
    const it = {
      ...raw,
      settlementSeen: s && s.amount > 0 ? s.amount : null,
      settlementDate: s && s.amount > 0 ? (s.date || null) : null,
      settlementKind: s && s.amount > 0 ? (s.kind || null) : null,
    };
    it.status = deriveStatus(it, warehousePoSet);
    const days = daysOld(it.refundDate, today);
    const isWfs = it.type === 'WFS';
    // adjustments are parked, never chased: no countdown, no needs-action
    const chaseable = it.status === 'outstanding' && !it.caseOpened && !it.adjustment;
    let daysLeft = null;
    let wfsWaiting = false;
    let wfsDisputeOpen = false;
    let windowClosed = false;
    let needsAction = false;
    if (chaseable && days !== null) {
      if (it.lost === true) {
        needsAction = true;
      } else if (isWfs) {
        if (days < WFS_REIMBURSE_DAYS) { wfsWaiting = true; daysLeft = WFS_REIMBURSE_DAYS - days; }
        else if (days < WFS_DEADLINE) { wfsDisputeOpen = true; daysLeft = WFS_DEADLINE - days; needsAction = true; }
        else { windowClosed = true; daysLeft = WFS_DEADLINE - days; needsAction = true; }
      } else {
        daysLeft = SELLER_DISPUTE_DAYS - days;
        if (daysLeft <= 0) { windowClosed = true; needsAction = true; }
        else needsAction = daysLeft <= FILE_SOON_DAYS;
      }
    } else if (chaseable && it.lost === true) {
      needsAction = true;
    }
    // payment cycles since the case: runs whose period END is after the
    // approval date if approved, else the opened date (§6.4)
    const ref = it.caseApproved && it.caseApprovedAt ? it.caseApprovedAt : it.caseOpenedAt;
    const refT = ref ? Date.parse(ref) : NaN;
    const cyclesSinceCase = it.caseOpened && Number.isFinite(refT) ? cycleEnds.filter((t) => t > refT).length : 0;
    const caseIssue = !!it.caseOpened && it.status === 'outstanding' && cyclesSinceCase >= 2;
    if (caseIssue) needsAction = true;
    return { ...it, daysOld: days, daysLeft, isWfs, wfsWaiting, wfsDisputeOpen, windowClosed, needsAction, cyclesSinceCase, caseIssue };
  });
}

// ----- manual markers (§6.4): one pure step from the current marks -----
const blankMarks = () => ({
  caseOpened: false, caseOpenedAt: null, caseId: null, caseApproved: false, caseApprovedAt: null,
  adjustment: false, adjustmentAt: null, reimbursePending: false, reimbursePendingAt: null,
  writtenOff: false, writtenOffAt: null, note: null, noteAt: null,
});
function applyMarker(current, action, payload = {}, nowIso = new Date().toISOString()) {
  const m = { ...blankMarks(), ...(current || {}) };
  const clearCase = () => { m.caseOpened = false; m.caseOpenedAt = null; m.caseId = null; m.caseApproved = false; m.caseApprovedAt = null; };
  switch (action) {
    case 'case':
      m.caseOpened = true;
      if (!m.caseOpenedAt) m.caseOpenedAt = nowIso;
      if (payload.caseId !== undefined) m.caseId = String(payload.caseId || '').trim() || null;
      m.adjustment = false; m.adjustmentAt = null; // a case and an adjustment are mutually exclusive
      break;
    case 'undoCase': clearCase(); break;
    case 'approve': if (m.caseOpened) { m.caseApproved = true; m.caseApprovedAt = nowIso; } break;
    case 'unapprove': m.caseApproved = false; m.caseApprovedAt = null; break;
    case 'caseId': m.caseId = String(payload.caseId || '').trim() || null; break;
    case 'adjustment': m.adjustment = true; m.adjustmentAt = nowIso; clearCase(); break;
    case 'undoAdjustment': m.adjustment = false; m.adjustmentAt = null; break;
    case 'pending': m.reimbursePending = true; m.reimbursePendingAt = nowIso; break;
    case 'undoPending': m.reimbursePending = false; m.reimbursePendingAt = null; break;
    case 'writeOff': m.writtenOff = true; m.writtenOffAt = nowIso; break;
    case 'undoWriteOff': m.writtenOff = false; m.writtenOffAt = null; break;
    case 'note': {
      const t = String(payload.note || '').trim();
      m.note = t || null; m.noteAt = t ? nowIso : null;
      break;
    }
    default: throw new Error(`Unknown marker action: ${action}`);
  }
  return m;
}
const hasAnyMarker = (m) => !!(m && (m.caseOpened || m.caseApproved || m.caseId || m.adjustment || m.reimbursePending || m.writtenOff || m.note));

// every item lives in exactly one list tab (§6.5)
function filterOf(it) {
  if (it.status === 'received') return 'received';
  if (it.status === 'loss') return 'lost';
  if (it.status === 'reimbursed' || it.status === 'reimbursed_pending') return 'reimbursed';
  if (it.caseOpened) return 'cases';
  if (it.adjustment) return 'adjustments';
  return 'todo';
}

// Sort: needs action first, then oldest refund first
function sortItems(items) {
  const t = (it) => { const d = parseRefundDate(it.refundDate); return d ? d.getTime() : Infinity; };
  return items.slice().sort((a, b) => (b.needsAction ? 1 : 0) - (a.needsAction ? 1 : 0) || t(a) - t(b) || String(a.po).localeCompare(String(b.po)));
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Mon D" from an ISO stamp, an ISO day or a report MM/DD/YYYY date
function monDay(v) {
  if (!v) return '';
  const s = String(v);
  let d = null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  else d = parseRefundDate(s.slice(0, 10));
  if (!d || isNaN(d.getTime())) return '';
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}
const money = (n) => `$${Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The status sentence (§6.6): a bold lead in the tone colour, a muted clause,
// the tooltip. tone: red | amber | green | blue | navy | grey
function statusText(it) {
  if (it.status === 'loss') return { lead: 'Written off', clause: monDay(it.writtenOffAt), tone: 'grey', tooltip: '' };
  if (it.status === 'reimbursed') {
    const partial = it.settlementSeen < (it.amount || 0) - 0.01;
    return {
      lead: partial ? `Paid back ${money(it.settlementSeen)} of ${money(it.amount)}` : 'Paid back in full',
      clause: it.settlementDate ? `seen ${monDay(it.settlementDate)}` : '',
      tone: 'green',
      tooltip: it.settlementKind ? `Walmart payout: ${it.settlementKind}` : '',
    };
  }
  if (it.status === 'reimbursed_pending') {
    return { lead: 'Pending reimbursement', clause: it.reimbursePendingAt ? `marked ${monDay(it.reimbursePendingAt)}` : '', tone: 'amber', tooltip: 'auto-confirms when a payout appears in an imported report' };
  }
  if (it.adjustment) return { lead: 'Adjustment', clause: 'self-initiated partial refund', tone: 'navy', tooltip: 'not a return to chase' };
  if (it.caseOpened) {
    if (it.caseIssue) {
      return {
        lead: `Unpaid after ${it.cyclesSinceCase} cycles`,
        clause: `opened ${monDay(it.caseOpenedAt)}`,
        tone: 'amber',
        tooltip: `${it.caseApproved ? 'Approved' : 'Case opened'} but no reimbursement after ${it.cyclesSinceCase} payment cycles — follow up`,
      };
    }
    if (it.caseApproved) return { lead: `Approved ${monDay(it.caseApprovedAt)}`, clause: 'awaiting payout', tone: 'green', tooltip: `Walmart approved ${monDay(it.caseApprovedAt)} — awaiting payout` };
    return { lead: `Case opened ${monDay(it.caseOpenedAt)}`, clause: it.caseId ? `case ${it.caseId}` : '', tone: 'blue', tooltip: `Case filed ${monDay(it.caseOpenedAt)}` };
  }
  if (it.lost) return { lead: 'Lost', clause: 'file now', tone: 'red', tooltip: 'you can open a case immediately' };
  if (it.wfsWaiting) return { lead: 'Walmart pays back by day 90', clause: `${it.daysLeft} to go`, tone: 'blue', tooltip: `expect it in the settlement report within ${it.daysLeft} days; no action yet` };
  if (it.wfsDisputeOpen) return { lead: 'Dispute open', clause: `${it.daysLeft} days to file`, tone: 'red', tooltip: `no auto-reimbursement showed up; file within ${it.daysLeft} days (closes 135 d after the return)` };
  if (it.windowClosed) {
    const ago = it.daysLeft == null ? 0 : -it.daysLeft;
    return { lead: ago > 0 ? `Window closed ${ago} days ago` : 'Window closed', clause: 'write off?', tone: 'grey', tooltip: 'can no longer file — write it off as a loss' };
  }
  if (it.daysLeft != null) return { lead: `${it.daysLeft} days left to file`, clause: '', tone: it.needsAction ? 'red' : 'amber', tooltip: `dispute window closes in ${it.daysLeft} days — 45 days from the refund` };
  return { lead: 'Outstanding', clause: 'no refund date', tone: 'amber', tooltip: '' };
}

// The Reconcile table's "What to do" sentence for a stored summary row (§13.1)
function whatToDo(row) {
  const st = String(row.Status || '');
  const days = Number(row['Days Ago']);
  if (st === 'Lost (per Walmart)') return { lead: 'Open a case now', clause: 'lost per Walmart', tone: 'red' };
  if (st === 'Missing >30 days') return { lead: 'Open a dispute now', clause: 'missing over 30 days', tone: 'red' };
  if (st === 'Missing (recent)') {
    const left = Number.isFinite(days) ? Math.max(0, SELLER_DISPUTE_DAYS - days) : null;
    return { lead: 'Watch for arrival', clause: left === null ? '' : `${left} days to file`, tone: 'amber' };
  }
  if (st === 'Overdue (>45 days)') return { lead: 'Open a case with Walmart', clause: 'overdue', tone: 'red' };
  if (st === 'Pending') return { lead: 'Wait', clause: 'pays back by day 90', tone: 'blue' };
  return { lead: st, clause: row.Action || '', tone: 'grey' };
}

// ----- the Today card -----
function todayCounts(items) {
  const live = items.filter((i) => i.status !== 'received');
  const sum = (arr) => r2(arr.reduce((a, i) => a + (i.amount || 0), 0));
  const toFile = live.filter((i) => i.needsAction);
  const waiting = live.filter((i) => i.status === 'outstanding' && !i.caseOpened && !i.adjustment && !i.needsAction);
  const cases = live.filter((i) => i.status === 'outstanding' && i.caseOpened);
  return {
    toFile: { count: toFile.length, total: sum(toFile) },
    waiting: { count: waiting.length, total: sum(waiting) },
    cases: { count: cases.length, total: sum(cases) },
    needsAction: toFile.length,
  };
}

// ----- summary math (§8) -----
function monthKeyOf(d) {
  const s = String(d || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7);
  const iso = toIsoDay(s);
  return iso ? iso.slice(0, 7) : null;
}

function bucketTotals(refundTxs, items) {
  const t = { returns: 0, returnsCount: 0, notReceived: 0, received: 0, reimbursed: 0, loss: 0, pendingWfs: 0, pendingSeller: 0, adjustments: 0, lossCount: 0, pendingCount: 0 };
  for (const x of refundTxs) { t.returns += Math.abs(x.amount || 0); t.returnsCount++; }
  for (const it of items) {
    const amt = it.amount || 0;
    if (it.status === 'received') continue;
    t.notReceived += amt;
    if (it.status === 'loss') { t.loss += amt; t.lossCount++; }
    else if (it.status === 'reimbursed') {
      const paid = Math.min(it.settlementSeen || 0, amt);
      t.reimbursed += paid;
      if (amt - paid > 0.01) t.loss += amt - paid; // the partial-reimbursement gap is a loss
    } else if (it.adjustment) t.adjustments += amt;
    else if (it.lost && /after delivery/i.test(String(it.reason || ''))) { t.loss += amt; t.lossCount++; }
    else {
      if (it.type === 'WFS') t.pendingWfs += amt;
      else t.pendingSeller += amt;
      t.pendingCount++;
    }
  }
  t.received = Math.max(0, t.returns - t.notReceived);
  for (const k of Object.keys(t)) if (typeof t[k] === 'number') t[k] = r2(t[k]);
  return t;
}

const isRefundTx = (t) => String(t.type || '').toLowerCase() === 'refund';
// a dispute you WON: a positive Dispute Settlement credit; wins on tracked
// not-received POs are already counted in Reimbursed
const isDisputeWinTx = (t) => (t.amount || 0) > 0 && /dispute/i.test(String(t.type || ''));
const disputeWinSkipSet = (items) => new Set(items.filter((i) => i.status !== 'received').map((i) => i.po));
function sumDisputeWins(txs, skip) {
  let amt = 0;
  const pos = new Set();
  for (const t of txs) {
    if (!isDisputeWinTx(t) || !t.po || skip.has(t.po)) continue;
    amt += t.amount;
    pos.add(t.po);
  }
  return { disputeWins: r2(amt), disputeWinsCount: pos.size };
}

// the ledger across runs, deduped by transaction key (a payout or refund
// line only ever lives in one period, but a re-imported file is the same)
function dedupeLedger(rows) {
  const seen = new Map();
  for (const t of rows) { const k = t.key || `${t.run_id}|${t.po}|${t.type}|${t.date}|${t.amount}`; if (!seen.has(k)) seen.set(k, t); }
  return [...seen.values()];
}

// ----- stage wording shared by the exports (§7) -----
function stageOf(it) {
  if (it.status === 'received') return 'Received';
  if (it.status === 'loss') return 'Loss (written off)';
  if (it.status === 'reimbursed') return it.settlementSeen && it.settlementSeen < (it.amount || 0) - 0.01 ? 'Reimbursed (partial)' : 'Reimbursed';
  if (it.status === 'reimbursed_pending') return 'Pending reimbursement';
  if (it.adjustment) return 'Partial adjustment';
  if (it.caseOpened) return it.caseIssue ? 'Issue - approved unpaid' : (it.caseApproved ? 'Approved' : 'Case opened');
  if (it.lost) return 'Lost';
  if (it.windowClosed) return 'Dispute window closed';
  if (it.wfsDisputeOpen) return 'Dispute open';
  if (it.wfsWaiting) return 'Auto-reimburse (waiting)';
  return 'Outstanding';
}
function windowText(it) {
  const dl = it.daysLeft;
  if (it.caseOpened || it.status !== 'outstanding' || it.adjustment) return '';
  if (it.lost) return 'file now';
  if (dl == null) return '';
  if (it.windowClosed) return `closed ${-dl}d ago`;
  if (it.wfsWaiting) return `auto-reimburse in ${dl}d`;
  return `${dl}d left to file`;
}

// Audit workbook: every item with its stage, window, case fields and note
function buildAuditWorkbook(items) {
  const columns = [
    { header: 'PO #', width: 20, kind: 'text' }, { header: 'Type', width: 8, kind: 'text' }, { header: 'Product', width: 42, kind: 'text' },
    { header: 'Refund date', width: 13, kind: 'text' }, { header: 'Days old', width: 9, kind: 'int' }, { header: 'Refund amount', width: 13, kind: 'money' },
    { header: 'Walmart paid', width: 12, kind: 'money' }, { header: 'Stage', width: 22, kind: 'text' }, { header: 'Dispute window', width: 18, kind: 'text' },
    { header: 'Case opened', width: 11, kind: 'text' }, { header: 'Case ID', width: 14, kind: 'text' }, { header: 'Case opened date', width: 15, kind: 'text' },
    { header: 'Approved', width: 9, kind: 'text' }, { header: 'Approved date', width: 13, kind: 'text' }, { header: 'Cycles since opened', width: 16, kind: 'int' },
    { header: 'Adjustment', width: 10, kind: 'text' }, { header: 'Needs action', width: 11, kind: 'text' }, { header: 'Note', width: 55, kind: 'text' },
  ];
  const rows = items.map((it) => [
    String(it.po ?? ''), it.type || '', it.item || '', it.refundDate || '', it.daysOld ?? '', r2(it.amount), r2(it.settlementSeen),
    stageOf(it), windowText(it), it.caseOpened ? 'Yes' : '', it.caseId || '', it.caseOpenedAt ? String(it.caseOpenedAt).slice(0, 10) : '',
    it.caseApproved ? 'Yes' : '', it.caseApprovedAt ? String(it.caseApprovedAt).slice(0, 10) : '', it.caseOpened ? (it.cyclesSinceCase ?? 0) : '',
    it.adjustment ? 'Yes' : '', it.needsAction ? 'Yes' : '', it.note || '',
  ]);
  return buildWorkbookSheets([{ name: 'Returns Not Received', columns, rows }]);
}

// Summary workbook for one scope: Summary + Received + Pending WFS + Pending
// Seller + Loss + Reimbursed (+ Adjustments, Dispute wins). The rows sum to
// the legend because the bucket rules are bucketTotals' own.
function buildSummaryWorkbook({ label, refunds, items, allTxs, nameByPo = new Map() }) {
  const rnrByPo = new Map(items.map((i) => [i.po, i]));
  const received = refunds.filter((t) => { const it = rnrByPo.get(t.po); return !it || it.status === 'received'; });
  const winSkip = disputeWinSkipSet(items);
  const winTxs = (allTxs || []).filter((t) => isDisputeWinTx(t) && t.po && !winSkip.has(t.po));
  const isLad = (i) => i.lost && /after delivery/i.test(String(i.reason || ''));
  const live = items.filter((i) => i.status !== 'received');
  const writeOffs = live.filter((i) => i.status === 'loss' || (i.status !== 'reimbursed' && !i.adjustment && isLad(i)));
  const reimb = live.filter((i) => i.status === 'reimbursed');
  const adj = live.filter((i) => i.status !== 'reimbursed' && i.status !== 'loss' && i.adjustment);
  const pending = live.filter((i) => i.status !== 'reimbursed' && i.status !== 'loss' && !i.adjustment && !isLad(i));
  const pendingW = pending.filter((i) => i.type === 'WFS');
  const pendingS = pending.filter((i) => i.type !== 'WFS');
  const m = bucketTotals(refunds, items);
  const winTotal = r2(winTxs.reduce((a, t) => a + t.amount, 0));
  const winPos = new Set(winTxs.map((t) => t.po));

  const summaryRows = [
    [`Returns — ${label}`, r2(m.returns), m.returnsCount || 0],
    ['Received (came back)', r2(m.received), received.length],
    ['Reimbursed by Walmart', r2(m.reimbursed), reimb.length],
  ];
  if (winTotal > 0) summaryRows.push(['Dispute wins (item also received)', winTotal, winPos.size]);
  summaryRows.push(['Loss (write-offs, partial gaps, lost after delivery)', r2(m.loss), writeOffs.length]);
  summaryRows.push(['Pending — WFS', r2(m.pendingWfs), pendingW.length]);
  summaryRows.push(['Pending — Seller', r2(m.pendingSeller), pendingS.length]);
  if (m.adjustments) summaryRows.push(['Adjustments (self-initiated partials)', r2(m.adjustments), adj.length]);

  const itemCols = [
    { header: 'PO #', width: 20, kind: 'text' }, { header: 'Type', width: 8, kind: 'text' }, { header: 'Product', width: 46, kind: 'text' },
    { header: 'Refund date', width: 12, kind: 'text' }, { header: 'Days old', width: 9, kind: 'int' }, { header: 'Refund amount', width: 14, kind: 'money' },
    { header: 'Walmart paid', width: 12, kind: 'money' }, { header: 'Stage', width: 22, kind: 'text' }, { header: 'Case ID', width: 13, kind: 'text' }, { header: 'Note', width: 44, kind: 'text' },
  ];
  const itemRows = (rows) => rows.map((i) => [String(i.po || ''), i.type || '', i.item || '', i.refundDate || '', i.daysOld ?? '', r2(i.amount), r2(i.settlementSeen), stageOf(i), i.caseId || '', i.note || '']);

  const sheets = [
    { name: 'Summary', columns: [{ header: 'Bucket', width: 48, kind: 'text' }, { header: 'Amount', width: 14, kind: 'money' }, { header: 'POs', width: 8, kind: 'int' }], rows: summaryRows },
    {
      name: 'Received',
      columns: [{ header: 'PO #', width: 20, kind: 'text' }, { header: 'Order #', width: 20, kind: 'text' }, { header: 'Refund date', width: 12, kind: 'text' }, { header: 'Product', width: 46, kind: 'text' }, { header: 'Refund amount', width: 14, kind: 'money' }],
      rows: received.map((t) => [String(t.po || ''), String(t.order || ''), t.date || '', nameByPo.get(t.po) || '', r2(Math.abs(t.amount || 0))]),
    },
    { name: 'Pending - WFS', columns: itemCols, rows: itemRows(pendingW) },
    { name: 'Pending - Seller', columns: itemCols, rows: itemRows(pendingS) },
    { name: 'Loss', columns: itemCols, rows: itemRows(writeOffs) },
    {
      name: 'Reimbursed',
      columns: [
        { header: 'PO #', width: 20, kind: 'text' }, { header: 'Type', width: 8, kind: 'text' }, { header: 'Product', width: 46, kind: 'text' }, { header: 'Refund date', width: 12, kind: 'text' },
        { header: 'Refund amount', width: 14, kind: 'money' }, { header: 'Walmart paid', width: 12, kind: 'money' }, { header: 'Gap (loss)', width: 11, kind: 'money' }, { header: 'Partial?', width: 8, kind: 'text' },
        { header: 'Kind', width: 12, kind: 'text' }, { header: 'Note', width: 40, kind: 'text' },
      ],
      rows: reimb.map((i) => {
        const paid = r2(Math.min(i.settlementSeen || 0, i.amount || 0));
        const gap = r2(Math.max(0, (i.amount || 0) - paid));
        return [String(i.po || ''), i.type || '', i.item || '', i.refundDate || '', r2(i.amount), paid, gap, gap > 0.01 ? 'Yes' : '', i.settlementKind || '', i.note || ''];
      }),
    },
  ];
  if (adj.length) sheets.push({ name: 'Adjustments', columns: itemCols, rows: itemRows(adj) });
  if (winTxs.length) {
    sheets.push({
      name: 'Dispute wins',
      columns: [{ header: 'PO #', width: 20, kind: 'text' }, { header: 'Order #', width: 20, kind: 'text' }, { header: 'Date paid', width: 12, kind: 'text' }, { header: 'Product', width: 46, kind: 'text' }, { header: 'Amount won', width: 13, kind: 'money' }],
      rows: winTxs.map((t) => [String(t.po || ''), String(t.order || ''), t.date || '', nameByPo.get(t.po) || '', r2(t.amount)]),
    });
  }
  return buildWorkbookSheets(sheets);
}

// CSV of the current view (§7): the PO as ="…" so Excel keeps it as text
function buildViewCsv(items) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = ['PO #,Type,Product,Refund Date,Days Old,Refund Amount,Walmart Paid,Status,Needs Action'];
  for (const it of items) {
    const st = statusText(it);
    lines.push([
      `="${String(it.po || '').replace(/"/g, '')}"`, it.type || '', esc(it.item || ''), it.refundDate || '', it.daysOld ?? '',
      r2(it.amount).toFixed(2), it.settlementSeen != null ? r2(it.settlementSeen).toFixed(2) : '',
      esc([st.lead, st.clause].filter(Boolean).join(' — ')), it.needsAction ? 'Yes' : '',
    ].join(','));
  }
  return lines.join('\r\n');
}

// ----- the dispute digest (§9.1) -----
// The Seller Center returns-search URL exactly as the site builds it: the
// appliedFilters JSON, double-URL-encoded, with the PO in "id".
function sellerReturnLink(po, now = new Date()) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const end = new Date(now);
  const start = new Date(now); start.setDate(start.getDate() - 180);
  const filters = {
    pageSize: 25, pageNum: 0, offset: 0, returnGroup: 'ALL', filter: true,
    startDate: `${iso(start)}T00:00:00+00:00`, endDate: `${iso(end)}T23:59:59+00:00`,
    id: String(po), searchIdType: 'PO_NO', limit: 25, resetFilter: true, tabIndex: 4,
  };
  return 'https://seller.walmart.com/orders/returns?appliedFilters=' + encodeURIComponent(encodeURIComponent(JSON.stringify(filters))) + '&returnGroup=ALL';
}
const WFS_CASES_LINK = 'https://seller.walmart.com/supporthub/your-cases?dateRange=last30days&returnUrl=%2Forders%2Freturns';
const SELLER_DIGEST_DAYS = 10;

function buildDigest(items, now = new Date()) {
  const fileable = (i) => i.status === 'outstanding' && !i.caseOpened && !i.adjustment;
  const sellers = items
    .filter((i) => fileable(i) && i.type !== 'WFS' && i.daysLeft != null && i.daysLeft > 0 && i.daysLeft <= SELLER_DIGEST_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const wfs = items.filter((i) => fileable(i) && i.wfsDisputeOpen).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  const all = [...sellers, ...wfs];
  if (!all.length) return null;

  const total = r2(all.reduce((a, i) => a + (i.amount || 0), 0));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const trunc = (s, n = 34) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const pill = (text, urgent) =>
    `<span style="background:${urgent ? '#fdecec' : '#fef3df'};color:${urgent ? '#b3261e' : '#9a6a00'};font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;">${text}</span>`;
  const row = (i, last) => {
    const b = last ? '' : 'border-bottom:1px solid #efece2;';
    const href = i.type === 'WFS' ? WFS_CASES_LINK : sellerReturnLink(i.po, now);
    const p = i.type === 'WFS' ? pill('file now', true) : pill(`${i.daysLeft}d left`, i.daysLeft <= 5);
    return '<tr>' +
      `<td style="padding:9px 8px;${b}"><a href="${href}" style="color:#0654ba;font-family:Consolas,monospace;font-size:12.5px;text-decoration:underline;">${esc(i.po)}</a></td>` +
      `<td style="padding:9px 8px;${b}color:#444;">${esc(trunc(i.item))}</td>` +
      `<td style="padding:9px 8px;${b}text-align:right;font-weight:600;">${money(i.amount || 0)}</td>` +
      `<td style="padding:9px 8px;${b}text-align:right;">${p}</td></tr>`;
  };
  const section = (label, list, pad) =>
    list.length
      ? `<div style="padding:${pad};">` +
        `<div style="font-size:11.5px;font-weight:600;letter-spacing:.05em;color:#8a8672;text-transform:uppercase;padding-bottom:6px;">${label} (${list.length})</div>` +
        `<table style="width:100%;border-collapse:collapse;font-size:13px;">${list.map((i, n) => row(i, n === list.length - 1)).join('')}</table></div>`
      : '';
  const today = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const subject = `Cases to open — ${all.length} return${all.length === 1 ? '' : 's'} · ${money(total)}`;
  const html =
    '<div style="width:600px;max-width:100%;margin:0 auto;background:#ffffff;border:1px solid #e5e0d5;border-radius:10px;overflow:hidden;font-family:-apple-system,\'Segoe UI\',Roboto,sans-serif;color:#1a1a1a;">' +
    '<div style="background:#1c2f57;padding:16px 24px;">' +
    `<div style="color:#ffffff;font-size:16px;font-weight:500;">${esc(subject)}</div>` +
    `<div style="color:#b9c3dd;font-size:12px;margin-top:2px;">${today}</div></div>` +
    section('Seller', sellers, '16px 24px 4px') +
    section('WFS', wfs, '14px 24px 20px') +
    '</div>';
  const key = crypto.createHash('sha1').update(all.map((i) => i.po).sort().join(',')).digest('hex');
  return {
    subject, html, total, count: all.length, key,
    items: all.map((i) => ({
      po: i.po, type: i.type, product: i.item || '', amount: i.amount || 0,
      refundDate: i.refundDate || '', daysLeft: i.daysLeft ?? null,
      link: i.type === 'WFS' ? WFS_CASES_LINK : sellerReturnLink(i.po, now),
    })),
  };
}

// "Email me this list": a mailto with every needs-action item (§9.2)
function mailtoFor(email, items) {
  const need = items.filter((i) => i.needsAction);
  if (!need.length) return null;
  const total = need.reduce((acc, i) => acc + (i.amount || 0), 0);
  const lines = need.map((i) =>
    `PO ${i.po} [${i.type}] — ${i.item || '(no item name)'} — refunded ${i.refundDate}` +
    `${i.daysOld !== null && i.daysOld !== undefined ? ` (${i.daysOld} days ago)` : ''} — $${(i.amount || 0).toFixed(2)}`);
  const subject = `Returns not received — ${need.length} need action ($${total.toFixed(2)})`;
  const body = `These refunded POs never arrived at the warehouse and need action (lost / dispute window closing / WFS past day 90):\n\n${lines.join('\n')}\n`;
  return { count: need.length, mailto: `mailto:${encodeURIComponent(String(email || '').trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
}

module.exports = {
  SELLER_DISPUTE_DAYS, WFS_REIMBURSE_DAYS, FILE_WINDOW_DAYS, WFS_DEADLINE, FILE_SOON_DAYS, SELLER_DIGEST_DAYS, WFS_CASES_LINK,
  typeOf, itemFromRow, trackerRows, aggregateSettlements, daysOld, deriveStatus, decorate,
  blankMarks, applyMarker, hasAnyMarker, filterOf, sortItems, monDay, money, statusText, whatToDo, todayCounts,
  monthKeyOf, bucketTotals, isRefundTx, isDisputeWinTx, disputeWinSkipSet, sumDisputeWins, dedupeLedger,
  stageOf, windowText, buildAuditWorkbook, buildSummaryWorkbook, buildViewCsv, sellerReturnLink, buildDigest, mailtoFor,
};
