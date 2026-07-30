'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = [
  'state:changed',
  'order:detected',
  'order:duplicate',
  'clipboard:ignored',
  'sync:progress',
  'sync:done',
  'ui:open-settings',
  'ui:open-debug',
];

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  submitScan: (text, force) => ipcRenderer.invoke('scan:submit', { text, force: !!force }),
  nextOrder: () => ipcRenderer.invoke('order:next'),
  reopenRow: (id) => ipcRenderer.invoke('order:open', id),
  undo: () => ipcRenderer.invoke('undo'),
  updateRow: (id, fields) => ipcRenderer.invoke('rows:update', { id, fields }),
  deleteRow: (id) => ipcRenderer.invoke('rows:delete', id),
  runSync: () => ipcRenderer.invoke('sync:run'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  exportCsv: () => ipcRenderer.invoke('csv:export'),
  openCsvFolder: () => ipcRenderer.invoke('csv:openFolder'),
  chooseCsvFolder: () => ipcRenderer.invoke('csv:chooseFolder'),
  testLinnworks: (creds) => ipcRenderer.invoke('linnworks:test', creds),
  getDebugLog: () => ipcRenderer.invoke('debug:get'),
  on: (channel, cb) => {
    if (!EVENTS.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});
