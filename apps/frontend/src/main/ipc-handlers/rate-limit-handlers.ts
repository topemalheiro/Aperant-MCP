/**
 * Rate Limit Wait-and-Resume IPC Handlers
 *
 * Handles IPC communication for rate limit waiting when no alternative
 * accounts are available (single account scenario).
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult, SDKRateLimitInfo } from '../../shared/types';
import {
  startRateLimitWait,
  cancelRateLimitWait,
  formatRemainingTime
} from '../rate-limit-waiter';
import { AgentManager } from '../agent';
import { findTaskAndProject } from './task/shared';

/**
 * Register IPC handlers for rate limit wait-and-resume functionality
 */
export function registerRateLimitHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  /**
   * Start waiting for a rate limit to reset.
   * When the wait completes, the task will be automatically resumed.
   */
  ipcMain.handle(
    IPC_CHANNELS.RATE_LIMIT_WAIT_START,
    async (_, info: SDKRateLimitInfo): Promise<IPCResult<{ waitId: string }>> => {
      const mainWindow = getMainWindow();

      // Validate that we have the required fields
      if (!info.resetAtDate || !info.waitDurationMs || info.waitDurationMs <= 0) {
        return {
          success: false,
          error: 'Cannot start wait: reset time is missing or already passed'
        };
      }

      console.log(`[RateLimitHandler] Starting wait for rate limit. Source: ${info.source}, Task: ${info.taskId || 'N/A'}`);
      console.log(`[RateLimitHandler] Will wait for ${formatRemainingTime(info.waitDurationMs)} until ${info.resetTime}`);

      // Start the wait with auto-resume callback
      const waitId = startRateLimitWait(info, mainWindow, (completedInfo) => {
        // Auto-resume the task when wait completes
        if (completedInfo.taskId && completedInfo.projectId) {
          console.log(`[RateLimitHandler] Wait complete, auto-resuming task: ${completedInfo.taskId}`);

          // Find task and project
          const { task, project } = findTaskAndProject(completedInfo.taskId);

          if (task && project) {
            // Emit auto-resume event to the renderer
            if (mainWindow) {
              mainWindow.webContents.send(IPC_CHANNELS.RATE_LIMIT_AUTO_RESUME, {
                taskId: completedInfo.taskId,
                projectId: completedInfo.projectId,
                source: completedInfo.source,
                profileId: completedInfo.profileId
              });
            }

            // Actually restart the task
            // Note: The task will be restarted via the TASK_START IPC channel
            // which is triggered by the renderer when it receives RATE_LIMIT_AUTO_RESUME
            console.log(`[RateLimitHandler] Sent RATE_LIMIT_AUTO_RESUME for task: ${completedInfo.taskId}`);
          } else {
            console.warn(`[RateLimitHandler] Could not find task or project for auto-resume: ${completedInfo.taskId}`);
          }
        } else {
          console.log(`[RateLimitHandler] Wait complete, but no task to resume (source: ${completedInfo.source})`);
        }
      });

      if (!waitId) {
        return {
          success: false,
          error: 'Failed to start wait: could not create wait timer'
        };
      }

      return {
        success: true,
        data: { waitId }
      };
    }
  );

  /**
   * Cancel an active rate limit wait
   */
  ipcMain.handle(
    IPC_CHANNELS.RATE_LIMIT_WAIT_CANCEL,
    async (_, waitId: string): Promise<IPCResult> => {
      console.log(`[RateLimitHandler] Cancelling wait: ${waitId}`);

      const cancelled = cancelRateLimitWait(waitId);

      if (!cancelled) {
        return {
          success: false,
          error: 'No active wait found with that ID'
        };
      }

      // Notify renderer that wait was cancelled
      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.RATE_LIMIT_WAIT_CANCEL, { waitId });
      }

      return { success: true };
    }
  );
}
