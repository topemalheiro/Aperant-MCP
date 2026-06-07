/**
 * Hugging Face IPC Handlers Module
 *
 * This module exports the main registration function for all Hugging Face-related IPC handlers.
 */

import { registerHuggingFaceOAuthHandlers } from './oauth-handlers';
import { registerHuggingFaceRepositoryHandlers } from './repository-handlers';

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string): void {
  if (DEBUG) {
    console.debug(`[HuggingFace] ${message}`);
  }
}

/**
 * Register all Hugging Face IPC handlers
 */
export function registerHuggingFaceHandlers(): void {
  debugLog('Registering all Hugging Face handlers');

  // OAuth and authentication handlers (huggingface-cli)
  registerHuggingFaceOAuthHandlers();

  // Repository handlers (models)
  registerHuggingFaceRepositoryHandlers();

  debugLog('All Hugging Face handlers registered');
}

// Re-export individual registration functions for custom usage
export {
  registerHuggingFaceOAuthHandlers,
  registerHuggingFaceRepositoryHandlers
};
