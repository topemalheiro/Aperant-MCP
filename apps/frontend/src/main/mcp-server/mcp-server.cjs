#!/usr/bin/env node
/**
 * MCP Server Entry Point (CommonJS wrapper)
 *
 * Mocks the Electron environment and launches the TypeScript MCP server via
 * tsx with the ESM register-loader. This wrapper is useful for callers that
 * expect a plain .cjs entry point.
 */

const path = require('path');
const { spawn } = require('child_process');

// Mock Electron BEFORE any TypeScript/imports are processed
if (!process.versions.electron) {
  process.versions.electron = '30.0.0';
  console.warn('[MCP] Standalone mode - Electron environment mocked');
}

process.env.MCP_STANDALONE = 'true';

const scriptDir = path.dirname(__filename);
const args = [
  'tsx',
  '--import',
  path.join(scriptDir, 'register-loader.mjs'),
  path.join(scriptDir, 'index.ts'),
];

const child = spawn('npx', args, {
  cwd: process.cwd(),
  stdio: 'inherit',
});

child.on('error', (err) => {
  console.error('[MCP mcp-server.cjs] Failed to spawn tsx:', err);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
