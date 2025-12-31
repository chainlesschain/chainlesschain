/**
 * 工作区与任务管理 IPC 处理器
 * Phase 1 - v0.17.0
 *
 * 注册所有工作区和任务相关的IPC接口（22个）
 */

const { ipcMain } = require('electron');

/**
 * 注册工作区与任务管理IPC处理器
 * @param {Object} app - ChainlessChainApp实例
 */
function registerWorkspaceTaskIPC(app) {
  console.log('[IPC] 注册工作区与任务管理IPC处理器...');

  // ==================== 工作区管理IPC（7个）====================

  /**
   * 创建工作区
   */
  ipcMain.handle('organization:workspace:create', async (event, { orgId, workspaceData }) => {
    try {
      if (!app.workspaceManager) {
        return { success: false, error: '工作区管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const workspace = await app.workspaceManager.createWorkspace(
        orgId,
        workspaceData,
        currentIdentity.did
      );

      return { success: true, workspace };
    } catch (error) {
      console.error('[IPC] 创建工作区失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取组织工作区列表
   */
  ipcMain.handle('organization:workspace:list', async (event, { orgId, includeArchived = false }) => {
    try {
      if (!app.workspaceManager) {
        return { success: false, error: '工作区管理器未初始化' };
      }

      const workspaces = await app.workspaceManager.getWorkspaces(orgId, { includeArchived });

      return { success: true, workspaces };
    } catch (error) {
      console.error('[IPC] 获取工作区列表失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新工作区
   */
  ipcMain.handle('organization:workspace:update', async (event, { workspaceId, updates }) => {
    try {
      if (!app.workspaceManager) {
        return { success: false, error: '工作区管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const result = await app.workspaceManager.updateWorkspace(
        workspaceId,
        updates,
        currentIdentity.did
      );

      return result;
    } catch (error) {
      console.error('[IPC] 更新工作区失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 删除工作区
   */
  ipcMain.handle('organization:workspace:delete', async (event, { workspaceId }) => {
    try {
      if (!app.workspaceManager) {
        return { success: false, error: '工作区管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const result = await app.workspaceManager.deleteWorkspace(
        workspaceId,
        currentIdentity.did
      );

      return result;
    } catch (error) {
      console.error('[IPC] 删除工作区失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 添加工作区成员
   */
  ipcMain.handle('organization:workspace:addMember', async (event, { workspaceId, memberDID, role }) => {
    try {
      if (!app.workspaceManager) {
        return { success: false, error: '工作区管理器未初始化' };
      }

      const result = await app.workspaceManager.addWorkspaceMember(workspaceId, memberDID, role);

      return result;
    } catch (error) {
      console.error('[IPC] 添加工作区成员失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 移除工作区成员
   */
  ipcMain.handle('organization:workspace:removeMember', async (event, { workspaceId, memberDID }) => {
    try {
      if (!app.workspaceManager) {
        return { success: false, error: '工作区管理器未初始化' };
      }

      const result = await app.workspaceManager.removeWorkspaceMember(workspaceId, memberDID);

      return result;
    } catch (error) {
      console.error('[IPC] 移除工作区成员失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 添加资源到工作区
   */
  ipcMain.handle('organization:workspace:addResource', async (event, { workspaceId, resourceType, resourceId }) => {
    try {
      if (!app.workspaceManager) {
        return { success: false, error: '工作区管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const result = await app.workspaceManager.addResource(
        workspaceId,
        resourceType,
        resourceId,
        currentIdentity.did
      );

      return result;
    } catch (error) {
      console.error('[IPC] 添加资源到工作区失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ==================== 任务管理IPC（15个）====================

  /**
   * 创建任务
   */
  ipcMain.handle('tasks:create', async (event, { taskData }) => {
    try {
      if (!app.taskManager) {
        return { success: false, error: '任务管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const task = await app.taskManager.createTask(taskData, currentIdentity.did);

      return { success: true, task };
    } catch (error) {
      console.error('[IPC] 创建任务失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新任务
   */
  ipcMain.handle('tasks:update', async (event, { taskId, updates }) => {
    try {
      if (!app.taskManager) {
        return { success: false, error: '任务管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const result = await app.taskManager.updateTask(taskId, updates, currentIdentity.did);

      return result;
    } catch (error) {
      console.error('[IPC] 更新任务失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 删除任务
   */
  ipcMain.handle('tasks:delete', async (event, { taskId }) => {
    try {
      if (!app.taskManager) {
        return { success: false, error: '任务管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const result = await app.taskManager.deleteTask(taskId, currentIdentity.did);

      return result;
    } catch (error) {
      console.error('[IPC] 删除任务失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取任务列表
   */
  ipcMain.handle('tasks:list', async (event, { filters }) => {
    try {
      if (!app.taskManager) {
        return { success: false, error: '任务管理器未初始化' };
      }

      const tasks = await app.taskManager.getTasks(filters);

      return { success: true, tasks };
    } catch (error) {
      console.error('[IPC] 获取任务列表失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取任务详情
   */
  ipcMain.handle('tasks:detail', async (event, { taskId }) => {
    try {
      if (!app.taskManager) {
        return { success: false, error: '任务管理器未初始化' };
      }

      const task = await app.taskManager.getTask(taskId);

      if (!task) {
        return { success: false, error: '任务不存在' };
      }

      return { success: true, task };
    } catch (error) {
      console.error('[IPC] 获取任务详情失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 分配任务
   */
  ipcMain.handle('tasks:assign', async (event, { taskId, assignedTo }) => {
    try {
      if (!app.taskManager) {
        return { success: false, error: '任务管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const result = await app.taskManager.assignTask(taskId, assignedTo, currentIdentity.did);

      return result;
    } catch (error) {
      console.error('[IPC] 分配任务失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 变更任务状态
   */
  ipcMain.handle('tasks:changeStatus', async (event, { taskId, status }) => {
    try {
      if (!app.taskManager) {
        return { success: false, error: '任务管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const result = await app.taskManager.changeStatus(taskId, status, currentIdentity.did);

      return result;
    } catch (error) {
      console.error('[IPC] 变更任务状态失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 添加任务评论
   */
  ipcMain.handle('tasks:comment:add', async (event, { taskId, content, mentions }) => {
    try {
      if (!app.taskManager) {
        return { success: false, error: '任务管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const comment = await app.taskManager.addComment(
        taskId,
        { content, mentions },
        currentIdentity.did
      );

      return { success: true, comment };
    } catch (error) {
      console.error('[IPC] 添加任务评论失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取任务评论列表
   */
  ipcMain.handle('tasks:comment:list', async (event, { taskId }) => {
    try {
      if (!app.taskManager) {
        return { success: false, error: '任务管理器未初始化' };
      }

      const comments = await app.taskManager.getComments(taskId);

      return { success: true, comments };
    } catch (error) {
      console.error('[IPC] 获取任务评论失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 删除任务评论
   */
  ipcMain.handle('tasks:comment:delete', async (event, { commentId }) => {
    try {
      if (!app.taskManager) {
        return { success: false, error: '任务管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const result = await app.taskManager.deleteComment(commentId, currentIdentity.did);

      return result;
    } catch (error) {
      console.error('[IPC] 删除任务评论失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 创建任务看板
   */
  ipcMain.handle('tasks:board:create', async (event, { orgId, boardData }) => {
    try {
      if (!app.taskManager) {
        return { success: false, error: '任务管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const board = await app.taskManager.createBoard(orgId, boardData, currentIdentity.did);

      return { success: true, board };
    } catch (error) {
      console.error('[IPC] 创建任务看板失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取任务看板列表
   */
  ipcMain.handle('tasks:board:list', async (event, { orgId, workspaceId }) => {
    try {
      if (!app.taskManager) {
        return { success: false, error: '任务管理器未初始化' };
      }

      const boards = await app.taskManager.getBoards(orgId, workspaceId);

      return { success: true, boards };
    } catch (error) {
      console.error('[IPC] 获取任务看板列表失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新任务看板
   */
  ipcMain.handle('tasks:board:update', async (event, { boardId, updates }) => {
    try {
      // TODO: 实现看板更新逻辑
      return { success: false, error: '功能开发中' };
    } catch (error) {
      console.error('[IPC] 更新任务看板失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 删除任务看板
   */
  ipcMain.handle('tasks:board:delete', async (event, { boardId }) => {
    try {
      // TODO: 实现看板删除逻辑
      return { success: false, error: '功能开发中' };
    } catch (error) {
      console.error('[IPC] 删除任务看板失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取任务变更历史
   */
  ipcMain.handle('tasks:getHistory', async (event, { taskId }) => {
    try {
      if (!app.taskManager) {
        return { success: false, error: '任务管理器未初始化' };
      }

      const changes = await app.taskManager.getChanges(taskId);

      return { success: true, changes };
    } catch (error) {
      console.error('[IPC] 获取任务历史失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[IPC] ✓ 工作区与任务管理IPC处理器注册完成 (22个接口)');
}

module.exports = {
  registerWorkspaceTaskIPC
};
