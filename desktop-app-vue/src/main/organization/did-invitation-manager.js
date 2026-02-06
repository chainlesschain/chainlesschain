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

const { logger, createLogger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const QRCode = require('qrcode');

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

    // 邀请链接表（用于可分享的邀请链接）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invitation_links (
        link_id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        inviter_did TEXT NOT NULL,
        invitation_token TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'member',
        message TEXT,
        max_uses INTEGER DEFAULT 1,
        used_count INTEGER DEFAULT 0,
        metadata_json TEXT,
        status TEXT DEFAULT 'active',
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        last_used_at INTEGER,
        FOREIGN KEY (org_id) REFERENCES organization_info(org_id)
      )
    `);

    // 邀请链接使用记录表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invitation_link_usage (
        id TEXT PRIMARY KEY,
        link_id TEXT NOT NULL,
        user_did TEXT NOT NULL,
        used_at INTEGER NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        FOREIGN KEY (link_id) REFERENCES invitation_links(link_id)
      )
    `);

    // 创建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_did_invitations_org ON did_invitations(org_id);
      CREATE INDEX IF NOT EXISTS idx_did_invitations_inviter ON did_invitations(inviter_did);
      CREATE INDEX IF NOT EXISTS idx_did_invitations_invitee ON did_invitations(invitee_did);
      CREATE INDEX IF NOT EXISTS idx_did_invitations_status ON did_invitations(status);
      CREATE INDEX IF NOT EXISTS idx_invitation_links_org ON invitation_links(org_id);
      CREATE INDEX IF NOT EXISTS idx_invitation_links_token ON invitation_links(invitation_token);
      CREATE INDEX IF NOT EXISTS idx_invitation_links_status ON invitation_links(status);
      CREATE INDEX IF NOT EXISTS idx_invitation_link_usage_link ON invitation_link_usage(link_id);
      CREATE INDEX IF NOT EXISTS idx_invitation_link_usage_user ON invitation_link_usage(user_did);
    `);

    logger.info('[DIDInvitationManager] ✓ 数据库表已初始化');
  }

  /**
   * 注册P2P消息处理器
   */
  registerP2PHandlers() {
    if (!this.p2pManager) {
      logger.warn('[DIDInvitationManager] P2P Manager未初始化');
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

        logger.info('[DIDInvitationManager] 收到DID邀请:', invitation.invitationId);

        // 处理邀请
        await this.handleIncomingInvitation(invitation, senderPeerId);

        // 发送确认响应
        await stream.write(Buffer.from(JSON.stringify({ success: true })));
        await stream.close();
      } catch (error) {
        logger.error('[DIDInvitationManager] 处理DID邀请失败:', error);
      }
    });

    logger.info('[DIDInvitationManager] ✓ P2P处理器已注册');
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

    logger.info(`[DIDInvitationManager] 创建DID邀请: ${inviteeDID}`);

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

      logger.info(`[DIDInvitationManager] ✓ DID邀请已创建: ${invitationId}`);

      return invitation;
    } catch (error) {
      logger.error('[DIDInvitationManager] 创建DID邀请失败:', error);
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

      logger.info(`[DIDInvitationManager] ✓ 邀请已通过P2P发送`);
    } catch (error) {
      logger.error('[DIDInvitationManager] 发送邀请失败:', error);
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
    logger.info(`[DIDInvitationManager] 处理收到的邀请: ${invitation.invitationId}`);

    try {
      // 1. 验证邀请
      const currentDID = await this.didManager.getCurrentDID();
      if (invitation.inviteeDID !== currentDID) {
        logger.warn('[DIDInvitationManager] 邀请不是发给当前用户的');
        return;
      }

      // 2. 检查是否已存在
      const existing = this.db.prepare(`
        SELECT * FROM did_invitations WHERE invitation_id = ?
      `).get(invitation.invitationId);

      if (existing) {
        logger.info('[DIDInvitationManager] 邀请已存在，跳过');
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

      logger.info(`[DIDInvitationManager] ✓ 邀请已保存到本地`);

      // 4. 触发通知
      // 获取组织信息用于通知
      let orgName = '未知组织';
      try {
        const org = this.orgManager?.getOrganization?.(invitation.orgId);
        orgName = org?.name || invitation.orgId;
      } catch (e) {
        // 忽略
      }

      // 获取邀请者信息
      let inviterName = invitation.inviterDID;
      try {
        const inviter = this.didManager?.getIdentityByDID?.(invitation.inviterDID);
        inviterName = inviter?.nickname || inviter?.name || invitation.inviterDID.slice(-8);
      } catch (e) {
        // 忽略
      }

      // 创建通知记录
      const notificationId = uuidv4();
      const now = Date.now();

      try {
        this.db.prepare(`
          INSERT INTO notifications (id, type, recipient_did, title, content, metadata, read, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          notificationId,
          'invitation',
          invitation.inviteeDID,
          `${inviterName} 邀请你加入组织`,
          `你收到了加入「${orgName}」的邀请，角色: ${invitation.role}`,
          JSON.stringify({
            invitationId: invitation.invitationId,
            orgId: invitation.orgId,
            inviterDID: invitation.inviterDID,
            role: invitation.role,
            expiresAt: invitation.expiresAt,
          }),
          0, // unread
          now
        );
      } catch (e) {
        logger.warn('[DIDInvitationManager] 保存通知失败:', e.message);
      }

      // 通过 IPC 通知前端
      const { BrowserWindow } = require('electron');
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('invitation:received', {
          notificationId,
          invitationId: invitation.invitationId,
          orgId: invitation.orgId,
          orgName,
          inviterDID: invitation.inviterDID,
          inviterName,
          role: invitation.role,
          message: invitation.message,
          expiresAt: invitation.expiresAt,
          receivedAt: now,
        });
        logger.info('[DIDInvitationManager] ✓ 已通知前端');
      }

      // 触发事件
      if (typeof this.emit === 'function') {
        this.emit('invitation:received', {
          invitationId: invitation.invitationId,
          orgId: invitation.orgId,
          inviterDID: invitation.inviterDID,
        });
      }
    } catch (error) {
      logger.error('[DIDInvitationManager] 处理邀请失败:', error);
    }
  }

  /**
   * 接受邀请
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<Object>} 加入的组织信息
   */
  async acceptInvitation(invitationId) {
    logger.info(`[DIDInvitationManager] 接受邀请: ${invitationId}`);

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

      logger.info(`[DIDInvitationManager] ✓ 邀请已接受`);

      // 10. 获取组织信息
      const org = await this.orgManager.getOrganization(invitation.org_id);

      return org;
    } catch (error) {
      logger.error('[DIDInvitationManager] 接受邀请失败:', error);
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
    logger.info(`[DIDInvitationManager] 拒绝邀请: ${invitationId}`);

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

      logger.info(`[DIDInvitationManager] ✓ 邀请已拒绝`);
    } catch (error) {
      logger.error('[DIDInvitationManager] 拒绝邀请失败:', error);
      throw error;
    }
  }

  /**
   * 取消邀请
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<void>}
   */
  async cancelInvitation(invitationId) {
    logger.info(`[DIDInvitationManager] 取消邀请: ${invitationId}`);

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

      logger.info(`[DIDInvitationManager] ✓ 邀请已取消`);
    } catch (error) {
      logger.error('[DIDInvitationManager] 取消邀请失败:', error);
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

      logger.info(`[DIDInvitationManager] ✓ 已通知邀请人`);
    } catch (error) {
      logger.error('[DIDInvitationManager] 通知邀请人失败:', error);
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

      logger.info(`[DIDInvitationManager] ✓ 已通知被邀请人`);
    } catch (error) {
      logger.error('[DIDInvitationManager] 通知被邀请人失败:', error);
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
      logger.error('[DIDInvitationManager] 获取收到的邀请失败:', error);
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
      logger.error('[DIDInvitationManager] 获取发送的邀请失败:', error);
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
      logger.error('[DIDInvitationManager] 获取邀请详情失败:', error);
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
        logger.info(`[DIDInvitationManager] ✓ 已清理${count}个过期邀请`);
      }

      return count;
    } catch (error) {
      logger.error('[DIDInvitationManager] 清理过期邀请失败:', error);
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
      logger.error('[DIDInvitationManager] 获取邀请统计失败:', error);
      return {
        sent: 0,
        received: 0,
        pending: 0,
        accepted: 0,
        rejected: 0
      };
    }
  }

  // ============================================================
  // 邀请链接功能 (Invitation Link Features)
  // ============================================================

  /**
   * 生成安全的邀请令牌
   * @returns {string} 邀请令牌
   */
  generateInvitationToken() {
    // 生成32字节随机令牌，转为base64url格式
    const token = crypto.randomBytes(32).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    return token;
  }

  /**
   * 创建邀请链接
   * @param {Object} params - 邀请链接参数
   * @param {string} params.orgId - 组织ID
   * @param {string} params.role - 角色（默认member）
   * @param {string} params.message - 邀请消息
   * @param {number} params.maxUses - 最大使用次数（默认1，-1表示无限制）
   * @param {number} params.expiresIn - 过期时间（毫秒，默认7天）
   * @param {Object} params.metadata - 额外元数据
   * @returns {Promise<Object>} 邀请链接信息
   */
  async createInvitationLink(params) {
    const {
      orgId,
      role = 'member',
      message = '',
      maxUses = 1,
      expiresIn = 7 * 24 * 60 * 60 * 1000, // 7天
      metadata = {}
    } = params;

    logger.info(`[DIDInvitationManager] 创建邀请链接: ${orgId}`);

    try {
      // 1. 验证权限
      const currentDID = await this.didManager.getCurrentDID();
      const hasPermission = await this.orgManager.checkPermission(orgId, currentDID, 'member.invite');
      if (!hasPermission) {
        throw new Error('没有创建邀请链接的权限');
      }

      // 2. 获取组织信息
      const org = await this.orgManager.getOrganization(orgId);
      if (!org) {
        throw new Error('组织不存在');
      }

      // 3. 创建邀请链接记录
      const linkId = `link_${uuidv4().replace(/-/g, '')}`;
      const invitationToken = this.generateInvitationToken();
      const now = Date.now();
      const expiresAt = expiresIn ? now + expiresIn : null;

      const invitationLink = {
        linkId,
        orgId,
        inviterDID: currentDID,
        invitationToken,
        role,
        message,
        maxUses: maxUses === -1 ? 999999 : maxUses, // -1表示无限制
        usedCount: 0,
        metadata: JSON.stringify(metadata),
        status: 'active',
        createdAt: now,
        expiresAt,
        lastUsedAt: null
      };

      this.db.run(`
        INSERT INTO invitation_links
        (link_id, org_id, inviter_did, invitation_token, role, message, max_uses, used_count, metadata_json, status, created_at, expires_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        invitationLink.linkId,
        invitationLink.orgId,
        invitationLink.inviterDID,
        invitationLink.invitationToken,
        invitationLink.role,
        invitationLink.message,
        invitationLink.maxUses,
        invitationLink.usedCount,
        invitationLink.metadata,
        invitationLink.status,
        invitationLink.createdAt,
        invitationLink.expiresAt,
        invitationLink.lastUsedAt
      ]);

      // 4. 生成完整的邀请URL
      const invitationUrl = `chainlesschain://invite/${invitationToken}`;

      // 5. 记录活动日志
      await this.orgManager.logActivity(
        orgId,
        currentDID,
        'create_invitation_link',
        'invitation_link',
        linkId,
        { role, maxUses, expiresAt }
      );

      logger.info(`[DIDInvitationManager] ✓ 邀请链接已创建: ${linkId}`);

      return {
        ...invitationLink,
        invitationUrl,
        orgName: org.name,
        orgDescription: org.description,
        orgAvatar: org.avatar
      };
    } catch (error) {
      logger.error('[DIDInvitationManager] 创建邀请链接失败:', error);
      throw error;
    }
  }

  /**
   * 验证邀请令牌
   * @param {string} token - 邀请令牌
   * @returns {Promise<Object>} 邀请链接信息
   */
  async validateInvitationToken(token) {
    logger.info(`[DIDInvitationManager] 验证邀请令牌`);

    try {
      // 1. 查询邀请链接
      const link = this.db.prepare(`
        SELECT * FROM invitation_links WHERE invitation_token = ?
      `).get(token);

      if (!link) {
        throw new Error('邀请链接不存在');
      }

      // 2. 检查状态
      if (link.status !== 'active') {
        throw new Error(`邀请链接已${link.status === 'revoked' ? '撤销' : '失效'}`);
      }

      // 3. 检查是否过期
      if (link.expires_at && link.expires_at < Date.now()) {
        // 更新状态为已过期
        this.db.run(`
          UPDATE invitation_links SET status = 'expired' WHERE link_id = ?
        `, [link.link_id]);
        throw new Error('邀请链接已过期');
      }

      // 4. 检查使用次数
      if (link.used_count >= link.max_uses) {
        throw new Error('邀请链接使用次数已达上限');
      }

      // 5. 获取组织信息
      const org = await this.orgManager.getOrganization(link.org_id);
      if (!org) {
        throw new Error('组织不存在');
      }

      // 6. 获取邀请人信息
      const inviterIdentity = await this.didManager.getIdentityByDID(link.inviter_did);

      return {
        linkId: link.link_id,
        orgId: link.org_id,
        orgName: org.name,
        orgDescription: org.description,
        orgAvatar: org.avatar,
        inviterDID: link.inviter_did,
        inviterName: inviterIdentity?.displayName || 'Unknown',
        role: link.role,
        message: link.message,
        maxUses: link.max_uses,
        usedCount: link.used_count,
        remainingUses: link.max_uses - link.used_count,
        expiresAt: link.expires_at,
        createdAt: link.created_at,
        metadata: link.metadata_json ? JSON.parse(link.metadata_json) : {}
      };
    } catch (error) {
      logger.error('[DIDInvitationManager] 验证邀请令牌失败:', error);
      throw error;
    }
  }

  /**
   * 通过邀请链接加入组织
   * @param {string} token - 邀请令牌
   * @param {Object} options - 选项
   * @param {string} options.ipAddress - IP地址（可选）
   * @param {string} options.userAgent - User Agent（可选）
   * @returns {Promise<Object>} 加入的组织信息
   */
  async acceptInvitationLink(token, options = {}) {
    logger.info(`[DIDInvitationManager] 通过邀请链接加入组织`);

    try {
      // 1. 验证邀请令牌
      const linkInfo = await this.validateInvitationToken(token);

      // 2. 获取当前用户DID
      const currentDID = await this.didManager.getCurrentDID();
      if (!currentDID) {
        throw new Error('未找到当前用户身份');
      }

      // 3. 检查是否已经是成员
      const isMember = await this.orgManager.isMember(linkInfo.orgId, currentDID);
      if (isMember) {
        throw new Error('您已经是该组织的成员');
      }

      // 4. 检查是否已经使用过此链接
      const existingUsage = this.db.prepare(`
        SELECT * FROM invitation_link_usage
        WHERE link_id = ? AND user_did = ?
      `).get(linkInfo.linkId, currentDID);

      if (existingUsage) {
        throw new Error('您已经使用过此邀请链接');
      }

      // 5. 加入组织
      const currentIdentity = await this.didManager.getDefaultIdentity();
      await this.orgManager.addMember(linkInfo.orgId, {
        memberDID: currentDID,
        displayName: currentIdentity?.displayName || 'Unknown',
        avatar: currentIdentity?.avatar || '',
        role: linkInfo.role,
        invitedBy: linkInfo.inviterDID
      });

      // 6. 记录使用情况
      const usageId = uuidv4();
      const now = Date.now();

      this.db.run(`
        INSERT INTO invitation_link_usage
        (id, link_id, user_did, used_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        usageId,
        linkInfo.linkId,
        currentDID,
        now,
        options.ipAddress || null,
        options.userAgent || null
      ]);

      // 7. 更新链接使用次数
      this.db.run(`
        UPDATE invitation_links
        SET used_count = used_count + 1, last_used_at = ?
        WHERE link_id = ?
      `, [now, linkInfo.linkId]);

      // 8. 连接到组织P2P网络
      await this.orgManager.connectToOrgP2PNetwork(linkInfo.orgId);

      // 9. 记录活动日志
      await this.orgManager.logActivity(
        linkInfo.orgId,
        currentDID,
        'accept_invitation_link',
        'invitation_link',
        linkInfo.linkId,
        { inviterDID: linkInfo.inviterDID }
      );

      logger.info(`[DIDInvitationManager] ✓ 通过邀请链接加入组织成功`);

      // 10. 获取组织信息
      const org = await this.orgManager.getOrganization(linkInfo.orgId);

      return org;
    } catch (error) {
      logger.error('[DIDInvitationManager] 通过邀请链接加入失败:', error);
      throw error;
    }
  }

  /**
   * 获取邀请链接列表
   * @param {string} orgId - 组织ID
   * @param {Object} options - 选项
   * @param {string} options.status - 状态过滤（active/expired/revoked）
   * @returns {Array<Object>} 邀请链接列表
   */
  getInvitationLinks(orgId, options = {}) {
    try {
      let query = `
        SELECT * FROM invitation_links
        WHERE org_id = ?
      `;

      const params = [orgId];

      if (options.status) {
        query += ` AND status = ?`;
        params.push(options.status);
      }

      query += ` ORDER BY created_at DESC`;

      const links = this.db.prepare(query).all(...params);

      return links.map(link => ({
        ...link,
        metadata: link.metadata_json ? JSON.parse(link.metadata_json) : {},
        invitationUrl: `chainlesschain://invite/${link.invitation_token}`,
        remainingUses: link.max_uses - link.used_count,
        isExpired: link.expires_at && link.expires_at < Date.now(),
        isExhausted: link.used_count >= link.max_uses
      }));
    } catch (error) {
      logger.error('[DIDInvitationManager] 获取邀请链接列表失败:', error);
      return [];
    }
  }

  /**
   * 获取邀请链接详情
   * @param {string} linkId - 链接ID
   * @returns {Object|null} 邀请链接详情
   */
  getInvitationLink(linkId) {
    try {
      const link = this.db.prepare(`
        SELECT * FROM invitation_links WHERE link_id = ?
      `).get(linkId);

      if (!link) {
        return null;
      }

      // 获取使用记录
      const usageRecords = this.db.prepare(`
        SELECT * FROM invitation_link_usage
        WHERE link_id = ?
        ORDER BY used_at DESC
      `).all(linkId);

      return {
        ...link,
        metadata: link.metadata_json ? JSON.parse(link.metadata_json) : {},
        invitationUrl: `chainlesschain://invite/${link.invitation_token}`,
        remainingUses: link.max_uses - link.used_count,
        isExpired: link.expires_at && link.expires_at < Date.now(),
        isExhausted: link.used_count >= link.max_uses,
        usageRecords
      };
    } catch (error) {
      logger.error('[DIDInvitationManager] 获取邀请链接详情失败:', error);
      return null;
    }
  }

  /**
   * 撤销邀请链接
   * @param {string} linkId - 链接ID
   * @returns {Promise<void>}
   */
  async revokeInvitationLink(linkId) {
    logger.info(`[DIDInvitationManager] 撤销邀请链接: ${linkId}`);

    try {
      // 1. 获取链接信息
      const link = this.db.prepare(`
        SELECT * FROM invitation_links WHERE link_id = ?
      `).get(linkId);

      if (!link) {
        throw new Error('邀请链接不存在');
      }

      // 2. 验证权限（只有创建者或管理员可以撤销）
      const currentDID = await this.didManager.getCurrentDID();
      const isCreator = link.inviter_did === currentDID;
      const isAdmin = await this.orgManager.checkPermission(link.org_id, currentDID, 'member.manage');

      if (!isCreator && !isAdmin) {
        throw new Error('没有权限撤销此邀请链接');
      }

      // 3. 更新状态
      this.db.run(`
        UPDATE invitation_links
        SET status = 'revoked'
        WHERE link_id = ?
      `, [linkId]);

      // 4. 记录活动日志
      await this.orgManager.logActivity(
        link.org_id,
        currentDID,
        'revoke_invitation_link',
        'invitation_link',
        linkId,
        {}
      );

      logger.info(`[DIDInvitationManager] ✓ 邀请链接已撤销`);
    } catch (error) {
      logger.error('[DIDInvitationManager] 撤销邀请链接失败:', error);
      throw error;
    }
  }

  /**
   * 删除邀请链接
   * @param {string} linkId - 链接ID
   * @returns {Promise<void>}
   */
  async deleteInvitationLink(linkId) {
    logger.info(`[DIDInvitationManager] 删除邀请链接: ${linkId}`);

    try {
      // 1. 获取链接信息
      const link = this.db.prepare(`
        SELECT * FROM invitation_links WHERE link_id = ?
      `).get(linkId);

      if (!link) {
        throw new Error('邀请链接不存在');
      }

      // 2. 验证权限
      const currentDID = await this.didManager.getCurrentDID();
      const isCreator = link.inviter_did === currentDID;
      const isAdmin = await this.orgManager.checkPermission(link.org_id, currentDID, 'member.manage');

      if (!isCreator && !isAdmin) {
        throw new Error('没有权限删除此邀请链接');
      }

      // 3. 删除使用记录
      this.db.run(`
        DELETE FROM invitation_link_usage WHERE link_id = ?
      `, [linkId]);

      // 4. 删除链接
      this.db.run(`
        DELETE FROM invitation_links WHERE link_id = ?
      `, [linkId]);

      // 5. 记录活动日志
      await this.orgManager.logActivity(
        link.org_id,
        currentDID,
        'delete_invitation_link',
        'invitation_link',
        linkId,
        {}
      );

      logger.info(`[DIDInvitationManager] ✓ 邀请链接已删除`);
    } catch (error) {
      logger.error('[DIDInvitationManager] 删除邀请链接失败:', error);
      throw error;
    }
  }

  /**
   * 获取邀请链接统计信息
   * @param {string} orgId - 组织ID
   * @returns {Object} 统计信息
   */
  getInvitationLinkStats(orgId) {
    try {
      const stats = this.db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
          SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) as revoked,
          SUM(used_count) as totalUses,
          SUM(max_uses) as totalMaxUses
        FROM invitation_links
        WHERE org_id = ?
      `).get(orgId);

      return {
        total: stats.total || 0,
        active: stats.active || 0,
        expired: stats.expired || 0,
        revoked: stats.revoked || 0,
        totalUses: stats.totalUses || 0,
        totalMaxUses: stats.totalMaxUses || 0,
        utilizationRate: stats.totalMaxUses > 0
          ? ((stats.totalUses / stats.totalMaxUses) * 100).toFixed(2)
          : 0
      };
    } catch (error) {
      logger.error('[DIDInvitationManager] 获取邀请链接统计失败:', error);
      return {
        total: 0,
        active: 0,
        expired: 0,
        revoked: 0,
        totalUses: 0,
        totalMaxUses: 0,
        utilizationRate: 0
      };
    }
  }

  // ============================================================
  // QR Code Generation Features
  // ============================================================

  /**
   * 为邀请链接生成QR码
   * @param {string} linkId - 链接ID或邀请令牌
   * @param {Object} options - QR码选项
   * @param {number} options.width - 宽度（默认300）
   * @param {string} options.format - 格式（'png'|'svg'|'dataURL'，默认'dataURL'）
   * @param {string} options.errorCorrectionLevel - 纠错级别（'L'|'M'|'Q'|'H'，默认'M'）
   * @returns {Promise<string|Buffer>} QR码数据
   */
  async generateInvitationQRCode(linkId, options = {}) {
    const {
      width = 300,
      format = 'dataURL',
      errorCorrectionLevel = 'M'
    } = options;

    logger.info(`[DIDInvitationManager] 生成邀请QR码: ${linkId}`);

    try {
      // 1. 获取邀请链接信息
      let invitationUrl;

      // 检查是否是令牌（长度较长）或linkId
      if (linkId.length > 40) {
        // 这是一个令牌
        invitationUrl = `chainlesschain://invite/${linkId}`;
      } else {
        // 这是一个linkId，需要查询
        const link = this.db.prepare(`
          SELECT invitation_token FROM invitation_links WHERE link_id = ?
        `).get(linkId);

        if (!link) {
          throw new Error('邀请链接不存在');
        }

        invitationUrl = `chainlesschain://invite/${link.invitation_token}`;
      }

      // 2. 生成QR码
      const qrOptions = {
        width,
        errorCorrectionLevel,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      };

      let qrCode;
      switch (format) {
        case 'png':
          qrCode = await QRCode.toBuffer(invitationUrl, { ...qrOptions, type: 'png' });
          break;
        case 'svg':
          qrCode = await QRCode.toString(invitationUrl, { ...qrOptions, type: 'svg' });
          break;
        case 'dataURL':
        default:
          qrCode = await QRCode.toDataURL(invitationUrl, qrOptions);
          break;
      }

      logger.info(`[DIDInvitationManager] ✓ QR码已生成 (${format})`);

      return qrCode;
    } catch (error) {
      logger.error('[DIDInvitationManager] 生成QR码失败:', error);
      throw error;
    }
  }

  /**
   * 为DID邀请生成QR码
   * @param {string} invitationId - 邀请ID
   * @param {Object} options - QR码选项
   * @returns {Promise<string>} QR码数据URL
   */
  async generateDIDInvitationQRCode(invitationId, options = {}) {
    logger.info(`[DIDInvitationManager] 生成DID邀请QR码: ${invitationId}`);

    try {
      // 1. 获取邀请信息
      const invitation = this.getInvitation(invitationId);
      if (!invitation) {
        throw new Error('邀请不存在');
      }

      // 2. 构建邀请数据
      const invitationData = {
        type: 'did_invitation',
        invitationId: invitation.invitation_id,
        orgId: invitation.org_id,
        orgName: invitation.org_name,
        inviterDID: invitation.inviter_did,
        role: invitation.role,
        message: invitation.message,
        expiresAt: invitation.expires_at
      };

      // 3. 生成QR码
      const qrOptions = {
        width: options.width || 300,
        errorCorrectionLevel: options.errorCorrectionLevel || 'M',
        margin: 2
      };

      const qrCode = await QRCode.toDataURL(JSON.stringify(invitationData), qrOptions);

      logger.info(`[DIDInvitationManager] ✓ DID邀请QR码已生成`);

      return qrCode;
    } catch (error) {
      logger.error('[DIDInvitationManager] 生成DID邀请QR码失败:', error);
      throw error;
    }
  }

  /**
   * 批量生成邀请QR码
   * @param {string} orgId - 组织ID
   * @param {Object} options - 选项
   * @param {string} options.status - 状态过滤
   * @param {string} options.format - QR码格式
   * @returns {Promise<Array<Object>>} QR码列表
   */
  async generateBatchInvitationQRCodes(orgId, options = {}) {
    logger.info(`[DIDInvitationManager] 批量生成邀请QR码: ${orgId}`);

    try {
      // 1. 获取邀请链接列表
      const links = this.getInvitationLinks(orgId, { status: options.status || 'active' });

      // 2. 为每个链接生成QR码
      const qrCodes = await Promise.all(
        links.map(async (link) => {
          try {
            const qrCode = await this.generateInvitationQRCode(
              link.invitation_token,
              { format: options.format || 'dataURL' }
            );

            return {
              linkId: link.link_id,
              invitationToken: link.invitation_token,
              invitationUrl: link.invitationUrl,
              qrCode,
              orgName: link.org_name,
              role: link.role,
              expiresAt: link.expires_at,
              remainingUses: link.remainingUses
            };
          } catch (error) {
            logger.error(`[DIDInvitationManager] 生成QR码失败 (${link.link_id}):`, error);
            return null;
          }
        })
      );

      // 3. 过滤掉失败的
      const validQRCodes = qrCodes.filter(qr => qr !== null);

      logger.info(`[DIDInvitationManager] ✓ 批量生成完成: ${validQRCodes.length}/${links.length}`);

      return validQRCodes;
    } catch (error) {
      logger.error('[DIDInvitationManager] 批量生成QR码失败:', error);
      throw error;
    }
  }

  /**
   * 解析邀请QR码
   * @param {string} qrData - QR码数据
   * @returns {Promise<Object>} 解析后的邀请信息
   */
  async parseInvitationQRCode(qrData) {
    logger.info(`[DIDInvitationManager] 解析邀请QR码`);

    try {
      // 1. 尝试解析为URL
      if (qrData.startsWith('chainlesschain://invite/')) {
        const token = qrData.replace('chainlesschain://invite/', '');
        const linkInfo = await this.validateInvitationToken(token);
        return {
          type: 'invitation_link',
          ...linkInfo
        };
      }

      // 2. 尝试解析为JSON（DID邀请）
      try {
        const invitationData = JSON.parse(qrData);
        if (invitationData.type === 'did_invitation') {
          const invitation = this.getInvitation(invitationData.invitationId);
          return {
            type: 'did_invitation',
            ...invitation
          };
        }
      } catch (e) {
        // 不是JSON格式
      }

      throw new Error('无效的邀请QR码格式');
    } catch (error) {
      logger.error('[DIDInvitationManager] 解析QR码失败:', error);
      throw error;
    }
  }
}

module.exports = {
  DIDInvitationManager,
  InvitationStatus,
  InvitationType
};
