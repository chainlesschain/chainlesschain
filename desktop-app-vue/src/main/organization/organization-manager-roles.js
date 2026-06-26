/**
 * OrganizationManager — roles methods (prototype mixin).
 * Split verbatim from organization-manager.js; mixed into OrganizationManager.prototype.
 * Methods reference `this` exactly as before.
 *
 * @module organization/organization-manager-roles
 */
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

// A corrupt permissions column (malformed non-empty JSON — `|| "[]"` only guards
// null/empty) must not throw out of getRoles/getRole and take down the entire
// RBAC role list. Default to [] (no permissions = fail-closed) and log, so one
// bad row degrades only that role.
function safeParsePermissions(raw, roleId) {
  try {
    return JSON.parse(raw || "[]");
  } catch (err) {
    logger.warn(
      `[OrganizationManager] role ${roleId} has unparseable permissions; treating as none: ${err.message}`,
    );
    return [];
  }
}

module.exports = {
  async initializeBuiltinRoles(orgId) {
    const builtinRoles = [
      {
        name: "owner",
        description: "组织创建者，拥有最高权限",
        permissions: JSON.stringify(["*"]),
      },
      {
        name: "admin",
        description: "管理员，可以管理成员和内容",
        permissions: JSON.stringify([
          "org.manage",
          "member.invite",
          "member.remove",
          "member.manage",
          "knowledge.create",
          "knowledge.read",
          "knowledge.write",
          "knowledge.delete",
          "project.create",
          "project.delete",
          "role.create",
          "role.assign",
        ]),
      },
      {
        name: "member",
        description: "普通成员，可以创建和编辑内容",
        permissions: JSON.stringify([
          "knowledge.create",
          "knowledge.read",
          "knowledge.write",
          "project.create",
          "project.read",
          "project.write",
          "message.send",
        ]),
      },
      {
        name: "viewer",
        description: "访客，只能查看内容",
        permissions: JSON.stringify([
          "knowledge.read",
          "project.read",
          "message.read",
        ]),
      },
    ];

    for (const role of builtinRoles) {
      this.db.run(
        `INSERT INTO organization_roles (id, org_id, name, description, permissions, is_builtin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          orgId,
          role.name,
          role.description,
          role.permissions,
          1,
          Date.now(),
        ],
      );
    }
  },

  async checkPermission(orgId, userDID, permission) {
    // 获取用户成员信息
    const member = this.db
      .prepare(
        `SELECT role, permissions FROM organization_members WHERE org_id = ? AND member_did = ? AND status = 'active'`,
      )
      .get(orgId, userDID);

    if (!member) {
      return false; // 不是成员
    }

    // 获取角色权限
    const role = this.db
      .prepare(
        `SELECT permissions FROM organization_roles WHERE org_id = ? AND name = ?`,
      )
      .get(orgId, member.role);

    if (!role) {
      return false;
    }

    const permissions = JSON.parse(role.permissions || "[]");

    // Owner 拥有所有权限
    if (permissions.includes("*")) {
      return true;
    }

    // 检查具体权限
    if (permissions.includes(permission)) {
      return true;
    }

    // 检查通配符权限 (例如: knowledge.* 包含 knowledge.read)
    const [resource, action] = permission.split(".");
    const wildcardPermission = `${resource}.*`;
    if (permissions.includes(wildcardPermission)) {
      return true;
    }

    return false;
  },

  getDefaultPermissionsByRole(role) {
    const rolePermissions = {
      owner: ["*"],
      admin: [
        "org.manage",
        "member.invite",
        "member.remove",
        "member.manage",
        "knowledge.create",
        "knowledge.read",
        "knowledge.write",
        "knowledge.delete",
        "project.create",
        "project.delete",
        "role.create",
        "role.assign",
      ],
      member: [
        "knowledge.create",
        "knowledge.read",
        "knowledge.write",
        "project.create",
        "project.read",
        "project.write",
        "message.send",
      ],
      viewer: ["knowledge.read", "project.read", "message.read"],
    };

    return rolePermissions[role] || rolePermissions.viewer;
  },

  async getRoles(orgId) {
    const roles = this.db
      .prepare(
        `SELECT * FROM organization_roles WHERE org_id = ? ORDER BY is_builtin DESC, created_at ASC`,
      )
      .all(orgId);

    return roles.map((role) => ({
      ...role,
      permissions: safeParsePermissions(role.permissions, role.id),
    }));
  },

  async getRole(roleId) {
    const role = this.db
      .prepare(`SELECT * FROM organization_roles WHERE id = ?`)
      .get(roleId);

    if (!role) {
      return null;
    }

    return {
      ...role,
      permissions: safeParsePermissions(role.permissions, role.id),
    };
  },

  async createCustomRole(orgId, roleData, creatorDID) {
    logger.info("[OrganizationManager] 创建自定义角色:", roleData.name);

    // 1. 检查权限
    const canCreate = await this.checkPermission(
      orgId,
      creatorDID,
      "role.create",
    );
    if (!canCreate) {
      throw new Error("没有权限创建角色");
    }

    // 2. 验证角色名称唯一性
    const existingRole = this.db
      .prepare(
        `SELECT id FROM organization_roles WHERE org_id = ? AND name = ?`,
      )
      .get(orgId, roleData.name);

    if (existingRole) {
      throw new Error("角色名称已存在");
    }

    // 3. 验证权限格式
    if (!Array.isArray(roleData.permissions)) {
      throw new Error("权限必须是数组");
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
        roleData.description || "",
        JSON.stringify(roleData.permissions),
        0, // 非内置角色
        now,
      ],
    );

    // 5. 记录活动日志
    await this.logActivity(orgId, creatorDID, "create_role", "role", roleId, {
      roleName: roleData.name,
      permissions: roleData.permissions,
    });

    logger.info("[OrganizationManager] ✓ 自定义角色创建成功:", roleId);

    return {
      id: roleId,
      org_id: orgId,
      name: roleData.name,
      description: roleData.description || "",
      permissions: roleData.permissions,
      is_builtin: 0,
      created_at: now,
    };
  },

  async updateRole(roleId, updates, updaterDID) {
    logger.info("[OrganizationManager] 更新角色:", roleId);

    // 1. 获取角色信息
    const role = await this.getRole(roleId);
    if (!role) {
      throw new Error("角色不存在");
    }

    // 2. 检查是否是内置角色
    if (role.is_builtin) {
      throw new Error("不能修改内置角色");
    }

    // 3. 检查权限
    const canUpdate = await this.checkPermission(
      role.org_id,
      updaterDID,
      "role.manage",
    );
    if (!canUpdate) {
      throw new Error("没有权限更新角色");
    }

    // 4. 如果更改名称，检查唯一性
    if (updates.name && updates.name !== role.name) {
      const existingRole = this.db
        .prepare(
          `SELECT id FROM organization_roles WHERE org_id = ? AND name = ? AND id != ?`,
        )
        .get(role.org_id, updates.name, roleId);

      if (existingRole) {
        throw new Error("角色名称已存在");
      }
    }

    // 5. 构建更新语句
    const updateFields = [];
    const updateValues = [];

    if (updates.name !== undefined) {
      updateFields.push("name = ?");
      updateValues.push(updates.name);
    }

    if (updates.description !== undefined) {
      updateFields.push("description = ?");
      updateValues.push(updates.description);
    }

    if (updates.permissions !== undefined) {
      if (!Array.isArray(updates.permissions)) {
        throw new Error("权限必须是数组");
      }
      updateFields.push("permissions = ?");
      updateValues.push(JSON.stringify(updates.permissions));
    }

    if (updateFields.length === 0) {
      return role;
    }

    updateValues.push(roleId);

    // 6. 执行更新
    this.db.run(
      `UPDATE organization_roles SET ${updateFields.join(", ")} WHERE id = ?`,
      updateValues,
    );

    // 7. 记录活动日志
    await this.logActivity(
      role.org_id,
      updaterDID,
      "update_role",
      "role",
      roleId,
      {
        roleName: updates.name || role.name,
        updates: updates,
      },
    );

    logger.info("[OrganizationManager] ✓ 角色更新成功:", roleId);

    // 8. 返回更新后的角色
    return await this.getRole(roleId);
  },

  async deleteRole(roleId, deleterDID) {
    logger.info("[OrganizationManager] 删除角色:", roleId);

    // 1. 获取角色信息
    const role = await this.getRole(roleId);
    if (!role) {
      throw new Error("角色不存在");
    }

    // 2. 检查是否是内置角色
    if (role.is_builtin) {
      throw new Error("不能删除内置角色");
    }

    // 3. 检查权限
    const canDelete = await this.checkPermission(
      role.org_id,
      deleterDID,
      "role.delete",
    );
    if (!canDelete) {
      throw new Error("没有权限删除角色");
    }

    // 4. 检查是否有成员正在使用此角色
    const membersWithRole = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM organization_members WHERE org_id = ? AND role = ? AND status = 'active'`,
      )
      .get(role.org_id, role.name);

    if (membersWithRole && membersWithRole.count > 0) {
      throw new Error(
        `有 ${membersWithRole.count} 个成员正在使用此角色，请先更改这些成员的角色`,
      );
    }

    // 5. 删除角色
    this.db.run(`DELETE FROM organization_roles WHERE id = ?`, [roleId]);

    // 6. 记录活动日志
    await this.logActivity(
      role.org_id,
      deleterDID,
      "delete_role",
      "role",
      roleId,
      {
        roleName: role.name,
      },
    );

    logger.info("[OrganizationManager] ✓ 角色删除成功:", roleId);
  },

  getAllPermissions() {
    return [
      {
        category: "组织管理",
        permissions: [
          {
            value: "org.manage",
            label: "管理组织",
            description: "修改组织基本信息",
          },
          {
            value: "org.delete",
            label: "删除组织",
            description: "删除整个组织（仅所有者）",
          },
        ],
      },
      {
        category: "成员管理",
        permissions: [
          {
            value: "member.invite",
            label: "邀请成员",
            description: "创建邀请链接或邀请码",
          },
          {
            value: "member.manage",
            label: "管理成员",
            description: "更改成员角色",
          },
          {
            value: "member.remove",
            label: "移除成员",
            description: "将成员移出组织",
          },
        ],
      },
      {
        category: "角色管理",
        permissions: [
          {
            value: "role.create",
            label: "创建角色",
            description: "创建自定义角色",
          },
          {
            value: "role.manage",
            label: "管理角色",
            description: "修改角色权限",
          },
          {
            value: "role.assign",
            label: "分配角色",
            description: "给成员分配角色",
          },
          {
            value: "role.delete",
            label: "删除角色",
            description: "删除自定义角色",
          },
        ],
      },
      {
        category: "知识库",
        permissions: [
          {
            value: "knowledge.create",
            label: "创建知识",
            description: "创建新的知识条目",
          },
          {
            value: "knowledge.read",
            label: "查看知识",
            description: "查看知识库内容",
          },
          {
            value: "knowledge.write",
            label: "编辑知识",
            description: "修改知识库内容",
          },
          {
            value: "knowledge.delete",
            label: "删除知识",
            description: "删除知识条目",
          },
        ],
      },
      {
        category: "项目管理",
        permissions: [
          {
            value: "project.create",
            label: "创建项目",
            description: "创建新项目",
          },
          {
            value: "project.read",
            label: "查看项目",
            description: "查看项目信息",
          },
          {
            value: "project.write",
            label: "编辑项目",
            description: "修改项目信息",
          },
          {
            value: "project.delete",
            label: "删除项目",
            description: "删除项目",
          },
        ],
      },
      {
        category: "消息通信",
        permissions: [
          {
            value: "message.send",
            label: "发送消息",
            description: "在组织中发送消息",
          },
          {
            value: "message.read",
            label: "阅读消息",
            description: "阅读组织消息",
          },
        ],
      },
    ];
  },
};
