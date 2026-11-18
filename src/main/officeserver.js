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
const { importFolder, checkFolder, reportText } = require('../../server/import-folder');

let live = null;   // { port, db, runBackup, close } while the server runs
let error = '';
let lastPort = 8790;

const dataDir = (userData) => path.join(userData, 'dws-server');

async function stop() {
  const s = live;
  live = null;
  if (s) { try { await s.close(); } catch { /* already closed */ } }
}

// boot and every settings change: (re)start to match the setting
async function configure({ enabled, port, backupDir, userData }) {
  await stop();
  lastPort = Number(port) || 8790;
  if (!enabled) { error = ''; return; }
  try {
    live = await start({ data: dataDir(userData), port: lastPort, host: '0.0.0.0', backupDir: backupDir || '', quiet: true });
    error = '';
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

function info(enabled) {
  let records = 0; let logins = 0; let lastBackup = '';
  if (live) {
    try {
      records = live.db.counts().reduce((n, t) => n + t.count, 0);
      logins = live.db.userCount();
      lastBackup = live.db.meta.get('lastBackup') || '';
    } catch { /* closing */ }
  }
  return { ok: true, enabled: !!enabled, running: !!live, error, port: lastPort, local: `http://localhost:${lastPort}`,
    addresses: live ? addresses() : [], records, logins, lastBackup };
}

// a dry run of bringing the shared folder in: a report, nothing changed
function check(folder, compare) {
  try { return { ok: true, text: reportText(checkFolder(folder), { compare }) }; }
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
    return { ok: true, text: reportText(rep, { changed: true, compare }) };
  } catch (e) {
    return { ok: false, error: `That folder could not be brought in: ${e.message}` };
  }
}

module.exports = { configure, stop, info, check, bringIn, running: () => !!live };
