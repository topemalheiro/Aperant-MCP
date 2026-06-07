/**
 * Hugging Face Handlers Entry Point
 *
 * This file serves as the main entry point for Hugging Face IPC handlers,
 * delegating to the modular handlers in the huggingface/ directory.
 */

import { registerHuggingFaceHandlers } from './huggingface/index';

export { registerHuggingFaceHandlers };

/**
 * Default export for consistency with other handler modules
 */
export default function setupHuggingFaceHandlers(): void {
  registerHuggingFaceHandlers();
}
