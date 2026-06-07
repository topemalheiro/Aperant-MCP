#!/usr/bin/env npx tsx
/**
 * Shutdown Monitor (Global)
 *
 * Watches Auto-Claude tasks across MULTIPLE projects and triggers shutdown
 * when ALL active tasks across ALL projects are complete.
 *
 * A task is "complete" when:
 * - status is 'done' or 'pr_created' (terminal)
 * - ANY non-initial status at 100% subtask completion (agents may finish but not transition)
 * - task is archived (has archivedAt in task_metadata.json)
 *
 * Usage:
 *   npx tsx scripts/shutdown-monitor.ts --project-path /path/to/project1 --project-path /path/to/project2 [--delay-seconds 120]
 *
 * Monitors ALL non-done tasks across all specified projects.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const POLL_INTERVAL_MS = 5000; // Check every 5 seconds

interface TaskStatus {
  taskId: string;
  status: string;
  feature: string;
  projectPath: string;
  source: 'worktree' | 'main';
  progress: number;
}

// (hasSeenActiveTasks state is tracked in poll() and passed to areAllTasksComplete)

/**
 * Check if a task is archived by reading task_metadata.json.
 * Archived tasks have an archivedAt field set to an ISO date string.
 */
function isTaskArchived(projectPath: string, taskId: string): boolean {
  const metadataPath = path.join(projectPath, '.auto-claude', 'specs', taskId, 'task_metadata.json');
  try {
    if (!fs.existsSync(metadataPath)) return false;
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    if (metadata.archivedAt) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Calculate task completion percentage from phases/subtasks.
 * Returns 100 if all subtasks are completed, 0 if no subtasks.
 * Matches the logic in auto-shutdown-handlers.ts.
 */
function calculateTaskProgress(plan: any): number {
  if (!plan.phases || plan.phases.length === 0) return 0;

  const allSubtasks = plan.phases.flatMap((phase: any) =>
    phase.subtasks || phase.chunks || []
  ).filter(Boolean);

  if (allSubtasks.length === 0) {
    return plan.phases.every((p: any) => p.status === 'completed') ? 100 : 0;
  }

  const completed = allSubtasks.filter((s: any) => s.status === 'completed').length;
  return Math.round((completed / allSubtasks.length) * 100);
}

/**
 * Check if a task is QA-approved at 100% completion.
 * qa_signoff.status='approved' with all subtasks done = definitively DONE.
 */
function isQaApprovedComplete(content: any): boolean {
  if (content.qa_signoff?.status !== 'approved') return false;
  if (!content.phases || content.phases.length === 0) return false;

  const allSubtasks = content.phases.flatMap((p: any) => p.subtasks || []);
  if (allSubtasks.length === 0) return false;

  const completed = allSubtasks.filter((s: any) => s.status === 'completed').length;
  return completed === allSubtasks.length;
}

/**
 * Get worktree plan if it exists (agent writes progress to worktree).
 * Worktree path: <project>/.auto-claude/worktrees/tasks/<taskId>/.auto-claude/specs/<taskId>/implementation_plan.json
 */
function getWorktreePlan(projectPath: string, taskId: string): any | null {
  const worktreePlanPath = path.join(
    projectPath, '.auto-claude', 'worktrees', 'tasks', taskId,
    '.auto-claude', 'specs', taskId, 'implementation_plan.json'
  );

  if (!fs.existsSync(worktreePlanPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(worktreePlanPath, 'utf-8'));
  } catch (e) {
    console.error(`[Monitor] Failed to read worktree plan for ${taskId}:`, e);
    return null;
  }
}

/**
 * Get task statuses across MULTIPLE projects.
 * Skips archived tasks. Prefers worktree plans over main plans.
 * Includes progress calculation for each task.
 */
function getTaskStatuses(projectPaths: string[]): TaskStatus[] {
  const statuses: TaskStatus[] = [];

  for (const projectPath of projectPaths) {
    const specsDir = path.join(projectPath, '.auto-claude', 'specs');

    if (!fs.existsSync(specsDir)) {
      console.log(`[Monitor] Specs directory not found: ${specsDir}`);
      continue;
    }

    const dirs = fs.readdirSync(specsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const dir of dirs) {
      // Skip archived tasks - they shouldn't be monitored
      if (isTaskArchived(projectPath, dir)) continue;

      const planPath = path.join(specsDir, dir, 'implementation_plan.json');
      if (fs.existsSync(planPath)) {
        try {
          const mainContent = JSON.parse(fs.readFileSync(planPath, 'utf-8'));

          // Prefer worktree plan (has actual agent progress) over main (may be stale)
          const worktreeContent = getWorktreePlan(projectPath, dir);
          const content = worktreeContent || mainContent;
          const source: 'worktree' | 'main' = worktreeContent ? 'worktree' : 'main';

          // Tasks with error exitReason stay as-is (NOT complete, matches RDR logic)
          const hasErrorExit = content.exitReason === 'error' || content.exitReason === 'auth_failure' ||
              content.exitReason === 'prompt_loop' || content.exitReason === 'rate_limit_crash';

          // Normalize non-standard statuses to terminal for shutdown purposes
          let effectiveStatus = content.status || 'unknown';

          // QA-approved at 100% — terminal if on correct board or completed lifecycle
          // exitReason is a session-level artifact, not work-quality — if QA approved, work IS done
          if (isQaApprovedComplete(content)) {
            const isOnCorrectBoard = effectiveStatus === 'human_review' || effectiveStatus === 'done' || effectiveStatus === 'pr_created';
            const isCompletedLifecycle =
              (effectiveStatus === 'start_requested' || effectiveStatus === 'complete' || effectiveStatus === 'completed') &&
              (content.planStatus === 'completed' || content.planStatus === 'approved');
            // QA approved + successful exit = genuinely done regardless of planStatus
            const isSuccessfulExit = effectiveStatus === 'start_requested' && content.exitReason === 'success';

            if (isOnCorrectBoard || isCompletedLifecycle || isSuccessfulExit) {
              effectiveStatus = 'human_review'; // Treat as terminal
            }
          }

          // Note: 'approved' is a non-standard worktree status — NOT treated as terminal here.
          // The isQaApprovedComplete() check above handles QA-approved tasks properly
          // (requires correct board position or completed lifecycle).

          if (!hasErrorExit) {
            if (effectiveStatus === 'start_requested' &&
                (content.planStatus === 'completed' || content.planStatus === 'approved')) {
              effectiveStatus = 'human_review';
            }
            if ((effectiveStatus === 'complete' || effectiveStatus === 'completed') &&
                (content.planStatus === 'completed' || content.planStatus === 'approved')) {
              effectiveStatus = 'human_review';
            }
          }

          statuses.push({
            taskId: dir,
            status: effectiveStatus,
            feature: content.feature || dir,
            projectPath,
            source,
            progress: calculateTaskProgress(content),
          });
        } catch (e) {
          console.error(`[Monitor] Failed to read ${planPath}:`, e);
        }
      }
    }
  }

  return statuses;
}

// Track previous state for state-change-only logging
let previousTaskCount = 0;
let previousCompleteCount = 0;

/**
 * Check if all tasks are complete.
 *
 * A task is complete if:
 * - status is 'done' or 'pr_created' (terminal)
 * - status is 'human_review' with 100% progress (all subtasks done)
 *
 * Returns true when no active (incomplete) tasks remain AND we've seen tasks before.
 * This prevents triggering on an empty project with no tasks.
 */
function areAllTasksComplete(statuses: TaskStatus[], hasSeenActiveTasks: boolean): { complete: boolean; hasActive: boolean } {
  // Complete = done, pr_created, or human_review (QA passed, ready for human)
  // ai_review is NOT complete - QA validation is still running
  const completeTasks = statuses.filter(s =>
    s.status === 'done' || s.status === 'pr_created' || s.status === 'human_review'
  );

  // Active = everything else
  const activeTasks = statuses.filter(s =>
    s.status !== 'done' && s.status !== 'pr_created' && s.status !== 'human_review'
  );

  const hasActive = activeTasks.length > 0;

  // Only log if count changed (reduce polling spam from every 5s to state changes only)
  if (statuses.length !== previousTaskCount || completeTasks.length !== previousCompleteCount) {
    // Log status grouped by project
    const byProject = new Map<string, TaskStatus[]>();
    for (const task of statuses) {
      const name = path.basename(task.projectPath);
      if (!byProject.has(name)) byProject.set(name, []);
      byProject.get(name)!.push(task);
    }

    console.log(`[Monitor] ${statuses.length} tasks: ${completeTasks.length} complete, ${activeTasks.length} active`);
    Array.from(byProject.entries()).forEach(([projectName, tasks]) => {
      console.log(`  Project: ${projectName}`);
      tasks.forEach(task => {
        const isComplete = task.status === 'done' || task.status === 'pr_created' || task.status === 'human_review';
        console.log(`    - ${task.taskId}: ${task.status} [${task.source}] ${isComplete ? 'DONE' : '...'}`);
      });
    });

    previousTaskCount = statuses.length;
    previousCompleteCount = completeTasks.length;
  }

  // All active tasks gone AND we've seen tasks before → all work complete
  if (activeTasks.length === 0 && (hasSeenActiveTasks || statuses.length > 0)) {
    console.log(`[Monitor] ALL tasks complete! (${completeTasks.length} done/human_review)`);
    return { complete: true, hasActive };
  }

  return { complete: false, hasActive };
}

function triggerShutdown(command: string): void {
  console.log(`\n[Monitor] ALL TASKS COMPLETE!`);
  console.log(`[Monitor] Executing shutdown command: ${command}`);
  console.log(`[Monitor] Run "shutdown /a" (Windows) or "sudo shutdown -c" (Unix) to abort!\n`);

  // Parse command string into command + args
  // Example: "shutdown /s /t 120" -> ["shutdown", "/s", "/t", "120"]
  const parts = command.split(' ').filter(Boolean);
  const cmd = parts[0];
  const cmdArgs = parts.slice(1);

  spawn(cmd, cmdArgs, {
    shell: true,
    detached: true,
    stdio: 'ignore'
  }).unref();
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments - support MULTIPLE --project-path arguments
  const projectPaths: string[] = [];
  let delaySeconds = 120;
  let shutdownCommand: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--delay-seconds' && args[i + 1]) {
      delaySeconds = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--project-path' && args[i + 1]) {
      projectPaths.push(args[i + 1]);
      i++; // Skip the next arg (the path value)
    } else if (args[i] === '--shutdown-command' && args[i + 1]) {
      shutdownCommand = args[i + 1];
      i++; // Skip the next arg (the command value)
    }
  }

  if (projectPaths.length === 0) {
    console.error('[Monitor] No project paths provided! Use --project-path <path>');
    process.exit(1);
  }

  // Use custom shutdown command or platform default
  if (!shutdownCommand) {
    switch (process.platform) {
      case 'win32':
        shutdownCommand = `shutdown /s /t ${delaySeconds}`;
        break;
      case 'darwin':
        shutdownCommand = `sudo shutdown -h +${Math.ceil(delaySeconds / 60)}`;
        break;
      default:
        shutdownCommand = `shutdown -h +${Math.ceil(delaySeconds / 60)}`;
    }
  }

  console.log('[Monitor] Starting GLOBAL shutdown monitor...');
  console.log('[Monitor] Monitoring projects:');
  for (const projectPath of projectPaths) {
    console.log(`  - ${projectPath}`);
  }
  console.log('[Monitor] Shutdown command:', shutdownCommand);
  console.log('[Monitor] Poll interval:', POLL_INTERVAL_MS / 1000, 'seconds');
  console.log('');

  let seenActive = false;

  const poll = () => {
    const statuses = getTaskStatuses(projectPaths);

    if (statuses.length === 0) {
      console.log('[Monitor] No tasks found across all projects, waiting...');
      setTimeout(poll, POLL_INTERVAL_MS);
      return;
    }

    const result = areAllTasksComplete(statuses, seenActive);
    if (result.hasActive) {
      seenActive = true;
    }

    if (result.complete) {
      triggerShutdown(shutdownCommand);
      process.exit(0);
    } else {
      setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  // Start polling
  poll();
}

main().catch(err => {
  console.error('[Monitor] Fatal error:', err);
  process.exit(1);
});
