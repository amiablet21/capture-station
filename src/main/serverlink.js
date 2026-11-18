'use strict';
// This computer's connection to the office server (owner 2026-11-18: "how
// can I set up the other computers?"). Settings › General › Shared server
// takes the server's address and a person's own login; the server answers
// with a token that is kept encrypted on this computer and used from then
// on, so the password is typed once and never stored.
//
// This is the connection only. Which pages read and write through it comes
// one page at a time; until then every page still shares through the Drive
// folder, signed in or not.

let cfgApi = null;       // { get: () => ({ url, token, username }), set: (patch) => void }
let stationName = () => '';
let onChange = () => {};
let state = { online: false, error: '', user: null, checkedAt: 0 };
let timer = null;

// "office-pc:8790", "http://OFFICE-PC:8790/" and "192.168.1.50" all mean a server
function cleanUrl(raw) {
  let s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    if (!u.port && u.protocol === 'http:') u.port = '8790';
    return `${u.protocol}//${u.host}`;
  } catch { return ''; }
}

async function call(method, pathname, { url, token, body, timeout = 8000 } = {}) {
  const link = cfgApi.get();
  const base = url || link.url;
  const headers = { 'Content-Type': 'application/json' };
  const tok = token === undefined ? link.token : token;
  if (tok) headers.Authorization = `Bearer ${tok}`;
  let res;
  try {
    res = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  } catch {
    return { status: 0, json: {}, error: `No answer from ${base}. Is DWS Stock open on the server computer, and is this computer on the office network?` };
  }
  let json = {};
  try { json = await res.json(); } catch { /* an empty answer */ }
  return { status: res.status, json, error: res.ok ? '' : (json.error || `The server answered ${res.status}.`) };
}

function set(patch) {
  const was = JSON.stringify(state);
  state = { ...state, ...patch, checkedAt: Date.now() };
  if (JSON.stringify({ ...state, checkedAt: 0 }) !== JSON.stringify({ ...JSON.parse(was), checkedAt: 0 })) { try { onChange(status()); } catch { /* window gone */ } }
}

function status() {
  const link = cfgApi ? cfgApi.get() : { url: '', token: '', username: '' };
  return {
    ok: true, url: link.url || '', username: link.username || '', signedIn: !!(link.url && link.token),
    online: state.online, error: state.error,
    name: state.user ? state.user.name : '', role: state.user ? state.user.roleLabel : '', perms: state.user ? state.user.perms : [],
  };
}

// is the server there, and is this computer's sign-in still good?
async function refresh() {
  const link = cfgApi.get();
  if (!link.url || !link.token) { set({ online: false, error: '', user: null }); return status(); }
  const r = await call('GET', '/api/me');
  if (r.status === 200) set({ online: true, error: '', user: r.json.user });
  else if (r.status === 401) {
    // the login was switched off, or its password changed: sign in again
    cfgApi.set({ token: '' });
    set({ online: false, user: null, error: 'This computer was signed out by the server. Sign in again.' });
  } else set({ online: false, error: r.error });
  return status();
}

async function signIn({ url, username, password } = {}) {
  const base = cleanUrl(url);
  if (!base) return { ok: false, error: 'Type the server address, for example OFFICE-PC:8790.' };
  if (!String(username || '').trim() || !password) return { ok: false, error: 'Type the username and the password.' };
  const r = await call('POST', '/api/login', { url: base, token: '', body: { username: String(username).trim(), password: String(password), station: stationName() } });
  if (r.status !== 200 || !r.json.token) return { ok: false, error: r.error || 'That did not work.' };
  cfgApi.set({ url: base, token: r.json.token, username: r.json.user.username });
  set({ online: true, error: '', user: r.json.user });
  return status();
}

async function signOut() {
  const link = cfgApi.get();
  if (link.url && link.token) await call('POST', '/api/logout', { timeout: 3000 });
  cfgApi.set({ token: '' });
  set({ online: false, error: '', user: null });
  return status();
}

// boot: check now, then keep an eye on it (a server computer restarts, a
// laptop comes back to the office)
function start({ config, station, changed }) {
  cfgApi = config;
  stationName = station || stationName;
  onChange = changed || onChange;
  clearInterval(timer);
  refresh();
  timer = setInterval(refresh, 30 * 1000);
  if (timer.unref) timer.unref();
}
function stop() { clearInterval(timer); timer = null; }

module.exports = { start, stop, status, refresh, signIn, signOut, call, cleanUrl };
