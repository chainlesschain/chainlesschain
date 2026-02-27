/**
 * useRecommendationStore -- Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Getters: unviewedCount, topRecommendations
 *  - fetchRecommendations() -> recommendation:get-recommendations
 *  - generate()             -> recommendation:generate
 *  - markViewed()           -> recommendation:mark-viewed
 *  - provideFeedback()      -> recommendation:feedback
 *  - fetchProfile()         -> recommendation:get-profile
 *  - Loading state toggling
 *  - Error handling for each action
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// vi.hoisted runs before imports -- set up electronAPI before store captures it
const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useRecommendationStore } from '../../../src/renderer/stores/recommendation';

const makeRec = (overrides: Partial<any> = {}) => ({
  id: 'rec-1',
  user_id: 'u1',
  content_id: 'c1',
  content_type: 'article',
  score: 0.95,
  reason: 'Similar topics',
  source: 'collaborative',
  status: 'pending',
  created_at: Date.now(),
  viewed_at: null,
  ...overrides,
});

describe('useRecommendationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('Initial state', () => {
    it('recommendations starts as empty array', () => {
      const store = useRecommendationStore();
      expect(store.recommendations).toEqual([]);
    });

    it('profile starts as null', () => {
      const store = useRecommendationStore();
      expect(store.profile).toBeNull();
    });

    it('loading starts as false', () => {
      const store = useRecommendationStore();
      expect(store.loading).toBe(false);
    });

    it('error starts as null', () => {
      const store = useRecommendationStore();
      expect(store.error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  describe('Getters', () => {
    it('unviewedCount returns 0 initially', () => {
      const store = useRecommendationStore();
      expect(store.unviewedCount).toBe(0);
    });

    it('unviewedCount counts recommendations without viewed_at', () => {
      const store = useRecommendationStore();
      store.recommendations = [
        makeRec({ id: '1', viewed_at: null }),
        makeRec({ id: '2', viewed_at: 1000 }),
        makeRec({ id: '3', viewed_at: null }),
      ];
      expect(store.unviewedCount).toBe(2);
    });

    it('topRecommendations returns first 10 items', () => {
      const store = useRecommendationStore();
      const recs = Array.from({ length: 15 }, (_, i) => makeRec({ id: `r-${i}` }));
      store.recommendations = recs;
      expect(store.topRecommendations).toHaveLength(10);
      expect(store.topRecommendations[0].id).toBe('r-0');
    });

    it('topRecommendations returns all when fewer than 10', () => {
      const store = useRecommendationStore();
      store.recommendations = [makeRec({ id: '1' }), makeRec({ id: '2' })];
      expect(store.topRecommendations).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  describe('fetchRecommendations', () => {
    it('calls IPC and sets recommendations on success', async () => {
      const store = useRecommendationStore();
      const recs = [makeRec({ id: '1' }), makeRec({ id: '2' })];
      mockInvoke.mockResolvedValueOnce({ success: true, recommendations: recs });

      const result = await store.fetchRecommendations('u1', 20, 'article');
      expect(mockInvoke).toHaveBeenCalledWith('recommendation:get-recommendations', { userId: 'u1', limit: 20, contentType: 'article' });
      expect(result.success).toBe(true);
      expect(store.recommendations).toEqual(recs);
      expect(store.loading).toBe(false);
    });

    it('toggles loading during call', async () => {
      const store = useRecommendationStore();
      let loadingDuringCall = false;
      mockInvoke.mockImplementationOnce(() => {
        loadingDuringCall = store.loading;
        return Promise.resolve({ success: true, recommendations: [] });
      });

      await store.fetchRecommendations('u1');
      expect(loadingDuringCall).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('sets error when result is not success', async () => {
      const store = useRecommendationStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'DB error' });

      await store.fetchRecommendations('u1');
      expect(store.error).toBe('DB error');
      expect(store.recommendations).toEqual([]);
    });

    it('catches exceptions and sets error', async () => {
      const store = useRecommendationStore();
      mockInvoke.mockRejectedValueOnce(new Error('IPC lost'));

      const result = await store.fetchRecommendations('u1');
      expect(store.error).toBe('IPC lost');
      expect(result).toEqual({ success: false, error: 'IPC lost' });
      expect(store.loading).toBe(false);
    });
  });

  describe('generate', () => {
    it('calls IPC and refetches recommendations on success', async () => {
      const store = useRecommendationStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, generated: 5 })
        .mockResolvedValueOnce({ success: true, recommendations: [makeRec()] });

      const result = await store.generate('u1', []);
      expect(mockInvoke).toHaveBeenCalledWith('recommendation:generate', { userId: 'u1', contentPool: [] });
      expect(result.success).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('catches exceptions', async () => {
      const store = useRecommendationStore();
      mockInvoke.mockRejectedValueOnce(new Error('Engine fail'));

      const result = await store.generate('u1');
      expect(store.error).toBe('Engine fail');
      expect(result).toEqual({ success: false, error: 'Engine fail' });
    });
  });

  describe('markViewed', () => {
    it('calls IPC with recommendation id', async () => {
      const store = useRecommendationStore();
      mockInvoke.mockResolvedValueOnce({ success: true });

      await store.markViewed('rec-1');
      expect(mockInvoke).toHaveBeenCalledWith('recommendation:mark-viewed', { id: 'rec-1' });
    });

    it('does not throw on failure', async () => {
      const store = useRecommendationStore();
      mockInvoke.mockRejectedValueOnce(new Error('fail'));

      await expect(store.markViewed('rec-1')).resolves.not.toThrow();
    });
  });

  describe('provideFeedback', () => {
    it('calls IPC and updates local status on success', async () => {
      const store = useRecommendationStore();
      store.recommendations = [makeRec({ id: 'rec-1', status: 'pending' })];
      mockInvoke.mockResolvedValueOnce({ success: true });

      const result = await store.provideFeedback('rec-1', 'liked');
      expect(mockInvoke).toHaveBeenCalledWith('recommendation:feedback', { recommendationId: 'rec-1', feedback: 'liked' });
      expect(result.success).toBe(true);
      expect(store.recommendations[0].status).toBe('liked');
    });

    it('does not update status on failure', async () => {
      const store = useRecommendationStore();
      store.recommendations = [makeRec({ id: 'rec-1', status: 'pending' })];
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Invalid' });

      await store.provideFeedback('rec-1', 'liked');
      expect(store.recommendations[0].status).toBe('pending');
    });

    it('catches exceptions', async () => {
      const store = useRecommendationStore();
      mockInvoke.mockRejectedValueOnce(new Error('IPC fail'));

      const result = await store.provideFeedback('rec-1', 'liked');
      expect(result).toEqual({ success: false, error: 'IPC fail' });
    });
  });

  describe('fetchProfile', () => {
    it('calls IPC and sets profile on success', async () => {
      const store = useRecommendationStore();
      const profile = { user_id: 'u1', topics: { ai: 0.9 }, interaction_weights: {}, last_updated: 1000, update_count: 5 };
      mockInvoke.mockResolvedValueOnce({ success: true, profile });

      const result = await store.fetchProfile('u1');
      expect(mockInvoke).toHaveBeenCalledWith('recommendation:get-profile', { userId: 'u1' });
      expect(result.success).toBe(true);
      expect(store.profile).toEqual(profile);
    });

    it('catches exceptions', async () => {
      const store = useRecommendationStore();
      mockInvoke.mockRejectedValueOnce(new Error('Not found'));

      const result = await store.fetchProfile('u1');
      expect(result).toEqual({ success: false, error: 'Not found' });
    });
  });
});
