#!/usr/bin/env node
/**
 * MCP Server Entry Point
 *
 * This JavaScript file sets MCP_STANDALONE mode and mocks Electron before tsx loads.
 */

// Set environment variable to signal MCP standalone mode
process.env.MCP_STANDALONE = 'true';

// Mock Electron environment BEFORE tsx processes any TypeScript
if (!process.versions.electron) {
  process.versions.electron = '30.0.0';
}

// Use tsx's programmatic API to load and run the TypeScript file
const { register } = require('tsx/dist/register-D46fvsV_.cjs');
const path = require('path');

// Register tsx transformer
register();

// Load the main MCP server
require('./index.ts');
