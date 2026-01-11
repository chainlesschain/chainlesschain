/**
 * Organization IPC 处理器
 * 负责处理组织管理相关的前后端通信（企业版功能）
 *
 * @module organization-ipc
 * @description 提供组织创建、成员管理、权限控制、邀请管理、知识库等完整的企业协作功能 IPC 接口
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * 注册所有 Organization IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.organizationManager - 组织管理器
 * @param {Object} dependencies.dbManager - 数据库管理器（用于知识库操作）
 * @param {Object} dependencies.versionManager - 版本管理器（用于知识库版本）
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 * @param {Object} dependencies.dialog - Dialog对象（可选，用于测试注入）
 * @param {Object} dependencies.app - App对象（可选，用于测试注入）
 */
function registerOrganizationIPC({
  organizationManager,
  dbManager,
  versionManager,
  ipcMain: injectedIpcMain,
  dialog: injectedDialog,
  app: injectedApp
}) {
  // 支持依赖注入，用于测试
  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;
  const dialog = injectedDialog || electron.dialog;
  const electronApp = injectedApp || electron.app;

  console.log('[Organization IPC] Registering Organization IPC handlers...');

  // ============================================================
  // 组织基础操作 (Basic Organization Operations) - 12 handlers
  // ============================================================

  /**
   * 创建组织
   * Channel: 'org:create-organization'
   */
  ipcMain.handle('org:create-organization', async (_event, orgData) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      return await organizationManager.createOrganization(orgData);
    } catch (error) {
      console.error('[Organization IPC] 创建组织失败:', error);
      throw error;
    }
  });

  /**
   * 通过邀请码加入组织
   * Channel: 'org:join-organization'
   */
  ipcMain.handle('org:join-organization', async (_event, inviteCode) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      return await organizationManager.joinOrganization(inviteCode);
    } catch (error) {
      console.error('[Organization IPC] 加入组织失败:', error);
      throw error;
    }
  });

  /**
   * 获取组织信息
   * Channel: 'org:get-organization'
   */
  ipcMain.handle('org:get-organization', async (_event, orgId) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      return await organizationManager.getOrganization(orgId);
    } catch (error) {
      console.error('[Organization IPC] 获取组织信息失败:', error);
      throw error;
    }
  });

  /**
   * 更新组织信息
   * Channel: 'org:update-organization'
   */
  ipcMain.handle('org:update-organization', async (_event, params) => {
    try {
      if (!organizationManager) {
        return { success: false, error: '组织管理器未初始化' };
      }

      const { orgId, name, type, description, visibility, p2pEnabled, syncMode } = params;

      const result = await organizationManager.updateOrganization(orgId, {
        name,
        type,
        description,
        visibility,
        p2p_enabled: p2pEnabled ? 1 : 0,
        sync_mode: syncMode
      });

      return result;
    } catch (error) {
      console.error('[Organization IPC] 更新组织失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取用户所属组织列表
   * Channel: 'org:get-user-organizations'
   */
  ipcMain.handle('org:get-user-organizations', async (_event, userDID) => {
    try {
      if (!organizationManager) {
        return [];
      }

      return await organizationManager.getUserOrganizations(userDID);
    } catch (error) {
      console.error('[Organization IPC] 获取用户组织列表失败:', error);
      return [];
    }
  });

  /**
   * 离开组织
   * Channel: 'org:leave-organization'
   */
  ipcMain.handle('org:leave-organization', async (_event, orgId, userDID) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      await organizationManager.leaveOrganization(orgId, userDID);
      return { success: true };
    } catch (error) {
      console.error('[Organization IPC] 离开组织失败:', error);
      throw error;
    }
  });

  /**
   * 删除组织
   * Channel: 'org:delete-organization'
   */
  ipcMain.handle('org:delete-organization', async (_event, orgId, userDID) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      await organizationManager.deleteOrganization(orgId, userDID);
      return { success: true };
    } catch (error) {
      console.error('[Organization IPC] 删除组织失败:', error);
      throw error;
    }
  });

  /**
   * 获取组织成员列表
   * Channel: 'org:get-members'
   */
  ipcMain.handle('org:get-members', async (_event, orgId) => {
    try {
      if (!organizationManager) {
        return [];
      }

      return await organizationManager.getOrganizationMembers(orgId);
    } catch (error) {
      console.error('[Organization IPC] 获取组织成员失败:', error);
      return [];
    }
  });

  /**
   * 更新成员角色
   * Channel: 'org:update-member-role'
   */
  ipcMain.handle('org:update-member-role', async (_event, orgId, memberDID, newRole) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      await organizationManager.updateMemberRole(orgId, memberDID, newRole);
      return { success: true };
    } catch (error) {
      console.error('[Organization IPC] 更新成员角色失败:', error);
      throw error;
    }
  });

  /**
   * 移除成员
   * Channel: 'org:remove-member'
   */
  ipcMain.handle('org:remove-member', async (_event, orgId, memberDID) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      await organizationManager.removeMember(orgId, memberDID);
      return { success: true };
    } catch (error) {
      console.error('[Organization IPC] 移除成员失败:', error);
      throw error;
    }
  });

  /**
   * 检查权限
   * Channel: 'org:check-permission'
   */
  ipcMain.handle('org:check-permission', async (_event, orgId, userDID, permission) => {
    try {
      if (!organizationManager) {
        return false;
      }

      return await organizationManager.checkPermission(orgId, userDID, permission);
    } catch (error) {
      console.error('[Organization IPC] 检查权限失败:', error);
      return false;
    }
  });

  /**
   * 获取成员活动历史
   * Channel: 'org:get-member-activities'
   */
  ipcMain.handle('org:get-member-activities', async (_event, params) => {
    try {
      if (!organizationManager) {
        return { success: false, error: '组织管理器未初始化', activities: [] };
      }

      const { orgId, memberDID, limit = 10 } = params;
      const activities = organizationManager.getMemberActivities(orgId, memberDID, limit);
      return { success: true, activities };
    } catch (error) {
      console.error('[Organization IPC] 获取成员活动失败:', error);
      return { success: false, error: error.message, activities: [] };
    }
  });

  // ============================================================
  // 邀请管理 (Invitation Management) - 8 handlers
  // ============================================================

  /**
   * 创建邀请
   * Channel: 'org:create-invitation'
   */
  ipcMain.handle('org:create-invitation', async (_event, orgId, inviteData) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      return await organizationManager.createInvitation(orgId, inviteData);
    } catch (error) {
      console.error('[Organization IPC] 创建邀请失败:', error);
      throw error;
    }
  });

  /**
   * 通过DID邀请用户
   * Channel: 'org:invite-by-did'
   */
  ipcMain.handle('org:invite-by-did', async (_event, orgId, inviteData) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      const invitation = await organizationManager.inviteByDID(orgId, inviteData);
      return invitation;
    } catch (error) {
      console.error('[Organization IPC] 通过DID邀请失败:', error);
      throw error;
    }
  });

  /**
   * 接受DID邀请
   * Channel: 'org:accept-did-invitation'
   */
  ipcMain.handle('org:accept-did-invitation', async (_event, invitationId) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      const org = await organizationManager.acceptDIDInvitation(invitationId);
      return org;
    } catch (error) {
      console.error('[Organization IPC] 接受DID邀请失败:', error);
      throw error;
    }
  });

  /**
   * 拒绝DID邀请
   * Channel: 'org:reject-did-invitation'
   */
  ipcMain.handle('org:reject-did-invitation', async (_event, invitationId) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      const result = await organizationManager.rejectDIDInvitation(invitationId);
      return { success: result };
    } catch (error) {
      console.error('[Organization IPC] 拒绝DID邀请失败:', error);
      throw error;
    }
  });

  /**
   * 获取待处理的DID邀请
   * Channel: 'org:get-pending-did-invitations'
   */
  ipcMain.handle('org:get-pending-did-invitations', async (_event) => {
    try {
      if (!organizationManager) {
        return [];
      }

      const invitations = await organizationManager.getPendingDIDInvitations();
      return invitations;
    } catch (error) {
      console.error('[Organization IPC] 获取待处理DID邀请失败:', error);
      return [];
    }
  });

  /**
   * 获取组织的DID邀请列表
   * Channel: 'org:get-did-invitations'
   */
  ipcMain.handle('org:get-did-invitations', async (_event, orgId, options) => {
    try {
      if (!organizationManager) {
        return [];
      }

      const invitations = await organizationManager.getDIDInvitations(orgId, options);
      return invitations;
    } catch (error) {
      console.error('[Organization IPC] 获取DID邀请列表失败:', error);
      return [];
    }
  });

  /**
   * 获取邀请列表（包括邀请码和DID邀请）
   * Channel: 'org:get-invitations'
   */
  ipcMain.handle('org:get-invitations', async (_event, orgId) => {
    try {
      if (!organizationManager) {
        return { success: false, error: '组织管理器未初始化', invitations: [] };
      }

      const invitations = organizationManager.getInvitations(orgId);
      return { success: true, invitations };
    } catch (error) {
      console.error('[Organization IPC] 获取邀请列表失败:', error);
      return { success: false, error: error.message, invitations: [] };
    }
  });

  /**
   * 撤销邀请
   * Channel: 'org:revoke-invitation'
   */
  ipcMain.handle('org:revoke-invitation', async (_event, params) => {
    try {
      if (!organizationManager) {
        return { success: false, error: '组织管理器未初始化' };
      }

      const { orgId, invitationId } = params;
      const result = await organizationManager.revokeInvitation(orgId, invitationId);
      return result;
    } catch (error) {
      console.error('[Organization IPC] 撤销邀请失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 删除邀请
   * Channel: 'org:delete-invitation'
   */
  ipcMain.handle('org:delete-invitation', async (_event, params) => {
    try {
      if (!organizationManager) {
        return { success: false, error: '组织管理器未初始化' };
      }

      const { orgId, invitationId } = params;
      const result = await organizationManager.deleteInvitation(orgId, invitationId);
      return result;
    } catch (error) {
      console.error('[Organization IPC] 删除邀请失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // 邀请链接管理 (Invitation Link Management) - 9 handlers
  // ============================================================

  /**
   * 创建邀请链接
   * Channel: 'org:create-invitation-link'
   */
  ipcMain.handle('org:create-invitation-link', async (_event, params) => {
    try {
      if (!organizationManager || !organizationManager.didInvitationManager) {
        throw new Error('邀请管理器未初始化');
      }

      const invitationLink = await organizationManager.didInvitationManager.createInvitationLink(params);
      return { success: true, invitationLink };
    } catch (error) {
      console.error('[Organization IPC] 创建邀请链接失败:', error);
      throw error;
    }
  });

  /**
   * 验证邀请令牌
   * Channel: 'org:validate-invitation-token'
   */
  ipcMain.handle('org:validate-invitation-token', async (_event, token) => {
    try {
      if (!organizationManager || !organizationManager.didInvitationManager) {
        throw new Error('邀请管理器未初始化');
      }

      const linkInfo = await organizationManager.didInvitationManager.validateInvitationToken(token);
      return { success: true, linkInfo };
    } catch (error) {
      console.error('[Organization IPC] 验证邀请令牌失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 通过邀请链接加入组织
   * Channel: 'org:accept-invitation-link'
   */
  ipcMain.handle('org:accept-invitation-link', async (_event, token, options) => {
    try {
      if (!organizationManager || !organizationManager.didInvitationManager) {
        throw new Error('邀请管理器未初始化');
      }

      const org = await organizationManager.didInvitationManager.acceptInvitationLink(token, options);
      return { success: true, org };
    } catch (error) {
      console.error('[Organization IPC] 通过邀请链接加入失败:', error);
      throw error;
    }
  });

  /**
   * 获取邀请链接列表
   * Channel: 'org:get-invitation-links'
   */
  ipcMain.handle('org:get-invitation-links', async (_event, orgId, options) => {
    try {
      if (!organizationManager || !organizationManager.didInvitationManager) {
        return { success: false, error: '邀请管理器未初始化', links: [] };
      }

      const links = organizationManager.didInvitationManager.getInvitationLinks(orgId, options);
      return { success: true, links };
    } catch (error) {
      console.error('[Organization IPC] 获取邀请链接列表失败:', error);
      return { success: false, error: error.message, links: [] };
    }
  });

  /**
   * 获取邀请链接详情
   * Channel: 'org:get-invitation-link'
   */
  ipcMain.handle('org:get-invitation-link', async (_event, linkId) => {
    try {
      if (!organizationManager || !organizationManager.didInvitationManager) {
        return { success: false, error: '邀请管理器未初始化', link: null };
      }

      const link = organizationManager.didInvitationManager.getInvitationLink(linkId);
      return { success: true, link };
    } catch (error) {
      console.error('[Organization IPC] 获取邀请链接详情失败:', error);
      return { success: false, error: error.message, link: null };
    }
  });

  /**
   * 撤销邀请链接
   * Channel: 'org:revoke-invitation-link'
   */
  ipcMain.handle('org:revoke-invitation-link', async (_event, linkId) => {
    try {
      if (!organizationManager || !organizationManager.didInvitationManager) {
        throw new Error('邀请管理器未初始化');
      }

      await organizationManager.didInvitationManager.revokeInvitationLink(linkId);
      return { success: true };
    } catch (error) {
      console.error('[Organization IPC] 撤销邀请链接失败:', error);
      throw error;
    }
  });

  /**
   * 删除邀请链接
   * Channel: 'org:delete-invitation-link'
   */
  ipcMain.handle('org:delete-invitation-link', async (_event, linkId) => {
    try {
      if (!organizationManager || !organizationManager.didInvitationManager) {
        throw new Error('邀请管理器未初始化');
      }

      await organizationManager.didInvitationManager.deleteInvitationLink(linkId);
      return { success: true };
    } catch (error) {
      console.error('[Organization IPC] 删除邀请链接失败:', error);
      throw error;
    }
  });

  /**
   * 获取邀请链接统计信息
   * Channel: 'org:get-invitation-link-stats'
   */
  ipcMain.handle('org:get-invitation-link-stats', async (_event, orgId) => {
    try {
      if (!organizationManager || !organizationManager.didInvitationManager) {
        return {
          success: false,
          error: '邀请管理器未初始化',
          stats: {
            total: 0,
            active: 0,
            expired: 0,
            revoked: 0,
            totalUses: 0,
            totalMaxUses: 0,
            utilizationRate: 0
          }
        };
      }

      const stats = organizationManager.didInvitationManager.getInvitationLinkStats(orgId);
      return { success: true, stats };
    } catch (error) {
      console.error('[Organization IPC] 获取邀请链接统计失败:', error);
      return {
        success: false,
        error: error.message,
        stats: {
          total: 0,
          active: 0,
          expired: 0,
          revoked: 0,
          totalUses: 0,
          totalMaxUses: 0,
          utilizationRate: 0
        }
      };
    }
  });

  /**
   * 复制邀请链接到剪贴板
   * Channel: 'org:copy-invitation-link'
   */
  ipcMain.handle('org:copy-invitation-link', async (_event, invitationUrl) => {
    try {
      const { clipboard } = require('electron');
      clipboard.writeText(invitationUrl);
      return { success: true };
    } catch (error) {
      console.error('[Organization IPC] 复制邀请链接失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // 角色与权限管理 (Role & Permission Management) - 6 handlers
  // ============================================================

  /**
   * 获取组织所有角色
   * Channel: 'org:get-roles'
   */
  ipcMain.handle('org:get-roles', async (_event, orgId) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      const roles = await organizationManager.getRoles(orgId);
      return roles;
    } catch (error) {
      console.error('[Organization IPC] 获取角色列表失败:', error);
      throw error;
    }
  });

  /**
   * 获取单个角色
   * Channel: 'org:get-role'
   */
  ipcMain.handle('org:get-role', async (_event, roleId) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      const role = await organizationManager.getRole(roleId);
      return role;
    } catch (error) {
      console.error('[Organization IPC] 获取角色失败:', error);
      throw error;
    }
  });

  /**
   * 创建自定义角色
   * Channel: 'org:create-custom-role'
   */
  ipcMain.handle('org:create-custom-role', async (_event, orgId, roleData, creatorDID) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      const role = await organizationManager.createCustomRole(orgId, roleData, creatorDID);
      return role;
    } catch (error) {
      console.error('[Organization IPC] 创建自定义角色失败:', error);
      throw error;
    }
  });

  /**
   * 更新角色
   * Channel: 'org:update-role'
   */
  ipcMain.handle('org:update-role', async (_event, roleId, updates, updaterDID) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      const role = await organizationManager.updateRole(roleId, updates, updaterDID);
      return role;
    } catch (error) {
      console.error('[Organization IPC] 更新角色失败:', error);
      throw error;
    }
  });

  /**
   * 删除角色
   * Channel: 'org:delete-role'
   */
  ipcMain.handle('org:delete-role', async (_event, roleId, deleterDID) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      await organizationManager.deleteRole(roleId, deleterDID);
      return { success: true };
    } catch (error) {
      console.error('[Organization IPC] 删除角色失败:', error);
      throw error;
    }
  });

  /**
   * 获取所有可用权限列表
   * Channel: 'org:get-all-permissions'
   */
  ipcMain.handle('org:get-all-permissions', async (_event) => {
    try {
      if (!organizationManager) {
        throw new Error('组织管理器未初始化');
      }

      const permissions = organizationManager.getAllPermissions();
      return permissions;
    } catch (error) {
      console.error('[Organization IPC] 获取权限列表失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 活动日志 (Activity Log) - 2 handlers
  // ============================================================

  /**
   * 获取组织活动日志
   * Channel: 'org:get-activities'
   */
  ipcMain.handle('org:get-activities', async (_event, options) => {
    try {
      if (!organizationManager) {
        return { success: false, activities: [] };
      }

      const { orgId, limit = 500 } = options;
      const activities = await organizationManager.getOrganizationActivities(orgId, limit);
      return { success: true, activities };
    } catch (error) {
      console.error('[Organization IPC] 获取活动日志失败:', error);
      return { success: false, error: error.message, activities: [] };
    }
  });

  /**
   * 导出组织活动日志
   * Channel: 'org:export-activities'
   */
  ipcMain.handle('org:export-activities', async (_event, options) => {
    try {
      const { orgId, activities } = options;

      // 弹出保存对话框
      const result = await dialog.showSaveDialog({
        title: '导出活动日志',
        defaultPath: path.join(
          electronApp.getPath('documents'),
          `organization_${orgId}_activities_${Date.now()}.json`
        ),
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: '用户取消' };
      }

      const filePath = result.filePath;
      const ext = path.extname(filePath).toLowerCase();

      if (ext === '.json') {
        // 导出为JSON
        await fs.writeFile(
          filePath,
          JSON.stringify(activities, null, 2),
          'utf-8'
        );
      } else if (ext === '.csv') {
        // 导出为CSV
        const headers = ['操作者DID', '操作类型', '资源类型', '资源ID', '时间', '元数据'];
        const rows = activities.map(a => [
          a.actor_did,
          a.action,
          a.resource_type,
          a.resource_id,
          new Date(a.timestamp).toISOString(),
          a.metadata
        ]);

        const csv = [
          headers.join(','),
          ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        await fs.writeFile(filePath, csv, 'utf-8');
      }

      return { success: true, filePath };
    } catch (error) {
      console.error('[Organization IPC] 导出活动日志失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // 组织知识库 (Organization Knowledge Base) - 2 handlers
  // ============================================================

  /**
   * 获取组织知识列表
   * Channel: 'org:get-knowledge-items'
   */
  ipcMain.handle('org:get-knowledge-items', async (_event, params) => {
    try {
      const { orgId } = params;
      const db = dbManager.db;

      // 获取组织的所有知识（share_scope='org' 或 'public'）
      const items = db.prepare(`
        SELECT *
        FROM knowledge_items
        WHERE org_id = ? AND share_scope IN ('org', 'public')
        ORDER BY updated_at DESC
      `).all(orgId);

      return { success: true, items };
    } catch (error) {
      console.error('[Organization IPC] 获取组织知识列表失败:', error);
      return { success: false, error: error.message, items: [] };
    }
  });

  /**
   * 创建组织知识
   * Channel: 'org:create-knowledge'
   */
  ipcMain.handle('org:create-knowledge', async (_event, params) => {
    try {
      const {
        orgId,
        title,
        type,
        content,
        shareScope,
        tags,
        createdBy
      } = params;

      const db = dbManager.db;
      const knowledgeId = require('uuid').v4();
      const now = Date.now();

      // 插入知识
      db.prepare(`
        INSERT INTO knowledge_items (
          id, title, type, content, org_id, created_by, updated_by,
          share_scope, version, created_at, updated_at, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        knowledgeId,
        title,
        type,
        content,
        orgId,
        createdBy,
        createdBy,
        shareScope || 'org',
        1,
        now,
        now,
        'pending'
      );

      // 添加标签（如果有）
      if (tags && tags.length > 0) {
        for (const tagName of tags) {
          // 查找或创建标签
          let tag = db.prepare('SELECT * FROM tags WHERE name = ?').get(tagName);
          if (!tag) {
            const tagId = require('uuid').v4();
            db.prepare(`
              INSERT INTO tags (id, name, color, created_at)
              VALUES (?, ?, ?, ?)
            `).run(tagId, tagName, '#1890ff', now);
            tag = { id: tagId };
          }

          // 关联标签
          db.prepare(`
            INSERT INTO knowledge_tags (knowledge_id, tag_id, created_at)
            VALUES (?, ?, ?)
          `).run(knowledgeId, tag.id, now);
        }
      }

      // 创建初始版本快照
      if (versionManager) {
        await versionManager.createVersionSnapshot(knowledgeId, createdBy, {
          changeSummary: '创建知识',
          metadata: { type: 'initial_create' }
        });
      }

      // 记录活动
      if (organizationManager) {
        await organizationManager.logActivity(
          orgId,
          createdBy,
          'create_knowledge',
          'knowledge',
          knowledgeId,
          { title }
        );
      }

      return { success: true, id: knowledgeId };
    } catch (error) {
      console.error('[Organization IPC] 创建组织知识失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 删除组织知识
   * Channel: 'org:delete-knowledge'
   */
  ipcMain.handle('org:delete-knowledge', async (_event, params) => {
    try {
      const { orgId, knowledgeId } = params;
      const db = dbManager.db;

      // 检查知识是否存在且属于该组织
      const knowledge = db.prepare(`
        SELECT * FROM knowledge_items WHERE id = ? AND org_id = ?
      `).get(knowledgeId, orgId);

      if (!knowledge) {
        return { success: false, error: '知识不存在或无权删除' };
      }

      // 删除知识（级联删除关联的标签和搜索索引）
      db.prepare('DELETE FROM knowledge_items WHERE id = ?').run(knowledgeId);

      return { success: true };
    } catch (error) {
      console.error('[Organization IPC] 删除组织知识失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Organization IPC] ✓ All Organization IPC handlers registered successfully (41 handlers)');
}

module.exports = {
  registerOrganizationIPC
};
