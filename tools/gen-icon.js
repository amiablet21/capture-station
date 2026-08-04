// Generates build/icon.ico from scratch — no dependencies.
// Design: brand emerald rounded square with a white barcode glyph
// (flat, no gradients, per BRANDING.md). Renders at 4x supersampling,
// box-downsamples to each ICO size, encodes real PNGs (zlib deflate),
// and packs them into a single .ico (PNG-compressed entries).
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const EMERALD = [0x04, 0x78, 0x57, 255];
const WHITE = [255, 255, 255, 255];

// ---- geometry (256-unit canvas) ----
const BG_RADIUS = 56;
// parcel glyph (option D, approved 2026-08-04): an outlined taped shipping
// box — a 16-unit ring (outer minus inner rounded rect) plus two tape bars
const BOX_OUTER = { x: 52, y: 70, w: 152, h: 120, r: 22 };
const BOX_INNER = { x: 68, y: 86, w: 120, h: 88, r: 6 };
const TAPES = [
  { x: 60, y: 105, w: 136, h: 14, r: 0 },  // horizontal fold line
  { x: 121, y: 112, w: 14, h: 70, r: 0 },  // vertical tape, lower half
];

// signed containment test for a rounded rect, in 256-space
function inRoundedRect(px, py, rect) {
  const { x, y, w, h, r } = rect;
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.max(x + r, Math.min(px, x + w - r));
  const cy = Math.max(y + r, Math.min(py, y + h - r));
  const dx = px - cx, dy = py - cy;
  return (dx * dx + dy * dy) <= r * r || (px >= x + r && px <= x + w - r) || (py >= y + r && py <= y + h - r);
}

function inGlyph(px, py) {
  if (inRoundedRect(px, py, BOX_OUTER) && !inRoundedRect(px, py, BOX_INNER)) return true;
  return TAPES.some(t => inRoundedRect(px, py, t));
}

// render size×size RGBA with SS×SS supersampling
function render(size, ss = 4) {
  const bg = { x: 0, y: 0, w: 256, h: 256, r: BG_RADIUS };
  const px = Buffer.alloc(size * size * 4);
  const step = 256 / (size * ss);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rs = 0, gs = 0, bs = 0, as = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const ux = (x * ss + sx + 0.5) * step;
          const uy = (y * ss + sy + 0.5) * step;
          let c = null;
          if (inRoundedRect(ux, uy, bg)) {
            c = inGlyph(ux, uy) ? WHITE : EMERALD;
          }
          if (c) { rs += c[0]; gs += c[1]; bs += c[2]; as += c[3]; }
        }
      }
      const n = ss * ss;
      const o = (y * size + x) * 4;
      const a = as / n;
      // premultiplied average back to straight alpha
      px[o] = a ? Math.round(rs / n) : 0;
      px[o + 1] = a ? Math.round(gs / n) : 0;
      px[o + 2] = a ? Math.round(bs / n) : 0;
      px[o + 3] = Math.round(a);
    }
  }
  return px;
}

// ---- minimal PNG encoder (RGBA8, no filter) ----
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- ICO container (PNG entries, Vista+) ----
const SIZES = [256, 128, 64, 48, 32, 16];
const pngs = SIZES.map(s => ({ s, png: encodePng(s, render(s)) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);
const entries = [];
let offset = 6 + pngs.length * 16;
for (const { s, png } of pngs) {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s;
  e[1] = s === 256 ? 0 : s;
  e[4] = 1; // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  entries.push(e);
  offset += png.length;
}
const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([header, ...entries, ...pngs.map(p => p.png)]));
fs.writeFileSync(path.join(outDir, 'icon-256.png'), pngs[0].png); // preview / future use
console.log(`build/icon.ico written (${SIZES.join(', ')} px)`);
