<template>
  <div class="did-invitation-notifier">
    <!-- 邀请通知徽章 -->
    <a-badge :count="pendingCount" :offset="[-5, 5]">
      <a-button
        type="text"
        @click="showInvitationsDrawer = true"
        :disabled="pendingCount === 0"
      >
        <template #icon>
          <BellOutlined :class="{ 'bell-shake': pendingCount > 0 }" />
        </template>
        组织邀请
      </a-button>
    </a-badge>

    <!-- 邀请列表抽屉 -->
    <a-drawer
      v-model:open="showInvitationsDrawer"
      title="组织邀请"
      placement="right"
      width="450"
    >
      <div class="invitations-container">
        <!-- 待处理邀请 -->
        <div v-if="pendingInvitations.length > 0" class="pending-section">
          <h3 class="section-title">
            <MailOutlined />
            待处理 ({{ pendingInvitations.length }})
          </h3>

          <a-list
            :data-source="pendingInvitations"
            :loading="loading"
          >
            <template #renderItem="{ item }">
              <a-list-item class="invitation-item">
                <div class="invitation-card">
                  <!-- 组织信息 -->
                  <div class="org-header">
                    <a-avatar :size="48" class="org-avatar">
                      <template #icon>
                        <TeamOutlined />
                      </template>
                    </a-avatar>
                    <div class="org-info">
                      <h4>{{ item.org_name }}</h4>
                      <a-tag :color="getRoleColor(item.role)" size="small">
                        {{ getRoleLabel(item.role) }}
                      </a-tag>
                    </div>
                  </div>

                  <!-- 邀请人信息 -->
                  <div class="inviter-info">
                    <UserOutlined />
                    <span>{{ item.invited_by_name }}</span>
                    <span class="inviter-did">{{ formatDID(item.invited_by_did) }}</span>
                  </div>

                  <!-- 邀请消息 -->
                  <div class="invitation-message">
                    <MessageOutlined />
                    <span>{{ item.message }}</span>
                  </div>

                  <!-- 时间信息 -->
                  <div class="time-info">
                    <ClockCircleOutlined />
                    <span>{{ formatTimeAgo(item.created_at) }}</span>
                    <span v-if="item.expire_at" class="expire-warning">
                      • {{ formatExpireTime(item.expire_at) }}到期
                    </span>
                  </div>

                  <!-- 操作按钮 -->
                  <div class="action-buttons">
                    <a-button
                      type="primary"
                      @click="handleAccept(item)"
                      :loading="acceptingIds.includes(item.id)"
                    >
                      <CheckOutlined />
                      接受邀请
                    </a-button>
                    <a-button
                      danger
                      @click="handleReject(item)"
                      :loading="rejectingIds.includes(item.id)"
                    >
                      <CloseOutlined />
                      拒绝
                    </a-button>
                  </div>
                </div>
              </a-list-item>
            </template>
          </a-list>
        </div>

        <!-- 空状态 -->
        <a-empty
          v-else
          description="暂无待处理的邀请"
          style="margin-top: 100px"
        >
          <template #image>
            <InboxOutlined style="font-size: 64px; color: #d9d9d9" />
          </template>
        </a-empty>

        <!-- 历史记录按钮 -->
        <div class="history-section">
          <a-button block @click="showHistoryModal = true">
            <HistoryOutlined />
            查看历史邀请
          </a-button>
        </div>
      </div>
    </a-drawer>

    <!-- 历史邀请对话框 -->
    <a-modal
      v-model:open="showHistoryModal"
      title="历史邀请"
      :footer="null"
      width="600px"
    >
      <a-tabs v-model:activeKey="historyTab">
        <a-tab-pane key="accepted" tab="已接受">
          <a-list
            :data-source="acceptedInvitations"
            :loading="loadingHistory"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta>
                  <template #avatar>
                    <a-avatar>
                      <template #icon><TeamOutlined /></template>
                    </a-avatar>
                  </template>
                  <template #title>
                    {{ item.org_name }}
                    <a-tag color="green" size="small">已加入</a-tag>
                  </template>
                  <template #description>
                    邀请人：{{ item.invited_by_name }} • {{ formatDate(item.updated_at) }}
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>
          </a-list>
        </a-tab-pane>

        <a-tab-pane key="rejected" tab="已拒绝">
          <a-list
            :data-source="rejectedInvitations"
            :loading="loadingHistory"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta>
                  <template #avatar>
                    <a-avatar>
                      <template #icon><TeamOutlined /></template>
                    </a-avatar>
                  </template>
                  <template #title>
                    {{ item.org_name }}
                    <a-tag color="red" size="small">已拒绝</a-tag>
                  </template>
                  <template #description>
                    邀请人：{{ item.invited_by_name }} • {{ formatDate(item.updated_at) }}
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>
          </a-list>
        </a-tab-pane>

        <a-tab-pane key="expired" tab="已过期">
          <a-list
            :data-source="expiredInvitations"
            :loading="loadingHistory"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta>
                  <template #avatar>
                    <a-avatar>
                      <template #icon><TeamOutlined /></template>
                    </a-avatar>
                  </template>
                  <template #title>
                    {{ item.org_name }}
                    <a-tag color="default" size="small">已过期</a-tag>
                  </template>
                  <template #description>
                    邀请人：{{ item.invited_by_name }} • {{ formatDate(item.expire_at) }}
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>
          </a-list>
        </a-tab-pane>
      </a-tabs>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  BellOutlined,
  MailOutlined,
  UserOutlined,
  TeamOutlined,
  MessageOutlined,
  ClockCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  InboxOutlined,
  HistoryOutlined,
} from '@ant-design/icons-vue';
import { useIdentityStore } from '@/stores/identity';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const router = useRouter();
const identityStore = useIdentityStore();

// 状态
const loading = ref(false);
const loadingHistory = ref(false);
const showInvitationsDrawer = ref(false);
const showHistoryModal = ref(false);
const historyTab = ref('accepted');
const pendingInvitations = ref([]);
const acceptedInvitations = ref([]);
const rejectedInvitations = ref([]);
const expiredInvitations = ref([]);
const acceptingIds = ref([]);
const rejectingIds = ref([]);
let refreshInterval = null;

// 计算属性
const pendingCount = computed(() => pendingInvitations.value.length);

// 加载待处理邀请
const loadPendingInvitations = async () => {
  loading.value = true;
  try {
    const invitations = await window.ipc.invoke('org:get-pending-did-invitations');
    pendingInvitations.value = invitations || [];
  } catch (error) {
    console.error('加载待处理邀请失败:', error);
  } finally {
    loading.value = false;
  }
};

// 加载历史邀请
const loadHistoryInvitations = async () => {
  loadingHistory.value = true;
  try {
    // 获取所有状态的邀请
    const allInvitations = await window.ipc.invoke('org:get-pending-did-invitations');

    // TODO: 实现获取所有邀请（包括已接受、已拒绝）的API
    // 暂时使用模拟数据
    acceptedInvitations.value = [];
    rejectedInvitations.value = [];
    expiredInvitations.value = [];
  } catch (error) {
    console.error('加载历史邀请失败:', error);
  } finally {
    loadingHistory.value = false;
  }
};

// 接受邀请
const handleAccept = async (invitation) => {
  acceptingIds.value.push(invitation.id);
  try {
    const org = await window.ipc.invoke('org:accept-did-invitation', invitation.id);

    message.success(`成功加入组织 ${org.name}`);

    // 从待处理列表移除
    pendingInvitations.value = pendingInvitations.value.filter(
      inv => inv.id !== invitation.id
    );

    // 刷新组织列表
    await identityStore.loadUserOrganizations();

    // 询问是否立即切换到新组织
    const switchNow = await new Promise(resolve => {
      message.info({
        content: '是否立即切换到新加入的组织？',
        duration: 5,
        onClose: () => resolve(false),
        onClick: () => {
          resolve(true);
          return false;
        },
      });
      setTimeout(() => resolve(false), 5000);
    });

    if (switchNow) {
      await identityStore.switchContext(`org_${org.org_id}`);
      router.push('/organization/members');
      showInvitationsDrawer.value = false;
    }
  } catch (error) {
    console.error('接受邀请失败:', error);
    message.error(`接受邀请失败: ${error.message}`);
  } finally {
    acceptingIds.value = acceptingIds.value.filter(id => id !== invitation.id);
  }
};

// 拒绝邀请
const handleReject = async (invitation) => {
  rejectingIds.value.push(invitation.id);
  try {
    await window.ipc.invoke('org:reject-did-invitation', invitation.id);

    message.info(`已拒绝来自 ${invitation.org_name} 的邀请`);

    // 从待处理列表移除
    pendingInvitations.value = pendingInvitations.value.filter(
      inv => inv.id !== invitation.id
    );
  } catch (error) {
    console.error('拒绝邀请失败:', error);
    message.error(`拒绝邀请失败: ${error.message}`);
  } finally {
    rejectingIds.value = rejectingIds.value.filter(id => id !== invitation.id);
  }
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
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm');
};

const formatTimeAgo = (timestamp) => {
  if (!timestamp) return '';
  return dayjs(timestamp).fromNow();
};

const formatExpireTime = (timestamp) => {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = timestamp - now;

  if (diff < 0) return '已过期';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}天后`;
  if (hours > 0) return `${hours}小时后`;
  return '即将';
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

// 生命周期
onMounted(async () => {
  await loadPendingInvitations();

  // 每30秒刷新一次
  refreshInterval = setInterval(() => {
    loadPendingInvitations();
  }, 30000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});

// 暴露给父组件
defineExpose({
  refresh: loadPendingInvitations,
});
</script>

<style scoped lang="scss">
.did-invitation-notifier {
  .bell-shake {
    animation: shake 0.5s ease-in-out infinite;
  }

  @keyframes shake {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(-10deg); }
    75% { transform: rotate(10deg); }
  }
}

.invitations-container {
  .pending-section {
    margin-bottom: 24px;

    .section-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      font-size: 16px;
      font-weight: 600;
      color: #1890ff;
    }
  }

  .invitation-item {
    padding: 0;
    border: none;

    .invitation-card {
      width: 100%;
      padding: 16px;
      background: #fafafa;
      border-radius: 8px;
      border: 1px solid #e8e8e8;
      transition: all 0.3s;

      &:hover {
        border-color: #1890ff;
        box-shadow: 0 2px 8px rgba(24, 144, 255, 0.15);
      }

      .org-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;

        .org-avatar {
          background: #1890ff;
          flex-shrink: 0;
        }

        .org-info {
          flex: 1;

          h4 {
            margin: 0 0 4px 0;
            font-size: 16px;
            font-weight: 600;
          }
        }
      }

      .inviter-info,
      .invitation-message,
      .time-info {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        font-size: 13px;
        color: #595959;

        .inviter-did {
          color: #8c8c8c;
          font-size: 12px;
        }

        .expire-warning {
          color: #fa8c16;
          font-weight: 500;
        }
      }

      .action-buttons {
        display: flex;
        gap: 8px;
        margin-top: 16px;

        button {
          flex: 1;
        }
      }
    }
  }

  .history-section {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid #e8e8e8;
  }
}
</style>
