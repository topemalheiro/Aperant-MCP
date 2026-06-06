/**
 * Reprompty Layout Daemon Client (Linux)
 *
 * Communicates with the reprompty-layoutd daemon via Unix domain socket
 * at $XDG_RUNTIME_DIR/reprompty/daemon.sock (falls back to /tmp/reprompty/daemon.sock).
 *
 * Used for positioning VS Code: windows without manual drag-and-drop.
 */

import { connect } from 'net';
import * as path from 'path';

function getSocketPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir) {
    return path.join(runtimeDir, 'reprompty', 'daemon.sock');
  }
  return '/tmp/reprompty/daemon.sock';
}

interface LayoutRequest {
  cmd: 'layout';
  slot: string;
  mode?: 'dual' | 'single';
  panel_side?: 'left' | 'right';
  window_title?: string;
  window_handle?: number;
}

export interface LayoutResponse {
  ok: boolean;
  message?: string;
  error?: string;
  data?: unknown;
}

/**
 * Check if the reprompty layout daemon is running.
 */
export function isLayoutDaemonRunning(): boolean {
  try {
    const socketPath = getSocketPath();
    // Quick check: try to connect and immediately close
    const socket = connect(socketPath);
    let connected = false;
    socket.on('connect', () => {
      connected = true;
      socket.end();
    });
    socket.on('error', () => {
      // Daemon not running
    });
    // Give it a short timeout
    const start = Date.now();
    while (Date.now() - start < 200) {
      if (connected) return true;
      // Busy-wait is acceptable for a 200ms timeout
    }
    socket.destroy();
    return connected;
  } catch {
    return false;
  }
}

/**
 * Send a layout command to the reprompty layout daemon.
 *
 * @param request Layout request parameters
 * @returns Promise resolving to the daemon's response
 */
export function sendLayoutCommand(request: LayoutRequest): Promise<LayoutResponse> {
  return new Promise((resolve) => {
    const socketPath = getSocketPath();
    const socket = connect(socketPath);

    let responseData = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok: false, error: 'Layout daemon connection timed out' });
    }, 5000);

    socket.on('connect', () => {
      socket.write(JSON.stringify(request) + '\n');
    });

    socket.on('data', (chunk: Buffer) => {
      responseData += chunk.toString('utf-8');
    });

    socket.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      try {
        const lines = responseData.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        const response = JSON.parse(lastLine) as LayoutResponse;
        resolve(response);
      } catch {
        resolve({ ok: false, error: 'Invalid response from layout daemon' });
      }
    });

    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: false,
        error: `Layout daemon connection failed: ${err.message}`
      });
    });
  });
}

/**
 * Apply a layout slot to a VS Code: window.
 *
 * @param slot Slot letter (e.g., 'A', 'B') or slot name
 * @param windowTitle Optional window title to target
 * @param windowHandle Optional window handle to target
 */
export async function applyLayoutSlot(
  slot: string,
  windowTitle?: string,
  windowHandle?: number
): Promise<LayoutResponse> {
  return sendLayoutCommand({
    cmd: 'layout',
    slot,
    window_title: windowTitle,
    window_handle: windowHandle
  });
}

/**
 * Get the layout daemon socket path.
 * Useful for logging and diagnostics.
 */
export function getLayoutDaemonSocketPath(): string {
  return getSocketPath();
}
