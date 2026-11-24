'use strict';
// The office server inside DWS Stock (owner 2026-11-18: "build it into DWS
// Stock"). One computer in the office ticks Settings › General › "This
// computer is the server"; this module then runs DWS Server (server/) in
// this app's own process: one shared database, a login per person, a
// history of every change. Off by default, and nothing on any computer
// talks to it until that computer is pointed at it.
//
// The database lives in this computer's userData (dws-server/), beside the
// app's own, never inside the shared Drive folder.

const os = require('node:os');
const path = require('node:path');
const { start } = require('../../server/dws-server');
const { importFolder, checkFolder, reportText, summarize, keepCurrent } = require('../../server/import-folder');

let live = null;   // { port, db, runBackup, close } while the server runs
let topUp = null;  // the automatic bring-in from the shared Drive folder, while the server runs
let error = '';
let lastPort = 8790;

const dataDir = (userData) => path.join(userData, 'dws-server');

async function stop() {
  const s = live;
  live = null;
  if (topUp) { topUp.stop(); topUp = null; }
  if (s) { try { await s.close(); } catch { /* already closed */ } }
}

// boot and every settings change: (re)start to match the setting
// `folder`: a function giving this computer's shared Drive folder. While
// the server runs it tops itself up from that folder every two minutes
// (only reading it), so what the computers save through Drive shows on the
// server without anyone pressing Bring in.
// `app`: asks DWS Stock itself for what its Stock and Recovery pages
// show, so the server's page can draw the same thing (read only).
async function configure({ enabled, port, backupDir, userData, folder, app }) {
  await stop();
  lastPort = Number(port) || 8790;
  if (!enabled) { error = ''; return; }
  try {
    live = await start({ data: dataDir(userData), port: lastPort, host: '0.0.0.0', backupDir: backupDir || '', quiet: true, app: typeof app === 'function' ? app : null });
    error = '';
    if (typeof folder === 'function') topUp = keepCurrent(live.db, folder);
  } catch (e) {
    error = e && e.code === 'EADDRINUSE' ? `Port ${lastPort} is in use by another program.` : String((e && e.message) || e);
  }
}

// the addresses another computer in the office can type: this computer's
// name first (it does not change), then its numbers on the network
function addresses() {
  const out = [`http://${os.hostname()}:${lastPort}`];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${lastPort}`);
  }
  return [...new Set(out)];
}

function info(enabled, backupDir) {
  let records = 0; let logins = 0; let lastBackup = ''; let backupError = '';
  if (live) {
    try {
      records = live.db.counts().reduce((n, t) => n + t.count, 0);
      logins = live.db.userCount();
      lastBackup = live.db.meta.get('lastBackup') || '';
      backupError = live.db.meta.get('lastBackupError') || '';
    } catch { /* closing */ }
  }
  return { ok: true, enabled: !!enabled, running: !!live, error, port: lastPort, local: `http://localhost:${lastPort}`,
    addresses: live ? addresses() : [], records, logins, lastBackup, backupError, backupDir: String(backupDir || ''),
    topUp: topUp ? { ...topUp.status } : null };
}

// a dry run of bringing the shared folder in: a report, nothing changed
function check(folder, compare) {
  try { const rep = checkFolder(folder); return { ok: true, summary: summarize(rep, { compare }), text: reportText(rep, { compare }) }; }
  catch (e) { return { ok: false, error: `That folder could not be read: ${e.message}` }; }
}

// the real thing: the folder's records into the server's database. The
// folder is only read. Safe to press again; only what is new comes in.
function bringIn(folder, compare) {
  if (!live) return { ok: false, error: 'Turn the server on first.' };
  try {
    const res = importFolder(live.db, folder);
    const rep = { ...res, totals: live.db.counts(), files: 0, folder };
    try { rep.files = require('node:fs').readdirSync(folder).filter((n) => /\.jsonl$/.test(n)).length; } catch { /* count only */ }
    return { ok: true, summary: summarize(rep, { changed: true, compare }), text: reportText(rep, { changed: true, compare }) };
  } catch (e) {
    return { ok: false, error: `That folder could not be brought in: ${e.message}` };
  }
}

// a full copy of the database now: into this computer's own backups and,
// when a second folder is set, into that folder too
function backupNow() {
  if (!live) return { ok: false, error: 'Turn the server on first.' };
  live.runBackup();
  const err = live.db.meta.get('lastBackupError') || '';
  return err ? { ok: false, error: `The backup did not finish: ${err.replace(/^\S+ /, '')}` } : { ok: true };
}

// Forgotten passwords (owner 2026-11-18). Anyone's password can be set from
// the Logins tab by an owner; this is for when the owner's own is lost. It
// only works from DWS Stock on the server computer itself, never from a
// browser, and signs that login out everywhere.
function logins() {
  if (!live) return { ok: false, error: 'Turn the server on first.', logins: [] };
  return { ok: true, logins: live.db.listUsers().map((u) => ({ id: u.id, username: u.username, name: u.name, role: u.roleLabel, active: u.active })) };
}
function resetPassword(id, password) {
  if (!live) return { ok: false, error: 'Turn the server on first.' };
  try {
    const u = live.db.updateUser(Number(id), { password: String(password || '') }, { user: 'server computer', station: os.hostname().toUpperCase() });
    return { ok: true, username: u.username };
  } catch (e) { return { ok: false, error: e.message }; }
}

// one look at the folder now (the tests use it; the timer does the rest)
const topUpNow = () => (topUp ? topUp.run() : Promise.resolve(null));

module.exports = { configure, stop, info, check, bringIn, backupNow, logins, resetPassword, topUpNow, running: () => !!live };
