/**
 * OrganizationManager — members methods (prototype mixin).
 * Split verbatim from organization-manager.js; mixed into OrganizationManager.prototype.
 * Methods reference `this` exactly as before.
 *
 * @module organization/organization-manager-members
 */
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

module.exports = {
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
      status: "active",
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
        member.status,
      ],
    );

    return member;
  },

  async getOrganizationMembers(orgId) {
    return this.db
      .prepare(
        `SELECT * FROM organization_members WHERE org_id = ? AND status = 'active' ORDER BY joined_at ASC`,
      )
      .all(orgId);
  },

  async updateMemberRole(orgId, memberDID, newRole) {
    // 检查操作者权限
    const currentIdentity = await this.didManager.getCurrentIdentity();
    const canManage = await this.checkPermission(
      orgId,
      currentIdentity.did,
      "member.manage",
    );

    if (!canManage) {
      throw new Error("没有权限管理成员");
    }

    // 更新角色
    this.db.run(
      `UPDATE organization_members SET role = ?, permissions = ? WHERE org_id = ? AND member_did = ?`,
      [
        newRole,
        JSON.stringify(this.getDefaultPermissionsByRole(newRole)),
        orgId,
        memberDID,
      ],
    );

    // 记录活动日志
    await this.logActivity(
      orgId,
      currentIdentity.did,
      "update_member_role",
      "member",
      memberDID,
      {
        newRole: newRole,
      },
    );
  },

  async removeMember(orgId, memberDID) {
    // 检查操作者权限
    const currentIdentity = await this.didManager.getCurrentIdentity();
    const canRemove = await this.checkPermission(
      orgId,
      currentIdentity.did,
      "member.remove",
    );

    if (!canRemove) {
      throw new Error("没有权限移除成员");
    }

    // 不能移除owner
    const member = this.db
      .prepare(
        `SELECT role FROM organization_members WHERE org_id = ? AND member_did = ?`,
      )
      .get(orgId, memberDID);

    if (member && member.role === "owner") {
      throw new Error("不能移除组织所有者");
    }

    // 更新状态为removed
    this.db.run(
      `UPDATE organization_members SET status = 'removed' WHERE org_id = ? AND member_did = ?`,
      [orgId, memberDID],
    );

    // 记录活动日志
    await this.logActivity(
      orgId,
      currentIdentity.did,
      "remove_member",
      "member",
      memberDID,
      {},
    );
  },

  getOnlineMembers(orgId) {
    if (!this.orgP2PNetwork) {
      return [];
    }
    return this.orgP2PNetwork.getOnlineMembers(orgId);
  },

  getOnlineMemberCount(orgId) {
    if (!this.orgP2PNetwork) {
      return 0;
    }
    return this.orgP2PNetwork.getOnlineMemberCount(orgId);
  },

  isMemberOnline(orgId, memberDID) {
    if (!this.orgP2PNetwork) {
      return false;
    }
    return this.orgP2PNetwork.isMemberOnline(orgId, memberDID);
  },

  async isMember(orgId, userDID) {
    try {
      const member = this.db
        .prepare(
          `SELECT id FROM organization_members WHERE org_id = ? AND member_did = ? AND status = 'active'`,
        )
        .get(orgId, userDID);

      return !!member;
    } catch (error) {
      logger.error("[OrganizationManager] 检查成员失败:", error);
      return false;
    }
  },
};
