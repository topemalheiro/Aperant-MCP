/**
 * Auto-Shutdown IPC Handlers
 *
 * Manages the shutdown monitor script that watches tasks and triggers
 * system shutdown when all active tasks reach Human Review.
 */

import { ipcMain, app, Notification } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import type { AutoShutdownStatus } from '../../shared/types/task';
import { projectStore } from '../project-store';
import { readSettingsFile, writeSettingsFile } from '../settings-utils';

// Track running monitor processes per project
const monitorProcesses = new Map<string, ChildProcess>();
const monitorStatuses = new Map<string, AutoShutdownStatus>();
const monitorProjectPaths = new Map<string, string>(); // projectId → projectPath for live recalculation

/**
 * Get project specs directory
 */
function getProjectSpecsDir(projectPath: string): string {
  return path.join(projectPath, '.auto-claude', 'specs');
}

/**
 * Get the worktree version of a task's plan, if it exists.
 * Worktrees contain the ACTUAL agent progress (ai_review, in_progress, etc.)
 * while the main project directory may have stale status (e.g., human_review).
 * Path: <project>/.auto-claude/worktrees/tasks/<taskId>/.auto-claude/specs/<taskId>/implementation_plan.json
 */
function getWorktreePlan(projectPath: string, taskDir: string): Record<string, unknown> | null {
  const worktreePlanPath = path.join(
    projectPath, '.auto-claude', 'worktrees', 'tasks', taskDir,
    '.auto-claude', 'specs', taskDir, 'implementation_plan.json'
  );

  if (!fs.existsSync(worktreePlanPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(worktreePlanPath, 'utf-8'));
  } catch (e) {
    console.error(`[AutoShutdown] Failed to read worktree plan for ${taskDir}:`, e);
    return null;
  }
}

/**
 * Check if QA validation phase completed ("all criteria met") for a task.
 * Reads task_logs.json validation phase status — written by QA loop when all
 * acceptance criteria pass. This is the definitive signal that QA actually ran
 * and approved, not just a stale qa_signoff from a previous cycle.
 * Falls back to qa_report.md existence if task_logs.json is unavailable.
 */
function isQaValidationComplete(specsDir: string, taskDir: string): boolean {
  // Primary: check task_logs.json validation phase
  const logsPath = path.join(specsDir, taskDir, 'task_logs.json');
  if (fs.existsSync(logsPath)) {
    try {
      const logs = JSON.parse(fs.readFileSync(logsPath, 'utf-8'));
      const validationPhase = logs?.phases?.validation;
      if (validationPhase?.status === 'completed' && validationPhase?.completed_at) {
        return true;
      }
    } catch {
      // Fall through to qa_report.md check
    }
  }

  // Fallback: qa_report.md written by QA reviewer when it validates
  const qaReportPath = path.join(specsDir, taskDir, 'qa_report.md');
  return fs.existsSync(qaReportPath);
}

/**
 * Check if a task is QA-approved at 100% completion (all subtasks done).
 * NOTE: This checks plan data only. Callers should ALSO verify qa_report.md
 * exists (via hasQaReport) to confirm QA validation actually ran — qa_signoff
 * can be stale from a previous cycle.
 */
function isQaApprovedComplete(content: Record<string, unknown>): boolean {
  const qaSignoff = content.qa_signoff as { status?: string } | undefined;
  if (qaSignoff?.status !== 'approved') return false;

  const phases = content.phases as Array<{ subtasks?: Array<{ status?: string }> }> | undefined;
  if (!phases || phases.length === 0) return false;

  const allSubtasks = phases.flatMap(p => p.subtasks || []);
  if (allSubtasks.length === 0) return false;

  const completed = allSubtasks.filter(s => s.status === 'completed').length;
  return completed === allSubtasks.length;
}

/**
 * Check if a task is archived by reading task_metadata.json
 * Archived tasks have an archivedAt field set to an ISO date string
 */
function isTaskArchived(specsDir: string, taskDir: string): boolean {
  const metadataPath = path.join(specsDir, taskDir, 'task_metadata.json');

  if (!fs.existsSync(metadataPath)) {
    return false;
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    // Task is archived if archivedAt field exists and is truthy
    if (metadata.archivedAt) {
      return true;
    }
    return false;
  } catch (e) {
    // If we can't read metadata, assume not archived
    return false;
  }
}


/**
 * Get all active task IDs for a project
 * Returns tasks that are not in terminal status (done, pr_created) and not archived
 */
function getActiveTaskIds(projectPath: string): string[] {
  const specsDir = getProjectSpecsDir(projectPath);

  if (!fs.existsSync(specsDir)) {
    return [];
  }

  const taskIds: string[] = [];
  const dirs = fs.readdirSync(specsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const dir of dirs) {
    // Skip archived tasks - they shouldn't be monitored for shutdown
    if (isTaskArchived(specsDir, dir)) {
      continue;
    }

    const planPath = path.join(specsDir, dir, 'implementation_plan.json');
    if (fs.existsSync(planPath)) {
      try {
        const mainContent = JSON.parse(fs.readFileSync(planPath, 'utf-8'));

        // Prefer worktree plan (has actual agent progress) over main (may be stale)
        const worktreeContent = getWorktreePlan(projectPath, dir);
        const content = worktreeContent || mainContent;
        const source = worktreeContent ? 'worktree' : 'main';

        // Tasks with error exitReason are NOT complete - need intervention (matches RDR logic)
        const hasErrorExit = content.exitReason === 'error' || content.exitReason === 'auth_failure' ||
            content.exitReason === 'prompt_loop' || content.exitReason === 'rate_limit_crash';

        // QA-approved at 100% — terminal if on correct board or completed lifecycle
        // ALSO requires qa_report.md to confirm QA validation actually ran (qa_signoff can be stale)
        const qaValidationPassed = isQaValidationComplete(specsDir, dir);
        if (isQaApprovedComplete(content) && qaValidationPassed) {
          const effectiveStatus = String(content.status || '');
          const isOnCorrectBoard = effectiveStatus === 'human_review' || effectiveStatus === 'done' || effectiveStatus === 'pr_created';
          const isCompletedLifecycle =
            (effectiveStatus === 'start_requested' || effectiveStatus === 'complete' || effectiveStatus === 'completed') &&
            (content.planStatus === 'completed' || content.planStatus === 'approved');
          const isSuccessfulExit = effectiveStatus === 'start_requested' && content.exitReason === 'success';

          if (isOnCorrectBoard || isCompletedLifecycle || isSuccessfulExit) {
            continue;
          }
        }

        if (!hasErrorExit) {
          // human_review + qa_signoff=approved + qa_report.md = QA validated and complete
          // qa_signoff alone can be stale from a previous cycle — qa_report.md proves QA ran
          const qaApproved = (content as any).qa_signoff?.status === 'approved';
          const qaValidated = qaApproved && qaValidationPassed;
          const isLegitHumanReview = content.status === 'human_review' && qaValidated;
          if (content.status === 'done' || content.status === 'pr_created' || isLegitHumanReview) {
            continue;
          }

          // start_requested + completed planStatus + QA approved + qa_report.md = lifecycle done
          if (content.status === 'start_requested' &&
              (content.planStatus === 'completed' || content.planStatus === 'approved') &&
              (content as any).qa_signoff?.status === 'approved' &&
              qaValidationPassed) {
            continue;
          }

          // complete/completed + approved planStatus = agent done + QA approved
          if ((content.status === 'complete' || content.status === 'completed') &&
              (content.planStatus === 'completed' || content.planStatus === 'approved')) {
            continue;
          }
        }

        taskIds.push(dir);
      } catch (e) {
        console.error(`[AutoShutdown] Failed to read ${planPath}:`, e);
      }
    }
  }

  return taskIds;
}

/**
 * Count tasks that are not in terminal status (done, pr_created) and not archived
 * Returns total count and how many are in human_review
 */
function countTasksByStatus(projectPath: string): { total: number } {
  const specsDir = getProjectSpecsDir(projectPath);

  if (!fs.existsSync(specsDir)) {
    return { total: 0 };
  }

  let total = 0;

  const dirs = fs.readdirSync(specsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const dir of dirs) {
    // Skip archived tasks - they shouldn't be counted for shutdown monitoring
    if (isTaskArchived(specsDir, dir)) {
      continue;
    }

    const planPath = path.join(specsDir, dir, 'implementation_plan.json');
    if (fs.existsSync(planPath)) {
      try {
        const mainContent = JSON.parse(fs.readFileSync(planPath, 'utf-8'));

        // Prefer worktree plan (has actual agent progress) over main (may be stale)
        const worktreeContent = getWorktreePlan(projectPath, dir);
        const content = worktreeContent || mainContent;
        const source = worktreeContent ? 'worktree' : 'main';

        // Tasks with error exitReason are NOT complete - need intervention (matches RDR logic)
        const hasErrorExit = content.exitReason === 'error' || content.exitReason === 'auth_failure' ||
            content.exitReason === 'prompt_loop' || content.exitReason === 'rate_limit_crash';

        // QA-approved at 100% — terminal if on correct board or completed lifecycle
        // ALSO requires qa_report.md to confirm QA validation actually ran (qa_signoff can be stale)
        const qaValidationPassed = isQaValidationComplete(specsDir, dir);
        if (isQaApprovedComplete(content) && qaValidationPassed) {
          const effectiveStatus = String(content.status || '');
          const isOnCorrectBoard = effectiveStatus === 'human_review' || effectiveStatus === 'done' || effectiveStatus === 'pr_created';
          const isCompletedLifecycle =
            (effectiveStatus === 'start_requested' || effectiveStatus === 'complete' || effectiveStatus === 'completed') &&
            (content.planStatus === 'completed' || content.planStatus === 'approved');
          const isSuccessfulExit = effectiveStatus === 'start_requested' && content.exitReason === 'success';

          if (isOnCorrectBoard || isCompletedLifecycle || isSuccessfulExit) {
            continue;
          }
        }

        if (!hasErrorExit) {
          // human_review + qa_signoff=approved + qa_report.md = QA validated and complete
          // qa_signoff alone can be stale from a previous cycle — qa_report.md proves QA ran
          const qaApproved = (content as any).qa_signoff?.status === 'approved';
          const qaValidated = qaApproved && qaValidationPassed;
          const isLegitHumanReview = content.status === 'human_review' && qaValidated;
          if (content.status === 'done' || content.status === 'pr_created' || isLegitHumanReview) {
            continue;
          }

          // start_requested + completed planStatus + QA approved + qa_report.md = lifecycle done
          if (content.status === 'start_requested' &&
              (content.planStatus === 'completed' || content.planStatus === 'approved') &&
              (content as any).qa_signoff?.status === 'approved' &&
              qaValidationPassed) {
            continue;
          }

          // complete/completed + approved planStatus = agent done + QA approved
          if ((content.status === 'complete' || content.status === 'completed') &&
              (content.planStatus === 'completed' || content.planStatus === 'approved')) {
            continue;
          }
        }

        total++;
      } catch (e) {
        console.error(`[AutoShutdown] Failed to read ${planPath}:`, e);
      }
    }
  }

  console.log(`[AutoShutdown] Total incomplete tasks: ${total}`);
  return { total };
}

/**
 * Get global auto-shutdown status across ALL projects
 * When monitoring is active, recalculates task count live from disk
 */
ipcMain.handle(
  IPC_CHANNELS.GET_AUTO_SHUTDOWN_STATUS,
  async (_): Promise<IPCResult<AutoShutdownStatus>> => {
    try {
      const cached = monitorStatuses.get('global');

      // If monitoring is active, recalculate task count live from ALL projects
      if (cached?.monitoring) {
        // Verify monitor process is still running
        const monitorProcess = monitorProcesses.get('global');
        if (!monitorProcess || monitorProcess.killed || monitorProcess.exitCode !== null) {
          console.log(`[AutoShutdown] Monitor process died - resetting status (exitCode=${monitorProcess?.exitCode}, killed=${monitorProcess?.killed})`);
          monitorProcesses.delete('global');
          const resetStatus: AutoShutdownStatus = {
            enabled: false,
            monitoring: false,
            tasksRemaining: 0,
            shutdownPending: false
          };
          monitorStatuses.set('global', resetStatus);
          return { success: true, data: resetStatus };
        }

        const projects = projectStore.getProjects();
        let totalTasks = 0;

        for (const project of projects) {
          const { total } = countTasksByStatus(project.path);
          totalTasks += total;
        }

        const updatedStatus: AutoShutdownStatus = {
          ...cached,
          tasksRemaining: totalTasks,
        };
        monitorStatuses.set('global', updatedStatus);
        return { success: true, data: updatedStatus };
      }

      if (cached) {
        return { success: true, data: cached };
      }

      // Default status
      const status: AutoShutdownStatus = {
        enabled: false,
        monitoring: false,
        tasksRemaining: 0,
        shutdownPending: false
      };

      return { success: true, data: status };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[AutoShutdown] Failed to get status:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }
);

/**
 * Start the shutdown monitor process across all projects.
 * Extracted so it can be called from both the IPC handler and initAutoShutdown().
 */
async function startMonitorProcess(persistSetting = true): Promise<IPCResult<AutoShutdownStatus>> {
  const projects = projectStore.getProjects();

  if (projects.length === 0) {
    return {
      success: false,
      error: 'No projects available to monitor'
    };
  }

  // Count total active tasks across all projects
  const projectPaths = projects.map(p => p.path);
  let totalActiveTasks = 0;

  for (const projectPath of projectPaths) {
    const activeTaskIds = getActiveTaskIds(projectPath);
    totalActiveTasks += activeTaskIds.length;
  }

  if (totalActiveTasks === 0) {
    console.log('[AutoShutdown] No active tasks - monitor will trigger shutdown on first poll');
  }

  // Kill existing global process if any
  const existingProcess = monitorProcesses.get('global');
  if (existingProcess) {
    existingProcess.kill();
    monitorProcesses.delete('global');
  }

  // Get script path
  const appPath = app.getAppPath();
  console.log(`[AutoShutdown] App path: ${appPath}`);

  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'scripts', 'shutdown-monitor.ts')
    : path.resolve(appPath, '..', '..', '..', '..', 'scripts', 'shutdown-monitor.ts');

  console.log(`[AutoShutdown] Script path: ${scriptPath}`);
  console.log(`[AutoShutdown] Script exists: ${fs.existsSync(scriptPath)}`);

  if (!fs.existsSync(scriptPath)) {
    return {
      success: false,
      error: `Shutdown monitor script not found at: ${scriptPath}`
    };
  }

  // Build args for monitor script with ALL project paths
  // Use Node's built-in TypeScript support (--experimental-strip-types)
  // No tsx dependency needed, no shell = no terminal popup on Windows
  const args = [
    '--experimental-strip-types',
    '--no-warnings',
    scriptPath,
    '--delay-seconds', '120',
    ...projectPaths.flatMap(p => ['--project-path', p])
  ];

  // Spawn via Electron as Node (ELECTRON_RUN_AS_NODE=1)
  const monitorProcess = spawn(
    process.execPath,
    args,
    {
      cwd: projectPaths[0],
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    }
  );

  // Suppress normal polling output (only log errors via stderr)
  monitorProcess.stdout?.on('data', () => {
    // Suppress to reduce noise
  });

  monitorProcess.stderr?.on('data', (data) => {
    console.error(`[AutoShutdown:global]`, data.toString().trim());
  });

  monitorProcess.on('exit', (code, signal) => {
    console.log(`[AutoShutdown:global] Monitor exited with code ${code}, signal ${signal}`);
    monitorProcesses.delete('global');

    if (code === 0) {
      // Monitor detected all tasks complete and triggered shutdown
      if (Notification.isSupported()) {
        new Notification({
          title: 'Auto-Shutdown Armed',
          body: 'All tasks complete! System will shut down in 2 minutes. Run "shutdown /a" to abort.',
          urgency: 'critical'
        }).show();
      }
    }

    const status: AutoShutdownStatus = {
      enabled: false,
      monitoring: false,
      tasksRemaining: 0,
      shutdownPending: false
    };
    monitorStatuses.set('global', status);
  });

  monitorProcess.unref();
  monitorProcesses.set('global', monitorProcess);

  // Get initial task count across all projects
  let totalTasks = 0;
  for (const project of projects) {
    const { total } = countTasksByStatus(project.path);
    totalTasks += total;
  }

  const status: AutoShutdownStatus = {
    enabled: true,
    monitoring: true,
    tasksRemaining: totalTasks,
    shutdownPending: false
  };
  monitorStatuses.set('global', status);

  if (persistSetting) {
    const settings = readSettingsFile() || {};
    writeSettingsFile({
      ...settings,
      autoShutdownEnabled: true
    });
  }

  console.log(`[AutoShutdown] Monitoring ${projects.length} projects with ${totalActiveTasks} active tasks`);

  return { success: true, data: status };
}

/**
 * Enable/disable auto-shutdown GLOBALLY across ALL projects
 */
ipcMain.handle(
  IPC_CHANNELS.SET_AUTO_SHUTDOWN,
  async (_, enabled: boolean): Promise<IPCResult<AutoShutdownStatus>> => {
    try {
      if (enabled) {
        const result = await startMonitorProcess();
        return result;
      } else {
        // Stop monitoring
        const process = monitorProcesses.get('global');
        if (process) {
          process.kill();
          monitorProcesses.delete('global');
        }

        const status: AutoShutdownStatus = {
          enabled: false,
          monitoring: false,
          tasksRemaining: 0,
          shutdownPending: false
        };
        monitorStatuses.set('global', status);

        // Persist to settings
        const settings = readSettingsFile() || {};
        writeSettingsFile({
          ...settings,
          autoShutdownEnabled: false
        });

        return { success: true, data: status };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[AutoShutdown] Failed to set auto-shutdown:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }
);

/**
 * Cancel pending shutdown (global)
 */
ipcMain.handle(
  IPC_CHANNELS.CANCEL_AUTO_SHUTDOWN,
  async (_): Promise<IPCResult<void>> => {
    try {
      // Kill global monitor process if running
      const process = monitorProcesses.get('global');
      if (process) {
        process.kill();
        monitorProcesses.delete('global');
      }

      // Cancel system shutdown (Windows)
      if (process.platform === 'win32') {
        spawn('shutdown', ['/a'], { shell: true });
      }

      // Update status
      const status: AutoShutdownStatus = {
        enabled: false,
        monitoring: false,
        tasksRemaining: 0,
        shutdownPending: false
      };
      monitorStatuses.set('global', status);

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[AutoShutdown] Failed to cancel shutdown:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }
);

// Clean up on app quit
app.on('before-quit', () => {
  for (const process of monitorProcesses.values()) {
    process.kill();
  }
  monitorProcesses.clear();
});

/**
 * Restore auto-shutdown on app startup if it was previously enabled.
 * Called from ipc-handlers/index.ts after all handlers are registered.
 */
export function initAutoShutdown(): void {
  const settings = readSettingsFile();
  if (!settings?.autoShutdownEnabled) return;

  console.log('[AutoShutdown] Restoring from saved settings...');
  startMonitorProcess(false).catch(err =>
    console.error('[AutoShutdown] Failed to restore monitor on startup:', err)
  );
}
