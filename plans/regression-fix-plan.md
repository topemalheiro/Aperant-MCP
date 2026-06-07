# Regression Detection Fix Plan

## Changes Made

### File: `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts`

1. **Added `checkTaskHadMeaningfulWork()` function** - Checks if task actually ran by looking for evidence:
   - `start_requested_at` - task was started
   - `executionPhase` - agent was in a phase
   - `lastEvent` - XState processed events
   - `phases` with subtasks - agent created work items
   - `exitReason` - agent crashed/errored
   - Worktree directory exists

2. **Modified regression detection logic** - Now only fires warning when task had meaningful work

## Build Command

```bash
npm run build
```

## Testing

The fix prevents false positives when:
- User manually stops a task
- User drags task to planning board
- Task just started, no subtasks yet

Actual bugs still trigger the warning when:
- Agent runs for 10+ minutes, creates worktree/subtasks
- Agent crashes mid-coding with exitReason='error'
- Agent was in planning phase and regresses

## Push Branches

- **Private repo (origin)**: develop
- **Public repo (fork)**: develop, main, dev-next
