import { app, type BrowserWindow } from 'electron';

/**
 * Check if running in development mode.
 * Safe to call even before app is ready.
 */
export function isDev(): boolean {
  try {
    return !app.isPackaged;
  } catch {
    return true; // Default to dev mode if app not ready
  }
}

/**
 * Check if running in production mode.
 */
export function isProd(): boolean {
  return !isDev();
}

/**
 * Watch window shortcuts for development and production modes.
 * Replaces @electron-toolkit/utils optimizer.watchWindowShortcuts.
 */
export function watchWindowShortcuts(window: BrowserWindow): void {
  if (!window) return;

  const { webContents } = window;

  webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      // Production mode: block reload and dev tools shortcuts
      if (!isDev()) {
        if (input.code === 'KeyR' && (input.control || input.meta)) {
          event.preventDefault();
        }
        if (input.code === 'KeyI' && (input.alt && input.meta || input.control && input.shift)) {
          event.preventDefault();
        }
      } else {
        // Development mode: F12 toggles dev tools
        if (input.code === 'F12') {
          if (webContents.isDevToolsOpened()) {
            webContents.closeDevTools();
          } else {
            webContents.openDevTools({ mode: 'undocked' });
          }
        }
      }
    }
  });
}
