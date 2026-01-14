<template>
  <div class="organization-activity-log-page">
    <a-page-header
      title="组织活动日志"
      sub-title="查看组织的所有操作记录"
      @back="() => $router.back()"
    >
      <template #extra>
        <a-button type="primary" @click="refreshLogs">
          <ReloadOutlined />
          刷新
        </a-button>
        <a-button @click="exportLogs">
          <ExportOutlined />
          导出
        </a-button>
      </template>
    </a-page-header>

    <div class="activity-log-container">
      <!-- 筛选器 -->
      <a-card title="筛选条件" :bordered="false" class="filter-card">
        <a-row :gutter="16">
          <a-col :span="6">
            <a-select
              v-model:value="filters.actionType"
              placeholder="操作类型"
              style="width: 100%"
              allowClear
              @change="handleFilterChange"
            >
              <a-select-option value="">全部</a-select-option>
              <a-select-option value="add_member">添加成员</a-select-option>
              <a-select-option value="remove_member">移除成员</a-select-option>
              <a-select-option value="update_member_role">更新角色</a-select-option>
              <a-select-option value="create_knowledge">创建知识库</a-select-option>
              <a-select-option value="update_knowledge">更新知识库</a-select-option>
              <a-select-option value="delete_knowledge">删除知识库</a-select-option>
              <a-select-option value="create_project">创建项目</a-select-option>
              <a-select-option value="update_organization">更新组织</a-select-option>
              <a-select-option value="create_role">创建角色</a-select-option>
              <a-select-option value="invite_member">邀请成员</a-select-option>
            </a-select>
          </a-col>

          <a-col :span="6">
            <a-select
              v-model:value="filters.actorDID"
              placeholder="操作者"
              style="width: 100%"
              allowClear
              show-search
              :filter-option="filterMember"
              @change="handleFilterChange"
            >
              <a-select-option value="">全部</a-select-option>
              <a-select-option
                v-for="member in members"
                :key="member.member_did"
                :value="member.member_did"
              >
                {{ member.display_name }} ({{ getRoleLabel(member.role) }})
              </a-select-option>
            </a-select>
          </a-col>

          <a-col :span="6">
            <a-range-picker
              v-model:value="filters.dateRange"
              style="width: 100%"
              @change="handleFilterChange"
            />
          </a-col>

          <a-col :span="6">
            <a-input-search
              v-model:value="filters.keyword"
              placeholder="搜索关键词"
              @search="handleFilterChange"
            />
          </a-col>
        </a-row>
      </a-card>

      <!-- 活动日志表格 -->
      <a-card :bordered="false" class="log-table-card">
        <a-table
          :columns="columns"
          :data-source="filteredActivities"
          :loading="loading"
          :pagination="pagination"
          @change="handleTableChange"
          row-key="id"
        >
          <!-- 操作者列 -->
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'actor'">
              <a-space>
                <a-avatar :src="getActorAvatar(record.actor_did)" size="small" />
                <span>{{ getActorName(record.actor_did) }}</span>
              </a-space>
            </template>

            <!-- 操作类型列 -->
            <template v-else-if="column.key === 'action'">
              <a-tag :color="getActionColor(record.action)">
                {{ getActionLabel(record.action) }}
              </a-tag>
            </template>

            <!-- 资源类型列 -->
            <template v-else-if="column.key === 'resource_type'">
              <a-tag>{{ getResourceTypeLabel(record.resource_type) }}</a-tag>
            </template>

            <!-- 详细信息列 -->
            <template v-else-if="column.key === 'details'">
              <a-typography-text
                :ellipsis="{ tooltip: getActivityDetails(record) }"
                style="max-width: 300px"
              >
                {{ getActivityDetails(record) }}
              </a-typography-text>
            </template>

            <!-- 时间列 -->
            <template v-else-if="column.key === 'timestamp'">
              <a-tooltip :title="formatFullTime(record.timestamp)">
                {{ formatRelativeTime(record.timestamp) }}
              </a-tooltip>
            </template>

            <!-- 操作列 -->
            <template v-else-if="column.key === 'operations'">
              <a-button type="link" @click="showDetails(record)">
                详情
              </a-button>
            </template>
          </template>
        </a-table>
      </a-card>
    </div>

    <!-- 详情对话框 -->
    <a-modal
      v-model:open="detailsVisible"
      title="活动详情"
      :footer="null"
      width="600px"
    >
      <a-descriptions v-if="selectedActivity" :column="1" bordered>
        <a-descriptions-item label="操作者">
          <a-space>
            <a-avatar :src="getActorAvatar(selectedActivity.actor_did)" size="small" />
            {{ getActorName(selectedActivity.actor_did) }}
          </a-space>
        </a-descriptions-item>
        <a-descriptions-item label="操作类型">
          <a-tag :color="getActionColor(selectedActivity.action)">
            {{ getActionLabel(selectedActivity.action) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="资源类型">
          {{ getResourceTypeLabel(selectedActivity.resource_type) }}
        </a-descriptions-item>
        <a-descriptions-item label="资源ID">
          {{ selectedActivity.resource_id }}
        </a-descriptions-item>
        <a-descriptions-item label="时间">
          {{ formatFullTime(selectedActivity.timestamp) }}
        </a-descriptions-item>
        <a-descriptions-item label="详细信息">
          <pre style="margin: 0; max-height: 300px; overflow: auto">{{
            JSON.stringify(JSON.parse(selectedActivity.metadata || '{}'), null, 2)
          }}</pre>
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  ReloadOutlined,
  ExportOutlined
} from '@ant-design/icons-vue';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const route = useRoute();
const orgId = ref(route.params.orgId || null);

// 数据
const activities = ref([]);
const members = ref([]);
const loading = ref(false);
const detailsVisible = ref(false);
const selectedActivity = ref(null);

// 筛选器
const filters = reactive({
  actionType: '',
  actorDID: '',
  dateRange: null,
  keyword: ''
});

// 分页
const pagination = reactive({
  current: 1,
  pageSize: 20,
  total: 0,
  showSizeChanger: true,
  showQuickJumper: true,
  showTotal: (total) => `共 ${total} 条记录`
});

// 表格列定义
const columns = [
  {
    title: '操作者',
    key: 'actor',
    dataIndex: 'actor_did',
    width: 180
  },
  {
    title: '操作类型',
    key: 'action',
    dataIndex: 'action',
    width: 150
  },
  {
    title: '资源类型',
    key: 'resource_type',
    dataIndex: 'resource_type',
    width: 120
  },
  {
    title: '详细信息',
    key: 'details',
    width: 300
  },
  {
    title: '时间',
    key: 'timestamp',
    dataIndex: 'timestamp',
    width: 150,
    sorter: (a, b) => a.timestamp - b.timestamp
  },
  {
    title: '操作',
    key: 'operations',
    width: 100,
    fixed: 'right'
  }
];

// 过滤后的活动日志
const filteredActivities = computed(() => {
  let result = [...activities.value];

  // 操作类型筛选
  if (filters.actionType) {
    result = result.filter(a => a.action === filters.actionType);
  }

  // 操作者筛选
  if (filters.actorDID) {
    result = result.filter(a => a.actor_did === filters.actorDID);
  }

  // 日期范围筛选
  if (filters.dateRange && filters.dateRange.length === 2) {
    const startTime = filters.dateRange[0].valueOf();
    const endTime = filters.dateRange[1].valueOf();
    result = result.filter(a => a.timestamp >= startTime && a.timestamp <= endTime);
  }

  // 关键词筛选
  if (filters.keyword) {
    const keyword = filters.keyword.toLowerCase();
    result = result.filter(a => {
      const actorName = getActorName(a.actor_did).toLowerCase();
      const actionLabel = getActionLabel(a.action).toLowerCase();
      const details = getActivityDetails(a).toLowerCase();
      return actorName.includes(keyword) ||
             actionLabel.includes(keyword) ||
             details.includes(keyword);
    });
  }

  pagination.total = result.length;
  return result;
});

// 获取活动日志
async function loadActivities() {
  loading.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke('org:get-activities', {
      orgId: orgId.value,
      limit: 500
    });

    if (result.success) {
      activities.value = result.activities;
      pagination.total = result.activities.length;
    } else {
      message.error(result.error || '加载活动日志失败');
    }
  } catch (error) {
    console.error('加载活动日志失败:', error);
    message.error('加载活动日志失败');
  } finally {
    loading.value = false;
  }
}

// 加载成员列表
async function loadMembers() {
  try {
    const result = await window.electron.ipcRenderer.invoke('org:get-members', { orgId: orgId.value });
    if (result.success) {
      members.value = result.members;
    }
  } catch (error) {
    console.error('加载成员列表失败:', error);
  }
}

// 刷新日志
function refreshLogs() {
  loadActivities();
}

// 筛选器变化
function handleFilterChange() {
  pagination.current = 1;
}

// 表格变化
function handleTableChange(pag) {
  pagination.current = pag.current;
  pagination.pageSize = pag.pageSize;
}

// 显示详情
function showDetails(activity) {
  selectedActivity.value = activity;
  detailsVisible.value = true;
}

// 导出日志
async function exportLogs() {
  try {
    const result = await window.electron.ipcRenderer.invoke('org:export-activities', {
      orgId: orgId.value,
      activities: filteredActivities.value
    });

    if (result.success) {
      message.success('活动日志已导出到: ' + result.filePath);
    } else {
      message.error('导出失败');
    }
  } catch (error) {
    console.error('导出失败:', error);
    message.error('导出失败');
  }
}

// 获取操作者名称
function getActorName(actorDID) {
  const member = members.value.find(m => m.member_did === actorDID);
  return member?.display_name || actorDID.substring(0, 12) + '...';
}

// 获取操作者头像
function getActorAvatar(actorDID) {
  const member = members.value.find(m => m.member_did === actorDID);
  return member?.avatar || '';
}

// 获取操作类型标签
function getActionLabel(action) {
  const labels = {
    'add_member': '添加成员',
    'remove_member': '移除成员',
    'update_member_role': '更新角色',
    'create_knowledge': '创建知识库',
    'update_knowledge': '更新知识库',
    'delete_knowledge': '删除知识库',
    'create_project': '创建项目',
    'update_project': '更新项目',
    'delete_project': '删除项目',
    'update_organization': '更新组织',
    'create_role': '创建角色',
    'update_role': '更新角色',
    'delete_role': '删除角色',
    'invite_member': '邀请成员',
    'leave_organization': '离开组织'
  };
  return labels[action] || action;
}

// 获取操作类型颜色
function getActionColor(action) {
  const colors = {
    'add_member': 'green',
    'remove_member': 'red',
    'update_member_role': 'blue',
    'create_knowledge': 'cyan',
    'update_knowledge': 'blue',
    'delete_knowledge': 'red',
    'create_project': 'green',
    'update_organization': 'orange',
    'create_role': 'purple',
    'invite_member': 'geekblue'
  };
  return colors[action] || 'default';
}

// 获取资源类型标签
function getResourceTypeLabel(resourceType) {
  const labels = {
    'member': '成员',
    'knowledge': '知识库',
    'project': '项目',
    'organization': '组织',
    'role': '角色',
    'invitation': '邀请'
  };
  return labels[resourceType] || resourceType;
}

// 获取活动详细信息
function getActivityDetails(activity) {
  try {
    const metadata = JSON.parse(activity.metadata || '{}');

    switch (activity.action) {
      case 'add_member':
        return `添加了成员: ${metadata.display_name} (${metadata.role})`;
      case 'remove_member':
        return `移除了成员: ${metadata.member_name || activity.resource_id}`;
      case 'update_member_role':
        return `将 ${metadata.member_name} 的角色从 ${metadata.old_role} 更改为 ${metadata.new_role}`;
      case 'create_knowledge':
        return `创建了知识库: ${metadata.title || ''}`;
      case 'update_knowledge':
        return `更新了知识库: ${metadata.title || ''}`;
      case 'delete_knowledge':
        return `删除了知识库: ${metadata.title || activity.resource_id}`;
      case 'create_project':
        return `创建了项目: ${metadata.name || ''}`;
      case 'update_organization':
        return `更新了组织信息`;
      case 'create_role':
        return `创建了角色: ${metadata.name || ''}`;
      case 'invite_member':
        return `生成了邀请码`;
      default:
        return JSON.stringify(metadata);
    }
  } catch (error) {
    return activity.metadata || '';
  }
}

// 格式化相对时间
function formatRelativeTime(timestamp) {
  return dayjs(timestamp).fromNow();
}

// 格式化完整时间
function formatFullTime(timestamp) {
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss');
}

// 获取角色标签
function getRoleLabel(role) {
  const labels = {
    'owner': '所有者',
    'admin': '管理员',
    'member': '成员',
    'viewer': '访客'
  };
  return labels[role] || role;
}

// 成员筛选
function filterMember(input, option) {
  return option.children[0].children.toLowerCase().includes(input.toLowerCase());
}

// 组件挂载
onMounted(() => {
  loadActivities();
  loadMembers();
});
</script>

<style scoped lang="scss">
.organization-activity-log-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f0f2f5;
}

.activity-log-container {
  flex: 1;
  padding: 16px;
  overflow: auto;
}

.filter-card {
  margin-bottom: 16px;
}

.log-table-card {
  .ant-table-wrapper {
    background: white;
  }
}
</style>
