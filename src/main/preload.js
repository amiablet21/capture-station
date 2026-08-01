'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = [
  'state:changed',
  'order:detected',
  'order:duplicate',
  'order:similar',
  'clipboard:ignored',
  'tracking:detected',
  'tracking:clipped',
  'orders:imported',
  'sync:progress',
  'image:progress',
  'sync:done',
  'routing:done',
  'ui:open-settings',
  'ui:open-debug',
  'ui:open-history',
];

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  submitScan: (text, force) => ipcRenderer.invoke('scan:submit', { text, force: !!force }),
  nextOrder: () => ipcRenderer.invoke('order:next'),
  addOrderAnyway: (channel, orderNumber) => ipcRenderer.invoke('order:forceAdd', { channel, orderNumber }),
  reopenRow: (id) => ipcRenderer.invoke('order:open', id),
  openOrderPage: (orderNumber, channel) => ipcRenderer.invoke('order:openExternal', { orderNumber, channel }),
  refreshOrders: () => ipcRenderer.invoke('orders:refresh'),
  undo: () => ipcRenderer.invoke('undo'),
  updateRow: (id, fields) => ipcRenderer.invoke('rows:update', { id, fields }),
  deleteRow: (id) => ipcRenderer.invoke('rows:delete', id),
  runSync: (ids) => ipcRenderer.invoke('sync:run', { ids }),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  exportCsv: () => ipcRenderer.invoke('csv:export'),
  openCsvFolder: () => ipcRenderer.invoke('csv:openFolder'),
  chooseCsvFolder: () => ipcRenderer.invoke('csv:chooseFolder'),
  testLinnworks: (creds) => ipcRenderer.invoke('linnworks:test', creds),
  getDebugLog: () => ipcRenderer.invoke('debug:get'),
  getHistory: () => ipcRenderer.invoke('history:get'),
  getStock: () => ipcRenderer.invoke('stock:get'),
  getStockOpenOrders: (sku) => ipcRenderer.invoke('stock:openOrders', { sku }),
  setStockLevel: (sku, level) => ipcRenderer.invoke('stock:set', { sku, level }),
  getChannelSkus: (stockItemId) => ipcRenderer.invoke('stock:channelSkus', { stockItemId }),
  addStockImage: (sku, stockItemId) => ipcRenderer.invoke('stock:addImage', { sku, stockItemId }),
  addStockImageUrl: (sku, stockItemId, url) => ipcRenderer.invoke('stock:addImageUrl', { sku, stockItemId, url }),
  cancelStockImage: () => ipcRenderer.invoke('stock:cancelImage'),
  addStockImageFile: (sku, stockItemId, filePath) => ipcRenderer.invoke('stock:addImage', { sku, stockItemId, filePath }),
  // dropped File -> real path (File.path is gone in modern Electron)
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  saveStockImage: (sku, url) => ipcRenderer.invoke('stock:saveImage', { sku, url }),
  wfsList: () => ipcRenderer.invoke('wfs:list'),
  wfsCreate: (note, items) => ipcRenderer.invoke('wfs:create', { note, items }),
  receivingFinish: (lines, meta) => ipcRenderer.invoke('receiving:finish', { lines, ...(meta || {}) }),
  receivingList: () => ipcRenderer.invoke('receiving:list'),
  chooseReceivingFolder: () => ipcRenderer.invoke('receiving:chooseFolder'),
  copyText: (text) => ipcRenderer.invoke('clipboard:copy', text),
  on: (channel, cb) => {
    if (!EVENTS.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});
