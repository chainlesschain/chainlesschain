<template>
  <div class="invitation-link-manager">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <LinkOutlined class="page-icon" />
        <h2>邀请链接管理</h2>
        <a-tag color="blue" style="margin-left: 12px">企业版</a-tag>
      </div>
      <div class="header-right">
        <a-space>
          <a-button @click="loadInvitationLinks">
            <template #icon><ReloadOutlined /></template>
            刷新
          </a-button>
          <a-button
            v-if="canCreateInvitation"
            type="primary"
            @click="showCreateDialog = true"
          >
            <template #icon><PlusOutlined /></template>
            创建邀请链接
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 统计卡片 -->
    <a-row :gutter="16" class="stats-section">
      <a-col :span="6">
        <a-card>
          <a-statistic
            title="总链接数"
            :value="stats.total"
            :value-style="{ color: '#1890ff' }"
          >
            <template #prefix><LinkOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic
            title="活跃链接"
            :value="stats.active"
            :value-style="{ color: '#52c41a' }"
          >
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic
            title="总使用次数"
            :value="stats.totalUses"
            :value-style="{ color: '#722ed1' }"
          >
            <template #prefix><UserAddOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic
            title="使用率"
            :value="stats.utilizationRate"
            suffix="%"
            :value-style="{ color: '#fa8c16' }"
          >
            <template #prefix><PercentageOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- 筛选器 -->
    <div class="filters-section">
      <a-space>
        <a-select
          v-model:value="statusFilter"
          placeholder="按状态筛选"
          style="width: 150px"
          @change="handleFilterChange"
        >
          <a-select-option value="">全部状态</a-select-option>
          <a-select-option value="active">活跃</a-select-option>
          <a-select-option value="expired">已过期</a-select-option>
          <a-select-option value="revoked">已撤销</a-select-option>
        </a-select>
        <a-input-search
          v-model:value="searchText"
          placeholder="搜索链接ID或消息"
          style="width: 300px"
          @search="handleSearch"
        />
      </a-space>
    </div>

    <!-- 邀请链接列表 -->
    <a-table
      :columns="columns"
      :data-source="filteredLinks"
      :loading="loading"
      :pagination="pagination"
      row-key="link_id"
      class="links-table"
    >
      <!-- 链接URL列 -->
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'invitationUrl'">
          <div class="url-cell">
            <a-typography-text
              :copyable="{ text: record.invitationUrl }"
              :ellipsis="{ tooltip: record.invitationUrl }"
              style="max-width: 300px"
            >
              {{ record.invitationUrl }}
            </a-typography-text>
            <a-space style="margin-left: 8px">
              <a-button
                size="small"
                type="text"
                @click="showQRCode(record)"
                title="显示二维码"
              >
                <QrcodeOutlined />
              </a-button>
              <a-button
                size="small"
                type="text"
                @click="copyLink(record.invitationUrl)"
                title="复制链接"
              >
                <CopyOutlined />
              </a-button>
            </a-space>
          </div>
        </template>

        <!-- 角色列 -->
        <template v-else-if="column.key === 'role'">
          <a-tag :color="getRoleColor(record.role)">
            {{ getRoleLabel(record.role) }}
          </a-tag>
        </template>

        <!-- 使用情况列 -->
        <template v-else-if="column.key === 'usage'">
          <div class="usage-cell">
            <a-progress
              :percent="getUsagePercent(record)"
              :status="getUsageStatus(record)"
              :format="() => `${record.used_count}/${record.max_uses}`"
            />
            <a-typography-text type="secondary" style="font-size: 12px">
              剩余 {{ record.remainingUses }} 次
            </a-typography-text>
          </div>
        </template>

        <!-- 状态列 -->
        <template v-else-if="column.key === 'status'">
          <a-badge
            :status="getStatusBadge(record).status"
            :text="getStatusBadge(record).text"
          />
        </template>

        <!-- 过期时间列 -->
        <template v-else-if="column.key === 'expires_at'">
          <div v-if="record.expires_at">
            <div>{{ formatDate(record.expires_at) }}</div>
            <a-typography-text
              type="secondary"
              style="font-size: 12px"
            >
              {{ getTimeRemaining(record.expires_at) }}
            </a-typography-text>
          </div>
          <a-typography-text v-else type="secondary">
            永不过期
          </a-typography-text>
        </template>

        <!-- 操作列 -->
        <template v-else-if="column.key === 'actions'">
          <a-space>
            <a-button
              size="small"
              @click="showLinkDetail(record)"
            >
              详情
            </a-button>
            <a-dropdown>
              <a-button size="small">
                更多
                <DownOutlined />
              </a-button>
              <template #overlay>
                <a-menu @click="handleMenuClick($event, record)">
                  <a-menu-item key="copy">
                    <CopyOutlined /> 复制链接
                  </a-menu-item>
                  <a-menu-item key="qrcode">
                    <QrcodeOutlined /> 显示二维码
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item
                    key="revoke"
                    v-if="record.status === 'active'"
                    danger
                  >
                    <StopOutlined /> 撤销链接
                  </a-menu-item>
                  <a-menu-item key="delete" danger>
                    <DeleteOutlined /> 删除链接
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 创建邀请链接对话框 -->
    <CreateInvitationLinkDialog
      v-model:visible="showCreateDialog"
      :org-id="currentOrgId"
      @created="handleLinkCreated"
    />

    <!-- 邀请链接详情对话框 -->
    <InvitationLinkDetailDialog
      v-model:visible="showDetailDialog"
      :link-id="selectedLinkId"
      @refresh="loadInvitationLinks"
    />

    <!-- 二维码显示对话框 -->
    <QRCodeDialog
      v-model:visible="showQRDialog"
      :url="selectedUrl"
      :title="qrCodeTitle"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  UserAddOutlined,
  PercentageOutlined,
  CopyOutlined,
  QrcodeOutlined,
  DownOutlined,
  StopOutlined,
  DeleteOutlined
} from '@ant-design/icons-vue';
import CreateInvitationLinkDialog from './CreateInvitationLinkDialog.vue';
import InvitationLinkDetailDialog from './InvitationLinkDetailDialog.vue';
import QRCodeDialog from './QRCodeDialog.vue';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

// Props
const props = defineProps({
  orgId: {
    type: String,
    required: true
  }
});

// State
const loading = ref(false);
const links = ref([]);
const stats = ref({
  total: 0,
  active: 0,
  expired: 0,
  revoked: 0,
  totalUses: 0,
  totalMaxUses: 0,
  utilizationRate: 0
});
const statusFilter = ref('');
const searchText = ref('');
const showCreateDialog = ref(false);
const showDetailDialog = ref(false);
const showQRDialog = ref(false);
const selectedLinkId = ref('');
const selectedUrl = ref('');
const qrCodeTitle = ref('');
const canCreateInvitation = ref(true);
const currentOrgId = computed(() => props.orgId);

// Pagination
const pagination = ref({
  current: 1,
  pageSize: 10,
  total: 0,
  showSizeChanger: true,
  showTotal: (total) => `共 ${total} 条`
});

// Table columns
const columns = [
  {
    title: '链接URL',
    key: 'invitationUrl',
    width: 350
  },
  {
    title: '角色',
    key: 'role',
    width: 100
  },
  {
    title: '使用情况',
    key: 'usage',
    width: 200
  },
  {
    title: '状态',
    key: 'status',
    width: 100
  },
  {
    title: '创建时间',
    dataIndex: 'created_at',
    key: 'created_at',
    width: 180,
    customRender: ({ text }) => formatDate(text)
  },
  {
    title: '过期时间',
    key: 'expires_at',
    width: 180
  },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    fixed: 'right'
  }
];

// Computed
const filteredLinks = computed(() => {
  let result = links.value;

  // 状态筛选
  if (statusFilter.value) {
    result = result.filter(link => link.status === statusFilter.value);
  }

  // 搜索筛选
  if (searchText.value) {
    const search = searchText.value.toLowerCase();
    result = result.filter(link =>
      link.link_id.toLowerCase().includes(search) ||
      (link.message && link.message.toLowerCase().includes(search))
    );
  }

  pagination.value.total = result.length;
  return result;
});

// Methods
const loadInvitationLinks = async () => {
  loading.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'org:get-invitation-links',
      currentOrgId.value,
      { status: statusFilter.value || undefined }
    );

    if (result.success) {
      links.value = result.links;
    } else {
      message.error(result.error || '加载邀请链接失败');
    }

    // 加载统计信息
    await loadStats();
  } catch (error) {
    console.error('加载邀请链接失败:', error);
    message.error('加载邀请链接失败');
  } finally {
    loading.value = false;
  }
};

const loadStats = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'org:get-invitation-link-stats',
      currentOrgId.value
    );

    if (result.success) {
      stats.value = result.stats;
    }
  } catch (error) {
    console.error('加载统计信息失败:', error);
  }
};

const handleFilterChange = () => {
  loadInvitationLinks();
};

const handleSearch = () => {
  // 搜索由computed自动处理
};

const copyLink = async (url) => {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'org:copy-invitation-link',
      url
    );

    if (result.success) {
      message.success('链接已复制到剪贴板');
    } else {
      message.error('复制失败');
    }
  } catch (error) {
    console.error('复制链接失败:', error);
    message.error('复制链接失败');
  }
};

const showQRCode = (record) => {
  selectedUrl.value = record.invitationUrl;
  qrCodeTitle.value = `邀请链接二维码 - ${getRoleLabel(record.role)}`;
  showQRDialog.value = true;
};

const showLinkDetail = (record) => {
  selectedLinkId.value = record.link_id;
  showDetailDialog.value = true;
};

const handleMenuClick = async ({ key }, record) => {
  switch (key) {
    case 'copy':
      await copyLink(record.invitationUrl);
      break;
    case 'qrcode':
      showQRCode(record);
      break;
    case 'revoke':
      await revokeLink(record);
      break;
    case 'delete':
      await deleteLink(record);
      break;
  }
};

const revokeLink = async (record) => {
  try {
    const confirmed = await new Promise((resolve) => {
      window.antd.Modal.confirm({
        title: '确认撤销',
        content: '撤销后此链接将无法使用，确定要撤销吗？',
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      });
    });

    if (!confirmed) return;

    const result = await window.electron.ipcRenderer.invoke(
      'org:revoke-invitation-link',
      record.link_id
    );

    if (result.success) {
      message.success('链接已撤销');
      await loadInvitationLinks();
    } else {
      message.error(result.error || '撤销失败');
    }
  } catch (error) {
    console.error('撤销链接失败:', error);
    message.error('撤销链接失败');
  }
};

const deleteLink = async (record) => {
  try {
    const confirmed = await new Promise((resolve) => {
      window.antd.Modal.confirm({
        title: '确认删除',
        content: '删除后将无法恢复，确定要删除吗？',
        okText: '删除',
        okType: 'danger',
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      });
    });

    if (!confirmed) return;

    const result = await window.electron.ipcRenderer.invoke(
      'org:delete-invitation-link',
      record.link_id
    );

    if (result.success) {
      message.success('链接已删除');
      await loadInvitationLinks();
    } else {
      message.error(result.error || '删除失败');
    }
  } catch (error) {
    console.error('删除链接失败:', error);
    message.error('删除链接失败');
  }
};

const handleLinkCreated = () => {
  loadInvitationLinks();
};

// Helper functions
const getRoleColor = (role) => {
  const colors = {
    owner: 'red',
    admin: 'orange',
    member: 'blue',
    viewer: 'green'
  };
  return colors[role] || 'default';
};

const getRoleLabel = (role) => {
  const labels = {
    owner: '所有者',
    admin: '管理员',
    member: '成员',
    viewer: '访客'
  };
  return labels[role] || role;
};

const getUsagePercent = (record) => {
  if (record.max_uses === 0) return 0;
  return Math.round((record.used_count / record.max_uses) * 100);
};

const getUsageStatus = (record) => {
  const percent = getUsagePercent(record);
  if (percent >= 100) return 'exception';
  if (percent >= 80) return 'active';
  return 'normal';
};

const getStatusBadge = (record) => {
  if (record.isExpired) {
    return { status: 'default', text: '已过期' };
  }
  if (record.isExhausted) {
    return { status: 'default', text: '已用尽' };
  }
  if (record.status === 'revoked') {
    return { status: 'error', text: '已撤销' };
  }
  if (record.status === 'active') {
    return { status: 'success', text: '活跃' };
  }
  return { status: 'default', text: record.status };
};

const formatDate = (timestamp) => {
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm');
};

const getTimeRemaining = (expiresAt) => {
  const now = Date.now();
  if (expiresAt < now) {
    return '已过期';
  }
  return dayjs(expiresAt).fromNow();
};

// Lifecycle
onMounted(() => {
  loadInvitationLinks();
});

watch(() => props.orgId, () => {
  loadInvitationLinks();
});
</script>

<style scoped lang="scss">
.invitation-link-manager {
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
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);

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

  .stats-section {
    margin-bottom: 24px;

    .ant-card {
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    }
  }

  .filters-section {
    margin-bottom: 16px;
    padding: 16px 24px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }

  .links-table {
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);

    .url-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .usage-cell {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
  }
}
</style>
