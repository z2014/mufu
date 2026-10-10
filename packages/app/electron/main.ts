import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

const rendererUrl = process.env.MUFU_RENDERER_URL;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'mufu',
    webPreferences: {
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
