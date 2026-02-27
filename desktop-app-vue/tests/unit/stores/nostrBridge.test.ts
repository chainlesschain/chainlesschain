/**
 * useNostrBridgeStore -- Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Getters: connectedRelays, relayCount
 *  - fetchRelays()      -> nostr:list-relays
 *  - addRelay()         -> nostr:add-relay
 *  - publishEvent()     -> nostr:publish-event
 *  - fetchEvents()      -> nostr:get-events
 *  - generateKeyPair()  -> nostr:generate-keypair
 *  - mapDID()           -> nostr:map-did
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

import { useNostrBridgeStore } from '../../../src/renderer/stores/nostrBridge';

const makeRelay = (overrides: Partial<any> = {}) => ({
  id: 'r1',
  url: 'wss://relay.example.com',
  status: 'connected',
  last_connected: Date.now(),
  event_count: 10,
  read_enabled: true,
  write_enabled: true,
  ...overrides,
});

const makeEvent = (overrides: Partial<any> = {}) => ({
  id: 'evt-1',
  pubkey: 'pk1',
  kind: 1,
  content: 'Hello Nostr',
  tags: [],
  sig: 'sig1',
  created_at: Date.now(),
  relay_url: 'wss://relay.example.com',
  ...overrides,
});

describe('useNostrBridgeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('Initial state', () => {
    it('relays starts as empty array', () => {
      const store = useNostrBridgeStore();
      expect(store.relays).toEqual([]);
    });

    it('events starts as empty array', () => {
      const store = useNostrBridgeStore();
      expect(store.events).toEqual([]);
    });

    it('keyPair starts as null', () => {
      const store = useNostrBridgeStore();
      expect(store.keyPair).toBeNull();
    });

    it('loading starts as false', () => {
      const store = useNostrBridgeStore();
      expect(store.loading).toBe(false);
    });

    it('error starts as null', () => {
      const store = useNostrBridgeStore();
      expect(store.error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  describe('Getters', () => {
    it('connectedRelays returns only connected relays', () => {
      const store = useNostrBridgeStore();
      store.relays = [
        makeRelay({ id: '1', status: 'connected' }),
        makeRelay({ id: '2', status: 'disconnected' }),
        makeRelay({ id: '3', status: 'connected' }),
      ];
      expect(store.connectedRelays).toHaveLength(2);
      expect(store.connectedRelays.every(r => r.status === 'connected')).toBe(true);
    });

    it('connectedRelays returns empty array initially', () => {
      const store = useNostrBridgeStore();
      expect(store.connectedRelays).toEqual([]);
    });

    it('relayCount returns number of relays', () => {
      const store = useNostrBridgeStore();
      expect(store.relayCount).toBe(0);
      store.relays = [makeRelay({ id: '1' }), makeRelay({ id: '2' })];
      expect(store.relayCount).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  describe('fetchRelays', () => {
    it('calls IPC and sets relays on success', async () => {
      const store = useNostrBridgeStore();
      const relays = [makeRelay({ id: '1' }), makeRelay({ id: '2' })];
      mockInvoke.mockResolvedValueOnce({ success: true, relays });

      const result = await store.fetchRelays();
      expect(mockInvoke).toHaveBeenCalledWith('nostr:list-relays');
      expect(result.success).toBe(true);
      expect(store.relays).toEqual(relays);
      expect(store.loading).toBe(false);
    });

    it('toggles loading during call', async () => {
      const store = useNostrBridgeStore();
      let loadingDuringCall = false;
      mockInvoke.mockImplementationOnce(() => {
        loadingDuringCall = store.loading;
        return Promise.resolve({ success: true, relays: [] });
      });

      await store.fetchRelays();
      expect(loadingDuringCall).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('sets error when result is not success', async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'No relays configured' });

      await store.fetchRelays();
      expect(store.error).toBe('No relays configured');
    });

    it('catches exceptions and sets error', async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockRejectedValueOnce(new Error('IPC unavailable'));

      const result = await store.fetchRelays();
      expect(store.error).toBe('IPC unavailable');
      expect(result).toEqual({ success: false, error: 'IPC unavailable' });
      expect(store.loading).toBe(false);
    });
  });

  describe('addRelay', () => {
    it('calls IPC and refetches relays on success', async () => {
      const store = useNostrBridgeStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, relays: [makeRelay()] });

      const result = await store.addRelay('wss://new-relay.com');
      expect(mockInvoke).toHaveBeenCalledWith('nostr:add-relay', { url: 'wss://new-relay.com' });
      expect(result.success).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('sets error on failure', async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Invalid URL' });

      await store.addRelay('bad-url');
      expect(store.error).toBe('Invalid URL');
    });

    it('catches exceptions', async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockRejectedValueOnce(new Error('Network fail'));

      const result = await store.addRelay('wss://relay.com');
      expect(store.error).toBe('Network fail');
      expect(result).toEqual({ success: false, error: 'Network fail' });
    });
  });

  describe('publishEvent', () => {
    it('calls IPC with kind, content and tags', async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockResolvedValueOnce({ success: true, eventId: 'evt-1' });

      const result = await store.publishEvent(1, 'Hello world', [['t', 'test']]);
      expect(mockInvoke).toHaveBeenCalledWith('nostr:publish-event', { kind: 1, content: 'Hello world', tags: [['t', 'test']] });
      expect(result.success).toBe(true);
      expect(store.error).toBeNull();
    });

    it('sets error on failure', async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'No key' });

      await store.publishEvent(1, 'test');
      expect(store.error).toBe('No key');
    });

    it('catches exceptions', async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockRejectedValueOnce(new Error('Relay reject'));

      const result = await store.publishEvent(1, 'test');
      expect(store.error).toBe('Relay reject');
      expect(result).toEqual({ success: false, error: 'Relay reject' });
      expect(store.loading).toBe(false);
    });
  });

  describe('fetchEvents', () => {
    it('calls IPC and sets events on success', async () => {
      const store = useNostrBridgeStore();
      const events = [makeEvent({ id: '1' }), makeEvent({ id: '2' })];
      mockInvoke.mockResolvedValueOnce({ success: true, events });

      const result = await store.fetchEvents([1], 50, 1000);
      expect(mockInvoke).toHaveBeenCalledWith('nostr:get-events', { kinds: [1], limit: 50, since: 1000 });
      expect(result.success).toBe(true);
      expect(store.events).toEqual(events);
    });

    it('catches exceptions', async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockRejectedValueOnce(new Error('Timeout'));

      const result = await store.fetchEvents();
      expect(store.error).toBe('Timeout');
      expect(result).toEqual({ success: false, error: 'Timeout' });
      expect(store.loading).toBe(false);
    });
  });

  describe('generateKeyPair', () => {
    it('calls IPC and sets keyPair on success', async () => {
      const store = useNostrBridgeStore();
      const keyPair = { npub: 'npub1...', nsec: 'nsec1...', publicKeyHex: 'abc', privateKeyHex: 'def' };
      mockInvoke.mockResolvedValueOnce({ success: true, keyPair });

      const result = await store.generateKeyPair();
      expect(mockInvoke).toHaveBeenCalledWith('nostr:generate-keypair');
      expect(result.success).toBe(true);
      expect(store.keyPair).toEqual(keyPair);
    });

    it('does not set keyPair on failure', async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Entropy error' });

      await store.generateKeyPair();
      expect(store.keyPair).toBeNull();
    });

    it('catches exceptions', async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockRejectedValueOnce(new Error('Crypto unavailable'));

      const result = await store.generateKeyPair();
      expect(result).toEqual({ success: false, error: 'Crypto unavailable' });
    });
  });

  describe('mapDID', () => {
    it('calls IPC with DID and nostr keys', async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockResolvedValueOnce({ success: true });

      const result = await store.mapDID('did:key:abc', 'npub1...', 'nsec1...');
      expect(mockInvoke).toHaveBeenCalledWith('nostr:map-did', { did: 'did:key:abc', npub: 'npub1...', nsec: 'nsec1...' });
      expect(result.success).toBe(true);
    });

    it('catches exceptions', async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockRejectedValueOnce(new Error('DID invalid'));

      const result = await store.mapDID('bad', 'npub', 'nsec');
      expect(result).toEqual({ success: false, error: 'DID invalid' });
    });
  });
});
