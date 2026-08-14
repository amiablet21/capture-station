'use strict';

// Temu bulk-upload workbook writer. Temu listings are created by filling the
// seller's own downloaded template (an .xlsx with hidden token rows Temu's
// importer validates) and uploading it back in Seller Central — so unlike the
// eBay CSV, the output must BE that workbook with product rows written into
// the Template sheet. This module reads the template (zip of XML), fills rows
// 5+ (which exist as stubs carrying only a category-name formula in column F),
// and rebuilds the zip byte-identical everywhere else. Dependency-free: zlib.

const fs = require('fs');
const zlib = require('zlib');

/* ---------- zip: read entries, rebuild with replaced parts ---------- */

function zipEntries(buf) {
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) throw new Error('Not an .xlsx file (zip signature missing).');
  const count = buf.readUInt16LE(i + 10);
  let off = buf.readUInt32LE(i + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const cmtLen = buf.readUInt16LE(off + 32);
    out.push({
      method: buf.readUInt16LE(off + 10),
      mtime: buf.readUInt16LE(off + 12),
      mdate: buf.readUInt16LE(off + 14),
      crc: buf.readUInt32LE(off + 16),
      csize: buf.readUInt32LE(off + 20),
      usize: buf.readUInt32LE(off + 24),
      extAttrs: buf.readUInt32LE(off + 38),
      lho: buf.readUInt32LE(off + 42),
      name: buf.toString('utf8', off + 46, off + 46 + nameLen),
    });
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

function rawData(buf, e) {
  const nl = buf.readUInt16LE(e.lho + 26);
  const el = buf.readUInt16LE(e.lho + 28);
  const start = e.lho + 30 + nl + el;
  return buf.subarray(start, start + e.csize);
}

function zipReadText(buf, entries, name) {
  const e = entries.find(x => x.name === name);
  if (!e) return null;
  const data = rawData(buf, e);
  const plain = e.method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
  return plain.toString('utf8');
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// Rebuild the whole zip: replaced parts recompressed, everything else copied
// raw. Local headers are rewritten from central-directory facts (the template
// uses trailing data descriptors — bit 3 — which are dropped here) so the
// result is a plain, maximally-compatible zip.
function rebuildZip(buf, replacements) {
  const entries = zipEntries(buf);
  const parts = [];
  const cd = [];
  let off = 0;
  for (const e of entries) {
    let { method, crc, csize, usize } = e;
    let data;
    if (replacements.has(e.name)) {
      const plain = Buffer.isBuffer(replacements.get(e.name))
        ? replacements.get(e.name) : Buffer.from(String(replacements.get(e.name)), 'utf8');
      data = zlib.deflateRawSync(plain, { level: 6 });
      method = 8; crc = crc32(plain); csize = data.length; usize = plain.length;
    } else {
      data = rawData(buf, e);
    }
    const nameBuf = Buffer.from(e.name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8 names; no data descriptor
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(e.mtime, 10);
    lh.writeUInt16LE(e.mdate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(csize, 18);
    lh.writeUInt32LE(usize, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    parts.push(lh, nameBuf, data);
    cd.push({ e, method, crc, csize, usize, off, nameBuf });
    off += 30 + nameBuf.length + csize;
  }
  const cdParts = [];
  let cdSize = 0;
  for (const c of cd) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt16LE(0x0800, 8);
    h.writeUInt16LE(c.method, 10);
    h.writeUInt16LE(c.e.mtime, 12);
    h.writeUInt16LE(c.e.mdate, 14);
    h.writeUInt32LE(c.crc, 16);
    h.writeUInt32LE(c.csize, 20);
    h.writeUInt32LE(c.usize, 24);
    h.writeUInt16LE(c.nameBuf.length, 28);
    h.writeUInt32LE(c.e.extAttrs, 38);
    h.writeUInt32LE(c.off, 42);
    cdParts.push(h, c.nameBuf);
    cdSize += 46 + c.nameBuf.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(cd.length, 8);
  eocd.writeUInt16LE(cd.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, ...cdParts, eocd]);
}

/* ---------- worksheet helpers ---------- */

function colLetter(idx) { // 0 -> A, 27 -> AB
  let n = idx + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

const escXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const unesc = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

// One filled sheet row: our inline-string cells in column order, keeping any
// cells the template already put in that row (the column-F formula) intact.
function buildRowXml(rowNum, cells, keepXml) {
  const parts = [];
  const sorted = [...cells.entries()].sort((a, b) => a[0] - b[0]);
  for (const [idx, val] of sorted) {
    if (val === undefined || val === null || String(val) === '') continue;
    parts.push(`<c r="${colLetter(idx)}${rowNum}" t="inlineStr"><is><t xml:space="preserve">${escXml(val)}</t></is></c>`);
  }
  return `<row r="${rowNum}">${keepXml || ''}${parts.join('')}</row>`;
}

/* ---------- template introspection ---------- */

function templateSheetPath(buf, entries) {
  const wb = zipReadText(buf, entries, 'xl/workbook.xml') || '';
  const m = wb.match(/<sheet[^>]*name="Template"[^>]*r:id="(rId\d+)"[^>]*\/>/)
    || wb.match(/<sheet[^>]*r:id="(rId\d+)"[^>]*name="Template"[^>]*\/>/);
  if (!m) throw new Error('This file has no "Template" sheet — download the category template from Temu Seller Central.');
  const rels = zipReadText(buf, entries, 'xl/_rels/workbook.xml.rels') || '';
  const t = rels.match(new RegExp(`Id="${m[1]}"[^>]*Target="([^"]+)"`)) || rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${m[1]}"`));
  if (!t) throw new Error('Workbook relationships are missing the Template sheet.');
  return 'xl/' + t[1].replace(/^\//, '').replace(/^xl\//, '');
}

function parseHeaderRow(sheetXml, rowNum) {
  const m = sheetXml.match(new RegExp(`<row r="${rowNum}"[^>]*>([\\s\\S]*?)</row>`));
  if (!m) return [];
  const out = [];
  for (const cm of m[1].matchAll(/<c r="([A-Z]+)\d+"[^>]*>([\s\S]*?)<\/c>/g)) {
    let n = 0;
    for (const ch of cm[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    const t = [...cm[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('');
    out[n - 1] = unesc(t).trim();
  }
  return out;
}

// Columns of the Template sheet: visible name (row 2) + internal key (row 4).
function readTemplate(templatePath) {
  const buf = fs.readFileSync(templatePath);
  const entries = zipEntries(buf);
  const sheetPath = templateSheetPath(buf, entries);
  const xml = zipReadText(buf, entries, sheetPath);
  if (!xml) throw new Error('The Template sheet could not be read from the file.');
  const names = parseHeaderRow(xml, 2);
  const keys = parseHeaderRow(xml, 4);
  if (!keys.some(k => /^t_\d_/.test(k || ''))) throw new Error('This does not look like a Temu upload template (field keys missing).');
  const columns = [];
  for (let i = 0; i < Math.max(names.length, keys.length); i++) {
    if (names[i] || keys[i]) columns.push({ idx: i, name: names[i] || '', key: keys[i] || '' });
  }
  return { buf, entries, sheetPath, xml, columns };
}

/* ---------- field resolution + row building ---------- */

function colsWhere(columns, pred) { return columns.filter(pred).map(c => c.idx); }
function firstCol(columns, pred) { const c = columns.find(pred); return c ? c.idx : -1; }

const keyIs = (k) => (c) => c.key === k;
const keyEnds = (s) => (c) => c.key.endsWith(s);
// numbered spec columns: row-4 key "t_3_Property:318", row-2 name
// "318 - Operating System" — either identifies the column
const specCol = (id) => (c) => c.key.endsWith(`Property:${id}`) || c.name.startsWith(`${id} - `);

// products: [{ category, name, brand, origin, description, variations: [
//   { sku, goods, color, ramrom, qty, base, list, weightLb, lenIn, widIn,
//     heiIn, images: [url], upc }], specs: { id: value } }]
// profiles: { shippingTemplate, handlingTime }
function buildRows(columns, products, profiles) {
  const p = profiles || {};
  const rows = [];
  for (const prod of products) {
    for (const v of prod.variations || []) {
      const cells = new Map();
      const put = (idx, val) => { if (idx >= 0 && val !== undefined && val !== null && String(val).trim() !== '') cells.set(idx, String(val).trim()); };
      put(firstCol(columns, keyIs('t_1_Category')), prod.category);
      put(firstCol(columns, keyEnds('_Product Name')), prod.name);
      put(firstCol(columns, keyEnds('_Contribution Goods')), v.goods || v.sku);
      put(firstCol(columns, keyEnds('_Contribution SKU')), v.sku);
      put(firstCol(columns, keyEnds('_Update or Add')), 'Add');
      put(firstCol(columns, keyEnds('_Brand')), prod.brand);
      put(firstCol(columns, keyEnds('_Product Description')), prod.description);
      for (const [id, val] of Object.entries(prod.specs || {})) {
        for (const idx of colsWhere(columns, specCol(id))) put(idx, val);
      }
      put(firstCol(columns, keyEnds('_Variation Theme')), prod.variationTheme);
      put(firstCol(columns, (c) => /(^|_)RAM\+ROM$/.test(c.key) || c.name === 'RAM+ROM'), v.ramrom);
      put(firstCol(columns, (c) => /(^|_)Color$/.test(c.key) || (c.name === 'Color' && !/^t_[01]/.test(c.key))), v.color);
      const imgCols = colsWhere(columns, keyEnds('_SKU Images URL'));
      (v.images || []).slice(0, imgCols.length).forEach((u, i) => put(imgCols[i], u));
      const detCols = colsWhere(columns, keyEnds('_Detail Images URL'));
      (v.images || []).slice(0, Math.min(6, detCols.length)).forEach((u, i) => put(detCols[i], u));
      put(firstCol(columns, keyEnds('_Quantity')), v.qty);
      put(firstCol(columns, keyEnds('_Base Price - USD')), v.base);
      put(firstCol(columns, keyEnds('_List Price - USD')), v.list);
      put(firstCol(columns, keyEnds('_Weight - lb')), v.weightLb);
      put(firstCol(columns, keyEnds('_Length - in')), v.lenIn);
      put(firstCol(columns, keyEnds('_Width - in')), v.widIn);
      put(firstCol(columns, keyEnds('_Height - in')), v.heiIn);
      if (v.upc && /^\d{12,14}$/.test(String(v.upc))) {
        const type = String(v.upc).length === 12 ? 'UPC' : String(v.upc).length === 13 ? 'EAN' : 'GTIN-14';
        put(firstCol(columns, keyEnds('_External Product ID Type')), type);
        put(firstCol(columns, keyEnds('_External Product ID')), v.upc);
      }
      put(firstCol(columns, keyEnds('_Individually packed')), 'Yes');
      put(firstCol(columns, keyEnds('_Total packaging quantity')), '1');
      put(firstCol(columns, keyEnds('_Packaging unit')), 'piece');
      put(firstCol(columns, keyEnds('_SKU type')), 'Single set');
      put(firstCol(columns, keyEnds('_Shipping Template')), p.shippingTemplate || 'FREE SHIPPING');
      put(firstCol(columns, keyEnds('_Handling Time')), p.handlingTime || '1 Day');
      put(firstCol(columns, keyEnds('_Import Designation')), 'Imported');
      put(firstCol(columns, keyEnds('_Fulfillment Channel')), 'I will ship this item myself');
      put(firstCol(columns, keyEnds('_Country/Region of Origin')), prod.origin);
      // Prop 65 wears a governance key (t_8_Governance Property:…) — resolve
      // by the visible column name instead
      put(firstCol(columns, (c) => c.name === 'California Proposition 65 Warning Type'), 'No Warning Applicable');
      rows.push(cells);
    }
  }
  return rows;
}

// Write the rows into the Template sheet, starting at row 5. The template
// pre-creates rows 5..3000 as stubs holding only the column-F category-name
// formula — each stub is replaced in place, keeping that formula cell.
function fillWorkbook(templatePath, products, profiles) {
  const { buf, sheetPath, xml, columns } = readTemplate(templatePath);
  const rows = buildRows(columns, products, profiles);
  if (!rows.length) throw new Error('Nothing to export.');
  let out = xml;
  rows.forEach((cells, i) => {
    const rowNum = 5 + i;
    const re = new RegExp(`<row r="${rowNum}"[^>]*>([\\s\\S]*?)</row>`);
    const m = out.match(re);
    if (!m) throw new Error(`The template has no row ${rowNum} — it holds 2996 rows max.`);
    const keep = (m[1].match(new RegExp(`<c r="F${rowNum}"[\\s\\S]*?</c>`)) || [''])[0];
    out = out.replace(re, buildRowXml(rowNum, cells, keep).replace(/\$/g, '$$$$'));
  });
  return rebuildZip(buf, new Map([[sheetPath, out]]));
}

// Nearest Temu-allowed color for a phone/tablet variation. Temu's palette on
// these categories is fixed; anything else must map or the row is rejected.
const TEMU_COLORS = ['Black', 'White', 'Red', 'Orange', 'Yellow', 'Green', 'Blue'];
const COLOR_MAP = {
  BLACK: 'Black', JETBLACK: 'Black', JBLK: 'Black', BLK: 'Black', GRAPHITE: 'Black', GRAY: 'Black', GREY: 'Black', TITANIUM: 'Black', PHANTOM: 'Black',
  WHITE: 'White', SILVER: 'White', CREAM: 'White', BEIGE: 'White', GOLD: 'White', PLATINUM: 'White', SHADOW: 'White',
  RED: 'Red', BURGUNDY: 'Red', CORAL: 'Red', PINK: 'Red', ROSE: 'Red',
  ORANGE: 'Orange', PEACH: 'Orange',
  YELLOW: 'Yellow', LEMON: 'Yellow',
  GREEN: 'Green', MINT: 'Green', LIME: 'Green', OLIVE: 'Green',
  BLUE: 'Blue', NAVY: 'Blue', ICYBLUE: 'Blue', ICEBLUE: 'Blue', SKYBLUE: 'Blue', VIOLET: 'Blue', PURPLE: 'Blue', LAVENDER: 'Blue', SILVERBLUE: 'Blue',
};

function temuColorFor(text) {
  const t = String(text || '').toUpperCase().replace(/[^A-Z]/g, '');
  for (const [k, v] of Object.entries(COLOR_MAP)) if (t.includes(k)) return v;
  return 'Black';
}

module.exports = {
  readTemplate, buildRows, fillWorkbook, temuColorFor, TEMU_COLORS,
  _internal: { zipEntries, rebuildZip, zipReadText, colLetter, buildRowXml, crc32, escXml },
};
