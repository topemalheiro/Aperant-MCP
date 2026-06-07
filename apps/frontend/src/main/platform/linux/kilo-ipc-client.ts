/**
 * Kilo Code: IPC Client (Linux)
 *
 * A lightweight Unix-domain-socket client for Kilo Code:'s named-pipe protocol.
 * Kilo's node-ipc server speaks a simple JSON-over-socket protocol where each
 * message is a JSON object terminated by a form-feed character (\f, 0x0C).
 *
 * We intentionally do not depend on node-ipc; this module uses Node's built-in
 * `net` module directly.
 *
 * Ported from Reprompty's core/ipc-client.ts, adapted for Aperant-MCP.
 */

import * as net from 'net';
import * as crypto from 'crypto';

const IpcMessageType = {
  Connect: 'Connect',
  Disconnect: 'Disconnect',
  Ack: 'Ack',
  TaskCommand: 'TaskCommand',
  TaskEvent: 'TaskEvent'
} as const;

const IpcOrigin = {
  Client: 'client',
  Server: 'server'
} as const;

const TaskCommandName = {
  StartNewTask: 'StartNewTask',
  CancelTask: 'CancelTask',
  CloseTask: 'CloseTask',
  ResumeTask: 'ResumeTask',
  SendMessage: 'SendMessage'
} as const;

interface AckData {
  clientId: string;
  pid: number;
  ppid: number;
}

interface TaskCommand {
  commandName: string;
  data: unknown;
}

interface IpcMessage {
  type: string;
  origin: string;
  clientId?: string;
  relayClientId?: string;
  data: unknown;
}

const MESSAGE_DELIMITER = '\f';

export interface KiloIpcSendResult {
  success: boolean;
  error?: string;
}

/**
 * Send a chat message to Kilo Code: via its IPC socket.
 *
 * This creates a short-lived connection, waits for the server's Ack,
 * sends a SendMessage TaskCommand, and immediately closes.
 */
export async function sendKiloIpcMessage(
  socketPath: string,
  text: string,
  timeoutMs = 5000
): Promise<KiloIpcSendResult> {
  return new Promise((resolve) => {
    const clientId = `aperant-${crypto.randomBytes(6).toString('hex')}`;
    let resolved = false;
    let buffer = '';
    let serverClientId: string | undefined;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
        resolve({ success: false, error: `Kilo IPC connection timed out (${timeoutMs}ms)` });
      }
    }, timeoutMs);

    const socket = net.createConnection(socketPath, () => {
      // Connection established; wait for server Ack before sending.
    });

    const doResolve = (result: KiloIpcSendResult) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        try {
          socket.end();
          socket.destroy();
        } catch {
          /* ignore */
        }
        resolve(result);
      }
    };

    socket.on('data', (data) => {
      buffer += data.toString('utf-8');

      let delimiterIndex: number;
      while ((delimiterIndex = buffer.indexOf(MESSAGE_DELIMITER)) !== -1) {
        const raw = buffer.slice(0, delimiterIndex);
        buffer = buffer.slice(delimiterIndex + 1);

        if (!raw.trim()) continue;

        try {
          const payload = JSON.parse(raw) as IpcMessage;

          if (payload.origin === IpcOrigin.Server && payload.type === IpcMessageType.Ack) {
            const ack = payload.data as AckData;
            serverClientId = ack.clientId;

            // Send the TaskCommand now that we're acknowledged
            const message: IpcMessage = {
              type: IpcMessageType.TaskCommand,
              origin: IpcOrigin.Client,
              clientId: serverClientId,
              data: {
                commandName: TaskCommandName.SendMessage,
                data: { text, images: [] }
              } as TaskCommand
            };

            socket.write(JSON.stringify(message) + MESSAGE_DELIMITER, (err) => {
              if (err) {
                doResolve({ success: false, error: `Kilo IPC write error: ${err.message}` });
              } else {
                // Give the server a brief moment to process before closing.
                setTimeout(() => doResolve({ success: true }), 150);
              }
            });
          }
        } catch (err) {
          doResolve({
            success: false,
            error: `Kilo IPC parse error: ${err instanceof Error ? err.message : String(err)}`
          });
        }
      }
    });

    socket.on('error', (err) => {
      doResolve({ success: false, error: `Kilo IPC socket error: ${err.message}` });
    });

    socket.on('close', (hadError) => {
      if (!resolved) {
        doResolve({
          success: false,
          error: hadError ? 'Kilo IPC socket closed with error' : 'Kilo IPC socket closed unexpectedly'
        });
      }
    });
  });
}

/**
 * Test whether a Kilo Code: IPC socket is currently accepting connections.
 */
export async function isKiloIpcAvailable(socketPath: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    const socket = net.createConnection(socketPath, () => {
      if (!resolved) {
        resolved = true;
        try {
          socket.end();
          socket.destroy();
        } catch {
          /* ignore */
        }
        resolve(true);
      }
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
        resolve(false);
      }
    }, timeoutMs);

    socket.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(false);
      }
    });

    socket.on('close', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(false);
      }
    });
  });
}
