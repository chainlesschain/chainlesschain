const { v4: uuidv4 } = require('uuid');

/**
 * 工作区管理器 - 企业协作工作区核心模块
 * Phase 1 - v0.17.0
 *
 * 功能:
 * - 工作区CRUD
 * - 工作区成员管理
 * - 工作区资源管理
 * - 工作区权限控制
 *
 * @class WorkspaceManager
 */
class WorkspaceManager {
  /**
   * @param {Object} db - 数据库实例
   * @param {Object} organizationManager - 组织管理器实例
   */
  constructor(db, organizationManager) {
    this.db = db;
    this.organizationManager = organizationManager;
  }

  /**
   * 创建工作区
   * @param {string} orgId - 组织ID
   * @param {Object} workspaceData - 工作区数据
   * @param {string} workspaceData.name - 工作区名称
   * @param {string} workspaceData.description - 描述
   * @param {string} workspaceData.type - 类型 (default|development|testing|production)
   * @param {string} workspaceData.color - 颜色标识
   * @param {string} workspaceData.icon - 图标
   * @param {string} workspaceData.visibility - 可见性 (members|admins|specific_roles)
   * @param {Array<string>} workspaceData.allowedRoles - 允许访问的角色列表
   * @param {string} creatorDID - 创建者DID
   * @returns {Promise<Object>} 创建的工作区信息
   */
  async createWorkspace(orgId, workspaceData, creatorDID) {
    console.log('[WorkspaceManager] 创建工作区:', workspaceData.name);

    try {
      // 1. 验证组织是否存在
      const org = await this.organizationManager.getOrganization(orgId);
      if (!org) {
        throw new Error('组织不存在');
      }

      // 2. 检查创建者权限
      const hasPermission = await this.organizationManager.checkPermission(
        orgId,
        creatorDID,
        'workspace.create'
      );
      if (!hasPermission) {
        throw new Error('没有权限创建工作区');
      }

      // 3. 检查工作区名称是否重复
      const existing = this.db.prepare(
        'SELECT id FROM organization_workspaces WHERE org_id = ? AND name = ?'
      ).get(orgId, workspaceData.name);

      if (existing) {
        throw new Error('工作区名称已存在');
      }

      // 4. 创建工作区
      const workspaceId = `ws_${uuidv4().replace(/-/g, '')}`;
      const now = Date.now();

      const workspace = {
        id: workspaceId,
        org_id: orgId,
        name: workspaceData.name,
        description: workspaceData.description || '',
        type: workspaceData.type || 'default',
        color: workspaceData.color || '#1890ff',
        icon: workspaceData.icon || 'folder',
        is_default: workspaceData.isDefault ? 1 : 0,
        visibility: workspaceData.visibility || 'members',
        allowed_roles: JSON.stringify(workspaceData.allowedRoles || []),
        created_by: creatorDID,
        created_at: now,
        updated_at: now,
        archived: 0
      };

      this.db.prepare(`
        INSERT INTO organization_workspaces
        (id, org_id, name, description, type, color, icon, is_default, visibility,
         allowed_roles, created_by, created_at, updated_at, archived)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workspace.id,
        workspace.org_id,
        workspace.name,
        workspace.description,
        workspace.type,
        workspace.color,
        workspace.icon,
        workspace.is_default,
        workspace.visibility,
        workspace.allowed_roles,
        workspace.created_by,
        workspace.created_at,
        workspace.updated_at,
        workspace.archived
      );

      // 5. 添加创建者为工作区管理员
      await this.addWorkspaceMember(workspaceId, creatorDID, 'admin');

      // 6. 记录活动日志
      await this.organizationManager.logActivity(
        orgId,
        creatorDID,
        'create_workspace',
        'workspace',
        workspaceId,
        { workspaceName: workspace.name, type: workspace.type }
      );

      console.log('[WorkspaceManager] ✓ 工作区创建成功:', workspaceId);

      return {
        ...workspace,
        allowed_roles: JSON.parse(workspace.allowed_roles)
      };
    } catch (error) {
      console.error('[WorkspaceManager] 创建工作区失败:', error);
      throw error;
    }
  }

  /**
   * 获取组织的所有工作区
   * @param {string} orgId - 组织ID
   * @param {Object} options - 查询选项
   * @param {boolean} options.includeArchived - 是否包含已归档的工作区
   * @returns {Promise<Array>} 工作区列表
   */
  async getWorkspaces(orgId, options = {}) {
    try {
      let sql = 'SELECT * FROM organization_workspaces WHERE org_id = ?';
      const params = [orgId];

      if (!options.includeArchived) {
        sql += ' AND archived = 0';
      }

      sql += ' ORDER BY is_default DESC, created_at ASC';

      const workspaces = this.db.prepare(sql).all(...params);

      return workspaces.map(ws => ({
        ...ws,
        is_default: Boolean(ws.is_default),
        archived: Boolean(ws.archived),
        allowed_roles: JSON.parse(ws.allowed_roles || '[]')
      }));
    } catch (error) {
      console.error('[WorkspaceManager] 获取工作区列表失败:', error);
      return [];
    }
  }

  /**
   * 获取单个工作区详情
   * @param {string} workspaceId - 工作区ID
   * @returns {Promise<Object|null>} 工作区信息
   */
  async getWorkspace(workspaceId) {
    try {
      const workspace = this.db.prepare(
        'SELECT * FROM organization_workspaces WHERE id = ?'
      ).get(workspaceId);

      if (!workspace) {
        return null;
      }

      return {
        ...workspace,
        is_default: Boolean(workspace.is_default),
        archived: Boolean(workspace.archived),
        allowed_roles: JSON.parse(workspace.allowed_roles || '[]')
      };
    } catch (error) {
      console.error('[WorkspaceManager] 获取工作区失败:', error);
      return null;
    }
  }

  /**
   * 更新工作区
   * @param {string} workspaceId - 工作区ID
   * @param {Object} updates - 更新字段
   * @param {string} updaterDID - 更新者DID
   * @returns {Promise<Object>} 更新结果
   */
  async updateWorkspace(workspaceId, updates, updaterDID) {
    try {
      // 1. 获取工作区信息
      const workspace = await this.getWorkspace(workspaceId);
      if (!workspace) {
        return { success: false, error: '工作区不存在' };
      }

      // 2. 检查权限
      const hasPermission = await this.organizationManager.checkPermission(
        workspace.org_id,
        updaterDID,
        'workspace.manage'
      );

      if (!hasPermission) {
        return { success: false, error: '没有权限管理工作区' };
      }

      // 3. 构建更新SQL
      const fields = [];
      const values = [];

      if (updates.name !== undefined) {
        fields.push('name = ?');
        values.push(updates.name);
      }
      if (updates.description !== undefined) {
        fields.push('description = ?');
        values.push(updates.description);
      }
      if (updates.type !== undefined) {
        fields.push('type = ?');
        values.push(updates.type);
      }
      if (updates.color !== undefined) {
        fields.push('color = ?');
        values.push(updates.color);
      }
      if (updates.icon !== undefined) {
        fields.push('icon = ?');
        values.push(updates.icon);
      }
      if (updates.visibility !== undefined) {
        fields.push('visibility = ?');
        values.push(updates.visibility);
      }
      if (updates.allowedRoles !== undefined) {
        fields.push('allowed_roles = ?');
        values.push(JSON.stringify(updates.allowedRoles));
      }

      if (fields.length === 0) {
        return { success: false, error: '没有需要更新的字段' };
      }

      // 添加更新时间
      fields.push('updated_at = ?');
      values.push(Date.now());

      // 添加workspaceId到values
      values.push(workspaceId);

      // 4. 执行更新
      const sql = `UPDATE organization_workspaces SET ${fields.join(', ')} WHERE id = ?`;
      this.db.prepare(sql).run(...values);

      // 5. 记录活动
      await this.organizationManager.logActivity(
        workspace.org_id,
        updaterDID,
        'update_workspace',
        'workspace',
        workspaceId,
        { updates: Object.keys(updates) }
      );

      console.log('[WorkspaceManager] ✓ 工作区更新成功:', workspaceId);

      return { success: true };
    } catch (error) {
      console.error('[WorkspaceManager] 更新工作区失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 删除工作区（归档）
   * @param {string} workspaceId - 工作区ID
   * @param {string} deleterDID - 删除者DID
   * @returns {Promise<Object>} 删除结果
   */
  async deleteWorkspace(workspaceId, deleterDID) {
    try {
      // 1. 获取工作区信息
      const workspace = await this.getWorkspace(workspaceId);
      if (!workspace) {
        return { success: false, error: '工作区不存在' };
      }

      // 2. 检查权限
      const hasPermission = await this.organizationManager.checkPermission(
        workspace.org_id,
        deleterDID,
        'workspace.delete'
      );

      if (!hasPermission) {
        return { success: false, error: '没有权限删除工作区' };
      }

      // 3. 不能删除默认工作区
      if (workspace.is_default) {
        return { success: false, error: '不能删除默认工作区' };
      }

      // 4. 归档工作区（软删除）
      this.db.prepare(
        'UPDATE organization_workspaces SET archived = 1, updated_at = ? WHERE id = ?'
      ).run(Date.now(), workspaceId);

      // 5. 记录活动
      await this.organizationManager.logActivity(
        workspace.org_id,
        deleterDID,
        'delete_workspace',
        'workspace',
        workspaceId,
        { workspaceName: workspace.name }
      );

      console.log('[WorkspaceManager] ✓ 工作区已归档:', workspaceId);

      return { success: true };
    } catch (error) {
      console.error('[WorkspaceManager] 删除工作区失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 添加工作区成员
   * @param {string} workspaceId - 工作区ID
   * @param {string} memberDID - 成员DID
   * @param {string} role - 角色 (admin|member|viewer)
   * @returns {Promise<Object>} 添加结果
   */
  async addWorkspaceMember(workspaceId, memberDID, role = 'member') {
    try {
      // 检查是否已经是成员
      const existing = this.db.prepare(
        'SELECT id FROM workspace_members WHERE workspace_id = ? AND member_did = ?'
      ).get(workspaceId, memberDID);

      if (existing) {
        return { success: false, error: '成员已存在' };
      }

      // 添加成员
      const memberId = uuidv4();
      this.db.prepare(`
        INSERT INTO workspace_members (id, workspace_id, member_did, role, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(memberId, workspaceId, memberDID, role, Date.now());

      console.log('[WorkspaceManager] ✓ 工作区成员添加成功:', memberDID);

      return { success: true, memberId };
    } catch (error) {
      console.error('[WorkspaceManager] 添加工作区成员失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 移除工作区成员
   * @param {string} workspaceId - 工作区ID
   * @param {string} memberDID - 成员DID
   * @returns {Promise<Object>} 移除结果
   */
  async removeWorkspaceMember(workspaceId, memberDID) {
    try {
      this.db.prepare(
        'DELETE FROM workspace_members WHERE workspace_id = ? AND member_did = ?'
      ).run(workspaceId, memberDID);

      console.log('[WorkspaceManager] ✓ 工作区成员移除成功:', memberDID);

      return { success: true };
    } catch (error) {
      console.error('[WorkspaceManager] 移除工作区成员失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取工作区成员列表
   * @param {string} workspaceId - 工作区ID
   * @returns {Promise<Array>} 成员列表
   */
  async getWorkspaceMembers(workspaceId) {
    try {
      const members = this.db.prepare(`
        SELECT wm.*, om.display_name, om.avatar
        FROM workspace_members wm
        LEFT JOIN organization_members om ON wm.member_did = om.member_did
        WHERE wm.workspace_id = ?
        ORDER BY wm.joined_at ASC
      `).all(workspaceId);

      return members || [];
    } catch (error) {
      console.error('[WorkspaceManager] 获取工作区成员失败:', error);
      return [];
    }
  }

  /**
   * 添加资源到工作区
   * @param {string} workspaceId - 工作区ID
   * @param {string} resourceType - 资源类型 (knowledge|project|conversation)
   * @param {string} resourceId - 资源ID
   * @param {string} adderDID - 添加者DID
   * @returns {Promise<Object>} 添加结果
   */
  async addResource(workspaceId, resourceType, resourceId, adderDID) {
    try {
      // 检查是否已存在
      const existing = this.db.prepare(
        'SELECT id FROM workspace_resources WHERE workspace_id = ? AND resource_type = ? AND resource_id = ?'
      ).get(workspaceId, resourceType, resourceId);

      if (existing) {
        return { success: false, error: '资源已存在于该工作区' };
      }

      // 添加资源
      const resourceRecordId = uuidv4();
      this.db.prepare(`
        INSERT INTO workspace_resources (id, workspace_id, resource_type, resource_id, added_by, added_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(resourceRecordId, workspaceId, resourceType, resourceId, adderDID, Date.now());

      console.log('[WorkspaceManager] ✓ 资源添加到工作区:', resourceType, resourceId);

      return { success: true };
    } catch (error) {
      console.error('[WorkspaceManager] 添加资源到工作区失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 从工作区移除资源
   * @param {string} workspaceId - 工作区ID
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @returns {Promise<Object>} 移除结果
   */
  async removeResource(workspaceId, resourceType, resourceId) {
    try {
      this.db.prepare(
        'DELETE FROM workspace_resources WHERE workspace_id = ? AND resource_type = ? AND resource_id = ?'
      ).run(workspaceId, resourceType, resourceId);

      console.log('[WorkspaceManager] ✓ 资源已从工作区移除:', resourceType, resourceId);

      return { success: true };
    } catch (error) {
      console.error('[WorkspaceManager] 移除资源失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取工作区的所有资源
   * @param {string} workspaceId - 工作区ID
   * @param {string} resourceType - 资源类型（可选）
   * @returns {Promise<Array>} 资源列表
   */
  async getWorkspaceResources(workspaceId, resourceType = null) {
    try {
      let sql = 'SELECT * FROM workspace_resources WHERE workspace_id = ?';
      const params = [workspaceId];

      if (resourceType) {
        sql += ' AND resource_type = ?';
        params.push(resourceType);
      }

      sql += ' ORDER BY added_at DESC';

      const resources = this.db.prepare(sql).all(...params);

      return resources || [];
    } catch (error) {
      console.error('[WorkspaceManager] 获取工作区资源失败:', error);
      return [];
    }
  }
}

module.exports = WorkspaceManager;
