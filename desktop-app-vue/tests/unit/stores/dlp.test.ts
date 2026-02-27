/**
 * useDlpStore -- Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Getters: activePolicies, unresolvedIncidents
 *  - fetchPolicies()    -> dlp:list-policies
 *  - createPolicy()     -> dlp:create-policy
 *  - updatePolicy()     -> dlp:update-policy
 *  - deletePolicy()     -> dlp:delete-policy
 *  - fetchIncidents()   -> dlp:get-incidents
 *  - resolveIncident()  -> dlp:resolve-incident
 *  - scanContent()      -> dlp:scan-content
 *  - fetchStats()       -> dlp:get-stats
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

import { useDlpStore } from '../../../src/renderer/stores/dlp';

const makePolicy = (overrides: Partial<any> = {}) => ({
  id: 'pol-1',
  name: 'Credit Card Filter',
  description: 'Detect credit card numbers',
  enabled: true,
  channels: ['chat', 'email'],
  patterns: ['\\d{4}-\\d{4}-\\d{4}-\\d{4}'],
  keywords: ['credit card'],
  action: 'block',
  severity: 'high',
  created_at: Date.now(),
  updated_at: Date.now(),
  ...overrides,
});

const makeIncident = (overrides: Partial<any> = {}) => ({
  id: 'inc-1',
  policy_id: 'pol-1',
  channel: 'chat',
  action_taken: 'blocked',
  matched_patterns: '\\d{4}-\\d{4}',
  severity: 'high',
  user_id: 'u1',
  created_at: Date.now(),
  resolved_at: null,
  resolution: null,
  ...overrides,
});

describe('useDlpStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('Initial state', () => {
    it('policies starts as empty array', () => {
      const store = useDlpStore();
      expect(store.policies).toEqual([]);
    });

    it('incidents starts as empty array', () => {
      const store = useDlpStore();
      expect(store.incidents).toEqual([]);
    });

    it('stats starts as null', () => {
      const store = useDlpStore();
      expect(store.stats).toBeNull();
    });

    it('loading starts as false', () => {
      const store = useDlpStore();
      expect(store.loading).toBe(false);
    });

    it('error starts as null', () => {
      const store = useDlpStore();
      expect(store.error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  describe('Getters', () => {
    it('activePolicies returns only enabled policies', () => {
      const store = useDlpStore();
      store.policies = [
        makePolicy({ id: '1', enabled: true }),
        makePolicy({ id: '2', enabled: false }),
        makePolicy({ id: '3', enabled: true }),
      ];
      expect(store.activePolicies).toHaveLength(2);
      expect(store.activePolicies.every(p => p.enabled)).toBe(true);
    });

    it('activePolicies returns empty array initially', () => {
      const store = useDlpStore();
      expect(store.activePolicies).toEqual([]);
    });

    it('unresolvedIncidents returns only unresolved incidents', () => {
      const store = useDlpStore();
      store.incidents = [
        makeIncident({ id: '1', resolved_at: null }),
        makeIncident({ id: '2', resolved_at: 1000 }),
        makeIncident({ id: '3', resolved_at: null }),
      ];
      expect(store.unresolvedIncidents).toHaveLength(2);
      expect(store.unresolvedIncidents.every(i => !i.resolved_at)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  describe('fetchPolicies', () => {
    it('calls IPC and sets policies on success', async () => {
      const store = useDlpStore();
      const policies = [makePolicy({ id: '1' }), makePolicy({ id: '2' })];
      mockInvoke.mockResolvedValueOnce({ success: true, policies });

      const result = await store.fetchPolicies(true);
      expect(mockInvoke).toHaveBeenCalledWith('dlp:list-policies', { enabled: true });
      expect(result.success).toBe(true);
      expect(store.policies).toEqual(policies);
      expect(store.loading).toBe(false);
    });

    it('toggles loading during call', async () => {
      const store = useDlpStore();
      let loadingDuringCall = false;
      mockInvoke.mockImplementationOnce(() => {
        loadingDuringCall = store.loading;
        return Promise.resolve({ success: true, policies: [] });
      });

      await store.fetchPolicies();
      expect(loadingDuringCall).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('sets error when result is not success', async () => {
      const store = useDlpStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'DB error' });

      await store.fetchPolicies();
      expect(store.error).toBe('DB error');
      expect(store.policies).toEqual([]);
    });

    it('catches exceptions and sets error', async () => {
      const store = useDlpStore();
      mockInvoke.mockRejectedValueOnce(new Error('IPC fail'));

      const result = await store.fetchPolicies();
      expect(store.error).toBe('IPC fail');
      expect(result).toEqual({ success: false, error: 'IPC fail' });
      expect(store.loading).toBe(false);
    });
  });

  describe('createPolicy', () => {
    it('calls IPC and refetches policies on success', async () => {
      const store = useDlpStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, id: 'pol-new' })
        .mockResolvedValueOnce({ success: true, policies: [makePolicy({ id: 'pol-new' })] });

      const result = await store.createPolicy({ name: 'Test', enabled: true });
      expect(mockInvoke).toHaveBeenCalledWith('dlp:create-policy', { name: 'Test', enabled: true });
      expect(result.success).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('sets error on failure', async () => {
      const store = useDlpStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Validation error' });

      await store.createPolicy({ name: '' });
      expect(store.error).toBe('Validation error');
    });

    it('catches exceptions', async () => {
      const store = useDlpStore();
      mockInvoke.mockRejectedValueOnce(new Error('Timeout'));

      const result = await store.createPolicy({ name: 'Test' });
      expect(store.error).toBe('Timeout');
      expect(result).toEqual({ success: false, error: 'Timeout' });
      expect(store.loading).toBe(false);
    });
  });

  describe('updatePolicy', () => {
    it('calls IPC and refetches policies on success', async () => {
      const store = useDlpStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, policies: [] });

      const result = await store.updatePolicy('pol-1', { enabled: false });
      expect(mockInvoke).toHaveBeenCalledWith('dlp:update-policy', { id: 'pol-1', enabled: false });
      expect(result.success).toBe(true);
    });

    it('catches exceptions', async () => {
      const store = useDlpStore();
      mockInvoke.mockRejectedValueOnce(new Error('Not found'));

      const result = await store.updatePolicy('pol-1', { enabled: false });
      expect(result).toEqual({ success: false, error: 'Not found' });
      expect(store.loading).toBe(false);
    });
  });

  describe('deletePolicy', () => {
    it('calls IPC and refetches policies on success', async () => {
      const store = useDlpStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, policies: [] });

      const result = await store.deletePolicy('pol-1');
      expect(mockInvoke).toHaveBeenCalledWith('dlp:delete-policy', { id: 'pol-1' });
      expect(result.success).toBe(true);
    });

    it('catches exceptions', async () => {
      const store = useDlpStore();
      mockInvoke.mockRejectedValueOnce(new Error('Locked'));

      const result = await store.deletePolicy('pol-1');
      expect(result).toEqual({ success: false, error: 'Locked' });
      expect(store.loading).toBe(false);
    });
  });

  describe('fetchIncidents', () => {
    it('calls IPC and sets incidents on success', async () => {
      const store = useDlpStore();
      const incidents = [makeIncident({ id: '1' })];
      mockInvoke.mockResolvedValueOnce({ success: true, incidents });

      const result = await store.fetchIncidents({ channel: 'chat', severity: 'high', limit: 10 });
      expect(mockInvoke).toHaveBeenCalledWith('dlp:get-incidents', { channel: 'chat', severity: 'high', limit: 10 });
      expect(result.success).toBe(true);
      expect(store.incidents).toEqual(incidents);
    });

    it('catches exceptions', async () => {
      const store = useDlpStore();
      mockInvoke.mockRejectedValueOnce(new Error('DB error'));

      const result = await store.fetchIncidents();
      expect(store.error).toBe('DB error');
      expect(result).toEqual({ success: false, error: 'DB error' });
      expect(store.loading).toBe(false);
    });
  });

  describe('resolveIncident', () => {
    it('calls IPC and refetches incidents on success', async () => {
      const store = useDlpStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, incidents: [] });

      const result = await store.resolveIncident('inc-1', 'False positive');
      expect(mockInvoke).toHaveBeenCalledWith('dlp:resolve-incident', { id: 'inc-1', resolution: 'False positive' });
      expect(result.success).toBe(true);
    });

    it('catches exceptions', async () => {
      const store = useDlpStore();
      mockInvoke.mockRejectedValueOnce(new Error('Not found'));

      const result = await store.resolveIncident('inc-1', 'test');
      expect(result).toEqual({ success: false, error: 'Not found' });
    });
  });

  describe('scanContent', () => {
    it('calls IPC with content, channel and userId', async () => {
      const store = useDlpStore();
      mockInvoke.mockResolvedValueOnce({ success: true, violations: [] });

      const result = await store.scanContent('my card is 1234-5678-9012-3456', 'chat', 'u1');
      expect(mockInvoke).toHaveBeenCalledWith('dlp:scan-content', { content: 'my card is 1234-5678-9012-3456', channel: 'chat', userId: 'u1' });
      expect(result.success).toBe(true);
    });

    it('catches exceptions', async () => {
      const store = useDlpStore();
      mockInvoke.mockRejectedValueOnce(new Error('Engine fail'));

      const result = await store.scanContent('test', 'chat');
      expect(result).toEqual({ success: false, error: 'Engine fail' });
    });
  });

  describe('fetchStats', () => {
    it('calls IPC and sets stats on success', async () => {
      const store = useDlpStore();
      const stats = { scanned: 100, blocked: 5, alerted: 10 };
      mockInvoke.mockResolvedValueOnce({ success: true, stats });

      const result = await store.fetchStats();
      expect(mockInvoke).toHaveBeenCalledWith('dlp:get-stats');
      expect(result.success).toBe(true);
      expect(store.stats).toEqual(stats);
    });

    it('catches exceptions', async () => {
      const store = useDlpStore();
      mockInvoke.mockRejectedValueOnce(new Error('Stats unavailable'));

      const result = await store.fetchStats();
      expect(result).toEqual({ success: false, error: 'Stats unavailable' });
    });
  });
});
