<template>
  <div>
    <div
      style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;"
    >
      <div>
        <h2 class="page-title">仪表板</h2>
        <p class="page-sub">
          {{
            isProject
              ? `项目「${cfg.projectName || '未命名'}」运行概览`
              : 'ChainlessChain 全局运行概览'
          }}
        </p>
      </div>
      <a-button type="primary" ghost :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <a-card
      v-if="isProject"
      style="background: rgba(22,119,255,.08); border-color: rgba(22,119,255,.25); margin-bottom: 16px;"
      size="small"
    >
      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
        <FolderOutlined style="color: #1677ff; font-size: 18px;" />
        <div>
          <div style="color: #91caff; font-weight: 600;">{{ cfg.projectName || '项目' }}</div>
          <div style="color: #4a6fa5; font-size: 11px; font-family: monospace;">{{ cfg.projectRoot }}</div>
        </div>
        <a-tag color="blue" style="margin-left: auto;">项目面板</a-tag>
      </div>
    </a-card>

    <a-row :gutter="[12, 12]" style="margin-bottom: 16px;">
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

      <a-col :xs="24" :sm="12" :lg="6">
        <a-card class="stat-card" size="small">
          <div class="stat-header">
            <span class="stat-label">当前 LLM</span>
            <RobotOutlined style="color: #1677ff;" />
          </div>
          <div
            class="stat-value"
            style="color: #91caff; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
          >
            {{ stats.activeLlm || '未配置' }}
          </div>
          <div
            class="stat-sub"
            style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
          >
            {{ stats.activeModel || '—' }}
          </div>
        </a-card>
      </a-col>

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

    <a-row :gutter="[12, 12]" style="margin-bottom: 16px;">
      <a-col :xs="24" :sm="8">
        <a-card class="stat-card" size="small">
          <div class="stat-header">
            <span class="stat-label">应用状态</span>
            <DesktopOutlined :style="{ color: stats.appRunning ? '#52c41a' : '#888' }" />
          </div>
          <div
            class="stat-value"
            :style="{ color: stats.appRunning ? '#52c41a' : '#888', fontSize: '15px' }"
          >
            {{ stats.appRunning ? '运行中' : stats.setupDone ? '已初始化' : '未启动' }}
          </div>
          <div class="stat-sub">{{ stats.edition || 'Community' }} Edition</div>
        </a-card>
      </a-col>

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

    <a-row :gutter="[16, 16]">
      <a-col :xs="24" :lg="10">
        <a-card title="快速操作" style="background: var(--bg-card); border-color: var(--border-color); height: 100%;">
          <a-space direction="vertical" style="width: 100%;" size="middle">
            <a-button type="primary" block @click="$router.push('/chat')">
              <template #icon><MessageOutlined /></template>
              {{ isProject ? '进入项目 Chat' : '新建 AI 对话' }}
            </a-button>
            <a-button
              block
              @click="newAgentSession"
              style="background: rgba(114,46,209,.12); border-color: #722ed1; color: #722ed1;"
            >
              <template #icon><RobotOutlined /></template>
              启动 Agent 模式
            </a-button>
            <a-row :gutter="8">
              <a-col :span="12">
                <a-button
                  block
                  @click="$router.push('/services')"
                  style="background: var(--bg-card-hover); border-color: var(--border-color);"
                >
                  <template #icon><SettingOutlined /></template>
                  服务管理
                </a-button>
              </a-col>
              <a-col :span="12">
                <a-button
                  block
                  @click="$router.push('/logs')"
                  style="background: var(--bg-card-hover); border-color: var(--border-color);"
                >
                  <template #icon><FileTextOutlined /></template>
                  查看日志
                </a-button>
              </a-col>
            </a-row>
            <a-row :gutter="8">
              <a-col :span="12">
                <a-button
                  block
                  @click="$router.push('/skills')"
                  style="background: var(--bg-card-hover); border-color: var(--border-color);"
                >
                  <template #icon><AppstoreOutlined /></template>
                  技能管理
                </a-button>
              </a-col>
              <a-col :span="12">
                <a-button
                  block
                  @click="$router.push('/providers')"
                  style="background: var(--bg-card-hover); border-color: var(--border-color);"
                >
                  <template #icon><ApiOutlined /></template>
                  LLM 配置
                </a-button>
              </a-col>
            </a-row>
          </a-space>
        </a-card>
      </a-col>

      <a-col :xs="24" :lg="14">
        <a-card
          title="最近状态"
          style="background: var(--bg-card); border-color: var(--border-color);"
          :loading="loading"
        >
          <template #extra>
            <a-button type="link" size="small" @click="$router.push('/logs')">查看更多</a-button>
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
      <a-row :gutter="[12, 12]" style="margin-bottom: 12px;">
        <a-col :xs="24" :md="8">
          <div class="telemetry-filter">
            <div class="telemetry-filter-label">时间窗口</div>
            <a-select v-model:value="telemetryFilters.windowPreset" style="width: 100%;" @change="refreshCompression">
              <a-select-option value="all">全部样本</a-select-option>
              <a-select-option value="1h">近 1 小时</a-select-option>
              <a-select-option value="24h">近 24 小时</a-select-option>
              <a-select-option value="7d">近 7 天</a-select-option>
            </a-select>
          </div>
        </a-col>
        <a-col :xs="24" :md="8">
          <div class="telemetry-filter">
            <div class="telemetry-filter-label">Provider 切片</div>
            <a-select v-model:value="telemetryFilters.provider" style="width: 100%;" @change="refreshCompression">
              <a-select-option value="">全部 Provider</a-select-option>
              <a-select-option v-for="item in providerEntries" :key="item.key" :value="item.key">
                {{ item.key }}
              </a-select-option>
            </a-select>
          </div>
        </a-col>
        <a-col :xs="24" :md="8">
          <div class="telemetry-filter">
            <div class="telemetry-filter-label">Model 切片</div>
            <a-select v-model:value="telemetryFilters.model" style="width: 100%;" @change="refreshCompression">
              <a-select-option value="">全部 Model</a-select-option>
              <a-select-option v-for="item in modelEntries" :key="item.key" :value="item.key">
                {{ item.key }}
              </a-select-option>
            </a-select>
          </div>
        </a-col>
      </a-row>

      <a-row :gutter="[12, 12]">
        <a-col :xs="24" :sm="8">
          <div class="telemetry-card">
            <div class="telemetry-label">压缩命中率</div>
            <div class="telemetry-value">{{ formatPercent(compression.hitRate) }}</div>
            <div class="telemetry-sub">
              {{ compression.compressedSamples }} / {{ compression.samples }} 次压缩产生了有效节省
            </div>
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
            <div class="telemetry-sub">
              原始 {{ compression.totalOriginalTokens }} -> 压缩后 {{ compression.totalCompressedTokens }}
            </div>
          </div>
        </a-col>
      </a-row>

      <a-row :gutter="[16, 16]" style="margin-top: 12px;">
        <a-col :xs="24" :lg="12">
          <div class="telemetry-section">
            <div class="telemetry-section-title">策略命中分布</div>
            <div v-if="compression.strategyDistribution.length === 0" class="telemetry-empty">暂无压缩样本</div>
            <div v-else class="telemetry-list">
              <div
                v-for="item in compression.strategyDistribution.slice(0, 6)"
                :key="item.strategy"
                class="telemetry-row"
              >
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

      <a-row :gutter="[16, 16]" style="margin-top: 12px;">
        <a-col :xs="24" :lg="12">
          <div class="telemetry-section">
            <div class="telemetry-section-title">Provider 切片</div>
            <div v-if="providerEntries.length === 0" class="telemetry-empty">暂无 Provider 数据</div>
            <div v-else class="telemetry-list">
              <div v-for="item in providerEntries.slice(0, 6)" :key="item.key" class="telemetry-row">
                <span>{{ item.key }}</span>
                <span>{{ item.samples }} 次 · {{ formatPercent(item.hitRate) }}</span>
              </div>
            </div>
          </div>
        </a-col>
        <a-col :xs="24" :lg="12">
          <div class="telemetry-section">
            <div class="telemetry-section-title">Model 切片</div>
            <div v-if="modelEntries.length === 0" class="telemetry-empty">暂无 Model 数据</div>
            <div v-else class="telemetry-list">
              <div v-for="item in modelEntries.slice(0, 6)" :key="item.key" class="telemetry-row">
                <span>{{ item.key }}</span>
                <span>{{ item.samples }} 次 · {{ item.savedTokens }} saved</span>
              </div>
            </div>
          </div>
        </a-col>
      </a-row>
    </a-card>

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
          <span style="color: var(--text-muted);">v5.0.2.43</span>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  ReloadOutlined, ApiOutlined, RobotOutlined, AppstoreOutlined,
  MessageOutlined, FolderOutlined, DesktopOutlined, FileTextOutlined,
  ToolOutlined, SettingOutlined
} from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'
import { useChatStore } from '../stores/chat.js'
import { useDashboardStore } from '../stores/dashboard.js'

const router = useRouter()
const ws = useWsStore()
const chatStore = useChatStore()
const dashboardStore = useDashboardStore()
const cfg = window.__CC_CONFIG__ || {}
const isProject = computed(() => cfg.mode === 'project')
const wsStatus = computed(() => ws.status)
const loading = computed(() => dashboardStore.loading)
const statusLog = computed(() => dashboardStore.statusLog)
const telemetryFilters = computed(() => dashboardStore.telemetryFilters)
const compression = computed(() => dashboardStore.compression)
const stats = computed(() => dashboardStore.stats)
const variantEntries = computed(() => Object.entries(compression.value.variantDistribution || {}))
const providerEntries = computed(() => compression.value.providerDistribution || [])
const modelEntries = computed(() => compression.value.modelDistribution || [])

async function refresh() {
  await dashboardStore.refresh()
}

async function refreshCompression() {
  await dashboardStore.refreshCompression()
}

function formatPercent(value) {
  return `${((value || 0) * 100).toFixed(1)}%`
}

async function newAgentSession() {
  await chatStore.createSession('agent')
  router.push('/chat')
}

onMounted(() => {
  dashboardStore.ensureRuntimeSubscription(ws)
  setTimeout(refresh, 300)
})

onUnmounted(() => {
  dashboardStore.stopRuntimeSubscription()
})
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
  font-family: "Consolas", monospace;
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
.telemetry-filter {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.telemetry-filter-label {
  color: var(--text-muted);
  font-size: 12px;
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
