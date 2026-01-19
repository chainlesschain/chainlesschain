<template>
  <!-- 只有在有有效的身份上下文时才显示 -->
  <div
    v-if="hasValidContext"
    class="identity-switcher"
  >
    <!-- 当前身份显示 -->
    <div
      class="current-identity"
      @click="showSwitcher = true"
    >
      <a-avatar
        :src="currentIdentity.avatar"
        :size="32"
      >
        <template
          v-if="!currentIdentity.avatar"
          #icon
        >
          <UserOutlined v-if="currentIdentity.type === 'personal'" />
          <TeamOutlined v-else />
        </template>
      </a-avatar>
      <div class="identity-info">
        <div class="identity-name">
          {{ currentIdentity.displayName }}
        </div>
        <div class="identity-type">
          {{ currentIdentity.type === 'personal' ? '个人' : currentIdentity.orgName }}
        </div>
      </div>
      <SwapOutlined class="swap-icon" />
    </div>

    <!-- 身份切换对话框 -->
    <a-modal
      v-model:open="showSwitcher"
      title="切换身份"
      :footer="null"
      width="500px"
      centered
    >
      <div class="identity-list">
        <!-- 个人身份 -->
        <div
          class="identity-item"
          :class="{ active: currentContext === 'personal' }"
          @click="handleSwitch('personal')"
        >
          <a-avatar
            :src="contexts.personal.avatar"
            :size="40"
          >
            <template
              v-if="!contexts.personal.avatar"
              #icon
            >
              <UserOutlined />
            </template>
          </a-avatar>
          <div class="item-info">
            <div class="item-name">
              <UserOutlined style="margin-right: 8px" />
              个人
            </div>
            <div class="item-desc">
              私人知识库和项目
            </div>
          </div>
          <CheckCircleFilled
            v-if="currentContext === 'personal'"
            class="check-icon"
          />
        </div>

        <a-divider style="margin: 12px 0" />

        <!-- 组织身份列表 -->
        <div class="org-section-title">
          我的组织
        </div>
        <template v-if="organizationIdentities.length > 0">
          <div
            v-for="org in organizationIdentities"
            :key="org.orgId"
            class="identity-item"
            :class="{ active: currentContext === `org_${org.orgId}` }"
            @click="handleSwitch(`org_${org.orgId}`)"
          >
            <a-avatar
              :src="org.avatar"
              :size="40"
            >
              <template
                v-if="!org.avatar"
                #icon
              >
                <TeamOutlined />
              </template>
            </a-avatar>
            <div class="item-info">
              <div class="item-name">
                <TeamOutlined style="margin-right: 8px" />
                {{ org.orgName }}
              </div>
              <div class="item-desc">
                <a-tag
                  size="small"
                  :color="getRoleColor(org.role)"
                >
                  {{ getRoleLabel(org.role) }}
                </a-tag>
              </div>
            </div>
            <CheckCircleFilled
              v-if="currentContext === `org_${org.orgId}`"
              class="check-icon"
            />
          </div>
        </template>
        <a-empty
          v-else
          description="暂无组织"
          style="margin: 20px 0"
        />

        <a-divider style="margin: 12px 0" />

        <!-- 操作按钮 -->
        <div class="action-buttons">
          <a-button
            type="dashed"
            block
            style="margin-bottom: 8px"
            @click="showCreateOrg = true"
          >
            <template #icon>
              <PlusOutlined />
            </template>
            创建新组织
          </a-button>

          <a-button
            type="dashed"
            block
            @click="showJoinOrg = true"
          >
            <template #icon>
              <LinkOutlined />
            </template>
            加入组织
          </a-button>
        </div>
      </div>
    </a-modal>

    <!-- 创建组织对话框 -->
    <a-modal
      v-model:open="showCreateOrg"
      title="创建组织"
      :confirm-loading="creating"
      ok-text="创建"
      cancel-text="取消"
      @ok="handleCreateOrg"
    >
      <a-form
        :model="newOrgForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item
          label="组织名称"
          required
        >
          <a-input
            v-model:value="newOrgForm.name"
            placeholder="请输入组织名称"
          />
        </a-form-item>

        <a-form-item label="组织类型">
          <a-select v-model:value="newOrgForm.type">
            <a-select-option value="startup">
              创业团队
            </a-select-option>
            <a-select-option value="company">
              公司
            </a-select-option>
            <a-select-option value="community">
              社区
            </a-select-option>
            <a-select-option value="opensource">
              开源项目
            </a-select-option>
            <a-select-option value="education">
              教育机构
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="组织描述">
          <a-textarea
            v-model:value="newOrgForm.description"
            placeholder="简单描述一下你的组织"
            :rows="3"
          />
        </a-form-item>

        <a-form-item label="可见性">
          <a-radio-group v-model:value="newOrgForm.visibility">
            <a-radio value="private">
              私有（仅邀请）
            </a-radio>
            <a-radio value="public">
              公开
            </a-radio>
          </a-radio-group>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 加入组织对话框 -->
    <a-modal
      v-model:open="showJoinOrg"
      title="加入组织"
      :confirm-loading="joining"
      ok-text="加入"
      cancel-text="取消"
      @ok="handleJoinOrg"
    >
      <a-form
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item
          label="邀请码"
          required
        >
          <a-input
            v-model:value="inviteCode"
            placeholder="输入6位邀请码"
            :maxlength="6"
            style="text-transform: uppercase"
          />
        </a-form-item>
        <a-alert
          message="提示"
          description="请向组织管理员获取邀请码"
          type="info"
          show-icon
        />
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { message } from 'ant-design-vue';
import {
  UserOutlined,
  TeamOutlined,
  SwapOutlined,
  CheckCircleFilled,
  PlusOutlined,
  LinkOutlined
} from '@ant-design/icons-vue';
import { useIdentityStore } from '../stores/identityStore';

// ==================== Store ====================
const identityStore = useIdentityStore();

// ==================== State ====================
const showSwitcher = ref(false);
const showCreateOrg = ref(false);
const showJoinOrg = ref(false);

const creating = ref(false);
const joining = ref(false);

// 新组织表单
const newOrgForm = ref({
  name: '',
  description: '',
  type: 'startup',
  visibility: 'private'
});

// 邀请码
const inviteCode = ref('');

// ==================== Computed ====================
const currentIdentity = computed(() => {
  const ctx = identityStore.activeContext;
  if (!ctx) {return { displayName: '加载中...', type: 'personal' };}

  return {
    displayName: ctx.display_name,
    type: ctx.context_type,
    avatar: ctx.avatar,
    orgName: ctx.display_name
  };
});

const contexts = computed(() => ({
  personal: identityStore.personalContext || {}
}));

const currentContext = computed(() => identityStore.currentContextId);
const organizationIdentities = computed(() => {
  return identityStore.organizationContexts.map(ctx => ({
    orgId: ctx.org_id,
    orgName: ctx.display_name,
    avatar: ctx.avatar,
    role: 'member' // TODO: Get actual role from member data
  }));
});

// 检查是否有有效的身份上下文
const hasValidContext = computed(() => {
  return identityStore.activeContext !== null || identityStore.contexts.length > 0;
});

// ==================== Methods ====================

/**
 * 切换身份
 */
async function handleSwitch(contextId) {
  if (contextId === currentContext.value) {
    showSwitcher.value = false;
    return;
  }

  try {
    const result = await identityStore.switchContext(contextId);

    if (result.success) {
      message.success(`已切换到: ${result.context.display_name}`);
      showSwitcher.value = false;

      // 刷新页面内容
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } else {
      message.error(result.error || '切换身份失败');
    }
  } catch (error) {
    console.error('切换身份失败:', error);
    message.error(error.message || '切换身份失败');
  }
}

/**
 * 创建组织
 */
async function handleCreateOrg() {
  if (!newOrgForm.value.name.trim()) {
    message.warning('请输入组织名称');
    return;
  }

  creating.value = true;

  try {
    // 1. 创建组织
    const orgResult = await window.electron.ipcRenderer.invoke('org:create-organization', {
      name: newOrgForm.value.name,
      description: newOrgForm.value.description,
      type: newOrgForm.value.type
    });

    if (!orgResult.success) {
      throw new Error(orgResult.error || '创建组织失败');
    }

    const { organization } = orgResult;

    // 2. 创建组织身份上下文
    const contextResult = await identityStore.createOrganizationContext(
      organization.org_id,
      organization.org_did,
      organization.name,
      null
    );

    if (!contextResult.success) {
      throw new Error(contextResult.error || '创建身份上下文失败');
    }

    message.success(`组织"${newOrgForm.value.name}"创建成功！`);

    // 重置表单
    newOrgForm.value = {
      name: '',
      description: '',
      type: 'startup',
      visibility: 'private'
    };

    showCreateOrg.value = false;

    // 刷新上下文列表
    await identityStore.loadContexts();
  } catch (error) {
    console.error('创建组织失败:', error);
    message.error(error.message || '创建组织失败');
  } finally {
    creating.value = false;
  }
}

/**
 * 加入组织
 */
async function handleJoinOrg() {
  if (!inviteCode.value.trim() || inviteCode.value.length !== 6) {
    message.warning('请输入正确的6位邀请码');
    return;
  }

  joining.value = true;

  try {
    // 1. 加入组织
    const joinResult = await window.electron.ipcRenderer.invoke('org:join-organization', {
      inviteCode: inviteCode.value.toUpperCase()
    });

    if (!joinResult.success) {
      throw new Error(joinResult.error || '加入组织失败');
    }

    const { organization } = joinResult;

    // 2. 创建组织身份上下文
    const contextResult = await identityStore.createOrganizationContext(
      organization.org_id,
      organization.org_did,
      organization.name,
      organization.avatar || null
    );

    if (!contextResult.success) {
      throw new Error(contextResult.error || '创建身份上下文失败');
    }

    message.success(`成功加入组织"${organization.name}"！`);

    inviteCode.value = '';
    showJoinOrg.value = false;

    // 刷新上下文列表
    await identityStore.loadContexts();
  } catch (error) {
    console.error('加入组织失败:', error);
    message.error(error.message || '加入组织失败，请检查邀请码是否正确');
  } finally {
    joining.value = false;
  }
}

/**
 * 获取角色标签
 */
function getRoleLabel(role) {
  const labels = {
    owner: '所有者',
    admin: '管理员',
    member: '成员',
    viewer: '访客'
  };
  return labels[role] || role;
}

/**
 * 获取角色颜色
 */
function getRoleColor(role) {
  const colors = {
    owner: 'red',
    admin: 'orange',
    member: 'blue',
    viewer: 'default'
  };
  return colors[role] || 'default';
}
</script>

<style scoped lang="less">
.identity-switcher {
  .current-identity {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.3s;

    &:hover {
      background-color: rgba(0, 0, 0, 0.04);
    }

    .identity-info {
      margin-left: 12px;
      flex: 1;

      .identity-name {
        font-size: 14px;
        font-weight: 500;
        color: #1890ff;
      }

      .identity-type {
        font-size: 12px;
        color: #666;
        margin-top: 2px;
      }
    }

    .swap-icon {
      color: #999;
      font-size: 16px;
    }
  }

  .identity-list {
    .identity-item {
      display: flex;
      align-items: center;
      padding: 12px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.3s;
      margin-bottom: 8px;

      &:hover {
        background-color: #f5f5f5;
      }

      &.active {
        background-color: #e6f7ff;
        border: 1px solid #1890ff;
      }

      .item-info {
        margin-left: 12px;
        flex: 1;

        .item-name {
          font-size: 14px;
          font-weight: 500;
          color: #333;
          display: flex;
          align-items: center;
        }

        .item-desc {
          font-size: 12px;
          color: #999;
          margin-top: 4px;
        }
      }

      .check-icon {
        color: #52c41a;
        font-size: 20px;
      }
    }

    .org-section-title {
      font-size: 12px;
      color: #999;
      margin-bottom: 8px;
      font-weight: 500;
    }

    .action-buttons {
      margin-top: 12px;
    }
  }
}
</style>
