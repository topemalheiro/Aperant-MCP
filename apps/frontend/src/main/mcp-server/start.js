#!/usr/bin/env node
/**
 * MCP Server Entry Point
 *
 * This JavaScript file sets MCP_STANDALONE mode and mocks Electron before
 * launching the TypeScript MCP server through tsx with the ESM register-loader.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

// Set environment variable to signal MCP standalone mode
process.env.MCP_STANDALONE = 'true';

// Mock Electron environment BEFORE tsx processes any TypeScript
if (!process.versions.electron) {
  process.versions.electron = '30.0.0';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = [
  '--import',
  path.join(__dirname, 'register-loader.mjs'),
  path.join(__dirname, 'index.ts'),
];

const child = spawn('npx', ['tsx', ...args], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

child.on('error', (err) => {
  console.error('[MCP start.js] Failed to spawn tsx:', err);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
