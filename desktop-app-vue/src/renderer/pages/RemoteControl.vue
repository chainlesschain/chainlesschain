<template>
  <div class="remote-control-page">
    <a-page-header
      title="远程控制"
      sub-title="管理移动设备连接和权限"
    >
      <template #extra>
        <a-space>
          <a-badge :count="connectedDevices.length" :number-style="{ backgroundColor: '#52c41a' }">
            <a-button type="primary" @click="refreshDevices">
              <template #icon><ReloadOutlined /></template>
              刷新设备
            </a-button>
          </a-badge>
          <a-button @click="showStats">
            <template #icon><BarChartOutlined /></template>
            统计信息
          </a-button>
        </a-space>
      </template>
    </a-page-header>

    <div class="content">
      <!-- 设备列表 -->
      <a-card title="已连接设备" :loading="loading">
        <template #extra>
          <a-tag color="success">{{ connectedDevices.length }} 台设备在线</a-tag>
        </template>

        <a-empty v-if="connectedDevices.length === 0" description="暂无设备连接" />

        <a-list v-else :data-source="connectedDevices" item-layout="horizontal">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #title>
                  <a-space>
                    <MobileOutlined style="font-size: 20px; color: #1890ff;" />
                    <span>{{ item.did }}</span>
                    <a-tag v-if="item.permissionLevel" :color="getPermissionColor(item.permissionLevel)">
                      Level {{ item.permissionLevel }}
                    </a-tag>
                  </a-space>
                </template>
                <template #description>
                  Peer ID: {{ item.peerId }}<br />
                  连接时间: {{ formatTime(item.connectedAt) }}
                </template>
              </a-list-item-meta>

              <template #actions>
                <a-button type="link" @click="sendTestCommand(item)">
                  <template #icon><SendOutlined /></template>
                  发送测试命令
                </a-button>
                <a-button type="link" @click="managePermission(item)">
                  <template #icon><SettingOutlined /></template>
                  管理权限
                </a-button>
                <a-button type="link" danger @click="viewAuditLogs(item)">
                  <template #icon><FileTextOutlined /></template>
                  审计日志
                </a-button>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </a-card>

      <!-- 命令测试面板 -->
      <a-card title="命令测试" style="margin-top: 16px;">
        <a-form layout="vertical">
          <a-row :gutter="16">
            <a-col :span="8">
              <a-form-item label="目标设备">
                <a-select v-model:value="testCommand.peerId" placeholder="选择设备">
                  <a-select-option v-for="device in connectedDevices" :key="device.peerId" :value="device.peerId">
                    {{ device.did }}
                  </a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
            <a-col :span="8">
              <a-form-item label="命令类型">
                <a-select v-model:value="testCommand.method" placeholder="选择命令">
                  <a-select-option value="system.getStatus">系统状态</a-select-option>
                  <a-select-option value="system.notify">发送通知</a-select-option>
                  <a-select-option value="ai.chat">AI 对话</a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
            <a-col :span="8">
              <a-form-item label="操作">
                <a-button type="primary" block @click="executeTestCommand" :loading="testCommand.loading">
                  <template #icon><ThunderboltOutlined /></template>
                  执行命令
                </a-button>
              </a-form-item>
            </a-col>
          </a-row>

          <a-form-item label="命令参数（JSON）">
            <a-textarea
              v-model:value="testCommand.params"
              placeholder='{"key": "value"}'
              :rows="4"
            />
          </a-form-item>

          <a-form-item v-if="testCommand.result" label="执行结果">
            <a-alert
              :type="testCommand.result.success ? 'success' : 'error'"
              :message="testCommand.result.success ? '命令执行成功' : '命令执行失败'"
            >
              <template #description>
                <pre>{{ JSON.stringify(testCommand.result.data, null, 2) }}</pre>
              </template>
            </a-alert>
          </a-form-item>
        </a-form>
      </a-card>
    </div>

    <!-- 权限管理对话框 -->
    <a-modal
      v-model:open="permissionModal.visible"
      title="管理设备权限"
      @ok="savePermission"
      @cancel="permissionModal.visible = false"
    >
      <a-form layout="vertical">
        <a-form-item label="设备 DID">
          <a-input :value="permissionModal.device ? permissionModal.device.did : ''" disabled />
        </a-form-item>

        <a-form-item label="权限级别">
          <a-radio-group v-model:value="permissionModal.level">
            <a-radio :value="1">
              <a-space>
                Level 1 - Public
                <a-tag color="default">只读权限</a-tag>
              </a-space>
            </a-radio>
            <a-radio :value="2">
              <a-space>
                Level 2 - Normal
                <a-tag color="blue">标准权限</a-tag>
              </a-space>
            </a-radio>
            <a-radio :value="3">
              <a-space>
                Level 3 - Admin
                <a-tag color="orange">管理员权限</a-tag>
              </a-space>
            </a-radio>
            <a-radio :value="4">
              <a-space>
                Level 4 - Root
                <a-tag color="red">完全控制（需要 U-Key）</a-tag>
              </a-space>
            </a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item label="设备名称">
          <a-input v-model:value="permissionModal.deviceName" placeholder="为设备起个名字" />
        </a-form-item>

        <a-form-item label="过期时间（小时）">
          <a-input-number v-model:value="permissionModal.expiresInHours" :min="1" :max="168" />
          <span style="margin-left: 8px; color: #999;">设置为 0 表示永不过期</span>
        </a-form-item>

        <a-form-item label="备注">
          <a-textarea v-model:value="permissionModal.notes" :rows="3" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 审计日志对话框 -->
    <a-modal
      v-model:open="auditModal.visible"
      title="审计日志"
      width="800px"
      :footer="null"
    >
      <a-table
        :columns="auditColumns"
        :data-source="auditModal.logs"
        :loading="auditModal.loading"
        :pagination="{ pageSize: 10 }"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'granted'">
            <a-tag :color="record.granted ? 'success' : 'error'">
              {{ record.granted ? '允许' : '拒绝' }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'timestamp'">
            {{ formatTime(record.timestamp) }}
          </template>
        </template>
      </a-table>
    </a-modal>

    <!-- 统计信息对话框 -->
    <a-modal
      v-model:open="statsModal.visible"
      title="统计信息"
      :footer="null"
    >
      <a-descriptions bordered :column="1">
        <a-descriptions-item label="总命令数">
          {{ stats.totalCommands }}
        </a-descriptions-item>
        <a-descriptions-item label="成功率">
          {{ stats.successRate }}
        </a-descriptions-item>
        <a-descriptions-item label="已连接设备">
          {{ stats.connectedDevices }}
        </a-descriptions-item>
        <a-descriptions-item label="运行时间">
          {{ formatUptime(stats.uptime) }}
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import {
  ReloadOutlined,
  BarChartOutlined,
  MobileOutlined,
  SendOutlined,
  SettingOutlined,
  FileTextOutlined,
  ThunderboltOutlined
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'

const { ipcRenderer } = window.require('electron')

// 设备列表
const loading = ref(false)
const connectedDevices = ref([])

// 测试命令
const testCommand = reactive({
  peerId: null,
  method: 'system.getStatus',
  params: '{}',
  loading: false,
  result: null
})

// 权限管理
const permissionModal = reactive({
  visible: false,
  device: null,
  level: 2,
  deviceName: '',
  expiresInHours: 24,
  notes: ''
})

// 审计日志
const auditModal = reactive({
  visible: false,
  logs: [],
  loading: false
})

const auditColumns = [
  { title: '方法', dataIndex: 'method', key: 'method' },
  { title: '权限级别', dataIndex: 'permission_level', key: 'permission_level' },
  { title: '状态', key: 'granted' },
  { title: '原因', dataIndex: 'reason', key: 'reason' },
  { title: '时间', key: 'timestamp' }
]

// 统计信息
const statsModal = reactive({
  visible: false
})

const stats = ref({
  totalCommands: 0,
  successRate: '0%',
  connectedDevices: 0,
  uptime: 0
})

// 刷新设备列表
async function refreshDevices() {
  loading.value = true
  try {
    const result = await ipcRenderer.invoke('remote:get-connected-devices')
    if (result.success) {
      connectedDevices.value = result.data

      // 获取每个设备的权限级别
      for (const device of connectedDevices.value) {
        const permResult = await ipcRenderer.invoke('remote:get-device-permission', {
          did: device.did
        })
        if (permResult.success) {
          device.permissionLevel = permResult.data.level
        }
      }

      message.success('设备列表已更新')
    } else {
      message.error('获取设备列表失败: ' + result.error)
    }
  } catch (error) {
    console.error('刷新设备失败:', error)
    message.error('刷新设备失败')
  } finally {
    loading.value = false
  }
}

// 发送测试命令
function sendTestCommand(device) {
  testCommand.peerId = device.peerId
  testCommand.result = null
}

// 执行测试命令
async function executeTestCommand() {
  if (!testCommand.peerId || !testCommand.method) {
    message.warning('请选择设备和命令')
    return
  }

  testCommand.loading = true
  testCommand.result = null

  try {
    let params = {}
    if (testCommand.params.trim()) {
      params = JSON.parse(testCommand.params)
    }

    const result = await ipcRenderer.invoke('remote:send-command', {
      peerId: testCommand.peerId,
      method: testCommand.method,
      params,
      timeout: 30000
    })

    testCommand.result = result

    if (result.success) {
      message.success('命令执行成功')
    } else {
      message.error('命令执行失败: ' + result.error)
    }
  } catch (error) {
    console.error('执行命令失败:', error)
    message.error('执行命令失败')
    testCommand.result = { success: false, error: error.message }
  } finally {
    testCommand.loading = false
  }
}

// 管理权限
function managePermission(device) {
  permissionModal.device = device
  permissionModal.level = device.permissionLevel || 2
  permissionModal.deviceName = device.deviceName || ''
  permissionModal.expiresInHours = 24
  permissionModal.notes = ''
  permissionModal.visible = true
}

// 保存权限
async function savePermission() {
  try {
    const expiresIn = permissionModal.expiresInHours > 0
      ? permissionModal.expiresInHours * 3600000
      : null

    const result = await ipcRenderer.invoke('remote:set-device-permission', {
      did: permissionModal.device.did,
      level: permissionModal.level,
      options: {
        deviceName: permissionModal.deviceName,
        expiresIn,
        notes: permissionModal.notes,
        grantedBy: 'user'
      }
    })

    if (result.success) {
      message.success('权限已更新')
      permissionModal.visible = false
      refreshDevices()
    } else {
      message.error('更新权限失败: ' + result.error)
    }
  } catch (error) {
    console.error('保存权限失败:', error)
    message.error('保存权限失败')
  }
}

// 查看审计日志
async function viewAuditLogs(device) {
  auditModal.visible = true
  auditModal.loading = true

  try {
    const result = await ipcRenderer.invoke('remote:get-audit-logs', {
      did: device.did,
      limit: 50
    })

    if (result.success) {
      auditModal.logs = result.data
    } else {
      message.error('获取审计日志失败: ' + result.error)
    }
  } catch (error) {
    console.error('获取审计日志失败:', error)
    message.error('获取审计日志失败')
  } finally {
    auditModal.loading = false
  }
}

// 显示统计信息
async function showStats() {
  try {
    const result = await ipcRenderer.invoke('remote:get-stats')

    if (result.success) {
      stats.value = result.data
      statsModal.visible = true
    } else {
      message.error('获取统计信息失败: ' + result.error)
    }
  } catch (error) {
    console.error('获取统计信息失败:', error)
    message.error('获取统计信息失败')
  }
}

// 工具函数
function getPermissionColor(level) {
  const colors = {
    1: 'default',
    2: 'blue',
    3: 'orange',
    4: 'red'
  }
  return colors[level] || 'default'
}

function formatTime(timestamp) {
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss')
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}天 ${hours % 24}小时`
  if (hours > 0) return `${hours}小时 ${minutes % 60}分钟`
  if (minutes > 0) return `${minutes}分钟 ${seconds % 60}秒`
  return `${seconds}秒`
}

// 监听设备事件
onMounted(() => {
  refreshDevices()

  // 监听设备连接事件
  ipcRenderer.on('remote:device-connected', (event, data) => {
    message.info(`设备已连接: ${data.peerId}`)
    refreshDevices()
  })

  ipcRenderer.on('remote:device-registered', (event, data) => {
    message.success(`设备已注册: ${data.did}`)
    refreshDevices()
  })

  ipcRenderer.on('remote:device-disconnected', (event, data) => {
    message.warning(`设备已断开: ${data.peerId}`)
    refreshDevices()
  })
})

onUnmounted(() => {
  ipcRenderer.removeAllListeners('remote:device-connected')
  ipcRenderer.removeAllListeners('remote:device-registered')
  ipcRenderer.removeAllListeners('remote:device-disconnected')
})
</script>

<style scoped>
.remote-control-page {
  padding: 24px;
}

.content {
  margin-top: 16px;
}

pre {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  max-height: 300px;
  overflow: auto;
}
</style>
