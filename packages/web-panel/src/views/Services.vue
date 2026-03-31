<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">服务管理</h2>
        <p class="page-sub">ChainlessChain 运行状态与服务控制</p>
      </div>
      <a-button type="primary" ghost :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <!-- Status Cards Row -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <!-- App Status -->
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="应用状态"
            :value="appRunning ? '运行中' : '未运行'"
            :value-style="{ color: appRunning ? '#52c41a' : '#888', fontSize: '16px' }"
          >
            <template #prefix><DesktopOutlined /></template>
          </a-statistic>
          <div v-if="edition" style="margin-top: 6px; color: var(--text-muted); font-size: 11px;">版本: {{ edition }}</div>
        </a-card>
      </a-col>
      <!-- WebSocket Server -->
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="WebSocket 服务"
            value="运行中"
            :value-style="{ color: '#52c41a', fontSize: '16px' }"
          >
            <template #prefix><ApiOutlined /></template>
          </a-statistic>
          <div style="margin-top: 6px; color: var(--text-muted); font-size: 11px;">
            端口: {{ cfg.wsPort || 18800 }} · {{ cfg.wsHost || '127.0.0.1' }}
          </div>
        </a-card>
      </a-col>
      <!-- LLM Provider -->
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="LLM 提供商"
            :value="activeLlm || '未配置'"
            :value-style="{ color: activeLlm ? '#1677ff' : '#888', fontSize: '16px' }"
          >
            <template #prefix><RobotOutlined /></template>
          </a-statistic>
          <div v-if="activeModel" style="margin-top: 6px; color: var(--text-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            {{ activeModel }}
          </div>
        </a-card>
      </a-col>
      <!-- Setup Status -->
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="初始化"
            :value="setupDone ? '已完成' : '未完成'"
            :value-style="{ color: setupDone ? '#52c41a' : '#faad14', fontSize: '16px' }"
          >
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
          <div v-if="setupDate" style="margin-top: 6px; color: var(--text-muted); font-size: 11px;">{{ setupDate }}</div>
        </a-card>
      </a-col>
    </a-row>

    <!-- Port Status Table -->
    <a-card
      title="端口状态"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
    >
      <template #extra>
        <a-tag :color="wsConnected ? 'green' : 'red'">
          WS {{ wsConnected ? '已连接' : '断开' }}
        </a-tag>
      </template>
      <div v-if="loading" style="text-align: center; padding: 30px;"><a-spin /></div>
      <a-table
        v-else
        :columns="portColumns"
        :data-source="ports"
        :pagination="false"
        size="small"
        :row-class-name="(r) => r.active ? 'port-active' : ''"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <a-badge
              :status="record.active ? 'success' : 'default'"
              :text="record.active ? '运行中' : '未运行'"
            />
          </template>
          <template v-if="column.key === 'port'">
            <span style="font-family: monospace; color: #ccc;">{{ record.port }}</span>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- Docker Services -->
    <a-card
      title="Docker 服务"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
    >
      <div v-if="dockerStatus" style="color: var(--text-secondary); font-size: 13px; padding: 8px 0;">
        {{ dockerStatus }}
      </div>
      <div v-else style="color: var(--text-muted); font-size: 13px; padding: 8px 0;">未检测到 Docker 服务</div>
    </a-card>

    <!-- Quick Actions -->
    <a-card
      title="快速操作"
      style="background: var(--bg-card); border-color: var(--border-color);"
    >
      <a-space wrap>
        <a-button :loading="doctorLoading" @click="runDoctor" style="background: var(--bg-card-hover); border-color: var(--border-color);">
          <template #icon><MedicineBoxOutlined /></template>
          环境诊断
        </a-button>
        <a-button @click="$router.push('/logs')" style="background: var(--bg-card-hover); border-color: var(--border-color);">
          <template #icon><FileTextOutlined /></template>
          查看日志
        </a-button>
        <a-button @click="$router.push('/providers')" style="background: var(--bg-card-hover); border-color: var(--border-color);">
          <template #icon><ApiOutlined /></template>
          LLM 配置
        </a-button>
      </a-space>

      <!-- Doctor Output -->
      <div v-if="doctorOutput" style="margin-top: 16px;">
        <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 6px;">诊断结果</div>
        <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; max-height: 300px; overflow-y: auto; white-space: pre-wrap;">{{ doctorOutput }}</pre>
      </div>
    </a-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  ReloadOutlined, DesktopOutlined, ApiOutlined, RobotOutlined,
  CheckCircleOutlined, MedicineBoxOutlined, FileTextOutlined
} from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'

const ws = useWsStore()
const cfg = window.__CC_CONFIG__ || {}

const loading = ref(false)
const doctorLoading = ref(false)
const doctorOutput = ref('')

const rawStatus = ref('')
const appRunning = ref(false)
const edition = ref('')
const activeLlm = ref('')
const activeModel = ref('')
const setupDone = ref(false)
const setupDate = ref('')
const dockerStatus = ref('')
const ports = ref([])
const wsConnected = computed(() => ws.status === 'connected')

const portColumns = [
  { title: '服务', dataIndex: 'name', key: 'name' },
  { title: '端口', dataIndex: 'port', key: 'port' },
  { title: '状态', key: 'status' },
]

async function refresh() {
  loading.value = true
  try {
    const { output } = await ws.execute('status', 15000)
    rawStatus.value = output
    parseStatus(output)
  } catch (e) {
    console.error('status failed:', e)
  } finally {
    loading.value = false
  }
}

function parseStatus(output) {
  // App running
  appRunning.value = output.includes('Desktop app running') || output.includes('Running')

  // Edition
  const edMatch = output.match(/Edition:\s+(\S+)/i)
  if (edMatch) edition.value = edMatch[1]

  // LLM
  const llmMatch = output.match(/LLM:\s+(\S+)\s+\(([^)]+)\)/i)
  if (llmMatch) {
    activeLlm.value = llmMatch[1]
    activeModel.value = llmMatch[2]
  } else {
    const llm2 = output.match(/LLM:\s+(\S+)/i)
    if (llm2) activeLlm.value = llm2[1]
  }

  // Setup
  setupDone.value = output.includes('Setup completed')
  const dateMatch = output.match(/Setup completed \(([^)]+)\)/i)
  if (dateMatch) {
    try { setupDate.value = new Date(dateMatch[1]).toLocaleDateString('zh-CN') } catch { setupDate.value = '' }
  }

  // Docker
  if (output.includes('docker-compose.yml not found')) {
    dockerStatus.value = '未找到 docker-compose.yml'
  } else if (output.includes('Docker Services')) {
    dockerStatus.value = '已检测到 Docker 配置'
  }

  // Ports
  const portLines = output.split('\n').filter(l => l.match(/[○●]\s+\w+:\s+\d+/))
  ports.value = portLines.map(l => {
    const m = l.match(/([○●])\s+(\w+):\s+(\d+)/)
    if (!m) return null
    return { key: m[2], name: m[2], port: parseInt(m[3]), active: m[1] === '●' }
  }).filter(Boolean)
}

async function runDoctor() {
  doctorLoading.value = true
  doctorOutput.value = ''
  try {
    const { output } = await ws.execute('doctor', 30000)
    doctorOutput.value = output
  } catch (e) {
    doctorOutput.value = `诊断失败: ${e.message}`
  } finally {
    doctorLoading.value = false
  }
}

onMounted(refresh)
</script>

<style scoped>
:deep(.port-active td) { color: #52c41a !important; }
</style>
