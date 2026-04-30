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
          <template v-if="column.key === 'action'">
            <a-button
              v-if="dataSource === 'topic'"
              size="small"
              type="link"
              @click="openRunModal(record)"
            >
              <template #icon><PlayCircleOutlined /></template>
              运行
            </a-button>
            <span v-else style="color: var(--text-muted); font-size: 11px;">仅桌面模式</span>
          </template>
        </template>
        <template #emptyText>
          <div style="padding: 30px; color: var(--text-muted);">暂无可用工具</div>
        </template>
      </a-table>
    </a-card>

    <a-modal
      :open="runModalOpen"
      :title="runModalTitle"
      :width="640"
      :confirm-loading="running"
      :ok-text="running ? '运行中...' : '运行'"
      cancel-text="关闭"
      @ok="runSelectedTool"
      @cancel="closeRunModal"
    >
      <div v-if="selectedTool" style="display: flex; flex-direction: column; gap: 12px;">
        <div>
          <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">服务器 / 工具</div>
          <div style="font-family: monospace; font-size: 13px;">
            <a-tag color="blue">{{ selectedTool.server }}</a-tag>
            <span style="color: #91caff;">{{ selectedTool.name }}</span>
          </div>
        </div>
        <div v-if="selectedTool.description">
          <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">描述</div>
          <div style="font-size: 12px;">{{ selectedTool.description }}</div>
        </div>
        <div v-if="selectedTool.inputSchema">
          <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">参数 schema</div>
          <pre style="background: var(--bg-card-hover); padding: 8px; border-radius: 4px; font-size: 11px; max-height: 140px; overflow: auto; margin: 0;">{{ formattedSchema }}</pre>
        </div>
        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: var(--text-muted); font-size: 11px;">参数</span>
            <a-radio-group v-model:value="paramMode" size="small" button-style="solid">
              <a-radio-button value="form" :disabled="!hasFormSchema">表单</a-radio-button>
              <a-radio-button value="json">JSON</a-radio-button>
            </a-radio-group>
          </div>
          <McpToolForm
            v-if="paramMode === 'form'"
            v-model="formValues"
            :schema="selectedTool.inputSchema"
            :errors="formErrors"
          />
          <template v-else>
            <a-textarea
              v-model:value="paramsText"
              :rows="6"
              :placeholder="'{}'"
              style="font-family: monospace; font-size: 12px;"
            />
            <div v-if="paramsParseError" style="color: #ff4d4f; font-size: 11px; margin-top: 4px;">
              JSON 解析失败：{{ paramsParseError }}
            </div>
          </template>
        </div>
        <div v-if="runError" style="background: #2a1517; border: 1px solid #5c2426; padding: 8px; border-radius: 4px;">
          <div style="color: #ff4d4f; font-size: 11px; font-weight: 500; margin-bottom: 4px;">运行失败</div>
          <pre style="color: #ff7875; font-size: 11px; margin: 0; white-space: pre-wrap;">{{ runError }}</pre>
        </div>
        <div v-if="runResult !== null">
          <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">结果</div>
          <pre style="background: var(--bg-card-hover); padding: 8px; border-radius: 4px; font-size: 11px; max-height: 240px; overflow: auto; margin: 0; white-space: pre-wrap;">{{ formattedResult }}</pre>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ReloadOutlined, CloudServerOutlined, ToolOutlined, CheckCircleOutlined, PlayCircleOutlined } from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'
import { useMcp } from '../composables/useMcp.js'
import McpToolForm from '../components/McpToolForm.vue'
import { extractFields, defaultValues, validateValues } from '../utils/mcp-schema.js'

const ws = useWsStore()
const mcp = useMcp()

const loading = ref(false)
const servers = ref([])
const tools = ref([])
const toolSearch = ref('')
const dataSource = ref('')   // 'topic' | 'cli' — surfaced in template hint, helps debug

const filteredTools = computed(() => {
  if (!toolSearch.value) return tools.value
  const q = toolSearch.value.toLowerCase()
  return tools.value.filter(t => t.name?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q))
})

const toolColumns = [
  { title: '工具名称', key: 'name', dataIndex: 'name', width: '28%' },
  { title: '服务器', key: 'server', dataIndex: 'server', width: '18%' },
  { title: '描述', dataIndex: 'description', ellipsis: true },
  { title: '操作', key: 'action', width: 110 },
]

// Run-tool modal state — only meaningful in topic mode (CLI mode falls back
// to the old text-parsing path which never had inputSchema, so we hide the
// trigger entirely there).
const runModalOpen = ref(false)
const selectedTool = ref(null)
const paramMode = ref('form')              // 'form' | 'json'
const formValues = ref({})                  // Form-mode values, keyed by property name
const formErrors = ref({})                  // Form-mode per-field errors
const paramsText = ref('{}')                // JSON-mode raw text
const running = ref(false)
const runResult = ref(null)
const runError = ref('')

const hasFormSchema = computed(() => {
  return extractFields(selectedTool.value?.inputSchema || null).length > 0
})

const runModalTitle = computed(() => {
  if (!selectedTool.value) return '运行 MCP 工具'
  return `运行 ${selectedTool.value.server}.${selectedTool.value.name}`
})

const formattedSchema = computed(() => {
  if (!selectedTool.value?.inputSchema) return ''
  try {
    return JSON.stringify(selectedTool.value.inputSchema, null, 2)
  } catch {
    return String(selectedTool.value.inputSchema)
  }
})

const formattedResult = computed(() => {
  if (runResult.value === null) return ''
  try {
    return JSON.stringify(runResult.value, null, 2)
  } catch {
    return String(runResult.value)
  }
})

const paramsParseError = ref('')

function openRunModal(tool) {
  selectedTool.value = tool
  paramsText.value = '{}'
  runResult.value = null
  runError.value = ''
  paramsParseError.value = ''
  formErrors.value = {}
  // Default to form mode whenever the tool has a usable schema; JSON mode
  // is the escape hatch for tools whose schema falls outside extractFields'
  // supported subset (nested objects, arrays of objects, etc).
  const fields = extractFields(tool?.inputSchema || null)
  paramMode.value = fields.length > 0 ? 'form' : 'json'
  formValues.value = defaultValues(fields)
  runModalOpen.value = true
}

function closeRunModal() {
  runModalOpen.value = false
  // Keep selectedTool / result around briefly so the close animation
  // doesn't render an empty modal — Vue tears it down on next tick anyway.
}

async function runSelectedTool() {
  if (!selectedTool.value || running.value) return
  paramsParseError.value = ''
  formErrors.value = {}
  let params = {}

  if (paramMode.value === 'form') {
    const fields = extractFields(selectedTool.value.inputSchema || null)
    const r = validateValues(fields, formValues.value)
    if (!r.ok) {
      formErrors.value = r.errors
      return
    }
    params = r.params
  } else {
    const txt = (paramsText.value || '').trim()
    if (txt) {
      try {
        params = JSON.parse(txt)
      } catch (err) {
        paramsParseError.value = err.message || 'invalid JSON'
        return
      }
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        paramsParseError.value = '参数必须是 JSON 对象'
        return
      }
    }
  }

  running.value = true
  runError.value = ''
  runResult.value = null
  try {
    const r = await mcp.callTool(
      selectedTool.value.server,
      selectedTool.value.name,
      params,
    )
    runResult.value = r
  } catch (err) {
    runError.value = err?.message || String(err)
  } finally {
    running.value = false
  }
}

/**
 * Topic path — works inside the desktop web-shell where mcp.list_tools is
 * registered (see desktop-app-vue/src/main/web-shell/handlers/mcp-handlers.js).
 * Returns false on `mcp_unavailable` / `no_handler` so the caller falls back
 * to the CLI execute path.
 */
async function loadFromTopic() {
  const r = await mcp.listTools()
  if (!r || !Array.isArray(r.servers)) return false
  servers.value = r.servers.map((s) => ({
    key: s.name,
    name: s.name,
    command: '',         // topic doesn't expose config-time command/args
    args: [],
    description: s.state ? `state: ${s.state}` : '',
    error: s.error || null,
  }))
  const flat = []
  for (const s of r.servers) {
    if (!Array.isArray(s.tools)) continue
    for (const t of s.tools) {
      flat.push({
        key: `${s.name}.${t.name}`,
        name: t.name,
        description: t.description || '',
        server: s.name,
        inputSchema: t.inputSchema || null,
      })
    }
  }
  tools.value = flat
  return true
}

async function load() {
  loading.value = true
  try {
    // Prefer the topic path — it's the only one that works in the embedded
    // desktop web-shell (Electron can't spawn the cc CLI as a child). When
    // the topic isn't registered (standalone CLI mode in a browser), fall
    // back to ws.execute. Either path populates the same `servers` + `tools`
    // refs so the template doesn't branch.
    try {
      const ok = await loadFromTopic()
      if (ok) {
        dataSource.value = 'topic'
        return
      }
    } catch (err) {
      // Expected when the desktop web-shell isn't loaded — CLI mode falls through.
      const msg = err?.message || ''
      const recoverable =
        msg.includes('mcp_unavailable') ||
        msg.includes('no_handler') ||
        msg.includes('UNKNOWN_TYPE')
      if (!recoverable) {
        console.error('MCP topic load failed:', err)
      }
    }
    const [serversResult, toolsResult] = await Promise.all([
      ws.execute('mcp servers', 15000).catch(() => ({ output: '' })),
      ws.execute('mcp tools', 15000).catch(() => ({ output: '' })),
    ])
    servers.value = parseServers(serversResult.output)
    tools.value = parseTools(toolsResult.output)
    dataSource.value = 'cli'
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
