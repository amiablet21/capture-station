'use strict';

// Demo mode (CAPTURE_DEMO=1): boots the app on an isolated throwaway
// profile and seeds believable dummy data into the renderer, so unreleased
// UI can be reviewed without Linnworks credentials. Nothing here touches
// the real profile, and none of it runs in a normal boot.

const DEMO_SEED = `(() => {
  // a fresh profile may auto-open settings/onboarding: demo review needs none of it
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  const now = new Date();
  const iso = (mins) => new Date(now.getTime() - mins * 60000).toISOString();
  const row = (id, po, extra) => ({
    id, order_number: po, channel: 'walmart', status: 'pending', origin: 'linnworks',
    created_at: iso(id), day: now.toISOString().slice(0, 10),
    tracking: '', notes: '', serials: [], items: [], sub_sku: '', sub_qty: 0, sub_for: '',
    lw_order_id: '', ...extra,
  });
  state.captureOnly = false;
  state.pages = { stock: true, history: true, returns: true };
  state.locations = { primaryName: 'Digital World Shop', fallbackName: 'DropShip', fallbackSet: true };
  state.shipCutoff = '16:00';
  state.rows = [
    row(4, '119121888000111', { lw_order_id: 'LW-A' }),
    row(3, '119121888000111', { lw_order_id: 'LW-B' }),
    row(2, '119121525565007', {}),
    row(1, '02-14818-21581', { channel: 'ebay', tracking: '1ZF9814D0216394250', status: 'captured' }),
  ];
  state.orderMeta = {
    '119121888000111#LW-A': { source: 'WALMART', despatchBy: now.toISOString(), split: { part: 1, of: 2 },
      items: [{ sku: 'S25-256GB-SILVERSHADOW', qty: 1, title: 'Galaxy S25 256GB', img: '' }] },
    '119121888000111#LW-B': { source: 'WALMART', despatchBy: now.toISOString(), dropship: true, split: { part: 2, of: 2 },
      items: [{ sku: 'X400-64GB-BLACK', qty: 1, title: 'X400 64GB', img: '' }] },
    '119121525565007': { source: 'WALMART', despatchBy: '2026-08-05T00:00:00', parked: true,
      items: [{ sku: 'S26-PLUS-256GB-WHITE', qty: 2, title: 'Galaxy S26+', img: '' }] },
    '02-14818-21581': { source: 'EBAY', despatchBy: now.toISOString(),
      items: [{ sku: 'Z-FOLD-256GB-JBLK', qty: 1, title: 'Galaxy Z Fold', img: '' }] },
  };
  // stock sheet + unlisted machinery
  unlistedSkus = new Set(['OPEN-BOX-S25-FE-128GB', 'S26-PLUS-256GB-WHITE']);
  unlistedDetail = [
    { sku: 'S26-PLUS-256GB-WHITE', title: 'Galaxy S26+ 256GB White', image: '', avail: 2, retail: 999 },
    { sku: 'OPEN-BOX-S25-FE-128GB', title: 'Galaxy S25 FE (Open Box)', image: '', avail: 1, retail: 449 },
  ];
  unlistedChannels = ['WALMART', 'EBAY'];
  // inventory cache: the mapping screen's right sheet + combos everywhere
  recvItems = [
    { sku: 'X230-128GB-GRAY', title: 'Galaxy Tab A11+ 128GB Gray', stockItemId: 'd1', levels: [], retailPrice: 219 },
    { sku: 'X230-128GB-SILVER', title: 'Galaxy Tab A11+ 128GB Silver', stockItemId: 'd2', levels: [], retailPrice: 219 },
    { sku: 'S26-PLUS-256GB-WHITE', title: 'Galaxy S26+ 256GB White', stockItemId: 'd3', levels: [], retailPrice: 999 },
    { sku: 'OPEN-BOX-S25-FE-128GB', title: 'Galaxy S25 FE 128GB — Open Box', stockItemId: 'd4', levels: [], retailPrice: 449 },
    { sku: 'X110-64GB-GRAY', title: 'Galaxy Tab A9 64GB Gray', stockItemId: 'd5', levels: [], retailPrice: 149 },
  ];
  recvBySku = new Map(recvItems.map(i => [i.sku.toLowerCase(), i]));
  recvByBarcode = new Map();
  recvLookup = 'ready';
  // channel mapping: local demo catalog (twin listings included)
  chmap.local = true;
  chmap.channels = [
    { id: 1, source: 'WALMART', subSource: '10001467995' },
    { id: 2, source: 'EBAY', subSource: 'wirelesstechnostore' },
    { id: 3, source: 'TEMU US', subSource: 'Digital World Shop' },
  ];
  chmap.chan = chmap.channels[0];
  chmap.items = [
    { sku: 'X230-128GB-GRAY-GLOBAL', title: 'Samsung Galaxy Tab A11+ 11" 128GB Wi-Fi', wfs: false, linked: true, linkedItemId: 'd1', rowId: 'r1' },
    { sku: 'X230-128GB-GRAY-GLOBAL-1', title: 'Samsung Galaxy Tab A11+ (Plus) 128GB — twin', wfs: false, linked: true, linkedItemId: 'd1', rowId: 'r2' },
    { sku: 'S26-PLUS-256GB-WHITE-US', title: 'Samsung Galaxy S26+ 256GB White', wfs: false, linked: false, linkedItemId: '', rowId: '' },
    { sku: 'S26PLUS-256-WHT-2', title: 'Samsung Galaxy S26+ 256GB White — twin listing', wfs: false, linked: false, linkedItemId: '', rowId: '' },
    { sku: 'OB-S25-FE-128', title: 'Galaxy S25 FE 128GB (Open Box)', wfs: false, linked: false, linkedItemId: '', rowId: '' },
    { sku: 'X110GRAY-WFS', title: 'Samsung Galaxy Tab A9 64GB Gray (WFS)', wfs: true, linked: true, linkedItemId: 'd5', rowId: 'r5' },
  ];
  render();
  renderRetTodo();
  return 'demo seeded';
})()`;

function seedDemo(win, db) {
  // the returns log reads from the (throwaway) db — real records, fake data
  try {
    db.createReturn({
      orderNumber: '119120771799124', source: 'WALMART', customer: 'Marybeth Morris',
      tracking: '1Z43241903901156', receivedBy: 'IM', note: '', unmatched: false,
      items: [{ sku: 'S25-256GB-SILVERSHADOW', condition: 'new', targetSku: 'S25-256GB-SILVERSHADOW', qty: 1, price: 529.99, note: 'brand new' }],
    });
    db.createReturn({
      orderNumber: '119119354597966', source: 'WALMART', customer: 'Terrence Howell',
      tracking: '', receivedBy: 'IM', note: '', unmatched: true,
      items: [{ sku: 'S25-FE-128GB-JETBLACK', condition: 'openbox', targetSku: 'OPEN-BOX-S25-FE-128GB', qty: 1, price: 449.0, note: 'no issues' }],
    });
    db.createReturn({
      orderNumber: '119120671019601', source: 'WALMART', customer: '',
      tracking: '', receivedBy: 'IM', note: '', unmatched: true,
      items: [{ sku: 'S26-ULTRA-512GB-BLACK', condition: 'used', targetSku: 'USED-S26-ULTRA-512GB-BLACK', qty: 2, price: 1099.0, settle: 765.98, note: 'scuffed corner — case: 05589312' }],
    });
  } catch { /* re-seed on a reused temp profile: duplicates are fine to skip */ }
  const inject = async () => {
    try {
      await win.webContents.executeJavaScript(DEMO_SEED);
      await win.webContents.executeJavaScript(
        `toast('DEMO DATA — throwaway profile, nothing here is real', 9000)`);
    } catch { /* renderer not ready yet; the retry below covers it */ }
  };
  win.webContents.on('did-finish-load', () => setTimeout(inject, 600));
}

module.exports = { seedDemo };
