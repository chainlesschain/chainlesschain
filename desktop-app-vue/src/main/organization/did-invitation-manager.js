/**
 * DID邀请管理器
 *
 * 功能：
 * - 通过DID直接发送邀请
 * - DID邀请验证和接受流程
 * - 跨组织DID邀请
 * - 邀请历史和状态追踪
 * - 去中心化邀请机制（无需中心服务器）
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * 邀请状态枚举
 */
const InvitationStatus = {
  PENDING: 'pending',       // 待处理
  ACCEPTED: 'accepted',     // 已接受
  REJECTED: 'rejected',     // 已拒绝
  EXPIRED: 'expired',       // 已过期
  CANCELLED: 'cancelled'    // 已取消
};

/**
 * 邀请类型枚举
 */
const InvitationType = {
  DIRECT_DID: 'direct_did',     // 直接DID邀请
  INVITE_CODE: 'invite_code',   // 邀请码
  LINK: 'link'                  // 邀请链接
};

/**
 * DID邀请管理器类
 */
class DIDInvitationManager {
  constructor(db, didManager, p2pManager, orgManager) {
    this.db = db;
    this.didManager = didManager;
    this.p2pManager = p2pManager;
    this.orgManager = orgManager;

    // 初始化数据库表
    this.initializeDatabase();

    // 注册P2P消息处理器
    this.registerP2PHandlers();
  }

  /**
   * 初始化数据库表
   */
  initializeDatabase() {
    // DID邀请表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS did_invitations (
        invitation_id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        inviter_did TEXT NOT NULL,
        invitee_did TEXT NOT NULL,
        invitation_type TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        message TEXT,
        metadata_json TEXT,
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        responded_at INTEGER,
        FOREIGN KEY (org_id) REFERENCES organization_info(org_id)
      )
    `);

    // 创建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_did_invitations_org ON did_invitations(org_id);
      CREATE INDEX IF NOT EXISTS idx_did_invitations_inviter ON did_invitations(inviter_did);
      CREATE INDEX IF NOT EXISTS idx_did_invitations_invitee ON did_invitations(invitee_did);
      CREATE INDEX IF NOT EXISTS idx_did_invitations_status ON did_invitations(status);
    `);

    console.log('[DIDInvitationManager] ✓ 数据库表已初始化');
  }

  /**
   * 注册P2P消息处理器
   */
  registerP2PHandlers() {
    if (!this.p2pManager) {
      console.warn('[DIDInvitationManager] P2P Manager未初始化');
      return;
    }

    // 注册DID邀请协议处理器
    this.p2pManager.node?.handle('/chainlesschain/did-invitation/1.0.0', async ({ stream, connection }) => {
      try {
        const data = [];
        for await (const chunk of stream.source) {
          data.push(chunk.subarray());
        }

        const invitationData = Buffer.concat(data);
        const invitation = JSON.parse(invitationData.toString());
        const senderPeerId = connection.remotePeer.toString();

        console.log('[DIDInvitationManager] 收到DID邀请:', invitation.invitationId);

        // 处理邀请
        await this.handleIncomingInvitation(invitation, senderPeerId);

        // 发送确认响应
        await stream.write(Buffer.from(JSON.stringify({ success: true })));
        await stream.close();
      } catch (error) {
        console.error('[DIDInvitationManager] 处理DID邀请失败:', error);
      }
    });

    console.log('[DIDInvitationManager] ✓ P2P处理器已注册');
  }

  /**
   * 创建DID邀请
   * @param {Object} params - 邀请参数
   * @param {string} params.orgId - 组织ID
   * @param {string} params.inviteeDID - 被邀请人DID
   * @param {string} params.role - 角色（默认member）
   * @param {string} params.message - 邀请消息
   * @param {number} params.expiresIn - 过期时间（毫秒，默认7天）
   * @param {Object} params.metadata - 额外元数据
   * @returns {Promise<Object>} 邀请信息
   */
  async createDIDInvitation(params) {
    const {
      orgId,
      inviteeDID,
      role = 'member',
      message = '',
      expiresIn = 7 * 24 * 60 * 60 * 1000, // 7天
      metadata = {}
    } = params;

    console.log(`[DIDInvitationManager] 创建DID邀请: ${inviteeDID}`);

    try {
      // 1. 验证权限
      const currentDID = await this.didManager.getCurrentDID();
      const hasPermission = await this.orgManager.checkPermission(orgId, currentDID, 'member.invite');
      if (!hasPermission) {
        throw new Error('没有邀请成员的权限');
      }

      // 2. 检查是否已经是成员
      const isMember = await this.orgManager.isMember(orgId, inviteeDID);
      if (isMember) {
        throw new Error('该用户已经是组织成员');
      }

      // 3. 检查是否已有待处理的邀请
      const existingInvitation = this.db.prepare(`
        SELECT * FROM did_invitations
        WHERE org_id = ? AND invitee_did = ? AND status = 'pending'
      `).get(orgId, inviteeDID);

      if (existingInvitation) {
        throw new Error('该用户已有待处理的邀请');
      }

      // 4. 创建邀请记录
      const invitationId = `inv_${uuidv4().replace(/-/g, '')}`;
      const now = Date.now();
      const expiresAt = expiresIn ? now + expiresIn : null;

      const invitation = {
        invitationId,
        orgId,
        inviterDID: currentDID,
        inviteeDID,
        invitationType: InvitationType.DIRECT_DID,
        role,
        message,
        metadata: JSON.stringify(metadata),
        status: InvitationStatus.PENDING,
        createdAt: now,
        expiresAt
      };

      this.db.run(`
        INSERT INTO did_invitations
        (invitation_id, org_id, inviter_did, invitee_did, invitation_type, role, message, metadata_json, status, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        invitation.invitationId,
        invitation.orgId,
        invitation.inviterDID,
        invitation.inviteeDID,
        invitation.invitationType,
        invitation.role,
        invitation.message,
        invitation.metadata,
        invitation.status,
        invitation.createdAt,
        invitation.expiresAt
      ]);

      // 5. 通过P2P发送邀请
      await this.sendInvitationViaPeer(invitation);

      // 6. 记录活动日志
      await this.orgManager.logActivity(
        orgId,
        currentDID,
        'send_did_invitation',
        'invitation',
        invitationId,
        { inviteeDID, role }
      );

      console.log(`[DIDInvitationManager] ✓ DID邀请已创建: ${invitationId}`);

      return invitation;
    } catch (error) {
      console.error('[DIDInvitationManager] 创建DID邀请失败:', error);
      throw error;
    }
  }

  /**
   * 通过P2P发送邀请
   * @param {Object} invitation - 邀请信息
   * @returns {Promise<void>}
   */
  async sendInvitationViaPeer(invitation) {
    if (!this.p2pManager) {
      throw new Error('P2P Manager未初始化');
    }

    try {
      // 获取组织信息
      const org = await this.orgManager.getOrganization(invitation.orgId);
      if (!org) {
        throw new Error('组织不存在');
      }

      // 获取邀请人信息
      const inviterIdentity = await this.didManager.getDefaultIdentity();

      // 构建邀请消息
      const invitationMessage = {
        ...invitation,
        orgName: org.name,
        orgDescription: org.description,
        orgAvatar: org.avatar,
        inviterName: inviterIdentity?.displayName || 'Unknown',
        inviterAvatar: inviterIdentity?.avatar || ''
      };

      // 发送加密消息
      await this.p2pManager.sendEncryptedMessage(
        invitation.inviteeDID,
        JSON.stringify(invitationMessage),
        null,
        { autoQueue: true }
      );

      console.log(`[DIDInvitationManager] ✓ 邀请已通过P2P发送`);
    } catch (error) {
      console.error('[DIDInvitationManager] 发送邀请失败:', error);
      // 不抛出错误，邀请已保存到数据库
      // 用户可以稍后重试发送
    }
  }

  /**
   * 处理收到的邀请
   * @param {Object} invitation - 邀请信息
   * @param {string} senderPeerId - 发送者PeerId
   * @returns {Promise<void>}
   */
  async handleIncomingInvitation(invitation, senderPeerId) {
    console.log(`[DIDInvitationManager] 处理收到的邀请: ${invitation.invitationId}`);

    try {
      // 1. 验证邀请
      const currentDID = await this.didManager.getCurrentDID();
      if (invitation.inviteeDID !== currentDID) {
        console.warn('[DIDInvitationManager] 邀请不是发给当前用户的');
        return;
      }

      // 2. 检查是否已存在
      const existing = this.db.prepare(`
        SELECT * FROM did_invitations WHERE invitation_id = ?
      `).get(invitation.invitationId);

      if (existing) {
        console.log('[DIDInvitationManager] 邀请已存在，跳过');
        return;
      }

      // 3. 保存邀请到本地数据库
      this.db.run(`
        INSERT INTO did_invitations
        (invitation_id, org_id, inviter_did, invitee_did, invitation_type, role, message, metadata_json, status, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        invitation.invitationId,
        invitation.orgId,
        invitation.inviterDID,
        invitation.inviteeDID,
        invitation.invitationType,
        invitation.role,
        invitation.message || '',
        invitation.metadata || '{}',
        InvitationStatus.PENDING,
        invitation.createdAt,
        invitation.expiresAt
      ]);

      console.log(`[DIDInvitationManager] ✓ 邀请已保存到本地`);

      // 4. 触发通知（可以通过IPC通知前端）
      // TODO: 实现通知机制
    } catch (error) {
      console.error('[DIDInvitationManager] 处理邀请失败:', error);
    }
  }

  /**
   * 接受邀请
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<Object>} 加入的组织信息
   */
  async acceptInvitation(invitationId) {
    console.log(`[DIDInvitationManager] 接受邀请: ${invitationId}`);

    try {
      // 1. 获取邀请信息
      const invitation = this.db.prepare(`
        SELECT * FROM did_invitations WHERE invitation_id = ?
      `).get(invitationId);

      if (!invitation) {
        throw new Error('邀请不存在');
      }

      // 2. 验证邀请状态
      if (invitation.status !== InvitationStatus.PENDING) {
        throw new Error(`邀请状态无效: ${invitation.status}`);
      }

      // 3. 检查是否过期
      if (invitation.expires_at && invitation.expires_at < Date.now()) {
        // 更新状态为已过期
        this.db.run(`
          UPDATE did_invitations
          SET status = ?, responded_at = ?
          WHERE invitation_id = ?
        `, [InvitationStatus.EXPIRED, Date.now(), invitationId]);

        throw new Error('邀请已过期');
      }

      // 4. 验证当前用户
      const currentDID = await this.didManager.getCurrentDID();
      if (invitation.invitee_did !== currentDID) {
        throw new Error('邀请不是发给当前用户的');
      }

      // 5. 加入组织
      const currentIdentity = await this.didManager.getDefaultIdentity();
      await this.orgManager.addMember(invitation.org_id, {
        memberDID: currentDID,
        displayName: currentIdentity?.displayName || 'Unknown',
        avatar: currentIdentity?.avatar || '',
        role: invitation.role,
        invitedBy: invitation.inviter_did
      });

      // 6. 更新邀请状态
      this.db.run(`
        UPDATE did_invitations
        SET status = ?, responded_at = ?
        WHERE invitation_id = ?
      `, [InvitationStatus.ACCEPTED, Date.now(), invitationId]);

      // 7. 通知邀请人
      await this.notifyInviter(invitation, InvitationStatus.ACCEPTED);

      // 8. 连接到组织P2P网络
      await this.orgManager.connectToOrgP2PNetwork(invitation.org_id);

      // 9. 记录活动日志
      await this.orgManager.logActivity(
        invitation.org_id,
        currentDID,
        'accept_did_invitation',
        'invitation',
        invitationId,
        { inviterDID: invitation.inviter_did }
      );

      console.log(`[DIDInvitationManager] ✓ 邀请已接受`);

      // 10. 获取组织信息
      const org = await this.orgManager.getOrganization(invitation.org_id);

      return org;
    } catch (error) {
      console.error('[DIDInvitationManager] 接受邀请失败:', error);
      throw error;
    }
  }

  /**
   * 拒绝邀请
   * @param {string} invitationId - 邀请ID
   * @param {string} reason - 拒绝原因
   * @returns {Promise<void>}
   */
  async rejectInvitation(invitationId, reason = '') {
    console.log(`[DIDInvitationManager] 拒绝邀请: ${invitationId}`);

    try {
      // 1. 获取邀请信息
      const invitation = this.db.prepare(`
        SELECT * FROM did_invitations WHERE invitation_id = ?
      `).get(invitationId);

      if (!invitation) {
        throw new Error('邀请不存在');
      }

      // 2. 验证邀请状态
      if (invitation.status !== InvitationStatus.PENDING) {
        throw new Error(`邀请状态无效: ${invitation.status}`);
      }

      // 3. 验证当前用户
      const currentDID = await this.didManager.getCurrentDID();
      if (invitation.invitee_did !== currentDID) {
        throw new Error('邀请不是发给当前用户的');
      }

      // 4. 更新邀请状态
      this.db.run(`
        UPDATE did_invitations
        SET status = ?, responded_at = ?, metadata_json = json_set(metadata_json, '$.rejectReason', ?)
        WHERE invitation_id = ?
      `, [InvitationStatus.REJECTED, Date.now(), reason, invitationId]);

      // 5. 通知邀请人
      await this.notifyInviter(invitation, InvitationStatus.REJECTED, reason);

      console.log(`[DIDInvitationManager] ✓ 邀请已拒绝`);
    } catch (error) {
      console.error('[DIDInvitationManager] 拒绝邀请失败:', error);
      throw error;
    }
  }

  /**
   * 取消邀请
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<void>}
   */
  async cancelInvitation(invitationId) {
    console.log(`[DIDInvitationManager] 取消邀请: ${invitationId}`);

    try {
      // 1. 获取邀请信息
      const invitation = this.db.prepare(`
        SELECT * FROM did_invitations WHERE invitation_id = ?
      `).get(invitationId);

      if (!invitation) {
        throw new Error('邀请不存在');
      }

      // 2. 验证邀请状态
      if (invitation.status !== InvitationStatus.PENDING) {
        throw new Error(`邀请状态无效: ${invitation.status}`);
      }

      // 3. 验证权限（只有邀请人可以取消）
      const currentDID = await this.didManager.getCurrentDID();
      if (invitation.inviter_did !== currentDID) {
        throw new Error('只有邀请人可以取消邀请');
      }

      // 4. 更新邀请状态
      this.db.run(`
        UPDATE did_invitations
        SET status = ?, responded_at = ?
        WHERE invitation_id = ?
      `, [InvitationStatus.CANCELLED, Date.now(), invitationId]);

      // 5. 通知被邀请人
      await this.notifyInvitee(invitation, InvitationStatus.CANCELLED);

      console.log(`[DIDInvitationManager] ✓ 邀请已取消`);
    } catch (error) {
      console.error('[DIDInvitationManager] 取消邀请失败:', error);
      throw error;
    }
  }

  /**
   * 通知邀请人
   * @param {Object} invitation - 邀请信息
   * @param {string} status - 新状态
   * @param {string} reason - 原因（可选）
   * @returns {Promise<void>}
   */
  async notifyInviter(invitation, status, reason = '') {
    if (!this.p2pManager) {
      return;
    }

    try {
      const currentIdentity = await this.didManager.getDefaultIdentity();

      const notification = {
        type: 'invitation_response',
        invitationId: invitation.invitation_id,
        orgId: invitation.org_id,
        status,
        reason,
        responderDID: invitation.invitee_did,
        responderName: currentIdentity?.displayName || 'Unknown',
        timestamp: Date.now()
      };

      await this.p2pManager.sendEncryptedMessage(
        invitation.inviter_did,
        JSON.stringify(notification),
        null,
        { autoQueue: true }
      );

      console.log(`[DIDInvitationManager] ✓ 已通知邀请人`);
    } catch (error) {
      console.error('[DIDInvitationManager] 通知邀请人失败:', error);
    }
  }

  /**
   * 通知被邀请人
   * @param {Object} invitation - 邀请信息
   * @param {string} status - 新状态
   * @returns {Promise<void>}
   */
  async notifyInvitee(invitation, status) {
    if (!this.p2pManager) {
      return;
    }

    try {
      const notification = {
        type: 'invitation_cancelled',
        invitationId: invitation.invitation_id,
        orgId: invitation.org_id,
        status,
        timestamp: Date.now()
      };

      await this.p2pManager.sendEncryptedMessage(
        invitation.invitee_did,
        JSON.stringify(notification),
        null,
        { autoQueue: true }
      );

      console.log(`[DIDInvitationManager] ✓ 已通知被邀请人`);
    } catch (error) {
      console.error('[DIDInvitationManager] 通知被邀请人失败:', error);
    }
  }

  /**
   * 获取收到的邀请列表
   * @param {string} status - 状态过滤（可选）
   * @returns {Array<Object>} 邀请列表
   */
  getReceivedInvitations(status = null) {
    try {
      const currentDID = this.didManager.getCurrentDID();
      if (!currentDID) {
        return [];
      }

      let query = `
        SELECT i.*, o.name as org_name, o.description as org_description, o.avatar as org_avatar
        FROM did_invitations i
        LEFT JOIN organization_info o ON i.org_id = o.org_id
        WHERE i.invitee_did = ?
      `;

      const params = [currentDID];

      if (status) {
        query += ` AND i.status = ?`;
        params.push(status);
      }

      query += ` ORDER BY i.created_at DESC`;

      const invitations = this.db.prepare(query).all(...params);

      return invitations.map(inv => ({
        ...inv,
        metadata: inv.metadata_json ? JSON.parse(inv.metadata_json) : {}
      }));
    } catch (error) {
      console.error('[DIDInvitationManager] 获取收到的邀请失败:', error);
      return [];
    }
  }

  /**
   * 获取发送的邀请列表
   * @param {string} orgId - 组织ID（可选）
   * @param {string} status - 状态过滤（可选）
   * @returns {Array<Object>} 邀请列表
   */
  getSentInvitations(orgId = null, status = null) {
    try {
      const currentDID = this.didManager.getCurrentDID();
      if (!currentDID) {
        return [];
      }

      let query = `
        SELECT * FROM did_invitations
        WHERE inviter_did = ?
      `;

      const params = [currentDID];

      if (orgId) {
        query += ` AND org_id = ?`;
        params.push(orgId);
      }

      if (status) {
        query += ` AND status = ?`;
        params.push(status);
      }

      query += ` ORDER BY created_at DESC`;

      const invitations = this.db.prepare(query).all(...params);

      return invitations.map(inv => ({
        ...inv,
        metadata: inv.metadata_json ? JSON.parse(inv.metadata_json) : {}
      }));
    } catch (error) {
      console.error('[DIDInvitationManager] 获取发送的邀请失败:', error);
      return [];
    }
  }

  /**
   * 获取邀请详情
   * @param {string} invitationId - 邀请ID
   * @returns {Object|null} 邀请详情
   */
  getInvitation(invitationId) {
    try {
      const invitation = this.db.prepare(`
        SELECT i.*, o.name as org_name, o.description as org_description, o.avatar as org_avatar
        FROM did_invitations i
        LEFT JOIN organization_info o ON i.org_id = o.org_id
        WHERE i.invitation_id = ?
      `).get(invitationId);

      if (!invitation) {
        return null;
      }

      return {
        ...invitation,
        metadata: invitation.metadata_json ? JSON.parse(invitation.metadata_json) : {}
      };
    } catch (error) {
      console.error('[DIDInvitationManager] 获取邀请详情失败:', error);
      return null;
    }
  }

  /**
   * 清理过期邀请
   * @returns {number} 清理的邀请数量
   */
  cleanupExpiredInvitations() {
    try {
      const now = Date.now();

      const result = this.db.run(`
        UPDATE did_invitations
        SET status = ?
        WHERE status = ? AND expires_at IS NOT NULL AND expires_at < ?
      `, [InvitationStatus.EXPIRED, InvitationStatus.PENDING, now]);

      const count = result.changes || 0;

      if (count > 0) {
        console.log(`[DIDInvitationManager] ✓ 已清理${count}个过期邀请`);
      }

      return count;
    } catch (error) {
      console.error('[DIDInvitationManager] 清理过期邀请失败:', error);
      return 0;
    }
  }

  /**
   * 获取邀请统计信息
   * @param {string} orgId - 组织ID（可选）
   * @returns {Object} 统计信息
   */
  getInvitationStats(orgId = null) {
    try {
      const currentDID = this.didManager.getCurrentDID();
      if (!currentDID) {
        return {
          sent: 0,
          received: 0,
          pending: 0,
          accepted: 0,
          rejected: 0
        };
      }

      let sentQuery = `SELECT COUNT(*) as count FROM did_invitations WHERE inviter_did = ?`;
      let receivedQuery = `SELECT COUNT(*) as count FROM did_invitations WHERE invitee_did = ?`;

      const sentParams = [currentDID];
      const receivedParams = [currentDID];

      if (orgId) {
        sentQuery += ` AND org_id = ?`;
        receivedQuery += ` AND org_id = ?`;
        sentParams.push(orgId);
        receivedParams.push(orgId);
      }

      const sent = this.db.prepare(sentQuery).get(...sentParams).count;
      const received = this.db.prepare(receivedQuery).get(...receivedParams).count;

      const pending = this.db.prepare(`
        SELECT COUNT(*) as count FROM did_invitations
        WHERE (inviter_did = ? OR invitee_did = ?) AND status = ?
        ${orgId ? 'AND org_id = ?' : ''}
      `).get(currentDID, currentDID, InvitationStatus.PENDING, ...(orgId ? [orgId] : [])).count;

      const accepted = this.db.prepare(`
        SELECT COUNT(*) as count FROM did_invitations
        WHERE (inviter_did = ? OR invitee_did = ?) AND status = ?
        ${orgId ? 'AND org_id = ?' : ''}
      `).get(currentDID, currentDID, InvitationStatus.ACCEPTED, ...(orgId ? [orgId] : [])).count;

      const rejected = this.db.prepare(`
        SELECT COUNT(*) as count FROM did_invitations
        WHERE (inviter_did = ? OR invitee_did = ?) AND status = ?
        ${orgId ? 'AND org_id = ?' : ''}
      `).get(currentDID, currentDID, InvitationStatus.REJECTED, ...(orgId ? [orgId] : [])).count;

      return {
        sent,
        received,
        pending,
        accepted,
        rejected
      };
    } catch (error) {
      console.error('[DIDInvitationManager] 获取邀请统计失败:', error);
      return {
        sent: 0,
        received: 0,
        pending: 0,
        accepted: 0,
        rejected: 0
      };
    }
  }
}

module.exports = {
  DIDInvitationManager,
  InvitationStatus,
  InvitationType
};
