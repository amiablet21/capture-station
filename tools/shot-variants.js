'use strict';
// Screenshots each HTML file passed on the command line at app size.
// Usage: electron tools/shot-variants.js out-dir file1.html file2.html ...
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const [outDir, ...files] = process.argv.slice(2);

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ width: 860, height: 1000, show: true, backgroundColor: '#F7F6F3' });
  for (const file of files) {
    await win.loadFile(path.resolve(process.cwd(), file));
    await new Promise(r => setTimeout(r, 700)); // let fonts render
    const img = await win.webContents.capturePage();
    const out = path.join(outDir, path.basename(file, '.html') + '.png');
    fs.writeFileSync(out, img.toPNG());
    console.log('SHOT ' + out);
  }
  win.destroy();
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
