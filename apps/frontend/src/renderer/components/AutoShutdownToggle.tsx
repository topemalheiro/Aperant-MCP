import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Power, PowerOff, Loader2 } from 'lucide-react';
import { Switch } from './ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from './ui/tooltip';
import { useProjectStore } from '../stores/project-store';
import { useSettingsStore } from '../stores/settings-store';
import { cn } from '../lib/utils';

interface AutoShutdownStatus {
  enabled: boolean;
  monitoring: boolean;
  tasksRemaining: number;
  shutdownPending: boolean;
  countdown?: number;
}

interface AutoShutdownToggleProps {
  isCollapsed?: boolean;
}

/**
 * Global Auto-Shutdown Toggle
 * Monitors ALL projects simultaneously and triggers shutdown when
 * ALL tasks across ALL projects reach Human Review.
 */
export function AutoShutdownToggle({ isCollapsed = false }: AutoShutdownToggleProps) {
  const { t } = useTranslation(['common', 'settings']);
  const projects = useProjectStore((state) => state.projects);
  const settings = useSettingsStore((state) => state.settings);

  const [status, setStatus] = useState<AutoShutdownStatus>({
    enabled: false,
    monitoring: false,
    tasksRemaining: 0,
    shutdownPending: false
  });

  // Load initial state from settings
  useEffect(() => {
    setStatus(prev => ({
      ...prev,
      enabled: settings.autoShutdownEnabled ?? false
    }));
  }, [settings.autoShutdownEnabled]);

  // Load global auto-shutdown status (across ALL projects)
  useEffect(() => {
    const loadStatus = async () => {
      try {
        const result = await window.electronAPI.getAutoShutdownStatus();
        if (result.success && result.data) {
          setStatus(result.data);
        }
      } catch (error) {
        console.error('[AutoShutdown] Failed to load status:', error);
      }
    };

    loadStatus();

    // Poll status every 30 seconds (5s was causing excessive I/O from countTasksByStatus)
    const interval = setInterval(loadStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleToggle = async (enabled: boolean) => {
    try {
      const result = await window.electronAPI.setAutoShutdown(enabled);
      if (result.success && result.data) {
        setStatus(result.data);
      }
    } catch (error) {
      console.error('[AutoShutdown] Failed to toggle:', error);
    }
  };

  // Hide if no projects exist
  if (projects.length === 0) {
    return null;
  }

  const getStatusText = () => {
    if (status.shutdownPending && status.countdown !== undefined) {
      return t('settings:autoShutdown.shutdownIn', { seconds: status.countdown });
    }
    if (status.monitoring && status.tasksRemaining > 0) {
      return t('settings:autoShutdown.tasksRemainingGlobal', {
        count: status.tasksRemaining,
        projects: projects.length
      });
    }
    if (status.monitoring && status.tasksRemaining === 0) {
      return t('settings:autoShutdown.waitingForCompletion');
    }
    if (status.enabled) {
      return t('settings:autoShutdown.monitoringGlobal', { projects: projects.length });
    }
    return t('settings:autoShutdown.disabled');
  };

  const getStatusIcon = () => {
    // Shutdown pending: red/destructive with pulse
    if (status.shutdownPending) {
      return <PowerOff className="h-4 w-4 text-destructive animate-pulse" />;
    }

    // Monitoring: bright accent text color with spin animation
    if (status.monitoring) {
      return <Loader2 className="h-4 w-4 text-accent-foreground animate-spin" />;
    }

    // Enabled: bright accent text color
    if (status.enabled) {
      return <Power className="h-4 w-4 text-accent-foreground" />;
    }

    // Disabled: gray/muted
    return <Power className="h-4 w-4 text-muted-foreground" />;
  };

  // Collapsed state: power icon only (accent color when on, gray when off)
  if (isCollapsed) {
    return (
      <div className="flex items-center justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => handleToggle(!status.enabled)}
              disabled={status.shutdownPending}
              className={cn(
                "h-9 w-9 flex items-center justify-center rounded-lg transition-colors",
                "hover:bg-accent-foreground/10",
                status.shutdownPending && "opacity-50 cursor-not-allowed"
              )}
              aria-label={t('settings:autoShutdown.toggle')}
            >
              <Power className={cn(
                "h-5 w-5",
                status.shutdownPending
                  ? "text-destructive animate-pulse"
                  : (status.enabled || status.monitoring)
                  ? "text-accent-foreground"
                  : "text-muted-foreground"
              )} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs">
            <div className="space-y-1">
              <p className="font-medium">{t('settings:autoShutdown.title')}</p>
              <p className={cn(
                "text-xs",
                (status.monitoring || status.enabled)
                  ? "text-accent-foreground font-medium"
                  : "text-foreground"
              )}>{getStatusText()}</p>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // Expanded state: full card (keep existing implementation)
  return (
    <div className={cn(
      "rounded-lg border p-3 transition-colors",
      status.shutdownPending
        ? "border-destructive/50 bg-destructive/10"
        : status.monitoring
        ? "border-accent-foreground/30 bg-accent-foreground/10"
        : "border-border bg-card"
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {getStatusIcon()}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-medium truncate">
                  {t('settings:autoShutdown.title')}
                </span>
                <span className={cn(
                  "text-xs truncate font-medium",
                  status.shutdownPending
                    ? "text-destructive"
                    : (status.monitoring || status.enabled)
                    ? "text-accent-foreground"
                    : "text-muted-foreground"
                )}>
                  {getStatusText()}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="text-sm">
                {t('settings:autoShutdown.description')}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>

        <Switch
          checked={status.enabled}
          onCheckedChange={handleToggle}
          disabled={status.shutdownPending}
          aria-label={t('settings:autoShutdown.toggle')}
        />
      </div>
    </div>
  );
}
