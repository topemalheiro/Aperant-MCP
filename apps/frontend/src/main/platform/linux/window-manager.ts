/**
 * Linux Window Manager
 *
 * Provides VS Code: window enumeration and message sending on Linux.
 * Supports X11 (wmctrl/xdotool), KDE Wayland (kdotool), and process-based fallback.
 * Uses CDP (Chrome DevTools Protocol) for background prompt sending,
 * falling back to foreground clipboard simulation when CDP is unavailable.
 *
 * Ported from Reprompty's Linux platform layer, adapted for Aperant-MCP.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  sendViaAgentCdp,
  isCdpAvailable,
  getWindowAgentStates,
  findWindowAgentState,
  type AgentKind
} from './linux-cdp-client';

/**
 * Represents a VS Code: window on Linux
 */
export interface VSCodeWindow {
  handle: number;
  title: string;
  processId: number;
  processName?: string;
  /** KDE Wayland kdotool UUID handle (if available) */
  kdotoolHandle?: string;
  /** Detected CDP port for this window's VS Code: instance */
  cdpPort?: number;
  /** Detected active AI agent in this window */
  activeAgent?: AgentKind;
  /** Available AI agents in this window */
  availableAgents?: AgentKind[];
}

/**
 * Result of sending a message to a window
 */
export interface SendMessageResult {
  success: boolean;
  error?: string;
}

const EDITOR_TITLE_SUBSTRINGS = [
  'Visual Studio Code:',
  'Kilo Code:',
  'Kimi Code:',
  'VSCodium',
  'Code: - OSS'
];

const SUPPORTED_EDITOR_PROCESS_NAMES = new Set([
  'code',
  'code-oss',
  'vscodium',
  'codium',
  'kilocode'
]);

const KILO_PIPE_PREFIXES = ['kilo-ipc-', 'kilo-code-', 'roo-code-'];

function isEditorWindowTitle(title: string): boolean {
  return EDITOR_TITLE_SUBSTRINGS.some((substring) => title.includes(substring));
}

function isWaylandSession(): boolean {
  return process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
}

function getKdotoolPath(): string {
  return path.join(process.env.HOME || '', '.local', 'bin', 'kdotool');
}

function hasKdotool(): boolean {
  try {
    fs.accessSync(getKdotoolPath(), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeEditorProcessName(name?: string | null): string {
  return (name ?? '').trim().replace(/\.exe$/i, '').toLowerCase();
}

function isSupportedEditorProcessName(name?: string | null): boolean {
  return SUPPORTED_EDITOR_PROCESS_NAMES.has(normalizeEditorProcessName(name));
}

function fallbackProcessNameFromTitle(title: string): string {
  return title.includes('Kilo Code:') || title.includes('Kimi Code:') ? 'kilocode' : 'code';
}

function getWritableTempDir(): string {
  const candidates = [
    process.env.XDG_RUNTIME_DIR,
    process.env.TMPDIR,
    process.env.TEMP,
    process.env.TMP,
    '/tmp',
    '.'
  ].filter((value): value is string => Boolean(value));

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch {
      // Try next candidate
    }
  }

  return '.';
}

function buildKiloPipeCandidates(pid: number): string[] {
  const tmpDir = getWritableTempDir();
  return KILO_PIPE_PREFIXES.map((prefix) => path.join(tmpDir, `${prefix}${pid}.sock`));
}

function resolveKiloPipePath(pid: number): string | null {
  const candidates = buildKiloPipeCandidates(pid);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate);
      return candidate;
    } catch {
      // Try next candidate
    }
  }

  // Legacy fallback: scan tmp dir for any matching pipe
  try {
    const tmpDir = getWritableTempDir();
    const names = fs
      .readdirSync(tmpDir)
      .filter((name) => KILO_PIPE_PREFIXES.some((prefix) => name.toLowerCase().startsWith(prefix)));
    if (names.length === 1) {
      return path.join(tmpDir, names[0]);
    }
  } catch {
    // Ignore pipe enumeration failures
  }

  return null;
}

function listWindowsKdotool(): Array<{
  pid: number;
  title: string;
  processName: string;
  handle: string;
}> {
  const kdotoolPath = getKdotoolPath();
  const results: Array<{ pid: number; title: string; processName: string; handle: string }> = [];
  const seenHandles = new Set<string>();

  for (const term of EDITOR_TITLE_SUBSTRINGS) {
    try {
      const output = execSync(
        `"${kdotoolPath}" search --title ${JSON.stringify(term)} --limit 0`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();

      const lines = output
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('{'));
      for (const handleStr of lines) {
        try {
          if (seenHandles.has(handleStr)) {
            continue;
          }
          seenHandles.add(handleStr);

          const title = execSync(`"${kdotoolPath}" getwindowname ${handleStr}`, {
            encoding: 'utf-8',
            timeout: 2000
          }).trim();

          if (!title || !isEditorWindowTitle(title)) {
            continue;
          }

          let pid = 0;
          try {
            const pidStr = execSync(`"${kdotoolPath}" getwindowpid ${handleStr}`, {
              encoding: 'utf-8',
              timeout: 2000
            }).trim();
            pid = parseInt(pidStr, 10);
          } catch {
            pid = 0;
          }

          let processName = '';
          if (pid) {
            try {
              processName = execSync(`ps -p ${pid} -o comm=`, {
                encoding: 'utf-8',
                timeout: 2000
              }).trim();
            } catch {
              processName = '';
            }
          }

          if (!processName) {
            processName = fallbackProcessNameFromTitle(title);
          }

          if (!isSupportedEditorProcessName(processName)) {
            continue;
          }

          results.push({ pid, title, processName, handle: handleStr });
        } catch {
          // skip individual window errors
        }
      }
    } catch {
      // search term failed
    }
  }

  return results;
}

function findKdotoolHandleByPid(pid: number): string | null {
  if (!hasKdotool()) return null;
  const kdotoolPath = getKdotoolPath();
  try {
    const output = execSync(`"${kdotoolPath}" search ".*"`, {
      encoding: 'utf-8',
      timeout: 5000
    }).trim();
    const lines = output
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('{'));
    for (const handle of lines) {
      try {
        const pidStr = execSync(`"${kdotoolPath}" getwindowpid ${handle}`, {
          encoding: 'utf-8',
          timeout: 2000
        }).trim();
        if (parseInt(pidStr, 10) === pid) {
          return handle;
        }
      } catch {
        // continue
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function listEditorProcesses(): Array<{ pid: number; processName: string; title: string }> {
  const results: Array<{ pid: number; processName: string; title: string }> = [];
  try {
    const psOutput = execSync('ps -eo pid,comm,args', {
      encoding: 'utf-8',
      timeout: 5000
    });

    const lines = psOutput
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const seenPids = new Set<number>();

    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
      if (!match) continue;

      const pid = parseInt(match[1], 10);
      const comm = match[2];
      const args = match[3];

      if (seenPids.has(pid)) continue;

      const normalizedComm = normalizeEditorProcessName(comm);
      if (!SUPPORTED_EDITOR_PROCESS_NAMES.has(normalizedComm)) {
        continue;
      }

      // Skip helper processes (zygote, gpu, renderer, crashpad)
      if (
        args.includes('--type=zygote') ||
        args.includes('--type=gpu') ||
        args.includes('--type=renderer') ||
        args.includes('crashpad')
      ) {
        continue;
      }

      // Extract folder path from args if available
      let folderPath = '';
      const folderMatch = args.match(/\s+(-n|--new-window)\s+"?([^"]+)"?/);
      if (folderMatch) {
        folderPath = folderMatch[2];
      } else {
        const pathMatch = args.match(/\s+([^\s-][^\s]*)\s*$/);
        if (pathMatch && !pathMatch[1].startsWith('-')) {
          folderPath = pathMatch[1];
        }
      }

      const displayTitle = folderPath
        ? `${path.basename(folderPath)} - Visual Studio Code:`
        : 'Visual Studio Code:';

      seenPids.add(pid);
      results.push({
        pid,
        processName: normalizedComm,
        title: displayTitle
      });
    }
  } catch (err) {
    console.error('[LinuxWindowManager] listEditorProcesses error:', err);
  }

  return results;
}

function parseArgvJson(portFile: string): number | null {
  try {
    if (!fs.existsSync(portFile)) return null;
    const raw = fs.readFileSync(portFile, 'utf-8');
    const parsed = JSON.parse(raw);
    const port = parsed['remote-debugging-port'];
    if (typeof port === 'number' || typeof port === 'string') {
      const n = parseInt(String(port), 10);
      if (!isNaN(n)) return n;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Discover the CDP port from VS Code:'s DevToolsActivePort file.
 * Falls back to parsing ~/.vscode/argv.json for "remote-debugging-port".
 */
export function getCdpPort(): number | null {
  try {
    const homeDir = process.env.HOME;
    if (!homeDir) return null;

    const candidates = [
      path.join(homeDir, '.config', 'Code', 'DevToolsActivePort'),
      path.join(homeDir, '.config', 'VSCodium', 'DevToolsActivePort'),
      path.join(homeDir, '.config', 'Code - OSS', 'DevToolsActivePort')
    ];

    for (const portFile of candidates) {
      if (!fs.existsSync(portFile)) continue;

      const content = fs.readFileSync(portFile, 'utf-8').trim();
      const port = parseInt(content.split('\n')[0], 10);
      if (!isNaN(port)) return port;
    }

    const argvCandidates = [
      path.join(homeDir, '.vscode', 'argv.json'),
      path.join(homeDir, '.config', 'VSCodium', 'argv.json'),
      path.join(homeDir, '.config', 'Code - OSS', 'argv.json')
    ];
    for (const argvFile of argvCandidates) {
      const port = parseArgvJson(argvFile);
      if (port !== null) return port;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get all VS Code: windows currently open on Linux.
 *
 * Uses a 3-tier detection strategy:
 * 1. X11: wmctrl -l -p
 * 2. KDE Wayland: kdotool search
 * 3. Process fallback: ps -eo pid,comm,args
 *
 * Also probes each window via CDP to detect active AI agents.
 */
export async function getVSCodeWindows(): Promise<VSCodeWindow[]> {
  const windows: VSCodeWindow[] = [];
  const cdpPort = getCdpPort();
  let agentStates: import('./linux-cdp-client').WindowAgentState[] = [];

  if (cdpPort) {
    try {
      agentStates = await getWindowAgentStates(cdpPort);
    } catch {
      // CDP not available, continue without agent detection
    }
  }

  // Tier 1: X11 via wmctrl
  try {
    const output = execSync('wmctrl -l -p', { encoding: 'utf-8', timeout: 5000 });
    const lines = output
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;

      const handle = parseInt(parts[0], 16);
      const pid = parseInt(parts[2], 10);
      const title = parts.slice(3).join(' ');

      if (!isEditorWindowTitle(title)) continue;

      let processName = '';
      try {
        processName = execSync(`ps -p ${pid} -o comm=`, {
          encoding: 'utf-8',
          timeout: 2000
        }).trim();
      } catch {
        processName = '';
      }

      if (processName && !isSupportedEditorProcessName(processName)) continue;

      const resolvedName = processName || fallbackProcessNameFromTitle(title);
      const agentState = findWindowAgentState(agentStates, title);

      windows.push({
        handle,
        title,
        processId: pid,
        processName: resolvedName,
        cdpPort: cdpPort || undefined,
        activeAgent: agentState?.activeAgent,
        availableAgents: agentState?.availableAgents
      });
    }
  } catch {
    // wmctrl failed — likely on Wayland or not installed
  }

  // Tier 2: KDE Wayland via kdotool
  if (windows.length === 0 && hasKdotool()) {
    for (const win of listWindowsKdotool()) {
      const agentState = findWindowAgentState(agentStates, win.title);
      windows.push({
        handle: win.pid, // Use PID as surrogate handle on Wayland
        title: win.title,
        processId: win.pid,
        processName: win.processName,
        kdotoolHandle: win.handle,
        cdpPort: cdpPort || undefined,
        activeAgent: agentState?.activeAgent,
        availableAgents: agentState?.availableAgents
      });
    }
  }

  // Tier 3: Process fallback for Wayland
  if (windows.length === 0 && isWaylandSession()) {
    for (const proc of listEditorProcesses()) {
      const agentState = findWindowAgentState(agentStates, proc.title);
      windows.push({
        handle: proc.pid,
        title: proc.title,
        processId: proc.pid,
        processName: proc.processName,
        cdpPort: cdpPort || undefined,
        activeAgent: agentState?.activeAgent,
        availableAgents: agentState?.availableAgents
      });
    }
  }

  return windows;
}

export function findWindowByTitle(pattern: string): VSCodeWindow | undefined {
  const windows = getVSCodeWindowsSync();
  const lowerPattern = pattern.toLowerCase();
  return windows.find((w) => w.title.toLowerCase().includes(lowerPattern));
}

export function findWindowByHandle(handle: number): VSCodeWindow | undefined {
  const windows = getVSCodeWindowsSync();
  return windows.find((w) => w.handle === handle);
}

export function findWindowByProcessId(pid: number): VSCodeWindow | undefined {
  const windows = getVSCodeWindowsSync();
  return windows.find((w) => w.processId === pid);
}

export function findWindow(identifier: number | string): VSCodeWindow | undefined {
  if (typeof identifier === 'number') {
    return findWindowByHandle(identifier) ?? findWindowByProcessId(identifier);
  }
  return findWindowByTitle(identifier);
}

export function isWindowValid(handle: number): boolean {
  const windows = getVSCodeWindowsSync();
  return windows.some((w) => w.handle === handle);
}

// Synchronous version for findWindow* helpers (uses cached results or simple detection)
function getVSCodeWindowsSync(): VSCodeWindow[] {
  // Note: CDP probing is async, so sync callers don't get agent state.
  // This is acceptable for findWindow/isWindowValid which only need basic info.
  const windows: VSCodeWindow[] = [];

  try {
    const output = execSync('wmctrl -l -p', { encoding: 'utf-8', timeout: 3000 });
    const lines = output
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;

      const handle = parseInt(parts[0], 16);
      const pid = parseInt(parts[2], 10);
      const title = parts.slice(3).join(' ');

      if (!isEditorWindowTitle(title)) continue;

      windows.push({
        handle,
        title,
        processId: pid
      });
    }
  } catch {
    // wmctrl failed
  }

  if (windows.length === 0 && hasKdotool()) {
    for (const win of listWindowsKdotool()) {
      windows.push({
        handle: win.pid,
        title: win.title,
        processId: win.pid,
        processName: win.processName,
        kdotoolHandle: win.handle
      });
    }
  }

  if (windows.length === 0 && isWaylandSession()) {
    for (const proc of listEditorProcesses()) {
      windows.push({
        handle: proc.pid,
        title: proc.title,
        processId: proc.pid,
        processName: proc.processName
      });
    }
  }

  return windows;
}

/**
 * Send a message to a VS Code: window on Linux.
 *
 * Strategy:
 * 1. Try CDP-based background sending (no window focus needed)
 * 2. Fall back to foreground clipboard simulation (xdotool/xclip or kdotool/wl-copy)
 * 3. Return error if all methods fail
 */
export async function sendMessageToWindow(
  identifier: number | string,
  message: string
): Promise<SendMessageResult> {
  if (!identifier && identifier !== 0) {
    return { success: false, error: 'Window identifier cannot be empty' };
  }
  if (!message) {
    return { success: false, error: 'Message cannot be empty' };
  }

  // Re-enumerate windows to get fresh data
  const windows = await getVSCodeWindows();
  if (windows.length === 0) {
    return { success: false, error: 'No VS Code: windows found on Linux' };
  }

  const targetWindow = findWindow(identifier);
  if (!targetWindow) {
    const availableTitles = windows.map((w) => w.title).join(', ');
    return {
      success: false,
      error: `No window found matching "${identifier}". Available: ${availableTitles}`
    };
  }

  console.log(
    `[LinuxWindowManager] Found window: "${targetWindow.title}" (PID: ${targetWindow.processId})`
  );

  // Strategy 1: CDP-based background sending
  const cdpPort = targetWindow.cdpPort || getCdpPort();
  if (cdpPort) {
    const activeAgent = targetWindow.activeAgent;
    if (activeAgent && activeAgent !== 'unknown') {
      console.log(`[LinuxWindowManager] Trying CDP send via ${activeAgent} on port ${cdpPort}`);
      const result = await sendViaAgentCdp(cdpPort, message, {
        agent: activeAgent,
        windowTitle: targetWindow.title
      });
      if (result.success) {
        console.log('[LinuxWindowManager] CDP send succeeded');
        return { success: true };
      }
      console.warn('[LinuxWindowManager] CDP send failed:', result.error);
    } else {
      // Try common agents in order of preference
      const agentsToTry: Exclude<AgentKind, 'unknown'>[] = ['kilo-code', 'kimi-code', 'claude-code', 'codex'];
      const available = targetWindow.availableAgents || [];
      for (const agent of agentsToTry) {
        if (available.length > 0 && !available.includes(agent)) continue;
        console.log(`[LinuxWindowManager] Trying CDP send via ${agent} on port ${cdpPort}`);
        const result = await sendViaAgentCdp(cdpPort, message, {
          agent,
          windowTitle: targetWindow.title
        });
        if (result.success) {
          console.log('[LinuxWindowManager] CDP send succeeded via', agent);
          return { success: true };
        }
      }
    }
  }

  // Strategy 2: Foreground clipboard simulation
  console.log('[LinuxWindowManager] Falling back to foreground clipboard simulation');
  const foregroundResult = await sendMessageForeground(targetWindow, message);
  if (foregroundResult) {
    return { success: true };
  }

  return { success: false, error: 'All Linux sending methods failed (CDP and foreground)' };
}

/**
 * Send a message via foreground clipboard simulation.
 * On X11: xdotool + xclip/xsel
 * On Wayland: kdotool + wl-copy + wtype/ydotool
 */
async function sendMessageForeground(
  window: VSCodeWindow,
  message: string
): Promise<boolean> {
  try {
    const tempDir = getWritableTempDir();
    const msgFile = path.join(tempDir, `aperant-rdr-msg-${Date.now()}.txt`);
    fs.writeFileSync(msgFile, message, 'utf-8');

    if (isWaylandSession()) {
      // Wayland path
      const kdotoolPath = getKdotoolPath();
      const kdotoolHandle = window.kdotoolHandle || (window.processId ? findKdotoolHandleByPid(window.processId) : null);

      const script = `#!/bin/bash
msg_file="${msgFile}"
message=$(cat "$msg_file")
rm -f "$msg_file"

# Copy to clipboard (wl-copy for Wayland)
if command -v wl-copy >/dev/null 2>&1; then
  echo -n "$message" | setsid wl-copy &>/dev/null
else
  echo "wl-copy not available" >&2
  exit 1
fi

# Focus window using kdotool if available
${kdotoolHandle ? `"${kdotoolPath}" windowactivate ${kdotoolHandle}` : '# kdotool handle not found'}
${kdotoolHandle ? 'sleep 0.15' : '# skipping focus wait'}

# Paste and send — prefer wtype (no daemon), fall back to ydotool
wtype_ok=false
if command -v wtype >/dev/null 2>&1; then
  if wtype -M ctrl -k v -m ctrl 2>/dev/null; then
    sleep 0.1
    if wtype -k Return 2>/dev/null; then
      wtype_ok=true
    fi
  fi
fi

if [ "$wtype_ok" != "true" ] && command -v ydotool >/dev/null 2>&1; then
  if [ ! -S /run/user/$(id -u)/ydotoold_socket ]; then
    ydotoold --socket-path=/run/user/$(id -u)/ydotoold_socket --socket-own=$(id -u):$(id -g) &
    sleep 0.5
  fi
  export YDOTOOL_SOCKET=/run/user/$(id -u)/ydotoold_socket
  ydotool key 29:1 47:1 47:0 29:0
  sleep 0.1
  ydotool key 28:1 28:0
elif [ "$wtype_ok" != "true" ]; then
  echo "No typing tool available (wtype or ydotool)" >&2
  exit 1
fi

echo "sent"
`;
      const shFile = path.join(tempDir, `aperant-rdr-send-${Date.now()}.sh`);
      fs.writeFileSync(shFile, script, 'utf-8');
      fs.chmodSync(shFile, 0o755);

      try {
        const result = execSync(`"${shFile}"`, { encoding: 'utf-8', timeout: 10000 }).trim();
        return result.includes('sent');
      } finally {
        try {
          fs.unlinkSync(shFile);
        } catch {
          /* ignore */
        }
      }
    }

    // X11 path
    const script = `#!/bin/bash
msg_file="${msgFile}"
handle="${window.handle}"
message=$(cat "$msg_file")
rm -f "$msg_file"

# Copy to clipboard
if command -v xclip >/dev/null 2>&1; then
  echo -n "$message" | xclip -selection clipboard
elif command -v xsel >/dev/null 2>&1; then
  echo -n "$message" | xsel --clipboard --input
else
  echo "No clipboard tool available" >&2
  exit 1
fi

# Focus window
xdotool windowactivate "$handle"
sleep 0.15

# Paste
xdotool key --clearmodifiers ctrl+v
sleep 0.1

# Press Enter
xdotool key --clearmodifiers Return
sleep 0.05

echo "sent"
`;
    const shFile = path.join(tempDir, `aperant-rdr-send-${Date.now()}.sh`);
    fs.writeFileSync(shFile, script, 'utf-8');
    fs.chmodSync(shFile, 0o755);

    try {
      const result = execSync(`"${shFile}"`, { encoding: 'utf-8', timeout: 10000 }).trim();
      return result.includes('sent');
    } finally {
      try {
        fs.unlinkSync(shFile);
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    console.error('[LinuxWindowManager] Foreground send error:', err);
    return false;
  }
}

/**
 * Check if Claude Code (or any AI agent) is currently busy.
 *
 * Detection strategy:
 * 1. Check window title for busy indicators
 * 2. Check MCP connection monitor
 * 3. Check OutputMonitor state
 */
export async function isClaudeCodeBusy(identifier: number | string): Promise<boolean> {
  try {
    console.log('[LinuxWindowManager] Checking if AI agent is busy...');

    const windows = await getVSCodeWindows();
    const targetWindow = findWindow(identifier);

    if (!targetWindow) {
      console.warn('[LinuxWindowManager] Window not found, assuming idle');
      return false;
    }

    // Check window title for busy patterns
    const busyPatterns = [
      /thinking/i,
      /generating/i,
      /processing/i,
      /claude.*working/i,
      /claude's plan/i,
      /kimi.*working/i,
      /kilo.*working/i
    ];

    const titleIndicatesBusy = busyPatterns.some((pattern) => pattern.test(targetWindow.title));
    if (titleIndicatesBusy) {
      console.log(`[LinuxWindowManager] BUSY: Window title indicates busy — "${targetWindow.title}"`);
      return true;
    }

    // Check MCP connection monitor
    try {
      const { mcpMonitor } = await import('../../mcp-server');
      if (mcpMonitor?.isBusy()) {
        console.log('[LinuxWindowManager] BUSY: MCP connection active');
        return true;
      }
    } catch {
      // MCP monitor not available
    }

    // Check OutputMonitor
    try {
      const { outputMonitor } = await import('../../claude-code/output-monitor');
      const state = outputMonitor?.getCurrentState();
      if (state === 'PROCESSING') {
        console.log('[LinuxWindowManager] BUSY: OutputMonitor reports PROCESSING');
        return true;
      }
    } catch {
      // OutputMonitor not available
    }

    console.log('[LinuxWindowManager] All checks passed — agent is IDLE');
    return false;
  } catch (error) {
    console.error('[LinuxWindowManager] Error checking busy state:', error);
    return false;
  }
}

/**
 * Check if CDP is available for background sending to a specific agent.
 */
export async function checkCdpForAgent(agent?: AgentKind): Promise<boolean> {
  const port = getCdpPort();
  if (!port) return false;
  const agentToCheck = agent && agent !== 'unknown' ? agent : 'kilo-code';
  return isCdpAvailable(port, agentToCheck);
}
