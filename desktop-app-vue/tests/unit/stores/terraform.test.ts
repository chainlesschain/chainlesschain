/**
 * useTerraformStore -- Pinia store unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useTerraformStore } from '../../../src/renderer/stores/terraform';

describe('useTerraformStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  describe('Initial state', () => {
    it('workspaces starts as empty array', () => {
      const store = useTerraformStore();
      expect(store.workspaces).toEqual([]);
    });

    it('runs starts as empty array', () => {
      const store = useTerraformStore();
      expect(store.runs).toEqual([]);
    });

    it('loading and error start correctly', () => {
      const store = useTerraformStore();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('Getters', () => {
    it('activeWorkspaces filters by status active', () => {
      const store = useTerraformStore();
      store.workspaces = [
        { id: '1', status: 'active' } as any,
        { id: '2', status: 'archived' } as any,
      ];
      expect(store.activeWorkspaces).toHaveLength(1);
    });

    it('recentRuns returns first 10', () => {
      const store = useTerraformStore();
      store.runs = Array.from({ length: 15 }, (_, i) => ({ id: `r${i}`, resources_added: 1 } as any));
      expect(store.recentRuns).toHaveLength(10);
    });

    it('totalResources sums resources_added', () => {
      const store = useTerraformStore();
      store.runs = [
        { id: '1', resources_added: 5 } as any,
        { id: '2', resources_added: 3 } as any,
      ];
      expect(store.totalResources).toBe(8);
    });
  });

  describe('fetchWorkspaces', () => {
    it('calls IPC and sets workspaces on success', async () => {
      const store = useTerraformStore();
      const workspaces = [{ id: '1', name: 'prod' }];
      mockInvoke.mockResolvedValueOnce({ success: true, workspaces });

      await store.fetchWorkspaces();
      expect(mockInvoke).toHaveBeenCalledWith('terraform:list-workspaces', undefined);
      expect(store.workspaces).toEqual(workspaces);
    });

    it('sets error on failure', async () => {
      const store = useTerraformStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'DB error' });

      await store.fetchWorkspaces();
      expect(store.error).toBe('DB error');
    });

    it('catches exceptions', async () => {
      const store = useTerraformStore();
      mockInvoke.mockRejectedValueOnce(new Error('IPC down'));

      const result = await store.fetchWorkspaces();
      expect(store.error).toBe('IPC down');
      expect(result).toEqual({ success: false, error: 'IPC down' });
    });
  });

  describe('createWorkspace', () => {
    it('calls IPC and refetches on success', async () => {
      const store = useTerraformStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, workspace: { id: '1' } })
        .mockResolvedValueOnce({ success: true, workspaces: [{ id: '1' }] });

      await store.createWorkspace('prod', 'Production');
      expect(mockInvoke).toHaveBeenCalledWith('terraform:create-workspace', { name: 'prod', description: 'Production', terraformVersion: undefined, providers: undefined });
    });

    it('sets error on failure', async () => {
      const store = useTerraformStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Duplicate name' });

      await store.createWorkspace('prod');
      expect(store.error).toBe('Duplicate name');
    });
  });

  describe('planRun', () => {
    it('calls IPC and refetches runs', async () => {
      const store = useTerraformStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, run: { id: 'r1' } })
        .mockResolvedValueOnce({ success: true, runs: [] });

      await store.planRun('ws1', 'plan');
      expect(mockInvoke).toHaveBeenCalledWith('terraform:plan-run', { workspaceId: 'ws1', runType: 'plan', triggeredBy: undefined });
    });

    it('catches exceptions', async () => {
      const store = useTerraformStore();
      mockInvoke.mockRejectedValueOnce(new Error('Run error'));

      const result = await store.planRun('ws1');
      expect(store.error).toBe('Run error');
      expect(result).toEqual({ success: false, error: 'Run error' });
    });
  });

  describe('fetchRuns', () => {
    it('calls IPC and sets runs', async () => {
      const store = useTerraformStore();
      const runs = [{ id: 'r1', run_type: 'plan' }];
      mockInvoke.mockResolvedValueOnce({ success: true, runs });

      const result = await store.fetchRuns();
      expect(result.success).toBe(true);
      expect(store.runs).toEqual(runs);
    });
  });
});
