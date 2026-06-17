import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // ── Database ──
  getSources: () => ipcRenderer.invoke('db:get-sources'),
  upsertSource: (source: any) => ipcRenderer.invoke('db:upsert-source', source),
  getComponents: () => ipcRenderer.invoke('db:get-components'),
  upsertComponent: (comp: any) => ipcRenderer.invoke('db:upsert-component', comp),
  getTabs: () => ipcRenderer.invoke('db:get-tabs'),
  getPlacements: (tabId: string) => ipcRenderer.invoke('db:get-placements', tabId),
  upsertPlacement: (p: any) => ipcRenderer.invoke('db:upsert-placement', p),
  deletePlacement: (id: string) => ipcRenderer.invoke('db:delete-placement', id),
  getSetting: (key: string) => ipcRenderer.invoke('db:get-setting', key),
  setSetting: (key: string, val: string) => ipcRenderer.invoke('db:set-setting', key, val),

  // ── Events from main ──
  onCycleTheme: (cb: () => void) => ipcRenderer.on('cycle-theme', cb),
  onReloadSources: (cb: () => void) => ipcRenderer.on('reload-sources', cb),
});
