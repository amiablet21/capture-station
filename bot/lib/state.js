// The bot's memory, one JSON file in the data folder: which group it posts
// to, purchases noted with "bought", which sell-outs it already announced,
// the day the last evening list went out.
import fs from 'node:fs';
import path from 'node:path';

// bought: open purchase notes (they settle when the stock arrives);
// purchases: every purchase ever noted, kept for "history" and last prices
const EMPTY = { groupJid: '', bought: {}, purchases: [], alertedOut: {}, primed: false, lastDailyDay: '', linnworksDownNotified: false };

export class State {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'state.json');
    fs.mkdirSync(dataDir, { recursive: true });
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first run */ }
    this.s = { ...structuredClone(EMPTY), ...stored };
  }

  get(key) { return this.s[key]; }

  set(patch) {
    Object.assign(this.s, patch);
    // write-then-rename so a crash mid-write never leaves half a file
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.s, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}
