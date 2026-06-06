import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Terminal, RefreshCw, Loader2, Check, FolderOpen, AlertTriangle, Plus, Edit, Trash2 } from 'lucide-react';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { SettingsSection } from './SettingsSection';
import type { AppSettings, SupportedIDE, SupportedTerminal } from '../../../shared/types';
import { DEFAULT_RDR_MECHANISMS } from '../../../shared/constants/config';

interface DevToolsSettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

interface DetectedTool {
  id: string;
  name: string;
  path: string;
  installed: boolean;
}

interface DetectedTools {
  ides: DetectedTool[];
  terminals: DetectedTool[];
}

// IDE display names - alphabetically sorted for easy scanning
const IDE_NAMES: Partial<Record<SupportedIDE, string>> = {
  androidstudio: 'Android Studio',
  clion: 'CLion',
  cursor: 'Cursor',
  emacs: 'Emacs',
  goland: 'GoLand',
  intellij: 'IntelliJ IDEA',
  neovim: 'Neovim',
  nova: 'Nova',
  phpstorm: 'PhpStorm',
  pycharm: 'PyCharm',
  rider: 'Rider',
  rubymine: 'RubyMine',
  sublime: 'Sublime Text',
  vim: 'Vim',
  vscode: 'Visual Studio Code',
  vscodium: 'VSCodium',
  webstorm: 'WebStorm',
  windsurf: 'Windsurf',
  xcode: 'Xcode',
  zed: 'Zed',
  custom: 'Custom...'  // Always last
};

// Terminal display names - alphabetically sorted
const TERMINAL_NAMES: Partial<Record<SupportedTerminal, string>> = {
  alacritty: 'Alacritty',
  ghostty: 'Ghostty',
  gnometerminal: 'GNOME Terminal',
  hyper: 'Hyper',
  iterm2: 'iTerm2',
  kitty: 'Kitty',
  konsole: 'Konsole',
  powershell: 'PowerShell',
  system: 'System Terminal',
  tabby: 'Tabby',
  terminal: 'Terminal.app',
  terminator: 'Terminator',
  tilix: 'Tilix',
  tmux: 'tmux',
  warp: 'Warp',
  wezterm: 'WezTerm',
  windowsterminal: 'Windows Terminal',
  zellij: 'Zellij',
  custom: 'Custom...'  // Always last
};

/**
 * Developer Tools settings component for configuring preferred IDE and terminal
 */
export function DevToolsSettings({ settings, onSettingsChange }: DevToolsSettingsProps) {
  const { t } = useTranslation('settings');
  const [detectedTools, setDetectedTools] = useState<DetectedTools | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);

  // RDR mechanism management state
  const [showCreateMechanismDialog, setShowCreateMechanismDialog] = useState(false);
  const [showRenameMechanismDialog, setShowRenameMechanismDialog] = useState(false);
  const [mechanismName, setMechanismName] = useState('');

  // Detect installed tools on mount
  const detectTools = useCallback(async () => {
    setIsDetecting(true);
    setDetectError(null);
    try {
      // Check if the API is available (may not be in dev mode or if preload failed)
      if (!window.electronAPI?.worktreeDetectTools) {
        console.warn('[DevToolsSettings] Detection API not available');
        setIsDetecting(false);
        return;
      }

      const result = await window.electronAPI.worktreeDetectTools();
      if (result.success && result.data) {
        setDetectedTools(result.data as DetectedTools);
      } else {
        setDetectError(result.error || 'Failed to detect tools');
      }
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : 'Failed to detect tools');
    } finally {
      setIsDetecting(false);
    }
  }, []);

  useEffect(() => {
    detectTools();
  }, [detectTools]);

  // RDR Mechanism Management Handlers
  const mechanisms = settings.rdrMechanisms || DEFAULT_RDR_MECHANISMS;
  const activeMechanismId = settings.activeMechanismId || mechanisms[0]?.id;
  const selectedMechanism = mechanisms.find(m => m.id === activeMechanismId);

  const handleCreateMechanism = () => {
    const newMechanism = {
      id: crypto.randomUUID(),
      name: mechanismName.trim() || 'New Mechanism',
      template: '',
      isDefault: false
    };

    const updatedMechanisms = [...mechanisms, newMechanism];

    onSettingsChange({
      ...settings,
      rdrMechanisms: updatedMechanisms,
      activeMechanismId: newMechanism.id
    });

    setShowCreateMechanismDialog(false);
    setMechanismName('');
  };

  const handleRenameMechanism = () => {
    if (!selectedMechanism || selectedMechanism.isDefault) return;

    const updatedMechanisms = mechanisms.map(m =>
      m.id === activeMechanismId ? { ...m, name: mechanismName.trim() } : m
    );

    onSettingsChange({
      ...settings,
      rdrMechanisms: updatedMechanisms
    });

    setShowRenameMechanismDialog(false);
    setMechanismName('');
  };

  const handleDeleteMechanism = () => {
    if (!selectedMechanism || selectedMechanism.isDefault) return;

    const updatedMechanisms = mechanisms.filter(m => m.id !== activeMechanismId);
    const newActiveId = updatedMechanisms[0]?.id;

    onSettingsChange({
      ...settings,
      rdrMechanisms: updatedMechanisms,
      activeMechanismId: newActiveId
    });
  };

  const handleUpdateTemplate = (template: string) => {
    const updatedMechanisms = mechanisms.map(m =>
      m.id === activeMechanismId ? { ...m, template } : m
    );

    onSettingsChange({
      ...settings,
      rdrMechanisms: updatedMechanisms
    });
  };

  const handleIDEChange = (ide: SupportedIDE) => {
    onSettingsChange({
      ...settings,
      preferredIDE: ide,
      // Clear custom path when switching away from custom
      customIDEPath: ide === 'custom' ? settings.customIDEPath : undefined
    });
  };

  const handleTerminalChange = (terminal: SupportedTerminal) => {
    onSettingsChange({
      ...settings,
      preferredTerminal: terminal,
      // Clear custom path when switching away from custom
      customTerminalPath: terminal === 'custom' ? settings.customTerminalPath : undefined
    });
  };

  const handleCustomIDEPathChange = (path: string) => {
    onSettingsChange({
      ...settings,
      customIDEPath: path
    });
  };

  const handleCustomTerminalPathChange = (path: string) => {
    onSettingsChange({
      ...settings,
      customTerminalPath: path
    });
  };

  // Build IDE options with detection status
  const ideOptions: Array<{ value: SupportedIDE; label: string; detected: boolean }> = [];

  // Add detected IDEs first
  if (detectedTools) {
    for (const tool of detectedTools.ides) {
      ideOptions.push({
        value: tool.id as SupportedIDE,
        label: tool.name,
        detected: true
      });
    }
  }

  // Add remaining IDEs that weren't detected
  const detectedIDEIds = new Set(detectedTools?.ides.map(t => t.id) || []);
  for (const [id, name] of Object.entries(IDE_NAMES)) {
    if (id !== 'custom' && !detectedIDEIds.has(id)) {
      ideOptions.push({
        value: id as SupportedIDE,
        label: name,
        detected: false
      });
    }
  }

  // Add custom option last
  ideOptions.push({ value: 'custom', label: 'Custom...', detected: false });

  // Build Terminal options with detection status
  const terminalOptions: Array<{ value: SupportedTerminal; label: string; detected: boolean }> = [];

  // Always add system terminal first
  terminalOptions.push({
    value: 'system',
    label: TERMINAL_NAMES.system || 'System Terminal',
    detected: true
  });

  // Add detected terminals
  if (detectedTools) {
    for (const tool of detectedTools.terminals) {
      if (tool.id !== 'system') {
        terminalOptions.push({
          value: tool.id as SupportedTerminal,
          label: tool.name,
          detected: true
        });
      }
    }
  }

  // Add remaining terminals that weren't detected
  const detectedTerminalIds = new Set(detectedTools?.terminals.map(t => t.id) || []);
  detectedTerminalIds.add('system'); // Always consider system as detected
  for (const [id, name] of Object.entries(TERMINAL_NAMES)) {
    if (id !== 'custom' && !detectedTerminalIds.has(id)) {
      terminalOptions.push({
        value: id as SupportedTerminal,
        label: name,
        detected: false
      });
    }
  }

  // Add custom option last
  terminalOptions.push({ value: 'custom', label: 'Custom...', detected: false });

  return (
    <SettingsSection
      title={t('devtools.title', 'Developer Tools')}
      description={t('devtools.description', 'Configure your preferred IDE and terminal for working with worktrees')}
    >
      <div className="space-y-6">
        {/* Detect Tools Button */}
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={detectTools}
            disabled={isDetecting}
          >
            {isDetecting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {t('devtools.detectAgain', 'Detect Again')}
          </Button>
        </div>

        {detectError && (
          <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
            {detectError}
          </div>
        )}

        {/* IDE Selection */}
        <div className="space-y-2">
          <Label htmlFor="preferred-ide" className="flex items-center gap-2">
            <Code className="h-4 w-4" />
            {t('devtools.ide.label', 'Preferred IDE')}
          </Label>
          <Select
            value={settings.preferredIDE || 'vscode'}
            onValueChange={(value) => handleIDEChange(value as SupportedIDE)}
          >
            <SelectTrigger id="preferred-ide">
              <SelectValue placeholder={t('devtools.ide.placeholder', 'Select IDE...')} />
            </SelectTrigger>
            <SelectContent>
              {ideOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <div className="flex items-center gap-2">
                    <span>{option.label}</span>
                    {option.detected && (
                      <Check className="h-3 w-3 text-green-500" />
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t('devtools.ide.description', 'Aperant-MCP will open worktrees in this editor')}
          </p>

          {/* Custom IDE Path */}
          {settings.preferredIDE === 'custom' && (
            <div className="mt-3 space-y-2">
              <Label htmlFor="custom-ide-path">
                {t('devtools.customPath', 'Custom path')}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="custom-ide-path"
                  value={settings.customIDEPath || ''}
                  onChange={(e) => handleCustomIDEPathChange(e.target.value)}
                  placeholder="/path/to/your/ide"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={async () => {
                    const result = await window.electronAPI.selectDirectory();
                    if (result) {
                      handleCustomIDEPathChange(result);
                    }
                  }}
                  aria-label={t('common:accessibility.browseFilesAriaLabel')}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Terminal Selection */}
        <div className="space-y-2">
          <Label htmlFor="preferred-terminal" className="flex items-center gap-2">
            <Terminal className="h-4 w-4" />
            {t('devtools.terminal.label', 'Preferred Terminal')}
          </Label>
          <Select
            value={settings.preferredTerminal || 'system'}
            onValueChange={(value) => handleTerminalChange(value as SupportedTerminal)}
          >
            <SelectTrigger id="preferred-terminal">
              <SelectValue placeholder={t('devtools.terminal.placeholder', 'Select terminal...')} />
            </SelectTrigger>
            <SelectContent>
              {terminalOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <div className="flex items-center gap-2">
                    <span>{option.label}</span>
                    {option.detected && (
                      <Check className="h-3 w-3 text-green-500" />
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t('devtools.terminal.description', 'Aperant-MCP will open terminal sessions here')}
          </p>

          {/* Custom Terminal Path */}
          {settings.preferredTerminal === 'custom' && (
            <div className="mt-3 space-y-2">
              <Label htmlFor="custom-terminal-path">
                {t('devtools.customPath', 'Custom path')}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="custom-terminal-path"
                  value={settings.customTerminalPath || ''}
                  onChange={(e) => handleCustomTerminalPathChange(e.target.value)}
                  placeholder="/path/to/your/terminal"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={async () => {
                    const result = await window.electronAPI.selectDirectory();
                    if (result) {
                      handleCustomTerminalPathChange(result);
                    }
                  }}
                  aria-label={t('common:accessibility.browseFilesAriaLabel')}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Aperant-MCP System Section */}
        <div className="space-y-4 pt-6 border-t border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Aperant-MCP System</h3>
            <p className="text-xs text-muted-foreground mt-1">
              LLM Manager restart control and crash recovery settings
            </p>
          </div>

          {/* Reopen Command */}
          <div className="space-y-2 ml-4">
            <Label htmlFor="reopen-command" className="text-sm font-medium">
              {t('devtools.reopenCommand.label', 'Reopen Command')}
            </Label>
            <Input
              id="reopen-command"
              value={settings.autoRestartOnFailure?.reopenCommand || ''}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  autoRestartOnFailure: {
                    ...(settings.autoRestartOnFailure || {
                      enabled: false,
                      buildCommand: 'npm run build',
                      maxRestartsPerHour: 3,
                      cooldownMinutes: 5
                    }),
                    reopenCommand: e.target.value
                  }
                })
              }
              placeholder={t('devtools.reopenCommand.placeholder', 'e.g., open -a "Auto-Claude" (macOS)')}
              className="max-w-md font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              {t('devtools.reopenCommand.description', 'Command to start Auto-Claude after restart (OS-specific and IDE/CLI specific sometimes)')}
            </p>
          </div>

          {/* Build Command (moved outside toggle) */}
          <div className="space-y-2 ml-4">
            <Label htmlFor="build-command" className="text-sm font-medium text-foreground">
              {t('devtools.buildCommand.label', 'Build Command')}
            </Label>
            <Input
              id="build-command"
              value={settings.autoRestartOnFailure?.buildCommand ?? 'npm run build'}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  autoRestartOnFailure: {
                    ...(settings.autoRestartOnFailure || {
                      enabled: false,
                      maxRestartsPerHour: 3,
                      cooldownMinutes: 5
                    }),
                    buildCommand: e.target.value
                  }
                })
              }
              placeholder="npm run build"
              className="max-w-md"
            />
            <p className="text-xs text-muted-foreground">
              {t('devtools.buildCommand.description', 'Command to build Auto-Claude (auto-filled based on Build Type)')}
            </p>
          </div>

          {/* Shutdown Command */}
          <div className="space-y-2 ml-4">
            <Label htmlFor="shutdown-command" className="text-sm font-medium text-foreground">
              {t('devtools.shutdownCommand.label', 'Shutdown Command')}
            </Label>
            <Input
              id="shutdown-command"
              value={settings.shutdownCommand || ''}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  shutdownCommand: e.target.value
                })
              }
              placeholder="shutdown /s /t 120 (Windows) | sudo shutdown -h +2 (macOS/Linux)"
              className="max-w-md font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              {t('devtools.shutdownCommand.description', 'Command to shut down your system when all tasks complete (OS-specific). Leave empty for platform default.')}
            </p>
          </div>

          {/* Auto-disable RDR on User Stop */}
          <div className="space-y-3 ml-4">
            <div className="flex items-center justify-between max-w-md">
              <div className="space-y-0.5">
                <Label htmlFor="auto-disable-rdr-on-stop" className="text-sm font-medium">
                  {t('devtools.autoDisableRdrOnStop.label', 'Auto-disable RDR on User Stop')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('devtools.autoDisableRdrOnStop.description', 'When you stop a task, automatically disable RDR for that task so it won\'t be auto-recovered. Turn this off if you want stopped tasks to still be detected by MCP for later recovery (e.g., task taking too long and you want it picked up later).')}
                </p>
              </div>
              <Switch
                id="auto-disable-rdr-on-stop"
                checked={settings.autoDisableRdrOnStop ?? true}
                onCheckedChange={(checked) =>
                  onSettingsChange({
                    ...settings,
                    autoDisableRdrOnStop: checked
                  })
                }
              />
            </div>
          </div>

          {/* Master LLM RDR Prompt Sending Mechanism - Profile System */}
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium ml-4">
                {t('devtools.rdrMechanisms.label', 'Master LLM RDR Prompt Sending Mechanism')}
              </Label>
              <p className="text-xs text-muted-foreground ml-4">
                {t('devtools.rdrMechanisms.description', 'Manage named RDR sending mechanisms. Use template variables: {{message}} (escaped text), {{messagePath}} (temp file path), {{identifier}} (window PID/title), {{scriptPath}} (script file path).')}
              </p>

              {/* Mechanism selector + action buttons */}
              <div className="flex items-center gap-2 w-full px-4">
                <Select
                  value={activeMechanismId}
                  onValueChange={(id) =>
                    onSettingsChange({
                      ...settings,
                      activeMechanismId: id
                    })
                  }
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select mechanism" />
                  </SelectTrigger>
                  <SelectContent>
                    {mechanisms.map(m => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Create button */}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setMechanismName('');
                    setShowCreateMechanismDialog(true);
                  }}
                  title="Create new mechanism"
                >
                  <Plus className="w-4 h-4" />
                </Button>

                {/* Rename button */}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (selectedMechanism && !selectedMechanism.isDefault) {
                      setMechanismName(selectedMechanism.name);
                      setShowRenameMechanismDialog(true);
                    }
                  }}
                  disabled={!selectedMechanism || selectedMechanism.isDefault}
                  title="Rename mechanism"
                >
                  <Edit className="w-4 h-4" />
                </Button>

                {/* Delete button */}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleDeleteMechanism}
                  disabled={!selectedMechanism || selectedMechanism.isDefault}
                  title="Delete mechanism"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              {/* Template editor - full width and resizable */}
              {/* Linux native mechanism shows a status panel instead of an empty textarea */}
              {selectedMechanism?.id === 'linux-native-cdp-vscode' ? (
                <div className="px-4">
                  <div className="flex items-start gap-2 p-3 border border-green-500/50 bg-green-500/10 rounded-md">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-green-600 dark:text-green-400">
                        Linux Native CDP Active
                      </p>
                      <p className="text-xs text-green-600/80 dark:text-green-400/80">
                        Prompts are sent directly via Chrome DevTools Protocol (CDP) to VS Code: extensions.
                        No custom script needed. Fallback: foreground clipboard simulation (xdotool/xclip or kdotool/wl-copy).
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="px-4">
                  <Textarea
                    className="w-full resize-y font-mono text-xs"
                    rows={6}
                    value={selectedMechanism?.template || ''}
                    onChange={(e) => handleUpdateTemplate(e.target.value)}
                    placeholder={t('devtools.rdrMechanisms.templatePlaceholder', 'e.g., ccli --message "$(cat \'{{messagePath}}\')"')}
                  />
                </div>
              )}

              {/* Template validation warning */}
              {(() => {
                const template = selectedMechanism?.template?.trim();
                if (template && !template.includes('{{message}}') && !template.includes('{{messagePath}}')) {
                  return (
                    <div className="flex items-start gap-2 p-2 border border-amber-500/50 bg-amber-500/10 rounded-md mx-4">
                      <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Template must include either {'{{message}}'} or {'{{messagePath}}'} to send the RDR notification
                      </p>
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            {/* Create Mechanism Dialog */}
            <Dialog open={showCreateMechanismDialog} onOpenChange={setShowCreateMechanismDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('devtools.rdrMechanisms.createDialogTitle', 'Create New Mechanism')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="mechanism-name">{t('devtools.rdrMechanisms.nameLabel', 'Mechanism Name')}</Label>
                    <Input
                      id="mechanism-name"
                      value={mechanismName}
                      onChange={(e) => setMechanismName(e.target.value)}
                      placeholder={t('devtools.rdrMechanisms.namePlaceholder', 'e.g., Windows Claude Code for VS Code')}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCreateMechanismDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateMechanism}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Rename Mechanism Dialog */}
            <Dialog open={showRenameMechanismDialog} onOpenChange={setShowRenameMechanismDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('devtools.rdrMechanisms.renameDialogTitle', 'Rename Mechanism')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="rename-mechanism-name">{t('devtools.rdrMechanisms.nameLabel', 'Mechanism Name')}</Label>
                    <Input
                      id="rename-mechanism-name"
                      value={mechanismName}
                      onChange={(e) => setMechanismName(e.target.value)}
                      placeholder={t('devtools.rdrMechanisms.namePlaceholder', 'e.g., Windows Claude Code for VS Code')}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowRenameMechanismDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleRenameMechanism}>Rename</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {/* Auto-Restart on Crash or If Required */}
          <div className="space-y-3 ml-4">
            <div className="flex items-center justify-between max-w-md">
              <div className="space-y-0.5">
                <Label htmlFor="auto-restart-on-failure" className="text-sm font-medium">
                  {t('devtools.autoRestartOnFailure.label', 'Auto-Restart on Crash or If Required')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('devtools.autoRestartOnFailure.description', 'Automatically restart when a task pauses due to rate limit, automatically resume it when the limit resets. If disabled, tasks go to Human Review and require manual restart.')}
                </p>
              </div>
              <Switch
                id="auto-restart-on-failure"
                checked={settings.autoRestartOnFailure?.enabled ?? false}
                onCheckedChange={(checked) =>
                  onSettingsChange({
                    ...settings,
                    autoRestartOnFailure: {
                      ...(settings.autoRestartOnFailure || {
                        buildCommand: 'npm run build',
                        maxRestartsPerHour: 3,
                        cooldownMinutes: 5
                      }),
                      enabled: checked
                    }
                  })
                }
              />
            </div>
          </div>

          {/* Crash Recovery */}
          <div className="space-y-3 ml-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="crash-recovery" className="text-sm font-medium">
                  {t('devtools.crashRecovery.label', 'Crash Recovery')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('devtools.crashRecovery.description', 'Automatically restart Aperant-MCP when crashes are detected (via external watchdog)')}
                </p>
              </div>
              <Switch
                id="crash-recovery"
                checked={settings.crashRecovery?.enabled ?? false}
                onCheckedChange={(checked) => {
                  onSettingsChange({
                    ...settings,
                    crashRecovery: {
                      ...(settings.crashRecovery || { autoRestart: true, maxRestarts: 3, restartCooldown: 60000 }),
                      enabled: checked
                    }
                  });
                }}
              />
            </div>
          </div>
        </div>

        {/* Auto-name Claude Terminals Toggle */}
        <div className="space-y-3 pt-2 border-t border-border">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-name-claude-terminals" className="text-sm font-medium">
                {t('devtools.autoNameClaude.label', 'Auto-name Claude terminals')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t('devtools.autoNameClaude.description', 'Use AI to generate a descriptive name for Claude terminals based on your first message')}
              </p>
            </div>
            {/* Fallback to true for existing users who don't have this setting in persisted config */}
            <Switch
              id="auto-name-claude-terminals"
              checked={settings.autoNameClaudeTerminals ?? true}
              onCheckedChange={(checked) => {
                onSettingsChange({
                  ...settings,
                  autoNameClaudeTerminals: checked
                });
              }}
            />
          </div>
        </div>

        {/* YOLO Mode Toggle */}
        <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <Label htmlFor="yolo-mode" className="text-amber-200">
                {t('devtools.yoloMode.label', 'YOLO Mode')}
              </Label>
            </div>
            <Switch
              id="yolo-mode"
              checked={settings.dangerouslySkipPermissions ?? false}
              onCheckedChange={(checked) => {
                onSettingsChange({
                  ...settings,
                  dangerouslySkipPermissions: checked
                });
              }}
            />
          </div>
          <p className="text-xs text-amber-400/80">
            {t('devtools.yoloMode.description', 'Start Claude with --dangerously-skip-permissions flag, bypassing all safety prompts. Use with extreme caution.')}
          </p>
          {settings.dangerouslySkipPermissions && (
            <p className="text-xs text-amber-500 font-medium flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {t('devtools.yoloMode.warning', 'This mode bypasses Claude\'s permission system. Only enable if you fully trust the code being executed.')}
            </p>
          )}
        </div>

        {/* Detection Summary */}
        {detectedTools && !isDetecting && (
          <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
            <p className="font-medium mb-1">{t('devtools.detected', 'Detected on your system')}:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {detectedTools.ides.map((ide) => (
                <li key={ide.id}>{ide.name}</li>
              ))}
              {detectedTools.terminals.filter(t => t.id !== 'system').map((term) => (
                <li key={term.id}>{term.name}</li>
              ))}
              {detectedTools.ides.length === 0 && detectedTools.terminals.filter(t => t.id !== 'system').length === 0 && (
                <li>{t('devtools.noToolsDetected', 'No additional tools detected')}</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
