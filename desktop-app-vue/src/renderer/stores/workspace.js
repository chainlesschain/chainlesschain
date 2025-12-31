import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { message } from 'ant-design-vue';

/**
 * 工作区管理Store - Phase 1
 * 负责管理组织工作区的CRUD操作和成员管理
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  // ==================== State ====================

  // 当前组织的工作区列表
  const workspaces = ref([]);

  // 当前选中的工作区
  const currentWorkspace = ref(null);

  // 工作区成员列表（当前工作区）
  const currentWorkspaceMembers = ref([]);

  // 工作区资源列表（当前工作区）
  const currentWorkspaceResources = ref([]);

  // 加载状态
  const loading = ref(false);

  // 创建工作区对话框可见性
  const createDialogVisible = ref(false);

  // 工作区详情对话框可见性
  const detailDialogVisible = ref(false);

  // ==================== Getters ====================

  /**
   * 获取默认工作区
   */
  const defaultWorkspace = computed(() => {
    return workspaces.value.find(ws => ws.is_default === 1);
  });

  /**
   * 按类型分组的工作区
   */
  const workspacesByType = computed(() => {
    const groups = {
      default: [],
      development: [],
      testing: [],
      production: []
    };

    workspaces.value.forEach(ws => {
      if (groups[ws.type]) {
        groups[ws.type].push(ws);
      }
    });

    return groups;
  });

  /**
   * 未归档的工作区
   */
  const activeWorkspaces = computed(() => {
    return workspaces.value.filter(ws => !ws.archived);
  });

  /**
   * 归档的工作区
   */
  const archivedWorkspaces = computed(() => {
    return workspaces.value.filter(ws => ws.archived);
  });

  /**
   * 当前工作区ID
   */
  const currentWorkspaceId = computed(() => {
    return currentWorkspace.value?.id || null;
  });

  /**
   * 当前用户在当前工作区的角色
   */
  const currentUserRole = computed(() => {
    if (!currentWorkspace.value || !currentWorkspaceMembers.value.length) {
      return null;
    }
    // TODO: 需要获取当前用户DID
    // const currentMember = currentWorkspaceMembers.value.find(m => m.member_did === currentUserDID);
    // return currentMember?.role;
    return 'admin'; // 临时返回
  });

  // ==================== Actions ====================

  /**
   * 加载组织工作区列表
   * @param {string} orgId - 组织ID
   * @param {boolean} includeArchived - 是否包含归档的工作区
   */
  async function loadWorkspaces(orgId, includeArchived = false) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke('organization:workspace:list', {
        orgId,
        includeArchived
      });

      if (result.success) {
        workspaces.value = result.workspaces || [];
        console.log('[WorkspaceStore] 工作区列表加载成功', workspaces.value.length);

        // 如果当前没有选中工作区，自动选中默认工作区
        if (!currentWorkspace.value && workspaces.value.length > 0) {
          const defaultWs = defaultWorkspace.value || workspaces.value[0];
          await selectWorkspace(defaultWs.id);
        }
      } else {
        message.error(`加载工作区列表失败: ${result.error}`);
        console.error('[WorkspaceStore] 加载工作区列表失败:', result.error);
      }
    } catch (error) {
      message.error('加载工作区列表异常');
      console.error('[WorkspaceStore] 加载工作区列表异常:', error);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 创建工作区
   * @param {string} orgId - 组织ID
   * @param {object} workspaceData - 工作区数据
   */
  async function createWorkspace(orgId, workspaceData) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke('organization:workspace:create', {
        orgId,
        workspaceData
      });

      if (result.success) {
        message.success('工作区创建成功');
        console.log('[WorkspaceStore] 工作区创建成功:', result.workspace);

        // 重新加载工作区列表
        await loadWorkspaces(orgId);

        // 自动选中新创建的工作区
        if (result.workspace) {
          await selectWorkspace(result.workspace.id);
        }

        return result.workspace;
      } else {
        message.error(`创建工作区失败: ${result.error}`);
        console.error('[WorkspaceStore] 创建工作区失败:', result.error);
        return null;
      }
    } catch (error) {
      message.error('创建工作区异常');
      console.error('[WorkspaceStore] 创建工作区异常:', error);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 更新工作区
   * @param {string} workspaceId - 工作区ID
   * @param {object} updates - 更新数据
   */
  async function updateWorkspace(workspaceId, updates) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke('organization:workspace:update', {
        workspaceId,
        updates
      });

      if (result.success) {
        message.success('工作区更新成功');
        console.log('[WorkspaceStore] 工作区更新成功');

        // 更新本地缓存
        const index = workspaces.value.findIndex(ws => ws.id === workspaceId);
        if (index !== -1) {
          workspaces.value[index] = {
            ...workspaces.value[index],
            ...updates,
            updated_at: Date.now()
          };
        }

        // 如果更新的是当前工作区，同步更新
        if (currentWorkspace.value?.id === workspaceId) {
          currentWorkspace.value = {
            ...currentWorkspace.value,
            ...updates,
            updated_at: Date.now()
          };
        }

        return true;
      } else {
        message.error(`更新工作区失败: ${result.error}`);
        console.error('[WorkspaceStore] 更新工作区失败:', result.error);
        return false;
      }
    } catch (error) {
      message.error('更新工作区异常');
      console.error('[WorkspaceStore] 更新工作区异常:', error);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 删除（归档）工作区
   * @param {string} workspaceId - 工作区ID
   */
  async function deleteWorkspace(workspaceId) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke('organization:workspace:delete', {
        workspaceId
      });

      if (result.success) {
        message.success('工作区已归档');
        console.log('[WorkspaceStore] 工作区归档成功');

        // 从列表中移除或标记为归档
        const workspace = workspaces.value.find(ws => ws.id === workspaceId);
        if (workspace) {
          workspace.archived = 1;
        }

        // 如果删除的是当前工作区，切换到默认工作区
        if (currentWorkspace.value?.id === workspaceId) {
          const defaultWs = defaultWorkspace.value || activeWorkspaces.value[0];
          if (defaultWs) {
            await selectWorkspace(defaultWs.id);
          } else {
            currentWorkspace.value = null;
          }
        }

        return true;
      } else {
        message.error(`归档工作区失败: ${result.error}`);
        console.error('[WorkspaceStore] 归档工作区失败:', result.error);
        return false;
      }
    } catch (error) {
      message.error('归档工作区异常');
      console.error('[WorkspaceStore] 归档工作区异常:', error);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 选中工作区
   * @param {string} workspaceId - 工作区ID
   */
  async function selectWorkspace(workspaceId) {
    const workspace = workspaces.value.find(ws => ws.id === workspaceId);
    if (workspace) {
      currentWorkspace.value = workspace;
      console.log('[WorkspaceStore] 切换到工作区:', workspace.name);

      // 加载工作区成员和资源
      await loadWorkspaceMembers(workspaceId);
      await loadWorkspaceResources(workspaceId);
    } else {
      console.error('[WorkspaceStore] 工作区不存在:', workspaceId);
    }
  }

  /**
   * 加载工作区成员
   * @param {string} workspaceId - 工作区ID
   */
  async function loadWorkspaceMembers(workspaceId) {
    try {
      // TODO: 实现获取工作区成员的IPC接口
      // const result = await window.ipc.invoke('organization:workspace:getMembers', { workspaceId });
      // currentWorkspaceMembers.value = result.members || [];
      currentWorkspaceMembers.value = [];
      console.log('[WorkspaceStore] 工作区成员加载成功');
    } catch (error) {
      console.error('[WorkspaceStore] 加载工作区成员失败:', error);
    }
  }

  /**
   * 加载工作区资源
   * @param {string} workspaceId - 工作区ID
   */
  async function loadWorkspaceResources(workspaceId) {
    try {
      // TODO: 实现获取工作区资源的IPC接口
      // const result = await window.ipc.invoke('organization:workspace:getResources', { workspaceId });
      // currentWorkspaceResources.value = result.resources || [];
      currentWorkspaceResources.value = [];
      console.log('[WorkspaceStore] 工作区资源加载成功');
    } catch (error) {
      console.error('[WorkspaceStore] 加载工作区资源失败:', error);
    }
  }

  /**
   * 添加工作区成员
   * @param {string} workspaceId - 工作区ID
   * @param {string} memberDID - 成员DID
   * @param {string} role - 角色 (admin/member/viewer)
   */
  async function addMember(workspaceId, memberDID, role) {
    try {
      const result = await window.ipc.invoke('organization:workspace:addMember', {
        workspaceId,
        memberDID,
        role
      });

      if (result.success) {
        message.success('成员添加成功');
        await loadWorkspaceMembers(workspaceId);
        return true;
      } else {
        message.error(`添加成员失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error('添加成员异常');
      console.error('[WorkspaceStore] 添加成员异常:', error);
      return false;
    }
  }

  /**
   * 移除工作区成员
   * @param {string} workspaceId - 工作区ID
   * @param {string} memberDID - 成员DID
   */
  async function removeMember(workspaceId, memberDID) {
    try {
      const result = await window.ipc.invoke('organization:workspace:removeMember', {
        workspaceId,
        memberDID
      });

      if (result.success) {
        message.success('成员移除成功');
        await loadWorkspaceMembers(workspaceId);
        return true;
      } else {
        message.error(`移除成员失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error('移除成员异常');
      console.error('[WorkspaceStore] 移除成员异常:', error);
      return false;
    }
  }

  /**
   * 添加资源到工作区
   * @param {string} workspaceId - 工作区ID
   * @param {string} resourceType - 资源类型 (knowledge/project/conversation)
   * @param {string} resourceId - 资源ID
   */
  async function addResource(workspaceId, resourceType, resourceId) {
    try {
      const result = await window.ipc.invoke('organization:workspace:addResource', {
        workspaceId,
        resourceType,
        resourceId
      });

      if (result.success) {
        message.success('资源添加成功');
        await loadWorkspaceResources(workspaceId);
        return true;
      } else {
        message.error(`添加资源失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error('添加资源异常');
      console.error('[WorkspaceStore] 添加资源异常:', error);
      return false;
    }
  }

  /**
   * 重置Store
   */
  function reset() {
    workspaces.value = [];
    currentWorkspace.value = null;
    currentWorkspaceMembers.value = [];
    currentWorkspaceResources.value = [];
    loading.value = false;
    createDialogVisible.value = false;
    detailDialogVisible.value = false;
  }

  // ==================== 返回 ====================

  return {
    // State
    workspaces,
    currentWorkspace,
    currentWorkspaceMembers,
    currentWorkspaceResources,
    loading,
    createDialogVisible,
    detailDialogVisible,

    // Getters
    defaultWorkspace,
    workspacesByType,
    activeWorkspaces,
    archivedWorkspaces,
    currentWorkspaceId,
    currentUserRole,

    // Actions
    loadWorkspaces,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    selectWorkspace,
    loadWorkspaceMembers,
    loadWorkspaceResources,
    addMember,
    removeMember,
    addResource,
    reset
  };
});
