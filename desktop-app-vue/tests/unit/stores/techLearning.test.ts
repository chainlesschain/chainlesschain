import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useTechLearningStore } from '../../../src/renderer/stores/techLearning';

describe('useTechLearningStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  describe('Initial state', () => {
    it('profiles starts as empty', () => {
      const store = useTechLearningStore();
      expect(store.profiles).toEqual([]);
    });

    it('practices starts as empty', () => {
      const store = useTechLearningStore();
      expect(store.practices).toEqual([]);
    });
  });

  describe('Getters', () => {
    it('promotedPractices filters promoted', () => {
      const store = useTechLearningStore();
      store.practices = [{ status: 'promoted' } as any, { status: 'extracted' } as any];
      expect(store.promotedPractices).toHaveLength(1);
    });

    it('profileCount returns total', () => {
      const store = useTechLearningStore();
      store.profiles = [{ id: '1' } as any, { id: '2' } as any];
      expect(store.profileCount).toBe(2);
    });
  });

  describe('detectStack', () => {
    it('calls IPC and refetches', async () => {
      const store = useTechLearningStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, profile: { id: '1' } })
        .mockResolvedValueOnce({ success: true, profiles: [] });
      await store.detectStack('/home/project');
      expect(mockInvoke).toHaveBeenCalledWith('tech-learning:detect-stack', { projectPath: '/home/project' });
    });

    it('sets error on failure', async () => {
      const store = useTechLearningStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Not found' });
      await store.detectStack('/path');
      expect(store.error).toBe('Not found');
    });
  });

  describe('fetchProfiles', () => {
    it('calls IPC and sets profiles', async () => {
      const store = useTechLearningStore();
      mockInvoke.mockResolvedValueOnce({ success: true, profiles: [{ id: '1' }] });
      await store.fetchProfiles();
      expect(store.profiles).toHaveLength(1);
    });
  });

  describe('extractPractices', () => {
    it('calls IPC and refetches practices', async () => {
      const store = useTechLearningStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, practices: [{ id: '1' }] })
        .mockResolvedValueOnce({ success: true, practices: [{ id: '1' }] });
      await store.extractPractices('p1');
      expect(mockInvoke).toHaveBeenCalledWith('tech-learning:extract-practices', { profileId: 'p1', source: undefined });
    });
  });

  describe('synthesizeSkill', () => {
    it('calls IPC', async () => {
      const store = useTechLearningStore();
      mockInvoke.mockResolvedValueOnce({ success: true, skill: { id: 's1' } });
      const result = await store.synthesizeSkill('p1');
      expect(result.success).toBe(true);
    });
  });
});
