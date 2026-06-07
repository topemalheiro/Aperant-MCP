import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, RefreshCw, Loader2, Send, Zap } from 'lucide-react';
import { Button } from '../ui/button';
import { SettingsSection } from './SettingsSection';

interface UsageDiag {
  currentUsage: {
    sessionPercent: number;
    weeklyPercent: number;
    profileId: string;
    profileName: string;
    fetchedAt: string;
    sessionResetTime?: string;
    weeklyResetTime?: string;
  } | null;
  lastGoodUsage: {
    sessionPercent: number;
    weeklyPercent: number;
    fetchedAt: string;
  } | null;
  currentUsageProfileId: string | null;
  apiFailureTimestamps: Record<string, number>;
  lastEmitTimestamp: number;
  lastRdrNotificationState: string;
  isChecking: boolean;
  lastGoodUsagePath: string;
  cliCredentialPath: string;
  cliCredentialExists: boolean;
  cliCredentialHasToken: boolean;
  timestamp: number;
}

interface RdrDiag {
  rdrPauseState: {
    paused: boolean;
    warning: boolean;
    reason: string;
    pausedAt: number;
    rateLimitResetAt: number;
  };
  outputMonitorState: string;
  mcpBusy: boolean;
  isClaudeCodeBusy: boolean;
  timestamp: number;
}

function formatTimestamp(ts: number | string | undefined): string {
  if (!ts) return 'N/A';
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

function formatAgo(ts: number): string {
  if (!ts) return 'never';
  const ago = Math.round((Date.now() - ts) / 1000);
  if (ago < 60) return `${ago}s ago`;
  if (ago < 3600) return `${Math.round(ago / 60)}m ago`;
  return `${Math.round(ago / 3600)}h ago`;
}

/**
 * Diagnostics settings panel for debugging usage meter and RDR system.
 * Auto-refreshes every 5 seconds.
 */
export function DiagnosticsSettings() {
  const { t } = useTranslation('settings');
  const [usageDiag, setUsageDiag] = useState<UsageDiag | null>(null);
  const [rdrDiag, setRdrDiag] = useState<RdrDiag | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [forceFetchResult, setForceFetchResult] = useState<string | null>(null);
  const [testRdrResult, setTestRdrResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [usageRes, rdrRes] = await Promise.all([
        window.electronAPI.getUsageState(),
        window.electronAPI.getRdrState(),
      ]);
      if (usageRes.success && usageRes.data) setUsageDiag(usageRes.data as UsageDiag);
      if (rdrRes.success && rdrRes.data) setRdrDiag(rdrRes.data as RdrDiag);
    } catch {
      // Silently fail — diagnostics should never crash
    }
  }, []);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const handleForceFetch = async () => {
    setIsLoading(true);
    setForceFetchResult(null);
    try {
      const res = await window.electronAPI.forceUsageFetch();
      if (res.success) {
        setForceFetchResult('Fetch complete');
        await refresh();
      } else {
        setForceFetchResult(`Error: ${res.error}`);
      }
    } catch (err) {
      setForceFetchResult(err instanceof Error ? err.message : 'Failed');
    } finally {
      setIsLoading(false);
      setTimeout(() => setForceFetchResult(null), 3000);
    }
  };

  const handleTestRdr = async () => {
    setTestRdrResult(null);
    try {
      const res = await window.electronAPI.sendTestRdr();
      if (res.success && res.data) {
        setTestRdrResult(res.data.message);
      } else {
        setTestRdrResult(`Error: ${res.error}`);
      }
    } catch (err) {
      setTestRdrResult(err instanceof Error ? err.message : 'Failed');
    }
    setTimeout(() => setTestRdrResult(null), 5000);
  };

  return (
    <SettingsSection
      title={t('sections.diagnostics.title', 'Diagnostics')}
      description={t('sections.diagnostics.description', 'Usage meter and RDR system diagnostics')}
    >
      <div className="space-y-6">
        {/* Usage Meter State */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {t('diagnostics.usageMeter', 'Usage Meter State')}
          </h3>
          <div className="rounded-md border border-border bg-muted/50 p-3 text-xs font-mono space-y-1">
            {usageDiag ? (
              <>
                <Row label="Session %" value={usageDiag.currentUsage?.sessionPercent ?? 'null'} />
                <Row label="Weekly %" value={usageDiag.currentUsage?.weeklyPercent ?? 'null'} />
                <Row label="Profile" value={usageDiag.currentUsage?.profileName ?? 'none'} />
                <Row label="Fetched at" value={formatTimestamp(usageDiag.currentUsage?.fetchedAt)} />
                <Row label="Session resets" value={usageDiag.currentUsage?.sessionResetTime ?? 'N/A'} />
                <Row label="Weekly resets" value={usageDiag.currentUsage?.weeklyResetTime ?? 'N/A'} />
                <div className="border-t border-border my-1 pt-1" />
                <Row label="Last good (disk)" value={
                  usageDiag.lastGoodUsage
                    ? `S:${usageDiag.lastGoodUsage.sessionPercent}% W:${usageDiag.lastGoodUsage.weeklyPercent}%`
                    : 'none'
                } />
                <Row label="Last emit" value={formatAgo(usageDiag.lastEmitTimestamp)} />
                <Row label="RDR notify state" value={usageDiag.lastRdrNotificationState} />
                <Row label="Is checking" value={String(usageDiag.isChecking)} />
                <Row label="API failures" value={
                  Object.keys(usageDiag.apiFailureTimestamps).length === 0
                    ? 'none'
                    : Object.entries(usageDiag.apiFailureTimestamps)
                        .map(([id, ts]) => `${id.slice(0, 8)}: ${formatAgo(ts)}`)
                        .join(', ')
                } />
                <div className="border-t border-border my-1 pt-1" />
                <Row label="CLI creds" value={usageDiag.cliCredentialExists ? 'exists' : 'missing'} />
                <Row label="CLI has token" value={String(usageDiag.cliCredentialHasToken)} />
                <Row label="CLI creds path" value={usageDiag.cliCredentialPath} />
              </>
            ) : (
              <span className="text-muted-foreground">{t('diagnostics.loading', 'Loading...')}</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleForceFetch} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              {t('diagnostics.forceFetch', 'Force Fetch')}
            </Button>
            {forceFetchResult && (
              <span className="text-xs text-muted-foreground self-center">{forceFetchResult}</span>
            )}
          </div>
        </div>

        {/* RDR System State */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
            <Zap className="h-4 w-4" />
            {t('diagnostics.rdrSystem', 'RDR System State')}
          </h3>
          <div className="rounded-md border border-border bg-muted/50 p-3 text-xs font-mono space-y-1">
            {rdrDiag ? (
              <>
                <Row label="Output monitor" value={rdrDiag.outputMonitorState} />
                <Row label="MCP busy" value={String(rdrDiag.mcpBusy)} />
                <Row label="Claude Code busy" value={String(rdrDiag.isClaudeCodeBusy)} />
                <div className="border-t border-border my-1 pt-1" />
                <Row label="RDR paused" value={String(rdrDiag.rdrPauseState.paused)} />
                <Row label="RDR warning" value={String(rdrDiag.rdrPauseState.warning)} />
                <Row label="Pause reason" value={rdrDiag.rdrPauseState.reason || 'none'} />
                {rdrDiag.rdrPauseState.rateLimitResetAt > 0 && (
                  <Row label="Reset at" value={formatTimestamp(rdrDiag.rdrPauseState.rateLimitResetAt)} />
                )}
              </>
            ) : (
              <span className="text-muted-foreground">{t('diagnostics.loading', 'Loading...')}</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleTestRdr}>
              <Send className="h-3 w-3 mr-1" />
              {t('diagnostics.testRdr', 'Test RDR Send')}
            </Button>
            {testRdrResult && (
              <span className="text-xs text-muted-foreground self-center">{testRdrResult}</span>
            )}
          </div>
        </div>

        {/* Manual Refresh */}
        <div className="text-xs text-muted-foreground">
          {t('diagnostics.autoRefresh', 'Auto-refreshes every 5 seconds')}
          {usageDiag && ` | Last: ${formatTimestamp(usageDiag.timestamp)}`}
        </div>
      </div>
    </SettingsSection>
  );
}

/** Simple key-value row for diagnostic display */
function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className="text-foreground text-right break-all">{value}</span>
    </div>
  );
}
