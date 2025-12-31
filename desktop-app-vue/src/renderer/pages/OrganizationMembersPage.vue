<template>
  <div class="organization-members-page">
    <!-- 组织导航 -->
    <div class="org-nav">
      <a-space size="large">
        <router-link :to="`/org/${orgId}/members`" class="nav-link active">
          <TeamOutlined /> 成员管理
        </router-link>
        <router-link :to="`/org/${orgId}/roles`" class="nav-link">
          <SafetyCertificateOutlined /> 角色管理
        </router-link>
        <router-link :to="`/org/${orgId}/activities`" class="nav-link">
          <HistoryOutlined /> 活动日志
        </router-link>
        <router-link :to="`/org/${orgId}/settings`" class="nav-link">
          <SettingOutlined /> 组织设置
        </router-link>
      </a-space>
    </div>

    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <TeamOutlined class="page-icon" />
        <h2>组织成员管理</h2>
      </div>
      <div class="header-right">
        <a-button
          v-permission="'member.invite'"
          type="primary"
          @click="showInviteModal = true"
        >
          <template #icon><UserAddOutlined /></template>
          邀请成员
        </a-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-cards">
      <a-card class="stat-card">
        <a-statistic title="总成员数" :value="members.length">
          <template #suffix>
            <TeamOutlined />
          </template>
        </a-statistic>
      </a-card>
      <a-card class="stat-card">
        <a-statistic title="在线成员" :value="onlineCount" :value-style="{ color: '#3f8600' }">
          <template #suffix>
            <CheckCircleOutlined />
          </template>
        </a-statistic>
      </a-card>
      <a-card class="stat-card">
        <a-statistic title="管理员" :value="adminCount">
          <template #suffix>
            <CrownOutlined />
          </template>
        </a-statistic>
      </a-card>
    </div>

    <!-- 搜索和筛选 -->
    <div class="filters">
      <a-input-search
        v-model:value="searchKeyword"
        placeholder="搜索成员名称或DID"
        style="width: 300px"
        @search="handleSearch"
      >
        <template #prefix>
          <SearchOutlined />
        </template>
      </a-input-search>

      <a-select
        v-model:value="roleFilter"
        placeholder="按角色筛选"
        style="width: 150px; margin-left: 12px"
        @change="handleFilter"
      >
        <a-select-option value="">全部角色</a-select-option>
        <a-select-option value="owner">所有者</a-select-option>
        <a-select-option value="admin">管理员</a-select-option>
        <a-select-option value="member">成员</a-select-option>
        <a-select-option value="viewer">访客</a-select-option>
      </a-select>
    </div>

    <!-- 成员列表 -->
    <a-table
      :columns="columns"
      :data-source="filteredMembers"
      :loading="loading"
      :pagination="pagination"
      :scroll="{ x: 1000 }"
      row-key="member_did"
      class="members-table"
    >
      <!-- 成员列 -->
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'member'">
          <div class="member-cell">
            <a-avatar :src="record.avatar" :size="40">
              <template #icon v-if="!record.avatar">
                <UserOutlined />
              </template>
            </a-avatar>
            <div class="member-info">
              <div class="member-name">
                {{ record.display_name }}
                <a-tag v-if="record.member_did === currentUserDID" color="blue" size="small">
                  我
                </a-tag>
              </div>
              <div class="member-did">{{ formatDID(record.member_did) }}</div>
            </div>
          </div>
        </template>

        <!-- 角色列 -->
        <template v-else-if="column.key === 'role'">
          <a-tag :color="getRoleColor(record.role)">
            {{ getRoleLabel(record.role) }}
          </a-tag>
        </template>

        <!-- 权限列 -->
        <template v-else-if="column.key === 'permissions'">
          <a-tooltip>
            <template #title>
              <div v-if="record.permissions_json">
                <div v-for="perm in parsePermissions(record.permissions_json)" :key="perm">
                  {{ perm }}
                </div>
              </div>
              <div v-else>使用角色默认权限</div>
            </template>
            <a-tag color="default">
              {{ getPermissionCount(record) }} 项权限
            </a-tag>
          </a-tooltip>
        </template>

        <!-- 状态列 -->
        <template v-else-if="column.key === 'status'">
          <a-badge
            :status="record.is_active ? 'success' : 'default'"
            :text="record.is_active ? '正常' : '已停用'"
          />
        </template>

        <!-- 加入时间列 -->
        <template v-else-if="column.key === 'joined_at'">
          {{ formatDate(record.joined_at) }}
        </template>

        <!-- 操作列 -->
        <template v-else-if="column.key === 'actions'">
          <a-space>
            <!-- 修改角色 -->
            <a-button
              v-if="record.member_did !== currentUserDID"
              v-permission="'member.manage'"
              size="small"
              @click="showChangeRoleModal(record)"
            >
              <EditOutlined />
              修改角色
            </a-button>

            <!-- 查看详情 -->
            <a-button size="small" @click="showMemberDetail(record)">
              <EyeOutlined />
              详情
            </a-button>

            <!-- 移除成员 -->
            <a-popconfirm
              v-if="record.member_did !== currentUserDID && record.role !== 'owner'"
              title="确定要移除该成员吗？"
              @confirm="handleRemoveMember(record)"
            >
              <a-button
                v-permission="'member.remove'"
                size="small"
                danger
              >
                <DeleteOutlined />
                移除
              </a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 邀请成员对话框 -->
    <a-modal
      v-model:open="showInviteModal"
      title="邀请成员"
      :confirm-loading="inviteLoading"
      @ok="handleCreateInvitation"
    >
      <a-form :model="inviteForm" layout="vertical">
        <a-form-item label="邀请方式">
          <a-radio-group v-model:value="inviteForm.method">
            <a-radio value="code">邀请码</a-radio>
            <a-radio value="did" disabled>DID直接邀请（开发中）</a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item label="默认角色" required>
          <a-select v-model:value="inviteForm.role">
            <a-select-option value="member">成员</a-select-option>
            <a-select-option value="viewer">访客</a-select-option>
            <a-select-option value="admin" v-if="currentUserRole === 'owner'">
              管理员
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="最大使用次数">
          <a-input-number
            v-model:value="inviteForm.maxUses"
            :min="1"
            :max="999"
            style="width: 100%"
          />
        </a-form-item>

        <a-form-item label="过期时间">
          <a-radio-group v-model:value="inviteForm.expireOption">
            <a-radio value="never">永不过期</a-radio>
            <a-radio value="1day">1天</a-radio>
            <a-radio value="7days">7天</a-radio>
            <a-radio value="30days">30天</a-radio>
          </a-radio-group>
        </a-form-item>

        <!-- 显示生成的邀请码 -->
        <a-alert
          v-if="generatedInviteCode"
          type="success"
          :message="`邀请码：${generatedInviteCode}`"
          description="请复制此邀请码分享给新成员"
          show-icon
          style="margin-top: 16px"
        >
          <template #action>
            <a-button size="small" @click="copyInviteCode">
              <CopyOutlined />
              复制
            </a-button>
          </template>
        </a-alert>
      </a-form>
    </a-modal>

    <!-- 修改角色对话框 -->
    <a-modal
      v-model:open="showRoleModal"
      title="修改成员角色"
      :confirm-loading="roleLoading"
      @ok="handleUpdateRole"
    >
      <div v-if="selectedMember" style="margin-bottom: 16px">
        <div class="member-cell">
          <a-avatar :src="selectedMember.avatar" :size="48">
            <template #icon v-if="!selectedMember.avatar">
              <UserOutlined />
            </template>
          </a-avatar>
          <div class="member-info">
            <div class="member-name">{{ selectedMember.display_name }}</div>
            <div class="member-did">{{ formatDID(selectedMember.member_did) }}</div>
          </div>
        </div>
      </div>

      <a-form layout="vertical">
        <a-form-item label="选择新角色" required>
          <a-select v-model:value="newRole" style="width: 100%">
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

        <a-alert
          type="info"
          message="角色权限说明"
          description="访客只能查看内容；成员可以创建和编辑知识库；管理员可以管理成员和设置"
        />
      </a-form>
    </a-modal>

    <!-- 成员详情对话框 -->
    <a-modal
      v-model:open="showDetailModal"
      title="成员详情"
      :footer="null"
      width="600px"
    >
      <div v-if="selectedMember" class="member-detail">
        <div class="detail-header">
          <a-avatar :src="selectedMember.avatar" :size="80">
            <template #icon v-if="!selectedMember.avatar">
              <UserOutlined />
            </template>
          </a-avatar>
          <div class="detail-info">
            <h3>{{ selectedMember.display_name }}</h3>
            <a-tag :color="getRoleColor(selectedMember.role)">
              {{ getRoleLabel(selectedMember.role) }}
            </a-tag>
          </div>
        </div>

        <a-descriptions :column="1" bordered style="margin-top: 24px">
          <a-descriptions-item label="DID">
            {{ selectedMember.member_did }}
          </a-descriptions-item>
          <a-descriptions-item label="角色">
            {{ getRoleLabel(selectedMember.role) }}
          </a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-badge
              :status="selectedMember.is_active ? 'success' : 'default'"
              :text="selectedMember.is_active ? '正常' : '已停用'"
            />
          </a-descriptions-item>
          <a-descriptions-item label="加入时间">
            {{ formatDate(selectedMember.joined_at) }}
          </a-descriptions-item>
          <a-descriptions-item label="最后活跃">
            {{ selectedMember.last_active_at ? formatDate(selectedMember.last_active_at) : '未知' }}
          </a-descriptions-item>
          <a-descriptions-item label="权限">
            <div v-if="selectedMember.permissions_json">
              <a-tag
                v-for="perm in parsePermissions(selectedMember.permissions_json)"
                :key="perm"
                style="margin: 4px"
              >
                {{ perm }}
              </a-tag>
            </div>
            <span v-else>使用角色默认权限</span>
          </a-descriptions-item>
        </a-descriptions>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  TeamOutlined,
  UserOutlined,
  UserAddOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  CrownOutlined,
  SafetyOutlined,
  SafetyCertificateOutlined,
  HistoryOutlined,
  SettingOutlined,
} from '@ant-design/icons-vue';
import { useIdentityStore } from '@/stores/identity';

const route = useRoute();
const orgId = computed(() => route.params.orgId);

const identityStore = useIdentityStore();

// 状态
const loading = ref(false);
const members = ref([]);
const searchKeyword = ref('');
const roleFilter = ref('');
const showInviteModal = ref(false);
const showRoleModal = ref(false);
const showDetailModal = ref(false);
const inviteLoading = ref(false);
const roleLoading = ref(false);
const selectedMember = ref(null);
const newRole = ref('');
const generatedInviteCode = ref('');

// 邀请表单
const inviteForm = ref({
  method: 'code',
  role: 'member',
  maxUses: 10,
  expireOption: '30days',
});

// 当前用户信息
const currentUserDID = computed(() => identityStore.primaryDID);
const currentUserRole = computed(() => {
  if (!identityStore.isOrganizationContext) return null;
  const orgId = identityStore.currentOrgId;
  const org = identityStore.organizations.find(o => o.org_id === orgId);
  return org?.role || null;
});

// 权限检查
const canManageMembers = computed(() => {
  return ['owner', 'admin'].includes(currentUserRole.value);
});

const canInviteMembers = computed(() => {
  return canManageMembers.value;
});

// 统计
const onlineCount = computed(() => {
  // TODO: 实现在线状态检测
  return members.value.filter(m => m.is_active).length;
});

const adminCount = computed(() => {
  return members.value.filter(m => ['owner', 'admin'].includes(m.role)).length;
});

// 过滤后的成员列表
const filteredMembers = computed(() => {
  let result = members.value;

  // 搜索过滤
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(m =>
      m.display_name?.toLowerCase().includes(keyword) ||
      m.member_did?.toLowerCase().includes(keyword)
    );
  }

  // 角色过滤
  if (roleFilter.value) {
    result = result.filter(m => m.role === roleFilter.value);
  }

  return result;
});

// 表格列定义
const columns = [
  {
    title: '成员',
    key: 'member',
    width: 250,
    fixed: 'left',
  },
  {
    title: '角色',
    key: 'role',
    width: 120,
  },
  {
    title: '权限',
    key: 'permissions',
    width: 120,
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
  },
  {
    title: '加入时间',
    key: 'joined_at',
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
  showQuickJumper: true,
  showTotal: (total) => `共 ${total} 条`,
});

// 加载成员列表
const loadMembers = async () => {
  if (!identityStore.isOrganizationContext) {
    message.warning('请先切换到组织身份');
    return;
  }

  loading.value = true;
  try {
    const orgId = identityStore.currentOrgId;
    const result = await window.ipc.invoke('org:get-members', orgId);
    members.value = result || [];
    pagination.value.total = members.value.length;
  } catch (error) {
    console.error('加载成员列表失败:', error);
    message.error('加载成员列表失败');
  } finally {
    loading.value = false;
  }
};

// 创建邀请
const handleCreateInvitation = async () => {
  inviteLoading.value = true;
  try {
    const orgId = identityStore.currentOrgId;

    // 计算过期时间
    let expireAt = null;
    if (inviteForm.value.expireOption !== 'never') {
      const days = {
        '1day': 1,
        '7days': 7,
        '30days': 30,
      }[inviteForm.value.expireOption];
      expireAt = Date.now() + days * 24 * 60 * 60 * 1000;
    }

    const invitation = await window.ipc.invoke('org:create-invitation', orgId, {
      invitedBy: currentUserDID.value,
      role: inviteForm.value.role,
      maxUses: inviteForm.value.maxUses,
      expireAt,
    });

    generatedInviteCode.value = invitation.invite_code;
    message.success('邀请码创建成功');
  } catch (error) {
    console.error('创建邀请失败:', error);
    message.error('创建邀请失败');
  } finally {
    inviteLoading.value = false;
  }
};

// 复制邀请码
const copyInviteCode = () => {
  navigator.clipboard.writeText(generatedInviteCode.value);
  message.success('邀请码已复制到剪贴板');
};

// 显示修改角色对话框
const showChangeRoleModal = (member) => {
  selectedMember.value = member;
  newRole.value = member.role;
  showRoleModal.value = true;
};

// 更新成员角色
const handleUpdateRole = async () => {
  roleLoading.value = true;
  try {
    const orgId = identityStore.currentOrgId;
    await window.ipc.invoke(
      'org:update-member-role',
      orgId,
      selectedMember.value.member_did,
      newRole.value
    );

    message.success('角色更新成功');
    showRoleModal.value = false;
    await loadMembers();
  } catch (error) {
    console.error('更新角色失败:', error);
    message.error('更新角色失败');
  } finally {
    roleLoading.value = false;
  }
};

// 移除成员
const handleRemoveMember = async (member) => {
  try {
    const orgId = identityStore.currentOrgId;
    await window.ipc.invoke('org:remove-member', orgId, member.member_did);

    message.success('成员已移除');
    await loadMembers();
  } catch (error) {
    console.error('移除成员失败:', error);
    message.error('移除成员失败');
  }
};

// 显示成员详情
const showMemberDetail = (member) => {
  selectedMember.value = member;
  showDetailModal.value = true;
};

// 搜索
const handleSearch = () => {
  // 搜索由computed自动处理
};

// 过滤
const handleFilter = () => {
  // 过滤由computed自动处理
};

// 工具函数
const formatDID = (did) => {
  if (!did) return '';
  if (did.length > 30) {
    return did.substring(0, 15) + '...' + did.substring(did.length - 10);
  }
  return did;
};

const formatDate = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
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

const parsePermissions = (permissionsJson) => {
  try {
    const perms = JSON.parse(permissionsJson);
    return Array.isArray(perms) ? perms : [];
  } catch {
    return [];
  }
};

const getPermissionCount = (member) => {
  if (member.permissions_json) {
    return parsePermissions(member.permissions_json).length;
  }
  // 返回默认权限数量
  const defaultCounts = {
    owner: '全部',
    admin: 15,
    member: 8,
    viewer: 3,
  };
  return defaultCounts[member.role] || 0;
};

// 生命周期
onMounted(async () => {
  await loadMembers();
});
</script>

<style scoped lang="scss">
.organization-members-page {
  padding: 24px;
  background: #f0f2f5;
  min-height: 100vh;

  .org-nav {
    background: white;
    padding: 16px 24px;
    margin-bottom: 16px;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);

    .nav-link {
      color: #595959;
      font-size: 14px;
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 4px;
      transition: all 0.3s;
      display: inline-flex;
      align-items: center;
      gap: 6px;

      &:hover {
        color: #1890ff;
        background: #e6f7ff;
      }

      &.active,
      &.router-link-active {
        color: #1890ff;
        background: #e6f7ff;
        font-weight: 500;
      }

      .anticon {
        font-size: 16px;
      }
    }
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

  .members-table {
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    padding: 24px;

    .member-cell {
      display: flex;
      align-items: center;
      gap: 12px;

      .member-info {
        flex: 1;

        .member-name {
          font-weight: 500;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .member-did {
          font-size: 12px;
          color: #8c8c8c;
          margin-top: 4px;
        }
      }
    }
  }

  .member-detail {
    .detail-header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
      background: #f5f5f5;
      border-radius: 8px;

      .detail-info {
        h3 {
          margin: 0 0 8px 0;
          font-size: 18px;
        }
      }
    }
  }
}
</style>
