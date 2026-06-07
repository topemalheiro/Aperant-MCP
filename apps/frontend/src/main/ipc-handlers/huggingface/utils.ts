/**
 * Hugging Face utility functions
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getAugmentedEnv, findExecutable } from '../../env-utils';

/**
 * Strip ANSI escape codes from a string
 */
export function stripAnsiCodes(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Parse CLI output, filtering out warning/deprecation lines and ANSI codes
 * Returns the first non-warning, non-empty line (typically the actual data)
 */
export function parseCliOutput(output: string): string {
  const lines = output.trim().split('\n');
  for (const line of lines) {
    const cleaned = stripAnsiCodes(line).trim();
    // Skip warning lines
    if (cleaned.startsWith('Warning:') || cleaned.includes('is deprecated')) {
      continue;
    }
    // Skip empty lines
    if (!cleaned) {
      continue;
    }
    return cleaned;
  }
  // Fallback: return the whole output stripped of ANSI
  return stripAnsiCodes(output.trim());
}

// Debug logging helper
const DEBUG = process.env.NODE_ENV === 'development' && process.env.DEBUG === 'true';

/**
 * Redact sensitive information from data before logging
 */
function redactSensitiveData(data: unknown): unknown {
  if (typeof data === 'string') {
    // Redact anything that looks like a HF token (hf_*)
    return data.replace(/hf_[A-Za-z0-9]+/g, 'hf_[REDACTED]');
  }
  if (typeof data === 'object' && data !== null) {
    if (Array.isArray(data)) {
      return data.map(redactSensitiveData);
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (/token|password|secret|credential|auth/i.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSensitiveData(value);
      }
    }
    return result;
  }
  return data;
}

export function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[HuggingFace] ${message}`, redactSensitiveData(data));
    } else {
      console.debug(`[HuggingFace] ${message}`);
    }
  }
}

/**
 * Get the Hugging Face token from various sources
 * Priority: HF_TOKEN env var > ~/.cache/huggingface/token
 */
export function getHuggingFaceToken(): string | null {
  // Check environment variable first
  const envToken = process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN;
  if (envToken) {
    debugLog('Found token in environment variable');
    return envToken;
  }

  // Check cached token file
  const tokenPath = join(homedir(), '.cache', 'huggingface', 'token');
  if (existsSync(tokenPath)) {
    try {
      const token = readFileSync(tokenPath, 'utf-8').trim();
      if (token) {
        debugLog('Found token in cache file');
        return token;
      }
    } catch (error) {
      debugLog('Failed to read token file:', error instanceof Error ? error.message : error);
    }
  }

  // Windows alternative path
  if (process.platform === 'win32') {
    const winTokenPath = join(homedir(), '.huggingface', 'token');
    if (existsSync(winTokenPath)) {
      try {
        const token = readFileSync(winTokenPath, 'utf-8').trim();
        if (token) {
          debugLog('Found token in Windows cache file');
          return token;
        }
      } catch (error) {
        debugLog('Failed to read Windows token file:', error instanceof Error ? error.message : error);
      }
    }
  }

  return null;
}

/**
 * Find the huggingface-cli executable
 */
export function findHuggingFaceCli(): string | null {
  // Try common names via findExecutable
  const cliNames = ['huggingface-cli', 'hf'];

  for (const name of cliNames) {
    const path = findExecutable(name);
    if (path) {
      debugLog('Found CLI via findExecutable:', path);
      return path;
    }
  }

  // On Windows, check common Python Scripts locations
  if (process.platform === 'win32') {
    const pythonPaths = [
      join(homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'Scripts', 'huggingface-cli.exe'),
      join(homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'Scripts', 'huggingface-cli.exe'),
      join(homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'Scripts', 'huggingface-cli.exe'),
      join(homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python310', 'Scripts', 'huggingface-cli.exe'),
      join(homedir(), 'AppData', 'Roaming', 'Python', 'Python313', 'Scripts', 'huggingface-cli.exe'),
      join(homedir(), 'AppData', 'Roaming', 'Python', 'Python312', 'Scripts', 'huggingface-cli.exe'),
      'C:\\Python313\\Scripts\\huggingface-cli.exe',
      'C:\\Python312\\Scripts\\huggingface-cli.exe',
    ];

    for (const pythonPath of pythonPaths) {
      if (existsSync(pythonPath)) {
        debugLog('Found CLI at Windows path:', pythonPath);
        return pythonPath;
      }
    }
  }

  // Try Python module invocation
  try {
    execFileSync('python', ['-m', 'huggingface_hub.cli', '--version'], {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: getAugmentedEnv()
    });
    debugLog('Found CLI via python module');
    return 'python -m huggingface_hub.cli';
  } catch {
    // Not available
  }

  try {
    execFileSync('python3', ['-m', 'huggingface_hub.cli', '--version'], {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: getAugmentedEnv()
    });
    debugLog('Found CLI via python3 module');
    return 'python3 -m huggingface_hub.cli';
  } catch {
    // Not available
  }

  return null;
}

/**
 * Execute huggingface-cli command
 */
export function execHuggingFaceCli(args: string[]): string {
  const env = {
    ...getAugmentedEnv(),
    // Fix Windows encoding issues with emoji in CLI output
    PYTHONIOENCODING: 'utf-8'
  };

  // Use findHuggingFaceCli to get the correct path
  const cliPath = findHuggingFaceCli();

  if (cliPath) {
    // If it's a Python module path
    if (cliPath.includes('python')) {
      const pythonCmd = cliPath.startsWith('python3') ? 'python3' : 'python';
      return execFileSync(pythonCmd, ['-m', 'huggingface_hub.cli', ...args], {
        encoding: 'utf-8',
        stdio: 'pipe',
        env
      });
    }

    // Direct executable path
    return execFileSync(cliPath, args, {
      encoding: 'utf-8',
      stdio: 'pipe',
      env
    });
  }

  // Fallback: Try Python module directly
  try {
    return execFileSync('python', ['-m', 'huggingface_hub.cli', ...args], {
      encoding: 'utf-8',
      stdio: 'pipe',
      env
    });
  } catch {
    return execFileSync('python3', ['-m', 'huggingface_hub.cli', ...args], {
      encoding: 'utf-8',
      stdio: 'pipe',
      env
    });
  }
}

/**
 * Validate Hugging Face repo ID format (username/repo-name)
 */
export function isValidHuggingFaceRepoId(repoId: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoId);
}

/**
 * Parse Hugging Face URL to extract repo ID
 * Supports:
 * - https://huggingface.co/username/model-name
 * - git@hf.co:username/model-name
 */
export function parseHuggingFaceUrl(url: string): { repoId: string; repoType: 'model' | 'dataset' | 'space' } | null {
  // HTTPS format
  const httpsMatch = url.match(/https?:\/\/huggingface\.co\/(?:(datasets|spaces)\/)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  if (httpsMatch) {
    const typePrefix = httpsMatch[1];
    const repoId = httpsMatch[2].replace(/\.git$/, '');
    let repoType: 'model' | 'dataset' | 'space' = 'model';
    if (typePrefix === 'datasets') repoType = 'dataset';
    if (typePrefix === 'spaces') repoType = 'space';
    return { repoId, repoType };
  }

  // SSH format (git@hf.co:username/repo)
  const sshMatch = url.match(/git@hf\.co:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  if (sshMatch) {
    const repoId = sshMatch[1].replace(/\.git$/, '');
    return { repoId, repoType: 'model' };
  }

  return null;
}
