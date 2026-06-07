/**
 * Mock Electron Environment
 * 
 * This file is loaded via node --require before any other modules.
 * It mocks process.versions.electron to prevent @sentry/electron from crashing.
 */

if (!process.versions.electron) {
  process.versions.electron = '30.0.0';
  console.warn('[MCP] Electron environment mocked for standalone MCP server');
}
