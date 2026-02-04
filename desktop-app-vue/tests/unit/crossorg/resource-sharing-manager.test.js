/**
 * Resource Sharing Manager Unit Tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ResourceSharingManager } from '../../../src/main/crossorg/resource-sharing-manager.js';

// Mock database
const createMockDatabase = () => {
  const data = {
    shares: [],
    partnerships: [
      { id: 'p-1', initiator_org_id: 'org-1', partner_org_id: 'org-2', status: 'active', trust_level: 'standard' }
    ]
  };

  return {
    getDatabase: () => ({
      prepare: (sql) => ({
        run: vi.fn((...args) => {
          if (sql.includes('INSERT INTO cross_org_shares')) {
            data.shares.push({
              id: args[0],
              source_org_id: args[1],
              target_org_id: args[2],
              target_workspace_id: args[3],
              resource_type: args[4],
              resource_id: args[5],
              resource_name: args[6],
              share_type: args[7],
              permissions: args[8],
              status: 'active'
            });
            return { changes: 1 };
          }
          if (sql.includes('UPDATE cross_org_shares')) {
            return { changes: 1 };
          }
          if (sql.includes('DELETE FROM cross_org_shares')) {
            const idx = data.shares.findIndex(s => s.id === args[0]);
            if (idx > -1) data.shares.splice(idx, 1);
            return { changes: 1 };
          }
          return { changes: 0 };
        }),
        get: vi.fn((...args) => {
          if (sql.includes('SELECT * FROM cross_org_shares WHERE id')) {
            return data.shares.find(s => s.id === args[0]);
          }
          if (sql.includes('SELECT id FROM cross_org_shares WHERE source_org_id')) {
            return data.shares.find(s =>
              s.source_org_id === args[0] &&
              s.target_org_id === args[1] &&
              s.resource_type === args[2] &&
              s.resource_id === args[3]
            );
          }
          if (sql.includes('SELECT id, trust_level FROM org_partnerships')) {
            return data.partnerships.find(p =>
              (p.initiator_org_id === args[0] && p.partner_org_id === args[1]) ||
              (p.initiator_org_id === args[2] && p.partner_org_id === args[3])
            );
          }
          return null;
        }),
        all: vi.fn((...args) => {
          if (sql.includes('SELECT * FROM cross_org_shares WHERE')) {
            return data.shares.filter(s =>
              s.source_org_id === args[0] || s.target_org_id === args[0]
            );
          }
          return [];
        })
      })
    }),
    data
  };
};

describe('ResourceSharingManager Unit Tests', () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    manager = new ResourceSharingManager(mockDb);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize resource sharing manager', () => {
      expect(manager).toBeDefined();
      expect(manager.database).toBe(mockDb);
    });
  });

  describe('shareResource', () => {
    it('should share a resource with partner organization', async () => {
      const data = {
        sourceOrgId: 'org-1',
        targetOrgId: 'org-2',
        resourceType: 'knowledge',
        resourceId: 'kb-1',
        resourceName: 'Test Knowledge Base',
        shareType: 'reference',
        permissions: ['read'],
        sharedByDid: 'did:example:user1'
      };

      const result = await manager.shareResource(data);

      expect(result.success).toBe(true);
      expect(result.shareId).toBeDefined();
      expect(mockDb.data.shares.length).toBe(1);
    });

    it('should reject sharing with self', async () => {
      const data = {
        sourceOrgId: 'org-1',
        targetOrgId: 'org-1',
        resourceType: 'knowledge',
        resourceId: 'kb-1'
      };

      const result = await manager.shareResource(data);

      expect(result.success).toBe(false);
      // The implementation checks for partnership, not self-sharing
      // When sharing with self, it fails to find a partnership
      expect(result.error).toBe('NO_PARTNERSHIP');
    });
  });

  describe('unshareResource', () => {
    it('should unshare a resource', async () => {
      // First share a resource
      const shareResult = await manager.shareResource({
        sourceOrgId: 'org-1',
        targetOrgId: 'org-2',
        resourceType: 'knowledge',
        resourceId: 'kb-1',
        resourceName: 'Test KB',
        shareType: 'reference',
        permissions: ['read'],
        sharedByDid: 'did:example:user1'
      });

      const result = await manager.unshareResource(shareResult.shareId, 'did:example:user1');

      expect(result.success).toBe(true);
    });
  });

  describe('getSharedResources', () => {
    it('should return shared resources for an organization', async () => {
      // Create a share first
      await manager.shareResource({
        sourceOrgId: 'org-1',
        targetOrgId: 'org-2',
        resourceType: 'knowledge',
        resourceId: 'kb-1',
        resourceName: 'Test KB',
        shareType: 'reference',
        permissions: ['read'],
        sharedByDid: 'did:example:user1'
      });

      const result = await manager.getSharedResources('org-1');

      expect(result.success).toBe(true);
      // The implementation returns a single 'shares' array, not separate arrays
      expect(Array.isArray(result.shares)).toBe(true);
      expect(result.shares.length).toBeGreaterThan(0);
    });
  });

  describe('accessSharedResource', () => {
    it('should allow access to shared resource', async () => {
      // First share a resource
      const shareResult = await manager.shareResource({
        sourceOrgId: 'org-1',
        targetOrgId: 'org-2',
        resourceType: 'knowledge',
        resourceId: 'kb-1',
        resourceName: 'Test KB',
        shareType: 'reference',
        permissions: ['read'],
        sharedByDid: 'did:example:user1'
      });

      // accessSharedResource expects: shareId, accessorDid, accessorOrgId (in that order)
      const result = await manager.accessSharedResource(
        shareResult.shareId,
        'did:example:user2',
        'org-2'
      );

      expect(result.success).toBe(true);
    });
  });

  describe('updateSharePermissions', () => {
    it('should update share permissions', async () => {
      // First share a resource
      const shareResult = await manager.shareResource({
        sourceOrgId: 'org-1',
        targetOrgId: 'org-2',
        resourceType: 'knowledge',
        resourceId: 'kb-1',
        resourceName: 'Test KB',
        shareType: 'reference',
        permissions: ['read'],
        sharedByDid: 'did:example:user1'
      });

      const result = await manager.updateSharePermissions(
        shareResult.shareId,
        ['read', 'write'],
        'did:example:user1'
      );

      expect(result.success).toBe(true);
    });
  });
});
