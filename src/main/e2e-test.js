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
    // a concurrently running production instance stops seeing test order numbers.
    // restoreText bypasses the watcher: the operator's clipboard may hold a
    // real PO#, which must not become a phantom row in THIS suite's queue
    try { (clipboard.restoreText || clipboard.writeText)(savedClipboard); } catch { /* best effort */ }

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

    // 21. stock condition views: config defaults + pure filter logic
    res = await exec('api.getConfig()');
    check('stockViews default: Open Box + Used + Scrap',
      Array.isArray(res.stockViews) && res.stockViews.length === 3
        && res.stockViews.map(v => v.label).join(',') === 'Open Box,Used,Scrap'
        && res.stockViews.every(v => v.tint),
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
    const usedPat = JSON.stringify('(^|[^A-Za-z])USED($|[^A-Za-z])');
    const svu = await exec(`[
      stockViewMatch({ sku: 'S25-128GB-NAVY-USED', title: '' }, ${usedPat}),
      stockViewMatch({ sku: 'X1', title: 'Galaxy S25 (Used)' }, ${usedPat}),
      stockViewMatch({ sku: 'S25-UNUSED', title: '' }, ${usedPat}),
      stockViewMatch({ sku: 'X2', title: 'Unused sealed unit' }, ${usedPat}),
    ]`);
    check('Used view matches -USED but never UNUSED',
      svu[0] === true && svu[1] === true && svu[2] === false && svu[3] === false,
      svu);

    // 22. product image handlers: capture-only refusal + cancel safe when idle
    res = await exec(`api.addStockImageUrl('S25-128GB-NAVY', 'sid', 'https://example.com/x.jpg')`);
    check('stock:addImageUrl refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    res = await exec('api.cancelStockImage()');
    check('stock:cancelImage safe with nothing in flight', res && res.ok === true, res);

    // 23. condition-mapping engine: manual overrides beat auto, delete falls back
    const inv = ['S25-128GB-NAVY', 'S25-128GB-NAVY-OPENBOX', 'S25-128GB-NAVY-SCRAP'];
    let targets = db.resolveConditionTargets('S25-128GB-NAVY', inv);
    check('auto-derivation from suffix listings',
      targets.new === 'S25-128GB-NAVY' && targets.openbox === 'S25-128GB-NAVY-OPENBOX'
        && targets.scrap === 'S25-128GB-NAVY-SCRAP' && targets.used === '',
      targets);
    db.saveConditionMapping('S25-128GB-NAVY', 'openbox', 'ALT-OPENBOX-BIN');
    targets = db.resolveConditionTargets('S25-128GB-NAVY', inv);
    check('manual mapping beats auto-derivation', targets.openbox === 'ALT-OPENBOX-BIN', targets);
    db.deleteConditionMapping('S25-128GB-NAVY', 'openbox');
    targets = db.resolveConditionTargets('S25-128GB-NAVY', inv);
    check('deleting a manual pick falls back to auto', targets.openbox === 'S25-128GB-NAVY-OPENBOX', targets);
    // a base that IS a condition listing (2026-09-09): its own condition
    // lands on itself, other grades derive from the CORE sku — never
    // OPEN-BOX-OPEN-BOX-…
    const invOb = ['OPEN-BOX-X133-64GB-GRAY', 'X133-64GB-GRAY', 'USED-X133-64GB-GRAY'];
    targets = db.resolveConditionTargets('OPEN-BOX-X133-64GB-GRAY', invOb);
    check('a condition SKU maps its own grade to itself, others from the core',
      targets.openbox === 'OPEN-BOX-X133-64GB-GRAY' && targets.used === 'USED-X133-64GB-GRAY'
        && targets.scrap === '',
      targets);
    targets = db.resolveConditionTargets('S25-128GB-NAVY-USED', ['S25-128GB-NAVY-USED', 'S25-128GB-NAVY-OPENBOX']);
    check('suffix-named condition SKUs resolve the same way',
      targets.used === 'S25-128GB-NAVY-USED' && targets.openbox === 'S25-128GB-NAVY-OPENBOX',
      targets);

    // 24. NO-POPUP receiving (owner 2026-09-10): the PO cell looks the
    // order up INLINE; a failed lookup keeps the row for hand entry —
    // no dialog opens at any point
    await exec(`loadRetPast()`);
    await sleep(250);
    await exec(`$('wsPo').value = 'WMR-REMOVAL-7788';
      $('wsPo').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); 0;`);
    await sleep(400); // lookup refuses offline -> unmatched hand-entry state
    const rvBits = await exec(`[
      !!document.querySelector('#retRecvDialog[open]'),
      $('wsPo').value,
      ws.unmatched,
      ws.looked,
    ]`);
    check('PO Enter looks up inline; failed lookup keeps the row, NO popup',
      rvBits[0] === false && rvBits[1] === 'WMR-REMOVAL-7788'
        && rvBits[2] === true && rvBits[3] === 'WMR-REMOVAL-7788',
      rvBits);
    // 24b. the row's condition pill and ⚠: a mapped grade wears its pill
    // quietly, an unmapped one grows the ⚠ whose anchored popover offers
    // Create (affix-aware) and a manual pick
    const prevLookup = await exec(`(() => {
      const prev = recvLookup;
      recvItems = [{ sku: 'S25-128GB-NAVY', title: 'Galaxy S25', barcode: '' }];
      recvBySku = new Map(recvItems.map(i => [i.sku.toLowerCase(), i]));
      recvByBarcode = new Map();
      recvLookup = 'ready';
      return prev;
    })()`);
    await exec(`$('ws_sku').value = 'S25-128GB-NAVY';
      ws.targets = { new: 'S25-128GB-NAVY', openbox: 'S25-128GB-NAVY-OPENBOX', used: '', scrap: '' };
      ws.condition = 'openbox'; wsRenderCond(); 0;`);
    let tgt = await exec(`[
      !!document.querySelector('#wsWarn'),
      (document.querySelector('#wsCond') || {}).textContent || '',
    ]`);
    check('a mapped grade shows its pill in the row, no ⚠',
      tgt[0] === false && /Open box/.test(tgt[1]), tgt);
    await exec(`ws.condition = 'used'; wsRenderCond(); 0;`);
    tgt = await exec(`[!!document.querySelector('#wsWarn'), $('wsFix').hidden]`);
    check('an unmapped grade grows the ⚠ in the row (popover closed)',
      tgt[0] === true && tgt[1] === true, tgt);
    await exec(`document.querySelector('#wsWarn').click(); 0;`);
    await sleep(150);
    tgt = await exec(`[
      $('wsFix').hidden,
      $('wsFixMsg').textContent,
      $('wsFixCreate').hidden,
      $('wsFixCreate').textContent,
      !!document.querySelector('.ws-pick-combo .combo-list'),
    ]`);
    check('the ⚠ popover asks to create the missing listing, with a manual pick',
      tgt[0] === false && /no used listing for S25-128GB-NAVY/i.test(tgt[1]) && tgt[2] === false
        && /USED-S25-128GB-NAVY/.test(tgt[3]) && tgt[4] === true,
      tgt);
    // 24b-bis. Create opens the full New SKU sheet prefilled; closing it
    // without creating changes nothing
    await exec(`$('wsFixCreate').click(); 0;`);
    await sleep(250);
    const mk = await exec(`[
      !!document.querySelector('#skuDialog[open]'),
      $('skuSku').value,
      $('skuTitle').value,
    ]`);
    check('Create opens the New SKU sheet prefilled from the base item',
      mk[0] === true && mk[1] === 'USED-S25-128GB-NAVY' && /Galaxy S25 - Used/.test(mk[2]), mk);
    await exec(`$('skuDialog').close()`);
    // saving is refused while the grade has no landing listing
    await exec(`window.__rvOrigB = rvCreate; window.__rvGotB = 'untouched';
      rvCreate = async (p) => { window.__rvGotB = p; return { ok: true, id: 1 }; };
      wsSave(); 0;`);
    await sleep(400);
    const blocked = await exec(`window.__rvGotB === 'untouched'`);
    check('save refused while the missing listing is unpicked — nothing written',
      blocked === true, blocked);
    await exec(`rvCreate = window.__rvOrigB; wsReset();
      recvItems = null; recvBySku = null; recvByBarcode = null; recvLookup = ${JSON.stringify(prevLookup)}; 0;`);
    db.createReturn({
      orderNumber: 'WMR-REMOVAL-7788', source: '', customer: 'Walmart removals', note: '', unmatched: true,
      tracking: '1ZRETURN000111', receivedBy: 'IM',
      items: [{ sku: 'S25-128GB-NAVY', condition: 'openbox', targetSku: 'S25-128GB-NAVY-OPENBOX', qty: 2, price: 189.99, note: 'box dented' }],
    });
    res = await exec('api.returnsList()');
    check('returns:list carries the worksheet fields',
      Array.isArray(res) && res.length === 1 && res[0].unmatched === true
        && res[0].tracking === '1ZRETURN000111' && res[0].received_by === 'IM'
        && res[0].items[0].price === 189.99 && res[0].items[0].note === 'box dented',
      res);
    await exec('loadRetPast()');
    await sleep(250);
    // history = the RETURNS-2 sheet (13-column header incl. Price, Dispute
    // Settlement + actions), one row per ITEM LINE (the qty-2 return = 1
    // row, Units column carries the 2), condition dot, edit/delete per
    // row, and the excel-style entry row pinned on top
    const ledgerBits = await exec(`[
      !!document.querySelector('#retPastBox table.ret-log-table'),
      document.querySelectorAll('#retPastBox thead th').length,
      document.querySelectorAll('#retPastBox tbody tr.ret-past-tr').length,
      !!document.querySelector('#retPastBox .ret-cond-ro .ret-dd-dot.is-openbox'),
      document.querySelectorAll('#retPastBox tr.ret-past-tr td[data-edit]').length,
      document.querySelectorAll('#retPastBox .ret-log-del-btn').length,
      document.querySelectorAll('#retPastBox tr.ret-past-tr input, #retPastBox tr.ret-past-tr select').length,
      (document.querySelector('#retPastBox .ret-cell-units') || {}).textContent || '',
      (document.querySelector('#retPastBox .ret-cell-price') || {}).textContent || '',
    ]`);
    check('history renders the RETURNS-2 sheet, one row per line',
      ledgerBits[0] === true && ledgerBits[1] === 13
        && ledgerBits[2] === 1 && ledgerBits[3] === true && ledgerBits[7] === '2'
        && ledgerBits[8] === '189.99',
      ledgerBits);
    check('every column is in-place editable, delete stays, no idle inputs',
      ledgerBits[4] === 11 && ledgerBits[5] === 1 && ledgerBits[6] === 0, ledgerBits);
    // 24c-bis. the entry row: a singleton that SURVIVES a re-render, with
    // an input in EVERY column (owner 2026-09-09, "type in any column")
    const entryBits = await exec(`[
      !!document.querySelector('#retPastBox tr.ws-row'),
      !!document.querySelector('#retPastBox tr.ws-row #wsPo'),
      (function () { const a = document.querySelector('#wsPo'); a.value = 'KEEP-ME'; renderRetLog(); return document.querySelector('#wsPo').value; })(),
      document.querySelectorAll('#retPastBox tr.ws-row .ws-in').length,
      $('ws_date').value,
    ]`);
    check('entry row: PO cell present, survives re-render, 10 typable columns, date prefills today',
      entryBits[0] === true && entryBits[1] === true && entryBits[2] === 'KEEP-ME'
        && entryBits[3] === 10 && /^\d{2}\/\d{2}\/\d{4}$/.test(entryBits[4]),
      entryBits);
    await exec(`$('wsPo').value = ''; 0;`);
    // 24c-ter. NO-POPUP receiving (owner 2026-09-10): Enter in the row
    // saves in place — no dialog opens at any point
    await exec(`
      window.__rvOrig2 = rvCreate;
      window.__rvGot2 = null;
      rvCreate = async (p) => { window.__rvGot2 = p; return { ok: true, id: 998 }; };
      recvItems = [{ sku: 'S25-128GB-NAVY', title: 'Navy', barcode: '' }];
      recvBySku = new Map(recvItems.map(i => [i.sku.toLowerCase(), i]));
      recvByBarcode = new Map();
      recvLookup = 'ready';
      $('ws_cust').value = 'Walk-in Willie';
      $('ws_sku').value = 's25-128gb-navy';
      $('ws_units').value = '2';
      $('ws_date').value = '08/15/2026'; // a typed (backdated) Date Received
      $('ws_note').value = 'no label on the box';
      $('ws_cust').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      0;`);
    let inlineGot = null;
    for (let w = 0; w < 40; w++) {
      await sleep(150);
      inlineGot = await exec(`window.__rvGot2`);
      if (inlineGot) break;
    }
    const inlineBits = await exec(`[
      !!document.querySelector('#retRecvDialog[open]'),
      $('ws_cust').value + $('ws_sku').value + $('ws_note').value + $('wsPo').value,
    ]`);
    check('Enter receives in place: PO-less unmatched entry, row cleared, NO popup',
      inlineGot && inlineGot.orderNumber === '' && inlineGot.unmatched === true
        && inlineGot.customer === 'Walk-in Willie'
        && inlineGot.receivedDay === '2026-08-15'
        && inlineGot.items.length === 1 && inlineGot.items[0].sku === 'S25-128GB-NAVY'
        && inlineGot.items[0].qty === 2 && inlineGot.items[0].condition === 'new'
        && inlineGot.items[0].targetSku === 'S25-128GB-NAVY'
        && inlineGot.items[0].note === 'no label on the box'
        && inlineBits[0] === false && inlineBits[1] === '',
      { inlineGot, inlineBits });
    // PO# + Enter looks the order up INLINE: blanks fill in the row itself
    await exec(`
      window.__rvGot2 = null;
      window.__wlOrig = wsLookupApi;
      wsLookupApi = async () => ({ ok: true, order: {
        orderId: 'oid-77', source: 'WALMART', reference: '119888000000001',
        customer: 'Cara Cross', tracking: 'TRK-9', items: [
          { sku: 'S25-128GB-NAVY', channelSku: 'WM-NAVY', title: '', quantity: 1, price: 149.99,
            targets: { openbox: '', used: '', scrap: '' } },
        ] } });
      $('ws_cust').value = 'WRONG NAME'; // the lookup OVERWRITES typed cells
      $('wsPo').value = '119888000000001';
      $('wsPo').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      0;`);
    await sleep(400);
    const looked = await exec(`[
      $('ws_cust').value, $('ws_trk').value, $('ws_sku').value,
      $('ws_price').value,
      !!document.querySelector('#retRecvDialog[open]'),
    ]`);
    check('PO Enter loads the order OVER the row — customer, tracking, SKU, price',
      looked[0] === 'Cara Cross' && looked[1] === 'TRK-9' && looked[2] === 'S25-128GB-NAVY'
        && looked[3] === '149.99' && looked[4] === false,
      looked);
    // the second Enter saves the matched receive
    await exec(`$('wsPo').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); 0;`);
    for (let w = 0; w < 40; w++) {
      await sleep(150);
      inlineGot = await exec(`window.__rvGot2`);
      if (inlineGot) break;
    }
    check('the second Enter saves the matched receive with the orderId',
      inlineGot && inlineGot.orderId === 'oid-77' && inlineGot.unmatched === false
        && inlineGot.items[0].price === 149.99 && inlineGot.items[0].settle === 149.99,
      inlineGot);
    // 24c-unsaved (owner 2026-10-22, returns "disappearing"): a looked-up
    // draft that a new PO replaces, or that Esc clears, is KEPT on the
    // unsaved card instead of vanishing; Put back restores it to save
    await exec(`localStorage.removeItem('retUnsaved'); wsReset();
      $('wsPo').value = '119888000000001';
      $('wsPo').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); 0;`);
    await sleep(300);
    await exec(`$('wsPo').value = 'PO-NEXT-2';
      $('wsPo').dispatchEvent(new Event('input', { bubbles: true }));
      $('wsPo').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); 0;`);
    await sleep(300);
    let uns = await exec(`[JSON.parse(localStorage.getItem('retUnsaved') || '[]'), $('retUnsaved').hidden]`);
    check('a new PO over a loaded, unsaved return keeps that return on the unsaved card',
      uns[0].length === 1 && uns[0][0].v.po === '119888000000001' && uns[0][0].v.sku === 'S25-128GB-NAVY'
        && uns[0][0].orderId === 'oid-77' && /replaced by PO PO-NEXT-2/.test(uns[0][0].why) && uns[1] === false,
      uns);
    await exec(`$('ws_sku').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 0;`);
    uns = await exec(`[JSON.parse(localStorage.getItem('retUnsaved') || '[]'), $('wsPo').value + $('ws_sku').value,
      document.querySelectorAll('#retUnsaved .ret-uns-row').length]`);
    check('Esc clears the row but keeps the draft (same PO + SKU listed once)',
      uns[0].length === 1 && /Esc/.test(uns[0][0].why) && uns[1] === '' && uns[2] === 1, uns);
    await exec(`window.__rvGot2 = null; document.querySelector('#retUnsaved [data-unsput="0"]').click(); 0;`);
    uns = await exec(`[$('wsPo').value, $('ws_sku').value, ws.orderId, JSON.parse(localStorage.getItem('retUnsaved') || '[]').length]`);
    check('Put back restores the draft, loaded order included, and leaves the card',
      uns[0] === '119888000000001' && uns[1] === 'S25-128GB-NAVY' && uns[2] === 'oid-77' && uns[3] === 0, uns);
    await exec(`$('ws_sku').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); 0;`);
    for (let w = 0; w < 20 && !(inlineGot = await exec(`window.__rvGot2`)); w++) await sleep(150);
    check('a put-back draft saves with its order', inlineGot && inlineGot.orderId === 'oid-77'
      && inlineGot.orderNumber === '119888000000001', inlineGot);
    // a scan typed while the save runs survives the save's row clear
    await exec(`window.__rvKeep = rvCreate; window.__rvGot2 = null;
      rvCreate = async (p) => { window.__rvGot2 = p; await new Promise(r => { window.__rvDone = r; }); return { ok: true, id: 997 }; };
      wsReset(); $('wsPo').value = 'PO-A'; ws.looked = 'PO-A'; $('ws_sku').value = 'S25-128GB-NAVY';
      $('ws_sku').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); 0;`);
    await sleep(100);
    await exec(`$('wsPo').value = 'PO-B'; $('wsPo').dispatchEvent(new Event('input', { bubbles: true })); window.__rvDone(); 0;`);
    await sleep(300);
    uns = await exec(`[window.__rvGot2 && window.__rvGot2.orderNumber, $('wsPo').value, $('ws_sku').value,
      JSON.parse(localStorage.getItem('retUnsaved') || '[]').length]`);
    check('a PO typed during a save is kept; the saved cells clear; nothing lands on the card',
      uns[0] === 'PO-A' && uns[1] === 'PO-B' && uns[2] === '' && uns[3] === 0, uns);
    await exec(`rvCreate = window.__rvKeep; wsReset(); localStorage.removeItem('retUnsaved'); renderRetUnsaved(); 0;`);
    // the condition pill opens its 4-pill menu right in the row
    await exec(`$('ws_sku').value = 'S25-128GB-NAVY'; wsRenderCond(); document.querySelector('#wsCond').click(); 0;`);
    await sleep(150);
    const wsMenu = await exec(`[
      document.querySelectorAll('.ws-emenu .ret-emi').length,
      !!document.querySelector('#retRecvDialog[open]'),
    ]`);
    check('the row condition pill opens the 5-pill menu (Different return included), still no popup',
      wsMenu[0] === 5 && wsMenu[1] === false, wsMenu);
    // 24c-quater. Different return (owner 2026-09-10): the ORDERED SKU
    // stays in the cell and a "→ what came back" line grows under it —
    // junk text saves log-only, a real listing restocks itself
    await exec(`
      window.__rvGot2 = null;
      recvItems = [{ sku: 'S25-128GB-NAVY', title: 'Navy', barcode: '' }];
      recvBySku = new Map(recvItems.map(i => [i.sku.toLowerCase(), i]));
      recvByBarcode = new Map();
      recvLookup = 'ready';
      $('wsPo').value = 'PO-DIFF-1'; ws.looked = 'PO-DIFF-1';
      ws.condition = 'different';
      $('ws_sku').value = 'S25-128GB-NAVY';
      wsRenderCond();
      $('ws_recv').value = 'GARBAGE';
      wsRenderCond();
      0;`);
    const dWarn = await exec(`[
      !!document.querySelector('#ws_recv'),
      $('ws_sku').value,
      !!document.querySelector('#wsWarn'),
    ]`);
    check('different return: the → line appears, ordered SKU untouched, junk grows the ⚠',
      dWarn[0] === true && dWarn[1] === 'S25-128GB-NAVY' && dWarn[2] === true, dWarn);
    await exec(`wsSave(); 0;`);
    for (let w = 0; w < 40; w++) {
      await sleep(150);
      inlineGot = await exec(`window.__rvGot2`);
      if (inlineGot) break;
    }
    check('junk on the → line saves log-only: ordered SKU kept, received recorded, no stock',
      inlineGot && inlineGot.items[0].condition === 'different'
        && inlineGot.items[0].sku === 'S25-128GB-NAVY'
        && inlineGot.items[0].received === 'GARBAGE'
        && inlineGot.items[0].targetSku === '',
      inlineGot);
    await exec(`
      window.__rvGot2 = null;
      $('wsPo').value = 'PO-DIFF-2'; ws.looked = 'PO-DIFF-2';
      ws.condition = 'different';
      $('ws_sku').value = 'S26-ULTRA';
      wsRenderCond();
      $('ws_recv').value = 'S25-128GB-NAVY';
      wsRenderCond(); wsSave(); 0;`);
    for (let w = 0; w < 40; w++) {
      await sleep(150);
      inlineGot = await exec(`window.__rvGot2`);
      if (inlineGot) break;
    }
    check('a REAL listing on the → line restocks that listing',
      inlineGot && inlineGot.items[0].condition === 'different'
        && inlineGot.items[0].sku === 'S26-ULTRA'
        && inlineGot.items[0].received === 'S25-128GB-NAVY'
        && inlineGot.items[0].targetSku === 'S25-128GB-NAVY',
      inlineGot);
    await exec(`
      const m = document.querySelector('.ws-emenu'); if (m) m.remove();
      wsReset();
      rvCreate = window.__rvOrig2; wsLookupApi = window.__wlOrig;
      recvItems = null; recvBySku = null; recvByBarcode = null; recvLookup = null;
      0;`);
    // (returns:create's relaxed PO rule can't be hit here — the e2e
    // profile runs capture-only, which gates the handler before it)
    // 24c. Receive commits price + dispute settlement through the
    // returns:create engine and CLOSES the popup — no async errors
    await exec(`
      window.__err = ''; window.addEventListener('error', (e) => { window.__err += String(e.error && e.error.stack || e.message) + ' | '; });
      window.addEventListener('unhandledrejection', (e) => { window.__err += 'REJ:' + String(e.reason && e.reason.stack || e.reason) + ' | '; });
      window.__rvOrig = rvCreate;
      window.__rvGot = null;
      rvCreate = async (p) => { window.__rvGot = p; return { ok: true, id: 999 }; };
      retOpenRecv();
      rv.unmatched = false; rv.orderId = 'oid-9'; rv.source = 'WALMART';
      $('rvPo').value = '119999000000001'; rvLastLookup = '119999000000001';
      rv.items = [{ sku: 'S25-128GB-NAVY', title: '', price: 1, quantity: 1, targets: null }];
      rv.received = [false];
      rvLoadItemAt(0);
      $('rvPrice').value = '150'; $('rvBy').value = 'IM';
      $('rvSave').click(); 0;`);
    // commit -> close is async: poll instead of a fixed sleep (flaked at
    // fixed sleeps under load, 2026-08-14)
    for (let w = 0; w < 40; w++) {
      await sleep(200);
      if (await exec(`!document.querySelector('#retRecvDialog[open]')`)) break;
    }
    const rvGot = await exec(`window.__rvGot`);
    check('Receive commits the price through returns:create',
      rvGot && rvGot.orderNumber === '119999000000001' && rvGot.items.length === 1
        && rvGot.items[0].price === 150
        && rvGot.items[0].targetSku === 'S25-128GB-NAVY',
      rvGot);
    const rvClosed = await exec(`[!document.querySelector('#retRecvDialog[open]'), String(window.__err || '')]`);
    check('Receive closes the popup after the commit, no async errors',
      rvClosed[0] === true && rvClosed[1] === '', rvClosed);
    await exec(`rvCreate = window.__rvOrig; if (document.querySelector('#retRecvDialog[open]')) $('retRecvDialog').close(); 0;`);
    // 24e. in-place editing (owner 2026-09-07, the pencil popup retired):
    // clicking a cell swaps in an editor prefilled with the cell's value,
    // Escape cancels it back to display
    await exec(`document.querySelector('#retPastBox tr.ret-past-tr td[data-edit="units"]').click()`);
    await sleep(150);
    let inline = await exec(`[
      !!document.querySelector('#retPastBox td[data-edit="units"] .ret-ein'),
      (document.querySelector('#retPastBox td[data-edit="units"] .ret-ein') || {}).value || '',
    ]`);
    check('clicking a log cell opens the in-place editor prefilled',
      inline[0] === true && inline[1] === '2', inline);
    await exec(`document.querySelector('#retPastBox td[data-edit="units"] .ret-ein')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(150);
    inline = await exec(`[
      !!document.querySelector('#retPastBox .ret-ein'),
      (document.querySelector('#retPastBox .ret-cell-units') || {}).textContent || '',
    ]`);
    check('Escape cancels the editor back to the display value',
      inline[0] === false && inline[1] === '2', inline);
    // Enter saves through the SAME qty-aware corrections engine the popup
    // used — the payload carries the whole row with the edit swapped in
    await exec(`
      window.__reOrig = retEditApi;
      window.__reGot = null;
      retEditApi = async (p) => { window.__reGot = p; return { ok: true, stockNote: '' }; };
      document.querySelector('#retPastBox tr.ret-past-tr td[data-edit="units"]').click(); 0;`);
    await sleep(150);
    await exec(`(() => {
      const ein = document.querySelector('#retPastBox td[data-edit="units"] .ret-ein');
      ein.value = '3';
      ein.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await sleep(250);
    const reGot = await exec(`window.__reGot`);
    check('an inline edit saves the full row through returns:editUnit',
      reGot && reGot.po === 'WMR-REMOVAL-7788' && reGot.units === '3'
        && reGot.sku === 'S25-128GB-NAVY' && reGot.condition === 'openbox'
        && reGot.price === 189.99 && reGot.receivedBy === 'IM',
      reGot);
    await exec(`retEditApi = window.__reOrig; 0;`);
    // the condition cell edits through a compact 4-pill menu
    await exec(`loadRetPast()`);
    await sleep(250);
    await exec(`document.querySelector('#retPastBox tr.ret-past-tr td[data-edit="condition"]').click()`);
    await sleep(150);
    const condMenu = await exec(`[
      document.querySelectorAll('#retPastBox .ret-emenu .ret-emi').length,
      (document.querySelector('#retPastBox .ret-emi.is-sel') || { dataset: {} }).dataset.cond || '',
    ]`);
    check('the condition cell edits through the 5-pill menu, current one marked',
      condMenu[0] === 5 && condMenu[1] === 'openbox', condMenu);
    await exec(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    await sleep(150);
    // 24f. a condition with no listing opens the create-or-pick dialog —
    // and the suggested name strips the affix the SKU already carries
    await exec(`
      recvItems = [{ sku: 'OPEN-BOX-X1', title: 'X1 open box', barcode: '' }];
      recvBySku = new Map(recvItems.map(i => [i.sku.toLowerCase(), i]));
      recvByBarcode = new Map();
      recvLookup = 'ready';
      openRetCondFix({ i: { sku: 'OPEN-BOX-X1', condition: 'new' }, r: {}, ii: 0 }, 'used'); 0;`);
    await sleep(150);
    const condFix = await exec(`[
      !!document.querySelector('#retCondDialog[open]'),
      $('retCondCreate').hidden,
      $('retCondCreate').textContent,
      !!document.querySelector('.retcond-combo .combo-list'),
    ]`);
    check('missing-listing dialog: affix-stripped footer create, pick search',
      condFix[0] === true
        && condFix[1] === false && /Create USED-X1$/.test((condFix[2] || '').trim())
        && condFix[3] === true,
      condFix);
    await exec(`$('retCondDialog').close(); recvItems = null; recvBySku = null; recvByBarcode = null; recvLookup = null; 0;`);

    // 24g. returns-history import: units count from the ROWS (owner
    // 2026-09-09: an order of 12 with 12 rows is 12 units, never 144)
    {
      const ri = require('./returns-import');
      const rows = [
        ['PO #', 'Customer Name', 'Tracking #', 'Date Received', 'Returned SKU', 'Price', 'Received By', 'Dispute Settlement Amount'],
        ['119000000000001', 'Ann A', '5.28846386026E11', '', 'SM-X133-64GB-GREY', '$127.49', '', 'case open'],
        ['119000000000001', 'Ann A', '', '', 'SM-X133-64GB-GREY', '127.49', '', ''],
        ['119000000000002', 'Bob B', '532312595932.0', '', 'TABA9+64GB', '183.99', '', '45.50'],
        ['', 'Cara C', '', '', 'X1', '10', '', ''],
      ];
      const recs = ri.parseReturnsRows(rows);
      check('import parse: unit rows read, refs normalized, comments become notes',
        recs.length === 4 && recs[0].tracking === '528846386026' && recs[2].tracking === '532312595932'
          && recs[0].note === 'case open' && recs[0].settle === 0 && recs[2].settle === 45.5
          && recs[0].price === 127.49, recs);
      const ents = ri.collapseReturns(recs);
      const a = ents.find(e => e.po === '119000000000001');
      check('import collapse: duplicate PO+SKU rows become one entry with units',
        ents.length === 3 && a && a.units === 2 && a.tracking === '528846386026'
          && a.note === 'case open' && ents.find(e => !e.po).customer === 'Cara C', ents);
    }
    // the Import button is retired (owner 2026-09-14) — the parse/collapse
    // engine above keeps its checks; the dialog has no UI entry point now
    check('Import button retired from the returns bar',
      (await exec(`!$('retImportBtn')`)) === true);

    // 24h. the missing-listings slider: one gap at a time, affix-stripped
    // create suggestions, Skip advances, the tally closes it out
    await exec(`
      window.__fixOrig = retFixGapsApi;
      recvItems = [{ sku: 'BASE-Y7', title: 'Y7 base', barcode: '' }];
      recvBySku = new Map(recvItems.map(i => [i.sku.toLowerCase(), i]));
      recvByBarcode = new Map();
      recvLookup = 'ready';
      retFixGapsApi = async () => ({ ok: true, relinked: 0, gaps: [
        { sku: 'OPEN-BOX-BASE-X9', condition: 'openbox', units: 2, entries: 2, customer: 'Ann A' },
        { sku: 'BASE-Y7', condition: 'used', units: 1, entries: 1, customer: 'Bob B' },
      ] });
      retFixOpenIfNeeded(); 0;`);
    await sleep(300);
    const fix1 = await exec(`[
      !!document.querySelector('#retFixDialog[open]'),
      $('retFixN').textContent,
      $('retFixSku').textContent,
      $('retFixCreate').textContent.trim(),
      $('retFixCtx').textContent,
    ]`);
    check('slider opens on gap 1 with an affix-stripped create suggestion',
      fix1[0] === true && fix1[1] === '1 / 2' && fix1[2] === 'OPEN-BOX-BASE-X9'
        && /Create OPEN-BOX-BASE-X9$/.test(fix1[3]) && /2 units/.test(fix1[4]), fix1);
    await exec(`$('retFixSkip').click(); 0;`);
    await sleep(150);
    const fix2 = await exec(`[$('retFixN').textContent, $('retFixSku').textContent, $('retFixCreate').textContent.trim()]`);
    check('Skip advances to gap 2 (USED- prefix suggestion)',
      fix2[0] === '2 / 2' && fix2[1] === 'BASE-Y7' && /Create USED-BASE-Y7$/.test(fix2[2]), fix2);
    await exec(`$('retFixSkip').click(); 0;`);
    await sleep(150);
    const fixDone = await exec(`[
      $('retFixDone').hidden,
      $('retFixDoneH').textContent,
      $('retFixTally').textContent,
      $('retFixClose').hidden,
    ]`);
    check('all handled: the tally view with Done',
      fixDone[0] === false && fixDone[1] === 'All 2 handled'
        && /2 skipped/.test(fixDone[2]) && fixDone[3] === false, fixDone);
    await exec(`$('retFixClose').click();
      retFixGapsApi = window.__fixOrig;
      recvItems = null; recvBySku = null; recvByBarcode = null; recvLookup = null; 0;`);
    const fixClosed = await exec(`[!document.querySelector('#retFixDialog[open]')]`);
    check('Done closes the slider', fixClosed[0] === true, fixClosed);

    // 24d. disputes card: a "case:" note makes a pending dispute; resolved
    // notes leave the card
    db.createReturn({
      orderNumber: 'WMR-DISPUTE-1', source: '', customer: '', note: '', unmatched: true,
      tracking: '', receivedBy: 'IM',
      items: [{ sku: 'S25-128GB-NAVY', condition: 'new', targetSku: 'S25-128GB-NAVY', qty: 1, price: 100, note: 'fake item — case: 88421' }],
    });
    db.createReturn({
      orderNumber: 'WMR-DISPUTE-2', source: '', customer: '', note: '', unmatched: true,
      tracking: '', receivedBy: 'IM',
      items: [{ sku: 'S25-128GB-NAVY', condition: 'new', targetSku: 'S25-128GB-NAVY', qty: 1, price: 100, note: 'case: 999 — resolved' }],
    });
    await exec('loadRetPast()');
    await sleep(250);
    // V1: the card waits behind the bar chip — hidden until the chip is
    // clicked, but its rows render regardless (the resolve button works)
    const disp = await exec(`[
      $('retDisputes').hidden,
      (document.querySelector('#retChips [data-chip="disp"]') || {}).textContent || '',
      document.querySelectorAll('#retDisputes .ret-todo-row').length,
      ($('retDisputes').textContent || '').includes('88421'),
      ($('retDisputes').textContent || '').includes('999'),
      !!document.querySelector('#retDisputes [data-dispdone]'),
    ]`);
    check('disputes wait behind the bar chip, open cases only, with resolve',
      disp[0] === true && /1 dispute open/.test(disp[1]) && disp[2] === 1
        && disp[3] === true && disp[4] === false && disp[5] === true,
      disp);
    await exec(`document.querySelector('#retChips [data-chip="disp"]').click()`);
    const dispOpen = await exec(`!$('retDisputes').hidden`);
    check('the dispute chip expands the card', dispOpen === true, dispOpen);
    await exec(`document.querySelector('#retChips [data-chip="disp"]').click(); 0;`);

    // 25. new returns handlers refuse in capture-only mode
    res = await exec(`api.returnsTargets('S25-128GB-NAVY')`);
    check('returns:targets refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    res = await exec('api.returnsMappings()');
    check('returns:mappings refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    res = await exec(`api.returnsMapSet('A', 'openbox', 'B')`);
    check('returns:mapSet refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    res = await exec(`api.returnsMapDelete('A', 'openbox')`);
    check('returns:mapDelete refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);

    // 26. marketplace browser pane: refusals + safe no-ops in capture-only
    res = await exec(`api.browserOpen('119121297240391', 'walmart')`);
    check('browser:open refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    res = await exec(`api.browserLayout({ visible: true, x: 0, y: 0, width: 300, height: 300 })`);
    check('browser:layout stays hidden in capture-only mode', res && res.ok === true && res.visible === false, res);
    res = await exec(`api.browserNav('back')`);
    check('browser:nav safe with no pane', res && res.ok === false, res);

    // 27. New SKU: capture-only refusal + offline dialog validation
    res = await exec(`api.createSku({ sku: 'TEST-1', title: 'Test', qty: 0 })`);
    check('stock:createSku refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    const invList = JSON.stringify([{ sku: 'S25-128GB-NAVY' }]);
    const v = await exec(`[
      validateNewSku({ sku: '', title: 'T', qty: 0 }, ${invList}),
      validateNewSku({ sku: 'A-1', title: '', qty: 0 }, ${invList}),
      validateNewSku({ sku: 'bad sku!', title: 'T', qty: 0 }, ${invList}),
      validateNewSku({ sku: 's25-128gb-navy', title: 'T', qty: 0 }, ${invList}),
      validateNewSku({ sku: 'A-1', title: 'T', qty: -2 }, ${invList}),
      validateNewSku({ sku: 'A-1', title: 'T', qty: 3 }, ${invList}),
      validateNewSku({ sku: 'a-1', title: 'T', qty: '' }, ${invList}),
    ]`);
    check('new-SKU validation: required fields, charset, case-blind dupes, qty',
      /required/i.test(v[0]) && /required/i.test(v[1]) && /letters/i.test(v[2])
        && /already exists/i.test(v[3]) && /whole number/i.test(v[4])
        && v[5] === '' && v[6] === '',
      v);

    // 28. ship-by due logic (pure, pinned clock) + cutoff formatting
    const dueChecks = await exec(`(() => {
      const now = new Date('2026-08-01T14:00:00');
      return [
        dueInfo('2026-07-30T00:00:00', '16:00', now),
        dueInfo('2026-08-01T20:00:00', '16:00', now),
        dueInfo('2026-08-01T20:00:00', '16:00', new Date('2026-08-01T15:10:00')),
        dueInfo('2026-08-05T00:00:00', '16:00', now),
        dueInfo('', '16:00', now),
        dueInfo('1899-12-30T00:00:00', '16:00', now),
        fmtCutoff('16:00'),
        fmtCutoff('9:30'),
      ];
    })()`);
    check('due chips: overdue / amber / red near cutoff / future+unset clean',
      dueChecks[0] && dueChecks[0].label === 'Overdue' && dueChecks[0].overdue === true
        && dueChecks[1] && dueChecks[1].label === 'Due today' && dueChecks[1].urgent === false
        && dueChecks[2] && dueChecks[2].urgent === true
        && dueChecks[3] === null && dueChecks[4] === null && dueChecks[5] === null,
      dueChecks);
    check('cutoff formats as a 12h clock', dueChecks[6] === '4:00 PM' && dueChecks[7] === '9:30 AM',
      [dueChecks[6], dueChecks[7]]);

    // 29. seeded queue: chips + filter + header show; ordering stays pure
    // newest-first (due urgency never re-sorts the rows)
    await exec(`
      state.orderMeta['02-12345-67890'] = { source: 'EBAY', despatchBy: '2020-01-02T00:00:00',
        items: [{ sku: 'S25-128GB-NAVY', qty: 2, title: 'Galaxy S25', img: '' }] };
      state.shipCutoff = '16:00';
      render();
    `);
    const queueBits = await exec(`[
      !!document.querySelector('#rowsBody .due-chip'),
      !!document.querySelector('#rowsBody .qty-chip'),
      !document.querySelector('#channelChips .chip-due'), // filter chip removed 2026-08-06
      document.querySelector('#rowsBody tr td.cell-order .order-num').dataset.po,
      $('dueHeader').hidden,
      document.querySelector('#rowsBody tr:first-child td.cell-gutter').textContent,
      document.querySelector('#rowsBody tr:last-child td.cell-gutter').textContent,
    ]`);
    // the ebay row is both the newest capture AND the overdue one, so the top
    // slot proves newest-first (the due seed must not have re-sorted anything)
    check('queue shows due + qty chips (no Due-today filter), newest on top',
      queueBits[0] === true && queueBits[1] === true && queueBits[2] === true
        && queueBits[3] === '02-12345-67890' && queueBits[4] === true, // the "due by" headline left with the Orders restyle (2026-10-14)
      queueBits);
    check('gutter numbers follow display order: top = count, bottom = 1',
      queueBits[5] === '2' && queueBits[6] === '1',
      [queueBits[5], queueBits[6]]);

    // 30. browser pane loading screen: show -> fail -> retry-clear (DOM side)
    await exec(`bShowLoading('Opening order 119121415476080'); $('bLoadDomain').textContent = 'seller.walmart.com';`);
    let lp = await exec(`[!$('bLoadPanel').hidden, $('bLoadLabel').textContent, bLoad.active, !$('bLoadSpin').hidden]`);
    check('loading panel shows with PO label + spinner',
      lp[0] === true && /119121415476080/.test(lp[1]) && lp[2] === true && lp[3] === true, lp);
    await exec(`bShowLoadError('ERR_NAME_NOT_RESOLVED')`);
    lp = await exec(`[!$('bLoadErr').hidden, bLoad.failed, $('bLoadSpin').hidden]`);
    check('failed load swaps to the red retry state', lp[0] === true && lp[1] === true && lp[2] === true, lp);
    await exec('bHideLoading()');
    lp = await exec(`[$('bLoadPanel').hidden, bLoad.active, bLoad.failed]`);
    check('loading panel clears fully', lp[0] === true && lp[1] === false && lp[2] === false, lp);

    // 31. per-order location move: refusal + both affordances render
    res = await exec(`api.moveOrder('119121297240391', 'primary', false)`);
    check('orders:move refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    await exec(`
      state.captureOnly = false;
      state.locations = { primaryName: 'Digital World Shop', fallbackName: 'DropShip', fallbackSet: true };
      state.orderMeta['119121297240391'] = { source: 'WALMART', dropship: true, despatchBy: '', items: [] };
      render();
    `);
    // location-move UI is PARKED: the DS chip renders as a passive badge and
    // no move affordances exist (the IPC surface stays, dormant). The
    // substitution swap on the item line is LIVE again in sync mode.
    const moveBits = await exec(`[
      !!document.querySelector('#rowsBody .badge-dropship'),
      !!document.querySelector('#rowsBody .badge-dropship[data-act]'),
      !!document.querySelector('#rowsBody [data-act="movedropship"]'),
      !!document.querySelector('#rowsBody .item-sub-btn[data-act="substitute"]'),
    ]`);
    check('DS chip is a passive badge and move actions are parked',
      moveBits[0] === true && moveBits[1] === false && moveBits[2] === false,
      moveBits);
    check('substitution swap button renders on the item line in sync mode',
      moveBits[3] === true, moveBits);
    // restore capture-only + drop only the DS seeding (the due/qty seeding
    // from check 29 stays visible for the screenshot pass)
    await exec(`state.captureOnly = true; delete state.orderMeta['119121297240391']; render();`);

    // 31b. SPLIT orders (2026-08-07): one marketplace order split across
    // locations by Linnworks' fulfillment network = one row per part, meta
    // keyed ref#lwOrderId, part badges, and the dedupe sweep spares them
    const sp1 = db.createRow({ channel: 'walmart', orderNumber: '119121888000111', origin: 'linnworks', lwOrderId: 'LW-A' });
    const sp2 = db.createRow({ channel: 'walmart', orderNumber: '119121888000111', origin: 'linnworks', lwOrderId: 'LW-B' });
    check('split parts store their Linnworks order ids',
      sp1.lw_order_id === 'LW-A' && sp2.lw_order_id === 'LW-B'
        && !!db.findByOrderAndPart('119121888000111', 'LW-B'), [sp1.lw_order_id, sp2.lw_order_id]);
    const dd2 = db.dedupeOrderRows();
    check('dedupe sweep never eats split parts',
      !!db.findByOrderAndPart('119121888000111', 'LW-A') && !!db.findByOrderAndPart('119121888000111', 'LW-B'),
      dd2);
    await exec(`
      state.rows.unshift(
        { id: 99101, order_number: '119121888000111', lw_order_id: 'LW-A', channel: 'walmart', status: 'pending', created_at: new Date().toISOString(), serials: [], items: [], tracking: '', notes: '' },
        { id: 99102, order_number: '119121888000111', lw_order_id: 'LW-B', channel: 'walmart', status: 'pending', created_at: new Date().toISOString(), serials: [], items: [], tracking: '', notes: '' });
      state.orderMeta['119121888000111#LW-A'] = { source: 'WALMART', despatchBy: '', split: { part: 1, of: 2 }, items: [{ sku: 'S25-128GB-NAVY', qty: 1, title: '', img: '' }] };
      state.orderMeta['119121888000111#LW-B'] = { source: 'WALMART', despatchBy: '', dropship: true, split: { part: 2, of: 2 }, items: [{ sku: 'X400-64GB-BLACK', qty: 1, title: '', img: '' }] };
      render();
    `);
    const splitBits = await exec(`[
      document.querySelectorAll('#rowsBody .badge-split').length,
      [...document.querySelectorAll('#rowsBody .badge-split')].map(b => b.textContent).join(','),
      [...document.querySelectorAll('#rowsBody tr')].filter(tr => tr.textContent.includes('119121888000111')).length,
      [...document.querySelectorAll('#rowsBody tr')].some(tr => tr.textContent.includes('S25-128GB-NAVY') && tr.textContent.includes('119121888000111')),
      [...document.querySelectorAll('#rowsBody tr')].some(tr => tr.textContent.includes('X400-64GB-BLACK') && tr.textContent.includes('119121888000111')),
    ]`);
    check('split parts render as separate rows with part badges + own items',
      splitBits[0] === 2 && /1\/2/.test(splitBits[1]) && /2\/2/.test(splitBits[1])
        && splitBits[2] === 2 && splitBits[3] === true && splitBits[4] === true,
      splitBits);
    db.deleteRow(sp1.id);
    db.deleteRow(sp2.id);
    await exec(`
      state.rows = state.rows.filter(r => r.order_number !== '119121888000111');
      delete state.orderMeta['119121888000111#LW-A'];
      delete state.orderMeta['119121888000111#LW-B'];
      render();
    `);

    // 32. "shipped different item" substitution: refusal + intent + pill + CSV + clear
    res = await exec(`api.substituteRow(${ebayRow.id}, 'X230-128GB-GRAY', 1, '', false)`);
    check('rows:substitute refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    const noteText = await exec(`subDefaultNote('S25-128GB-NAVY', 'X230-128GB-GRAY')`);
    check('substitution auto-note format', noteText === 'ordered S25-128GB-NAVY, shipped X230-128GB-GRAY', noteText);
    db.setSubstitution(ebayRow.id, 'X230-128GB-GRAY', 2, noteText);
    const subRow = db.getRow(ebayRow.id);
    check('substitution intent saved on the row',
      subRow.sub_sku === 'X230-128GB-GRAY' && subRow.sub_qty === 2 && /shipped X230/.test(subRow.sub_note), subRow);
    await exec(`api.updateRow(${ebayRow.id}, {})`); // pushState -> fresh state + CSV
    await sleep(200);
    const pillBits = await exec(`[
      !!document.querySelector('#rowsBody .sub-pill'),
      (document.querySelector('#rowsBody .sub-pill') || {}).textContent || '',
      !!document.querySelector('#rowsBody button.sub-pill[data-act="substitute"]'),
    ]`);
    check('row shows the SUB pill with SKU and qty',
      pillBits[0] === true && /SUB → X230-128GB-GRAY ×2/.test(pillBits[1]), pillBits);
    check('SUB pill is clickable (opens the substitution dialog)',
      pillBits[2] === true, pillBits);
    state = await exec('api.getState()');
    const csvSub = fs.readFileSync(state.csv.path, 'utf8');
    check('CSV notes column carries the internal SUB marker',
      csvSub.includes('SUB:') && csvSub.includes('shipped X230-128GB-GRAY'), csvSub.split('\r\n')[0]);
    db.setSubstitution(ebayRow.id, '', 0, '');
    await exec(`api.updateRow(${ebayRow.id}, {})`);
    await sleep(200);
    const cleared = await exec(`!!document.querySelector('#rowsBody .sub-pill')`);
    check('clearing the substitution removes the pill', cleared === false, cleared);
    // pending-substitution claims: the app-side "reservation" for substitutes.
    // Counts other unprocessed rows' sub intents per SKU, case-blind, and
    // never counts the row being edited itself.
    const claims = await exec(`(() => {
      const saved = state.rows;
      state.rows = [
        { id: 1, status: 'pending', sub_sku: 'X236-128GB-BLACK', sub_qty: 2 },
        { id: 2, status: 'pending', sub_sku: 'x236-128gb-black', sub_qty: 1 },
        { id: 3, status: 'failed', sub_sku: '' },
      ];
      const n = [
        subPendingClaims('X236-128GB-BLACK', 99), // both rows count
        subPendingClaims('x236-128gb-BLACK', 1),  // own row (qty 2) excluded
        subPendingClaims('X999-NOPE', 99),        // unclaimed SKU
        subPendingClaims('', 99),                 // blank never matches blanks
      ];
      state.rows = saved;
      return n;
    })()`);
    check('pending substitution claims counted per SKU, own row excluded',
      claims[0] === 3 && claims[1] === 1 && claims[2] === 0 && claims[3] === 0, claims);

    // 33. WFS stock view: the chip appears when a WFS location exists in the
    // inventory data, shows only SKUs Walmart holds, and is read-only. The
    // New SKU / Receiving / WFS Shipments buttons are temporarily hidden.
    const wfsView = await exec(`(() => {
      const lvl = (loc, name, n, o) => ({ locationId: loc, locationName: name, stockLevel: n, inOrders: o, due: 0, minimumLevel: 0, available: n - o });
      stockSeed({ ok: true, locationId: 'L1', locationName: 'Digital World Shop', items: [
        { stockItemId: '1', sku: 'S25-128GB-NAVY', title: 'navy', barcode: '', category: '', image: '', levels: [lvl('L1', 'Digital World Shop', 4, 1), lvl('LW', 'WFS FULFILLED', 9, 0)] },
        { stockItemId: '2', sku: 'A16-64GB-BLK', title: 'black', barcode: '', category: '', image: '', levels: [lvl('L1', 'Digital World Shop', 2, 0)] },
      ] });
      renderStockChips();
      const chip = document.querySelector('#stockChips [data-view="wfs"]');
      if (chip) chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const wfsCell = document.querySelector('#stockList .stock-num-ro');
      const homeBtn = document.querySelector('#stockList .stock-num-btn');
      const head = document.querySelector('#stockList thead');
      const out = {
        chip: !!chip,
        rows: document.querySelectorAll('#stockList tbody tr').length,
        wfsCount: wfsCell ? wfsCell.textContent.trim() : '',
        homeCount: homeBtn ? homeBtn.textContent.trim() : '',
        homeEditable: !!(homeBtn && homeBtn.dataset.sku === 'S25-128GB-NAVY'),
        headers: head ? head.textContent : '',
        summary: $('stockSummary').textContent,
        hiddenBtns: [$('newSkuBtn').hidden, $('recvBtn').hidden],
      };
      stockWfsActive = false; stockCache = null; renderStockChips();
      return out;
    })()`);
    check('WFS view: Walmart-held SKUs only, WFS count read-only, warehouse count editable',
      wfsView.chip === true && wfsView.rows === 1
      && wfsView.wfsCount === '9' && wfsView.homeCount === '4' && wfsView.homeEditable === true
      && /At WFS/.test(wfsView.headers) && /At warehouse/.test(wfsView.headers)
      && /WFS FULFILLED/.test(wfsView.summary), wfsView);
    // WFS Shipments came back 2026-09-09 (owner asked for exactly what it
    // does); New SKU and Receiving stay tucked away
    check('stock toolbar: New SKU / Receiving hidden, WFS Shipments visible',
      wfsView.hiddenBtns[0] === true && wfsView.hiddenBtns[1] === true
        && wfsView.hiddenBtns[2] === false, wfsView);

    // 34. stock minimums: pure crossing engine, capture-only refusal, Low view
    const lows = db.lowStockCrossings([
      { sku: 'A', title: 'a', available: 1, min: 3 },  // below, new -> alerts
      { sku: 'B', title: 'b', available: 5, min: 3 },  // healthy
      { sku: 'C', title: 'c', available: 0, min: 2 },  // below, already latched
      { sku: 'D', title: 'd', available: 0, min: 0 },  // no minimum set: never alerts
    ], { C: true, E: true }); // E recovered since the last pass
    check('lowStockCrossings: one alert per crossing, latch holds, recovery re-arms',
      lows.crossed.length === 1 && lows.crossed[0].sku === 'A'
        && lows.below.A === true && lows.below.C === true
        && lows.below.B === undefined && lows.below.E === undefined,
      lows);
    res = await exec(`api.setStockMin('sid-1', 5)`);
    check('stock:setMin refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    const lowView = await exec(`(() => {
      const lvl = (n, o, m) => [{ locationId: 'L1', locationName: 'Digital World Shop', stockLevel: n, inOrders: o, due: 0, minimumLevel: m, available: n - o }];
      stockSeed({ ok: true, locationId: 'L1', locationName: 'Digital World Shop', items: [
        { stockItemId: '1', sku: 'S25-128GB-NAVY', title: 'navy', barcode: '', category: '', image: '', levels: lvl(2, 1, 5) },
        { stockItemId: '2', sku: 'A16-64GB-BLK', title: 'black', barcode: '', category: '', image: '', levels: lvl(9, 0, 2) },
      ] });
      renderStockChips();
      renderStock();
      const out = {
        // the Low stock CHIP was removed (owner request 2026-08-06); the red
        // Available tint and Min editing stay
        chipGone: !document.querySelector('#stockChips [data-view="low"]'),
        lowRed: !!document.querySelector('#stockList .stock-avail.is-low'),
        minBtn: !!document.querySelector('#stockList .stock-min-btn'),
      };
      stockCache = null; renderStockChips();
      return out;
    })()`);
    check('low stock: chip removed, red Available tint + Min editing stay',
      lowView.chipGone === true && lowView.lowRed === true && lowView.minBtn === true,
      lowView);

    // 35. day-over-day sales deltas (the Sales tab itself was removed; its
    // backend stays and feeds the Stock page badges)
    const deltas = await exec(`[
      salesDeltaText(11, 10), salesDeltaText(9, 10), salesDeltaText(5, 5),
      salesDeltaText(3, 0), salesDeltaText(0, 4), salesDeltaText(0, 0),
    ]`);
    check('salesDeltaText: +10% / -10% / flat / new / -100% / nothing',
      deltas[0].text === '+10%' && deltas[0].cls === 'is-pos'
        && deltas[1].text === '-10%' && deltas[1].cls === 'is-neg'
        && deltas[2].text === '0%' && deltas[2].cls === 'is-flat'
        && deltas[3].text === 'new' && deltas[3].cls === 'is-pos'
        && deltas[4].text === '-100%' && deltas[4].cls === 'is-neg'
        && deltas[5] === null,
      deltas);
    res = await exec(`api.salesQuery('2026-08-01', '2026-08-03')`);
    check('sales:query refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);

    // 35b. stock history (owner 2026-09-23): every level write the app makes
    // lands in stock_log with who / which computer; the grid's tray clock
    // and count tooltip read today's summary
    db.logStockChanges([
      { sku: 'sh-test-sku', locationId: 'loc-1', delta: 2, levelAfter: 5, reason: 'return', changeSource: 'Capture Station return', ref: 'PO-77', note: 'new', computer: 'Front desk', by: 'RS' },
      { sku: 'SH-TEST-SKU', locationId: 'loc-1', delta: null, levelAfter: 4, reason: 'set', changeSource: 'Capture Station stock page', note: 'set to 4', computer: 'Office' },
    ]);
    const shRows = db.stockHistory('sh-test-sku');
    check('stock_log: two rows for the SKU, newest first, SKU upper-cased, delta null on a hand-set count',
      shRows.length === 2 && shRows[0].sku === 'SH-TEST-SKU' && shRows[0].reason === 'set' && shRows[0].delta === null
        && shRows[0].level_after === 4 && shRows[1].delta === 2 && shRows[1].ref === 'PO-77' && shRows[1].computer === 'Front desk' && shRows[1].by === 'RS',
      shRows);
    const shToday = db.stockHistoryToday();
    check('stock_log today summary: count 2, last = the hand-set row',
      shToday['SH-TEST-SKU'] && shToday['SH-TEST-SKU'].count === 2 && shToday['SH-TEST-SKU'].lastReason === 'set' && shToday['SH-TEST-SKU'].lastComputer === 'Office',
      shToday['SH-TEST-SKU']);
    // channel links made / removed land as MAPPED / UNMAPPED lines (owner 2026-10-23);
    // dated a month back so the History dialog's last-7-days check never sees them
    db.logStockChanges([
      { sku: 'sh-map-sku', createdAt: new Date(Date.now() - 30 * 86400000).toISOString(), delta: 0, reason: 'mapped', changeSource: 'Capture Station mapping', computer: 'Office', data: { channelSku: 'WM-TABA9-64', source: 'WALMART', subSource: 'Walmart US' } },
      { sku: 'sh-map-sku', createdAt: new Date(Date.now() - 29 * 86400000).toISOString(), delta: 0, reason: 'unmapped', changeSource: 'Capture Station mapping', computer: 'Office', data: { channelSku: 'OLD-EBAY-1', source: 'EBAY', subSource: 'EBAY0' } },
    ]);
    res = await exec(`api.stockHistory('sh-map-sku').then(r => r.rows.map(e => shRowHtml(e, false, false)).join('|'))`);
    check('stock history: MAPPED / UNMAPPED lines name the listing and the channel, no stock move',
      /MAPPED/.test(res) && /linked to<\/span> <span class="mono">WM-TABA9-64<\/span>/.test(res) && /on Walmart \(Walmart US\)/.test(res)
        && /UNMAPPED/.test(res) && /no longer linked to<\/span> <span class="mono">OLD-EBAY-1<\/span>/.test(res) && /on eBay/.test(res) && !/sh-edit-btn/.test(res), res);
    res = await exec(`api.stockHistory('sh-test-sku')`);
    check('stock:history IPC returns the rows', res && res.ok === true && res.rows.length === 2 && res.rows[0].sku === 'SH-TEST-SKU', res);
    res = await exec(`api.stockHistoryToday()`);
    check('stock:historyToday IPC returns the per-SKU summary', res && res.ok === true && res.bySku['SH-TEST-SKU'].count === 2, res);
    res = await exec(`[stockHistTip(null), stockHistTip({ count: 2, lastAt: new Date().toISOString(), lastDelta: null, lastAfter: 4, lastReason: 'set', lastComputer: 'Office', lastBy: '' }), stockHistTip({ count: 1, lastAt: new Date().toISOString(), lastDelta: 2, lastReason: 'return', lastComputer: 'Front desk', lastBy: 'RS' }, true)]`);
    check('stockHistTip: quiet day / hand-set today / count tooltip keeps its click hint',
      /nothing moved today/.test(res[0]) && /2 changes today · last = 4 at \d\d:\d\d · set · Office/.test(res[1])
        && /1 change today · last \+2 at \d\d:\d\d · returned · Front desk \(RS\)\nClick to correct the count/.test(res[2]),
      res);
    await exec(`openStockHistory('sh-test-sku')`);
    await new Promise(r => setTimeout(r, 300));
    res = await exec(`({ open: $('stockHistDialog').open, sku: $('stockHistSku').textContent, items: document.querySelectorAll('#stockHistBody .sh-line').length,
      acts: [...document.querySelectorAll('#stockHistBody .sh-act')].map(e => e.textContent), who: [...document.querySelectorAll('#stockHistBody .sh-pc')].map(e => e.textContent.trim()),
      text: [...document.querySelectorAll('#stockHistBody .sh-text')].map(e => e.textContent.replace(/\\s+/g, ' ').trim()),
      pcs: [...document.querySelectorAll('#shPcMenu input')].map(i => i.value) })`);
    check('stock history dialog: opens on the SKU, one pill row per change (SET / RETURNED), the computer on the right, computers in the filter',
      res && res.open === true && res.sku === 'sh-test-sku' && res.items === 2
        && res.acts[0] === 'SET' && res.acts[1] === 'RETURNED'
        && /^to 4/.test(res.text[0]) && /^2 units \(PO#: PO-77\)/.test(res.text[1])
        && res.who[0] === 'OFFICE' && res.who[1] === 'FRONT DESK RS'
        && res.pcs.join(',') === 'Office,Front desk',
      res);
    // the action filter: tick RETURNED, only that row stays
    res = await exec(`(() => { shDlg.acts.add('returned'); renderStockHistory(); return [...document.querySelectorAll('#stockHistBody .sh-act')].map(e => e.textContent); })()`);
    check('stock history dialog: action filter narrows to RETURNED', res && res.length === 1 && res[0] === 'RETURNED', res);
    await exec(`$('stockHistDialog').close()`);
    // the History dialog IS the stock history now: every SKU, the same pill rows, filters + range
    await exec(`openHistory()`);
    await new Promise(r => setTimeout(r, 300));
    res = await exec(`({ open: $('historyDialog').open, stockShown: !$('historyStockView').hidden, capHidden: !document.getElementById('historyCapView'),
      rows: document.querySelectorAll('#hsList .sh-line').length, skus: [...document.querySelectorAll('#hsList .sh-sku')].map(e => e.textContent),
      range: $('hsRangeDd').querySelector('.sh-dd-label').textContent })`);
    check('History dialog: opens straight on the stock history, every SKU with the SKU on the row, last 7 days by default, no captures tab',
      res && res.open === true && res.stockShown === true && res.capHidden === true && res.rows === 2 && res.skus[0] === 'SH-TEST-SKU' && res.range === 'Last 7 days', res);
    res = await exec(`(() => { $('hsSearch').value = 'PO-77'; hs.text = 'PO-77'; renderHistoryStock(); return document.querySelectorAll('#hsList .sh-line').length; })()`);
    check('History dialog: Stock tab search narrows by PO#', res === 1, res);
    await exec(`$('historyDialog').close()`);
    // Capture page History mode: processed orders in the capture table
    const histRowId = db.createRow({ channel: 'walmart', orderNumber: 'HIST-ORDER-1', origin: '' }).id;
    db.setTracking(histRowId, '1Z999HIST', 'UPS');
    db.setRowItems(histRowId, [{ sku: 'SH-TEST-SKU', qty: 2 }]);
    db.markSynced(histRowId);
    await exec(`showPage('capture'); setCapHist(true)`);
    await new Promise(r => setTimeout(r, 400));
    res = await exec(`({ on: capHist.on, lit: $('capHistBtn').classList.contains('is-on'), range: !$('capHistRange').hidden, importHidden: $('shipImportBtn').hidden,
      dayHeads: document.querySelectorAll('#rowsBody tr.cap-day').length, rows: [...document.querySelectorAll('#rowsBody tr.is-hist')].map(tr => tr.querySelector('.order-num').textContent),
      gutter: document.querySelector('#rowsBody tr.is-hist .cell-gutter').className, items: document.querySelector('#rowsBody tr.is-hist .items-stack').textContent.trim(),
      trk: document.querySelector('#rowsBody tr.is-hist .cell-tracking').textContent.trim(), notes: document.querySelector('#rowsBody tr.is-hist .cap-sub').textContent.trim(), poCell: document.querySelector('#rowsBody tr.is-hist .cell-order .order-num').textContent.trim() })`);
    // the Notes column left with the Orders restyle (owner 2026-10-14): the processed word, station and note ride under the order number
    check('Capture history mode: the table shows processed orders by day with a green gutter, items, tracking and the processed time under the order number; the band swaps to the range and the History icon lights up',
      res && res.on === true && res.lit === true && res.range === true && res.importHidden === true
        && res.dayHeads >= 1 && res.rows.includes('HIST-ORDER-1') && /st-synced/.test(res.gutter)
        && /SH-TEST-SKU×2/.test(res.items) && res.trk === 'UPS 1Z999HIST' && /Processed \d\d:\d\d/.test(res.notes) && res.poCell === 'HIST-ORDER-1',
      res);
    // the note on a history row is still editable, through the same dialog, onto the same row
    res = await exec(`(() => { const tr = [...document.querySelectorAll('#rowsBody tr.is-hist')].find(t => t.textContent.includes('HIST-ORDER-1')); const b = tr.querySelector('[data-act="note"]'); if (!b) return { btn: false }; b.click(); return { btn: true, open: $('notesDialog').open, title: $('notesTitle').textContent }; })()`);
    check('Capture history mode: the note control renders and opens the notes dialog for that order', res && res.btn === true && res.open === true && /HIST-ORDER-1/.test(res.title), res);
    await exec(`$('notesText').value = 'left at side door'; $('notesForm').requestSubmit();`);
    await new Promise(r => setTimeout(r, 500));
    res = await exec(`(() => { const tr = [...document.querySelectorAll('#rowsBody tr.is-hist')].find(t => t.textContent.includes('HIST-ORDER-1')); return { saved: (tr.querySelector('.cap-sub-note') || {}).textContent || '', pill: (tr.querySelector('.history-status') || {}).textContent || '' }; })()`);
    check('Capture history mode: the saved note shows on the history row and the Processed pill is untouched', res && res.saved === 'left at side door' && /^Processed \d\d:\d\d$/.test(res.pill) && db.getRow(histRowId).notes === 'left at side door', res);
    res = await exec(`(() => { $('capHistBtn').click(); return { on: capHist.on, lit: $('capHistBtn').classList.contains('is-on'), importShown: !$('shipImportBtn').hidden, hist: document.querySelectorAll('#rowsBody tr.is-hist').length }; })()`);
    check('Capture history mode: clicking the History icon again restores the live list', res && res.on === false && res.lit === false && res.importShown === true && res.hist === 0, res);
    db.deleteRow(histRowId);
    // 35c. one history, no doubles (owner 2026-09-23: "I don't want any data
    // errors"): every log row has a unique gid and inserts are insert-if-
    // absent, so the same change can never land twice
    const shBefore = db.stockHistory('sh-test-sku').length;
    const ins1 = db.logStockChanges([{ gid: 'e2e:fixed-1', sku: 'sh-test-sku', delta: 1, levelAfter: 6, reason: 'return', computer: 'Office' }]);
    const ins2 = db.logStockChanges([{ gid: 'e2e:fixed-1', sku: 'sh-test-sku', delta: 1, levelAfter: 6, reason: 'return', computer: 'Office' }]);
    check('stock_log: the same gid inserted twice lands once', ins1.length === 1 && ins2.length === 0 && db.stockHistory('sh-test-sku').length === shBefore + 1, { ins1, ins2 });
    check('stock_log: rows logged without a gid got one (unique, non-empty)',
      db.stockHistory('sh-test-sku').every(r => r.gid && r.gid.length > 8) && new Set(db.stockHistory('sh-test-sku').map(r => r.gid)).size === db.stockHistory('sh-test-sku').length,
      db.stockHistory('sh-test-sku').map(r => r.gid));
    // the bulk-import history folds in as SET / ADDED / REMOVED rows, idempotently
    const bulkEntry = { id: 'bulk-e2e-1', ts: '2026-09-22T18:32:03.000Z', station: 'IMRAN-MACBOOK-PRO', mode: 'edit', note: '', rows: [{ sku: 'OPEN-BOX-E2E-BLACK', before: 22, qty: 19, after: 19 }] };
    const bulkAdd = { id: 'bulk-e2e-2', ts: '2026-09-22T19:00:00.000Z', station: 'IMRAN-MACBOOK-PRO', mode: 'add', note: 'Tuesday shipment', rows: [{ sku: 'X610-E2E-BLACK', before: 42, qty: 3, after: 45 }, { sku: 'X611-E2E-BLACK', before: 0, qty: 2, after: 2 }] };
    const bulkRevert = { id: 'bulk-e2e-3', ts: '2026-09-22T19:30:00.000Z', station: 'IMRAN-MACBOOK-PRO', mode: 'revert', revertOf: 'bulk-e2e-2', rows: [{ sku: 'X610-E2E-BLACK', before: 45, qty: -3, after: 42 }] };
    const conv = [bulkEntry, bulkAdd, bulkRevert].flatMap(db.stockRowsFromBulkEntry);
    check('bulk history → stock rows: edit = SET to 19 (was 22), add = +3 / +2 received, revert = −3; gids bulk:<id>:<line>',
      conv.length === 4 && conv[0].gid === 'bulk:bulk-e2e-1:0' && conv[0].delta === null && conv[0].levelAfter === 19 && conv[0].reason === 'set' && conv[0].note === 'was 22'
        && conv[1].delta === 3 && conv[1].reason === 'bulk-add' && conv[1].note === 'Tuesday shipment' && conv[2].gid === 'bulk:bulk-e2e-2:1' && conv[2].delta === 2
        && conv[3].delta === -3 && conv[3].reason === 'revert' && conv.every(r => r.computer === 'IMRAN-MACBOOK-PRO'),
      conv);
    const bulkIns1 = db.logStockChanges(conv), bulkIns2 = db.logStockChanges(conv);
    check('bulk history import is idempotent: 4 rows the first time, 0 the second, dated by the entry timestamp',
      bulkIns1.length === 4 && bulkIns2.length === 0 && db.stockHistory('X610-E2E-BLACK').length === 2 && db.stockHistory('OPEN-BOX-E2E-BLACK')[0].day === '2026-09-22',
      { bulkIns1: bulkIns1.length, bulkIns2: bulkIns2.length });
    // the rows read back through the dialog as the pill words the owner asked for
    await exec(`openStockHistory('X610-E2E-BLACK')`);
    await new Promise(r => setTimeout(r, 300));
    res = await exec(`[...document.querySelectorAll('#stockHistBody .sh-act')].map(e => e.textContent).join(',') + '|' + [...document.querySelectorAll('#stockHistBody .sh-pc')].map(e => e.textContent.trim()).join(',')`);
    check('bulk-derived rows render as REMOVED (revert) then ADDED, by IMRAN-MACBOOK-PRO', res === 'REMOVED,ADDED|IMRAN-MACBOOK-PRO,IMRAN-MACBOOK-PRO', res);
    await exec(`$('stockHistDialog').close()`);
    // 35d2. the Pricing bar wears the Capture band's icon cluster (owner 2026-09-24)
    res = await exec(`({ hist: $('prHistBtn').className, refresh: $('prRefresh').className, inCluster: !!$('prRefresh').closest('.pr-bar .cap-icons'), words: ($('prHistBtn').textContent + $('prRefresh').textContent).trim() })`);
    check('Pricing bar: History and Refresh are icon buttons in one cluster, no words', res && /cap-ico/.test(res.hist) && /cap-ico/.test(res.refresh) && res.inCluster === true && res.words === '', res);

    // 35e. the customer card on a PO (owner 2026-09-24): an "i" after the PO#
    // opens (on click, never hover) the buyer, ship-to and phone with copy buttons
    const custRowId = db.createRow({ channel: 'walmart', orderNumber: 'CUST-ORDER-1', origin: '' }).id;
    await exec(`(async () => { showPage('capture'); setCapHist(false); state = await api.getState(); state.orderMeta['CUST-ORDER-1'] = { source: 'WALMART', despatchBy: '', items: [{ sku: 'X133-64GB-GRAY', qty: 1 }],
      customer: { name: 'Maria Delgado', company: '', address: ['2841 Palmetto Ave, Apt 4B', 'Hialeah, FL 33012', 'United States'], phone: '(305) 555-0142' } }; render(); })()`);
    res = await exec(`(() => { const tr = [...document.querySelectorAll('#rowsBody tr')].find(t => t.textContent.includes('CUST-ORDER-1')); const b = tr && tr.querySelector('button.cust-info'); if (!b) return { btn: false };
      const before = !!document.querySelector('.cust-card'); b.click();
      const card = document.querySelector('.cust-card'); return { btn: true, before, open: !!card, isOpen: b.classList.contains('is-open'),
        labels: [...card.querySelectorAll('.cust-l')].map(e => e.textContent), name: card.querySelector('.cust-v').textContent,
        copies: [...card.querySelectorAll('.cust-copy')].map(e => e.dataset.copy), foot: card.querySelector('.cust-foot').textContent }; })()`);
    check('customer card: the "i" renders when the order carries a buyer, opens on click with name / ship-to / phone and a copy value each',
      res && res.btn === true && res.before === false && res.open === true && res.isOpen === true
        && res.labels.join(',') === 'Customer,Ship to,Phone' && res.name === 'Maria Delgado'
        && res.copies[0] === 'Maria Delgado' && res.copies[1] === '2841 Palmetto Ave, Apt 4B\nHialeah, FL 33012\nUnited States' && res.copies[2] === '(305) 555-0142'
        && /Walmart · captured/.test(res.foot),
      res);
    res = await exec(`(() => { const b = document.querySelector('#rowsBody button.cust-info.is-open'); if (!b) return null; b.click(); const closed = !document.querySelector('.cust-card'); b.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return { closed, escClosed: !document.querySelector('.cust-card') }; })()`);
    check('customer card: a second click closes it, and so does Escape', res && res.closed === true && res.escClosed === true, res);
    res = await exec(`(() => { delete state.orderMeta['CUST-ORDER-1']; render(); const tr2 = [...document.querySelectorAll('#rowsBody tr')].find(t => t.textContent.includes('CUST-ORDER-1')); return !!tr2 && !tr2.querySelector('button.cust-info'); })()`);
    check('customer card: no "i" when the order has no buyer on record', res === true, res);
    db.deleteRow(custRowId);

    // the bulk popup no longer carries its own history (it all lives in the Stock tab)
    res = await exec(`({ hist: !!document.getElementById('bulkHist'), rev: !!document.getElementById('bulkRevDialog') })`);
    check('bulk popup: its history list and revert dialog are gone', res && res.hist === false && res.rev === false, res);

    // 35d. corrections (owner 2026-09-23): edit / delete a history line
    // through a NEW linked line, never by rewriting the old one
    const lm = () => db.stockLogLinkMap();
    const lvl = (m) => (k) => (k in m ? m[k] : null);
    const noLater = () => null;
    db.logStockChanges([{ gid: 'e2e:orig-add', sku: 'S26-256GB-VIOLET', delta: 16, levelAfter: 16, reason: 'bulk-add', computer: 'Stock room', createdAt: '2026-09-21T21:30:00.000Z' }]);
    const origAdd = db.stockLogGet('e2e:orig-add');
    let plan = db.planStockCorrection({ original: origAdd, linkMap: lm(), change: { qty: 15, sku: 'S26-256GB-VIOLET' }, levelOf: lvl({ 'S26-256GB-VIOLET': 16 }), laterSet: noLater });
    check('planner: 16 → 15 on the same SKU applies −1', plan.ok && plan.applies.length === 1 && plan.applies[0].applied === -1 && plan.data.toQty === 15 && /−1 on S26-256GB-VIOLET \(16 → 15\)/.test(plan.text), plan);
    plan = db.planStockCorrection({ original: origAdd, linkMap: lm(), change: { qty: 16, sku: 'S26-256GB-BLUE' }, levelOf: lvl({ 'S26-256GB-VIOLET': 16, 'S26-256GB-BLUE': 3 }), laterSet: noLater });
    check('planner: a SKU change moves the units: −16 off the old listing, +16 onto the new', plan.ok && plan.applies.length === 2 && plan.applies[0].applied === -16 && plan.applies[1].sku === 'S26-256GB-BLUE' && plan.applies[1].applied === 16, plan);
    plan = db.planStockCorrection({ original: origAdd, linkMap: lm(), change: { qty: 16, sku: 'NOT-A-LISTING' }, levelOf: lvl({ 'S26-256GB-VIOLET': 16 }), laterSet: noLater });
    check('planner: a SKU that is not in Linnworks is refused', plan.ok === false && /not in Linnworks/.test(plan.error), plan);
    plan = db.planStockCorrection({ original: origAdd, linkMap: lm(), change: { del: true }, levelOf: lvl({ 'S26-256GB-VIOLET': 2 }), laterSet: noLater });
    check('planner: deleting a +16 line with only 2 on hand removes 2 and says so (floor at zero)', plan.ok && plan.applies[0].delta === -16 && plan.applies[0].applied === -2 && /removed 2 of 16, only 2 on hand/.test(plan.notes.join(' ')), plan);
    plan = db.planStockCorrection({ original: origAdd, linkMap: lm(), change: { del: true }, levelOf: lvl({ 'S26-256GB-VIOLET': 20 }), laterSet: () => ({ day: '2026-09-22' }) });
    check('planner rule 1: a later hand-set count makes the delete record-only', plan.ok && plan.recordOnly === true && plan.applies[0].applied === 0 && plan.applies[0].skipped === 'later-set' && /set by hand on 09\/22, record only/.test(plan.notes[0]), plan);
    db.logStockChanges([{ gid: 'e2e:orig-ret', sku: 'S26-256GB-VIOLET', delta: 1, levelAfter: 17, reason: 'return', computer: 'Front desk', ref: 'PO-1' }]);
    plan = db.planStockCorrection({ original: db.stockLogGet('e2e:orig-ret'), linkMap: lm(), change: { del: true }, levelOf: lvl({}), laterSet: noLater });
    check('planner: a return line points to Returns instead', plan.ok === false && /corrected in Returns/.test(plan.error), plan);
    // record the 16 → 15 correction the way stock:historyApply does, then the line's effective state + marks follow the link
    db.logStockChanges([{ gid: 'e2e:fix-1', sku: 'S26-256GB-VIOLET', delta: -1, reason: 'edit-qty', computer: 'Office', note: '16 → 15 units · corrects the entry from 09/21', linkKind: 'edit', linkGid: 'e2e:orig-add', data: { kind: 'edit', fromSku: 'S26-256GB-VIOLET', fromQty: 16, toSku: 'S26-256GB-VIOLET', toQty: 15, applied: [{ sku: 'S26-256GB-VIOLET', delta: -1 }] } }]);
    let eff = db.stockLogEffective(db.stockLogGet('e2e:orig-add'), lm());
    check('effective state after a correction: 15 units, corrected, not deleted', eff.qty === 15 && eff.corrected === true && eff.deleted === false, eff);
    plan = db.planStockCorrection({ original: db.stockLogGet('e2e:orig-add'), linkMap: lm(), change: { del: true }, levelOf: lvl({ 'S26-256GB-VIOLET': 40 }), laterSet: noLater });
    check('planner: deleting a corrected line takes out its corrected quantity (15, not 16)', plan.ok && plan.applies[0].applied === -15, plan);
    plan = db.planStockCorrection({ original: db.stockLogGet('e2e:fix-1'), linkMap: lm(), change: { qty: 3 }, levelOf: lvl({}), laterSet: noLater });
    check('planner: a correction line cannot be edited, only deleted', plan.ok === false && /can be deleted/.test(plan.error), plan);
    plan = db.planStockCorrection({ original: db.stockLogGet('e2e:fix-1'), linkMap: lm(), change: { del: true }, levelOf: lvl({ 'S26-256GB-VIOLET': 40 }), laterSet: noLater });
    check('planner: deleting the correction reverses exactly what it applied (+1)', plan.ok && plan.applies.length === 1 && plan.applies[0].applied === 1, plan);
    db.logStockChanges([{ gid: 'e2e:del-fix-1', sku: 'S26-256GB-VIOLET', delta: 1, reason: 'deleted', computer: 'Office', note: 'deleted the entry from 09/23', linkKind: 'delete', linkGid: 'e2e:fix-1', data: { kind: 'delete', applied: [{ sku: 'S26-256GB-VIOLET', delta: 1 }] } }]);
    eff = db.stockLogEffective(db.stockLogGet('e2e:orig-add'), lm());
    check('deleting the correction restores the original: 16 units, no longer corrected', eff.qty === 16 && eff.corrected === false, eff);
    const ann = db.annotateStockRows(db.stockHistory('S26-256GB-VIOLET'));
    const annOrig = ann.find(r => r.gid === 'e2e:orig-add'), annFix = ann.find(r => r.gid === 'e2e:fix-1');
    check('annotated rows: the original has no live marks left, the undone correction carries its own deleted mark and points at the original',
      annOrig && annOrig.marks.length === 0 && annFix && annFix.marks.length === 1 && annFix.marks[0].kind === 'delete' && annFix.target && annFix.target.gid === 'e2e:orig-add' && annFix.eff.deleted === true, { annOrig: annOrig && annOrig.marks, annFix: annFix && { marks: annFix.marks, target: annFix.target } });
    // a fresh delete on the original, for the on-screen marks
    db.logStockChanges([{ gid: 'e2e:del-orig', sku: 'S26-256GB-VIOLET', delta: -16, reason: 'deleted', computer: 'Office', note: 'deleted the entry from 09/21', linkKind: 'delete', linkGid: 'e2e:orig-add', data: { kind: 'delete', fromSku: 'S26-256GB-VIOLET', fromQty: 16, applied: [{ sku: 'S26-256GB-VIOLET', delta: -16 }] } }]);
    await exec(`openStockHistory('S26-256GB-VIOLET')`);
    await new Promise(r => setTimeout(r, 300));
    res = await exec(`(() => { const L = [...document.querySelectorAll('#stockHistBody .sh-line')]; const g = (gid) => L.find(l => l.dataset.gid === gid); return {
      acts: L.map(l => l.querySelector('.sh-act').textContent),
      origDeleted: g('e2e:orig-add').classList.contains('is-deleted'), origMark: g('e2e:orig-add').querySelector('.sh-mark') ? g('e2e:orig-add').querySelector('.sh-mark').textContent : '',
      origTools: !!g('e2e:orig-add').querySelector('.sh-edit-btn'), delBack: (g('e2e:del-orig').querySelector('.sh-goto') || {}).textContent || '',
      retTools: (g('e2e:orig-ret').querySelector('.sh-tools') || {}).textContent || '', fixUndone: g('e2e:fix-1').classList.contains('is-deleted') }; })()`);
    check('stock history rows: DELETED pill, the original struck through with a clickable "deleted" mark and no tools, the DELETED line pointing back, the return line pointing to Returns',
      res && res.acts.includes('DELETED') && res.origDeleted === true && res.origMark === 'deleted' && res.origTools === false
        && /deleted the entry from 9\/21 by STOCK ROOM/.test(res.delBack) && /edit in Returns/.test(res.retTools) && res.fixUndone === true,
      res);
    // the jump: clicking the DELETED line's pointer flashes the original
    res = await exec(`(() => { document.querySelector('#stockHistBody .sh-line[data-gid="e2e:del-orig"] .sh-goto').click(); return document.querySelector('#stockHistBody .sh-line[data-gid="e2e:orig-add"]').classList.contains('is-flash'); })()`);
    check('stock history rows: the pointer jumps to and flashes the original line', res === true, res);
    // the editor opens in place on an editable line and asks the planner (refused in capture-only, shown inline, never thrown)
    db.logStockChanges([{ gid: 'e2e:orig-add-2', sku: 'S26-256GB-VIOLET', delta: 5, levelAfter: 5, reason: 'bulk-add', computer: 'Stock room' }]);
    await exec(`openStockHistory('S26-256GB-VIOLET')`);
    await new Promise(r => setTimeout(r, 300));
    res = await exec(`(() => { document.querySelector('#stockHistBody .sh-line[data-gid="e2e:orig-add-2"] .sh-edit-btn').click(); const l = document.querySelector('#stockHistBody .sh-line[data-gid="e2e:orig-add-2"]'); return { editing: l.classList.contains('sh-editing'), qty: l.querySelector('.sh-edit-qty').value, sku: l.querySelector('.sh-edit-sku').value, save: l.querySelector('.sh-edit-save').disabled }; })()`);
    await new Promise(r => setTimeout(r, 300));
    res.preview = await exec(`document.querySelector('#stockHistBody .sh-line[data-gid="e2e:orig-add-2"] .sh-edit-preview').textContent`);
    check('stock history editor: opens in place with the line\'s qty and SKU, Save disabled until the plan answers, capture-only refusal shown inline',
      res && res.editing === true && res.qty === '5' && res.sku === 'S26-256GB-VIOLET' && res.save === true && /Capture-only/.test(res.preview), res);
    await exec(`$('stockHistDialog').close()`);
    await exec(`$('historyDialog').close()`);

    // 36. returns resize: whole-width grip + per-column grips on the log
    // (the worksheet left with design C, 2026-08-07 — the log is the sheet)
    const retGrips = await exec(`[
      !!$('retGrip'),
      document.querySelectorAll('#retPastBox thead .col-grip').length,
    ]`);
    check('returns log: shared width grip + column grips',
      retGrips[0] === true && retGrips[1] === 11, retGrips);

    // 37. shipped-orders file import: header detection ignores the "Update
    // Tracking Number" column, per-PO dedupe, bulk fill + conflict report
    const shipfile = require('./shipfile.js');
    const shipCsv = require('path').join(app.getPath('userData'), 'ship-test.csv');
    fs.writeFileSync(shipCsv, [
      'PO#,Order#,Status,Carrier,Tracking Number,Update Tracking Number',
      '119990000000001,2001,Shipped,UPS,1Z0000000000000001,',
      '119990000000001,2001,Shipped,UPS,1Z0000000000000001,',
      '119990000000002,2002,Shipped,FedEx,881122334455,',
      '119990000000003,2003,Shipped,UPS,1Z0000000000000003,',
      '119990000000009,2009,Shipped,UPS,1Z0000000000000009,',
    ].join('\n'));
    const shipRecs = shipfile.extractShipped(shipCsv);
    check('shipped file parses with the right tracking column',
      shipRecs.length === 5 && shipRecs[0].tracking === '1Z0000000000000001' && shipRecs[0].carrier === 'UPS',
      shipRecs.slice(0, 2));
    const s1 = db.createRow({ channel: 'walmart', orderNumber: '119990000000001', origin: 'linnworks' });
    const s2 = db.createRow({ channel: 'walmart', orderNumber: '119990000000002', origin: 'linnworks' });
    const s3 = db.createRow({ channel: 'walmart', orderNumber: '119990000000003', origin: 'linnworks' });
    db.setTracking(s3.id, 'DIFFERENT-TRACKING', 'USPS');
    const shipSum = shipfile.applyShipped(db, shipRecs);
    check('shipped import fills empty rows, spares filled ones, reports the rest',
      shipSum.filled === 2
        && db.getRow(s1.id).tracking === '1Z0000000000000001'
        && db.getRow(s2.id).tracking === '881122334455'
        && db.getRow(s2.id).carrier === 'FedEx'
        && db.getRow(s3.id).tracking === 'DIFFERENT-TRACKING'
        && shipSum.conflicts.length === 1
        && shipSum.notInQueue.length === 1 && shipSum.notInQueue[0] === '119990000000009',
      shipSum);
    db.deleteRow(s1.id);
    db.deleteRow(s2.id);
    db.deleteRow(s3.id);

    // 38. channel mapping: capture-only refusals + seeded dialog + link flow
    res = await exec(`api.mappingChannels()`);
    check('mapping:channels refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    res = await exec(`api.mappingItems(1, 'WALMART', 'SUB')`);
    check('mapping:items refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    res = await exec(`api.mappingLink('A', 'WALMART', 'SUB', 'B')`);
    check('mapping:link refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    res = await exec(`api.mappingUnlink('rid')`);
    check('mapping:unlink refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    res = await exec(`api.unparkOrder('119990000000001')`);
    check('orders:unpark refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    res = await exec(`api.stockSetTitle('sid-1', 'A title')`);
    check('stock:setTitle refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    for (const [label, call] of [['wmsite:go', `api.wmsiteGo('galaxy tab a9')`], ['walmart:siteSearch', `api.walmartSiteSearch('galaxy tab a9', 1)`], ['walmart:mine', 'api.walmartMine()'], ['walmart:itemDetails', `api.walmartItemDetails('1735902284')`],
      ['walmart:mapState', `api.walmartMapState(['X'])`], ['walmart:pricing', 'api.walmartPricing()'],
      ['walmart:pricingSave', `api.walmartPricingSave([{ sku: 'X', strategy: 'S', min: 1, max: 2 }], [])`],
      ['walmart:saveStrategy', `api.walmartSaveStrategy({ name: 'S' })`], ['walmart:incentives', 'api.walmartIncentives()'],
      ['walmart:incentiveEnroll', `api.walmartIncentiveEnroll([{ sku: 'X' }], true)`], ['walmart:wfOpt', `api.walmartWfOpt(['X'], false)`],
      ['walmart:wfAll', 'api.walmartWfAll(false)']]) {
      res = await exec(call);
      check(`${label} refused in capture-only mode`, res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    }
    res = await exec(`api.walmartSubmit([{ sku: 'X', upc: '887276790801', price: 1, qty: 1, shipLb: 1 }])`);
    check('walmart:submit refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    {
      // List on Walmart: the API client's pure builders + parsers
      const w = require('./walmart.js');
      const feed = w.buildMatchFeed([{ sku: 'X110-64GB-GRAY', upc: '887276790801', price: 116.989, shipLb: 1.2 }]);
      const it0 = feed.MPItem[0].Item;
      check('walmart feed: 4.2 match header, GTIN-14 offer, New, rounded price',
        feed.MPItemFeedHeader.version === '4.2' && feed.MPItemFeedHeader.sellingChannel === 'mpsetupbymatch'
          && !('businessUnit' in feed.MPItemFeedHeader) && it0.productIdentifiers.productIdType === 'GTIN'
          && it0.productIdentifiers.productId === '00887276790801' && it0.price === 116.99
          && it0.ShippingWeight === 1.2 && it0.condition === 'New' && it0.sku === 'X110-64GB-GRAY', feed);
      const po = w.buildMatchFeed([{ sku: 'USED-X', upc: '887276790801', price: 89, shipLb: 1, condition: 'Pre-Owned: Good', mainImageUrl: 'https://img/x.jpg' },
        { sku: 'NEW-X', upc: '887276790801', price: 99, shipLb: 1, condition: 'New', mainImageUrl: 'https://img/x.jpg' }]).MPItem;
      check('walmart feed: a Pre-Owned offer carries its condition and photo, New carries no photo',
        po[0].Item.condition === 'Pre-Owned: Good' && po[0].Item.mainImageUrl === 'https://img/x.jpg'
          && po[1].Item.condition === 'New' && !('mainImageUrl' in po[1].Item)
          && w.MATCH_CONDITIONS.includes('Pre-Owned: Fair') && !w.MATCH_CONDITIONS.includes('Open Box'), po);
      check('walmart ids: 12 -> upc, 13 -> ean, 14 -> gtin, 11 widened, junk refused',
        w.idParam('887276790801').param === 'upc' && w.idParam('8806094912345').param === 'ean'
          && w.idParam('00887276790801').param === 'gtin' && w.idParam('87276790801').value === '087276790801'
          && w.idParam('123') === null && w.toGtin14('12') === '', null);
      const ns = w.normalizeSearch({ items: [{ itemId: 5, title: 'T', brand: 'B', price: { amount: '9.68', currency: 'USD' }, images: [{ url: 'https://i/x.jpg' }], customerRating: '4.7', properties: { numReviews: '198' } }, { itemId: '6', title: 'U' }] });
      check('walmart search: string price, rating and review count read, missing ones are 0, page URL, {} is no match',
        ns.length === 2 && ns[0].price === 9.68 && ns[1].price === 0 && ns[0].url === 'https://www.walmart.com/ip/5'
          && ns[0].rating === 4.7 && ns[0].reviews === 198 && ns[1].rating === 0 && ns[1].reviews === 0
          && ns[0].image === 'https://i/x.jpg' && w.normalizeSearch({}).length === 0, ns);
      const st = w.parseFeedStatus({ feedStatus: 'PROCESSED', itemsReceived: 2, itemsSucceeded: 1, itemsFailed: 1,
        itemDetails: { itemIngestionStatus: [
          { sku: 'A', ingestionStatus: 'SUCCESS', wpid: 'W1', ingestionErrors: null },
          { sku: 'B', ingestionStatus: 'DATA_ERROR', wpid: null, ingestionErrors: { ingestionError: [{ type: 'DATA_ERROR', code: 'E1', field: 'price', description: 'too low' }] } },
        ] } });
      check('walmart feed status: per-SKU state, readable errors, settled states',
        st.status === 'PROCESSED' && st.items.A.status === 'SUCCESS' && st.items.B.errors[0] === 'price: too low'
          && st.counts.failed === 1 && w.isFinal('DATA_ERROR') && w.isFinal('SUCCESS') && !w.isFinal('INPROGRESS'), st);
      check('walmart errors: JSON error lists read as one line',
        w.errorText({ errors: { error: [{ code: 'X', description: 'Bad SKU' }] } }, 400) === 'Bad SKU', null);
      // Walmart tab (owner 2026-10-23): pricing, repricer, incentives, the product page
      const ins = w.parseInsight({ sku: 'A', itemName: 'Tab', currentPrice: 124.99, buyBoxBasePrice: 119, buyBoxWinRate: '12.5', repricerStrategyName: 'Beat by $1', repricerMinPrice: 120, repricerMaxPrice: 150, competitorPrice: null });
      check('walmart pricing insights: price, Buy Box, win rate (a percentage string), strategy, min / max',
        ins.price === 124.99 && ins.bbPrice === 119 && ins.winRate === 12.5 && ins.strategy === 'Beat by $1' && ins.min === 120 && ins.max === 150
          && ins.competitor === null && w.parseInsight({ sku: 'B', buyBoxWinRate: null }).winRate === null && w.parseInsight({}) === null, ins);
      const stp = w.parseStrategy({ repricerStrategy: 'Open box 2%', strategyCollectionId: 'c1', enabled: true, assignedCount: 10, strategies: [{ strategyType: 'Buy Box Price', adjustmentType: 'PERCENTAGE', adjustmentValue: 2 }] });
      const stb = w.buildStrategy({ name: 'Beat by $1', type: 'Buy Box Price', unit: '$', value: 1 });
      check('walmart repricer strategy: read (name, id, count, % rule) and built (UNIT adjustment, flags off)',
        stp.id === 'c1' && stp.name === 'Open box 2%' && stp.count === 10 && stp.unit === '%' && stp.value === 2
          && stb.repricerStrategy === 'Beat by $1' && stb.strategies[0].strategyType === 'Buy Box Price' && stb.strategies[0].adjustmentType === 'UNIT'
          && stb.strategies[0].adjustmentValue === 1 && stb.enableRepricerForPromotion === false, { stp, stb });
      const rf = w.buildRepricerFeed([{ sku: 'A', strategy: 'Beat by $1', min: 99.999, max: 150 }, { sku: 'B', strategy: '' }]);
      check('walmart repricer feed: items by strategy NAME with min / max; no strategy = the reserved take-out name',
        rf.ItemFeedHeader.sellingChannel === 'repricerstrategy' && rf.Item[0].Strategy.repricerStrategy === 'Beat by $1'
          && rf.Item[0].Strategy.minimumSellerAllowedPrice === 100 && rf.Item[0].Strategy.maximumSellerAllowedPrice === 150
          && rf.Item[1].Strategy.repricerStrategy === w.NO_STRATEGY && !('minimumSellerAllowedPrice' in rf.Item[1].Strategy), rf);
      const inc = w.parseIncentive({ skuId: 'S1', itemId: 649861121, productName: 'P', currentPrice: 20.5, targetPrice: 20, baseReferralFee: 8, reducedReferralFee: 7, incentiveType: 'REDUCED_REFERRAL', incentiveStatus: 'NEW', inventoryCount: '200', expirationDate: '1660805999000', incentiveId: 'i1', productUrl: 'https://www.walmart.com/ip/649861121' });
      const ef = w.buildIncentiveFeed([{ sku: 'S1', incentiveId: 'i1' }], true);
      const wf = w.buildWalmartFundedFeed(['S1'], false);
      check('walmart incentives: skuId read, epoch-ms dates as days, enroll Y with the incentive id, Walmart-funded Opt-out',
        inc.sku === 'S1' && inc.itemId === '649861121' && inc.target === 20 && inc.reducedFee === 7 && inc.stock === 200 && /^2022-08-1[78]$/.test(inc.expires)
          && ef.ProgramActionFeedHeader.feedType === 'INCENTIVE_ENROLLMENT' && ef.ProgramAction[0].Programs.IncentivesEnrollment.referralFeeIncentiveEnrollment === 'Y'
          && ef.ProgramAction[0].Programs.IncentivesEnrollment.incentiveId === 'i1'
          && wf.ProgramAction[0].Programs.WalmartFundedIncentivesEnrollment.walmartFundedIncentivesEnrollment === 'Opt-out', { inc, ef, wf });
      const pg = w.parseProductPage({ json: ['{"@type":"Product","brand":{"@type":"Brand","name":"SAMSUNG"},"aggregateRating":{"ratingValue":"4.6","reviewCount":"2341"}}', '{"product":{"currentPrice":{"price":119,"priceString":"$119.00"},"sellerDisplayName":"Walmart.com","additionalOfferCount":13}}'], body: 'More seller options (13)', title: 'Galaxy Tab A9', image: 'https://i5.walmartimages.com/x.jpg' });
      check('walmart product page: sellers, Buy Box holder, price, rating, brand; nothing found = unknown, not 0',
        pg.sellers === 14 && pg.buyBoxSeller === 'Walmart.com' && pg.price === 119 && pg.rating === 4.6 && pg.reviews === 2341 && pg.brand === 'SAMSUNG'
          && w.parseProductPage({}).sellers === null && w.parseProductPage({}).rating === null, pg);
      const is = w.parseItemStatus({ ItemResponse: [{ sku: 'A', publishedStatus: 'UNPUBLISHED', lifecycleStatus: 'ACTIVE', unpublishedReasons: { reason: ['No price was found for this listing.'] } }], totalItems: 1 });
      check('walmart item status: published / unpublished with Walmart\'s reasons',
        is.published === 'UNPUBLISHED' && is.reasons[0] === 'No price was found for this listing.' && w.parseItemStatus({ publishedStatus: 'PUBLISHED' }).published === 'PUBLISHED', is);
      check('walmart errors: the repricer\'s errorMessage reads as the error', w.errorText({ status: 'BAD_REQUEST', errorMessage: 'Error(s) : Strategy name is duplicate' }, 400) === 'Error(s) : Strategy name is duplicate', null);
    }

    const prevLookup2 = await exec('recvLookup');
    await exec(`
      chmap.local = true;
      chmap.channels = [{ id: 1, source: 'WALMART', subSource: 'SUB' }];
      chmap.chan = chmap.channels[0];
      chmap.items = [
        { sku: 'TWIN-A', title: 'Twin A', wfs: false, linked: true, linkedItemId: 's1', rowId: 'r1', qty: 2 },
        { sku: 'TWIN-B', title: 'Twin B', wfs: false, linked: false, linkedItemId: '', rowId: '', qty: 3 },
      ];
      recvItems = [
        { sku: 'LW-1', title: 'Item one', stockItemId: 's1' },
        { sku: 'LW-2', title: 'Item two', stockItemId: 's2' },
      ];
      recvBySku = new Map(recvItems.map(i => [i.sku.toLowerCase(), i]));
      recvByBarcode = new Map();
      recvLookup = 'ready';
      chmapOpen();
    `);
    await sleep(200);
    const cm = await exec(`[
      !!document.querySelector('#chmapDialog[open]'),
      document.querySelectorAll('#chmapWmBody tr').length,
      !!document.querySelector('#chmapWmBody .chmap-lk'),
      !!document.querySelector('#chmapWmBody .chmap-unlink'),
      [...document.querySelectorAll('#chmapLwBody .chmap-link')].every(b => b.disabled),
      $('chmapChanLbl').textContent,
      (document.querySelectorAll('#chmapWmBody tr')[0].cells[1].textContent || '').trim(),
    ]`);
    check('mapping dialog renders both sheets from seeded state',
      cm[0] === true && cm[1] === 2 && cm[2] === true && cm[3] === true
        && cm[4] === true && cm[5] === 'Walmart' && cm[6] === 'LW-1',
      cm);
    await exec(`document.querySelectorAll('#chmapWmBody tr')[1].cells[0].click()`);
    const en = await exec(`[...document.querySelectorAll('#chmapLwBody .chmap-link')].some(b => !b.disabled)`);
    check('selecting a listing enables the Link buttons', en === true, en);
    await exec(`document.querySelectorAll('#chmapLwBody .chmap-link')[1].click()`);
    await sleep(120);
    const cmLinked = await exec(`[chmap.items[1].linked, chmap.items[1].linkedSkuOverride]`);
    check('Link maps the listing to the chosen SKU', cmLinked[0] === true && cmLinked[1] === 'LW-2', cmLinked);
    await exec(`$('chmapWmQ').value = 'twin-a'; renderChmap()`);
    const cmFilt = await exec(`document.querySelectorAll('#chmapWmBody tr').length`);
    check('left search filters the catalog locally', cmFilt === 1, cmFilt);
    await exec(`$('chmapWmQ').value = ''; $('chmapDialog').close();
      chmap.local = false; chmap.items = []; chmap.channels = []; chmap.chan = null; chmap.sel = null;
      recvItems = null; recvBySku = null; recvByBarcode = null; recvLookup = ${JSON.stringify(prevLookup2)};`);

    // screenshot of the live window for visual review
    if (process.env.CAPTURE_E2E_SHOT) {
      await sleep(400);
      let img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.CAPTURE_E2E_SHOT, img.toPNG());
      console.log(`SHOT ${process.env.CAPTURE_E2E_SHOT}`);
      await exec(`api.setConfig(${JSON.stringify({ captureOnly: false, pages: { returns: true } })})`);
      await sleep(400); // let state:changed land so the pane becomes allowed
      // per-order location move: DS chip + row swap action
      await exec(`
        state.locations = { primaryName: 'Digital World Shop', fallbackName: 'DropShip', fallbackSet: true };
        state.orderMeta['119121297240391'] = { source: 'WALMART', dropship: true, despatchBy: '', items: [{ sku: 'S25-128GB-NAVY', qty: 1, title: '', img: '' }] };
        state.orderMeta['02-12345-67890'] = { source: 'EBAY', despatchBy: '', items: [{ sku: 'A16-64GB-BLK', qty: 2, title: '', img: '' }] };
        render();
        const tr = document.querySelector('#rowsBody tr:last-child');
        if (tr) tr.querySelector('.row-actions').style.opacity = '1';
      `);
      await sleep(250);
      img = await win.webContents.capturePage();
      const moveShot = process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-move.png');
      fs.writeFileSync(moveShot, img.toPNG());
      console.log(`SHOT ${moveShot}`);
      // substitution: pill on the row + the dialog prefilled
      db.setSubstitution(ebayRow.id, 'X230-128GB-GRAY', 2, 'ordered A16-64GB-BLK, shipped X230-128GB-GRAY');
      await exec(`api.updateRow(${ebayRow.id}, {})`);
      await sleep(250);
      await exec(`
        recvItems = recvItems || [];
        openSubDialog(state.rows.find(r => r.id === ${ebayRow.id}));
      `);
      await sleep(250);
      img = await win.webContents.capturePage();
      const subShot = process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-substitute.png');
      fs.writeFileSync(subShot, img.toPNG());
      console.log(`SHOT ${subShot}`);
      await exec(`$('subDialog').close()`);
      db.setSubstitution(ebayRow.id, '', 0, '');
      await exec(`api.updateRow(${ebayRow.id}, {})`);
      // marketplace browser pane docked beside the capture sheet
      await exec(`bPane.visible = true; applyBrowserPane();`);
      await sleep(200); // let the rAF layout pass run
      const align = await exec(`[
        Math.round($('findBar').getBoundingClientRect().left),
        Math.round($('rowsMain').getBoundingClientRect().left),
        Math.round($('findBar').getBoundingClientRect().width),
        Math.round($('rowsMain').getBoundingClientRect().width),
      ]`);
      check('find bar aligns with the sheet column while the pane is open',
        Math.abs(align[0] - align[1]) <= 1 && Math.abs(align[2] - align[3]) <= 1, align);
      // the loading panel, exactly as a PO#-click shows it
      await exec(`bShowLoading('Opening order 119121415476080'); $('bLoadDomain').textContent = 'seller.walmart.com';`);
      await sleep(250);
      img = await win.webContents.capturePage();
      const loadShot = process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-browser-loadingpane.png');
      fs.writeFileSync(loadShot, img.toPNG());
      console.log(`SHOT ${loadShot}`);
      await exec('bHideLoading()');
      await exec(`api.browserOpenUrl('https://example.com')`);
      await sleep(3000); // page load
      img = await win.capturePage(); // window layout (native view compositing may be blank here)
      const paneShot = process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-browser.png');
      fs.writeFileSync(paneShot, img.toPNG());
      console.log(`SHOT ${paneShot}`);
      try {
        // the pane's own contents, as proof the page really loaded in it
        const kid = win.contentView.children.find(v => v.webContents);
        if (kid) {
          const pimg = await kid.webContents.capturePage();
          const pageShot = process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-browser-page.png');
          fs.writeFileSync(pageShot, pimg.toPNG());
          console.log(`SHOT ${pageShot}`);
        }
      } catch { /* capture is best effort */ }
      await exec(`bPane.visible = false; applyBrowserPane();`);
      await sleep(200);
      // the receiving worksheet with lines, tracking, note + an expanded past day
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
      await exec(`$('recvDialog').close()`);
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
      const lvl = (n, o, m = 0) => [{ locationId: 'L1', stockLevel: n, inOrders: o, due: 0, minimumLevel: m, available: n - o }];
      await exec(`stockSeed(${JSON.stringify({
        ok: true, locationId: 'L1', locationName: 'Warehouse',
        items: [
          { stockItemId: '1', sku: 'S25-128GB-NAVY', title: 'Samsung Galaxy S25 128GB Navy', barcode: '', category: '', image: '', levels: lvl(42, 3, 10) },
          { stockItemId: '2', sku: 'S25-128GB-NAVY-OPENBOX', title: 'Samsung Galaxy S25 128GB Navy (Open Box)', barcode: '', category: '', image: '', levels: lvl(5, 1) },
          { stockItemId: '3', sku: 'A16-64GB-BLK-OPENBOX', title: 'Samsung Galaxy A16 64GB Black (Open Box)', barcode: '', category: '', image: '', levels: lvl(3, 0) },
          { stockItemId: '4', sku: 'IP15-128GB-BLUE', title: 'iPhone 15 128GB Blue', barcode: '', category: '', image: '', levels: lvl(2, 1, 5) },
        ],
      })})`);
      // day-over-day deltas beside the SKUs + the all-inventory view so the
      // low-stock row (IP15, red Available) and the Low chip both show
      await exec(`stockDeltas = ${JSON.stringify({
        'S25-128GB-NAVY': { today: 11, yesterday: 10 },
        'S25-128GB-NAVY-OPENBOX': { today: 1, yesterday: 0 },
        'IP15-128GB-BLUE': { today: 2, yesterday: 4 },
      })};`);
      await exec(`stockActiveView = null; renderStockChips(); renderStock();`);
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
      // New SKU dialog, prefilled the way the returns mapping flow opens it
      await exec(`openNewSkuDialog({ sku: 's25-128gb-navy-openbox', title: 'Samsung Galaxy S25 128GB Navy (Open Box)', retailPrice: 449.99 })`);
      await exec(`$('skuQty').value = '2'; $('skuPurchase').value = '310';`);
      await sleep(300);
      img = await win.webContents.capturePage();
      const skuShot = process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-new-sku.png');
      fs.writeFileSync(skuShot, img.toPNG());
      console.log(`SHOT ${skuShot}`);
      await exec(`$('skuDialog').close()`);
      // returns worksheet: matched rows (one per unit) + an unmatched row + history
      // (shot at a desktop-ish width: the sheet fills the page, no inner scroll)
      win.setContentSize(1360, 1000);
      db.saveConditionMapping('S25-128GB-NAVY', 'openbox', 'S25-128GB-NAVY-OPENBOX');
      await exec(`showPage('returns')`);
      await sleep(300);
      await exec(`
        recvItems = ${JSON.stringify([
          { sku: 'S25-128GB-NAVY', title: 'Samsung Galaxy S25 128GB Navy', barcode: '' },
          { sku: 'S25-128GB-NAVY-OPENBOX', title: 'Samsung Galaxy S25 128GB Navy (Open Box)', barcode: '' },
          { sku: 'A16-64GB-BLK', title: 'Samsung Galaxy A16 64GB Black', barcode: '' },
          { sku: 'A16-64GB-BLK-USED', title: 'Samsung Galaxy A16 64GB Black (Used)', barcode: '' },
        ])};
        recvBySku = new Map(recvItems.map(i => [i.sku.toLowerCase(), i]));
        recvByBarcode = new Map();
        recvLookup = 'ready';
      `);
      const s25Targets = { new: 'S25-128GB-NAVY', openbox: 'S25-128GB-NAVY-OPENBOX', used: '', scrap: '' };
      // the receive popup mid-flow: matched order, condition auto-matched
      await exec(`retReceivedBy = 'IM'; loadRetPast()`);
      await sleep(300);
      await exec(`retOpenRecv();
        rv.unmatched = false; rv.orderId = 'oid-1'; rv.source = 'WALMART';
        $('rvPo').value = '119121310078834'; rvLastLookup = '119121310078834';
        $('rvCust').value = 'J. Alvarez';
        $('rvTrk').value = '1ZF98W401234567890';
        rv.items = [
          { sku: 'S25-128GB-NAVY', title: 'Samsung Galaxy S25 128GB Navy', price: 529.99, quantity: 2, targets: ${JSON.stringify(s25Targets)} },
          { sku: 'A16-64GB-BLK', title: 'Samsung Galaxy A16 64GB Black', price: 139.99, quantity: 1, targets: null },
        ];
        rv.received = [false, false];
        rvLoadItemAt(0);
        rv.condition = 'openbox';
        $('rvBy').value = 'IM'; $('rvNote').value = 'box opened once, resealed';
        rvRenderCond();`);
      await sleep(400);
      img = await win.webContents.capturePage();
      const retShot = process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-returns-popup.png');
      fs.writeFileSync(retShot, img.toPNG());
      console.log(`SHOT ${retShot}`);
      // the unmapped state: Used has no listing -> pick box + create button
      await exec(`document.querySelector('#rvPills .rv-pill[data-cond="used"]').click()`);
      await sleep(250);
      img = await win.webContents.capturePage();
      const retFixShot = process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-returns-popup-fix.png');
      fs.writeFileSync(retFixShot, img.toPNG());
      console.log(`SHOT ${retFixShot}`);
      await exec(`$('retRecvDialog').close()`);
      // condition-mapping editor, seeded with mixed auto/manual rows
      await exec(`$('mapDialog').showModal(); $('mapSearch').value = ''; mapRows = ${JSON.stringify([
        { baseSku: 'A16-64GB-BLK', conds: { used: { sku: 'A16-64GB-BLK-USED', source: 'manual' } } },
        { baseSku: 'S25-128GB-NAVY', conds: { openbox: { sku: 'S25-128GB-NAVY-OPENBOX', source: 'auto' }, used: { sku: 'S25-128GB-NAVY-USED', source: 'auto' }, scrap: { sku: 'SCRAP-PARTS-BIN', source: 'manual' } } },
        { baseSku: 'S25-256GB-ICYBLUE', conds: { openbox: { sku: 'S25-256GB-ICYBLUE-OPENBOX', source: 'auto' } } },
      ])}; renderMapList();`);
      await sleep(300);
      img = await win.webContents.capturePage();
      const mapShot = process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-mappings.png');
      fs.writeFileSync(mapShot, img.toPNG());
      console.log(`SHOT ${mapShot}`);
      await exec(`$('mapDialog').close()`);
      win.setContentSize(860, 1000);
    }

    // 42. claim photos: LAN upload server — 5-day shelf, token gate, magic
    // bytes, PO-continuing file numbering
    {
      const claims = require('./claims.js');
      const cpath = require('path');
      const cdir = cpath.join(app.getPath('userData'), 'claim-photos-test');
      fs.mkdirSync(cdir, { recursive: true });
      const oldFile = cpath.join(cdir, 'OLDPO_0101-0900_1.jpg');
      fs.writeFileSync(oldFile, Buffer.alloc(16, 0xff));
      const oldSec = (Date.now() - 6 * 86400000) / 1000;
      fs.utimesSync(oldFile, oldSec, oldSec);
      const uploads = [];
      const crun = await claims.start({
        dir: cdir, port: 0,
        listToday: () => [{ po: '119990000000042', sku: 'TEST-SKU', tm: '9:00a' }],
        onUpload: (u) => uploads.push(u),
      });
      check('claims: 5-day cleanup removed the old file', !fs.existsSync(oldFile) && crun.removed === 1, crun.removed);
      const cbase = `http://127.0.0.1:${crun.port}`;
      // a real-enough JPEG (magic bytes + padding past the sniff window)
      const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 0)]);
      let cres = await fetch(`${cbase}/photo?t=WRONGTOKEN&po=X`, { method: 'POST', body: jpeg });
      check('claims: bad token rejected', cres.status === 403, cres.status);
      cres = await fetch(`${cbase}/up?t=WRONGTOKEN`);
      check('claims: bad token gets the expired page', cres.status === 403 && /expired/i.test(await cres.text()), cres.status);
      cres = await fetch(`${cbase}/photo?t=${crun.token}&po=119990000000042`, { method: 'POST', body: Buffer.from('this is not an image, whatever the phone claims') });
      check('claims: non-image rejected by magic bytes', cres.status === 415, cres.status);
      const up1 = await (await fetch(`${cbase}/photo?t=${crun.token}&po=119990000000042`, { method: 'POST', body: jpeg })).json();
      const up2 = await (await fetch(`${cbase}/photo?t=${crun.token}&po=119990000000042`, { method: 'POST', body: jpeg })).json();
      check('claims: files named PO_MMDD-HHMM_n, numbering continues',
        up1.ok && up2.ok
          && /^119990000000042_\d{4}-\d{4}_1\.jpg$/.test(up1.name)
          && /^119990000000042_\d{4}-\d{4}_2\.jpg$/.test(up2.name)
          && fs.existsSync(cpath.join(cdir, up2.name)),
        { up1, up2 });
      check('claims: upload events carried the running day count',
        uploads.length === 2 && uploads[1].todayCount === 2, uploads);
      // a REAL (decodable) JPEG is re-encoded to PNG on arrival (Walmart
      // wants case images as PNGs); the fake-JPEG uploads above cannot
      // decode, so they keep .jpg — which doubles as the fallback-path check
      const realJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
      const up3 = await (await fetch(`${cbase}/photo?t=${crun.token}&po=119990000000042`, { method: 'POST', body: realJpeg })).json();
      check('claims: real photos re-encode to PNG',
        up3.ok && /_3\.png$/.test(up3.name) && fs.existsSync(cpath.join(cdir, up3.name)), up3);
      // Walmart caps a case's images at 25 MB combined: a PO whose folder
      // already fills the budget refuses the next photo with a clear error
      const fullPo = '119990000000099';
      const claimsBudget = require('./claims.js')._test.CASE_BUDGET;
      fs.writeFileSync(cpath.join(cdir, `${fullPo}_0101-0900_1.png`), Buffer.alloc(claimsBudget));
      const upFull = await fetch(`${cbase}/photo?t=${crun.token}&po=${fullPo}`, { method: 'POST', body: realJpeg });
      const upFullBody = await upFull.json();
      check('claims: Walmart 25 MB combined case budget refuses the overflow photo',
        upFull.status === 413 && /25 MB/.test(upFullBody.error || ''), { status: upFull.status, upFullBody });
      fs.unlinkSync(cpath.join(cdir, `${fullPo}_0101-0900_1.png`));
      const cpage = await (await fetch(`${cbase}/up?t=${crun.token}`)).text();
      check('claims: phone page lists today\'s returns as tap chips',
        cpage.includes('Upload Photos') && cpage.includes('119990000000042') && cpage.includes('TEST-SKU'), cpage.length);
      await crun.close();
    }

    // 44. claim photos: EXIF orientation parser
    {
      // EXIF orientation parser: a handcrafted JPEG APP1 with Orientation=6
      const exif = Buffer.concat([
        Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x20]),
        Buffer.from('Exif\0\0', 'ascii'),
        Buffer.from('II', 'ascii'), Buffer.from([0x2A, 0x00, 0x08, 0x00, 0x00, 0x00]),
        Buffer.from([0x01, 0x00]),                                  // 1 IFD entry
        Buffer.from([0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00]), // tag 0x0112 = 6
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
      ]);
      const claimsT = require('./claims.js')._test;
      check('claims: EXIF orientation tag parsed (sideways phone photos)',
        claimsT.jpegOrientation(exif) === 6 && claimsT.jpegOrientation(Buffer.from([0xFF, 0xD8, 0xFF, 0xDB, 0x00, 0x04, 0, 0])) === 1,
        claimsT.jpegOrientation(exif));
    }

    // 40. Recovery (2026-10-11): the §11 fixture through parse -> reconcile ->
    // classify -> store -> tracker on a throwaway db (src/main/recovery/selftest.js),
    // then the Electron skin: capture-only refuses, the tab is opt-in and off
    await require('./recovery/selftest')(check);
    res = await exec('api.recoveryState()');
    check('recovery:state refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    res = await exec(`api.recoveryImport('x.csv', 'a,b', false)`);
    check('recovery:import refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    const rcUi = await exec(`[$('tabRecovery').hidden, !!$('recoveryPage'), $('recoveryPage').hidden, typeof enterRecovery, !!$('setPageRecovery'), !!$('setRcEmail'), !!$('setRcWebhook')]`);
    check('recovery: tab hidden until ticked, page section present, settings fields present',
      rcUi[0] === true && rcUi[1] === true && rcUi[2] === true && rcUi[3] === 'function' && rcUi[4] && rcUi[5] && rcUi[6], rcUi);
    const rcCfg = await exec('api.getConfig()');
    check('recovery: config defaults — page off, email and webhook empty',
      rcCfg && rcCfg.pages && rcCfg.pages.recovery === false && rcCfg.recovery && rcCfg.recovery.email === '' && rcCfg.recovery.webhookUrl === '', rcCfg && rcCfg.recovery);
    check('recovery: PO# menu — Walmart transaction link template carries {po}',
      rcCfg && rcCfg.txnUrlTemplates && /^https:\/\/seller\.walmart\.com\/.*\{po\}/.test(rcCfg.txnUrlTemplates.walmart), rcCfg && rcCfg.txnUrlTemplates);
    const rcTables = db.open().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'wm_%' ORDER BY name").all().map(r => r.name);
    check('recovery: schema tables created', JSON.stringify(rcTables) === JSON.stringify(['wm_expenses', 'wm_items', 'wm_ledger', 'wm_lines', 'wm_marks', 'wm_orders', 'wm_payouts', 'wm_refunds', 'wm_runs', 'wm_tombstones']), rcTables);
    // Ship tab (owner 2026-10-19): UPS labels against a fake UPS — both
    // accounts rated side by side, a return label bought, listed, voided
    {
      const http = require('node:http');
      const upsMod = require('./ups');
      const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0x78, 0x05, 0x20, 0x03]), Buffer.alloc(20)]).toString('base64');
      const upsSeen = [];
      const fake = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          upsSeen.push({ url: req.url, method: req.method, body });
          res.setHeader('Content-Type', 'application/json');
          if (req.url === '/security/v1/oauth/token') {
            const id = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
            return res.end(JSON.stringify({ access_token: `TOK-${id.split(':')[0]}`, expires_in: '3600' }));
          }
          const b = String(req.headers.authorization || '').endsWith('-B'); // the second account
          if (req.url.startsWith('/api/rating/')) {
            return res.end(JSON.stringify({ RateResponse: { RatedShipment: [
              { Service: { Code: '03' }, TotalCharges: { MonetaryValue: '15.00' }, NegotiatedRateCharges: { TotalCharge: { MonetaryValue: b ? '9.10' : '10.40' } } },
              { Service: { Code: '02' }, TotalCharges: { MonetaryValue: b ? '24.00' : '23.50' } },
              // UPS can answer a service twice (a dearer Saturday-delivery Ground)
              { Service: { Code: '03' }, TotalCharges: { MonetaryValue: '19.00' }, NegotiatedRateCharges: { TotalCharge: { MonetaryValue: b ? '13.10' : '14.40' } } },
            ] } }));
          }
          if (req.url.endsWith('/ship')) {
            return res.end(JSON.stringify({ ShipmentResponse: { ShipmentResults: {
              ShipmentIdentificationNumber: '1ZE2E0000000000001',
              NegotiatedRateCharges: { TotalCharge: { MonetaryValue: '9.10' } },
              PackageResults: [{ TrackingNumber: '1ZE2E0000000000001', ShippingLabel: { GraphicImage: gif } }],
            } } }));
          }
          if (req.url.includes('/void/cancel/')) return res.end(JSON.stringify({ VoidShipmentResponse: { SummaryResult: { Status: { Code: '1' } } } }));
          // the fake Walmart (Ship with Walmart) on the same server
          if (req.url === '/v3/token') return res.end(JSON.stringify({ access_token: 'WMTOK', expires_in: 900 }));
          if (req.url.startsWith('/v3/orders/')) return res.end(JSON.stringify({ order: { purchaseOrderId: '108829451230774',
            orderDate: new Date(2026, 9, 20, 9).getTime(), shippingInfo: { estimatedDeliveryDate: new Date(2026, 9, 22, 14).getTime(), estimatedShipDate: new Date(2026, 9, 20, 18).getTime(), postalAddress: { name: 'Maria Delgado', address1: '4120 W Belmont Ave', city: 'Chicago', state: 'IL', postalCode: '60641' } },
            orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'WM-X133', productName: 'Galaxy' }, orderLineQuantity: { amount: '1' } }] } } }));
          if (req.url === '/v3/shipping/labels/shipping-estimates') return res.end(JSON.stringify({ data: { estimates: [
            { name: 'USPS_GROUND_ADVANTAGE', displayName: 'USPS Ground Advantage', carrierName: 'USPS', estimatedRate: { amount: 5.5 } },
            { name: 'UPS_GROUND', displayName: 'UPS Ground', carrierName: 'UPS', estimatedRate: { amount: 8.4 }, deliveryDate: '2026-10-23T23:59:00Z' },
            { name: 'FEDEX_2_DAY', displayName: 'FedEx 2Day', carrierName: 'FedEx', estimatedRate: { amount: 11.8 } } ] } }));
          if (req.url === '/v3/shipping/labels' && req.method === 'POST') return res.end(JSON.stringify({ data: { trackingNo: '1Z9WM0000000000077', carrierName: 'UPS', carrierServiceType: 'UPS Ground' } }));
          if (req.url === '/v3/shipping/labels/carriers') return res.end(JSON.stringify([{ carrierId: '1000', shortName: 'FedEx', carrierName: 'FedEx' }, { carrierId: '1001', shortName: 'USPS', carrierName: 'USPS' }]));
          if (req.url.startsWith('/v3/shipping/labels/carriers/')) {
            if (req.method === 'DELETE') return res.end(JSON.stringify({ data: 'true' }));
            res.setHeader('Content-Type', 'image/png');
            return res.end(Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 176, 0, 0, 7, 8]), Buffer.alloc(200)]));
          }
          res.statusCode = 404; res.end('{}');
        });
      });
      await new Promise(r => fake.listen(0, '127.0.0.1', r));
      upsMod.UpsClient.testHost = `http://127.0.0.1:${fake.address().port}`;
      try {
        check('ship: tab hidden until ticked', await exec(`document.getElementById('tabShip').hidden`) === true);
        const addr = (company, line2) => ({ company, name: 'Shipping', phone: '201-555-0100', line1: '100 Commerce Dr', line2, city: 'Fairfield', state: 'NJ', zip: '07004' });
        await exec(`api.setConfig(${JSON.stringify({
          captureOnly: false,
          pages: { ship: true },
          ups: {
            accounts: [
              { id: 'a', name: 'Digital World Shop', accountNumber: 'aaa111', clientId: 'ID-A', clientSecret: 'S-A' },
              { id: 'b', name: 'Company Two', accountNumber: 'bbb222', clientId: 'ID-B', clientSecret: 'S-B' },
            ],
            shipFrom: addr('Digital World Shop', ''),
            returnTo: addr('DWS Returns', 'Dock 2'),
          },
        })}).then(() => refresh())`);
        await sleep(300);
        check('ship: tab shows once ticked', await exec(`document.getElementById('tabShip').hidden`) === false);
        const info = await exec('api.shipInfo()');
        check('ship: both accounts ready, addresses complete',
          info.ok && info.accounts.length === 2 && info.accounts.every(a => a.ready) && !info.shipFromProblem && !info.returnToProblem, info);
        // saved keys never come back to the window, and a save without them keeps them
        let pub = await exec('api.getConfig()');
        check('keys: config read carries no UPS keys, only saved flags',
          pub.ups.accounts.every(a => a.clientId === '' && a.clientSecret === '' && a.hasClientId && a.hasClientSecret), pub.ups.accounts);
        await exec(`api.setConfig({ ups: { accounts: [{ id: 'a', name: 'Digital World Shop', accountNumber: 'aaa111', clientId: '', clientSecret: '' }, { id: 'b', name: 'Company Two', accountNumber: 'bbb222' }] }, linnworks: { applicationSecret: 'LW-SECRET', token: 'LW-TOKEN' } })`);
        const kept = (await exec('api.shipInfo()')).accounts.every(a => a.ready);
        const back = await exec(`api.setConfig({ linnworks: { applicationSecret: '', token: '' } })`);
        pub = await exec('api.getConfig()');
        check('keys: a save without keys keeps them; Linnworks keys stay hidden too',
          kept && pub.linnworks.applicationSecret === '' && pub.linnworks.token === '' && pub.linnworks.hasApplicationSecret && pub.linnworks.hasToken
            && back.linnworks.token === '' && !JSON.stringify(pub).includes('LW-SECRET') && !JSON.stringify(pub).includes('S-A'), pub.linnworks);
        const shown = await exec(`(async () => { await openSettings(); const r = { inputHidden: $('setUpsSecret0').hidden, saved: !$('setUpsSecret0').nextElementSibling.hidden && /Saved/.test($('setUpsSecret0').nextElementSibling.textContent), value: $('setUpsSecret0').value, lw: $('setToken').hidden }; $('settingsDialog').close(); return r; })()`);
        check('keys: Settings shows "Saved" instead of the key', shown.inputHidden && shown.saved && shown.value === '' && shown.lw, shown);
        const cust = { name: 'Maria Delgado', line1: '4120 W Belmont Ave', line2: 'Apt 2', city: 'Chicago', state: 'IL', zip: '60641' };
        let r = await exec(`api.shipRates(${JSON.stringify({ kind: 'ship', party: { ...cust, zip: '606' }, pkg: { weight: 1 } })})`);
        check('ship: a bad ZIP is caught before UPS is asked', !r.ok && /zip/i.test(r.error), r);
        r = await exec(`api.shipRates(${JSON.stringify({ kind: 'ship', party: cust, pkg: { weight: 0 } })})`);
        check('ship: no weight, no rates', !r.ok && /weight/i.test(r.error), r);
        r = await exec(`api.shipRates(${JSON.stringify({ kind: 'return', party: cust, pkg: { weight: 1.1, length: 8, width: 6, height: 4 }, value: 189.99 })})`);
        const ra = r.ok && r.accounts.find(a => a.id === 'a');
        const rb = r.ok && r.accounts.find(a => a.id === 'b');
        check('ship: both accounts rated side by side (negotiated price wins)',
          ra && rb && ra.ok && rb.ok && ra.rates[0].price === 10.4 && rb.rates[0].price === 9.1 && rb.rates[0].code === '03', r);
        check('ship: a service UPS answers twice shows once, at its standard price',
          ra && rb && ra.rates.filter(x => x.code === '03').length === 1 && rb.rates.filter(x => x.code === '03').length === 1 && ra.rates.length === 2, ra && ra.rates);
        const rateBody = JSON.parse(upsSeen.filter(x => x.url.startsWith('/api/rating/')).pop().body).RateRequest.Shipment;
        check('ship: a return is rated from the customer to our return address',
          rateBody.ShipFrom.Name === 'Maria Delgado' && rateBody.ShipTo.Name === 'DWS Returns', rateBody.ShipTo);
        const made = await exec(`api.shipCreate(${JSON.stringify({
          accountId: 'b', serviceCode: '03', kind: 'return', party: cust, pkg: { weight: 1.1 }, value: 189.99,
          reference: '108829451230774', fromPo: true, source: 'WALMART', description: 'Return X133-128GB-GRAY',
        })})`);
        check('ship: return label bought on the second account',
          made.ok && made.label.tracking === '1ZE2E0000000000001' && made.label.kind === 'return' && made.label.account_name === 'Company Two'
            && made.label.cost === 9.1 && made.gif === gif && made.size && made.size.width === 1400, made.ok ? made.label : made);
        const shipBody = JSON.parse(upsSeen.filter(x => x.url.endsWith('/ship')).pop().body).ShipmentRequest.Shipment;
        check('ship: the PO# is Ref 1, PRL return service, value declared, no product on the label',
          shipBody.Package[0].ReferenceNumber[0].Value === '108829451230774' && shipBody.ReturnService.Code === '9'
            && shipBody.Package[0].Description === 'Merchandise return' && shipBody.Description === 'Merchandise return'
            && !JSON.stringify(shipBody).includes('X133')
            && shipBody.Package[0].PackageServiceOptions.DeclaredValue.MonetaryValue === '189.99' && shipBody.Shipper.ShipperNumber === 'BBB222', shipBody);
        const typed = await exec(`api.shipCreate(${JSON.stringify({
          accountId: 'a', serviceCode: '02', kind: 'ship', party: { ...cust, company: 'TechHub' }, pkg: { weight: 6 }, value: 0,
          reference: 'INV-2304', reference2: 'RMA-77', fromPo: false, saveAddress: true,
        })})`);
        const typedBody = JSON.parse(upsSeen.filter(x => x.url.endsWith('/ship')).pop().body).ShipmentRequest.Shipment;
        const mk = await exec(`(async () => {
          $('spMkt').value = 'eBay'; $('spMkt').dispatchEvent(new Event('change'));
          const out = { picked: sp.mkt, dot: $('spMktDot').className };
          sp.log = [{ id: 9001, created_at: new Date().toISOString(), kind: 'ship', reference: 'X-1', from_po: 1, source: 'TEMU', service_name: 'UPS Ground', account_name: 'A', tracking: '1ZX', value: 0, cost: 1 }];
          spRenderLog(); out.tag = (document.querySelector('#spLogBody tr[data-id="9001"] .sp-mk') || {}).textContent || '';
          spSetMkt(''); await spLoadLog();
          return out; })()`);
        check('ship: the Marketplace dropdown picks Walmart / eBay / Temu, and the list tags each label', mk.picked === 'eBay' && /is-ebay/.test(mk.dot) && mk.tag === 'Temu', mk);
        check('ship: an optional Reference #2 prints under Ref 1', JSON.stringify(typedBody.Package[0].ReferenceNumber) === JSON.stringify([{ Value: 'INV-2304' }, { Value: 'RMA-77' }]), typedBody.Package[0].ReferenceNumber);
        check('ship: label with no PO# saves the address', typed.ok && typed.label.from_po === 0
          && (await exec('api.shipAddresses()')).addresses.some(x => x.company === 'TechHub'), typed);
        let list = await exec('api.shipList(0)');
        check('ship: today\'s list carries both labels, newest first, no images',
          list.ok && list.labels.length === 2 && list.labels[0].reference === 'INV-2304' && !('label_gif' in list.labels[0]), list.labels && list.labels.length);
        const v = await exec(`api.shipVoid(${made.label.id})`);
        list = await exec('api.shipList(0)');
        check('ship: void reaches UPS and marks the label',
          v.ok && upsSeen.some(x => x.method === 'DELETE' && x.url.endsWith('/1ZE2E0000000000001'))
            && list.labels.find(l => l.id === made.label.id).voided_at, v);
        await exec(`showPage('ship')`);
        await sleep(600);
        check('ship: page opens with the labels list',
          await exec(`!document.getElementById('shipPage').hidden && document.querySelectorAll('#spLogBody tr').length === 2`), null);
        const disk = JSON.parse(fs.readFileSync(require('node:path').join(app.getPath('userData'), 'config.json'), 'utf8'));
        check('ship: UPS secrets never sit in config.json in plain text (when the OS can encrypt)',
          !disk.upsEnc || disk.ups.accounts.every(a => !a.clientSecret && !a.clientId), disk.ups && disk.ups.accounts);

        // Ship from the Orders line (owner 2026-10-20): Walmart + both UPS
        // accounts in one list; the label's tracking lands on the row
        const wmMod = require('./walmart');
        wmMod.WalmartClient.testHost = upsMod.UpsClient.testHost;
        const lwMod = require('./linnworks');
        const realFind = lwMod.LinnworksClient.prototype.findOrderForLabel;
        lwMod.LinnworksClient.prototype.findOrderForLabel = async (ref) => ({ reference: ref, source: 'WALMART', status: 'open', total: 189.99,
          items: [{ sku: 'X133-128GB-GRAY', quantity: 1 }], party: { ...cust, phone: '', email: '', country: 'United States' } });
        try {
          await exec(`api.setConfig({ walmart: { clientId: 'WCID', clientSecret: 'WSEC' } })`);
          const wt = await exec(`api.walmartTest({})`);
          check('walmart: Test logs in and lists the carriers Walmart sells labels for', wt.ok && Array.isArray(wt.carriers) && wt.carriers.join(',') === 'FedEx,USPS', wt);
          const wRow = db.createRow({ channel: 'walmart', orderNumber: '108829451230774', origin: '' });
          const eRow = db.createRow({ channel: 'ebay', orderNumber: '21-13542-88761', origin: '' });
          let r = await exec(`api.orderShipPrep(${wRow.id})`);
          check('order ship: a Walmart line preps with the Linnworks address and Walmart on', r.ok && r.walmart === true && r.party.city === 'Chicago' && r.value === 189.99, r);
          const pkg = { weight: 1.1, length: 8, width: 6, height: 4 };
          r = await exec(`api.orderShipRates(${JSON.stringify({ rowId: wRow.id, party: cust, pkg, value: 189.99 })})`);
          const wm = r.ok && r.sources.find(x => x.id === 'wm');
          check('order ship: one list from Walmart and both UPS accounts, USPS never offered',
            r.ok && r.sources.map(x => x.id).join(',') === 'wm,a,b' && wm.ok && wm.rates.map(x => x.code).join(',') === 'UPS_GROUND,FEDEX_2_DAY', r);
          r = await exec(`api.orderShipCreate(${JSON.stringify({ rowId: wRow.id, via: 'wm', code: 'UPS_GROUND', name: 'UPS Ground', carrier: 'UPS', price: 8.4, party: cust, pkg, value: 189.99 })})`);
          let rowNow = db.getRow(wRow.id);
          check('order ship: a Walmart label fills the row\'s tracking, image kept, not processed',
            r.ok && rowNow.tracking === '1Z9WM0000000000077' && rowNow.carrier === 'UPS' && rowNow.status !== 'synced' && r.size && r.size.type === 'png' && r.label.account_name === 'Walmart', { r: r.ok ? r.label : r, rowNow });
          const wmLabel = r.label;
          r = await exec(`api.orderShipRates(${JSON.stringify({ rowId: eRow.id, party: cust, pkg, value: 129 })})`);
          check('order ship: an eBay line shows only the UPS accounts', r.ok && r.sources.map(x => x.id).join(',') === 'a,b', r);
          r = await exec(`api.orderShipCreate(${JSON.stringify({ rowId: eRow.id, via: 'b', code: '03', name: 'UPS Ground', price: 9.1, party: cust, pkg, value: 129 })})`);
          rowNow = db.getRow(eRow.id);
          check('order ship: a UPS label on the eBay line, the PO# as Ref 1',
            r.ok && rowNow.tracking === '1ZE2E0000000000001' && r.label.reference === '21-13542-88761' && r.label.row_id === eRow.id, r.ok ? r.label : r);
          r = await exec(`api.orderShipCreate(${JSON.stringify({ rowId: eRow.id, via: 'b', code: '03', party: cust, pkg })})`);
          check('order ship: a line with tracking can\'t buy a second label', !r.ok && /already has tracking/.test(r.error), r);
          r = await exec(`api.shipVoid(${wmLabel.id})`);
          check('order ship: voiding the Walmart label takes the tracking back off the row',
            r.ok && upsSeen.some(x => x.method === 'DELETE' && x.url.includes('/v3/shipping/labels/carriers/UPS/trackings/1Z9WM0000000000077')) && db.getRow(wRow.id).tracking === '', r);
          await exec(`(async () => { showPage('capture'); setCapHist(false); state = await api.getState(); render(); })()`);
          await sleep(500);
          const ui = await exec(`(async () => {
            const tr = document.querySelector('#rowsBody tr[data-id="${wRow.id}"]'); const b = tr && tr.querySelector('.os-btn');
            if (!b) return { btn: false };
            b.click(); await new Promise(r => setTimeout(r, 900));
            const d = document.getElementById('osDrawer');
            const out = { btn: true, open: d.classList.contains('is-open'), marked: !!document.querySelector('#rowsBody tr.os-open[data-id="${wRow.id}"]'),
              ref: $('osdRef').textContent === '108829451230774', cust: /Chicago/.test($('osAddr').textContent), items: /X133-128GB-GRAY/.test($('osdItems').textContent) && /×1/.test($('osdItems').textContent),
              saveBtn: !!$('osPkSave') && $('osPkSave').disabled, noValue: $('osVal').value === '', ref2: $('osRef2').value,
              ref2Many: osRef2Default([{ sku: 'X133-128GB-GRAY', qty: 2 }, { sku: 'OPEN-BOX-S25-ULTRA-512GB-BLACK', qty: 1 }]) };
            render(); out.survives = d.classList.contains('is-open') && !!document.querySelector('#rowsBody tr.os-open');
            const wt = $('osWt'); wt.value = '1.3'; wt.dispatchEvent(new Event('input'));
            out.saveOn = !!$('osPkSave') && !$('osPkSave').disabled && /Save for this item/.test($('osPkSave').textContent);
            $('osPkSave').click(); await new Promise(r => setTimeout(r, 300));
            out.savedTag = /Saved for this item/.test($('osPkTag').textContent);
            await new Promise(r => setTimeout(r, 2500)); // the rates for the new weight
            const picked = document.querySelector('#osRates .sp-rate.is-on');
            out.deliver = $('osdDates').textContent;
            out.late = [...document.querySelectorAll('#osRates .sp-rate.is-late')].map(x => x.dataset.k);
            out.pickedLate = !!(picked && picked.classList.contains('is-late'));
            out.starOnPicked = !!(picked && picked.querySelector('.sp-star'));
            wt.focus();
            wt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            out.escClosed = !d.classList.contains('is-open') && os === null && !document.querySelector('#rowsBody tr.os-open');
            if (!out.escClosed) osClose();
            await new Promise(r => setTimeout(r, 400));
            document.querySelector('#rowsBody tr[data-id="${wRow.id}"] .os-btn').click(); await new Promise(r => setTimeout(r, 900));
            out.refilled = $('osWt').value === '1.3' && /Saved for this item/.test($('osPkTag').textContent);
            osClose(); return out; })()`);
          check('order ship: Ship opens the drawer with the customer, the item and Ref 1, and it survives a re-render',
            ui.btn && ui.open && ui.marked && ui.ref && ui.cust && ui.items && ui.saveBtn && ui.survives, ui);
          check('order ship: no declared value unless typed', ui.noValue === true, ui);
          check('order ship: Reference #2 starts as the SKU and units sold, cut to 35 with the count kept',
            ui.ref2 === 'X133-128GB-GRAY | 1 unit sold' && ui.ref2Many === 'X133-128GB-GRAY, OPE | 3 units sold' && ui.ref2Many.length <= 35, ui);
          check('order ship: a package saved for the item fills in next time', ui.saveOn && ui.savedTag && ui.refilled, ui);
          check('order ship: Esc cancels the open drawer', ui.escClosed === true, ui);
          check('order ship: the Order box shows Walmart\'s ordered / ship-by / deliver-by dates, flags late rates and picks the cheapest on time',
            /Deliver by10\/22\/2026/.test(ui.deliver) && /Ordered10\/20\/2026/.test(ui.deliver) && ui.late.includes('wm:UPS_GROUND') && !ui.pickedLate && ui.starOnPicked, ui);
          const lr = await exec(`(async () => {
            state = await api.getState(); render();
            const tr = document.querySelector('#rowsBody tr[data-id="${eRow.id}"]');
            const rp = tr && tr.querySelector('[data-act="lreprint"]'), vd = tr && tr.querySelector('[data-act="lvoid"]');
            const out = { reprint: !!rp, void: !!vd, otherRow: !!document.querySelector('#rowsBody tr[data-id="${wRow.id}"] [data-act="lreprint"]') };
            if (!rp) return out;
            rp.click(); await new Promise(r => setTimeout(r, 600));
            const dlg = $('osLabelDlg');
            out.open = dlg.open; out.title = $('osLabelTitle').textContent;
            out.fmts = [...$('osPrintFmt').querySelectorAll('[data-fmt]')].map(b => b.textContent);
            $('osPrintFmt').querySelector('[data-fmt="letter"]').click();
            out.letterOn = $('osPrintFmt').querySelector('[data-fmt="letter"]').classList.contains('is-on') && localStorage.getItem('osPrintFmt') === 'letter'
              && $('osSheet').classList.contains('is-letter');
            $('osPrintFmt').querySelector('[data-fmt="a4"]').click();
            out.a4On = $('osSheet').classList.contains('is-a4') && localStorage.getItem('osPrintFmt') === 'a4';
            out.printerSel = !!$('osPrinter');
            dlg.close();
            $('osPrintFmt').querySelector('[data-fmt="label"]').click();
            return out; })()`);
          check('order ship: a line with a label made here offers Reprint and Void; Reprint opens the popup with label printer or paper',
            lr.reprint && lr.void && !lr.otherRow && lr.open && lr.title === 'Reprint label' && lr.fmts.join('|') === 'Label 4×6|Letter|A4' && lr.letterOn && lr.a4On && lr.printerSel, lr);
          const many = await exec(`(async () => {
            sp.logDays = 30; await spLoadLog();
            const boxes = [...document.querySelectorAll('#spLogBody [data-sel]')].slice(0, 2);
            boxes.forEach(b => { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
            const out = { n: boxes.length, btn: !$('spPrintSel').hidden && $('spPrintSel').textContent === 'Print selected · 2' };
            $('spPrintSel').click(); await new Promise(r => setTimeout(r, 600));
            out.open = $('osLabelDlg').open; out.title = $('osLabelTitle').textContent; out.ids = $('osLabelDlg').dataset.ids.split(',').length;
            $('osLabelDlg').close();
            out.none = await api.shipPrintMany([987654], {});
            return out; })()`);
          check('ship: tick labels in the list and Print selected prints them together (unknown labels refused)',
            many.n === 2 && many.btn && many.open && many.title === 'Print 2 labels' && many.ids === 2 && many.none.ok === false, many);
          r = await exec(`api.orderShipPrep(${wRow.id})`);
          check('order ship: the saved package is keyed by the item', r.ok && r.key === 'X133-128GB-GRAY' && r.saved && r.saved.weight === 1.3, r);
          if (process.env.CAPTURE_E2E_SHOT) {
            win.setSize(1360, 900);
            await exec(`(async () => { const b = document.querySelector('#rowsBody tr[data-id="${wRow.id}"] .os-btn'); b.click(); await new Promise(r => setTimeout(r, 700));
              const w = document.getElementById('osWt'); w.value = '1.1'; w.dispatchEvent(new Event('input')); })()`);
            await sleep(2200);
            fs.writeFileSync(process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-order-ship.png'), (await win.webContents.capturePage()).toPNG());
            await exec(`document.getElementById('osCreate').click()`);
            await sleep(1800);
            fs.writeFileSync(process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-order-ship-label.png'), (await win.webContents.capturePage()).toPNG());
            await exec(`document.getElementById('osLabelDlg').close()`);
            await sleep(400);
            fs.writeFileSync(process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-order-ship-done.png'), (await win.webContents.capturePage()).toPNG());
          }
        } finally {
          lwMod.LinnworksClient.prototype.findOrderForLabel = realFind;
          wmMod.WalmartClient.testHost = '';
        }
      } finally {
        upsMod.UpsClient.testHost = '';
        fake.close();
      }
    }

    // Settings in six groups (owner 2026-10-20, variants/settings-organized.html)
    {
      const res = await exec(`(async () => {
        await openSettings('general');
        const shown = () => [...document.querySelectorAll('#setPane .set-sec')].filter(x => !x.hidden).map(x => x.dataset.p);
        const out = { groups: [...document.querySelectorAll('#setNav [data-p]')].map(b => b.textContent.trim()), first: shown(), upsHidden: !$('setUpsName0').offsetParent };
        document.querySelector('#setNav [data-p="shipping"]').click();
        out.after = shown(); out.on = document.querySelector('#setNav .is-on').dataset.p; out.upsShown = !!$('setUpsName0').offsetParent;
        $('settingsDialog').close();
        await openSettings();
        out.reopened = shown();
        $('settingsDialog').close();
        return out;
      })()`);
      check('settings: six groups in a sidebar, one on screen, the pick stays for the session',
        res && res.groups.join() === 'General,Linnworks,Shipping,Stock,Returns,Advanced' && res.first.join() === 'general' && res.upsHidden
        && res.after.join() === 'shipping' && res.on === 'shipping' && res.upsShown && res.reopened.join() === 'shipping', res);
    }

    // Browser access (owner 2026-10-20): the whole app at localhost, locked to
    // this computer, a private key and the page's own origin
    {
      const http = require('node:http');
      const { BrowserWindow } = require('electron');
      const req = (opts, body) => new Promise((resolve) => {
        const r = http.request({ host: '127.0.0.1', port: 47391, method: 'GET', ...opts }, (res) => {
          let data = ''; res.on('data', c => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });
        r.on('error', (e) => resolve({ status: 0, headers: {}, body: '', error: e.code }));
        if (body) r.write(body);
        r.end();
      });
      await exec(`api.setConfig({ web: { enabled: true } })`);
      await sleep(500);
      const info = await exec('api.webInfo()');
      const key = (String(info.url).match(/\?k=([0-9a-f]+)/) || [])[1] || '';
      check('web: switched on, serving a link with a long private key', info.running && key.length === 48 && /^http:\/\/localhost:47391\/\?k=/.test(info.url), info);
      const host = { Host: 'localhost:47391' };
      let r = await req({ path: '/', headers: host });
      check('web: no key, no app', r.status === 401 && !r.body.includes('renderer.js'), r.status);
      r = await req({ path: '/?k=nope', headers: host });
      check('web: a wrong key is refused', r.status === 401, r.status);
      r = await req({ path: `/?k=${key}`, headers: host });
      const cookie = String((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
      check('web: the right key becomes a strict, script-proof cookie and a clean address',
        r.status === 302 && r.headers.location === '/' && /HttpOnly/.test(r.headers['set-cookie']) && /SameSite=Strict/.test(r.headers['set-cookie']), r.headers);
      r = await req({ path: '/', headers: { ...host, Cookie: cookie } });
      check('web: with the cookie, the app itself (bridge included)', r.status === 200 && r.body.includes('/web-bridge.js') && r.headers['x-frame-options'] === 'DENY', r.status);
      r = await req({ path: '/', headers: { Host: 'evil.example:47391', Cookie: cookie } });
      check('web: a page posing under another host name is refused (DNS rebinding)', r.status === 403, r.status);
      const call = (ch, origin, body = '[]') => req({ method: 'POST', path: `/ipc/${ch}`, headers: { ...host, Cookie: cookie, 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) } }, body);
      r = await call('web:info', 'https://evil.example');
      check('web: actions from another site are refused', r.status === 403, r.status);
      r = await call('web:info', 'http://localhost:47391');
      check('web: actions from the page itself run the app\'s own handlers', r.status === 200 && JSON.parse(r.body).value.running === true, r.body);
      r = await call('web:newKey', 'http://localhost:47391');
      check('web: a new link can only be made on the desktop', JSON.parse(r.body).value.ok === false, r.body);
      r = await req({ path: '/..%2fmain%2fmain.js', headers: { ...host, Cookie: cookie } });
      check('web: nothing outside the app\'s pages is served', r.status === 404, r.status);

      // Download PDF (owner 2026-10-20): an existing label, read-only, behind the key
      const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const sample = db.shipLabelAdd({ kind: 'return', reference: 'SAMPLE-PO-1001', fromPo: true, accountId: 'a', accountName: 'Sample UPS',
        serviceCode: '03', serviceName: 'UPS Ground', tracking: '1ZSAMPLE0000000001', cost: 9.1, value: 50, weight: 1, labelGif: PNG1 });
      const voidedSample = db.shipLabelAdd({ kind: 'ship', reference: 'SAMPLE-PO-1002', fromPo: true, accountId: 'a', accountName: 'Sample UPS',
        serviceCode: '03', serviceName: 'UPS Ground', tracking: '1ZSAMPLE0000000002', cost: 9.1, labelGif: PNG1 });
      db.shipLabelVoid(voidedSample.id);
      const before = JSON.stringify(db.shipLabelGet(sample.id));
      const labelCount = db.shipLabelList({ limit: 5000 }).length;
      const pdfOk = (x, name) => x.status === 200 && x.headers['content-type'] === 'application/pdf'
        && x.headers['content-disposition'] === `attachment; filename="${name}"` && String(x.body).startsWith('%PDF');
      r = await req({ path: `/labels/${sample.id}/pdf`, headers: { ...host, Cookie: cookie } });
      check('web: Download PDF serves the existing label as an attachment named return-<PO>.pdf', pdfOk(r, 'return-SAMPLE-PO-1001.pdf'), { status: r.status, headers: r.headers });
      r = await req({ path: '/labels/pdf?tracking=1zsample0000000001', headers: { ...host, Cookie: cookie } });
      const byTracking = pdfOk(r, 'return-SAMPLE-PO-1001.pdf');
      r = await req({ path: '/labels/pdf?po=SAMPLE-PO-1001', headers: { ...host, Cookie: cookie } });
      check('web: the same PDF by tracking number or by PO#', byTracking && pdfOk(r, 'return-SAMPLE-PO-1001.pdf'), r.status);
      r = await req({ path: `/labels/${sample.id}/pdf`, headers: host });
      check('web: Download PDF needs the key like everything else', r.status === 401 && !String(r.body).startsWith('%PDF'), r.status);
      r = await req({ path: '/labels/pdf?tracking=1ZNOTHERE000000000', headers: { ...host, Cookie: cookie } });
      const missing = r.status === 404 && /No label found/.test(JSON.parse(r.body).error);
      r = await req({ path: '/labels/pdf?tracking=1ZSAMPLE0000000002', headers: { ...host, Cookie: cookie } });
      const voidedByTracking = r.status === 404;
      r = await req({ path: `/labels/${voidedSample.id}/pdf`, headers: { ...host, Cookie: cookie } });
      check('web: a missing or voided label answers with a clear error, no file', missing && voidedByTracking && r.status === 410 && /voided/.test(JSON.parse(r.body).error), r.body);
      r = await req({ method: 'POST', path: `/labels/${sample.id}/pdf`, headers: { ...host, Cookie: cookie, Origin: 'http://localhost:47391' } });
      check('web: Download PDF is read-only: no POST, and the label and the label count are unchanged',
        r.status === 405 && JSON.stringify(db.shipLabelGet(sample.id)) === before && db.shipLabelList({ limit: 5000 }).length === labelCount, r.status);
      // a real browser page: the whole app renders and follows live updates
      const bw = new BrowserWindow({ show: false, width: 1300, height: 900, webPreferences: { contextIsolation: true, sandbox: true } });
      const webLog = [];
      bw.webContents.on('console-message', (...a) => webLog.push(a.map(x => (x && x.message) || x).join(' ').slice(0, 300)));
      try {
        await bw.loadURL(info.url);
        await sleep(2500);
        const page = await bw.webContents.executeJavaScript(`(async () => {
          window.__got = 0; api.on('state:changed', () => { window.__got++; });
          const st = await api.getState();
          return { web: !!window.__DWS_WEB__, rows: st.rows.length, tabs: !!document.getElementById('tabShip'), url: location.href, rendered: (showPage('capture'), render(), document.querySelectorAll('#rowsBody tr').length), dockHidden: getComputedStyle(document.getElementById('bDock')).display === 'none' };
        })()`, true);
        await exec(`api.setConfig({})`); // any change pushes state to every window
        await sleep(800);
        const got = await bw.webContents.executeJavaScript('window.__got', true);
        check('web: the app runs in a browser page, key gone from the address, live updates arrive',
          page.web && page.rows > 0 && page.tabs && page.rendered === page.rows && page.dockHidden && page.url === 'http://localhost:47391/' && got > 0, { ...page, got, webLog: webLog.filter(l => !/Content Security Policy/.test(l)).slice(0, 8) });
        // the Labels list's Download PDF link: a real browser download
        const dlDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dws-dl-'));
        const downloaded = new Promise((resolve) => {
          bw.webContents.session.once('will-download', (_ev, item) => {
            const to = path.join(dlDir, item.getFilename());
            item.setSavePath(to);
            item.once('done', (_e2, st) => resolve({ state: st, name: item.getFilename(), to }));
          });
          setTimeout(() => resolve({ state: 'timeout' }), 8000);
        });
        const link = await bw.webContents.executeJavaScript(`(async () => {
          sp.logDays = 30; await spLoadLog();
          const a = document.querySelector('#spLogBody tr[data-id="${sample.id}"] [data-testid="label-download-pdf"]');
          const v = document.querySelector('#spLogBody tr[data-id="${voidedSample.id}"] [data-testid="label-download-pdf"]');
          const text = a ? a.textContent : '';
          if (a) a.click();
          return { link: !!a, text, href: a ? a.getAttribute('href') : '', po: a ? a.dataset.po : '', voidedLink: !!v,
            keeps: !!document.querySelector('#spLogBody tr[data-id="${sample.id}"] [data-act="pdf"]') && !!document.querySelector('#spLogBody tr[data-id="${sample.id}"] [data-act="print"]') };
        })()`, true);
        const dl = await downloaded;
        const file = dl.to && fs.existsSync(dl.to) ? fs.readFileSync(dl.to) : Buffer.alloc(0);
        check('web: Download PDF in Ship › Labels downloads return-<PO>.pdf; Reprint and PDF stay; none on a voided label',
          link.link && link.text === 'Download PDF' && link.href === `/labels/${sample.id}/pdf` && link.po === 'SAMPLE-PO-1001' && link.keeps && !link.voidedLink
          && dl.state === 'completed' && dl.name === 'return-SAMPLE-PO-1001.pdf' && file.subarray(0, 4).toString() === '%PDF', { link, dl: { state: dl.state, name: dl.name }, size: file.length });
        const desk = await exec(`(async () => { sp.logDays = 30; await spLoadLog(); return !!document.querySelector('#spLogBody [data-testid="label-download-pdf"]'); })()`);
        check('web: the desktop window keeps its own PDF button, no browser link', desk === false, desk);
      } finally {
        bw.destroy();
      }
      await exec(`api.setConfig({ web: { enabled: false } })`);
      await sleep(400);
      r = await req({ path: '/', headers: host });
      check('web: switched off, nothing is listening', r.status === 0, r);
    }

    // returns.csv carries every return (it stopped at the newest 1000,
    // so the oldest fell off once a station passed 1000 — owner 2026-10-22).
    // Last in the suite: the extra returns would skew the log checks above.
    {
      const tag = `CSV-OLDEST-${Date.now()}`;
      db.createReturn({ orderNumber: tag, source: '', customer: '', note: '', unmatched: true, tracking: '', receivedBy: '',
        items: [{ sku: 'CSV-TEST', condition: 'new', targetSku: '', qty: 1, price: 0, note: '' }] });
      for (let n = 0; n < 1000; n++) {
        db.createReturn({ orderNumber: `CSV-FILL-${n}`, source: '', customer: '', note: '', unmatched: true, tracking: '', receivedBy: '',
          items: [{ sku: 'CSV-TEST', condition: 'new', targetSku: '', qty: 1, price: 0, note: '' }] });
      }
      const wasCaptureOnly = (await exec('api.getConfig()')).captureOnly;
      await exec(`api.setConfig({ captureOnly: false })`); // returns:create refuses capture-only
      const made = await exec(`api.returnsCreate({ orderNumber: 'CSV-NEWEST', unmatched: true, items: [] })`);
      await exec(`api.setConfig(${JSON.stringify({ captureOnly: !!wasCaptureOnly })})`);
      const folder = (await exec('api.getConfig()')).csvFolder || path.join(app.getPath('documents'), 'Capture Station');
      const csv = fs.readFileSync(path.join(folder, 'returns.csv'), 'utf8');
      check('returns.csv keeps every return past 1000 — the oldest and the newest are both in it',
        made && made.ok && csv.includes(tag) && csv.includes('CSV-NEWEST') && csv.split('\r\n').length - 1 >= db.listReturns(1e9).length,
        { made, hasOldest: csv.includes(tag), lines: csv.split('\r\n').length - 1, returns: db.listReturns(1e9).length });
    }

    console.log(failures === 0 ? 'E2E_ALL_PASS' : `E2E_FAILURES ${failures}`);
  } catch (e) {
    console.log(`E2E_CRASH ${e.stack}`);
    failures++;
  } finally {
    try { (clipboard.restoreText || clipboard.writeText)(savedClipboard); } catch { /* best effort */ }
    app.exit(failures === 0 ? 0 : 1);
  }
};
