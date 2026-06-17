import { ipcMain } from 'electron';
import {
  getAllSources, getAllComponents, getActiveWorkspaceTabs, getPlacementsForTab,
  upsertSource, upsertComponent, upsertPlacement, deletePlacement,
  getSetting, setSetting,
  Source, Component, Placement,
} from './database';

export function registerIpcHandlers(): void {

  // ── Sources ──
  ipcMain.handle('db:get-sources', () => getAllSources());

  ipcMain.handle('db:upsert-source', (_e, source: Source) => {
    upsertSource(source);
    return { ok: true };
  });

  // ── Components ──
  ipcMain.handle('db:get-components', () => getAllComponents());

  ipcMain.handle('db:upsert-component', (_e, component: Component) => {
    upsertComponent(component);
    return { ok: true };
  });

  // ── Tabs ──
  ipcMain.handle('db:get-tabs', () => getActiveWorkspaceTabs());

  // ── Placements ──
  ipcMain.handle('db:get-placements', (_e, tabId: string) => getPlacementsForTab(tabId));

  ipcMain.handle('db:upsert-placement', (_e, placement: Placement) => {
    upsertPlacement(placement);
    return { ok: true };
  });

  ipcMain.handle('db:delete-placement', (_e, id: string) => {
    deletePlacement(id);
    return { ok: true };
  });

  // ── Settings ──
  ipcMain.handle('db:get-setting', (_e, key: string) => getSetting(key));

  ipcMain.handle('db:set-setting', (_e, key: string, value: string) => {
    setSetting(key, value);
    return { ok: true };
  });

  console.log('[IPC] All handlers registered');
}
