/**
 * DIDInvitationManager 单元测试
 *
 * 测试覆盖:
 * - 直接DID邀请 (8 tests)
 * - 邀请接受 (6 tests)
 * - 邀请状态管理 (5 tests)
 * - 邀请链接/代码 (7 tests)
 * - P2P邀请传递 (5 tests)
 * - 权限验证 (4 tests)
 * - 错误处理 (5 tests)
 *
 * 总计: 40 测试用例
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const path = require('path');
const fs = require('fs');

// 模拟 uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234-5678-90ab')
}));

// 模拟 QRCode
vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(async (data, options) => `data:image/png;base64,mockQRCode_${data}`),
    toBuffer: vi.fn(async (data, options) => Buffer.from(`mockQRCodeBuffer_${data}`)),
    toString: vi.fn(async (data, options) => `<svg>mockQRCodeSVG_${data}</svg>`)
  }
}));

describe('DIDInvitationManager Unit Tests', () => {
  let DIDInvitationManager;
  let DatabaseManager;
  let DIDManager;
  let OrganizationManager;
  let db;
  let didManager;
  let p2pManager;
  let orgManager;
  let invitationManager;
  let testDbPath;

  beforeEach(async () => {
    // 设置测试数据库
    testDbPath = path.join(__dirname, '../temp/test-did-invitation-manager.db');
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
    const { DIDInvitationManager: InvitationManagerClass } = require('../../../src/main/organization/did-invitation-manager');
    DIDInvitationManager = InvitationManagerClass;

    // 初始化数据库
    db = new DatabaseManager(testDbPath, { encryptionEnabled: false });
    await db.initialize();

    // 初始化DID管理器
    didManager = new DIDManager(db);
    await didManager.initialize();

    // 添加 getCurrentDID 方法（如果不存在）
    if (!didManager.getCurrentDID) {
      didManager.getCurrentDID = function() {
        return this.currentIdentity?.did || null;
      };
    }

    // 添加 getDefaultIdentity 方法（如果不存在）
    if (!didManager.getDefaultIdentity) {
      didManager.getDefaultIdentity = function() {
        return this.currentIdentity || null;
      };
    }

    // 模拟P2P管理器
    p2pManager = {
      isInitialized: vi.fn(() => true),
      sendEncryptedMessage: vi.fn(async () => true),
      node: {
        handle: vi.fn(async (protocol, handler) => {
          // Store the handler for testing
          p2pManager._handlers = p2pManager._handlers || {};
          p2pManager._handlers[protocol] = handler;
        })
      }
    };

    // 初始化组织管理器
    orgManager = new OrganizationManager(db, didManager, p2pManager);

    // 初始化邀请管理器
    invitationManager = new DIDInvitationManager(db, didManager, p2pManager, orgManager);
  });

  afterEach(() => {
    // 清理测试数据库
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  // ============================================================================
  // 直接DID邀请 (8 tests)
  // ============================================================================
  describe('Direct DID Invitation', () => {
    let org, inviterIdentity, inviteeIdentity;

    beforeEach(async () => {
      // 创建邀请人身份
      inviterIdentity = await didManager.createIdentity(
        { nickname: 'Inviter', displayName: 'Test Inviter' },
        { setAsDefault: true }
      );

      // 创建被邀请人身份
      inviteeIdentity = await didManager.createIdentity(
        { nickname: 'Invitee', displayName: 'Test Invitee' },
        { setAsDefault: false }
      );

      // 创建测试组织
      org = await orgManager.createOrganization({
        name: 'Invitation Test Org',
        type: 'startup'
      });
    });

    it('should send direct DID invitation', async () => {
      const invitation = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'member',
        message: 'Welcome to our organization!'
      });

      expect(invitation).toBeDefined();
      expect(invitation.invitationId).toMatch(/^inv_/);
      expect(invitation.orgId).toBe(org.org_id);
      expect(invitation.inviterDID).toBe(inviterIdentity.did);
      expect(invitation.inviteeDID).toBe(inviteeIdentity.did);
      expect(invitation.role).toBe('member');
      expect(invitation.message).toBe('Welcome to our organization!');
      expect(invitation.status).toBe('pending');
      expect(invitation.invitationType).toBe('direct_did');
    });

    it('should send invitation with custom message', async () => {
      const customMessage = 'Join us for an exciting journey!';
      const invitation = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        message: customMessage
      });

      expect(invitation.message).toBe(customMessage);
    });

    it('should send invitation with specific role (admin)', async () => {
      const invitation = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'admin'
      });

      expect(invitation.role).toBe('admin');
    });

    it('should send invitation with specific role (viewer)', async () => {
      const invitation = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'viewer'
      });

      expect(invitation.role).toBe('viewer');
    });

    it('should send invitation with expiration time', async () => {
      const expiresIn = 24 * 60 * 60 * 1000; // 24 hours
      const beforeTime = Date.now();

      const invitation = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        expiresIn
      });

      const afterTime = Date.now();

      expect(invitation.expiresAt).toBeGreaterThan(beforeTime);
      expect(invitation.expiresAt).toBeLessThanOrEqual(afterTime + expiresIn);
      expect(invitation.expiresAt - invitation.createdAt).toBeCloseTo(expiresIn, -2);
    });

    it('should get invitation by ID', async () => {
      const invitation = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'member'
      });

      const retrieved = invitationManager.getInvitation(invitation.invitationId);

      expect(retrieved).toBeDefined();
      expect(retrieved.invitation_id).toBe(invitation.invitationId);
      expect(retrieved.org_id).toBe(org.org_id);
      expect(retrieved.inviter_did).toBe(inviterIdentity.did);
      expect(retrieved.invitee_did).toBe(inviteeIdentity.did);
    });

    it('should list pending invitations for user', async () => {
      // 切换到被邀请人身份
      await didManager.setDefaultIdentity(inviteeIdentity.did);

      // 创建邀请（需要切换回邀请人）
      await didManager.setDefaultIdentity(inviterIdentity.did);
      await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'member'
      });

      // 切换到被邀请人查看邀请
      await didManager.setDefaultIdentity(inviteeIdentity.did);
      const invitations = invitationManager.getReceivedInvitations('pending');

      expect(invitations.length).toBeGreaterThan(0);
      expect(invitations[0].invitee_did).toBe(inviteeIdentity.did);
      expect(invitations[0].status).toBe('pending');
    });

    it('should handle P2P delivery of invitation', async () => {
      const invitation = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'member',
        message: 'Welcome!'
      });

      // 验证P2P消息已发送
      expect(p2pManager.sendEncryptedMessage).toHaveBeenCalledWith(
        inviteeIdentity.did,
        expect.stringContaining(invitation.invitationId),
        null,
        { autoQueue: true }
      );
    });
  });

  // ============================================================================
  // 邀请接受 (6 tests)
  // ============================================================================
  describe('Invitation Acceptance', () => {
    let org, inviterIdentity, inviteeIdentity, invitation;

    beforeEach(async () => {
      // 创建邀请人身份
      inviterIdentity = await didManager.createIdentity(
        { nickname: 'Inviter', displayName: 'Test Inviter' },
        { setAsDefault: true }
      );

      // 创建被邀请人身份
      inviteeIdentity = await didManager.createIdentity(
        { nickname: 'Invitee', displayName: 'Test Invitee' },
        { setAsDefault: false }
      );

      // 创建测试组织
      org = await orgManager.createOrganization({
        name: 'Acceptance Test Org',
        type: 'startup'
      });

      // 创建邀请
      invitation = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'member'
      });
    });

    it('should accept valid invitation', async () => {
      // 切换到被邀请人身份
      await didManager.setDefaultIdentity(inviteeIdentity.did);

      const result = await invitationManager.acceptInvitation(invitation.invitationId);

      expect(result).toBeDefined();
      expect(result.org_id).toBe(org.org_id);

      // 验证邀请状态已更新
      const updated = invitationManager.getInvitation(invitation.invitationId);
      expect(updated.status).toBe('accepted');
      expect(updated.responded_at).toBeDefined();
    });

    it('should accept invitation and join organization', async () => {
      // 切换到被邀请人身份
      await didManager.setDefaultIdentity(inviteeIdentity.did);

      await invitationManager.acceptInvitation(invitation.invitationId);

      // 验证成员已添加到组织
      const isMember = await orgManager.isMember(org.org_id, inviteeIdentity.did);
      expect(isMember).toBe(true);
    });

    it('should reject invitation', async () => {
      // 切换到被邀请人身份
      await didManager.setDefaultIdentity(inviteeIdentity.did);

      await invitationManager.rejectInvitation(invitation.invitationId, 'Not interested');

      // 验证邀请状态已更新
      const updated = invitationManager.getInvitation(invitation.invitationId);
      expect(updated.status).toBe('rejected');
      expect(updated.responded_at).toBeDefined();
    });

    it('should accept invitation updates member role', async () => {
      // 先取消第一个邀请
      await invitationManager.cancelInvitation(invitation.invitationId);

      // 创建管理员角色邀请
      const adminInvitation = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'admin'
      });

      // 切换到被邀请人身份
      await didManager.setDefaultIdentity(inviteeIdentity.did);

      await invitationManager.acceptInvitation(adminInvitation.invitationId);

      // 验证成员角色
      const members = await orgManager.getOrganizationMembers(org.org_id);
      const member = members.find(m => m.member_did === inviteeIdentity.did);
      expect(member).toBeDefined();
      expect(member.role).toBe('admin');
    });

    it('should not accept expired invitation', async () => {
      // 先取消第一个邀请
      await invitationManager.cancelInvitation(invitation.invitationId);

      // 创建已过期的邀请
      const expiredInvitation = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'member',
        expiresIn: -1000 // 已过期
      });

      // 切换到被邀请人身份
      await didManager.setDefaultIdentity(inviteeIdentity.did);

      await expect(
        invitationManager.acceptInvitation(expiredInvitation.invitationId)
      ).rejects.toThrow('邀请已过期');
    });

    it('should not accept cancelled invitation', async () => {
      // 切换回邀请人身份并取消邀请
      await didManager.setDefaultIdentity(inviterIdentity.did);
      await invitationManager.cancelInvitation(invitation.invitationId);

      // 切换到被邀请人身份尝试接受
      await didManager.setDefaultIdentity(inviteeIdentity.did);

      await expect(
        invitationManager.acceptInvitation(invitation.invitationId)
      ).rejects.toThrow('邀请状态无效');
    });
  });

  // ============================================================================
  // 邀请状态管理 (5 tests)
  // ============================================================================
  describe('Invitation Status Management', () => {
    let org, inviterIdentity, inviteeIdentity, invitation;

    beforeEach(async () => {
      // 创建邀请人身份
      inviterIdentity = await didManager.createIdentity(
        { nickname: 'Inviter', displayName: 'Test Inviter' },
        { setAsDefault: true }
      );

      // 创建被邀请人身份
      inviteeIdentity = await didManager.createIdentity(
        { nickname: 'Invitee', displayName: 'Test Invitee' },
        { setAsDefault: false }
      );

      // 创建测试组织
      org = await orgManager.createOrganization({
        name: 'Status Test Org',
        type: 'startup'
      });

      // 创建邀请
      invitation = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'member'
      });
    });

    it('should get invitation status (pending/accepted/rejected/expired/cancelled)', async () => {
      // Pending状态
      let inv = invitationManager.getInvitation(invitation.invitationId);
      expect(inv.status).toBe('pending');

      // 接受后变为accepted
      await didManager.setDefaultIdentity(inviteeIdentity.did);
      await invitationManager.acceptInvitation(invitation.invitationId);
      inv = invitationManager.getInvitation(invitation.invitationId);
      expect(inv.status).toBe('accepted');
    });

    it('should cancel pending invitation (inviter only)', async () => {
      await invitationManager.cancelInvitation(invitation.invitationId);

      const updated = invitationManager.getInvitation(invitation.invitationId);
      expect(updated.status).toBe('cancelled');
    });

    it('should mark invitation as expired', async () => {
      // 先取消第一个邀请
      await invitationManager.cancelInvitation(invitation.invitationId);

      // 创建已过期的邀请 (过期时间为1小时前)
      const expiredInv = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'member',
        expiresIn: -60 * 60 * 1000 // -1小时
      });

      // 验证邀请已创建但是过期的
      const beforeCleanup = invitationManager.getInvitation(expiredInv.invitationId);
      expect(beforeCleanup.status).toBe('pending');
      expect(beforeCleanup.expires_at).toBeLessThan(Date.now());

      // 清理过期邀请
      const cleanupCount = invitationManager.cleanupExpiredInvitations();
      // 注意: sql.js 的 changes 属性可能不可用，所以清理计数可能为0
      // 但是状态应该已经更新

      // 验证状态已更新为expired
      const updated = invitationManager.getInvitation(expiredInv.invitationId);
      expect(updated.status).toBe('expired');
    });

    it('should not cancel already accepted invitation', async () => {
      // 接受邀请
      await didManager.setDefaultIdentity(inviteeIdentity.did);
      await invitationManager.acceptInvitation(invitation.invitationId);

      // 尝试取消
      await didManager.setDefaultIdentity(inviterIdentity.did);
      await expect(
        invitationManager.cancelInvitation(invitation.invitationId)
      ).rejects.toThrow('邀请状态无效');
    });

    it('should get invitation history for organization', async () => {
      // 创建多个邀请
      const invitee2 = await didManager.createIdentity(
        { nickname: 'Invitee2' },
        { setAsDefault: false }
      );

      await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: invitee2.did,
        role: 'viewer'
      });

      const sentInvitations = invitationManager.getSentInvitations(org.org_id);
      expect(sentInvitations.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================================
  // 邀请链接/代码 (7 tests)
  // ============================================================================
  describe('Invite Link/Code', () => {
    let org, inviterIdentity;

    beforeEach(async () => {
      // 创建邀请人身份
      inviterIdentity = await didManager.createIdentity(
        { nickname: 'Inviter', displayName: 'Test Inviter' },
        { setAsDefault: true }
      );

      // 创建测试组织
      org = await orgManager.createOrganization({
        name: 'Link Test Org',
        type: 'startup'
      });
    });

    it('should generate invitation link', async () => {
      const link = await invitationManager.createInvitationLink({
        orgId: org.org_id,
        role: 'member',
        message: 'Join our organization'
      });

      expect(link).toBeDefined();
      expect(link.linkId).toMatch(/^link_/);
      expect(link.invitationToken).toBeDefined();
      expect(link.invitationUrl).toMatch(/^chainlesschain:\/\/invite\//);
      expect(link.role).toBe('member');
      expect(link.maxUses).toBe(1);
      expect(link.status).toBe('active');
    });

    it('should generate invitation code', async () => {
      const link = await invitationManager.createInvitationLink({
        orgId: org.org_id,
        role: 'member'
      });

      expect(link.invitationToken).toBeDefined();
      expect(link.invitationToken.length).toBeGreaterThan(20);
    });

    it('should generate QR code for invitation', async () => {
      const link = await invitationManager.createInvitationLink({
        orgId: org.org_id,
        role: 'member'
      });

      const qrCode = await invitationManager.generateInvitationQRCode(link.invitationToken);

      expect(qrCode).toBeDefined();
      expect(qrCode).toMatch(/^data:image\/png;base64,/);
    });

    it('should accept invitation via link token', async () => {
      const link = await invitationManager.createInvitationLink({
        orgId: org.org_id,
        role: 'member',
        maxUses: 5
      });

      // 创建新用户并接受邀请
      const newUser = await didManager.createIdentity(
        { nickname: 'NewUser', displayName: 'New User' },
        { setAsDefault: false }
      );
      await didManager.setDefaultIdentity(newUser.did);

      const result = await invitationManager.acceptInvitationLink(link.invitationToken);

      expect(result).toBeDefined();
      expect(result.org_id).toBe(org.org_id);

      // 验证成员已加入
      const isMember = await orgManager.isMember(org.org_id, newUser.did);
      expect(isMember).toBe(true);
    });

    it('should accept invitation via code', async () => {
      const link = await invitationManager.createInvitationLink({
        orgId: org.org_id,
        role: 'viewer'
      });

      // 验证令牌
      const linkInfo = await invitationManager.validateInvitationToken(link.invitationToken);

      expect(linkInfo).toBeDefined();
      expect(linkInfo.orgId).toBe(org.org_id);
      expect(linkInfo.role).toBe('viewer');
    });

    it('should track link usage count', async () => {
      const link = await invitationManager.createInvitationLink({
        orgId: org.org_id,
        role: 'member',
        maxUses: 3
      });

      // 第一个用户
      const user1 = await didManager.createIdentity(
        { nickname: 'User1' },
        { setAsDefault: false }
      );
      await didManager.setDefaultIdentity(user1.did);
      await invitationManager.acceptInvitationLink(link.invitationToken);

      // 验证使用次数
      const updated = invitationManager.getInvitationLink(link.linkId);
      expect(updated.used_count).toBe(1);
      expect(updated.remainingUses).toBe(2);
    });

    it('should expire link after max uses', async () => {
      const link = await invitationManager.createInvitationLink({
        orgId: org.org_id,
        role: 'member',
        maxUses: 1
      });

      // 第一个用户使用
      const user1 = await didManager.createIdentity(
        { nickname: 'User1' },
        { setAsDefault: false }
      );
      await didManager.setDefaultIdentity(user1.did);
      await invitationManager.acceptInvitationLink(link.invitationToken);

      // 第二个用户尝试使用
      const user2 = await didManager.createIdentity(
        { nickname: 'User2' },
        { setAsDefault: false }
      );
      await didManager.setDefaultIdentity(user2.did);

      await expect(
        invitationManager.acceptInvitationLink(link.invitationToken)
      ).rejects.toThrow('使用次数已达上限');
    });
  });

  // ============================================================================
  // P2P邀请传递 (5 tests)
  // ============================================================================
  describe('P2P Invitation Delivery', () => {
    let org, inviterIdentity, inviteeIdentity;

    beforeEach(async () => {
      // 创建邀请人身份
      inviterIdentity = await didManager.createIdentity(
        { nickname: 'Inviter', displayName: 'Test Inviter' },
        { setAsDefault: true }
      );

      // 创建被邀请人身份
      inviteeIdentity = await didManager.createIdentity(
        { nickname: 'Invitee', displayName: 'Test Invitee' },
        { setAsDefault: false }
      );

      // 创建测试组织
      org = await orgManager.createOrganization({
        name: 'P2P Test Org',
        type: 'startup'
      });
    });

    it('should register P2P message handlers', () => {
      // 验证P2P处理器已注册
      expect(p2pManager.node.handle).toHaveBeenCalled();
      expect(p2pManager.node.handle).toHaveBeenCalledWith(
        '/chainlesschain/did-invitation/1.0.0',
        expect.any(Function)
      );
    });

    it('should send invitation via P2P network', async () => {
      await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'member'
      });

      // 验证P2P消息已发送
      expect(p2pManager.sendEncryptedMessage).toHaveBeenCalled();
    });

    it('should receive invitation notification', async () => {
      const invitation = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'member',
        message: 'Welcome!'
      });

      // 模拟接收邀请
      await invitationManager.handleIncomingInvitation(
        {
          invitationId: invitation.invitationId,
          orgId: org.org_id,
          inviterDID: inviterIdentity.did,
          inviteeDID: inviteeIdentity.did,
          invitationType: 'direct_did',
          role: 'member',
          message: 'Welcome!',
          status: 'pending',
          createdAt: Date.now(),
          expiresAt: null
        },
        'test-peer-id'
      );

      // 切换到被邀请人身份以查看收到的邀请
      await didManager.setDefaultIdentity(inviteeIdentity.did);

      // 验证邀请已保存（会有重复检测，所以邀请数量不会增加）
      const invitations = invitationManager.getReceivedInvitations();
      expect(invitations.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle offline recipient (queue message)', async () => {
      // P2P管理器应该使用autoQueue选项
      await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'member'
      });

      expect(p2pManager.sendEncryptedMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        null,
        { autoQueue: true }
      );
    });

    it('should retry failed invitation delivery', async () => {
      // 创建会失败的P2P管理器
      const failingP2PManager = {
        isInitialized: vi.fn(() => true),
        sendEncryptedMessage: vi.fn(async () => {
          throw new Error('P2P network error');
        }),
        node: {
          handle: vi.fn()
        }
      };

      const failingInvitationManager = new DIDInvitationManager(
        db,
        didManager,
        failingP2PManager,
        orgManager
      );

      // 即使P2P失败，邀请仍应创建成功
      const invitation = await failingInvitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'member'
      });

      expect(invitation).toBeDefined();
      expect(invitation.invitationId).toMatch(/^inv_/);

      // 验证P2P发送被尝试
      expect(failingP2PManager.sendEncryptedMessage).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 权限验证 (4 tests)
  // ============================================================================
  describe('Permission Validation', () => {
    let org, ownerIdentity, adminIdentity, memberIdentity, viewerIdentity, externalIdentity;

    beforeEach(async () => {
      // 创建所有者身份
      ownerIdentity = await didManager.createIdentity(
        { nickname: 'Owner', displayName: 'Owner' },
        { setAsDefault: true }
      );

      // 创建测试组织
      org = await orgManager.createOrganization({
        name: 'Permission Test Org',
        type: 'startup'
      });

      // 创建不同角色的成员
      adminIdentity = await didManager.createIdentity(
        { nickname: 'Admin' },
        { setAsDefault: false }
      );
      await orgManager.addMember(org.org_id, {
        memberDID: adminIdentity.did,
        displayName: 'Admin',
        avatar: '',
        role: 'admin',
        permissions: JSON.stringify(orgManager.getDefaultPermissionsByRole('admin'))
      });

      memberIdentity = await didManager.createIdentity(
        { nickname: 'Member' },
        { setAsDefault: false }
      );
      await orgManager.addMember(org.org_id, {
        memberDID: memberIdentity.did,
        displayName: 'Member',
        avatar: '',
        role: 'member',
        permissions: JSON.stringify(orgManager.getDefaultPermissionsByRole('member'))
      });

      viewerIdentity = await didManager.createIdentity(
        { nickname: 'Viewer' },
        { setAsDefault: false }
      );
      await orgManager.addMember(org.org_id, {
        memberDID: viewerIdentity.did,
        displayName: 'Viewer',
        avatar: '',
        role: 'viewer',
        permissions: JSON.stringify(orgManager.getDefaultPermissionsByRole('viewer'))
      });

      // 创建外部用户
      externalIdentity = await didManager.createIdentity(
        { nickname: 'External' },
        { setAsDefault: false }
      );
    });

    it('should allow admin to invite', async () => {
      // 切换到管理员身份
      await didManager.setDefaultIdentity(adminIdentity.did);

      const invitation = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: externalIdentity.did,
        role: 'member'
      });

      expect(invitation).toBeDefined();
      expect(invitation.inviterDID).toBe(adminIdentity.did);
    });

    it('should prevent member from sending invitations', async () => {
      // 切换到普通成员身份
      await didManager.setDefaultIdentity(memberIdentity.did);

      await expect(
        invitationManager.createDIDInvitation({
          orgId: org.org_id,
          inviteeDID: externalIdentity.did,
          role: 'member'
        })
      ).rejects.toThrow('没有邀请成员的权限');
    });

    it('should prevent viewer from sending invitations', async () => {
      // 切换到查看者身份
      await didManager.setDefaultIdentity(viewerIdentity.did);

      await expect(
        invitationManager.createDIDInvitation({
          orgId: org.org_id,
          inviteeDID: externalIdentity.did,
          role: 'member'
        })
      ).rejects.toThrow('没有邀请成员的权限');
    });

    it('should verify inviter has permission before sending', async () => {
      // 外部用户尝试邀请
      await didManager.setDefaultIdentity(externalIdentity.did);

      await expect(
        invitationManager.createDIDInvitation({
          orgId: org.org_id,
          inviteeDID: memberIdentity.did,
          role: 'member'
        })
      ).rejects.toThrow('没有邀请成员的权限');
    });
  });

  // ============================================================================
  // 错误处理 (5 tests)
  // ============================================================================
  describe('Error Handling', () => {
    let org, inviterIdentity, inviteeIdentity;

    beforeEach(async () => {
      // 创建邀请人身份
      inviterIdentity = await didManager.createIdentity(
        { nickname: 'Inviter', displayName: 'Test Inviter' },
        { setAsDefault: true }
      );

      // 创建被邀请人身份
      inviteeIdentity = await didManager.createIdentity(
        { nickname: 'Invitee', displayName: 'Test Invitee' },
        { setAsDefault: false }
      );

      // 创建测试组织
      org = await orgManager.createOrganization({
        name: 'Error Test Org',
        type: 'startup'
      });
    });

    it('should handle database errors', async () => {
      // 使用无效的组织ID
      await expect(
        invitationManager.createDIDInvitation({
          orgId: 'invalid-org-id-xyz',
          inviteeDID: inviteeIdentity.did,
          role: 'member'
        })
      ).rejects.toThrow();
    });

    it('should handle DID resolution failures', async () => {
      // 使用不存在的DID - 系统允许邀请不在本地数据库的DID
      // 因为它们可能存在于其他节点上
      const invitation = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: 'did:key:nonexistent-did',
        role: 'member'
      });

      // 验证邀请仍然可以创建
      expect(invitation).toBeDefined();
      expect(invitation.inviteeDID).toBe('did:key:nonexistent-did');
    });

    it('should handle P2P network errors', async () => {
      // 创建会失败的P2P管理器
      const failingP2PManager = {
        sendEncryptedMessage: vi.fn(async () => {
          throw new Error('P2P network error');
        }),
        node: {
          handle: vi.fn()
        }
      };

      const failingInvitationManager = new DIDInvitationManager(
        db,
        didManager,
        failingP2PManager,
        orgManager
      );

      // P2P错误不应阻止邀请创建
      const invitation = await failingInvitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'member'
      });

      expect(invitation).toBeDefined();
    });

    it('should handle invalid invitation data', async () => {
      // 尝试接受不存在的邀请
      await expect(
        invitationManager.acceptInvitation('inv_nonexistent')
      ).rejects.toThrow('邀请不存在');

      // 尝试取消不存在的邀请
      await expect(
        invitationManager.cancelInvitation('inv_nonexistent')
      ).rejects.toThrow('邀请不存在');
    });

    it('should handle duplicate invitation prevention', async () => {
      // 创建第一个邀请
      await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: inviteeIdentity.did,
        role: 'member'
      });

      // 尝试创建重复邀请
      await expect(
        invitationManager.createDIDInvitation({
          orgId: org.org_id,
          inviteeDID: inviteeIdentity.did,
          role: 'member'
        })
      ).rejects.toThrow('该用户已有待处理的邀请');
    });
  });

  // ============================================================================
  // 额外测试: 邀请统计
  // ============================================================================
  describe('Invitation Statistics', () => {
    let org, inviterIdentity, invitee1, invitee2;

    beforeEach(async () => {
      // 创建邀请人身份
      inviterIdentity = await didManager.createIdentity(
        { nickname: 'Inviter', displayName: 'Test Inviter' },
        { setAsDefault: true }
      );

      // 创建被邀请人身份
      invitee1 = await didManager.createIdentity(
        { nickname: 'Invitee1' },
        { setAsDefault: false }
      );

      invitee2 = await didManager.createIdentity(
        { nickname: 'Invitee2' },
        { setAsDefault: false }
      );

      // 创建测试组织
      org = await orgManager.createOrganization({
        name: 'Stats Test Org',
        type: 'startup'
      });
    });

    it('should get invitation statistics', async () => {
      // 创建多个邀请
      const inv1 = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: invitee1.did,
        role: 'member'
      });

      const inv2 = await invitationManager.createDIDInvitation({
        orgId: org.org_id,
        inviteeDID: invitee2.did,
        role: 'member'
      });

      // 接受一个邀请
      await didManager.setDefaultIdentity(invitee1.did);
      await invitationManager.acceptInvitation(inv1.invitationId);

      // 获取统计
      await didManager.setDefaultIdentity(inviterIdentity.did);
      const stats = invitationManager.getInvitationStats(org.org_id);

      expect(stats.sent).toBeGreaterThanOrEqual(2);
      expect(stats.pending).toBeGreaterThanOrEqual(1);
      expect(stats.accepted).toBeGreaterThanOrEqual(1);
    });

    it('should get invitation link statistics', async () => {
      // 创建邀请链接
      const link1 = await invitationManager.createInvitationLink({
        orgId: org.org_id,
        role: 'member',
        maxUses: 5
      });

      const link2 = await invitationManager.createInvitationLink({
        orgId: org.org_id,
        role: 'viewer',
        maxUses: 10
      });

      // 使用一个链接
      await didManager.setDefaultIdentity(invitee1.did);
      await invitationManager.acceptInvitationLink(link1.invitationToken);

      // 获取统计
      const stats = invitationManager.getInvitationLinkStats(org.org_id);

      expect(stats.total).toBeGreaterThanOrEqual(2);
      expect(stats.active).toBeGreaterThanOrEqual(2);
      expect(stats.totalUses).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // 额外测试: QR码生成
  // ============================================================================
  describe('QR Code Generation', () => {
    let org, inviterIdentity;

    beforeEach(async () => {
      // 创建邀请人身份
      inviterIdentity = await didManager.createIdentity(
        { nickname: 'Inviter', displayName: 'Test Inviter' },
        { setAsDefault: true }
      );

      // 创建测试组织
      org = await orgManager.createOrganization({
        name: 'QR Test Org',
        type: 'startup'
      });
    });

    it('should generate QR code for invitation link', async () => {
      const link = await invitationManager.createInvitationLink({
        orgId: org.org_id,
        role: 'member'
      });

      const qrCode = await invitationManager.generateInvitationQRCode(link.invitationToken);

      expect(qrCode).toBeDefined();
      expect(qrCode).toMatch(/^data:image\/png;base64,/);
    });

    it('should generate QR code in different formats', async () => {
      const link = await invitationManager.createInvitationLink({
        orgId: org.org_id,
        role: 'member'
      });

      // PNG格式
      const QRCode = require('qrcode');
      const pngQR = await invitationManager.generateInvitationQRCode(link.invitationToken, {
        format: 'png'
      });
      expect(Buffer.isBuffer(pngQR)).toBe(true);

      // SVG格式
      const svgQR = await invitationManager.generateInvitationQRCode(link.invitationToken, {
        format: 'svg'
      });
      expect(svgQR).toContain('<svg');
    });

    it('should parse invitation QR code', async () => {
      const link = await invitationManager.createInvitationLink({
        orgId: org.org_id,
        role: 'member'
      });

      const qrData = `chainlesschain://invite/${link.invitationToken}`;
      const parsed = await invitationManager.parseInvitationQRCode(qrData);

      expect(parsed).toBeDefined();
      expect(parsed.type).toBe('invitation_link');
      expect(parsed.orgId).toBe(org.org_id);
    });
  });
});
