/**
 * Kimi Code OAuth flow.
 *
 * Implements RFC 8628 OAuth 2.0 Device Authorization Grant against Kimi's auth
 * endpoints, matching the flow used by the official Kimi Code CLI.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app, shell } from 'electron';

const CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
const OAUTH_HOST = 'https://auth.kimi.com';
const DEVICE_AUTH_ENDPOINT = `${OAUTH_HOST}/api/oauth/device_authorization`;
const TOKEN_ENDPOINT = `${OAUTH_HOST}/api/oauth/token`;
const SCOPE = 'kimi-code';

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5000;

export interface KimiAuthResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  tokenType: string;
}

export interface KimiAuthState {
  isAuthenticated: boolean;
  expiresAt?: number;
}

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  token_type: string;
}

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

function getAuthDir(): string {
  return path.join(app.getPath('userData'), 'kimi-auth');
}

function getTokenFilePath(accountId: string): string {
  return path.join(getAuthDir(), `${accountId}.json`);
}

function getDeviceIdFilePath(): string {
  return path.join(getAuthDir(), 'device-id.json');
}

/**
 * Kimi's auth endpoint requires a stable device id. Generate one once and reuse
 * it across sessions.
 */
function getStableDeviceId(): string {
  try {
    const raw = fs.readFileSync(getDeviceIdFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as { deviceId?: string };
    if (typeof parsed.deviceId === 'string' && parsed.deviceId.length > 0) {
      return parsed.deviceId;
    }
  } catch {
    // File doesn't exist or is corrupt — generate a new one.
  }

  const deviceId = crypto.randomUUID();
  try {
    fs.mkdirSync(getAuthDir(), { recursive: true });
    fs.writeFileSync(getDeviceIdFilePath(), JSON.stringify({ deviceId }, null, 2), 'utf8');
    fs.chmodSync(getDeviceIdFilePath(), 0o600);
  } catch {
    // Best effort.
  }
  return deviceId;
}

function getOAuthHeaders(): Record<string, string> {
  const platform = process.platform;
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
    'X-Msh-Platform': 'aperant-mcp',
    'X-Msh-Version': app.getVersion(),
    'X-Msh-Device-Name': 'Aperant-MCP',
    'X-Msh-Device-Model': 'Desktop',
    'X-Msh-Os-Version': `${platform}-${os.release()}`,
    'X-Msh-Device-Id': getStableDeviceId(),
  };
}

function readStoredTokens(accountId: string): StoredTokens | null {
  try {
    const raw = fs.readFileSync(getTokenFilePath(accountId), 'utf8');
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

function writeStoredTokens(accountId: string, tokens: KimiAuthResult): void {
  const safeTokens: StoredTokens = {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: tokens.expiresAt,
    scope: tokens.scope,
    token_type: tokens.tokenType,
  };

  const targetPath = getTokenFilePath(accountId);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(safeTokens, null, 2), 'utf8');
  try {
    fs.chmodSync(targetPath, 0o600);
  } catch {
    // chmod is best effort on Windows.
  }
}

function parseTokenResponse(data: Record<string, unknown>): KimiAuthResult {
  if (typeof data.access_token !== 'string') {
    throw new Error('Token response missing access_token');
  }
  if (typeof data.refresh_token !== 'string') {
    throw new Error('Token response missing refresh_token');
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: typeof data.scope === 'string' ? data.scope : SCOPE,
    tokenType: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
  };
}

/**
 * Start the OAuth device-code flow. Opens the user's browser to the verification
 * URL and returns the device auth details so the caller can poll for completion.
 */
export async function startKimiDeviceAuth(): Promise<DeviceAuthResponse> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: SCOPE,
  });

  const response = await fetch(DEVICE_AUTH_ENDPOINT, {
    method: 'POST',
    headers: getOAuthHeaders(),
    body: body.toString(),
  });

  const responseText = await response.text();
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const errorData = JSON.parse(responseText) as { error?: string; error_description?: string };
      message = errorData.error_description ?? errorData.error ?? message;
    } catch {
      // Ignore malformed error bodies.
    }
    throw new Error(`Kimi device authorization failed: ${message}`);
  }

  const data = JSON.parse(responseText) as DeviceAuthResponse;

  // Open the browser with the code pre-filled when possible.
  const openUrl = data.verification_uri_complete ?? data.verification_uri;
  await shell.openExternal(openUrl);

  return data;
}

/**
 * Poll the token endpoint until the user authorizes the device code, or until
 * the flow expires.
 */
export async function pollKimiToken(deviceCode: string, options?: {
  intervalMs?: number;
  expiresInMs?: number;
  onPending?: () => void;
}): Promise<KimiAuthResult> {
  const intervalMs = options?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const expiresInMs = options?.expiresInMs ?? 30 * 60 * 1000;
  const startTime = Date.now();

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: deviceCode,
  });

  while (Date.now() - startTime < expiresInMs) {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: getOAuthHeaders(),
      body: body.toString(),
    });

    const responseText = await response.text();

    if (response.status === 400) {
      let errorCode = '';
      try {
        const errorData = JSON.parse(responseText) as { error?: string };
        errorCode = errorData.error ?? '';
      } catch {
        // Ignore malformed error bodies.
      }

      if (errorCode === 'authorization_pending') {
        options?.onPending?.();
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        continue;
      }

      if (errorCode === 'slow_down') {
        await new Promise((resolve) => setTimeout(resolve, intervalMs + 5000));
        continue;
      }

      throw new Error(`Kimi token error: ${errorCode}`);
    }

    if (!response.ok) {
      throw new Error(`Kimi token request failed: HTTP ${response.status}`);
    }

    const data = JSON.parse(responseText) as Record<string, unknown>;
    return parseTokenResponse(data);
  }

  throw new Error('Kimi OAuth flow timed out waiting for authorization.');
}

/**
 * Exchange a refresh token for a new access token.
 */
export async function refreshKimiToken(refreshToken: string): Promise<KimiAuthResult> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: getOAuthHeaders(),
    body: body.toString(),
  });

  const responseText = await response.text();
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const errorData = JSON.parse(responseText) as { error?: string; error_description?: string };
      message = errorData.error_description ?? errorData.error ?? message;
    } catch {
      // Ignore malformed error bodies.
    }
    throw new Error(`Kimi token refresh failed: ${message}`);
  }

  const data = JSON.parse(responseText) as Record<string, unknown>;
  return parseTokenResponse(data);
}

/**
 * Ensure a valid access token is available for the account, refreshing if
 * within the threshold.
 */
export async function ensureValidKimiToken(accountId: string): Promise<string | null> {
  const stored = readStoredTokens(accountId);
  if (!stored) {
    return null;
  }

  if (stored.expires_at - Date.now() > REFRESH_THRESHOLD_MS) {
    return stored.access_token;
  }

  try {
    const refreshed = await refreshKimiToken(stored.refresh_token);
    writeStoredTokens(accountId, refreshed);
    return refreshed.accessToken;
  } catch {
    return null;
  }
}

/**
 * Get the current auth state for an account.
 */
export async function getKimiAuthState(accountId: string): Promise<KimiAuthState> {
  const stored = readStoredTokens(accountId);
  if (!stored) {
    return { isAuthenticated: false };
  }

  return {
    isAuthenticated: Date.now() < stored.expires_at,
    expiresAt: stored.expires_at,
  };
}

/**
 * Clear stored tokens for an account.
 */
export async function clearKimiAuth(accountId: string): Promise<void> {
  try {
    fs.unlinkSync(getTokenFilePath(accountId));
  } catch {
    // File may already be gone.
  }
}

/**
 * Run the complete OAuth flow: request device code, open browser, poll until
 * authorized, and store tokens.
 */
export async function startKimiOAuthFlow(accountId: string): Promise<KimiAuthResult> {
  const deviceAuth = await startKimiDeviceAuth();
  const tokens = await pollKimiToken(deviceAuth.device_code, {
    intervalMs: deviceAuth.interval * 1000,
    expiresInMs: deviceAuth.expires_in * 1000,
  });
  writeStoredTokens(accountId, tokens);
  return tokens;
}
