/**
 * Auto-Claude MCP Server Types
 *
 * Type definitions for MCP tool parameters and responses.
 * These reuse the shared task types where possible so the MCP layer
 * stays in sync with the rest of the app.
 */

import type {
  ExecutionProgress,
  ModelType,
  QAReport,
  ReferencedFile,
  ReviewReason,
  Subtask,
  Task as SharedTask,
  TaskCategory,
  TaskComplexity,
  TaskExitReason,
  TaskPriority,
  TaskRateLimitInfo,
  TaskStatus,
} from '../../shared/types/task';
import type { ThinkingLevel } from '../../shared/types/settings';

// Re-export shared types so consumers only need one import source
export type {
  ExecutionProgress,
  ModelType,
  QAReport,
  ReferencedFile,
  ReviewReason,
  Subtask,
  TaskCategory,
  TaskComplexity,
  TaskExitReason,
  TaskPriority,
  TaskRateLimitInfo,
  TaskStatus,
};

/**
 * Per-phase model configuration passed by MCP clients.
 * Differs from the internal PhaseModelConfig only in key naming.
 */
export interface PhaseModels {
  specCreation?: ModelType;
  planning?: ModelType;
  coding?: ModelType;
  qaReview?: ModelType;
}

/**
 * Per-phase thinking level configuration passed by MCP clients.
 */
export interface PhaseThinking {
  specCreation?: ThinkingLevel;
  planning?: ThinkingLevel;
  coding?: ThinkingLevel;
  qaReview?: ThinkingLevel;
}

/**
 * Task creation options
 */
export interface TaskOptions {
  // Provider selection
  provider?: string;  // Provider name (e.g., 'MiniMax', 'Primary') — resolved to providerId

  // Model configuration
  model?: ModelType;
  phaseModels?: PhaseModels;
  phaseThinking?: PhaseThinking;

  // Review settings
  requireReviewBeforeCoding?: boolean;

  // Git options
  baseBranch?: string;

  // Reference files (relative paths from project root)
  referencedFiles?: string[];

  // Classification (optional)
  category?: TaskCategory;
  complexity?: TaskComplexity;
  priority?: TaskPriority;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Parameter Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parameters for create_task tool
 */
export interface CreateTaskParams {
  projectId: string;
  description: string;
  title?: string;
  options?: TaskOptions;
}

/**
 * Parameters for list_tasks tool
 */
export interface ListTasksParams {
  projectId: string;
  status?: TaskStatus;
}

/**
 * Parameters for start_task tool
 */
export interface StartTaskParams {
  projectId: string;
  taskId: string;
  options?: {
    model?: ModelType;
    baseBranch?: string;
  };
}

/**
 * Parameters for get_task_status tool
 */
export interface GetTaskStatusParams {
  projectId: string;
  taskId: string;
}

/**
 * Task definition for batch operations
 */
export interface BatchTaskDefinition {
  description: string;
  title?: string;
  options?: TaskOptions;
}

/**
 * Parameters for start_batch tool
 */
export interface StartBatchParams {
  projectId: string;
  tasks: BatchTaskDefinition[];
  options?: TaskOptions; // Default options applied to all tasks
  startImmediately?: boolean; // Default: true
}

/**
 * On-complete callback configuration
 */
export interface OnCompleteConfig {
  command: string;
  args?: string[];
  delaySeconds?: number; // Grace period before executing (default: 60)
}

/**
 * Parameters for wait_for_human_review tool
 */
export interface WaitForHumanReviewParams {
  projectId: string;
  taskIds: string[];
  onComplete?: OnCompleteConfig;
  pollIntervalMs?: number; // How often to check (default: 30000)
  timeoutMs?: number; // Max time to wait (default: no timeout)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Response Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard result wrapper
 */
export interface MCPResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Created task info
 */
export interface CreatedTask {
  taskId: string;
  specPath: string;
  title: string;
  status: TaskStatus;
}

/**
 * Task summary for listing.
 * Mirrors the internal Task shape and adds the project path and a stable
 * `taskId` alias so MCP clients can locate tasks on disk for file-based recovery.
 */
export type TaskSummary = SharedTask & { projectPath: string; taskId: string };

/**
 * Detailed task status.
 * Mirrors the internal Task shape and exposes the spec ID as `taskId`,
 * plus a few computed convenience fields used by the MCP responses.
 */
export type TaskStatusDetail = SharedTask & {
  taskId: string;
  phase?: string;
  progress?: number;
  subtaskCount?: number;
  completedSubtasks?: number;
};

/**
 * Batch operation result
 */
export interface BatchResult {
  taskIds: string[];
  created: number;
  started: number;
  errors: Array<{ description: string; error: string }>;
}

/**
 * Wait completion result
 */
export interface WaitResult {
  completed: boolean;
  taskStatuses: Record<string, TaskStatus>;
  commandExecuted?: boolean;
  commandOutput?: string;
  timedOut?: boolean;
  /** Whether shutdown was blocked due to rate-limit-crashed tasks */
  shutdownBlocked?: boolean;
  /** Task IDs that crashed due to rate limit (not genuinely complete) */
  rateLimitCrashes?: string[];
  /** Human-readable message about the wait result */
  message?: string;
}
