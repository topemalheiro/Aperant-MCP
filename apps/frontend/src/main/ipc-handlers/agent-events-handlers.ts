import type { BrowserWindow } from "electron";
import path from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { IPC_CHANNELS, AUTO_BUILD_PATHS, getSpecsDir } from "../../shared/constants";
import type {
  SDKRateLimitInfo,
  AuthFailureInfo,
  ImplementationPlan,
  TaskExitReason,
  TaskRateLimitInfo,
} from "../../shared/types";
import { XSTATE_SETTLED_STATES, XSTATE_TO_PHASE, mapStateToLegacy } from "../../shared/state-machines";
import { AgentManager } from "../agent";
import type { ProcessType, ExecutionProgressData } from "../agent";
import { titleGenerator } from "../title-generator";
import { fileWatcher } from "../file-watcher";
import { notificationService } from "../notification-service";
import { persistPlanLastEventSync, getPlanPath, persistPlanPhaseSync, persistPlanStatusAndReasonSync } from "./task/plan-file-utils";
import { findTaskWorktree } from "../worktree-paths";
import { findTaskAndProject } from "./task/shared";
import { safeSendToRenderer } from "./utils";
import { getClaudeProfileManager } from "../claude-profile-manager";
import { taskStateManager } from "../task-state-manager";
import {
  getRateLimitForTask,
  clearRateLimitForTask,
  setRateLimitForTask,
} from "../rate-limit-detector";
import { startRateLimitWaitForTask } from "../rate-limit-waiter";
import { queueTaskForRdr } from "./rdr-handlers";
import { activityMonitor } from "../activity-monitor";
import { projectStore } from "../project-store";
import { getUsageMonitor } from "../claude-profile/usage-monitor";

/**
 * Register all agent-events-related IPC handlers
 */
export function registerAgenteventsHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  taskStateManager.configure(getMainWindow);

  // ============================================
  // Agent Manager Events → Renderer
  // ============================================

  // Track repeated log lines per task to suppress rate limit spam
  const lastLogByTask = new Map<string, { line: string; count: number; timestamp: number }>();

  agentManager.on("log", (taskId: string, log: string, projectId?: string) => {
    // Use projectId from event when available; fall back to lookup for backward compatibility
    if (!projectId) {
      const { project } = findTaskAndProject(taskId);
      projectId = project?.id;
    }

    // Deduplicate repeated lines (e.g., "You've hit your limit" every ~20s during rate limit waits)
    const trimmed = log.trim();
    const cached = lastLogByTask.get(taskId);
    if (cached && cached.line === trimmed && Date.now() - cached.timestamp < 120_000) {
      // Same line repeated within 2 minutes — suppress
      cached.count++;
      cached.timestamp = Date.now();
      return;
    }

    // Different line or first occurrence — flush suppression count if any, then send
    if (cached && cached.count > 1) {
      safeSendToRenderer(
        getMainWindow,
        IPC_CHANNELS.TASK_LOG,
        taskId,
        `[Previous message repeated ${cached.count - 1} more time${cached.count > 2 ? "s" : ""}]\n`,
        projectId
      );
    }

    lastLogByTask.set(taskId, { line: trimmed, count: 1, timestamp: Date.now() });
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_LOG, taskId, log, projectId);
  });

  agentManager.on("error", (taskId: string, error: string, projectId?: string) => {
    // Use projectId from event when available; fall back to lookup for backward compatibility
    if (!projectId) {
      const { project } = findTaskAndProject(taskId);
      projectId = project?.id;
    }
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_ERROR, taskId, error, projectId);
  });

  // Handle SDK rate limit events from agent manager
  agentManager.on("sdk-rate-limit", (rateLimitInfo: SDKRateLimitInfo) => {
    // Store rate limit for task so exit handler can detect rate limit crash
    if (rateLimitInfo.taskId) {
      console.warn(`[AgentEvents] Storing rate limit for task ${rateLimitInfo.taskId}`);
      setRateLimitForTask(rateLimitInfo.taskId, rateLimitInfo);
    }
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.CLAUDE_SDK_RATE_LIMIT, rateLimitInfo);

    // Force usage meter to 100% immediately — closes polling gap
    getUsageMonitor().forceSessionLimit();
  });

  // Handle SDK rate limit events from title generator
  titleGenerator.on("sdk-rate-limit", (rateLimitInfo: SDKRateLimitInfo) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.CLAUDE_SDK_RATE_LIMIT, rateLimitInfo);
  });

  // Handle auth failure events (401 errors requiring re-authentication)
  agentManager.on("auth-failure", (taskId: string, authFailure: {
    profileId?: string;
    failureType?: 'missing' | 'invalid' | 'expired' | 'unknown';
    message?: string;
    originalError?: string;
  }) => {
    console.warn(`[AgentEvents] Auth failure detected for task ${taskId}:`, authFailure);

    // Get profile name for display
    const profileManager = getClaudeProfileManager();
    const profile = authFailure.profileId
      ? profileManager.getProfile(authFailure.profileId)
      : profileManager.getActiveProfile();

    const authFailureInfo: AuthFailureInfo = {
      profileId: authFailure.profileId || profile?.id || 'unknown',
      profileName: profile?.name,
      failureType: authFailure.failureType || 'unknown',
      message: authFailure.message || 'Authentication failed. Please re-authenticate.',
      originalError: authFailure.originalError,
      taskId,
      detectedAt: new Date(),
    };

    safeSendToRenderer(getMainWindow, IPC_CHANNELS.CLAUDE_AUTH_FAILURE, authFailureInfo);
  });

  agentManager.on("exit", (taskId: string, code: number | null, processType: ProcessType, projectId?: string) => {
    activityMonitor.recordActivity('agent-exited');

    // Use projectId from event to scope the lookup (prevents cross-project contamination)
    const { task: exitTask, project: exitProject } = findTaskAndProject(taskId, projectId);
    const exitProjectId = exitProject?.id || projectId;

    // Check if this was a rate limit exit BEFORE telling XState
    // Rate limit = temporary pause, not an error — task should stay on current board
    const isRateLimitExit = code !== 0 && code !== null ? !!getRateLimitForTask(taskId) : false;

    if (isRateLimitExit) {
      console.warn(`[Task ${taskId}] Rate limit exit (code ${code}) — keeping task on current board, skipping XState PROCESS_EXITED`);
    } else {
      taskStateManager.handleProcessExited(taskId, code, exitTask, exitProject);
    }

    // Send final plan state to renderer BEFORE unwatching
    // This ensures the renderer has the final subtask data (fixes 0/0 subtask bug)
    const finalPlan = fileWatcher.getCurrentPlan(taskId);
    if (finalPlan) {
      safeSendToRenderer(
        getMainWindow,
        IPC_CHANNELS.TASK_PROGRESS,
        taskId,
        finalPlan,
        exitProjectId
      );
    }

    fileWatcher.unwatch(taskId);

    if (processType === "spec-creation") {
      console.warn(`[Task ${taskId}] Spec creation completed with code ${code}`);
      return;
    }

    const { task, project } = findTaskAndProject(taskId, projectId);
    if (!task || !project) return;

    const taskTitle = task.title || task.specId;
    if (code === 0) {
      notificationService.notifyReviewNeeded(taskTitle, project.id, taskId);
    } else {
      // Non-zero exit code - check if this was a rate limit crash
      const rateLimitInfo = getRateLimitForTask(taskId);

      if (rateLimitInfo) {
        const exitReason: TaskExitReason = 'rate_limit_crash';
        console.warn(`[Task ${taskId}] Task crashed due to rate limit - will auto-resume when limit resets`);

        // Persist rate limit info to plan
        try {
          const mainPlanPath = getPlanPath(project, task);
          const planContent = readFileSync(mainPlanPath, 'utf-8');
          const plan = JSON.parse(planContent);
          plan.exitReason = exitReason;
          plan.rateLimitInfo = {
            resetAt: rateLimitInfo.resetAtDate?.toISOString(),
            limitType: rateLimitInfo.limitType,
            profileId: rateLimitInfo.profileId,
            detectedAt: rateLimitInfo.detectedAt.toISOString(),
          } as TaskRateLimitInfo;
          writeFileSync(mainPlanPath, JSON.stringify(plan, null, 2));
          console.warn(`[Task ${taskId}] Persisted rate limit crash info to plan`);
        } catch (err) {
          console.error(`[Task ${taskId}] Failed to persist rate limit info:`, err);
        }

        // Check if auto-resume is enabled in per-project settings (not global)
        const autoResumeEnabled = project?.settings?.autoResumeAfterRateLimit === true;

        // Start auto-wait for rate limit reset (only if enabled)
        if (autoResumeEnabled) {
          const capturedProjectId = project.id;
          const mainWindow = getMainWindow();
          startRateLimitWaitForTask(taskId, rateLimitInfo, mainWindow, () => {
            console.warn(`[Task ${taskId}] Rate limit reset - task can now be resumed`);
            clearRateLimitForTask(taskId);

            // Trigger RDR to send prompt to Claude Code for auto-recovery
            console.warn(`[Task ${taskId}] Triggering RDR processing after rate limit reset`);
            const taskInfo = {
              specId: taskId,
              status: 'human_review' as const,
              reviewReason: 'rate_limit_reset',
              description: `Rate limit reset at ${new Date().toISOString()}. Task ready to resume.`,
              subtasks: []
            };
            queueTaskForRdr(capturedProjectId, taskInfo);
          });
          console.warn(`[Task ${taskId}] Auto-resume enabled - waiting for rate limit reset`);
        } else {
          console.warn(`[Task ${taskId}] Auto-resume disabled - task will stay in Human Review until manually resumed`);
          clearRateLimitForTask(taskId);
        }

        // Notify renderer that task crashed due to rate limit
        safeSendToRenderer(
          getMainWindow,
          IPC_CHANNELS.TASK_RATE_LIMIT_CRASH,
          taskId,
          project.id,
          { ...rateLimitInfo, autoResumeEnabled }
        );

        notificationService.notify(
          'Task Paused - Rate Limit',
          autoResumeEnabled
            ? `${taskTitle} paused due to rate limit. Will auto-resume when limit resets.`
            : `${taskTitle} paused due to rate limit. Manual restart required (auto-resume disabled).`,
          { type: 'info' }
        );
      } else {
        // Regular error - not rate limit
        notificationService.notifyTaskFailed(taskTitle, project.id, taskId);

        // Persist exit reason to plan
        try {
          const mainPlanPath = getPlanPath(project, task);
          const planContent = readFileSync(mainPlanPath, 'utf-8');
          const plan = JSON.parse(planContent);
          plan.exitReason = 'error';
          writeFileSync(mainPlanPath, JSON.stringify(plan, null, 2));
        } catch (err) {
          console.error(`[Task ${taskId}] Failed to persist exit reason:`, err);
        }
      }
    }
  });

  agentManager.on("task-event", (taskId: string, event, projectId?: string) => {
    console.debug(`[agent-events-handlers] Received task-event for ${taskId}:`, event.type, event);

    if (taskStateManager.getLastSequence(taskId) === undefined) {
      const { task, project } = findTaskAndProject(taskId, projectId);
      if (task && project) {
        try {
          const planPath = getPlanPath(project, task);
          const planContent = readFileSync(planPath, "utf-8");
          const plan = JSON.parse(planContent);
          const lastSeq = plan?.lastEvent?.sequence;
          if (typeof lastSeq === "number" && lastSeq >= 0) {
            taskStateManager.setLastSequence(taskId, lastSeq);
          }
        } catch {
          // Ignore missing/invalid plan files
        }
      }
    }

    const { task, project } = findTaskAndProject(taskId, projectId);
    if (!task || !project) {
      console.debug(`[agent-events-handlers] No task/project found for ${taskId}`);
      return;
    }

    console.debug(`[agent-events-handlers] Task state before handleTaskEvent:`, {
      status: task.status,
      reviewReason: task.reviewReason,
      phase: task.executionProgress?.phase
    });

    const accepted = taskStateManager.handleTaskEvent(taskId, event, task, project);
    console.debug(`[agent-events-handlers] Event ${event.type} accepted: ${accepted}`);
    if (!accepted) {
      return;
    }

    const mainPlanPath = getPlanPath(project, task);
    persistPlanLastEventSync(mainPlanPath, event);

    const worktreePath = findTaskWorktree(project.path, task.specId);
    if (worktreePath) {
      const specsBaseDir = getSpecsDir(project.autoBuildPath);
      const worktreePlanPath = path.join(
        worktreePath,
        specsBaseDir,
        task.specId,
        AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN
      );
      if (existsSync(worktreePlanPath)) {
        persistPlanLastEventSync(worktreePlanPath, event);
      }
    }
  });

  agentManager.on("execution-progress", (taskId: string, progress: ExecutionProgressData, projectId?: string) => {
    activityMonitor.recordActivity('execution-progress');

    // Use projectId from event to scope the lookup (prevents cross-project contamination)
    const { task, project } = findTaskAndProject(taskId, projectId);
    const taskProjectId = project?.id || projectId;

    // Check if XState has already established a terminal/review state for this task.
    // XState is the source of truth for status. When XState is in a terminal state
    // (e.g., plan_review after PLANNING_COMPLETE), execution-progress events from the
    // agent process are stale and must not overwrite XState's persisted status.
    //
    // Example: When requireReviewBeforeCoding=true, the process exits with code 1 after
    // PLANNING_COMPLETE. The exit handler emits execution-progress with phase='failed',
    // which would incorrectly overwrite status='human_review' with status='error' via
    // persistPlanPhaseSync, and send a 'failed' phase to the renderer overwriting the
    // 'planning' phase that XState already emitted via emitPhaseFromState.
    const currentXState = taskStateManager.getCurrentState(taskId);
    const xstateInTerminalState = currentXState && XSTATE_SETTLED_STATES.has(currentXState);
    // Guard: When XState is in QA state (qa_review/qa_fixing), don't let stale phase
    // events (e.g., 'planning' from agent startup) overwrite the correct ai_review
    // status on disk via persistPlanPhaseSync. Without this guard, the agent's initial
    // execution-progress (phase: 'planning') maps to status 'in_progress' and overwrites
    // the ai_review that FORCE_AI_REVIEW correctly set.
    const xstateInQAState = currentXState === 'qa_review' || currentXState === 'qa_fixing';

    // Persist phase to plan file for restoration on app refresh
    // Must persist to BOTH main project and worktree (if exists) since task may be loaded from either
    // Skip when XState is in terminal state (stale events) or QA state (prevents ai_review overwrite)
    if (task && project && progress.phase && !xstateInTerminalState && !xstateInQAState) {
      const mainPlanPath = getPlanPath(project, task);
      persistPlanPhaseSync(mainPlanPath, progress.phase, project.id);

      // Also persist to worktree if task has one
      const worktreePath = findTaskWorktree(project.path, task.specId);
      if (worktreePath) {
        const specsBaseDir = getSpecsDir(project.autoBuildPath);
        const worktreePlanPath = path.join(
          worktreePath,
          specsBaseDir,
          task.specId,
          AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN
        );
        if (existsSync(worktreePlanPath)) {
          persistPlanPhaseSync(worktreePlanPath, progress.phase, project.id);
        }
      }
    } else if (xstateInTerminalState && progress.phase) {
      console.debug(`[agent-events-handlers] Skipping persistPlanPhaseSync for ${taskId}: XState in '${currentXState}', not overwriting with phase '${progress.phase}'`);
    } else if (xstateInQAState && progress.phase) {
      console.debug(`[agent-events-handlers] Skipping persistPlanPhaseSync for ${taskId}: XState in QA state '${currentXState}', not overwriting ai_review with phase '${progress.phase}'`);
    }

    // Skip sending execution-progress to renderer when XState has settled.
    // XState's emitPhaseFromState already sent the correct phase to the renderer.
    // QA states still receive progress updates for display.
    if (xstateInTerminalState) {
      console.debug(`[agent-events-handlers] Skipping execution-progress to renderer for ${taskId}: XState in '${currentXState}', ignoring phase '${progress.phase}'`);
      return;
    }
    safeSendToRenderer(
      getMainWindow,
      IPC_CHANNELS.TASK_EXECUTION_PROGRESS,
      taskId,
      progress,
      taskProjectId
    );
  });

  // ============================================
  // File Watcher Events → Renderer
  // ============================================

  fileWatcher.on("progress", (taskId: string, plan: ImplementationPlan) => {
    // File watcher events don't carry projectId — fall back to lookup
    const { task, project } = findTaskAndProject(taskId);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_PROGRESS, taskId, plan, project?.id);

    // Re-stamp XState status fields if the backend overwrote the plan file without them.
    // The planner agent writes implementation_plan.json via the Write tool, which replaces
    // the entire file and strips the frontend's status/xstateState/executionPhase fields.
    // This causes tasks to snap back to backlog on refresh.
    const planWithStatus = plan as { xstateState?: string; executionPhase?: string; status?: string };
    const currentXState = taskStateManager.getCurrentState(taskId);
    if (currentXState && !planWithStatus.xstateState && task && project) {
      console.debug(`[agent-events-handlers] Re-stamping XState status on plan file for ${taskId} (state: ${currentXState})`);
      const mainPlanPath = getPlanPath(project, task);
      const { status, reviewReason } = mapStateToLegacy(currentXState);
      const phase = XSTATE_TO_PHASE[currentXState] || 'idle';
      persistPlanStatusAndReasonSync(mainPlanPath, status, reviewReason, project.id, currentXState, phase);

      // Also re-stamp worktree copy if it exists
      const worktreePath = findTaskWorktree(project.path, task.specId);
      if (worktreePath) {
        const specsBaseDir = getSpecsDir(project.autoBuildPath);
        const worktreePlanPath = path.join(
          worktreePath,
          specsBaseDir,
          task.specId,
          AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN
        );
        if (existsSync(worktreePlanPath)) {
          persistPlanStatusAndReasonSync(worktreePlanPath, status, reviewReason, project.id, currentXState, phase);
        }
      }
    }
  });

  fileWatcher.on("error", (taskId: string, error: string) => {
    // File watcher events don't carry projectId — fall back to lookup
    const { project } = findTaskAndProject(taskId);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_ERROR, taskId, error, project?.id);
  });

  // ============================================
  // Specs Directory Watcher Events → Renderer
  // (For MCP-created tasks to trigger auto-refresh)
  // ============================================

  // Throttle TASK_LIST_REFRESH: coalesce rapid specs-changed events (main + worktree writes)
  // into a single renderer refresh. Without this, writing to both main AND worktree plans
  // fires 2 specs-changed events → 4 loadTasks() calls → 4 full kanban re-renders → freeze.
  const pendingRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const REFRESH_THROTTLE_MS = 2_000;

  fileWatcher.on("specs-changed", (data: { projectId: string; projectPath: string; specDir: string; specId: string }) => {
    console.log(`[AgentEvents] specs-changed event received! specId=${data.specId}`);

    // Coalesce rapid-fire specs-changed events into one refresh per project
    const existingTimer = pendingRefreshTimers.get(data.projectId);
    if (existingTimer) clearTimeout(existingTimer);

    pendingRefreshTimers.set(data.projectId, setTimeout(() => {
      pendingRefreshTimers.delete(data.projectId);
      // Invalidate cache and notify renderer (single coalesced refresh)
      projectStore.invalidateTasksCache(data.projectId);
      console.log(`[AgentEvents] Sending coalesced TASK_LIST_REFRESH for project ${data.projectId}`);
      safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_LIST_REFRESH, data.projectId);
    }, REFRESH_THROTTLE_MS));
  });

  // Handle MCP-requested task starts (task-start-requested event from file watcher)
  fileWatcher.on("task-start-requested", (data: { projectId: string; projectPath: string; specDir: string; specId: string }) => {
    console.log(`[AgentEvents] task-start-requested event received!`);
    console.log(`[AgentEvents] - specId: ${data.specId}`);
    console.log(`[AgentEvents] - projectId: ${data.projectId}`);

    // Invalidate the project's task cache
    projectStore.invalidateTasksCache(data.projectId);

    // Notify renderer to auto-start the task
    // The renderer will call TASK_START IPC to begin execution
    console.log(`[AgentEvents] Sending TASK_AUTO_START to renderer for task ${data.specId}`);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_AUTO_START, data.projectId, data.specId);

    // Trigger auto-refresh if enabled in settings
    console.log(`[AgentEvents] Sending TASK_AUTO_REFRESH_TRIGGER for task-start-requested`);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_AUTO_REFRESH_TRIGGER, {
      reason: 'task-start-requested',
      projectId: data.projectId,
      specId: data.specId
    });
  });

  // Handle forceRecovery: kill running agent when test_force_recovery MCP tool is used
  // MCP server runs in a separate process and can't access agentManager directly,
  // so it sets metadata.forceRecovery=true and the file watcher emits this event.
  // Note: MCP also does a direct PID kill for instant response; this is the backup cleanup path.
  fileWatcher.on("task-force-recovery", (data: { projectId: string; projectPath: string; specDir: string; specId: string }) => {
    console.log(`[AgentEvents] task-force-recovery event received for ${data.specId}`);
    const isRunning = agentManager.isRunning(data.specId);
    if (isRunning) {
      console.log(`[AgentEvents] Killing running agent for ${data.specId} (forceRecovery)`);
      agentManager.killTask(data.specId);
    } else {
      console.log(`[AgentEvents] No running agent for ${data.specId} - forceRecovery flag set only (may have been killed by MCP direct PID kill)`);
    }

    // Forward to renderer for devtools logging
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.DEBUG_EVENT, {
      type: 'force-recovery',
      taskId: data.specId,
      agentKilled: isRunning,
      timestamp: new Date().toISOString()
    });
  });

  // Handle force-recovery XState revert: after a cross-process PID kill (from MCP),
  // buffered stdout events (e.g., QA_PASSED) may have already transitioned XState
  // before the exit handler fires. This event fires in the exit handler AFTER all
  // buffered events, and reverts XState to the intended target board.
  agentManager.on("force-recovery-revert", (taskId: string, targetBoard: string, projectId?: string) => {
    console.warn(`[AgentEvents] force-recovery-revert: reverting ${taskId} XState to ${targetBoard}`);
    const result = findTaskAndProject(taskId, projectId);
    if (result) {
      const { task, project } = result;

      // Clear forceRecovery from plan files BEFORE sending XState event.
      // The guard in persistPlanStatusAndReasonSync blocks writes when forceRecovery is active.
      // We must clear it first so the subscriber can persist the CORRECT status (ai_review)
      // and emit TASK_STATUS_CHANGE to the renderer — making the transition instant.
      try {
        const mainPlanPath = getPlanPath(project, task);
        const mainPlan = JSON.parse(readFileSync(mainPlanPath, 'utf-8'));
        if (mainPlan.metadata?.forceRecovery) {
          delete mainPlan.metadata.forceRecovery;
          delete mainPlan.metadata.forceRecoveryTargetBoard;
          writeFileSync(mainPlanPath, JSON.stringify(mainPlan, null, 2));
          console.warn(`[AgentEvents] Cleared forceRecovery from main plan for ${taskId}`);
        }
        const worktreePath = findTaskWorktree(project.path, task.specId);
        if (worktreePath) {
          const specsBaseDir = getSpecsDir(project.autoBuildPath);
          const wtPlanPath = path.join(worktreePath, specsBaseDir, task.specId, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
          if (existsSync(wtPlanPath)) {
            const wtPlan = JSON.parse(readFileSync(wtPlanPath, 'utf-8'));
            if (wtPlan.metadata?.forceRecovery) {
              delete wtPlan.metadata.forceRecovery;
              delete wtPlan.metadata.forceRecoveryTargetBoard;
              writeFileSync(wtPlanPath, JSON.stringify(wtPlan, null, 2));
            }
          }
        }
      } catch (err) {
        console.warn(`[AgentEvents] Failed to clear forceRecovery from plans for ${taskId}:`, err);
      }

      // NOW send XState event — subscriber will persist + emit successfully
      const eventMap: Record<string, import('../../shared/state-machines/task-machine').TaskEvent> = {
        'ai_review': { type: 'FORCE_AI_REVIEW' },
        'in_progress': { type: 'USER_RESUMED' },
        'backlog': { type: 'FORCE_BACKLOG' },
        'human_review': { type: 'FORCE_HUMAN_REVIEW' }
      };
      const event = eventMap[targetBoard] || { type: 'FORCE_AI_REVIEW' };
      taskStateManager.handleUiEvent(taskId, event, task, project);
      console.warn(`[AgentEvents] force-recovery-revert: sent ${event.type} to XState for ${taskId}`);

      // Clear force-recovery dedup so future test_force_recovery calls work
      fileWatcher.clearForceRecoveryDedup(taskId);

      // Forward to renderer for devtools logging
      safeSendToRenderer(getMainWindow, IPC_CHANNELS.DEBUG_EVENT, {
        type: 'force-recovery-revert',
        taskId,
        targetBoard,
        timestamp: new Date().toISOString()
      });
    } else {
      console.warn(`[AgentEvents] force-recovery-revert: could not find task/project for ${taskId}`);
    }
  });

  // Handle task status changes from file watcher (for RDR auto-recovery)
  fileWatcher.on("task-status-changed", (data: {
    projectId: string;
    taskId: string;
    specId: string;
    oldStatus: TaskStatus;
    newStatus: TaskStatus;
  }) => {
    console.log(`[AgentEvents] task-status-changed event received!`);
    console.log(`[AgentEvents] - specId: ${data.specId}`);
    console.log(`[AgentEvents] - projectId: ${data.projectId}`);
    console.log(`[AgentEvents] - status change: ${data.oldStatus} → ${data.newStatus}`);

    // Invalidate the project's task cache to trigger UI refresh
    projectStore.invalidateTasksCache(data.projectId);

    // Notify renderer to refresh task list with animation
    console.log(`[AgentEvents] Sending TASK_STATUS_CHANGED to renderer`);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_STATUS_CHANGED, data);

    // Trigger auto-refresh if enabled in settings
    console.log(`[AgentEvents] Sending TASK_AUTO_REFRESH_TRIGGER for task-status-changed`);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_AUTO_REFRESH_TRIGGER, {
      reason: 'task-status-changed',
      projectId: data.projectId,
      specId: data.specId
    });

    // Detect task regression: was started/running but went back to backlog
    // Only fire warning if task actually did meaningful work (not user manual actions)
    if (data.newStatus === 'backlog' && data.oldStatus !== 'backlog') {
      // Check if task has evidence of meaningful work before showing regression warning
      const hasMeaningfulWork = checkTaskHadMeaningfulWork(data.projectId, data.specId);
      
      if (hasMeaningfulWork) {
        console.warn(`[AgentEvents] REGRESSION DETECTED: Task ${data.specId} went ${data.oldStatus} → backlog (had meaningful work)`);
        safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_REGRESSION_DETECTED, {
          projectId: data.projectId,
          specId: data.specId,
          oldStatus: data.oldStatus,
          newStatus: data.newStatus,
          timestamp: new Date().toISOString()
        });
      } else {
        console.log(`[AgentEvents] Task ${data.specId} went ${data.oldStatus} → backlog (no meaningful work, skipping regression warning)`);
      }
    }
  });

  // Start watching specs directories for all existing projects
  startWatchingAllProjectSpecs();
}

/**
 * Check if a task had meaningful work before regressing to backlog.
 * Uses same logic as RDR's wasTaskPreviouslyStarted to determine if agent actually ran.
 * This prevents regression warnings for user manual actions (stop/drag).
 */
function checkTaskHadMeaningfulWork(projectId: string, specId: string): boolean {
  try {
    const { project } = findTaskAndProject(specId, projectId);
    if (!project || !project.path) return false;

    const planPath = path.join(project.path, '.auto-claude', 'specs', specId, 'implementation_plan.json');
    if (!existsSync(planPath)) return false;

    const plan = JSON.parse(readFileSync(planPath, 'utf-8'));

    // Check for evidence of meaningful work:
    // 1. start_requested_at - task was started
    // 2. executionPhase - agent was in a phase
    // 3. lastEvent - XState processed events
    // 4. phases with subtasks - agent created work items
    // 5. exitReason - agent crashed/errored
    // 6. Has worktree directory
    const hasStartRequested = !!plan.start_requested_at;
    const hasExecutionPhase = !!plan.executionPhase;
    const hasLastEvent = !!plan.lastEvent;
    const hasPhasesWithSubtasks = plan.phases && plan.phases.length > 0 && 
      plan.phases.some((phase: any) => phase.subtasks && phase.subtasks.length > 0);
    const hasExitReason = !!plan.exitReason;

    // Also check for worktree (agent created one)
    const worktreePath = findTaskWorktree(project.path, specId);
    const hasWorktree = !!worktreePath;

    const hadMeaningfulWork = hasStartRequested || hasExecutionPhase || hasLastEvent || 
      hasPhasesWithSubtasks || hasExitReason || hasWorktree;

    console.log(`[AgentEvents] checkTaskHadMeaningfulWork for ${specId}:`, {
      hasStartRequested,
      hasExecutionPhase,
      hasLastEvent,
      hasPhasesWithSubtasks,
      hasExitReason,
      hasWorktree,
      result: hadMeaningfulWork
    });

    return hadMeaningfulWork;
  } catch (error) {
    console.error(`[AgentEvents] Error checking meaningful work for ${specId}:`, error);
    return false;
  }
}

/**
 * Start watching specs directory for all projects.
 * Called on app startup and when projects are added.
 */
export function startWatchingAllProjectSpecs(): void {
  const projects = projectStore.getProjects();
  console.log(`[AgentEvents] startWatchingAllProjectSpecs called - found ${projects.length} projects`);
  for (const project of projects) {
    console.log(`[AgentEvents] Project: ${project.name || project.id}, autoBuildPath: ${project.autoBuildPath || 'NOT SET'}`);
    if (project.autoBuildPath) {
      startWatchingProjectSpecs(project.id, project.path, project.autoBuildPath);
    }
  }
}

/**
 * Start watching specs directory for a single project.
 */
export function startWatchingProjectSpecs(projectId: string, projectPath: string, autoBuildPath: string): void {
  const specsDir = getSpecsDir(autoBuildPath);
  const fullPath = path.join(projectPath, specsDir);
  console.log(`[AgentEvents] startWatchingProjectSpecs called:`);
  console.log(`[AgentEvents] - projectId: ${projectId}`);
  console.log(`[AgentEvents] - projectPath: ${projectPath}`);
  console.log(`[AgentEvents] - autoBuildPath: ${autoBuildPath}`);
  console.log(`[AgentEvents] - specsDir: ${specsDir}`);
  console.log(`[AgentEvents] - fullPath: ${fullPath}`);
  console.log(`[AgentEvents] - isWatchingSpecs: ${fileWatcher.isWatchingSpecs(projectId)}`);

  if (!fileWatcher.isWatchingSpecs(projectId)) {
    console.log(`[AgentEvents] Starting specs watcher for project ${projectId} at ${fullPath}`);
    fileWatcher.watchSpecsDirectory(projectId, projectPath, specsDir);
  } else {
    console.log(`[AgentEvents] Already watching specs for project ${projectId}`);
  }
}
