<template>
  <div class="organization-members">
    <div class="members-header">
      <h2>成员管理</h2>
      <a-space>
        <a-input-search
          v-model:value="searchText"
          placeholder="搜索成员..."
          style="width: 250px"
          @search="handleSearch"
        />
        <a-select
          v-model:value="filterRole"
          placeholder="筛选角色"
          style="width: 150px"
          allow-clear
        >
          <a-select-option value="">
            全部角色
          </a-select-option>
          <a-select-option value="owner">
            所有者
          </a-select-option>
          <a-select-option value="admin">
            管理员
          </a-select-option>
          <a-select-option value="member">
            成员
          </a-select-option>
          <a-select-option value="viewer">
            访客
          </a-select-option>
        </a-select>
        <a-button
          type="primary"
          :disabled="!canInvite"
          @click="emit('invite')"
        >
          <template #icon>
            <UserAddOutlined />
          </template>
          邀请成员
        </a-button>
      </a-space>
    </div>

    <a-table
      :columns="columns"
      :data-source="filteredMembers"
      :loading="loading"
      :pagination="pagination"
      row-key="member_did"
      @change="handleTableChange"
    >
      <template #bodyCell="{ column, record }">
        <!-- 成员信息 -->
        <template v-if="column.key === 'member'">
          <div class="member-info">
            <a-avatar
              :src="record.avatar"
              :size="40"
            >
              <template #icon>
                <UserOutlined />
              </template>
            </a-avatar>
            <div class="member-details">
              <div class="member-name">
                {{ record.display_name || shortenDID(record.member_did) }}
              </div>
              <div class="member-did">
                {{ shortenDID(record.member_did) }}
                <a-tooltip title="复制DID">
                  <CopyOutlined
                    style="margin-left: 8px; cursor: pointer"
                    @click="copyToClipboard(record.member_did)"
                  />
                </a-tooltip>
              </div>
            </div>
          </div>
        </template>

        <!-- 角色 -->
        <template v-if="column.key === 'role'">
          <a-tag :color="getRoleColor(record.role)">
            {{ getRoleLabel(record.role) }}
          </a-tag>
        </template>

        <!-- 加入时间 -->
        <template v-if="column.key === 'joined_at'">
          {{ formatDate(record.joined_at) }}
        </template>

        <!-- 最后活跃 -->
        <template v-if="column.key === 'last_active_at'">
          <a-tooltip :title="formatDate(record.last_active_at)">
            {{ formatRelativeTime(record.last_active_at) }}
          </a-tooltip>
        </template>

        <!-- 状态 -->
        <template v-if="column.key === 'status'">
          <a-badge
            :status="record.is_active ? 'success' : 'default'"
            :text="record.is_active ? '活跃' : '离线'"
          />
        </template>

        <!-- 操作 -->
        <template v-if="column.key === 'actions'">
          <a-space>
            <!-- 更改角色 -->
            <a-dropdown v-if="canChangeRole(record)">
              <a-button size="small">
                更改角色
                <DownOutlined />
              </a-button>
              <template #overlay>
                <a-menu @click="({ key }) => handleChangeRole(record, key)">
                  <a-menu-item
                    key="owner"
                    :disabled="!canAssignOwner"
                  >
                    所有者
                  </a-menu-item>
                  <a-menu-item key="admin">
                    管理员
                  </a-menu-item>
                  <a-menu-item key="member">
                    成员
                  </a-menu-item>
                  <a-menu-item key="viewer">
                    访客
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>

            <!-- 移除成员 -->
            <a-popconfirm
              v-if="canRemoveMember(record)"
              title="确定要移除该成员吗？"
              ok-text="确定"
              cancel-text="取消"
              @confirm="handleRemoveMember(record)"
            >
              <a-button
                size="small"
                danger
              >
                移除
              </a-button>
            </a-popconfirm>

            <!-- 当前用户 -->
            <a-tag
              v-if="isCurrentUser(record)"
              color="blue"
            >
              当前用户
            </a-tag>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 成员详情抽屉 -->
    <a-drawer
      v-model:open="showMemberDetail"
      title="成员详情"
      width="500"
    >
      <div
        v-if="selectedMember"
        class="member-detail"
      >
        <a-descriptions
          :column="1"
          bordered
        >
          <a-descriptions-item label="头像">
            <a-avatar
              :src="selectedMember.avatar"
              :size="64"
            >
              <template #icon>
                <UserOutlined />
              </template>
            </a-avatar>
          </a-descriptions-item>
          <a-descriptions-item label="名称">
            {{ selectedMember.display_name || '-' }}
          </a-descriptions-item>
          <a-descriptions-item label="DID">
            <div style="word-break: break-all">
              {{ selectedMember.member_did }}
            </div>
          </a-descriptions-item>
          <a-descriptions-item label="角色">
            <a-tag :color="getRoleColor(selectedMember.role)">
              {{ getRoleLabel(selectedMember.role) }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="加入时间">
            {{ formatDate(selectedMember.joined_at) }}
          </a-descriptions-item>
          <a-descriptions-item label="最后活跃">
            {{ formatDate(selectedMember.last_active_at) }}
          </a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-badge
              :status="selectedMember.is_active ? 'success' : 'default'"
              :text="selectedMember.is_active ? '在线' : '离线'"
            />
          </a-descriptions-item>
        </a-descriptions>

        <!-- 活动历史 -->
        <div class="activity-section">
          <h3>最近活动</h3>
          <a-timeline>
            <a-timeline-item
              v-for="activity in memberActivities"
              :key="activity.activity_id"
            >
              <p>{{ activity.activity_type }}</p>
              <p style="color: #999; font-size: 12px">
                {{ formatDate(activity.activity_timestamp) }}
              </p>
            </a-timeline-item>
          </a-timeline>
        </div>
      </div>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { message } from 'ant-design-vue';
import { useIdentityStore } from '@/stores/identityStore';
import {
  UserOutlined,
  UserAddOutlined,
  DownOutlined,
  CopyOutlined
} from '@ant-design/icons-vue';

// ==================== Props & Emits ====================
const props = defineProps({
  orgId: {
    type: String,
    required: true
  }
});

const emit = defineEmits(['invite']);

// ==================== Store ====================
const identityStore = useIdentityStore();

// ==================== State ====================
const loading = ref(false);
const members = ref([]);
const searchText = ref('');
const filterRole = ref('');

const showMemberDetail = ref(false);
const selectedMember = ref(null);
const memberActivities = ref([]);

const pagination = ref({
  current: 1,
  pageSize: 10,
  total: 0,
  showSizeChanger: true,
  showTotal: total => `共 ${total} 名成员`
});

// ==================== Computed ====================
const currentUserRole = computed(() => {
  const member = members.value.find(
    m => m.member_did === identityStore.currentUserDID
  );
  return member?.role || 'viewer';
});

const canInvite = computed(() => {
  return ['owner', 'admin'].includes(currentUserRole.value);
});

const canAssignOwner = computed(() => {
  return currentUserRole.value === 'owner';
});

const filteredMembers = computed(() => {
  let result = members.value;

  // 搜索过滤
  if (searchText.value) {
    const query = searchText.value.toLowerCase();
    result = result.filter(m =>
      m.display_name?.toLowerCase().includes(query) ||
      m.member_did.toLowerCase().includes(query)
    );
  }

  // 角色过滤
  if (filterRole.value) {
    result = result.filter(m => m.role === filterRole.value);
  }

  return result;
});

const columns = [
  { title: '成员', key: 'member', width: 300 },
  { title: '角色', key: 'role', width: 120 },
  { title: '加入时间', key: 'joined_at', width: 180 },
  { title: '最后活跃', key: 'last_active_at', width: 150 },
  { title: '状态', key: 'status', width: 100 },
  { title: '操作', key: 'actions', width: 200, fixed: 'right' }
];

// ==================== Methods ====================

/**
 * 加载成员列表
 */
async function loadMembers() {
  try {
    loading.value = true;

    const result = await window.electron.ipcRenderer.invoke('org:get-members', props.orgId);

    if (result.success) {
      members.value = result.members;
      pagination.value.total = result.members.length;
    } else {
      message.error(result.error || '加载成员列表失败');
    }
  } catch (error) {
    console.error('加载成员列表失败:', error);
    message.error('加载成员列表失败');
  } finally {
    loading.value = false;
  }
}

/**
 * 搜索
 */
function handleSearch() {
  pagination.value.current = 1;
}

/**
 * 表格变化
 */
function handleTableChange(pag) {
  pagination.value = pag;
}

/**
 * 更改角色
 */
async function handleChangeRole(member, newRole) {
  if (member.role === newRole) {
    return;
  }

  try {
    const result = await window.electron.ipcRenderer.invoke('org:update-member-role', {
      orgId: props.orgId,
      memberDID: member.member_did,
      newRole
    });

    if (result.success) {
      message.success('角色更新成功');
      await loadMembers();
    } else {
      message.error(result.error || '角色更新失败');
    }
  } catch (error) {
    console.error('更改角色失败:', error);
    message.error('更改角色失败');
  }
}

/**
 * 移除成员
 */
async function handleRemoveMember(member) {
  try {
    const result = await window.electron.ipcRenderer.invoke('org:remove-member', {
      orgId: props.orgId,
      memberDID: member.member_did
    });

    if (result.success) {
      message.success('成员已移除');
      await loadMembers();
    } else {
      message.error(result.error || '移除成员失败');
    }
  } catch (error) {
    console.error('移除成员失败:', error);
    message.error('移除成员失败');
  }
}

/**
 * 检查是否可以更改角色
 */
function canChangeRole(member) {
  // 所有者可以更改所有人的角色
  if (currentUserRole.value === 'owner') {
    return member.member_did !== identityStore.currentUserDID;
  }

  // 管理员可以更改成员和访客的角色
  if (currentUserRole.value === 'admin') {
    return ['member', 'viewer'].includes(member.role) &&
           member.member_did !== identityStore.currentUserDID;
  }

  return false;
}

/**
 * 检查是否可以移除成员
 */
function canRemoveMember(member) {
  // 不能移除自己
  if (member.member_did === identityStore.currentUserDID) {
    return false;
  }

  // 不能移除所有者
  if (member.role === 'owner') {
    return false;
  }

  // 所有者和管理员可以移除成员
  return ['owner', 'admin'].includes(currentUserRole.value);
}

/**
 * 是否是当前用户
 */
function isCurrentUser(member) {
  return member.member_did === identityStore.currentUserDID;
}

/**
 * 查看成员详情
 */
async function handleViewMemberDetail(member) {
  selectedMember.value = member;
  showMemberDetail.value = true;

  // 加载成员活动历史
  try {
    const result = await window.electron.ipcRenderer.invoke('org:get-member-activities', {
      orgId: props.orgId,
      memberDID: member.member_did,
      limit: 10
    });

    if (result.success) {
      memberActivities.value = result.activities;
    }
  } catch (error) {
    console.error('加载活动历史失败:', error);
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

/**
 * 缩短DID显示
 */
function shortenDID(did) {
  if (!did) {return '';}
  if (did.length <= 20) {return did;}
  return `${did.slice(0, 10)}...${did.slice(-8)}`;
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
  if (!timestamp) {return '-';}
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

/**
 * 格式化相对时间
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) {return '-';}

  const now = Date.now();
  const diff = now - timestamp;

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return '刚刚';
  } else if (diff < hour) {
    return `${Math.floor(diff / minute)} 分钟前`;
  } else if (diff < day) {
    return `${Math.floor(diff / hour)} 小时前`;
  } else if (diff < 7 * day) {
    return `${Math.floor(diff / day)} 天前`;
  } else {
    return formatDate(timestamp);
  }
}

// ==================== Lifecycle ====================
onMounted(async () => {
  await loadMembers();
});

// 监听组织ID变化
watch(() => props.orgId, async (newOrgId) => {
  if (newOrgId) {
    await loadMembers();
  }
});
</script>

<style scoped lang="less">
.organization-members {
  .members-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;

    h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }
  }

  .member-info {
    display: flex;
    align-items: center;
    gap: 12px;

    .member-details {
      .member-name {
        font-weight: 500;
        font-size: 14px;
        color: #333;
      }

      .member-did {
        font-size: 12px;
        color: #999;
        margin-top: 4px;
      }
    }
  }

  .member-detail {
    .activity-section {
      margin-top: 24px;

      h3 {
        margin-bottom: 16px;
        font-size: 16px;
        font-weight: 600;
      }
    }
  }
}
</style>
