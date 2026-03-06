/**
 * SCIM IPC Handlers Unit Tests
 * Target: src/main/enterprise/scim-ipc.js
 * Coverage: Registration, handler routing, error handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================
// Mocks
// ============================================================

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn()
  }
}));

describe('SCIM IPC Handlers', () => {
  let registerSCIMIPC, unregisterSCIMIPC, CHANNELS;
  let mockIpcMain;
  let mockScimServer;
  let mockScimSync;
  let handlers;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockIpcMain = {
      handle: vi.fn(),
      removeHandler: vi.fn()
    };

    mockScimServer = {
      listUsers: vi.fn(async () => ({ Resources: [], totalResults: 0 })),
      createUser: vi.fn(async (data) => ({ id: 'u1', userName: data.userName })),
      getUser: vi.fn(async (id) => ({ id, userName: 'jdoe' })),
      deleteUser: vi.fn(async () => ({ success: true })),
    };

    mockScimSync = {
      registerConnector: vi.fn((p) => ({ success: true, provider: p })),
      getConnectors: vi.fn(() => []),
      syncProvider: vi.fn(async (p) => ({ provider: p, created: 0 })),
      getStatus: vi.fn(() => ({ status: 'idle', connectorCount: 0 })),
      getSyncHistory: vi.fn(async () => []),
    };

    const mod = await import('../../../src/main/enterprise/scim-ipc.js');
    registerSCIMIPC = mod.registerSCIMIPC;
    unregisterSCIMIPC = mod.unregisterSCIMIPC;
    CHANNELS = mod.CHANNELS;

    handlers = {};
    mockIpcMain.handle.mockImplementation((_channel, handler) => {
      handlers[_channel] = handler;
    });
  });

  // ============================================================
  // Registration
  // ============================================================

  describe('registerSCIMIPC()', () => {
    it('should register all 8 IPC handlers', () => {
      const result = registerSCIMIPC({
        scimServer: mockScimServer,
        scimSync: mockScimSync,
        ipcMain: mockIpcMain
      });

      expect(result.handlerCount).toBe(8);
      expect(mockIpcMain.handle).toHaveBeenCalledTimes(8);
    });

    it('should register expected channel names', () => {
      registerSCIMIPC({ scimServer: mockScimServer, scimSync: mockScimSync, ipcMain: mockIpcMain });

      const registeredChannels = mockIpcMain.handle.mock.calls.map(c => c[0]);
      expect(registeredChannels).toContain('scim:list-users');
      expect(registeredChannels).toContain('scim:create-user');
      expect(registeredChannels).toContain('scim:get-user');
      expect(registeredChannels).toContain('scim:delete-user');
      expect(registeredChannels).toContain('scim:register-connector');
      expect(registeredChannels).toContain('scim:get-connectors');
      expect(registeredChannels).toContain('scim:sync-provider');
      expect(registeredChannels).toContain('scim:get-status');
    });

    it('all handlers should be async functions', () => {
      registerSCIMIPC({ scimServer: mockScimServer, scimSync: mockScimSync, ipcMain: mockIpcMain });

      for (const [, handler] of Object.entries(handlers)) {
        expect(handler.constructor.name).toBe('AsyncFunction');
      }
    });
  });

  // ============================================================
  // CHANNELS constant
  // ============================================================

  describe('CHANNELS', () => {
    it('should have 8 channels', () => {
      expect(CHANNELS).toHaveLength(8);
    });
  });

  // ============================================================
  // Handler: scim:list-users
  // ============================================================

  describe('scim:list-users handler', () => {
    beforeEach(() => {
      registerSCIMIPC({ scimServer: mockScimServer, scimSync: mockScimSync, ipcMain: mockIpcMain });
    });

    it('should call scimServer.listUsers and return success', async () => {
      const result = await handlers['scim:list-users']({}, { count: 10 });
      expect(result.success).toBe(true);
      expect(mockScimServer.listUsers).toHaveBeenCalledWith({ count: 10 });
    });

    it('should return error when scimServer is null', async () => {
      handlers = {};
      mockIpcMain.handle.mockImplementation((_ch, h) => { handlers[_ch] = h; });
      registerSCIMIPC({ scimServer: null, scimSync: mockScimSync, ipcMain: mockIpcMain });

      const result = await handlers['scim:list-users']({}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });
  });

  // ============================================================
  // Handler: scim:create-user
  // ============================================================

  describe('scim:create-user handler', () => {
    beforeEach(() => {
      registerSCIMIPC({ scimServer: mockScimServer, scimSync: mockScimSync, ipcMain: mockIpcMain });
    });

    it('should call scimServer.createUser and return created user', async () => {
      const result = await handlers['scim:create-user']({}, { userName: 'alice' });
      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(mockScimServer.createUser).toHaveBeenCalledWith({ userName: 'alice' });
    });
  });

  // ============================================================
  // Handler: scim:delete-user
  // ============================================================

  describe('scim:delete-user handler', () => {
    beforeEach(() => {
      registerSCIMIPC({ scimServer: mockScimServer, scimSync: mockScimSync, ipcMain: mockIpcMain });
    });

    it('should call scimServer.deleteUser', async () => {
      const result = await handlers['scim:delete-user']({}, { userId: 'u1' });
      expect(result.success).toBe(true);
      expect(mockScimServer.deleteUser).toHaveBeenCalledWith('u1');
    });
  });

  // ============================================================
  // Handler: scim:register-connector
  // ============================================================

  describe('scim:register-connector handler', () => {
    beforeEach(() => {
      registerSCIMIPC({ scimServer: mockScimServer, scimSync: mockScimSync, ipcMain: mockIpcMain });
    });

    it('should call scimSync.registerConnector', async () => {
      const result = await handlers['scim:register-connector']({}, {
        provider: 'okta',
        config: { endpoint: 'https://okta.example.com' }
      });
      expect(result.success).toBe(true);
      expect(mockScimSync.registerConnector).toHaveBeenCalledWith('okta', { endpoint: 'https://okta.example.com' });
    });

    it('should return error when scimSync is null', async () => {
      handlers = {};
      mockIpcMain.handle.mockImplementation((_ch, h) => { handlers[_ch] = h; });
      registerSCIMIPC({ scimServer: mockScimServer, scimSync: null, ipcMain: mockIpcMain });

      const result = await handlers['scim:register-connector']({}, { provider: 'okta', config: {} });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });
  });

  // ============================================================
  // Handler: scim:sync-provider
  // ============================================================

  describe('scim:sync-provider handler', () => {
    beforeEach(() => {
      registerSCIMIPC({ scimServer: mockScimServer, scimSync: mockScimSync, ipcMain: mockIpcMain });
    });

    it('should call scimSync.syncProvider and return result', async () => {
      const result = await handlers['scim:sync-provider']({}, { provider: 'okta' });
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(mockScimSync.syncProvider).toHaveBeenCalledWith('okta');
    });
  });

  // ============================================================
  // Handler: scim:get-status
  // ============================================================

  describe('scim:get-status handler', () => {
    beforeEach(() => {
      registerSCIMIPC({ scimServer: mockScimServer, scimSync: mockScimSync, ipcMain: mockIpcMain });
    });

    it('should return status and recent history', async () => {
      const result = await handlers['scim:get-status']({});
      expect(result.success).toBe(true);
      expect(result.status).toBe('idle');
      expect(result.recentHistory).toBeDefined();
    });
  });

  // ============================================================
  // unregisterSCIMIPC
  // ============================================================

  describe('unregisterSCIMIPC()', () => {
    it('should call removeHandler for all channels', async () => {
      // The unregister function uses the top-level imported electronIpcMain
      // which is mocked via vi.mock('electron')
      const electron = await import('electron');
      unregisterSCIMIPC();
      expect(electron.ipcMain.removeHandler).toHaveBeenCalledTimes(CHANNELS.length);
    });
  });
});
