'use strict';
// One-off: screenshot the edit dialog open, using the renderer's demo-preview mode.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const out = process.argv[2];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 860, height: 1000, backgroundColor: '#F7F6F3' });
  await win.loadFile(path.resolve(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise(r => setTimeout(r, 800));
  await win.webContents.executeJavaScript(`
    document.getElementById('editOrder').value = '00887276796253';
    document.getElementById('editTracking').value = '';
    document.getElementById('editSerials').value = '';
    document.getElementById('editDialog').showModal();
  `, true);
  await new Promise(r => setTimeout(r, 400));
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  console.log('SHOT ' + out);
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
