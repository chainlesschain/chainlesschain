/**
 * DID邀请机制单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const path = require('path');
const fs = require('fs');

// 模拟依赖
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

describe('DID Invitation Mechanism', () => {
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
    testDbPath = path.join(__dirname, '../temp/test-did-invitation.db');
    const testDir = path.dirname(testDbPath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // 加载模块
    DatabaseManager = require('../../src/main/database');
    DIDManager = require('../../src/main/did/did-manager');
    OrganizationManager = require('../../src/main/organization/organization-manager');

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

  describe('inviteByDID()', () => {
    let orgId, aliceDID, bobDID;

    beforeEach(async () => {
      // 创建测试用户
      const alice = await didManager.createIdentity({ nickname: 'Alice' }, { setAsDefault: true });
      aliceDID = alice.did;

      const bob = await didManager.createIdentity({ nickname: 'Bob' }, { setAsDefault: false });
      bobDID = bob.did;

      // 创建测试组织
      const org = await orgManager.createOrganization({
        name: 'Test Organization',
        type: 'startup',
        description: 'Test org for DID invitation',
      });
      orgId = org.org_id;
    });

    it('应该成功创建DID邀请', async () => {
      const invitation = await orgManager.inviteByDID(orgId, {
        invitedDID: bobDID,
        role: 'member',
        message: '欢迎加入我们的团队',
      });

      expect(invitation).toBeDefined();
      expect(invitation.org_id).toBe(orgId);
      expect(invitation.invited_did).toBe(bobDID);
      expect(invitation.role).toBe('member');
      expect(invitation.status).toBe('pending');
      expect(invitation.message).toBe('欢迎加入我们的团队');
    });

    it('应该发送P2P通知', async () => {
      await orgManager.inviteByDID(orgId, {
        invitedDID: bobDID,
        role: 'member',
      });

      expect(p2pManager.sendMessage).toHaveBeenCalledWith(
        bobDID,
        expect.objectContaining({
          type: 'org_invitation',
          orgId: orgId,
          invitedBy: aliceDID,
        })
      );
    });

    it('应该验证DID格式', async () => {
      await expect(
        orgManager.inviteByDID(orgId, {
          invitedDID: 'invalid-did',
          role: 'member',
        })
      ).rejects.toThrow('无效的DID格式');
    });

    it('应该防止重复邀请', async () => {
      // 第一次邀请
      await orgManager.inviteByDID(orgId, {
        invitedDID: bobDID,
        role: 'member',
      });

      // 第二次邀请应该失败
      await expect(
        orgManager.inviteByDID(orgId, {
          invitedDID: bobDID,
          role: 'member',
        })
      ).rejects.toThrow('已有待处理的邀请');
    });

    it('应该防止邀请已有成员', async () => {
      // 先让Bob加入组织
      await orgManager.addMember(orgId, {
        memberDID: bobDID,
        displayName: 'Bob',
        role: 'member',
      });

      // 尝试再次邀请应该失败
      await expect(
        orgManager.inviteByDID(orgId, {
          invitedDID: bobDID,
          role: 'member',
        })
      ).rejects.toThrow('该用户已经是组织成员');
    });

    it('应该检查邀请权限', async () => {
      // 将Alice的角色改为viewer（无邀请权限）
      const result = db.exec(`
        UPDATE organization_members
        SET role = 'viewer'
        WHERE org_id = ? AND member_did = ?
      `, [orgId, aliceDID]);

      await expect(
        orgManager.inviteByDID(orgId, {
          invitedDID: bobDID,
          role: 'member',
        })
      ).rejects.toThrow('没有邀请权限');
    });

    it('应该支持设置过期时间', async () => {
      const expireAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7天后

      const invitation = await orgManager.inviteByDID(orgId, {
        invitedDID: bobDID,
        role: 'member',
        expireAt,
      });

      expect(invitation.expire_at).toBe(expireAt);
    });
  });

  describe('acceptDIDInvitation()', () => {
    let orgId, aliceDID, bobDID, invitationId;

    beforeEach(async () => {
      // 创建Alice和组织
      const alice = await didManager.createIdentity({ nickname: 'Alice' }, { setAsDefault: true });
      aliceDID = alice.did;

      const org = await orgManager.createOrganization({
        name: 'Test Organization',
        type: 'startup',
      });
      orgId = org.org_id;

      // 创建Bob
      const bob = await didManager.createIdentity({ nickname: 'Bob' }, { setAsDefault: false });
      bobDID = bob.did;

      // Alice邀请Bob
      const invitation = await orgManager.inviteByDID(orgId, {
        invitedDID: bobDID,
        role: 'member',
      });
      invitationId = invitation.id;

      // 切换到Bob的身份
      await didManager.setDefaultIdentity(bobDID);
    });

    it('应该成功接受邀请', async () => {
      const org = await orgManager.acceptDIDInvitation(invitationId);

      expect(org).toBeDefined();
      expect(org.org_id).toBe(orgId);

      // 验证Bob已成为成员
      const members = await orgManager.getOrganizationMembers(orgId);
      const bobMember = members.find(m => m.member_did === bobDID);
      expect(bobMember).toBeDefined();
      expect(bobMember.role).toBe('member');
    });

    it('应该更新邀请状态为accepted', async () => {
      await orgManager.acceptDIDInvitation(invitationId);

      const result = db.exec(`
        SELECT status FROM organization_did_invitations WHERE id = ?
      `, [invitationId]);

      expect(result[0].values[0][0]).toBe('accepted');
    });

    it('应该发送接受通知给邀请人', async () => {
      await orgManager.acceptDIDInvitation(invitationId);

      expect(p2pManager.sendMessage).toHaveBeenCalledWith(
        aliceDID,
        expect.objectContaining({
          type: 'org_invitation_accepted',
          invitationId: invitationId,
          acceptedBy: bobDID,
        })
      );
    });

    it('应该拒绝过期的邀请', async () => {
      // 将邀请设置为已过期
      db.exec(`
        UPDATE organization_did_invitations
        SET expire_at = ?
        WHERE id = ?
      `, [Date.now() - 1000, invitationId]);

      await expect(
        orgManager.acceptDIDInvitation(invitationId)
      ).rejects.toThrow('邀请已过期');
    });

    it('应该拒绝非pending状态的邀请', async () => {
      // 先接受一次
      await orgManager.acceptDIDInvitation(invitationId);

      // 尝试再次接受应该失败
      await expect(
        orgManager.acceptDIDInvitation(invitationId)
      ).rejects.toThrow('邀请状态为 accepted，无法接受');
    });

    it('应该验证被邀请人身份', async () => {
      // 切换回Alice身份
      await didManager.setDefaultIdentity(aliceDID);

      // Alice尝试接受Bob的邀请应该失败
      await expect(
        orgManager.acceptDIDInvitation(invitationId)
      ).rejects.toThrow('邀请对象不匹配');
    });
  });

  describe('rejectDIDInvitation()', () => {
    let orgId, aliceDID, bobDID, invitationId;

    beforeEach(async () => {
      // 创建Alice和组织
      const alice = await didManager.createIdentity({ nickname: 'Alice' }, { setAsDefault: true });
      aliceDID = alice.did;

      const org = await orgManager.createOrganization({
        name: 'Test Organization',
        type: 'startup',
      });
      orgId = org.org_id;

      // 创建Bob
      const bob = await didManager.createIdentity({ nickname: 'Bob' }, { setAsDefault: false });
      bobDID = bob.did;

      // Alice邀请Bob
      const invitation = await orgManager.inviteByDID(orgId, {
        invitedDID: bobDID,
        role: 'member',
      });
      invitationId = invitation.id;

      // 切换到Bob的身份
      await didManager.setDefaultIdentity(bobDID);
    });

    it('应该成功拒绝邀请', async () => {
      const result = await orgManager.rejectDIDInvitation(invitationId);

      expect(result).toBe(true);

      // 验证邀请状态已更新
      const dbResult = db.exec(`
        SELECT status FROM organization_did_invitations WHERE id = ?
      `, [invitationId]);

      expect(dbResult[0].values[0][0]).toBe('rejected');
    });

    it('应该发送拒绝通知给邀请人', async () => {
      await orgManager.rejectDIDInvitation(invitationId);

      expect(p2pManager.sendMessage).toHaveBeenCalledWith(
        aliceDID,
        expect.objectContaining({
          type: 'org_invitation_rejected',
          invitationId: invitationId,
          rejectedBy: bobDID,
        })
      );
    });

    it('应该拒绝非pending状态的邀请', async () => {
      // 先拒绝一次
      await orgManager.rejectDIDInvitation(invitationId);

      // 尝试再次拒绝应该失败
      await expect(
        orgManager.rejectDIDInvitation(invitationId)
      ).rejects.toThrow('邀请状态为 rejected，无法拒绝');
    });
  });

  describe('getPendingDIDInvitations()', () => {
    let orgId, aliceDID, bobDID;

    beforeEach(async () => {
      // 创建Alice和组织
      const alice = await didManager.createIdentity({ nickname: 'Alice' }, { setAsDefault: true });
      aliceDID = alice.did;

      const org = await orgManager.createOrganization({
        name: 'Test Organization',
        type: 'startup',
      });
      orgId = org.org_id;

      // 创建Bob
      const bob = await didManager.createIdentity({ nickname: 'Bob' }, { setAsDefault: false });
      bobDID = bob.did;
    });

    it('应该返回当前用户的待处理邀请', async () => {
      // Alice邀请Bob
      await orgManager.inviteByDID(orgId, {
        invitedDID: bobDID,
        role: 'member',
      });

      // 切换到Bob的身份
      await didManager.setDefaultIdentity(bobDID);

      // 获取Bob的待处理邀请
      const invitations = await orgManager.getPendingDIDInvitations();

      expect(invitations).toHaveLength(1);
      expect(invitations[0].invited_did).toBe(bobDID);
      expect(invitations[0].status).toBe('pending');
    });

    it('应该过滤已过期的邀请', async () => {
      // 创建过期邀请
      const expiredInvitation = await orgManager.inviteByDID(orgId, {
        invitedDID: bobDID,
        role: 'member',
        expireAt: Date.now() - 1000, // 1秒前过期
      });

      // 切换到Bob的身份
      await didManager.setDefaultIdentity(bobDID);

      // 获取待处理邀请应该为空
      const invitations = await orgManager.getPendingDIDInvitations();

      expect(invitations).toHaveLength(0);
    });

    it('应该返回多个邀请', async () => {
      // 创建第二个组织
      const org2 = await orgManager.createOrganization({
        name: 'Test Organization 2',
        type: 'company',
      });

      // 两个组织都邀请Bob
      await orgManager.inviteByDID(orgId, {
        invitedDID: bobDID,
        role: 'member',
      });

      await orgManager.inviteByDID(org2.org_id, {
        invitedDID: bobDID,
        role: 'admin',
      });

      // 切换到Bob的身份
      await didManager.setDefaultIdentity(bobDID);

      // 获取Bob的待处理邀请
      const invitations = await orgManager.getPendingDIDInvitations();

      expect(invitations).toHaveLength(2);
    });
  });

  describe('getDIDInvitations()', () => {
    let orgId, aliceDID, bobDID, charlieDID;

    beforeEach(async () => {
      // 创建用户
      const alice = await didManager.createIdentity({ nickname: 'Alice' }, { setAsDefault: true });
      aliceDID = alice.did;

      const bob = await didManager.createIdentity({ nickname: 'Bob' });
      bobDID = bob.did;

      const charlie = await didManager.createIdentity({ nickname: 'Charlie' });
      charlieDID = charlie.did;

      // 创建组织
      const org = await orgManager.createOrganization({
        name: 'Test Organization',
        type: 'startup',
      });
      orgId = org.org_id;

      // 创建多个邀请
      await orgManager.inviteByDID(orgId, {
        invitedDID: bobDID,
        role: 'member',
      });

      await orgManager.inviteByDID(orgId, {
        invitedDID: charlieDID,
        role: 'admin',
      });
    });

    it('应该返回组织的所有DID邀请', async () => {
      const invitations = await orgManager.getDIDInvitations(orgId);

      expect(invitations).toHaveLength(2);
      expect(invitations.some(inv => inv.invited_did === bobDID)).toBe(true);
      expect(invitations.some(inv => inv.invited_did === charlieDID)).toBe(true);
    });

    it('应该支持按状态筛选', async () => {
      // Bob接受邀请
      const bobInvitation = (await orgManager.getDIDInvitations(orgId)).find(
        inv => inv.invited_did === bobDID
      );

      await didManager.setDefaultIdentity(bobDID);
      await orgManager.acceptDIDInvitation(bobInvitation.id);

      // 只获取已接受的邀请
      await didManager.setDefaultIdentity(aliceDID);
      const acceptedInvitations = await orgManager.getDIDInvitations(orgId, {
        status: 'accepted',
      });

      expect(acceptedInvitations).toHaveLength(1);
      expect(acceptedInvitations[0].invited_did).toBe(bobDID);
      expect(acceptedInvitations[0].status).toBe('accepted');
    });

    it('应该支持限制数量', async () => {
      const invitations = await orgManager.getDIDInvitations(orgId, {
        limit: 1,
      });

      expect(invitations).toHaveLength(1);
    });
  });

  describe('完整流程测试', () => {
    it('应该完成完整的邀请-接受流程', async () => {
      // 1. Alice创建身份和组织
      const alice = await didManager.createIdentity({ nickname: 'Alice' }, { setAsDefault: true });
      const aliceDID = alice.did;

      const org = await orgManager.createOrganization({
        name: 'Alice Team',
        type: 'startup',
        description: 'Alice的团队',
      });
      const orgId = org.org_id;

      // 2. Bob创建身份
      const bob = await didManager.createIdentity({ nickname: 'Bob' });
      const bobDID = bob.did;

      // 3. Alice邀请Bob
      const invitation = await orgManager.inviteByDID(orgId, {
        invitedDID: bobDID,
        role: 'member',
        message: '欢迎加入Alice Team',
      });

      expect(invitation.status).toBe('pending');
      expect(p2pManager.sendMessage).toHaveBeenCalled();

      // 4. Bob查看待处理邀请
      await didManager.setDefaultIdentity(bobDID);
      const pendingInvitations = await orgManager.getPendingDIDInvitations();

      expect(pendingInvitations).toHaveLength(1);
      expect(pendingInvitations[0].org_name).toBe('Alice Team');
      expect(pendingInvitations[0].invited_by_name).toBe('Alice');

      // 5. Bob接受邀请
      const joinedOrg = await orgManager.acceptDIDInvitation(invitation.id);

      expect(joinedOrg.org_id).toBe(orgId);

      // 6. 验证Bob已成为成员
      const members = await orgManager.getOrganizationMembers(orgId);
      const bobMember = members.find(m => m.member_did === bobDID);

      expect(bobMember).toBeDefined();
      expect(bobMember.role).toBe('member');

      // 7. 验证邀请状态已更新
      const updatedInvitations = await orgManager.getDIDInvitations(orgId, {
        status: 'accepted',
      });

      expect(updatedInvitations).toHaveLength(1);
      expect(updatedInvitations[0].id).toBe(invitation.id);

      // 8. 验证Alice收到了接受通知
      expect(p2pManager.sendMessage).toHaveBeenCalledWith(
        aliceDID,
        expect.objectContaining({
          type: 'org_invitation_accepted',
        })
      );
    });

    it('应该完成完整的邀请-拒绝流程', async () => {
      // 1. 创建Alice和组织
      const alice = await didManager.createIdentity({ nickname: 'Alice' }, { setAsDefault: true });
      const aliceDID = alice.did;

      const org = await orgManager.createOrganization({
        name: 'Alice Team',
        type: 'startup',
      });
      const orgId = org.org_id;

      // 2. 创建Bob
      const bob = await didManager.createIdentity({ nickname: 'Bob' });
      const bobDID = bob.did;

      // 3. Alice邀请Bob
      const invitation = await orgManager.inviteByDID(orgId, {
        invitedDID: bobDID,
        role: 'member',
      });

      // 4. Bob拒绝邀请
      await didManager.setDefaultIdentity(bobDID);
      const result = await orgManager.rejectDIDInvitation(invitation.id);

      expect(result).toBe(true);

      // 5. 验证Bob未成为成员
      const members = await orgManager.getOrganizationMembers(orgId);
      const bobMember = members.find(m => m.member_did === bobDID);

      expect(bobMember).toBeUndefined();

      // 6. 验证邀请状态已更新
      const rejectedInvitations = await orgManager.getDIDInvitations(orgId, {
        status: 'rejected',
      });

      expect(rejectedInvitations).toHaveLength(1);
      expect(rejectedInvitations[0].id).toBe(invitation.id);

      // 7. 验证Alice收到了拒绝通知
      expect(p2pManager.sendMessage).toHaveBeenCalledWith(
        aliceDID,
        expect.objectContaining({
          type: 'org_invitation_rejected',
        })
      );
    });
  });

  describe('边缘情况', () => {
    let orgId, aliceDID, bobDID;

    beforeEach(async () => {
      const alice = await didManager.createIdentity({ nickname: 'Alice' }, { setAsDefault: true });
      aliceDID = alice.did;

      const org = await orgManager.createOrganization({
        name: 'Test Organization',
        type: 'startup',
      });
      orgId = org.org_id;

      const bob = await didManager.createIdentity({ nickname: 'Bob' });
      bobDID = bob.did;
    });

    it('P2P未初始化时应该仍能创建邀请', async () => {
      // 模拟P2P未初始化
      p2pManager.isInitialized = vi.fn(() => false);

      const invitation = await orgManager.inviteByDID(orgId, {
        invitedDID: bobDID,
        role: 'member',
      });

      // 邀请应该成功创建
      expect(invitation).toBeDefined();
      expect(invitation.status).toBe('pending');

      // P2P消息不应被发送
      expect(p2pManager.sendMessage).not.toHaveBeenCalled();
    });

    it('P2P发送失败时应该不影响邀请创建', async () => {
      // 模拟P2P发送失败
      p2pManager.sendMessage = vi.fn(() => {
        throw new Error('Network error');
      });

      const invitation = await orgManager.inviteByDID(orgId, {
        invitedDID: bobDID,
        role: 'member',
      });

      // 邀请应该成功创建
      expect(invitation).toBeDefined();
      expect(invitation.status).toBe('pending');
    });

    it('应该处理空的邀请消息', async () => {
      const invitation = await orgManager.inviteByDID(orgId, {
        invitedDID: bobDID,
        role: 'member',
        message: '',
      });

      // 应该使用默认消息
      expect(invitation.message).toContain('邀请您加入组织');
    });

    it('应该处理不同的角色', async () => {
      const roles = ['member', 'admin', 'viewer'];

      for (const role of roles) {
        const bob = await didManager.createIdentity({ nickname: `Bob-${role}` });
        const invitation = await orgManager.inviteByDID(orgId, {
          invitedDID: bob.did,
          role: role,
        });

        expect(invitation.role).toBe(role);
      }
    });
  });
});
