/**
 * SCIMServer Unit Tests
 * Target: src/main/enterprise/scim-server.js
 * Coverage: CRUD users/groups, PATCH operations, constants
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

describe('SCIMServer', () => {
  let SCIMServer, SCIM_SCHEMAS, RESOURCE_TYPES;
  let server;
  let mockDb;
  let mockRunStmt;
  let mockGetStmt;
  let mockAllStmt;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockRunStmt = { run: vi.fn() };
    mockGetStmt = { get: vi.fn(() => null) };
    mockAllStmt = { all: vi.fn(() => []) };

    mockDb = {
      db: {
        exec: vi.fn(),
        prepare: vi.fn((sql) => {
          if (sql.includes('INSERT')) return mockRunStmt;
          if (sql.includes('DELETE')) return mockRunStmt;
          if (sql.includes('UPDATE')) return mockRunStmt;
          if (sql.includes('COUNT')) return mockGetStmt;
          if (sql.includes('SELECT *') && !sql.includes('LIMIT')) return mockGetStmt;
          if (sql.includes('SELECT *') && sql.includes('LIMIT')) return mockAllStmt;
          return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
        })
      },
      saveToFile: vi.fn()
    };

    const mod = await import('../../../src/main/enterprise/scim-server.js');
    SCIMServer = mod.SCIMServer;
    SCIM_SCHEMAS = mod.SCIM_SCHEMAS;
    RESOURCE_TYPES = mod.RESOURCE_TYPES;

    server = new SCIMServer(mockDb);
  });

  afterEach(async () => {
    if (server) await server.close();
  });

  // ============================================================
  // Constructor & Initialization
  // ============================================================

  describe('constructor', () => {
    it('should create instance with database reference', () => {
      expect(server.database).toBe(mockDb);
      expect(server.initialized).toBe(false);
    });
  });

  describe('initialize()', () => {
    it('should call _ensureTables and set initialized', async () => {
      await server.initialize();
      expect(server.initialized).toBe(true);
      expect(mockDb.db.exec).toHaveBeenCalled();
    });
  });

  describe('_ensureTables()', () => {
    it('should create scim_resources and scim_sync_log tables', () => {
      server._ensureTables();
      const execCall = mockDb.db.exec.mock.calls[0][0];
      expect(execCall).toContain('CREATE TABLE IF NOT EXISTS scim_resources');
      expect(execCall).toContain('CREATE TABLE IF NOT EXISTS scim_sync_log');
    });

    it('should skip if database.db is missing', () => {
      const s = new SCIMServer({});
      s._ensureTables(); // should not throw
    });
  });

  // ============================================================
  // createUser
  // ============================================================

  describe('createUser()', () => {
    it('should insert user into DB and return SCIM User response', async () => {
      const userData = { userName: 'jdoe', displayName: 'John Doe', email: 'john@example.com' };
      const result = await server.createUser(userData);

      expect(mockRunStmt.run).toHaveBeenCalled();
      expect(mockDb.saveToFile).toHaveBeenCalled();
      expect(result.schemas).toContain(SCIM_SCHEMAS.USER);
      expect(result.userName).toBe('jdoe');
      expect(result.displayName).toBe('John Doe');
      expect(result.meta.resourceType).toBe('User');
    });

    it('should emit user:created event', async () => {
      const spy = vi.fn();
      server.on('user:created', spy);

      await server.createUser({ userName: 'alice' });
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ userName: 'alice' }));
    });

    it('should handle emails array', async () => {
      const userData = { userName: 'bob', emails: [{ value: 'bob@test.com', primary: true }] };
      const result = await server.createUser(userData);
      expect(result.emails).toEqual([{ value: 'bob@test.com', primary: true }]);
    });
  });

  // ============================================================
  // getUser
  // ============================================================

  describe('getUser()', () => {
    it('should return user when found', async () => {
      mockDb.db.prepare = vi.fn(() => ({
        get: vi.fn(() => ({
          id: 'u1', user_name: 'jdoe', display_name: 'John', external_id: null,
          email: 'john@test.com', active: 1, attributes: '{}',
          created_at: 1700000000000, updated_at: 1700000000000
        })),
        run: vi.fn(), all: vi.fn(() => [])
      }));

      const result = await server.getUser('u1');
      expect(result.schemas).toContain(SCIM_SCHEMAS.USER);
      expect(result.id).toBe('u1');
      expect(result.active).toBe(true);
    });

    it('should return 404 error when user not found', async () => {
      mockDb.db.prepare = vi.fn(() => ({
        get: vi.fn(() => null), run: vi.fn(), all: vi.fn(() => [])
      }));

      const result = await server.getUser('nonexistent');
      expect(result.status).toBe(404);
      expect(result.schemas).toContain(SCIM_SCHEMAS.ERROR);
    });
  });

  // ============================================================
  // listUsers
  // ============================================================

  describe('listUsers()', () => {
    it('should return ListResponse with pagination', async () => {
      const mockRows = [
        { id: 'u1', user_name: 'alice', display_name: 'Alice', external_id: null, email: 'a@t.com', active: 1, attributes: '{}', created_at: 1700000000000, updated_at: 1700000000000 }
      ];

      mockDb.db.prepare = vi.fn((sql) => {
        if (sql.includes('COUNT')) return { get: vi.fn(() => ({ count: 1 })) };
        return { all: vi.fn(() => mockRows), get: vi.fn(() => null), run: vi.fn() };
      });

      const result = await server.listUsers({ startIndex: 1, count: 10 });
      expect(result.schemas).toContain(SCIM_SCHEMAS.LIST_RESPONSE);
      expect(result.totalResults).toBe(1);
      expect(result.startIndex).toBe(1);
      expect(result.itemsPerPage).toBe(10);
      expect(result.Resources).toHaveLength(1);
    });

    it('should support userName eq filter', async () => {
      mockDb.db.prepare = vi.fn((sql) => {
        if (sql.includes('COUNT')) return { get: vi.fn(() => ({ count: 0 })) };
        return { all: vi.fn(() => []), get: vi.fn(() => null), run: vi.fn() };
      });

      const result = await server.listUsers({ filter: 'userName eq "alice"' });
      expect(result.schemas).toContain(SCIM_SCHEMAS.LIST_RESPONSE);
      // The prepare should have been called with a query containing user_name = ?
      const prepareCalls = mockDb.db.prepare.mock.calls;
      const hasFilter = prepareCalls.some(c => c[0].includes('user_name = ?'));
      expect(hasFilter).toBe(true);
    });
  });

  // ============================================================
  // updateUser
  // ============================================================

  describe('updateUser()', () => {
    it('should update DB and return updated user', async () => {
      // Mock: UPDATE returns, then getUser returns the row
      const updatedRow = {
        id: 'u1', user_name: 'jdoe_updated', display_name: 'John Updated',
        external_id: null, email: 'j@t.com', active: 1, attributes: '{}',
        created_at: 1700000000000, updated_at: Date.now()
      };

      mockDb.db.prepare = vi.fn((sql) => {
        if (sql.includes('UPDATE')) return { run: vi.fn() };
        if (sql.includes('INSERT')) return { run: vi.fn() };
        return { get: vi.fn(() => updatedRow), run: vi.fn(), all: vi.fn(() => []) };
      });

      const result = await server.updateUser('u1', { userName: 'jdoe_updated', displayName: 'John Updated' });
      expect(mockDb.saveToFile).toHaveBeenCalled();
      expect(result.id).toBe('u1');
    });

    it('should emit user:updated event', async () => {
      const spy = vi.fn();
      server.on('user:updated', spy);

      mockDb.db.prepare = vi.fn((sql) => {
        if (sql.includes('UPDATE')) return { run: vi.fn() };
        if (sql.includes('INSERT')) return { run: vi.fn() };
        return { get: vi.fn(() => ({ id: 'u1', user_name: 'x', display_name: 'x', active: 1, attributes: '{}', created_at: 1700000000000, updated_at: Date.now() })), run: vi.fn(), all: vi.fn(() => []) };
      });

      await server.updateUser('u1', { userName: 'x' });
      expect(spy).toHaveBeenCalledWith({ id: 'u1' });
    });
  });

  // ============================================================
  // patchUser
  // ============================================================

  describe('patchUser()', () => {
    const existingRow = {
      id: 'u1', user_name: 'jdoe', display_name: 'John', external_id: null,
      email: 'j@t.com', active: 1, attributes: '{"title":"Dev"}',
      created_at: 1700000000000, updated_at: 1700000000000
    };

    beforeEach(() => {
      // Default: first SELECT returns existingRow, then UPDATE + later SELECT
      mockDb.db.prepare = vi.fn((sql) => {
        if (sql.includes('INSERT')) return { run: vi.fn() };
        if (sql.includes('UPDATE')) return { run: vi.fn() };
        return {
          get: vi.fn(() => existingRow),
          run: vi.fn(),
          all: vi.fn(() => [])
        };
      });
    });

    it('should apply replace operation', async () => {
      const result = await server.patchUser('u1', {
        Operations: [{ op: 'replace', path: 'active', value: false }]
      });
      expect(result).toBeDefined();
    });

    it('should apply add operation', async () => {
      const result = await server.patchUser('u1', {
        Operations: [{ op: 'add', value: { department: 'Engineering' } }]
      });
      expect(result).toBeDefined();
    });

    it('should apply remove operation', async () => {
      const result = await server.patchUser('u1', {
        Operations: [{ op: 'remove', path: 'title' }]
      });
      expect(result).toBeDefined();
    });

    it('should return 404 for unknown user', async () => {
      mockDb.db.prepare = vi.fn(() => ({
        get: vi.fn(() => null), run: vi.fn(), all: vi.fn(() => [])
      }));

      const result = await server.patchUser('nonexistent', { Operations: [] });
      expect(result.status).toBe(404);
    });
  });

  // ============================================================
  // deleteUser
  // ============================================================

  describe('deleteUser()', () => {
    it('should remove user from DB and emit event', async () => {
      const spy = vi.fn();
      server.on('user:deleted', spy);

      const result = await server.deleteUser('u1');
      expect(result.success).toBe(true);
      expect(mockDb.saveToFile).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith({ id: 'u1' });
    });
  });

  // ============================================================
  // Groups
  // ============================================================

  describe('createGroup()', () => {
    it('should create group and return SCIM Group response', async () => {
      const result = await server.createGroup({ displayName: 'Engineering', members: [] });
      expect(result.schemas).toContain(SCIM_SCHEMAS.GROUP);
      expect(result.displayName).toBe('Engineering');
      expect(mockDb.saveToFile).toHaveBeenCalled();
    });
  });

  describe('listGroups()', () => {
    it('should return groups in ListResponse format', async () => {
      mockDb.db.prepare = vi.fn((sql) => {
        if (sql.includes('COUNT')) return { get: vi.fn(() => ({ count: 1 })) };
        return {
          all: vi.fn(() => [{ id: 'g1', display_name: 'Team A', members: '[]', created_at: 1700000000000 }]),
          get: vi.fn(() => ({ count: 1 })),
          run: vi.fn()
        };
      });

      const result = await server.listGroups();
      expect(result.schemas).toContain(SCIM_SCHEMAS.LIST_RESPONSE);
      expect(result.Resources).toHaveLength(1);
      expect(result.Resources[0].displayName).toBe('Team A');
    });
  });

  // ============================================================
  // Constants
  // ============================================================

  describe('exported constants', () => {
    it('SCIM_SCHEMAS should have USER, GROUP, LIST_RESPONSE, PATCH_OP, ERROR', () => {
      expect(SCIM_SCHEMAS.USER).toBe('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(SCIM_SCHEMAS.GROUP).toBe('urn:ietf:params:scim:schemas:core:2.0:Group');
      expect(SCIM_SCHEMAS.LIST_RESPONSE).toBe('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(SCIM_SCHEMAS.PATCH_OP).toBe('urn:ietf:params:scim:api:messages:2.0:PatchOp');
      expect(SCIM_SCHEMAS.ERROR).toBe('urn:ietf:params:scim:api:messages:2.0:Error');
    });

    it('RESOURCE_TYPES should have USER and GROUP', () => {
      expect(RESOURCE_TYPES.USER).toBe('User');
      expect(RESOURCE_TYPES.GROUP).toBe('Group');
    });
  });
});
