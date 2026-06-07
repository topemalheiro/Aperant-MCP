/**
 * Crash Recovery Handler - Reads crash flags and notifies Claude Code
 *
 * This runs on Electron startup to check if the app was restarted after a crash.
 * If a crash flag file exists, it sends a notification to Claude Code via MCP
 * and then deletes the flag.
 */

import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

interface CrashInfo {
  timestamp: number;
  exitCode: number | null;
  signal: string | null;
  logs: string[];
  freezeDetected?: boolean;
  freezeType?: string;
}

/**
 * Get the path to the crash flag file
 */
function getCrashFlagPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'crash-flag.json');
}

/**
 * Build crash notification message for Claude Code
 */
function buildCrashMessage(crashInfo: CrashInfo, restartCount: number): string {
  const lines: string[] = [];
  const date = new Date(crashInfo.timestamp);
  const isFreeze = crashInfo.freezeDetected === true;

  if (isFreeze) {
    lines.push('[Auto-Claude Crash Recovery] APP RESTARTED AFTER FREEZE');
    lines.push('');
    lines.push('**Freeze Details:**');
    lines.push(`- **Time:** ${date.toLocaleString()}`);
    lines.push(`- **Type:** ${crashInfo.freezeType ?? 'Unknown'}`);
    lines.push(`- **Restart Attempt:** ${restartCount}`);
    lines.push('');
    lines.push('**What Happened?**');
    lines.push('The Auto-Claude application froze (became unresponsive). The freeze was detected');
    lines.push(`via ${crashInfo.freezeType === 'main_process_freeze' ? 'heartbeat monitoring (main process stalled)' : 'Electron unresponsive detection (renderer hung)'}.`);
    lines.push('The application was automatically killed and restarted.');
  } else {
    lines.push('[Auto-Claude Crash Recovery] APP RESTARTED AFTER CRASH');
    lines.push('');
    lines.push('**Crash Details:**');
    lines.push(`- **Time:** ${date.toLocaleString()}`);
    lines.push(`- **Exit Code:** ${crashInfo.exitCode ?? 'N/A'}`);
    lines.push(`- **Signal:** ${crashInfo.signal ?? 'N/A'}`);
    lines.push(`- **Restart Attempt:** ${restartCount}`);
    lines.push('');
    lines.push('**What Happened?**');
    lines.push('The Auto-Claude application crashed unexpectedly. The external watchdog detected');
    lines.push('the crash and automatically restarted the application.');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('**Recent Logs:**');
  lines.push('```');
  crashInfo.logs.forEach(log => lines.push(log));
  lines.push('```');
  lines.push('');
  lines.push('**Recovery Actions:**');
  lines.push('- Application restarted successfully');
  lines.push('- Review logs above for error patterns');
  lines.push('');
  lines.push('**To Disable:**');
  lines.push('Go to Settings → Updates → Crash Recovery (toggle off)');

  return lines.join('\n');
}

/**
 * Check for crash flag and notify Claude Code if found
 */
export async function checkAndNotifyCrash(mainWindow: BrowserWindow): Promise<void> {
  const flagPath = getCrashFlagPath();

  // Check if crash flag exists
  if (!fs.existsSync(flagPath)) {
    console.log('[CrashRecovery] No crash flag found, startup is normal');
    return;
  }

  console.log('[CrashRecovery] Crash flag detected:', flagPath);

  try {
    // Read crash info
    const content = fs.readFileSync(flagPath, 'utf-8');
    const crashInfo: CrashInfo = JSON.parse(content);

    console.log('[CrashRecovery] Crash info:', {
      timestamp: new Date(crashInfo.timestamp).toISOString(),
      exitCode: crashInfo.exitCode,
      signal: crashInfo.signal,
      logLines: crashInfo.logs.length
    });

    // Count restart attempts (simple heuristic: how many times we've seen this)
    const restartCount = 1; // TODO: Track actual restart count

    // Build notification message
    const message = buildCrashMessage(crashInfo, restartCount);

    // Send notification to Claude Code via RDR system
    // Wait a bit for the window to be fully ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (!mainWindow.isDestroyed()) {
      console.log('[CrashRecovery] Sending crash notification to Claude Code...');

      try {
        // Use the RDR notification system to send to Claude Code
        const result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            try {
              // Use the existing sendRdrToWindow API
              const result = await window.electronAPI.sendRdrToWindow('Claude Code', ${JSON.stringify(message)});
              return result;
            } catch (error) {
              return { success: false, error: error.message };
            }
          })()
        `);

        if (result?.success) {
          console.log('[CrashRecovery] ✅ Crash notification sent successfully');
        } else {
          console.error('[CrashRecovery] ❌ Failed to send notification:', result?.error);
        }
      } catch (error) {
        console.error('[CrashRecovery] Exception sending notification:', error);
      }
    }

    // Delete crash flag file
    fs.unlinkSync(flagPath);
    console.log('[CrashRecovery] Crash flag deleted');

  } catch (error) {
    console.error('[CrashRecovery] Failed to process crash flag:', error);

    // Try to delete the corrupted flag file
    try {
      fs.unlinkSync(flagPath);
      console.log('[CrashRecovery] Deleted corrupted crash flag');
    } catch (deleteError) {
      console.error('[CrashRecovery] Failed to delete crash flag:', deleteError);
    }
  }
}

/**
 * Check if crash recovery is enabled in settings
 */
export function isCrashRecoveryEnabled(): boolean {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');

    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return settings.crashRecovery?.enabled ?? false;
    }
  } catch (error) {
    console.error('[CrashRecovery] Failed to read settings:', error);
  }

  return false;
}
