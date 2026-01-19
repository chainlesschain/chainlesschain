<template>
  <div class="organization-settings-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <SettingOutlined class="page-icon" />
        <h2>组织设置</h2>
      </div>
      <div class="header-right">
        <a-button
          v-if="canManageOrg"
          type="primary"
          danger
          @click="showDeleteOrgModal = true"
        >
          <template #icon>
            <DeleteOutlined />
          </template>
          删除组织
        </a-button>
      </div>
    </div>

    <!-- 设置内容 -->
    <div class="settings-content">
      <!-- 基本信息 -->
      <a-card
        title="基本信息"
        class="settings-card"
      >
        <a-form
          :model="orgForm"
          layout="vertical"
        >
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item
                label="组织名称"
                required
              >
                <a-input
                  v-model:value="orgForm.name"
                  placeholder="输入组织名称"
                  :disabled="!canManageOrg"
                />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="组织类型">
                <a-select
                  v-model:value="orgForm.type"
                  :disabled="!canManageOrg"
                >
                  <a-select-option value="startup">
                    初创公司
                  </a-select-option>
                  <a-select-option value="company">
                    企业
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
            </a-col>
          </a-row>

          <a-form-item label="组织描述">
            <a-textarea
              v-model:value="orgForm.description"
              :rows="4"
              placeholder="描述您的组织"
              :disabled="!canManageOrg"
            />
          </a-form-item>

          <a-form-item label="组织头像">
            <div class="avatar-upload">
              <a-avatar
                :src="orgForm.avatar"
                :size="80"
              >
                <template
                  v-if="!orgForm.avatar"
                  #icon
                >
                  <TeamOutlined />
                </template>
              </a-avatar>
              <a-upload
                v-if="canManageOrg"
                :show-upload-list="false"
                :before-upload="handleAvatarUpload"
                accept="image/*"
              >
                <a-button style="margin-left: 16px">
                  <UploadOutlined />
                  上传头像
                </a-button>
              </a-upload>
            </div>
          </a-form-item>

          <a-form-item v-if="canManageOrg">
            <a-space>
              <a-button
                type="primary"
                :loading="saving"
                @click="handleSaveBasicInfo"
              >
                保存更改
              </a-button>
              <a-button @click="loadOrganizationInfo">
                取消
              </a-button>
            </a-space>
          </a-form-item>
        </a-form>
      </a-card>

      <!-- 组织信息 -->
      <a-card
        title="组织信息"
        class="settings-card"
      >
        <a-descriptions
          :column="2"
          bordered
        >
          <a-descriptions-item label="组织ID">
            {{ currentOrgInfo?.org_id }}
          </a-descriptions-item>
          <a-descriptions-item label="组织DID">
            <a-typography-paragraph
              :copyable="{ text: currentOrgInfo?.org_did }"
              style="margin: 0"
            >
              {{ formatDID(currentOrgInfo?.org_did) }}
            </a-typography-paragraph>
          </a-descriptions-item>
          <a-descriptions-item label="所有者">
            {{ formatDID(currentOrgInfo?.owner_did) }}
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">
            {{ formatDate(currentOrgInfo?.created_at) }}
          </a-descriptions-item>
          <a-descriptions-item label="成员数量">
            {{ memberCount }} 人
          </a-descriptions-item>
          <a-descriptions-item label="最后更新">
            {{ formatDate(currentOrgInfo?.updated_at) }}
          </a-descriptions-item>
        </a-descriptions>
      </a-card>

      <!-- 权限设置 -->
      <a-card
        title="权限设置"
        class="settings-card"
      >
        <a-form layout="vertical">
          <!-- 角色管理快捷入口 -->
          <a-alert
            message="角色与权限管理"
            description="管理组织中的角色和权限配置，包括创建自定义角色、分配权限等"
            type="info"
            show-icon
            style="margin-bottom: 24px"
          >
            <template #action>
              <a-button
                type="primary"
                size="small"
                @click="handleGoToRolesPage"
              >
                <SafetyCertificateOutlined /> 管理角色
              </a-button>
            </template>
          </a-alert>

          <a-form-item>
            <template #label>
              <span>可见性</span>
              <a-tooltip title="公开组织可被其他用户发现和搜索">
                <QuestionCircleOutlined style="margin-left: 4px" />
              </a-tooltip>
            </template>
            <a-radio-group
              v-model:value="settingsForm.visibility"
              :disabled="!canManageOrg"
            >
              <a-radio value="private">
                私有 - 仅邀请加入
              </a-radio>
              <a-radio value="public">
                公开 - 可被搜索和发现
              </a-radio>
            </a-radio-group>
          </a-form-item>

          <a-form-item>
            <template #label>
              <span>最大成员数</span>
            </template>
            <a-input-number
              v-model:value="settingsForm.maxMembers"
              :min="1"
              :max="10000"
              style="width: 200px"
              :disabled="!canManageOrg"
            />
          </a-form-item>

          <a-form-item>
            <a-checkbox
              v-model:checked="settingsForm.allowMemberInvite"
              :disabled="!canManageOrg"
            >
              允许普通成员邀请新成员
            </a-checkbox>
          </a-form-item>

          <a-form-item label="新成员默认角色">
            <a-select
              v-model:value="settingsForm.defaultMemberRole"
              style="width: 200px"
              :disabled="!canManageOrg"
            >
              <a-select-option value="member">
                成员
              </a-select-option>
              <a-select-option value="viewer">
                访客
              </a-select-option>
            </a-select>
          </a-form-item>

          <a-form-item v-if="canManageOrg">
            <a-space>
              <a-button
                type="primary"
                :loading="saving"
                @click="handleSaveSettings"
              >
                保存设置
              </a-button>
              <a-button @click="loadOrganizationInfo">
                取消
              </a-button>
            </a-space>
          </a-form-item>
        </a-form>
      </a-card>

      <!-- 数据与同步 -->
      <a-card
        title="数据与同步"
        class="settings-card"
      >
        <a-space
          direction="vertical"
          style="width: 100%"
          :size="16"
        >
          <div class="info-item">
            <div class="item-label">
              <CloudSyncOutlined class="item-icon" />
              P2P 网络同步
            </div>
            <div class="item-content">
              <a-switch
                v-model:checked="syncForm.p2pEnabled"
                :disabled="!canManageOrg"
              />
              <span style="margin-left: 8px; color: #8c8c8c">
                {{ syncForm.p2pEnabled ? '已启用' : '已禁用' }}
              </span>
            </div>
          </div>

          <div class="info-item">
            <div class="item-label">
              <DatabaseOutlined class="item-icon" />
              数据库路径
            </div>
            <div class="item-content">
              <a-typography-text code>
                {{ databasePath }}
              </a-typography-text>
            </div>
          </div>

          <div class="info-item">
            <div class="item-label">
              <SafetyOutlined class="item-icon" />
              数据加密
            </div>
            <div class="item-content">
              <a-tag color="green">
                <CheckCircleOutlined />
                已启用 AES-256 加密
              </a-tag>
            </div>
          </div>

          <a-divider />

          <a-space>
            <a-button @click="handleBackupDatabase">
              <ExportOutlined />
              备份数据
            </a-button>
            <a-button
              :loading="syncing"
              @click="handleSyncNow"
            >
              <SyncOutlined />
              立即同步
            </a-button>
          </a-space>
        </a-space>
      </a-card>

      <!-- 活动日志 -->
      <a-card
        title="最近活动"
        class="settings-card"
      >
        <a-list
          :loading="loadingActivities"
          :data-source="recentActivities"
          :pagination="{ pageSize: 5 }"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #avatar>
                  <a-avatar>
                    <template #icon>
                      <component :is="getActivityIcon(item.action_type)" />
                    </template>
                  </a-avatar>
                </template>
                <template #title>
                  {{ getActivityTitle(item) }}
                </template>
                <template #description>
                  {{ formatDate(item.created_at) }}
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
      </a-card>

      <!-- 危险操作 -->
      <a-card
        v-if="canManageOrg"
        title="危险操作"
        class="settings-card danger-zone"
      >
        <a-space
          direction="vertical"
          style="width: 100%"
          :size="16"
        >
          <div class="danger-item">
            <div class="danger-info">
              <h4>离开组织</h4>
              <p>您将无法再访问此组织的数据和资源</p>
            </div>
            <a-button
              danger
              @click="handleLeaveOrg"
            >
              离开组织
            </a-button>
          </div>

          <a-divider />

          <div
            v-if="isOwner"
            class="danger-item"
          >
            <div class="danger-info">
              <h4>删除组织</h4>
              <p>此操作无法撤销，将永久删除组织及所有数据</p>
            </div>
            <a-button
              danger
              type="primary"
              @click="showDeleteOrgModal = true"
            >
              <DeleteOutlined />
              删除组织
            </a-button>
          </div>
        </a-space>
      </a-card>
    </div>

    <!-- 删除组织确认对话框 -->
    <a-modal
      v-model:open="showDeleteOrgModal"
      title="确认删除组织"
      :confirm-loading="deleting"
      @ok="handleDeleteOrg"
    >
      <a-alert
        type="error"
        message="警告"
        description="此操作无法撤销！删除后，组织的所有数据将被永久删除。"
        show-icon
        style="margin-bottom: 16px"
      />

      <a-form layout="vertical">
        <a-form-item label="请输入组织名称以确认删除">
          <a-input
            v-model:value="deleteConfirmName"
            placeholder="输入组织名称"
          />
        </a-form-item>
      </a-form>

      <p>组织名称: <strong>{{ currentOrgInfo?.name }}</strong></p>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import {
  SettingOutlined,
  DeleteOutlined,
  TeamOutlined,
  UploadOutlined,
  QuestionCircleOutlined,
  CloudSyncOutlined,
  DatabaseOutlined,
  SafetyOutlined,
  SafetyCertificateOutlined,
  CheckCircleOutlined,
  ExportOutlined,
  SyncOutlined,
  UserAddOutlined,
  EditOutlined,
  LogoutOutlined,
} from '@ant-design/icons-vue';
import { useIdentityStore } from '@/stores/identity';

const router = useRouter();
const identityStore = useIdentityStore();

// 状态
const loading = ref(false);
const saving = ref(false);
const syncing = ref(false);
const deleting = ref(false);
const loadingActivities = ref(false);
const showDeleteOrgModal = ref(false);
const deleteConfirmName = ref('');
const databasePath = ref('');
const memberCount = ref(0);
const recentActivities = ref([]);

// 当前组织信息
const currentOrgInfo = ref(null);

// 表单数据
const orgForm = ref({
  name: '',
  type: 'startup',
  description: '',
  avatar: '',
});

const settingsForm = ref({
  visibility: 'private',
  maxMembers: 100,
  allowMemberInvite: true,
  defaultMemberRole: 'member',
});

const syncForm = ref({
  p2pEnabled: false,
});

// 当前用户角色
const currentUserRole = computed(() => {
  if (!identityStore.isOrganizationContext) {return null;}
  const orgId = identityStore.currentOrgId;
  const org = identityStore.organizations.find(o => o.org_id === orgId);
  return org?.role || null;
});

// 权限检查
const canManageOrg = computed(() => {
  return ['owner', 'admin'].includes(currentUserRole.value);
});

const isOwner = computed(() => {
  return currentUserRole.value === 'owner';
});

// 加载组织信息
const loadOrganizationInfo = async () => {
  if (!identityStore.isOrganizationContext) {
    message.warning('请先切换到组织身份');
    return;
  }

  loading.value = true;
  try {
    const orgId = identityStore.currentOrgId;

    // 获取组织信息
    currentOrgInfo.value = await window.ipc.invoke('org:get-organization', orgId);

    // 填充表单
    orgForm.value = {
      name: currentOrgInfo.value.name,
      type: currentOrgInfo.value.type,
      description: currentOrgInfo.value.description || '',
      avatar: currentOrgInfo.value.avatar || '',
    };

    // 解析设置
    if (currentOrgInfo.value.settings_json) {
      const settings = JSON.parse(currentOrgInfo.value.settings_json);
      settingsForm.value = {
        visibility: settings.visibility || 'private',
        maxMembers: settings.maxMembers || 100,
        allowMemberInvite: settings.allowMemberInvite !== false,
        defaultMemberRole: settings.defaultMemberRole || 'member',
      };
    }

    // 获取成员数量
    const members = await window.ipc.invoke('org:get-members', orgId);
    memberCount.value = members?.length || 0;

    // 获取数据库路径
    databasePath.value = await window.ipc.invoke('db:get-context-path', `org_${orgId}`);

    // 加载活动日志
    await loadActivities();
  } catch (error) {
    console.error('加载组织信息失败:', error);
    message.error('加载组织信息失败');
  } finally {
    loading.value = false;
  }
};

// 加载活动日志
const loadActivities = async () => {
  loadingActivities.value = true;
  try {
    const orgId = identityStore.currentOrgId;
    const activities = await window.ipc.invoke('org:get-activities', orgId, 20);
    recentActivities.value = activities || [];
  } catch (error) {
    console.error('加载活动日志失败:', error);
  } finally {
    loadingActivities.value = false;
  }
};

// 保存基本信息
const handleSaveBasicInfo = async () => {
  saving.value = true;
  try {
    const orgId = identityStore.currentOrgId;
    if (!orgId) {
      message.error('未找到当前组织');
      return;
    }

    const result = await window.ipc.invoke('org:update-organization', {
      orgId,
      name: orgForm.value.name,
      type: orgForm.value.type,
      description: orgForm.value.description,
      visibility: orgForm.value.visibility
    });

    if (result.success) {
      message.success('保存成功');
      await loadOrganizationInfo();
    } else {
      message.error(result.error || '保存失败');
    }
  } catch (error) {
    console.error('保存失败:', error);
    message.error('保存失败');
  } finally {
    saving.value = false;
  }
};

// 保存设置
const handleSaveSettings = async () => {
  saving.value = true;
  try {
    const orgId = identityStore.currentOrgId;
    if (!orgId) {
      message.error('未找到当前组织');
      return;
    }

    const result = await window.ipc.invoke('org:update-organization', {
      orgId,
      p2pEnabled: settingsForm.value.p2pEnabled,
      syncMode: settingsForm.value.syncMode
    });

    if (result.success) {
      message.success('设置已保存');
      await loadOrganizationInfo();
    } else {
      message.error(result.error || '保存设置失败');
    }
  } catch (error) {
    console.error('保存设置失败:', error);
    message.error('保存设置失败');
  } finally {
    saving.value = false;
  }
};

// 跳转到角色管理页面
const handleGoToRolesPage = () => {
  router.push('/organization/roles');
};

// 上传头像
const handleAvatarUpload = async (file) => {
  try {
    // Read file as base64
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target.result;

      const orgId = identityStore.currentOrgId;
      if (!orgId) {
        message.error('未找到当前组织');
        return;
      }

      // Update organization with new avatar
      const result = await window.ipc.invoke('org:update-organization', {
        orgId,
        avatar: base64Data
      });

      if (result.success) {
        orgForm.value.avatar = base64Data;
        message.success('头像上传成功');
      } else {
        message.error(result.error || '头像上传失败');
      }
    };
    reader.readAsDataURL(file);
  } catch (error) {
    console.error('头像上传失败:', error);
    message.error('头像上传失败');
  }
  return false; // Prevent default upload behavior
};

// 备份数据库
const handleBackupDatabase = async () => {
  try {
    const result = await window.electronAPI.invoke('db:backup');

    if (result.success) {
      message.success(`数据备份成功: ${result.backupPath}`);
    } else {
      message.error(result.error || '备份失败');
    }
  } catch (error) {
    console.error('备份失败:', error);
    message.error('备份失败');
  }
};

// 立即同步
const handleSyncNow = async () => {
  syncing.value = true;
  try {
    const orgId = identityStore.currentOrgId;
    if (!orgId) {
      message.error('未找到当前组织');
      return;
    }

    // Trigger P2P sync
    const result = await window.electronAPI.invoke('p2p:sync-organization', { orgId });

    if (result.success) {
      message.success('同步完成');
    } else {
      message.error(result.error || '同步失败');
    }
  } catch (error) {
    console.error('同步失败:', error);
    message.error('同步失败');
  } finally {
    syncing.value = false;
  }
};

// 离开组织
const handleLeaveOrg = () => {
  Modal.confirm({
    title: '确认离开组织？',
    content: '离开后，您将无法访问该组织的数据和资源',
    okText: '确认离开',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        const orgId = identityStore.currentOrgId;
        await identityStore.leaveOrganization(orgId);
        message.success('已离开组织');
        router.push('/');
      } catch (error) {
        console.error('离开组织失败:', error);
        message.error('离开组织失败');
      }
    },
  });
};

// 删除组织
const handleDeleteOrg = async () => {
  if (deleteConfirmName.value !== currentOrgInfo.value?.name) {
    message.error('组织名称不匹配');
    return;
  }

  deleting.value = true;
  try {
    const orgId = identityStore.currentOrgId;
    await window.ipc.invoke('org:delete-organization', orgId, identityStore.primaryDID);

    message.success('组织已删除');
    showDeleteOrgModal.value = false;

    // 切换回个人身份
    await identityStore.switchContext('personal');
    router.push('/');
  } catch (error) {
    console.error('删除组织失败:', error);
    message.error('删除组织失败');
  } finally {
    deleting.value = false;
  }
};

// 工具函数
const formatDID = (did) => {
  if (!did) {return '';}
  if (did.length > 30) {
    return did.substring(0, 20) + '...' + did.substring(did.length - 10);
  }
  return did;
};

const formatDate = (timestamp) => {
  if (!timestamp) {return '';}
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
};

const getActivityIcon = (actionType) => {
  const icons = {
    create_organization: TeamOutlined,
    join_organization: UserAddOutlined,
    add_member: UserAddOutlined,
    remove_member: DeleteOutlined,
    update_member_role: EditOutlined,
    leave_organization: LogoutOutlined,
  };
  return icons[actionType] || EditOutlined;
};

const getActivityTitle = (activity) => {
  const titles = {
    create_organization: '创建了组织',
    join_organization: '加入了组织',
    add_member: '添加了新成员',
    remove_member: '移除了成员',
    update_member_role: '更新了成员角色',
    leave_organization: '离开了组织',
  };
  return titles[activity.action_type] || activity.action_type;
};

// 生命周期
onMounted(async () => {
  await loadOrganizationInfo();
});
</script>

<style scoped lang="scss">
.organization-settings-page {
  padding: 24px;
  background: #f0f2f5;
  min-height: 100vh;

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    padding: 16px 24px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;

      .page-icon {
        font-size: 24px;
        color: #1890ff;
      }

      h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
      }
    }
  }

  .settings-content {
    display: flex;
    flex-direction: column;
    gap: 24px;

    .settings-card {
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);

      .avatar-upload {
        display: flex;
        align-items: center;
      }

      .info-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 0;

        .item-label {
          display: flex;
          align-items: center;
          font-weight: 500;

          .item-icon {
            margin-right: 8px;
            font-size: 16px;
            color: #1890ff;
          }
        }

        .item-content {
          display: flex;
          align-items: center;
        }
      }
    }

    .danger-zone {
      border: 1px solid #ff4d4f;

      .danger-item {
        display: flex;
        justify-content: space-between;
        align-items: center;

        .danger-info {
          flex: 1;

          h4 {
            margin: 0 0 4px 0;
            color: #ff4d4f;
            font-size: 16px;
          }

          p {
            margin: 0;
            color: #8c8c8c;
            font-size: 14px;
          }
        }
      }
    }
  }
}
</style>
