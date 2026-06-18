#!/usr/bin/env bash
# MCP Server Launcher with Electron Mocking

# Resolve the directory containing this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Run tsx with the ESM register-loader so Electron imports are mocked and
# TypeScript .js extension imports resolve correctly.
cd "$(dirname "$SCRIPT_DIR")/../../../.." || exit 1
npx --yes tsx --import "${SCRIPT_DIR}/register-loader.mjs" "${SCRIPT_DIR}/index.ts"
