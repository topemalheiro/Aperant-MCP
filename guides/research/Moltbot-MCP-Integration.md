# Moltbot (Formerly Clawdbot) - MCP Integration Research

## Overview

**Moltbot** (formerly **Clawdbot**) is a self-hosted AI assistant created by Peter Steinberger (@steipete), founder of PSPDFKit. It's essentially "Claude with hands" - an AI agent that doesn't just chat, but performs actions.

- **GitHub**: https://github.com/moltbot/moltbot
- **Stars**: 60,000+ (one of the fastest-growing open-source projects ever)
- **Launch**: Late 2025
- **Rebranding**: January 27, 2026 (Anthropic C&D for trademark "Claude")

## Key Features

| Feature | Description |
|---------|-------------|
| **Persistent Memory** | Context maintained across conversations |
| **Full System Access** | Shell, browser, files |
| **Proactive Notifications** | Can initiate messages based on triggers/schedules |
| **50+ Integrations** | WhatsApp, Telegram, Slack, iMessage, Signal, Discord |
| **MCP Server Support** | Can be called from Claude Code and other tools |
| **Skills System** | Extensible via modular "skills" |

## MCP Server Integration

- **PR #1605**: Added MCP server support - https://github.com/moltbot/moltbot/pull/1605
- Tested primarily from **Claude Code**
- Uses "mcporter skill" for token-efficient MCP usage
- Creator's stance: "Most MCPs are useless and CLIs are better alternatives"

### Awesome Moltbot Skills

Repository: https://github.com/VoltAgent/awesome-moltbot-skills

Skills extend Moltbot's capabilities:
- Interact with external services
- Automate workflows
- Perform specialized tasks

## Comparison: Auto-Claude MCP vs Moltbot

| Aspect | Auto-Claude MCP | Moltbot MCP |
|--------|-----------------|-------------|
| **Purpose** | Task orchestration for coding | General AI assistant |
| **Architecture** | File-based triggers + IPC | Direct command execution |
| **Extension Model** | Electron + Python agents | Skills system |
| **Integration** | Standalone MCP server | Built-in MCP support |
| **Trigger Mechanism** | `start_requested` status in JSON | Direct API calls |
| **Memory** | Graphiti knowledge graph | Built-in persistent memory |

## Auto-Claude MCP Implementation

### Current Tools

| Tool | Description |
|------|-------------|
| `create_task` | Create task with models, thinking, review settings |
| `list_tasks` | List all tasks for a project |
| `get_task_status` | Get detailed task status |
| `start_task` | Start task execution (via file watcher) |
| `start_batch` | Create multiple tasks at once |
| `wait_for_human_review` | Wait for completion + optional shutdown |

### Architecture

```
┌──────────────┐       MCP Protocol        ┌──────────────────────┐
│ Claude Code  │ ◄────────────────────────► │ Auto-Claude MCP     │
│ (or any MCP  │   create_task, start_task │ Server (TypeScript)  │
│  client)     │   get_status, wait_done   │                      │
└──────────────┘                           └──────────┬───────────┘
                                                      │ File System
                                                      ▼
                                           ┌──────────────────────┐
                                           │ Electron App         │
                                           │ (File Watcher)       │
                                           └──────────────────────┘
```

### Key Difference from Moltbot

Auto-Claude MCP uses a **file-based trigger system**:

1. MCP server writes `status: "start_requested"` to `implementation_plan.json`
2. Electron file watcher detects change
3. File watcher emits `task-start-requested` event
4. Agent events handler triggers task execution via IPC

This decouples the MCP server from the Electron app, allowing:
- Standalone MCP server operation
- No direct IPC dependency
- Works even when Electron is restarted

## Potential Improvements (Inspired by Moltbot)

### 1. Skills-like Architecture

Create modular "skills" for Auto-Claude tools:
```
apps/frontend/src/main/mcp-server/skills/
├── create-task.skill.ts
├── batch-operations.skill.ts
├── monitoring.skill.ts
└── integrations/
    ├── github.skill.ts
    ├── linear.skill.ts
    └── notifications.skill.ts
```

### 2. Messaging Platform Integration

Add notification support for task completion:
- Telegram bot notifications
- Discord webhooks
- Slack integration

### 3. Persistent Memory Enhancement

Leverage Graphiti more deeply:
- Store task patterns and preferences
- Learn from successful task configurations
- Suggest optimal profiles based on history

## Security Considerations

Moltbot faced prompt injection vulnerabilities. Auto-Claude should:

1. **Sandbox task execution** in isolated worktrees
2. **Validate all MCP inputs** with Zod schemas
3. **Limit file system access** to project directories
4. **Audit command execution** in agent sessions

## Sources

- [Moltbot MCP Server PR #1605](https://github.com/moltbot/moltbot/pull/1605)
- [Awesome Moltbot Skills](https://github.com/VoltAgent/awesome-moltbot-skills)
- [Moltbot Guide 2026](https://dev.to/czmilo/moltbot-the-ultimate-personal-ai-assistant-guide-for-2026-d4e)
- [What is Clawdbot/Moltbot - Medium](https://medium.com/@tahirbalarabe2/what-is-clawdbot-moltbot-3a9a373c7b0d)
- [Clawdbot Viral Rise - Medium](https://medium.com/@gwrx2005/clawdbot-moltybot-a-self-hosted-personal-ai-assistant-and-its-viral-rise-520427c6ef4f)
- [MacStories - Future of Personal AI](https://www.macstories.net/stories/clawdbot-showed-me-what-the-future-of-personal-ai-assistants-looks-like/)

---

*Research conducted: 2026-01-28*
*For: Auto-Claude MCP Integration*
