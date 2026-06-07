/**
 * Diagnostics API for renderer process
 *
 * Exposes usage monitor and RDR system internals for debugging.
 * Used by the diagnostics panel to compare meter values, verify RDR timing,
 * and force fresh usage fetches.
 */

import { IPC_CHANNELS } from '../../../shared/constants';
import { invokeIpc } from './ipc-utils';

export interface UsageDiagnostics {
  currentUsage: {
    sessionPercent: number;
    weeklyPercent: number;
    profileId: string;
    profileName: string;
    fetchedAt: string;
    sessionResetTime?: string;
    weeklyResetTime?: string;
  } | null;
  lastGoodUsage: {
    sessionPercent: number;
    weeklyPercent: number;
    fetchedAt: string;
  } | null;
  currentUsageProfileId: string | null;
  apiFailureTimestamps: Record<string, number>;
  lastEmitTimestamp: number;
  lastRdrNotificationState: string;
  isChecking: boolean;
  lastGoodUsagePath: string;
  cliCredentialPath: string;
  cliCredentialExists: boolean;
  cliCredentialHasToken: boolean;
  timestamp: number;
}

export interface RdrDiagnostics {
  rdrPauseState: {
    paused: boolean;
    warning: boolean;
    reason: string;
    pausedAt: number;
    rateLimitResetAt: number;
  };
  outputMonitorState: string;
  mcpBusy: boolean;
  isClaudeCodeBusy: boolean;
  timestamp: number;
}

export interface DiagResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface DiagnosticsAPI {
  getUsageState: () => Promise<DiagResult<UsageDiagnostics>>;
  getRdrState: () => Promise<DiagResult<RdrDiagnostics>>;
  forceUsageFetch: () => Promise<DiagResult<unknown>>;
  sendTestRdr: () => Promise<DiagResult<{ wouldSend: boolean; busyCheckResult: boolean; message: string }>>;
}

export const createDiagnosticsAPI = (): DiagnosticsAPI => ({
  getUsageState: (): Promise<DiagResult<UsageDiagnostics>> =>
    invokeIpc(IPC_CHANNELS.DIAG_GET_USAGE_STATE),

  getRdrState: (): Promise<DiagResult<RdrDiagnostics>> =>
    invokeIpc(IPC_CHANNELS.DIAG_GET_RDR_STATE),

  forceUsageFetch: (): Promise<DiagResult<unknown>> =>
    invokeIpc(IPC_CHANNELS.DIAG_FORCE_USAGE_FETCH),

  sendTestRdr: (): Promise<DiagResult<{ wouldSend: boolean; busyCheckResult: boolean; message: string }>> =>
    invokeIpc(IPC_CHANNELS.DIAG_SEND_TEST_RDR),
});
