/**
 * SCIMSync Unit Tests
 * Target: src/main/enterprise/scim-sync.js
 * Coverage: Connector registration, sync operations, status, history, close
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================
// Mocks
// ============================================================

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-' + Math.random().toString(36).substr(2, 9))
}));

describe('SCIMSync', () => {
  let SCIMSync, SYNC_PROVIDERS, SYNC_STATUS;
  let sync;
  let mockDb;
  let mockScimServer;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockDb = {
      db: {
        exec: vi.fn(),
        prepare: vi.fn(() => ({
          run: vi.fn(),
          get: vi.fn(() => null),
          all: vi.fn(() => [])
        }))
      },
      saveToFile: vi.fn()
    };

    mockScimServer = {
      createUser: vi.fn(),
      listUsers: vi.fn(() => ({ Resources: [] })),
    };

    const mod = await import('../../../src/main/enterprise/scim-sync.js');
    SCIMSync = mod.SCIMSync;
    SYNC_PROVIDERS = mod.SYNC_PROVIDERS;
    SYNC_STATUS = mod.SYNC_STATUS;

    sync = new SCIMSync(mockDb, mockScimServer);
  });

  afterEach(async () => {
    if (sync) await sync.close();
  });

  // ============================================================
  // Constructor
  // ============================================================

  describe('constructor', () => {
    it('should set initial state', () => {
      expect(sync.database).toBe(mockDb);
      expect(sync.scimServer).toBe(mockScimServer);
      expect(sync.initialized).toBe(false);
      expect(sync._syncStatus).toBe(SYNC_STATUS.IDLE);
      expect(sync._lastSyncAt).toBeNull();
    });
  });

  // ============================================================
  // initialize
  // ============================================================

  describe('initialize()', () => {
    it('should set initialized to true', async () => {
      await sync.initialize();
      expect(sync.initialized).toBe(true);
    });

    it('should create interval when autoSync is enabled', async () => {
      vi.useFakeTimers();
      await sync.initialize({ autoSync: true, syncIntervalMs: 1000 });
      expect(sync._syncInterval).not.toBeNull();
      vi.useRealTimers();
    });

    it('should not create interval without autoSync', async () => {
      await sync.initialize();
      expect(sync._syncInterval).toBeNull();
    });
  });

  // ============================================================
  // registerConnector
  // ============================================================

  describe('registerConnector()', () => {
    it('should throw on missing endpoint', () => {
      expect(() => sync.registerConnector('okta', {})).toThrow('Connector endpoint is required');
    });

    it('should store connector successfully', () => {
      const result = sync.registerConnector('okta', { endpoint: 'https://okta.example.com/scim' });
      expect(result.success).toBe(true);
      expect(result.provider).toBe('okta');
    });

    it('should emit connector:registered event', () => {
      const spy = vi.fn();
      sync.on('connector:registered', spy);

      sync.registerConnector('azure', { endpoint: 'https://azure.example.com/scim' });
      expect(spy).toHaveBeenCalledWith({ provider: 'azure' });
    });

    it('should store connector with default enabled=true', () => {
      sync.registerConnector('okta', { endpoint: 'https://okta.example.com' });
      const connectors = sync.getConnectors();
      expect(connectors[0].enabled).toBe(true);
    });

    it('should store connector with enabled=false when specified', () => {
      sync.registerConnector('okta', { endpoint: 'https://okta.example.com', enabled: false });
      const connectors = sync.getConnectors();
      expect(connectors[0].enabled).toBe(false);
    });
  });

  // ============================================================
  // getConnectors
  // ============================================================

  describe('getConnectors()', () => {
    it('should return sanitized connector list (no token)', () => {
      sync.registerConnector('okta', { endpoint: 'https://okta.example.com', token: 'secret-token-123' });
      const list = sync.getConnectors();
      expect(list).toHaveLength(1);
      expect(list[0].provider).toBe('okta');
      expect(list[0].endpoint).toBe('https://okta.example.com');
      expect(list[0]).not.toHaveProperty('token');
    });

    it('should return empty array when no connectors', () => {
      expect(sync.getConnectors()).toEqual([]);
    });
  });

  // ============================================================
  // syncProvider
  // ============================================================

  describe('syncProvider()', () => {
    it('should throw for unknown connector', async () => {
      await expect(sync.syncProvider('unknown')).rejects.toThrow('Connector not found: unknown');
    });

    it('should throw for disabled connector', async () => {
      sync.registerConnector('okta', { endpoint: 'https://okta.example.com', enabled: false });
      await expect(sync.syncProvider('okta')).rejects.toThrow('Connector disabled: okta');
    });

    it('should return sync result with timestamps', async () => {
      sync.registerConnector('okta', { endpoint: 'https://okta.example.com' });

      const result = await sync.syncProvider('okta');
      expect(result.provider).toBe('okta');
      expect(result.startedAt).toBeDefined();
      expect(result.completedAt).toBeDefined();
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
    });

    it('should log sync to DB', async () => {
      sync.registerConnector('okta', { endpoint: 'https://okta.example.com' });
      await sync.syncProvider('okta');

      expect(mockDb.db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO scim_sync_log'));
      expect(mockDb.saveToFile).toHaveBeenCalled();
    });

    it('should update sync status to COMPLETED', async () => {
      sync.registerConnector('okta', { endpoint: 'https://okta.example.com' });
      await sync.syncProvider('okta');

      expect(sync._syncStatus).toBe(SYNC_STATUS.COMPLETED);
      expect(sync._lastSyncAt).not.toBeNull();
    });

    it('should emit sync:started and sync:completed events', async () => {
      const startSpy = vi.fn();
      const completeSpy = vi.fn();
      sync.on('sync:started', startSpy);
      sync.on('sync:completed', completeSpy);

      sync.registerConnector('okta', { endpoint: 'https://okta.example.com' });
      await sync.syncProvider('okta');

      expect(startSpy).toHaveBeenCalledWith({ provider: 'okta' });
      expect(completeSpy).toHaveBeenCalledWith(expect.objectContaining({ provider: 'okta' }));
    });
  });

  // ============================================================
  // syncAll
  // ============================================================

  describe('syncAll()', () => {
    it('should sync all enabled connectors', async () => {
      sync.registerConnector('okta', { endpoint: 'https://okta.example.com' });
      sync.registerConnector('azure', { endpoint: 'https://azure.example.com' });
      sync.registerConnector('disabled', { endpoint: 'https://disabled.example.com', enabled: false });

      const result = await sync.syncAll();
      expect(result.results).toHaveLength(2);
      expect(result.syncedAt).toBeDefined();
    });

    it('should handle errors gracefully in syncAll', async () => {
      sync.registerConnector('okta', { endpoint: 'https://okta.example.com' });
      // Override syncProvider to throw, simulating a failure
      sync.syncProvider = vi.fn().mockRejectedValue(new Error('Sync failed'));

      const result = await sync.syncAll();
      // Should have an error result but not throw
      expect(result.results).toHaveLength(1);
      expect(result.results[0].error).toBeDefined();
    });
  });

  // ============================================================
  // getStatus
  // ============================================================

  describe('getStatus()', () => {
    it('should return current status', () => {
      const status = sync.getStatus();
      expect(status.status).toBe(SYNC_STATUS.IDLE);
      expect(status.lastSyncAt).toBeNull();
      expect(status.connectorCount).toBe(0);
      expect(status.enabledConnectors).toBe(0);
    });

    it('should reflect registered connectors', () => {
      sync.registerConnector('okta', { endpoint: 'https://okta.example.com' });
      sync.registerConnector('azure', { endpoint: 'https://azure.example.com', enabled: false });

      const status = sync.getStatus();
      expect(status.connectorCount).toBe(2);
      expect(status.enabledConnectors).toBe(1);
    });
  });

  // ============================================================
  // getSyncHistory
  // ============================================================

  describe('getSyncHistory()', () => {
    it('should query DB for sync log', async () => {
      const mockRows = [{ id: 'log1', operation: 'sync', provider: 'okta' }];
      mockDb.db.prepare = vi.fn(() => ({
        all: vi.fn(() => mockRows), get: vi.fn(() => null), run: vi.fn()
      }));

      const history = await sync.getSyncHistory();
      expect(history).toEqual(mockRows);
    });

    it('should filter by provider when specified', async () => {
      mockDb.db.prepare = vi.fn(() => ({
        all: vi.fn(() => []), get: vi.fn(() => null), run: vi.fn()
      }));

      await sync.getSyncHistory({ provider: 'okta' });
      expect(mockDb.db.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE provider = ?'));
    });

    it('should return empty array when no database', async () => {
      const s = new SCIMSync(null, null);
      const history = await s.getSyncHistory();
      expect(history).toEqual([]);
    });
  });

  // ============================================================
  // close
  // ============================================================

  describe('close()', () => {
    it('should clear interval and connectors', async () => {
      vi.useFakeTimers();
      await sync.initialize({ autoSync: true, syncIntervalMs: 60000 });
      sync.registerConnector('okta', { endpoint: 'https://okta.example.com' });

      await sync.close();

      expect(sync._syncInterval).toBeNull();
      expect(sync.getConnectors()).toEqual([]);
      expect(sync.initialized).toBe(false);
      vi.useRealTimers();
    });
  });

  // ============================================================
  // Constants
  // ============================================================

  describe('constants', () => {
    it('SYNC_PROVIDERS should have AZURE_AD, OKTA, ONELOGIN, CUSTOM', () => {
      expect(SYNC_PROVIDERS.AZURE_AD).toBe('azure_ad');
      expect(SYNC_PROVIDERS.OKTA).toBe('okta');
      expect(SYNC_PROVIDERS.ONELOGIN).toBe('onelogin');
      expect(SYNC_PROVIDERS.CUSTOM).toBe('custom');
    });

    it('SYNC_STATUS should have IDLE, RUNNING, COMPLETED, FAILED', () => {
      expect(SYNC_STATUS.IDLE).toBe('idle');
      expect(SYNC_STATUS.RUNNING).toBe('running');
      expect(SYNC_STATUS.COMPLETED).toBe('completed');
      expect(SYNC_STATUS.FAILED).toBe('failed');
    });
  });
});
