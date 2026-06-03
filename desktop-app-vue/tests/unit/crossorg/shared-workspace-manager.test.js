/**
 * Shared Workspace Manager Unit Tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SharedWorkspaceManager } from '../../../src/main/crossorg/shared-workspace-manager.js';

// Mock database
const createMockDatabase = () => {
  const data = {
    workspaces: [],
    workspaceOrgs: [],
    workspaceMembers: []
  };

  return {
    getDatabase: () => ({
      prepare: (sql) => ({
        run: vi.fn((...args) => {
          if (sql.includes('INSERT INTO shared_workspaces')) {
            data.workspaces.push({
              id: args[0],
              name: args[1],
              description: args[2],
              workspace_type: args[3],
              visibility: args[4],
              created_by_org_id: args[5],
              created_by_org_name: args[6],
              created_by_did: args[7],
              created_by_name: args[8],
              status: 'active'
            });
            return { changes: 1 };
          }
          if (sql.includes('INSERT INTO shared_workspace_orgs')) {
            data.workspaceOrgs.push({
              id: args[0],
              workspace_id: args[1],
              org_id: args[2],
              org_name: args[3],
              role: 'admin', // Hardcoded in SQL
              joined_at: args[4]
            });
            return { changes: 1 };
          }
          if (sql.includes('INSERT INTO shared_workspace_members')) {
            data.workspaceMembers.push({
              id: args[0],
              workspace_id: args[1],
              member_did: args[2],
              member_org_id: args[3],
              member_name: args[4],
              role: args[5],
              permissions: args[6]
            });
            return { changes: 1 };
          }
          return { changes: 1 };
        }),
        get: vi.fn((...args) => {
          if (sql.includes('SELECT * FROM shared_workspaces WHERE id')) {
            return data.workspaces.find(w => w.id === args[0]);
          }
          if (sql.includes('SELECT id FROM shared_workspace_orgs')) {
            return data.workspaceOrgs.find(o => o.workspace_id === args[0] && o.org_id === args[1]);
          }
          if (sql.includes('SELECT id FROM shared_workspace_members')) {
            return data.workspaceMembers.find(m => m.workspace_id === args[0] && m.member_did === args[1]);
          }
          if (sql.includes('SELECT created_by_org_id FROM shared_workspaces')) {
            const ws = data.workspaces.find(w => w.id === args[0]);
            return ws ? { created_by_org_id: ws.created_by_org_id } : null;
          }
          if (sql.includes('SELECT id FROM org_partnerships')) {
            return { id: 'partnership-1' }; // Mock active partnership
          }
          return null;
        }),
        all: vi.fn((...args) => {
          if (sql.includes('SELECT sw.* FROM shared_workspaces')) {
            return data.workspaces;
          }
          if (sql.includes('SELECT * FROM shared_workspace_orgs')) {
            return data.workspaceOrgs.filter(o => o.workspace_id === args[0]);
          }
          if (sql.includes('SELECT * FROM shared_workspace_members')) {
            return data.workspaceMembers.filter(m => m.workspace_id === args[0]);
          }
          return [];
        })
      })
    }),
    data
  };
};

describe('SharedWorkspaceManager Unit Tests', () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    manager = new SharedWorkspaceManager(mockDb);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize shared workspace manager', () => {
      expect(manager).toBeDefined();
      expect(manager.database).toBe(mockDb);
    });
  });

  describe('createWorkspace', () => {
    it('should create a new workspace', async () => {
      const data = {
        name: 'Test Workspace',
        description: 'A test workspace',
        workspaceType: 'project',
        visibility: 'private',
        createdByOrgId: 'org-1',
        createdByOrgName: 'Org One',
        createdByDid: 'did:example:user1',
        createdByName: 'User One'
      };

      const result = await manager.createWorkspace(data);

      expect(result.success).toBe(true);
      expect(result.workspaceId).toBeDefined();
      expect(mockDb.data.workspaces.length).toBe(1);
      expect(mockDb.data.workspaces[0].name).toBe('Test Workspace');
    });

    it('should add creator org as admin', async () => {
      const data = {
        name: 'Test Workspace',
        createdByOrgId: 'org-1',
        createdByOrgName: 'Org One',
        createdByDid: 'did:example:user1',
        createdByName: 'User One'
      };

      await manager.createWorkspace(data);

      expect(mockDb.data.workspaceOrgs.length).toBe(1);
      expect(mockDb.data.workspaceOrgs[0].role).toBe('admin');
    });
  });

  describe('inviteOrg', () => {
    it('should invite an organization to workspace', async () => {
      // Create workspace first
      const ws = await manager.createWorkspace({
        name: 'Test Workspace',
        createdByOrgId: 'org-1',
        createdByOrgName: 'Org One',
        createdByDid: 'did:example:user1',
        createdByName: 'User One'
      });

      const result = await manager.inviteOrg(
        ws.workspaceId,
        { orgId: 'org-2', orgName: 'Org Two', role: 'member' },
        'did:example:user1'
      );

      expect(result.success).toBe(true);
      expect(result.membershipId).toBeDefined();
    });
  });

  describe('addMember', () => {
    it('should add a member to workspace', async () => {
      // Create workspace first
      const ws = await manager.createWorkspace({
        name: 'Test Workspace',
        createdByOrgId: 'org-1',
        createdByOrgName: 'Org One',
        createdByDid: 'did:example:user1',
        createdByName: 'User One'
      });

      const result = await manager.addMember(ws.workspaceId, {
        memberDid: 'did:example:user2',
        memberOrgId: 'org-1',
        memberName: 'User Two',
        role: 'editor',
        permissions: ['read', 'write']
      }, 'did:example:user1');

      expect(result.success).toBe(true);
      expect(result.memberId).toBeDefined();
    });
  });

  describe('getWorkspaces', () => {
    it('should return workspaces for an organization', async () => {
      await manager.createWorkspace({
        name: 'Test Workspace 1',
        createdByOrgId: 'org-1',
        createdByOrgName: 'Org One',
        createdByDid: 'did:example:user1',
        createdByName: 'User One'
      });

      const result = await manager.getWorkspaces('org-1');

      expect(result.success).toBe(true);
      expect(Array.isArray(result.workspaces)).toBe(true);
    });
  });

  describe('archiveWorkspace', () => {
    it('should archive a workspace', async () => {
      const ws = await manager.createWorkspace({
        name: 'Test Workspace',
        createdByOrgId: 'org-1',
        createdByOrgName: 'Org One',
        createdByDid: 'did:example:user1',
        createdByName: 'User One'
      });

      const result = await manager.archiveWorkspace(ws.workspaceId, 'did:example:user1');

      expect(result.success).toBe(true);
    });
  });
});
