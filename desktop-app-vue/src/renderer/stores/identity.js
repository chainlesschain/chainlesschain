import { logger, createLogger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

/**
 * 身份管理Store - 企业版多身份切换
 * 负责管理个人身份和组织身份的切换
 */
export const useIdentityStore = defineStore('identity', () => {
  // ==================== State ====================

  // 用户主DID
  const primaryDID = ref(null);

  // 当前激活的身份上下文
  const currentContext = ref('personal'); // 默认个人身份

  // 所有身份上下文
  const contexts = ref({
    personal: {
      type: 'personal',
      displayName: '个人',
      avatar: '',
      localDB: 'data/personal.db'
    }
    // 组织身份动态添加
  });

  // 用户所属组织列表
  const organizations = ref([]);

  // 加载状态
  const loading = ref(false);

  // ==================== Getters ====================

  /**
   * 获取当前身份信息
   */
  const currentIdentity = computed(() => {
    return contexts.value[currentContext.value] || contexts.value.personal;
  });

  /**
   * 获取所有组织身份
   */
  const organizationIdentities = computed(() => {
    return Object.values(contexts.value).filter(ctx => ctx.type === 'organization');
  });

  /**
   * 是否是组织身份
   */
  const isOrganizationContext = computed(() => {
    return currentIdentity.value.type === 'organization';
  });

  /**
   * 当前组织ID（如果是组织身份）
   */
  const currentOrgId = computed(() => {
    if (isOrganizationContext.value) {
      return currentIdentity.value.orgId;
    }
    return null;
  });

  // ==================== Actions ====================

  /**
   * 初始化身份Store
   */
  async function initialize() {
    loading.value = true;

    try {
      // 1. 获取当前用户DID
      const identity = await window.ipc.invoke('did:get-current-identity');
      if (identity) {
        primaryDID.value = identity.did;

        // 更新个人身份信息
        contexts.value.personal = {
          type: 'personal',
          displayName: identity.displayName || '个人',
          avatar: identity.avatar || '',
          localDB: 'data/personal.db'
        };
      }

      // 2. 加载用户所属的组织
      if (primaryDID.value) {
        await loadUserOrganizations();
      }

      // 3. 加载身份上下文（从数据库）
      // TODO: 从identity-contexts表加载已保存的上下文

      logger.info('[IdentityStore] 身份Store初始化成功');
    } catch (error) {
      logger.error('[IdentityStore] 初始化失败:', error);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 加载用户所属的组织
   */
  async function loadUserOrganizations() {
    if (!primaryDID.value) {
      logger.warn('[IdentityStore] 未设置主DID，跳过加载组织');
      return;
    }

    try {
      const orgs = await window.ipc.invoke('org:get-user-organizations', primaryDID.value);
      organizations.value = orgs;

      // 为每个组织创建身份上下文
      orgs.forEach(org => {
        const contextId = `org_${org.orgId}`;
        contexts.value[contextId] = {
          type: 'organization',
          orgId: org.orgId,
          orgName: org.name,
          role: org.role,
          displayName: `${contexts.value.personal.displayName || '我'}@${org.name}`,
          avatar: org.avatar || '',
          localDB: `data/${org.orgId}.db`
        };
      });

      logger.info('[IdentityStore] 加载了', orgs.length, '个组织');
    } catch (error) {
      logger.error('[IdentityStore] 加载组织失败:', error);
    }
  }

  /**
   * 切换身份上下文
   * @param {string} contextId - 身份上下文ID ('personal' 或 'org_xxx')
   */
  async function switchContext(contextId) {
    if (!contexts.value[contextId]) {
      throw new Error(`身份上下文不存在: ${contextId}`);
    }

    if (currentContext.value === contextId) {
      logger.info('[IdentityStore] 已经是当前身份，无需切换');
      return;
    }

    loading.value = true;

    try {
      logger.info('[IdentityStore] 切换身份:', contextId);

      // 1. 保存当前上下文状态
      await saveCurrentContext();

      // 2. 切换数据库文件
      logger.info('[IdentityStore] 切换数据库到:', contextId);
      const result = await window.ipc.invoke('db:switch-database', contextId);
      logger.info('[IdentityStore] 数据库切换结果:', result);

      // 3. 切换上下文
      currentContext.value = contextId;

      // 4. 更新P2P网络身份
      // TODO: 更新P2P网络的身份信息
      // if (window.ipc) {
      //   await window.ipc.invoke('p2p:update-identity', contextId);
      // }

      // 5. 保存身份切换记录
      await saveContextSwitch(contextId);

      logger.info('[IdentityStore] ✓ 身份切换成功:', contexts.value[contextId].displayName);

      // 刷新页面以加载新身份的数据
      window.location.reload();
    } catch (error) {
      logger.error('[IdentityStore] 切换身份失败:', error);
      throw error;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 创建组织并添加到身份列表
   * @param {Object} orgData - 组织数据
   * @returns {Promise<Object>} 创建的组织信息
   */
  async function createOrganization(orgData) {
    loading.value = true;

    try {
      logger.info('[IdentityStore] 创建组织:', orgData.name);

      // 1. 调用后端创建组织
      const org = await window.ipc.invoke('org:create-organization', orgData);

      // 2. 添加到组织列表
      organizations.value.push({
        orgId: org.org_id,
        name: org.name,
        description: org.description,
        type: org.type,
        avatar: org.avatar,
        role: 'owner', // 创建者是owner
        joinedAt: org.created_at
      });

      // 3. 创建组织身份上下文
      const contextId = `org_${org.org_id}`;
      contexts.value[contextId] = {
        type: 'organization',
        orgId: org.org_id,
        orgName: org.name,
        role: 'owner',
        displayName: `${contexts.value.personal.displayName || '我'}@${org.name}`,
        avatar: org.avatar || '',
        localDB: `data/${org.org_id}.db`
      };

      logger.info('[IdentityStore] ✓ 组织创建成功:', org.org_id);

      return org;
    } catch (error) {
      logger.error('[IdentityStore] 创建组织失败:', error);
      throw error;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 加入组织
   * @param {string} inviteCode - 邀请码
   * @returns {Promise<Object>} 加入的组织信息
   */
  async function joinOrganization(inviteCode) {
    loading.value = true;

    try {
      logger.info('[IdentityStore] 通过邀请码加入组织:', inviteCode);

      // 1. 调用后端加入组织
      const org = await window.ipc.invoke('org:join-organization', inviteCode);

      // 2. 重新加载组织列表
      await loadUserOrganizations();

      logger.info('[IdentityStore] ✓ 成功加入组织:', org.org_id);

      return org;
    } catch (error) {
      logger.error('[IdentityStore] 加入组织失败:', error);
      throw error;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 离开组织
   * @param {string} orgId - 组织ID
   */
  async function leaveOrganization(orgId) {
    if (!primaryDID.value) {
      throw new Error('未找到用户DID');
    }

    loading.value = true;

    try {
      logger.info('[IdentityStore] 离开组织:', orgId);

      // 1. 调用后端离开组织
      await window.ipc.invoke('org:leave-organization', orgId, primaryDID.value);

      // 2. 从列表中移除
      organizations.value = organizations.value.filter(org => org.orgId !== orgId);

      // 3. 移除身份上下文
      const contextId = `org_${orgId}`;
      delete contexts.value[contextId];

      // 4. 如果当前是该组织身份，切换回个人身份
      if (currentContext.value === contextId) {
        await switchContext('personal');
      }

      logger.info('[IdentityStore] ✓ 已离开组织:', orgId);
    } catch (error) {
      logger.error('[IdentityStore] 离开组织失败:', error);
      throw error;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 保存当前上下文状态
   */
  async function saveCurrentContext() {
    // TODO: 保存到identity-contexts表
    logger.info('[IdentityStore] 保存当前上下文:', currentContext.value);
  }

  /**
   * 保存身份切换记录
   * @param {string} contextId - 新的上下文ID
   */
  async function saveContextSwitch(contextId) {
    // TODO: 保存到数据库，记录切换时间
    logger.info('[IdentityStore] 记录身份切换:', contextId);
  }

  /**
   * 获取组织信息
   * @param {string} orgId - 组织ID
   */
  async function getOrganization(orgId) {
    try {
      return await window.ipc.invoke('org:get-organization', orgId);
    } catch (error) {
      logger.error('[IdentityStore] 获取组织信息失败:', error);
      return null;
    }
  }

  /**
   * 获取组织成员列表
   * @param {string} orgId - 组织ID
   */
  async function getOrganizationMembers(orgId) {
    try {
      return await window.ipc.invoke('org:get-members', orgId);
    } catch (error) {
      logger.error('[IdentityStore] 获取成员列表失败:', error);
      return [];
    }
  }

  /**
   * 检查权限
   * @param {string} permission - 权限字符串
   * @returns {Promise<boolean>}
   */
  async function checkPermission(permission) {
    if (!isOrganizationContext.value || !primaryDID.value) {
      return false; // 个人身份或未登录，无组织权限
    }

    try {
      return await window.ipc.invoke(
        'org:check-permission',
        currentOrgId.value,
        primaryDID.value,
        permission
      );
    } catch (error) {
      logger.error('[IdentityStore] 检查权限失败:', error);
      return false;
    }
  }

  /**
   * 创建邀请
   * @param {Object} inviteData - 邀请数据
   * @returns {Promise<Object>} 邀请信息
   */
  async function createInvitation(inviteData) {
    if (!isOrganizationContext.value || !primaryDID.value) {
      throw new Error('需要在组织身份下创建邀请');
    }

    try {
      return await window.ipc.invoke('org:create-invitation', currentOrgId.value, {
        ...inviteData,
        invitedBy: primaryDID.value
      });
    } catch (error) {
      logger.error('[IdentityStore] 创建邀请失败:', error);
      throw error;
    }
  }

  // ==================== Return ====================

  return {
    // State
    primaryDID,
    currentContext,
    contexts,
    organizations,
    loading,

    // Getters
    currentIdentity,
    organizationIdentities,
    isOrganizationContext,
    currentOrgId,

    // Actions
    initialize,
    loadUserOrganizations,
    switchContext,
    createOrganization,
    joinOrganization,
    leaveOrganization,
    getOrganization,
    getOrganizationMembers,
    checkPermission,
    createInvitation
  };
});
