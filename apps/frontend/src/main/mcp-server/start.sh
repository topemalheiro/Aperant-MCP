#!/usr/bin/env bash
# MCP Server Launcher with Electron Mocking

# Mock Electron before starting
export NODE_OPTIONS="--require $(dirname "$0")/mock-electron.js"

# Run tsx with the MCP server
cd "$(dirname "$0")/../../../.."
npx --yes tsx apps/frontend/src/main/mcp-server/index.ts
