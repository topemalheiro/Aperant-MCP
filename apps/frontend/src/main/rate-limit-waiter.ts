/**
 * Rate Limit Waiter
 *
 * Manages wait-and-auto-resume functionality for single-account scenarios.
 * When a rate limit is hit and no alternative accounts are available,
 * this module allows waiting until the rate limit resets and then
 * automatically resumes the interrupted task.
 */

import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type { SDKRateLimitInfo } from './rate-limit-detector';
import { pauseRdr, resumeRdr } from './ipc-handlers/rdr-handlers';

/**
 * State of an active wait operation
 */
interface WaitState {
  /** Rate limit info for this wait */
  rateLimitInfo: SDKRateLimitInfo;
  /** Timer ID for the countdown interval */
  countdownInterval: NodeJS.Timeout;
  /** Timer ID for the completion timeout */
  completionTimeout: NodeJS.Timeout;
  /** When the wait started */
  startedAt: Date;
  /** When the wait will complete (rate limit reset) */
  completesAt: Date;
  /** Whether this wait was cancelled */
  cancelled: boolean;
}

/**
 * Active wait operations keyed by taskId (or a unique identifier)
 */
const activeWaits = new Map<string, WaitState>();

/**
 * Get a unique wait ID for a rate limit event
 */
function getWaitId(info: SDKRateLimitInfo): string {
  if (info.taskId) {
    return `task:${info.taskId}`;
  }
  return `${info.source}:${info.profileId}:${Date.now()}`;
}

/**
 * Start waiting for a rate limit to reset.
 *
 * @param info - Rate limit info with reset time
 * @param mainWindow - Electron main window for IPC events
 * @param onComplete - Callback when wait completes (for auto-resume)
 * @returns Wait ID that can be used to cancel the wait
 */
export function startRateLimitWait(
  info: SDKRateLimitInfo,
  mainWindow: BrowserWindow | null,
  onComplete?: (info: SDKRateLimitInfo) => void
): string | null {
  // Must have reset time and wait duration
  if (!info.resetAtDate || !info.waitDurationMs || info.waitDurationMs <= 0) {
    console.warn('[RateLimitWaiter] Cannot start wait: missing reset time or already passed');
    return null;
  }

  const waitId = getWaitId(info);

  // Cancel any existing wait for this ID
  cancelRateLimitWait(waitId);

  console.log(`[RateLimitWaiter] Starting wait for ${waitId}, duration: ${Math.ceil(info.waitDurationMs / 1000)}s`);

  const startedAt = new Date();
  const completesAt = info.resetAtDate;

  // Emit start event
  if (mainWindow) {
    mainWindow.webContents.send(IPC_CHANNELS.RATE_LIMIT_WAIT_START, {
      waitId,
      taskId: info.taskId,
      projectId: info.projectId,
      source: info.source,
      profileId: info.profileId,
      resetTime: info.resetTime,
      secondsRemaining: Math.ceil(info.waitDurationMs / 1000),
      startedAt: startedAt.toISOString(),
      completesAt: completesAt.toISOString()
    });
  }

  // Pause RDR — same subscription, Claude Code is also rate limited
  pauseRdr('Rate limit detected', completesAt.getTime());

  // Create countdown interval (update every second)
  const countdownInterval = setInterval(() => {
    const state = activeWaits.get(waitId);
    if (!state || state.cancelled) {
      clearInterval(countdownInterval);
      return;
    }

    const now = Date.now();
    const remaining = Math.max(0, state.completesAt.getTime() - now);
    const secondsRemaining = Math.ceil(remaining / 1000);

    // Emit progress event
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.RATE_LIMIT_WAIT_PROGRESS, {
        waitId,
        taskId: info.taskId,
        secondsRemaining,
        minutesRemaining: Math.ceil(secondsRemaining / 60),
        progress: 1 - (remaining / (info.waitDurationMs || 1))
      });
    }

    // If we've reached zero, the completion timeout will handle it
    if (remaining <= 0) {
      clearInterval(countdownInterval);
    }
  }, 1000);

  // Create completion timeout
  const completionTimeout = setTimeout(() => {
    const state = activeWaits.get(waitId);
    if (!state || state.cancelled) {
      return;
    }

    console.log(`[RateLimitWaiter] Wait complete for ${waitId}`);

    // Clean up
    clearInterval(state.countdownInterval);
    activeWaits.delete(waitId);

    // Emit completion event
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.RATE_LIMIT_WAIT_COMPLETE, {
        waitId,
        taskId: info.taskId,
        projectId: info.projectId,
        source: info.source,
        profileId: info.profileId
      });
    }

    // Resume RDR — rate limit cleared, send pending tasks
    resumeRdr('Rate limit reset');

    // Trigger callback for auto-resume
    if (onComplete) {
      onComplete(info);
    }
  }, info.waitDurationMs);

  // Store wait state
  activeWaits.set(waitId, {
    rateLimitInfo: info,
    countdownInterval,
    completionTimeout,
    startedAt,
    completesAt,
    cancelled: false
  });

  return waitId;
}

/**
 * Cancel an active rate limit wait
 */
export function cancelRateLimitWait(waitId: string): boolean {
  const state = activeWaits.get(waitId);
  if (!state) {
    return false;
  }

  console.log(`[RateLimitWaiter] Cancelling wait: ${waitId}`);

  // Mark as cancelled
  state.cancelled = true;

  // Clear timers
  clearInterval(state.countdownInterval);
  clearTimeout(state.completionTimeout);

  // Remove from active waits
  activeWaits.delete(waitId);

  return true;
}

/**
 * Cancel all active waits for a specific task
 */
export function cancelWaitsForTask(taskId: string): number {
  let cancelled = 0;
  for (const [waitId, state] of activeWaits.entries()) {
    if (state.rateLimitInfo.taskId === taskId) {
      if (cancelRateLimitWait(waitId)) {
        cancelled++;
      }
    }
  }
  return cancelled;
}

/**
 * Get the active wait state for a wait ID
 */
export function getWaitState(waitId: string): WaitState | undefined {
  return activeWaits.get(waitId);
}

/**
 * Check if there's an active wait for a task
 */
export function hasActiveWait(taskId: string): boolean {
  for (const state of activeWaits.values()) {
    if (state.rateLimitInfo.taskId === taskId && !state.cancelled) {
      return true;
    }
  }
  return false;
}

/**
 * Get remaining time for a wait
 */
export function getWaitRemaining(waitId: string): number {
  const state = activeWaits.get(waitId);
  if (!state || state.cancelled) {
    return 0;
  }
  return Math.max(0, state.completesAt.getTime() - Date.now());
}

/**
 * Format remaining time as human-readable string
 */
export function formatRemainingTime(milliseconds: number): string {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Get all active waits (for debugging/status)
 */
export function getAllActiveWaits(): Array<{
  waitId: string;
  taskId?: string;
  source: string;
  remainingMs: number;
  remainingFormatted: string;
}> {
  const result = [];
  const now = Date.now();

  for (const [waitId, state] of activeWaits.entries()) {
    if (!state.cancelled) {
      const remainingMs = Math.max(0, state.completesAt.getTime() - now);
      result.push({
        waitId,
        taskId: state.rateLimitInfo.taskId,
        source: state.rateLimitInfo.source,
        remainingMs,
        remainingFormatted: formatRemainingTime(remainingMs)
      });
    }
  }

  return result;
}

/**
 * Start a rate limit wait specifically for a task that crashed.
 * This is called from the exit handler when a task crashes due to rate limit.
 * When the wait completes, emits RATE_LIMIT_AUTO_RESUME to trigger task restart.
 *
 * @param taskId - The task that crashed
 * @param info - Rate limit info with reset time
 * @param mainWindow - Electron main window for IPC events
 * @param onResume - Optional callback when wait completes
 * @returns Wait ID or null if wait cannot be started
 */
export function startRateLimitWaitForTask(
  taskId: string,
  info: SDKRateLimitInfo,
  mainWindow: BrowserWindow | null,
  onResume?: () => void
): string | null {
  // Create a task-specific rate limit info
  const taskInfo: SDKRateLimitInfo = {
    ...info,
    taskId,
    source: 'task'
  };

  console.log(`[RateLimitWaiter] Starting auto-wait for crashed task ${taskId}`);

  return startRateLimitWait(taskInfo, mainWindow, (completedInfo) => {
    console.log(`[RateLimitWaiter] Rate limit reset for task ${taskId} - emitting auto-resume`);

    // Emit auto-resume event for the renderer to handle
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.RATE_LIMIT_AUTO_RESUME, {
        waitId: `task:${taskId}`,
        taskId,
        projectId: completedInfo.projectId,
        source: 'task_crash'
      });
    }

    // Resume RDR — rate limit auto-resumed, send pending tasks
    resumeRdr('Rate limit auto-resume');

    // Call optional callback
    if (onResume) {
      onResume();
    }
  });
}

/**
 * Get all active task waits (tasks waiting for rate limit reset).
 * Used by wait_for_human_review to check if tasks are waiting.
 */
export function getTasksWaitingForRateLimit(): string[] {
  const waitingTasks: string[] = [];

  for (const [waitId, state] of activeWaits.entries()) {
    if (!state.cancelled && state.rateLimitInfo.taskId) {
      waitingTasks.push(state.rateLimitInfo.taskId);
    }
  }

  return waitingTasks;
}
