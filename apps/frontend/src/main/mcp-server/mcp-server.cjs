#!/usr/bin/env node
/**
 * MCP Server Entry Point (JavaScript)
 *  
 * Mocks Electron environment before loading TypeScript MCP server.
 * This prevents @sentry/electron from crashing in standalone mode.
 */

const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// Mock Electron BEFORE any TypeScript/imports are processed
if (!process.versions.electron) {
  process.versions.electron = '30.0.0';
  console.warn('[MCP] Standalone mode - Electron environment mocked');

  // Mock the electron module to prevent Sentry from crashing
  const Module = require('module');
  const originalRequire = Module.prototype.require;

  // Track if relaunch was requested
  let relaunchRequested = false;

  Module.prototype.require = function(id) {
    if (id === 'electron') {
      // Return a mock electron module
      return {
        app: {
          getPath: (name) => {
            const homedir = os.homedir();
            // On Windows, userData is in AppData/Roaming/<app-name>
            const appData = process.platform === 'win32'
              ? path.join(homedir, 'AppData', 'Roaming')
              : path.join(homedir, '.config');
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
          on: () => {},
          once: () => {},
          whenReady: () => Promise.resolve(),
          relaunch: () => {
            // In standalone MCP mode, launch the Electron app
            console.warn('[MCP] app.relaunch() called - launching Electron app...');
            relaunchRequested = true;

            // Launch the app using npx electron from the frontend directory
            const frontendDir = path.resolve(__dirname, '../../..');
            const electronProcess = spawn('npx', ['electron', '.'], {
              cwd: frontendDir,
              detached: true,
              stdio: 'ignore',
              shell: true
            });
            electronProcess.unref();
            console.warn('[MCP] Electron app launched from:', frontendDir);
          },
          quit: () => {
            // In standalone MCP mode, exit this process after relaunch
            console.warn('[MCP] app.quit() called');
            if (relaunchRequested) {
              console.warn('[MCP] Exiting MCP server after relaunch...');
              // Give the spawned process time to start
              setTimeout(() => process.exit(0), 1000);
            }
          }
        },
        ipcMain: {
          handle: () => {},
          on: () => {},
          removeHandler: () => {}
        },
        BrowserWindow: class MockBrowserWindow {
          constructor() {}
          loadURL() { return Promise.resolve(); }
          on() {}
          webContents = { send: () => {} }
        },
        shell: {
          openExternal: () => Promise.resolve()
        },
        Notification: class MockNotification {
          constructor() {}
          show() {}
        }
      };
    }
    return originalRequire.apply(this, arguments);
  };
}

// Dynamically import the TypeScript server (requires tsx to be available)
(async () => {
  try {
    await import('./index.ts');
  } catch (error) {
    console.error('[MCP] Failed to start server:', error);
    process.exit(1);
  }
})();
