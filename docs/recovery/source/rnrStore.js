/**
 * Returns Not Received (RNR) — one unified tracker for every refunded PO that
 * never arrived at the warehouse, WFS *and* seller-fulfilled. Replaces the old
 * split between the WFS watchlist and the Not Received tracker.
 *
 * Every status is **derived from a portable source of truth**, never stored as
 * a hidden local decision (so it syncs across the owner's computers):
 *   - received   → the PO is in the warehouse Received list
 *   - loss       → the PO is in the warehouse Loss list
 *   - reimbursed → a Dispute Settlement for the PO was seen in an imported report
 *   - outstanding→ none of the above (still being chased)
 *
 * Each item carries its fulfillment `type` ("WFS" | "Seller"), which sets the
 * "needs action" threshold — WFS overdue at 45 days (Walmart routes WFS returns
 * through their own warehouse first), seller "act now" at 30 days. Lost items
 * need action immediately regardless of type.
 *
 * Status: outstanding | received | reimbursed | loss
 */
const fs = require("fs");
const path = require("path");
const { parseRefundDate } = require("./parseReport");
const { isLostReason, AGED_THRESHOLD_DAYS, WFS_OVERDUE_DAYS } = require("./reconcile");

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Two very different Walmart timelines by fulfillment type:
//  - Seller-fulfilled: you must FILE a dispute within 45 days of the refund;
//    miss it and the money is unrecoverable (a hard deadline).
//  - WFS: a not-received return AUTO-reimburses (lands in the settlement report)
//    within ~90 days of the return — no dispute needed. You only open a case if
//    it hasn't paid by then.
const SELLER_DISPUTE_DAYS = 45;    // seller-fulfilled: dispute window ~45 days from refund
const WFS_REIMBURSE_DAYS = 90;     // WFS not-received: auto-reimburses by ~90d; dispute window then OPENS
const FILE_WINDOW_DAYS = 45;       // ...and you have 45 days to file after it opens (WFS hard deadline = 135d)
const FILE_SOON_DAYS = 10;         // seller: warn when <= 10 days left to file

let filePath = null;

function init(userDataDir) {
  filePath = path.join(userDataDir, "rnr.json");
}

function load() {
  try {
    const items = JSON.parse(fs.readFileSync(filePath, "utf8")).items;
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function save(items) {
  fs.writeFileSync(filePath, JSON.stringify({ items }, null, 2));
}

const typeOf = (fulfillment) => (/wfs|walmart-fulfilled/i.test(String(fulfillment || "")) ? "WFS" : "Seller");

// Add not-received rows from a reconcile run (seller MISSING/LOST + WFS not received).
// Items already tracked keep their status — re-running a report never resets a decision.
function upsertFromRun(rows, sourceRunId) {
  const items = load();
  const known = new Set(items.map((i) => i.po));
  for (const r of rows) {
    const po = r["PO #"];
    if (!po || known.has(po)) continue;
    known.add(po);
    items.push({
      po,
      order: r["Order #"] || "",
      item: r["Item"] || "",
      qty: r["Qty"] || 0,
      refundDate: r["Refund Date"] || "",
      amount: r["Net Refund (Payable Impact)"] || 0,
      reason: r["Return Reason"] || "",
      lost: isLostReason(r),
      type: typeOf(r["Fulfillment Type"]),
      status: "outstanding",
      reimbursedAmount: null,
      settlementSeen: null,
      sourceRunId: sourceRunId || null,
      addedAt: new Date().toISOString(),
    });
  }
  save(items);
  return items;
}

function removeByRun(sourceRunId) {
  if (!sourceRunId) return load();
  const items = load().filter((i) => i.sourceRunId !== sourceRunId);
  save(items);
  return items;
}

function pruneOrphans(validRunIds) {
  const items = load().filter((i) => i.sourceRunId && validRunIds.has(i.sourceRunId));
  save(items);
  return items;
}

function removeItem(po) {
  const items = load().filter((i) => i.po !== po);
  save(items);
  return items;
}

// Set each item's Walmart-payout total from the *aggregate* of all reports
// (computed by the caller across every run). Idempotent — safe to run on every
// refresh, and self-heals stale items that missed a one-shot capture. A PO with
// any payout becomes "reimbursed" via deriveStatus; money never moves physical
// status, it just becomes visible. Returns how many items changed.
function applySettlements(settlementsByPo) {
  const items = load();
  let touched = 0;
  for (const it of items) {
    const s = settlementsByPo[it.po];
    const amount = s && s.amount > 0 ? s.amount : null;
    const date = amount ? (s.date || it.settlementDate || null) : null;
    const kind = amount ? (s.kind || null) : null;
    if (it.settlementSeen !== amount || it.settlementDate !== date || it.settlementKind !== kind) {
      it.settlementSeen = amount;
      it.settlementDate = date;
      it.settlementKind = kind;
      touched++;
    }
  }
  if (touched) save(items);
  return touched;
}

// "Case opened" is a manual workflow marker (you filed a case with Walmart). It
// does NOT change the derived status — it just records that you've acted, so the
// item drops out of "needs action" and shows under the Open Cases filter. Local
// to this machine (a personal to-do marker, not part of the portable truth).
function markCase(po, opened = true, caseId) {
  const items = load();
  const it = items.find((i) => i.po === po);
  if (it) {
    it.caseOpened = !!opened;
    if (opened) {
      if (!it.caseOpenedAt) it.caseOpenedAt = new Date().toISOString();
      if (caseId !== undefined) it.caseId = String(caseId || "").trim() || null;
      it.adjustment = false; it.adjustmentAt = null; // a case and an adjustment are mutually exclusive
    } else {
      it.caseOpenedAt = null;
      it.caseId = null;
      it.caseApproved = false; it.caseApprovedAt = null;
    }
    save(items);
  }
  return items;
}

// "Approved" = Walmart emailed that they'll pay this case. Visual only — the
// payment clock restarts from the approval date, so the 2-cycle issue flag then
// means "approved but still not paid." Only valid on an open case. Local-only.
function markApproved(po, on = true) {
  const items = load();
  const it = items.find((i) => i.po === po);
  if (it && it.caseOpened) {
    it.caseApproved = !!on;
    it.caseApprovedAt = on ? new Date().toISOString() : null;
    save(items);
  }
  return items;
}

// Update just the case reference number — without touching caseOpenedAt, so the
// "payment cycles since opened" counter keeps measuring from the original date.
function setCaseId(po, caseId) {
  const items = load();
  const it = items.find((i) => i.po === po);
  if (it) { it.caseId = String(caseId || "").trim() || null; save(items); }
  return items;
}

// A free-text note pinned to a PO (e.g. "called rep Jun 20, ref #4471"). Local.
function setNote(po, note) {
  const items = load();
  const it = items.find((i) => i.po === po);
  if (it) {
    const t = String(note || "").trim();
    it.note = t || null;
    it.noteAt = t ? new Date().toISOString() : null;
    save(items);
  }
  return items;
}

// "Partial adjustment" is a manual marker for a self-initiated partial refund
// that isn't a real return (a missing-part credit, a billing correction). It's
// not chased and not a product loss — it just moves to its own tab. Local-only.
function markAdjustment(po, on = true) {
  const items = load();
  const it = items.find((i) => i.po === po);
  if (it) {
    it.adjustment = !!on;
    it.adjustmentAt = on ? new Date().toISOString() : null;
    if (on) { it.caseOpened = false; it.caseOpenedAt = null; it.caseId = null; it.caseApproved = false; it.caseApprovedAt = null; }
    save(items);
  }
  return items;
}

// "Pending reimbursement" is a manual marker: you expect Walmart to pay this
// back before the payment cycle has posted. It moves the item to the Reimbursed
// side as pending; when a real payout for the PO later appears in an imported
// report, deriveStatus promotes it to confirmed "reimbursed" automatically.
function markReimbursePending(po, pending = true) {
  const items = load();
  const it = items.find((i) => i.po === po);
  if (it) {
    it.reimbursePending = !!pending;
    it.reimbursePendingAt = pending ? new Date().toISOString() : null;
    save(items);
  }
  return items;
}

function daysOld(refundDate, today) {
  const parsed = parseRefundDate(refundDate);
  if (!parsed) return null;
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((midnight - parsed) / MS_PER_DAY);
}

const actionThreshold = (type) => (type === "WFS" ? WFS_OVERDUE_DAYS : AGED_THRESHOLD_DAYS);

// Derive each item's status from the source-of-truth lists, then decorate with
// daysOld + needsAction (those two are never persisted). Priority: a PO that's
// physically received wins; then written-off (loss); then reimbursed by Walmart
// (a Dispute Settlement was seen); otherwise still outstanding.
function deriveStatus(it, warehousePoSet, lostPoSet) {
  if (warehousePoSet.has(it.po)) return "received";
  // Write-off is now an RNR-local marker (its own `writtenOff` flag); lostPoSet is
  // still honoured so any legacy warehouse-side losses keep resolving to "loss".
  if (it.writtenOff || lostPoSet.has(it.po)) return "loss";
  if ((it.settlementSeen || 0) > 0) return "reimbursed";        // confirmed: a payout was seen in a report
  if (it.reimbursePending) return "reimbursed_pending";          // manual: expected, payment cycle not in yet
  return "outstanding";
}

// Write off / un-write-off a PO — kept inside Returns Not Received, no longer
// pushed to the warehouse Loss list.
function markWrittenOff(po, on = true) {
  const items = load();
  const it = items.find((i) => i.po === po);
  if (it) { it.writtenOff = !!on; it.writtenOffAt = on ? new Date().toISOString() : null; save(items); }
  return items;
}

function refreshStatuses(warehousePoSet, lostPoSet = new Set(), today = new Date()) {
  const items = load();
  for (const it of items) it.status = deriveStatus(it, warehousePoSet, lostPoSet);
  save(items);
  const WFS_DEADLINE = WFS_REIMBURSE_DAYS + FILE_WINDOW_DAYS; // 135
  return items.map((it) => {
    const days = daysOld(it.refundDate, today);
    const isWfs = it.type === "WFS";
    // Adjustments are self-initiated partial refunds — parked, never chased, so
    // they must not trip "needs action" or the dispute-window countdowns.
    const chaseable = it.status === "outstanding" && !it.caseOpened && !it.adjustment;
    let daysLeft = null;        // days until the next relevant milestone
    let wfsWaiting = false;     // WFS, still inside the ~90-day auto-reimburse window
    let wfsDisputeOpen = false; // WFS, past 90d unpaid → 45-day dispute window is open
    let windowClosed = false;   // dispute window has fully closed (unrecoverable → write off)
    let needsAction = false;
    if (chaseable && days !== null) {
      if (it.lost === true) {
        needsAction = true; // lost: act immediately
      } else if (isWfs) {
        if (days < WFS_REIMBURSE_DAYS) {           // 0..90 — just wait for the auto-reimbursement
          wfsWaiting = true;
          daysLeft = WFS_REIMBURSE_DAYS - days;
        } else if (days < WFS_DEADLINE) {          // 90..135 — no auto-pay, file the dispute
          wfsDisputeOpen = true;
          daysLeft = WFS_DEADLINE - days;
          needsAction = true;
        } else {                                    // 135+ — window closed
          windowClosed = true;
          daysLeft = WFS_DEADLINE - days;
          needsAction = true;
        }
      } else {                                      // seller: ~45 days from refund to file
        daysLeft = SELLER_DISPUTE_DAYS - days;
        if (daysLeft <= 0) { windowClosed = true; needsAction = true; }
        else { needsAction = daysLeft <= FILE_SOON_DAYS; }
      }
    } else if (chaseable && it.lost === true) {
      needsAction = true;
    }
    return { ...it, daysOld: days, daysLeft, isWfs, wfsWaiting, wfsDisputeOpen, windowClosed, needsAction };
  });
}

// Money summary for the Profit tab: still owed, recovered, written off.
// Statuses are derived, so callers should refreshStatuses() before summary().
function summary() {
  const items = load();
  const sum = (arr, f = (i) => i.amount || 0) => arr.reduce((a, i) => a + f(i), 0);
  const by = (s) => items.filter((i) => i.status === s);
  const reimbursed = by("reimbursed");
  const reimbursedPending = by("reimbursed_pending");
  const openCases = items.filter((i) => i.status === "outstanding" && i.caseOpened);
  return {
    outstanding: { count: by("outstanding").length, total: sum(by("outstanding")) },
    openCases: { count: openCases.length, total: sum(openCases) },
    reimbursed: { count: reimbursed.length, total: sum(reimbursed), recovered: sum(reimbursed, (i) => i.settlementSeen ?? i.amount ?? 0) },
    reimbursedPending: { count: reimbursedPending.length, total: sum(reimbursedPending) },
    loss: { count: by("loss").length, total: sum(by("loss")) },
    received: { count: by("received").length, total: sum(by("received")) },
  };
}

// ----- One-time migration from the two legacy stores -----
// WFS-lost items can appear in both; keep the more-decided status and merge fields.
function migrateFrom(wfsItems = [], nrItems = []) {
  const RANK = { loss: 5, reimbursed: 5, case_opened: 4, received: 2, outstanding: 1, pending: 1 };
  const byPo = new Map();
  const merge = (incoming) => {
    const existing = byPo.get(incoming.po);
    if (!existing) { byPo.set(incoming.po, incoming); return; }
    // keep whichever status is more "decided"; fill any blank fields from the other
    const winner = (RANK[incoming.status] || 0) >= (RANK[existing.status] || 0) ? incoming : existing;
    const other = winner === incoming ? existing : incoming;
    byPo.set(incoming.po, { ...other, ...winner });
  };

  for (const w of wfsItems) {
    merge({
      po: w.po, order: w.order || "", item: w.item || "", qty: w.qty || 0,
      refundDate: w.refundDate || "", amount: w.netRefund || 0, reason: w.reason || "",
      lost: !!w.lost, type: "WFS",
      status: w.status === "pending" ? "outstanding" : w.status,
      reimbursedAmount: null, settlementSeen: null,
      caseOpenedAt: w.caseOpenedAt, sourceRunId: w.sourceRunId || null, addedAt: w.addedAt || new Date().toISOString(),
    });
  }
  for (const n of nrItems) {
    merge({
      po: n.po, order: n.order || "", item: n.item || "", qty: n.qty || 0,
      refundDate: n.refundDate || "", amount: n.amount || 0, reason: n.reason || "",
      lost: !!n.lost, type: typeOf(n.fulfillment),
      status: n.status,
      reimbursedAmount: n.reimbursedAmount ?? null, settlementSeen: n.settlementSeen ?? null,
      settlementDate: n.settlementDate, resolvedAt: n.resolvedAt,
      sourceRunId: n.sourceRunId || null, addedAt: n.addedAt || new Date().toISOString(),
    });
  }
  return [...byPo.values()];
}

module.exports = {
  init, load, save, upsertFromRun, removeByRun, removeItem, pruneOrphans,
  applySettlements, refreshStatuses, markCase, setCaseId, markApproved, markAdjustment, setNote, markWrittenOff, markReimbursePending,
  summary, migrateFrom, WFS_OVERDUE_DAYS, AGED_THRESHOLD_DAYS,
};
