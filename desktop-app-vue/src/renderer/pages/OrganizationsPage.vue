<template>
  <div class="organizations-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <TeamOutlined class="page-icon" />
        <h1>我的组织</h1>
        <a-tag color="blue">
          企业版
        </a-tag>
      </div>
      <div class="header-right">
        <a-button
          type="primary"
          @click="showCreateModal = true"
        >
          <template #icon>
            <PlusOutlined />
          </template>
          创建组织
        </a-button>
      </div>
    </div>

    <!-- 组织列表 -->
    <div class="organizations-list">
      <a-spin :spinning="loading">
        <a-empty
          v-if="!loading && organizations.length === 0"
          description="您还没有加入任何组织"
        >
          <a-button
            type="primary"
            @click="showCreateModal = true"
          >
            创建第一个组织
          </a-button>
        </a-empty>

        <a-row
          v-else
          :gutter="[16, 16]"
        >
          <a-col
            v-for="org in organizations"
            :key="org.org_id"
            :xs="24"
            :sm="12"
            :md="8"
            :lg="6"
          >
            <a-card
              hoverable
              class="org-card"
              @click="navigateToOrg(org.org_id)"
            >
              <!-- 组织头像 -->
              <div class="org-avatar">
                <a-avatar
                  :src="org.avatar"
                  :size="64"
                >
                  <template
                    v-if="!org.avatar"
                    #icon
                  >
                    <TeamOutlined />
                  </template>
                </a-avatar>
              </div>

              <!-- 组织信息 -->
              <div class="org-info">
                <h3 class="org-name">
                  {{ org.name }}
                </h3>
                <p class="org-description">
                  {{ org.description || '暂无描述' }}
                </p>

                <div class="org-meta">
                  <a-tag :color="getOrgTypeColor(org.type)">
                    {{ getOrgTypeLabel(org.type) }}
                  </a-tag>
                  <a-tag :color="getRoleColor(org.role)">
                    {{ getRoleLabel(org.role) }}
                  </a-tag>
                </div>

                <div class="org-stats">
                  <div class="stat-item">
                    <UserOutlined />
                    <span>{{ org.member_count || 0 }} 成员</span>
                  </div>
                  <div class="stat-item">
                    <ClockCircleOutlined />
                    <span>{{ formatDate(org.joined_at) }}</span>
                  </div>
                </div>
              </div>

              <!-- 快捷操作 -->
              <template #actions>
                <a-tooltip title="成员管理">
                  <TeamOutlined @click.stop="navigateToMembers(org.org_id)" />
                </a-tooltip>
                <a-tooltip title="活动日志">
                  <HistoryOutlined @click.stop="navigateToActivities(org.org_id)" />
                </a-tooltip>
                <a-tooltip title="组织设置">
                  <SettingOutlined @click.stop="navigateToSettings(org.org_id)" />
                </a-tooltip>
              </template>
            </a-card>
          </a-col>
        </a-row>
      </a-spin>
    </div>

    <!-- 创建组织对话框 -->
    <a-modal
      v-model:open="showCreateModal"
      title="创建新组织"
      :confirm-loading="creating"
      @ok="handleCreate"
    >
      <a-form
        :model="createForm"
        layout="vertical"
      >
        <a-form-item
          label="组织名称"
          required
        >
          <a-input
            v-model:value="createForm.name"
            placeholder="输入组织名称"
            :maxlength="50"
          />
        </a-form-item>

        <a-form-item
          label="组织类型"
          required
        >
          <a-select v-model:value="createForm.type">
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

        <a-form-item label="组织描述">
          <a-textarea
            v-model:value="createForm.description"
            :rows="3"
            placeholder="描述您的组织(可选)"
            :maxlength="200"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  TeamOutlined,
  PlusOutlined,
  UserOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  SettingOutlined
} from '@ant-design/icons-vue';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const router = useRouter();

// 数据
const loading = ref(false);
const organizations = ref([]);
const showCreateModal = ref(false);
const creating = ref(false);

// 创建表单
const createForm = ref({
  name: '',
  type: 'startup',
  description: ''
});

// 加载组织列表
async function loadOrganizations() {
  loading.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke('org:get-user-organizations');

    if (result.success) {
      organizations.value = result.organizations;
    } else {
      message.error(result.error || '加载组织列表失败');
    }
  } catch (error) {
    logger.error('加载组织列表失败:', error);
    message.error('加载组织列表失败');
  } finally {
    loading.value = false;
  }
}

// 创建组织
async function handleCreate() {
  if (!createForm.value.name) {
    message.warning('请输入组织名称');
    return;
  }

  creating.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke('org:create-organization', createForm.value);

    if (result.success) {
      message.success('组织创建成功');
      showCreateModal.value = false;

      // 重置表单
      createForm.value = {
        name: '',
        type: 'startup',
        description: ''
      };

      // 刷新列表
      await loadOrganizations();

      // 跳转到组织成员管理页面
      router.push(`/org/${result.organization.org_id}/members`);
    } else {
      message.error(result.error || '创建组织失败');
    }
  } catch (error) {
    logger.error('创建组织失败:', error);
    message.error('创建组织失败');
  } finally {
    creating.value = false;
  }
}

// 导航到组织页面
function navigateToOrg(orgId) {
  router.push(`/org/${orgId}/members`);
}

function navigateToMembers(orgId) {
  router.push(`/org/${orgId}/members`);
}

function navigateToActivities(orgId) {
  router.push(`/org/${orgId}/activities`);
}

function navigateToSettings(orgId) {
  router.push(`/org/${orgId}/settings`);
}

// 获取组织类型标签
function getOrgTypeLabel(type) {
  const labels = {
    startup: '初创公司',
    company: '企业',
    community: '社区',
    opensource: '开源',
    education: '教育'
  };
  return labels[type] || type;
}

// 获取组织类型颜色
function getOrgTypeColor(type) {
  const colors = {
    startup: 'green',
    company: 'blue',
    community: 'purple',
    opensource: 'orange',
    education: 'cyan'
  };
  return colors[type] || 'default';
}

// 获取角色标签
function getRoleLabel(role) {
  const labels = {
    owner: '所有者',
    admin: '管理员',
    member: '成员',
    viewer: '访客'
  };
  return labels[role] || role;
}

// 获取角色颜色
function getRoleColor(role) {
  const colors = {
    owner: 'gold',
    admin: 'red',
    member: 'blue',
    viewer: 'default'
  };
  return colors[role] || 'default';
}

// 格式化日期
function formatDate(timestamp) {
  return dayjs(timestamp).fromNow();
}

// 组件挂载
onMounted(() => {
  loadOrganizations();
});
</script>

<style scoped lang="scss">
.organizations-page {
  padding: 24px;
  background: #f0f2f5;
  min-height: 100vh;

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    padding: 24px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;

      .page-icon {
        font-size: 28px;
        color: #1890ff;
      }

      h1 {
        margin: 0;
        font-size: 24px;
        font-weight: 600;
      }
    }
  }

  .organizations-list {
    .org-card {
      transition: all 0.3s;
      cursor: pointer;

      &:hover {
        transform: translateY(-4px);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
      }

      .org-avatar {
        text-align: center;
        margin-bottom: 16px;
      }

      .org-info {
        text-align: center;

        .org-name {
          margin: 0 0 8px;
          font-size: 18px;
          font-weight: 600;
          color: #262626;
        }

        .org-description {
          margin: 0 0 12px;
          font-size: 14px;
          color: #8c8c8c;
          min-height: 40px;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .org-meta {
          margin-bottom: 12px;
        }

        .org-stats {
          display: flex;
          justify-content: center;
          gap: 16px;
          padding-top: 12px;
          border-top: 1px solid #f0f0f0;

          .stat-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 14px;
            color: #595959;

            .anticon {
              color: #8c8c8c;
            }
          }
        }
      }

      :deep(.ant-card-actions) {
        li {
          margin: 8px 0;

          .anticon {
            font-size: 18px;
            color: #595959;
            transition: all 0.3s;

            &:hover {
              color: #1890ff;
            }
          }
        }
      }
    }
  }
}
</style>
