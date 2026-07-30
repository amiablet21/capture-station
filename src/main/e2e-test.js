'use strict';
// Automated end-to-end test, run with CAPTURE_E2E=1 against a throwaway userData dir.
// Flow under test: copy PO# -> scan tracking -> row complete (serial tracking retired).

const { distributeSerials } = require('./sync');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;

function check(name, cond, extra) {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name}${extra ? ` :: ${JSON.stringify(extra)}` : ''}`);
  }
}

module.exports = async function run({ app, win, db, clipboard }) {
  const savedClipboard = clipboard.readText();
  try {
    await sleep(1500); // let renderer boot and clipboard watcher prime

    const exec = (js) => win.webContents.executeJavaScript(js, true);

    // 0. renderer script actually executed (CSP not blocking it)
    const rendererAlive = await exec('typeof window.focusScan');
    check('renderer.js executed', rendererAlive === 'function', rendererAlive);

    // 1. Walmart order via clipboard
    clipboard.writeText('119121297240391');
    await sleep(900);
    let row = db.findByOrderNumber('119121297240391');
    check('clipboard ingests walmart order', !!row && row.channel === 'walmart', row);

    let state = await exec('api.getState()');
    check('current row opened, expecting tracking', state.currentRowId === row.id && state.expecting === 'tracking', state);

    // 2. Garbage clipboard text is ignored
    clipboard.writeText('john.customer@example.com');
    await sleep(700);
    state = await exec('api.getState()');
    check('email ignored by watcher', state.rows.length === 1, state.rows.length);

    // 3. Junk scan warns instead of saving garbage
    let res = await exec(`api.submitScan('x', false)`);
    check('junk scan needs confirm', res.ok === false && res.needsConfirm === true, res);

    // 4. Tracking scan (UPS) completes and closes the order
    res = await exec(`api.submitScan('1ZF98W401234567890', false)`);
    check('UPS tracking accepted', res.ok === true && res.kind === 'tracking' && res.carrier === 'UPS', res);
    row = db.getRow(row.id);
    check('row captured after tracking', row.status === 'captured', row.status);
    state = await exec('api.getState()');
    check('row auto-closed after tracking', state.currentRowId === null, state.currentRowId);

    // 5. Scan with no open order is rejected
    res = await exec(`api.submitScan('1ZF98W401234567891', false)`);
    check('scan without open order rejected', res.ok === false && !!res.error, res);

    // 6. Undo clears tracking and reopens the order
    res = await exec('api.undo()');
    row = db.getRow(row.id);
    state = await exec('api.getState()');
    check('undo cleared tracking and reopened', res.ok === true && row.tracking === '' && state.currentRowId === row.id, { tracking: row.tracking, current: state.currentRowId });

    // 7. Re-scan tracking
    await exec(`api.submitScan('1ZF98W401234567890', false)`);
    row = db.getRow(row.id);
    check('re-scan restored tracking', row.tracking === '1ZF98W401234567890' && row.status === 'captured', row);

    // 8. eBay and Temu orders via clipboard
    clipboard.writeText('02-12345-67890');
    await sleep(900);
    const ebayRow = db.findByOrderNumber('02-12345-67890');
    check('ebay order ingested', !!ebayRow && ebayRow.channel === 'ebay', ebayRow);

    clipboard.writeText('PO-211-1234567890123');
    await sleep(900);
    const temuRow = db.findByOrderNumber('PO-211-1234567890123');
    check('temu order ingested', !!temuRow && temuRow.channel === 'temu', temuRow);

    // 9. Duplicate order rejected
    clipboard.writeText('119121297240391');
    await sleep(900);
    state = await exec('api.getState()');
    const walmartRows = state.rows.filter(r => r.order_number === '119121297240391');
    check('duplicate order not re-added', walmartRows.length === 1, state.rows.length);

    // 10. Edit adds tracking and notes, requeues row
    await exec(`api.updateRow(${ebayRow.id}, { tracking: '9234567890123456789012', notes: 'IMEI 355123450987654, resold unit' })`);
    const edited = db.getRow(ebayRow.id);
    check('edit saves tracking + notes', edited.tracking === '9234567890123456789012' && edited.notes.includes('355123450987654') && edited.status === 'captured', edited);

    // 11. Delete row
    await exec(`api.deleteRow(${temuRow.id})`);
    check('delete row works', db.getRow(temuRow.id) === null, null);

    // 12. distributeSerials pure logic (dormant sync path)
    const d1 = distributeSerials([{ rowId: 'A', quantity: 2 }], ['s1', 's2']);
    check('serials qty2 single line', d1.assignments.length === 1 && d1.assignments[0].serials.length === 2, d1);
    const d2 = distributeSerials([{ rowId: 'A', quantity: 1 }, { rowId: 'B', quantity: 2 }], ['s1', 's2', 's3']);
    check('serials split across lines by qty', d2.assignments.length === 2 && d2.assignments[1].serials.join(',') === 's2,s3', d2);

    // 13. rowsToSync picks captured rows
    const toSync = db.rowsToSync();
    check('rowsToSync returns captured rows', toSync.length === 2, toSync.map(r => [r.order_number, r.status]));

    // 14. capture-only mode: sync refused, daily CSV mirror written with notes
    state = await exec('api.getState()');
    check('capture-only is default', state.captureOnly === true, state.captureOnly);
    res = await exec('api.runSync()');
    check('sync refused in capture-only mode', !!(res && res.error && /capture-only/i.test(res.error)), res);
    const fs = require('node:fs');
    check('daily CSV exists', state.csv && !state.csv.error && fs.existsSync(state.csv.path), state.csv);
    const csvText = fs.readFileSync(state.csv.path, 'utf8');
    check('CSV has notes column + data',
      csvText.split('\r\n')[0].includes('notes')
        && csvText.includes('119121297240391')
        && csvText.includes('1ZF98W401234567890')
        && csvText.includes('resold unit'),
      csvText.split('\r\n')[0]);

    // screenshot of the live window for visual review
    if (process.env.CAPTURE_E2E_SHOT) {
      await sleep(400);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.CAPTURE_E2E_SHOT, img.toPNG());
      console.log(`SHOT ${process.env.CAPTURE_E2E_SHOT}`);
    }

    console.log(failures === 0 ? 'E2E_ALL_PASS' : `E2E_FAILURES ${failures}`);
  } catch (e) {
    console.log(`E2E_CRASH ${e.stack}`);
    failures++;
  } finally {
    try { clipboard.writeText(savedClipboard); } catch { /* best effort */ }
    app.exit(failures === 0 ? 0 : 1);
  }
};
