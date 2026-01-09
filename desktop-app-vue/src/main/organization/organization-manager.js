const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { OrgP2PNetwork, MessageType } = require('./org-p2p-network');

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

    // 初始化组织P2P网络管理器
    this.orgP2PNetwork = null;
    if (p2pManager && didManager) {
      this.orgP2PNetwork = new OrgP2PNetwork(p2pManager, didManager, db);
      this.setupP2PEventListeners();
    }
  }

  /**
   * 设置P2P事件监听器
   */
  setupP2PEventListeners() {
    if (!this.orgP2PNetwork) {
      return;
    }

    // 成员上线
    this.orgP2PNetwork.on('member:online', ({ orgId, memberDID, displayName }) => {
      console.log(`[OrganizationManager] 成员上线: ${displayName} (${memberDID})`);
      // 可以在这里更新UI或触发其他操作
    });

    // 成员下线
    this.orgP2PNetwork.on('member:offline', ({ orgId, memberDID }) => {
      console.log(`[OrganizationManager] 成员下线: ${memberDID}`);
    });

    // 成员发现
    this.orgP2PNetwork.on('member:discovered', ({ orgId, memberDID, displayName }) => {
      console.log(`[OrganizationManager] 发现成员: ${displayName} (${memberDID})`);
    });

    // 知识库事件
    this.orgP2PNetwork.on('knowledge:event', async ({ orgId, type, data }) => {
      console.log(`[OrganizationManager] 知识库事件: ${type}`);
      await this.handleKnowledgeEvent(orgId, type, data);
    });

    // 广播消息
    this.orgP2PNetwork.on('broadcast:received', ({ orgId, type, content, senderDID }) => {
      console.log(`[OrganizationManager] 收到广播: ${type} from ${senderDID}`);
    });
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
   * 更新组织信息
   * @param {string} orgId - 组织ID
   * @param {Object} updates - 更新的字段
   * @returns {Promise<Object>} 更新结果
   */
  async updateOrganization(orgId, updates) {
    try {
      const org = await this.getOrganization(orgId);
      if (!org) {
        return { success: false, error: '组织不存在' };
      }

      // 构建更新SQL
      const fields = [];
      const values = [];

      if (updates.name !== undefined) {
        fields.push('name = ?');
        values.push(updates.name);
      }
      if (updates.type !== undefined) {
        fields.push('type = ?');
        values.push(updates.type);
      }
      if (updates.description !== undefined) {
        fields.push('description = ?');
        values.push(updates.description);
      }
      if (updates.avatar !== undefined) {
        fields.push('avatar = ?');
        values.push(updates.avatar);
      }
      if (updates.visibility !== undefined) {
        fields.push('visibility = ?');
        values.push(updates.visibility);
      }
      if (updates.p2p_enabled !== undefined) {
        fields.push('p2p_enabled = ?');
        values.push(updates.p2p_enabled);
      }
      if (updates.sync_mode !== undefined) {
        fields.push('sync_mode = ?');
        values.push(updates.sync_mode);
      }

      if (fields.length === 0) {
        return { success: false, error: '没有需要更新的字段' };
      }

      // 添加更新时间
      fields.push('updated_at = ?');
      values.push(Date.now());

      // 添加orgId到values
      values.push(orgId);

      // 执行更新
      const sql = `UPDATE organization_info SET ${fields.join(', ')} WHERE org_id = ?`;
      this.db.prepare(sql).run(...values);

      // 记录活动
      await this.logActivity(orgId, updates.updatedBy || 'system', 'update_organization', 'organization', orgId, {
        updates: Object.keys(updates)
      });

      return { success: true };
    } catch (error) {
      console.error('更新组织失败:', error);
      return { success: false, error: error.message };
    }
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
   * 获取组织的所有邀请（包括邀请码和DID邀请）
   * @param {string} orgId - 组织ID
   * @returns {Array} 邀请列表
   */
  getInvitations(orgId) {
    try {
      // 获取邀请码邀请
      const codeInvitations = this.db.prepare(`
        SELECT * FROM organization_invitations
        WHERE org_id = ?
        ORDER BY created_at DESC
      `).all(orgId);

      // 获取DID邀请
      const didInvitations = this.db.prepare(`
        SELECT * FROM organization_did_invitations
        WHERE org_id = ?
        ORDER BY created_at DESC
      `).all(orgId);

      // 合并两种邀请，添加类型标识
      const allInvitations = [
        ...codeInvitations.map(inv => ({
          ...inv,
          invitation_id: inv.id,
          type: 'code',
          code: inv.invite_code,
          status: this.getInvitationStatus(inv)
        })),
        ...didInvitations.map(inv => ({
          ...inv,
          invitation_id: inv.id,
          type: 'did',
          code: `DID: ${this.shortenDID(inv.invited_did)}`,
          status: inv.status
        }))
      ];

      return allInvitations;
    } catch (error) {
      console.error('获取邀请列表失败:', error);
      return [];
    }
  }

  /**
   * 获取邀请状态
   * @param {Object} invitation - 邀请对象
   * @returns {string} 状态
   */
  getInvitationStatus(invitation) {
    // 检查是否已撤销
    if (invitation.is_revoked) {
      return 'revoked';
    }

    // 检查是否过期
    if (invitation.expire_at && Date.now() > invitation.expire_at) {
      return 'expired';
    }

    // 检查是否用尽
    if (invitation.used_count >= invitation.max_uses) {
      return 'exhausted';
    }

    // 检查是否已使用过
    if (invitation.used_count > 0) {
      return 'accepted';
    }

    return 'pending';
  }

  /**
   * 撤销邀请
   * @param {string} orgId - 组织ID
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<Object>} 结果
   */
  async revokeInvitation(orgId, invitationId) {
    try {
      // 先检查是否是邀请码邀请
      const codeInv = this.db.prepare(
        'SELECT * FROM organization_invitations WHERE id = ? AND org_id = ?'
      ).get(invitationId, orgId);

      if (codeInv) {
        // 标记为已撤销
        this.db.prepare(`
          UPDATE organization_invitations
          SET is_revoked = 1, updated_at = ?
          WHERE id = ?
        `).run(Date.now(), invitationId);

        return { success: true };
      }

      // 检查是否是DID邀请
      const didInv = this.db.prepare(
        'SELECT * FROM organization_did_invitations WHERE id = ? AND org_id = ?'
      ).get(invitationId, orgId);

      if (didInv) {
        // 更新状态为已撤销
        this.db.prepare(`
          UPDATE organization_did_invitations
          SET status = 'revoked', updated_at = ?
          WHERE id = ?
        `).run(Date.now(), invitationId);

        return { success: true };
      }

      return { success: false, error: '邀请不存在' };
    } catch (error) {
      console.error('撤销邀请失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 删除邀请
   * @param {string} orgId - 组织ID
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<Object>} 结果
   */
  async deleteInvitation(orgId, invitationId) {
    try {
      // 先尝试删除邀请码邀请
      const codeResult = this.db.prepare(
        'DELETE FROM organization_invitations WHERE id = ? AND org_id = ?'
      ).run(invitationId, orgId);

      if (codeResult.changes > 0) {
        return { success: true };
      }

      // 尝试删除DID邀请
      const didResult = this.db.prepare(
        'DELETE FROM organization_did_invitations WHERE id = ? AND org_id = ?'
      ).run(invitationId, orgId);

      if (didResult.changes > 0) {
        return { success: true };
      }

      return { success: false, error: '邀请不存在' };
    } catch (error) {
      console.error('删除邀请失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 缩短DID显示
   * @param {string} did - 完整DID
   * @returns {string} 缩短的DID
   */
  shortenDID(did) {
    if (!did || did.length <= 30) return did;
    return `${did.slice(0, 15)}...${did.slice(-10)}`;
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
   * 获取成员活动历史
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID
   * @param {number} limit - 限制数量
   * @returns {Array} 活动列表
   */
  getMemberActivities(orgId, memberDID, limit = 10) {
    try {
      const activities = this.db.prepare(`
        SELECT * FROM organization_activities
        WHERE org_id = ? AND user_did = ?
        ORDER BY activity_timestamp DESC
        LIMIT ?
      `).all(orgId, memberDID, limit);

      return activities;
    } catch (error) {
      console.error('获取成员活动失败:', error);
      return [];
    }
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
    if (!this.orgP2PNetwork) {
      console.warn('[OrganizationManager] OrgP2PNetwork未初始化，跳过网络设置');
      return;
    }

    try {
      console.log('[OrganizationManager] 初始化组织P2P网络:', orgId);

      // 使用新的P2P网络模块初始化
      await this.orgP2PNetwork.initialize(orgId);

      console.log('[OrganizationManager] ✓ 组织P2P网络初始化完成');
    } catch (error) {
      console.error('[OrganizationManager] P2P网络初始化失败:', error);
      // 不抛出错误，允许组织创建继续
    }
  }

  /**
   * 连接到组织P2P网络
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */
  async connectToOrgP2PNetwork(orgId) {
    if (!this.orgP2PNetwork) {
      console.warn('[OrganizationManager] OrgP2PNetwork未初始化，跳过连接');
      return;
    }

    try {
      console.log('[OrganizationManager] 连接到组织P2P网络:', orgId);

      // 初始化网络订阅
      await this.orgP2PNetwork.initialize(orgId);

      console.log('[OrganizationManager] ✓ 已连接到组织P2P网络');
    } catch (error) {
      console.error('[OrganizationManager] 连接P2P网络失败:', error);
    }
  }

  /**
   * 处理组织同步消息
   * @param {string} orgId - 组织ID
   * @param {Object} message - 消息内容
   * @returns {Promise<void>}
   */
  async handleOrgSyncMessage(orgId, message) {
    try {
      const data = JSON.parse(message.toString());
      console.log('[OrganizationManager] 收到同步消息:', data.type);

      switch (data.type) {
        case 'sync_request':
          // 收到同步请求,发送增量数据
          await this.sendIncrementalData(orgId, data.requester, data.localVersion);
          break;

        case 'sync_data':
          // 收到同步数据,应用到本地
          await this.applyIncrementalData(orgId, data);
          break;

        case 'member_joined':
          // 成员加入通知
          console.log('[OrganizationManager] 成员加入:', data.memberDID);
          break;

        case 'member_updated':
          // 成员信息更新
          await this.syncMemberUpdate(orgId, data);
          break;

        case 'knowledge_created':
        case 'knowledge_updated':
        case 'knowledge_deleted':
          // 知识库变更
          await this.syncKnowledgeChange(orgId, data);
          break;

        default:
          console.warn('[OrganizationManager] 未知的同步消息类型:', data.type);
      }
    } catch (error) {
      console.error('[OrganizationManager] 处理同步消息失败:', error);
    }
  }

  /**
   * 广播组织消息
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据
   * @returns {Promise<void>}
   */
  async broadcastOrgMessage(orgId, data) {
    if (!this.p2pManager || !this.p2pManager.node?.services?.pubsub) {
      console.warn('[OrganizationManager] P2P网络未就绪，无法广播消息');
      return;
    }

    try {
      const topic = `org_${orgId}_sync`;
      const message = Buffer.from(JSON.stringify(data));

      await this.p2pManager.node.services.pubsub.publish(topic, message);
      console.log('[OrganizationManager] ✓ 已广播消息:', data.type);
    } catch (error) {
      console.error('[OrganizationManager] 广播消息失败:', error);
    }
  }

  /**
   * 请求增量同步
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */
  async requestIncrementalSync(orgId) {
    try {
      // 获取本地最新版本号
      const localVersion = await this.getLocalVersion(orgId);

      // 广播同步请求
      await this.broadcastOrgMessage(orgId, {
        type: 'sync_request',
        orgId: orgId,
        requester: await this.didManager.getCurrentDID(),
        localVersion: localVersion,
        timestamp: Date.now()
      });

      console.log('[OrganizationManager] ✓ 已请求增量同步，本地版本:', localVersion);
    } catch (error) {
      console.error('[OrganizationManager] 请求同步失败:', error);
    }
  }

  /**
   * 获取本地数据版本号
   * @param {string} orgId - 组织ID
   * @returns {Promise<number>} 版本号
   */
  async getLocalVersion(orgId) {
    try {
      const result = this.db.prepare(
        `SELECT MAX(timestamp) as max_timestamp FROM organization_activities WHERE org_id = ?`
      ).get(orgId);

      return result?.max_timestamp || 0;
    } catch (error) {
      console.error('[OrganizationManager] 获取本地版本失败:', error);
      return 0;
    }
  }

  /**
   * 发送增量数据
   * @param {string} orgId - 组织ID
   * @param {string} targetDID - 目标用户DID
   * @param {number} sinceVersion - 起始版本号
   * @returns {Promise<void>}
   */
  async sendIncrementalData(orgId, targetDID, sinceVersion) {
    try {
      // 查询大于sinceVersion的所有变更
      const changes = this.db.prepare(
        `SELECT * FROM organization_activities
         WHERE org_id = ? AND timestamp > ?
         ORDER BY timestamp ASC
         LIMIT 100`
      ).all(orgId, sinceVersion);

      if (changes.length === 0) {
        console.log('[OrganizationManager] 没有新数据需要同步');
        return;
      }

      // 获取相关的完整数据
      const syncData = {
        type: 'sync_data',
        orgId: orgId,
        sender: await this.didManager.getCurrentDID(),
        sinceVersion: sinceVersion,
        toVersion: await this.getLocalVersion(orgId),
        changes: changes.map(change => ({
          ...change,
          metadata: JSON.parse(change.metadata || '{}')
        })),
        timestamp: Date.now()
      };

      // 直接发送给请求者
      await this.p2pManager.sendEncryptedMessage(targetDID, JSON.stringify(syncData));
      console.log('[OrganizationManager] ✓ 已发送增量数据，共', changes.length, '条变更');
    } catch (error) {
      console.error('[OrganizationManager] 发送增量数据失败:', error);
    }
  }

  /**
   * 应用增量数据
   * @param {string} orgId - 组织ID
   * @param {Object} syncData - 同步数据
   * @returns {Promise<void>}
   */
  async applyIncrementalData(orgId, syncData) {
    const { changes } = syncData;

    console.log('[OrganizationManager] 应用增量数据，共', changes.length, '条变更');

    for (const change of changes) {
      try {
        // 检查是否有冲突
        const hasConflict = await this.checkConflict(orgId, change);

        if (hasConflict) {
          await this.resolveConflict(orgId, change);
          continue;
        }

        // 应用变更
        await this.applyChange(orgId, change);
      } catch (error) {
        console.error('[OrganizationManager] 应用变更失败:', change, error);
      }
    }

    console.log('[OrganizationManager] ✓ 增量数据应用完成');
  }

  /**
   * 检查是否有冲突
   * @param {string} orgId - 组织ID
   * @param {Object} change - 变更记录
   * @returns {Promise<boolean>} 是否冲突
   */
  async checkConflict(orgId, change) {
    try {
      const { resource_type, resource_id, timestamp } = change;

      // 查询本地是否有更新的版本
      const localActivity = this.db.prepare(
        `SELECT timestamp FROM organization_activities
         WHERE org_id = ? AND resource_type = ? AND resource_id = ?
         ORDER BY timestamp DESC LIMIT 1`
      ).get(orgId, resource_type, resource_id);

      if (localActivity && localActivity.timestamp > timestamp) {
        console.warn('[OrganizationManager] 检测到冲突:', resource_type, resource_id);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[OrganizationManager] 冲突检查失败:', error);
      return false;
    }
  }

  /**
   * 解决冲突 - 使用Last-Write-Wins策略
   * @param {string} orgId - 组织ID
   * @param {Object} change - 变更记录
   * @returns {Promise<void>}
   */
  async resolveConflict(orgId, change) {
    console.log('[OrganizationManager] 解决冲突:', change.action);

    // 策略1: Last-Write-Wins (保留时间戳更新的版本)
    const localActivity = this.db.prepare(
      `SELECT timestamp FROM organization_activities
       WHERE org_id = ? AND resource_type = ? AND resource_id = ?
       ORDER BY timestamp DESC LIMIT 1`
    ).get(orgId, change.resource_type, change.resource_id);

    if (!localActivity || change.timestamp > localActivity.timestamp) {
      // 远程更新,覆盖本地
      await this.applyChange(orgId, change);
      console.log('[OrganizationManager] ✓ 冲突已解决: 应用远程版本');
    } else {
      // 本地更新,保留本地
      console.log('[OrganizationManager] ✓ 冲突已解决: 保留本地版本');
    }
  }

  /**
   * 应用变更
   * @param {string} orgId - 组织ID
   * @param {Object} change - 变更记录
   * @returns {Promise<void>}
   */
  async applyChange(orgId, change) {
    const { action, resource_type, resource_id, metadata } = change;

    console.log('[OrganizationManager] 应用变更:', action, resource_type, resource_id);

    switch (action) {
      case 'update_member_role':
        await this.db.run(
          `UPDATE organization_members SET role = ? WHERE org_id = ? AND member_did = ?`,
          [metadata.new_role, orgId, resource_id]
        );
        break;

      case 'remove_member':
        await this.db.run(
          `UPDATE organization_members SET status = 'removed' WHERE org_id = ? AND member_did = ?`,
          [orgId, resource_id]
        );
        break;

      case 'add_member':
        // 检查成员是否已存在
        const existingMember = this.db.prepare(
          `SELECT id FROM organization_members WHERE org_id = ? AND member_did = ?`
        ).get(orgId, metadata.member_did);

        if (!existingMember) {
          await this.db.run(
            `INSERT INTO organization_members (id, org_id, member_did, display_name, role, joined_at, status)
             VALUES (?, ?, ?, ?, ?, ?, 'active')`,
            [resource_id, orgId, metadata.member_did, metadata.display_name, metadata.role, metadata.joined_at]
          );
        }
        break;

      default:
        console.warn('[OrganizationManager] 未知的变更操作:', action);
    }

    // 记录到本地活动日志 (如果不存在)
    const existingActivity = this.db.prepare(
      `SELECT id FROM organization_activities WHERE id = ?`
    ).get(change.id);

    if (!existingActivity) {
      await this.db.run(
        `INSERT INTO organization_activities (id, org_id, actor_did, action, resource_type, resource_id, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          change.id,
          orgId,
          change.actor_did,
          action,
          resource_type,
          resource_id,
          JSON.stringify(metadata),
          change.timestamp
        ]
      );
    }
  }

  /**
   * 同步成员更新
   * @param {string} orgId - 组织ID
   * @param {Object} data - 成员数据
   * @returns {Promise<void>}
   */
  async syncMemberUpdate(orgId, data) {
    try {
      const { memberDID, updates } = data;

      await this.db.run(
        `UPDATE organization_members SET display_name = ?, avatar = ?
         WHERE org_id = ? AND member_did = ?`,
        [updates.display_name, updates.avatar, orgId, memberDID]
      );

      console.log('[OrganizationManager] ✓ 成员信息已同步:', memberDID);
    } catch (error) {
      console.error('[OrganizationManager] 同步成员更新失败:', error);
    }
  }

  /**
   * 同步知识库变更
   * @param {string} orgId - 组织ID
   * @param {Object} data - 知识库变更数据
   * @returns {Promise<void>}
   */
  async syncKnowledgeChange(orgId, data) {
    try {
      // 这里需要与知识库管理器集成
      // 暂时记录日志
      console.log('[OrganizationManager] 知识库变更:', data.type, data.knowledgeId);

      // TODO: 集成知识库管理器,应用知识库变更
      // await knowledgeManager.applyRemoteChange(data);
    } catch (error) {
      console.error('[OrganizationManager] 同步知识库变更失败:', error);
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
      // 1. 连接到组织P2P网络
      await this.connectToOrgP2PNetwork(orgId);

      // 2. 请求增量同步
      await this.requestIncrementalSync(orgId);

      console.log('[OrganizationManager] ✓ 组织数据同步已启动');
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

  /**
   * 获取组织所有角色
   * @param {string} orgId - 组织ID
   * @returns {Promise<Array>} 角色列表
   */
  async getRoles(orgId) {
    const roles = this.db.prepare(
      `SELECT * FROM organization_roles WHERE org_id = ? ORDER BY is_builtin DESC, created_at ASC`
    ).all(orgId);

    return roles.map(role => ({
      ...role,
      permissions: JSON.parse(role.permissions || '[]')
    }));
  }

  /**
   * 获取单个角色
   * @param {string} roleId - 角色ID
   * @returns {Promise<Object|null>} 角色信息
   */
  async getRole(roleId) {
    const role = this.db.prepare(
      `SELECT * FROM organization_roles WHERE id = ?`
    ).get(roleId);

    if (!role) {
      return null;
    }

    return {
      ...role,
      permissions: JSON.parse(role.permissions || '[]')
    };
  }

  /**
   * 创建自定义角色
   * @param {string} orgId - 组织ID
   * @param {Object} roleData - 角色数据
   * @param {string} roleData.name - 角色名称
   * @param {string} roleData.description - 角色描述
   * @param {Array<string>} roleData.permissions - 权限列表
   * @param {string} creatorDID - 创建者DID
   * @returns {Promise<Object>} 创建的角色
   */
  async createCustomRole(orgId, roleData, creatorDID) {
    console.log('[OrganizationManager] 创建自定义角色:', roleData.name);

    // 1. 检查权限
    const canCreate = await this.checkPermission(orgId, creatorDID, 'role.create');
    if (!canCreate) {
      throw new Error('没有权限创建角色');
    }

    // 2. 验证角色名称唯一性
    const existingRole = this.db.prepare(
      `SELECT id FROM organization_roles WHERE org_id = ? AND name = ?`
    ).get(orgId, roleData.name);

    if (existingRole) {
      throw new Error('角色名称已存在');
    }

    // 3. 验证权限格式
    if (!Array.isArray(roleData.permissions)) {
      throw new Error('权限必须是数组');
    }

    // 4. 创建角色
    const roleId = uuidv4();
    const now = Date.now();

    this.db.run(
      `INSERT INTO organization_roles (id, org_id, name, description, permissions, is_builtin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        roleId,
        orgId,
        roleData.name,
        roleData.description || '',
        JSON.stringify(roleData.permissions),
        0, // 非内置角色
        now
      ]
    );

    // 5. 记录活动日志
    await this.logActivity(orgId, creatorDID, 'create_role', 'role', roleId, {
      roleName: roleData.name,
      permissions: roleData.permissions
    });

    console.log('[OrganizationManager] ✓ 自定义角色创建成功:', roleId);

    return {
      id: roleId,
      org_id: orgId,
      name: roleData.name,
      description: roleData.description || '',
      permissions: roleData.permissions,
      is_builtin: 0,
      created_at: now
    };
  }

  /**
   * 更新角色（仅能更新自定义角色）
   * @param {string} roleId - 角色ID
   * @param {Object} updates - 更新数据
   * @param {string} updates.name - 角色名称
   * @param {string} updates.description - 角色描述
   * @param {Array<string>} updates.permissions - 权限列表
   * @param {string} updaterDID - 更新者DID
   * @returns {Promise<Object>} 更新后的角色
   */
  async updateRole(roleId, updates, updaterDID) {
    console.log('[OrganizationManager] 更新角色:', roleId);

    // 1. 获取角色信息
    const role = await this.getRole(roleId);
    if (!role) {
      throw new Error('角色不存在');
    }

    // 2. 检查是否是内置角色
    if (role.is_builtin) {
      throw new Error('不能修改内置角色');
    }

    // 3. 检查权限
    const canUpdate = await this.checkPermission(role.org_id, updaterDID, 'role.manage');
    if (!canUpdate) {
      throw new Error('没有权限更新角色');
    }

    // 4. 如果更改名称，检查唯一性
    if (updates.name && updates.name !== role.name) {
      const existingRole = this.db.prepare(
        `SELECT id FROM organization_roles WHERE org_id = ? AND name = ? AND id != ?`
      ).get(role.org_id, updates.name, roleId);

      if (existingRole) {
        throw new Error('角色名称已存在');
      }
    }

    // 5. 构建更新语句
    const updateFields = [];
    const updateValues = [];

    if (updates.name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(updates.name);
    }

    if (updates.description !== undefined) {
      updateFields.push('description = ?');
      updateValues.push(updates.description);
    }

    if (updates.permissions !== undefined) {
      if (!Array.isArray(updates.permissions)) {
        throw new Error('权限必须是数组');
      }
      updateFields.push('permissions = ?');
      updateValues.push(JSON.stringify(updates.permissions));
    }

    if (updateFields.length === 0) {
      return role;
    }

    updateValues.push(roleId);

    // 6. 执行更新
    this.db.run(
      `UPDATE organization_roles SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    // 7. 记录活动日志
    await this.logActivity(role.org_id, updaterDID, 'update_role', 'role', roleId, {
      roleName: updates.name || role.name,
      updates: updates
    });

    console.log('[OrganizationManager] ✓ 角色更新成功:', roleId);

    // 8. 返回更新后的角色
    return await this.getRole(roleId);
  }

  /**
   * 删除自定义角色
   * @param {string} roleId - 角色ID
   * @param {string} deleterDID - 删除者DID
   * @returns {Promise<void>}
   */
  async deleteRole(roleId, deleterDID) {
    console.log('[OrganizationManager] 删除角色:', roleId);

    // 1. 获取角色信息
    const role = await this.getRole(roleId);
    if (!role) {
      throw new Error('角色不存在');
    }

    // 2. 检查是否是内置角色
    if (role.is_builtin) {
      throw new Error('不能删除内置角色');
    }

    // 3. 检查权限
    const canDelete = await this.checkPermission(role.org_id, deleterDID, 'role.delete');
    if (!canDelete) {
      throw new Error('没有权限删除角色');
    }

    // 4. 检查是否有成员正在使用此角色
    const membersWithRole = this.db.prepare(
      `SELECT COUNT(*) as count FROM organization_members WHERE org_id = ? AND role = ? AND status = 'active'`
    ).get(role.org_id, role.name);

    if (membersWithRole && membersWithRole.count > 0) {
      throw new Error(`有 ${membersWithRole.count} 个成员正在使用此角色，请先更改这些成员的角色`);
    }

    // 5. 删除角色
    this.db.run(
      `DELETE FROM organization_roles WHERE id = ?`,
      [roleId]
    );

    // 6. 记录活动日志
    await this.logActivity(role.org_id, deleterDID, 'delete_role', 'role', roleId, {
      roleName: role.name
    });

    console.log('[OrganizationManager] ✓ 角色删除成功:', roleId);
  }

  /**
   * 获取所有可用权限列表
   * @returns {Array} 权限列表
   */
  getAllPermissions() {
    return [
      { category: '组织管理', permissions: [
        { value: 'org.manage', label: '管理组织', description: '修改组织基本信息' },
        { value: 'org.delete', label: '删除组织', description: '删除整个组织（仅所有者）' }
      ]},
      { category: '成员管理', permissions: [
        { value: 'member.invite', label: '邀请成员', description: '创建邀请链接或邀请码' },
        { value: 'member.manage', label: '管理成员', description: '更改成员角色' },
        { value: 'member.remove', label: '移除成员', description: '将成员移出组织' }
      ]},
      { category: '角色管理', permissions: [
        { value: 'role.create', label: '创建角色', description: '创建自定义角色' },
        { value: 'role.manage', label: '管理角色', description: '修改角色权限' },
        { value: 'role.assign', label: '分配角色', description: '给成员分配角色' },
        { value: 'role.delete', label: '删除角色', description: '删除自定义角色' }
      ]},
      { category: '知识库', permissions: [
        { value: 'knowledge.create', label: '创建知识', description: '创建新的知识条目' },
        { value: 'knowledge.read', label: '查看知识', description: '查看知识库内容' },
        { value: 'knowledge.write', label: '编辑知识', description: '修改知识库内容' },
        { value: 'knowledge.delete', label: '删除知识', description: '删除知识条目' }
      ]},
      { category: '项目管理', permissions: [
        { value: 'project.create', label: '创建项目', description: '创建新项目' },
        { value: 'project.read', label: '查看项目', description: '查看项目信息' },
        { value: 'project.write', label: '编辑项目', description: '修改项目信息' },
        { value: 'project.delete', label: '删除项目', description: '删除项目' }
      ]},
      { category: '消息通信', permissions: [
        { value: 'message.send', label: '发送消息', description: '在组织中发送消息' },
        { value: 'message.read', label: '阅读消息', description: '阅读组织消息' }
      ]}
    ];
  }

  /**
   * 获取组织在线成员列表
   * @param {string} orgId - 组织ID
   * @returns {Array<string>} 在线成员DID列表
   */
  getOnlineMembers(orgId) {
    if (!this.orgP2PNetwork) {
      return [];
    }
    return this.orgP2PNetwork.getOnlineMembers(orgId);
  }

  /**
   * 获取组织在线成员数量
   * @param {string} orgId - 组织ID
   * @returns {number} 在线成员数量
   */
  getOnlineMemberCount(orgId) {
    if (!this.orgP2PNetwork) {
      return 0;
    }
    return this.orgP2PNetwork.getOnlineMemberCount(orgId);
  }

  /**
   * 检查成员是否在线
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID
   * @returns {boolean} 是否在线
   */
  isMemberOnline(orgId, memberDID) {
    if (!this.orgP2PNetwork) {
      return false;
    }
    return this.orgP2PNetwork.isMemberOnline(orgId, memberDID);
  }

  /**
   * 广播消息到组织
   * @param {string} orgId - 组织ID
   * @param {Object} message - 消息内容
   * @returns {Promise<void>}
   */
  async broadcastOrgMessage(orgId, message) {
    if (!this.orgP2PNetwork) {
      throw new Error('OrgP2PNetwork未初始化');
    }
    await this.orgP2PNetwork.broadcastMessage(orgId, message);
  }

  /**
   * 获取组织P2P网络统计信息
   * @param {string} orgId - 组织ID
   * @returns {Object} 统计信息
   */
  getOrgNetworkStats(orgId) {
    if (!this.orgP2PNetwork) {
      return null;
    }
    return this.orgP2PNetwork.getNetworkStats(orgId);
  }

  /**
   * 断开组织P2P网络连接
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */
  async disconnectFromOrgP2PNetwork(orgId) {
    if (!this.orgP2PNetwork) {
      return;
    }
    await this.orgP2PNetwork.unsubscribeTopic(orgId);
  }

  /**
   * 处理知识库事件
   * @param {string} orgId - 组织ID
   * @param {string} type - 事件类型
   * @param {Object} data - 事件数据
   * @returns {Promise<void>}
   */
  async handleKnowledgeEvent(orgId, type, data) {
    // 这里可以实现知识库同步逻辑
    console.log(`[OrganizationManager] 处理知识库事件: ${type}`, data);
    // TODO: 实现知识库同步
  }
}

module.exports = OrganizationManager;
