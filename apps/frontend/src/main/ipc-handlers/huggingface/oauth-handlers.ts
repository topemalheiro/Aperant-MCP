/**
 * Hugging Face OAuth handlers using huggingface-cli
 * Provides authentication flow for Hugging Face Hub
 */

import { ipcMain, shell } from 'electron';
import { spawn } from 'child_process';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import { getAugmentedEnv } from '../../env-utils';
import { openTerminalWithCommand } from '../claude-code-handlers';
import {
  debugLog,
  findHuggingFaceCli,
  getHuggingFaceToken,
  execHuggingFaceCli,
  parseCliOutput
} from './utils';

/**
 * Check if huggingface-cli is installed
 */
export function registerCheckHuggingFaceCli(): void {
  ipcMain.handle(
    IPC_CHANNELS.HUGGINGFACE_CHECK_CLI,
    async (): Promise<IPCResult<{ installed: boolean; version?: string }>> => {
      debugLog('checkHuggingFaceCli handler called');
      try {
        const cliPath = findHuggingFaceCli();
        if (!cliPath) {
          debugLog('huggingface-cli not found');
          return {
            success: true,
            data: { installed: false }
          };
        }
        debugLog('huggingface-cli found:', cliPath);

        // Get version
        try {
          const versionOutput = execHuggingFaceCli(['--version']);
          const version = versionOutput.trim().split('\n')[0];
          debugLog('huggingface-cli version:', version);

          return {
            success: true,
            data: { installed: true, version }
          };
        } catch {
          // CLI found but version check failed - still consider it installed
          return {
            success: true,
            data: { installed: true }
          };
        }
      } catch (error) {
        debugLog('huggingface-cli check error:', error instanceof Error ? error.message : error);
        return {
          success: true,
          data: { installed: false }
        };
      }
    }
  );
}

/**
 * Install huggingface-cli by opening a terminal with the install command
 */
export function registerInstallHuggingFaceCli(): void {
  ipcMain.handle(
    IPC_CHANNELS.HUGGINGFACE_INSTALL_CLI,
    async (): Promise<IPCResult<{ command: string }>> => {
      debugLog('installHuggingFaceCli handler called');
      try {
        // pip install is cross-platform
        const command = 'pip install -U huggingface_hub';

        debugLog('Install command:', command);
        debugLog('Opening terminal...');
        await openTerminalWithCommand(command);
        debugLog('Terminal opened successfully');

        return {
          success: true,
          data: { command }
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        debugLog('Install failed:', errorMsg);
        return {
          success: false,
          error: `Failed to open terminal for installation: ${errorMsg}`
        };
      }
    }
  );
}

/**
 * Check if user is authenticated with Hugging Face
 */
export function registerCheckHuggingFaceAuth(): void {
  ipcMain.handle(
    IPC_CHANNELS.HUGGINGFACE_CHECK_AUTH,
    async (): Promise<IPCResult<{ authenticated: boolean; username?: string }>> => {
      debugLog('checkHuggingFaceAuth handler called');

      try {
        // First check if we have a token
        const token = getHuggingFaceToken();
        if (!token) {
          debugLog('No token found');
          return {
            success: true,
            data: { authenticated: false }
          };
        }

        // Verify token by running whoami
        try {
          const whoamiOutput = execHuggingFaceCli(['whoami']);
          const username = parseCliOutput(whoamiOutput);

          if (username && !username.includes('Not logged in')) {
            debugLog('Authenticated as:', username);
            return {
              success: true,
              data: { authenticated: true, username }
            };
          }
        } catch {
          // whoami failed, token might be invalid
        }

        return {
          success: true,
          data: { authenticated: false }
        };
      } catch (error) {
        debugLog('Auth check failed:', error instanceof Error ? error.message : error);
        return {
          success: true,
          data: { authenticated: false }
        };
      }
    }
  );
}

/**
 * Start Hugging Face login flow
 */
export function registerHuggingFaceLogin(): void {
  ipcMain.handle(
    IPC_CHANNELS.HUGGINGFACE_LOGIN,
    async (): Promise<IPCResult<{ success: boolean; message?: string }>> => {
      debugLog('huggingFaceLogin handler called');

      return new Promise((resolve) => {
        try {
          const env = getAugmentedEnv();

          // Try to find the CLI
          const cliPath = findHuggingFaceCli();
          let command: string;
          let args: string[];

          if (cliPath && !cliPath.includes('python')) {
            command = 'huggingface-cli';
            args = ['login'];
          } else {
            // Use Python module
            command = process.platform === 'win32' ? 'python' : 'python3';
            args = ['-m', 'huggingface_hub.cli', 'login'];
          }

          debugLog('Spawning:', command, args);

          const loginProcess = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env
          });

          let output = '';
          let errorOutput = '';
          let browserOpened = false;

          loginProcess.stdout?.on('data', (data) => {
            const chunk = data.toString();
            output += chunk;
            debugLog('stdout:', chunk);

            // Open browser if URL detected
            const urlMatch = chunk.match(/https?:\/\/huggingface\.co[^\s]*/);
            if (urlMatch && !browserOpened) {
              browserOpened = true;
              shell.openExternal(urlMatch[0]).catch((err) => {
                debugLog('Failed to open browser:', err);
              });
            }
          });

          loginProcess.stderr?.on('data', (data) => {
            const chunk = data.toString();
            errorOutput += chunk;
            debugLog('stderr:', chunk);
          });

          loginProcess.on('close', (code) => {
            debugLog('login process exited with code:', code);

            if (code === 0) {
              resolve({
                success: true,
                data: {
                  success: true,
                  message: 'Successfully logged in to Hugging Face'
                }
              });
            } else {
              resolve({
                success: false,
                error: errorOutput || `Login failed with exit code ${code}`
              });
            }
          });

          loginProcess.on('error', (error) => {
            debugLog('login process error:', error.message);
            resolve({
              success: false,
              error: error.message
            });
          });

          // The CLI will prompt for token input - open the token page for user
          setTimeout(() => {
            if (!browserOpened) {
              shell.openExternal('https://huggingface.co/settings/tokens').catch((err) => {
                debugLog('Failed to open token page:', err);
              });
            }
          }, 1000);

        } catch (error) {
          debugLog('Exception in huggingFaceLogin:', error instanceof Error ? error.message : error);
          resolve({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      });
    }
  );
}

/**
 * Login to Hugging Face with a token (non-interactive)
 * This is the recommended approach since huggingface-cli login is interactive
 */
export function registerHuggingFaceLoginWithToken(): void {
  ipcMain.handle(
    IPC_CHANNELS.HUGGINGFACE_LOGIN_WITH_TOKEN,
    async (_, token: string): Promise<IPCResult<{ success: boolean }>> => {
      debugLog('huggingFaceLoginWithToken handler called');

      if (!token || token.trim().length === 0) {
        return {
          success: false,
          error: 'Token is required'
        };
      }

      try {
        // Use login command (the deprecation warning suggests 'hf auth login' but it doesn't exist)
        // --add-to-git-credential stores the token for git operations
        execHuggingFaceCli(['login', '--token', token.trim(), '--add-to-git-credential']);
        debugLog('Login with token successful');

        return {
          success: true,
          data: { success: true }
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Login failed';
        debugLog('Login with token failed:', errorMsg);
        return {
          success: false,
          error: errorMsg
        };
      }
    }
  );
}

/**
 * Get the current Hugging Face token
 */
export function registerGetHuggingFaceToken(): void {
  ipcMain.handle(
    IPC_CHANNELS.HUGGINGFACE_GET_TOKEN,
    async (): Promise<IPCResult<{ token: string }>> => {
      debugLog('getHuggingFaceToken handler called');

      try {
        const token = getHuggingFaceToken();

        if (!token) {
          return {
            success: false,
            error: 'No token found. Please login first.'
          };
        }

        return {
          success: true,
          data: { token }
        };
      } catch (error) {
        debugLog('Failed to get token:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get token'
        };
      }
    }
  );
}

/**
 * Get the authenticated Hugging Face user info
 */
export function registerGetHuggingFaceUser(): void {
  ipcMain.handle(
    IPC_CHANNELS.HUGGINGFACE_GET_USER,
    async (): Promise<IPCResult<{ username: string; fullname?: string }>> => {
      debugLog('getHuggingFaceUser handler called');

      try {
        const whoamiOutput = execHuggingFaceCli(['whoami']);
        const username = parseCliOutput(whoamiOutput);

        if (!username || username.includes('Not logged in')) {
          return {
            success: false,
            error: 'Not logged in to Hugging Face'
          };
        }

        debugLog('Username:', username);

        return {
          success: true,
          data: { username }
        };
      } catch (error) {
        debugLog('Failed to get user info:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get user info'
        };
      }
    }
  );
}

/**
 * Register all Hugging Face OAuth handlers
 */
export function registerHuggingFaceOAuthHandlers(): void {
  debugLog('Registering Hugging Face OAuth handlers');
  registerCheckHuggingFaceCli();
  registerInstallHuggingFaceCli();
  registerCheckHuggingFaceAuth();
  registerHuggingFaceLogin();
  registerHuggingFaceLoginWithToken();
  registerGetHuggingFaceToken();
  registerGetHuggingFaceUser();
  debugLog('Hugging Face OAuth handlers registered');
}
