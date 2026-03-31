<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">MCP 工具</h2>
        <p class="page-sub">Model Context Protocol — 已挂载工具与服务器</p>
      </div>
      <a-button type="primary" ghost :loading="loading" @click="load">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <!-- Stats Row -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="24" :sm="8">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic title="服务器数量" :value="servers.length" value-style="color: #1677ff; font-size: 20px;">
            <template #prefix><CloudServerOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic title="工具数量" :value="tools.length" value-style="color: #52c41a; font-size: 20px;">
            <template #prefix><ToolOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic title="运行状态" value="就绪" value-style="color: #52c41a; font-size: 20px;">
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Servers -->
    <a-card title="已配置服务器" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
      <div v-if="loading" style="text-align: center; padding: 30px;"><a-spin /></div>
      <div v-else-if="!servers.length" style="text-align: center; padding: 30px; color: var(--text-muted);">
        暂无 MCP 服务器，使用 <code style="background: var(--bg-card-hover); padding: 2px 6px; border-radius: 3px;">chainlesschain mcp add</code> 添加
      </div>
      <div v-else class="servers-grid">
        <a-card
          v-for="srv in servers"
          :key="srv.name"
          size="small"
          style="background: var(--bg-card-hover); border-color: var(--border-color);"
        >
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
            <CloudServerOutlined style="color: #1677ff;" />
            <span style="color: #e0e0e0; font-weight: 500; font-family: monospace;">{{ srv.name }}</span>
            <a-badge status="success" />
          </div>
          <div v-if="srv.command" style="color: var(--text-secondary); font-size: 11px; font-family: monospace;">
            {{ srv.command }} {{ srv.args?.join(' ') }}
          </div>
          <div v-if="srv.description" style="color: var(--text-secondary); font-size: 11px; margin-top: 4px;">{{ srv.description }}</div>
        </a-card>
      </div>
    </a-card>

    <!-- Tools -->
    <a-card title="可用工具" style="background: var(--bg-card); border-color: var(--border-color);">
      <template #extra>
        <a-input-search
          v-model:value="toolSearch"
          placeholder="搜索工具..."
          allow-clear
          size="small"
          style="width: 200px;"
        />
      </template>
      <div v-if="loading" style="text-align: center; padding: 30px;"><a-spin /></div>
      <a-table
        v-else
        :columns="toolColumns"
        :data-source="filteredTools"
        :pagination="{ pageSize: 15 }"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <span style="color: #91caff; font-family: monospace; font-size: 12px;">{{ record.name }}</span>
          </template>
          <template v-if="column.key === 'server'">
            <a-tag color="blue" style="font-size: 10px;">{{ record.server }}</a-tag>
          </template>
        </template>
        <template #emptyText>
          <div style="padding: 30px; color: var(--text-muted);">暂无可用工具</div>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ReloadOutlined, CloudServerOutlined, ToolOutlined, CheckCircleOutlined } from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'

const ws = useWsStore()

const loading = ref(false)
const servers = ref([])
const tools = ref([])
const toolSearch = ref('')

const filteredTools = computed(() => {
  if (!toolSearch.value) return tools.value
  const q = toolSearch.value.toLowerCase()
  return tools.value.filter(t => t.name?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q))
})

const toolColumns = [
  { title: '工具名称', key: 'name', dataIndex: 'name', width: '30%' },
  { title: '服务器', key: 'server', dataIndex: 'server', width: '20%' },
  { title: '描述', dataIndex: 'description', ellipsis: true },
]

async function load() {
  loading.value = true
  try {
    const [serversResult, toolsResult] = await Promise.all([
      ws.execute('mcp servers', 15000).catch(() => ({ output: '' })),
      ws.execute('mcp tools', 15000).catch(() => ({ output: '' })),
    ])
    servers.value = parseServers(serversResult.output)
    tools.value = parseTools(toolsResult.output)
  } catch (e) {
    console.error('MCP load failed:', e)
  } finally {
    loading.value = false
  }
}

function parseServers(output) {
  const result = []
  const lines = output.split('\n')
  let current = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('MCP')) continue
    // Name line: "  servername" or "● servername"
    const nameMatch = trimmed.match(/^[●•]?\s*([a-z][a-z0-9-_]+)\s*$/i)
      || trimmed.match(/^([a-z][a-z0-9-_]+)\s*[:：]/)
    if (nameMatch) {
      if (current) result.push(current)
      current = { key: nameMatch[1], name: nameMatch[1], command: '', args: [], description: '' }
    } else if (current) {
      if (trimmed.startsWith('command:') || trimmed.startsWith('Command:')) {
        current.command = trimmed.replace(/^command:\s*/i, '').trim()
      } else if (trimmed.startsWith('args:') || trimmed.startsWith('Args:')) {
        current.args = trimmed.replace(/^args:\s*/i, '').split(',').map(a => a.trim())
      } else if (!current.description) {
        current.description = trimmed.slice(0, 80)
      }
    }
  }
  if (current) result.push(current)
  // If no servers parsed but output has content, show raw entries
  if (!result.length && output.trim() && !output.includes('No MCP')) {
    const entries = output.split('\n').filter(l => l.trim() && !l.includes('─'))
    entries.slice(0, 10).forEach((e, i) => {
      result.push({ key: i, name: e.trim(), command: '', args: [], description: '' })
    })
  }
  return result
}

function parseTools(output) {
  const result = []
  const lines = output.split('\n')
  let currentServer = 'unknown'
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─')) continue
    // Server header
    if (trimmed.match(/^\[/) || trimmed.match(/^Server:/i)) {
      currentServer = trimmed.replace(/[\[\]]/g, '').replace(/^Server:\s*/i, '').trim()
      continue
    }
    // Tool entry: "  tool_name - description" or "● tool_name"
    const m = trimmed.match(/^[●•]?\s*([a-z][a-z0-9_-]+)\s*[-–]\s*(.+)/i)
      || trimmed.match(/^[●•]?\s*([a-z][a-z0-9_-]+)$/)
    if (m) {
      result.push({ key: result.length, name: m[1], description: m[2] || '', server: currentServer })
    }
  }
  return result
}

onMounted(load)
</script>

<style scoped>
.servers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}
</style>
