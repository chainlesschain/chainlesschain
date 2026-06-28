const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

/** Tolerant JSON column parse — a corrupt row must not abort a list-load loop. */
function safeParse(raw, fallback) {
  if (raw == null || raw === "") {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(`[OrgManager] Bad JSON column, fallback: ${err.message}`);
    return fallback;
  }
}
const crypto = require("crypto");
const { OrgP2PNetwork, MessageType } = require("./org-p2p-network");
const { DIDInvitationManager } = require("./did-invitation-manager");
const _mixin_members = require("./organization-manager-members");
const _mixin_invitations = require("./organization-manager-invitations");
const _mixin_roles = require("./organization-manager-roles");
const _mixin_activity = require("./organization-manager-activity");
const _mixin_p2pSync = require("./organization-manager-p2pSync");
const _mixin_knowledge = require("./organization-manager-knowledge");

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

    // 初始化DID邀请管理器
    this.didInvitationManager = null;
    if (db && didManager) {
      this.didInvitationManager = new DIDInvitationManager(
        db,
        didManager,
        p2pManager,
        this,
      );
      logger.info("[OrganizationManager] ✓ DID邀请管理器已初始化");
    }

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
    this.orgP2PNetwork.on(
      "member:online",
      ({ orgId, memberDID, displayName }) => {
        logger.info(
          `[OrganizationManager] 成员上线: ${displayName} (${memberDID})`,
        );
        // 可以在这里更新UI或触发其他操作
      },
    );

    // 成员下线
    this.orgP2PNetwork.on("member:offline", ({ orgId, memberDID }) => {
      logger.info(`[OrganizationManager] 成员下线: ${memberDID}`);
    });

    // 成员发现
    this.orgP2PNetwork.on(
      "member:discovered",
      ({ orgId, memberDID, displayName }) => {
        logger.info(
          `[OrganizationManager] 发现成员: ${displayName} (${memberDID})`,
        );
      },
    );

    // 知识库事件
    this.orgP2PNetwork.on("knowledge:event", async ({ orgId, type, data }) => {
      logger.info(`[OrganizationManager] 知识库事件: ${type}`);
      await this.handleKnowledgeEvent(orgId, type, data);
    });

    // 广播消息
    this.orgP2PNetwork.on(
      "broadcast:received",
      ({ orgId, type, content, senderDID }) => {
        logger.info(
          `[OrganizationManager] 收到广播: ${type} from ${senderDID}`,
        );
      },
    );
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
    logger.info("[OrganizationManager] 创建组织:", orgData.name);

    try {
      // 1. 生成组织ID和DID
      const orgId = `org_${uuidv4().replace(/-/g, "")}`;
      const orgDID = await this.didManager.createOrganizationDID(
        orgId,
        orgData.name,
      );

      // 2. 获取当前用户DID
      const currentIdentity = await this.didManager.getCurrentIdentity();
      if (!currentIdentity) {
        throw new Error("未找到当前用户身份");
      }

      // 3. 创建组织记录
      const now = Date.now();
      const organization = {
        org_id: orgId,
        org_did: orgDID,
        name: orgData.name,
        description: orgData.description || "",
        type: orgData.type || "startup",
        avatar: orgData.avatar || "",
        owner_did: currentIdentity.did,
        settings_json: JSON.stringify({
          visibility: orgData.visibility || "private",
          maxMembers: orgData.maxMembers || 100,
          allowMemberInvite: orgData.allowMemberInvite !== false,
          defaultMemberRole: "member",
        }),
        created_at: now,
        updated_at: now,
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
          organization.updated_at,
        ],
      );

      // 4. 添加创建者为Owner
      await this.addMember(orgId, {
        memberDID: currentIdentity.did,
        displayName: currentIdentity.displayName || "Owner",
        avatar: currentIdentity.avatar || "",
        role: "owner",
        permissions: JSON.stringify(["*"]), // 所有权限
      });

      // 5. 初始化内置角色
      await this.initializeBuiltinRoles(orgId);

      // 6. 生成默认邀请码
      if (orgData.enableInviteCode !== false) {
        await this.createInvitation(orgId, {
          invitedBy: currentIdentity.did,
          role: "member",
          maxUses: 999,
          expireAt: null, // 永不过期
        });
      }

      // 7. 初始化P2P组织网络
      await this.initializeOrgP2PNetwork(orgId);

      // 8. 记录活动日志
      await this.logActivity(
        orgId,
        currentIdentity.did,
        "create_organization",
        "organization",
        orgId,
        {
          orgName: orgData.name,
        },
      );

      logger.info("[OrganizationManager] ✓ 组织创建成功:", orgId);

      return {
        ...organization,
        settings: safeParse(organization.settings_json, {}),
      };
    } catch (error) {
      logger.error("[OrganizationManager] 创建组织失败:", error);
      throw error;
    }
  }

  /**
   * 加入组织
   * @param {string} inviteCode - 邀请码
   * @returns {Promise<Object>} 加入的组织信息
   */
  async joinOrganization(inviteCode) {
    logger.info("[OrganizationManager] 通过邀请码加入组织:", inviteCode);

    try {
      // 1. 验证邀请码
      const invitation = this.db
        .prepare(
          `SELECT * FROM organization_invitations
         WHERE invite_code = ? AND (expire_at IS NULL OR expire_at > ?) AND used_count < max_uses`,
        )
        .get(inviteCode, Date.now());

      if (!invitation) {
        throw new Error("邀请码无效或已过期");
      }

      // 2. 获取组织信息
      const org = await this.getOrganization(invitation.org_id);
      if (!org) {
        throw new Error("组织不存在");
      }

      // 3. 获取当前用户DID
      const currentIdentity = await this.didManager.getCurrentIdentity();
      if (!currentIdentity) {
        throw new Error("未找到当前用户身份");
      }

      // 4. 检查是否已经是成员
      const existingMember = this.db
        .prepare(
          `SELECT * FROM organization_members WHERE org_id = ? AND member_did = ?`,
        )
        .get(invitation.org_id, currentIdentity.did);

      if (existingMember) {
        throw new Error("您已经是该组织的成员");
      }

      // 5. 添加为成员
      await this.addMember(invitation.org_id, {
        memberDID: currentIdentity.did,
        displayName: currentIdentity.displayName || "Member",
        avatar: currentIdentity.avatar || "",
        role: invitation.role,
        permissions: JSON.stringify(
          this.getDefaultPermissionsByRole(invitation.role),
        ),
      });

      // 6. 更新邀请码使用次数
      this.db.run(
        `UPDATE organization_invitations SET used_count = used_count + 1 WHERE id = ?`,
        [invitation.id],
      );

      // 7. 连接到组织P2P网络
      await this.connectToOrgP2PNetwork(invitation.org_id);

      // 8. 同步组织数据
      await this.syncOrganizationData(invitation.org_id);

      // 9. 记录活动日志
      await this.logActivity(
        invitation.org_id,
        currentIdentity.did,
        "join_organization",
        "member",
        currentIdentity.did,
        {
          inviteCode: inviteCode,
        },
      );

      logger.info("[OrganizationManager] ✓ 成功加入组织:", invitation.org_id);

      return org;
    } catch (error) {
      logger.error("[OrganizationManager] 加入组织失败:", error);
      throw error;
    }
  }

  /**
   * 获取组织信息
   * @param {string} orgId - 组织ID
   * @returns {Promise<Object|null>} 组织信息
   */
  async getOrganization(orgId) {
    const org = this.db
      .prepare(`SELECT * FROM organization_info WHERE org_id = ?`)
      .get(orgId);

    if (!org) {
      return null;
    }

    return {
      ...org,
      settings: safeParse(org.settings_json, {}),
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
        return { success: false, error: "组织不存在" };
      }

      // 构建更新SQL
      const fields = [];
      const values = [];

      if (updates.name !== undefined) {
        fields.push("name = ?");
        values.push(updates.name);
      }
      if (updates.type !== undefined) {
        fields.push("type = ?");
        values.push(updates.type);
      }
      if (updates.description !== undefined) {
        fields.push("description = ?");
        values.push(updates.description);
      }
      if (updates.avatar !== undefined) {
        fields.push("avatar = ?");
        values.push(updates.avatar);
      }
      if (updates.visibility !== undefined) {
        fields.push("visibility = ?");
        values.push(updates.visibility);
      }
      if (updates.p2p_enabled !== undefined) {
        fields.push("p2p_enabled = ?");
        values.push(updates.p2p_enabled);
      }
      if (updates.sync_mode !== undefined) {
        fields.push("sync_mode = ?");
        values.push(updates.sync_mode);
      }

      if (fields.length === 0) {
        return { success: false, error: "没有需要更新的字段" };
      }

      // 添加更新时间
      fields.push("updated_at = ?");
      values.push(Date.now());

      // 添加orgId到values
      values.push(orgId);

      // 执行更新
      const sql = `UPDATE organization_info SET ${fields.join(", ")} WHERE org_id = ?`;
      this.db.prepare(sql).run(...values);

      // 记录活动
      await this.logActivity(
        orgId,
        updates.updatedBy || "system",
        "update_organization",
        "organization",
        orgId,
        {
          updates: Object.keys(updates),
        },
      );

      return { success: true };
    } catch (error) {
      logger.error("更新组织失败:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取用户所属的所有组织
   * @param {string} userDID - 用户DID
   * @returns {Promise<Array>} 组织列表
   */
  async getUserOrganizations(userDID) {
    const memberships = this.db
      .prepare(
        `SELECT om.*, oi.name, oi.description, oi.type, oi.avatar
       FROM organization_members om
       JOIN organization_info oi ON om.org_id = oi.org_id
       WHERE om.member_did = ? AND om.status = 'active'
       ORDER BY om.joined_at DESC`,
      )
      .all(userDID);

    return memberships.map((m) => ({
      orgId: m.org_id,
      name: m.name,
      description: m.description,
      type: m.type,
      avatar: m.avatar,
      role: m.role,
      joinedAt: m.joined_at,
    }));
  }

  /**
   * 添加成员
   * @param {string} orgId - 组织ID
   * @param {Object} memberData - 成员数据
   * @returns {Promise<Object>} 添加的成员信息
   */

  /**
   * 获取组织成员列表
   * @param {string} orgId - 组织ID
   * @returns {Promise<Array>} 成员列表
   */

  /**
   * 更新成员角色
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID
   * @param {string} newRole - 新角色
   * @returns {Promise<void>}
   */

  /**
   * 移除成员
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID
   * @returns {Promise<void>}
   */

  /**
   * 创建邀请
   * @param {string} orgId - 组织ID
   * @param {Object} inviteData - 邀请数据
   * @returns {Promise<Object>} 邀请信息
   */

  /**
   * 获取组织的所有邀请（包括邀请码和DID邀请）
   * @param {string} orgId - 组织ID
   * @returns {Array} 邀请列表
   */

  /**
   * 获取邀请状态
   * @param {Object} invitation - 邀请对象
   * @returns {string} 状态
   */

  /**
   * 撤销邀请
   * @param {string} orgId - 组织ID
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<Object>} 结果
   */

  /**
   * 删除邀请
   * @param {string} orgId - 组织ID
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<Object>} 结果
   */

  /**
   * 缩短DID显示
   * @param {string} did - 完整DID
   * @returns {string} 缩短的DID
   */

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

  /**
   * 接受DID邀请
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<Object>} 组织信息
   */

  /**
   * 拒绝DID邀请
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<boolean>} 是否成功
   */

  /**
   * 获取待处理的DID邀请（当前用户收到的）
   * @returns {Promise<Array>} 邀请列表
   */

  /**
   * 获取当前用户的DID邀请历史（已接受、已拒绝、已过期）
   * @param {Object} options - 选项
   * @param {string} options.status - 状态筛选（accepted|rejected）
   * @param {number} options.limit - 限制数量
   * @returns {Promise<Object>} { accepted, rejected, expired }
   */

  /**
   * 获取组织的DID邀请列表（用于管理）
   * @param {string} orgId - 组织ID
   * @param {Object} options - 选项
   * @param {string} options.status - 状态筛选（pending|accepted|rejected|expired）
   * @param {number} options.limit - 限制数量
   * @returns {Promise<Array>} 邀请列表
   */

  /**
   * 初始化内置角色
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */

  /**
   * 检查权限
   * @param {string} orgId - 组织ID
   * @param {string} userDID - 用户DID
   * @param {string} permission - 权限字符串 (如 'knowledge.write')
   * @returns {Promise<boolean>} 是否有权限
   */

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

  /**
   * 获取组织活动日志
   * @param {string} orgId - 组织ID
   * @param {number} limit - 限制数量
   * @returns {Promise<Array>} 活动日志列表
   */

  /**
   * 获取成员活动历史
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID
   * @param {number} limit - 限制数量
   * @returns {Array} 活动列表
   */

  /**
   * 生成邀请码
   * @returns {string} 邀请码
   */

  /**
   * 根据角色获取默认权限
   * @param {string} role - 角色名称
   * @returns {Array} 权限数组
   */

  /**
   * 初始化组织P2P网络
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */

  /**
   * 连接到组织P2P网络
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */

  /**
   * 处理组织同步消息
   * @param {string} orgId - 组织ID
   * @param {Object} message - 消息内容
   * @returns {Promise<void>}
   */

  /**
   * 广播组织消息
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据
   * @returns {Promise<void>}
   */

  /**
   * 请求增量同步
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */

  /**
   * 获取本地数据版本号
   * @param {string} orgId - 组织ID
   * @returns {Promise<number>} 版本号
   */

  /**
   * 发送增量数据
   * @param {string} orgId - 组织ID
   * @param {string} targetDID - 目标用户DID
   * @param {number} sinceVersion - 起始版本号
   * @returns {Promise<void>}
   */

  /**
   * 应用增量数据
   * @param {string} orgId - 组织ID
   * @param {Object} syncData - 同步数据
   * @returns {Promise<void>}
   */

  /**
   * 检查是否有冲突
   * @param {string} orgId - 组织ID
   * @param {Object} change - 变更记录
   * @returns {Promise<boolean>} 是否冲突
   */

  /**
   * 解决冲突 - 使用Last-Write-Wins策略
   * @param {string} orgId - 组织ID
   * @param {Object} change - 变更记录
   * @returns {Promise<void>}
   */

  /**
   * 应用变更
   * @param {string} orgId - 组织ID
   * @param {Object} change - 变更记录
   * @returns {Promise<void>}
   */

  /**
   * 同步成员更新
   * @param {string} orgId - 组织ID
   * @param {Object} data - 成员数据
   * @returns {Promise<void>}
   */

  /**
   * 同步知识库变更
   * @param {string} orgId - 组织ID
   * @param {Object} data - 知识库变更数据
   * @returns {Promise<void>}
   */
  /**
   * 同步知识库变更
   * @param {string} orgId - 组织ID
   * @param {Object} data - 变更数据
   * @param {string} data.type - 变更类型 (create|update|delete)
   * @param {string} data.knowledgeId - 知识库条目ID
   * @param {Object} data.content - 变更内容
   * @param {string} data.authorDID - 作者DID
   * @param {number} data.timestamp - 变更时间戳
   */

  /**
   * 创建知识库条目
   */

  /**
   * 更新知识库条目
   */

  /**
   * 删除知识库条目
   */

  /**
   * 同步组织数据
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */
  async syncOrganizationData(orgId) {
    logger.info("[OrganizationManager] 同步组织数据:", orgId);

    try {
      // 1. 连接到组织P2P网络
      await this.connectToOrgP2PNetwork(orgId);

      // 2. 请求增量同步
      await this.requestIncrementalSync(orgId);

      logger.info("[OrganizationManager] ✓ 组织数据同步已启动");
    } catch (error) {
      logger.error("[OrganizationManager] 数据同步失败:", error);
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
    const member = this.db
      .prepare(
        `SELECT role FROM organization_members WHERE org_id = ? AND member_did = ?`,
      )
      .get(orgId, userDID);

    if (member && member.role === "owner") {
      throw new Error("组织所有者不能离开组织，请先转让所有权或删除组织");
    }

    // 更新状态为removed
    this.db.run(
      `UPDATE organization_members SET status = 'removed' WHERE org_id = ? AND member_did = ?`,
      [orgId, userDID],
    );

    // 记录活动日志
    await this.logActivity(
      orgId,
      userDID,
      "leave_organization",
      "member",
      userDID,
      {},
    );

    logger.info("[OrganizationManager] ✓ 成功离开组织:", orgId);
  }

  /**
   * 删除组织（仅owner可操作）
   * @param {string} orgId - 组织ID
   * @param {string} userDID - 用户DID
   * @returns {Promise<void>}
   */
  async deleteOrganization(orgId, userDID) {
    // 检查权限
    const canDelete = await this.checkPermission(orgId, userDID, "org.delete");

    if (!canDelete) {
      throw new Error("只有组织所有者可以删除组织");
    }

    // 软删除：将所有成员状态设为removed
    this.db.run(
      `UPDATE organization_members SET status = 'removed' WHERE org_id = ?`,
      [orgId],
    );

    // 记录活动日志
    await this.logActivity(
      orgId,
      userDID,
      "delete_organization",
      "organization",
      orgId,
      {},
    );

    logger.info("[OrganizationManager] ✓ 组织已删除:", orgId);
  }

  /**
   * 获取组织所有角色
   * @param {string} orgId - 组织ID
   * @returns {Promise<Array>} 角色列表
   */

  /**
   * 获取单个角色
   * @param {string} roleId - 角色ID
   * @returns {Promise<Object|null>} 角色信息
   */

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

  /**
   * 删除自定义角色
   * @param {string} roleId - 角色ID
   * @param {string} deleterDID - 删除者DID
   * @returns {Promise<void>}
   */

  /**
   * 获取所有可用权限列表
   * @returns {Array} 权限列表
   */

  /**
   * 获取组织在线成员列表
   * @param {string} orgId - 组织ID
   * @returns {Array<string>} 在线成员DID列表
   */

  /**
   * 获取组织在线成员数量
   * @param {string} orgId - 组织ID
   * @returns {number} 在线成员数量
   */

  /**
   * 检查成员是否在线
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID
   * @returns {boolean} 是否在线
   */

  /**
   * 检查用户是否是组织成员
   * @param {string} orgId - 组织ID
   * @param {string} userDID - 用户DID
   * @returns {Promise<boolean>} 是否是成员
   */

  /**
   * 广播消息到组织
   * @param {string} orgId - 组织ID
   * @param {Object} message - 消息内容
   * @returns {Promise<void>}
   */

  /**
   * 获取组织P2P网络统计信息
   * @param {string} orgId - 组织ID
   * @returns {Object} 统计信息
   */

  /**
   * 断开组织P2P网络连接
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */

  /**
   * 处理知识库事件
   * @param {string} orgId - 组织ID
   * @param {string} type - 事件类型 (knowledge:create|knowledge:update|knowledge:delete|knowledge:sync)
   * @param {Object} data - 事件数据
   * @returns {Promise<Object>} 处理结果
   */

  /**
   * 获取组织知识库数据用于同步
   * @param {string} orgId - 组织ID
   * @param {number} since - 时间戳，获取此时间之后的数据
   * @returns {Promise<Object>} 知识库数据
   */
}

// Attach per-domain method groups onto the prototype (mixin split of a 2800-line
// class). `this` + cross-method calls stay intact since all land on one prototype.
Object.assign(
  OrganizationManager.prototype,
  _mixin_members,
  _mixin_invitations,
  _mixin_roles,
  _mixin_activity,
  _mixin_p2pSync,
  _mixin_knowledge,
);

module.exports = OrganizationManager;
