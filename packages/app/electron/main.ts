import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';

const rendererUrl = process.env.MUFU_RENDERER_URL;

ipcMain.handle('pick-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '选择工作目录',
  });
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
});

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'mufu',
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
    return;
  }
  void window.loadFile(join(import.meta.dirname, '../dist/index.html'));
}

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
