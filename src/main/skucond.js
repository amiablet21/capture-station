'use strict';
// The condition a SKU's name carries, from the listing naming convention:
// OPEN-BOX- / USED- / SCRAP- in front (preferred since 2026-08-06) or
// -OPENBOX / -USED / -SCRAP at the end (older listings keep deriving so
// they never unmap). Pure, no Electron: the Returns grading (db.js) and
// Recovery's Profit grouping both read it.
const CONDITION_SUFFIX = { openbox: '-OPENBOX', used: '-USED', scrap: '-SCRAP' };
const CONDITION_PREFIX = { openbox: 'OPEN-BOX-', used: 'USED-', scrap: 'SCRAP-' };

// { cond, core } with the affix stripped, or null for a plain (new) SKU
function conditionOfSku(sku) {
  const s = String(sku || '');
  const up = s.toUpperCase();
  for (const [cond, pre] of Object.entries(CONDITION_PREFIX)) {
    if (up.startsWith(pre) && up.length > pre.length) return { cond, core: s.slice(pre.length) };
  }
  for (const [cond, suf] of Object.entries(CONDITION_SUFFIX)) {
    if (up.endsWith(suf) && up.length > suf.length) return { cond, core: s.slice(0, s.length - suf.length) };
  }
  return null;
}

module.exports = { CONDITION_SUFFIX, CONDITION_PREFIX, conditionOfSku };
