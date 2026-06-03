<template>
  <div class="message-queue-page">
    <a-page-header
      title="消息队列管理"
      subtitle="查看和管理待发送和待接收的消息"
      @back="handleBack"
    >
      <template #extra>
        <a-button @click="handleRefresh">
          <ReloadOutlined />
          刷新
        </a-button>
        <a-button
          type="primary"
          @click="handleRetryAll"
        >
          <RedoOutlined />
          重试全部
        </a-button>
      </template>
    </a-page-header>

    <div class="queue-content">
      <a-row :gutter="24">
        <!-- Outgoing Messages -->
        <a-col
          :xs="24"
          :lg="12"
        >
          <a-card
            title="待发送消息"
            class="queue-card"
          >
            <template #extra>
              <a-space>
                <a-badge
                  :count="outgoingMessages.length"
                  :number-style="{ backgroundColor: '#52c41a' }"
                />
                <a-button
                  size="small"
                  danger
                  @click="handleClearCompleted('outgoing')"
                >
                  清空已完成
                </a-button>
              </a-space>
            </template>

            <a-spin :spinning="loading">
              <a-list
                v-if="outgoingMessages.length > 0"
                :data-source="outgoingMessages"
                :pagination="{ pageSize: 5 }"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <template #actions>
                      <a-tooltip title="重试">
                        <a-button
                          v-if="item.status === 'error' || item.status === 'pending'"
                          size="small"
                          type="text"
                          @click="handleRetry(item)"
                        >
                          <RedoOutlined />
                        </a-button>
                      </a-tooltip>
                      <a-tooltip title="取消">
                        <a-button
                          v-if="item.status !== 'completed' && item.status !== 'cancelled'"
                          size="small"
                          type="text"
                          danger
                          @click="handleCancel(item)"
                        >
                          <StopOutlined />
                        </a-button>
                      </a-tooltip>
                      <a-tooltip title="删除">
                        <a-button
                          size="small"
                          type="text"
                          danger
                          @click="handleDelete(item)"
                        >
                          <DeleteOutlined />
                        </a-button>
                      </a-tooltip>
                    </template>

                    <a-list-item-meta>
                      <template #title>
                        <div class="message-title">
                          <MessageOutlined style="margin-right: 8px" />
                          <span class="message-preview">{{ getMessagePreview(item) }}</span>
                          <a-tag
                            :color="getStatusColor(item.status)"
                            style="margin-left: 8px"
                          >
                            {{ getStatusText(item.status) }}
                          </a-tag>
                        </div>
                      </template>
                      <template #description>
                        <div class="message-info">
                          <div><strong>接收方:</strong> {{ item.recipientName || item.recipientId }}</div>
                          <div><strong>时间:</strong> {{ formatDateTime(item.timestamp) }}</div>
                          <div v-if="item.retryCount > 0">
                            <strong>重试次数:</strong> {{ item.retryCount }}
                          </div>
                          <div
                            v-if="item.error"
                            class="error-message"
                          >
                            <ExclamationCircleOutlined />
                            {{ item.error }}
                          </div>
                        </div>
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>
              <a-empty
                v-else
                description="没有待发送消息"
              />
            </a-spin>
          </a-card>
        </a-col>

        <!-- Incoming Messages -->
        <a-col
          :xs="24"
          :lg="12"
        >
          <a-card
            title="待接收消息"
            class="queue-card"
          >
            <template #extra>
              <a-space>
                <a-badge
                  :count="incomingMessages.length"
                  :number-style="{ backgroundColor: '#1890ff' }"
                />
                <a-button
                  size="small"
                  danger
                  @click="handleClearCompleted('incoming')"
                >
                  清空已完成
                </a-button>
              </a-space>
            </template>

            <a-spin :spinning="loading">
              <a-list
                v-if="incomingMessages.length > 0"
                :data-source="incomingMessages"
                :pagination="{ pageSize: 5 }"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <template #actions>
                      <a-tooltip title="接受">
                        <a-button
                          v-if="item.status === 'pending'"
                          size="small"
                          type="primary"
                          @click="handleAccept(item)"
                        >
                          <CheckOutlined />
                        </a-button>
                      </a-tooltip>
                      <a-tooltip title="拒绝">
                        <a-button
                          v-if="item.status === 'pending'"
                          size="small"
                          danger
                          @click="handleReject(item)"
                        >
                          <CloseOutlined />
                        </a-button>
                      </a-tooltip>
                      <a-tooltip title="删除">
                        <a-button
                          size="small"
                          type="text"
                          danger
                          @click="handleDelete(item)"
                        >
                          <DeleteOutlined />
                        </a-button>
                      </a-tooltip>
                    </template>

                    <a-list-item-meta>
                      <template #title>
                        <div class="message-title">
                          <MessageOutlined style="margin-right: 8px" />
                          <span class="message-preview">{{ getMessagePreview(item) }}</span>
                          <a-tag
                            :color="getStatusColor(item.status)"
                            style="margin-left: 8px"
                          >
                            {{ getStatusText(item.status) }}
                          </a-tag>
                        </div>
                      </template>
                      <template #description>
                        <div class="message-info">
                          <div><strong>发送方:</strong> {{ item.senderName || item.senderId }}</div>
                          <div><strong>时间:</strong> {{ formatDateTime(item.timestamp) }}</div>
                          <div v-if="item.encrypted">
                            <LockOutlined />
                            已加密
                          </div>
                        </div>
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>
              <a-empty
                v-else
                description="没有待接收消息"
              />
            </a-spin>
          </a-card>
        </a-col>
      </a-row>

      <!-- Statistics -->
      <a-card
        title="队列统计"
        class="stats-card"
      >
        <a-row :gutter="16">
          <a-col
            :xs="12"
            :sm="6"
          >
            <a-statistic
              title="待发送"
              :value="outgoingPending"
              suffix="条"
            >
              <template #prefix>
                <SendOutlined style="color: #1890ff" />
              </template>
            </a-statistic>
          </a-col>
          <a-col
            :xs="12"
            :sm="6"
          >
            <a-statistic
              title="发送失败"
              :value="outgoingError"
              suffix="条"
            >
              <template #prefix>
                <ExclamationCircleOutlined style="color: #ff4d4f" />
              </template>
            </a-statistic>
          </a-col>
          <a-col
            :xs="12"
            :sm="6"
          >
            <a-statistic
              title="待接收"
              :value="incomingPending"
              suffix="条"
            >
              <template #prefix>
                <InboxOutlined style="color: #52c41a" />
              </template>
            </a-statistic>
          </a-col>
          <a-col
            :xs="12"
            :sm="6"
          >
            <a-statistic
              title="总计"
              :value="totalMessages"
              suffix="条"
            >
              <template #prefix>
                <MessageOutlined style="color: #722ed1" />
              </template>
            </a-statistic>
          </a-col>
        </a-row>
      </a-card>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import {
  ReloadOutlined,
  RedoOutlined,
  MessageOutlined,
  StopOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  LockOutlined,
  SendOutlined,
  InboxOutlined,
} from '@ant-design/icons-vue';

export default {
  name: 'MessageQueuePage',
  components: {
    ReloadOutlined,
    RedoOutlined,
    MessageOutlined,
    StopOutlined,
    DeleteOutlined,
    ExclamationCircleOutlined,
    CheckOutlined,
    CloseOutlined,
    LockOutlined,
    SendOutlined,
    InboxOutlined,
  },
  setup() {
    const router = useRouter();

    const loading = ref(false);
    const outgoingMessages = ref([]);
    const incomingMessages = ref([]);
    let refreshInterval = null;

    const outgoingPending = computed(() =>
      outgoingMessages.value.filter((m) => m.status === 'pending' || m.status === 'sending').length
    );

    const outgoingError = computed(() =>
      outgoingMessages.value.filter((m) => m.status === 'error').length
    );

    const incomingPending = computed(() =>
      incomingMessages.value.filter((m) => m.status === 'pending').length
    );

    const totalMessages = computed(() =>
      outgoingMessages.value.length + incomingMessages.value.length
    );

    const handleBack = () => {
      router.back();
    };

    const handleRefresh = async () => {
      loading.value = true;
      try {
        await loadQueues();
        message.success('刷新成功');
      } catch (error) {
        console.error('Refresh error:', error);
        message.error('刷新失败');
      } finally {
        loading.value = false;
      }
    };

    const handleRetryAll = async () => {
      const errorMessages = outgoingMessages.value.filter((m) => m.status === 'error');
      if (errorMessages.length === 0) {
        message.info('没有需要重试的消息');
        return;
      }

      try {
        for (const msg of errorMessages) {
          await window.electron.invoke('p2p:retry-message', {
            messageId: msg.id,
          });
          msg.status = 'pending';
          msg.retryCount = (msg.retryCount || 0) + 1;
        }
        message.success(`已重试 ${errorMessages.length} 条消息`);
      } catch (error) {
        console.error('Retry all error:', error);
        message.error('重试失败');
      }
    };

    const handleRetry = async (msg) => {
      try {
        await window.electron.invoke('p2p:retry-message', {
          messageId: msg.id,
        });
        msg.status = 'pending';
        msg.retryCount = (msg.retryCount || 0) + 1;
        message.success('已加入重试队列');
      } catch (error) {
        console.error('Retry error:', error);
        message.error('重试失败');
      }
    };

    const handleCancel = async (msg) => {
      try {
        await window.electron.invoke('p2p:cancel-message', {
          messageId: msg.id,
        });
        msg.status = 'cancelled';
        message.info('已取消');
      } catch (error) {
        console.error('Cancel error:', error);
        message.error('取消失败');
      }
    };

    const handleDelete = (msg) => {
      Modal.confirm({
        title: '确认删除',
        content: '确定要删除这条消息吗?',
        okText: '确认',
        cancelText: '取消',
        okType: 'danger',
        onOk: () => {
          outgoingMessages.value = outgoingMessages.value.filter((m) => m.id !== msg.id);
          incomingMessages.value = incomingMessages.value.filter((m) => m.id !== msg.id);
          message.success('已删除');
        },
      });
    };

    const handleAccept = async (msg) => {
      try {
        await window.electron.invoke('p2p:accept-message', {
          messageId: msg.id,
        });
        msg.status = 'accepted';
        message.success('已接受');
      } catch (error) {
        console.error('Accept error:', error);
        message.error('接受失败');
      }
    };

    const handleReject = async (msg) => {
      try {
        await window.electron.invoke('p2p:reject-message', {
          messageId: msg.id,
        });
        msg.status = 'rejected';
        message.info('已拒绝');
      } catch (error) {
        console.error('Reject error:', error);
        message.error('拒绝失败');
      }
    };

    const handleClearCompleted = (direction) => {
      Modal.confirm({
        title: '确认清空',
        content: '确定要清空所有已完成的消息吗?',
        okText: '确认',
        cancelText: '取消',
        okType: 'danger',
        onOk: () => {
          if (direction === 'outgoing') {
            outgoingMessages.value = outgoingMessages.value.filter(
              (m) => m.status !== 'completed' && m.status !== 'cancelled'
            );
          } else {
            incomingMessages.value = incomingMessages.value.filter(
              (m) => m.status !== 'accepted' && m.status !== 'rejected'
            );
          }
          message.success('已清空');
        },
      });
    };

    const getMessagePreview = (msg) => {
      if (msg.messageType === 'text') {
        return msg.content.substring(0, 50) + (msg.content.length > 50 ? '...' : '');
      }
      return `[${msg.messageType}]`;
    };

    const getStatusColor = (status) => {
      const colorMap = {
        pending: 'default',
        sending: 'blue',
        completed: 'success',
        error: 'error',
        cancelled: 'warning',
        accepted: 'success',
        rejected: 'warning',
      };
      return colorMap[status] || 'default';
    };

    const getStatusText = (status) => {
      const textMap = {
        pending: '等待中',
        sending: '发送中',
        completed: '已完成',
        error: '失败',
        cancelled: '已取消',
        accepted: '已接受',
        rejected: '已拒绝',
      };
      return textMap[status] || status;
    };

    const formatDateTime = (timestamp) => {
      return new Date(timestamp).toLocaleString('zh-CN');
    };

    const loadQueues = async () => {
      try {
        const result = await window.electron.invoke('p2p:get-message-queues');
        outgoingMessages.value = result.outgoing || generateDummyOutgoing();
        incomingMessages.value = result.incoming || generateDummyIncoming();
      } catch (error) {
        console.error('Load queues error:', error);
        outgoingMessages.value = generateDummyOutgoing();
        incomingMessages.value = generateDummyIncoming();
      }
    };

    const generateDummyOutgoing = () => {
      const messages = [];
      const statuses = ['pending', 'sending', 'error', 'completed'];

      for (let i = 0; i < 5; i++) {
        messages.push({
          id: 'out-' + i,
          messageType: 'text',
          content: '这是一条测试消息 ' + i,
          recipientId: 'peer-' + (i % 3),
          recipientName: 'Device ' + (i % 3),
          status: statuses[i % statuses.length],
          retryCount: Math.floor(Math.random() * 3),
          timestamp: Date.now() - Math.floor(Math.random() * 3600000),
          error: i % 4 === 2 ? '网络连接失败' : null,
        });
      }

      return messages;
    };

    const generateDummyIncoming = () => {
      const messages = [];
      const statuses = ['pending', 'accepted', 'rejected'];

      for (let i = 0; i < 3; i++) {
        messages.push({
          id: 'in-' + i,
          messageType: 'text',
          content: '收到的测试消息 ' + i,
          senderId: 'peer-' + (i % 2),
          senderName: 'Device ' + (i % 2),
          status: statuses[i % statuses.length],
          encrypted: true,
          timestamp: Date.now() - Math.floor(Math.random() * 3600000),
        });
      }

      return messages;
    };

    onMounted(() => {
      loadQueues();

      // Auto refresh every 10 seconds
      refreshInterval = setInterval(() => {
        loadQueues();
      }, 10000);
    });

    onUnmounted(() => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    });

    return {
      loading,
      outgoingMessages,
      incomingMessages,
      outgoingPending,
      outgoingError,
      incomingPending,
      totalMessages,
      handleBack,
      handleRefresh,
      handleRetryAll,
      handleRetry,
      handleCancel,
      handleDelete,
      handleAccept,
      handleReject,
      handleClearCompleted,
      getMessagePreview,
      getStatusColor,
      getStatusText,
      formatDateTime,
    };
  },
};
</script>

<style scoped lang="scss">
.message-queue-page {
  min-height: 100vh;
  background-color: #f0f2f5;

  .queue-content {
    padding: 24px;

    .queue-card {
      margin-bottom: 24px;

      .message-title {
        display: flex;
        align-items: center;

        .message-preview {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }

      .message-info {
        font-size: 12px;
        color: #8c8c8c;

        div {
          margin-bottom: 4px;
        }

        .error-message {
          color: #ff4d4f;
          margin-top: 8px;
        }
      }
    }

    .stats-card {
      margin-top: 24px;
    }
  }
}
</style>
