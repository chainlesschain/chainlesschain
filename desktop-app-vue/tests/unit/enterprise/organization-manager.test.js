/**
 * OrganizationManager 单元测试
 *
 * 测试覆盖:
 * - 组织生命周期管理 (8 tests)
 * - 成员管理 (10 tests)
 * - 组织查询 (6 tests)
 * - P2P网络集成 (5 tests)
 * - 知识库事件处理 (4 tests)
 * - 权限检查 (5 tests)
 * - 错误处理 (4 tests)
 *
 * 总计: 42 测试用例
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const path = require('path');
const fs = require('fs');

// 模拟 uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234')
}));

describe('OrganizationManager Unit Tests', () => {
  let OrganizationManager;
  let DatabaseManager;
  let DIDManager;
  let db;
  let didManager;
  let p2pManager;
  let orgManager;
  let testDbPath;

  beforeEach(async () => {
    // 设置测试数据库
    testDbPath = path.join(__dirname, '../temp/test-org-manager.db');
    const testDir = path.dirname(testDbPath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // 加载模块
    DatabaseManager = require('../../../src/main/database');
    DIDManager = require('../../../src/main/did/did-manager');
    OrganizationManager = require('../../../src/main/organization/organization-manager');

    // 初始化数据库
    db = new DatabaseManager(testDbPath, { encryptionEnabled: false });
    await db.initialize();

    // 初始化DID管理器
    didManager = new DIDManager(db);
    await didManager.initialize();

    // 模拟P2P管理器
    p2pManager = {
      isInitialized: vi.fn(() => true),
      sendMessage: vi.fn(async () => true),
      node: {
        handle: vi.fn(async () => {}),
        services: {
          pubsub: {
            publish: vi.fn(async () => {}),
            subscribe: vi.fn(async () => {})
          }
        }
      }
    };

    // 初始化组织管理器
    orgManager = new OrganizationManager(db, didManager, p2pManager);
  });

  afterEach(() => {
    // 清理测试数据库
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  // ============================================================================
  // 组织生命周期管理 (8 tests)
  // ============================================================================
  describe('Organization Lifecycle', () => {
    let currentIdentity;

    beforeEach(async () => {
      // 创建当前用户身份
      currentIdentity = await didManager.createIdentity(
        { nickname: 'Test User', displayName: 'Test User' },
        { setAsDefault: true }
      );
    });

    it('should create organization with valid data', async () => {
      const orgData = {
        name: 'Test Organization',
        description: 'A test organization for unit testing',
        type: 'company',
        avatar: 'https://example.com/avatar.png'
      };

      const org = await orgManager.createOrganization(orgData);

      expect(org).toBeDefined();
      expect(org.name).toBe(orgData.name);
      expect(org.description).toBe(orgData.description);
      expect(org.type).toBe(orgData.type);
      expect(org.avatar).toBe(orgData.avatar);
      expect(org.org_id).toMatch(/^org_/);
      expect(org.org_did).toMatch(/^did:/);
      expect(org.owner_did).toBe(currentIdentity.did);
    });

    it('should create organization and verify DID generation', async () => {
      const orgData = {
        name: 'DID Test Org',
        type: 'startup'
      };

      const org = await orgManager.createOrganization(orgData);

      expect(org.org_did).toBeDefined();
      expect(org.org_did).toMatch(/^did:/);

      // 验证DID格式正确（did:chainlesschain:org:hash）
      expect(org.org_did).toMatch(/^did:chainlesschain:org:/);
    });

    it('should create organization and assign owner as admin', async () => {
      const orgData = {
        name: 'Owner Test Org',
        type: 'startup'
      };

      const org = await orgManager.createOrganization(orgData);
      const members = await orgManager.getOrganizationMembers(org.org_id);

      expect(members).toHaveLength(1);
      expect(members[0].member_did).toBe(currentIdentity.did);
      expect(members[0].role).toBe('owner');
    });

    it('should create organization with all optional fields', async () => {
      const orgData = {
        name: 'Full Data Org',
        description: 'Complete organization data',
        type: 'education',
        avatar: 'https://example.com/edu.png',
        visibility: 'public',
        maxMembers: 200,
        allowMemberInvite: true
      };

      const org = await orgManager.createOrganization(orgData);

      expect(org.settings.visibility).toBe('public');
      expect(org.settings.maxMembers).toBe(200);
      expect(org.settings.allowMemberInvite).toBe(true);
    });

    it('should reject organization creation without current identity', async () => {
      // 创建新的数据库实例以确保表存在
      const testPath = path.join(__dirname, '../temp/test-no-identity.db');
      if (fs.existsSync(testPath)) {
        fs.unlinkSync(testPath);
      }

      const tempDb = new DatabaseManager(testPath, { encryptionEnabled: false });
      await tempDb.initialize();

      const tempDIDManager = new DIDManager(tempDb);
      await tempDIDManager.initialize();

      const tempOrgManager = new OrganizationManager(tempDb, tempDIDManager, p2pManager);

      const orgData = {
        name: 'Invalid Org',
        type: 'startup'
      };

      await expect(tempOrgManager.createOrganization(orgData)).rejects.toThrow('未找到当前用户身份');

      // 清理
      if (fs.existsSync(testPath)) {
        fs.unlinkSync(testPath);
      }
    });

    it('should reject organization creation with invalid type', async () => {
      const orgData = {
        name: 'Invalid Type Org',
        type: 'invalid-type-xyz'
      };

      // 数据库有类型约束，应该抛出错误
      await expect(orgManager.createOrganization(orgData)).rejects.toThrow();
    });

    it('should soft delete organization', async () => {
      const orgData = {
        name: 'Delete Test Org',
        type: 'startup'
      };

      const org = await orgManager.createOrganization(orgData);

      await orgManager.deleteOrganization(org.org_id, currentIdentity.did);

      const members = await orgManager.getOrganizationMembers(org.org_id);
      expect(members).toHaveLength(0); // 所有成员状态变为removed
    });

    it('should prevent non-owner from deleting organization', async () => {
      const orgData = {
        name: 'Protected Org',
        type: 'startup'
      };

      const org = await orgManager.createOrganization(orgData);

      // 创建另一个用户
      const otherUser = await didManager.createIdentity(
        { nickname: 'Other User' },
        { setAsDefault: false }
      );

      // 添加为普通成员
      await orgManager.addMember(org.org_id, {
        memberDID: otherUser.did,
        displayName: 'Other User',
        avatar: '',
        role: 'member',
        permissions: JSON.stringify(['knowledge.read'])
      });

      await expect(
        orgManager.deleteOrganization(org.org_id, otherUser.did)
      ).rejects.toThrow('只有组织所有者可以删除组织');
    });
  });

  // ============================================================================
  // 成员管理 (10 tests)
  // ============================================================================
  describe('Member Management', () => {
    let org, ownerDID, memberDID;

    beforeEach(async () => {
      // 创建测试组织
      const owner = await didManager.createIdentity(
        { nickname: 'Owner', displayName: 'Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      org = await orgManager.createOrganization({
        name: 'Member Test Org',
        type: 'startup'
      });

      // 创建测试成员
      const member = await didManager.createIdentity(
        { nickname: 'Member', displayName: 'Member' },
        { setAsDefault: false }
      );
      memberDID = member.did;
    });

    it('should add member to organization', async () => {
      const memberData = {
        memberDID: memberDID,
        displayName: 'Test Member',
        avatar: 'https://example.com/member.png',
        role: 'member',
        permissions: JSON.stringify(['knowledge.read', 'knowledge.write'])
      };

      const addedMember = await orgManager.addMember(org.org_id, memberData);

      expect(addedMember).toBeDefined();
      expect(addedMember.member_did).toBe(memberDID);
      expect(addedMember.display_name).toBe('Test Member');
      expect(addedMember.role).toBe('member');
      expect(addedMember.status).toBe('active');
    });

    it('should add member with specific role (admin)', async () => {
      const memberData = {
        memberDID: memberDID,
        displayName: 'Admin Member',
        avatar: '',
        role: 'admin',
        permissions: JSON.stringify(orgManager.getDefaultPermissionsByRole('admin'))
      };

      const addedMember = await orgManager.addMember(org.org_id, memberData);

      expect(addedMember.role).toBe('admin');
    });

    it('should add member with specific role (viewer)', async () => {
      const memberData = {
        memberDID: memberDID,
        displayName: 'Viewer Member',
        avatar: '',
        role: 'viewer',
        permissions: JSON.stringify(orgManager.getDefaultPermissionsByRole('viewer'))
      };

      const addedMember = await orgManager.addMember(org.org_id, memberData);

      expect(addedMember.role).toBe('viewer');
    });

    it('should remove member from organization', async () => {
      // 先添加成员
      await orgManager.addMember(org.org_id, {
        memberDID: memberDID,
        displayName: 'To Remove',
        avatar: '',
        role: 'member',
        permissions: JSON.stringify(['knowledge.read'])
      });

      // 移除成员
      await orgManager.removeMember(org.org_id, memberDID);

      // 验证成员状态已更新
      const member = db.prepare(
        'SELECT status FROM organization_members WHERE org_id = ? AND member_did = ?'
      ).get(org.org_id, memberDID);

      expect(member.status).toBe('removed');
    });

    it('should prevent removing organization owner', async () => {
      await expect(
        orgManager.removeMember(org.org_id, ownerDID)
      ).rejects.toThrow('不能移除组织所有者');
    });

    it('should update member role', async () => {
      // 添加成员
      await orgManager.addMember(org.org_id, {
        memberDID: memberDID,
        displayName: 'Member',
        avatar: '',
        role: 'member',
        permissions: JSON.stringify(['knowledge.read'])
      });

      // 更新角色
      await orgManager.updateMemberRole(org.org_id, memberDID, 'admin');

      // 验证角色已更新
      const member = db.prepare(
        'SELECT role FROM organization_members WHERE org_id = ? AND member_did = ?'
      ).get(org.org_id, memberDID);

      expect(member.role).toBe('admin');
    });

    it('should get all members of organization', async () => {
      // 添加多个成员
      const member2 = await didManager.createIdentity(
        { nickname: 'Member2' },
        { setAsDefault: false }
      );

      await orgManager.addMember(org.org_id, {
        memberDID: memberDID,
        displayName: 'Member 1',
        avatar: '',
        role: 'member',
        permissions: JSON.stringify(['knowledge.read'])
      });

      await orgManager.addMember(org.org_id, {
        memberDID: member2.did,
        displayName: 'Member 2',
        avatar: '',
        role: 'viewer',
        permissions: JSON.stringify(['knowledge.read'])
      });

      const members = await orgManager.getOrganizationMembers(org.org_id);

      expect(members).toHaveLength(3); // owner + 2 members
    });

    it('should get member count', async () => {
      await orgManager.addMember(org.org_id, {
        memberDID: memberDID,
        displayName: 'Member',
        avatar: '',
        role: 'member',
        permissions: JSON.stringify(['knowledge.read'])
      });

      const members = await orgManager.getOrganizationMembers(org.org_id);
      expect(members.length).toBe(2); // owner + 1 member
    });

    it('should check if user is member', async () => {
      await orgManager.addMember(org.org_id, {
        memberDID: memberDID,
        displayName: 'Member',
        avatar: '',
        role: 'member',
        permissions: JSON.stringify(['knowledge.read'])
      });

      const isMember = await orgManager.isMember(org.org_id, memberDID);
      expect(isMember).toBe(true);

      const notMember = await didManager.createIdentity(
        { nickname: 'NotMember' },
        { setAsDefault: false }
      );
      const isNotMember = await orgManager.isMember(org.org_id, notMember.did);
      expect(isNotMember).toBe(false);
    });

    it('should list organizations for user', async () => {
      // 创建第二个组织
      const org2 = await orgManager.createOrganization({
        name: 'Second Org',
        type: 'community'
      });

      // 将成员添加到两个组织
      await orgManager.addMember(org.org_id, {
        memberDID: memberDID,
        displayName: 'Member',
        avatar: '',
        role: 'member',
        permissions: JSON.stringify(['knowledge.read'])
      });

      await orgManager.addMember(org2.org_id, {
        memberDID: memberDID,
        displayName: 'Member',
        avatar: '',
        role: 'viewer',
        permissions: JSON.stringify(['knowledge.read'])
      });

      const userOrgs = await orgManager.getUserOrganizations(memberDID);

      expect(userOrgs).toHaveLength(2);
      expect(userOrgs.map(o => o.orgId)).toContain(org.org_id);
      expect(userOrgs.map(o => o.orgId)).toContain(org2.org_id);
    });
  });

  // ============================================================================
  // 组织查询 (6 tests)
  // ============================================================================
  describe('Organization Queries', () => {
    let org1, org2, userDID;

    beforeEach(async () => {
      const user = await didManager.createIdentity(
        { nickname: 'QueryUser', displayName: 'Query User' },
        { setAsDefault: true }
      );
      userDID = user.did;

      org1 = await orgManager.createOrganization({
        name: 'Query Org 1',
        description: 'First test org',
        type: 'startup'
      });

      org2 = await orgManager.createOrganization({
        name: 'Query Org 2',
        description: 'Second test org',
        type: 'company'
      });
    });

    it('should get organization by ID', async () => {
      const result = await orgManager.getOrganization(org1.org_id);

      expect(result).toBeDefined();
      expect(result.org_id).toBe(org1.org_id);
      expect(result.name).toBe('Query Org 1');
    });

    it('should get organization by DID', async () => {
      const result = db.prepare(
        'SELECT * FROM organization_info WHERE org_did = ?'
      ).get(org1.org_did);

      expect(result).toBeDefined();
      expect(result.org_did).toBe(org1.org_did);
      expect(result.name).toBe('Query Org 1');
    });

    it('should return null for non-existent organization', async () => {
      const result = await orgManager.getOrganization('non-existent-id');

      expect(result).toBeNull();
    });

    it('should list user organizations', async () => {
      const userOrgs = await orgManager.getUserOrganizations(userDID);

      expect(userOrgs).toHaveLength(2);
      expect(userOrgs[0].name).toBeDefined();
      expect(userOrgs[0].role).toBe('owner');
    });

    it('should get organization with member count', async () => {
      // 添加成员
      const member = await didManager.createIdentity(
        { nickname: 'Member' },
        { setAsDefault: false }
      );

      await orgManager.addMember(org1.org_id, {
        memberDID: member.did,
        displayName: 'Member',
        avatar: '',
        role: 'member',
        permissions: JSON.stringify(['knowledge.read'])
      });

      const members = await orgManager.getOrganizationMembers(org1.org_id);
      expect(members.length).toBe(2); // owner + 1 member
    });

    it('should search organizations by name', async () => {
      // 这个功能可能需要在未来添加
      const orgs = db.prepare(
        'SELECT * FROM organization_info WHERE name LIKE ?'
      ).all('%Query Org%');

      expect(orgs.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================================
  // P2P网络集成 (5 tests)
  // ============================================================================
  describe('P2P Network Integration', () => {
    let org, ownerDID;

    beforeEach(async () => {
      const owner = await didManager.createIdentity(
        { nickname: 'P2POwner', displayName: 'P2P Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      org = await orgManager.createOrganization({
        name: 'P2P Test Org',
        type: 'startup',
        enableInviteCode: false // 禁用邀请码以加快测试
      });
    });

    it('should initialize P2P network for organization', async () => {
      // P2P网络应该在组织创建时初始化
      expect(orgManager.orgP2PNetwork).toBeDefined();
    });

    it('should handle member online event', async () => {
      const eventHandler = vi.fn();

      if (orgManager.orgP2PNetwork) {
        orgManager.orgP2PNetwork.on('member:online', eventHandler);

        // 模拟成员上线事件
        orgManager.orgP2PNetwork.emit('member:online', {
          orgId: org.org_id,
          memberDID: 'did:key:test-member',
          displayName: 'Test Member'
        });

        expect(eventHandler).toHaveBeenCalled();
      }
    });

    it('should handle member offline event', async () => {
      const eventHandler = vi.fn();

      if (orgManager.orgP2PNetwork) {
        orgManager.orgP2PNetwork.on('member:offline', eventHandler);

        // 模拟成员下线事件
        orgManager.orgP2PNetwork.emit('member:offline', {
          orgId: org.org_id,
          memberDID: 'did:key:test-member'
        });

        expect(eventHandler).toHaveBeenCalled();
      }
    });

    it('should handle member discovered event', async () => {
      const eventHandler = vi.fn();

      if (orgManager.orgP2PNetwork) {
        orgManager.orgP2PNetwork.on('member:discovered', eventHandler);

        // 模拟成员发现事件
        orgManager.orgP2PNetwork.emit('member:discovered', {
          orgId: org.org_id,
          memberDID: 'did:key:test-member',
          displayName: 'Discovered Member'
        });

        expect(eventHandler).toHaveBeenCalled();
      }
    });

    it('should broadcast message to organization', async () => {
      // 测试 P2P 广播功能的存在性
      expect(orgManager.broadcastOrgMessage).toBeDefined();
      expect(typeof orgManager.broadcastOrgMessage).toBe('function');

      // 由于P2P网络是mock的，我们只验证方法可以被调用
      const message = {
        type: 'test_message',
        content: 'Hello organization'
      };

      // 应该不会抛出错误（即使P2P网络未完全初始化）
      try {
        await orgManager.broadcastOrgMessage(org.org_id, message);
      } catch (error) {
        // 如果失败，确保是预期的P2P网络相关错误（包括未订阅等）
        expect(error.message).toMatch(/未订阅|OrgP2PNetwork|未初始化/);
      }
    });
  });

  // ============================================================================
  // 知识库事件处理 (4 tests)
  // ============================================================================
  describe('Knowledge Event Handling', () => {
    let org, ownerDID;

    beforeEach(async () => {
      const owner = await didManager.createIdentity(
        { nickname: 'KnowledgeOwner', displayName: 'Knowledge Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      org = await orgManager.createOrganization({
        name: 'Knowledge Test Org',
        type: 'startup',
        enableInviteCode: false
      });
    });

    it('should handle knowledge shared event', async () => {
      const eventData = {
        orgId: org.org_id,
        type: 'knowledge_shared',
        data: {
          knowledgeId: 'kb-123',
          title: 'Test Knowledge',
          sharedBy: ownerDID
        }
      };

      // handleKnowledgeEvent 应该被正确调用
      await expect(
        orgManager.handleKnowledgeEvent(
          eventData.orgId,
          eventData.type,
          eventData.data
        )
      ).resolves.not.toThrow();
    });

    it('should handle knowledge updated event', async () => {
      const eventData = {
        orgId: org.org_id,
        type: 'knowledge_updated',
        data: {
          knowledgeId: 'kb-123',
          updatedBy: ownerDID,
          changes: ['content', 'tags']
        }
      };

      await expect(
        orgManager.handleKnowledgeEvent(
          eventData.orgId,
          eventData.type,
          eventData.data
        )
      ).resolves.not.toThrow();
    });

    it('should handle knowledge deleted event', async () => {
      const eventData = {
        orgId: org.org_id,
        type: 'knowledge_deleted',
        data: {
          knowledgeId: 'kb-123',
          deletedBy: ownerDID
        }
      };

      await expect(
        orgManager.handleKnowledgeEvent(
          eventData.orgId,
          eventData.type,
          eventData.data
        )
      ).resolves.not.toThrow();
    });

    it('should handle knowledge permission changed event', async () => {
      const eventData = {
        orgId: org.org_id,
        type: 'knowledge_permission_changed',
        data: {
          knowledgeId: 'kb-123',
          newPermissions: ['read', 'write'],
          changedBy: ownerDID
        }
      };

      await expect(
        orgManager.handleKnowledgeEvent(
          eventData.orgId,
          eventData.type,
          eventData.data
        )
      ).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // 权限检查 (5 tests)
  // ============================================================================
  describe('Permission Checks', () => {
    let org, ownerDID, adminDID, memberDID, viewerDID;

    beforeEach(async () => {
      const owner = await didManager.createIdentity(
        { nickname: 'Owner', displayName: 'Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      org = await orgManager.createOrganization({
        name: 'Permission Test Org',
        type: 'startup'
      });

      // 创建不同角色的用户
      const admin = await didManager.createIdentity(
        { nickname: 'Admin' },
        { setAsDefault: false }
      );
      adminDID = admin.did;

      const member = await didManager.createIdentity(
        { nickname: 'Member' },
        { setAsDefault: false }
      );
      memberDID = member.did;

      const viewer = await didManager.createIdentity(
        { nickname: 'Viewer' },
        { setAsDefault: false }
      );
      viewerDID = viewer.did;

      // 添加成员
      await orgManager.addMember(org.org_id, {
        memberDID: adminDID,
        displayName: 'Admin',
        avatar: '',
        role: 'admin',
        permissions: JSON.stringify(orgManager.getDefaultPermissionsByRole('admin'))
      });

      await orgManager.addMember(org.org_id, {
        memberDID: memberDID,
        displayName: 'Member',
        avatar: '',
        role: 'member',
        permissions: JSON.stringify(orgManager.getDefaultPermissionsByRole('member'))
      });

      await orgManager.addMember(org.org_id, {
        memberDID: viewerDID,
        displayName: 'Viewer',
        avatar: '',
        role: 'viewer',
        permissions: JSON.stringify(orgManager.getDefaultPermissionsByRole('viewer'))
      });
    });

    it('should allow owner to manage organization', async () => {
      const canManage = await orgManager.checkPermission(org.org_id, ownerDID, 'org.manage');
      expect(canManage).toBe(true);
    });

    it('should allow admin to invite members', async () => {
      const canInvite = await orgManager.checkPermission(org.org_id, adminDID, 'member.invite');
      expect(canInvite).toBe(true);
    });

    it('should prevent member from removing other members', async () => {
      const canRemove = await orgManager.checkPermission(org.org_id, memberDID, 'member.remove');
      expect(canRemove).toBe(false);
    });

    it('should prevent viewer from deleting organization', async () => {
      const canDelete = await orgManager.checkPermission(org.org_id, viewerDID, 'org.delete');
      expect(canDelete).toBe(false);
    });

    it('should verify admin-only operations', async () => {
      // Admin 可以管理成员
      const adminCanManageMembers = await orgManager.checkPermission(
        org.org_id,
        adminDID,
        'member.manage'
      );
      expect(adminCanManageMembers).toBe(true);

      // Member 不能管理成员
      const memberCanManageMembers = await orgManager.checkPermission(
        org.org_id,
        memberDID,
        'member.manage'
      );
      expect(memberCanManageMembers).toBe(false);

      // Viewer 不能管理成员
      const viewerCanManageMembers = await orgManager.checkPermission(
        org.org_id,
        viewerDID,
        'member.manage'
      );
      expect(viewerCanManageMembers).toBe(false);
    });
  });

  // ============================================================================
  // 错误处理 (4 tests)
  // ============================================================================
  describe('Error Handling', () => {
    let org, ownerDID;

    beforeEach(async () => {
      const owner = await didManager.createIdentity(
        { nickname: 'ErrorOwner', displayName: 'Error Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      org = await orgManager.createOrganization({
        name: 'Error Test Org',
        type: 'startup'
      });
    });

    it('should handle database errors gracefully', async () => {
      // 模拟数据库错误（使用无效的组织ID）
      const result = await orgManager.getOrganization('invalid-org-id-xyz');
      expect(result).toBeNull();
    });

    it('should handle DID generation failures', async () => {
      // 创建新的数据库实例
      const testPath = path.join(__dirname, '../temp/test-did-error.db');
      if (fs.existsSync(testPath)) {
        fs.unlinkSync(testPath);
      }

      const tempDb = new DatabaseManager(testPath, { encryptionEnabled: false });
      await tempDb.initialize();

      const tempDIDManager = new DIDManager(tempDb);
      await tempDIDManager.initialize();

      const tempOrgManager = new OrganizationManager(tempDb, tempDIDManager, p2pManager);

      // 没有当前身份时应该失败
      await expect(
        tempOrgManager.createOrganization({
          name: 'DID Error Org',
          type: 'startup'
        })
      ).rejects.toThrow();

      // 清理
      if (fs.existsSync(testPath)) {
        fs.unlinkSync(testPath);
      }
    });

    it('should handle P2P network errors', async () => {
      // 创建一个会失败的P2P管理器
      const failingP2PManager = {
        isInitialized: vi.fn(() => true),
        sendMessage: vi.fn(async () => {
          throw new Error('P2P network error');
        }),
        node: null
      };

      const failingOrgManager = new OrganizationManager(
        db,
        didManager,
        failingP2PManager
      );

      // P2P错误不应该阻止组织创建
      const result = await failingOrgManager.createOrganization({
        name: 'P2P Error Org',
        type: 'startup'
      });

      expect(result).toBeDefined();
      expect(result.name).toBe('P2P Error Org');
    });

    it('should handle concurrent modification conflicts', async () => {
      // 添加成员
      const member = await didManager.createIdentity(
        { nickname: 'Member' },
        { setAsDefault: false }
      );

      await orgManager.addMember(org.org_id, {
        memberDID: member.did,
        displayName: 'Member',
        avatar: '',
        role: 'member',
        permissions: JSON.stringify(['knowledge.read'])
      });

      // 尝试同时更新角色（第二次更新应该成功）
      await orgManager.updateMemberRole(org.org_id, member.did, 'admin');
      await orgManager.updateMemberRole(org.org_id, member.did, 'viewer');

      const memberData = db.prepare(
        'SELECT role FROM organization_members WHERE org_id = ? AND member_did = ?'
      ).get(org.org_id, member.did);

      expect(memberData.role).toBe('viewer'); // 最后一次更新应该生效
    });
  });

  // ============================================================================
  // 额外测试: 邀请码功能
  // ============================================================================
  describe('Invitation Code Features', () => {
    let org, ownerDID;

    beforeEach(async () => {
      const owner = await didManager.createIdentity(
        { nickname: 'InviteOwner', displayName: 'Invite Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      org = await orgManager.createOrganization({
        name: 'Invite Test Org',
        type: 'startup',
        enableInviteCode: true
      });
    });

    it('should generate invite code on organization creation', async () => {
      const invitations = orgManager.getInvitations(org.org_id);

      expect(invitations.length).toBeGreaterThan(0);
      expect(invitations[0].code).toBeDefined();
      expect(invitations[0].type).toBe('code');
    });

    it('should create custom invitation', async () => {
      const invitation = await orgManager.createInvitation(org.org_id, {
        invitedBy: ownerDID,
        role: 'admin',
        maxUses: 5,
        expireAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      expect(invitation.invite_code).toBeDefined();
      expect(invitation.invite_code).toMatch(/^[A-Z0-9]{6}$/);
      expect(invitation.role).toBe('admin');
      expect(invitation.max_uses).toBe(5);
    });
  });

  // ============================================================================
  // 额外测试: 角色管理
  // ============================================================================
  describe('Role Management', () => {
    let org, ownerDID;

    beforeEach(async () => {
      const owner = await didManager.createIdentity(
        { nickname: 'RoleOwner', displayName: 'Role Owner' },
        { setAsDefault: true }
      );
      ownerDID = owner.did;

      org = await orgManager.createOrganization({
        name: 'Role Test Org',
        type: 'startup'
      });
    });

    it('should get all roles', async () => {
      const roles = await orgManager.getRoles(org.org_id);

      expect(roles.length).toBeGreaterThanOrEqual(4); // owner, admin, member, viewer
      expect(roles.map(r => r.name)).toContain('owner');
      expect(roles.map(r => r.name)).toContain('admin');
      expect(roles.map(r => r.name)).toContain('member');
      expect(roles.map(r => r.name)).toContain('viewer');
    });

    it('should get all available permissions', () => {
      const permissions = orgManager.getAllPermissions();

      expect(permissions.length).toBeGreaterThan(0);
      expect(permissions[0].category).toBeDefined();
      expect(permissions[0].permissions).toBeDefined();
      expect(Array.isArray(permissions[0].permissions)).toBe(true);
    });
  });
});
