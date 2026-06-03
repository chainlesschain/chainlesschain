import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useAutonomousDevStore } from '../../../src/renderer/stores/autonomousDev';

describe('useAutonomousDevStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  describe('Initial state', () => {
    it('sessions starts as empty', () => {
      const store = useAutonomousDevStore();
      expect(store.sessions).toEqual([]);
    });

    it('currentSession starts as null', () => {
      const store = useAutonomousDevStore();
      expect(store.currentSession).toBeNull();
    });
  });

  describe('Getters', () => {
    it('completedSessions filters complete', () => {
      const store = useAutonomousDevStore();
      store.sessions = [{ status: 'complete' } as any, { status: 'intent' } as any];
      expect(store.completedSessions).toHaveLength(1);
    });

    it('activeSessions filters non-terminal', () => {
      const store = useAutonomousDevStore();
      store.sessions = [{ status: 'intent' } as any, { status: 'complete' } as any, { status: 'failed' } as any];
      expect(store.activeSessions).toHaveLength(1);
    });
  });

  describe('startSession', () => {
    it('calls IPC and refetches', async () => {
      const store = useAutonomousDevStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, session: { id: '1' } })
        .mockResolvedValueOnce({ success: true, sessions: [] });
      await store.startSession('Build API');
      expect(mockInvoke).toHaveBeenCalledWith('autonomous-dev:start-session', { intent: 'Build API', title: undefined });
    });

    it('sets error on failure', async () => {
      const store = useAutonomousDevStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Failed' });
      await store.startSession('test');
      expect(store.error).toBe('Failed');
    });
  });

  describe('generateCode', () => {
    it('calls IPC and sets session', async () => {
      const store = useAutonomousDevStore();
      mockInvoke.mockResolvedValueOnce({ success: true, session: { id: '1', status: 'complete' } });
      await store.generateCode('s1');
      expect(store.currentSession?.status).toBe('complete');
    });
  });

  describe('reviewCode', () => {
    it('calls IPC', async () => {
      const store = useAutonomousDevStore();
      mockInvoke.mockResolvedValueOnce({ success: true, review: { overallScore: 0.9 } });
      const result = await store.reviewCode('s1');
      expect(result.success).toBe(true);
    });

    it('catches exceptions', async () => {
      const store = useAutonomousDevStore();
      mockInvoke.mockRejectedValueOnce(new Error('Review failed'));
      const result = await store.reviewCode('s1');
      expect(store.error).toBe('Review failed');
      expect(result).toEqual({ success: false, error: 'Review failed' });
    });
  });

  describe('fetchSessions', () => {
    it('calls IPC and sets sessions', async () => {
      const store = useAutonomousDevStore();
      mockInvoke.mockResolvedValueOnce({ success: true, sessions: [{ id: '1' }] });
      await store.fetchSessions();
      expect(store.sessions).toHaveLength(1);
    });
  });
});
