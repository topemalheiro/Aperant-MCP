/**
 * Diagnostics IPC Handlers
 *
 * Exposes internal state of the usage monitor and RDR system for debugging.
 * Used by the diagnostics panel in Settings to compare Auto-Claude meter
 * values against CLI, verify RDR timing, and force fresh fetches.
 */

import { ipcMain } from 'electron';
import { homedir } from 'os';
import { join } from 'path';
import { IPC_CHANNELS } from '../../shared/constants';

export function registerDiagnosticsHandlers(): void {
  // Get usage monitor internal state
  ipcMain.handle(IPC_CHANNELS.DIAG_GET_USAGE_STATE, async () => {
    try {
      const { UsageMonitor } = await import('../claude-profile/usage-monitor');
      const monitor = UsageMonitor.getInstance();
      const diag = monitor.getDiagnostics();

      // Also check if CLI credential file exists and has a token
      let cliCredentialExists = false;
      let cliCredentialHasToken = false;
      const cliCredentialPath = join(homedir(), '.claude', '.credentials.json');
      try {
        const { readFile } = await import('fs/promises');
        const raw = await readFile(cliCredentialPath, 'utf8');
        cliCredentialExists = true;
        const parsed = JSON.parse(raw);
        cliCredentialHasToken = !!parsed?.claudeAiOauth?.accessToken;
      } catch {
        // File doesn't exist or can't be parsed
      }

      return {
        success: true,
        data: {
          ...diag,
          cliCredentialPath,
          cliCredentialExists,
          cliCredentialHasToken,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Get RDR system state (busy check, pause state, output monitor)
  ipcMain.handle(IPC_CHANNELS.DIAG_GET_RDR_STATE, async () => {
    try {
      const { getRdrPauseState } = await import('./rdr-handlers');
      const pauseState = getRdrPauseState();

      // Get output monitor state
      let outputMonitorState = 'unknown';
      try {
        const { outputMonitor } = await import('../claude-code/output-monitor');
        outputMonitorState = outputMonitor.getCurrentState();
      } catch {
        outputMonitorState = 'unavailable';
      }

      // Check MCP busy state
      let mcpBusy = false;
      try {
        const { mcpMonitor } = await import('../mcp-server');
        if (mcpMonitor) {
          mcpBusy = mcpMonitor.isBusy();
        }
      } catch {
        // MCP monitor not available
      }

      // Get isClaudeCodeBusy result (uses title-based detection with generic pattern)
      let isClaudeCodeBusy = false;
      try {
        const { isClaudeCodeBusy: checkBusy } = await import('../platform/windows/window-manager');
        isClaudeCodeBusy = await checkBusy('Claude');
      } catch {
        // Platform-specific, may not be available
      }

      return {
        success: true,
        data: {
          rdrPauseState: pauseState,
          outputMonitorState,
          mcpBusy,
          isClaudeCodeBusy,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Force a fresh usage fetch bypassing caches
  ipcMain.handle(IPC_CHANNELS.DIAG_FORCE_USAGE_FETCH, async () => {
    try {
      const { UsageMonitor } = await import('../claude-profile/usage-monitor');
      const monitor = UsageMonitor.getInstance();
      const result = await monitor.forceFetch();
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Send a test RDR message for pipeline verification
  ipcMain.handle(IPC_CHANNELS.DIAG_SEND_TEST_RDR, async () => {
    try {
      const { isClaudeCodeBusy } = await import('../platform/windows/window-manager');
      const busy = await isClaudeCodeBusy('Claude');
      return {
        success: true,
        data: {
          wouldSend: !busy,
          busyCheckResult: busy,
          message: busy
            ? 'RDR would NOT send — Claude Code is busy'
            : 'RDR would send — Claude Code is idle',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  console.log('[Diagnostics] IPC handlers registered');
}
