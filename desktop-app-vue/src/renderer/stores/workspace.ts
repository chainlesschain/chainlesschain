/**
 * Workspace Store - 工作区管理
 * 负责管理组织工作区的CRUD操作和成员管理
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { message } from 'ant-design-vue';
import { useIdentityStore } from './identityStore';

// ==================== 类型定义 ====================

/**
 * 工作区类型
 */
export type WorkspaceType = 'default' | 'development' | 'testing' | 'production';

/**
 * 成员角色
 */
export type MemberRole = 'admin' | 'member' | 'viewer';

/**
 * 工作区
 */
export interface Workspace {
  id: string;
  name: string;
  description?: string;
  org_id: string;
  type: WorkspaceType;
  is_default: number;
  archived: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  [key: string]: any;
}

/**
 * 工作区成员
 */
export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  member_did: string;
  role: MemberRole;
  display_name?: string;
  avatar?: string;
  joined_at: number;
}

/**
 * 工作区资源
 */
export interface WorkspaceResource {
  id: string;
  type: 'knowledge' | 'project' | 'conversation';
  name: string;
  description: string;
  created_at: number;
  updated_at?: number;
  creator?: string;
  metadata?: any;
}

/**
 * 工作区创建数据
 */
export interface WorkspaceCreateData {
  name: string;
  description?: string;
  type?: WorkspaceType;
  is_default?: boolean;
}

/**
 * 按类型分组的工作区
 */
export interface WorkspacesByType {
  default: Workspace[];
  development: Workspace[];
  testing: Workspace[];
  production: Workspace[];
}

/**
 * IPC 结果
 */
interface IpcResult<T = any> {
  success: boolean;
  workspaces?: Workspace[];
  workspace?: Workspace;
  members?: WorkspaceMember[];
  items?: any[];
  error?: string;
}

// ==================== Store ====================

export const useWorkspaceStore = defineStore('workspace', () => {
  // ==================== State ====================

  // 当前组织的工作区列表
  const workspaces: Ref<Workspace[]> = ref([]);

  // 当前选中的工作区
  const currentWorkspace: Ref<Workspace | null> = ref(null);

  // 工作区成员列表（当前工作区）
  const currentWorkspaceMembers: Ref<WorkspaceMember[]> = ref([]);

  // 工作区资源列表（当前工作区）
  const currentWorkspaceResources: Ref<WorkspaceResource[]> = ref([]);

  // 加载状态
  const loading: Ref<boolean> = ref(false);

  // 创建工作区对话框可见性
  const createDialogVisible: Ref<boolean> = ref(false);

  // 工作区详情对话框可见性
  const detailDialogVisible: Ref<boolean> = ref(false);

  // ==================== Getters ====================

  /**
   * 获取默认工作区
   */
  const defaultWorkspace: ComputedRef<Workspace | undefined> = computed(() => {
    return workspaces.value.find((ws) => ws.is_default === 1);
  });

  /**
   * 按类型分组的工作区
   */
  const workspacesByType: ComputedRef<WorkspacesByType> = computed(() => {
    const groups: WorkspacesByType = {
      default: [],
      development: [],
      testing: [],
      production: [],
    };

    workspaces.value.forEach((ws) => {
      if (groups[ws.type]) {
        groups[ws.type].push(ws);
      }
    });

    return groups;
  });

  /**
   * 未归档的工作区
   */
  const activeWorkspaces: ComputedRef<Workspace[]> = computed(() => {
    return workspaces.value.filter((ws) => !ws.archived);
  });

  /**
   * 归档的工作区
   */
  const archivedWorkspaces: ComputedRef<Workspace[]> = computed(() => {
    return workspaces.value.filter((ws) => ws.archived);
  });

  /**
   * 当前工作区ID
   */
  const currentWorkspaceId: ComputedRef<string | null> = computed(() => {
    return currentWorkspace.value?.id || null;
  });

  /**
   * 当前用户在当前工作区的角色
   */
  const currentUserRole: ComputedRef<MemberRole | null> = computed(() => {
    if (!currentWorkspace.value || !currentWorkspaceMembers.value.length) {
      return null;
    }
    const identityStore = useIdentityStore();
    const currentUserDID = identityStore.currentUserDID;
    if (!currentUserDID) {
      return null;
    }
    const currentMember = currentWorkspaceMembers.value.find(
      (m) => m.member_did === currentUserDID
    );
    return currentMember?.role || null;
  });

  // ==================== Actions ====================

  /**
   * 加载组织工作区列表
   */
  async function loadWorkspaces(orgId: string, includeArchived: boolean = false): Promise<void> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('organization:workspace:list', {
        orgId,
        includeArchived,
      });

      if (result.success) {
        workspaces.value = result.workspaces || [];
        logger.info('[WorkspaceStore] 工作区列表加载成功', workspaces.value.length);

        // 如果当前没有选中工作区，自动选中默认工作区
        if (!currentWorkspace.value && workspaces.value.length > 0) {
          const defaultWs = defaultWorkspace.value || workspaces.value[0];
          await selectWorkspace(defaultWs.id);
        }
      } else {
        message.error(`加载工作区列表失败: ${result.error}`);
        logger.error('[WorkspaceStore] 加载工作区列表失败:', result.error);
      }
    } catch (error) {
      message.error('加载工作区列表异常');
      logger.error('[WorkspaceStore] 加载工作区列表异常:', error as any);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 创建工作区
   */
  async function createWorkspace(
    orgId: string,
    workspaceData: WorkspaceCreateData
  ): Promise<Workspace | null> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('organization:workspace:create', {
        orgId,
        workspaceData,
      });

      if (result.success) {
        message.success('工作区创建成功');
        logger.info('[WorkspaceStore] 工作区创建成功:', result.workspace);

        // 重新加载工作区列表
        await loadWorkspaces(orgId);

        // 自动选中新创建的工作区
        if (result.workspace) {
          await selectWorkspace(result.workspace.id);
        }

        return result.workspace || null;
      } else {
        message.error(`创建工作区失败: ${result.error}`);
        logger.error('[WorkspaceStore] 创建工作区失败:', result.error);
        return null;
      }
    } catch (error) {
      message.error('创建工作区异常');
      logger.error('[WorkspaceStore] 创建工作区异常:', error as any);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 更新工作区
   */
  async function updateWorkspace(
    workspaceId: string,
    updates: Partial<Workspace>
  ): Promise<boolean> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('organization:workspace:update', {
        workspaceId,
        updates,
      });

      if (result.success) {
        message.success('工作区更新成功');
        logger.info('[WorkspaceStore] 工作区更新成功');

        // 更新本地缓存
        const index = workspaces.value.findIndex((ws) => ws.id === workspaceId);
        if (index !== -1) {
          workspaces.value[index] = {
            ...workspaces.value[index],
            ...updates,
            updated_at: Date.now(),
          };
        }

        // 如果更新的是当前工作区，同步更新
        if (currentWorkspace.value?.id === workspaceId) {
          currentWorkspace.value = {
            ...currentWorkspace.value,
            ...updates,
            updated_at: Date.now(),
          };
        }

        return true;
      } else {
        message.error(`更新工作区失败: ${result.error}`);
        logger.error('[WorkspaceStore] 更新工作区失败:', result.error);
        return false;
      }
    } catch (error) {
      message.error('更新工作区异常');
      logger.error('[WorkspaceStore] 更新工作区异常:', error as any);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 删除（归档）工作区
   */
  async function deleteWorkspace(workspaceId: string): Promise<boolean> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('organization:workspace:delete', {
        workspaceId,
      });

      if (result.success) {
        message.success('工作区已归档');
        logger.info('[WorkspaceStore] 工作区归档成功');

        // 从列表中移除或标记为归档
        const workspace = workspaces.value.find((ws) => ws.id === workspaceId);
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
        logger.error('[WorkspaceStore] 归档工作区失败:', result.error);
        return false;
      }
    } catch (error) {
      message.error('归档工作区异常');
      logger.error('[WorkspaceStore] 归档工作区异常:', error as any);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 选中工作区
   */
  async function selectWorkspace(workspaceId: string): Promise<void> {
    const workspace = workspaces.value.find((ws) => ws.id === workspaceId);
    if (workspace) {
      currentWorkspace.value = workspace;
      logger.info('[WorkspaceStore] 切换到工作区:', workspace.name);

      // 加载工作区成员和资源
      await loadWorkspaceMembers(workspaceId);
      await loadWorkspaceResources(workspaceId);
    } else {
      logger.error('[WorkspaceStore] 工作区不存在:', workspaceId);
    }
  }

  /**
   * 加载工作区成员
   */
  async function loadWorkspaceMembers(workspaceId: string): Promise<void> {
    try {
      loading.value = true;
      logger.info('[WorkspaceStore] 开始加载工作区成员:', workspaceId);

      const workspace = workspaces.value.find((ws) => ws.id === workspaceId);
      if (!workspace) {
        logger.error('[WorkspaceStore] 工作区不存在:', workspaceId);
        message.error('工作区不存在');
        return;
      }

      // 获取组织成员
      const result: IpcResult = await (window as any).electronAPI.organization.getMembers(
        workspace.org_id
      );

      if (result && result.success) {
        currentWorkspaceMembers.value = result.members || [];
        logger.info(
          `[WorkspaceStore] 工作区成员加载成功: ${currentWorkspaceMembers.value.length} 个成员`
        );
      } else {
        logger.warn('[WorkspaceStore] 加载成员失败:', result?.error);
        currentWorkspaceMembers.value = [];
        message.warning('加载成员失败: ' + (result?.error || '未知错误'));
      }
    } catch (error) {
      logger.error('[WorkspaceStore] 加载工作区成员异常:', error as any);
      currentWorkspaceMembers.value = [];

      let errorMessage = '加载成员失败';
      const err = error as Error;
      if (err.message) {
        if (err.message.includes('permission')) {
          errorMessage = '没有权限查看成员列表';
        } else if (err.message.includes('not found')) {
          errorMessage = '工作区不存在';
        } else {
          errorMessage = `加载失败: ${err.message}`;
        }
      }

      message.error(errorMessage);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 加载工作区资源
   */
  async function loadWorkspaceResources(workspaceId: string): Promise<void> {
    try {
      loading.value = true;
      logger.info('[WorkspaceStore] 开始加载工作区资源:', workspaceId);

      const workspace = workspaces.value.find((ws) => ws.id === workspaceId);
      if (!workspace) {
        logger.error('[WorkspaceStore] 工作区不存在:', workspaceId);
        message.error('工作区不存在');
        return;
      }

      // 获取工作区的知识库资源
      const knowledgeResult: IpcResult = await (
        window as any
      ).electronAPI.organization.getKnowledgeItems({
        orgId: workspace.org_id,
        workspaceId: workspaceId,
      });

      // 构建资源列表
      const resources: WorkspaceResource[] = [];

      if (knowledgeResult && knowledgeResult.success) {
        const knowledgeItems = knowledgeResult.items || [];
        knowledgeItems.forEach((item: any) => {
          resources.push({
            id: item.id,
            type: 'knowledge',
            name: item.title || item.file_name,
            description: item.content?.substring(0, 100) || '无描述',
            created_at: item.created_at,
            updated_at: item.updated_at,
            creator: item.created_by,
            metadata: item,
          });
        });
      }

      currentWorkspaceResources.value = resources;
      logger.info(`[WorkspaceStore] 工作区资源加载成功: ${resources.length} 个资源`);
    } catch (error) {
      logger.error('[WorkspaceStore] 加载工作区资源异常:', error as any);
      currentWorkspaceResources.value = [];

      let errorMessage = '加载资源失败';
      const err = error as Error;
      if (err.message) {
        if (err.message.includes('permission')) {
          errorMessage = '没有权限查看资源列表';
        } else if (err.message.includes('not found')) {
          errorMessage = '工作区不存在';
        } else if (err.message.includes('timeout')) {
          errorMessage = '加载超时，请重试';
        } else {
          errorMessage = `加载失败: ${err.message}`;
        }
      }

      message.error(errorMessage);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 添加工作区成员
   */
  async function addMember(
    workspaceId: string,
    memberDID: string,
    role: MemberRole
  ): Promise<boolean> {
    try {
      const result: IpcResult = await (window as any).ipc.invoke(
        'organization:workspace:addMember',
        {
          workspaceId,
          memberDID,
          role,
        }
      );

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
      logger.error('[WorkspaceStore] 添加成员异常:', error as any);
      return false;
    }
  }

  /**
   * 移除工作区成员
   */
  async function removeMember(workspaceId: string, memberDID: string): Promise<boolean> {
    try {
      const result: IpcResult = await (window as any).ipc.invoke(
        'organization:workspace:removeMember',
        {
          workspaceId,
          memberDID,
        }
      );

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
      logger.error('[WorkspaceStore] 移除成员异常:', error as any);
      return false;
    }
  }

  /**
   * 添加资源到工作区
   */
  async function addResource(
    workspaceId: string,
    resourceType: 'knowledge' | 'project' | 'conversation',
    resourceId: string
  ): Promise<boolean> {
    try {
      const result: IpcResult = await (window as any).ipc.invoke(
        'organization:workspace:addResource',
        {
          workspaceId,
          resourceType,
          resourceId,
        }
      );

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
      logger.error('[WorkspaceStore] 添加资源异常:', error as any);
      return false;
    }
  }

  /**
   * 重置Store
   */
  function reset(): void {
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
    reset,
  };
});
