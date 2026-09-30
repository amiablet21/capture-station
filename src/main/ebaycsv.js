'use strict';
// eBay lister: pure builders for the Seller Hub upload CSV and the listing
// description HTML (WirelessTechnoStore template, logo colors). No I/O here —
// everything is unit-testable from the e2e suite.

const CONDITION_IDS = { new: 1000, openbox: 1500, used: 3000, scrap: 7000 };

const COND_BLOCKS = {
  new: {
    label: 'BRAND NEW • FACTORY SEALED', bg: '#2e7d32', fg: '#ffffff',
    blurb: 'Item is brand new in its original, unopened retail packaging with the factory seal intact. All original contents are included. Never opened, never activated.',
    includes: 'everything, factory sealed in the original retail box.',
    condRow: 'New',
  },
  openbox: {
    label: 'OPEN BOX', bg: '#6a1b9a', fg: '#ffffff',
    blurb: 'Box has been opened, but the item is in like-new condition — no dents, scratches, or signs of wear. Fully tested and working. All included accessories are original. Original box may show light shelf wear.',
    includes: 'the device + all original accessories, original box (may show light shelf wear).',
    condRow: 'Open Box',
  },
  used: {
    label: 'USED • TESTED & WORKING', bg: '#fbc02d', fg: '#222222',
    blurb: 'Item has been previously used and may show cosmetic wear such as light scratches or scuffs (see photos for actual condition). Fully tested and 100% functional.',
    includes: 'the device + accessories exactly as listed — original accessories may not be included. Wall charger not included.',
    condRow: 'Used — Tested & Working',
  },
  scrap: {
    label: 'FOR PARTS OR REPAIR — NOT WORKING', bg: '#c62828', fg: '#ffffff',
    blurb: 'Item is sold as-is for parts or repair and does not function as intended. Sold with no guarantee of functionality. No returns for non-working condition — please review photos carefully before purchasing.',
    includes: 'the device only — sold as-is.',
    condRow: 'For Parts or Repair',
  },
};

const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The store template: header/footer in the logo colors (royal blue + black),
// ONE condition block, the full spec table, per-condition Package Includes.
function buildDescription({ title, cond, specs }) {
  const c = COND_BLOCKS[cond] || COND_BLOCKS.openbox;
  const rows = Object.entries(specs || {})
    .filter(([, v]) => String(v || '').trim())
    .map(([k, v]) => `<tr><td style="border:1px solid #ddd; padding:10px;">${escHtml(k)}</td><td style="border:1px solid #ddd; padding:10px;">${escHtml(v)}</td></tr>`)
    .join('\n      ');
  return `<div style="font-family: Arial, Helvetica, sans-serif; color:#222; line-height:1.5; max-width:900px; margin:auto;">
  <div style="border-bottom:3px solid #2361EB; padding:14px 0 10px 0; margin-bottom:24px; text-align:center;">
    <div style="font-size:26px; letter-spacing:5px; font-weight:700;"><span style="color:#2361EB;">WIRELESS</span><span style="color:#16181C;">TECHNO</span><span style="color:#2361EB;">STORE</span></div>
    <div style="font-size:12px; letter-spacing:3px; color:#5B6472; margin-top:4px;">30-DAY MONEY BACK GUARANTEE &middot; FAST MESSAGING RESPONSE</div>
  </div>
  <h2 style="text-align:center; color:#111; margin-bottom:4px;">${escHtml(title)}</h2>
  <p style="text-align:center; margin-top:0;">
    <span style="display:inline-block; background:${c.bg}; color:${c.fg}; font-size:18px; font-weight:700; padding:6px 18px; border-radius:4px;">${c.label}</span>
  </p>
  <p style="text-align:center; font-size:16px;">${c.blurb}</p>
  <hr>
  <h3>Full Specifications</h3>
  <table style="width:100%; border-collapse:collapse;">
    <tbody>
      <tr>
        <th style="border:1px solid #ddd; padding:10px; background:#f5f5f5; width:35%;">Specification</th>
        <th style="border:1px solid #ddd; padding:10px; background:#f5f5f5;">Details</th>
      </tr>
      ${rows}
      <tr><td style="border:1px solid #ddd; padding:10px;">Condition</td><td style="border:1px solid #ddd; padding:10px;">${c.condRow}</td></tr>
    </tbody>
  </table>
  <h3>Package Includes</h3>
  <p><strong>Package Includes:</strong> ${c.includes}</p>
  <div style="border-top:3px solid #2361EB; margin-top:28px; padding-top:14px; text-align:center;">
    <div style="font-size:15px;"><strong><span style="color:#2361EB;">Wireless</span><span style="color:#16181C;">Techno</span><span style="color:#2361EB;">Store</span></strong></div>
    <div style="font-size:13px; color:#5B6472; margin-top:4px;">Every device inspected and tested before shipping &middot; Fast shipping &middot; Questions? Message us — we respond quickly.</div>
  </div>
</div>`;
}

// CSV field: quote when needed, double internal quotes
const csvq = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// listings: [{ sku, categoryId, title, cond, specs {label: value}, picUrls [],
//              description, price, qty, variations [{sku, details, price, qty}] }]
// profiles: { shipping, returns, payment, location, dispatchDays }
// Variation specifics in eBay's upload format: the names eBay's own phone
// and tablet categories use, NOT the SKU grammar's short words. A child row
// reads `Storage Capacity=64GB|Color=Gray` (pipe between specifics), the
// parent row lists every value each specific takes
// (`Storage Capacity=64GB;128GB|Color=Gray;Black`). The first upload went
// out as `Storage=64GB;Color=Gray` — eBay read that as one specific with two
// values (owner's rejected upload, 2026-09-28).
const VAR_NAMES = { storage: 'Storage Capacity', color: 'Color' };

// a variation's {storage, color}; older payloads carry only the joined
// `details` string, so parse that when the fields are missing
function varAxes(v) {
  const out = { storage: String(v.storage || '').trim(), color: String(v.color || '').trim() };
  if ((!out.storage || !out.color) && v.details) {
    for (const part of String(v.details).split(/[;|]/)) {
      const [k, val] = part.split('=');
      if (/storage/i.test(k || '') && !out.storage) out.storage = String(val || '').trim();
      if (/color/i.test(k || '') && !out.color) out.color = String(val || '').trim();
    }
  }
  return out;
}
function varDetails(v) {
  const a = varAxes(v);
  return [a.storage && `${VAR_NAMES.storage}=${a.storage}`, a.color && `${VAR_NAMES.color}=${a.color}`].filter(Boolean).join('|');
}
function parentDetails(variations) {
  const storages = [], colors = [];
  for (const v of variations) {
    const a = varAxes(v);
    if (a.storage && !storages.includes(a.storage)) storages.push(a.storage);
    if (a.color && !colors.includes(a.color)) colors.push(a.color);
  }
  return [storages.length && `${VAR_NAMES.storage}=${storages.join(';')}`, colors.length && `${VAR_NAMES.color}=${colors.join(';')}`].filter(Boolean).join('|');
}

function buildEbayCsv(listings, profiles) {
  const p = profiles || {};
  // one header serves every listing: union of all C: labels, stable order
  const specCols = [];
  for (const l of listings) {
    for (const k of Object.keys(l.specs || {})) if (!specCols.includes(k)) specCols.push(k);
  }
  const header = [
    '*Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)',
    'CustomLabel', '*Category', '*Title', 'Relationship', 'RelationshipDetails', '*ConditionID',
    ...specCols.map(k => `C:${k}`),
    'PicURL', '*Description', '*Format', '*Duration', '*StartPrice', '*Quantity',
    '*Location', '*DispatchTimeMax', 'ShippingProfileName', 'ReturnProfileName', 'PaymentProfileName',
  ];
  const lines = [header.map(csvq).join(',')];
  const base = (l) => ({
    cat: l.categoryId || '',
    cond: CONDITION_IDS[l.cond] || l.conditionId || '',
    pics: (l.picUrls || []).join('|'),
    loc: p.location || 'US',
    disp: p.dispatchDays ?? 1,
  });
  for (const l of listings) {
    const b = base(l);
    const spec = (k) => (l.specs || {})[k] ?? '';
    if (l.variations && l.variations.length) {
      // parent: everything shared; children: one row per combo with its own
      // CustomLabel (the condition SKU Linnworks auto-links), price, qty.
      // A specific that varies (Storage Capacity, Color) must NOT also sit
      // on the parent as an item specific — eBay rejects the clash
      const varying = new Set(Object.values(VAR_NAMES).map(n => n.toLowerCase()));
      const parentSpec = (k) => varying.has(String(k).toLowerCase()) ? '' : spec(k);
      lines.push([
        'Add', l.sku, b.cat, l.title, '', parentDetails(l.variations), b.cond,
        ...specCols.map(parentSpec),
        b.pics, l.description, 'FixedPrice', 'GTC', '', '',
        b.loc, b.disp, p.shipping || '', p.returns || '', p.payment || '',
      ].map(csvq).join(','));
      for (const v of l.variations) {
        lines.push([
          'Add', v.sku, '', '', 'Variation', varDetails(v), '',
          ...specCols.map(() => ''),
          '', '', '', '', v.price, v.qty,
          '', '', '', '', '',
        ].map(csvq).join(','));
      }
    } else {
      lines.push([
        'Add', l.sku, b.cat, l.title, '', '', b.cond,
        ...specCols.map(spec),
        b.pics, l.description, 'FixedPrice', 'GTC', l.price, l.qty,
        b.loc, b.disp, p.shipping || '', p.returns || '', p.payment || '',
      ].map(csvq).join(','));
    }
  }
  return lines.join('\n') + '\n';
}

// Parse the "About this item" specifics out of a live eBay listing page.
// eBay's SSR markup has carried the ux-labels-values classes for years; if
// they ever change, the caller falls back to manual fill.
function parseEbayPage(html) {
  const out = { title: '', categoryId: '', price: 0, specs: {} };
  const t = html.match(/<meta property="og:title" content="([^"]+)"/i);
  if (t) out.title = t[1].replace(/\s*\|\s*eBay\s*$/i, '').trim();
  const c = html.match(/"categoryId"\s*:\s*"?(\d+)/);
  if (c) out.categoryId = c[1];
  const pr = html.match(/"price"\s*:\s*"?([\d.]+)/) || html.match(/itemprop="price"[^>]*content="([\d.]+)"/i);
  if (pr) out.price = Number(pr[1]) || 0;
  // label text -> lazily skip markup -> the matching values text. The lazy
  // middle stops at the FIRST __values marker, keeping pairs aligned.
  const re = /ux-labels-values__labels[^>]*>(?:\s*<[^>]+>)*\s*([^<>]+?)\s*<[\s\S]*?ux-labels-values__values[^>]*>(?:\s*<[^>]+>)*\s*([^<>]+?)\s*</g;
  let m;
  while ((m = re.exec(html)) && Object.keys(out.specs).length < 30) {
    const label = m[1].trim().replace(/:$/, '');
    const value = m[2].trim();
    if (!label || !value || /^condition$/i.test(label) || /read more|see all/i.test(value)) continue;
    if (!out.specs[label]) out.specs[label] = value;
  }
  return out;
}

module.exports = { buildEbayCsv, buildDescription, parseEbayPage, CONDITION_IDS };
