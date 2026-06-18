import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Project, Task } from '../../shared/types';

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getProjectByPath: vi.fn(),
  getTasks: vi.fn(),
  invalidateTasksCache: vi.fn(),
  generateTitle: vi.fn(),
  getProviderAccountState: vi.fn(),
}));

vi.mock('../project-store', () => ({
  projectStore: {
    getProject: mocks.getProject,
    getProjectByPath: mocks.getProjectByPath,
    getTasks: mocks.getTasks,
    invalidateTasksCache: mocks.invalidateTasksCache,
  },
}));

vi.mock('../title-generator', () => ({
  titleGenerator: {
    generateTitle: mocks.generateTitle,
  },
}));

vi.mock('../services/provider-account-service', () => ({
  getProviderAccountState: mocks.getProviderAccountState,
}));

import {
  resolveProjectPath,
  toTaskMetadata,
  listTasks,
  getTaskStatus,
  createTask,
} from './utils';

describe('MCP server utilities', () => {
  beforeEach(() => {
    mocks.getProject.mockReset();
    mocks.getProjectByPath.mockReset();
    mocks.getTasks.mockReset();
    mocks.invalidateTasksCache.mockReset();
    mocks.generateTitle.mockReset();
    mocks.getProviderAccountState.mockReset();
    mocks.getProviderAccountState.mockResolvedValue({
      accounts: [],
      globalPriorityOrder: [],
      disabledAutoSwitchAccountIds: [],
    });
  });

  describe('resolveProjectPath', () => {
    it('resolves by UUID when project exists', () => {
      const project = { id: 'uuid-1', path: '/projects/a' } as Project;
      mocks.getProject.mockReturnValue(project);

      const result = resolveProjectPath('uuid-1');
      expect('error' in result).toBe(false);
      expect(result).toMatchObject({ projectPath: '/projects/a', project });
    });

    it('falls back to projectPath when UUID is unknown', () => {
      const project = { id: 'uuid-2', path: '/projects/b' } as Project;
      mocks.getProject.mockReturnValue(undefined);
      mocks.getProjectByPath.mockReturnValue(project);

      const result = resolveProjectPath('unknown', '/projects/b');
      expect('error' in result).toBe(false);
      expect(result).toMatchObject({ projectPath: '/projects/b', project });
    });

    it('returns an error when project cannot be found', () => {
      mocks.getProject.mockReturnValue(undefined);
      mocks.getProjectByPath.mockReturnValue(undefined);

      const result = resolveProjectPath('unknown');
      expect('error' in result).toBe(true);
      expect((result as { error: string }).error).toContain('Project not found');
    });
  });

  describe('toTaskMetadata', () => {
    it('returns default manual metadata when options are empty', () => {
      const meta = toTaskMetadata();
      expect(meta.sourceType).toBe('manual');
      expect(meta.category).toBeUndefined();
    });

    it('maps MCP options to internal TaskMetadata', () => {
      const meta = toTaskMetadata({
        category: 'feature',
        complexity: 'small',
        priority: 'medium',
        requireReviewBeforeCoding: true,
        baseBranch: 'develop',
        model: 'sonnet',
        phaseModels: {
          specCreation: 'haiku',
          planning: 'sonnet',
          coding: 'opus',
          qaReview: 'sonnet',
        },
        phaseThinking: {
          specCreation: 'low',
          planning: 'medium',
          coding: 'high',
          qaReview: 'xhigh',
        },
        referencedFiles: ['src/foo.ts'],
      });

      expect(meta.sourceType).toBe('manual');
      expect(meta.category).toBe('feature');
      expect(meta.complexity).toBe('small');
      expect(meta.priority).toBe('medium');
      expect(meta.requireReviewBeforeCoding).toBe(true);
      expect(meta.baseBranch).toBe('develop');
      expect(meta.model).toBe('sonnet');
      expect(meta.isAutoProfile).toBe(true);
      expect(meta.phaseModels).toMatchObject({
        spec: 'haiku',
        planning: 'sonnet',
        coding: 'opus',
        qa: 'sonnet',
      });
      expect(meta.phaseThinking).toMatchObject({
        spec: 'low',
        planning: 'medium',
        coding: 'high',
        qa: 'xhigh',
      });
      expect(meta.referencedFiles).toHaveLength(1);
      expect(meta.referencedFiles?.[0]).toMatchObject({
        path: 'src/foo.ts',
        name: 'foo.ts',
        isDirectory: false,
      });
    });
  });

  describe('listTasks', () => {
    it('returns task summaries with projectPath and taskId', () => {
      const project = { id: 'p1', path: '/projects/p1', autoBuildPath: '.auto-claude' } as Project;
      const task: Task = {
        id: 't1',
        specId: '001-test',
        projectId: 'p1',
        title: 'Test task',
        description: 'A task',
        status: 'backlog',
        subtasks: [],
        logs: [],
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      } as Task;

      mocks.getProject.mockReturnValue(project);
      mocks.getTasks.mockReturnValue([task]);

      const result = listTasks('p1');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      const summary = result.data?.[0];
      if (!summary) throw new Error('Expected a task summary');
      expect(summary.taskId).toBe('001-test');
      expect(summary.projectPath).toBe('/projects/p1');
      expect(summary.title).toBe('Test task');
      expect(summary.status).toBe('backlog');
    });
  });

  describe('getTaskStatus', () => {
    it('returns detail with computed progress fields', () => {
      const project = { id: 'p1', path: '/projects/p1' } as Project;
      const task: Task = {
        id: 't1',
        specId: '002-test',
        projectId: 'p1',
        title: 'Test task',
        description: 'A task',
        status: 'in_progress',
        subtasks: [
          { id: 's1', title: 'Sub 1', description: '', status: 'completed', files: [] },
          { id: 's2', title: 'Sub 2', description: '', status: 'pending', files: [] },
        ],
        logs: [],
        executionProgress: {
          phase: 'coding',
          phaseProgress: 50,
          overallProgress: 75,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Task;

      mocks.getProject.mockReturnValue(project);
      mocks.getTasks.mockReturnValue([task]);

      const result = getTaskStatus('p1', '002-test');
      expect(result.success).toBe(true);
      const detail = result.data;
      if (!detail) throw new Error('Expected task status detail');
      expect(detail.taskId).toBe('002-test');
      expect(detail.phase).toBe('coding');
      expect(detail.progress).toBe(75);
      expect(detail.subtaskCount).toBe(2);
      expect(detail.completedSubtasks).toBe(1);
      expect(detail.subtasks).toHaveLength(2);
    });
  });

  describe('createTask', () => {
    let testDir: string;
    let projectPath: string;

    beforeEach(() => {
      testDir = path.join(tmpdir(), `mcp-utils-test-${Date.now()}`);
      projectPath = path.join(testDir, 'project');
      mkdirSync(path.join(projectPath, '.auto-claude', 'specs'), { recursive: true });
      mocks.generateTitle.mockResolvedValue('Generated title');
    });

    afterEach(() => {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('creates a task spec directory and implementation plan', async () => {
      const project = {
        id: 'p1',
        path: projectPath,
        autoBuildPath: '.auto-claude',
      } as Project;
      mocks.getProject.mockReturnValue(project);

      const result = await createTask('p1', 'Create a smoke test task', 'Smoke test');
      expect(result.success).toBe(true);
      expect(result.data?.taskId).toMatch(/^\d+-smoke-test$/);
      expect(result.data?.status).toBe('backlog');
      expect(result.data?.taskId).toBeDefined();

      const specPath = path.join(projectPath, '.auto-claude', 'specs', result.data?.taskId ?? '');
      expect(existsSync(path.join(specPath, 'implementation_plan.json'))).toBe(true);
      expect(existsSync(path.join(specPath, 'task_metadata.json'))).toBe(true);
    });
  });
});
