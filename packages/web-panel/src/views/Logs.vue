<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">日志查看</h2>
        <p class="page-sub">系统运行日志与诊断输出</p>
      </div>
      <a-space>
        <a-checkbox v-model:checked="autoScroll">自动滚动</a-checkbox>
        <a-button type="primary" ghost :loading="loading" @click="loadLog">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>
    </div>

    <!-- Tab Selector -->
    <a-tabs v-model:activeKey="activeTab" @change="loadLog" style="margin-bottom: 0;">
      <a-tab-pane key="status" tab="系统状态" />
      <a-tab-pane key="doctor" tab="环境诊断" />
      <a-tab-pane key="skill-sources" tab="技能来源" />
      <a-tab-pane key="llm-providers" tab="LLM 提供商" />
    </a-tabs>

    <!-- Search Bar -->
    <div style="display: flex; gap: 10px; margin: 12px 0;">
      <a-input-search
        v-model:value="searchQuery"
        placeholder="搜索日志内容..."
        allow-clear
        style="flex: 1;"
      />
      <a-tag v-if="filteredLines.length !== allLines.length" color="blue">
        {{ filteredLines.length }} / {{ allLines.length }} 行
      </a-tag>
    </div>

    <!-- Log Output -->
    <div
      ref="logContainer"
      class="log-box"
    >
      <div v-if="loading" style="text-align: center; padding: 40px; color: var(--text-muted);">
        <a-spin size="large" /><div style="margin-top: 10px;">加载中...</div>
      </div>
      <div v-else-if="!filteredLines.length" style="text-align: center; padding: 40px; color: var(--text-muted);">
        {{ error || '暂无日志内容，点击刷新加载' }}
      </div>
      <div v-else>
        <div
          v-for="(line, i) in filteredLines"
          :key="i"
          class="log-line"
          :class="lineClass(line)"
          v-html="highlightSearch(escapeHtml(line))"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { ReloadOutlined } from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'

const ws = useWsStore()

const activeTab = ref('status')
const loading = ref(false)
const error = ref('')
const rawOutput = ref('')
const searchQuery = ref('')
const autoScroll = ref(true)
const logContainer = ref(null)

const TAB_COMMANDS = {
  status: 'status',
  doctor: 'doctor',
  'skill-sources': 'skill sources',
  'llm-providers': 'llm providers',
}

const allLines = computed(() => rawOutput.value.split('\n'))

const filteredLines = computed(() => {
  if (!searchQuery.value) return allLines.value
  const q = searchQuery.value.toLowerCase()
  return allLines.value.filter(l => l.toLowerCase().includes(q))
})

function lineClass(line) {
  if (line.includes('✖') || line.includes('error') || line.includes('Error') || line.includes('failed')) return 'line-error'
  if (line.includes('✔') || line.includes('✓') || line.includes('success') || line.includes('running')) return 'line-success'
  if (line.includes('warn') || line.includes('Warn') || line.includes('○')) return 'line-warn'
  if (line.startsWith('  ') || line.startsWith('\t')) return 'line-indent'
  return ''
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlightSearch(line) {
  if (!searchQuery.value) return line
  const q = searchQuery.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return line.replace(new RegExp(`(${q})`, 'gi'), '<mark>$1</mark>')
}

async function loadLog() {
  loading.value = true
  error.value = ''
  rawOutput.value = ''
  const cmd = TAB_COMMANDS[activeTab.value] || 'status'
  try {
    const { output } = await ws.execute(cmd, 30000)
    rawOutput.value = output
    if (autoScroll.value) {
      await nextTick()
      if (logContainer.value) logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  } catch (e) {
    error.value = `执行失败: ${e.message}`
    rawOutput.value = error.value
  } finally {
    loading.value = false
  }
}

watch(filteredLines, async () => {
  if (autoScroll.value) {
    await nextTick()
    if (logContainer.value) logContainer.value.scrollTop = logContainer.value.scrollHeight
  }
})

onMounted(loadLog)
</script>

<style scoped>
.log-box {
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px 16px;
  height: calc(100vh - 280px);
  min-height: 300px;
  overflow-y: auto;
  font-family: 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.7;
}
.log-line { padding: 1px 0; white-space: pre-wrap; word-break: break-all; color: var(--text-secondary); }
.line-error { color: #ff6b6b; }
.line-success { color: #69db7c; }
.line-warn { color: #fcc419; }
.line-indent { color: var(--text-secondary); }
:deep(mark) { background: #d4a017; color: #000; border-radius: 2px; padding: 0 2px; }
</style>
