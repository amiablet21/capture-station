// Settings come from bot/.env (copy .env.example) or the environment.
// Secrets live only there — never in the code or the repository.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig() {
  const envFile = path.join(BOT_DIR, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const e = process.env;
  // TZ drives every "local day" (the sales window, the evening list);
  // assigning it is what makes Node pick it up after start
  if (e.TZ) process.env.TZ = e.TZ;
  const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const dataDir = path.resolve(BOT_DIR, e.DATA_DIR || 'data');
  const daily = String(e.DAILY_TIME || '19:00').trim();
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(daily)) throw new Error(`DAILY_TIME must look like 19:00 (got "${daily}")`);
  return {
    linnworks: {
      applicationId: e.LINNWORKS_APP_ID || '',
      applicationSecret: e.LINNWORKS_APP_SECRET || '',
      token: e.LINNWORKS_TOKEN || '',
    },
    // the warehouse's Linnworks stock location, by name or id ('' = Default)
    location: String(e.LINNWORKS_LOCATION || 'Default').trim(),
    dailyTime: daily,
    leadDays: num(e.LEAD_DAYS, 7),
    coverDays: num(e.COVER_DAYS, 21),
    // a sell-out gets its own message right away at this pace or faster;
    // slower ones wait for the evening list
    hotPerDay: num(e.HOT_PER_DAY, 0.5),
    checkMinutes: Math.max(5, num(e.CHECK_MINUTES, 15)),
    boughtDays: num(e.BOUGHT_DAYS, 21),
    // people allowed to give the bot commands (country code + number)
    allowedNumbers: String(e.ALLOWED_NUMBERS || '').split(',').map(digits).filter(Boolean),
    // the spare number, for linking with a code instead of a QR
    botPhone: digits(e.BOT_PHONE),
    alertWebhookUrl: String(e.ALERT_WEBHOOK_URL || '').trim(),
    // DWS Stock's item costs from the shared Drive folder (optional): the
    // service account's key file and the folder's id from its Drive link
    googleKeyFile: e.GOOGLE_KEY_FILE ? path.resolve(BOT_DIR, e.GOOGLE_KEY_FILE) : '',
    driveFolderId: driveFolderId(e.DRIVE_FOLDER_ID),
    // plain-language questions through Claude: on when ANTHROPIC_API_KEY is set
    ai: {
      enabled: !!String(e.ANTHROPIC_API_KEY || '').trim(),
      model: String(e.CLAUDE_MODEL || 'claude-opus-5-5').trim(),
      effort: String(e.CLAUDE_EFFORT || 'low').trim(),
      dailyLimit: num(e.AI_DAILY_LIMIT, 200),
    },
    // optional names for the allowed numbers ("15551234567=Me,15557654321=Dad")
    names: Object.fromEntries(String(e.NAMES || '').split(',').map(p => p.split('=')).filter(p => p.length === 2)
      .map(([n, name]) => [digits(n), name.trim()]).filter(([n, name]) => n && name)),
    dataDir,
    authDir: path.join(dataDir, 'whatsapp-auth'),
  };
}

// the id alone, or pasted as the whole folder link
function driveFolderId(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const m = s.match(/folders\/([A-Za-z0-9_-]+)/) || s.match(/^([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error(`DRIVE_FOLDER_ID doesn't look like a Drive folder id or link: "${s}"`);
  return m[1];
}

export function requireLinnworks(cfg) {
  const lw = cfg.linnworks;
  const missing = [['LINNWORKS_APP_ID', lw.applicationId], ['LINNWORKS_APP_SECRET', lw.applicationSecret], ['LINNWORKS_TOKEN', lw.token]]
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing in bot/.env: ${missing.join(', ')}`);
}
