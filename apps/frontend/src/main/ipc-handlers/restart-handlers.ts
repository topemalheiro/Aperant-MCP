import { ipcMain, app, BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { IPC_CHANNELS } from '../../shared/constants/ipc';
import type { IPCResult } from '../../shared/types';
import type { AgentManager } from '../agent/agent-manager';
import { readSettingsFile } from '../settings-utils';
import { projectStore } from '../project-store';
import { performGracefulRestart, restoreAppState } from './graceful-restart-handler';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const RESTART_STATE_FILE = path.join(
  app.getPath('userData'),
  '.restart-state.json'
);

const RESTART_MARKER_FILE = path.join(
  app.getPath('userData'),
  '.restart-requested'
);

const HISTORY_FILE = path.join(app.getPath('userData'), '.restart-history.json');

interface RestartState {
  restartedAt: string;
  reason: 'stuckRetry_loop' | 'crash' | 'manual';
  tasks: Array<{
    taskId: string;
    projectId: string;
    status: string;
  }>;
}

interface RestartHistory {
  timestamps: string[];
}

/**
 * Check if restart was requested by hook
 */
export function checkRestartRequested(): boolean {
  return existsSync(RESTART_MARKER_FILE);
}

/**
 * Check cooldown and rate limiting
 */
function checkCooldown(settings: any): { allowed: boolean; reason?: string } {
  if (!existsSync(HISTORY_FILE)) {
    return { allowed: true };
  }

  const history: RestartHistory = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
  const now = Date.now();

  // Filter restarts in the last hour
  const recentRestarts = history.timestamps.filter(ts => {
    const age = now - new Date(ts).getTime();
    return age < 3600000; // 1 hour
  });

  const maxPerHour = settings.autoRestartOnFailure?.maxRestartsPerHour || 3;

  if (recentRestarts.length >= maxPerHour) {
    return {
      allowed: false,
      reason: `Max restarts per hour (${maxPerHour}) exceeded. Last restart: ${recentRestarts[0]}`
    };
  }

  // Check cooldown between restarts
  const lastRestart = recentRestarts[0];
  if (lastRestart) {
    const timeSinceLast = now - new Date(lastRestart).getTime();
    const cooldownMs = (settings.autoRestartOnFailure?.cooldownMinutes || 5) * 60000;

    if (timeSinceLast < cooldownMs) {
      return {
        allowed: false,
        reason: `Cooldown active. Wait ${Math.ceil((cooldownMs - timeSinceLast) / 60000)} more minutes.`
      };
    }
  }

  return { allowed: true };
}

/**
 * Record restart in history
 */
function recordRestart(): void {
  const history: RestartHistory = existsSync(HISTORY_FILE)
    ? JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'))
    : { timestamps: [] };

  history.timestamps.unshift(new Date().toISOString());

  // Keep only last 24 hours
  history.timestamps = history.timestamps.filter(ts => {
    const age = Date.now() - new Date(ts).getTime();
    return age < 86400000;
  });

  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

/**
 * Execute build command and restart app
 * Workflow: Build → Kill → Start (using reopenCommand if set)
 */
export async function buildAndRestart(buildCommand: string): Promise<IPCResult<void>> {
  try {
    // Check cooldown
    const settings = readSettingsFile();
    const cooldownCheck = checkCooldown(settings);

    if (!cooldownCheck.allowed) {
      console.warn('[RESTART] Cooldown active:', cooldownCheck.reason);
      return {
        success: false,
        error: cooldownCheck.reason
      };
    }

    // Step 1: BUILD (while app is still running)
    if (buildCommand && buildCommand.trim()) {
      console.log('[RESTART] Step 1/3: Building...', buildCommand);

      // Parse command (e.g., "npm run build" -> ["npm", "run", "build"])
      const [cmd, ...args] = buildCommand.split(' ');

      // Execute build
      const buildProcess = spawn(cmd, args, {
        cwd: path.join(currentDir, '../../../'), // Frontend root
        stdio: 'pipe',
        shell: true // Enable shell for cross-platform compatibility
      });

      let errorOutput = '';

      buildProcess.stdout?.on('data', (data) => {
        console.log('[BUILD]', data.toString().trim());
      });

      buildProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
        console.error('[BUILD ERROR]', data.toString().trim());
      });

      const exitCode = await new Promise<number>((resolve) => {
        buildProcess.on('exit', (code) => resolve(code || 0));
      });

      if (exitCode !== 0) {
        return {
          success: false,
          error: `Build failed with exit code ${exitCode}: ${errorOutput}`
        };
      }

      console.log('[RESTART] Build succeeded');
    } else {
      console.log('[RESTART] Step 1/3: Skipping build (no command set)');
    }

    // Record restart
    recordRestart();

    // Delete restart marker
    if (existsSync(RESTART_MARKER_FILE)) {
      unlinkSync(RESTART_MARKER_FILE);
    }

    // Step 2 & 3: START new process, then QUIT
    const reopenCommand = settings.autoRestartOnFailure?.reopenCommand;

    if (reopenCommand && reopenCommand.trim()) {
      console.log('[RESTART] Step 2/3: Starting new process:', reopenCommand);

      // Spawn the reopen command as a detached process
      // This ensures it survives after we quit
      const reopenProcess = spawn(reopenCommand, [], {
        cwd: path.join(currentDir, '../../../'),
        shell: true,
        detached: true,
        stdio: 'ignore'
      });

      // Unref so it doesn't keep the parent alive
      reopenProcess.unref();

      console.log('[RESTART] Step 3/3: Quitting current app...');
      app.quit();
    } else {
      // Fallback: Use Electron's built-in relaunch (works for packaged apps)
      console.log('[RESTART] Step 2/3: Using app.relaunch() (no reopenCommand set)');
      app.relaunch();
      console.log('[RESTART] Step 3/3: Quitting current app...');
      app.quit();
    }

    return { success: true };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[RESTART] Error:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Save running tasks before restart
 */
function saveRestartState(reason: RestartState['reason'], agentManager: AgentManager): void {
  const runningTasks = agentManager.getRunningTasks();

  const state: RestartState = {
    restartedAt: new Date().toISOString(),
    reason,
    tasks: runningTasks.map(task => ({
      taskId: task.specId,
      projectId: task.projectId,
      status: task.status
    }))
  };

  writeFileSync(RESTART_STATE_FILE, JSON.stringify(state, null, 2));
  console.log('[RESTART] Saved state for', state.tasks.length, 'tasks');
}

/**
 * Resume tasks after restart
 */
export function resumeTasksAfterRestart(): void {
  if (!existsSync(RESTART_STATE_FILE)) {
    return; // No restart state, skip
  }

  try {
    const state: RestartState = JSON.parse(
      readFileSync(RESTART_STATE_FILE, 'utf-8')
    );

    console.log('[RESTART] Resuming', state.tasks.length, 'tasks after', state.reason);

    // For each task, set status to "start_requested"
    // File watcher will pick it up and auto-start
    for (const task of state.tasks) {
      // Get project path from project store
      const project = projectStore.getProject(task.projectId);
      if (!project) {
        console.warn('[RESTART] Project not found:', task.projectId);
        continue;
      }

      const planPath = path.join(
        project.path,
        '.auto-claude',
        'specs',
        task.taskId,
        'implementation_plan.json'
      );

      if (existsSync(planPath)) {
        const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
        plan.status = 'start_requested';
        writeFileSync(planPath, JSON.stringify(plan, null, 2));
        console.log('[RESTART] Marked', task.taskId, 'for resumption');
      }

      // Also check worktree version (higher priority)
      const worktreePath = path.join(
        project.path,
        '.auto-claude',
        'worktrees',
        'tasks',
        task.taskId,
        '.auto-claude',
        'specs',
        task.taskId,
        'implementation_plan.json'
      );

      if (existsSync(worktreePath)) {
        const plan = JSON.parse(readFileSync(worktreePath, 'utf-8'));
        plan.status = 'start_requested';
        writeFileSync(worktreePath, JSON.stringify(plan, null, 2));
        console.log('[RESTART] Marked', task.taskId, 'worktree for resumption');
      }
    }

    // Delete restart state file
    unlinkSync(RESTART_STATE_FILE);

  } catch (error) {
    console.error('[RESTART] Error resuming tasks:', error);
  }
}

/**
 * IPC Handlers
 */
export function registerRestartHandlers(agentManager: AgentManager) {
  // Trigger auto-restart (called by MCP tool or UI)
  ipcMain.handle(IPC_CHANNELS.RESTART_TRIGGER_AUTO_RESTART, async (_, buildCommand: string) => {
    saveRestartState('manual', agentManager);
    return buildAndRestart(buildCommand);
  });

  // Check restart cooldown (prevent too many restarts)
  ipcMain.handle(IPC_CHANNELS.RESTART_CHECK_COOLDOWN, async () => {
    const settings = readSettingsFile();
    const cooldownCheck = checkCooldown(settings);
    return { success: true, data: cooldownCheck };
  });

  // Graceful restart (from MCP or user request)
  ipcMain.handle(IPC_CHANNELS.RESTART_GRACEFUL, async (_, options: {
    reason: 'stuckRetry_loop' | 'memory_leak' | 'manual' | 'settings_change' | 'recovery';
    saveState?: boolean;
    delay?: number;
  }) => {
    try {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      await performGracefulRestart(mainWindow, options);
      return { success: true };
    } catch (error) {
      console.error('[RestartHandlers] Graceful restart failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });
}

/**
 * Check for restart marker on startup
 */
export function checkAndHandleRestart(settings: any, agentManager: AgentManager): void {
  if (!checkRestartRequested()) {
    return;
  }

  if (!settings.autoRestartOnFailure?.enabled) {
    console.log('[RESTART] Auto-restart requested but feature is disabled');
    unlinkSync(RESTART_MARKER_FILE);
    return;
  }

  console.log('[RESTART] Restart requested by hook, triggering build...');

  saveRestartState('stuckRetry_loop', agentManager);

  const buildCommand = settings.autoRestartOnFailure.buildCommand || 'npm run build';

  buildAndRestart(buildCommand).catch(error => {
    console.error('[RESTART] Auto-restart failed:', error);
  });
}
