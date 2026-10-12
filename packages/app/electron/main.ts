import { spawn, type ChildProcess } from 'node:child_process';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { packagedDaemonLaunch, refreshLaunchAgent, shouldInstallLaunchAgent } from './launch-agent.js';

let packagedDaemon: ChildProcess | null = null;

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

/** macOS 用 LaunchAgent。其它系统没有 launchctl，打包后的壳自己拉起同一个守护进程。 */
function startBundledDaemon(): void {
  const launch = packagedDaemonLaunch(process.execPath, process.resourcesPath);
  packagedDaemon = spawn(launch.program, launch.args, {
    env: { ...process.env, ...launch.env },
    stdio: 'inherit',
  });
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
  } else if (app.isPackaged) {
    startBundledDaemon();
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (packagedDaemon?.exitCode === null && !packagedDaemon.killed) {
    packagedDaemon.kill('SIGTERM');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
