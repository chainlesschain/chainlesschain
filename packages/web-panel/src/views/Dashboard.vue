<template>
  <div>
    <!-- Header -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
      <div>
        <h2 class="page-title">仪表板</h2>
        <p class="page-sub">
          {{ isProject ? `项目「${cfg.projectName || '未命名'}」运行概览` : 'ChainlessChain 全局运行状态' }}
        </p>
      </div>
      <a-button type="primary" ghost :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <!-- Project Mode Banner -->
    <a-card v-if="isProject" style="background: rgba(22,119,255,.08); border-color: rgba(22,119,255,.25); margin-bottom: 16px;" size="small">
      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
        <FolderOutlined style="color: #1677ff; font-size: 18px;" />
        <div>
          <div style="color: #91caff; font-weight: 600;">{{ cfg.projectName || '项目' }}</div>
          <div style="color: #4a6fa5; font-size: 11px; font-family: monospace;">{{ cfg.projectRoot }}</div>
        </div>
        <a-tag color="blue" style="margin-left: auto;">项目级面板</a-tag>
      </div>
    </a-card>

    <!-- Primary Stats Row -->
    <a-row :gutter="[12, 12]" style="margin-bottom: 16px;">
      <!-- WebSocket Gateway -->
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card class="stat-card gateway-card" size="small">
          <div class="stat-header">
            <span class="stat-label">WebSocket Gateway</span>
            <a-badge :status="wsStatus === 'connected' ? 'success' : 'error'" />
          </div>
          <div class="stat-value" :style="{ color: wsStatus === 'connected' ? '#52c41a' : '#888' }">
            {{ wsStatus === 'connected' ? '运行中' : '未连接' }}
          </div>
          <div class="stat-sub">端口 {{ cfg.wsPort || 18800 }} · {{ cfg.wsHost || '127.0.0.1' }}</div>
        </a-card>
      </a-col>

      <!-- Active LLM -->
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card class="stat-card" size="small">
          <div class="stat-header">
            <span class="stat-label">主 LLM</span>
            <RobotOutlined style="color: #1677ff;" />
          </div>
          <div class="stat-value" style="color: #91caff; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            {{ stats.activeLlm || '未配置' }}
          </div>
          <div class="stat-sub" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            {{ stats.activeModel || '—' }}
          </div>
        </a-card>
      </a-col>

      <!-- Skills -->
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card class="stat-card" size="small" style="cursor: pointer;" @click="$router.push('/skills')">
          <div class="stat-header">
            <span class="stat-label">可用技能</span>
            <AppstoreOutlined style="color: #1677ff;" />
          </div>
          <div class="stat-value" style="color: #1677ff;">{{ stats.skillCount || '—' }}</div>
          <div class="stat-sub">点击管理技能</div>
        </a-card>
      </a-col>

      <!-- Sessions -->
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card class="stat-card" size="small" style="cursor: pointer;" @click="$router.push('/chat')">
          <div class="stat-header">
            <span class="stat-label">AI 会话</span>
            <MessageOutlined style="color: #722ed1;" />
          </div>
          <div class="stat-value" style="color: #c084fc;">{{ stats.sessionCount }}</div>
          <div class="stat-sub">点击进入对话</div>
        </a-card>
      </a-col>
    </a-row>

    <!-- Secondary Stats Row -->
    <a-row :gutter="[12, 12]" style="margin-bottom: 16px;">
      <!-- App Status -->
      <a-col :xs="24" :sm="8">
        <a-card class="stat-card" size="small">
          <div class="stat-header">
            <span class="stat-label">应用状态</span>
            <DesktopOutlined :style="{ color: stats.appRunning ? '#52c41a' : '#888' }" />
          </div>
          <div class="stat-value" :style="{ color: stats.appRunning ? '#52c41a' : '#888', fontSize: '15px' }">
            {{ stats.appRunning ? '运行中' : stats.setupDone ? '已初始化' : '未启动' }}
          </div>
          <div class="stat-sub">{{ stats.edition || 'Community' }} Edition</div>
        </a-card>
      </a-col>

      <!-- MCP Tools -->
      <a-col :xs="24" :sm="8">
        <a-card class="stat-card" size="small" style="cursor: pointer;" @click="$router.push('/mcp')">
          <div class="stat-header">
            <span class="stat-label">MCP 工具</span>
            <ToolOutlined style="color: #13c2c2;" />
          </div>
          <div class="stat-value" style="color: #13c2c2;">{{ stats.mcpCount ?? '—' }}</div>
          <div class="stat-sub">已挂载扩展</div>
        </a-card>
      </a-col>

      <!-- Notes -->
      <a-col :xs="24" :sm="8">
        <a-card class="stat-card" size="small" style="cursor: pointer;" @click="$router.push('/notes')">
          <div class="stat-header">
            <span class="stat-label">知识库笔记</span>
            <FileTextOutlined style="color: #faad14;" />
          </div>
          <div class="stat-value" style="color: #faad14;">{{ stats.noteCount ?? '—' }}</div>
          <div class="stat-sub">点击管理笔记</div>
        </a-card>
      </a-col>
    </a-row>

    <!-- Quick Actions + Status Log (2-col layout) -->
    <a-row :gutter="[16, 16]">
      <!-- Quick Actions -->
      <a-col :xs="24" :lg="10">
        <a-card title="快速操作" style="background: var(--bg-card); border-color: var(--border-color); height: 100%;">
          <a-space direction="vertical" style="width: 100%;" size="middle">
            <a-button type="primary" block @click="$router.push('/chat')">
              <template #icon><MessageOutlined /></template>
              {{ isProject ? '进入项目 Chat' : '新建 AI 对话' }}
            </a-button>
            <a-button block @click="newAgentSession" style="background: rgba(114,46,209,.12); border-color: #722ed1; color: #722ed1;">
              <template #icon><RobotOutlined /></template>
              启动 Agent 模式
            </a-button>
            <a-row :gutter="8">
              <a-col :span="12">
                <a-button block @click="$router.push('/services')" style="background: var(--bg-card-hover); border-color: var(--border-color);">
                  <template #icon><SettingOutlined /></template>
                  服务管理
                </a-button>
              </a-col>
              <a-col :span="12">
                <a-button block @click="$router.push('/logs')" style="background: var(--bg-card-hover); border-color: var(--border-color);">
                  <template #icon><FileTextOutlined /></template>
                  查看日志
                </a-button>
              </a-col>
            </a-row>
            <a-row :gutter="8">
              <a-col :span="12">
                <a-button block @click="$router.push('/skills')" style="background: var(--bg-card-hover); border-color: var(--border-color);">
                  <template #icon><AppstoreOutlined /></template>
                  技能管理
                </a-button>
              </a-col>
              <a-col :span="12">
                <a-button block @click="$router.push('/providers')" style="background: var(--bg-card-hover); border-color: var(--border-color);">
                  <template #icon><ApiOutlined /></template>
                  LLM 配置
                </a-button>
              </a-col>
            </a-row>
          </a-space>
        </a-card>
      </a-col>

      <!-- Status Log -->
      <a-col :xs="24" :lg="14">
        <a-card
          title="最近状态"
          style="background: var(--bg-card); border-color: var(--border-color);"
          :loading="loading"
        >
          <template #extra>
            <a-button type="link" size="small" @click="$router.push('/logs')">查看更多 →</a-button>
          </template>
          <pre class="status-log">{{ statusLog || '点击刷新加载系统状态...' }}</pre>
        </a-card>
      </a-col>
    </a-row>

    <a-card
      title="压缩策略观测"
      style="background: var(--bg-card); border-color: var(--border-color); margin-top: 16px;"
      :loading="loading"
    >
      <a-row :gutter="[12, 12]">
        <a-col :xs="24" :sm="8">
          <div class="telemetry-card">
            <div class="telemetry-label">压缩命中率</div>
            <div class="telemetry-value">{{ formatPercent(compression.hitRate) }}</div>
            <div class="telemetry-sub">{{ compression.compressedSamples }} / {{ compression.samples }} 次压缩产生了有效节省</div>
          </div>
        </a-col>
        <a-col :xs="24" :sm="8">
          <div class="telemetry-card">
            <div class="telemetry-label">累计节省 Token</div>
            <div class="telemetry-value">{{ compression.totalSavedTokens }}</div>
            <div class="telemetry-sub">平均每次 {{ compression.averageSavedTokens }} Token</div>
          </div>
        </a-col>
        <a-col :xs="24" :sm="8">
          <div class="telemetry-card">
            <div class="telemetry-label">净节省率</div>
            <div class="telemetry-value">{{ formatPercent(compression.netSavingsRate) }}</div>
            <div class="telemetry-sub">原始 {{ compression.totalOriginalTokens }} → 压缩后 {{ compression.totalCompressedTokens }}</div>
          </div>
        </a-col>
      </a-row>

      <a-row :gutter="[16, 16]" style="margin-top: 12px;">
        <a-col :xs="24" :lg="12">
          <div class="telemetry-section">
            <div class="telemetry-section-title">策略命中分布</div>
            <div v-if="compression.strategyDistribution.length === 0" class="telemetry-empty">暂无压缩样本</div>
            <div v-else class="telemetry-list">
              <div v-for="item in compression.strategyDistribution.slice(0, 6)" :key="item.strategy" class="telemetry-row">
                <span>{{ item.strategy }}</span>
                <span>{{ item.hits }} 次 · {{ formatPercent(item.hitRate) }}</span>
              </div>
            </div>
          </div>
        </a-col>
        <a-col :xs="24" :lg="12">
          <div class="telemetry-section">
            <div class="telemetry-section-title">变体分布</div>
            <div v-if="variantEntries.length === 0" class="telemetry-empty">暂无变体数据</div>
            <div v-else class="telemetry-list">
              <div v-for="[variant, count] in variantEntries" :key="variant" class="telemetry-row">
                <span>{{ variant }}</span>
                <span>{{ count }} 次</span>
              </div>
            </div>
          </div>
        </a-col>
      </a-row>
    </a-card>

    <!-- System Info -->
    <a-card title="运行信息" style="background: var(--bg-card); border-color: var(--border-color); margin-top: 16px;">
      <a-descriptions :column="{ xs: 1, sm: 2, lg: 3 }" size="small">
        <a-descriptions-item label="面板模式">
          <a-tag :color="isProject ? 'blue' : 'purple'">{{ isProject ? '项目级' : '全局' }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item v-if="isProject" label="项目名称">
          <span style="color: #91caff;">{{ cfg.projectName || '—' }}</span>
        </a-descriptions-item>
        <a-descriptions-item v-if="isProject" label="项目路径">
          <span style="color: var(--text-muted); font-family: monospace; font-size: 11px;">{{ cfg.projectRoot }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="WebSocket">
          <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">
            ws://{{ cfg.wsHost || '127.0.0.1' }}:{{ cfg.wsPort || 18800 }}
          </span>
        </a-descriptions-item>
        <a-descriptions-item label="认证">
          <a-tag :color="cfg.wsToken ? 'green' : 'default'" style="font-size: 11px;">
            {{ cfg.wsToken ? '已启用' : '未启用' }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="版本">
          <span style="color: var(--text-muted);">v5.0.2.7</span>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  ReloadOutlined, ApiOutlined, RobotOutlined, AppstoreOutlined,
  MessageOutlined, FolderOutlined, DesktopOutlined, FileTextOutlined,
  ToolOutlined, SettingOutlined
} from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'
import { useChatStore } from '../stores/chat.js'

const router = useRouter()
const ws = useWsStore()
const chatStore = useChatStore()
const cfg = window.__CC_CONFIG__ || {}
const isProject = computed(() => cfg.mode === 'project')
const wsStatus = computed(() => ws.status)
const variantEntries = computed(() => Object.entries(compression.value.variantDistribution || {}))

const loading = ref(false)
const statusLog = ref('')
const compression = ref({
  samples: 0,
  compressedSamples: 0,
  hitRate: 0,
  totalSavedTokens: 0,
  averageSavedTokens: 0,
  totalOriginalTokens: 0,
  totalCompressedTokens: 0,
  netSavingsRate: 0,
  variantDistribution: {},
  strategyDistribution: [],
})
const stats = ref({
  activeLlm: null, activeModel: null,
  skillCount: 0, sessionCount: 0,
  appRunning: false, setupDone: false, edition: '',
  mcpCount: null, noteCount: null,
})

async function refresh() {
  loading.value = true
  stats.value.wsStatus = ws.status
  statusLog.value = ''

  try {
    // Wave 1: Critical — status + sessions
    const [statusResult, sessions] = await Promise.allSettled([
      ws.execute('status', 15000),
      ws.listSessions(),
    ])

    if (statusResult.status === 'fulfilled') {
      const out = statusResult.value.output
      statusLog.value = out.split('\n').slice(0, 20).join('\n')
      parseStatus(out)
    }
    if (sessions.status === 'fulfilled') {
      stats.value.sessionCount = sessions.value.length
    }

    // Wave 2: Skills + LLM (parallel, non-blocking)
    Promise.allSettled([
      ws.execute('skill sources', 15000),
      ws.execute('llm providers', 15000),
    ]).then(([skillResult, llmResult]) => {
      if (skillResult.status === 'fulfilled') {
        const m = skillResult.value.output.match(/(\d+)\s*(?:skills|技能)/i)
        if (m) stats.value.skillCount = parseInt(m[1])
      }
      if (llmResult.status === 'fulfilled') {
        const out = llmResult.value.output
        const m = out.match(/active[:\s]+(\S+)/i)
        if (m && !stats.value.activeLlm) stats.value.activeLlm = m[1]
      }
    })

    // Wave 3: MCP count (non-blocking)
    ws.execute('mcp servers', 10000).then(({ output }) => {
      const count = (output.match(/^[a-z]/gm) || []).length
      stats.value.mcpCount = count
    }).catch(() => { stats.value.mcpCount = 0 })

    ws.sendRaw({ type: 'compression-stats' }, 10000).then((result) => {
      compression.value = { ...compression.value, ...(result.summary || {}) }
    }).catch(() => {})

  } catch (_) {
    // Best-effort
  } finally {
    loading.value = false
  }
}

function parseStatus(out) {
  stats.value.appRunning = out.includes('Desktop app running')
  stats.value.setupDone = out.includes('Setup completed')
  const ed = out.match(/Edition:\s+(\S+)/i)
  if (ed) stats.value.edition = ed[1]
  const llm = out.match(/LLM:\s+(\S+)\s+\(([^)]+)\)/i)
  if (llm) { stats.value.activeLlm = llm[1]; stats.value.activeModel = llm[2] }
  else {
    const l2 = out.match(/LLM:\s+(\S+)/i)
    if (l2) stats.value.activeLlm = l2[1]
  }
}

function formatPercent(value) {
  return `${((value || 0) * 100).toFixed(1)}%`
}

async function newAgentSession() {
  await chatStore.createSession('agent')
  router.push('/chat')
}

onMounted(() => setTimeout(refresh, 300))
</script>

<style scoped>
.stat-card {
  background: var(--bg-card) !important;
  border-color: var(--border-color) !important;
  transition: border-color 0.2s;
}
.stat-card:hover { border-color: var(--text-muted) !important; }
.stat-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.stat-label { color: var(--text-secondary); font-size: 12px; }
.stat-value { font-size: 22px; font-weight: 600; line-height: 1.2; margin-bottom: 4px; }
.stat-sub { color: var(--text-muted); font-size: 11px; }
.gateway-card { border-left: 3px solid #1677ff !important; }
.status-log {
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 10px 14px;
  color: var(--text-secondary);
  font-size: 11px;
  font-family: 'Consolas', monospace;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  margin: 0;
  line-height: 1.6;
}
.telemetry-card {
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 14px;
  height: 100%;
}
.telemetry-label {
  color: var(--text-muted);
  font-size: 12px;
  margin-bottom: 6px;
}
.telemetry-value {
  color: #91caff;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.2;
}
.telemetry-sub {
  color: var(--text-secondary);
  font-size: 11px;
  margin-top: 4px;
}
.telemetry-section {
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 14px;
  min-height: 140px;
}
.telemetry-section-title {
  color: var(--text-secondary);
  font-size: 12px;
  margin-bottom: 10px;
}
.telemetry-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.telemetry-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 12px;
}
.telemetry-empty {
  color: var(--text-muted);
  font-size: 12px;
}
</style>
