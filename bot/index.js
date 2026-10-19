// DWS Stock WhatsApp bot: posts the shopping list to the group every
// evening, posts right away when a fast seller sells out, and answers
// list / stock / bought / cancel / status from the people allowed to ask.
//
//   node index.js            run the bot (the service does this)
//   node index.js --link     link the spare number once, then exit
//   node index.js --preview  print the shopping list from Linnworks, no WhatsApp
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, requireLinnworks } from './lib/config.js';
import { State } from './lib/state.js';
import { SalesData } from './lib/data.js';
import { startWhatsApp, senderAllowed, senderIds } from './lib/whatsapp.js';
import {
  shoppingList, formatShoppingList, formatOutAlert, formatStock, settledBought,
  parseCommand, matchSku, isConditionSku, HELP_TEXT,
} from './lib/report.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const LINNWORKS_DOWN_NOTICE_MS = 60 * 60 * 1000;

const cfg = loadConfig();
const mode = process.argv.includes('--link') ? 'link' : process.argv.includes('--preview') ? 'preview' : 'run';

if (mode === 'preview') {
  requireLinnworks(cfg);
  const data = new SalesData(cfg);
  log('reading stock and 30 days of sales from Linnworks (the first time takes a few minutes)…');
  const rows = await data.refresh();
  const state = new State(cfg.dataDir);
  console.log(`\nLocation: ${data.locationName} · ${rows.length} SKUs\n`);
  console.log(formatShoppingList(shoppingList(rows, state.get('bought')), { leadDays: cfg.leadDays }));
  process.exit(0);
}

if (mode === 'link') {
  const wa = await startWhatsApp({ authDir: cfg.authDir, botPhone: cfg.botPhone, linkOnly: true });
  log('linked. Start the service now (see SETUP.md).');
  wa.close();
  setTimeout(() => process.exit(0), 1500);
} else {
  await run();
}

async function run() {
  requireLinnworks(cfg);
  // without a list, anyone who added the bot to a group could redirect it
  if (!cfg.allowedNumbers.length) throw new Error('Set ALLOWED_NUMBERS in bot/.env (your number and your dad\'s, with country code).');
  if (!fs.existsSync(path.join(cfg.authDir, 'creds.json'))) throw new Error('WhatsApp is not linked yet. Run: npm run link');
  const state = new State(cfg.dataDir);
  const data = new SalesData(cfg);
  let failingSince = 0;
  let lastError = '';

  const notifyWebhook = async (body) => {
    if (!/^https:\/\//i.test(cfg.alertWebhookUrl)) return;
    try {
      await fetch(cfg.alertWebhookUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, at: new Date().toISOString() }), signal: AbortSignal.timeout(10000),
      });
    } catch (e) { log('alert webhook failed:', e.message); }
  };

  const wa = await startWhatsApp({
    authDir: cfg.authDir,
    botPhone: cfg.botPhone,
    onMessage: (msg, text) => handleMessage(msg, text),
    onLoggedOut: async () => {
      // set the dead login aside: the service then stops at "not linked
      // yet" on each restart instead of looping (and re-alerting) forever
      try { fs.renameSync(cfg.authDir, `${cfg.authDir}.logged-out-${Date.now()}`); } catch (e) { log('could not set the old login aside:', e.message); }
      await notifyWebhook({ type: 'whatsapp-logged-out', text: 'The DWS Stock bot was logged out of WhatsApp. Link it again: npm run link' });
      process.exit(1);
    },
  });

  // a failed send is logged, never thrown: one bad post must not stop the
  // checks or be mistaken for a Linnworks failure
  const post = async (text) => {
    const jid = state.get('groupJid');
    if (!jid) { log('no group yet — send "setup" in the group'); return false; }
    try { await wa.send(jid, text); return true; } catch (e) { log('post failed:', e.message); return false; }
  };

  // drop settled "bought" notes, then the list with what is left
  const currentList = () => {
    const bought = { ...state.get('bought') };
    const done = settledBought(data.rows, bought, { maxDays: cfg.boughtDays });
    if (done.length) {
      for (const k of done) delete bought[k];
      state.set({ bought });
      log('purchase notes settled:', done.join(', '));
    }
    return shoppingList(data.rows, bought);
  };

  // fast sellers that hit zero since the last check: one message, once per
  // sell-out (back in stock re-arms it)
  const checkSellOuts = async () => {
    const alerted = { ...state.get('alertedOut') };
    const bought = state.get('bought');
    const fresh = [];
    for (const r of data.rows) {
      const k = String(r.sku).toUpperCase();
      if (r.onHand > 0) { delete alerted[k]; continue; }
      if (r.status !== 'Out of stock' || alerted[k] || isConditionSku(r.sku)) continue;
      alerted[k] = new Date().toISOString();
      if (r.perDay >= cfg.hotPerDay && !bought[k]) fresh.push(r);
    }
    // the very first check only takes note of what is already out (the
    // evening list covers those); announcing them all would be noise
    if (!state.get('primed')) { state.set({ alertedOut: alerted, primed: true }); return; }
    state.set({ alertedOut: alerted });
    if (fresh.length) await post(formatOutAlert(fresh));
  };

  const check = async () => {
    try {
      await data.refresh();
      if (failingSince && state.get('linnworksDownNotified')) await post('✅ Linnworks is reachable again.');
      failingSince = 0; lastError = '';
      state.set({ linnworksDownNotified: false });
      await checkSellOuts();
    } catch (e) {
      lastError = e.message;
      log('check failed:', e.message);
      if (!failingSince) failingSince = Date.now();
      if (Date.now() - failingSince > LINNWORKS_DOWN_NOTICE_MS && !state.get('linnworksDownNotified')) {
        state.set({ linnworksDownNotified: true });
        await post(`⚠️ I can't reach Linnworks since ${new Date(failingSince).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}: ${e.message.slice(0, 200)}`);
      }
    }
  };

  // the evening list: once a day, at DAILY_TIME or the first minute after
  // it the bot is up
  const dailyDue = () => {
    const now = new Date();
    const [h, m] = cfg.dailyTime.split(':').map(Number);
    return now.getHours() * 60 + now.getMinutes() >= h * 60 + m && state.get('lastDailyDay') !== localDay(now);
  };
  let tickTriedAt = 0;
  const tick = async () => {
    if (!dailyDue() || !state.get('groupJid')) return;
    // fresh figures for the list; while Linnworks fails, try every 10 min
    if (Date.now() - data.at > 10 * 60000) {
      if (Date.now() - tickTriedAt < 10 * 60000) return;
      tickTriedAt = Date.now();
      await data.refresh().catch(e => log('refresh before the list failed:', e.message));
    }
    if (!data.rows) return; // never read Linnworks yet: the next try posts it
    if (await post(formatShoppingList(currentList(), { leadDays: cfg.leadDays, dataAt: data.at }))) {
      state.set({ lastDailyDay: localDay() });
      log('evening list posted');
    }
  };

  async function handleMessage(msg, text) {
    const chat = msg.key.remoteJid || '';
    const command = parseCommand(text);
    if (!command) return;
    const reply = (t) => wa.send(chat, t);
    const allowed = senderAllowed(msg, cfg.allowedNumbers);

    // whoami answers anyone, anywhere: it is how you find the number to
    // put in ALLOWED_NUMBERS
    if (command.cmd === 'whoami') { await reply(`You are: ${senderIds(msg).join(', ')}`); return; }
    if (!allowed) { log('ignored a message from', senderIds(msg).join(', ')); return; }

    if (command.cmd === 'setup') {
      if (!chat.endsWith('@g.us')) { await reply('Send *setup* inside the group you want me to post in.'); return; }
      state.set({ groupJid: chat });
      log('group set:', chat);
      await reply(`👋 I'll post the shopping list here every evening at ${cfg.dailyTime}, and right away when a fast seller sells out.\n\n${HELP_TEXT}`);
      return;
    }
    // everything else only in the group
    if (chat !== state.get('groupJid')) return;
    if (command.error) { await reply(command.error); return; }
    if (command.cmd === 'help') { await reply(HELP_TEXT); return; }
    if (command.cmd === 'status') {
      const age = data.at ? Math.round((Date.now() - data.at) / 60000) : null;
      await reply([
        '🤖 *Bot status*',
        age === null ? 'Not read Linnworks yet' : `Last Linnworks check: ${age} min ago (${data.rows.length} SKUs, ${data.locationName})`,
        lastError ? `⚠️ Last error: ${lastError.slice(0, 200)}` : '✅ No errors',
        `Evening list: ${cfg.dailyTime} · purchase notes: ${Object.keys(state.get('bought')).length}`,
      ].join('\n'));
      return;
    }
    if (!data.rows) { await reply('Still reading Linnworks — try again in a minute.'); return; }
    if (Date.now() - data.at > 5 * 60000) await data.refresh().catch(() => {});

    if (command.cmd === 'list') { await reply(formatShoppingList(currentList(), { leadDays: cfg.leadDays, dataAt: data.at })); return; }

    if (command.cmd === 'cancel') {
      const bought = { ...state.get('bought') };
      const q = command.sku.toUpperCase();
      const hits = bought[q] ? [q] : Object.keys(bought).filter(k => k.includes(q));
      if (hits.length !== 1) { await reply(hits.length ? `"${command.sku}" matches ${hits.join(', ')} — which one?` : `No purchase note matches "${command.sku}".`); return; }
      const key = hits[0];
      delete bought[key];
      state.set({ bought });
      await reply(`🗑️ Removed the purchase note for ${key}.`);
      return;
    }

    const hit = matchSku(data.rows, command.sku);
    if (hit.error) { await reply(hit.error); return; }
    const r = hit.row;
    const key = String(r.sku).toUpperCase();

    if (command.cmd === 'stock') { await reply(formatStock(r, state.get('bought')[key])); return; }

    if (command.cmd === 'bought') {
      const bought = { ...state.get('bought') };
      bought[key] = {
        sku: r.sku, title: r.title, qty: command.qty, price: command.price,
        at: new Date().toISOString(), onHandAt: r.onHand, by: senderIds(msg)[0] || '',
      };
      state.set({ bought });
      const left = Math.max(0, (Number(r.order) || 0) - command.qty);
      await reply(`✅ Noted: ${command.qty} × ${r.sku}${command.price ? ` @ $${command.price}` : ''}. ${left ? `Still short by ${left}.` : "It's off the list until it arrives."}`);
    }
  }

  await check();
  log(`running: checks every ${cfg.checkMinutes} min, evening list at ${cfg.dailyTime} (${process.env.TZ || 'server time zone'})`);
  setInterval(check, cfg.checkMinutes * 60000);
  setInterval(() => tick().catch(e => log('evening list failed:', e.message)), 60000);
  tick().catch(e => log('evening list failed:', e.message));

  const stop = () => { log('stopping'); wa.close(); setTimeout(() => process.exit(0), 1000); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
