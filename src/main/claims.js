'use strict';
// Claim photos: a tiny LAN-only upload server. The warehouse phone scans a QR
// shown by the app, shoots, and each photo is POSTed straight here — landing as
// plain files in Documents\Capture Station\claim photos, named
// PO#_MMDD-HHMM_n.jpg. Nothing is saved on the phone, nothing leaves the LAN.
// Files older than KEEP_DAYS are removed when the app starts.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const MAX_BYTES = 15 * 1024 * 1024;
const KEEP_DAYS = 5;

function sanitizePo(po) {
  return String(po || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
}

// magic-byte sniff — the phone page only offers the camera, but never trust
// the network: anything that isn't a real image is rejected
function magicExt(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return '.webp';
  if (buf.slice(4, 8).toString('ascii') === 'ftyp') return '.heic'; // iPhone HEIF family
  return null;
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// numbering continues per PO across sends (and across days): a second batch
// for the same PO picks up at _3, _4… — max+1, so deletions can't collide
function nextIndex(dir, po) {
  let max = 0;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return 1; }
  for (const n of names) {
    if (!n.startsWith(`${po}_`)) continue;
    const m = n.match(/_(\d+)\.[A-Za-z0-9]+$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

function cleanupOld(dir) {
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  let removed = 0;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const n of names) {
    const f = path.join(dir, n);
    try {
      const st = fs.statSync(f);
      if (st.isFile() && st.mtimeMs < cutoff) { fs.unlinkSync(f); removed++; }
    } catch { /* locked or already gone */ }
  }
  return removed;
}

function todayCount(dir) {
  const today = new Date().toDateString();
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  let c = 0;
  for (const n of names) {
    try { if (new Date(fs.statSync(path.join(dir, n)).mtimeMs).toDateString() === today) c++; } catch { /* ignore */ }
  }
  return c;
}

// the address the phone can actually reach — first private IPv4 wins
function lanIp() {
  const nets = os.networkInterfaces();
  const all = [];
  for (const list of Object.values(nets)) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) all.push(ni.address);
    }
  }
  const score = (a) => a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : a.startsWith('172.') ? 2 : 3;
  all.sort((a, b) => score(a) - score(b));
  return all[0] || '127.0.0.1';
}

// Read the EXIF Orientation tag out of a JPEG (1 = upright). Phones save
// sideways pixels + this flag; Electron's decoder drops the flag without
// applying it, so we must rotate the pixels ourselves.
function jpegOrientation(buf) {
  try {
    if (!(buf[0] === 0xFF && buf[1] === 0xD8)) return 1;
    let i = 2;
    while (i + 4 < buf.length && buf[i] === 0xFF) {
      const marker = buf[i + 1];
      if (marker === 0xDA) break; // start of scan: no EXIF past here
      const size = buf.readUInt16BE(i + 2);
      if (marker === 0xE1 && buf.slice(i + 4, i + 10).toString('ascii') === 'Exif\0\0') {
        const t = i + 10; // TIFF header
        const le = buf.slice(t, t + 2).toString('ascii') === 'II';
        const rd16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
        const rd32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
        const ifd = t + rd32(t + 4);
        const n = rd16(ifd);
        for (let k = 0; k < n; k++) {
          const e = ifd + 2 + k * 12;
          if (rd16(e) === 0x0112) return rd16(e + 8) || 1;
        }
        return 1;
      }
      i += 2 + size;
    }
  } catch { /* malformed EXIF: assume upright */ }
  return 1;
}

// JPEG/WebP -> upright PNG via Electron's decoder (EXIF rotation applied);
// null if the format is beyond it
function toPng(buf) {
  try {
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return null;
    const o = jpegOrientation(buf);
    if (o !== 3 && o !== 6 && o !== 8) return img.toPNG();
    const { width: w, height: h } = img.getSize();
    const src = img.toBitmap(); // BGRA
    const rot90 = o !== 3;
    const dw = rot90 ? h : w;
    const dh = rot90 ? w : h;
    const dst = Buffer.alloc(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let nx, ny;
        if (o === 6) { nx = h - 1 - y; ny = x; }      // rotate 90° CW
        else if (o === 8) { nx = y; ny = w - 1 - x; } // rotate 90° CCW
        else { nx = w - 1 - x; ny = h - 1 - y; }      // 180°
        const si = (y * w + x) * 4;
        const di = (ny * dw + nx) * 4;
        dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
      }
    }
    return nativeImage.createFromBitmap(dst, { width: dw, height: dh }).toPNG();
  } catch {
    return null;
  }
}

function tokenOk(token, t) {
  const a = Buffer.from(String(t || ''));
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- the phone page ---------- */
// Served to the phone's browser (NOT the app renderer — the app's CSP does not
// apply here, inline styles are fine). Camera-only input: photos go straight
// from the camera into the POST, nothing is written to the phone's gallery.

function phonePage(token, po, pos) {
  const chips = pos.map(p =>
    `<button class="chip" data-po="${p.po}"><span class="po">${p.po}</span><span class="sk">${p.sku || ''}</span><span class="tm">received ${p.tm}</span></button>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Upload Photos</title>
<style>
  * { box-sizing: border-box; margin: 0; -webkit-tap-highlight-color: transparent; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: #f7f7f5; color: #2f3437; min-height: 100vh; display: flex; flex-direction: column; }
  header { background: #047857; color: #fff; font-weight: 600; font-size: 16px; padding: 14px 16px; }
  main { flex: 1; padding: 14px; display: flex; flex-direction: column; gap: 10px; max-width: 480px; width: 100%; margin: 0 auto; }
  .lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #9b9a97; }
  .chip { display: flex; flex-direction: column; gap: 2px; text-align: left; border: 1px solid #e0e0dd; border-radius: 12px; background: #fff; padding: 12px 14px; cursor: pointer; font: inherit; }
  .chip:active { border-color: #047857; }
  .chip .po { font-family: ui-monospace, Menlo, monospace; font-size: 15px; font-weight: 600; }
  .chip .sk { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #9b9a97; }
  .chip .tm { font-size: 11px; color: #9b9a97; }
  .typelink { font-size: 13px; color: #6b6f76; text-align: center; text-decoration: underline; background: none; border: none; padding: 8px; cursor: pointer; }
  #poIn { font-family: ui-monospace, Menlo, monospace; font-size: 16px; padding: 12px; border: 1px solid #e0e0dd; border-radius: 10px; width: 100%; display: none; }
  #poIn.on { display: block; }
  .lock { display: none; align-items: center; gap: 8px; background: #ecf5f0; border-radius: 12px; padding: 12px 14px; }
  .lock.on { display: flex; }
  .lock .po { font-family: ui-monospace, Menlo, monospace; font-size: 15px; font-weight: 700; color: #047857; flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .lock button { font-size: 12px; color: #6b6f76; text-decoration: underline; background: none; border: none; cursor: pointer; }
  #camBtn { display: none; border: 2px dashed #047857; border-radius: 14px; background: #ecf5f0; color: #047857; font-size: 16px; font-weight: 600; padding: 26px 12px; text-align: center; cursor: pointer; }
  #camBtn.on { display: block; }
  #camBtn .big { font-size: 30px; display: block; margin-bottom: 4px; }
  #shots { display: flex; gap: 8px; flex-wrap: wrap; }
  #shots img { width: 64px; height: 64px; object-fit: cover; border-radius: 10px; border: 1px solid #e0e0dd; }
  #send { display: none; margin-top: auto; background: #047857; color: #fff; border: none; border-radius: 12px; font-size: 17px; font-weight: 600; padding: 15px; cursor: pointer; }
  #send.on { display: block; }
  #send:disabled { opacity: .4; }
  #ok { display: none; text-align: center; padding: 30px 10px; }
  #ok.on { display: block; }
  #ok .mark { font-size: 44px; }
  #ok p { font-size: 15px; margin-top: 8px; }
  #ok button { margin-top: 18px; background: #047857; color: #fff; border: none; border-radius: 12px; font-size: 15px; font-weight: 600; padding: 12px 22px; cursor: pointer; }
  #err { display: none; background: #fdecec; color: #b91c1c; border-radius: 10px; padding: 10px 12px; font-size: 13px; }
</style></head><body>
<header>Upload Photos</header>
<main>
  <div id="pick">
    <div class="lbl" style="margin-bottom:8px">Today's returns — tap one</div>
    <div style="display:flex;flex-direction:column;gap:8px">${chips || '<div style="font-size:13px;color:#9b9a97">No returns received today yet.</div>'}</div>
    <button class="typelink" id="typeLink">or type a PO#…</button>
    <input id="poIn" placeholder="PO#" autocomplete="off" spellcheck="false" enterkeyhint="done">
  </div>
  <div class="lock" id="lock"><span class="po" id="lockPo"></span><button id="chg">change</button></div>
  <button id="camBtn"><span class="big">&#128247;</span>Take photo</button>
  <input id="camIn" type="file" accept="image/*" capture="environment" style="display:none">
  <div id="shots"></div>
  <div id="err"></div>
  <button id="send" disabled>Send 0 photos</button>
  <div id="ok"><div class="mark">&#9989;</div><p id="okTxt"></p><button id="more">Send more</button></div>
</main>
<script>
  var TOKEN = ${JSON.stringify(token)};
  var files = [], po = '';
  var $ = function (id) { return document.getElementById(id); };
  function lock(v) {
    po = v;
    $('pick').style.display = 'none';
    $('lock').classList.add('on'); $('lockPo').textContent = v;
    $('camBtn').classList.add('on'); $('send').classList.add('on');
    sync();
  }
  function unlock() {
    po = ''; files = []; $('shots').innerHTML = '';
    $('pick').style.display = 'block'; $('ok').classList.remove('on');
    $('lock').classList.remove('on'); $('camBtn').classList.remove('on'); $('send').classList.remove('on');
  }
  function sync() {
    $('send').disabled = !files.length || !po;
    $('send').textContent = 'Send ' + files.length + ' photo' + (files.length === 1 ? '' : 's');
  }
  document.addEventListener('click', function (e) {
    var c = e.target.closest('.chip');
    if (c) lock(c.dataset.po);
  });
  $('typeLink').addEventListener('click', function () { $('poIn').classList.add('on'); $('poIn').focus(); });
  $('poIn').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.value.trim()) lock(e.target.value.trim().replace(/[^A-Za-z0-9_-]/g, ''));
  });
  $('chg').addEventListener('click', unlock);
  $('camBtn').addEventListener('click', function () { $('camIn').click(); });
  $('camIn').addEventListener('change', function () {
    var f = $('camIn').files[0];
    if (!f) return;
    files.push(f);
    var img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    $('shots').appendChild(img);
    $('camIn').value = '';
    sync();
  });
  $('send').addEventListener('click', async function () {
    $('send').disabled = true; $('err').style.display = 'none';
    var sent = 0;
    for (var i = 0; i < files.length; i++) {
      $('send').textContent = 'Sending ' + (i + 1) + ' of ' + files.length + '…';
      try {
        var res = await fetch('/photo?t=' + encodeURIComponent(TOKEN) + '&po=' + encodeURIComponent(po), { method: 'POST', body: files[i] });
        var j = await res.json();
        if (!j.ok) throw new Error(j.error || 'upload failed');
        sent++;
      } catch (err) {
        $('err').textContent = 'Upload failed after ' + sent + ' photo' + (sent === 1 ? '' : 's') + ': ' + err.message + ' — check the Wi-Fi and try again.';
        $('err').style.display = 'block';
        files = files.slice(i); sync();
        return;
      }
    }
    var done = po;
    files = []; $('shots').innerHTML = '';
    $('camBtn').classList.remove('on'); $('send').classList.remove('on'); $('lock').classList.remove('on');
    $('okTxt').textContent = sent + ' photo' + (sent === 1 ? '' : 's') + ' sent for ' + done;
    $('ok').classList.add('on');
  });
  $('more').addEventListener('click', unlock);
  ${po ? `lock(${JSON.stringify(po)});` : ''}
</script></body></html>`;
}

const expiredPage = '<!DOCTYPE html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="font-family:sans-serif;padding:40px 20px;text-align:center;color:#2f3437"><h3>This QR code has expired</h3><p style="color:#6b6f76">Open Upload Photos in Capture Station and scan the new one.</p></body>';

/* ---------- the LISTING photos phone page (eBay lister) ---------- */
// Capture ONLY: shoot, tap a thumbnail to drop a bad shot, send. All editing
// happens in the app's photo editor on the PC.

function listingPage(token, sku) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Listing Photos</title>
<style>
  * { box-sizing: border-box; margin: 0; -webkit-tap-highlight-color: transparent; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: #f7f7f5; color: #2f3437; min-height: 100vh; display: flex; flex-direction: column; }
  header { background: #047857; color: #fff; padding: 12px 16px 10px; }
  header .t { font-weight: 600; font-size: 16px; }
  header .sku { font-family: ui-monospace, Menlo, monospace; font-size: 11px; opacity: .85; }
  main { flex: 1; padding: 14px; display: flex; flex-direction: column; gap: 10px; max-width: 480px; width: 100%; margin: 0 auto; }
  #camBtn { border: 2px dashed #047857; border-radius: 14px; background: #ecf5f0; color: #047857; font-size: 16px; font-weight: 600; padding: 24px 12px; text-align: center; cursor: pointer; }
  #grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  #grid img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 10px; border: 1px solid #e0e0dd; }
  .hint { font-size: 11px; color: #9b9a97; text-align: center; }
  #send { margin-top: auto; background: #047857; color: #fff; border: none; border-radius: 12px; font-size: 17px; font-weight: 600; padding: 15px; cursor: pointer; }
  #send:disabled { opacity: .4; }
  #ok { display: none; text-align: center; padding: 30px 10px; }
  #ok.on { display: block; }
  #ok .mark { font-size: 44px; }
  #ok button { margin-top: 18px; background: #047857; color: #fff; border: none; border-radius: 12px; font-size: 15px; font-weight: 600; padding: 12px 22px; cursor: pointer; }
  #err { display: none; background: #fdecec; color: #b91c1c; border-radius: 10px; padding: 10px 12px; font-size: 13px; }
</style></head><body>
<header><div class="t">Listing Photos</div><div class="sku">${sku}</div></header>
<main>
  <div id="camBtn">&#128247; Take photo</div>
  <input id="camIn" type="file" accept="image/*" capture="environment" style="display:none">
  <div id="grid"></div>
  <div class="hint">tap a photo to remove it &mdash; editing happens on the PC</div>
  <div id="err"></div>
  <button id="send" disabled>Send 0 photos to the draft</button>
  <div id="ok"><div class="mark">&#9989;</div><p id="okTxt"></p><button id="more">Shoot more</button></div>
</main>
<script>
  var TOKEN = ${JSON.stringify(token)}, SKU = ${JSON.stringify(sku)};
  var files = [];
  var $ = function (id) { return document.getElementById(id); };
  function sync() {
    $('grid').innerHTML = '';
    files.forEach(function (f, i) {
      var img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      img.dataset.i = i;
      $('grid').appendChild(img);
    });
    $('send').disabled = !files.length;
    $('send').textContent = 'Send ' + files.length + ' photo' + (files.length === 1 ? '' : 's') + ' to the draft';
  }
  $('camBtn').addEventListener('click', function () { $('camIn').click(); });
  $('camIn').addEventListener('change', function () {
    if ($('camIn').files[0]) files.push($('camIn').files[0]);
    $('camIn').value = '';
    sync();
  });
  $('grid').addEventListener('click', function (e) {
    if (e.target.dataset.i !== undefined) { files.splice(+e.target.dataset.i, 1); sync(); }
  });
  $('send').addEventListener('click', async function () {
    $('send').disabled = true; $('err').style.display = 'none';
    var sent = 0;
    for (var i = 0; i < files.length; i++) {
      $('send').textContent = 'Sending ' + (i + 1) + ' of ' + files.length + '\\u2026';
      try {
        var res = await fetch('/lphoto?t=' + encodeURIComponent(TOKEN) + '&sku=' + encodeURIComponent(SKU), { method: 'POST', body: files[i] });
        var j = await res.json();
        if (!j.ok) throw new Error(j.error || 'upload failed');
        sent++;
      } catch (err) {
        $('err').textContent = 'Upload failed after ' + sent + ': ' + err.message + ' \\u2014 check the Wi-Fi and try again.';
        $('err').style.display = 'block';
        files = files.slice(i); sync();
        return;
      }
    }
    files = []; sync();
    $('okTxt').textContent = sent + ' photo' + (sent === 1 ? '' : 's') + ' in the draft';
    $('ok').classList.add('on');
  });
  $('more').addEventListener('click', function () { $('ok').classList.remove('on'); });
  sync();
</script></body></html>`;
}

/* ---------- server ---------- */

// opts: { dir, port (0 = ephemeral), listToday() -> [{po, sku, tm}],
//         onUpload({po, name, todayCount}),
//         listingDir, onListingUpload({sku, file}) }  <- eBay lister capture
function start(opts) {
  const dir = opts.dir;
  fs.mkdirSync(dir, { recursive: true });
  const listingDir = opts.listingDir || '';
  if (listingDir) fs.mkdirSync(listingDir, { recursive: true });
  const sweepListings = () => {
    if (!listingDir) return;
    // per-SKU subfolders; drafts are exported within days — 14-day shelf
    try {
      for (const sub of fs.readdirSync(listingDir)) {
        const d = path.join(listingDir, sub);
        try {
          if (!fs.statSync(d).isDirectory()) continue;
          const cutoff = Date.now() - 14 * 86400000;
          for (const n of fs.readdirSync(d)) {
            const f = path.join(d, n);
            if (fs.statSync(f).mtimeMs < cutoff) fs.unlinkSync(f);
          }
          if (!fs.readdirSync(d).length) fs.rmdirSync(d);
        } catch { /* per-folder best effort */ }
      }
    } catch { /* sweep is best effort */ }
  };
  const removed = cleanupOld(dir);
  sweepListings();
  // the shelf life must hold even if the app stays open for days: re-sweep
  // every 6 hours, not only at startup
  const sweeper = setInterval(() => { cleanupOld(dir); sweepListings(); }, 6 * 3600 * 1000);
  const token = crypto.randomBytes(12).toString('base64url'); // rotates every app session
  const listToday = opts.listToday || (() => []);

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const t = u.searchParams.get('t');

    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/up')) {
      if (!tokenOk(token, t)) { res.writeHead(403, { 'Content-Type': 'text/html' }); res.end(expiredPage); return; }
      let pos = [];
      try { pos = listToday(); } catch { /* chips are a convenience, not a dependency */ }
      const po = sanitizePo(u.searchParams.get('po'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(phonePage(token, po, pos));
      return;
    }

    // eBay lister capture page: QR carries the draft's SKU, phone just shoots
    if (req.method === 'GET' && u.pathname === '/lup') {
      if (!tokenOk(token, t)) { res.writeHead(403, { 'Content-Type': 'text/html' }); res.end(expiredPage); return; }
      const sku = sanitizePo(u.searchParams.get('sku'));
      if (!sku || !listingDir) { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('missing sku'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(listingPage(token, sku));
      return;
    }

    if (req.method === 'POST' && u.pathname === '/lphoto') {
      if (!tokenOk(token, t)) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"expired"}'); return; }
      const sku = sanitizePo(u.searchParams.get('sku'));
      if (!sku || !listingDir) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"missing sku"}'); return; }
      const chunks = [];
      let size = 0, dead = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) { dead = true; res.writeHead(413, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"photo too large"}'); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (dead) return;
        let buf = Buffer.concat(chunks);
        let ext = magicExt(buf);
        if (!ext) { res.writeHead(415, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"not an image"}'); return; }
        if (ext !== '.png') {
          const png = toPng(buf);
          if (png) { buf = png; ext = '.png'; }
        }
        const skuDir = path.join(listingDir, sku);
        try {
          fs.mkdirSync(skuDir, { recursive: true });
          const name = `${sku}_${nextIndex(skuDir, sku)}${ext}`;
          const file = path.join(skuDir, name);
          fs.writeFileSync(file, buf);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, name }));
          if (opts.onListingUpload) { try { opts.onListingUpload({ sku, file }); } catch { /* best effort */ } }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    if (req.method === 'POST' && u.pathname === '/photo') {
      if (!tokenOk(token, t)) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"expired"}'); return; }
      const po = sanitizePo(u.searchParams.get('po'));
      if (!po) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"missing PO"}'); return; }
      const chunks = [];
      let size = 0, dead = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) { dead = true; res.writeHead(413, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"photo too large"}'); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (dead) return;
        let buf = Buffer.concat(chunks);
        let ext = magicExt(buf);
        if (!ext) { res.writeHead(415, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"not an image"}'); return; }
        // owner wants uniform PNGs in the folder: re-encode whatever the
        // phone sent (JPEG, usually). Formats Electron can't decode (HEIC)
        // keep their real extension rather than being lost.
        if (ext !== '.png') {
          const png = toPng(buf);
          if (png) { buf = png; ext = '.png'; }
        }
        const name = `${po}_${stamp(new Date())}_${nextIndex(dir, po)}${ext}`;
        try {
          fs.writeFileSync(path.join(dir, name), buf);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, name }));
        if (opts.onUpload) { try { opts.onUpload({ po, name, todayCount: todayCount(dir) }); } catch { /* notify is best-effort */ } }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(opts.port ?? 0, '0.0.0.0', () => {
      const port = server.address().port;
      resolve({
        server, token, port, dir, removed, listingDir,
        url: `http://${lanIp()}:${port}/up?t=${token}`,
        listingUrl: (sku) => `http://${lanIp()}:${port}/lup?t=${token}&sku=${encodeURIComponent(sanitizePo(sku))}`,
        todayCount: () => todayCount(dir),
        close: () => { clearInterval(sweeper); return new Promise((r) => server.close(r)); },
      });
    });
  });
}

module.exports = { start, _test: { sanitizePo, magicExt, nextIndex, cleanupOld, stamp, todayCount, jpegOrientation } };
