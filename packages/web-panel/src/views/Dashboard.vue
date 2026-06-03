<template>
  <div>
    <div
      style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;"
    >
      <div>
        <h2 class="page-title">{{ $t('dashboard.title') }}</h2>
        <p class="page-sub">
          {{
            isProject
              ? $t('dashboard.subProject', { name: cfg.projectName || $t('dashboard.unnamedProject') })
              : $t('dashboard.subGlobal')
          }}
        </p>
      </div>
      <a-button type="primary" ghost :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        {{ $t('dashboard.refresh') }}
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
          <div style="color: #91caff; font-weight: 600;">{{ cfg.projectName || $t('dashboard.projectBanner.fallbackName') }}</div>
          <div style="color: #4a6fa5; font-size: 11px; font-family: monospace;">{{ cfg.projectRoot }}</div>
        </div>
        <a-tag color="blue" style="margin-left: auto;">{{ $t('dashboard.projectBanner.tag') }}</a-tag>
      </div>
    </a-card>

    <a-row :gutter="[12, 12]" style="margin-bottom: 16px;">
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card class="stat-card gateway-card" size="small">
          <div class="stat-header">
            <span class="stat-label">{{ $t('dashboard.stats.wsGateway') }}</span>
            <a-badge :status="wsStatus === 'connected' ? 'success' : 'error'" />
          </div>
          <div class="stat-value" :style="{ color: wsStatus === 'connected' ? '#52c41a' : '#888' }">
            {{ wsStatus === 'connected' ? $t('dashboard.stats.wsRunning') : $t('dashboard.stats.wsDisconnected') }}
          </div>
          <div class="stat-sub">{{ $t('dashboard.stats.wsPortLine', { port: cfg.wsPort || 18800, host: cfg.wsHost || '127.0.0.1' }) }}</div>
        </a-card>
      </a-col>

      <a-col :xs="24" :sm="12" :lg="6">
        <a-card class="stat-card" size="small">
          <div class="stat-header">
            <span class="stat-label">{{ $t('dashboard.stats.currentLlm') }}</span>
            <RobotOutlined style="color: #1677ff;" />
          </div>
          <div
            class="stat-value"
            style="color: #91caff; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
          >
            {{ stats.activeLlm || $t('dashboard.stats.llmUnconfigured') }}
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
            <span class="stat-label">{{ $t('dashboard.stats.skills') }}</span>
            <AppstoreOutlined style="color: #1677ff;" />
          </div>
          <div class="stat-value" style="color: #1677ff;">{{ stats.skillCount || '—' }}</div>
          <div class="stat-sub">{{ $t('dashboard.stats.skillsHint') }}</div>
        </a-card>
      </a-col>

      <a-col :xs="24" :sm="12" :lg="6">
        <a-card class="stat-card" size="small" style="cursor: pointer;" @click="$router.push('/chat')">
          <div class="stat-header">
            <span class="stat-label">{{ $t('dashboard.stats.sessions') }}</span>
            <MessageOutlined style="color: #722ed1;" />
          </div>
          <div class="stat-value" style="color: #c084fc;">{{ stats.sessionCount }}</div>
          <div class="stat-sub">{{ $t('dashboard.stats.sessionsHint') }}</div>
        </a-card>
      </a-col>
    </a-row>

    <a-row :gutter="[12, 12]" style="margin-bottom: 16px;">
      <a-col :xs="24" :sm="8">
        <a-card class="stat-card" size="small">
          <div class="stat-header">
            <span class="stat-label">{{ $t('dashboard.stats.appStatus') }}</span>
            <DesktopOutlined :style="{ color: stats.appRunning ? '#52c41a' : '#888' }" />
          </div>
          <div
            class="stat-value"
            :style="{ color: stats.appRunning ? '#52c41a' : '#888', fontSize: '15px' }"
          >
            {{ stats.appRunning ? $t('dashboard.stats.appRunning') : stats.setupDone ? $t('dashboard.stats.appReady') : $t('dashboard.stats.appNotStarted') }}
          </div>
          <div class="stat-sub">{{ $t('dashboard.stats.edition', { name: stats.edition || 'Community' }) }}</div>
        </a-card>
      </a-col>

      <a-col :xs="24" :sm="8">
        <a-card class="stat-card" size="small" style="cursor: pointer;" @click="$router.push('/mcp')">
          <div class="stat-header">
            <span class="stat-label">{{ $t('dashboard.stats.mcp') }}</span>
            <ToolOutlined style="color: #13c2c2;" />
          </div>
          <div class="stat-value" style="color: #13c2c2;">{{ stats.mcpCount ?? '—' }}</div>
          <div class="stat-sub">{{ $t('dashboard.stats.mcpHint') }}</div>
        </a-card>
      </a-col>

      <a-col :xs="24" :sm="8">
        <a-card class="stat-card" size="small" style="cursor: pointer;" @click="$router.push('/notes')">
          <div class="stat-header">
            <span class="stat-label">{{ $t('dashboard.stats.notes') }}</span>
            <FileTextOutlined style="color: #faad14;" />
          </div>
          <div class="stat-value" style="color: #faad14;">{{ stats.noteCount ?? '—' }}</div>
          <div class="stat-sub">{{ $t('dashboard.stats.notesHint') }}</div>
        </a-card>
      </a-col>
    </a-row>

    <a-row :gutter="[16, 16]">
      <a-col :xs="24" :lg="10">
        <a-card :title="$t('dashboard.quick.title')" style="background: var(--bg-card); border-color: var(--border-color); height: 100%;">
          <a-space direction="vertical" style="width: 100%;" size="middle">
            <a-button type="primary" block @click="$router.push('/chat')">
              <template #icon><MessageOutlined /></template>
              {{ isProject ? $t('dashboard.quick.enterProjectChat') : $t('dashboard.quick.newAiChat') }}
            </a-button>
            <a-button
              block
              @click="newAgentSession"
              style="background: rgba(114,46,209,.12); border-color: #722ed1; color: #722ed1;"
            >
              <template #icon><RobotOutlined /></template>
              {{ $t('dashboard.quick.startAgent') }}
            </a-button>
            <a-row :gutter="8">
              <a-col :span="12">
                <a-button
                  block
                  @click="$router.push('/services')"
                  style="background: var(--bg-card-hover); border-color: var(--border-color);"
                >
                  <template #icon><SettingOutlined /></template>
                  {{ $t('dashboard.quick.services') }}
                </a-button>
              </a-col>
              <a-col :span="12">
                <a-button
                  block
                  @click="$router.push('/logs')"
                  style="background: var(--bg-card-hover); border-color: var(--border-color);"
                >
                  <template #icon><FileTextOutlined /></template>
                  {{ $t('dashboard.quick.logs') }}
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
                  {{ $t('dashboard.quick.skills') }}
                </a-button>
              </a-col>
              <a-col :span="12">
                <a-button
                  block
                  @click="$router.push('/providers')"
                  style="background: var(--bg-card-hover); border-color: var(--border-color);"
                >
                  <template #icon><ApiOutlined /></template>
                  {{ $t('dashboard.quick.providers') }}
                </a-button>
              </a-col>
            </a-row>
          </a-space>
        </a-card>
      </a-col>

      <a-col :xs="24" :lg="14">
        <a-card
          :title="$t('dashboard.status.title')"
          style="background: var(--bg-card); border-color: var(--border-color);"
          :loading="loading"
        >
          <template #extra>
            <a-button type="link" size="small" @click="$router.push('/logs')">{{ $t('dashboard.status.more') }}</a-button>
          </template>
          <pre class="status-log">{{ statusLog || $t('dashboard.status.placeholder') }}</pre>
        </a-card>
      </a-col>
    </a-row>

    <a-card
      :title="$t('dashboard.telemetry.title')"
      style="background: var(--bg-card); border-color: var(--border-color); margin-top: 16px;"
      :loading="loading"
    >
      <a-row :gutter="[12, 12]" style="margin-bottom: 12px;">
        <a-col :xs="24" :md="8">
          <div class="telemetry-filter">
            <div class="telemetry-filter-label">{{ $t('dashboard.telemetry.filterWindow') }}</div>
            <a-select v-model:value="telemetryFilters.windowPreset" style="width: 100%;" @change="refreshCompression">
              <a-select-option value="all">{{ $t('dashboard.telemetry.windowAll') }}</a-select-option>
              <a-select-option value="1h">{{ $t('dashboard.telemetry.window1h') }}</a-select-option>
              <a-select-option value="24h">{{ $t('dashboard.telemetry.window24h') }}</a-select-option>
              <a-select-option value="7d">{{ $t('dashboard.telemetry.window7d') }}</a-select-option>
            </a-select>
          </div>
        </a-col>
        <a-col :xs="24" :md="8">
          <div class="telemetry-filter">
            <div class="telemetry-filter-label">{{ $t('dashboard.telemetry.filterProvider') }}</div>
            <a-select v-model:value="telemetryFilters.provider" style="width: 100%;" @change="refreshCompression">
              <a-select-option value="">{{ $t('dashboard.telemetry.providerAll') }}</a-select-option>
              <a-select-option v-for="item in providerEntries" :key="item.key" :value="item.key">
                {{ item.key }}
              </a-select-option>
            </a-select>
          </div>
        </a-col>
        <a-col :xs="24" :md="8">
          <div class="telemetry-filter">
            <div class="telemetry-filter-label">{{ $t('dashboard.telemetry.filterModel') }}</div>
            <a-select v-model:value="telemetryFilters.model" style="width: 100%;" @change="refreshCompression">
              <a-select-option value="">{{ $t('dashboard.telemetry.modelAll') }}</a-select-option>
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
            <div class="telemetry-label">{{ $t('dashboard.telemetry.hitRate') }}</div>
            <div class="telemetry-value">{{ formatPercent(compression.hitRate) }}</div>
            <div class="telemetry-sub">
              {{ $t('dashboard.telemetry.hitRateSub', { compressed: compression.compressedSamples, total: compression.samples }) }}
            </div>
          </div>
        </a-col>
        <a-col :xs="24" :sm="8">
          <div class="telemetry-card">
            <div class="telemetry-label">{{ $t('dashboard.telemetry.savedTokens') }}</div>
            <div class="telemetry-value">{{ compression.totalSavedTokens }}</div>
            <div class="telemetry-sub">{{ $t('dashboard.telemetry.savedTokensSub', { avg: compression.averageSavedTokens }) }}</div>
          </div>
        </a-col>
        <a-col :xs="24" :sm="8">
          <div class="telemetry-card">
            <div class="telemetry-label">{{ $t('dashboard.telemetry.netSavingsRate') }}</div>
            <div class="telemetry-value">{{ formatPercent(compression.netSavingsRate) }}</div>
            <div class="telemetry-sub">
              {{ $t('dashboard.telemetry.netSavingsRateSub', { original: compression.totalOriginalTokens, compressed: compression.totalCompressedTokens }) }}
            </div>
          </div>
        </a-col>
      </a-row>

      <a-row :gutter="[16, 16]" style="margin-top: 12px;">
        <a-col :xs="24" :lg="12">
          <div class="telemetry-section">
            <div class="telemetry-section-title">{{ $t('dashboard.telemetry.strategyDistribution') }}</div>
            <div v-if="compression.strategyDistribution.length === 0" class="telemetry-empty">{{ $t('dashboard.telemetry.strategyEmpty') }}</div>
            <div v-else class="telemetry-list">
              <div
                v-for="item in compression.strategyDistribution.slice(0, 6)"
                :key="item.strategy"
                class="telemetry-row"
              >
                <span>{{ item.strategy }}</span>
                <span>{{ $t('dashboard.telemetry.strategyRow', { hits: item.hits, rate: formatPercent(item.hitRate) }) }}</span>
              </div>
            </div>
          </div>
        </a-col>
        <a-col :xs="24" :lg="12">
          <div class="telemetry-section">
            <div class="telemetry-section-title">{{ $t('dashboard.telemetry.variantDistribution') }}</div>
            <div v-if="variantEntries.length === 0" class="telemetry-empty">{{ $t('dashboard.telemetry.variantEmpty') }}</div>
            <div v-else class="telemetry-list">
              <div v-for="[variant, count] in variantEntries" :key="variant" class="telemetry-row">
                <span>{{ variant }}</span>
                <span>{{ $t('dashboard.telemetry.variantRow', { count }) }}</span>
              </div>
            </div>
          </div>
        </a-col>
      </a-row>

      <a-row :gutter="[16, 16]" style="margin-top: 12px;">
        <a-col :xs="24" :lg="12">
          <div class="telemetry-section">
            <div class="telemetry-section-title">{{ $t('dashboard.telemetry.providerSlice') }}</div>
            <div v-if="providerEntries.length === 0" class="telemetry-empty">{{ $t('dashboard.telemetry.providerEmpty') }}</div>
            <div v-else class="telemetry-list">
              <div v-for="item in providerEntries.slice(0, 6)" :key="item.key" class="telemetry-row">
                <span>{{ item.key }}</span>
                <span>{{ $t('dashboard.telemetry.providerRow', { samples: item.samples, rate: formatPercent(item.hitRate) }) }}</span>
              </div>
            </div>
          </div>
        </a-col>
        <a-col :xs="24" :lg="12">
          <div class="telemetry-section">
            <div class="telemetry-section-title">{{ $t('dashboard.telemetry.modelSlice') }}</div>
            <div v-if="modelEntries.length === 0" class="telemetry-empty">{{ $t('dashboard.telemetry.modelEmpty') }}</div>
            <div v-else class="telemetry-list">
              <div v-for="item in modelEntries.slice(0, 6)" :key="item.key" class="telemetry-row">
                <span>{{ item.key }}</span>
                <span>{{ $t('dashboard.telemetry.modelRow', { samples: item.samples, saved: item.savedTokens }) }}</span>
              </div>
            </div>
          </div>
        </a-col>
      </a-row>
    </a-card>

    <a-card :title="$t('dashboard.info.title')" style="background: var(--bg-card); border-color: var(--border-color); margin-top: 16px;">
      <a-descriptions :column="{ xs: 1, sm: 2, lg: 3 }" size="small">
        <a-descriptions-item :label="$t('dashboard.info.panelMode')">
          <a-tag :color="isProject ? 'blue' : 'purple'">{{ isProject ? $t('dashboard.info.modeProject') : $t('dashboard.info.modeGlobal') }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item v-if="isProject" :label="$t('dashboard.info.projectName')">
          <span style="color: #91caff;">{{ cfg.projectName || '—' }}</span>
        </a-descriptions-item>
        <a-descriptions-item v-if="isProject" :label="$t('dashboard.info.projectPath')">
          <span style="color: var(--text-muted); font-family: monospace; font-size: 11px;">{{ cfg.projectRoot }}</span>
        </a-descriptions-item>
        <a-descriptions-item :label="$t('dashboard.info.websocket')">
          <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">
            ws://{{ cfg.wsHost || '127.0.0.1' }}:{{ cfg.wsPort || 18800 }}
          </span>
        </a-descriptions-item>
        <a-descriptions-item :label="$t('dashboard.info.auth')">
          <a-tag :color="cfg.wsToken ? 'green' : 'default'" style="font-size: 11px;">
            {{ cfg.wsToken ? $t('dashboard.info.authEnabled') : $t('dashboard.info.authDisabled') }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item :label="$t('dashboard.info.version')">
          <span style="color: var(--text-muted);">{{ PRODUCT_VERSION }}</span>
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
const PRODUCT_VERSION = typeof __PRODUCT_VERSION__ !== 'undefined' ? __PRODUCT_VERSION__ : 'vDev'
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
