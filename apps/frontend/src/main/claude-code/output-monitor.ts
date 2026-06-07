/**
 * Claude Code Output Monitor
 *
 * Monitors Claude Code's session state to detect when it's waiting at a prompt.
 * This prevents RDR from sending messages while Claude is in a prompt loop.
 *
 * ENHANCED: Now uses EventEmitter for real-time state change notifications.
 * RDR can subscribe to 'idle' event to immediately detect when Claude Code
 * finishes processing, instead of relying on fixed polling intervals.
 *
 * FIXED: Now monitors JSONL transcripts in ~/.claude/projects/ instead of empty
 * .output files in %LOCALAPPDATA%\Temp\claude\
 */

import * as fs from 'fs/promises';
import { existsSync, watch, FSWatcher } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';

/**
 * Claude Code's possible states
 */
export type ClaudeState = 'AT_PROMPT' | 'PROCESSING' | 'IDLE';

/**
 * Prompt and activity patterns to detect Claude's state
 */
const PATTERNS = {
  // Claude waiting for input (the ">" prompt)
  AT_PROMPT: [
    /^>\s*$/m, // Just ">" on its own line
    /\n>\s*$/m, // ">" at end after newline
    /^\s*>\s+$/m // ">" with possible whitespace
  ],

  // Claude actively processing/working
  PROCESSING: [
    /^●/m, // Claude's response bullet point
    /\u25cf/m, // Unicode bullet point (●)
    /^(Read|Write|Edit|Bash|Grep|Glob|Task|WebFetch|WebSearch|TodoWrite|AskUserQuestion)\(/m, // Tool calls
    /^\s*\d+\s*[│|]\s*/m, // Line numbers (Claude reading files)
    /Loading\.\.\./i,
    /Thinking\.\.\./i,
    /Analyzing\.\.\./i,
    /Processing\.\.\./i,
    /Working\.\.\./i,
    /Searching\.\.\./i,
    /Creating\.\.\./i,
    /Updating\.\.\./i,
    /Running\.\.\./i
  ]
};

/**
 * State change event data
 */
export interface StateChangeEvent {
  from: ClaudeState;
  to: ClaudeState;
  file?: string;
  timestamp: number;
}

/**
 * Monitor Claude Code's output files to detect prompt state
 * Extends EventEmitter for real-time notifications to RDR
 *
 * Events:
 * - 'stateChange': Emitted when state changes (data: StateChangeEvent)
 * - 'idle': Emitted when Claude Code becomes idle (data: StateChangeEvent)
 * - 'processing': Emitted when Claude Code starts processing
 * - 'watching': Emitted when file watching starts
 * - 'watchError': Emitted on file watching errors
 */
class ClaudeOutputMonitor extends EventEmitter {
  private currentState: ClaudeState = 'IDLE';
  private lastStateChange: number = Date.now();
  private lastCheckedMtime: number = 0;  // Track last file mtime checked to prevent redundant state changes
  private claudeProjectsDir: string;
  private fileWatchers: FSWatcher[] = [];
  private isWatching: boolean = false;
  private watchDebounceTimer: NodeJS.Timeout | null = null;
  private processingRecheckTimer: NodeJS.Timeout | null = null;
  private isUpdatingState: boolean = false; // Guard against concurrent updateState() calls
  private cachedLatestFile: { path: string; mtime: number; foundAt: number } | null = null;
  private static readonly WATCH_DEBOUNCE_MS = 500; // Debounce rapid file changes
  private static readonly PROCESSING_RECHECK_MS = 15000; // Re-check after 15s to detect idle
  private static readonly CACHE_TTL_MS = 60000; // Re-scan directories every 60s max

  constructor() {
    super();
    // Monitor JSONL transcripts in ~/.claude/projects/
    // (.output files in temp are empty/old, JSONL files have real session data)
    this.claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  }

  /**
   * Start watching JSONL files for real-time state change detection
   * This enables event-driven RDR triggering instead of polling
   */
  async startWatching(): Promise<void> {
    if (this.isWatching) {
      console.log('[OutputMonitor] Already watching for file changes');
      return;
    }

    try {
      // Watch the projects directory for changes
      if (existsSync(this.claudeProjectsDir)) {
        console.log('[OutputMonitor] Starting file watcher on:', this.claudeProjectsDir);

        // Get list of project directories
        const entries = await fs.readdir(this.claudeProjectsDir, { withFileTypes: true });
        const projectDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

        // Watch each project directory for JSONL changes
        for (const projectDir of projectDirs) {
          const projectPath = path.join(this.claudeProjectsDir, projectDir);
          try {
            const watcher = watch(projectPath, { persistent: false }, (eventType, filename) => {
              if (filename && filename.endsWith('.jsonl')) {
                this.handleFileChange(path.join(projectPath, filename), eventType);
              }
            });

            watcher.on('error', (error) => {
              console.warn('[OutputMonitor] Watcher error for', projectPath, ':', error);
              this.emit('watchError', { path: projectPath, error });
            });

            this.fileWatchers.push(watcher);
          } catch (error) {
            // Skip directories we can't watch
            console.warn('[OutputMonitor] Could not watch directory:', projectPath, error);
          }
        }

        this.isWatching = true;
        console.log('[OutputMonitor] Watching', this.fileWatchers.length, 'project directories');
        this.emit('watching', { directories: this.fileWatchers.length });
      } else {
        console.warn('[OutputMonitor] Projects directory does not exist:', this.claudeProjectsDir);
      }
    } catch (error) {
      console.error('[OutputMonitor] Failed to start watching:', error);
      this.emit('watchError', { error });
    }
  }

  /**
   * Stop watching for file changes
   */
  stopWatching(): void {
    if (!this.isWatching) return;

    console.log('[OutputMonitor] Stopping file watchers...');
    for (const watcher of this.fileWatchers) {
      try {
        watcher.close();
      } catch {
        // Ignore close errors
      }
    }
    this.fileWatchers = [];
    this.isWatching = false;

    if (this.watchDebounceTimer) {
      clearTimeout(this.watchDebounceTimer);
      this.watchDebounceTimer = null;
    }

    if (this.processingRecheckTimer) {
      clearTimeout(this.processingRecheckTimer);
      this.processingRecheckTimer = null;
    }
  }

  /**
   * Handle JSONL file change event with debouncing
   */
  private handleFileChange(filePath: string, eventType: string): void {
    // Debounce rapid changes
    if (this.watchDebounceTimer) {
      clearTimeout(this.watchDebounceTimer);
    }

    this.watchDebounceTimer = setTimeout(async () => {
      console.log('[OutputMonitor] File change detected:', eventType, filePath);

      // Update state
      const oldState = this.currentState;
      await this.updateState();
      const newState = this.currentState;

      // State change is already emitted in setState, but we log here for context
      if (oldState !== newState) {
        console.log(`[OutputMonitor] State changed after file update: ${oldState} -> ${newState}`);
      }
    }, ClaudeOutputMonitor.WATCH_DEBOUNCE_MS);
  }

  /**
   * Check if Claude Code is currently at a prompt (waiting for input)
   * This is the PRIMARY indicator that we should NOT send RDR messages
   */
  async isAtPrompt(): Promise<boolean> {
    try {
      console.log('[OutputMonitor] Checking prompt state...');
      await this.updateState();
      console.log('[OutputMonitor] Current state after update:', this.currentState);
      return this.currentState === 'AT_PROMPT';
    } catch (error) {
      // On error, assume not at prompt (graceful degradation)
      console.warn('[OutputMonitor] Failed to check prompt state:', error);
      return false;
    }
  }

  /**
   * Get current Claude Code state
   */
  getCurrentState(): ClaudeState {
    return this.currentState;
  }

  /**
   * Get time since last state change (in milliseconds)
   */
  getTimeSinceStateChange(): number {
    return Date.now() - this.lastStateChange;
  }

  /**
   * Update Claude's state by checking recent JSONL transcript
   * Guarded against concurrent calls (timer + file watcher race condition)
   */
  private async updateState(): Promise<void> {
    // Prevent concurrent updateState() calls from timer and file watcher
    if (this.isUpdatingState) {
      return;
    }
    this.isUpdatingState = true;

    try {
    // Find the most recent JSONL transcript across all projects
    const result = await this.getLatestOutputFile();

    if (!result) {
      // No recent transcript files - Claude is idle
      console.log('[OutputMonitor] No recent JSONL transcript found - setting IDLE');
      this.setState('IDLE');
      this.lastCheckedMtime = 0;  // Reset tracking
      return;
    }

    const { path: latestTranscript, fileAgeMs } = result;

    // Calculate file mtime from age
    const fileMtime = Date.now() - fileAgeMs;

    console.log('[OutputMonitor] Found latest transcript:', latestTranscript, `(file ${Math.floor(fileAgeMs / 1000)}s old)`);

    // CRITICAL FIX: Only treat as PROCESSING if file was NEWLY modified since last check
    // This prevents repeated checks of the same old file from causing state transitions
    // that reset the idle timer, allowing the 30-second accumulation to complete
    const isNewActivity = fileMtime !== this.lastCheckedMtime;

    if (fileAgeMs < 3000) {
      if (isNewActivity) {
        // File freshly modified - Claude is actively streaming
        console.log(`[OutputMonitor] NEW activity detected - file modified since last check`);
        this.setState('PROCESSING');
        this.lastCheckedMtime = fileMtime;
        return;
      } else {
        // Same file as last check - don't reset state timer
        console.log(`[OutputMonitor] Same file as last check - maintaining current state (${this.currentState})`);
        // Don't call setState - keeps idle timer running without reset
        return;
      }
    }

    // File is old enough to parse content - update tracking
    this.lastCheckedMtime = fileMtime;

    // Read and parse JSONL file
    const content = await fs.readFile(latestTranscript, 'utf-8');
    const lines = content.trim().split('\n');

    // Parse all messages (we need full context for conversation state)
    const messages: any[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'user' || entry.type === 'assistant') {
          messages.push(entry);
        }
      } catch {
        // Skip malformed JSON lines
        continue;
      }
    }

    console.log('[OutputMonitor] Parsed', messages.length, 'messages from transcript');

    // Parse conversation state (file is old enough to check message content)
    const state = this.parseConversationState(messages);
    this.setState(state);
    } finally {
      this.isUpdatingState = false;
    }
  }

  /**
   * Find the most recently modified JSONL transcript file across all project directories
   * Returns both the file path and how old the file is (in ms) for streaming detection
   */
  private async getLatestOutputFile(): Promise<{ path: string; fileAgeMs: number } | null> {
    try {
      // Use cached file path if found recently - avoids scanning 34K+ files
      if (this.cachedLatestFile && Date.now() - this.cachedLatestFile.foundAt < ClaudeOutputMonitor.CACHE_TTL_MS) {
        try {
          const stats = await fs.stat(this.cachedLatestFile.path);
          if (stats.mtimeMs >= this.cachedLatestFile.mtime) {
            this.cachedLatestFile = { ...this.cachedLatestFile, mtime: stats.mtimeMs };
            const fileAgeMs = Date.now() - stats.mtimeMs;
            console.log('[OutputMonitor] Using cached file:', path.basename(this.cachedLatestFile.path), `(${Math.floor(fileAgeMs / 1000)}s old)`);
            return { path: this.cachedLatestFile.path, fileAgeMs };
          }
        } catch {
          // File gone, fall through to full scan
          this.cachedLatestFile = null;
        }
      }

      console.log('[OutputMonitor] Searching for JSONL transcripts in:', this.claudeProjectsDir);

      // List all project directories under ~/.claude/projects/
      const projectDirs = await fs.readdir(this.claudeProjectsDir);
      console.log('[OutputMonitor] Found', projectDirs.length, 'project directories');

      let latestFile: { path: string; mtime: number } | null = null;
      let totalJsonlFiles = 0;
      let recentJsonlFiles = 0;

      for (const projectDir of projectDirs) {
        const projectPath = path.join(this.claudeProjectsDir, projectDir);

        try {
          const files = await fs.readdir(projectPath);

          for (const file of files) {
            // Find .jsonl files (but skip sessions-index.json)
            if (file.endsWith('.jsonl') && !file.startsWith('sessions-index')) {
              totalJsonlFiles++;
              const filePath = path.join(projectPath, file);
              const stats = await fs.stat(filePath);

              // Only consider files modified in the last 5 minutes
              // (Claude Code sessions may not constantly write to JSONL)
              const ageMs = Date.now() - stats.mtimeMs;

              if (ageMs > 300000) {
                continue; // Skip old files silently
              }

              const ageSeconds = Math.floor(ageMs / 1000);
              recentJsonlFiles++;
              console.log('[OutputMonitor]   Found recent file:', file, `(${ageSeconds}s old)`);

              if (!latestFile || stats.mtimeMs > latestFile.mtime) {
                latestFile = { path: filePath, mtime: stats.mtimeMs };
              }
            }
          }
        } catch {
          // Directory doesn't exist or can't be read, skip
          continue;
        }
      }

      console.log('[OutputMonitor] Summary: Found', totalJsonlFiles, 'total JSONL files,', recentJsonlFiles, 'recent (<5min)');

      if (latestFile) {
        console.log('[OutputMonitor] Selected latest file:', latestFile.path);
        // Cache result for future checks
        this.cachedLatestFile = { ...latestFile, foundAt: Date.now() };
        const fileAgeMs = Date.now() - latestFile.mtime;
        return { path: latestFile.path, fileAgeMs };
      } else {
        console.log('[OutputMonitor] No recent JSONL files found');
        this.cachedLatestFile = null;
        return null;
      }
    } catch (error) {
      // Base directory doesn't exist or can't be accessed
      console.warn('[OutputMonitor] Failed to access projects directory:', error);
      return null;
    }
  }

  /**
   * Check if text matches any pattern in the list
   */
  private matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(text));
  }

  /**
   * Parse the actual conversation state from JSONL messages
   * Returns the true state based on conversation flow, not time guesses
   */
  private parseConversationState(messages: any[]): ClaudeState {
    if (messages.length === 0) {
      console.log('[OutputMonitor] No messages - returning IDLE');
      return 'IDLE';
    }

    // Get last message
    const lastMessage = messages[messages.length - 1];
    console.log('[OutputMonitor] Last message type:', lastMessage.type, 'stop_reason:', lastMessage.stop_reason);

    // CASE 1: Last message is user message → Claude should be thinking
    if (lastMessage.type === 'user') {
      // Check if session is abandoned (>5 minutes old)
      if (this.isMessageVeryOld(lastMessage)) {
        console.log('[OutputMonitor] User message is very old (>5min) - session abandoned');
        return 'IDLE';
      }
      console.log('[OutputMonitor] User message detected - Claude should be responding');
      return 'PROCESSING';
    }

    // CASE 2: Last message is assistant message
    if (lastMessage.type === 'assistant') {
      // Check stop_reason (ACTUAL STATE, not time guess)
      if (lastMessage.stop_reason === 'tool_use') {
        console.log('[OutputMonitor] stop_reason=tool_use - waiting for tool results');
        return 'PROCESSING';
      }

      if (lastMessage.stop_reason === null || lastMessage.stop_reason === undefined) {
        // stop_reason is null/undefined - could mean:
        // 1. Message is still streaming (recent message)
        // 2. JSONL format doesn't include stop_reason for completed messages (old message)
        // 3. Tool call in progress but stop_reason not recorded in JSONL

        // Check if assistant message has tool_use content blocks with no subsequent tool_result
        // This means a tool is actively running (build, user approval, etc.)
        if (this.hasUnresolvedToolUse(lastMessage, messages)) {
          console.log('[OutputMonitor] stop_reason=null/undefined but tool_use pending - tool still running');
          return 'PROCESSING';
        }

        const messageAge = this.getMessageAge(lastMessage);

        // If message is very recent (< 10 seconds), assume still streaming
        if (messageAge < 10000) {
          console.log('[OutputMonitor] stop_reason=null/undefined, recent message (< 10s) - still streaming');
          return 'PROCESSING';
        }

        // Message is old but no stop_reason - treat as completed, check content
        console.log(`[OutputMonitor] stop_reason=null/undefined, old message (${Math.floor(messageAge / 1000)}s) - treating as completed`);
        // Fall through to check content for prompts/questions
      }

      // Message complete (stop_reason='end_turn' OR old message with no stop_reason)
      // Check what the message contains
      const lastContent = this.getLastTextContent(lastMessage);

      // CRITICAL: Check message age FIRST before checking for questions
      // Old messages with questions are completed sessions, not active prompts
      const messageAge = this.getMessageAge(lastMessage);
      const isOldMessage = messageAge > 30000; // 30 seconds

      // Does it end with a question to the user?
      if (this.endsWithQuestion(lastContent)) {
        if (isOldMessage) {
          console.log(`[OutputMonitor] Message ends with question BUT is old (${Math.floor(messageAge / 1000)}s) - treating as completed session`);
          return 'IDLE';
        }
        console.log('[OutputMonitor] Message ends with question - waiting for user answer');
        return 'AT_PROMPT';
      }

      // Does it contain the ">" prompt pattern?
      if (this.matchesAnyPattern(lastContent, PATTERNS.AT_PROMPT)) {
        console.log('[OutputMonitor] Prompt pattern detected - at command prompt');
        return 'AT_PROMPT';
      }

      // Message complete, no question, no prompt
      // Only applies if stop_reason='end_turn' (not for old messages with undefined stop_reason)
      if (lastMessage.stop_reason === 'end_turn') {
        // Grace period: 10 seconds after completion before allowing RDR
        // (Reduced from 2 minutes since we now have event-driven notification)
        const messageAge = this.getMessageAge(lastMessage);
        if (messageAge < 10000) {
          const ageSeconds = Math.floor(messageAge / 1000);
          console.log(`[OutputMonitor] Recent completion (${ageSeconds}s ago) - grace period active`);
          return 'PROCESSING';
        }
      }

      console.log('[OutputMonitor] Message complete, no prompt/question - session idle');
      return 'IDLE';
    }

    console.log('[OutputMonitor] Unknown state - defaulting to IDLE');
    return 'IDLE';
  }

  /**
   * Helper: Check if the last assistant message has tool_use content blocks
   * without a subsequent tool_result message. This means a tool is actively
   * running (build, user approval, file edit, etc.) and Claude is NOT idle.
   */
  private hasUnresolvedToolUse(lastMessage: any, messages: any[]): boolean {
    // Check if the last assistant message contains tool_use content blocks
    const content = lastMessage.message?.content || lastMessage.content;
    if (!Array.isArray(content)) return false;

    const hasToolUse = content.some((block: any) => block.type === 'tool_use');
    if (!hasToolUse) return false;

    // Check if there's a tool_result after this message
    const lastIndex = messages.indexOf(lastMessage);
    for (let i = lastIndex + 1; i < messages.length; i++) {
      if (messages[i].type === 'tool_result' || messages[i].type === 'user') {
        return false; // Tool result received, not pending
      }
    }

    return true; // tool_use with no subsequent tool_result = tool still running
  }

  /**
   * Helper: Extract last text content from message
   */
  private getLastTextContent(message: any): string {
    if (!message.message?.content) return '';

    const textBlocks = message.message.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text);

    return textBlocks[textBlocks.length - 1] || '';
  }

  /**
   * Helper: Check if text ends with a question
   */
  private endsWithQuestion(text: string): boolean {
    const trimmed = text.trim();
    return trimmed.endsWith('?') || /\?\s*$/m.test(trimmed);
  }

  /**
   * Helper: Check if message is very old (>5 minutes) - session abandoned
   */
  private isMessageVeryOld(message: any): boolean {
    if (!message.timestamp) return false;
    const messageTime = new Date(message.timestamp).getTime();
    const ageMs = Date.now() - messageTime;
    return ageMs > 300000; // 5 minutes
  }

  /**
   * Helper: Get message age from timestamp
   */
  private getMessageAge(message: any): number {
    if (!message.timestamp) return Infinity;
    const messageTime = new Date(message.timestamp).getTime();
    return Date.now() - messageTime;
  }

  /**
   * Update state and log transition if changed
   * Emits events for state changes so RDR can respond immediately
   *
   * CRITICAL FIX: Schedules a re-check timer when entering PROCESSING state.
   * Without this, after Claude's last file write, no more file changes trigger
   * updateState(), so the state stays PROCESSING forever and idle event never fires.
   * The re-check timer ensures we re-evaluate after 15s to detect the transition to IDLE.
   */
  private setState(newState: ClaudeState): void {
    // Clear any pending processing re-check timer on ANY state update
    if (this.processingRecheckTimer) {
      clearTimeout(this.processingRecheckTimer);
      this.processingRecheckTimer = null;
    }

    if (newState !== this.currentState) {
      const oldState = this.currentState;
      this.currentState = newState;
      this.lastStateChange = Date.now();

      const eventData: StateChangeEvent = {
        from: oldState,
        to: newState,
        timestamp: Date.now()
      };

      console.log(
        `[OutputMonitor] State transition: ${oldState} -> ${newState} (after ${this.getTimeSinceStateChange()}ms)`
      );

      // Emit general state change event
      this.emit('stateChange', eventData);

      // Log additional context for debugging and emit specific events
      if (newState === 'AT_PROMPT') {
        console.log('[OutputMonitor] WARNING: Claude is at prompt - RDR should skip sending');
        this.emit('atPrompt', eventData);
      } else if (newState === 'PROCESSING') {
        console.log('[OutputMonitor] INFO: Claude is processing - RDR should skip sending');
        this.emit('processing', eventData);
      } else if (newState === 'IDLE') {
        console.log('[OutputMonitor] INFO: Claude is idle - RDR can send');
        // CRITICAL: Emit 'idle' event for RDR to trigger immediately
        this.emit('idle', eventData);
      }
    }

    // Schedule re-check when in PROCESSING state
    // This ensures we detect when Claude finishes (file stops changing)
    // Without this, state stays PROCESSING forever after the last file write
    if (newState === 'PROCESSING') {
      this.processingRecheckTimer = setTimeout(async () => {
        console.log('[OutputMonitor] Re-checking state after PROCESSING timer...');
        await this.updateState();
      }, ClaudeOutputMonitor.PROCESSING_RECHECK_MS);
    }
  }

  /**
   * Get diagnostic information about current state
   */
  async getDiagnostics(): Promise<{
    state: ClaudeState;
    timeSinceStateChange: number;
    recentOutputFiles: number;
    baseDirExists: boolean;
    latestFileAgeMs?: number;
  }> {
    const latestOutput = await this.getLatestOutputFile().catch(() => null);
    let baseDirExists = false;
    try {
      await fs.access(this.claudeProjectsDir);
      baseDirExists = true;
    } catch {
      baseDirExists = false;
    }

    return {
      state: this.currentState,
      timeSinceStateChange: this.getTimeSinceStateChange(),
      recentOutputFiles: latestOutput ? 1 : 0,
      baseDirExists,
      latestFileAgeMs: latestOutput?.fileAgeMs
    };
  }
}

// Export singleton instance
export const outputMonitor = new ClaudeOutputMonitor();
