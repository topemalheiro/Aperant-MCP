import { app } from './electron-compat';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { projectStore } from './project-store';
import { isRdrPaused } from './ipc-handlers/rdr-handlers';
import type { AgentManager } from './agent';
import type { BrowserWindow } from 'electron';

const CHECK_INTERVAL_MS = 60_000;              // Check every 60s
const STALL_THRESHOLD_MS = 3 * 60_000;        // 3 min without activity = stalled
const MAX_SELF_HEAL_ATTEMPTS = 2;              // 2 × 3 min = 6 min before escalation
const AGENT_STALE_THRESHOLD_MS = 10 * 60_000; // 10 min with "running" agents but no activity = stale

class ActivityMonitor {
  private lastActivityAt: number = Date.now();
  private lastActivitySource: string = 'startup';
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private selfHealAttempts: number = 0;
  private reloadAttempted: boolean = false;
  private agentManager: AgentManager | null = null;
  private getMainWindow: (() => BrowserWindow | null) | null = null;

  configure(agentManager: AgentManager, getMainWindow: () => BrowserWindow | null): void {
    this.agentManager = agentManager;
    this.getMainWindow = getMainWindow;
  }

  start(): void {
    if (this.checkInterval) return;
    this.checkInterval = setInterval(() => this.check(), CHECK_INTERVAL_MS);
    this.checkInterval.unref();

    // Check for stale RDR pause on startup (watchdog may have cleared it)
    this.checkWatchdogRdrClear();

    console.log('[ActivityMonitor] Started (check interval:', CHECK_INTERVAL_MS / 1000, 's, stall threshold:', STALL_THRESHOLD_MS / 1000, 's)');
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /** Check if the watchdog cleared a stale RDR pause (wrote rdr-clear-signal.json) */
  private checkWatchdogRdrClear(): void {
    try {
      const userData = app.getPath('userData');
      const signalPath = join(userData, 'rdr-clear-signal.json');
      if (!existsSync(signalPath)) return;

      const content = readFileSync(signalPath, 'utf-8').trim();
      if (!content) return;

      const signal = JSON.parse(content);
      console.log(`[ActivityMonitor] Watchdog cleared stale RDR pause at ${signal.clearedAt}`);

      // Import resumeRdr to clear the in-memory state and notify renderer
      const { resumeRdr } = require('./ipc-handlers/rdr-handlers');
      resumeRdr('Watchdog cleared stale RDR pause');

      // Clear the signal file
      writeFileSync(signalPath, '', 'utf-8');
    } catch {
      // Ignore errors
    }
  }

  recordActivity(source: string): void {
    this.lastActivityAt = Date.now();
    this.lastActivitySource = source;
    // Real activity resets self-heal counter and reload flag
    if (!source.startsWith('self-heal')) {
      this.selfHealAttempts = 0;
      this.reloadAttempted = false;
    }
  }

  getLastActivityAt(): number {
    return this.lastActivityAt;
  }

  getLastActivitySource(): string {
    return this.lastActivitySource;
  }

  getSelfHealAttempts(): number {
    return this.selfHealAttempts;
  }

  private check(): void {
    const staleDuration = Date.now() - this.lastActivityAt;

    // 0. Check if watchdog cleared a stale RDR pause
    this.checkWatchdogRdrClear();

    // 1. Is there actually work to do?
    if (!this.hasIncompleteWork()) {
      return;
    }

    // 2. Is RDR paused due to rate limit?
    if (isRdrPaused()) {
      return;
    }

    // 3. Are agents actively running AND making progress?
    if (this.agentManager && this.agentManager.getRunningTasks().length > 0) {
      const agentStaleDuration = Date.now() - this.lastActivityAt;
      if (agentStaleDuration < AGENT_STALE_THRESHOLD_MS) {
        return; // Agents running AND recent activity — all good
      }
      // Agents "running" but no activity for 10+ min — likely stale/dead processes
      console.warn(
        `[ActivityMonitor] Agents appear STALE: ${this.agentManager.getRunningTasks().length} "running" ` +
        `but no activity for ${Math.round(agentStaleDuration / 60_000)}min — falling through to stall detection`
      );
    }

    // 4. Has it been long enough to worry?
    if (staleDuration < STALL_THRESHOLD_MS) {
      return;
    }

    // --- STALLED ---
    const staleMin = Math.round(staleDuration / 60_000);
    const incompleteTasks = this.countIncompleteTasks();
    console.warn(
      `[ActivityMonitor] STALL DETECTED: No activity for ${staleMin}min. ` +
      `Last activity: "${this.lastActivitySource}" at ${new Date(this.lastActivityAt).toISOString()}. ` +
      `Incomplete tasks: ${incompleteTasks}, running agents: ${this.agentManager?.getRunningTasks().length ?? 0}`
    );

    // 5. Try self-heal first
    if (this.selfHealAttempts < MAX_SELF_HEAL_ATTEMPTS) {
      this.selfHeal();
      return;
    }

    // 6. Self-heal exhausted — escalate
    this.escalate(staleDuration, incompleteTasks);
  }

  private selfHeal(): void {
    this.selfHealAttempts++;
    console.warn(`[ActivityMonitor] Self-heal attempt ${this.selfHealAttempts}/${MAX_SELF_HEAL_ATTEMPTS}`);

    // Send IPC to renderer to force-reset RDR state and trigger immediate poll
    const win = this.getMainWindow?.();
    if (win && !win.isDestroyed()) {
      win.webContents.send('activity-monitor:force-rdr-reset');
      console.warn('[ActivityMonitor] Sent force-rdr-reset IPC to renderer');
    } else {
      console.warn('[ActivityMonitor] No main window available for IPC');
    }

    // Give 5 more minutes for recovery to take effect
    this.lastActivityAt = Date.now();
    this.lastActivitySource = `self-heal-attempt-${this.selfHealAttempts}`;
  }

  private escalate(staleDuration: number, incompleteTasks: number): void {
    const staleMin = Math.round(staleDuration / 60_000);
    const reason = `No activity for ${staleMin}min with ${incompleteTasks} incomplete tasks. ` +
      `${this.selfHealAttempts} self-heal attempts failed. Last activity: "${this.lastActivitySource}"`;
    console.error(`[ActivityMonitor] ESCALATING: ${reason}`);

    const win = this.getMainWindow?.();

    // Try renderer reload first (less aggressive than full process kill)
    if (!this.reloadAttempted && win && !win.isDestroyed()) {
      console.warn('[ActivityMonitor] Attempting renderer reload before process kill...');
      this.writeFunctionalFreezeNotification(reason);
      win.webContents.reload();
      this.reloadAttempted = true;
      this.selfHealAttempts = 0;
      this.lastActivityAt = Date.now();
      this.lastActivitySource = 'renderer-reload';
      return;
    }

    // Reload already tried or no window — kill the process
    console.error('[ActivityMonitor] Renderer reload failed or already attempted — exiting');
    this.writeFunctionalFreezeNotification(reason);

    // Exit if watchdog is running (set by launcher.ts via WATCHDOG_ENABLED=true env var).
    // This covers both packaged apps AND the bat-file launch path (electron out/main/index.js),
    // where app.isPackaged is false but the watchdog IS running and will restart us.
    const watchdogRunning = process.env.WATCHDOG_ENABLED === 'true';
    if (watchdogRunning || app.isPackaged) {
      console.error('[ActivityMonitor] Watchdog present — exiting for restart');
      app.exit(1);
    } else if (win && !win.isDestroyed()) {
      // Pure dev mode without watchdog — last resort reload
      console.warn('[ActivityMonitor] No watchdog — force reloading renderer');
      win.webContents.reload();
      this.reloadAttempted = false;
      this.selfHealAttempts = 0;
      this.lastActivityAt = Date.now();
      this.lastActivitySource = 'dev-force-reload';
    }
  }

  private writeFunctionalFreezeNotification(reason: string): void {
    try {
      const userData = app.getPath('userData');

      const flagPath = join(userData, 'crash-flag.json');
      const crashFlag = {
        timestamp: Date.now(),
        exitCode: 1,
        signal: null,
        logs: [`[Freeze] functional_freeze: ${reason}`],
        freezeDetected: true,
        freezeType: 'functional_freeze'
      };
      writeFileSync(flagPath, JSON.stringify(crashFlag, null, 2), 'utf-8');

      const notificationPath = join(userData, 'crash-notification.json');
      const notification = {
        type: 'freeze_detected',
        freezeType: 'functional_freeze',
        timestamp: new Date().toISOString(),
        exitCode: 1,
        signal: null,
        logs: [`[Freeze] ${reason}`],
        autoRestart: true,
        restartCount: 0,
        message: `Auto-Claude functional freeze at ${new Date().toISOString()}. ${reason}`
      };
      writeFileSync(notificationPath, JSON.stringify(notification, null, 2), 'utf-8');

      console.error('[ActivityMonitor] Freeze notification written');
    } catch (error) {
      console.error('[ActivityMonitor] Failed to write freeze notification:', error);
    }
  }

  private hasIncompleteWork(): boolean {
    const projects = projectStore.getProjects();
    for (const project of projects) {
      const tasks = projectStore.getTasks(project.id);
      for (const task of tasks) {
        if (task.metadata?.archivedAt) continue;
        if (task.status === 'done' || task.status === 'pr_created') continue;
        if (task.status === 'human_review' && task.reviewReason === 'stopped') continue;
        if (task.metadata?.rdrDisabled) continue;
        return true;
      }
    }
    return false;
  }

  private countIncompleteTasks(): number {
    let count = 0;
    const projects = projectStore.getProjects();
    for (const project of projects) {
      const tasks = projectStore.getTasks(project.id);
      for (const task of tasks) {
        if (task.metadata?.archivedAt) continue;
        if (task.status === 'done' || task.status === 'pr_created') continue;
        if (task.status === 'human_review' && task.reviewReason === 'stopped') continue;
        if (task.metadata?.rdrDisabled) continue;
        count++;
      }
    }
    return count;
  }
}

export const activityMonitor = new ActivityMonitor();
