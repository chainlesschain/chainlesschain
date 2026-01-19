/**
 * 身份上下文 Store
 *
 * 管理多个身份上下文(个人、组织)的切换和状态
 *
 * @module identityStore
 */

import { logger, createLogger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useIdentityStore = defineStore('identity', () => {
  // ==================== 状态 ====================

  // 当前激活的上下文
  const activeContext = ref(null);

  // 所有可用的上下文
  const contexts = ref([]);

  // 当前用户DID
  const currentUserDID = ref(null);

  // 加载状态
  const loading = ref(false);

  // 切换中状态
  const switching = ref(false);

  // ==================== 计算属性 ====================

  /**
   * 是否在个人身份
   */
  const isPersonalContext = computed(() => {
    return activeContext.value?.context_type === 'personal';
  });

  /**
   * 是否在组织身份
   */
  const isOrganizationContext = computed(() => {
    return activeContext.value?.context_type === 'organization';
  });

  /**
   * 当前上下文ID
   */
  const currentContextId = computed(() => {
    return activeContext.value?.context_id;
  });

  /**
   * 当前组织ID
   */
  const currentOrgId = computed(() => {
    return activeContext.value?.org_id;
  });

  /**
   * 个人上下文
   */
  const personalContext = computed(() => {
    return contexts.value.find(ctx => ctx.context_type === 'personal');
  });

  /**
   * 组织上下文列表
   */
  const organizationContexts = computed(() => {
    return contexts.value.filter(ctx => ctx.context_type === 'organization');
  });

  /**
   * 上下文数量
   */
  const contextCount = computed(() => {
    return contexts.value.length;
  });

  /**
   * 是否有组织
   */
  const hasOrganizations = computed(() => {
    return organizationContexts.value.length > 0;
  });

  // ==================== 方法 ====================

  /**
   * 初始化身份上下文
   */
  async function initialize(userDID) {
    try {
      loading.value = true;
      currentUserDID.value = userDID;

      // 1. 加载所有上下文
      await loadContexts();

      // 2. 获取当前激活的上下文
      const result = await window.electron.ipcRenderer.invoke('identity:get-active-context', { userDID });

      if (result.success && result.context) {
        activeContext.value = result.context;
      } else if (result.error && result.error.includes('未初始化')) {
        // 身份上下文管理器未初始化(用户尚未创建DID),这是正常情况
        logger.info('身份上下文管理器未初始化,跳过身份上下文加载');
        return { success: true, skipped: true };
      } else {
        // 如果没有激活的上下文,创建并激活个人上下文
        await ensurePersonalContext(userDID);
      }

      return { success: true };
    } catch (error) {
      logger.error('初始化身份上下文失败:', error);
      // 不阻止应用启动,只记录错误
      return { success: true, error: error.message };
    } finally {
      loading.value = false;
    }
  }

  /**
   * 加载所有上下文
   */
  async function loadContexts() {
    try {
      const result = await window.electron.ipcRenderer.invoke('identity:get-all-contexts', {
        userDID: currentUserDID.value
      });

      if (result.success) {
        contexts.value = result.contexts || [];
      } else if (result.error && result.error.includes('未初始化')) {
        // 管理器未初始化,返回空列表
        contexts.value = [];
      }

      return result;
    } catch (error) {
      logger.error('加载上下文列表失败:', error);
      contexts.value = [];
      return { success: false, error: error.message };
    }
  }

  /**
   * 确保个人上下文存在
   */
  async function ensurePersonalContext(userDID, displayName = '个人') {
    try {
      const result = await window.electron.ipcRenderer.invoke('identity:create-personal-context', {
        userDID,
        displayName
      });

      if (result.success) {
        // 刷新上下文列表
        await loadContexts();

        // 激活个人上下文
        if (!activeContext.value) {
          await switchContext('personal');
        }
      } else if (result.error && result.error.includes('未初始化')) {
        // 管理器未初始化,跳过
        logger.info('身份上下文管理器未初始化,跳过创建个人上下文');
        return { success: true, skipped: true };
      }

      return result;
    } catch (error) {
      logger.error('创建个人上下文失败:', error);
      return { success: true, error: error.message };
    }
  }

  /**
   * 创建组织上下文
   */
  async function createOrganizationContext(orgId, orgDID, displayName, avatar = null) {
    try {
      const result = await window.electron.ipcRenderer.invoke('identity:create-organization-context', {
        userDID: currentUserDID.value,
        orgId,
        orgDID,
        displayName,
        avatar
      });

      if (result.success) {
        // 刷新上下文列表
        await loadContexts();
      }

      return result;
    } catch (error) {
      logger.error('创建组织上下文失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 切换身份上下文
   */
  async function switchContext(targetContextId) {
    try {
      if (targetContextId === currentContextId.value) {
        logger.info('已经是当前上下文');
        return { success: true, context: activeContext.value };
      }

      switching.value = true;

      const result = await window.electron.ipcRenderer.invoke('identity:switch-context', {
        userDID: currentUserDID.value,
        targetContextId
      });

      if (result.success) {
        // 更新激活的上下文
        activeContext.value = result.context;

        // 刷新上下文列表
        await loadContexts();

        logger.info(`✓ 已切换到: ${result.context.display_name}`);
      }

      return result;
    } catch (error) {
      logger.error('切换身份上下文失败:', error);
      return { success: false, error: error.message };
    } finally {
      switching.value = false;
    }
  }

  /**
   * 切换到个人身份
   */
  async function switchToPersonal() {
    return await switchContext('personal');
  }

  /**
   * 切换到组织身份
   */
  async function switchToOrganization(orgId) {
    return await switchContext(`org_${orgId}`);
  }

  /**
   * 删除组织上下文
   */
  async function deleteOrganizationContext(orgId) {
    try {
      const result = await window.electron.ipcRenderer.invoke('identity:delete-organization-context', {
        userDID: currentUserDID.value,
        orgId
      });

      if (result.success) {
        // 刷新上下文列表
        await loadContexts();
      }

      return result;
    } catch (error) {
      logger.error('删除组织上下文失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取切换历史
   */
  async function getSwitchHistory(limit = 10) {
    try {
      const result = await window.electron.ipcRenderer.invoke('identity:get-switch-history', {
        userDID: currentUserDID.value,
        limit
      });

      return result.success ? result.history : [];
    } catch (error) {
      logger.error('获取切换历史失败:', error);
      return [];
    }
  }

  /**
   * 根据上下文ID获取上下文
   */
  function getContextById(contextId) {
    return contexts.value.find(ctx => ctx.context_id === contextId);
  }

  /**
   * 刷新当前上下文
   */
  async function refreshActiveContext() {
    try {
      const result = await window.electron.ipcRenderer.invoke('identity:get-active-context', {
        userDID: currentUserDID.value
      });

      if (result.success && result.context) {
        activeContext.value = result.context;
      }

      return result;
    } catch (error) {
      logger.error('刷新当前上下文失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 重置 Store
   */
  function reset() {
    activeContext.value = null;
    contexts.value = [];
    currentUserDID.value = null;
    loading.value = false;
    switching.value = false;
  }

  // ==================== 返回 ====================

  return {
    // 状态
    activeContext,
    contexts,
    currentUserDID,
    loading,
    switching,

    // 计算属性
    isPersonalContext,
    isOrganizationContext,
    currentContextId,
    currentOrgId,
    personalContext,
    organizationContexts,
    contextCount,
    hasOrganizations,

    // 方法
    initialize,
    loadContexts,
    ensurePersonalContext,
    createOrganizationContext,
    switchContext,
    switchToPersonal,
    switchToOrganization,
    deleteOrganizationContext,
    getSwitchHistory,
    getContextById,
    refreshActiveContext,
    reset
  };
});
