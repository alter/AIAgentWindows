// index.ts
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { windowTitle } from '../shared/app-info';

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    title: windowTitle(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

void app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
