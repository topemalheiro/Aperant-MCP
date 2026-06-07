/**
 * Watchdog Module - Crash detection and recovery system
 *
 * Exports:
 * - AutoClaudeWatchdog: Main watchdog class for process monitoring
 * - CrashNotifier: Sends crash notifications to Claude Code via MCP
 */

export { AutoClaudeWatchdog } from './auto-claude-watchdog';
export { crashNotifier, CrashNotifier } from './crash-notifier';
