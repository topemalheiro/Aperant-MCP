/**
 * Mock Electron module for ESM standalone MCP server.
 * Provides named exports that match what electron provides.
 * Add exports here as needed when new electron imports are encountered.
 */
import os from 'os';
import path from 'path';

const homedir = os.homedir();
const appData = process.platform === 'win32'
  ? path.join(homedir, 'AppData', 'Roaming')
  : process.platform === 'darwin'
    ? path.join(homedir, 'Library', 'Application Support')
    : path.join(homedir, '.config');

const noop = () => {};
const noopObj = new Proxy({}, { get: () => noop });

export const app = {
  getPath: (name) => {
    switch (name) {
      case 'userData': return path.join(appData, 'auto-claude-ui');
      case 'home': return homedir;
      case 'appData': return appData;
      default: return homedir;
    }
  },
  getAppPath: () => process.cwd(),
  isPackaged: false,
  getVersion: () => '2.7.5',
  getName: () => 'Auto-Claude',
  on: noop,
  once: noop,
  whenReady: () => Promise.resolve(),
  relaunch: noop,
  quit: noop,
};

export const ipcMain = { handle: noop, on: noop, removeHandler: noop };
export const ipcRenderer = { send: noop, on: noop, invoke: () => Promise.resolve() };

export class BrowserWindow {
  constructor() {}
  loadURL() { return Promise.resolve(); }
  on() {}
  webContents = { send: noop };
  static getAllWindows() { return []; }
  static getFocusedWindow() { return null; }
}

export const shell = { openExternal: () => Promise.resolve() };
export const screen = { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) };
export const powerMonitor = { on: noop, removeListener: noop };
export const autoUpdater = { on: noop, checkForUpdates: noop, setFeedURL: noop };
export const dialog = { showMessageBox: () => Promise.resolve({ response: 0 }), showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) };
export const session = { defaultSession: { webRequest: { onBeforeRequest: noop } } };
export const Menu = { buildFromTemplate: () => ({}), setApplicationMenu: noop };
export const Tray = class { constructor() {} setToolTip() {} setContextMenu() {} };
export class Notification { constructor() {} show() {} }

export default { app, ipcMain, ipcRenderer, BrowserWindow, shell, screen, powerMonitor, autoUpdater, dialog, session, Menu, Tray, Notification };
