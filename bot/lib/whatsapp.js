// The bot's WhatsApp side: the spare number logged in as a linked device
// (like WhatsApp Web), through the Baileys library. The login is kept in
// data/whatsapp-auth, so restarts never need a new scan.
import fs from 'node:fs';
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';

const log = (...a) => console.log(new Date().toISOString(), '[whatsapp]', ...a);

// the message itself, whatever wrapper it came in
function innerMessage(msg) {
  let m = msg && msg.message;
  if (!m) return null;
  if (m.ephemeralMessage) m = m.ephemeralMessage.message || {};
  if (m.viewOnceMessage) m = m.viewOnceMessage.message || {};
  return m;
}

export function messageText(msg) {
  const m = innerMessage(msg);
  if (!m) return '';
  return m.conversation || (m.extendedTextMessage && m.extendedTextMessage.text) || '';
}

// who a message @mentions, and whose message it replies to
export function messageContext(msg) {
  const m = innerMessage(msg);
  const ci = (m && m.extendedTextMessage && m.extendedTextMessage.contextInfo) || {};
  return { mentioned: (ci.mentionedJid || []).map(String), quotedFrom: ci.participant ? String(ci.participant) : '' };
}

// every id WhatsApp gives the sender: the phone-number id and/or the
// privacy id (LID) newer groups use; either may be the one that is set
export function senderIds(msg) {
  const k = (msg && msg.key) || {};
  return [k.participant, k.participantAlt, k.remoteJid, k.remoteJidAlt]
    .filter(Boolean)
    .filter(j => !String(j).endsWith('@g.us'))
    .map(String);
}

export const digitsOf = (jid) => String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');

// a message meant for the assistant → the question in it, else null.
// Meant for it = @mentions the bot, replies to one of the bot's messages,
// or starts with "bot" or "?". Everything else is people talking.
export function addressedText(msg, text, meIds) {
  const mine = new Set(meIds.map(digitsOf).filter(Boolean));
  const { mentioned, quotedFrom } = messageContext(msg);
  const t = String(text || '').trim();
  if (mentioned.some(j => mine.has(digitsOf(j)))) return t.replace(/@\d+/g, '').trim();
  if (quotedFrom && mine.has(digitsOf(quotedFrom))) return t;
  const m = t.match(/^(?:hey\s+)?bot\b[\s,:!-]*([\s\S]*)$/i) || t.match(/^\?\s*([\s\S]+)$/);
  return m ? m[1].trim() : null;
}

export function senderAllowed(msg, allowedNumbers) {
  if (!allowedNumbers.length) return true;
  return senderIds(msg).some(j => allowedNumbers.includes(digitsOf(j)));
}

// onMessage(msg, text) for each new incoming text; resolves once connected
export async function startWhatsApp({ authDir, botPhone, onMessage, onLoggedOut, linkOnly = false }) {
  fs.mkdirSync(authDir, { recursive: true });
  let sock = null;
  let attempts = 0;
  let resolveOpen;
  const opened = new Promise(r => { resolveOpen = r; });

  const connect = async () => {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    // the current WhatsApp Web version; the library's built-in one stands in
    // when GitHub is slow or unreachable
    const { version } = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise(r => setTimeout(() => r({}), 10000).unref()),
    ]).catch(() => ({}));
    sock = makeWASocket({
      auth: state,
      version,
      logger: pino({ level: 'silent' }),
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
    });
    sock.ev.on('creds.update', saveCreds);
    let codeAsked = false;

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;
      if (qr && !state.creds.registered) {
        if (botPhone && !codeAsked) {
          codeAsked = true;
          try {
            const code = await sock.requestPairingCode(botPhone);
            console.log('\n  On the spare phone: WhatsApp → Settings → Linked devices → Link a device');
            console.log('  → "Link with phone number instead", then type this code:\n');
            console.log(`      ${code.slice(0, 4)}-${code.slice(4)}\n`);
          } catch (e) {
            log('could not get a pairing code:', e.message);
          }
        } else if (!botPhone) {
          console.log('\n  On the spare phone: WhatsApp → Settings → Linked devices → Link a device, and scan:\n');
          console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
        }
      }
      if (connection === 'open') {
        attempts = 0;
        log('connected as', sock.user && sock.user.id);
        resolveOpen(sock);
      }
      if (connection === 'close') {
        const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
          ? lastDisconnect.error.output.statusCode : 0;
        if (code === DisconnectReason.loggedOut) {
          log('logged out by WhatsApp. Link again: npm run link');
          if (onLoggedOut) await onLoggedOut();
          return;
        }
        if (linkOnly && state.creds.registered && code !== DisconnectReason.restartRequired) return;
        // restartRequired comes right after linking; anything else is a
        // dropped line - back off up to 5 minutes between tries
        const wait = code === DisconnectReason.restartRequired ? 0 : Math.min(300000, 5000 * 2 ** attempts++);
        log(`connection closed (${code || 'no code'}), reconnecting in ${Math.round(wait / 1000)}s`);
        setTimeout(() => connect().catch(e => log('reconnect failed:', e.message)), wait);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || !onMessage) return;
      for (const msg of messages) {
        if (!msg.key || msg.key.fromMe) continue;
        const text = messageText(msg);
        if (!text) continue;
        try { await onMessage(msg, text); } catch (e) { log('message handler failed:', e.message); }
      }
    });
  };

  await connect();
  await opened;
  return {
    send: (jid, text) => sock.sendMessage(jid, { text }),
    // an answer shown as a reply to the question it answers
    reply: (jid, text, quoted) => sock.sendMessage(jid, { text }, quoted ? { quoted } : {}),
    typing: (jid, on) => sock.sendPresenceUpdate(on ? 'composing' : 'paused', jid).catch(() => {}),
    // the bot's own ids (phone-number id and privacy id), to spot @mentions
    me: () => [sock.user && sock.user.id, sock.user && sock.user.lid].filter(Boolean).map(String),
    groups: async () => Object.values(await sock.groupFetchAllParticipating()),
    close: () => { try { sock.end(undefined); } catch { /* already closed */ } },
  };
}
