<template>
  <div>
    <!-- Page Title -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 style="margin: 0; color: #fff; font-size: 20px;">仪表板</h2>
        <p style="margin: 4px 0 0; color: #666; font-size: 13px;">
          {{ isProject ? `项目「${cfg.projectName || '未命名'}」的系统概览` : '全局系统概览' }}
        </p>
      </div>
      <a-button type="primary" ghost :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <!-- Project Mode: Project Info Card -->
    <a-card
      v-if="isProject"
      style="background: #0d1b2e; border-color: #1677ff30; margin-bottom: 20px;"
      size="small"
    >
      <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
        <FolderOutlined style="color: #1677ff; font-size: 20px;" />
        <div>
          <div style="color: #91caff; font-weight: 600; font-size: 15px;">{{ cfg.projectName || '项目' }}</div>
          <div style="color: #4a6fa5; font-size: 11px; font-family: monospace; margin-top: 2px;">{{ cfg.projectRoot }}</div>
        </div>
        <div style="margin-left: auto;">
          <a-tag color="blue">项目级面板</a-tag>
          <a-tooltip title="此面板的 AI 对话、技能运行均在此项目目录范围内">
            <InfoCircleOutlined style="color: #555; cursor: help; margin-left: 6px;" />
          </a-tooltip>
        </div>
      </div>
    </a-card>

    <!-- Global Mode: Notice -->
    <a-alert
      v-else
      type="info"
      style="margin-bottom: 20px; background: #1a0d2e; border-color: #722ed130;"
      show-icon
    >
      <template #message>
        <span style="color: #c084fc;">全局模式</span>
        <span style="color: #888; margin-left: 8px; font-size: 12px;">
          — 在项目目录下运行 <code style="background: #2a2a2a; padding: 1px 5px; border-radius: 3px;">chainlesschain ui</code> 可切换到项目级面板
        </span>
      </template>
    </a-alert>

    <!-- Status Cards -->
    <a-row :gutter="[16, 16]">
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: #1f1f1f; border-color: #303030;">
          <a-statistic
            title="WebSocket"
            :value="wsStatusText"
            :value-style="{ color: wsStatusColor, fontSize: '18px' }"
          >
            <template #prefix><ApiOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: #1f1f1f; border-color: #303030;">
          <a-statistic
            title="活跃 LLM"
            :value="stats.activeLlm || '未配置'"
            :value-style="{ color: stats.activeLlm ? '#52c41a' : '#888', fontSize: '18px' }"
          >
            <template #prefix><RobotOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: #1f1f1f; border-color: #303030;">
          <a-statistic
            title="可用技能"
            :value="stats.skillCount || '—'"
            value-style="color: #1677ff; font-size: 18px;"
          >
            <template #prefix><AppstoreOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: #1f1f1f; border-color: #303030;">
          <a-statistic
            title="AI 会话"
            :value="stats.sessionCount"
            value-style="color: #722ed1; font-size: 18px;"
          >
            <template #prefix><MessageOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Quick Actions -->
    <div style="margin-top: 24px;">
      <h3 style="color: #ccc; font-size: 15px; margin-bottom: 12px;">快速操作</h3>
      <a-space wrap>
        <a-button type="primary" @click="$router.push('/chat')">
          <template #icon><MessageOutlined /></template>
          {{ isProject ? '项目 Chat' : '新建对话' }}
        </a-button>
        <a-button @click="newAgentSession" style="background: #2a2a2a; border-color: #444;">
          <template #icon><RobotOutlined /></template>
          {{ isProject ? '项目 Agent' : 'Agent 模式' }}
        </a-button>
        <a-button @click="$router.push('/skills')" style="background: #2a2a2a; border-color: #444;">
          <template #icon><AppstoreOutlined /></template>
          {{ isProject ? '项目技能' : '浏览技能' }}
        </a-button>
        <a-button @click="$router.push('/providers')" style="background: #2a2a2a; border-color: #444;">
          <template #icon><ApiOutlined /></template>
          LLM 配置
        </a-button>
      </a-space>
    </div>

    <!-- System Info -->
    <div style="margin-top: 24px;">
      <h3 style="color: #ccc; font-size: 15px; margin-bottom: 12px;">运行信息</h3>
      <a-card style="background: #1f1f1f; border-color: #303030;">
        <a-descriptions :column="{ xs: 1, sm: 2 }" size="small">
          <a-descriptions-item label="面板模式">
            <a-tag :color="isProject ? 'blue' : 'purple'">
              {{ isProject ? '项目级' : '全局' }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item v-if="isProject" label="项目名称">
            <span style="color: #91caff;">{{ cfg.projectName || '—' }}</span>
          </a-descriptions-item>
          <a-descriptions-item v-if="isProject" label="项目路径">
            <span style="color: #555; font-family: monospace; font-size: 11px;">{{ cfg.projectRoot }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="WebSocket">
            <span style="color: #888; font-family: monospace; font-size: 12px;">
              ws://{{ cfg.wsHost || '127.0.0.1' }}:{{ cfg.wsPort || 18800 }}
            </span>
          </a-descriptions-item>
          <a-descriptions-item label="认证">
            <a-tag :color="cfg.wsToken ? 'green' : 'default'" style="font-size: 11px;">
              {{ cfg.wsToken ? '已启用' : '未启用' }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="版本">
            <span style="color: #555;">v5.0.2.5</span>
          </a-descriptions-item>
        </a-descriptions>
      </a-card>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  ReloadOutlined, ApiOutlined, RobotOutlined, AppstoreOutlined,
  MessageOutlined, FolderOutlined, InfoCircleOutlined
} from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'
import { useDashboardStore } from '../stores/dashboard.js'
import { useChatStore } from '../stores/chat.js'

const ws = useWsStore()
const dashboard = useDashboardStore()
const chatStore = useChatStore()
const router = useRouter()

const { loading, stats, refresh } = dashboard
const cfg = window.__CC_CONFIG__ || {}
const isProject = computed(() => cfg.mode === 'project')

const wsStatusText = computed(() => ({
  connected: '已连接', connecting: '连接中', error: '错误', disconnected: '未连接'
})[ws.status] || '未知')

const wsStatusColor = computed(() => ({
  connected: '#52c41a', connecting: '#faad14', error: '#ff4d4f', disconnected: '#888'
})[ws.status] || '#888')

async function newAgentSession() {
  await chatStore.createSession('agent')
  router.push('/chat')
}

onMounted(() => {
  setTimeout(refresh, 500)
})
</script>
