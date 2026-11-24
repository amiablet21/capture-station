'use strict';
// A Walmart payment period as a statement: Sales, Refunds, Fees,
// Adjustments, what Walmart says is payable and what went to the bank.
// Plain arithmetic over the period's stored lines, with nothing read from
// disk, so DWS Stock's Recovery page and the office server's Payment
// reports (server/) give the same figures from the same code.

const STATEMENT_AMOUNT_LABELS = {
  'Product Price': 'Product price', Shipping: 'Shipping', 'Product tax': 'Net tax collected', 'Other tax (Fees)': 'Other taxes (fee)',
  'Commission on Product': 'Net commission', 'Commission on Shipping': 'Net commission', 'Product tax withheld': 'Net tax withheld',
  'Total Walmart Funded Savings': 'Total Walmart funded savings', 'Promo Code': 'Promo code', 'Payable to partner': 'Payable to partner',
};
// the issuer of a refund, from the statement's Transaction Description
const REFUND_ISSUERS = { 'return refund': 'Customer returns', 'seller initiated returns': 'Seller issued', 'walmart customer care refund': 'Walmart Customer Care issued' };
const refundIssuer = (desc) => { const d = String(desc || '').trim(); if (!d) return ''; return REFUND_ISSUERS[d.toLowerCase()] || d; };
const STATEMENT_SALES_ORDER = ['Product price', 'Shipping', 'Net tax collected', 'Other taxes (fee)', 'Net commission', 'Net tax withheld', 'Total Walmart funded savings', 'Promo code', 'Payable to partner'];

function buildStatement(lines, label, scope, key, runs, exps) {
  const sections = new Map();
  const put = (section, name, amount, count, order, issuer) => {
    const s = sections.get(section) || { name: section, lines: new Map(), total: 0, order };
    const l = s.lines.get(name) || { label: name, amount: 0, count: 0, by: new Map() };
    l.amount += amount; l.count += count; s.lines.set(name, l); s.total += amount;
    // who issued a refund (owner 2026-10-13): the statement's own words,
    // folded to three — the customer, the seller, Walmart Customer Care
    if (issuer) { const b = l.by.get(issuer) || { label: issuer, amount: 0, count: 0 }; b.amount += amount; b.count += count; l.by.set(issuer, b); }
    sections.set(section, s);
  };
  let payable = 0; let payableSeen = false;
  const paid = [];
  for (const l of lines) {
    const t = l.type;
    if (t === 'PaymentSummary') { payable += l.amount; payableSeen = true; continue; }
    if (t === 'Sale' || t === 'Refund') { put(t === 'Sale' ? 'Sales' : 'Refunds', STATEMENT_AMOUNT_LABELS[l.amountType] || l.amountType || l.desc || t, l.amount, l.count, t === 'Sale' ? 1 : 2, t === 'Refund' ? refundIssuer(l.desc) : ''); continue; }
    if (t === 'Instant Transfer' || /payout|transfer/i.test(t)) { paid.push({ date: l.date, amount: -l.amount, desc: l.desc }); continue; }
    if (t === 'Service Fee') { put('Fees', l.desc || l.amountType || t, l.amount, l.count, 3); continue; }
    if (t === 'Adjustment' || t === 'Dispute Settlement') { put('Adjustments', l.desc || t, l.amount, l.count, 4); continue; }
    put('Other activities', l.desc || l.amountType || t, l.amount, l.count, 5);
  }
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const out = [...sections.values()].sort((a, b) => a.order - b.order).map((s) => ({
    name: s.name, total: r2(s.total),
    lines: [...s.lines.values()].sort((a, b) => {
      const ia = STATEMENT_SALES_ORDER.indexOf(a.label); const ib = STATEMENT_SALES_ORDER.indexOf(b.label);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return Math.abs(b.amount) - Math.abs(a.amount);
    }).map((l) => ({ label: l.label, amount: r2(l.amount), count: l.count, by: l.by && (l.by.size > 1 || (l.by.size === 1 && !l.by.has('Customer returns'))) ? [...l.by.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).map((b) => ({ label: b.label, amount: r2(b.amount), count: b.count })) : [] })),
  }));
  // the owner's own expenses, as a section of their own
  if (exps.length) {
    const byCat = new Map();
    for (const e of exps) byCat.set(e.category || 'Other', (byCat.get(e.category || 'Other') || 0) + (Number(e.amount) || 0));
    out.push({ name: 'Your expenses', total: r2(-[...byCat.values()].reduce((a, v) => a + v, 0)), lines: [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ label: category, amount: r2(-amount), count: exps.filter((e) => (e.category || 'Other') === category).length })) });
  }
  const activity = r2(out.reduce((a, s) => a + s.total, 0));
  // by day, newest first; the bank transfers are negative lines on the statement
  const paidByDay = new Map();
  for (const p of paid) { const k = p.date || ''; paidByDay.set(k, r2((paidByDay.get(k) || 0) + p.amount)); }
  const paidOut = [...paidByDay.entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0]))).map(([date, amount]) => ({ date, amount }));
  return {
    ok: true, scope, key, label, runs: runs.length, sections: out, activity,
    payable: payableSeen ? r2(payable) : null, paid: paidOut, paidTotal: r2(paidOut.reduce((a, p) => a + p.amount, 0)),
    hasLines: lines.length > 0,
  };
}

module.exports = { buildStatement, refundIssuer, STATEMENT_AMOUNT_LABELS, STATEMENT_SALES_ORDER };
