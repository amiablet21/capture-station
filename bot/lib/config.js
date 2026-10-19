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
    dataDir,
    authDir: path.join(dataDir, 'whatsapp-auth'),
  };
}

export function requireLinnworks(cfg) {
  const lw = cfg.linnworks;
  const missing = [['LINNWORKS_APP_ID', lw.applicationId], ['LINNWORKS_APP_SECRET', lw.applicationSecret], ['LINNWORKS_TOKEN', lw.token]]
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing in bot/.env: ${missing.join(', ')}`);
}
