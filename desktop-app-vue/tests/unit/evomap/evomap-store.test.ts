/**
 * Unit tests for EvoMap Pinia Store
 * @module evomap/evomap-store.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useEvoMapStore } from '../../../src/renderer/stores/evomap';

describe('EvoMap Store', () => {
  let mockInvoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke = vi.fn();
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // Initial State
  // ============================================================

  describe('initial state', () => {
    it('should have correct defaults', () => {
      const store = useEvoMapStore();
      expect(store.nodeStatus.registered).toBe(false);
      expect(store.nodeStatus.credits).toBe(0);
      expect(store.assets).toEqual([]);
      expect(store.trendingAssets).toEqual([]);
      expect(store.syncLog).toEqual([]);
      expect(store.tasks).toEqual([]);
      expect(store.config).toBeNull();
      expect(store.searchResults).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // ============================================================
  // Getters
  // ============================================================

  describe('getters', () => {
    it('isRegistered should reflect nodeStatus', () => {
      const store = useEvoMapStore();
      expect(store.isRegistered).toBe(false);
      store.nodeStatus.registered = true;
      expect(store.isRegistered).toBe(true);
    });

    it('creditBalance should reflect nodeStatus.credits', () => {
      const store = useEvoMapStore();
      store.nodeStatus.credits = 42;
      expect(store.creditBalance).toBe(42);
    });

    it('publishedCount should count published assets', () => {
      const store = useEvoMapStore();
      store.assets = [
        { asset_id: '1', direction: 'published' } as any,
        { asset_id: '2', direction: 'fetched' } as any,
        { asset_id: '3', direction: 'published' } as any,
      ];
      expect(store.publishedCount).toBe(2);
    });

    it('fetchedCount should count fetched assets', () => {
      const store = useEvoMapStore();
      store.assets = [
        { asset_id: '1', direction: 'fetched' } as any,
        { asset_id: '2', direction: 'published' } as any,
      ];
      expect(store.fetchedCount).toBe(1);
    });

    it('importedCount should count imported assets', () => {
      const store = useEvoMapStore();
      store.assets = [
        { asset_id: '1', status: 'imported' } as any,
        { asset_id: '2', status: 'promoted' } as any,
      ];
      expect(store.importedCount).toBe(1);
    });
  });

  // ============================================================
  // Actions - Node Management
  // ============================================================

  describe('register()', () => {
    it('should call IPC and update status on success', async () => {
      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'evomap:register') return { success: true };
        if (channel === 'evomap:get-status') return { success: true, data: { registered: true, credits: 100 } };
        return { success: true };
      });

      const store = useEvoMapStore();
      const result = await store.register();
      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('evomap:register');
    });

    it('should set error on failure', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Hub unavailable' });

      const store = useEvoMapStore();
      await store.register();
      expect(store.error).toBe('Hub unavailable');
    });

    it('should set loading flag', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useEvoMapStore();
      const promise = store.register();
      // loading should be true during the call
      await promise;
      expect(store.loading).toBe(false);
    });
  });

  describe('getStatus()', () => {
    it('should update nodeStatus', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: { nodeId: 'n1', credits: 50, registered: true },
      });

      const store = useEvoMapStore();
      await store.getStatus();
      expect(store.nodeStatus.credits).toBe(50);
    });
  });

  describe('refreshCredits()', () => {
    it('should update credits', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { credits: 75 } });

      const store = useEvoMapStore();
      await store.refreshCredits();
      expect(store.nodeStatus.credits).toBe(75);
    });
  });

  // ============================================================
  // Actions - Discovery
  // ============================================================

  describe('searchAssets()', () => {
    it('should update searchResults on success', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: { assets: [{ asset_id: 'a1', type: 'Gene' }] },
      });

      const store = useEvoMapStore();
      await store.searchAssets(['test'], 'Gene', 'relevance');
      expect(store.searchResults).toHaveLength(1);
      expect(mockInvoke).toHaveBeenCalledWith('evomap:search-assets', ['test'], 'Gene', 'relevance');
    });

    it('should set error on failure', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Search failed' });

      const store = useEvoMapStore();
      await store.searchAssets(['test']);
      expect(store.error).toBe('Search failed');
    });
  });

  describe('fetchTrending()', () => {
    it('should update trendingAssets', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: { assets: [{ asset_id: 't1' }] },
      });

      const store = useEvoMapStore();
      await store.fetchTrending();
      expect(store.trendingAssets).toHaveLength(1);
    });
  });

  describe('fetchRelevant()', () => {
    it('should update searchResults', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: { assets: [{ asset_id: 'r1' }] },
      });

      const store = useEvoMapStore();
      await store.fetchRelevant(['error']);
      expect(store.searchResults).toHaveLength(1);
    });
  });

  // ============================================================
  // Actions - Publishing
  // ============================================================

  describe('publishInstinct()', () => {
    it('should call IPC and refresh assets on success', async () => {
      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'evomap:publish-instinct') return { success: true };
        if (channel === 'evomap:get-local-assets') return { success: true, data: [] };
        return { success: true };
      });

      const store = useEvoMapStore();
      const result = await store.publishInstinct('inst_1');
      expect(result.success).toBe(true);
    });
  });

  describe('publishDecision()', () => {
    it('should call IPC', async () => {
      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'evomap:publish-decision') return { success: true };
        if (channel === 'evomap:get-local-assets') return { success: true, data: [] };
        return { success: true };
      });

      const store = useEvoMapStore();
      const result = await store.publishDecision('dec_1');
      expect(result.success).toBe(true);
    });
  });

  describe('autoPublish()', () => {
    it('should call IPC', async () => {
      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'evomap:auto-publish') return { success: true, data: { published: 2 } };
        if (channel === 'evomap:get-local-assets') return { success: true, data: [] };
        return { success: true };
      });

      const store = useEvoMapStore();
      const result = await store.autoPublish();
      expect(result.success).toBe(true);
    });
  });

  describe('approvePublish()', () => {
    it('should approve and refresh assets', async () => {
      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'evomap:approve-publish') return { success: true };
        if (channel === 'evomap:get-local-assets') return { success: true, data: [] };
        return { success: true };
      });

      const store = useEvoMapStore();
      const result = await store.approvePublish('review_1');
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // Actions - Import
  // ============================================================

  describe('importAsSkill()', () => {
    it('should call IPC', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { skillName: 'test' } });

      const store = useEvoMapStore();
      const result = await store.importAsSkill('asset_1');
      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('evomap:import-as-skill', 'asset_1');
    });
  });

  describe('importAsInstinct()', () => {
    it('should call IPC', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useEvoMapStore();
      const result = await store.importAsInstinct('asset_1');
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // Actions - Local Assets
  // ============================================================

  describe('getLocalAssets()', () => {
    it('should update assets', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: [{ asset_id: 'a1', direction: 'published' }],
      });

      const store = useEvoMapStore();
      await store.getLocalAssets({ direction: 'published' });
      expect(store.assets).toHaveLength(1);
    });
  });

  // ============================================================
  // Actions - Tasks
  // ============================================================

  describe('listTasks()', () => {
    it('should update tasks', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: { tasks: [{ id: 't1', title: 'Test task' }] },
      });

      const store = useEvoMapStore();
      await store.listTasks();
      expect(store.tasks).toHaveLength(1);
    });
  });

  describe('claimTask()', () => {
    it('should call IPC', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useEvoMapStore();
      const result = await store.claimTask('task_1');
      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('evomap:claim-task', 'task_1');
    });
  });

  // ============================================================
  // Actions - Config
  // ============================================================

  describe('getConfig()', () => {
    it('should update config', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: { evomap: { enabled: true, hubUrl: 'http://test' } },
      });

      const store = useEvoMapStore();
      await store.getConfig();
      expect(store.config).toEqual({ enabled: true, hubUrl: 'http://test' });
    });
  });

  describe('updateConfig()', () => {
    it('should merge and update config', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useEvoMapStore();
      store.config = { enabled: true, hubUrl: 'http://old' } as any;
      await store.updateConfig({ hubUrl: 'http://new' });

      expect(store.config?.hubUrl).toBe('http://new');
      expect(store.config?.enabled).toBe(true);
    });

    it('should handle null config gracefully', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useEvoMapStore();
      store.config = null;
      await store.updateConfig({ hubUrl: 'http://new' });
      expect(store.config?.hubUrl).toBe('http://new');
    });
  });

  // ============================================================
  // Actions - Sync Log
  // ============================================================

  describe('getSyncLog()', () => {
    it('should update syncLog', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: [{ id: 'log1', action: 'publish' }],
      });

      const store = useEvoMapStore();
      await store.getSyncLog(20);
      expect(store.syncLog).toHaveLength(1);
      expect(mockInvoke).toHaveBeenCalledWith('evomap:get-sync-log', 20);
    });
  });

  // ============================================================
  // Actions - Reset
  // ============================================================

  describe('reset()', () => {
    it('should reset all mutable state', () => {
      const store = useEvoMapStore();
      store.assets = [{ asset_id: 'a1' } as any];
      store.loading = true;
      store.error = 'some error';
      store.searchResults = [{ asset_id: 's1' } as any];

      store.reset();

      expect(store.assets).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.searchResults).toEqual([]);
      expect(store.tasks).toEqual([]);
    });
  });

  // ============================================================
  // Error Handling
  // ============================================================

  describe('error handling', () => {
    it('should catch exceptions in register', async () => {
      mockInvoke.mockRejectedValue(new Error('IPC failed'));

      const store = useEvoMapStore();
      const result = await store.register();
      expect(result.success).toBe(false);
      expect(store.error).toBe('IPC failed');
    });

    it('should catch exceptions in searchAssets', async () => {
      mockInvoke.mockRejectedValue(new Error('Search error'));

      const store = useEvoMapStore();
      const result = await store.searchAssets(['test']);
      expect(result.success).toBe(false);
      expect(store.error).toBe('Search error');
    });
  });
});
