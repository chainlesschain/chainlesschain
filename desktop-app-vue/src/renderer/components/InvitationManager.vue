<template>
  <div class="invitation-manager">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <MailOutlined class="page-icon" />
        <h2>邀请管理</h2>
      </div>
      <div class="header-right">
        <a-button
          v-if="canCreateInvitation"
          type="primary"
          @click="showCreateModal = true"
        >
          <template #icon><PlusOutlined /></template>
          创建邀请
        </a-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-cards">
      <a-card class="stat-card">
        <a-statistic title="总邀请数" :value="invitations.length">
          <template #suffix>
            <MailOutlined />
          </template>
        </a-statistic>
      </a-card>
      <a-card class="stat-card">
        <a-statistic
          title="有效邀请"
          :value="activeInvitations"
          :value-style="{ color: '#3f8600' }"
        >
          <template #suffix>
            <CheckCircleOutlined />
          </template>
        </a-statistic>
      </a-card>
      <a-card class="stat-card">
        <a-statistic title="已使用" :value="usedInvitations">
          <template #suffix>
            <UserAddOutlined />
          </template>
        </a-statistic>
      </a-card>
    </div>

    <!-- 筛选器 -->
    <div class="filters">
      <a-select
        v-model:value="statusFilter"
        placeholder="按状态筛选"
        style="width: 150px"
        @change="handleFilter"
      >
        <a-select-option value="">全部状态</a-select-option>
        <a-select-option value="active">有效</a-select-option>
        <a-select-option value="expired">已过期</a-select-option>
        <a-select-option value="used">已用完</a-select-option>
      </a-select>
    </div>

    <!-- 邀请列表 -->
    <a-table
      :columns="columns"
      :data-source="filteredInvitations"
      :loading="loading"
      :pagination="pagination"
      row-key="invite_id"
      class="invitations-table"
    >
      <!-- 邀请码列 -->
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'invite_code'">
          <div class="code-cell">
            <a-typography-text code strong style="font-size: 16px">
              {{ record.invite_code }}
            </a-typography-text>
            <a-button
              size="small"
              type="text"
              @click="copyInviteCode(record.invite_code)"
            >
              <CopyOutlined />
            </a-button>
          </div>
        </template>

        <!-- 角色列 -->
        <template v-else-if="column.key === 'role'">
          <a-tag :color="getRoleColor(record.role)">
            {{ getRoleLabel(record.role) }}
          </a-tag>
        </template>

        <!-- 状态列 -->
        <template v-else-if="column.key === 'status'">
          <a-badge :status="getStatusBadge(record).status" :text="getStatusBadge(record).text" />
        </template>

        <!-- 使用情况列 -->
        <template v-else-if="column.key === 'usage'">
          <a-progress
            :percent="getUsagePercent(record)"
            :status="record.used_count >= record.max_uses ? 'exception' : 'active'"
            :format="() => `${record.used_count}/${record.max_uses}`"
          />
        </template>

        <!-- 过期时间列 -->
        <template v-else-if="column.key === 'expire_at'">
          <span v-if="record.expire_at">
            {{ formatDate(record.expire_at) }}
            <a-tag v-if="isExpired(record)" color="red" size="small">
              已过期
            </a-tag>
          </span>
          <span v-else>
            <a-tag color="blue">永不过期</a-tag>
          </span>
        </template>

        <!-- 创建者列 -->
        <template v-else-if="column.key === 'invited_by'">
          {{ formatDID(record.invited_by) }}
        </template>

        <!-- 创建时间列 -->
        <template v-else-if="column.key === 'created_at'">
          {{ formatDate(record.created_at) }}
        </template>

        <!-- 操作列 -->
        <template v-else-if="column.key === 'actions'">
          <a-space>
            <!-- 查看详情 -->
            <a-button size="small" @click="showInvitationDetail(record)">
              <EyeOutlined />
              详情
            </a-button>

            <!-- 复制邀请链接 -->
            <a-button
              size="small"
              @click="copyInviteLink(record)"
              :disabled="!isInvitationActive(record)"
            >
              <LinkOutlined />
              复制链接
            </a-button>

            <!-- 禁用/启用 -->
            <a-button
              v-if="canManageInvitations"
              size="small"
              @click="toggleInvitationStatus(record)"
            >
              {{ record.is_active ? '禁用' : '启用' }}
            </a-button>

            <!-- 删除 -->
            <a-popconfirm
              v-if="canManageInvitations"
              title="确定要删除这个邀请吗？"
              @confirm="handleDeleteInvitation(record)"
            >
              <a-button size="small" danger>
                <DeleteOutlined />
              </a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 创建邀请对话框 -->
    <a-modal
      v-model:open="showCreateModal"
      title="创建新邀请"
      :confirm-loading="creating"
      @ok="handleCreateInvitation"
      width="600px"
    >
      <a-form :model="createForm" layout="vertical">
        <a-form-item label="邀请方式">
          <a-radio-group v-model:value="createForm.method">
            <a-radio value="code">邀请码</a-radio>
            <a-radio value="link">邀请链接</a-radio>
            <a-radio value="did">
              <a-tooltip title="通过DID直接邀请用户，对方将收到P2P通知">
                DID邀请
                <QuestionCircleOutlined />
              </a-tooltip>
            </a-radio>
          </a-radio-group>
        </a-form-item>

        <!-- DID输入（仅DID邀请方式显示） -->
        <a-form-item
          v-if="createForm.method === 'did'"
          label="被邀请人DID"
          required
        >
          <a-input
            v-model:value="createForm.invitedDID"
            placeholder="did:chainlesschain:..."
            @blur="validateDID"
          >
            <template #prefix>
              <IdcardOutlined />
            </template>
          </a-input>
          <div v-if="didValidationError" class="error-message">
            {{ didValidationError }}
          </div>
        </a-form-item>

        <a-form-item label="默认角色" required>
          <a-select v-model:value="createForm.role">
            <a-select-option value="viewer">
              <SafetyOutlined /> 访客 - 只能查看
            </a-select-option>
            <a-select-option value="member">
              <UserOutlined /> 成员 - 可以创建和编辑
            </a-select-option>
            <a-select-option value="admin" v-if="currentUserRole === 'owner'">
              <CrownOutlined /> 管理员 - 可以管理成员
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="最大使用次数">
              <a-input-number
                v-model:value="createForm.maxUses"
                :min="1"
                :max="999"
                style="width: 100%"
              />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="过期时间">
              <a-select v-model:value="createForm.expireOption">
                <a-select-option value="never">永不过期</a-select-option>
                <a-select-option value="1h">1小时</a-select-option>
                <a-select-option value="1day">1天</a-select-option>
                <a-select-option value="7days">7天</a-select-option>
                <a-select-option value="30days">30天</a-select-option>
                <a-select-option value="custom">自定义</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item
          v-if="createForm.expireOption === 'custom'"
          label="自定义过期时间"
        >
          <a-date-picker
            v-model:value="createForm.customExpireDate"
            show-time
            format="YYYY-MM-DD HH:mm:ss"
            style="width: 100%"
          />
        </a-form-item>

        <a-form-item label="备注（可选）">
          <a-textarea
            v-model:value="createForm.note"
            :rows="2"
            placeholder="添加一些备注信息"
          />
        </a-form-item>

        <!-- 显示生成的邀请信息 -->
        <a-alert
          v-if="generatedInvitation"
          type="success"
          style="margin-top: 16px"
        >
          <template #message>
            <div class="generated-invitation">
              <div class="invitation-item">
                <span class="label">邀请码：</span>
                <a-typography-text code strong style="font-size: 16px">
                  {{ generatedInvitation.invite_code }}
                </a-typography-text>
                <a-button
                  size="small"
                  type="link"
                  @click="copyInviteCode(generatedInvitation.invite_code)"
                >
                  <CopyOutlined />
                  复制
                </a-button>
              </div>
              <div v-if="createForm.method === 'link'" class="invitation-item">
                <span class="label">邀请链接：</span>
                <a-typography-text
                  :copyable="{ text: getInviteLink(generatedInvitation) }"
                  style="font-size: 12px"
                >
                  {{ getInviteLink(generatedInvitation) }}
                </a-typography-text>
              </div>
            </div>
          </template>
          <template #description>
            请复制邀请码或链接分享给新成员
          </template>
        </a-alert>
      </a-form>
    </a-modal>

    <!-- 邀请详情对话框 -->
    <a-modal
      v-model:open="showDetailModal"
      title="邀请详情"
      :footer="null"
      width="600px"
    >
      <div v-if="selectedInvitation" class="invitation-detail">
        <div class="detail-header">
          <MailOutlined class="detail-icon" />
          <div class="detail-title">
            <h3>邀请码：{{ selectedInvitation.invite_code }}</h3>
            <a-tag :color="getRoleColor(selectedInvitation.role)">
              {{ getRoleLabel(selectedInvitation.role) }}
            </a-tag>
          </div>
        </div>

        <a-descriptions :column="1" bordered style="margin-top: 24px">
          <a-descriptions-item label="邀请ID">
            {{ selectedInvitation.invite_id }}
          </a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-badge
              :status="getStatusBadge(selectedInvitation).status"
              :text="getStatusBadge(selectedInvitation).text"
            />
          </a-descriptions-item>
          <a-descriptions-item label="邀请角色">
            {{ getRoleLabel(selectedInvitation.role) }}
          </a-descriptions-item>
          <a-descriptions-item label="使用情况">
            <a-progress
              :percent="getUsagePercent(selectedInvitation)"
              :format="() => `${selectedInvitation.used_count}/${selectedInvitation.max_uses}`"
            />
          </a-descriptions-item>
          <a-descriptions-item label="创建者">
            {{ formatDID(selectedInvitation.invited_by) }}
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">
            {{ formatDate(selectedInvitation.created_at) }}
          </a-descriptions-item>
          <a-descriptions-item label="过期时间">
            <span v-if="selectedInvitation.expire_at">
              {{ formatDate(selectedInvitation.expire_at) }}
              <a-tag v-if="isExpired(selectedInvitation)" color="red" size="small">
                已过期
              </a-tag>
            </span>
            <span v-else>
              <a-tag color="blue">永不过期</a-tag>
            </span>
          </a-descriptions-item>
          <a-descriptions-item label="邀请链接">
            <a-typography-paragraph
              :copyable="{ text: getInviteLink(selectedInvitation) }"
              style="margin: 0"
            >
              {{ getInviteLink(selectedInvitation) }}
            </a-typography-paragraph>
          </a-descriptions-item>
        </a-descriptions>

        <!-- 使用历史 -->
        <a-divider>使用历史</a-divider>
        <a-empty v-if="!selectedInvitation.used_count" description="暂无使用记录" />
        <a-timeline v-else>
          <!-- TODO: 从后端获取使用历史 -->
          <a-timeline-item color="green">
            <template #dot>
              <CheckCircleOutlined />
            </template>
            用户 xxx 使用此邀请加入组织
            <div style="color: #8c8c8c; font-size: 12px">
              2024-01-01 12:00:00
            </div>
          </a-timeline-item>
        </a-timeline>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  MailOutlined,
  PlusOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  UserAddOutlined,
  EyeOutlined,
  LinkOutlined,
  DeleteOutlined,
  UserOutlined,
  CrownOutlined,
  SafetyOutlined,
  QuestionCircleOutlined,
  IdcardOutlined,
} from '@ant-design/icons-vue';
import { useIdentityStore } from '@/stores/identity';
import dayjs from 'dayjs';

const identityStore = useIdentityStore();

// 状态
const loading = ref(false);
const creating = ref(false);
const invitations = ref([]);
const statusFilter = ref('');
const showCreateModal = ref(false);
const showDetailModal = ref(false);
const selectedInvitation = ref(null);
const generatedInvitation = ref(null);

// 创建表单
const createForm = ref({
  method: 'code',
  role: 'member',
  maxUses: 10,
  expireOption: '30days',
  customExpireDate: null,
  note: '',
  invitedDID: '', // DID邀请专用
});

// DID验证状态
const didValidationError = ref('');

// 当前用户角色
const currentUserRole = computed(() => {
  if (!identityStore.isOrganizationContext) return null;
  const orgId = identityStore.currentOrgId;
  const org = identityStore.organizations.find(o => o.org_id === orgId);
  return org?.role || null;
});

// 权限检查
const canCreateInvitation = computed(() => {
  return ['owner', 'admin'].includes(currentUserRole.value);
});

const canManageInvitations = computed(() => {
  return ['owner', 'admin'].includes(currentUserRole.value);
});

// 统计
const activeInvitations = computed(() => {
  return invitations.value.filter(inv => isInvitationActive(inv)).length;
});

const usedInvitations = computed(() => {
  return invitations.value.reduce((sum, inv) => sum + inv.used_count, 0);
});

// 过滤后的邀请列表
const filteredInvitations = computed(() => {
  if (!statusFilter.value) return invitations.value;

  return invitations.value.filter(inv => {
    if (statusFilter.value === 'active') return isInvitationActive(inv);
    if (statusFilter.value === 'expired') return isExpired(inv);
    if (statusFilter.value === 'used') return inv.used_count >= inv.max_uses;
    return true;
  });
});

// 表格列定义
const columns = [
  {
    title: '邀请码',
    key: 'invite_code',
    width: 180,
  },
  {
    title: '角色',
    key: 'role',
    width: 100,
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
  },
  {
    title: '使用情况',
    key: 'usage',
    width: 150,
  },
  {
    title: '过期时间',
    key: 'expire_at',
    width: 180,
  },
  {
    title: '创建者',
    key: 'invited_by',
    width: 150,
  },
  {
    title: '创建时间',
    key: 'created_at',
    width: 180,
  },
  {
    title: '操作',
    key: 'actions',
    width: 250,
    fixed: 'right',
  },
];

// 分页配置
const pagination = ref({
  current: 1,
  pageSize: 10,
  total: 0,
  showSizeChanger: true,
  showTotal: (total) => `共 ${total} 条`,
});

// 加载邀请列表
const loadInvitations = async () => {
  if (!identityStore.isOrganizationContext) {
    message.warning('请先切换到组织身份');
    return;
  }

  loading.value = true;
  try {
    const orgId = identityStore.currentOrgId;
    const result = await window.ipc.invoke('org:get-invitations', orgId);

    if (result.success) {
      invitations.value = result.invitations || [];
      pagination.value.total = invitations.value.length;
    } else {
      message.error(result.error || '加载邀请列表失败');
      invitations.value = [];
    }
  } catch (error) {
    console.error('加载邀请列表失败:', error);
    message.error('加载邀请列表失败');
    invitations.value = [];
  } finally {
    loading.value = false;
  }
};

// DID验证
const validateDID = () => {
  didValidationError.value = '';
  const did = createForm.value.invitedDID.trim();

  if (!did) {
    didValidationError.value = '请输入DID';
    return false;
  }

  if (!did.startsWith('did:')) {
    didValidationError.value = 'DID格式错误，应以 "did:" 开头';
    return false;
  }

  // 简单的格式验证
  const parts = did.split(':');
  if (parts.length < 3) {
    didValidationError.value = 'DID格式错误，应为 did:method:identifier';
    return false;
  }

  return true;
};

// 创建邀请
const handleCreateInvitation = async () => {
  creating.value = true;
  try {
    const orgId = identityStore.currentOrgId;

    // 如果是DID邀请，验证DID
    if (createForm.value.method === 'did') {
      if (!validateDID()) {
        creating.value = false;
        return;
      }

      // 创建DID邀请
      const invitation = await window.ipc.invoke('org:invite-by-did', orgId, {
        invitedDID: createForm.value.invitedDID.trim(),
        role: createForm.value.role,
        message: createForm.value.note || undefined,
        expireAt: calculateExpireAt(),
      });

      generatedInvitation.value = {
        ...invitation,
        invite_code: `DID: ${formatDID(invitation.invited_did)}`,
      };

      message.success('DID邀请已发送，对方将收到P2P通知');
    } else {
      // 创建邀请码/链接
      const invitation = await window.ipc.invoke('org:create-invitation', orgId, {
        invitedBy: identityStore.primaryDID,
        role: createForm.value.role,
        maxUses: createForm.value.maxUses,
        expireAt: calculateExpireAt(),
      });

      generatedInvitation.value = invitation;
      message.success('邀请码创建成功');
    }

    // 刷新列表
    await loadInvitations();
  } catch (error) {
    console.error('创建邀请失败:', error);
    message.error(`创建邀请失败: ${error.message}`);
  } finally {
    creating.value = false;
  }
};

// 计算过期时间（提取为单独函数）
const calculateExpireAt = () => {
  let expireAt = null;
  if (createForm.value.expireOption !== 'never') {
    if (createForm.value.expireOption === 'custom') {
      expireAt = createForm.value.customExpireDate
        ? createForm.value.customExpireDate.valueOf()
        : null;
    } else {
      const timeMap = {
        '1h': 1 * 60 * 60 * 1000,
        '1day': 1 * 24 * 60 * 60 * 1000,
        '7days': 7 * 24 * 60 * 60 * 1000,
        '30days': 30 * 24 * 60 * 60 * 1000,
      };
      expireAt = Date.now() + timeMap[createForm.value.expireOption];
    }
  }
  return expireAt;
};

// 复制邀请码
const copyInviteCode = (code) => {
  navigator.clipboard.writeText(code);
  message.success('邀请码已复制');
};

// 复制邀请链接
const copyInviteLink = (invitation) => {
  const link = getInviteLink(invitation);
  navigator.clipboard.writeText(link);
  message.success('邀请链接已复制');
};

// 获取邀请链接
const getInviteLink = (invitation) => {
  // TODO: 使用实际的应用URL
  const baseUrl = 'chainlesschain://invite/';
  return `${baseUrl}${invitation.invite_code}`;
};

// 切换邀请状态
const toggleInvitationStatus = async (invitation) => {
  try {
    const orgId = identityStore.currentOrgId;

    // Use revoke to disable, or would need a separate enable API
    if (invitation.is_active) {
      const result = await window.ipc.invoke('org:revoke-invitation', {
        orgId,
        invitationId: invitation.id
      });

      if (result.success) {
        message.success('邀请已禁用');
        await loadInvitations();
      } else {
        message.error(result.error || '禁用邀请失败');
      }
    } else {
      // Note: There's no enable API, so we show a message
      message.info('已禁用的邀请无法重新启用，请创建新邀请');
    }
  } catch (error) {
    console.error('切换状态失败:', error);
    message.error('切换状态失败');
  }
};

// 删除邀请
const handleDeleteInvitation = async (invitation) => {
  try {
    const orgId = identityStore.currentOrgId;

    const result = await window.ipc.invoke('org:delete-invitation', {
      orgId,
      invitationId: invitation.id
    });

    if (result.success) {
      message.success('邀请已删除');
      await loadInvitations();
    } else {
      message.error(result.error || '删除邀请失败');
    }
  } catch (error) {
    console.error('删除邀请失败:', error);
    message.error('删除邀请失败');
  }
};

// 显示邀请详情
const showInvitationDetail = (invitation) => {
  selectedInvitation.value = invitation;
  showDetailModal.value = true;
};

// 工具函数
const isExpired = (invitation) => {
  if (!invitation.expire_at) return false;
  return Date.now() > invitation.expire_at;
};

const isInvitationActive = (invitation) => {
  if (!invitation.is_active) return false;
  if (invitation.used_count >= invitation.max_uses) return false;
  if (isExpired(invitation)) return false;
  return true;
};

const getStatusBadge = (invitation) => {
  if (!invitation.is_active) {
    return { status: 'default', text: '已禁用' };
  }
  if (invitation.used_count >= invitation.max_uses) {
    return { status: 'error', text: '已用完' };
  }
  if (isExpired(invitation)) {
    return { status: 'error', text: '已过期' };
  }
  return { status: 'success', text: '有效' };
};

const getUsagePercent = (invitation) => {
  return Math.round((invitation.used_count / invitation.max_uses) * 100);
};

const formatDID = (did) => {
  if (!did) return '';
  if (did.length > 30) {
    return did.substring(0, 15) + '...' + did.substring(did.length - 10);
  }
  return did;
};

const formatDate = (timestamp) => {
  if (!timestamp) return '';
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss');
};

const getRoleLabel = (role) => {
  const labels = {
    owner: '所有者',
    admin: '管理员',
    member: '成员',
    viewer: '访客',
  };
  return labels[role] || role;
};

const getRoleColor = (role) => {
  const colors = {
    owner: 'red',
    admin: 'orange',
    member: 'blue',
    viewer: 'default',
  };
  return colors[role] || 'default';
};

const handleFilter = () => {
  // 过滤由computed自动处理
};

// 生命周期
onMounted(async () => {
  await loadInvitations();
});
</script>

<style scoped lang="scss">
.invitation-manager {
  .error-message {
    color: #ff4d4f;
    font-size: 12px;
    margin-top: 4px;
  }

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

  .stats-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 24px;

    .stat-card {
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }
  }

  .filters {
    display: flex;
    align-items: center;
    margin-bottom: 16px;
    padding: 16px 24px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }

  .invitations-table {
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    padding: 24px;

    .code-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }

  .generated-invitation {
    .invitation-item {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;

      .label {
        font-weight: 500;
        min-width: 80px;
      }
    }
  }

  .invitation-detail {
    .detail-header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
      background: #f5f5f5;
      border-radius: 8px;

      .detail-icon {
        font-size: 48px;
        color: #1890ff;
      }

      .detail-title {
        flex: 1;

        h3 {
          margin: 0 0 8px 0;
          font-size: 18px;
        }
      }
    }
  }
}
</style>
