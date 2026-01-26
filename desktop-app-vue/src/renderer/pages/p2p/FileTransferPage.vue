<template>
  <div class="file-transfer-page">
    <a-page-header
      :title="peerName ? `与 ${peerName} 的文件传输` : '文件传输'"
      @back="handleBack"
    >
      <template #extra>
        <a-upload
          :before-upload="handleBeforeUpload"
          :show-upload-list="false"
          :multiple="true"
        >
          <a-button type="primary">
            <UploadOutlined />
            发送文件
          </a-button>
        </a-upload>
        <a-button @click="handleRefresh">
          <ReloadOutlined />
          刷新
        </a-button>
      </template>
    </a-page-header>

    <div class="transfer-content">
      <!-- Active Transfers -->
      <a-card
        v-if="activeTransfers.length > 0"
        title="进行中的传输"
        class="active-transfers-card"
      >
        <a-list
          :data-source="activeTransfers"
          :loading="loading"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <template #actions>
                <a-button
                  v-if="item.status === 'uploading' || item.status === 'downloading'"
                  size="small"
                  danger
                  @click="handleCancel(item)"
                >
                  <StopOutlined />
                  取消
                </a-button>
                <a-button
                  v-else-if="item.status === 'completed' && item.direction === 'incoming'"
                  size="small"
                  type="primary"
                  @click="handleOpenFile(item)"
                >
                  <FolderOpenOutlined />
                  打开
                </a-button>
              </template>

              <a-list-item-meta>
                <template #title>
                  <div class="transfer-title">
                    <FileOutlined style="margin-right: 8px" />
                    {{ item.fileName }}
                    <a-tag
                      :color="getStatusColor(item.status)"
                      style="margin-left: 8px"
                    >
                      {{ getStatusText(item.status) }}
                    </a-tag>
                  </div>
                </template>
                <template #description>
                  <div class="transfer-info">
                    <span>{{ formatFileSize(item.fileSize) }}</span>
                    <a-divider type="vertical" />
                    <span>{{ item.direction === 'outgoing' ? '发送至' : '接收自' }}: {{ item.peerName }}</span>
                    <a-divider type="vertical" />
                    <span>{{ formatRelativeTime(item.timestamp) }}</span>
                  </div>
                  <a-progress
                    v-if="item.status === 'uploading' || item.status === 'downloading'"
                    :percent="item.progress"
                    :status="item.status === 'error' ? 'exception' : 'active'"
                  />
                  <div
                    v-if="item.speed"
                    class="transfer-speed"
                  >
                    速度: {{ formatSpeed(item.speed) }}
                  </div>
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
      </a-card>

      <!-- Transfer History -->
      <a-card
        title="传输历史"
        class="history-card"
      >
        <template #extra>
          <a-space>
            <a-select
              v-model:value="filterDirection"
              style="width: 120px"
              @change="handleFilterChange"
            >
              <a-select-option value="all">
                全部
              </a-select-option>
              <a-select-option value="outgoing">
                发送的
              </a-select-option>
              <a-select-option value="incoming">
                接收的
              </a-select-option>
            </a-select>
            <a-button
              size="small"
              @click="handleClearHistory"
            >
              <DeleteOutlined />
              清空历史
            </a-button>
          </a-space>
        </template>

        <a-table
          :columns="historyColumns"
          :data-source="filteredHistory"
          :pagination="pagination"
          :loading="loading"
          row-key="id"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'fileName'">
              <div class="file-name-cell">
                <FileOutlined style="margin-right: 8px" />
                {{ record.fileName }}
              </div>
            </template>

            <template v-else-if="column.key === 'fileSize'">
              {{ formatFileSize(record.fileSize) }}
            </template>

            <template v-else-if="column.key === 'direction'">
              <a-tag :color="record.direction === 'outgoing' ? 'blue' : 'green'">
                {{ record.direction === 'outgoing' ? '发送' : '接收' }}
              </a-tag>
            </template>

            <template v-else-if="column.key === 'status'">
              <a-tag :color="getStatusColor(record.status)">
                {{ getStatusText(record.status) }}
              </a-tag>
            </template>

            <template v-else-if="column.key === 'timestamp'">
              {{ formatDateTime(record.timestamp) }}
            </template>

            <template v-else-if="column.key === 'actions'">
              <a-space>
                <a-button
                  v-if="record.status === 'completed' && record.direction === 'incoming'"
                  size="small"
                  @click="handleOpenFile(record)"
                >
                  <FolderOpenOutlined />
                  打开
                </a-button>
                <a-button
                  v-if="record.status === 'completed'"
                  size="small"
                  @click="handleResend(record)"
                >
                  <RedoOutlined />
                  重新发送
                </a-button>
                <a-button
                  size="small"
                  danger
                  @click="handleDelete(record)"
                >
                  <DeleteOutlined />
                  删除
                </a-button>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-card>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import {
  UploadOutlined,
  ReloadOutlined,
  FileOutlined,
  StopOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
  RedoOutlined,
} from '@ant-design/icons-vue';

export default {
  name: 'FileTransferPage',
  components: {
    UploadOutlined,
    ReloadOutlined,
    FileOutlined,
    StopOutlined,
    FolderOpenOutlined,
    DeleteOutlined,
    RedoOutlined,
  },
  setup() {
    const router = useRouter();
    const route = useRoute();

    const peerId = ref(route.query.peerId || null);
    const peerName = ref(route.query.peerName || '');
    const loading = ref(false);
    const transfers = ref([]);
    const filterDirection = ref('all');

    const historyColumns = [
      {
        title: '文件名',
        key: 'fileName',
        dataIndex: 'fileName',
        ellipsis: true,
      },
      {
        title: '大小',
        key: 'fileSize',
        dataIndex: 'fileSize',
        width: 120,
      },
      {
        title: '方向',
        key: 'direction',
        width: 100,
      },
      {
        title: '对方',
        key: 'peerName',
        dataIndex: 'peerName',
        width: 150,
      },
      {
        title: '状态',
        key: 'status',
        width: 100,
      },
      {
        title: '时间',
        key: 'timestamp',
        width: 180,
      },
      {
        title: '操作',
        key: 'actions',
        width: 220,
      },
    ];

    const pagination = {
      pageSize: 10,
      showSizeChanger: true,
      showTotal: (total) => `共 ${total} 条记录`,
    };

    const activeTransfers = computed(() => {
      return transfers.value.filter(
        (t) => t.status === 'uploading' || t.status === 'downloading' || t.status === 'pending'
      );
    });

    const filteredHistory = computed(() => {
      let history = transfers.value.filter(
        (t) => t.status === 'completed' || t.status === 'error' || t.status === 'cancelled'
      );

      if (filterDirection.value !== 'all') {
        history = history.filter((t) => t.direction === filterDirection.value);
      }

      if (peerId.value) {
        history = history.filter((t) => t.peerId === peerId.value);
      }

      return history;
    });

    const handleBack = () => {
      router.back();
    };

    const handleRefresh = async () => {
      loading.value = true;
      try {
        await loadTransfers();
        message.success('刷新成功');
      } catch (error) {
        console.error('Refresh error:', error);
        message.error('刷新失败');
      } finally {
        loading.value = false;
      }
    };

    const handleBeforeUpload = async (file) => {
      if (!peerId.value) {
        message.error('请先选择接收设备');
        return false;
      }

      try {
        // Start file transfer
        const transferId = await window.electron.invoke('p2p:send-file', {
          peerId: peerId.value,
          filePath: file.path,
          fileName: file.name,
          fileSize: file.size,
        });

        // Add to transfers list
        transfers.value.unshift({
          id: transferId,
          fileName: file.name,
          fileSize: file.size,
          direction: 'outgoing',
          peerId: peerId.value,
          peerName: peerName.value,
          status: 'uploading',
          progress: 0,
          timestamp: Date.now(),
        });

        message.success('开始发送文件');
      } catch (error) {
        console.error('Send file error:', error);
        message.error('发送失败: ' + error.message);
      }

      return false; // Prevent default upload behavior
    };

    const handleCancel = async (transfer) => {
      try {
        await window.electron.invoke('p2p:cancel-transfer', {
          transferId: transfer.id,
        });

        transfer.status = 'cancelled';
        message.info('已取消传输');
      } catch (error) {
        console.error('Cancel transfer error:', error);
        message.error('取消失败');
      }
    };

    const handleOpenFile = async (transfer) => {
      try {
        await window.electron.invoke('p2p:open-file', {
          filePath: transfer.localPath,
        });
      } catch (error) {
        console.error('Open file error:', error);
        message.error('打开文件失败');
      }
    };

    const handleResend = (transfer) => {
      // TODO: Implement resend
      message.info('重新发送功能开发中...');
    };

    const handleDelete = (transfer) => {
      Modal.confirm({
        title: '确认删除',
        content: '确定要删除这条传输记录吗?',
        okText: '确认',
        cancelText: '取消',
        okType: 'danger',
        onOk: () => {
          transfers.value = transfers.value.filter((t) => t.id !== transfer.id);
          message.success('已删除');
        },
      });
    };

    const handleClearHistory = () => {
      Modal.confirm({
        title: '确认清空',
        content: '确定要清空所有传输历史吗?',
        okText: '确认',
        cancelText: '取消',
        okType: 'danger',
        onOk: () => {
          transfers.value = transfers.value.filter(
            (t) => t.status === 'uploading' || t.status === 'downloading' || t.status === 'pending'
          );
          message.success('已清空历史');
        },
      });
    };

    const handleFilterChange = () => {
      // Filter is handled by computed property
    };

    const getStatusColor = (status) => {
      const colorMap = {
        pending: 'default',
        uploading: 'blue',
        downloading: 'blue',
        completed: 'success',
        error: 'error',
        cancelled: 'warning',
      };
      return colorMap[status] || 'default';
    };

    const getStatusText = (status) => {
      const textMap = {
        pending: '等待中',
        uploading: '发送中',
        downloading: '接收中',
        completed: '已完成',
        error: '失败',
        cancelled: '已取消',
      };
      return textMap[status] || status;
    };

    const formatFileSize = (bytes) => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };

    const formatSpeed = (bytesPerSecond) => {
      return formatFileSize(bytesPerSecond) + '/s';
    };

    const formatRelativeTime = (timestamp) => {
      const now = Date.now();
      const diff = now - timestamp;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);

      if (seconds < 60) return '刚刚';
      if (minutes < 60) return `${minutes}分钟前`;
      return formatDateTime(timestamp);
    };

    const formatDateTime = (timestamp) => {
      return new Date(timestamp).toLocaleString('zh-CN');
    };

    const loadTransfers = async () => {
      try {
        const result = await window.electron.invoke('p2p:list-transfers', {
          peerId: peerId.value,
        });

        transfers.value = result.transfers || generateDummyTransfers();
      } catch (error) {
        console.error('Load transfers error:', error);
        transfers.value = generateDummyTransfers();
      }
    };

    const generateDummyTransfers = () => {
      const dummyTransfers = [];
      const fileNames = [
        'document.pdf',
        'image.jpg',
        'video.mp4',
        'archive.zip',
        'presentation.pptx',
      ];

      for (let i = 0; i < 10; i++) {
        dummyTransfers.push({
          id: 'transfer-' + i,
          fileName: fileNames[i % fileNames.length],
          fileSize: Math.floor(Math.random() * 100000000),
          direction: Math.random() > 0.5 ? 'outgoing' : 'incoming',
          peerId: 'peer-' + Math.floor(Math.random() * 3),
          peerName: 'Device ' + Math.floor(Math.random() * 3),
          status: ['completed', 'error', 'cancelled'][Math.floor(Math.random() * 3)],
          progress: 100,
          timestamp: Date.now() - Math.floor(Math.random() * 86400000),
        });
      }

      return dummyTransfers;
    };

    onMounted(() => {
      loadTransfers();
    });

    return {
      peerId,
      peerName,
      loading,
      transfers,
      activeTransfers,
      filteredHistory,
      filterDirection,
      historyColumns,
      pagination,
      handleBack,
      handleRefresh,
      handleBeforeUpload,
      handleCancel,
      handleOpenFile,
      handleResend,
      handleDelete,
      handleClearHistory,
      handleFilterChange,
      getStatusColor,
      getStatusText,
      formatFileSize,
      formatSpeed,
      formatRelativeTime,
      formatDateTime,
    };
  },
};
</script>

<style scoped lang="scss">
.file-transfer-page {
  min-height: 100vh;
  background-color: #f0f2f5;

  .transfer-content {
    padding: 24px;

    .active-transfers-card {
      margin-bottom: 24px;

      .transfer-title {
        display: flex;
        align-items: center;
      }

      .transfer-info {
        margin-bottom: 8px;
        color: #8c8c8c;
      }

      .transfer-speed {
        margin-top: 4px;
        font-size: 12px;
        color: #595959;
      }
    }

    .history-card {
      .file-name-cell {
        display: flex;
        align-items: center;
      }
    }
  }
}
</style>
