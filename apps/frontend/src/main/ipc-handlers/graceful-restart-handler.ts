/**
 * Graceful Restart Handler - MCP command for restarting Auto-Claude
 *
 * This enables Claude Code to request a graceful restart of Auto-Claude via MCP.
 * Unlike crash recovery (external watchdog), this is an intentional restart triggered
 * by the user or Claude Code for maintenance purposes.
 *
 * Use cases:
 * - Prompt loop detection (stuck waiting for user input)
 * - High memory usage
 * - Settings changes requiring restart
 * - User request via Claude Code
 */

import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

interface RestartOptions {
  reason: 'stuckRetry_loop' | 'memory_leak' | 'manual' | 'settings_change' | 'recovery';
  saveState?: boolean;
  delay?: number; // Delay in milliseconds before restarting
}

interface AppState {
  reason: string;
  timestamp: string;
  windowBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  activeProject?: string;
}

/**
 * Save current application state before restart
 */
async function saveAppState(mainWindow: BrowserWindow | null, reason: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.log('[GracefulRestart] No window to save state from');
    return;
  }

  try {
    const userDataPath = app.getPath('userData');
    const statePath = path.join(userDataPath, 'restart-state.json');

    // Get window bounds
    const bounds = mainWindow.getBounds();

    // Get active project from renderer
    const activeProject = await mainWindow.webContents.executeJavaScript(`
      (function() {
        try {
          // Try to get current project ID from the store
          return window.__CURRENT_PROJECT_ID__ || null;
        } catch (e) {
          return null;
        }
      })()
    `).catch(() => null);

    const state: AppState = {
      reason,
      timestamp: new Date().toISOString(),
      windowBounds: bounds,
      activeProject: activeProject || undefined
    };

    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    console.log('[GracefulRestart] State saved:', statePath);
  } catch (error) {
    console.error('[GracefulRestart] Failed to save state:', error);
  }
}

/**
 * Restore application state after restart
 */
export async function restoreAppState(mainWindow: BrowserWindow): Promise<void> {
  try {
    const userDataPath = app.getPath('userData');
    const statePath = path.join(userDataPath, 'restart-state.json');

    if (!fs.existsSync(statePath)) {
      console.log('[GracefulRestart] No restart state to restore');
      return;
    }

    const content = fs.readFileSync(statePath, 'utf-8');
    const state: AppState = JSON.parse(content);

    console.log('[GracefulRestart] Restoring state from:', state.timestamp);
    console.log('[GracefulRestart] Restart reason:', state.reason);

    // Restore window bounds if available
    if (state.windowBounds && !mainWindow.isDestroyed()) {
      mainWindow.setBounds(state.windowBounds);
      console.log('[GracefulRestart] Window bounds restored');
    }

    // Notify renderer that we restarted
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('app-restarted', {
        reason: state.reason,
        timestamp: state.timestamp
      });
      console.log('[GracefulRestart] Notified renderer of restart');
    });

    // Delete state file
    fs.unlinkSync(statePath);
    console.log('[GracefulRestart] Restart state file deleted');
  } catch (error) {
    console.error('[GracefulRestart] Failed to restore state:', error);
  }
}

/**
 * Perform graceful restart of the application
 */
export async function performGracefulRestart(
  mainWindow: BrowserWindow | null,
  options: RestartOptions
): Promise<void> {
  console.log('[GracefulRestart] Restart requested');
  console.log('[GracefulRestart] Reason:', options.reason);
  console.log('[GracefulRestart] Save state:', options.saveState ?? true);
  console.log('[GracefulRestart] Delay:', options.delay ?? 0, 'ms');

  // Save state if requested
  if (options.saveState !== false) {
    await saveAppState(mainWindow, options.reason);
  }

  // Delay if requested
  if (options.delay && options.delay > 0) {
    console.log(`[GracefulRestart] Waiting ${options.delay}ms before restart...`);
    await new Promise(resolve => setTimeout(resolve, options.delay));
  }

  // Close all windows gracefully
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.close();
    }
  }

  // Wait a bit for windows to close
  await new Promise(resolve => setTimeout(resolve, 500));

  // Relaunch the app
  console.log('[GracefulRestart] Relaunching application...');
  app.relaunch();
  app.exit(0);
}

/**
 * Check if restart is needed based on system metrics
 */
export function checkRestartNeeded(): {
  needed: boolean;
  reason?: string;
  memoryUsage?: number;
} {
  // Check memory usage
  const memoryInfo = process.memoryUsage();
  const memoryMB = memoryInfo.heapUsed / 1024 / 1024;

  // If using more than 2GB, suggest restart
  if (memoryMB > 2048) {
    return {
      needed: true,
      reason: 'High memory usage detected',
      memoryUsage: Math.round(memoryMB)
    };
  }

  return { needed: false };
}
