import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  const tools: string[] = [];
  (globalThis as unknown as Record<string, typeof tools>).__MCP_REGISTERED_TOOLS = tools;

  class MockMcpServer {
    tool(name: string, _description: string, _schema: unknown, _handler: unknown) {
      tools.push(name);
      return this;
    }

    async connect() {
      return Promise.resolve();
    }
  }

  return {
    McpServer: MockMcpServer,
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  class MockStdioServerTransport {}
  return {
    StdioServerTransport: MockStdioServerTransport,
  };
});

vi.mock('../project-store', () => ({
  projectStore: {
    getProject: vi.fn(),
    getProjectByPath: vi.fn(),
    getTasks: vi.fn(() => []),
    addProject: vi.fn(),
    invalidateTasksCache: vi.fn(),
    updateTaskStatus: vi.fn(),
    save: vi.fn(),
    getTabState: vi.fn(() => ({ openProjectIds: [], activeProjectId: null, tabOrder: [] })),
    saveTabState: vi.fn(),
  },
}));

vi.mock('./utils.js', () => ({
  createTask: vi.fn(),
  listTasks: vi.fn(() => ({ success: true, data: [] })),
  getTaskStatus: vi.fn(() => ({ success: false, error: 'not found' })),
  startTask: vi.fn(),
  executeCommand: vi.fn(),
  pollTaskStatuses: vi.fn(),
  resolveProjectPath: vi.fn(() => ({ error: 'mock' })),
}));

vi.mock('../ipc-handlers/rdr-handlers.js', () => ({
  readAndClearSignalFile: vi.fn(),
  categorizeTasks: vi.fn(() => []),
  enrichTaskWithWorktreeData: vi.fn((t: unknown) => t),
}));

vi.mock('../services/project-automation-toggle-service.js', () => ({
  appendProjectAutomationSignal: vi.fn(),
  applyProjectAutomationToggle: vi.fn(),
}));

vi.mock('./open-project-service.js', () => ({
  openProjectForMcp: vi.fn(() => ({ success: true, project: { id: 'p1', name: 'Mock', path: '/tmp' } })),
}));

describe('MCP server tool registry', () => {
  beforeEach(() => {
    const registry = (globalThis as unknown as Record<string, string[]>).__MCP_REGISTERED_TOOLS;
    if (registry) {
      registry.length = 0;
    }
  });

  it('registers all 21 Aperant-MCP tools', async () => {
    // Importing the module triggers the tool registrations.
    await import('./index.js');

    const registry = (globalThis as unknown as Record<string, string[]>).__MCP_REGISTERED_TOOLS ?? [];

    const expectedTools = [
      'assign_window',
      'associate_project_desktop',
      'open_project',
      'set_auto_resume_after_rate_limit',
      'set_rdr_enabled',
      'create_task',
      'list_tasks',
      'get_task_status',
      'start_task',
      'start_batch',
      'wait_for_human_review',
      'get_tasks_needing_intervention',
      'get_task_error_details',
      'recover_stuck_task',
      'submit_task_fix_request',
      'get_task_logs',
      'get_rdr_batches',
      'process_rdr_batch',
      'trigger_auto_restart',
      'test_force_recovery',
      'defer_task',
    ];

    for (const name of expectedTools) {
      expect(registry, `expected tool ${name} to be registered`).toContain(name);
    }
    expect(registry.length).toBe(expectedTools.length);
  });
});
