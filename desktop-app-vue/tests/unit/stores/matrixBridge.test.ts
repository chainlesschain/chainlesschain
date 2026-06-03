/**
 * useMatrixBridgeStore -- Pinia store unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useMatrixBridgeStore } from '../../../src/renderer/stores/matrixBridge';

describe('useMatrixBridgeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  describe('Initial state', () => {
    it('rooms starts as empty array', () => {
      const store = useMatrixBridgeStore();
      expect(store.rooms).toEqual([]);
    });

    it('messages starts as empty array', () => {
      const store = useMatrixBridgeStore();
      expect(store.messages).toEqual([]);
    });

    it('loginState starts as logged_out', () => {
      const store = useMatrixBridgeStore();
      expect(store.loginState).toBe('logged_out');
    });

    it('userId starts as null', () => {
      const store = useMatrixBridgeStore();
      expect(store.userId).toBeNull();
    });
  });

  describe('Getters', () => {
    it('isLoggedIn returns true when logged in', () => {
      const store = useMatrixBridgeStore();
      store.loginState = 'logged_in';
      expect(store.isLoggedIn).toBe(true);
    });

    it('isLoggedIn returns false when logged out', () => {
      const store = useMatrixBridgeStore();
      expect(store.isLoggedIn).toBe(false);
    });

    it('encryptedRooms filters correctly', () => {
      const store = useMatrixBridgeStore();
      store.rooms = [
        { id: '1', is_encrypted: 1 } as any,
        { id: '2', is_encrypted: 0 } as any,
      ];
      expect(store.encryptedRooms).toHaveLength(1);
    });

    it('roomCount returns total count', () => {
      const store = useMatrixBridgeStore();
      store.rooms = [{ id: '1' } as any, { id: '2' } as any];
      expect(store.roomCount).toBe(2);
    });
  });

  describe('login', () => {
    it('calls IPC and updates state on success', async () => {
      const store = useMatrixBridgeStore();
      mockInvoke.mockResolvedValueOnce({ success: true, userId: '@user:matrix.org', homeserver: 'https://matrix.org' });

      await store.login('https://matrix.org', '@user:matrix.org', 'pass');
      expect(mockInvoke).toHaveBeenCalledWith('matrix:login', { homeserver: 'https://matrix.org', userId: '@user:matrix.org', password: 'pass' });
      expect(store.loginState).toBe('logged_in');
      expect(store.userId).toBe('@user:matrix.org');
    });

    it('sets error on failure', async () => {
      const store = useMatrixBridgeStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Invalid credentials' });

      await store.login('https://matrix.org', '@user:matrix.org', 'wrong');
      expect(store.error).toBe('Invalid credentials');
    });

    it('catches exceptions', async () => {
      const store = useMatrixBridgeStore();
      mockInvoke.mockRejectedValueOnce(new Error('Network error'));

      const result = await store.login('https://matrix.org', '@user:matrix.org', 'pass');
      expect(store.error).toBe('Network error');
      expect(result).toEqual({ success: false, error: 'Network error' });
    });
  });

  describe('fetchRooms', () => {
    it('calls IPC and sets rooms on success', async () => {
      const store = useMatrixBridgeStore();
      const rooms = [{ room_id: '!abc:matrix.org', name: 'Test' }];
      mockInvoke.mockResolvedValueOnce({ success: true, rooms });

      await store.fetchRooms();
      expect(store.rooms).toEqual(rooms);
    });
  });

  describe('sendMessage', () => {
    it('calls IPC and refetches messages', async () => {
      const store = useMatrixBridgeStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, event: { id: 'e1' } })
        .mockResolvedValueOnce({ success: true, messages: [] });

      await store.sendMessage('!abc:matrix.org', 'Hello');
      expect(mockInvoke).toHaveBeenCalledWith('matrix:send-message', { roomId: '!abc:matrix.org', body: 'Hello', msgtype: undefined });
    });

    it('sets error on failure', async () => {
      const store = useMatrixBridgeStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Not in room' });

      await store.sendMessage('!abc:matrix.org', 'Hello');
      expect(store.error).toBe('Not in room');
    });
  });

  describe('joinRoom', () => {
    it('calls IPC and refetches rooms', async () => {
      const store = useMatrixBridgeStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, room: { room_id: '!abc:matrix.org' } })
        .mockResolvedValueOnce({ success: true, rooms: [] });

      await store.joinRoom('#test:matrix.org');
      expect(mockInvoke).toHaveBeenCalledWith('matrix:join-room', { roomIdOrAlias: '#test:matrix.org' });
    });

    it('catches exceptions', async () => {
      const store = useMatrixBridgeStore();
      mockInvoke.mockRejectedValueOnce(new Error('Join error'));

      const result = await store.joinRoom('#test:matrix.org');
      expect(store.error).toBe('Join error');
      expect(result).toEqual({ success: false, error: 'Join error' });
    });
  });
});
