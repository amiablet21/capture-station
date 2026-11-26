'use strict';
// Period labels for an imported payment period, e.g. "May 30 - Jun 12, 2026"
// (spec docs/recovery/SPEC.md §2.2). Labels name the run, the archived CSV
// and the duplicate guard, so they stay filesystem-safe: letters, digits,
// space, comma, hyphen only.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmt(d) {
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}

function formatPeriod(start, end) {
  if (!start || !end) return null;
  if (start.getFullYear() === end.getFullYear()) {
    return `${fmt(start)} - ${fmt(end)}, ${end.getFullYear()}`;
  }
  return `${fmt(start)}, ${start.getFullYear()} - ${fmt(end)}, ${end.getFullYear()}`;
}

// Walmart's report filename embeds the PAYMENT date (…MP_06022026_… = paid
// Jun 2). The statement period Walmart shows is paid−17 → paid−3 (paid Jun 2
// ↔ "May 16 - May 30", verified against the owner's Statements page), so the
// filename derivation is authoritative; the file's own Period columns run a
// day short.
function periodFromReportName(name) {
  const m = /MP_(\d{2})(\d{2})(\d{4})_/.exec(String(name || ''));
  if (!m) return null;
  const paid = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  if (isNaN(paid.getTime())) return null;
  const end = new Date(paid); end.setDate(end.getDate() - 3);
  const start = new Date(paid); start.setDate(start.getDate() - 17);
  return { start, end, explicit: true };
}

// "Apr 19 - May 15, 2026" / "Dec 28, 2025 - Jan 5, 2026" -> { start, end }
// as local-midnight Dates, or nulls when the label is not a period (a bare
// filename fallback). The cycle counter and the period sort read these.
function parsePeriodLabel(label) {
  const s = String(label || '').trim();
  const parts = s.split(' - ');
  if (parts.length !== 2) return { start: null, end: null };
  const tailYear = /(\d{4})\s*$/.exec(parts[1]);
  const year = tailYear ? Number(tailYear[1]) : NaN;
  const parseSide = (side) => {
    const m = /^([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))?$/.exec(side.trim());
    if (!m) return null;
    const mi = MON.indexOf(m[1]);
    const y = m[3] ? Number(m[3]) : year;
    if (mi < 0 || !Number.isFinite(y)) return null;
    const d = new Date(y, mi, Number(m[2]));
    return isNaN(d.getTime()) ? null : d;
  };
  const end = parseSide(parts[1]);
  const start = parseSide(parts[0]);
  return { start, end };
}

// the period name for the screen: an en dash between the two dates
const displayLabel = (label) => String(label || '').replace(' - ', ' – ');

module.exports = { formatPeriod, periodFromReportName, parsePeriodLabel, displayLabel, MON };
