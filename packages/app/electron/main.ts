import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { packagedDaemonLaunch, refreshLaunchAgent, shouldInstallLaunchAgent } from './launch-agent.js';

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

void app.whenReady().then(async () => {
  if (shouldInstallLaunchAgent(app.isPackaged, process.platform)) {
    const launch = packagedDaemonLaunch(process.execPath, process.resourcesPath);
    await refreshLaunchAgent({
      home: homedir(),
      platform: process.platform,
      program: launch.program,
      args: launch.args,
      env: launch.env,
    });
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
