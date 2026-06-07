import {
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { Separator } from '../ui/separator';
import { AVAILABLE_MODELS } from '../../../shared/constants';
import type {
  Project,
  ProjectSettings as ProjectSettingsType,
  AutoBuildVersionInfo
} from '../../../shared/types';

interface GeneralSettingsProps {
  project: Project;
  settings: ProjectSettingsType;
  setSettings: React.Dispatch<React.SetStateAction<ProjectSettingsType>>;
  versionInfo: AutoBuildVersionInfo | null;
  isCheckingVersion: boolean;
  isUpdating: boolean;
  handleInitialize: () => Promise<void>;
}

export function GeneralSettings({
  project,
  settings,
  setSettings,
  versionInfo,
  isCheckingVersion,
  isUpdating,
  handleInitialize
}: GeneralSettingsProps) {
  const { t } = useTranslation(['settings']);

  return (
    <>
      {/* Auto-Claude MCP Section */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Auto-Claude MCP</h3>
          <p className="text-xs text-muted-foreground mt-1">
            LLM Manager integration for autonomous builds and restarts
          </p>
        </div>

        {/* LLM Manager Build & Restart */}
        <div className="space-y-3 ml-4">
          <h4 className="text-sm font-medium text-foreground">LLM Manager Build & Restart</h4>
          <p className="text-xs text-muted-foreground">
            Allow LLM Manager to change Auto-Claude code, build and restart if needed by this project
          </p>
        </div>
        {!project.autoBuildPath ? (
          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-warning mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Not Initialized</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Initialize to enable LLM Manager control of builds and restarts.
                </p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={handleInitialize}
                  disabled={isUpdating}
                >
                  {isUpdating ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Initializing...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Initialize Auto-Build
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <span className="text-sm font-medium text-foreground">Auto-Build Initialized</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Project is configured for Auto-Build tasks
                </p>
              </div>
              <code className="text-xs bg-background px-2 py-1 rounded shrink-0">
                {project.autoBuildPath}
              </code>
            </div>
            {isCheckingVersion && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking status...
              </div>
            )}

            {/* LLM Manager Control Toggle */}
            <Separator />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="font-normal text-foreground">
                  Auto-Build
                </Label>
                <p className="text-xs text-muted-foreground">
                  Enable LLM Manager to modify Auto-Claude, build and restart
                </p>
              </div>
              <Switch
                checked={settings.llmManagerEnabled ?? false}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, llmManagerEnabled: checked })
                }
              />
            </div>
          </div>
        )}
      </section>

      {project.autoBuildPath && (
        <>
          <Separator />

          {/* Agent Settings */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Agent Configuration</h3>
            <div className="space-y-2">
              <Label htmlFor="model" className="text-sm font-medium text-foreground">Model</Label>
              <Select
                value={settings.model}
                onValueChange={(value) => setSettings({ ...settings, model: value })}
              >
                <SelectTrigger id="model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_MODELS.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between pt-2">
              <div className="space-y-0.5">
                <Label className="font-normal text-foreground">
                  {t('projectSections.general.useClaudeMd')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('projectSections.general.useClaudeMdDescription')}
                </p>
              </div>
              <Switch
                checked={settings.useClaudeMd ?? true}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, useClaudeMd: checked })
                }
              />
            </div>
          </section>

          <Separator />

          {/* Notifications */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="font-normal text-foreground">On Task Complete</Label>
                <Switch
                  checked={settings.notifications.onTaskComplete}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      notifications: {
                        ...settings.notifications,
                        onTaskComplete: checked
                      }
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="font-normal text-foreground">On Task Failed</Label>
                <Switch
                  checked={settings.notifications.onTaskFailed}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      notifications: {
                        ...settings.notifications,
                        onTaskFailed: checked
                      }
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="font-normal text-foreground">On Review Needed</Label>
                <Switch
                  checked={settings.notifications.onReviewNeeded}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      notifications: {
                        ...settings.notifications,
                        onReviewNeeded: checked
                      }
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="font-normal text-foreground">Sound</Label>
                <Switch
                  checked={settings.notifications.sound}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      notifications: {
                        ...settings.notifications,
                        sound: checked
                      }
                    })
                  }
                />
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
