/**
 * Human-readable report period labels, e.g. "May 30 - Jun 12, 2026".
 * Used for the output filename and the past-reports list, so labels must
 * stay filesystem-safe (letters, digits, spaces, comma, hyphen only).
 */
function fmt(d) {
  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
}

function formatPeriod(start, end) {
  if (!start || !end) return null;
  if (start.getFullYear() === end.getFullYear()) {
    return `${fmt(start)} - ${fmt(end)}, ${end.getFullYear()}`;
  }
  return `${fmt(start)}, ${start.getFullYear()} - ${fmt(end)}, ${end.getFullYear()}`;
}

module.exports = { formatPeriod };
