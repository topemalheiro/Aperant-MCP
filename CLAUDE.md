# CLAUDE.md

## Build: npm run build

This file provides guidance to Claude Code when working with this repository.

Aperant-MCP is an autonomous multi-agent coding framework that plans, builds, and validates software for you. It's a monorepo with a Python backend (CLI + agent logic) and an Electron/React frontend (desktop UI).

> **Deep-dive reference:** [ARCHITECTURE.md](shared_docs/ARCHITECTURE.md) | **Frontend contributing:** [apps/frontend/CONTRIBUTING.md](apps/frontend/CONTRIBUTING.md)

## Product Overview

Aperant-MCP is a desktop application (+ CLI) where users describe a goal and AI agents autonomously handle planning, implementation, and QA validation. All work happens in isolated git worktrees so the main branch stays safe.

**Core workflow:** User creates a task → Spec creation pipeline assesses complexity and writes a specification → Planner agent breaks it into subtasks → Coder agent implements (can spawn parallel subagents) → QA reviewer validates → QA fixer resolves issues → User reviews and merges.

**Main features:**

- **Autonomous Tasks** — Multi-agent pipeline (planner, coder, QA) that builds features end-to-end
- **Kanban Board** — Visual task management from planning through completion
- **Agent Terminals** — Up to 12 parallel AI-powered terminals with task context injection
- **Insights** — AI chat interface for exploring and understanding your codebase
- **Roadmap** — AI-assisted feature planning with strategic roadmap generation
- **Ideation** — Discover improvements, performance issues, and security vulnerabilities
- **GitHub/GitLab Integration** — Import issues, AI-powered investigation, PR/MR review and creation
- **Changelog** — Generate release notes from completed tasks
- **Memory System** — Graphiti-based knowledge graph retains insights across sessions
- **Isolated Workspaces** — Git worktree isolation for every build; AI-powered semantic merge
- **Flexible Authentication** — Use a Claude Code subscription (OAuth) or API profiles with any Anthropic-compatible endpoint (e.g., Anthropic API, z.ai for GLM models)
- **Multi-Account Swapping** — Register multiple Claude accounts; when one hits a rate limit, Aperant-MCP automatically switches to an available account
- **Cross-Platform** — Native desktop app for Windows, macOS, and Linux with auto-updates

## Critical Rules

**Fix the system, not the symptom** — When the user reports Auto-Claude task problems (stuck tasks, wrong board, missing RDR detection, incomplete validation), NEVER apply manual one-off fixes (editing JSON files, changing statuses by hand). Instead, fix the underlying system (RDR detection logic, board routing, file watcher, MCP tools) so it handles the case automatically. Manual file edits are acceptable ONLY as a temporary workaround while the systemic fix is being implemented. The goal is always: RDR and the automation pipeline should handle it without human intervention.

**Claude Agent SDK only** — All AI interactions use `claude-agent-sdk`. NEVER use `anthropic.Anthropic()` directly. Always use `create_client()` from `core.client`.

**i18n required** — All frontend user-facing text MUST use `react-i18next` translation keys. Never hardcode strings in JSX/TSX. Add keys to both `en/*.json` and `fr/*.json`.

**Platform abstraction** — Never use `process.platform` directly. Import from `apps/frontend/src/main/platform/` or `apps/backend/core/platform/`. CI tests all three platforms.

**No time estimates** — Never provide duration predictions. Use priority-based ordering instead.

**PR target** — Always target the `develop` branch for PRs to AndyMik90/Auto-Claude, NOT `main`.

## Work Approach

**Investigate before speculating** — Always read the actual code before proposing root causes. Spawn agents to grep and read relevant source files before forming any hypothesis. Never guess at causes without evidence from the codebase.

**Spawn agents for complex tasks** — When tackling complex tasks, spawn sub-agents/agent teams immediately rather than trying to handle everything in a single context window. Never attempt to analyze large codebases or multiple features monolithically.

**Minimal fixes only** — Prefer the simplest approach (e.g., prompt-only changes, single guard clause) before suggesting multi-component solutions. If the user asks for X, implement X — don't bundle additional fixes they didn't request.

## Known Gotchas

**Electron path resolution** — For bug fixes in the Electron app, always check path resolution differences between dev and production builds (`app.isPackaged`, `process.resourcesPath`). Paths that work in dev often break when Electron is bundled for production — verify both contexts.

### Resetting PR Review State

To fully clear all PR review data so reviews run fresh, delete/reset these three things in `.auto-claude/github/`:

1. `rm .auto-claude/github/pr/logs_*.json` — review log files
2. `rm .auto-claude/github/pr/review_*.json` — review result files
3. Reset `pr/index.json` to `{"reviews": [], "last_updated": null}`
4. Reset `bot_detection_state.json` to `{"reviewed_commits": {}}` — this is the gatekeeper; without clearing it, the bot detector skips already-seen commits

## Project Structure

```
autonomous-coding/
├── apps/
│   ├── backend/                 # Python backend/CLI — ALL agent logic
│   │   ├── core/                # client.py, auth.py, worktree.py, platform/
│   │   ├── security/            # Command allowlisting, validators, hooks
│   │   ├── agents/              # planner, coder, session management
│   │   ├── qa/                  # reviewer, fixer, loop, criteria
│   │   ├── spec/                # Spec creation pipeline
│   │   ├── cli/                 # CLI commands (spec, build, workspace, QA)
│   │   ├── context/             # Task context building, semantic search
│   │   ├── runners/             # Standalone runners (spec, roadmap, insights, github)
│   │   ├── services/            # Background services, recovery orchestration
│   │   ├── integrations/        # graphiti/, linear, github
│   │   ├── project/             # Project analysis, security profiles
│   │   ├── merge/               # Intent-aware semantic merge for parallel agents
│   │   └── prompts/             # Agent system prompts (.md)
│   └── frontend/                # Electron desktop UI
│       └── src/
│           ├── main/            # Electron main process
│           │   ├── agent/       # Agent queue, process, state, events
│           │   ├── claude-profile/ # Multi-profile credentials, token refresh, usage
│           │   ├── terminal/    # PTY daemon, lifecycle, Claude integration
│           │   ├── platform/    # Cross-platform abstraction
│           │   ├── ipc-handlers/# 40+ handler modules by domain
│           │   ├── services/    # SDK session recovery, profile service
│           │   └── changelog/   # Changelog generation and formatting
│           ├── preload/         # Electron preload scripts (electronAPI bridge)
│           ├── renderer/        # React UI
│           │   ├── components/  # UI components (onboarding, settings, task, terminal, github, etc.)
│           │   ├── stores/      # 24+ Zustand state stores
│           │   ├── contexts/    # React contexts (ViewStateContext)
│           │   ├── hooks/       # Custom hooks (useIpc, useTerminal, etc.)
│           │   ├── styles/      # CSS / Tailwind styles
│           │   └── App.tsx      # Root component
│           ├── shared/          # Shared types, i18n, constants, utils
│           │   ├── i18n/locales/# en/*.json, fr/*.json
│           │   ├── constants/   # themes.ts, etc.
│           │   ├── types/       # 19+ type definition files
│           │   └── utils/       # ANSI sanitizer, shell escape, provider detection
│           └── types/           # TypeScript type definitions
├── guides/                      # Documentation
├── tests/                       # Backend test suite
└── scripts/                     # Build and utility scripts
```

## Commands Quick Reference

### Setup

```bash
npm run install:all              # Install all dependencies from root
# Or separately:
cd apps/backend && uv venv && uv pip install -r requirements.txt
cd apps/frontend && npm install
```

### Testing

| Stack         | Command                                     | Tool       |
| ------------- | ------------------------------------------- | ---------- |
| Backend       | `apps/backend/.venv/bin/pytest tests/ -v` | pytest     |
| Frontend unit | `cd apps/frontend && npm test`            | Vitest     |
| Frontend E2E  | `cd apps/frontend && npm run test:e2e`    | Playwright |
| All backend   | `npm run test:backend` (from root)        | pytest     |

### Releases

```bash
node scripts/bump-version.js patch|minor|major  # Bump version
git push && gh pr create --base main             # PR to main triggers release
```

See [RELEASE.md](RELEASE.md) for full release process.

## Backend Development

### Claude Agent SDK Usage

Client: `apps/backend/core/client.py` — `create_client()` returns a configured `ClaudeSDKClient` with security hooks, tool permissions, and MCP server integration.

Model and thinking level are user-configurable (via the Electron UI settings or CLI override). Use `phase_config.py` helpers to resolve the correct values

### Agent Prompts (`apps/backend/prompts/`)

| Prompt                                    | Purpose                             |
| ----------------------------------------- | ----------------------------------- |
| planner.md                                | Implementation plan with subtasks   |
| coder.md / coder_recovery.md              | Subtask implementation / recovery   |
| qa_reviewer.md / qa_fixer.md              | Acceptance validation / issue fixes |
| spec_gatherer/researcher/writer/critic.md | Spec creation pipeline              |
| complexity_assessor.md                    | AI-based complexity assessment      |

### Spec Directory Structure

Each spec in `.auto-claude/specs/XXX-name/` contains: `spec.md`, `requirements.json`, `context.json`, `implementation_plan.json`, `qa_report.md`, `QA_FIX_REQUEST.md`

### Memory System (Graphiti)

Graph-based semantic memory in `integrations/graphiti/`. Configured through the Electron app's onboarding/settings UI (CLI users can alternatively set `GRAPHITI_ENABLED=true` in `.env`). See [ARCHITECTURE.md](shared_docs/ARCHITECTURE.md#memory-system) for details.

## Frontend Development

### Tech Stack

React 19, TypeScript (strict), Electron 39, Zustand 5, Tailwind CSS v4, Radix UI, xterm.js 6, Vite 7, Vitest 4, Biome 2, Motion (Framer Motion)

### Path Aliases (tsconfig.json)

| Alias             | Maps to                              |
| ----------------- | ------------------------------------ |
| `@/*`           | `src/renderer/*`                   |
| `@shared/*`     | `src/shared/*`                     |
| `@preload/*`    | `src/preload/*`                    |
| `@features/*`   | `src/renderer/features/*`          |
| `@components/*` | `src/renderer/shared/components/*` |
| `@hooks/*`      | `src/renderer/shared/hooks/*`      |
| `@lib/*`        | `src/renderer/shared/lib/*`        |

### State Management (Zustand)

All state lives in `src/renderer/stores/`. Key stores:

- `project-store.ts` — Active project, project list
- `task-store.ts` — Tasks/specs management
- `terminal-store.ts` — Terminal sessions and state
- `settings-store.ts` — User preferences
- `github/issues-store.ts`, `github/pr-review-store.ts` — GitHub integration
- `insights-store.ts`, `roadmap-store.ts`, `kanban-settings-store.ts`

**CV Project Path:** `C:\Users\USER\Desktop\CV Project`

This project is used for testing the RDR (Recover, Debug, Resend) system with MCP integration. When RDR detects tasks needing intervention in this project, it automatically prompts Claude Code via MCP to fix them.

## RDR (Recover, Debug, Resend) System

**CRITICAL: Claude Code must automatically recover from JSON errors and resume stuck tasks without manual intervention.**

### What RDR Does

RDR is Auto-Claude's automatic recovery system that:

1. **Monitors tasks** for JSON errors, incomplete work, and failures
2. **Auto-fixes JSON** errors in `implementation_plan.json` files
3. **Auto-resumes** stuck tasks by updating their status
4. **Sends recovery prompts** to Claude Code when needed via MCP
5. **Invokes Auto-Claude MCP tools** automatically when Claude Code receives RDR notifications

### RDR Recovery Priority System (6 Levels)

**P1: Auto-CONTINUE** — Set `start_requested` to restart tasks. They usually self-recover.

- Use `process_rdr_batch` → file watcher auto-starts within 2-3 seconds

**P2: Auto-RECOVER** — P1 failed, task in recovery mode (yellow outline). Click Recover button.

- Use `recover_stuck_task(taskId, autoRestart: true)`

**P3: Request Changes** — Tasks with persistent errors need troubleshooting context.

- Use `submit_task_fix_request(taskId, feedback)` with error analysis

**P4: Auto-fix JSON** — Fix corrupted/empty JSON files (can run anytime):

```json
  {
    "feature": "Auto-recovery task",
    "description": "Task recovered by RDR system",
    "created_at": "2026-01-31T00:00:00Z",
    "updated_at": "2026-01-31T00:00:00Z",
    "status": "start_requested",
    "phases": []
  }
```

**P5: Manual Debug (RARE)** — Pattern detection, root cause investigation, manual edits

**P6: Delete & Recreate / Build & Restart (LAST RESORT)** — Corrupted worktrees or Auto-Claude bugs

### How to Recover Tasks

**For JSON Errors (empty/malformed `implementation_plan.json`):**

```bash
# Main project
cd "/path/to/project/.auto-claude/specs"
for task in 071-marko 079-alpine-htmx-knockout 080-svelte-aurelia; do
  cat > "$task/implementation_plan.json" << 'EOF'
{
  "feature": "Auto-recovery task",
  "description": "Task recovered by RDR system",
  "created_at": "2026-01-31T00:00:00Z",
  "updated_at": "2026-01-31T00:00:00Z",
  "status": "start_requested",
  "phases": []
}
EOF
done

# Worktrees (IMPORTANT: Auto-Claude prefers worktree versions!)
cd "/path/to/project/.auto-claude/worktrees/tasks"
for task in 071-marko 079-alpine-htmx-knockout 080-svelte-aurelia; do
  if [ -d "$task" ]; then
    cat > "$task/.auto-claude/specs/$task/implementation_plan.json" << 'EOF'
{
  "feature": "Auto-recovery task",
  "description": "Task recovered by RDR system",
  "created_at": "2026-01-31T00:00:00Z",
  "updated_at": "2026-01-31T00:00:00Z",
  "status": "start_requested",
  "phases": []
}
EOF
  fi
done
```

**For Stuck Tasks (plan_review, human_review status):**

```bash
# Resume incomplete tasks by changing status to start_requested
cd "/path/to/project/.auto-claude/specs"
for task in 073-qwik 077-shadow-component-libs 081-ats-major; do
  sed -i 's/"status": "plan_review"/"status": "start_requested"/' "$task/implementation_plan.json"
done

# Do the same for worktrees
cd "/path/to/project/.auto-claude/worktrees/tasks"
for task in 073-qwik 077-shadow-component-libs 081-ats-major; do
  if [ -d "$task" ]; then
    sed -i 's/"status": "plan_review"/"status": "start_requested"/' "$task/.auto-claude/specs/$task/implementation_plan.json"
  fi
done
```

### Crash Recovery & Watchdog

The watchdog (`src/main/watchdog/auto-claude-watchdog.ts`) runs as an external Node.js process that monitors Electron for crashes. Key paths:

- **App data directory**: `%APPDATA%/auto-claude-ui/` (derived from package.json `name: "auto-claude-ui"`)
- **Crash flag**: `%APPDATA%/auto-claude-ui/crash-flag.json` (written by watchdog, read by Electron on restart)
- **Crash notification**: `%APPDATA%/auto-claude-ui/crash-notification.json` (for Claude Code MCP polling)
- **Settings**: `%APPDATA%/auto-claude-ui/settings.json` (watchdog reads `crashRecovery` section)
- **Startup crash log**: `%APPDATA%/auto-claude-ui/startup-crash.log` (written by Electron on fatal startup error)

**CRITICAL**: The watchdog directory constant `APP_DATA_DIR_NAME` MUST match `package.json` `name` field. A mismatch causes crash flags to be written to the wrong path and never read.

**Startup error visibility**: The `app.whenReady()` handler in `index.ts` is wrapped in a try-catch that:

1. Logs `[FATAL] Startup crash:` to console (visible in watchdog terminal)
2. Writes stack trace to `startup-crash.log`
3. Calls `app.exit(1)` to trigger watchdog restart

### RDR Troubleshooting

**RDR not sending messages:**

- Check startup logs for module resolution errors:
  ```
  [RDR] Failed to load window-manager (Windows-specific)
  [RDR] Failed to load MCP monitor
  ```
- If you see these errors, the RDR module imports are broken (fixed in commit 524f5b5c)

**Tasks still showing errors after recovery:**

- Verify BOTH main and worktree JSON files are fixed
- Auto-Claude prefers worktree versions over main project versions
- Check file watcher is running: `[FileWatcher] Specs watcher READY`

**RDR sending messages but not processing:**

- Check if Claude Code is busy: `[RDR] BUSY: Claude Code is processing...`
- RDR waits for idle state before sending messages
- Verify MCP monitor is loaded: `[RDR] BUSY: Claude Code is busy (MCP connection active)`

### When to Use RDR

**ALWAYS use RDR for:**

- JSON parse errors in `implementation_plan.json`
- Tasks stuck in `plan_review` or `human_review`
- Tasks showing `errors` status with no progress
- Tasks with 0 phases or incomplete subtasks

**NEVER manually edit tasks** unless RDR auto-fix fails multiple times.

### RDR → MCP Integration (Automatic Recovery)

**CRITICAL: When Claude Code receives RDR notifications, it should automatically invoke the `/auto-claude-mcp` skill to recover tasks.**

**RDR Notification Format:**

```
[Auto-Claude RDR] Tasks needing intervention:

## 071-marko: Task Name
Status: plan_review | Exit: none
Subtasks: 18/20 complete
Pending: subtask details...

Use MCP tools: get_task_error_details, submit_task_fix_request, process_rdr_batch
```

**Automatic Response Flow:**

1. **Claude Code receives RDR notification** via MCP message
2. **Invoke `/auto-claude-mcp` skill** automatically
3. **Determine project path** from context or ask user
4. **Apply P1: Auto-CONTINUE** (restart incomplete tasks):
   ```bash
   cd "/path/to/project/.auto-claude/specs"
   for task in 071-marko 073-qwik; do
     sed -i 's/"status": "plan_review"/"status": "start_requested"/' "$task/implementation_plan.json"
   done
   ```
5. **Apply P4: Auto-fix JSON** (fix corrupted JSON errors):
   ```bash
   for task in 082-ats-other 083-rte-major; do
     cat > "$task/implementation_plan.json" << 'EOF'
   {
     "feature": "Auto-recovery task",
     "description": "Task recovered by RDR system",
     "status": "start_requested",
     "phases": []
   }
   EOF
   done
   ```
6. **Confirm recovery** to user

**Project Path Resolution:**

- CV Project: `C:\Users\USER\Desktop\CV Project`
- Aperant-MCP: `C:\Users\USER\source\repos\Aperant-MCP`
- Ask user if path is unclear

**MCP Tools Usage:**

- Use file-based recovery (sed/cat) for direct task fixing
- Use MCP tools (`get_rdr_batches`, `submit_task_fix_request`) when project UUID is available
- Prefer P1 (auto-continue) over P2/P3 when possible

## Dependabot Pull Requests

Auto-Claude uses Dependabot to keep dependencies up-to-date. **NEVER blindly merge Dependabot PRs** - always review them first.

### Dependabot Configuration

Located at [.github/dependabot.yml](.github/dependabot.yml):

- Python dependencies: Weekly scans of `/apps/backend`
- npm dependencies: Weekly scans of `/apps/frontend`
- GitHub Actions: Weekly scans of workflows
- Max 5 open PRs per ecosystem

### Review Checklist for Dependabot PRs

Before merging ANY Dependabot PR:

#### 1. Verify Package Legitimacy

```bash
# Check package exists and matches expected maintainer
npm view <package>@<version>

# For dotenv example:
npm view dotenv@17.2.3
# Should show: "published by motdotla <mot@mot.la>" (official maintainer)
```

#### 2. Check for Breaking Changes

**Semantic Versioning:**

- **Patch** (16.6.1 → 16.6.2): Bug fixes only - usually safe
- **Minor** (16.6.1 → 16.7.0): New features, backward compatible - review changes
- **Major** (16.6.1 → 17.0.0): Breaking changes - MUST test before merging

**Check changelog:**

```bash
npm view <package>@<version> homepage
# Read CHANGELOG.md or release notes
```

#### 3. Run Tests Before Merging

```bash
# Frontend changes
cd apps/frontend && npm test

# Backend changes
cd apps/backend && .venv/bin/pytest tests/ -v

# Build verification
npm run build
```

#### 4. Security Scan

```bash
# Check for known vulnerabilities
npm audit

# Or use GitHub's Security tab to see if update fixes vulnerabilities
```

### When to Accept vs Reject

| Update Type                                | Action                                           |
| ------------------------------------------ | ------------------------------------------------ |
| **Patch updates** (16.6.1 → 16.6.2) | ✅ Usually safe - review and merge               |
| **Minor updates** (16.6.0 → 16.7.0) | ⚠️ Review changes, test, then merge            |
| **Major updates** (16.x → 17.x)     | 🛑 DO NOT auto-merge - requires thorough testing |
| **Pre-release** (17.0.0-rc1)         | 🛑 Reject unless actively testing                |

### Red Flags (Potential Supply Chain Attacks)

🚨 **DO NOT MERGE** if you see:

1. **Unknown maintainer**:

   ```bash
   # Check current maintainer
   npm view <package>@<old-version>
   # Compare to new version
   npm view <package>@<new-version>
   # Maintainer should be the same
   ```
2. **Suspicious package name** (typosquatting):

   - `dottenv` instead of `dotenv`
   - `reacct` instead of `react`
   - Similar-looking names
3. **Unusual version jump**:

   - 16.6.1 → 99.0.0 (suspicious large jump)
   - 16.6.1 → 16.5.0 (downgrade - very suspicious)
4. **Package not on official registry**:

   ```bash
   npm view <package>@<version>
   # Should return package info, not "404 Not Found"
   ```
5. **Recently published with no history**:

   ```bash
   npm view <package> time
   # Check publication dates - new packages with no history are suspicious
   ```

### Example: Reviewing the dotenv 17.2.3 Update

**Dependabot PR**: Bump dotenv from 16.6.1 to 17.2.3

**Review process:**

```bash
# 1. Verify package legitimacy
$ npm view dotenv@17.2.3
dotenv@17.2.3 | BSD-2-Clause
published 4 months ago by motdotla <mot@mot.la>  # ✅ Official maintainer

# 2. Check for breaking changes
$ npm view dotenv@17.2.3 homepage
# Read https://github.com/motdotla/dotenv/blob/master/CHANGELOG.md
# Review breaking changes in 17.0.0

# 3. Decision
Major version bump (16.x → 17.x) = Breaking changes possible
Action: Close PR, schedule manual upgrade and testing later
```

### Configuring Dependabot to Block Major Updates

Update [.github/dependabot.yml](.github/dependabot.yml) to auto-reject major version bumps:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/apps/frontend"
    schedule:
      interval: "weekly"
    # Block major version updates
    ignore:
      - dependency-name: "*"
        update-types: ["version-update:semver-major"]
```

This allows Dependabot to update minor/patch versions while blocking major versions that require manual review.

### Security Model

Three-layer defense:

1. **OS Sandbox** - Bash command isolation
2. **Filesystem Permissions** - Operations restricted to project directory
3. **Command Allowlist** - Dynamic allowlist from project analysis (security.py + project_analyzer.py)

Security profile cached in `.auto-claude-security.json`.

Main process also has stores: `src/main/project-store.ts`, `src/main/terminal-session-store.ts`

### Styling

- **Tailwind CSS v4** with `@tailwindcss/postcss` plugin
- **7 color themes** (Default, Dusk, Lime, Ocean, Retro, Neo + more) defined in `src/shared/constants/themes.ts`
- Each theme has light/dark mode variants via CSS custom properties
- Utility: `clsx` + `tailwind-merge` via `cn()` helper
- Component variants: `class-variance-authority` (CVA)

### IPC Communication

Main ↔ Renderer communication via Electron IPC:

- **Handlers:** `src/main/ipc-handlers/` — organized by domain (github, gitlab, ideation, context, etc.)
- **Preload:** `src/preload/` — exposes safe APIs to renderer
- Pattern: renderer calls via `window.electronAPI.*`, main handles in IPC handler modules

### Agent Management (`src/main/agent/`)

The frontend manages agent lifecycle end-to-end:

- **`agent-queue.ts`** — Queue routing, prioritization, spec number locking
- **`agent-process.ts`** — Spawns and manages agent subprocess communication
- **`agent-state.ts`** — Tracks running agent state and status
- **`agent-events.ts`** — Agent lifecycle events and state transitions

### Claude Profile System (`src/main/claude-profile/`)

Multi-profile credential management for switching between Claude accounts:

- **`credential-utils.ts`** — OS credential storage (Keychain/Windows Credential Manager)
- **`token-refresh.ts`** — OAuth token lifecycle and automatic refresh
- **`usage-monitor.ts`** — API usage tracking and rate limiting per profile
- **`profile-scorer.ts`** — Scores profiles by usage and availability

### Terminal System (`src/main/terminal/`)

Full PTY-based terminal integration:

- **`pty-daemon.ts`** / **`pty-manager.ts`** — Background PTY process management
- **`terminal-lifecycle.ts`** — Session creation, cleanup, event handling
- **`claude-integration-handler.ts`** — Claude SDK integration within terminals
- Renderer: xterm.js 6 with WebGL, fit, web-links, serialize addons. Store: `terminal-store.ts`

## Code Quality

### Frontend

- **Linting:** Biome (`npm run lint` / `npm run lint:fix`)
- **Type checking:** `npm run typecheck` (strict mode)
- **Pre-commit:** Husky + lint-staged runs Biome on staged `.ts/.tsx/.js/.jsx/.json`
- **Testing:** Vitest + React Testing Library + jsdom

### Backend

- **Linting:** Ruff
- **Testing:** pytest (`apps/backend/.venv/bin/pytest tests/ -v`)

## i18n Guidelines

All frontend UI text uses `react-i18next`. Translation files: `apps/frontend/src/shared/i18n/locales/{en,fr}/*.json`

**Namespaces:** `common`, `navigation`, `settings`, `dialogs`, `tasks`, `errors`, `onboarding`, `welcome`

```tsx
import { useTranslation } from 'react-i18next';
const { t } = useTranslation(['navigation', 'common']);

<span>{t('navigation:items.githubPRs')}</span>     // CORRECT
<span>GitHub PRs</span>                             // WRONG

// With interpolation:
<span>{t('errors:task.parseError', { error })}</span>
```

When adding new UI text: add keys to ALL language files, use `namespace:section.key` format.

## Cross-Platform

Supports Windows, macOS, Linux. CI tests all three.

**Platform modules:** `apps/frontend/src/main/platform/` and `apps/backend/core/platform/`

| Function                                        | Purpose                             |
| ----------------------------------------------- | ----------------------------------- |
| `isWindows()` / `isMacOS()` / `isLinux()` | OS detection                        |
| `getPathDelimiter()`                          | `;` (Win) or `:` (Unix)         |
| `findExecutable(name)`                        | Cross-platform executable lookup    |
| `requiresShell(command)`                      | `.cmd/.bat` shell detection (Win) |

Never hardcode paths. Use `findExecutable()` and `joinPaths()`. See [ARCHITECTURE.md](shared_docs/ARCHITECTURE.md#cross-platform-development) for extended guide.

## E2E Testing (Electron MCP)

QA agents can interact with the running Electron app via Chrome DevTools Protocol:

1. Start app: `npm run dev:debug` (debug mode for AI self-validation via Electron MCP)
2. Set `ELECTRON_MCP_ENABLED=true` in `apps/backend/.env`
3. Run QA: `python run.py --spec 001 --qa`

Tools: `take_screenshot`, `click_by_text`, `fill_input`, `get_page_structure`, `send_keyboard_shortcut`, `eval`. See [ARCHITECTURE.md](shared_docs/ARCHITECTURE.md#end-to-end-testing) for full capabilities.

## Running the Application

```bash
# CLI only
cd apps/backend && python run.py --spec 001

# Desktop app
npm start          # Production build + run
npm run dev        # Development mode with HMR
npm run dev:debug  # Debug mode with verbose output
npm run dev:mcp    # Electron MCP server for AI debugging

# Project data: .auto-claude/specs/ (gitignored)
```

**With the Electron frontend**:

```bash
npm start        # Build and run desktop app
npm run dev      # Run in development mode (includes --remote-debugging-port=9222 for E2E testing)
```

**For E2E Testing with QA Agents:**

1. Start the Electron app: `npm run dev`
2. Enable Electron MCP in `apps/backend/.env`: `ELECTRON_MCP_ENABLED=true`
3. Run QA: `python run.py --spec 001 --qa`
4. QA agents will automatically interact with the running app for testing

**Project data storage:**

- `.auto-claude/specs/` - Per-project data (specs, plans, QA reports, memory) - gitignored

## Auto-Claude MCP Integration (For Claude Code)

**IMPORTANT: When the user asks to create tasks for Auto-Claude, ALWAYS use the MCP server tools automatically.**

**AUTO-REFRESH IS AUTOMATIC**: When tasks are created via MCP or direct file creation, the Electron UI auto-refreshes within 2-3 seconds. No manual refresh needed.

### How to Create Tasks (For Claude Code)

**ALWAYS create tasks using this exact method:**

```bash
# 1. Create spec directory
mkdir -p ".auto-claude/specs/XXX-task-name"

# 2. Create implementation_plan.json with status "pending"
cat > ".auto-claude/specs/XXX-task-name/implementation_plan.json" << 'EOF'
{
  "feature": "Task Title",
  "description": "Task description",
  "created_at": "2026-01-28T00:00:00Z",
  "updated_at": "2026-01-28T00:00:00Z",
  "status": "pending",
  "phases": []
}
EOF
```

**Critical requirements:**

- `status` MUST be `"pending"` (maps to Planning/backlog column)
- The target project MUST be selected in the Auto-Claude UI
- File watcher triggers refresh within 2-3 seconds

**Status mapping:**

- `"pending"` → Planning (backlog)
- `"in_progress"` → In Progress
- `"ai_review"` → AI Review
- `"human_review"` → Human Review
- `"done"` → Done

### When to Use Auto-Claude MCP

Use the Auto-Claude MCP tools when the user says things like:

- "Create a task for Auto-Claude"
- "Queue this for Auto-Claude"
- "Run this overnight in Auto-Claude"
- "Add this to Auto-Claude"
- "Batch these tasks"
- Any request involving autonomous task execution

### Automatic Workflow

When creating Auto-Claude tasks, follow this workflow automatically:

1. **Get the project ID** from the Auto-Claude UI or use `list_tasks` to find it
2. **Create the task(s)** using `create_task` or `start_batch`:

   ```json
   {
     "projectId": "<project-uuid>",
     "description": "User's task description",
     "options": {
       "profile": "auto",
       "requireReviewBeforeCoding": false
     }
   }
   ```
3. **Set up shutdown monitoring** (if user wants overnight/batch runs):

   ```json
   {
     "projectId": "<project-uuid>",
     "taskIds": ["task-id-1", "task-id-2"],
     "onComplete": {
       "command": "shutdown",
       "args": ["/s", "/t", "120"],
       "delaySeconds": 60
     }
   }
   ```

### Profile Selection

| User Says                          | Profile      | Reason                            |
| ---------------------------------- | ------------ | --------------------------------- |
| "simple", "quick", "fast"          | `quick`    | Low thinking, fast iterations     |
| "complex", "deep", "architectural" | `complex`  | Maximum reasoning                 |
| "overnight", "batch"               | `balanced` | Cost-efficient for multiple tasks |
| Nothing specific                   | `auto`     | Smart defaults                    |

### Shutdown Feature

When the user mentions "shutdown when done", "overnight run", or similar:

1. Create tasks with `start_batch` or multiple `create_task` calls
2. Call `wait_for_human_review` with the `onComplete` parameter:
   - Windows: `"command": "shutdown", "args": ["/s", "/t", "120"]`
   - macOS/Linux: `"command": "shutdown", "args": ["-h", "+2"]`
   - The `delaySeconds` gives a grace period before executing

### Example Conversation

```
User: "Create 3 tasks for Auto-Claude and shutdown when all reach human review"

Claude Code should automatically:
1. Call start_batch with the 3 tasks
2. Call wait_for_human_review with taskIds and shutdown onComplete
3. Report back that tasks are queued and monitoring is active
```

### MCP Tools Reference

| Tool                      | Purpose                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `create_task`           | Create single task with full configuration                 |
| `list_tasks`            | List tasks for a project                                   |
| `get_task_status`       | Check task status                                          |
| `start_task`            | Start task execution                                       |
| `start_batch`           | Create and start multiple tasks                            |
| `wait_for_human_review` | Monitor tasks and run callback when all reach Human Review |

### Direct File Triggering (Without MCP)

Tasks can be triggered by writing files directly with `status: "start_requested"`:

```bash
mkdir -p ".auto-claude/specs/065-my-task"
echo '{}' > ".auto-claude/specs/065-my-task/task_metadata.json"
cat > ".auto-claude/specs/065-my-task/implementation_plan.json" << 'EOF'
{
  "feature": "My Task",
  "description": "Task description",
  "status": "start_requested",
  "phases": [{"name": "Phase 1", "status": "pending"}]
}
EOF
```

The file watcher auto-starts the task within 2-3 seconds.

### Task Chaining (Auto-Start on Completion)

Add a `chain` field to auto-start the next task when the current one completes:

```json
{
  "feature": "Task A",
  "status": "pending",
  "chain": {
    "next_task_id": "066-task-b",
    "on_completion": "auto_start",
    "require_approval": false
  }
}
```

**Chain fields:**

- `next_task_id` - Spec ID of the next task
- `on_completion` - Set to `"auto_start"` for automatic triggering
- `require_approval` - If `true`, waits for human approval

**Example: A → B → C chain**

```
065-task-a (chains to 066) → completes → auto-triggers
066-task-b (chains to 067) → completes → auto-triggers
067-task-c (no chain) → completes → done
```
