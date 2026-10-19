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
import { DriveCosts } from './lib/drive.js';
import { startWhatsApp, senderAllowed, senderIds, addressedText, digitsOf } from './lib/whatsapp.js';
import { Assistant } from './lib/assistant.js';
import {
  shoppingList, formatShoppingList, formatOutAlert, formatStock, formatHistory, settledBought,
  lastPaidPrices, parseCommand, matchSku, isConditionSku, HELP_TEXT,
} from './lib/report.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const LINNWORKS_DOWN_NOTICE_MS = 60 * 60 * 1000;
const MAX_PURCHASES = 5000;

// DWS Stock's costs from the shared Drive folder, when it is set up
function driveCosts(cfg) {
  if (!cfg.googleKeyFile && !cfg.driveFolderId) return null;
  if (!cfg.googleKeyFile || !cfg.driveFolderId) throw new Error('Set both GOOGLE_KEY_FILE and DRIVE_FOLDER_ID in bot/.env (or neither).');
  return new DriveCosts({ keyFile: cfg.googleKeyFile, folderId: cfg.driveFolderId });
}

const cfg = loadConfig();
const mode = process.argv.includes('--link') ? 'link' : process.argv.includes('--preview') ? 'preview' : 'run';

if (mode === 'preview') {
  requireLinnworks(cfg);
  const data = new SalesData(cfg);
  log('reading stock and 30 days of sales from Linnworks (the first time takes a few minutes)…');
  const rows = await data.refresh();
  const state = new State(cfg.dataDir);
  const drive = driveCosts(cfg);
  if (drive) {
    log(`reading DWS Stock costs from Drive as ${drive.email}…`);
    await drive.refresh();
  }
  console.log(`\nLocation: ${data.locationName} · ${rows.length} SKUs${drive ? ` · ${drive.costs.size} costs from Drive` : ''}\n`);
  const prices = lastPaidPrices(drive ? drive.costs : new Map(), state.get('purchases'));
  console.log(formatShoppingList(shoppingList(rows, state.get('bought')), { leadDays: cfg.leadDays, prices }));
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
  const drive = driveCosts(cfg);
  let failingSince = 0;
  let lastError = '';
  let costsError = '';

  // costs are a bonus: a failed read keeps the last ones and never stops
  // the stock checks
  const refreshCosts = async () => {
    if (!drive) return;
    try { await drive.refresh(); costsError = ''; } catch (e) { costsError = e.message; log('costs read failed:', e.message); }
  };
  const prices = () => lastPaidPrices(drive ? drive.costs : new Map(), state.get('purchases'));

  // plain-language questions, when an Anthropic key is set
  const assistant = cfg.ai.enabled ? new Assistant({
    model: cfg.ai.model, effort: cfg.ai.effort, dailyLimit: cfg.ai.dailyLimit,
    getContext: () => ({
      rows: data.rows || [], days: data.days || [], dataAt: data.at,
      purchases: state.get('purchases'), bought: state.get('bought'), prices: prices(),
    }),
    log: (m) => log('[ai]', m),
  }) : null;
  const nameOf = (msg) => {
    for (const id of senderIds(msg)) { const n = cfg.names[digitsOf(id)]; if (n) return n; }
    return '';
  };

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
      await refreshCosts();
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
    if (await post(formatShoppingList(currentList(), { leadDays: cfg.leadDays, dataAt: data.at, prices: prices() }))) {
      state.set({ lastDailyDay: localDay() });
      log('evening list posted');
    }
  };

  async function handleMessage(msg, text) {
    const chat = msg.key.remoteJid || '';
    const command = parseCommand(text);
    const reply = (t) => wa.send(chat, t);
    const allowed = senderAllowed(msg, cfg.allowedNumbers);
    if (!command) {
      // not a command: a question for the assistant, or people talking
      if (!assistant || !allowed || chat !== state.get('groupJid')) return;
      const question = addressedText(msg, text, wa.me());
      if (question === null) return;
      if (!question) { await wa.reply(chat, 'Yes? Ask me about stock, sales, purchases or prices.', msg); return; }
      if (!data.rows) { await wa.reply(chat, 'Still reading Linnworks — ask me again in a minute.', msg); return; }
      await wa.typing(chat, true);
      const answer = await assistant.ask(chat, question, { who: nameOf(msg) });
      await wa.typing(chat, false);
      await wa.reply(chat, answer, msg);
      return;
    }

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
        !drive ? 'Prices: from "bought … @ price" notes only (Drive costs not set up)'
          : costsError ? `⚠️ Drive costs: ${costsError.slice(0, 200)}`
            : `Prices: ${drive.costs.size} costs from DWS Stock, read ${Math.round((Date.now() - drive.at) / 60000)} min ago`,
        `Evening list: ${cfg.dailyTime} · open purchase notes: ${Object.keys(state.get('bought')).length}`,
        assistant ? `Questions today: ${assistant.today().questions} of ${cfg.ai.dailyLimit} (≈ $${assistant.costToday().toFixed(2)}, ${cfg.ai.model})` : 'Questions: off (no ANTHROPIC_API_KEY)',
      ].join('\n'));
      return;
    }
    if (!data.rows) { await reply('Still reading Linnworks — try again in a minute.'); return; }
    if (Date.now() - data.at > 5 * 60000) await data.refresh().catch(() => {});

    if (command.cmd === 'list') { await reply(formatShoppingList(currentList(), { leadDays: cfg.leadDays, dataAt: data.at, prices: prices() })); return; }

    if (command.cmd === 'cancel') {
      // takes back the last purchase noted for a SKU (a typo, a wrong qty)
      const bought = { ...state.get('bought') };
      const purchases = [...state.get('purchases')];
      const q = command.sku.toUpperCase();
      const skus = [...new Set([...Object.keys(bought), ...purchases.map(p => String(p.sku).toUpperCase())])];
      const hits = skus.includes(q) ? [q] : skus.filter(k => k.includes(q));
      if (hits.length !== 1) { await reply(hits.length ? `"${command.sku}" matches ${hits.slice(0, 8).join(', ')} — which one?` : `No purchase note matches "${command.sku}".`); return; }
      const key = hits[0];
      let i = purchases.length - 1;
      while (i >= 0 && String(purchases[i].sku).toUpperCase() !== key) i--;
      const gone = i >= 0 ? purchases.splice(i, 1)[0] : null;
      delete bought[key];
      state.set({ bought, purchases });
      await reply(`🗑️ Removed the last purchase note for ${key}${gone ? ` (${gone.qty}${gone.price ? ` @ $${gone.price}` : ''}, ${new Date(gone.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})` : ''}.`);
      return;
    }

    const hit = matchSku(data.rows, command.sku);
    if (hit.error) { await reply(hit.error); return; }
    const r = hit.row;
    const key = String(r.sku).toUpperCase();

    if (command.cmd === 'stock') { await reply(formatStock(r, state.get('bought')[key], prices().get(key))); return; }
    if (command.cmd === 'history') { await reply(formatHistory(r, state.get('purchases'), prices().get(key))); return; }

    if (command.cmd === 'bought') {
      const at = new Date().toISOString();
      const by = nameOf(msg) || senderIds(msg)[0] || '';
      const bought = { ...state.get('bought') };
      // a second buy before the first arrives adds up
      const prev = bought[key];
      bought[key] = {
        sku: r.sku, title: r.title, qty: command.qty + (prev ? prev.qty : 0), price: command.price ?? (prev ? prev.price : null),
        at, onHandAt: prev ? prev.onHandAt : r.onHand, by,
      };
      const purchases = [...state.get('purchases'), { sku: r.sku, title: r.title, qty: command.qty, price: command.price, vendor: command.vendor, at, by }];
      state.set({ bought, purchases: purchases.slice(-MAX_PURCHASES) });
      const left = Math.max(0, (Number(r.order) || 0) - bought[key].qty);
      await reply(`✅ Noted: ${command.qty} × ${r.sku}${command.price ? ` @ $${command.price}` : ''}${command.vendor ? ` from ${command.vendor}` : ''}. ${left ? `Still short by ${left}.` : "It's off the list until it arrives."}`);
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
