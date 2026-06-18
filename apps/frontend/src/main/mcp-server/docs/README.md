# Aperant-MCP MCP development fork

[![License](https://img.shields.io/badge/license-AGPL--3.0-green?style=flat-square)](./agpl-3.0.txt)
[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/KCXaPBr4Dj)
[![YouTube](https://img.shields.io/badge/YouTube-Subscribe-FF0000?style=flat-square&logo=youtube&logoColor=white)](https://www.youtube.com/@AndreMikalsen)
[![CI](https://img.shields.io/github/actions/workflow/status/AndyMik90/Auto-Claude/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/AndyMik90/Auto-Claude/actions)
[![Mentioned in Awesome Claude Code](https://awesome.re/mentioned-badge-flat.svg)](https://github.com/hesreallyhim/awesome-claude-code)

# Most recent features are in develop branch! (still debugging, Main is stable)

## **To get the 'Master LLM' working properly through the MCP, either with RDR or general MCP usage, you'll need to copy the folders inside the skills folder in .claude to your personal \.claude\skills folder.**

Fork of [Auto-Claude](https://github.com/AndyMik90/Auto-Claude) with a custom MCP system, automatic recovery, and infrastructure for autonomous overnight batch runs. I added **22,000+ lines** across 114 files on top of main.

**Brief Summary:**
You can automatically orchestrate and/or troubleshoot your tasks done by LLMs with a master LLM chat through the MCP, sort of like a manager chat. It can work 24/7, with Auto Resume on session limit reset, and has an Auto Shutdown feature to shut down your computer when all tasks are done.

You can make the master LLM create batches of auto-started tasks (use start_requested status on creation to daisy chain, or at prompt end) with prompt inputs, as well as further develop the MCP to improve its maneuverability.

**This is a great tool for building dynamic pipelines and further automating your agentic workflows.**

> **Note:** The MCP server and all task management tools are standard MCP protocol and work with any MCP client. The RDR message **delivery pipeline** (how recovery prompts physically reach the the master LLM that enacts on the MCP) currently targets: **Windows** (PowerShell + Win32 API for clipboard paste + keyboard simulation), **VS Code** (process-level window detection, not extension-specific), and **Claude Code** (JSONL transcript reading for busy-state). The delivery is blind "focus window, paste, enter" — it works when the target chat input is focused but is not tied to any extension API. Each layer can be swapped independently. Contributions for macOS/Linux, other VS Code forks (Cursor, etc.), or other LLM CLIs are welcome. See also [Watchdog Process](#watchdog-process) for OS-specific launcher requirements.

## What This Fork Adds

### MCP Server (Claude Code Integration)

A full MCP (Model Context Protocol) server that lets Claude Code interact with Auto-Claude directly. Create, manage, monitor, and recover tasks programmatically instead of through the UI.


**21 MCP Tools:**

| Tool                               | Purpose                                                        |
| ---------------------------------- | -------------------------------------------------------------- |
| `assign_window`                  | Register a VS Code: window as the master LLM target for RDR    |
| `associate_project_desktop`      | Associate a project with the current virtual desktop           |
| `open_project`                   | Open/register a project folder for MCP task management         |
| `set_auto_resume_after_rate_limit` | Toggle project-level auto-resume after rate limit              |
| `set_rdr_enabled`                | Toggle project-level RDR monitoring                            |
| `create_task`                    | Create a single task with full configuration                   |
| `list_tasks`                     | List all tasks, filterable by status                           |
| `get_task_status`                | Detailed status including phase/subtask progress               |
| `start_task`                     | Start task execution                                           |
| `start_batch`                    | Create and start multiple tasks at once                        |
| `wait_for_human_review`          | Monitor tasks, execute callback (e.g., shutdown) when complete |
| `get_tasks_needing_intervention` | Get all tasks needing recovery                                 |
| `get_task_error_details`         | Detailed error info with logs and QA reports                   |
| `recover_stuck_task`             | Recover tasks stuck in recovery mode                           |
| `submit_task_fix_request`        | Submit fix guidance for failing tasks                          |
| `get_task_logs`                  | Phase-specific logs (planning, coding, validation)             |
| `get_rdr_batches`                | Get pending recovery batches by problem type                   |
| `process_rdr_batch`              | Process a batch of tasks through the recovery system           |
| `trigger_auto_restart`           | Restart app with build on crash/error detection                |
| `test_force_recovery`            | Force tasks into recovery mode for testing                     |
| `defer_task`                     | Park a broken task on the Queue board with RDR disabled        |

### RDR System (Recover, Debug, Resend)

Automatic 6-priority recovery system that detects stuck/failed tasks and sends a detailed prompt to the Master LLM through the MCP system so it acts on the tasks:

| Priority | Name              | When                     | Action                                          |
| -------- | ----------------- | ------------------------ | ----------------------------------------------- |
| P1       | Auto-CONTINUE     | Default (95% of cases)   | Sets `start_requested`, task self-recovers    |
| P2       | Auto-RECOVER      | Task in recovery mode    | Clears stuck state, restarts                    |
| P3       | Request Changes   | P1 failed 3+ times       | Writes detailed fix request with error analysis |
| P4       | Auto-fix JSON     | Corrupted plan files     | Rebuilds valid JSON structure                   |
| P5       | Manual Debug      | Pattern detection needed | Root cause investigation                        |
| P6       | Delete & Recreate or Change AC code and Rebuild | Last resort              | Delete the task and recreate or Change AC code and rebuild if the case                    |

Automatic escalation: tasks that enter Recovery become P2, then P3 after 3 attempts on P1 scaling up to P6B. Attempt counters reset on app startup.

### Auto-Shutdown Monitor

Monitors all running tasks and automatically shuts down the computer when all tasks reach completion. Start X number of tasks, go to sleep, computer powers off when done.

- Status-based completion detection (`done` / `pr_created` / `human_review`)
- Worktree-aware (reads real progress, not stale main copies)
- Configurable via UI toggle or MCP `wait_for_human_review` tool

### Auto-Refresh (Real-Time UI Updates)

File watcher detects all plan status changes and pushes updates to the Kanban board in real-time (~1 second). No manual refresh needed when MCP tools modify task files.

### Task Chaining (CI/CD-Style Pipelines)

Chain tasks to auto-start sequentially on task creation with the status start_requested on tasks:

```
Task A (creates and starts) --> Task B (creates and starts) --> Task C (creates and starts)
```

Configurable per-task with optional human approval gates between steps.

### Output Monitor

Monitors Claude Code session state via JSONL transcripts. Distinguishes between user sessions and task agent sessions to prevent false busy-state detection.

### Watchdog Process

External wrapper process that monitors Auto-Claude health, detects crashes, and can auto-restart. It spawns Electron as a child process and watches it from outside. The watchdog does **not** run when launching the app directly (`.exe`, `npm run dev`).

<details>
<summary><strong>Quick Setup (Windows)</strong></summary>

1. Rename `Aperant-MCP.example.bat` to `Aperant-MCP.bat`
2. Edit the path in the `.bat` to point to your install directory:
   ```bat
   set AUTO_CLAUDE_DIR=C:\Users\YourName\path\to\Aperant-MCP
   ```
3. Double-click the `.bat` to launch with watchdog
4. **Optional — pin to taskbar:** Create a shortcut with target:
   ```
   cmd.exe /c "C:\Users\YourName\path\to\Aperant-MCP\Aperant-MCP.bat"
   ```
   Then right-click the shortcut → Pin to taskbar. You can set the icon to `apps\frontend\resources\icon.ico` from the repo.

</details>

<details>
<summary><strong>Quick Setup (macOS/Linux)</strong></summary>

Create a shell script equivalent (e.g. `auto-claude-mcp.sh`):
```bash
#!/bin/bash
cd "$(dirname "$0")/apps/frontend"
echo "Starting Auto-Claude with crash recovery watchdog..."
npx tsx src/main/watchdog/launcher.ts ../../node_modules/.bin/electron out/main/index.js
```
Make it executable: `chmod +x auto-claude-mcp.sh`

</details>

### Window Manager (Windows)

PowerShell-based message delivery that sends RDR recovery prompts directly to Claude Code's terminal via clipboard paste. Handles VS Code window detection, focus management, and busy-state checking.

### Additional Features

- **Crash Recovery** - Automatic recovery from app crashes with state preservation
- **Graceful Restart** - Clean restart with build when errors detected
- **Rate Limit Handling** - Detection and intelligent waiting for API rate limits
- **HuggingFace Integration** - OAuth flow and repository management
- **Worktree-Aware Architecture** - All subsystems prefer worktree data over stale main project data

---

**Autonomous multi-agent coding framework that plans, builds, and validates software for you. Check the original repo:** https://github.com/AndyMik90/Auto-Claude

![Aperant-MCP Kanban Board](.github/assets/Auto-Claude-Kanban.png)

### Stable Release

<!-- STABLE_VERSION_BADGE -->
[![Stable](https://img.shields.io/badge/stable-2.7.5-blue?style=flat-square)](https://github.com/AndyMik90/Auto-Claude/releases/tag/v2.7.5)
<!-- STABLE_VERSION_BADGE_END -->

<!-- STABLE_DOWNLOADS -->
| Platform | Download |
|----------|----------|
| **Windows** | [Auto-Claude-2.7.5-win32-x64.exe](https://github.com/AndyMik90/Auto-Claude/releases/download/v2.7.5/Auto-Claude-2.7.5-win32-x64.exe) |
| **macOS (Apple Silicon)** | [Auto-Claude-2.7.5-darwin-arm64.dmg](https://github.com/AndyMik90/Auto-Claude/releases/download/v2.7.5/Auto-Claude-2.7.5-darwin-arm64.dmg) |
| **macOS (Intel)** | [Auto-Claude-2.7.5-darwin-x64.dmg](https://github.com/AndyMik90/Auto-Claude/releases/download/v2.7.5/Auto-Claude-2.7.5-darwin-x64.dmg) |
| **Linux** | [Auto-Claude-2.7.5-linux-x86_64.AppImage](https://github.com/AndyMik90/Auto-Claude/releases/download/v2.7.5/Auto-Claude-2.7.5-linux-x86_64.AppImage) |
| **Linux (Debian)** | [Auto-Claude-2.7.5-linux-amd64.deb](https://github.com/AndyMik90/Auto-Claude/releases/download/v2.7.5/Auto-Claude-2.7.5-linux-amd64.deb) |
| **Linux (Flatpak)** | [Auto-Claude-2.7.5-linux-x86_64.flatpak](https://github.com/AndyMik90/Auto-Claude/releases/download/v2.7.5/Auto-Claude-2.7.5-linux-x86_64.flatpak) |
<!-- STABLE_DOWNLOADS_END -->

### Beta Release

> ⚠️ Beta releases may contain bugs and breaking changes. [View all releases](https://github.com/AndyMik90/Auto-Claude/releases)

<!-- BETA_VERSION_BADGE -->
[![Beta](https://img.shields.io/badge/beta-2.7.6--beta.5-orange?style=flat-square)](https://github.com/AndyMik90/Auto-Claude/releases/tag/v2.7.6-beta.5)
<!-- BETA_VERSION_BADGE_END -->

<!-- BETA_DOWNLOADS -->
| Platform | Download |
|----------|----------|
| **Windows** | [Auto-Claude-2.7.6-beta.5-win32-x64.exe](https://github.com/AndyMik90/Auto-Claude/releases/download/v2.7.6-beta.5/Auto-Claude-2.7.6-beta.5-win32-x64.exe) |
| **macOS (Apple Silicon)** | [Auto-Claude-2.7.6-beta.5-darwin-arm64.dmg](https://github.com/AndyMik90/Auto-Claude/releases/download/v2.7.6-beta.5/Auto-Claude-2.7.6-beta.5-darwin-arm64.dmg) |
| **macOS (Intel)** | [Auto-Claude-2.7.6-beta.5-darwin-x64.dmg](https://github.com/AndyMik90/Auto-Claude/releases/download/v2.7.6-beta.5/Auto-Claude-2.7.6-beta.5-darwin-x64.dmg) |
| **Linux** | [Auto-Claude-2.7.6-beta.5-linux-x86_64.AppImage](https://github.com/AndyMik90/Auto-Claude/releases/download/v2.7.6-beta.5/Auto-Claude-2.7.6-beta.5-linux-x86_64.AppImage) |
| **Linux (Debian)** | [Auto-Claude-2.7.6-beta.5-linux-amd64.deb](https://github.com/AndyMik90/Auto-Claude/releases/download/v2.7.6-beta.5/Auto-Claude-2.7.6-beta.5-linux-amd64.deb) |
| **Linux (Flatpak)** | [Auto-Claude-2.7.6-beta.5-linux-x86_64.flatpak](https://github.com/AndyMik90/Auto-Claude/releases/download/v2.7.6-beta.5/Auto-Claude-2.7.6-beta.5-linux-x86_64.flatpak) |
<!-- BETA_DOWNLOADS_END -->

> All releases include SHA256 checksums and VirusTotal scan results for security verification.

---

## Requirements

- **Claude Pro/Max subscription** - [Get one here](https://claude.ai/upgrade)
- **Claude Code CLI** - `npm install -g @anthropic-ai/claude-code`
- **Git repository** - Your project must be initialized as a git repo

---

## Project Structure

```
Auto-Claude/
├── apps/
│   ├── backend/     # Python agents, specs, QA pipeline
│   └── frontend/    # Electron desktop application
├── guides/          # Additional documentation
├── tests/           # Test suite
└── scripts/         # Build utilities
```

---

## License

**AGPL-3.0** - GNU Affero General Public License v3.0

Aperant-MCP is free to use. If you modify and distribute it, or run it as a service, your code must also be open source under AGPL-3.0.

Commercial licensing available for closed-source use cases.

---
