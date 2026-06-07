/**
 * Crash Notifier - Sends crash notifications to Claude Code via MCP
 *
 * When crashes are detected by the watchdog, this module sends detailed
 * crash reports to Claude Code so it can investigate and take action.
 */

import type { BrowserWindow } from 'electron';

interface CrashNotification {
  event: 'crash_detected' | 'crash_loop';
  timestamp: string;
  exitCode: number | null;
  signal: string | null;
  restartCount: number;
  logs: string[];
  crashCount?: number;
}

export class CrashNotifier {
  private mainWindow: BrowserWindow | null = null;
  private readonly claudeCodePattern = 'Claude Code';

  /**
   * Set the main window reference for sending notifications
   */
  public setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * Send crash notification to Claude Code
   */
  public async sendCrashNotification(
    event: 'crash_detected' | 'crash_loop',
    crashInfo: {
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      restartCount: number;
      logs: string[];
      crashCount?: number;
    }
  ): Promise<void> {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      console.warn('[CrashNotifier] No main window available, cannot send notification');
      return;
    }

    const notification: CrashNotification = {
      event,
      timestamp: new Date().toISOString(),
      exitCode: crashInfo.exitCode,
      signal: crashInfo.signal,
      restartCount: crashInfo.restartCount,
      logs: crashInfo.logs,
      crashCount: crashInfo.crashCount
    };

    try {
      // Build detailed crash report message
      const message = this.buildCrashMessage(notification);

      // Send to Claude Code via the existing RDR notification system
      console.log('[CrashNotifier] Sending crash notification to Claude Code...');

      // Use the sendRdrToWindow API to send the crash notification
      const result = await this.mainWindow.webContents.executeJavaScript(`
        (async () => {
          try {
            const result = await window.electronAPI.sendRdrToWindow('${this.claudeCodePattern}', ${JSON.stringify(message)});
            return result;
          } catch (error) {
            return { success: false, error: error.message };
          }
        })()
      `);

      if (result?.success) {
        console.log('[CrashNotifier] ✅ Crash notification sent successfully');
      } else {
        console.error('[CrashNotifier] ❌ Failed to send crash notification:', result?.error);
      }
    } catch (error) {
      console.error('[CrashNotifier] Exception while sending notification:', error);
    }
  }

  /**
   * Build formatted crash message for Claude Code
   */
  private buildCrashMessage(notification: CrashNotification): string {
    const lines: string[] = [];

    if (notification.event === 'crash_loop') {
      lines.push('[Auto-Claude Crash Recovery] 🚨 CRASH LOOP DETECTED');
      lines.push('');
      lines.push(`**Crash Count:** ${notification.crashCount} crashes in rapid succession`);
      lines.push(`**Restart Attempts:** ${notification.restartCount}`);
      lines.push('**Status:** Restart attempts stopped to prevent infinite loop');
      lines.push('');
      lines.push('**Action Required:**');
      lines.push('1. Check recent logs below for error patterns');
      lines.push('2. Investigate root cause of crashes');
      lines.push('3. Fix underlying issue before restarting');
      lines.push('4. Consider disabling crash recovery temporarily');
    } else {
      lines.push('[Auto-Claude Crash Recovery] ⚠️ CRASH DETECTED');
      lines.push('');
      lines.push(`**Exit Code:** ${notification.exitCode ?? 'N/A'}`);
      lines.push(`**Signal:** ${notification.signal ?? 'N/A'}`);
      lines.push(`**Restart Attempt:** ${notification.restartCount}`);
      lines.push(`**Timestamp:** ${notification.timestamp}`);
      lines.push('');
      lines.push('**Status:** Auto-Claude will restart automatically in 2 seconds');
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('**Recent Logs (Last 20 lines):**');
    lines.push('```');
    notification.logs.forEach(log => lines.push(log));
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('**Recovery Options:**');
    lines.push('- **Auto-restart is enabled** - Watchdog will restart Auto-Claude automatically');
    lines.push('- **To disable:** Go to Settings → Updates → Crash Recovery (toggle off)');
    lines.push('- **To investigate:** Check full logs in Auto-Claude data directory');
    lines.push('');
    lines.push('**Settings Location:**');
    lines.push('- Windows: `%APPDATA%\\auto-claude\\settings.json`');
    lines.push('- macOS: `~/Library/Application Support/auto-claude/settings.json`');
    lines.push('- Linux: `~/.config/auto-claude/settings.json`');

    return lines.join('\n');
  }

  /**
   * Send a simple notification (for testing)
   */
  public async sendTestNotification(): Promise<void> {
    const testInfo = {
      exitCode: 1,
      signal: null as NodeJS.Signals | null,
      restartCount: 0,
      logs: [
        '[Test] This is a test crash notification',
        '[Test] Simulated crash for testing purposes',
        '[Test] No actual crash occurred'
      ]
    };

    await this.sendCrashNotification('crash_detected', testInfo);
  }
}

// Export singleton instance
export const crashNotifier = new CrashNotifier();
