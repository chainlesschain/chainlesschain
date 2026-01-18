<template>
  <div class="offline-queue-manager">
    <a-card title="离线消息队列" :loading="loading">
      <template #extra>
        <a-space>
          <a-badge
            :count="queueStats.totalMessages"
            :number-style="{ backgroundColor: '#1890ff' }"
          >
            <a-button @click="loadQueue">
              <template #icon><ReloadOutlined /></template>
              刷新
            </a-button>
          </a-badge>
          <a-button
            @click="showRetryAllModal = true"
            :disabled="queueStats.totalMessages === 0"
          >
            <template #icon><SyncOutlined /></template>
            重试全部
          </a-button>
          <a-button
            danger
            @click="showClearAllModal = true"
            :disabled="queueStats.totalMessages === 0"
          >
            <template #icon><DeleteOutlined /></template>
            清空队列
          </a-button>
        </a-space>
      </template>

      <!-- 队列统计 -->
      <a-row :gutter="16" style="margin-bottom: 24px">
        <a-col :span="6">
          <a-statistic
            title="待发送消息"
            :value="queueStats.pendingMessages"
            :value-style="{ color: '#1890ff' }"
          >
            <template #prefix><ClockCircleOutlined /></template>
          </a-statistic>
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="发送中"
            :value="queueStats.sendingMessages"
            :value-style="{ color: '#faad14' }"
          >
            <template #prefix><LoadingOutlined /></template>
          </a-statistic>
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="失败消息"
            :value="queueStats.failedMessages"
            :value-style="{ color: '#ff4d4f' }"
          >
            <template #prefix><ExclamationCircleOutlined /></template>
          </a-statistic>
        </a-col>
        <a-col :span="6">
          <a-statistic title="总消息数" :value="queueStats.totalMessages">
            <template #prefix><InboxOutlined /></template>
          </a-statistic>
        </a-col>
      </a-row>

      <!-- 消息列表 -->
      <a-table
        :columns="columns"
        :data-source="queueMessages"
        :pagination="pagination"
        :loading="loading"
        row-key="id"
        @change="handleTableChange"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <a-tag :color="getStatusColor(record.status)">
              {{ getStatusText(record.status) }}
            </a-tag>
          </template>

          <template v-else-if="column.key === 'targetPeerId'">
            <a-typography-text copyable>{{
              shortenPeerId(record.targetPeerId)
            }}</a-typography-text>
          </template>

          <template v-else-if="column.key === 'content'">
            <a-tooltip :title="record.content">
              <span>{{ truncateContent(record.content) }}</span>
            </a-tooltip>
          </template>

          <template v-else-if="column.key === 'createdAt'">
            {{ formatTime(record.createdAt) }}
          </template>

          <template v-else-if="column.key === 'retryCount'">
            <a-badge
              :count="record.retryCount"
              :number-style="{
                backgroundColor: record.retryCount >= 3 ? '#ff4d4f' : '#faad14',
              }"
            />
          </template>

          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-tooltip title="重试发送">
                <a-button
                  type="link"
                  size="small"
                  :disabled="record.status === 'sending'"
                  @click="handleRetry(record)"
                >
                  <template #icon><SyncOutlined /></template>
                </a-button>
              </a-tooltip>
              <a-tooltip title="查看详情">
                <a-button
                  type="link"
                  size="small"
                  @click="handleViewDetails(record)"
                >
                  <template #icon><EyeOutlined /></template>
                </a-button>
              </a-tooltip>
              <a-tooltip title="删除">
                <a-button
                  type="link"
                  size="small"
                  danger
                  @click="handleDelete(record)"
                >
                  <template #icon><DeleteOutlined /></template>
                </a-button>
              </a-tooltip>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 消息详情对话框 -->
    <a-modal
      v-model:open="showDetailsModal"
      title="消息详情"
      width="600px"
      :footer="null"
    >
      <a-descriptions v-if="selectedMessage" bordered :column="1">
        <a-descriptions-item label="消息ID">
          <a-typography-text copyable>{{
            selectedMessage.id
          }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="目标节点">
          <a-typography-text copyable>{{
            selectedMessage.targetPeerId
          }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="设备ID">
          <a-typography-text copyable>{{
            selectedMessage.deviceId || "未指定"
          }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="状态">
          <a-tag :color="getStatusColor(selectedMessage.status)">
            {{ getStatusText(selectedMessage.status) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="重试次数">
          {{ selectedMessage.retryCount }} / 3
        </a-descriptions-item>
        <a-descriptions-item label="是否加密">
          <a-tag :color="selectedMessage.encrypted ? 'green' : 'default'">
            {{ selectedMessage.encrypted ? "是" : "否" }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="创建时间">
          {{ new Date(selectedMessage.createdAt).toLocaleString("zh-CN") }}
        </a-descriptions-item>
        <a-descriptions-item label="最后重试时间">
          {{
            selectedMessage.lastRetryAt
              ? new Date(selectedMessage.lastRetryAt).toLocaleString("zh-CN")
              : "未重试"
          }}
        </a-descriptions-item>
        <a-descriptions-item label="错误信息">
          <a-typography-text type="danger">{{
            selectedMessage.error || "无"
          }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="消息内容">
          <a-typography-paragraph :copyable="{ text: selectedMessage.content }">
            <pre style="white-space: pre-wrap; word-break: break-all">{{
              selectedMessage.content
            }}</pre>
          </a-typography-paragraph>
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>

    <!-- 重试全部确认对话框 -->
    <a-modal
      v-model:open="showRetryAllModal"
      title="重试全部消息"
      @ok="handleRetryAll"
    >
      <p>确定要重试发送所有待发送和失败的消息吗？</p>
      <p>
        共
        {{
          queueStats.pendingMessages + queueStats.failedMessages
        }}
        条消息将被重试。
      </p>
    </a-modal>

    <!-- 清空队列确认对话框 -->
    <a-modal
      v-model:open="showClearAllModal"
      title="清空队列"
      @ok="handleClearAll"
    >
      <a-alert
        message="警告"
        description="此操作将删除所有离线消息，包括待发送和失败的消息。此操作不可恢复！"
        type="warning"
        show-icon
        style="margin-bottom: 16px"
      />
      <p>确定要清空整个离线消息队列吗？</p>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import {
  ReloadOutlined,
  SyncOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
  LoadingOutlined,
  ExclamationCircleOutlined,
  InboxOutlined,
  EyeOutlined,
} from "@ant-design/icons-vue";

const { ipcRenderer } = window.electron || {};

// 状态
const loading = ref(false);
const queueMessages = ref([]);
const selectedMessage = ref(null);
const showDetailsModal = ref(false);
const showRetryAllModal = ref(false);
const showClearAllModal = ref(false);

// 分页
const pagination = ref({
  current: 1,
  pageSize: 10,
  total: 0,
  showSizeChanger: true,
  showTotal: (total) => `共 ${total} 条消息`,
});

// 表格列定义
const columns = [
  {
    title: "消息ID",
    dataIndex: "id",
    key: "id",
    width: 120,
    ellipsis: true,
  },
  {
    title: "目标节点",
    dataIndex: "targetPeerId",
    key: "targetPeerId",
    width: 150,
  },
  {
    title: "消息内容",
    dataIndex: "content",
    key: "content",
    ellipsis: true,
  },
  {
    title: "状态",
    dataIndex: "status",
    key: "status",
    width: 100,
  },
  {
    title: "重试次数",
    dataIndex: "retryCount",
    key: "retryCount",
    width: 100,
    align: "center",
  },
  {
    title: "创建时间",
    dataIndex: "createdAt",
    key: "createdAt",
    width: 180,
  },
  {
    title: "操作",
    key: "actions",
    width: 150,
    fixed: "right",
  },
];

// 队列统计
const queueStats = computed(() => {
  const pending = queueMessages.value.filter(
    (m) => m.status === "pending",
  ).length;
  const sending = queueMessages.value.filter(
    (m) => m.status === "sending",
  ).length;
  const failed = queueMessages.value.filter(
    (m) => m.status === "failed",
  ).length;

  return {
    pendingMessages: pending,
    sendingMessages: sending,
    failedMessages: failed,
    totalMessages: queueMessages.value.length,
  };
});

// 方法
async function loadQueue() {
  loading.value = true;
  try {
    const result = await ipcRenderer.invoke("p2p:get-message-queue");
    if (result.success) {
      queueMessages.value = result.messages || [];
      pagination.value.total = queueMessages.value.length;
    } else {
      message.error("加载离线队列失败: " + result.error);
    }
  } catch (error) {
    console.error("加载离线队列失败:", error);
    message.error("加载离线队列失败: " + error.message);
  } finally {
    loading.value = false;
  }
}

async function handleRetry(record) {
  try {
    const result = await ipcRenderer.invoke("p2p:retry-message", record.id);
    if (result.success) {
      message.success("消息已重新加入发送队列");
      await loadQueue();
    } else {
      message.error("重试失败: " + result.error);
    }
  } catch (error) {
    console.error("重试消息失败:", error);
    message.error("重试失败: " + error.message);
  }
}

async function handleRetryAll() {
  try {
    const result = await ipcRenderer.invoke("p2p:retry-all-messages");
    if (result.success) {
      message.success(`已重试 ${result.count} 条消息`);
      await loadQueue();
    } else {
      message.error("批量重试失败: " + result.error);
    }
  } catch (error) {
    console.error("批量重试失败:", error);
    message.error("批量重试失败: " + error.message);
  } finally {
    showRetryAllModal.value = false;
  }
}

async function handleDelete(record) {
  try {
    const result = await ipcRenderer.invoke("p2p:delete-message", record.id);
    if (result.success) {
      message.success("消息已删除");
      await loadQueue();
    } else {
      message.error("删除失败: " + result.error);
    }
  } catch (error) {
    console.error("删除消息失败:", error);
    message.error("删除失败: " + error.message);
  }
}

async function handleClearAll() {
  try {
    const result = await ipcRenderer.invoke("p2p:clear-message-queue");
    if (result.success) {
      message.success("离线队列已清空");
      await loadQueue();
    } else {
      message.error("清空队列失败: " + result.error);
    }
  } catch (error) {
    console.error("清空队列失败:", error);
    message.error("清空队列失败: " + error.message);
  } finally {
    showClearAllModal.value = false;
  }
}

function handleViewDetails(record) {
  selectedMessage.value = record;
  showDetailsModal.value = true;
}

function handleTableChange(paginationConfig) {
  pagination.value.current = paginationConfig.current;
  pagination.value.pageSize = paginationConfig.pageSize;
}

function getStatusColor(status) {
  const colorMap = {
    pending: "blue",
    sending: "orange",
    failed: "red",
    delivered: "green",
  };
  return colorMap[status] || "default";
}

function getStatusText(status) {
  const textMap = {
    pending: "待发送",
    sending: "发送中",
    failed: "失败",
    delivered: "已送达",
  };
  return textMap[status] || status;
}

function shortenPeerId(peerId) {
  if (!peerId) return "";
  if (peerId.length <= 20) return peerId;
  return `${peerId.substring(0, 10)}...${peerId.substring(peerId.length - 6)}`;
}

function truncateContent(content) {
  if (!content) return "";
  if (content.length <= 50) return content;
  return content.substring(0, 50) + "...";
}

function formatTime(timestamp) {
  if (!timestamp) return "";

  const now = Date.now();
  const diff = now - timestamp;

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return "刚刚";
  } else if (diff < hour) {
    return `${Math.floor(diff / minute)}分钟前`;
  } else if (diff < day) {
    return `${Math.floor(diff / hour)}小时前`;
  } else {
    const date = new Date(timestamp);
    return date.toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}

// 生命周期
onMounted(async () => {
  await loadQueue();

  // 监听队列变化事件
  ipcRenderer.on("p2p:queue-updated", async () => {
    await loadQueue();
  });
});
</script>

<style scoped>
.offline-queue-manager {
  padding: 24px;
  height: 100%;
  overflow: auto;
}
</style>
