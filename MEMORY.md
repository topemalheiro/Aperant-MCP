# Auto-Claude Mod - Key Learnings

## Topic Files (detailed notes)
- [rdr-patterns.md](rdr-patterns.md) — RDR message pipeline, detection, recovery patterns
- [post-merge-bugs-2026-02-12.md](post-merge-bugs-2026-02-12.md) — WinError 206, MCP crash, XState board movement bug, writeFileSync
- [usage-rdr-interaction.md](usage-rdr-interaction.md) — Usage monitor ↔ RDR pause/resume, fragile interdependencies, NEVER rules
- [freeze-regression-timeline.md](freeze-regression-timeline.md) — Why Auto-Claude started freezing (Feb 27→Mar 9), trigger accumulation, root fix

## Watchdog Log Persistence (2026-03-09)
- `watchdog.log` at `%APPDATA%/auto-claude-ui/watchdog.log` now persists ALL Electron stdout/stderr (not just watchdog lifecycle events)
- Buffered writes (2s batching) to avoid disk thrashing
- Flushed on: crash (`handleProcessExit`), freeze (`handleFreezeDetected`), clean shutdown (`stop()`)
- Log rotation: 5MB limit, rotates to `watchdog.log.1` (previous session always recoverable)
- Session separators (`====` + timestamp) for easy navigation
- **File**: `apps/frontend/src/main/watchdog/auto-claude-watchdog.ts`

## Launching/Killing Auto-Claude from Claude Code — CRITICAL
- **Kill**: MUST kill the watchdog terminal, not just electron.exe. Watchdog is a separate node.exe that respawns Electron if only Electron dies.
  - `taskkill.exe //F //FI "WINDOWTITLE eq *Auto-Claude*" 2>/dev/null; taskkill.exe //F //IM "electron.exe" 2>/dev/null`
- **Start**: Must remove `ELECTRON_RUN_AS_NODE` env var first (Claude Code sets it, breaks Electron GUI)
  - `powershell.exe -Command "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; Start-Process 'C:\Users\topem\source\repos\Auto-Claude-MCP\Auto-Claude-MCP.bat'"`
- Without clearing env var, Electron runs as plain Node.js → `SyntaxError: 'electron' does not provide an export named 'BrowserWindow'`

## Git Branching Workflow (User Preference) - IMPORTANT
- **Bug fixes / non-feature work**: Use public `fork/develop` branch directly. Commit and push there.
- **New features** (e.g., messaging system): Use private `origin/dev-next` branch. Cherry-pick fixes to public later.
- **dev-next** = private experimentation + features. **develop** = public-facing, fix-only.
- Remotes: `origin` = private (`Auto-Claude-MCP-Private`), `fork` = public (`Auto-Claude-MCP`), `upstream` = original (`AndyMik90/Auto-Claude`)

## Critical Patterns

### Windows ESM --import Requires file:// URLs (2026-02-18) - CRITICAL
- Node.js `--import` flag with absolute Windows paths (`C:/...`) fails: `ERR_UNSUPPORTED_ESM_URL_SCHEME`
- Node interprets `C:` as a URL scheme. Fix: use `file:///C:/...` prefix
- Relative paths (`./path`) work fine — only absolute paths need `file:///`
- The `--import` path for `register-loader.mjs` MUST be `file:///C:/Users/topem/source/repos/Auto-Claude-MCP/apps/frontend/src/main/mcp-server/register-loader.mjs`
- The main entry point (tsx arg) does NOT need `file:///` — tsx handles that
- `claude mcp add-json` silently strips `cwd` field — always use absolute paths
- **Config locations**: `~/.claude.json` (user scope in root `mcpServers`), `~/.claude/.mcp.json` (global), `.mcp.json` (project)

### XState Silent Event Ignoring (2026-02-12) - IMPORTANT
- XState silently ignores events not in current state's `on:` map — NO error thrown
- `handleManualStatusChange` returns `true` regardless of whether XState transitioned
- Manual override events (MARK_DONE) must be in ALL non-terminal states
- **File**: `apps/frontend/src/shared/state-machines/task-machine.ts`

### Windows Command Line Length — WinError 206 (2026-02-12)
- Windows `CreateProcessW` limit: 32,767 chars. CLAUDE.md (~32KB) exceeds this via `--system-prompt`
- Fix: Externalize to `system_prompt_cache.md`, pass short reference prompt
- `anyio.open_process` raises misleading `FileNotFoundError` with `winerror: 206`
- Never `json.dump()` raw `mcp_servers` dict — may contain non-serializable SDK Server instances
- **File**: `apps/backend/core/client.py`

### Worktree vs Main Staleness (recurring since 2026-02-06)
- ANY code reading from main specs dir should check worktree first
- Worktree `planStatus` is the distinguishing field: `completed/approved` = done, `review/in_progress` = needs work

### Status Checks: Blacklists Not Whitelists (2026-02-09)
- NEVER use whitelists for status checks. Use BLACKLISTS (exclude known terminals).

### exitReason is Session-Level (2026-02-09)
- QA approved = work validated. Period. Don't let session-level crashes override.
- ALWAYS check recency before exitReason for active statuses.

### Task Status Write-Back Flow
- Manual board moves persist via XState subscriber → `persistPlanStatusAndReasonSync`
- Writes to BOTH main AND worktree `implementation_plan.json`
- `forceRefresh: true` clears XState actors, re-reads from disk → reverts UI if disk wasn't updated

### RDR Priority System (6 levels + 6C, 2026-02-09/15)
- P1: `rdrAttempts < 3`, no `stuckSince` → `process_rdr_batch`
- P2: `stuckSince` set → `recover_stuck_task`
- P3-6: `rdrAttempts >= 3` → `submit_task_fix_request`
- P4: `json_error` → `process_rdr_batch(type: "json_error")`
- P6C: `defer_task` — move broken task to Queue with RDR disabled, deal with it later
- Resets on normal startup, persists during P6B restarts

## RDR System Architecture
- Pipeline: OutputMonitor → idle event → rdr-handlers → IPC → KanbanBoard → WindowManager PowerShell
- MCP Monitor is reliable source for user state (task agents don't connect to MCP)
- OutputMonitor second — when MCP=idle but Output=PROCESSING, it's a task agent

## MCP Recovery (2026-02-06)
- File-based recovery (not IPC). Updates BOTH main AND worktree plans.
- ANY tool writing `start_requested` must also: update `updated_at`, clear `exitReason`, increment `rdrAttempts`

### RDR Busy Check ● Regression (2026-03-10) - CRITICAL
- Commit `80220ae0` removed `/●/` from `busyPatterns` in `window-manager.ts` — this was the main signal preventing RDR from interrupting active sessions
- Reason for removal: task agents constantly modify files → `●` always present → RDR never sends
- **But removing it broke busy detection** — between Claude responses (user reading/thinking), ALL checks return idle → RDR interrupts
- **Fix**: Restored `●` as a COMBO check: `●` in title AND OutputMonitor not IDLE → busy. Task agents with `●` but OutputMonitor IDLE → not blocked.
- Also added `/claude's plan/i` to `busyPatterns` for plan mode detection
- **File**: `apps/frontend/src/main/platform/windows/window-manager.ts`

### QA Completion: OR Logic Not Requirement (2026-03-10) - CRITICAL
- `qa_signoff=approved` OR `qa_report.md` → genuinely complete (OR logic)
- `qa_report.md` is ADDITIONAL signal, NOT a requirement — most tasks don't have it (only written on manual user approval)
- Making `qa_report.md` a requirement caused 33 false positive RDR detections
- **Files**: `rdr-handlers.ts` (determineInterventionType), `mcp-server/index.ts` (QA guard)

## Bug Fix Summary (by date)

### 2026-02-16 (Session 2 - RDR Stopped Task Detection + Queue Auto-Advance)
- **RDR special-cased stopped tasks**: `determineInterventionType` had early returns skipping `reviewReason === 'stopped'` (lines 399-402, 447-450). This prevented detection of stopped tasks with `phases: []` (regressions). **Fix**: Removed the special cases entirely. Let normal detection logic handle stopped tasks:
  - Stopped with phases + worktree → caught as regression by line 408-410 (hasWorktree)
  - Stopped without phases → caught by line 522 (empty phases check)
  - Stopped with work, no regression → return null naturally
- **Queue doesn't process when RDR disabled**: `useEffect` (lines 1397-1404) cleared held slots but didn't call `processQueue()`. Fix: Added `processQueue()` call after clearing slots so queue auto-advances.
- **Root cause insight** (user's key observation): Testing with `phases: []` simulates regression. Stop button keeps phases intact but sets `reviewReason: 'stopped'`. So RDR should detect REGRESSION regressions (empty phases), not all stopped tasks. The fix properly handles this distinction by removing special-case skips.

### 2026-03-09 (Session 2)
- **Usage API 429 spam**: Usage endpoint 429'd every 30s with NO cooldown → meter stuck at stale cached%. Fix: 429 now records `apiFailureTimestamps` → 2min cooldown. CLI fallback also skips during cooldown (same endpoint). Commit `70f00945`.
- **RDR no startup check**: RDR only fires on OutputMonitor idle events. If user is actively using Claude Code, idle never fires → RDR never sends. Fix: 45s delayed startup check notifies renderer to scan for stuck tasks. Commit `70f00945`.
- **P2 stalled agent detection**: Rate-limited agents keep process alive in AgentState.processes → `isTaskAgentRunning()` returns true → P2 skips them. Fix: `isTaskAgentStalled()` cross-checks agent `startedAt` (>10min) with plan `updated_at` (>15min stale). Commit `84be9687`.
- **P2 100%-complete tasks on active boards**: Tasks with all subtasks done but never transitioned to human_review (agent died after finishing). Batch 2c catches these. Commit `ea567e04`.

### 2026-03-09
- **RDR infinite re-pause loop**: `isSessionLimitReached()` used `Date.now()+5h` fallback when `sessionResetTimestamp` missing → pause expires → re-paused with new fabricated timestamp → infinite loop. Killed overnight batches. Fix: no real timestamp = not limited. Also added `checkRdrThresholds` to API failure path. Commit `1d026ba7`.
- **Why Feb worked but not March**: `checkRdrThresholds`/`pauseRdr` added March 7 (`6f17c683`). Before that, RDR had NO usage-based pause.
- See [usage-rdr-interaction.md](usage-rdr-interaction.md) for full system interaction docs.

### 2026-03-08
- **Usage meter freeze at ~80%**: Commit `2ebed3e1` added `if (this.currentUsage) return null` to `fetchUsageViaCLI()` (line 2093), killing the CLI fallback credential source. When keychain token fails, the backup (`~/.claude/.credentials.json`) is never read. Meter stuck at cached ~80% forever. Fix: removed the guard.
- **warnRdr at 80% shows orange text prematurely**: `checkRdrThresholds()` called `warnRdr()` at >=80%. User wants only `pauseRdr()` at >=100%. Fix: removed 80% warning tier entirely.
- **RDR busy check MCP override**: `isClaudeCodeBusy()` dismissed OutputMonitor PROCESSING when MCP was idle (treating it as "task agent"). MCP being idle between tool calls is normal. Fix: OutputMonitor PROCESSING always blocks.
- **NEVER correct user on CLI usage readings** — user explicitly demanded this
- **Diagnostics panel**: Added Settings > Diagnostics tab with usage meter + RDR state inspection, Force Fetch, Test RDR buttons. IPC: `diagnostics:getUsageState`, `diagnostics:getRdrState`, `diagnostics:forceUsageFetch`, `diagnostics:sendTestRdr`.

### 2026-02-15
- **Watchdog path mismatch**: Wrote crash flags to `%APPDATA%/auto-claude/` instead of `auto-claude-ui/`. `auto-claude-watchdog.ts`
- **Startup crash invisible**: No try-catch around `app.whenReady()` body. Added with `startup-crash.log`. `index.ts`
- **Queue leak (processQueue)**: Stale `initialInProgress.length` snapshot. Fix: live `useTaskStore.getState()` each iteration. `KanbanBoard.tsx`
- **Drag-to-queue agent not stopping**: Agent kill AFTER plan persistence → agent overwrites plan. Fix: kill BEFORE persist. `execution-handlers.ts`

### 2026-02-12 (Post-Merge — see [post-merge-bugs-2026-02-12.md])
- **WinError 206**: System prompt too long → externalize to file. `client.py` (commit `e41b64e7`)
- **MCP config crash**: `json.dump()` on SDK Server instance → removed caching. `client.py` (commit `efa37e6f`)
- **writeFileSync missing**: Import dropped in merge. `agent-process.ts` (commit `efa37e6f`)
- **shouldSkipStuckCheck missing**: Function dropped in merge. `TaskCard.tsx` (commit `b292cee4`)
- **XState MARK_DONE**: Only accepted from 3 states → added to all. `task-machine.ts` (commit `914698af`)

### 2026-02-11
- **RDR false positive for backlog**: `isTaskAgentRunning()` not checked for backlog/pending. `rdr-handlers.ts`

### 2026-02-09
- Enrichment whitelist → blacklist. QA-approved is final. Dynamic priority RDR (P1-P6).
- exitReason check order. File watcher always starts agent. process_rdr_batch timestamps.
- rdrAttempts reset on startup. QA-approved board position checks.

### 2026-02-08
- Auto-shutdown: status-only (no progress). OutputMonitor: MCP first.
- Shutdown monitor: `ELECTRON_RUN_AS_NODE=1` + `--experimental-strip-types`.
- Non-standard worktree statuses: check `planStatus`.

### 2026-02-06
- OutputMonitor stuck PROCESSING (recheck timer). Idle time bug. AT_PROMPT conflict.
- Worktree vs Main mismatch. MCP vs Electron store UUID. Wrong board routing.
- RDR message format. Auto-shutdown monitor rewrite.

## Key File Locations
- XState machine: `apps/frontend/src/shared/state-machines/task-machine.ts`
- TaskStateManager: `apps/frontend/src/main/task-state-manager.ts`
- Plan file utils: `apps/frontend/src/main/ipc-handlers/task/plan-file-utils.ts`
- Execution handlers: `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts`
- RDR handlers: `apps/frontend/src/main/ipc-handlers/rdr-handlers.ts`
- File watcher: `apps/frontend/src/main/file-watcher.ts`
- MCP server: `apps/frontend/src/main/mcp-server/index.ts`
- OutputMonitor: `apps/frontend/src/main/claude-code/output-monitor.ts`
- WindowManager: `apps/frontend/src/main/platform/windows/window-manager.ts`
- KanbanBoard: `apps/frontend/src/renderer/components/KanbanBoard.tsx`
- Auto Shutdown: `apps/frontend/src/main/ipc-handlers/auto-shutdown-handlers.ts`
- Client (Python): `apps/backend/core/client.py`
- Agent process: `apps/frontend/src/main/agent/agent-process.ts`
- Watchdog: `apps/frontend/src/main/watchdog/auto-claude-watchdog.ts`
- Crash recovery: `apps/frontend/src/main/crash-recovery-handler.ts`

### RDR In-Flight: useState→useRef Fix (2026-03-01) - CRITICAL
- `rdrMessageInFlight` as useState caused `handleAutoRdr` recreation → useEffect cascade → 5s startup timer spam
- Fix: Converted to `rdrMessageInFlightRef = useRef(false)` — same pattern as `queueBlockedRef`
- Removed `rdrMessageInFlight` from `handleAutoRdr` useCallback deps → useEffect no longer re-runs on in-flight changes
- Also: idle event no longer clears in-flight (commit `65bdbd30`), 3-min min send interval via `lastRdrSendTimestampRef`
- **3 commits**: `85cfb50c` (busy check guard), `65bdbd30` (min interval), `8301c302` (useState→useRef)
- **File**: `apps/frontend/src/renderer/components/KanbanBoard.tsx`

### Queue-Blocking: useState vs useRef Race Condition (2026-02-15) - IMPORTANT
- React `useState` is async (batched). `useRef.current` is synchronous.
- Queue blocking via useState: processQueue reads stale `false` from closure → task leaks
- Fix: `queueBlockedRef = useRef(false)` for logic, `useState` only for UI rendering
- Set ref BEFORE useState: `queueBlockedRef.current = true; setQueueBlocked(true);`
- Remove state from useCallback deps to prevent function recreation timing gaps
- **File**: `apps/frontend/src/renderer/components/KanbanBoard.tsx`

### Queue-Blocking: User Stop vs External Kill (2026-02-16) - CORRECTED
- **Stop button**: `USER_STOPPED` → `human_review` + `reviewReason: 'stopped'` (or `backlog` if no plan)
- **External kill (taskkill)**: `PROCESS_EXITED` → XState `error` → `mapStateToLegacy` → `human_review` + `reviewReason: 'errors'`
- Previous note was WRONG: external kills get 'errors', NOT 'stopped'
- Queue blocking catches external kills via: `reviewReason !== 'stopped'` check (line 1329)
- User stops should ALWAYS advance queue (user freed slot intentionally, RDR skips stopped tasks)
- No stopped-skip needed — removed in 2026-02-16 fix
- **File**: `apps/frontend/src/renderer/components/KanbanBoard.tsx`
- **Key mapping**: `task-state-utils.ts:78` — XState `error` → Kanban `human_review` + `errors`

### Watchdog Path Mismatch — Crash Flag Never Read (2026-02-15) - IMPORTANT
- Watchdog (`auto-claude-watchdog.ts`) hardcoded `'auto-claude'` as app data dir
- Electron `app.getPath('userData')` resolves to `%APPDATA%/auto-claude-ui/` (from package.json `name`)
- Result: Watchdog wrote crash flags to `%APPDATA%/auto-claude/` — Electron never read them
- Crash notifications never reached Claude Code, crash data was lost
- Fix: Shared constant `APP_DATA_DIR_NAME = 'auto-claude-ui'` used everywhere
- Also added try-catch in `app.whenReady()` with `startup-crash.log` for visible errors
- **Files**: `apps/frontend/src/main/watchdog/auto-claude-watchdog.ts`, `apps/frontend/src/main/index.ts`

### Testing Queue-Blocking Feature (2026-02-15) - CRITICAL LESSON
- **"Kill agents" ≠ Edit JSON status** — Means TERMINATE running subprocess processes
- Real agent failure requires **actual process termination** (`taskkill`, `pkill`, or IPC signal)
- Manual JSON edits simulate state changes but NOT actual agent crashes — doesn't test real failure scenario
- **Testing approach**: Use IPC or process management to stop agent subprocess, let Auto-Claude detect failure naturally
- **Wrong approach**: Edit JSON files to simulate failure — bypasses the actual status change listener flow

### UI Feature Implementation Checklist (2026-02-18) - CRITICAL
- **Never ship invisible features**: New UI must NEVER return `null` on first load. Show empty state/placeholder.
- **No empty onClick handlers**: Either implement, disable with visible reason, or remove entirely
- **Switch semantic consistency**: `checked` prop and `onCheckedChange` must control the SAME state
- **Plan fidelity**: Re-read every plan item after implementation. "Reorganize layout" ≠ "append at bottom"
- **i18n keys first**: Add to ALL locale JSON files immediately when writing `t()` calls, not as batch later
- **User journey walkthrough**: After implementing, simulate: zero data → discovery → config → active use
- **Learned skill file**: `~/.claude/skills/learned/ui-feature-checklist.md`

### RDR Notification = Rate Limit Reset (2026-02-20) - CRITICAL RULE
- **If you receive an RDR notification, the rate limit has ALREADY RESET**
- Task log entries showing "You've hit your limit" are HISTORICAL — written when the task hit the limit, not current state
- RDR only sends notifications when the Claude Code session is available again
- **ALWAYS process ALL RDR tasks immediately. NEVER refuse based on stale task log rate limit entries.**
- Updated both skill markdowns: `~/.claude/skills/rdr-handler.md` and `~/.claude/skills/auto-claude-rdr/skill.md`

### RDR Resend Flooding on Session Reset (2026-02-19) - NEEDS FIX
- **Problem**: When Claude Code session resets (rate limit/context), RDR sends fail with "Invalid window handle" and spam endlessly
- **Root cause**: `selectedWindowHandle` (React useState in KanbanBoard.tsx:1725) is set ONCE on mount, never refreshed
- `loadVsCodeWindows()` only auto-selects when `selectedWindowHandle === null` (line 1748)
- Custom PowerShell template gets stale handle substituted → `IsWindow()` fails
- **No backoff**: Line 2106 `setRdrMessageInFlight(false)` on failure → immediate retry → infinite spam loop
- **Fix needed**: (1) Refresh windows on send failure (call `loadVsCodeWindows()` on error), (2) Exponential backoff on repeated failures, (3) Max retry count before stopping
- **Also**: RDR should detect rate limit resets and only re-send when Claude Code session becomes available again
- **Files**: `KanbanBoard.tsx` (selectedWindowHandle, handleAutoRdr), `rdr-message-sender.ts`, `window-manager.ts`

### RDR Priority: in_progress Tasks Should Be P2 Not P1 (2026-02-19) - NEEDS INVESTIGATION
- Task 933 was `in_progress` at 83% with agent NOT running → classified as P1 (auto-continue)
- User expects P2 (recover) for stuck in_progress tasks — agent is dead, needs recovery
- `rdrAttempts` reset on startup → everything starts as P1 regardless of actual state
- **Question**: Should `in_progress`/`ai_review` tasks with no running agent be P2 immediately?
- **File**: `rdr-handlers.ts` (determineInterventionType, priority classification)

### reviewReason=completed ≠ qaSignoff=approved (2026-02-20) - CRITICAL FIX
- `reviewReason=completed` = coder finished all subtasks. `qaSignoff=approved` = QA validated the work.
- `isLegitimateHumanReview()` and `determineInterventionType()` BOTH had `reviewReason === 'completed'` in their QA-approved checks — WRONG
- Task 944 had 100% progress + `reviewReason=completed` + `qaSignoff=none` → RDR falsely skipped it as "QA-approved"
- Fix: Only `qaSignoff=approved` counts. Also guard catch-all at line 496 so `reviewReason=completed` doesn't slip through.
- Also: `rdrDisabled` now auto-cleared on `start_requested` in file-watcher.ts (undo `autoDisableRdrOnStop`)
- **Files**: `rdr-handlers.ts`, `file-watcher.ts` (commit `88361c0b`)

## Build
- Frontend: `cd apps/frontend && npm run build` → `apps/frontend/out/`
