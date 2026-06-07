/**
 * Hugging Face repository handlers
 * Handles listing, creating, and detecting HF model repositories
 */

import { ipcMain } from 'electron';
import { execFileSync } from 'child_process';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import type { HuggingFaceModel } from '../../../shared/types/integrations';
import { getIsolatedGitEnv } from '../../utils/git-isolation';
import {
  debugLog,
  getHuggingFaceToken,
  execHuggingFaceCli,
  isValidHuggingFaceRepoId,
  parseHuggingFaceUrl
} from './utils';

const HF_API_BASE = 'https://huggingface.co/api';

/**
 * List user's Hugging Face models
 */
export function registerListHuggingFaceModels(): void {
  ipcMain.handle(
    IPC_CHANNELS.HUGGINGFACE_LIST_MODELS,
    async (): Promise<IPCResult<{ models: HuggingFaceModel[] }>> => {
      debugLog('listHuggingFaceModels handler called');

      try {
        const token = getHuggingFaceToken();
        if (!token) {
          return {
            success: false,
            error: 'Not authenticated. Please login first.'
          };
        }

        // Get username first
        let username: string;
        try {
          const whoamiOutput = execHuggingFaceCli(['whoami']);
          username = whoamiOutput.trim().split('\n')[0];
          if (!username || username.includes('Not logged in')) {
            return {
              success: false,
              error: 'Not logged in to Hugging Face'
            };
          }
        } catch {
          return {
            success: false,
            error: 'Failed to get username'
          };
        }

        // Fetch user's models via API
        const response = await fetch(`${HF_API_BASE}/models?author=${username}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const modelsData = await response.json();
        debugLog('Found models:', modelsData.length);

        const models: HuggingFaceModel[] = modelsData.map((m: Record<string, unknown>) => ({
          id: m.id as string,
          modelId: (m.id as string).split('/')[1] || m.id,
          author: (m.id as string).split('/')[0] || username,
          private: m.private as boolean || false,
          gated: m.gated as boolean | 'auto' | 'manual' || false,
          downloads: m.downloads as number || 0,
          likes: m.likes as number || 0,
          tags: m.tags as string[] || [],
          library: m.library_name as string | null || null,
          pipeline_tag: m.pipeline_tag as string | null || null,
          createdAt: m.createdAt as string || '',
          lastModified: m.lastModified as string || ''
        }));

        return {
          success: true,
          data: { models }
        };
      } catch (error) {
        debugLog('Failed to list models:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list models'
        };
      }
    }
  );
}

/**
 * Detect Hugging Face repo from git remote origin
 */
export function registerDetectHuggingFaceRepo(): void {
  ipcMain.handle(
    IPC_CHANNELS.HUGGINGFACE_DETECT_REPO,
    async (_event, projectPath: string): Promise<IPCResult<{ repoId: string; repoType: string }>> => {
      debugLog('detectHuggingFaceRepo handler called', { projectPath });

      try {
        const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
          encoding: 'utf-8',
          cwd: projectPath,
          stdio: 'pipe',
          env: getIsolatedGitEnv()
        }).trim();

        debugLog('Remote URL:', remoteUrl);

        // Check if it's a Hugging Face URL
        if (!remoteUrl.includes('huggingface.co') && !remoteUrl.includes('hf.co')) {
          return {
            success: false,
            error: 'Remote is not a Hugging Face repository'
          };
        }

        const parsed = parseHuggingFaceUrl(remoteUrl);
        if (parsed) {
          debugLog('Detected HF repo:', parsed);
          return {
            success: true,
            data: {
              repoId: parsed.repoId,
              repoType: parsed.repoType
            }
          };
        }

        return {
          success: false,
          error: 'Could not parse Hugging Face repository from remote URL'
        };
      } catch (error) {
        debugLog('Failed to detect repo:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to detect Hugging Face repository'
        };
      }
    }
  );
}

/**
 * Create a new Hugging Face model repository
 */
export function registerCreateHuggingFaceRepo(): void {
  ipcMain.handle(
    IPC_CHANNELS.HUGGINGFACE_CREATE_REPO,
    async (
      _event,
      repoName: string,
      options: { private?: boolean; projectPath: string }
    ): Promise<IPCResult<{ repoId: string; url: string }>> => {
      debugLog('createHuggingFaceRepo handler called', { repoName, options });

      // Validate repo name
      if (!/^[A-Za-z0-9_.-]+$/.test(repoName)) {
        return {
          success: false,
          error: 'Invalid repository name. Use only letters, numbers, hyphens, underscores, and dots.'
        };
      }

      try {
        const token = getHuggingFaceToken();
        if (!token) {
          return {
            success: false,
            error: 'Not authenticated. Please login first.'
          };
        }

        // Get username
        let username: string;
        try {
          const whoamiOutput = execHuggingFaceCli(['whoami']);
          username = whoamiOutput.trim().split('\n')[0];
          if (!username || username.includes('Not logged in')) {
            return {
              success: false,
              error: 'Not logged in to Hugging Face'
            };
          }
        } catch {
          return {
            success: false,
            error: 'Failed to get username'
          };
        }

        // Create repo via CLI
        const args = ['repo', 'create', repoName, '--type', 'model'];
        if (options.private) {
          args.push('--private');
        }

        debugLog('Running: huggingface-cli', args);
        const output = execHuggingFaceCli(args);
        debugLog('Create repo output:', output);

        const repoId = `${username}/${repoName}`;
        const url = `https://huggingface.co/${repoId}`;

        // Clone the repo to the project path if it's empty
        try {
          execFileSync('git', ['clone', url, '.'], {
            cwd: options.projectPath,
            encoding: 'utf-8',
            stdio: 'pipe',
            env: getIsolatedGitEnv()
          });
        } catch {
          // If clone fails (directory not empty), just add as remote
          try {
            execFileSync('git', ['remote', 'add', 'origin', url], {
              cwd: options.projectPath,
              encoding: 'utf-8',
              stdio: 'pipe',
              env: getIsolatedGitEnv()
            });
          } catch {
            // Remote might already exist, try to set URL
            execFileSync('git', ['remote', 'set-url', 'origin', url], {
              cwd: options.projectPath,
              encoding: 'utf-8',
              stdio: 'pipe',
              env: getIsolatedGitEnv()
            });
          }
        }

        return {
          success: true,
          data: { repoId, url }
        };
      } catch (error) {
        debugLog('Failed to create repo:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create repository'
        };
      }
    }
  );
}

/**
 * Get branches from Hugging Face repo
 */
export function registerGetHuggingFaceBranches(): void {
  ipcMain.handle(
    IPC_CHANNELS.HUGGINGFACE_GET_BRANCHES,
    async (_event, repoId: string): Promise<IPCResult<string[]>> => {
      debugLog('getHuggingFaceBranches handler called', { repoId });

      if (!isValidHuggingFaceRepoId(repoId)) {
        return {
          success: false,
          error: 'Invalid repository ID format'
        };
      }

      try {
        const token = getHuggingFaceToken();
        if (!token) {
          return {
            success: false,
            error: 'Not authenticated. Please login first.'
          };
        }

        // Fetch branches via API
        const response = await fetch(`${HF_API_BASE}/models/${repoId}/refs`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const refsData = await response.json();
        const branches = (refsData.branches || []).map((b: { name: string }) => b.name);
        debugLog('Found branches:', branches);

        // Always include 'main' if not present (HF default)
        if (!branches.includes('main')) {
          branches.unshift('main');
        }

        return {
          success: true,
          data: branches
        };
      } catch (error) {
        debugLog('Failed to get branches:', error instanceof Error ? error.message : error);
        // Return default branch on error
        return {
          success: true,
          data: ['main']
        };
      }
    }
  );
}

/**
 * Check connection to Hugging Face repo
 */
export function registerCheckHuggingFaceConnection(): void {
  ipcMain.handle(
    IPC_CHANNELS.HUGGINGFACE_CHECK_CONNECTION,
    async (_event, repoId: string): Promise<IPCResult<{ connected: boolean; username?: string; error?: string }>> => {
      debugLog('checkHuggingFaceConnection handler called', { repoId });

      try {
        const token = getHuggingFaceToken();
        if (!token) {
          return {
            success: true,
            data: { connected: false, error: 'Not authenticated' }
          };
        }

        // Get username
        let username: string;
        try {
          const whoamiOutput = execHuggingFaceCli(['whoami']);
          username = whoamiOutput.trim().split('\n')[0];
          if (!username || username.includes('Not logged in')) {
            return {
              success: true,
              data: { connected: false, error: 'Not logged in' }
            };
          }
        } catch {
          return {
            success: true,
            data: { connected: false, error: 'Failed to verify authentication' }
          };
        }

        // Check if repo exists and is accessible
        if (repoId && isValidHuggingFaceRepoId(repoId)) {
          const response = await fetch(`${HF_API_BASE}/models/${repoId}`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });

          if (!response.ok) {
            return {
              success: true,
              data: { connected: true, username, error: 'Repository not found or not accessible' }
            };
          }
        }

        return {
          success: true,
          data: { connected: true, username }
        };
      } catch (error) {
        debugLog('Connection check failed:', error instanceof Error ? error.message : error);
        return {
          success: true,
          data: { connected: false, error: error instanceof Error ? error.message : 'Connection failed' }
        };
      }
    }
  );
}

/**
 * Register all Hugging Face repository handlers
 */
export function registerHuggingFaceRepositoryHandlers(): void {
  debugLog('Registering Hugging Face repository handlers');
  registerListHuggingFaceModels();
  registerDetectHuggingFaceRepo();
  registerCreateHuggingFaceRepo();
  registerGetHuggingFaceBranches();
  registerCheckHuggingFaceConnection();
  debugLog('Hugging Face repository handlers registered');
}
