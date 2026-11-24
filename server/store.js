'use strict';
// DWS Server storage: one SQLite database on the office computer that every
// DWS Stock desktop shares, in place of the per-station log files in the
// Google Drive folder (owner 2026-11-18: "a local server on a separate
// computer in the office ... they all basically have their own logins").
//
// What lives here:
//   users, sessions   one login per person, each with a role
//   records           every shared record, one row each. `kind` says what it
//                     is (a return, a stock change, a packed order ...) and
//                     `area` which of the five sections it belongs to
//   history           every change to a record: who, when, from which
//                     computer, and the record before and after
//   claims            short "I am working on this order" holds, so two
//                     computers cannot both buy a label for one PO#
//
// Every edit carries the version it was made from. An edit made from an old
// version is refused and handed the current record instead of overwriting it.

const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildStatement } = require('../src/main/recovery/statement');

const AREAS = [
  ['returns', 'Returns'],
  ['stock', 'Stock'],
  ['orders', 'Orders'],
  ['pricing', 'Pricing'],
  ['recovery', 'Recovery'],
];

const str = (v) => (v === null || v === undefined ? '' : String(v));
const money = (v) => {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return '';
  const n = Number(v);
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const stationOf = (id) => { const s = str(id); const cut = s.lastIndexOf(':'); return cut > 0 ? s.slice(0, cut) : ''; };
const CHANNEL = { WALMART: 'Walmart', EBAY: 'eBay', TEMU: 'Temu', 'TEMU US': 'Temu' };
const channel = (v) => CHANNEL[str(v).toUpperCase()] || str(v);
const CONDITION = { new: 'New', openbox: 'Open box', used: 'Used', scrap: 'Scrap' };
const itemList = (items, fn) => (Array.isArray(items) ? items : []).map(fn).filter(Boolean).join(', ');

// Each kind of record: its section, what it is called, the permission that
// writes it (and reads it, for the private ones), when it happened, and how
// it reads as one row of a table. `fixed` kinds are logs: added, never edited.
const KINDS = {
  return: {
    area: 'returns', label: 'Returns', one: 'Return', write: 'returns',
    when: (d) => d.created_at,
    title: (d) => `${channel(d.source)} ${str(d.order_number)}`.trim(),
    cols: ['Date', 'Order #', 'Channel', 'Customer', 'Items', 'Tracking', 'Received by', 'Note', 'Computer'],
    row: (d, r) => [d.created_at, d.order_number, channel(d.source), d.customer,
      itemList(d.items, (it) => `${it.sku || '?'} ×${it.qty ?? 1}${it.condition ? ` (${CONDITION[it.condition] || it.condition})` : ''}`),
      d.tracking, d.received_by, d.note, d.station || stationOf(r.id)],
  },
  stock_change: {
    area: 'stock', label: 'Stock changes', one: 'Stock change', write: 'stock', fixed: true,
    when: (d) => d.created_at,
    title: (d) => `${str(d.sku)} ${Number(d.delta) > 0 ? '+' : ''}${str(d.delta)}`,
    cols: ['Date', 'SKU', 'Change', 'Level after', 'Reason', 'Source', 'Note', 'By', 'Computer'],
    row: (d) => [d.created_at, d.sku, d.delta === null || d.delta === undefined ? '' : `${Number(d.delta) > 0 ? '+' : ''}${d.delta}`,
      d.level_after, d.reason, d.change_source, d.note, d.by, d.computer],
  },
  stock_import: {
    area: 'stock', label: 'Stock imports', one: 'Stock import', write: 'stock', fixed: true,
    when: (d) => d.ts,
    title: (d) => `${(d.rows || []).length} SKU${(d.rows || []).length === 1 ? '' : 's'} (${str(d.mode)})`,
    cols: ['Date', 'How', 'File', 'Lines', 'Computer'],
    row: (d) => [d.ts, d.mode, d.file, itemList(d.rows, (x) => `${x.sku} ${x.before ?? '?'}→${x.after ?? '?'}`), d.station],
  },
  cost: {
    area: 'stock', label: 'Costs', one: 'Cost', write: 'costs', read: 'costs',
    when: (d) => d.updated_at,
    title: (d) => `${str(d.sku)} ${money(d.cost)}`,
    cols: ['SKU', 'Cost', 'Changed', 'By', 'Computer'],
    row: (d) => [d.sku, money(d.cost), d.updated_at, d.by, d.station],
  },
  wfs_shipment: {
    area: 'stock', label: 'WFS shipments', one: 'WFS shipment', write: 'stock',
    when: (d) => d.ts,
    title: (d) => itemList(d.items, (it) => `${it.sku} ×${it.qty}`),
    cols: ['Date', 'Items', 'Note', 'Received at Walmart', 'Computer'],
    row: (d, r) => [d.ts, itemList(d.items, (it) => `${it.sku} ×${it.qty}`), d.note, d.received_at, d.station || stationOf(r.id)],
  },
  packed_order: {
    area: 'orders', label: 'Packed orders', one: 'Packed order', write: 'orders',
    when: (d) => d.created_at,
    title: (d) => `${channel(d.channel)} ${str(d.order_number)}`.trim(),
    cols: ['Date', 'Order #', 'Channel', 'Items', 'Tracking', 'Carrier', 'Status', 'Notes', 'Computer'],
    row: (d, r) => [d.created_at, d.order_number, channel(d.channel),
      itemList(d.items, (it) => (typeof it === 'string' ? it : `${it.sku || it.SKU || ''}${it.qty ? ` ×${it.qty}` : ''}`)),
      d.tracking, d.carrier, d.status, d.notes, d.station || stationOf(r.id)],
  },
  label: {
    area: 'orders', label: 'Shipping labels', one: 'Shipping label', write: 'orders',
    when: (d) => d.created_at,
    title: (d) => `${str(d.reference)} ${str(d.tracking)}`.trim(),
    cols: ['Date', 'PO # / reference', 'Carrier', 'Service', 'Tracking', 'Cost', 'Account', 'Voided', 'Computer'],
    row: (d, r) => [d.created_at, d.reference, d.carrier, d.service_name, d.tracking, money(d.cost), d.account_name,
      d.voided_at, d.station || stationOf(r.id)],
  },
  box_size: {
    area: 'orders', label: 'Box sizes', one: 'Box size', write: 'orders',
    when: (d) => d.ts,
    title: (d) => str(d.key),
    cols: ['SKU', 'Box', 'Weight (lb)', 'Size (in)', 'Changed', 'Computer'],
    row: (d) => { const p = d.pkg || {}; return [d.key, p.box, p.weight, [p.length, p.width, p.height].filter((x) => x !== undefined).join(' × '), d.ts, d.station]; },
  },
  sale: {
    area: 'pricing', label: 'Sales', one: 'Sale', write: 'orders', fixed: true,
    when: (d) => d.ts,
    title: (d) => `${channel(d.source)} ${str(d.ref)}`.trim(),
    cols: ['Date', 'Order #', 'Channel', 'Lines', 'Recorded by'],
    row: (d) => [d.ts, d.ref, channel(d.source), itemList(d.lines, (l) => `${l.c} ×${l.q ?? 1}`), d.station],
  },
  price_change: {
    area: 'pricing', label: 'Price changes', one: 'Price change', write: 'pricing', fixed: true,
    when: (d) => d.ts,
    title: (d) => `${str(d.sku || d.channelSku || d.c)} ${money(d.from ?? d.before)} → ${money(d.to ?? d.after ?? d.price)}`,
    cols: ['Date', 'SKU', 'Channel', 'From', 'To', 'How', 'By', 'Computer'],
    row: (d) => [d.ts, d.sku || d.channelSku || d.c, channel(d.channel || d.source), money(d.from ?? d.before),
      money(d.to ?? d.after ?? d.price), d.mode, d.by, d.station],
  },
  price_group: {
    area: 'pricing', label: 'Price groups', one: 'Price group', write: 'pricing',
    when: (d) => d.ts,
    title: (d) => `${str(d.child)} → ${str(d.parent)}`,
    cols: ['Listing', 'Grouped under', 'State', 'Changed', 'Computer'],
    row: (d) => [d.child, d.parent, d.state === 'ignored' ? 'Suggestion dismissed' : 'Grouped', d.ts, d.station],
  },
  wm_run: {
    area: 'recovery', label: 'Payment reports', one: 'Payment report', write: 'recovery', read: 'recovery',
    when: (d) => d.ranAt || d.ran_at,
    title: (d) => str(d.label),
    cols: ['Period', 'Payable', 'Paid to bank', 'Imported', 'Refunds', 'Seller-fulfilled', 'WFS', 'File', 'By', 'Computer'],
    row: (d) => [d.label, d.stmt && d.stmt.payable !== null ? money(d.stmt.payable) : '', d.stmt && d.stmt.paid ? money(d.stmt.paid) : '',
      d.ranAt || d.ran_at, d.totalRefunds ?? d.total_refunds, d.sellerCount ?? d.seller_count,
      d.wfsCount ?? d.wfs_count, d.csvName || d.csv_name, d.by, d.station],
  },
  wm_mark: {
    area: 'recovery', label: 'Case marks', one: 'Case mark', write: 'recovery', read: 'recovery',
    when: (d) => d.updated_at,
    title: (d) => `PO ${str(d.po)}`,
    cols: ['PO #', 'Case opened', 'Case ID', 'Approved', 'Paid out', 'Written off', 'Note', 'Changed', 'Computer'],
    row: (d) => [d.po, d.caseOpened ? (d.caseOpenedAt || 'yes') : '', d.caseId, d.caseApproved ? (d.caseApprovedAt || 'yes') : '',
      d.paidOut ? money(d.paidOut) : '', d.writtenOff ? (d.writtenOffAt || 'yes') : '', d.note, d.updated_at, d.station],
  },
  wm_expense: {
    area: 'recovery', label: 'Expenses', one: 'Expense', write: 'recovery', read: 'recovery',
    when: (d) => d.date || d.updated_at,
    title: (d) => `${str(d.category)} ${money(d.amount)}`,
    cols: ['Date', 'Category', 'Amount', 'SKU', 'Note', 'Computer'],
    row: (d) => [d.date, d.category, money(d.amount), d.sku, d.note, d.station],
  },
  wm_wfs_report: {
    area: 'recovery', label: 'WFS inventory reports', one: 'WFS inventory report', write: 'recovery', read: 'recovery',
    when: (d) => d.importedAt || d.imported_at,
    title: (d) => str(d.label),
    cols: ['Period', 'Imported', 'File', 'By', 'Computer'],
    row: (d) => [d.label, d.importedAt || d.imported_at, d.csvName || d.csv_name, d.by, d.station],
  },
};

// What each role may change. Everyone signed in can read; costs and Recovery
// are private and need their own permission to be seen at all.
const PERMS = ['returns', 'stock', 'costs', 'orders', 'pricing', 'recovery', 'admin'];
// A payment period's headline figures, kept on the record so the list can
// show them without opening every statement: what Walmart says is payable
// and what it sent to the bank. Null when the period has no statement lines.
function runTotals(lines) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const st = buildStatement(lines, '', 'cycle', '', [], []);
  return { payable: st.payable, paid: st.paidTotal, activity: st.activity };
}

const ROLES = {
  owner: { label: 'Owner', perms: PERMS },
  returns: { label: 'Returns room', perms: ['returns'] },
  stockroom: { label: 'Stock room', perms: ['orders'] },
  viewer: { label: 'View only', perms: [] },
};

function permsOf(user) {
  const role = ROLES[user.role] || ROLES.viewer;
  let extra = [];
  try { extra = JSON.parse(user.extra || '[]'); } catch { extra = []; }
  return [...new Set([...role.perms, ...extra.filter((p) => PERMS.includes(p))])];
}
const can = (user, perm) => !perm || permsOf(user).includes(perm);
const canRead = (user, kind) => !!KINDS[kind] && can(user, KINDS[kind].read);
const canWrite = (user, kind) => !!KINDS[kind] && can(user, KINDS[kind].write);

const CLAIM_MINUTES = 10;

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'viewer',
      extra TEXT NOT NULL DEFAULT '[]',
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      station TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      area TEXT NOT NULL,
      data TEXT NOT NULL,
      detail TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      deleted INTEGER NOT NULL DEFAULT 0,
      happened_at TEXT NOT NULL DEFAULT '',
      search TEXT NOT NULL DEFAULT '',
      src_ts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      station TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (kind, id)
    );
    CREATE INDEX IF NOT EXISTS records_list ON records (kind, deleted, happened_at);
    CREATE TABLE IF NOT EXISTS history (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      user TEXT NOT NULL DEFAULT '',
      station TEXT NOT NULL DEFAULT '',
      area TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT '',
      id TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      changed TEXT NOT NULL DEFAULT '',
      before TEXT,
      after TEXT,
      src_key TEXT UNIQUE
    );
    CREATE INDEX IF NOT EXISTS history_rec ON history (kind, id);
    CREATE INDEX IF NOT EXISTS history_ts ON history (ts);
    CREATE TABLE IF NOT EXISTS claims (
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      user TEXT NOT NULL,
      station TEXT NOT NULL DEFAULT '',
      ts TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (kind, key)
    );
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `);
  return api(db, file);
}

function api(db, file) {
  const now = () => new Date().toISOString();
  const listeners = new Set();
  const notify = (ev) => { for (const fn of listeners) { try { fn(ev); } catch { /* a closed stream */ } } };
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  /* ---------- users and sessions ---------- */
  const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
  const publicUser = (u) => u && ({ id: u.id, username: u.username, name: u.name || u.username, role: u.role,
    roleLabel: (ROLES[u.role] || ROLES.viewer).label, extra: JSON.parse(u.extra || '[]'), perms: permsOf(u), active: !!u.active });
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const listUsers = () => db.prepare('SELECT * FROM users ORDER BY username').all().map(publicUser);

  function checkUserInput({ username, password, role, extra }, needPw) {
    const name = str(username).trim().toLowerCase();
    if (username !== undefined && !/^[a-z0-9][a-z0-9._-]{1,30}$/.test(name)) throw new Error('A username is 2 to 31 letters, numbers, dots or dashes.');
    if ((needPw || password !== undefined) && str(password).length < 8) throw new Error('A password needs at least 8 characters.');
    if (role !== undefined && !ROLES[role]) throw new Error('Unknown role.');
    if (extra !== undefined && (!Array.isArray(extra) || extra.some((p) => !PERMS.includes(p)))) throw new Error('Unknown permission.');
    return name;
  }
  function createUser({ username, name, password, role = 'viewer', extra = [] }, actor) {
    const uname = checkUserInput({ username, password, role, extra }, true);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(uname)) throw new Error('That username is taken.');
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('INSERT INTO users (username, name, role, extra, salt, hash, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(uname, str(name).trim(), role, JSON.stringify(extra), salt, hashPw(password, salt), now());
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
    logHistory({ actor, action: 'user', summary: `Login created: ${uname} (${ROLES[role].label})` });
    return publicUser(u);
  }
  function updateUser(id, patch, actor) {
    const u = getUser(id);
    if (!u) throw new Error('No such login.');
    checkUserInput({ password: patch.password, role: patch.role, extra: patch.extra }, false);
    const next = {
      name: patch.name !== undefined ? str(patch.name).trim() : u.name,
      role: patch.role !== undefined ? patch.role : u.role,
      extra: patch.extra !== undefined ? JSON.stringify(patch.extra) : u.extra,
      active: patch.active !== undefined ? (patch.active ? 1 : 0) : u.active,
    };
    // the last working owner cannot be demoted or switched off
    const losingOwner = u.role === 'owner' && u.active && (next.role !== 'owner' || !next.active);
    if (losingOwner && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1").get().n <= 1) {
      throw new Error('This is the only owner login. Make another owner first.');
    }
    db.prepare('UPDATE users SET name = ?, role = ?, extra = ?, active = ? WHERE id = ?').run(next.name, next.role, next.extra, next.active, id);
    if (patch.password !== undefined) {
      const salt = crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE users SET salt = ?, hash = ? WHERE id = ?').run(salt, hashPw(patch.password, salt), id);
    }
    // a changed password or a switched-off login signs every device out
    if (patch.password !== undefined || !next.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    const what = [patch.role !== undefined && patch.role !== u.role ? `role ${ROLES[next.role].label}` : '',
      patch.password !== undefined ? 'new password' : '', patch.active !== undefined && !!patch.active !== !!u.active ? (next.active ? 'switched on' : 'switched off') : '',
      patch.extra !== undefined ? 'permissions' : ''].filter(Boolean).join(', ');
    logHistory({ actor, action: 'user', summary: `Login changed: ${u.username}${what ? ` (${what})` : ''}` });
    return publicUser(getUser(id));
  }

  const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
  function login(username, password, station) {
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(str(username).trim().toLowerCase());
    // the same work is done for an unknown name, so timing does not tell names apart
    const hash = hashPw(password, u ? u.salt : '00');
    if (!u || !u.active || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(u.hash))) return null;
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token_hash, user_id, station, created_at, last_seen) VALUES (?,?,?,?,?)')
      .run(tokenHash(token), u.id, str(station).slice(0, 40), now(), now());
    return { token, user: publicUser(u) };
  }
  function session(token) {
    if (!token) return null;
    const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash(token));
    if (!s) return null;
    const u = getUser(s.user_id);
    if (!u || !u.active) return null;
    if (Date.now() - Date.parse(s.last_seen) > 60000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now(), s.token_hash);
    return { user: u, station: s.station };
  }
  const logout = (token) => { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token)); };

  /* ---------- history ---------- */
  function logHistory({ actor, ts, area = '', kind = '', id = '', action, summary = '', changed = '', before = null, after = null, srcKey = null }) {
    const res = db.prepare(`INSERT OR IGNORE INTO history (ts, user, station, area, kind, id, action, summary, changed, before, after, src_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(ts || now(), (actor && actor.user) || '', (actor && actor.station) || '', area, kind, str(id), action, summary, changed,
      before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), srcKey);
    if (res.changes) notify({ seq: Number(res.lastInsertRowid), area, kind, id: str(id), action, by: (actor && actor.user) || '' });
    return res.changes;
  }
  function history({ area, kind, id, q, limit = 100, before, canSee }) {
    const where = ['1=1']; const args = [];
    if (area) { where.push('area = ?'); args.push(area); }
    if (kind) { where.push('kind = ?'); args.push(kind); }
    if (id) { where.push('id = ?'); args.push(str(id)); }
    if (before) { where.push('seq < ?'); args.push(Number(before)); }
    if (q) { where.push('(summary LIKE ? OR user LIKE ? OR station LIKE ? OR id LIKE ?)'); const p = `%${q}%`; args.push(p, p, p, p); }
    const rows = db.prepare(`SELECT seq, ts, user, station, area, kind, id, action, summary, changed FROM history
      WHERE ${where.join(' AND ')} ORDER BY ts DESC, seq DESC LIMIT ?`).all(...args, Math.min(500, Number(limit) || 100));
    return rows.filter((r) => !r.kind || !canSee || canSee(r.kind));
  }
  const historyEntry = (seq) => {
    const r = db.prepare('SELECT * FROM history WHERE seq = ?').get(Number(seq));
    if (!r) return null;
    return { ...r, before: r.before ? JSON.parse(r.before) : null, after: r.after ? JSON.parse(r.after) : null };
  };

  /* ---------- records ---------- */
  const searchText = (kind, data, id) => {
    const cells = KINDS[kind].row(data, { id }).map(str).join(' ');
    return `${id} ${cells}`.toLowerCase().slice(0, 4000);
  };
  const shape = (r, full) => r && ({
    kind: r.kind, id: r.id, version: r.version, deleted: !!r.deleted, updated_at: r.updated_at, updated_by: r.updated_by,
    created_at: r.created_at, created_by: r.created_by, station: r.station,
    cells: KINDS[r.kind].row(JSON.parse(r.data), r).map(str),
    ...(full ? { data: JSON.parse(r.data) } : {}),
  });
  const raw = (kind, id) => db.prepare('SELECT * FROM records WHERE kind = ? AND id = ?').get(kind, str(id));
  const get = (kind, id) => shape(raw(kind, id), true);
  // the bulky part of a record (a payment period's full statement), read
  // only when someone opens it
  const detail = (kind, id) => {
    const r = raw(kind, id);
    if (!r || r.deleted || !r.detail) return null;
    try { return JSON.parse(r.detail); } catch { return null; }
  };
  // One payment period as DWS Stock's Recovery page shows it. The owner's
  // own expenses are left out: this is Walmart's statement, and the
  // expenses have a list of their own.
  function runStatement(id) {
    const r = raw('wm_run', id);
    if (!r || r.deleted) return null;
    const d = detail('wm_run', id) || {};
    const run = JSON.parse(r.data);
    const st = buildStatement(Array.isArray(d.lines) ? d.lines : [], str(run.label), 'cycle', str(id), [run], []);
    return { ...st, refunds: (d.refunds || []).length };
  }
  // periods brought in before the totals were kept get them once, quietly:
  // the record itself is unchanged, so no version bump and no history line
  if (!db.prepare("SELECT v FROM meta WHERE k = 'runTotals'").get()) {
    for (const r of db.prepare("SELECT id, data, detail FROM records WHERE kind = 'wm_run' AND deleted = 0 AND detail IS NOT NULL").all()) {
      try {
        const data = JSON.parse(r.data);
        if (data.stmt !== undefined) continue;
        data.stmt = runTotals((JSON.parse(r.detail) || {}).lines);
        db.prepare("UPDATE records SET data = ?, search = ? WHERE kind = 'wm_run' AND id = ?").run(JSON.stringify(data), searchText('wm_run', data, r.id), r.id);
      } catch { /* an unreadable row stays as it is */ }
    }
    db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('runTotals', '1')").run();
  }

  function list(kind, { q = '', limit = 100, offset = 0 } = {}) {
    const where = ['kind = ?', 'deleted = 0']; const args = [kind];
    for (const word of str(q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) { where.push('search LIKE ?'); args.push(`%${word}%`); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM records WHERE ${where.join(' AND ')}`).get(...args).n;
    const rows = db.prepare(`SELECT kind, id, data, version, deleted, updated_at, updated_by, created_at, created_by, station FROM records
      WHERE ${where.join(' AND ')} ORDER BY happened_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...args, Math.min(500, Number(limit) || 100), Math.max(0, Number(offset) || 0));
    return { total, rows: rows.map((r) => shape(r, false)) };
  }

  const changedKeys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])]
    .filter((k) => JSON.stringify((a || {})[k]) !== JSON.stringify((b || {})[k]));

  function create(kind, data, actor, id) {
    const K = KINDS[kind];
    const rid = str(id) || `${(actor.station || 'SERVER').toUpperCase()}:${crypto.randomUUID()}`;
    return tx(() => {
      if (raw(kind, rid)) return { ok: false, conflict: 'exists', current: get(kind, rid) };
      const t = now();
      db.prepare(`INSERT INTO records (kind, id, area, data, version, happened_at, search, created_at, created_by, updated_at, updated_by, station)
        VALUES (?,?,?,?,1,?,?,?,?,?,?,?)`).run(kind, rid, K.area, JSON.stringify(data), str(K.when(data)) || t, searchText(kind, data, rid), t, actor.user, t, actor.user, actor.station || '');
      logHistory({ actor, area: K.area, kind, id: rid, action: 'create', summary: `${K.one} added: ${K.title(data)}`, after: data });
      return { ok: true, record: get(kind, rid) };
    });
  }

  // an edit names the version it started from; a stale one changes nothing
  function update(kind, id, data, version, actor) {
    const K = KINDS[kind];
    return tx(() => {
      const cur = raw(kind, id);
      if (!cur || cur.deleted) return { ok: false, conflict: 'gone', current: cur ? shape(cur, true) : null };
      if (Number(version) !== cur.version) return { ok: false, conflict: 'changed', current: shape(cur, true) };
      const before = JSON.parse(cur.data);
      const changed = changedKeys(before, data);
      if (!changed.length) return { ok: true, record: shape(cur, true), unchanged: true };
      const t = now();
      db.prepare('UPDATE records SET data = ?, version = version + 1, happened_at = ?, search = ?, updated_at = ?, updated_by = ? WHERE kind = ? AND id = ?')
        .run(JSON.stringify(data), str(K.when(data)) || cur.happened_at, searchText(kind, data, cur.id), t, actor.user, kind, cur.id);
      logHistory({ actor, area: K.area, kind, id: cur.id, action: 'edit', summary: `${K.one} edited: ${K.title(data)}`, changed: changed.join(', '), before, after: data });
      return { ok: true, record: get(kind, cur.id) };
    });
  }

  function remove(kind, id, version, actor) {
    const K = KINDS[kind];
    return tx(() => {
      const cur = raw(kind, id);
      if (!cur || cur.deleted) return { ok: true, already: true };
      if (Number(version) !== cur.version) return { ok: false, conflict: 'changed', current: shape(cur, true) };
      const before = JSON.parse(cur.data);
      db.prepare('UPDATE records SET deleted = 1, version = version + 1, updated_at = ?, updated_by = ? WHERE kind = ? AND id = ?').run(now(), actor.user, kind, cur.id);
      logHistory({ actor, area: K.area, kind, id: cur.id, action: 'delete', summary: `${K.one} deleted: ${K.title(before)}`, before });
      return { ok: true };
    });
  }

  // the importer's door: no history line per record, newest source wins
  function importPut(kind, id, data, { srcTs = 0, detail = null, station = '', deleted = false } = {}) {
    const K = KINDS[kind];
    const cur = raw(kind, id);
    if (cur && cur.updated_by !== 'import') return false; // changed on the server since: the server's copy stands
    if (cur && srcTs <= cur.src_ts) return false; // already here, nothing newer to say
    const t = now();
    const when = str(K.when(data)) || (srcTs ? new Date(srcTs).toISOString() : t);
    if (cur) {
      db.prepare('UPDATE records SET data = ?, detail = ?, deleted = ?, version = version + 1, happened_at = ?, search = ?, src_ts = ?, updated_at = ?, station = ? WHERE kind = ? AND id = ?')
        .run(JSON.stringify(data), detail, deleted ? 1 : 0, when, searchText(kind, data, id), srcTs, t, station || cur.station, kind, str(id));
    } else {
      db.prepare(`INSERT INTO records (kind, id, area, data, detail, version, deleted, happened_at, search, src_ts, created_at, created_by, updated_at, updated_by, station)
        VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?)`).run(kind, str(id), K.area, JSON.stringify(data), detail, deleted ? 1 : 0, when, searchText(kind, data, id), srcTs, t, 'import', t, 'import', station);
    }
    return true;
  }

  // how many live records of each kind, in section order (no login needed:
  // this is for the server's own computer, never sent to a browser as is)
  function counts() {
    const got = {};
    for (const r of db.prepare('SELECT kind, COUNT(*) AS n FROM records WHERE deleted = 0 GROUP BY kind').all()) got[r.kind] = r.n;
    const gone = {};
    for (const r of db.prepare('SELECT kind, COUNT(*) AS n FROM records WHERE deleted = 1 GROUP BY kind').all()) gone[r.kind] = r.n;
    return Object.entries(KINDS).map(([kind, K]) => ({ kind, area: K.area, label: K.label, count: got[kind] || 0, deleted: gone[kind] || 0 }));
  }

  function overview(user) {
    const counts = {};
    for (const r of db.prepare('SELECT kind, COUNT(*) AS n, MAX(happened_at) AS last FROM records WHERE deleted = 0 GROUP BY kind').all()) counts[r.kind] = r;
    return AREAS.map(([area, label]) => ({
      area, label,
      kinds: Object.entries(KINDS).filter(([k, K]) => K.area === area && canRead(user, k))
        .map(([k, K]) => ({ kind: k, label: K.label, one: K.one, cols: K.cols, fixed: !!K.fixed, canWrite: canWrite(user, k),
          count: counts[k] ? counts[k].n : 0, last: counts[k] ? counts[k].last : '' })),
    })).filter((a) => a.kinds.length);
  }

  /* ---------- claims: one computer at a time on an order ---------- */
  // "Check and claim" in one step. A PO# that already has a live label is
  // refused outright; otherwise the first computer to ask holds it for a
  // few minutes and everyone else is told who has it.
  function claimOrder(po, actor) {
    const key = str(po).trim().toUpperCase();
    if (!key) return { ok: false, reason: 'empty' };
    return tx(() => {
      const labels = db.prepare("SELECT id, data, station FROM records WHERE kind = 'label' AND deleted = 0 AND search LIKE ?").all(`%${key.toLowerCase()}%`);
      const live = labels.map((r) => ({ ...JSON.parse(r.data), _station: r.station || stationOf(r.id) }))
        .find((l) => str(l.reference).trim().toUpperCase() === key && !l.voided_at && !l.test);
      if (live) return { ok: false, reason: 'labelled', by: live._station, at: live.created_at, tracking: live.tracking || '' };
      const cur = db.prepare("SELECT * FROM claims WHERE kind = 'order' AND key = ?").get(key);
      const mine = cur && cur.user === actor.user && cur.station === (actor.station || '');
      if (cur && !mine && Date.parse(cur.expires_at) > Date.now()) return { ok: false, reason: 'claimed', by: cur.user, station: cur.station, at: cur.ts };
      const t = now();
      db.prepare("INSERT OR REPLACE INTO claims (kind, key, user, station, ts, expires_at) VALUES ('order', ?, ?, ?, ?, ?)")
        .run(key, actor.user, actor.station || '', t, new Date(Date.now() + CLAIM_MINUTES * 60000).toISOString());
      return { ok: true, key, until: new Date(Date.now() + CLAIM_MINUTES * 60000).toISOString() };
    });
  }
  function releaseOrder(po, actor, force) {
    const key = str(po).trim().toUpperCase();
    const cur = db.prepare("SELECT * FROM claims WHERE kind = 'order' AND key = ?").get(key);
    if (!cur) return { ok: true };
    if (!force && cur.user !== actor.user) return { ok: false, reason: 'not yours' };
    db.prepare("DELETE FROM claims WHERE kind = 'order' AND key = ?").run(key);
    return { ok: true };
  }

  /* ---------- backup ---------- */
  // a full, consistent copy of the database; the newest `keep` are kept
  function backup(dir, keep = 14) {
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dest = path.join(dir, `dws-server-${day}.sqlite`);
    fs.rmSync(dest, { force: true });
    db.prepare('VACUUM INTO ?').run(dest);
    const old = fs.readdirSync(dir).filter((n) => /^dws-server-\d{4}-\d{2}-\d{2}\.sqlite$/.test(n)).sort().reverse().slice(keep);
    for (const n of old) fs.rmSync(path.join(dir, n), { force: true });
    return dest;
  }

  const meta = {
    get: (k) => { const r = db.prepare('SELECT v FROM meta WHERE k = ?').get(k); return r ? r.v : null; },
    set: (k, v) => { db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(k, str(v)); },
  };

  return {
    file, tx, close: () => db.close(), onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    userCount, listUsers, createUser, updateUser, publicUser, login, session, logout,
    logHistory, history, historyEntry,
    get, detail, runStatement, list, create, update, remove, importPut, overview, counts,
    changed: (ev) => notify(ev || {}),
    claimOrder, releaseOrder, backup, meta,
  };
}

module.exports = { open, runTotals, KINDS, AREAS, ROLES, PERMS, permsOf, can, canRead, canWrite, stationOf };
