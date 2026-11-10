'use strict';
// End-to-end check of server/dws-hub.js + src/main/hubsync.js with plain
// Node (no Electron): a real hub on a free port, desktops simulated as
// separate hubsync instances, each on its own local folder.
//   node server/test-hub.js
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dws-hub-test-'));
const TOKEN = 'test-token-0123456789abcdef';
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(100); }
  return false;
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

let hub = null;
async function startHub(port) {
  hub = spawn(process.execPath, [path.join(__dirname, 'dws-hub.js')], {
    env: { ...process.env, HUB_TOKEN: TOKEN, HUB_DATA: path.join(root, 'hub'), PORT: String(port) },
    stdio: 'ignore',
  });
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/v1/health`)).ok; } catch { return false; } });
}
function stopHub() { return new Promise(r => { hub.once('exit', r); hub.kill(); }); }

// each desktop gets its own copy of the module (module state is per desktop)
function desktop(name) {
  const modPath = require.resolve('../src/main/hubsync.js');
  delete require.cache[modPath];
  const m = require(modPath);
  const dir = path.join(root, name, 'shared');
  return { m, dir, name, file: (prefix) => path.join(dir, `${prefix}-${name}.jsonl`), statePath: path.join(root, name, 'hub-state.json') };
}

(async () => {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  await startHub(port);

  // a Drive folder from before the move: A's returns and B's stock log
  const drive = path.join(root, 'drive');
  fs.mkdirSync(drive, { recursive: true });
  fs.writeFileSync(path.join(drive, 'returns-A.jsonl'), '{"v":1,"gid":"A:1","ts":1}\n{"v":1,"gid":"A:2","ts":2}\n');
  fs.writeFileSync(path.join(drive, 'stocklog-B.jsonl'), '{"gid":"B:1"}\n');
  fs.writeFileSync(path.join(drive, 'returns-log.csv'), 'not synced\n');

  const A = desktop('A');
  const imp = await A.m.importFolder(drive, { url, key: TOKEN });
  check(imp.ok && imp.sent === 2, `import from the old Drive folder sends the 2 log files (sent ${imp.sent})`);
  const again = await A.m.importFolder(drive, { url, key: TOKEN });
  check(again.ok && again.sent === 0, 'a second import sends nothing');

  const t = await A.m.test(url, TOKEN);
  check(t.ok && t.stations.join() === 'A,B', `test connection lists stations A,B (${t.stations})`);
  const bad = await A.m.test(url, 'wrong-key-wrong-key');
  check(!bad.ok && /refused/.test(bad.error), 'a wrong key is refused');

  await A.m.configure({ url, key: TOKEN, station: 'A', dir: A.dir, statePath: A.statePath });
  check(read(A.file('returns')) === '{"v":1,"gid":"A:1","ts":1}\n{"v":1,"gid":"A:2","ts":2}\n', "A gets its own history back from the hub on first sync");
  check(read(path.join(A.dir, 'stocklog-B.jsonl')) === '{"gid":"B:1"}\n', "A gets B's stock log");
  check(fs.existsSync(path.join(A.dir, 'presence-token.txt')), 'A has a presence token');

  const B = desktop('B');
  await B.m.configure({ url, key: TOKEN, station: 'B', dir: B.dir, statePath: B.statePath });
  check(read(path.join(B.dir, 'returns-A.jsonl')) !== null, "B gets A's returns");
  check(read(path.join(A.dir, 'presence-token.txt')) === read(path.join(B.dir, 'presence-token.txt')), 'A and B share one presence token');

  // A writes: B sees it within about a second
  let t0 = Date.now();
  fs.appendFileSync(A.file('returns'), '{"v":1,"gid":"A:3","ts":3}\n');
  const arrived = await until(() => (read(path.join(B.dir, 'returns-A.jsonl')) || '').includes('A:3'));
  check(arrived, `A's new return reaches B (${Date.now() - t0} ms)`);

  // a half-written line is held back until it is finished
  fs.appendFileSync(A.file('returns'), '{"v":1,"gid":"A:4"');
  await sleep(1500);
  check(!(read(path.join(B.dir, 'returns-A.jsonl')) || '').includes('A:4'), 'a half-written line is not sent');
  fs.appendFileSync(A.file('returns'), ',"ts":4}\n');
  check(await until(() => (read(path.join(B.dir, 'returns-A.jsonl')) || '').includes('"A:4","ts":4}')), 'the finished line is sent');

  // B writes a brand-new record type
  t0 = Date.now();
  fs.appendFileSync(B.file('costs'), '{"sku":"X","cost":5}\n');
  check(await until(() => read(path.join(A.dir, 'costs-B.jsonl')) === '{"sku":"X","cost":5}\n'), `B's new costs file reaches A (${Date.now() - t0} ms)`);

  // the server goes away: writes keep landing locally and upload later
  await stopHub();
  fs.appendFileSync(A.file('returns'), '{"v":1,"gid":"A:5","ts":5}\n');
  fs.appendFileSync(B.file('costs'), '{"sku":"Y","cost":7}\n');
  await sleep(1500);
  check(A.m.getStatus().online === false, 'A reports offline while the server is down');
  await startHub(port);
  check(await until(() => (read(path.join(B.dir, 'returns-A.jsonl')) || '').includes('A:5'), 30000), 'a return written while offline reaches B once the server is back');
  check(await until(() => (read(path.join(A.dir, 'costs-B.jsonl')) || '').includes('"Y"'), 30000), 'a cost written while offline reaches A once the server is back');
  check(await until(() => A.m.getStatus().online === true, 30000), 'A reports online again');

  // the same station name on a second computer: lines from both survive
  const A2 = desktop('A');
  A2.dir = path.join(root, 'A2', 'shared');
  A2.statePath = path.join(root, 'A2', 'hub-state.json');
  fs.mkdirSync(A2.dir, { recursive: true });
  fs.writeFileSync(path.join(A2.dir, 'returns-A.jsonl'), '{"v":1,"gid":"A:1","ts":1}\n{"v":1,"gid":"A:99","ts":99}\n');
  await A2.m.configure({ url, key: TOKEN, station: 'A', dir: A2.dir, statePath: A2.statePath });
  const merged = read(path.join(A2.dir, 'returns-A.jsonl')) || '';
  check(merged.includes('A:5') && merged.includes('A:99') && merged.split('A:1"').length === 2, 'diverged copies of one file merge without losing or doubling lines');
  check(await until(() => (read(path.join(B.dir, 'returns-A.jsonl')) || '').includes('A:99')), 'the merged line reaches B');
  A2.m.stop();

  // the app REWRITES its own file (retsync auxEnsure rebuilds a short file
  // from its rows): different bytes, longer — nothing torn, nothing lost
  const before = read(B.file('costs'));
  fs.writeFileSync(B.file('costs'), '{"sku":"W","cost":1}\n{"sku":"X","cost":5}\n{"sku":"Y","cost":7}\n{"sku":"Q","cost":2}\n');
  check(await until(() => (read(path.join(A.dir, 'costs-B.jsonl')) || '').includes('"Q"')), 'a rewritten own file reaches A');
  const costLines = (read(path.join(root, 'hub', 'files', 'costs-B.jsonl')) || '').split('\n').filter(Boolean);
  check(costLines.every(l => { try { JSON.parse(l); return true; } catch { return false; } }), 'no torn lines after a rewrite');
  check(['"W"', '"X"', '"Y"', '"Q"'].every(k => costLines.some(l => l.includes(k))) && costLines.length === new Set(costLines).size, `every line kept once after a rewrite (${costLines.length} lines; was ${before.split('\n').filter(Boolean).length})`);

  // no line is ever doubled on the server
  const serverText = read(path.join(root, 'hub', 'files', 'returns-A.jsonl')) || '';
  const lines = serverText.split('\n').filter(Boolean);
  check(lines.length === new Set(lines).size, `no duplicate lines on the server (${lines.length} lines)`);

  // removing a retired station on one desktop removes it everywhere
  const C = desktop('C');
  fs.mkdirSync(C.dir, { recursive: true });
  fs.writeFileSync(path.join(C.dir, 'returns-GONE.jsonl'), 'x\n'); // never synced: must be kept
  await C.m.configure({ url, key: TOKEN, station: 'C', dir: C.dir, statePath: C.statePath });
  check(fs.existsSync(path.join(C.dir, 'returns-A.jsonl')), "C has A's returns");
  A.m.stop(); // A is retired
  const del = await B.m.deleteRemote('returns-A.jsonl');
  check(del.ok, 'delete a station file');
  check(await until(() => !fs.existsSync(path.join(C.dir, 'returns-A.jsonl')) && !fs.existsSync(path.join(B.dir, 'returns-A.jsonl'))), 'the removed file leaves the other desktops');
  check(fs.existsSync(path.join(C.dir, 'returns-GONE.jsonl')), 'a local file the hub never had is left alone');
  // a station still running re-uploads its file, as it did on the Drive folder
  await C.m.deleteRemote('costs-B.jsonl');
  fs.appendFileSync(B.file('costs'), '{"sku":"Z","cost":9}\n');
  check(await until(() => (read(path.join(C.dir, 'costs-B.jsonl')) || '').includes('"Z"') && (read(path.join(C.dir, 'costs-B.jsonl')) || '').includes('"X"')), 'a live station removed by mistake comes back whole');

  // bad names never reach the server
  const r = await fetch(`${url}/v1/file/${encodeURIComponent('../etc-passwd.jsonl')}`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}` }, body: 'x' });
  check(r.status === 400 || r.status === 404, `a path-like name is refused (${r.status})`);
  const noAuth = await fetch(`${url}/v1/list`);
  check(noAuth.status === 401, 'no key, no listing');

  A.m.stop(); B.m.stop(); C.m.stop();
  await stopHub();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); try { await stopHub(); } catch { /* */ } process.exit(1); });
