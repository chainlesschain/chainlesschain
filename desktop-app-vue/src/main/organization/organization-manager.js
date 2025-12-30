const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * 组织管理器 - 去中心化组织核心模块
 * 负责组织的创建、加入、管理等核心功能
 *
 * @class OrganizationManager
 */
class OrganizationManager {
  constructor(db, didManager, p2pManager) {
    this.db = db;
    this.didManager = didManager;
    this.p2pManager = p2pManager;
    this.currentOrgId = null;
  }

  /**
   * 创建组织
   * @param {Object} orgData - 组织数据
   * @param {string} orgData.name - 组织名称
   * @param {string} orgData.description - 组织描述
   * @param {string} orgData.type - 组织类型 (startup|company|community|opensource|education)
   * @param {string} orgData.avatar - 组织头像URL
   * @returns {Promise<Object>} 创建的组织信息
   */
  async createOrganization(orgData) {
    console.log('[OrganizationManager] 创建组织:', orgData.name);

    try {
      // 1. 生成组织ID和DID
      const orgId = `org_${uuidv4().replace(/-/g, '')}`;
      const orgDID = await this.didManager.createOrganizationDID(orgId, orgData.name);

      // 2. 获取当前用户DID
      const currentIdentity = await this.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        throw new Error('未找到当前用户身份');
      }

      // 3. 创建组织记录
      const now = Date.now();
      const organization = {
        org_id: orgId,
        org_did: orgDID,
        name: orgData.name,
        description: orgData.description || '',
        type: orgData.type || 'startup',
        avatar: orgData.avatar || '',
        owner_did: currentIdentity.did,
        settings_json: JSON.stringify({
          visibility: orgData.visibility || 'private',
          maxMembers: orgData.maxMembers || 100,
          allowMemberInvite: orgData.allowMemberInvite !== false,
          defaultMemberRole: 'member'
        }),
        created_at: now,
        updated_at: now
      };

      this.db.run(
        `INSERT INTO organization_info
        (org_id, org_did, name, description, type, avatar, owner_did, settings_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          organization.org_id,
          organization.org_did,
          organization.name,
          organization.description,
          organization.type,
          organization.avatar,
          organization.owner_did,
          organization.settings_json,
          organization.created_at,
          organization.updated_at
        ]
      );

      // 4. 添加创建者为Owner
      await this.addMember(orgId, {
        memberDID: currentIdentity.did,
        displayName: currentIdentity.displayName || 'Owner',
        avatar: currentIdentity.avatar || '',
        role: 'owner',
        permissions: JSON.stringify(['*']) // 所有权限
      });

      // 5. 初始化内置角色
      await this.initializeBuiltinRoles(orgId);

      // 6. 生成默认邀请码
      if (orgData.enableInviteCode !== false) {
        await this.createInvitation(orgId, {
          invitedBy: currentIdentity.did,
          role: 'member',
          maxUses: 999,
          expireAt: null // 永不过期
        });
      }

      // 7. 初始化P2P组织网络
      await this.initializeOrgP2PNetwork(orgId);

      // 8. 记录活动日志
      await this.logActivity(orgId, currentIdentity.did, 'create_organization', 'organization', orgId, {
        orgName: orgData.name
      });

      console.log('[OrganizationManager] ✓ 组织创建成功:', orgId);

      return {
        ...organization,
        settings: JSON.parse(organization.settings_json)
      };
    } catch (error) {
      console.error('[OrganizationManager] 创建组织失败:', error);
      throw error;
    }
  }

  /**
   * 加入组织
   * @param {string} inviteCode - 邀请码
   * @returns {Promise<Object>} 加入的组织信息
   */
  async joinOrganization(inviteCode) {
    console.log('[OrganizationManager] 通过邀请码加入组织:', inviteCode);

    try {
      // 1. 验证邀请码
      const invitation = this.db.prepare(
        `SELECT * FROM organization_invitations
         WHERE invite_code = ? AND (expire_at IS NULL OR expire_at > ?) AND used_count < max_uses`
      ).get(inviteCode, Date.now());

      if (!invitation) {
        throw new Error('邀请码无效或已过期');
      }

      // 2. 获取组织信息
      const org = await this.getOrganization(invitation.org_id);
      if (!org) {
        throw new Error('组织不存在');
      }

      // 3. 获取当前用户DID
      const currentIdentity = await this.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        throw new Error('未找到当前用户身份');
      }

      // 4. 检查是否已经是成员
      const existingMember = this.db.prepare(
        `SELECT * FROM organization_members WHERE org_id = ? AND member_did = ?`
      ).get(invitation.org_id, currentIdentity.did);

      if (existingMember) {
        throw new Error('您已经是该组织的成员');
      }

      // 5. 添加为成员
      await this.addMember(invitation.org_id, {
        memberDID: currentIdentity.did,
        displayName: currentIdentity.displayName || 'Member',
        avatar: currentIdentity.avatar || '',
        role: invitation.role,
        permissions: JSON.stringify(this.getDefaultPermissionsByRole(invitation.role))
      });

      // 6. 更新邀请码使用次数
      this.db.run(
        `UPDATE organization_invitations SET used_count = used_count + 1 WHERE id = ?`,
        [invitation.id]
      );

      // 7. 连接到组织P2P网络
      await this.connectToOrgP2PNetwork(invitation.org_id);

      // 8. 同步组织数据
      await this.syncOrganizationData(invitation.org_id);

      // 9. 记录活动日志
      await this.logActivity(invitation.org_id, currentIdentity.did, 'join_organization', 'member', currentIdentity.did, {
        inviteCode: inviteCode
      });

      console.log('[OrganizationManager] ✓ 成功加入组织:', invitation.org_id);

      return org;
    } catch (error) {
      console.error('[OrganizationManager] 加入组织失败:', error);
      throw error;
    }
  }

  /**
   * 获取组织信息
   * @param {string} orgId - 组织ID
   * @returns {Promise<Object|null>} 组织信息
   */
  async getOrganization(orgId) {
    const org = this.db.prepare(`SELECT * FROM organization_info WHERE org_id = ?`).get(orgId);

    if (!org) {
      return null;
    }

    return {
      ...org,
      settings: JSON.parse(org.settings_json || '{}')
    };
  }

  /**
   * 获取用户所属的所有组织
   * @param {string} userDID - 用户DID
   * @returns {Promise<Array>} 组织列表
   */
  async getUserOrganizations(userDID) {
    const memberships = this.db.prepare(
      `SELECT om.*, oi.name, oi.description, oi.type, oi.avatar
       FROM organization_members om
       JOIN organization_info oi ON om.org_id = oi.org_id
       WHERE om.member_did = ? AND om.status = 'active'
       ORDER BY om.joined_at DESC`
    ).all(userDID);

    return memberships.map(m => ({
      orgId: m.org_id,
      name: m.name,
      description: m.description,
      type: m.type,
      avatar: m.avatar,
      role: m.role,
      joinedAt: m.joined_at
    }));
  }

  /**
   * 添加成员
   * @param {string} orgId - 组织ID
   * @param {Object} memberData - 成员数据
   * @returns {Promise<Object>} 添加的成员信息
   */
  async addMember(orgId, memberData) {
    const memberId = uuidv4();
    const now = Date.now();

    const member = {
      id: memberId,
      org_id: orgId,
      member_did: memberData.memberDID,
      display_name: memberData.displayName,
      avatar: memberData.avatar,
      role: memberData.role,
      permissions: memberData.permissions,
      joined_at: now,
      last_active_at: now,
      status: 'active'
    };

    this.db.run(
      `INSERT INTO organization_members
      (id, org_id, member_did, display_name, avatar, role, permissions, joined_at, last_active_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        member.id,
        member.org_id,
        member.member_did,
        member.display_name,
        member.avatar,
        member.role,
        member.permissions,
        member.joined_at,
        member.last_active_at,
        member.status
      ]
    );

    return member;
  }

  /**
   * 获取组织成员列表
   * @param {string} orgId - 组织ID
   * @returns {Promise<Array>} 成员列表
   */
  async getOrganizationMembers(orgId) {
    return this.db.prepare(
      `SELECT * FROM organization_members WHERE org_id = ? AND status = 'active' ORDER BY joined_at ASC`
    ).all(orgId);
  }

  /**
   * 更新成员角色
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID
   * @param {string} newRole - 新角色
   * @returns {Promise<void>}
   */
  async updateMemberRole(orgId, memberDID, newRole) {
    // 检查操作者权限
    const currentIdentity = await this.didManager.getDefaultIdentity();
    const canManage = await this.checkPermission(orgId, currentIdentity.did, 'member.manage');

    if (!canManage) {
      throw new Error('没有权限管理成员');
    }

    // 更新角色
    this.db.run(
      `UPDATE organization_members SET role = ?, permissions = ? WHERE org_id = ? AND member_did = ?`,
      [newRole, JSON.stringify(this.getDefaultPermissionsByRole(newRole)), orgId, memberDID]
    );

    // 记录活动日志
    await this.logActivity(orgId, currentIdentity.did, 'update_member_role', 'member', memberDID, {
      newRole: newRole
    });
  }

  /**
   * 移除成员
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID
   * @returns {Promise<void>}
   */
  async removeMember(orgId, memberDID) {
    // 检查操作者权限
    const currentIdentity = await this.didManager.getDefaultIdentity();
    const canRemove = await this.checkPermission(orgId, currentIdentity.did, 'member.remove');

    if (!canRemove) {
      throw new Error('没有权限移除成员');
    }

    // 不能移除owner
    const member = this.db.prepare(
      `SELECT role FROM organization_members WHERE org_id = ? AND member_did = ?`
    ).get(orgId, memberDID);

    if (member && member.role === 'owner') {
      throw new Error('不能移除组织所有者');
    }

    // 更新状态为removed
    this.db.run(
      `UPDATE organization_members SET status = 'removed' WHERE org_id = ? AND member_did = ?`,
      [orgId, memberDID]
    );

    // 记录活动日志
    await this.logActivity(orgId, currentIdentity.did, 'remove_member', 'member', memberDID, {});
  }

  /**
   * 创建邀请
   * @param {string} orgId - 组织ID
   * @param {Object} inviteData - 邀请数据
   * @returns {Promise<Object>} 邀请信息
   */
  async createInvitation(orgId, inviteData) {
    const invitationId = uuidv4();
    const inviteCode = this.generateInviteCode();

    const invitation = {
      id: invitationId,
      org_id: orgId,
      invite_code: inviteCode,
      invited_by: inviteData.invitedBy,
      role: inviteData.role || 'member',
      max_uses: inviteData.maxUses || 1,
      used_count: 0,
      expire_at: inviteData.expireAt || null,
      created_at: Date.now()
    };

    this.db.run(
      `INSERT INTO organization_invitations
      (id, org_id, invite_code, invited_by, role, max_uses, used_count, expire_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invitation.id,
        invitation.org_id,
        invitation.invite_code,
        invitation.invited_by,
        invitation.role,
        invitation.max_uses,
        invitation.used_count,
        invitation.expire_at,
        invitation.created_at
      ]
    );

    return invitation;
  }

  /**
   * 通过DID邀请用户加入组织
   * @param {string} orgId - 组织ID
   * @param {Object} inviteData - 邀请数据
   * @param {string} inviteData.invitedDID - 被邀请人的DID
   * @param {string} inviteData.role - 角色 (member|admin|viewer)
   * @param {string} inviteData.message - 邀请消息（可选）
   * @param {number} inviteData.expireAt - 过期时间戳（可选）
   * @returns {Promise<Object>} 邀请信息
   */
  async inviteByDID(orgId, inviteData) {
    console.log('[OrganizationManager] 通过DID邀请用户:', inviteData.invitedDID);

    try {
      // 1. 获取组织信息
      const org = await this.getOrganization(orgId);
      if (!org) {
        throw new Error('组织不存在');
      }

      // 2. 获取当前用户DID
      const currentIdentity = await this.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        throw new Error('未找到当前用户身份');
      }

      // 3. 检查权限（只有Owner和Admin可以邀请）
      const hasPermission = await this.checkPermission(orgId, currentIdentity.did, 'member.invite');
      if (!hasPermission) {
        throw new Error('没有邀请权限');
      }

      // 4. 验证被邀请人的DID格式
      if (!inviteData.invitedDID || !inviteData.invitedDID.startsWith('did:')) {
        throw new Error('无效的DID格式');
      }

      // 5. 检查用户是否已经是成员
      const existingMember = this.db.prepare(
        `SELECT * FROM organization_members WHERE org_id = ? AND member_did = ?`
      ).get(orgId, inviteData.invitedDID);

      if (existingMember) {
        throw new Error('该用户已经是组织成员');
      }

      // 6. 检查是否已有待处理的邀请
      const existingInvitation = this.db.prepare(
        `SELECT * FROM organization_did_invitations
         WHERE org_id = ? AND invited_did = ? AND status = 'pending'`
      ).get(orgId, inviteData.invitedDID);

      if (existingInvitation) {
        throw new Error('已有待处理的邀请');
      }

      // 7. 创建DID邀请记录
      const invitationId = uuidv4();
      const now = Date.now();
      const invitation = {
        id: invitationId,
        org_id: orgId,
        org_name: org.name,
        invited_by_did: currentIdentity.did,
        invited_by_name: currentIdentity.nickname || currentIdentity.displayName || 'Unknown',
        invited_did: inviteData.invitedDID,
        role: inviteData.role || 'member',
        status: 'pending',
        message: inviteData.message || `邀请您加入组织 ${org.name}`,
        expire_at: inviteData.expireAt || null,
        created_at: now,
        updated_at: now
      };

      this.db.run(
        `INSERT INTO organization_did_invitations
        (id, org_id, org_name, invited_by_did, invited_by_name, invited_did, role, status, message, expire_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invitation.id,
          invitation.org_id,
          invitation.org_name,
          invitation.invited_by_did,
          invitation.invited_by_name,
          invitation.invited_did,
          invitation.role,
          invitation.status,
          invitation.message,
          invitation.expire_at,
          invitation.created_at,
          invitation.updated_at
        ]
      );

      // 8. 通过P2P发送邀请通知
      if (this.p2pManager && this.p2pManager.isInitialized && this.p2pManager.isInitialized()) {
        try {
          await this.p2pManager.sendMessage(inviteData.invitedDID, {
            type: 'org_invitation',
            invitationId: invitation.id,
            orgId: invitation.org_id,
            orgName: invitation.org_name,
            invitedBy: invitation.invited_by_did,
            invitedByName: invitation.invited_by_name,
            role: invitation.role,
            message: invitation.message,
            expireAt: invitation.expire_at,
            createdAt: invitation.created_at
          });
          console.log('[OrganizationManager] P2P邀请通知已发送');
        } catch (error) {
          console.warn('[OrganizationManager] P2P邀请通知发送失败:', error.message);
          // 不中断流程，邀请记录已创建，用户可以通过其他方式看到
        }
      } else {
        console.warn('[OrganizationManager] P2P未初始化，无法发送邀请通知');
      }

      // 9. 记录活动日志
      await this.logActivity(orgId, currentIdentity.did, 'invite_by_did', 'invitation', invitationId, {
        invitedDID: inviteData.invitedDID,
        role: invitation.role
      });

      console.log('[OrganizationManager] ✓ DID邀请创建成功:', invitationId);

      return invitation;
    } catch (error) {
      console.error('[OrganizationManager] 创建DID邀请失败:', error);
      throw error;
    }
  }

  /**
   * 接受DID邀请
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<Object>} 组织信息
   */
  async acceptDIDInvitation(invitationId) {
    console.log('[OrganizationManager] 接受DID邀请:', invitationId);

    try {
      // 1. 获取邀请信息
      const invitation = this.db.prepare(
        `SELECT * FROM organization_did_invitations WHERE id = ?`
      ).get(invitationId);

      if (!invitation) {
        throw new Error('邀请不存在');
      }

      // 2. 检查邀请状态
      if (invitation.status !== 'pending') {
        throw new Error(`邀请状态为 ${invitation.status}，无法接受`);
      }

      // 3. 检查是否过期
      if (invitation.expire_at && Date.now() > invitation.expire_at) {
        // 更新状态为过期
        this.db.run(
          `UPDATE organization_did_invitations SET status = 'expired', updated_at = ? WHERE id = ?`,
          [Date.now(), invitationId]
        );
        throw new Error('邀请已过期');
      }

      // 4. 获取当前用户DID
      const currentIdentity = await this.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        throw new Error('未找到当前用户身份');
      }

      // 5. 验证被邀请人
      if (currentIdentity.did !== invitation.invited_did) {
        throw new Error('邀请对象不匹配');
      }

      // 6. 检查是否已经是成员
      const existingMember = this.db.prepare(
        `SELECT * FROM organization_members WHERE org_id = ? AND member_did = ?`
      ).get(invitation.org_id, currentIdentity.did);

      if (existingMember) {
        throw new Error('您已经是该组织的成员');
      }

      // 7. 添加为组织成员
      await this.addMember(invitation.org_id, {
        memberDID: currentIdentity.did,
        displayName: currentIdentity.nickname || currentIdentity.displayName || 'Member',
        avatar: currentIdentity.avatar || '',
        role: invitation.role,
        permissions: JSON.stringify(this.getDefaultPermissionsByRole(invitation.role))
      });

      // 8. 更新邀请状态
      this.db.run(
        `UPDATE organization_did_invitations SET status = 'accepted', updated_at = ? WHERE id = ?`,
        [Date.now(), invitationId]
      );

      // 9. 连接到组织P2P网络
      if (this.p2pManager && this.p2pManager.isInitialized && this.p2pManager.isInitialized()) {
        try {
          await this.connectToOrgP2PNetwork(invitation.org_id);
        } catch (error) {
          console.warn('[OrganizationManager] 连接组织P2P网络失败:', error.message);
        }
      }

      // 10. 同步组织数据
      try {
        await this.syncOrganizationData(invitation.org_id);
      } catch (error) {
        console.warn('[OrganizationManager] 同步组织数据失败:', error.message);
      }

      // 11. 通过P2P通知邀请人
      if (this.p2pManager && this.p2pManager.isInitialized && this.p2pManager.isInitialized()) {
        try {
          await this.p2pManager.sendMessage(invitation.invited_by_did, {
            type: 'org_invitation_accepted',
            invitationId: invitation.id,
            orgId: invitation.org_id,
            acceptedBy: currentIdentity.did,
            acceptedByName: currentIdentity.nickname || currentIdentity.displayName || 'Unknown'
          });
        } catch (error) {
          console.warn('[OrganizationManager] 发送接受通知失败:', error.message);
        }
      }

      // 12. 记录活动日志
      await this.logActivity(invitation.org_id, currentIdentity.did, 'accept_invitation', 'invitation', invitationId, {
        invitedBy: invitation.invited_by_did
      });

      // 13. 获取并返回组织信息
      const org = await this.getOrganization(invitation.org_id);

      console.log('[OrganizationManager] ✓ 成功接受邀请并加入组织:', invitation.org_id);

      return org;
    } catch (error) {
      console.error('[OrganizationManager] 接受DID邀请失败:', error);
      throw error;
    }
  }

  /**
   * 拒绝DID邀请
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<boolean>} 是否成功
   */
  async rejectDIDInvitation(invitationId) {
    console.log('[OrganizationManager] 拒绝DID邀请:', invitationId);

    try {
      // 1. 获取邀请信息
      const invitation = this.db.prepare(
        `SELECT * FROM organization_did_invitations WHERE id = ?`
      ).get(invitationId);

      if (!invitation) {
        throw new Error('邀请不存在');
      }

      // 2. 检查邀请状态
      if (invitation.status !== 'pending') {
        throw new Error(`邀请状态为 ${invitation.status}，无法拒绝`);
      }

      // 3. 获取当前用户DID
      const currentIdentity = await this.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        throw new Error('未找到当前用户身份');
      }

      // 4. 验证被邀请人
      if (currentIdentity.did !== invitation.invited_did) {
        throw new Error('邀请对象不匹配');
      }

      // 5. 更新邀请状态
      this.db.run(
        `UPDATE organization_did_invitations SET status = 'rejected', updated_at = ? WHERE id = ?`,
        [Date.now(), invitationId]
      );

      // 6. 通过P2P通知邀请人
      if (this.p2pManager && this.p2pManager.isInitialized && this.p2pManager.isInitialized()) {
        try {
          await this.p2pManager.sendMessage(invitation.invited_by_did, {
            type: 'org_invitation_rejected',
            invitationId: invitation.id,
            orgId: invitation.org_id,
            rejectedBy: currentIdentity.did,
            rejectedByName: currentIdentity.nickname || currentIdentity.displayName || 'Unknown'
          });
        } catch (error) {
          console.warn('[OrganizationManager] 发送拒绝通知失败:', error.message);
        }
      }

      console.log('[OrganizationManager] ✓ 成功拒绝邀请:', invitationId);

      return true;
    } catch (error) {
      console.error('[OrganizationManager] 拒绝DID邀请失败:', error);
      throw error;
    }
  }

  /**
   * 获取待处理的DID邀请（当前用户收到的）
   * @returns {Promise<Array>} 邀请列表
   */
  async getPendingDIDInvitations() {
    try {
      const currentIdentity = await this.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return [];
      }

      const invitations = this.db.prepare(
        `SELECT * FROM organization_did_invitations
         WHERE invited_did = ? AND status = 'pending'
         AND (expire_at IS NULL OR expire_at > ?)
         ORDER BY created_at DESC`
      ).all(currentIdentity.did, Date.now());

      return invitations || [];
    } catch (error) {
      console.error('[OrganizationManager] 获取待处理邀请失败:', error);
      return [];
    }
  }

  /**
   * 获取组织的DID邀请列表（用于管理）
   * @param {string} orgId - 组织ID
   * @param {Object} options - 选项
   * @param {string} options.status - 状态筛选（pending|accepted|rejected|expired）
   * @param {number} options.limit - 限制数量
   * @returns {Promise<Array>} 邀请列表
   */
  async getDIDInvitations(orgId, options = {}) {
    try {
      let query = `SELECT * FROM organization_did_invitations WHERE org_id = ?`;
      const params = [orgId];

      if (options.status) {
        query += ` AND status = ?`;
        params.push(options.status);
      }

      query += ` ORDER BY created_at DESC`;

      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }

      const invitations = this.db.prepare(query).all(...params);

      return invitations || [];
    } catch (error) {
      console.error('[OrganizationManager] 获取DID邀请列表失败:', error);
      return [];
    }
  }

  /**
   * 初始化内置角色
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */
  async initializeBuiltinRoles(orgId) {
    const builtinRoles = [
      {
        name: 'owner',
        description: '组织创建者，拥有最高权限',
        permissions: JSON.stringify(['*'])
      },
      {
        name: 'admin',
        description: '管理员，可以管理成员和内容',
        permissions: JSON.stringify([
          'org.manage', 'member.invite', 'member.remove', 'member.manage',
          'knowledge.create', 'knowledge.read', 'knowledge.write', 'knowledge.delete',
          'project.create', 'project.delete', 'role.create', 'role.assign'
        ])
      },
      {
        name: 'member',
        description: '普通成员，可以创建和编辑内容',
        permissions: JSON.stringify([
          'knowledge.create', 'knowledge.read', 'knowledge.write',
          'project.create', 'project.read', 'project.write', 'message.send'
        ])
      },
      {
        name: 'viewer',
        description: '访客，只能查看内容',
        permissions: JSON.stringify(['knowledge.read', 'project.read', 'message.read'])
      }
    ];

    for (const role of builtinRoles) {
      this.db.run(
        `INSERT INTO organization_roles (id, org_id, name, description, permissions, is_builtin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), orgId, role.name, role.description, role.permissions, 1, Date.now()]
      );
    }
  }

  /**
   * 检查权限
   * @param {string} orgId - 组织ID
   * @param {string} userDID - 用户DID
   * @param {string} permission - 权限字符串 (如 'knowledge.write')
   * @returns {Promise<boolean>} 是否有权限
   */
  async checkPermission(orgId, userDID, permission) {
    // 获取用户成员信息
    const member = this.db.prepare(
      `SELECT role, permissions FROM organization_members WHERE org_id = ? AND member_did = ? AND status = 'active'`
    ).get(orgId, userDID);

    if (!member) {
      return false; // 不是成员
    }

    // 获取角色权限
    const role = this.db.prepare(
      `SELECT permissions FROM organization_roles WHERE org_id = ? AND name = ?`
    ).get(orgId, member.role);

    if (!role) {
      return false;
    }

    const permissions = JSON.parse(role.permissions || '[]');

    // Owner 拥有所有权限
    if (permissions.includes('*')) {
      return true;
    }

    // 检查具体权限
    if (permissions.includes(permission)) {
      return true;
    }

    // 检查通配符权限 (例如: knowledge.* 包含 knowledge.read)
    const [resource, action] = permission.split('.');
    const wildcardPermission = `${resource}.*`;
    if (permissions.includes(wildcardPermission)) {
      return true;
    }

    return false;
  }

  /**
   * 记录活动日志
   * @param {string} orgId - 组织ID
   * @param {string} actorDID - 操作者DID
   * @param {string} action - 操作类型
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @param {Object} metadata - 元数据
   * @returns {Promise<void>}
   */
  async logActivity(orgId, actorDID, action, resourceType, resourceId, metadata) {
    this.db.run(
      `INSERT INTO organization_activities (id, org_id, actor_did, action, resource_type, resource_id, metadata, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), orgId, actorDID, action, resourceType, resourceId, JSON.stringify(metadata), Date.now()]
    );
  }

  /**
   * 获取组织活动日志
   * @param {string} orgId - 组织ID
   * @param {number} limit - 限制数量
   * @returns {Promise<Array>} 活动日志列表
   */
  async getOrganizationActivities(orgId, limit = 50) {
    return this.db.prepare(
      `SELECT * FROM organization_activities WHERE org_id = ? ORDER BY timestamp DESC LIMIT ?`
    ).all(orgId, limit);
  }

  /**
   * 生成邀请码
   * @returns {string} 邀请码
   */
  generateInviteCode() {
    // 生成6位大写字母和数字的邀请码
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * 根据角色获取默认权限
   * @param {string} role - 角色名称
   * @returns {Array} 权限数组
   */
  getDefaultPermissionsByRole(role) {
    const rolePermissions = {
      owner: ['*'],
      admin: [
        'org.manage', 'member.invite', 'member.remove', 'member.manage',
        'knowledge.create', 'knowledge.read', 'knowledge.write', 'knowledge.delete',
        'project.create', 'project.delete', 'role.create', 'role.assign'
      ],
      member: [
        'knowledge.create', 'knowledge.read', 'knowledge.write',
        'project.create', 'project.read', 'project.write', 'message.send'
      ],
      viewer: ['knowledge.read', 'project.read', 'message.read']
    };

    return rolePermissions[role] || rolePermissions.viewer;
  }

  /**
   * 初始化组织P2P网络
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */
  async initializeOrgP2PNetwork(orgId) {
    if (!this.p2pManager) {
      console.warn('[OrganizationManager] P2P Manager未初始化，跳过网络设置');
      return;
    }

    try {
      // 订阅组织topic
      const topic = `org_${orgId}_sync`;
      console.log('[OrganizationManager] 初始化组织P2P网络:', topic);

      // TODO: 实现P2P topic订阅和组织网络初始化
      // await this.p2pManager.subscribeToTopic(topic);
    } catch (error) {
      console.error('[OrganizationManager] P2P网络初始化失败:', error);
    }
  }

  /**
   * 连接到组织P2P网络
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */
  async connectToOrgP2PNetwork(orgId) {
    if (!this.p2pManager) {
      console.warn('[OrganizationManager] P2P Manager未初始化，跳过连接');
      return;
    }

    try {
      const topic = `org_${orgId}_sync`;
      console.log('[OrganizationManager] 连接到组织P2P网络:', topic);

      // TODO: 实现P2P网络连接
      // await this.p2pManager.subscribeToTopic(topic);
    } catch (error) {
      console.error('[OrganizationManager] 连接P2P网络失败:', error);
    }
  }

  /**
   * 同步组织数据
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */
  async syncOrganizationData(orgId) {
    console.log('[OrganizationManager] 同步组织数据:', orgId);

    try {
      // TODO: 实现组织数据同步逻辑
      // 1. 获取组织元数据
      // 2. 同步成员列表
      // 3. 同步知识库
      // 4. 同步项目
    } catch (error) {
      console.error('[OrganizationManager] 数据同步失败:', error);
    }
  }

  /**
   * 离开组织
   * @param {string} orgId - 组织ID
   * @param {string} userDID - 用户DID
   * @returns {Promise<void>}
   */
  async leaveOrganization(orgId, userDID) {
    // 检查是否是owner
    const member = this.db.prepare(
      `SELECT role FROM organization_members WHERE org_id = ? AND member_did = ?`
    ).get(orgId, userDID);

    if (member && member.role === 'owner') {
      throw new Error('组织所有者不能离开组织，请先转让所有权或删除组织');
    }

    // 更新状态为removed
    this.db.run(
      `UPDATE organization_members SET status = 'removed' WHERE org_id = ? AND member_did = ?`,
      [orgId, userDID]
    );

    // 记录活动日志
    await this.logActivity(orgId, userDID, 'leave_organization', 'member', userDID, {});

    console.log('[OrganizationManager] ✓ 成功离开组织:', orgId);
  }

  /**
   * 删除组织（仅owner可操作）
   * @param {string} orgId - 组织ID
   * @param {string} userDID - 用户DID
   * @returns {Promise<void>}
   */
  async deleteOrganization(orgId, userDID) {
    // 检查权限
    const canDelete = await this.checkPermission(orgId, userDID, 'org.delete');

    if (!canDelete) {
      throw new Error('只有组织所有者可以删除组织');
    }

    // 软删除：将所有成员状态设为removed
    this.db.run(
      `UPDATE organization_members SET status = 'removed' WHERE org_id = ?`,
      [orgId]
    );

    // 记录活动日志
    await this.logActivity(orgId, userDID, 'delete_organization', 'organization', orgId, {});

    console.log('[OrganizationManager] ✓ 组织已删除:', orgId);
  }
}

module.exports = OrganizationManager;
