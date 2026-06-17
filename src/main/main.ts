import { app, BrowserWindow, ipcMain, Menu, Tray, globalShortcut, nativeImage } from 'electron';
import path from 'path';
import { initDatabase, getDb } from './database';
import { registerIpcHandlers } from './ipc-handlers';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 800,
    minHeight: 600,
    title: 'Chart Watcher',
    backgroundColor: '#0F0F23',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/shell-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,           // Enable <webview> for source embedding
      spellcheck: false,
    },
  });

  // Load the shell HTML
  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Show when ready (avoids white flash)
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  // Prevent close — hide to tray instead
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  return win;
}

function createTray(): void {
  // Simple 16x16 icon (colored square)
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKklEQVQ4y2Ng' +
      'YJDWZ2BgOMvAwHCWEV2SgYGBYRQ4DAJo0qOhMApGHAAATuoEAe7JJQAAAAAASUVORK5CYII=',
      'base64'
    )
  );

  tray = new Tray(icon);
  tray.setToolTip('Chart Watcher');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { label: 'Reload', click: () => mainWindow?.webContents.reload() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow?.show());
}

function registerShortcuts(): void {
  // F11 = fullscreen toggle
  globalShortcut.register('F11', () => {
    if (!mainWindow) return;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });

  // Ctrl+T = cycle theme
  globalShortcut.register('CommandOrControl+T', () => {
    mainWindow?.webContents.send('cycle-theme');
  });

  // Ctrl+R = reload all sources
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    mainWindow?.webContents.send('reload-sources');
  });
}

// ── App lifecycle ──

app.whenReady().then(async () => {
  // Initialize database
  await initDatabase();

  // Register IPC handlers
  registerIpcHandlers();

  // Create window & tray
  mainWindow = createWindow();
  createTray();
  registerShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
