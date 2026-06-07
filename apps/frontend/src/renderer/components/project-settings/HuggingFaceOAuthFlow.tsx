import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Info,
  ExternalLink,
  Terminal
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

interface HuggingFaceOAuthFlowProps {
  onSuccess: (token: string, username?: string) => void;
  onCancel?: () => void;
}

// Debug logging helper
const DEBUG = process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true';

function debugLog(message: string, data?: unknown) {
  if (DEBUG) {
    if (data !== undefined) {
      console.warn(`[HuggingFaceOAuth] ${message}`, data);
    } else {
      console.warn(`[HuggingFaceOAuth] ${message}`);
    }
  }
}

/**
 * Hugging Face OAuth flow component using huggingface-cli
 * Guides users through authenticating with Hugging Face Hub
 */
export function HuggingFaceOAuthFlow({ onSuccess, onCancel }: HuggingFaceOAuthFlowProps) {
  const [status, setStatus] = useState<'checking' | 'need-install' | 'need-auth' | 'authenticating' | 'success' | 'error'>('checking');
  const [error, setError] = useState<string | null>(null);
  const [cliVersion, setCliVersion] = useState<string | undefined>();
  const [username, setUsername] = useState<string | undefined>();

  // Ref to prevent double-execution in React Strict Mode
  const hasCheckedRef = useRef(false);

  useEffect(() => {
    if (hasCheckedRef.current) {
      debugLog('Skipping duplicate check (Strict Mode)');
      return;
    }
    hasCheckedRef.current = true;
    debugLog('Component mounted, checking Hugging Face status...');
    checkHuggingFaceStatus();
  }, []);

  const checkHuggingFaceStatus = async () => {
    debugLog('checkHuggingFaceStatus() called');
    setStatus('checking');
    setError(null);

    try {
      // Check if huggingface-cli is installed
      debugLog('Calling checkHuggingFaceCli...');
      const cliResult = await window.electronAPI.checkHuggingFaceCli();
      debugLog('checkHuggingFaceCli result:', cliResult);

      if (!cliResult.success) {
        debugLog('checkHuggingFaceCli failed:', cliResult.error);
        setError(cliResult.error || 'Failed to check Hugging Face CLI');
        setStatus('error');
        return;
      }

      if (!cliResult.data?.installed) {
        debugLog('Hugging Face CLI not installed');
        setStatus('need-install');
        return;
      }

      setCliVersion(cliResult.data.version);
      debugLog('Hugging Face CLI installed, version:', cliResult.data.version);

      // Check if already authenticated
      debugLog('Calling checkHuggingFaceAuth...');
      const authResult = await window.electronAPI.checkHuggingFaceAuth();
      debugLog('checkHuggingFaceAuth result:', authResult);

      if (authResult.success && authResult.data?.authenticated) {
        debugLog('Already authenticated as:', authResult.data.username);
        setUsername(authResult.data.username);
        // Get the token and notify parent
        await fetchAndNotifyToken();
      } else {
        debugLog('Not authenticated, showing auth prompt');
        setStatus('need-auth');
      }
    } catch (err) {
      debugLog('Error in checkHuggingFaceStatus:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  };

  const fetchAndNotifyToken = async () => {
    debugLog('fetchAndNotifyToken() called');
    try {
      debugLog('Calling getHuggingFaceToken...');
      const tokenResult = await window.electronAPI.getHuggingFaceToken();
      debugLog('getHuggingFaceToken result:', {
        success: tokenResult.success,
        hasToken: !!tokenResult.data?.token,
        error: tokenResult.error
      });

      if (tokenResult.success && tokenResult.data?.token) {
        debugLog('Token retrieved successfully, calling onSuccess with username:', username);
        setStatus('success');
        onSuccess(tokenResult.data.token, username);
      } else {
        debugLog('Failed to get token:', tokenResult.error);
        setError(tokenResult.error || 'Failed to get token');
        setStatus('error');
      }
    } catch (err) {
      debugLog('Error in fetchAndNotifyToken:', err);
      setError(err instanceof Error ? err.message : 'Failed to get token');
      setStatus('error');
    }
  };

  const handleStartAuth = async () => {
    debugLog('handleStartAuth() called');
    setStatus('authenticating');
    setError(null);

    try {
      debugLog('Calling huggingFaceLogin...');
      const result = await window.electronAPI.huggingFaceLogin();
      debugLog('huggingFaceLogin result:', result);

      if (result.success && result.data?.success) {
        debugLog('Auth successful, fetching token...');
        // Fetch the token and notify parent
        await fetchAndNotifyToken();
      } else {
        debugLog('Auth failed:', result.error);
        setError(result.error || 'Authentication failed');
        setStatus('error');
      }
    } catch (err) {
      debugLog('Error in handleStartAuth:', err);
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setStatus('error');
    }
  };

  const handleInstallCli = async () => {
    debugLog('Installing Hugging Face CLI');
    try {
      const result = await window.electronAPI.installHuggingFaceCli();
      if (result.success) {
        debugLog('Install command opened:', result.data?.command);
      } else {
        setError(result.error || 'Failed to open install terminal');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install CLI');
    }
  };

  const handleOpenTokenPage = () => {
    debugLog('Opening Hugging Face token page');
    window.open('https://huggingface.co/settings/tokens', '_blank');
  };

  const handleRetry = () => {
    debugLog('Retry clicked');
    hasCheckedRef.current = false;
    checkHuggingFaceStatus();
  };

  debugLog('Rendering with status:', status);

  return (
    <div className="space-y-4">
      {/* Checking status */}
      {status === 'checking' && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Need to install huggingface-cli */}
      {status === 'need-install' && (
        <div className="space-y-4">
          <Card className="border border-warning/30 bg-warning/10">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <Terminal className="h-6 w-6 text-warning shrink-0 mt-0.5" />
                <div className="flex-1 space-y-3">
                  <h3 className="text-lg font-medium text-foreground">
                    Hugging Face CLI Required
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    The Hugging Face CLI is required for authentication. This provides a secure
                    way to connect to your Hugging Face account.
                  </p>
                  <div className="flex gap-3">
                    <Button onClick={handleInstallCli} className="gap-2">
                      <Terminal className="h-4 w-4" />
                      Install Hugging Face CLI
                    </Button>
                    <Button variant="outline" onClick={handleRetry}>
                      I've Installed It
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-info/30 bg-info/10">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-info shrink-0 mt-0.5" />
                <div className="flex-1 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-2">Installation instructions:</p>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>All platforms: <code className="px-1.5 py-0.5 bg-muted rounded font-mono text-xs">pip install -U huggingface_hub</code></li>
                    <li>Or with conda: <code className="px-1.5 py-0.5 bg-muted rounded font-mono text-xs">conda install -c conda-forge huggingface_hub</code></li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Need authentication */}
      {status === 'need-auth' && (
        <div className="space-y-4">
          <Card className="border border-info/30 bg-info/10">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <Box className="h-6 w-6 text-info shrink-0 mt-0.5" />
                <div className="flex-1 space-y-3">
                  <h3 className="text-lg font-medium text-foreground">
                    Connect to Hugging Face
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Click the button below to authenticate with Hugging Face. You'll need to
                    enter your access token from the Hugging Face settings.
                  </p>
                  {cliVersion && (
                    <p className="text-xs text-muted-foreground">
                      Using huggingface_hub {cliVersion}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col items-center gap-3">
            <Button onClick={handleStartAuth} size="lg" className="gap-2">
              <Box className="h-5 w-5" />
              Authenticate with Hugging Face
            </Button>
            <Button variant="link" onClick={handleOpenTokenPage} className="gap-1 text-sm">
              <ExternalLink className="h-3 w-3" />
              Get your access token
            </Button>
          </div>
        </div>
      )}

      {/* Authenticating */}
      {status === 'authenticating' && (
        <div className="space-y-4">
          <Card className="border border-info/30 bg-info/10">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <Loader2 className="h-6 w-6 animate-spin text-info shrink-0" />
                <div className="flex-1">
                  <h3 className="text-lg font-medium text-foreground">
                    Authenticating...
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Please enter your Hugging Face access token in the terminal window.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-primary/30 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">Need a token?</p>
                  <p>
                    Visit{' '}
                    <button
                      onClick={handleOpenTokenPage}
                      className="text-primary hover:underline"
                    >
                      huggingface.co/settings/tokens
                    </button>{' '}
                    to create an access token with write permissions.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Success */}
      {status === 'success' && (
        <Card className="border border-success/30 bg-success/10">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <CheckCircle2 className="h-6 w-6 text-success shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-medium text-success">
                  Successfully Connected
                </h3>
                <p className="text-sm text-success/80 mt-1">
                  {username ? `Connected as ${username}` : 'Your Hugging Face account is now connected'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div className="space-y-4">
          <Card className="border border-destructive/30 bg-destructive/10">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-lg font-medium text-destructive">
                    Authentication Failed
                  </h3>
                  <p className="text-sm text-destructive/80 mt-1">{error}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-center gap-3">
            <Button onClick={handleStartAuth} variant="outline">
              Retry
            </Button>
            {onCancel && (
              <Button onClick={onCancel} variant="ghost">
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Cancel button for non-error states */}
      {status !== 'error' && status !== 'success' && onCancel && (
        <div className="flex justify-center pt-2">
          <Button onClick={onCancel} variant="ghost">
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
