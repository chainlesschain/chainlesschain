<template>
  <div class="organization-settings">
    <!-- 顶部导航 -->
    <a-page-header
      title="组织设置"
      :subtitle="organizationName"
      @back="handleBack"
    >
      <template #extra>
        <a-space>
          <a-button @click="handleRefresh">
            <template #icon><ReloadOutlined /></template>
            刷新
          </a-button>
          <a-button type="primary" @click="handleSave" :loading="saving">
            <template #icon><SaveOutlined /></template>
            保存更改
          </a-button>
        </a-space>
      </template>
    </a-page-header>

    <a-spin :spinning="loading" tip="加载中...">
      <div class="settings-container">
        <!-- 左侧菜单 -->
        <a-menu
          v-model:selectedKeys="selectedKeys"
          mode="inline"
          class="settings-menu"
        >
          <a-menu-item key="basic">
            <template #icon><InfoCircleOutlined /></template>
            基本信息
          </a-menu-item>
          <a-menu-item key="members">
            <template #icon><TeamOutlined /></template>
            成员管理
            <a-badge :count="memberCount" :offset="[10, 0]" />
          </a-menu-item>
          <a-menu-item key="invitations">
            <template #icon><MailOutlined /></template>
            邀请管理
            <a-badge :count="activeInvitationCount" :offset="[10, 0]" />
          </a-menu-item>
          <a-menu-item key="roles">
            <template #icon><SafetyOutlined /></template>
            角色权限
          </a-menu-item>
          <a-menu-item key="advanced">
            <template #icon><SettingOutlined /></template>
            高级设置
          </a-menu-item>
          <a-menu-item key="danger" class="danger-menu-item">
            <template #icon><WarningOutlined /></template>
            危险操作
          </a-menu-item>
        </a-menu>

        <!-- 右侧内容 -->
        <div class="settings-content">
          <!-- 基本信息 -->
          <div v-if="selectedKeys[0] === 'basic'" class="settings-section">
            <h2>基本信息</h2>
            <a-form
              :model="formData"
              :label-col="{ span: 4 }"
              :wrapper-col="{ span: 16 }"
            >
              <a-form-item label="组织名称">
                <a-input
                  v-model:value="formData.name"
                  placeholder="请输入组织名称"
                  :disabled="!canManageOrg"
                />
              </a-form-item>

              <a-form-item label="组织类型">
                <a-select
                  v-model:value="formData.type"
                  :disabled="!canManageOrg"
                >
                  <a-select-option value="startup">创业团队</a-select-option>
                  <a-select-option value="company">公司</a-select-option>
                  <a-select-option value="community">社区</a-select-option>
                  <a-select-option value="opensource">开源项目</a-select-option>
                  <a-select-option value="education">教育机构</a-select-option>
                </a-select>
              </a-form-item>

              <a-form-item label="组织描述">
                <a-textarea
                  v-model:value="formData.description"
                  :rows="4"
                  placeholder="简单描述一下你的组织"
                  :disabled="!canManageOrg"
                />
              </a-form-item>

              <a-form-item label="组织DID">
                <a-input :value="orgData?.org_did" disabled>
                  <template #suffix>
                    <a-tooltip title="复制DID">
                      <CopyOutlined
                        @click="copyToClipboard(orgData?.org_did)"
                        style="cursor: pointer"
                      />
                    </a-tooltip>
                  </template>
                </a-input>
              </a-form-item>

              <a-form-item label="创建时间">
                <span>{{ formatDate(orgData?.created_at) }}</span>
              </a-form-item>

              <a-form-item label="成员数量">
                <span>{{ memberCount }} 人</span>
              </a-form-item>
            </a-form>
          </div>

          <!-- 成员管理 -->
          <div v-if="selectedKeys[0] === 'members'" class="settings-section">
            <organization-members-page :org-id="orgId" />
          </div>

          <!-- 邀请管理 -->
          <div v-if="selectedKeys[0] === 'invitations'" class="settings-section">
            <invitation-manager :org-id="orgId" />
          </div>

          <!-- 角色权限 -->
          <div v-if="selectedKeys[0] === 'roles'" class="settings-section">
            <h2>角色权限</h2>
            <a-table
              :columns="roleColumns"
              :data-source="roles"
              :pagination="false"
              row-key="role_name"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'permissions'">
                  <a-space wrap>
                    <a-tag
                      v-for="perm in getPermissionTags(record.permissions)"
                      :key="perm"
                      color="blue"
                    >
                      {{ perm }}
                    </a-tag>
                  </a-space>
                </template>
                <template v-if="column.key === 'actions'">
                  <a-button
                    v-if="!record.is_builtin"
                    type="link"
                    danger
                    @click="handleDeleteRole(record)"
                  >
                    删除
                  </a-button>
                  <span v-else style="color: #999">内置角色</span>
                </template>
              </template>
            </a-table>

            <a-button
              type="dashed"
              block
              @click="showCreateRoleModal = true"
              style="margin-top: 16px"
              :disabled="!canManageRoles"
            >
              <template #icon><PlusOutlined /></template>
              创建自定义角色
            </a-button>
          </div>

          <!-- 高级设置 -->
          <div v-if="selectedKeys[0] === 'advanced'" class="settings-section">
            <h2>高级设置</h2>
            <a-form :label-col="{ span: 4 }" :wrapper-col="{ span: 16 }">
              <a-form-item label="可见性">
                <a-radio-group
                  v-model:value="formData.visibility"
                  :disabled="!canManageOrg"
                >
                  <a-radio value="private">私有（仅邀请）</a-radio>
                  <a-radio value="public">公开</a-radio>
                </a-radio-group>
                <div style="color: #999; margin-top: 8px">
                  {{ formData.visibility === 'private' ? '只有受邀请的成员才能加入' : '任何人都可以通过邀请码加入' }}
                </div>
              </a-form-item>

              <a-form-item label="P2P网络">
                <a-switch
                  v-model:checked="formData.p2pEnabled"
                  :disabled="!canManageOrg"
                />
                <div style="color: #999; margin-top: 8px">
                  启用P2P去中心化网络进行数据同步
                </div>
              </a-form-item>

              <a-form-item label="数据同步">
                <a-select
                  v-model:value="formData.syncMode"
                  :disabled="!canManageOrg"
                >
                  <a-select-option value="auto">自动同步</a-select-option>
                  <a-select-option value="manual">手动同步</a-select-option>
                  <a-select-option value="off">关闭同步</a-select-option>
                </a-select>
              </a-form-item>
            </a-form>
          </div>

          <!-- 危险操作 -->
          <div v-if="selectedKeys[0] === 'danger'" class="settings-section">
            <h2>危险操作</h2>
            <a-alert
              message="警告"
              description="以下操作不可逆，请谨慎操作"
              type="warning"
              show-icon
              style="margin-bottom: 24px"
            />

            <a-space direction="vertical" style="width: 100%" :size="16">
              <!-- 离开组织 -->
              <a-card title="离开组织">
                <p>您将失去对该组织的访问权限，但组织数据将保留。</p>
                <a-button danger @click="handleLeaveOrganization">
                  离开组织
                </a-button>
              </a-card>

              <!-- 删除组织 -->
              <a-card
                title="删除组织"
                v-if="isOwner"
              >
                <p style="color: #f5222d">
                  <strong>警告：</strong>
                  删除组织将永久删除所有数据，包括成员、项目、知识库等。此操作无法撤销！
                </p>
                <a-button danger type="primary" @click="handleDeleteOrganization">
                  永久删除组织
                </a-button>
              </a-card>
            </a-space>
          </div>
        </div>
      </div>
    </a-spin>

    <!-- 创建自定义角色对话框 -->
    <a-modal
      v-model:open="showCreateRoleModal"
      title="创建自定义角色"
      @ok="handleCreateRole"
      :confirm-loading="creatingRole"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="角色名称" required>
          <a-input
            v-model:value="newRole.name"
            placeholder="例如：编辑者"
          />
        </a-form-item>

        <a-form-item label="角色描述">
          <a-textarea
            v-model:value="newRole.description"
            :rows="3"
            placeholder="描述这个角色的职责"
          />
        </a-form-item>

        <a-form-item label="权限">
          <a-checkbox-group v-model:value="newRole.permissions">
            <a-row>
              <a-col :span="24" v-for="perm in availablePermissions" :key="perm.value">
                <a-checkbox :value="perm.value">
                  {{ perm.label }}
                </a-checkbox>
              </a-col>
            </a-row>
          </a-checkbox-group>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { message } from 'ant-design-vue';
import { useRoute, useRouter } from 'vue-router';
import { useIdentityStore } from '@/stores/identityStore';
import {
  InfoCircleOutlined,
  TeamOutlined,
  MailOutlined,
  SafetyOutlined,
  SettingOutlined,
  WarningOutlined,
  ReloadOutlined,
  SaveOutlined,
  CopyOutlined,
  PlusOutlined
} from '@ant-design/icons-vue';
import OrganizationMembersPage from './OrganizationMembersPage.vue';
import InvitationManager from '@/components/InvitationManager.vue';

// ==================== Setup ====================
const route = useRoute();
const router = useRouter();
const identityStore = useIdentityStore();

const orgId = computed(() => route.params.orgId || identityStore.currentOrgId);

// ==================== State ====================
const loading = ref(false);
const saving = ref(false);
const selectedKeys = ref(['basic']);

const orgData = ref(null);
const members = ref([]);
const roles = ref([]);
const invitations = ref([]);

const formData = reactive({
  name: '',
  type: 'startup',
  description: '',
  visibility: 'private',
  p2pEnabled: true,
  syncMode: 'auto'
});

const showCreateRoleModal = ref(false);
const creatingRole = ref(false);
const newRole = reactive({
  name: '',
  description: '',
  permissions: []
});

// ==================== Computed ====================
const organizationName = computed(() => orgData.value?.name || '加载中...');
const memberCount = computed(() => members.value.length);
const activeInvitationCount = computed(() => {
  return invitations.value.filter(inv => inv.status === 'pending').length;
});

const currentUserRole = computed(() => {
  if (!orgData.value || !identityStore.currentUserDID) return 'viewer';
  const member = members.value.find(
    m => m.member_did === identityStore.currentUserDID
  );
  return member?.role || 'viewer';
});

const isOwner = computed(() => currentUserRole.value === 'owner');
const canManageOrg = computed(() => ['owner', 'admin'].includes(currentUserRole.value));
const canManageRoles = computed(() => ['owner', 'admin'].includes(currentUserRole.value));

const roleColumns = [
  { title: '角色名称', dataIndex: 'role_name', key: 'role_name' },
  { title: '描述', dataIndex: 'description', key: 'description' },
  { title: '权限', key: 'permissions' },
  { title: '类型', dataIndex: 'is_builtin', key: 'is_builtin',
    customRender: ({ text }) => text ? '内置' : '自定义'
  },
  { title: '操作', key: 'actions', width: 120 }
];

const availablePermissions = [
  { label: '管理组织', value: 'org.manage' },
  { label: '管理成员', value: 'member.manage' },
  { label: '管理角色', value: 'role.manage' },
  { label: '管理邀请', value: 'invitation.manage' },
  { label: '创建知识', value: 'knowledge.create' },
  { label: '阅读知识', value: 'knowledge.read' },
  { label: '编辑知识', value: 'knowledge.write' },
  { label: '删除知识', value: 'knowledge.delete' },
  { label: '创建项目', value: 'project.create' },
  { label: '阅读项目', value: 'project.read' },
  { label: '编辑项目', value: 'project.write' },
  { label: '删除项目', value: 'project.delete' }
];

// ==================== Methods ====================

/**
 * 加载组织数据
 */
async function loadOrganizationData() {
  try {
    loading.value = true;

    // 1. 获取组织信息
    const orgResult = await window.electron.ipcRenderer.invoke('org:get-organization', orgId.value);
    if (orgResult.success) {
      orgData.value = orgResult.organization;

      // 填充表单
      formData.name = orgData.value.name;
      formData.type = orgData.value.type || 'startup';
      formData.description = orgData.value.description || '';
      formData.visibility = orgData.value.visibility || 'private';
      formData.p2pEnabled = orgData.value.p2p_enabled !== 0;
      formData.syncMode = orgData.value.sync_mode || 'auto';
    }

    // 2. 获取成员列表
    const membersResult = await window.electron.ipcRenderer.invoke('org:get-members', orgId.value);
    if (membersResult.success) {
      members.value = membersResult.members;
    }

    // 3. 获取角色列表
    const rolesResult = await window.electron.ipcRenderer.invoke('org:get-roles', orgId.value);
    if (rolesResult.success) {
      roles.value = rolesResult.roles;
    }

    // 4. 获取邀请列表
    const invitationsResult = await window.electron.ipcRenderer.invoke('org:get-invitations', orgId.value);
    if (invitationsResult.success) {
      invitations.value = invitationsResult.invitations;
    }

  } catch (error) {
    console.error('加载组织数据失败:', error);
    message.error('加载组织数据失败');
  } finally {
    loading.value = false;
  }
}

/**
 * 保存更改
 */
async function handleSave() {
  if (!canManageOrg.value) {
    message.warning('您没有权限修改组织设置');
    return;
  }

  try {
    saving.value = true;

    const result = await window.electron.ipcRenderer.invoke('org:update-organization', {
      orgId: orgId.value,
      name: formData.name,
      type: formData.type,
      description: formData.description,
      visibility: formData.visibility,
      p2pEnabled: formData.p2pEnabled,
      syncMode: formData.syncMode
    });

    if (result.success) {
      message.success('保存成功');
      await loadOrganizationData();
    } else {
      message.error(result.error || '保存失败');
    }
  } catch (error) {
    console.error('保存失败:', error);
    message.error('保存失败');
  } finally {
    saving.value = false;
  }
}

/**
 * 刷新数据
 */
async function handleRefresh() {
  await loadOrganizationData();
  message.success('刷新成功');
}

/**
 * 返回
 */
function handleBack() {
  router.back();
}

/**
 * 复制到剪贴板
 */
function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
  message.success('已复制到剪贴板');
}

/**
 * 格式化日期
 */
function formatDate(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

/**
 * 获取权限标签
 */
function getPermissionTags(permissions) {
  if (!permissions) return [];

  try {
    const perms = JSON.parse(permissions);
    if (perms.includes('*')) return ['全部权限'];
    return perms.slice(0, 5); // 只显示前5个
  } catch {
    return [];
  }
}

/**
 * 创建自定义角色
 */
async function handleCreateRole() {
  if (!newRole.name.trim()) {
    message.warning('请输入角色名称');
    return;
  }

  try {
    creatingRole.value = true;

    const result = await window.electron.ipcRenderer.invoke('org:create-custom-role', {
      orgId: orgId.value,
      roleName: newRole.name,
      description: newRole.description,
      permissions: newRole.permissions
    });

    if (result.success) {
      message.success('角色创建成功');
      showCreateRoleModal.value = false;

      // 重置表单
      newRole.name = '';
      newRole.description = '';
      newRole.permissions = [];

      // 刷新角色列表
      await loadOrganizationData();
    } else {
      message.error(result.error || '创建失败');
    }
  } catch (error) {
    console.error('创建角色失败:', error);
    message.error('创建角色失败');
  } finally {
    creatingRole.value = false;
  }
}

/**
 * 删除角色
 */
async function handleDeleteRole(role) {
  // 确认删除
  const confirmed = await new Promise(resolve => {
    message.confirm({
      title: '确认删除',
      content: `确定要删除角色"${role.role_name}"吗？`,
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    });
  });

  if (!confirmed) return;

  try {
    const result = await window.electron.ipcRenderer.invoke('org:delete-role', {
      orgId: orgId.value,
      roleName: role.role_name
    });

    if (result.success) {
      message.success('角色删除成功');
      await loadOrganizationData();
    } else {
      message.error(result.error || '删除失败');
    }
  } catch (error) {
    console.error('删除角色失败:', error);
    message.error('删除角色失败');
  }
}

/**
 * 离开组织
 */
async function handleLeaveOrganization() {
  if (isOwner.value) {
    message.warning('所有者无法离开组织，请先转让所有权或删除组织');
    return;
  }

  // 确认离开
  const confirmed = await new Promise(resolve => {
    message.confirm({
      title: '确认离开',
      content: '确定要离开该组织吗？您将失去访问权限。',
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    });
  });

  if (!confirmed) return;

  try {
    const result = await window.electron.ipcRenderer.invoke('org:leave-organization', {
      orgId: orgId.value,
      userDID: identityStore.currentUserDID
    });

    if (result.success) {
      message.success('已离开组织');

      // 切换回个人身份
      await identityStore.switchToPersonal();

      // 跳转回首页
      router.push('/');
    } else {
      message.error(result.error || '离开失败');
    }
  } catch (error) {
    console.error('离开组织失败:', error);
    message.error('离开组织失败');
  }
}

/**
 * 删除组织
 */
async function handleDeleteOrganization() {
  // 二次确认
  const confirmed = await new Promise(resolve => {
    message.confirm({
      title: '永久删除组织',
      content: (
        <div>
          <p style="color: #f5222d; font-weight: bold">
            此操作无法撤销！
          </p>
          <p>将永久删除：</p>
          <ul>
            <li>组织数据库</li>
            <li>所有成员关系</li>
            <li>所有项目和知识库</li>
            <li>所有邀请记录</li>
          </ul>
          <p>请输入组织名称"<strong>{orgData.value?.name}</strong>"确认删除：</p>
          <a-input id="confirm-input" placeholder="输入组织名称" />
        </div>
      ),
      onOk: () => {
        const input = document.getElementById('confirm-input');
        if (input.value === orgData.value?.name) {
          resolve(true);
        } else {
          message.error('组织名称不匹配');
          resolve(false);
        }
      },
      onCancel: () => resolve(false)
    });
  });

  if (!confirmed) return;

  try {
    const result = await window.electron.ipcRenderer.invoke('org:delete-organization', {
      orgId: orgId.value,
      userDID: identityStore.currentUserDID
    });

    if (result.success) {
      message.success('组织已删除');

      // 切换回个人身份
      await identityStore.switchToPersonal();

      // 跳转回首页
      router.push('/');
    } else {
      message.error(result.error || '删除失败');
    }
  } catch (error) {
    console.error('删除组织失败:', error);
    message.error('删除组织失败');
  }
}

// ==================== Lifecycle ====================
onMounted(async () => {
  await loadOrganizationData();
});

// 监听组织ID变化
watch(() => orgId.value, async (newOrgId) => {
  if (newOrgId) {
    await loadOrganizationData();
  }
});
</script>

<style scoped lang="less">
.organization-settings {
  height: 100%;
  display: flex;
  flex-direction: column;

  .settings-container {
    display: flex;
    flex: 1;
    overflow: hidden;

    .settings-menu {
      width: 200px;
      border-right: 1px solid #f0f0f0;
      overflow-y: auto;

      .danger-menu-item {
        color: #f5222d;
      }
    }

    .settings-content {
      flex: 1;
      padding: 24px;
      overflow-y: auto;

      .settings-section {
        max-width: 800px;

        h2 {
          margin-bottom: 24px;
          font-size: 20px;
          font-weight: 600;
        }
      }
    }
  }
}
</style>
