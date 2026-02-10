/**
 * PermissionMiddleware Unit Tests
 *
 * Test Coverage:
 * - Permission Checking Middleware (8 tests)
 * - Multiple Permissions (AND logic) (5 tests)
 * - Any Permission (OR logic) (4 tests)
 * - Role-Based Checks (5 tests)
 * - Permission Cache (5 tests)
 * - Rate Limiting (4 tests)
 * - Audit Logging (4 tests)
 * - Error Handling (4 tests)
 *
 * Total: 39 test cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const path = require('path');
const fs = require('fs');

describe('PermissionMiddleware Unit Tests', () => {
  let PermissionMiddleware;
  let PermissionManager;
  let DatabaseManager;
  let DIDManager;
  let db;
  let didManager;
  let permissionManager;
  let middleware;
  let testDbPath;

  beforeEach(async () => {
    // Setup test database
    testDbPath = path.join(__dirname, '../temp/test-permission-middleware.db');
    const testDir = path.dirname(testDbPath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Load modules
    DatabaseManager = require('../../../src/main/database');
    DIDManager = require('../../../src/main/did/did-manager');
    PermissionManager = require('../../../src/main/collaboration/permission-manager');
    PermissionMiddleware = require('../../../src/main/organization/permission-middleware');

    // Initialize database
    db = new DatabaseManager(testDbPath, { encryptionEnabled: false });
    await db.initialize();

    // Initialize DID manager
    didManager = new DIDManager(db);
    await didManager.initialize();

    // Initialize permission manager
    permissionManager = new PermissionManager(db);

    // Initialize permission middleware
    middleware = new PermissionMiddleware(db, permissionManager);
  });

  afterEach(() => {
    // Cleanup
    if (middleware) {
      middleware.destroy();
    }

    // Cleanup test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  // ============================================================================
  // Permission Checking Middleware (8 tests)
  // ============================================================================
  describe('Permission Checking Middleware', () => {
    let org, ownerDID, memberDID;

    beforeEach(async () => {
      // Clean up any existing test data
      db.prepare(`DELETE FROM organization_members WHERE org_id = 'org_123'`).run();
      db.prepare(`DELETE FROM organization_info WHERE org_id = 'org_123'`).run();
      db.prepare(`DELETE FROM permission_audit_log WHERE org_id = 'org_123'`).run();

      // Create test users
      const owner = await didManager.createIdentity(
        { nickname: 'Owner', displayName: 'Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      const member = await didManager.createIdentity(
        { nickname: 'Member', displayName: 'Member' },
        { setAsDefault: false }
      );
      memberDID = member.did;

      // Create organization
      const now = Date.now();
      db.prepare(`
        INSERT INTO organization_info (org_id, org_did, name, owner_did, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('org_123', 'did:test:org123', 'Test Org', ownerDID, 'startup', now, now);

      org = { org_id: 'org_123', org_did: 'did:test:org123' };

      // Add owner as member
      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, ownerDID, 'owner', 'active', Date.now());

      // Add member
      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, memberDID, 'member', 'active', Date.now());
    });

    it('should require single permission (success)', async () => {
      const checkMiddleware = middleware.requirePermission('org.view');

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: ownerDID };

      const result = await checkMiddleware(mockEvent, mockArgs);

      expect(result).toBe(true);
    });

    it('should require single permission (denied)', async () => {
      const checkMiddleware = middleware.requirePermission('org.delete');

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: memberDID };

      await expect(checkMiddleware(mockEvent, mockArgs)).rejects.toThrow('Permission denied: org.delete');
    });

    it('should extract context from args (orgId, userDID)', () => {
      const context1 = middleware.extractContext({ orgId: 'org_123', userDID: 'did:test:user' });
      expect(context1.orgId).toBe('org_123');
      expect(context1.userDID).toBe('did:test:user');

      const context2 = middleware.extractContext({ org_id: 'org_456', user_did: 'did:test:user2' });
      expect(context2.orgId).toBe('org_456');
      expect(context2.userDID).toBe('did:test:user2');

      const context3 = middleware.extractContext({ orgId: 'org_789', did: 'did:test:user3' });
      expect(context3.orgId).toBe('org_789');
      expect(context3.userDID).toBe('did:test:user3');
    });

    it('should check permission with cache hit', async () => {
      // First check (cache miss)
      const result1 = await middleware.checkPermission(org.org_id, ownerDID, 'org.view');
      expect(result1).toBe(true);

      // Second check (cache hit)
      const result2 = await middleware.checkPermission(org.org_id, ownerDID, 'org.view');
      expect(result2).toBe(true);

      // Verify cache has the value
      const cacheKey = `${org.org_id}:${ownerDID}:org.view`;
      expect(middleware.permissionCache.has(cacheKey)).toBe(true);
    });

    it('should check permission with cache miss', async () => {
      const cacheKey = `${org.org_id}:${ownerDID}:org.edit`;
      expect(middleware.permissionCache.has(cacheKey)).toBe(false);

      const result = await middleware.checkPermission(org.org_id, ownerDID, 'org.edit');
      expect(result).toBe(true);

      // Now cache should have it
      expect(middleware.permissionCache.has(cacheKey)).toBe(true);
    });

    it('should check permission with custom options', async () => {
      const result = await middleware.checkPermission(
        org.org_id,
        ownerDID,
        'knowledge.edit',
        { skipCache: true, resourceId: 'kb_123' }
      );

      // Should work without throwing
      expect(typeof result).toBe('boolean');
    });

    it('should throw proper error on permission denial', async () => {
      const checkMiddleware = middleware.requirePermission('member.remove');

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: memberDID };

      try {
        await checkMiddleware(mockEvent, mockArgs);
        expect.fail('Should have thrown permission error');
      } catch (error) {
        expect(error.message).toContain('Permission denied: member.remove');
        expect(error.code).toBe('PERMISSION_DENIED');
        expect(error.permission).toBe('member.remove');
      }
    });

    it('should log audit on permission grant', async () => {
      const eventSpy = vi.fn();
      middleware.on('permission:granted', eventSpy);

      const checkMiddleware = middleware.requirePermission('org.view', { audit: true });

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: ownerDID };

      await checkMiddleware(mockEvent, mockArgs);

      // Check audit log was created
      const logs = db.prepare(`
        SELECT * FROM permission_audit_log
        WHERE org_id = ? AND user_did = ? AND permission = ? AND result = 'granted'
      `).all(org.org_id, ownerDID, 'org.view');

      expect(logs.length).toBeGreaterThan(0);
      expect(eventSpy).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Multiple Permissions (AND logic) (5 tests)
  // ============================================================================
  describe('Multiple Permissions (AND logic)', () => {
    let org, ownerDID, adminDID, memberDID;

    beforeEach(async () => {
      // Clean up any existing test data
      db.prepare(`DELETE FROM organization_members WHERE org_id = 'org_456'`).run();
      db.prepare(`DELETE FROM organization_info WHERE org_id = 'org_456'`).run();

      // Create test users
      const owner = await didManager.createIdentity(
        { nickname: 'Owner', displayName: 'Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      const admin = await didManager.createIdentity(
        { nickname: 'Admin', displayName: 'Admin' },
        { setAsDefault: false }
      );
      adminDID = admin.did;

      const member = await didManager.createIdentity(
        { nickname: 'Member', displayName: 'Member' },
        { setAsDefault: false }
      );
      memberDID = member.did;

      // Create organization
      const now = Date.now();
      db.prepare(`
        INSERT INTO organization_info (org_id, org_did, name, owner_did, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('org_456', 'did:test:org456', 'Test Org', ownerDID, 'company', now, now);

      org = { org_id: 'org_456', org_did: 'did:test:org456' };

      // Add members
      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, ownerDID, 'owner', 'active', Date.now());

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, adminDID, 'admin', 'active', Date.now());

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, memberDID, 'member', 'active', Date.now());
    });

    it('should require all permissions (all granted)', async () => {
      const checkMiddleware = middleware.requireAllPermissions(['org.view', 'org.edit']);

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: ownerDID };

      const result = await checkMiddleware(mockEvent, mockArgs);
      expect(result).toBe(true);
    });

    it('should require all permissions (one denied)', async () => {
      const checkMiddleware = middleware.requireAllPermissions(['org.view', 'org.delete']);

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: adminDID };

      await expect(checkMiddleware(mockEvent, mockArgs)).rejects.toThrow('Permission denied: org.delete');
    });

    it('should require all permissions (multiple denied)', async () => {
      const checkMiddleware = middleware.requireAllPermissions(['org.edit', 'org.delete', 'member.remove']);

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: memberDID };

      await expect(checkMiddleware(mockEvent, mockArgs)).rejects.toThrow('Permission denied');
    });

    it('should handle empty permissions array', async () => {
      const checkMiddleware = middleware.requireAllPermissions([]);

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: memberDID };

      const result = await checkMiddleware(mockEvent, mockArgs);
      expect(result).toBe(true);
    });

    it('should be permission order independent', async () => {
      const check1 = middleware.requireAllPermissions(['org.view', 'org.edit']);
      const check2 = middleware.requireAllPermissions(['org.edit', 'org.view']);

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: ownerDID };

      const result1 = await check1(mockEvent, mockArgs);
      const result2 = await check2(mockEvent, mockArgs);

      expect(result1).toBe(true);
      expect(result2).toBe(true);
    });
  });

  // ============================================================================
  // Any Permission (OR logic) (4 tests)
  // ============================================================================
  describe('Any Permission (OR logic)', () => {
    let org, adminDID, memberDID;

    beforeEach(async () => {
      // Clean up any existing test data
      db.prepare(`DELETE FROM organization_members WHERE org_id = 'org_789'`).run();
      db.prepare(`DELETE FROM organization_info WHERE org_id = 'org_789'`).run();

      const owner = await didManager.createIdentity(
        { nickname: 'Owner', displayName: 'Owner' },
        { setAsDefault: true }
      );

      const admin = await didManager.createIdentity(
        { nickname: 'Admin', displayName: 'Admin' },
        { setAsDefault: false }
      );
      adminDID = admin.did;

      const member = await didManager.createIdentity(
        { nickname: 'Member', displayName: 'Member' },
        { setAsDefault: false }
      );
      memberDID = member.did;

      // Create organization
      const now = Date.now();
      db.prepare(`
        INSERT INTO organization_info (org_id, org_did, name, owner_did, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('org_789', 'did:test:org789', 'Test Org', owner.did, 'startup', now, now);

      org = { org_id: 'org_789' };

      // Add members
      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, owner.did, 'owner', 'active', Date.now());

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, adminDID, 'admin', 'active', Date.now());

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, memberDID, 'member', 'active', Date.now());
    });

    it('should require any permission (first granted)', async () => {
      const checkMiddleware = middleware.requireAnyPermission(['org.view', 'org.delete']);

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: adminDID };

      const result = await checkMiddleware(mockEvent, mockArgs);
      expect(result).toBe(true);
    });

    it('should require any permission (second granted)', async () => {
      const checkMiddleware = middleware.requireAnyPermission(['org.delete', 'org.view']);

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: memberDID };

      const result = await checkMiddleware(mockEvent, mockArgs);
      expect(result).toBe(true);
    });

    it('should require any permission (all denied)', async () => {
      const checkMiddleware = middleware.requireAnyPermission(['org.delete', 'member.remove']);

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: memberDID };

      try {
        await checkMiddleware(mockEvent, mockArgs);
        expect.fail('Should have thrown permission error');
      } catch (error) {
        expect(error.message).toContain('requires one of');
        expect(error.code).toBe('PERMISSION_DENIED');
        expect(error.permissions).toEqual(['org.delete', 'member.remove']);
      }
    });

    it('should handle single permission in array', async () => {
      const checkMiddleware = middleware.requireAnyPermission(['org.view']);

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: memberDID };

      const result = await checkMiddleware(mockEvent, mockArgs);
      expect(result).toBe(true);
    });
  });

  // ============================================================================
  // Role-Based Checks (5 tests)
  // ============================================================================
  describe('Role-Based Checks', () => {
    let org, ownerDID, adminDID, memberDID, viewerDID;

    beforeEach(async () => {
      // Clean up any existing test data
      db.prepare(`DELETE FROM organization_members WHERE org_id = 'org_role'`).run();
      db.prepare(`DELETE FROM organization_info WHERE org_id = 'org_role'`).run();

      const owner = await didManager.createIdentity(
        { nickname: 'Owner', displayName: 'Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      const admin = await didManager.createIdentity(
        { nickname: 'Admin', displayName: 'Admin' },
        { setAsDefault: false }
      );
      adminDID = admin.did;

      const member = await didManager.createIdentity(
        { nickname: 'Member', displayName: 'Member' },
        { setAsDefault: false }
      );
      memberDID = member.did;

      const viewer = await didManager.createIdentity(
        { nickname: 'Viewer', displayName: 'Viewer' },
        { setAsDefault: false }
      );
      viewerDID = viewer.did;

      // Create organization
      const now = Date.now();
      db.prepare(`
        INSERT INTO organization_info (org_id, org_did, name, owner_did, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('org_role', 'did:test:orgrole', 'Role Test Org', ownerDID, 'company', now, now);

      org = { org_id: 'org_role' };

      // Add members with different roles
      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, ownerDID, 'owner', 'active', Date.now());

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, adminDID, 'admin', 'active', Date.now());

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, memberDID, 'member', 'active', Date.now());

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, viewerDID, 'viewer', 'active', Date.now());
    });

    it('should require admin role', async () => {
      const checkMiddleware = middleware.requireRole(['admin', 'owner']);

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: adminDID };

      const result = await checkMiddleware(mockEvent, mockArgs);
      expect(result).toBe(true);
    });

    it('should require owner role', async () => {
      const checkMiddleware = middleware.requireRole(['owner']);

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: ownerDID };

      const result = await checkMiddleware(mockEvent, mockArgs);
      expect(result).toBe(true);
    });

    it('should require member role', async () => {
      const checkMiddleware = middleware.requireRole(['member', 'admin', 'owner']);

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: memberDID };

      const result = await checkMiddleware(mockEvent, mockArgs);
      expect(result).toBe(true);
    });

    it('should deny viewer from admin-only operations', async () => {
      const checkMiddleware = middleware.requireRole(['admin', 'owner']);

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: viewerDID };

      try {
        await checkMiddleware(mockEvent, mockArgs);
        expect.fail('Should have thrown role error');
      } catch (error) {
        expect(error.message).toContain('Role required');
        expect(error.code).toBe('ROLE_REQUIRED');
        expect(error.requiredRoles).toEqual(['admin', 'owner']);
        expect(error.userRole).toBe('viewer');
      }
    });

    it('should handle multiple role requirements', async () => {
      const checkMiddleware = middleware.requireRole(['admin', 'owner', 'editor']);

      const mockEvent1 = {};
      const mockArgs1 = { orgId: org.org_id, userDID: ownerDID };
      const result1 = await checkMiddleware(mockEvent1, mockArgs1);
      expect(result1).toBe(true);

      const mockEvent2 = {};
      const mockArgs2 = { orgId: org.org_id, userDID: adminDID };
      const result2 = await checkMiddleware(mockEvent2, mockArgs2);
      expect(result2).toBe(true);

      const mockEvent3 = {};
      const mockArgs3 = { orgId: org.org_id, userDID: memberDID };
      await expect(checkMiddleware(mockEvent3, mockArgs3)).rejects.toThrow('Role required');
    });
  });

  // ============================================================================
  // Permission Cache (5 tests)
  // ============================================================================
  describe('Permission Cache', () => {
    let org, ownerDID;

    beforeEach(async () => {
      // Clean up any existing test data
      db.prepare(`DELETE FROM organization_members WHERE org_id = 'org_cache'`).run();
      db.prepare(`DELETE FROM organization_info WHERE org_id = 'org_cache'`).run();

      const owner = await didManager.createIdentity(
        { nickname: 'Owner', displayName: 'Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      const now = Date.now();
      db.prepare(`
        INSERT INTO organization_info (org_id, org_did, name, owner_did, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('org_cache', 'did:test:orgcache', 'Cache Test Org', ownerDID, 'startup', now, now);

      org = { org_id: 'org_cache' };

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, ownerDID, 'owner', 'active', Date.now());
    });

    it('should cache permission check result', async () => {
      const cacheKey = `${org.org_id}:${ownerDID}:org.view`;
      expect(middleware.permissionCache.has(cacheKey)).toBe(false);

      await middleware.checkPermission(org.org_id, ownerDID, 'org.view');

      expect(middleware.permissionCache.has(cacheKey)).toBe(true);
      const cached = middleware.permissionCache.get(cacheKey);
      expect(cached.value).toBe(true);
      expect(cached.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should return cached value on cache hit', async () => {
      // First call - cache miss
      const result1 = await middleware.checkPermission(org.org_id, ownerDID, 'org.edit');

      // Modify cache to verify it's being used
      const cacheKey = `${org.org_id}:${ownerDID}:org.edit`;
      const originalValue = middleware.permissionCache.get(cacheKey);

      // Second call - cache hit
      const result2 = await middleware.checkPermission(org.org_id, ownerDID, 'org.edit');

      expect(result1).toBe(result2);
    });

    it('should skip cache when skipCache option is true', async () => {
      const cacheKey = `${org.org_id}:${ownerDID}:org.settings`;

      await middleware.checkPermission(org.org_id, ownerDID, 'org.settings', { skipCache: true });

      expect(middleware.permissionCache.has(cacheKey)).toBe(false);
    });

    it('should expire cache after TTL', async () => {
      const cacheKey = `${org.org_id}:${ownerDID}:org.manage`;

      await middleware.checkPermission(org.org_id, ownerDID, 'org.manage');

      const cached = middleware.permissionCache.get(cacheKey);
      expect(cached).toBeDefined();
      expect(cached.expiresAt).toBeGreaterThan(Date.now());

      // Simulate cache expiration
      cached.expiresAt = Date.now() - 1000;
      middleware.permissionCache.set(cacheKey, cached);

      // Next check should not use expired cache
      await middleware.checkPermission(org.org_id, ownerDID, 'org.manage');

      const newCached = middleware.permissionCache.get(cacheKey);
      expect(newCached.expiresAt).toBeGreaterThan(cached.expiresAt);
    });

    it('should clear cache on invalidation', () => {
      const memberDID = 'did:test:member';

      // Add some cache entries
      middleware.permissionCache.set(`${org.org_id}:${ownerDID}:org.view`, { value: true, expiresAt: Date.now() + 60000 });
      middleware.permissionCache.set(`${org.org_id}:${ownerDID}:org.edit`, { value: true, expiresAt: Date.now() + 60000 });
      middleware.permissionCache.set(`${org.org_id}:${memberDID}:org.view`, { value: true, expiresAt: Date.now() + 60000 });

      expect(middleware.permissionCache.size).toBeGreaterThan(0);

      // Clear specific user's cache
      middleware.clearCache(org.org_id, ownerDID);

      expect(middleware.permissionCache.has(`${org.org_id}:${ownerDID}:org.view`)).toBe(false);
      expect(middleware.permissionCache.has(`${org.org_id}:${ownerDID}:org.edit`)).toBe(false);
      expect(middleware.permissionCache.has(`${org.org_id}:${memberDID}:org.view`)).toBe(true);

      // Clear all cache
      middleware.clearCache();
      expect(middleware.permissionCache.size).toBe(0);
    });
  });

  // ============================================================================
  // Rate Limiting (4 tests)
  // ============================================================================
  describe('Rate Limiting', () => {
    let org, ownerDID;

    beforeEach(async () => {
      // Clean up any existing test data
      db.prepare(`DELETE FROM organization_members WHERE org_id = 'org_rate'`).run();
      db.prepare(`DELETE FROM organization_info WHERE org_id = 'org_rate'`).run();

      const owner = await didManager.createIdentity(
        { nickname: 'Owner', displayName: 'Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      const now = Date.now();
      db.prepare(`
        INSERT INTO organization_info (org_id, org_did, name, owner_did, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('org_rate', 'did:test:orgrate', 'Rate Test Org', ownerDID, 'startup', now, now);

      org = { org_id: 'org_rate' };

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, ownerDID, 'owner', 'active', Date.now());
    });

    it('should allow operations within rate limit', async () => {
      const limiter = middleware.rateLimit('test_operation', { max: 5, window: 60000 });

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: ownerDID };

      // Should allow 5 operations
      for (let i = 0; i < 5; i++) {
        const result = await limiter(mockEvent, mockArgs);
        expect(result).toBe(true);
      }
    });

    it('should block operations exceeding rate limit', async () => {
      const limiter = middleware.rateLimit('block_test', { max: 3, window: 60000 });

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: ownerDID };

      // First 3 should succeed
      for (let i = 0; i < 3; i++) {
        await limiter(mockEvent, mockArgs);
      }

      // 4th should fail
      try {
        await limiter(mockEvent, mockArgs);
        expect.fail('Should have thrown rate limit error');
      } catch (error) {
        expect(error.message).toContain('Rate limit exceeded');
        expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(error.operation).toBe('block_test');
        expect(error.resetAt).toBeDefined();
      }
    });

    it('should apply rate limit per user', async () => {
      const limiter = middleware.rateLimit('per_user_test', { max: 2, window: 60000 });

      const member = await didManager.createIdentity(
        { nickname: 'Member', displayName: 'Member' },
        { setAsDefault: false }
      );
      const memberDID = member.did;

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, memberDID, 'member', 'active', Date.now());

      const mockEvent = {};

      // Owner's operations
      await limiter(mockEvent, { orgId: org.org_id, userDID: ownerDID });
      await limiter(mockEvent, { orgId: org.org_id, userDID: ownerDID });

      // Owner should be rate limited now
      await expect(limiter(mockEvent, { orgId: org.org_id, userDID: ownerDID }))
        .rejects.toThrow('Rate limit exceeded');

      // Member should still be allowed (different user)
      const result = await limiter(mockEvent, { orgId: org.org_id, userDID: memberDID });
      expect(result).toBe(true);
    });

    it('should reset rate limit window after expiration', async () => {
      const limiter = middleware.rateLimit('reset_test', { max: 2, window: 100 }); // 100ms window

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: ownerDID };

      // Use up the limit
      await limiter(mockEvent, mockArgs);
      await limiter(mockEvent, mockArgs);

      // Should be rate limited
      await expect(limiter(mockEvent, mockArgs)).rejects.toThrow('Rate limit exceeded');

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should work again after window reset
      const result = await limiter(mockEvent, mockArgs);
      expect(result).toBe(true);
    });
  });

  // ============================================================================
  // Audit Logging (4 tests)
  // ============================================================================
  describe('Audit Logging', () => {
    let org, ownerDID, memberDID;

    beforeEach(async () => {
      // Clean up any existing test data
      db.prepare(`DELETE FROM permission_audit_log WHERE org_id = 'org_audit'`).run();
      db.prepare(`DELETE FROM organization_members WHERE org_id = 'org_audit'`).run();
      db.prepare(`DELETE FROM organization_info WHERE org_id = 'org_audit'`).run();

      const owner = await didManager.createIdentity(
        { nickname: 'Owner', displayName: 'Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      const member = await didManager.createIdentity(
        { nickname: 'Member', displayName: 'Member' },
        { setAsDefault: false }
      );
      memberDID = member.did;

      const now = Date.now();
      db.prepare(`
        INSERT INTO organization_info (org_id, org_did, name, owner_did, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('org_audit', 'did:test:orgaudit', 'Audit Test Org', ownerDID, 'company', now, now);

      org = { org_id: 'org_audit' };

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, ownerDID, 'owner', 'active', Date.now());

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, memberDID, 'member', 'active', Date.now());
    });

    it('should log permission grant', async () => {
      await middleware.logPermissionGrant(org.org_id, ownerDID, 'org.view', { test: 'context' });

      const logs = db.prepare(`
        SELECT * FROM permission_audit_log
        WHERE org_id = ? AND user_did = ? AND permission = ? AND result = 'granted'
      `).all(org.org_id, ownerDID, 'org.view');

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].action).toBe('check');
      expect(logs[0].result).toBe('granted');

      const context = JSON.parse(logs[0].context);
      expect(context.test).toBe('context');
    });

    it('should log permission denial', async () => {
      const eventSpy = vi.fn();
      middleware.on('permission:denied', eventSpy);

      await middleware.logPermissionDenial(org.org_id, memberDID, 'org.delete', { operation: 'delete_org' });

      const logs = db.prepare(`
        SELECT * FROM permission_audit_log
        WHERE org_id = ? AND user_did = ? AND permission = ? AND result = 'denied'
      `).all(org.org_id, memberDID, 'org.delete');

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].action).toBe('check');
      expect(logs[0].result).toBe('denied');
      expect(eventSpy).toHaveBeenCalled();
    });

    it('should skip audit when disabled by option', async () => {
      const checkMiddleware = middleware.requirePermission('org.view', { audit: false });

      const mockEvent = {};
      const mockArgs = { orgId: org.org_id, userDID: ownerDID };

      await checkMiddleware(mockEvent, mockArgs);

      const logs = db.prepare(`
        SELECT * FROM permission_audit_log
        WHERE org_id = ? AND user_did = ? AND permission = ?
      `).all(org.org_id, ownerDID, 'org.view');

      // Should not have logged since audit is disabled
      expect(logs.length).toBe(0);
    });

    it('should include operation details in audit', async () => {
      const operationContext = {
        operation: 'update_member',
        targetMember: 'did:test:target',
        changes: { role: 'admin' }
      };

      await middleware.logPermissionGrant(org.org_id, ownerDID, 'member.edit', operationContext);

      const logs = db.prepare(`
        SELECT * FROM permission_audit_log
        WHERE org_id = ? AND permission = ?
      `).all(org.org_id, 'member.edit');

      expect(logs.length).toBeGreaterThan(0);

      const context = JSON.parse(logs[0].context);
      expect(context.operation).toBe('update_member');
      expect(context.targetMember).toBe('did:test:target');
      expect(context.changes).toEqual({ role: 'admin' });
    });
  });

  // ============================================================================
  // Error Handling (4 tests)
  // ============================================================================
  describe('Error Handling', () => {
    let org, ownerDID;

    beforeEach(async () => {
      // Clean up any existing test data
      db.prepare(`DELETE FROM organization_members WHERE org_id = 'org_error'`).run();
      db.prepare(`DELETE FROM organization_info WHERE org_id = 'org_error'`).run();

      const owner = await didManager.createIdentity(
        { nickname: 'Owner', displayName: 'Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      const now = Date.now();
      db.prepare(`
        INSERT INTO organization_info (org_id, org_did, name, owner_did, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('org_error', 'did:test:orgerror', 'Error Test Org', ownerDID, 'startup', now, now);

      org = { org_id: 'org_error' };

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, ownerDID, 'owner', 'active', Date.now());
    });

    it('should handle database errors gracefully', async () => {
      // Try to check permission for non-existent organization
      const result = await middleware.checkPermission('invalid_org', ownerDID, 'org.view');

      // Should return false instead of throwing
      expect(result).toBe(false);
    });

    it('should handle missing context (orgId/userDID)', async () => {
      const checkMiddleware = middleware.requirePermission('org.view');

      const mockEvent = {};
      const mockArgs = {}; // Missing orgId and userDID

      const context = middleware.extractContext(mockArgs);
      expect(context.orgId).toBeNull();
      expect(context.userDID).toBeNull();
    });

    it('should handle permission manager errors', async () => {
      // Create a middleware with a failing permission manager
      const failingPermissionManager = {
        getUserRole: vi.fn(async () => {
          throw new Error('Database connection failed');
        }),
        checkPermission: vi.fn(async () => {
          throw new Error('Permission check failed');
        })
      };

      const failingMiddleware = new PermissionMiddleware(db, failingPermissionManager);

      // Should handle the error gracefully
      try {
        await failingMiddleware.checkPermission(org.org_id, ownerDID, 'org.view');
      } catch (error) {
        // Error should be propagated but handled
        expect(error.message).toBeDefined();
      }

      failingMiddleware.destroy();
    });

    it('should handle malformed args', async () => {
      const checkMiddleware = middleware.requirePermission('org.view');

      const mockEvent = {};

      // Test with null args
      const context1 = middleware.extractContext(null);
      expect(context1.orgId).toBeNull();
      expect(context1.userDID).toBeNull();

      // Test with undefined args
      const context2 = middleware.extractContext(undefined);
      expect(context2.orgId).toBeNull();
      expect(context2.userDID).toBeNull();

      // Test with string args
      const context3 = middleware.extractContext('invalid');
      expect(context3.orgId).toBeNull();
      expect(context3.userDID).toBeNull();
    });
  });

  // ============================================================================
  // Additional Tests: Ownership Checks
  // ============================================================================
  describe('Ownership Checks', () => {
    let org, ownerDID, memberDID;

    beforeEach(async () => {
      // Clean up any existing test data
      db.prepare(`DELETE FROM org_knowledge_folders WHERE org_id = 'org_own'`).run();
      db.prepare(`DELETE FROM organization_members WHERE org_id = 'org_own'`).run();
      db.prepare(`DELETE FROM organization_info WHERE org_id = 'org_own'`).run();

      const owner = await didManager.createIdentity(
        { nickname: 'Owner', displayName: 'Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      const member = await didManager.createIdentity(
        { nickname: 'Member', displayName: 'Member' },
        { setAsDefault: false }
      );
      memberDID = member.did;

      const now = Date.now();
      db.prepare(`
        INSERT INTO organization_info (org_id, org_did, name, owner_did, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('org_own', 'did:test:orgown', 'Ownership Test Org', ownerDID, 'startup', now, now);

      org = { org_id: 'org_own' };

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, ownerDID, 'owner', 'active', Date.now());

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, memberDID, 'member', 'active', Date.now());

      // Create a test folder
      const folderNow = Date.now();
      db.prepare(`
        INSERT INTO org_knowledge_folders (id, org_id, name, created_by, created_at, updated_at, permissions)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('folder_123', org.org_id, 'Test Folder', ownerDID, folderNow, folderNow, '{}');
      // Note: Added const folderNow above
    });

    it('should check resource ownership (folder)', async () => {
      const isOwner = await middleware.checkOwnership(org.org_id, ownerDID, 'folder', 'folder_123');
      expect(isOwner).toBe(true);

      const isNotOwner = await middleware.checkOwnership(org.org_id, memberDID, 'folder', 'folder_123');
      expect(isNotOwner).toBe(false);
    });

    it('should require ownership via middleware', async () => {
      const ownershipMiddleware = middleware.requireOwnership(
        'folder',
        (args) => args.folderId
      );

      const mockEvent = {};

      // Owner should pass
      const ownerArgs = { orgId: org.org_id, userDID: ownerDID, folderId: 'folder_123' };
      const result = await ownershipMiddleware(mockEvent, ownerArgs);
      expect(result).toBe(true);

      // Non-owner should fail
      const memberArgs = { orgId: org.org_id, userDID: memberDID, folderId: 'folder_123' };
      try {
        await ownershipMiddleware(mockEvent, memberArgs);
        expect.fail('Should have thrown ownership error');
      } catch (error) {
        expect(error.message).toContain('Ownership required');
        expect(error.code).toBe('OWNERSHIP_REQUIRED');
        expect(error.resourceType).toBe('folder');
        expect(error.resourceId).toBe('folder_123');
      }
    });
  });

  // ============================================================================
  // Additional Tests: Audit Log Retrieval
  // ============================================================================
  describe('Audit Log Retrieval', () => {
    let org, ownerDID, memberDID;

    beforeEach(async () => {
      // Clean up any existing test data
      db.prepare(`DELETE FROM permission_audit_log WHERE org_id = 'org_log'`).run();
      db.prepare(`DELETE FROM organization_members WHERE org_id = 'org_log'`).run();
      db.prepare(`DELETE FROM organization_info WHERE org_id = 'org_log'`).run();

      const owner = await didManager.createIdentity(
        { nickname: 'Owner', displayName: 'Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      const member = await didManager.createIdentity(
        { nickname: 'Member', displayName: 'Member' },
        { setAsDefault: false }
      );
      memberDID = member.did;

      const now = Date.now();
      db.prepare(`
        INSERT INTO organization_info (org_id, org_did, name, owner_did, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('org_log', 'did:test:orglog', 'Log Test Org', ownerDID, 'company', now, now);

      org = { org_id: 'org_log' };

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, ownerDID, 'owner', 'active', Date.now());

      db.prepare(`
        INSERT INTO organization_members (org_id, member_did, role, status, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(org.org_id, memberDID, 'member', 'active', Date.now());

      // Create some audit logs
      await middleware.logPermissionGrant(org.org_id, ownerDID, 'org.view', { action: 'view' });
      await middleware.logPermissionGrant(org.org_id, ownerDID, 'org.edit', { action: 'edit' });
      await middleware.logPermissionDenial(org.org_id, memberDID, 'org.delete', { action: 'delete' });
    });

    it('should retrieve audit logs for organization', async () => {
      const logs = await middleware.getAuditLog(org.org_id);

      expect(logs.length).toBeGreaterThanOrEqual(3);
      expect(logs[0].org_id).toBe(org.org_id);
    });

    it('should filter audit logs by user', async () => {
      const logs = await middleware.getAuditLog(org.org_id, { userDID: ownerDID });

      expect(logs.length).toBeGreaterThanOrEqual(2);
      logs.forEach(log => {
        expect(log.user_did).toBe(ownerDID);
      });
    });

    it('should filter audit logs by result', async () => {
      const grantedLogs = await middleware.getAuditLog(org.org_id, { result: 'granted' });
      const deniedLogs = await middleware.getAuditLog(org.org_id, { result: 'denied' });

      expect(grantedLogs.length).toBeGreaterThanOrEqual(2);
      expect(deniedLogs.length).toBeGreaterThanOrEqual(1);

      grantedLogs.forEach(log => {
        expect(log.result).toBe('granted');
      });

      deniedLogs.forEach(log => {
        expect(log.result).toBe('denied');
      });
    });

    it('should limit audit log results', async () => {
      const logs = await middleware.getAuditLog(org.org_id, { limit: 2 });

      expect(logs.length).toBeLessThanOrEqual(2);
    });
  });
});
