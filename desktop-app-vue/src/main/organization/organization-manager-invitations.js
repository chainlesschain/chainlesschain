/**
 * OrganizationManager — invitations methods (prototype mixin).
 * Split verbatim from organization-manager.js; mixed into OrganizationManager.prototype.
 * Methods reference `this` exactly as before.
 *
 * @module organization/organization-manager-invitations
 */
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

module.exports = {
  async createInvitation(orgId, inviteData) {
    const invitationId = uuidv4();
    const inviteCode = this.generateInviteCode();

    const invitation = {
      id: invitationId,
      org_id: orgId,
      invite_code: inviteCode,
      invited_by: inviteData.invitedBy,
      role: inviteData.role || "member",
      max_uses: inviteData.maxUses || 1,
      used_count: 0,
      expire_at: inviteData.expireAt || null,
      created_at: Date.now(),
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
        invitation.created_at,
      ],
    );

    return invitation;
  },

  getInvitations(orgId) {
    try {
      // 获取邀请码邀请
      const codeInvitations = this.db
        .prepare(
          `
        SELECT * FROM organization_invitations
        WHERE org_id = ?
        ORDER BY created_at DESC
      `,
        )
        .all(orgId);

      // 获取DID邀请
      const didInvitations = this.db
        .prepare(
          `
        SELECT * FROM organization_did_invitations
        WHERE org_id = ?
        ORDER BY created_at DESC
      `,
        )
        .all(orgId);

      // 合并两种邀请，添加类型标识
      const allInvitations = [
        ...codeInvitations.map((inv) => ({
          ...inv,
          invitation_id: inv.id,
          type: "code",
          code: inv.invite_code,
          status: this.getInvitationStatus(inv),
        })),
        ...didInvitations.map((inv) => ({
          ...inv,
          invitation_id: inv.id,
          type: "did",
          code: `DID: ${this.shortenDID(inv.invited_did)}`,
          status: inv.status,
        })),
      ];

      return allInvitations;
    } catch (error) {
      logger.error("获取邀请列表失败:", error);
      return [];
    }
  },

  getInvitationStatus(invitation) {
    // 检查是否已撤销
    if (invitation.is_revoked) {
      return "revoked";
    }

    // 检查是否过期
    if (invitation.expire_at && Date.now() > invitation.expire_at) {
      return "expired";
    }

    // 检查是否用尽
    if (invitation.used_count >= invitation.max_uses) {
      return "exhausted";
    }

    // 检查是否已使用过
    if (invitation.used_count > 0) {
      return "accepted";
    }

    return "pending";
  },

  async revokeInvitation(orgId, invitationId) {
    try {
      // 先检查是否是邀请码邀请
      const codeInv = this.db
        .prepare(
          "SELECT * FROM organization_invitations WHERE id = ? AND org_id = ?",
        )
        .get(invitationId, orgId);

      if (codeInv) {
        // 标记为已撤销
        this.db
          .prepare(
            `
          UPDATE organization_invitations
          SET is_revoked = 1, updated_at = ?
          WHERE id = ?
        `,
          )
          .run(Date.now(), invitationId);

        return { success: true };
      }

      // 检查是否是DID邀请
      const didInv = this.db
        .prepare(
          "SELECT * FROM organization_did_invitations WHERE id = ? AND org_id = ?",
        )
        .get(invitationId, orgId);

      if (didInv) {
        // 更新状态为已撤销
        this.db
          .prepare(
            `
          UPDATE organization_did_invitations
          SET status = 'revoked', updated_at = ?
          WHERE id = ?
        `,
          )
          .run(Date.now(), invitationId);

        return { success: true };
      }

      return { success: false, error: "邀请不存在" };
    } catch (error) {
      logger.error("撤销邀请失败:", error);
      return { success: false, error: error.message };
    }
  },

  async deleteInvitation(orgId, invitationId) {
    try {
      // 先尝试删除邀请码邀请
      const codeResult = this.db
        .prepare(
          "DELETE FROM organization_invitations WHERE id = ? AND org_id = ?",
        )
        .run(invitationId, orgId);

      if (codeResult.changes > 0) {
        return { success: true };
      }

      // 尝试删除DID邀请
      const didResult = this.db
        .prepare(
          "DELETE FROM organization_did_invitations WHERE id = ? AND org_id = ?",
        )
        .run(invitationId, orgId);

      if (didResult.changes > 0) {
        return { success: true };
      }

      return { success: false, error: "邀请不存在" };
    } catch (error) {
      logger.error("删除邀请失败:", error);
      return { success: false, error: error.message };
    }
  },

  shortenDID(did) {
    if (!did || did.length <= 30) {
      return did;
    }
    return `${did.slice(0, 15)}...${did.slice(-10)}`;
  },

  async inviteByDID(orgId, inviteData) {
    logger.info(
      "[OrganizationManager] 通过DID邀请用户:",
      inviteData.invitedDID,
    );

    try {
      // 1. 获取组织信息
      const org = await this.getOrganization(orgId);
      if (!org) {
        throw new Error("组织不存在");
      }

      // 2. 获取当前用户DID
      const currentIdentity = await this.didManager.getCurrentIdentity();
      if (!currentIdentity) {
        throw new Error("未找到当前用户身份");
      }

      // 3. 检查权限（只有Owner和Admin可以邀请）
      const hasPermission = await this.checkPermission(
        orgId,
        currentIdentity.did,
        "member.invite",
      );
      if (!hasPermission) {
        throw new Error("没有邀请权限");
      }

      // 4. 验证被邀请人的DID格式
      if (!inviteData.invitedDID || !inviteData.invitedDID.startsWith("did:")) {
        throw new Error("无效的DID格式");
      }

      // 5. 检查用户是否已经是成员
      const existingMember = this.db
        .prepare(
          `SELECT * FROM organization_members WHERE org_id = ? AND member_did = ?`,
        )
        .get(orgId, inviteData.invitedDID);

      if (existingMember) {
        throw new Error("该用户已经是组织成员");
      }

      // 6. 检查是否已有待处理的邀请
      const existingInvitation = this.db
        .prepare(
          `SELECT * FROM organization_did_invitations
         WHERE org_id = ? AND invited_did = ? AND status = 'pending'`,
        )
        .get(orgId, inviteData.invitedDID);

      if (existingInvitation) {
        throw new Error("已有待处理的邀请");
      }

      // 7. 创建DID邀请记录
      const invitationId = uuidv4();
      const now = Date.now();
      const invitation = {
        id: invitationId,
        org_id: orgId,
        org_name: org.name,
        invited_by_did: currentIdentity.did,
        invited_by_name:
          currentIdentity.nickname || currentIdentity.displayName || "Unknown",
        invited_did: inviteData.invitedDID,
        role: inviteData.role || "member",
        status: "pending",
        message: inviteData.message || `邀请您加入组织 ${org.name}`,
        expire_at: inviteData.expireAt || null,
        created_at: now,
        updated_at: now,
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
          invitation.updated_at,
        ],
      );

      // 8. 通过P2P发送邀请通知
      if (
        this.p2pManager &&
        this.p2pManager.isInitialized &&
        this.p2pManager.isInitialized()
      ) {
        try {
          await this.p2pManager.sendMessage(inviteData.invitedDID, {
            type: "org_invitation",
            invitationId: invitation.id,
            orgId: invitation.org_id,
            orgName: invitation.org_name,
            invitedBy: invitation.invited_by_did,
            invitedByName: invitation.invited_by_name,
            role: invitation.role,
            message: invitation.message,
            expireAt: invitation.expire_at,
            createdAt: invitation.created_at,
          });
          logger.info("[OrganizationManager] P2P邀请通知已发送");
        } catch (error) {
          logger.warn(
            "[OrganizationManager] P2P邀请通知发送失败:",
            error.message,
          );
          // 不中断流程，邀请记录已创建，用户可以通过其他方式看到
        }
      } else {
        logger.warn("[OrganizationManager] P2P未初始化，无法发送邀请通知");
      }

      // 9. 记录活动日志
      await this.logActivity(
        orgId,
        currentIdentity.did,
        "invite_by_did",
        "invitation",
        invitationId,
        {
          invitedDID: inviteData.invitedDID,
          role: invitation.role,
        },
      );

      logger.info("[OrganizationManager] ✓ DID邀请创建成功:", invitationId);

      return invitation;
    } catch (error) {
      logger.error("[OrganizationManager] 创建DID邀请失败:", error);
      throw error;
    }
  },

  async acceptDIDInvitation(invitationId) {
    logger.info("[OrganizationManager] 接受DID邀请:", invitationId);

    try {
      // 1. 获取邀请信息
      const invitation = this.db
        .prepare(`SELECT * FROM organization_did_invitations WHERE id = ?`)
        .get(invitationId);

      if (!invitation) {
        throw new Error("邀请不存在");
      }

      // 2. 检查邀请状态
      if (invitation.status !== "pending") {
        throw new Error(`邀请状态为 ${invitation.status}，无法接受`);
      }

      // 3. 检查是否过期
      if (invitation.expire_at && Date.now() > invitation.expire_at) {
        // 更新状态为过期
        this.db.run(
          `UPDATE organization_did_invitations SET status = 'expired', updated_at = ? WHERE id = ?`,
          [Date.now(), invitationId],
        );
        throw new Error("邀请已过期");
      }

      // 4. 获取当前用户DID
      const currentIdentity = await this.didManager.getCurrentIdentity();
      if (!currentIdentity) {
        throw new Error("未找到当前用户身份");
      }

      // 5. 验证被邀请人
      if (currentIdentity.did !== invitation.invited_did) {
        throw new Error("邀请对象不匹配");
      }

      // 6. 检查是否已经是成员
      const existingMember = this.db
        .prepare(
          `SELECT * FROM organization_members WHERE org_id = ? AND member_did = ?`,
        )
        .get(invitation.org_id, currentIdentity.did);

      if (existingMember) {
        throw new Error("您已经是该组织的成员");
      }

      // 7. 添加为组织成员
      await this.addMember(invitation.org_id, {
        memberDID: currentIdentity.did,
        displayName:
          currentIdentity.nickname || currentIdentity.displayName || "Member",
        avatar: currentIdentity.avatar || "",
        role: invitation.role,
        permissions: JSON.stringify(
          this.getDefaultPermissionsByRole(invitation.role),
        ),
      });

      // 8. 更新邀请状态
      this.db.run(
        `UPDATE organization_did_invitations SET status = 'accepted', updated_at = ? WHERE id = ?`,
        [Date.now(), invitationId],
      );

      // 9. 连接到组织P2P网络
      if (
        this.p2pManager &&
        this.p2pManager.isInitialized &&
        this.p2pManager.isInitialized()
      ) {
        try {
          await this.connectToOrgP2PNetwork(invitation.org_id);
        } catch (error) {
          logger.warn(
            "[OrganizationManager] 连接组织P2P网络失败:",
            error.message,
          );
        }
      }

      // 10. 同步组织数据
      try {
        await this.syncOrganizationData(invitation.org_id);
      } catch (error) {
        logger.warn("[OrganizationManager] 同步组织数据失败:", error.message);
      }

      // 11. 通过P2P通知邀请人
      if (
        this.p2pManager &&
        this.p2pManager.isInitialized &&
        this.p2pManager.isInitialized()
      ) {
        try {
          await this.p2pManager.sendMessage(invitation.invited_by_did, {
            type: "org_invitation_accepted",
            invitationId: invitation.id,
            orgId: invitation.org_id,
            acceptedBy: currentIdentity.did,
            acceptedByName:
              currentIdentity.nickname ||
              currentIdentity.displayName ||
              "Unknown",
          });
        } catch (error) {
          logger.warn("[OrganizationManager] 发送接受通知失败:", error.message);
        }
      }

      // 12. 记录活动日志
      await this.logActivity(
        invitation.org_id,
        currentIdentity.did,
        "accept_invitation",
        "invitation",
        invitationId,
        {
          invitedBy: invitation.invited_by_did,
        },
      );

      // 13. 获取并返回组织信息
      const org = await this.getOrganization(invitation.org_id);

      logger.info(
        "[OrganizationManager] ✓ 成功接受邀请并加入组织:",
        invitation.org_id,
      );

      return org;
    } catch (error) {
      logger.error("[OrganizationManager] 接受DID邀请失败:", error);
      throw error;
    }
  },

  async rejectDIDInvitation(invitationId) {
    logger.info("[OrganizationManager] 拒绝DID邀请:", invitationId);

    try {
      // 1. 获取邀请信息
      const invitation = this.db
        .prepare(`SELECT * FROM organization_did_invitations WHERE id = ?`)
        .get(invitationId);

      if (!invitation) {
        throw new Error("邀请不存在");
      }

      // 2. 检查邀请状态
      if (invitation.status !== "pending") {
        throw new Error(`邀请状态为 ${invitation.status}，无法拒绝`);
      }

      // 3. 获取当前用户DID
      const currentIdentity = await this.didManager.getCurrentIdentity();
      if (!currentIdentity) {
        throw new Error("未找到当前用户身份");
      }

      // 4. 验证被邀请人
      if (currentIdentity.did !== invitation.invited_did) {
        throw new Error("邀请对象不匹配");
      }

      // 5. 更新邀请状态
      this.db.run(
        `UPDATE organization_did_invitations SET status = 'rejected', updated_at = ? WHERE id = ?`,
        [Date.now(), invitationId],
      );

      // 6. 通过P2P通知邀请人
      if (
        this.p2pManager &&
        this.p2pManager.isInitialized &&
        this.p2pManager.isInitialized()
      ) {
        try {
          await this.p2pManager.sendMessage(invitation.invited_by_did, {
            type: "org_invitation_rejected",
            invitationId: invitation.id,
            orgId: invitation.org_id,
            rejectedBy: currentIdentity.did,
            rejectedByName:
              currentIdentity.nickname ||
              currentIdentity.displayName ||
              "Unknown",
          });
        } catch (error) {
          logger.warn("[OrganizationManager] 发送拒绝通知失败:", error.message);
        }
      }

      logger.info("[OrganizationManager] ✓ 成功拒绝邀请:", invitationId);

      return true;
    } catch (error) {
      logger.error("[OrganizationManager] 拒绝DID邀请失败:", error);
      throw error;
    }
  },

  async getPendingDIDInvitations() {
    try {
      const currentIdentity = await this.didManager.getCurrentIdentity();
      if (!currentIdentity) {
        return [];
      }

      const invitations = this.db
        .prepare(
          `SELECT * FROM organization_did_invitations
         WHERE invited_did = ? AND status = 'pending'
         AND (expire_at IS NULL OR expire_at > ?)
         ORDER BY created_at DESC`,
        )
        .all(currentIdentity.did, Date.now());

      return invitations || [];
    } catch (error) {
      logger.error("[OrganizationManager] 获取待处理邀请失败:", error);
      return [];
    }
  },

  async getDIDInvitationHistory(options = {}) {
    try {
      const currentIdentity = await this.didManager.getCurrentIdentity();
      if (!currentIdentity) {
        return { accepted: [], rejected: [], expired: [] };
      }

      const did = currentIdentity.did;
      const now = Date.now();
      const limit = options.limit || 50;

      const accepted = this.db
        .prepare(
          `SELECT * FROM organization_did_invitations
           WHERE invited_did = ? AND status = 'accepted'
           ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(did, limit);

      const rejected = this.db
        .prepare(
          `SELECT * FROM organization_did_invitations
           WHERE invited_did = ? AND status = 'rejected'
           ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(did, limit);

      const expired = this.db
        .prepare(
          `SELECT * FROM organization_did_invitations
           WHERE invited_did = ? AND status = 'pending'
           AND expire_at IS NOT NULL AND expire_at <= ?
           ORDER BY expire_at DESC LIMIT ?`,
        )
        .all(did, now, limit);

      return {
        accepted: accepted || [],
        rejected: rejected || [],
        expired: expired || [],
      };
    } catch (error) {
      logger.error("[OrganizationManager] 获取邀请历史失败:", error);
      return { accepted: [], rejected: [], expired: [] };
    }
  },

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
      logger.error("[OrganizationManager] 获取DID邀请列表失败:", error);
      return [];
    }
  },

  generateInviteCode() {
    // 生成6位大写字母和数字的邀请码
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  },
};
