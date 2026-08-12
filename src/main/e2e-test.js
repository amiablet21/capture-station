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

    // 24. receive popup (design C, 2026-08-07): a failed PO lookup falls
    // into the hand-entry path instead of staging a worksheet row
    await exec(`retOpenRecv(); $('rvPo').value = 'WMR-REMOVAL-7788'; rvLookup()`);
    await sleep(300); // lookup refuses offline -> unmatched hand-entry state
    const rvBits = await exec(`[
      !!document.querySelector('#retRecvDialog[open]'),
      $('rvFeedback').hidden,
      $('rvFeedback').textContent,
      rv.unmatched,
      $('rvMatched').hidden,
    ]`);
    check('popup lookup failure falls into the hand-entry path',
      rvBits[0] === true && rvBits[1] === false && /by hand/i.test(rvBits[2])
        && rvBits[3] === true && rvBits[4] === true,
      rvBits);

    // 24b. condition pills + the live target line: New restocks the SKU
    // itself, a mapped condition shows its listing, an unmapped one opens
    // the fix row (pick combo + prefix-named create button)
    const prevLookup = await exec(`(() => {
      const prev = recvLookup;
      recvItems = [{ sku: 'S25-128GB-NAVY', title: 'Galaxy S25', barcode: '' }];
      recvBySku = new Map(recvItems.map(i => [i.sku.toLowerCase(), i]));
      recvByBarcode = new Map();
      recvLookup = 'ready';
      return prev;
    })()`);
    await exec(`rv.sku = 'S25-128GB-NAVY'; $('rvSku').value = 'S25-128GB-NAVY';
      rv.targets = { new: 'S25-128GB-NAVY', openbox: 'S25-128GB-NAVY-OPENBOX', used: '', scrap: '' };
      rvRenderCond();`);
    const pills = await exec(`[
      document.querySelectorAll('#rvPills .rv-pill').length,
      (document.querySelector('#rvPills .rv-pill.on') || { dataset: {} }).dataset.cond || '',
      $('rvTarget').textContent,
      $('rvFix').hidden,
    ]`);
    check('popup: 4 condition pills, New selected, target = the SKU itself',
      pills[0] === 4 && pills[1] === 'new' && /S25-128GB-NAVY/.test(pills[2]) && pills[3] === true,
      pills);
    await exec(`document.querySelector('#rvPills .rv-pill[data-cond="openbox"]').click()`);
    let tgt = await exec(`[$('rvTarget').textContent, $('rvFix').hidden]`);
    check('a mapped condition resolves to its listing, no fix row',
      /S25-128GB-NAVY-OPENBOX/.test(tgt[0]) && tgt[1] === true, tgt);
    await exec(`document.querySelector('#rvPills .rv-pill[data-cond="used"]').click()`);
    tgt = await exec(`[
      $('rvTarget').className,
      $('rvFix').hidden,
      $('rvCreate').hidden,
      $('rvCreate').textContent,
      !!document.querySelector('.rv-pick-combo .combo-list'),
    ]`);
    check('an unmapped condition opens the fix row with the prefix create button',
      /is-missing/.test(tgt[0]) && tgt[1] === false && tgt[2] === false
        && /USED-S25-128GB-NAVY/.test(tgt[3]) && tgt[4] === true,
      tgt);
    // receive is blocked while the target is unresolved
    await exec(`$('rvPo').value = 'WMR-REMOVAL-7788'; rvCommit()`);
    await sleep(120);
    const blocked = await exec(`$('rvFeedback').textContent`);
    check('receive blocked until the missing listing is picked or created',
      /pick or create/i.test(blocked), blocked);
    await exec(`$('retRecvDialog').close()`);
    await exec(`recvItems = null; recvBySku = null; recvByBarcode = null; recvLookup = ${JSON.stringify(prevLookup)}`);

    // 24c. Receive must CLOSE the popup after a successful single-line commit
    await exec(`retOpenRecv();
      rv.unmatched = false; rv.orderId = 'oid-9'; rv.source = 'WALMART';
      $('rvPo').value = '119999000000001';
      rv.items = [{ sku: 'S25-128GB-NAVY', title: '', price: 1, quantity: 1, targets: null }];
      rv.received = [false];
      rvLoadItemAt(0);
      window.__origCreate = rvCreate;
      rvCreate = async () => ({ ok: true });
      0;`);
    await exec(`$('rvSave').click()`);
    await sleep(300);
    const rvClosed = await exec(`[
      !document.querySelector('#retRecvDialog[open]'),
      ($('rvFeedback').hidden ? '' : $('rvFeedback').textContent),
    ]`);
    check('Receive closes the popup after a successful commit', rvClosed[0] === true, rvClosed);
    await exec(`rvCreate = window.__origCreate; if (document.querySelector('#retRecvDialog[open]')) $('retRecvDialog').close(); 0;`);
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
    // history = the SAME sheet as the worksheet (11-column header incl.
    // Units + actions), one row per ITEM LINE (the qty-2 return = 1 row,
    // Units column carries the 2), condition dot, edit/delete per row,
    // and no inputs until an edit begins
    const ledgerBits = await exec(`[
      !!document.querySelector('#retPastBox table.ret-log-table'),
      document.querySelectorAll('#retPastBox thead th').length,
      document.querySelectorAll('#retPastBox tbody tr.ret-past-tr').length,
      !!document.querySelector('#retPastBox .ret-cond-ro .ret-dd-dot.is-openbox'),
      document.querySelectorAll('#retPastBox .ret-log-edit-btn').length,
      document.querySelectorAll('#retPastBox .ret-log-del-btn').length,
      document.querySelectorAll('#retPastBox input, #retPastBox select').length,
      (document.querySelector('#retPastBox .ret-cell-units') || {}).textContent || '',
    ]`);
    check('history renders the worksheet-identical sheet, one row per line',
      ledgerBits[0] === true && ledgerBits[1] === 11
        && ledgerBits[2] === 1 && ledgerBits[3] === true && ledgerBits[7] === '2',
      ledgerBits);
    check('history rows carry edit + delete, no inputs until editing',
      ledgerBits[4] === 1 && ledgerBits[5] === 1 && ledgerBits[6] === 0, ledgerBits);
    // popup edit (owner request 2026-08-07): the pencil opens the receive
    // popup prefilled from the row, with the Received-date row visible
    await exec(`document.querySelector('#retPastBox .ret-log-edit-btn').click()`);
    await sleep(200);
    const editBits = await exec(`[
      !!document.querySelector('#retRecvDialog[open]'),
      $('rvTitle').textContent,
      $('rvPo').value,
      $('rvSku').value,
      (document.querySelector('#rvPills .rv-pill.on') || { dataset: {} }).dataset.cond || '',
      $('rvQty').value,
      $('rvSave').textContent,
      $('rvDayRow').hidden,
    ]`);
    check('pencil opens the edit popup prefilled from the row',
      editBits[0] === true && /Edit return/.test(editBits[1]) && editBits[2] === 'WMR-REMOVAL-7788'
        && editBits[3] === 'S25-128GB-NAVY' && editBits[4] === 'openbox' && editBits[5] === '2'
        && /Save changes/.test(editBits[6]) && editBits[7] === false,
      editBits);
    await exec(`$('retRecvDialog').close()`);

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
    const disp = await exec(`[
      !$('retDisputes').hidden,
      document.querySelectorAll('#retDisputes .ret-todo-row').length,
      ($('retDisputes').textContent || '').includes('88421'),
      ($('retDisputes').textContent || '').includes('999'),
      !!document.querySelector('#retDisputes [data-dispdone]'),
    ]`);
    check('disputes card lists open cases only, with a resolve button',
      disp[0] === true && disp[1] === 1 && disp[2] === true && disp[3] === false && disp[4] === true,
      disp);

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
        && queueBits[3] === '02-12345-67890' && queueBits[4] === false,
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
        hiddenBtns: [$('newSkuBtn').hidden, $('recvBtn').hidden, $('wfsBtn').hidden],
      };
      stockWfsActive = false; stockCache = null; renderStockChips();
      return out;
    })()`);
    check('WFS view: Walmart-held SKUs only, WFS count read-only, warehouse count editable',
      wfsView.chip === true && wfsView.rows === 1
      && wfsView.wfsCount === '9' && wfsView.homeCount === '4' && wfsView.homeEditable === true
      && /At WFS/.test(wfsView.headers) && /At warehouse/.test(wfsView.headers)
      && /WFS FULFILLED/.test(wfsView.summary), wfsView);
    check('stock toolbar buttons (New SKU / Receiving / WFS Shipments) hidden',
      wfsView.hiddenBtns.every(Boolean), wfsView);

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

    // 36. returns resize: whole-width grip + per-column grips on the log
    // (the worksheet left with design C, 2026-08-07 — the log is the sheet)
    const retGrips = await exec(`[
      !!$('retGrip'),
      document.querySelectorAll('#retPastBox thead .col-grip').length,
    ]`);
    check('returns log: shared width grip + column grips',
      retGrips[0] === true && retGrips[1] === 9, retGrips);

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

    // 43. eBay lister: refusals + the pure CSV/description builders
    res = await exec(`api.ebaySpecs('X133-64GB-GRAY')`);
    check('ebay:specs refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    res = await exec(`api.ebayExport({ sku: 'X' }, [])`);
    check('ebay:export refused in capture-only mode', res && res.ok === false && /capture-only/i.test(res.error || ''), res);
    {
      const ecsv = require('./ebaycsv.js');
      const desc = ecsv.buildDescription({ title: 'Tab A9+', cond: 'used', specs: { Brand: 'Samsung', 'Screen Size': '8.7 in' } });
      check('ebay description: store template + condition block + spec rows',
        desc.includes('WIRELESS') && desc.includes('USED') && desc.includes('8.7 in')
          && desc.includes('#2361EB') && desc.includes('Wall charger not included'), desc.length);
      const scrapDesc = ecsv.buildDescription({ title: 'T', cond: 'scrap', specs: {} });
      check('ebay description: scrap block, no charger line',
        scrapDesc.includes('FOR PARTS OR REPAIR') && scrapDesc.includes('sold as-is') && !scrapDesc.includes('Wall charger'), null);
      const csv1 = ecsv.buildEbayCsv([{
        sku: 'USED-X133-64GB-GRAY', categoryId: '171485', title: 'Tab, "quoted"', cond: 'used',
        specs: { Brand: 'Samsung', Model: 'X133' }, picUrls: ['http://a/1.jpg', 'http://a/2.jpg'],
        description: '<d>', price: '99.99', qty: 2,
      }], { shipping: 'Ship1', returns: 'Ret1', payment: 'Pay1', location: 'Brooklyn, NY', dispatchDays: 1 });
      const l1 = csv1.trim().split('\n');
      check('ebay csv: header carries C: columns + profile columns',
        l1[0].includes('C:Brand') && l1[0].includes('C:Model') && l1[0].includes('ShippingProfileName'), l1[0]);
      check('ebay csv: row has condition id, piped pics, quoted title, profiles',
        l1.length === 2 && l1[1].includes(',3000,') && l1[1].includes('http://a/1.jpg|http://a/2.jpg')
          && l1[1].includes('"Tab, ""quoted"""') && l1[1].includes('Ship1') && l1[1].includes('FixedPrice'), l1[1]);
      const csv2 = ecsv.buildEbayCsv([{
        sku: 'USED-S26-ULTRA', categoryId: '9355', title: 'S26 Ultra', cond: 'used',
        specs: { Brand: 'Samsung' }, picUrls: [], description: 'd', price: '899.99', qty: 2,
        variations: [
          { sku: 'USED-S26-ULTRA-512GB-BLACK', details: 'Storage=512GB;Color=Black', price: '899.99', qty: 2 },
          { sku: 'USED-S26-ULTRA-256GB-GRAY', details: 'Storage=256GB;Color=Gray', price: '799.99', qty: 1 },
        ],
      }], {});
      const l2 = csv2.trim().split('\n');
      check('ebay csv: variation listing = parent + child rows with own SKUs',
        l2.length === 4 && !l2[1].includes('Variation')
          && l2[2].includes('USED-S26-ULTRA-512GB-BLACK') && l2[2].includes('Variation') && l2[2].includes('Storage=512GB;Color=Black')
          && l2[3].includes('799.99'), l2.length);
      const parsed = ecsv.parseEbayPage(`<meta property="og:title" content="Samsung Tab A9+ | eBay">
        {"categoryId":"171485","price":"119.99"}
        <div class="ux-labels-values__labels"><span>Brand</span></div><div class="ux-labels-values__values"><span>Samsung</span></div>
        <div class="ux-labels-values__labels"><span>Screen Size</span></div><div class="ux-labels-values__values"><span>8.7 in</span></div>`);
      check('ebay page parser: title, category, price, specifics',
        parsed.title === 'Samsung Tab A9+' && parsed.categoryId === '171485' && parsed.price === 119.99
          && parsed.specs.Brand === 'Samsung' && parsed.specs['Screen Size'] === '8.7 in', parsed);
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
      await exec(`retReceivedBy = 'IM'; retOpenRecv();
        rv.unmatched = false; rv.orderId = 'oid-1'; rv.source = 'WALMART';
        $('rvPo').value = '119121310078834';
        $('rvCust').value = 'J. Alvarez';
        $('rvTrk').value = '1ZF98W401234567890';
        rv.items = [
          { sku: 'S25-128GB-NAVY', title: 'Samsung Galaxy S25 128GB Navy', price: 529.99, quantity: 2, targets: ${JSON.stringify(s25Targets)} },
          { sku: 'A16-64GB-BLK', title: 'Samsung Galaxy A16 64GB Black', price: 139.99, quantity: 1, targets: null },
        ];
        rv.received = [false, false];
        rvLoadItemAt(0);
        rv.condition = 'openbox';
        $('rvMatched').hidden = false; $('rvMatched').textContent = 'matched · J. Alvarez';
        $('rvBy').value = 'IM'; $('rvNote').value = 'box opened once, resealed';
        rvRenderCond();`);
      await sleep(400);
      img = await win.webContents.capturePage();
      const retShot = process.env.CAPTURE_E2E_SHOT.replace(/\.png$/i, '-returns-popup.png');
      fs.writeFileSync(retShot, img.toPNG());
      console.log(`SHOT ${retShot}`);
      // the unmapped state: Used has no listing -> fix row with create button
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
      // a REAL (decodable) JPEG is re-encoded to PNG on arrival (owner
      // wants uniform PNGs); the fake-JPEG uploads above cannot decode, so
      // they keep .jpg — which doubles as the fallback-path check
      const realJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
      const up3 = await (await fetch(`${cbase}/photo?t=${crun.token}&po=119990000000042`, { method: 'POST', body: realJpeg })).json();
      check('claims: real photos re-encode to PNG',
        up3.ok && /_3\.png$/.test(up3.name) && fs.existsSync(cpath.join(cdir, up3.name)), up3);
      const cpage = await (await fetch(`${cbase}/up?t=${crun.token}`)).text();
      check('claims: phone page lists today\'s returns as tap chips',
        cpage.includes('Upload Photos') && cpage.includes('119990000000042') && cpage.includes('TEST-SKU'), cpage.length);
      await crun.close();
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
