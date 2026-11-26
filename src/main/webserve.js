'use strict';
// Browser access (owner 2026-10-20): the whole app in a browser tab on this
// computer — every tab, every action — served by the running desktop app at
// http://localhost:<port>. The pages are the desktop's own files; the bridge
// the desktop window gets from preload.js is rebuilt in the browser on top of
// fetch (requests) and Server-Sent Events (live updates), so each button runs
// the very same handler the desktop window would.
//
// Safety, since a browser tab is open to the rest of the web:
//   - listens on 127.0.0.1 only: nothing else on the network can reach it
//   - the Host header must name localhost/127.0.0.1 on this port, which
//     defeats DNS-rebinding pages
//   - a private key, carried once in the link from Settings, becomes an
//     HttpOnly SameSite=Strict cookie; no cookie, nothing but a 401
//   - every request that does something must come from the page itself
//     (Origin check), so another site cannot fire actions at it
//   - frame-ancestors 'none': no other site can embed it

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');
const COOKIE = 'dws_web';
const MAX_BODY = 64 * 1024 * 1024; // a Walmart report CSV can be large
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon',
};

const newKey = () => crypto.randomBytes(24).toString('hex');

function sameKey(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function cookieOf(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return '';
}

// the bridge: preload.js run against a stand-in for Electron's renderer API
function bridgeSource() {
  const preload = fs.readFileSync(PRELOAD, 'utf8');
  return `(() => {
  const listeners = {};
  const events = new EventSource('/events');
  events.onmessage = (m) => {
    let msg; try { msg = JSON.parse(m.data); } catch { return; }
    for (const cb of listeners[msg.ch] || []) { try { cb({}, msg.data); } catch (e) { console.error(e); } }
  };
  async function invoke(ch, ...args) {
    const res = await fetch('/ipc/' + encodeURIComponent(ch), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args), credentials: 'same-origin',
    });
    const out = await res.json().catch(() => ({ error: 'The app answered ' + res.status }));
    if (out.error) throw new Error(out.error);
    return out.value;
  }
  let zoom = 1;
  const electron = {
    contextBridge: { exposeInMainWorld: (k, v) => { window[k] = v; } },
    ipcRenderer: { invoke, on: (ch, cb) => { (listeners[ch] = listeners[ch] || []).push(cb); } },
    // a browser never hands out a file's path on disk
    webUtils: { getPathForFile: () => '' },
    webFrame: { getZoomFactor: () => zoom, setZoomFactor: (z) => { zoom = z; document.documentElement.style.zoom = String(z); } },
  };
  const require = (m) => { if (m === 'electron') return electron; throw new Error('not available in the browser: ' + m); };
  window.__DWS_WEB__ = true;
${preload}
  // desktop-only pieces stay on the desktop: the docked marketplace browser
  // and pulling the desktop window to the front
  window.api.browserLayout = async () => ({ ok: true, visible: false });
  window.api.appFocus = async () => ({ ok: true });
})();
`;
}

function indexHtml() {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  // the page's own CSP allows only files from the page's origin, so the
  // browser-only bits come as files too
  const extra = '<script src="/web-bridge.js"></script><link rel="stylesheet" href="/web-bridge.css">';
  return html.replace('<script src="renderer.js"></script>', `${extra}<script src="renderer.js"></script>`);
}

const LOCKED = `<!doctype html><meta charset="utf-8"><title>DWS Stock</title>
<body style="font:15px system-ui;padding:40px;color:#2F3437">Open DWS Stock from the link in its Settings › General › Browser.</body>`;

function createServer({ port, getKey, handlers, eventTarget, labelPdf }) {
  const clients = new Set();
  const okHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const okOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  function send(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      ...headers,
    });
    res.end(body);
  }

  async function handle(req, res) {
    if (!okHosts.has(String(req.headers.host || '').toLowerCase())) return send(res, 403, 'Forbidden');
    const url = new URL(req.url, `http://localhost:${port}`);

    // the link from Settings: trade the key for the cookie, then a clean address
    if (req.method === 'GET' && url.searchParams.has('k')) {
      if (!sameKey(url.searchParams.get('k'), getKey())) return send(res, 401, LOCKED, MIME['.html']);
      return send(res, 302, '', 'text/plain', {
        Location: '/',
        'Set-Cookie': `${COOKIE}=${encodeURIComponent(getKey())}; HttpOnly; SameSite=Strict; Path=/`,
      });
    }
    if (!sameKey(cookieOf(req), getKey())) return send(res, 401, LOCKED, MIME['.html']);

    if (req.method === 'POST' && url.pathname.startsWith('/ipc/')) {
      if (!okOrigins.has(String(req.headers.origin || ''))) return send(res, 403, 'Forbidden');
      const channel = decodeURIComponent(url.pathname.slice(5));
      const fn = handlers.get(channel);
      if (!fn) return send(res, 404, JSON.stringify({ error: `Unknown action ${channel}` }), MIME['.json']);
      let raw = '';
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) return send(res, 413, JSON.stringify({ error: 'Too large' }), MIME['.json']);
        raw += chunk;
      }
      let args;
      try { args = JSON.parse(raw || '[]'); } catch { return send(res, 400, JSON.stringify({ error: 'Bad request' }), MIME['.json']); }
      if (!Array.isArray(args)) args = [args];
      try {
        const value = await fn({ sender: eventTarget(), web: true }, ...args);
        return send(res, 200, JSON.stringify({ value: value === undefined ? null : value }), MIME['.json']);
      } catch (e) {
        return send(res, 200, JSON.stringify({ error: (e && e.message) || String(e) }), MIME['.json']);
      }
    }

    if (req.method !== 'GET') return send(res, 405, 'Method not allowed');

    // an existing shipping label as a PDF download: /labels/<id>/pdf, or
    // /labels/pdf?tracking=… / ?po=… (owner 2026-10-20: the assistant that
    // answers Walmart messages attaches it). Behind the same key as the rest;
    // read-only — it never buys, voids or changes a label.
    const lm = url.pathname.match(/^\/labels\/(?:(\d+)\/)?pdf$/);
    if (lm) {
      if (typeof labelPdf !== 'function') return send(res, 404, JSON.stringify({ error: 'Labels are not available.' }), MIME['.json']);
      const q = lm[1] ? { id: Number(lm[1]) } : { tracking: url.searchParams.get('tracking') || '', po: url.searchParams.get('po') || '' };
      const out = await labelPdf(q);
      if (!out || !out.ok) return send(res, (out && out.status) || 500, JSON.stringify({ error: (out && out.error) || 'The PDF could not be made.' }), MIME['.json']);
      const name = String(out.filename || 'label.pdf').replace(/[^\w.-]+/g, '_');
      return send(res, 200, out.pdf, 'application/pdf', { 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': String(out.pdf.length) });
    }

    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
      res.write(': hello\n\n');
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return undefined;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, indexHtml(), MIME['.html']);
    if (url.pathname === '/web-bridge.js') return send(res, 200, bridgeSource(), MIME['.js']);
    // the docked marketplace browser lives in the desktop window only
    if (url.pathname === '/web-bridge.css') return send(res, 200, '#bExpand,#bDock,#bDivider{display:none!important}', MIME['.css']);

    // the renderer's own files, and nothing outside its folder
    const file = path.normalize(path.join(RENDERER, decodeURIComponent(url.pathname)));
    if (!file.startsWith(RENDERER + path.sep) || !MIME[path.extname(file)]) return send(res, 404, 'Not found');
    fs.readFile(file, (err, buf) => (err ? send(res, 404, 'Not found') : send(res, 200, buf, MIME[path.extname(file)])));
    return undefined;
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => { try { send(res, 500, String(e && e.message)); } catch { /* closed */ } });
  });

  return {
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    }),
    close: () => new Promise((resolve) => {
      for (const c of clients) { try { c.end(); } catch { /* gone */ } }
      clients.clear();
      server.close(() => resolve());
      server.closeAllConnections && server.closeAllConnections();
    }),
    // every event the desktop window gets, the browser tabs get too
    broadcast(channel, data) {
      if (!clients.size) return;
      let line;
      try { line = `data: ${JSON.stringify({ ch: channel, data })}\n\n`; } catch { return; }
      for (const c of clients) { try { c.write(line); } catch { /* gone */ } }
    },
  };
}

module.exports = { createServer, newKey };
