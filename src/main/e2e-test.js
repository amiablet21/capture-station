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

    // clipboard checks are done: restore the operator's clipboard right away so
    // a concurrently running production instance stops seeing test order numbers
    try { clipboard.writeText(savedClipboard); } catch { /* best effort */ }

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

    // 15. per-install page flags: defaults (capture always on)
    state = await exec('api.getState()');
    check('pages default: stock+history on, returns off',
      !!state.pages && state.pages.stock === true && state.pages.history === true && state.pages.returns === false,
      state.pages);

    // 16. receiving worksheet entry row: commit lines, merge repeats, empty qty = 1.
    // Inventory lookup is idle here, so free-text SKUs are accepted as typed.
    await exec(`$('recvSku').value = 'E2E-SKU-1'; $('recvQty').value = '3'; recvCommitEntry();`);
    await exec(`$('recvSku').value = 'E2E-SKU-1'; $('recvQty').value = '2'; recvCommitEntry();`);
    await exec(`$('recvSku').value = 'E2E-SKU-2'; $('recvQty').value = ''; recvCommitEntry();`);
    let formLines = await exec('JSON.parse(JSON.stringify(recvLines))');
    check('worksheet entry adds, merges repeats, defaults qty to 1',
      formLines.length === 2 && formLines[0].sku === 'E2E-SKU-1' && formLines[0].qty === 5 && formLines[1].qty === 1,
      formLines);
    const entryNum = await exec(`$('recvEntryNum').textContent`);
    check('entry row renumbers after commits', entryNum === '3', entryNum);
    await exec('recvSeed([])'); // clear the session for the next checks

    // 17. receiving session file via the IPC surface with a temp folder.
    // File + webhook only, no Linnworks, so it works offline and in capture-only.
    const os = require('node:os');
    const path = require('node:path');
    const recvDir = path.join(app.getPath('userData'), 'receiving-e2e');
    await exec(`api.setConfig(${JSON.stringify({ receiving: { folder: recvDir } })})`);
    const recvSession = [
      { sku: 'S25-128GB-NAVY', title: 'Galaxy S25 128GB Navy', qty: 3 },
      { sku: 'MYSTERY-SKU', title: '', qty: 1 },
    ];
    const recvMeta = { reference: 'PO-VENDOR-0731', trackingNumber: '1ZF98W401234567890', notes: 'left at dock, box dented' };
    res = await exec(`api.receivingFinish(${JSON.stringify(recvSession)}, ${JSON.stringify(recvMeta)})`);
    check('receiving:finish writes session', res && res.ok === true && res.lines === 2 && !!res.path, res);
    check('webhook skipped when URL empty', res && res.webhook === null, res && res.webhook);
    const sessionFiles = fs.readdirSync(recvDir).filter(f => /^receiving-session-.+\.json$/.test(f));
    check('one session file in temp folder', sessionFiles.length === 1, sessionFiles);
    const session = JSON.parse(fs.readFileSync(path.join(recvDir, sessionFiles[0]), 'utf8'));
    check('session content correct',
      session.status === 'pending' && session.station === os.hostname()
        && Array.isArray(session.lines) && session.lines.length === 2
        && session.lines[0].sku === 'S25-128GB-NAVY' && session.lines[0].qty === 3
        && session.lines[1].qty === 1
        && typeof session.id === 'string' && session.id.startsWith('rcv-')
        && !Number.isNaN(Date.parse(session.finishedAt)),
      session);
    check('session carries reference/tracking/notes',
      session.reference === recvMeta.reference
        && session.trackingNumber === recvMeta.trackingNumber
        && session.notes === recvMeta.notes,
      { reference: session.reference, trackingNumber: session.trackingNumber, notes: session.notes });
    res = await exec(`api.receivingFinish(${JSON.stringify([{ sku: 'X', title: '', qty: 1 }])})`);
    check('meta fields default to empty strings', res && res.ok === true, res);
    const bare = JSON.parse(fs.readFileSync(path.join(recvDir,
      fs.readdirSync(recvDir).filter(f => /^receiving-session-.+\.json$/.test(f)).sort().pop()), 'utf8'));
    check('bare session has empty reference/tracking/notes',
      bare.reference === '' && bare.trackingNumber === '' && bare.notes === '',
      { reference: bare.reference, trackingNumber: bare.trackingNumber, notes: bare.notes });

    // 18. empty session rejected
    res = await exec('api.receivingFinish([])');
    check('empty receiving session rejected', res && res.ok === false && !!res.error, res);

    // 19. past receipts list returns the sessions just written, newest first,
    // and tolerates malformed files in the shared folder
    res = await exec('api.receivingList()');
    const listed = res && res.sessions && res.sessions.find(s => s.id === session.id);
    check('receiving:list returns the session with its meta',
      res && res.ok === true && Array.isArray(res.sessions) && res.sessions.length === 2
        && !!listed && listed.status === 'pending' && listed.lines.length === 2
        && listed.reference === recvMeta.reference && listed.trackingNumber === recvMeta.trackingNumber
        && listed.notes === recvMeta.notes && listed.webhook === null,
      res && res.sessions);
    check('receiving:list sorts newest first',
      res && res.sessions.length === 2
        && String(res.sessions[0].finishedAt) >= String(res.sessions[1].finishedAt),
      res && res.sessions.map(s => s.finishedAt));
    fs.writeFileSync(path.join(recvDir, 'receiving-session-broken.json'), '{ not json', 'utf8');
    res = await exec('api.receivingList()');
    check('receiving:list skips malformed files', res && res.sessions.length === 2, res && res.sessions.length);

    // 20. capture-only still refuses Linnworks handlers (stock:get pattern)
    res = await exec('api.getStock()');
    check('stock refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    res = await exec(`api.getStockOpenOrders('S25-128GB-NAVY')`);
    check('stock:openOrders refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);

    // 21. stock condition views: config default + pure filter logic
    res = await exec('api.getConfig()');
    check('stockViews default has Open Box',
      Array.isArray(res.stockViews) && res.stockViews.length === 1 && res.stockViews[0].label === 'Open Box',
      res.stockViews);
    const obPat = JSON.stringify('OPEN[\\s-]?BOX');
    const svm = await exec(`[
      stockViewMatch({ sku: 'S25-128GB-NAVY-OPENBOX', title: '' }, ${obPat}),
      stockViewMatch({ sku: 'A16-64GB', title: 'Galaxy A16 (Open Box)' }, ${obPat}),
      stockViewMatch({ sku: 'X1', title: 'Open-Box unit' }, ${obPat}),
      stockViewMatch({ sku: 'S25-128GB-NAVY', title: 'Galaxy S25 128GB Navy' }, ${obPat}),
      stockViewMatch({ sku: 'S25', title: 'anything' }, '((broken regex'),
    ]`);
    check('Open Box view matches OPENBOX / OPEN BOX / OPEN-BOX only',
      svm[0] === true && svm[1] === true && svm[2] === true && svm[3] === false,
      svm);
    check('invalid view regex filters nothing', svm[4] === true, svm[4]);

    // 22. product image handlers: capture-only refusal + cancel safe when idle
    res = await exec(`api.addStockImageUrl('S25-128GB-NAVY', 'sid', 'https://example.com/x.jpg')`);
    check('stock:addImageUrl refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    res = await exec('api.cancelStockImage()');
    check('stock:cancelImage safe with nothing in flight', res && res.ok === true, res);

    // screenshot of the live window for visual review
    if (process.env.CAPTURE_E2E_SHOT) {
      await sleep(400);
      let img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.CAPTURE_E2E_SHOT, img.toPNG());
      console.log(`SHOT ${process.env.CAPTURE_E2E_SHOT}`);
      // second shot: the PO worksheet with lines, tracking, note + an expanded past day
      await exec(`api.setConfig(${JSON.stringify({ captureOnly: false, pages: { returns: true } })})`);
      await exec(`$('recvDialog').showModal(); enterReceiving();`);
      await sleep(500); // let the past-receipts list load
      await exec(`recvSeed(${JSON.stringify([
        { sku: 'S25-128GB-NAVY', title: 'Samsung Galaxy S25 128GB Navy', qty: 12 },
        { sku: 'S25-256GB-ICYBLUE', title: 'Samsung Galaxy S25 256GB Icy Blue', qty: 6 },
        { sku: 'A16-64GB-BLK-OPENBOX', title: 'Samsung Galaxy A16 64GB Black (open box)', qty: 3 },
        { sku: 'SKU-TYPO-99', title: '', qty: 1, known: false },
      ])})`);
      await exec(`
        $('recvRef').value = 'PO-VENDOR-0731';
        $('recvTracking').value = '1ZF98W401234567890';
        $('recvTracking').dispatchEvent(new Event('input'));
        $('recvNotes').value = 'Left at dock door 2 - one box dented, contents fine.';
      `);
      await exec(`{ const d = document.querySelector('.recv-day-row'); if (d) d.click(); }`);
      await sleep(400);
      img = await win.webContents.capturePage();
      const recvShot = process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-receiving.png');
      fs.writeFileSync(recvShot, img.toPNG());
      console.log(`SHOT ${recvShot}`);
      // third shot: the open-orders-per-SKU dialog, seeded with demo rows
      await exec(`ioRender('S25-128GB-NAVY', ${JSON.stringify([
        { source: 'WALMART', reference: '119121297240391', channelSku: 'WM-S25-NVY-128', quantity: 1, date: '2026-07-31T14:12:00Z' },
        { source: 'EBAY', reference: '02-13457-88190', channelSku: 'EB-S25NAVY', quantity: 2, date: '2026-07-31T11:03:00Z' },
        { source: 'TEMU', reference: 'PO-211-19077242886152', channelSku: '', quantity: 1, date: '2026-07-30T22:41:00Z' },
        { source: 'WALMART', reference: '119121299660484', channelSku: '', quantity: 2, date: '2026-07-30T15:20:00Z', via: 'S25-NAVY-2PACK' },
        { source: 'DIRECT', reference: 'DW-10422', channelSku: 'S25-128GB-NAVY', quantity: 3, date: '2026-07-30T09:15:00Z' },
      ])}); $('ioDialog').showModal();`);
      await sleep(400);
      img = await win.webContents.capturePage();
      const ioShot = process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-open-orders.png');
      fs.writeFileSync(ioShot, img.toPNG());
      console.log(`SHOT ${ioShot}`);
      await exec(`$('ioDialog').close()`);
      // fourth shot: the Stock page with condition chips, Open Box view active
      await exec(`showPage('stock')`);
      await sleep(500); // loadStock fails fast without creds; chips load from config
      const lvl = (n, o) => [{ locationId: 'L1', stockLevel: n, inOrders: o, due: 0, minimumLevel: 0, available: n - o }];
      await exec(`stockSeed(${JSON.stringify({
        ok: true, locationId: 'L1', locationName: 'Warehouse',
        items: [
          { stockItemId: '1', sku: 'S25-128GB-NAVY', title: 'Samsung Galaxy S25 128GB Navy', barcode: '', category: '', image: '', levels: lvl(42, 3) },
          { stockItemId: '2', sku: 'S25-128GB-NAVY-OPENBOX', title: 'Samsung Galaxy S25 128GB Navy (Open Box)', barcode: '', category: '', image: '', levels: lvl(5, 1) },
          { stockItemId: '3', sku: 'A16-64GB-BLK-OPENBOX', title: 'Samsung Galaxy A16 64GB Black (Open Box)', barcode: '', category: '', image: '', levels: lvl(3, 0) },
          { stockItemId: '4', sku: 'IP15-128GB-BLUE', title: 'iPhone 15 128GB Blue', barcode: '', category: '', image: '', levels: lvl(18, 2) },
        ],
      })})`);
      await exec(`stockActiveView = (stockViews || [])[0] || null; renderStockChips(); renderStock();`);
      await sleep(300);
      img = await win.webContents.capturePage();
      const stockShot = process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-stock.png');
      fs.writeFileSync(stockShot, img.toPNG());
      console.log(`SHOT ${stockShot}`);
      // product image dialog: idle (no image yet) and loading states
      await exec(`openImgDialog('S25-128GB-NAVY', 'sid-1', '')`);
      await sleep(300);
      img = await win.webContents.capturePage();
      const imgIdleShot = process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-image-idle.png');
      fs.writeFileSync(imgIdleShot, img.toPNG());
      console.log(`SHOT ${imgIdleShot}`);
      await exec(`imgStageLoading('Downloading image…', 'walmartimages.com');
        imgProgressUpdate({ phase: 'downloading', source: 'walmartimages.com', received: 421888, total: 678912 });`);
      await sleep(300);
      img = await win.webContents.capturePage();
      const imgLoadShot = process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-image-loading.png');
      fs.writeFileSync(imgLoadShot, img.toPNG());
      console.log(`SHOT ${imgLoadShot}`);
      await exec(`imgState = 'idle'; $('imgDialog').close();`);
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
