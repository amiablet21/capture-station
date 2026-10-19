// What the bot says, worked out from the 30-day sales export rows
// (src/main/sales-export.js) plus the bot's own "bought" notes. Pure — no
// network, no WhatsApp — so test.js can run it on made-up rows.

// open box / used / scrap listings are resold returns, never bought in
// (the same patterns as the Stock page's condition chips, config.stockViews)
const CONDITION_PATTERNS = [/OPEN[\s-]?BOX/i, /(^|[^A-Za-z])USED($|[^A-Za-z])/i, /(^|[^A-Za-z])SCRAP($|[^A-Za-z])/i];
export const isConditionSku = (sku) => CONDITION_PATTERNS.some(re => re.test(String(sku || '')));

const BUY_STATUSES = ['Out of stock', 'Order now', 'Order soon'];

const shortTitle = (t, n = 30) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const perDayText = (n) => `${Number(n || 0).toFixed(1)}/day`;
// out of stock but a Linnworks PO already covers it: say so instead of "buy 0"
const buyText = (r) => r.buy ? `*buy ${r.buy}*` : `due in ${r.due}`;
const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
export const dayLabel = (d = new Date()) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// bought notes that have done their job: the stock arrived (on hand rose by
// half the bought qty or more), a Linnworks PO now carries it (Due in), or
// it is older than maxDays. Returns the SKUs to drop.
export function settledBought(rows, bought, { now = Date.now(), maxDays = 21 } = {}) {
  const bySku = new Map(rows.map(r => [String(r.sku).toUpperCase(), r]));
  const done = [];
  for (const [sku, b] of Object.entries(bought || {})) {
    const r = bySku.get(sku);
    const ageDays = (now - Date.parse(b.at)) / 86400000;
    if (!(ageDays < maxDays)) { done.push(sku); continue; }
    if (!r) continue;
    if (r.onHand >= (Number(b.onHandAt) || 0) + Math.ceil(b.qty / 2)) done.push(sku);
    else if (r.due >= b.qty) done.push(sku);
  }
  return done;
}

// the shopping list: SKUs to buy grouped by urgency, less what has already
// been bought, plus what is on the way
export function shoppingList(rows, bought = {}) {
  const out = { out: [], now: [], soon: [], onTheWay: [] };
  for (const r of rows) {
    if (!BUY_STATUSES.includes(r.status) || isConditionSku(r.sku)) continue;
    const b = bought[String(r.sku).toUpperCase()];
    const buy = Math.max(0, (Number(r.order) || 0) - (b ? b.qty : 0));
    if (b) out.onTheWay.push({ ...r, bought: b });
    if (b && buy === 0) continue;
    const row = { ...r, buy };
    if (r.status === 'Out of stock') out.out.push(row);
    else if (r.status === 'Order now') out.now.push(row);
    else out.soon.push(row);
  }
  // bought SKUs that have dropped off the buy list still show as on the way
  for (const [sku, b] of Object.entries(bought)) {
    if (out.onTheWay.some(r => String(r.sku).toUpperCase() === sku)) continue;
    out.onTheWay.push({ sku: b.sku || sku, title: b.title || '', bought: b });
  }
  return out;
}

const MAX_LINES = 25; // per section, so a bad day still fits in one message

function section(head, rows, line) {
  if (!rows.length) return [];
  const shown = rows.slice(0, MAX_LINES).map(line);
  if (rows.length > MAX_LINES) shown.push(`…and ${rows.length - MAX_LINES} more`);
  return ['', head, ...shown];
}

export function formatShoppingList(list, { now = new Date(), leadDays = 7, dataAt = 0 } = {}) {
  const lines = [`🛒 *To buy — ${dayLabel(now)}*`];
  // Linnworks was unreachable just now: say how old the figures are
  const ageMin = dataAt ? Math.round((now.getTime() - dataAt) / 60000) : 0;
  if (ageMin > 30) lines.push(`⚠️ _Figures from ${ageMin >= 120 ? `${Math.round(ageMin / 60)} hours` : `${ageMin} min`} ago — Linnworks didn't answer._`);
  const left = (r) => r.daysLeft === '' ? `${r.onHand} left` : `${r.onHand} left (~${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'})`;
  lines.push(...section('🔴 *Out of stock*', list.out,
    r => `• ${r.sku} _${shortTitle(r.title)}_ — sells ${perDayText(r.perDay)} → ${buyText(r)}`));
  lines.push(...section(`🟠 *Order now* (runs out within ${leadDays} days)`, list.now,
    r => `• ${r.sku} _${shortTitle(r.title)}_ — ${left(r)}, ${perDayText(r.perDay)} → ${buyText(r)}`));
  lines.push(...section('🟡 *Order soon*', list.soon,
    r => `• ${r.sku} _${shortTitle(r.title)}_ — ${left(r)}, ${perDayText(r.perDay)} → ${buyText(r)}`));
  lines.push(...section('🚚 *On the way*', list.onTheWay,
    r => `• ${r.sku} — ${r.bought.qty} bought ${dayLabel(new Date(r.bought.at))}${r.bought.price ? ` @ ${money(r.bought.price)}` : ''}`));
  if (!list.out.length && !list.now.length && !list.soon.length) lines.push('', '✅ Nothing to buy right now.');
  const units = [...list.out, ...list.now, ...list.soon].reduce((s, r) => s + r.buy, 0);
  if (units) lines.push('', `Total: ${units.toLocaleString('en-US')} units`);
  lines.push('', '_Reply: bought SKU qty @ price · stock SKU · list · help_');
  return lines.join('\n');
}

// fast sellers that just hit zero (one message for all of them)
export function formatOutAlert(rows) {
  const lines = [`🚨 *Just sold out*`];
  for (const r of rows) lines.push(`• ${r.sku} _${shortTitle(r.title)}_ — was selling ${perDayText(r.perDay)} → *buy ${r.order || '?'}*`);
  return lines.join('\n');
}

export function formatStock(r, bought) {
  const lines = [`📦 *${r.sku}*`, shortTitle(r.title, 60)];
  lines.push(`Available ${r.available}${r.atWfs ? ` · at WFS ${r.atWfs}` : ''}${r.due ? ` · due in ${r.due}` : ''}`);
  lines.push(`Sold: ${r.sold7} this week · ${r.sold30} in 30 days (${perDayText(r.perDay)}${r.trend ? `, ${r.trend.toLowerCase()}` : ''})`);
  if (r.daysLeft !== '') lines.push(`Days left: ${r.daysLeft}`);
  const ch = [['Walmart', r.walmart], ['eBay', r.ebay], ['Temu', r.temu], ['Other', r.other]].filter(([, n]) => n > 0);
  if (ch.length) lines.push(ch.map(([k, n]) => `${k} ${n}`).join(' · '));
  lines.push(`Status: ${r.status}${r.order ? ` → buy ${r.order}` : ''}`);
  if (bought) lines.push(`🚚 ${bought.qty} bought ${dayLabel(new Date(bought.at))}${bought.price ? ` @ ${money(bought.price)}` : ''}`);
  return lines.join('\n');
}

export const HELP_TEXT = [
  '🤖 *What I understand*',
  '• *list* — the shopping list now',
  '• *stock S25* — stock and sales for a SKU',
  '• *bought S25 30 @ 405* — note a purchase (price optional)',
  '• *cancel S25* — remove a purchase note',
  '• *status* — is the bot healthy',
  'The list arrives every evening, and I post right away when a fast seller sells out.',
].join('\n');

// one chat line → { cmd, ... } or null when it is not meant for the bot
export function parseCommand(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const [word, ...rest] = t.split(' ');
  const cmd = word.toLowerCase().replace(/^[/!]/, '');
  const arg = rest.join(' ');
  switch (cmd) {
    case 'help': case 'list': case 'status': case 'setup': case 'whoami':
      return rest.length ? null : { cmd };
    case 'stock': case 'cancel':
      return arg ? { cmd, sku: arg } : { cmd, error: `Which SKU? e.g. *${cmd} S25*` };
    case 'bought': {
      // bought <sku> <qty> [@|at|for] [$]<price>
      const m = arg.match(/^(\S+)\s+(\d+)(?:\s*(?:@|at|for)?\s*\$?\s*(\d+(?:\.\d+)?))?$/i);
      if (!m) return { cmd, error: 'Write it like *bought S25 30 @ 405* (price optional).' };
      const qty = Number(m[2]);
      if (!(qty > 0)) return { cmd, error: 'The quantity has to be more than 0.' };
      return { cmd, sku: m[1], qty, price: m[3] ? Number(m[3]) : null };
    }
    default:
      return null;
  }
}

// a typed SKU (or part of one) → the row. Exact match wins; otherwise a
// single SKU containing the text; several = ask which.
export function matchSku(rows, typed) {
  const q = String(typed || '').trim().toUpperCase();
  if (!q) return { error: 'Which SKU?' };
  const exact = rows.find(r => String(r.sku).toUpperCase() === q);
  if (exact) return { row: exact };
  const hits = rows.filter(r => String(r.sku).toUpperCase().includes(q) && !isConditionSku(r.sku));
  if (hits.length === 1) return { row: hits[0] };
  if (!hits.length) return { error: `No SKU matches "${typed}".` };
  // prefer the ones that are actually moving
  hits.sort((a, b) => b.perDay - a.perDay);
  const list = hits.slice(0, 8).map(r => `• ${r.sku}`).join('\n');
  return { error: `"${typed}" matches ${hits.length} SKUs — which one?\n${list}${hits.length > 8 ? '\n…' : ''}` };
}
