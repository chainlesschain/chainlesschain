<template>
  <div class="call-history-page">
    <div class="page-header">
      <h2>通话记录</h2>
      <a-space>
        <a-select
          v-model:value="filterType"
          style="width: 120px"
          @change="handleFilterChange"
        >
          <a-select-option value="all">
            全部
          </a-select-option>
          <a-select-option value="audio">
            语音通话
          </a-select-option>
          <a-select-option value="video">
            视频通话
          </a-select-option>
          <a-select-option value="screen">
            屏幕共享
          </a-select-option>
        </a-select>
        <a-button
          :loading="loading"
          @click="handleRefresh"
        >
          <template #icon>
            <ReloadOutlined />
          </template>
          刷新
        </a-button>
        <a-button
          danger
          @click="handleClearAll"
        >
          <template #icon>
            <DeleteOutlined />
          </template>
          清空记录
        </a-button>
      </a-space>
    </div>

    <a-spin :spinning="loading">
      <div class="call-history-list">
        <a-empty
          v-if="filteredHistory.length === 0"
          description="暂无通话记录"
        />

        <div
          v-for="record in filteredHistory"
          :key="record.id"
          class="call-history-item"
          @click="handleRecordClick(record)"
        >
          <div class="call-icon">
            <PhoneOutlined
              v-if="record.type === 'audio'"
              class="icon-audio"
            />
            <VideoCameraOutlined
              v-else-if="record.type === 'video'"
              class="icon-video"
            />
            <DesktopOutlined
              v-else
              class="icon-screen"
            />
          </div>

          <div class="call-info">
            <div class="call-peer">
              <span class="peer-name">{{ getPeerName(record.peerId) }}</span>
              <a-tag
                :color="getCallStatusColor(record.status)"
                size="small"
              >
                {{ getCallStatusText(record.status) }}
              </a-tag>
            </div>
            <div class="call-details">
              <span class="call-time">{{ formatDateTime(record.startTime) }}</span>
              <span
                v-if="record.duration"
                class="call-duration"
              >
                {{ formatDuration(record.duration) }}
              </span>
            </div>
          </div>

          <div class="call-actions">
            <a-tooltip title="再次呼叫">
              <a-button
                type="text"
                size="small"
                @click.stop="handleCallAgain(record)"
              >
                <PhoneOutlined v-if="record.type === 'audio'" />
                <VideoCameraOutlined v-else-if="record.type === 'video'" />
                <DesktopOutlined v-else />
              </a-button>
            </a-tooltip>
            <a-tooltip title="删除记录">
              <a-button
                type="text"
                size="small"
                danger
                @click.stop="handleDelete(record)"
              >
                <DeleteOutlined />
              </a-button>
            </a-tooltip>
          </div>
        </div>
      </div>
    </a-spin>

    <!-- 通话详情抽屉 -->
    <a-drawer
      v-model:open="showDetails"
      title="通话详情"
      width="400"
      placement="right"
    >
      <div
        v-if="selectedRecord"
        class="call-details-content"
      >
        <a-descriptions
          :column="1"
          bordered
        >
          <a-descriptions-item label="通话类型">
            <a-tag :color="getCallTypeColor(selectedRecord.type)">
              {{ getCallTypeText(selectedRecord.type) }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="对方">
            {{ getPeerName(selectedRecord.peerId) }}
          </a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-tag :color="getCallStatusColor(selectedRecord.status)">
              {{ getCallStatusText(selectedRecord.status) }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="开始时间">
            {{ formatDateTime(selectedRecord.startTime) }}
          </a-descriptions-item>
          <a-descriptions-item
            v-if="selectedRecord.endTime"
            label="结束时间"
          >
            {{ formatDateTime(selectedRecord.endTime) }}
          </a-descriptions-item>
          <a-descriptions-item
            v-if="selectedRecord.duration"
            label="通话时长"
          >
            {{ formatDuration(selectedRecord.duration) }}
          </a-descriptions-item>
          <a-descriptions-item label="发起方">
            {{ selectedRecord.isInitiator ? '我' : getPeerName(selectedRecord.peerId) }}
          </a-descriptions-item>
        </a-descriptions>

        <!-- 通话质量统计 -->
        <div
          v-if="selectedRecord.stats"
          class="call-stats"
        >
          <h4>通话质量</h4>
          <a-descriptions
            :column="1"
            bordered
            size="small"
          >
            <a-descriptions-item label="发送字节">
              {{ formatBytes(selectedRecord.stats.bytesSent) }}
            </a-descriptions-item>
            <a-descriptions-item label="接收字节">
              {{ formatBytes(selectedRecord.stats.bytesReceived) }}
            </a-descriptions-item>
            <a-descriptions-item label="丢包率">
              {{ selectedRecord.stats.packetsLost || 0 }} 包
            </a-descriptions-item>
            <a-descriptions-item label="抖动">
              {{ (selectedRecord.stats.jitter * 1000).toFixed(2) }} ms
            </a-descriptions-item>
            <a-descriptions-item label="往返时间">
              {{ (selectedRecord.stats.roundTripTime * 1000).toFixed(2) }} ms
            </a-descriptions-item>
          </a-descriptions>
        </div>
      </div>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { useP2PCall } from '../composables/useP2PCall'
import {
  PhoneOutlined,
  VideoCameraOutlined,
  DesktopOutlined,
  ReloadOutlined,
  DeleteOutlined
} from '@ant-design/icons-vue'
import dayjs from 'dayjs'

const { startAudioCall, startVideoCall, startScreenShare } = useP2PCall()

// 状态
const loading = ref(false)
const filterType = ref('all')
const callHistory = ref([])
const showDetails = ref(false)
const selectedRecord = ref(null)

// 计算属性
const filteredHistory = computed(() => {
  if (filterType.value === 'all') {
    return callHistory.value
  }
  return callHistory.value.filter(record => record.type === filterType.value)
})

// 方法
const loadCallHistory = async () => {
  try {
    loading.value = true
    const result = await window.electron.ipcRenderer.invoke('call-history:get-all')
    if (result.success) {
      callHistory.value = result.history
    } else {
      message.error('加载通话记录失败')
    }
  } catch (error) {
    console.error('加载通话记录失败:', error)
    message.error('加载通话记录失败')
  } finally {
    loading.value = false
  }
}

const handleFilterChange = () => {
  // 过滤逻辑已在computed中处理
}

const handleRefresh = () => {
  loadCallHistory()
}

const handleClearAll = () => {
  Modal.confirm({
    title: '确认清空',
    content: '确定要清空所有通话记录吗？此操作不可恢复。',
    okText: '确定',
    cancelText: '取消',
    onOk: async () => {
      try {
        const result = await window.electron.ipcRenderer.invoke('call-history:clear-all')
        if (result.success) {
          callHistory.value = []
          message.success('已清空通话记录')
        } else {
          message.error('清空失败')
        }
      } catch (error) {
        console.error('清空通话记录失败:', error)
        message.error('清空失败')
      }
    }
  })
}

const handleRecordClick = (record) => {
  selectedRecord.value = record
  showDetails.value = true
}

const handleCallAgain = async (record) => {
  try {
    if (record.type === 'audio') {
      await startAudioCall(record.peerId)
      message.success('正在发起语音通话...')
    } else if (record.type === 'video') {
      await startVideoCall(record.peerId)
      message.success('正在发起视频通话...')
    } else if (record.type === 'screen') {
      // 屏幕共享需要重新选择源
      message.info('请在聊天窗口中发起屏幕共享')
    }
  } catch (error) {
    console.error('发起通话失败:', error)
    message.error('发起通话失败')
  }
}

const handleDelete = (record) => {
  Modal.confirm({
    title: '确认删除',
    content: '确定要删除这条通话记录吗？',
    okText: '确定',
    cancelText: '取消',
    onOk: async () => {
      try {
        const result = await window.electron.ipcRenderer.invoke('call-history:delete', record.id)
        if (result.success) {
          callHistory.value = callHistory.value.filter(r => r.id !== record.id)
          message.success('已删除')
        } else {
          message.error('删除失败')
        }
      } catch (error) {
        console.error('删除通话记录失败:', error)
        message.error('删除失败')
      }
    }
  })
}

// 辅助函数
const getPeerName = (peerId) => {
  // TODO: 从好友列表获取昵称
  return peerId.substring(0, 8) + '...'
}

const getCallTypeText = (type) => {
  const typeMap = {
    audio: '语音通话',
    video: '视频通话',
    screen: '屏幕共享'
  }
  return typeMap[type] || type
}

const getCallTypeColor = (type) => {
  const colorMap = {
    audio: 'blue',
    video: 'green',
    screen: 'purple'
  }
  return colorMap[type] || 'default'
}

const getCallStatusText = (status) => {
  const statusMap = {
    connected: '已接通',
    rejected: '已拒绝',
    missed: '未接听',
    failed: '失败',
    ended: '已结束'
  }
  return statusMap[status] || status
}

const getCallStatusColor = (status) => {
  const colorMap = {
    connected: 'success',
    rejected: 'error',
    missed: 'warning',
    failed: 'error',
    ended: 'default'
  }
  return colorMap[status] || 'default'
}

const formatDateTime = (timestamp) => {
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss')
}

const formatDuration = (seconds) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

const formatBytes = (bytes) => {
  if (bytes === 0) {return '0 B'}
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}

// 生命周期
onMounted(() => {
  loadCallHistory()
})
</script>

<style scoped>
.call-history-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-header h2 {
  margin: 0;
}

.call-history-list {
  flex: 1;
  overflow-y: auto;
}

.call-history-item {
  display: flex;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background-color 0.3s;
}

.call-history-item:hover {
  background-color: #f5f5f5;
}

.call-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background-color: #f0f0f0;
  margin-right: 16px;
  font-size: 24px;
}

.icon-audio {
  color: #1890ff;
}

.icon-video {
  color: #52c41a;
}

.icon-screen {
  color: #722ed1;
}

.call-info {
  flex: 1;
}

.call-peer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.peer-name {
  font-weight: 500;
  font-size: 16px;
}

.call-details {
  display: flex;
  gap: 16px;
  font-size: 14px;
  color: #666;
}

.call-actions {
  display: flex;
  gap: 8px;
}

.call-details-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.call-stats h4 {
  margin-bottom: 12px;
}
</style>
