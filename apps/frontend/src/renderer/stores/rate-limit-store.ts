import { create } from 'zustand';
import type { RateLimitInfo, SDKRateLimitInfo } from '../../shared/types';

/**
 * Wait state for rate limit auto-resume
 */
interface WaitState {
  waitId: string;
  taskId?: string;
  projectId?: string;
  source: string;
  profileId: string;
  secondsRemaining: number;
  startedAt: string;
  completesAt: string;
}

interface RateLimitState {
  // Terminal rate limit modal
  isModalOpen: boolean;
  rateLimitInfo: RateLimitInfo | null;

  // SDK rate limit modal (for changelog, tasks, etc.)
  isSDKModalOpen: boolean;
  sdkRateLimitInfo: SDKRateLimitInfo | null;

  // Track if there's a pending rate limit (persists after modal is closed)
  // User can click the sidebar indicator to reopen
  hasPendingRateLimit: boolean;
  pendingRateLimitType: 'terminal' | 'sdk' | null;

  // Wait-and-resume state (single account scenario)
  isWaiting: boolean;
  waitState: WaitState | null;

  // Actions
  showRateLimitModal: (info: RateLimitInfo) => void;
  hideRateLimitModal: () => void;
  showSDKRateLimitModal: (info: SDKRateLimitInfo) => void;
  hideSDKRateLimitModal: () => void;
  reopenRateLimitModal: () => void;
  clearPendingRateLimit: () => void;

  // Wait-and-resume actions
  startWaiting: (waitState: WaitState) => void;
  updateWaitProgress: (secondsRemaining: number) => void;
  stopWaiting: () => void;
}

export const useRateLimitStore = create<RateLimitState>((set, get) => ({
  isModalOpen: false,
  rateLimitInfo: null,
  isSDKModalOpen: false,
  sdkRateLimitInfo: null,
  hasPendingRateLimit: false,
  pendingRateLimitType: null,
  isWaiting: false,
  waitState: null,

  showRateLimitModal: (info: RateLimitInfo) => {
    set({
      isModalOpen: true,
      rateLimitInfo: info,
      hasPendingRateLimit: true,
      pendingRateLimitType: 'terminal'
    });
  },

  hideRateLimitModal: () => {
    // Keep the rate limit info and pending flag when closing
    // User can reopen via sidebar indicator
    set({ isModalOpen: false });
  },

  showSDKRateLimitModal: (info: SDKRateLimitInfo) => {
    set({
      isSDKModalOpen: true,
      sdkRateLimitInfo: info,
      hasPendingRateLimit: true,
      pendingRateLimitType: 'sdk'
    });
  },

  hideSDKRateLimitModal: () => {
    // Keep the rate limit info and pending flag when closing
    // User can reopen via sidebar indicator
    set({ isSDKModalOpen: false });
  },

  reopenRateLimitModal: () => {
    const state = get();
    if (state.pendingRateLimitType === 'terminal' && state.rateLimitInfo) {
      set({ isModalOpen: true });
    } else if (state.pendingRateLimitType === 'sdk' && state.sdkRateLimitInfo) {
      set({ isSDKModalOpen: true });
    }
  },

  clearPendingRateLimit: () => {
    set({
      hasPendingRateLimit: false,
      pendingRateLimitType: null,
      rateLimitInfo: null,
      sdkRateLimitInfo: null,
      isWaiting: false,
      waitState: null
    });
  },

  // Wait-and-resume actions
  startWaiting: (waitState: WaitState) => {
    set({
      isWaiting: true,
      waitState,
      // Close the modal since we're now waiting
      isSDKModalOpen: false
    });
  },

  updateWaitProgress: (secondsRemaining: number) => {
    const { waitState } = get();
    if (waitState) {
      set({
        waitState: { ...waitState, secondsRemaining }
      });
    }
  },

  stopWaiting: () => {
    set({
      isWaiting: false,
      waitState: null
    });
  }
}));
