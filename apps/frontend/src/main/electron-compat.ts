/**
 * Electron Compatibility Layer
 *
 * Provides fallback implementations when running outside Electron context
 * (e.g., MCP server running as standalone Node.js process)
 */

import { homedir } from 'os';
import path from 'path';
import { readFileSync } from 'fs';

// Check if we're running in Electron context
// Use process.type which is only set in Electron (undefined in Node.js)
const isElectronContext = typeof process !== 'undefined' &&
                         typeof (process as any).type === 'string' &&
                         ['browser', 'renderer', 'worker'].includes((process as any).type);

let electronApp: any = null;

// Only try to load electron if we're actually in Electron context
if (isElectronContext) {
  try {
    // Dynamic import to avoid bundler issues when not in Electron
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    electronApp = (await import('electron')).app;
  } catch (error) {
    console.warn('[ElectronCompat] Failed to load electron module:', error);
    electronApp = null;
  }
}

// Fallback app implementation for non-Electron contexts
const fallbackApp = {
  getPath(name: string): string {
    // Provide fallback paths for MCP server
    // CRITICAL: userData must match Electron's actual path so MCP server
    // and Electron app share the same project store (same UUIDs).
    // Electron uses: {APPDATA|~/Library/Application Support|~/.config}/auto-claude-ui
    const home = homedir();
    switch (name) {
      case 'userData':
        if (process.platform === 'win32') {
          return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'auto-claude-ui');
        } else if (process.platform === 'darwin') {
          return path.join(home, 'Library', 'Application Support', 'auto-claude-ui');
        } else {
          return path.join(home, '.config', 'auto-claude-ui');
        }
      case 'home':
        return home;
      default:
        return home;
    }
  },
  isPackaged: false,
  getVersion(): string {
    try {
      const packageJson = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
      return packageJson.version;
    } catch {
      return '0.0.0';
    }
  }
};

// Export app with fallback
export const app = electronApp || fallbackApp;

// Export isElectronContext for conditional logic
export const isElectron = isElectronContext;
