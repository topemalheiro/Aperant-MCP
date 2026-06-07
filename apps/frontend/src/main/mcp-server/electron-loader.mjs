/**
 * ESM Loader Hook for standalone MCP server.
 * Intercepts `import from 'electron'` and returns a comprehensive mock
 * with ALL electron exports generated inline (avoids static analysis issues).
 */
import os from 'os';
import path from 'path';

const ELECTRON_URL = 'electron://mock';

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: ELECTRON_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (url === ELECTRON_URL) {
    const homedir = os.homedir();
    const appData = process.platform === 'win32'
      ? path.join(homedir, 'AppData', 'Roaming')
      : process.platform === 'darwin'
        ? path.join(homedir, 'Library', 'Application Support')
        : path.join(homedir, '.config');
    const userData = path.join(appData, 'auto-claude-ui');

    const source = `
const noop = () => {};
const noopPromise = () => Promise.resolve();

export const app = {
  getPath: (name) => {
    const paths = { userData: ${JSON.stringify(userData)}, home: ${JSON.stringify(homedir)}, appData: ${JSON.stringify(appData)} };
    return paths[name] || ${JSON.stringify(homedir)};
  },
  getAppPath: () => process.cwd(),
  isPackaged: false,
  getVersion: () => '2.7.5',
  getName: () => 'Auto-Claude',
  on: noop, once: noop, off: noop, emit: noop,
  whenReady: noopPromise,
  relaunch: noop, quit: noop, exit: noop,
  requestSingleInstanceLock: () => true,
  setLoginItemSettings: noop,
  getLoginItemSettings: () => ({}),
};
export const ipcMain = { handle: noop, on: noop, once: noop, removeHandler: noop, removeAllListeners: noop };
export const ipcRenderer = { send: noop, on: noop, once: noop, invoke: noopPromise, removeListener: noop };
export class BrowserWindow {
  constructor() { this.webContents = { send: noop, on: noop, session: { webRequest: { onBeforeRequest: noop } } }; }
  loadURL() { return Promise.resolve(); }
  loadFile() { return Promise.resolve(); }
  on() { return this; }
  once() { return this; }
  show() {} hide() {} close() {} destroy() {} focus() {} blur() {}
  isDestroyed() { return false; }
  isVisible() { return true; }
  setBounds() {} getBounds() { return { x: 0, y: 0, width: 800, height: 600 }; }
  setSize() {} getSize() { return [800, 600]; }
  static getAllWindows() { return []; }
  static getFocusedWindow() { return null; }
  static fromWebContents() { return null; }
}
export const shell = { openExternal: noopPromise, openPath: noopPromise };
export const screen = { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }), getAllDisplays: () => [] };
export const powerMonitor = { on: noop, once: noop, removeListener: noop, getSystemIdleTime: () => 0 };
export const autoUpdater = { on: noop, once: noop, checkForUpdates: noop, setFeedURL: noop, quitAndInstall: noop };
export const crashReporter = { start: noop, getLastCrashReport: () => null, getUploadedReports: () => [] };
export const dialog = { showMessageBox: noopPromise, showOpenDialog: noopPromise, showSaveDialog: noopPromise, showErrorBox: noop };
export const session = { defaultSession: { webRequest: { onBeforeRequest: noop, onHeadersReceived: noop }, clearCache: noopPromise } };
export const Menu = { buildFromTemplate: () => ({}), setApplicationMenu: noop, getApplicationMenu: () => null };
export const Tray = class { constructor() {} setToolTip() {} setContextMenu() {} setImage() {} destroy() {} };
export class Notification { constructor() {} show() {} on() {} }
export const clipboard = { readText: () => '', writeText: noop, readHTML: () => '', writeHTML: noop };
export const nativeImage = { createFromPath: () => ({}), createEmpty: () => ({}) };
export const nativeTheme = { shouldUseDarkColors: false, themeSource: 'system', on: noop };
export const net = { request: noop, fetch: noopPromise };
export const protocol = { registerSchemesAsPrivileged: noop, handle: noop, registerHttpProtocol: noop };
export const webContents = { getAllWebContents: () => [], getFocusedWebContents: () => null };
export const globalShortcut = { register: noop, unregister: noop, unregisterAll: noop, isRegistered: () => false };
export const systemPreferences = { on: noop, getColor: () => '#000000', getUserDefault: () => null };
export const safeStorage = { isEncryptionAvailable: () => false, encryptString: () => Buffer.from(''), decryptString: () => '' };
export const contentTracing = { startRecording: noopPromise, stopRecording: noopPromise };
export const desktopCapturer = { getSources: noopPromise };
export const TouchBar = class { constructor() {} };
export default {
  app, ipcMain, ipcRenderer, BrowserWindow, shell, screen, powerMonitor, autoUpdater,
  crashReporter, dialog, session, Menu, Tray, Notification, clipboard, nativeImage,
  nativeTheme, net, protocol, webContents, globalShortcut, systemPreferences,
  safeStorage, contentTracing, desktopCapturer, TouchBar,
};
`;
    return { format: 'module', source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
