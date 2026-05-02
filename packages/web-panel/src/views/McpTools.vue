<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('mcpTools.title') }}</h2>
        <p class="page-sub">{{ t('mcpTools.subtitle') }}</p>
      </div>
      <a-button type="primary" ghost :loading="loading" @click="load">
        <template #icon><ReloadOutlined /></template>
        {{ t('mcpTools.refresh') }}
      </a-button>
    </div>

    <!-- Stats Row -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="24" :sm="8">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic :title="t('mcpTools.stats.servers')" :value="servers.length" value-style="color: #1677ff; font-size: 20px;">
            <template #prefix><CloudServerOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic :title="t('mcpTools.stats.tools')" :value="tools.length" value-style="color: #52c41a; font-size: 20px;">
            <template #prefix><ToolOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic :title="t('mcpTools.stats.running')" :value="t('mcpTools.stats.ready')" value-style="color: #52c41a; font-size: 20px;">
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Servers -->
    <a-card :title="t('mcpTools.servers.title')" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
      <div v-if="loading" style="text-align: center; padding: 30px;"><a-spin /></div>
      <div v-else-if="!servers.length" style="text-align: center; padding: 30px; color: var(--text-muted);">
        {{ t('mcpTools.servers.emptyHintPrefix') }} <code style="background: var(--bg-card-hover); padding: 2px 6px; border-radius: 3px;">{{ t('mcpTools.servers.emptyHintCommand') }}</code> {{ t('mcpTools.servers.emptyHintSuffix') }}
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
    <a-card :title="t('mcpTools.tools.title')" style="background: var(--bg-card); border-color: var(--border-color);">
      <template #extra>
        <a-input-search
          v-model:value="toolSearch"
          :placeholder="t('mcpTools.tools.searchPlaceholder')"
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
              {{ t('mcpTools.tools.runAction') }}
            </a-button>
            <span v-else style="color: var(--text-muted); font-size: 11px;">{{ t('mcpTools.tools.desktopOnly') }}</span>
          </template>
        </template>
        <template #emptyText>
          <div style="padding: 30px; color: var(--text-muted);">{{ t('mcpTools.tools.emptyText') }}</div>
        </template>
      </a-table>
    </a-card>

    <!-- Resources (topic mode only — CLI fallback doesn't surface resources) -->
    <a-card
      v-if="dataSource === 'topic'"
      :title="t('mcpTools.resources.title')"
      style="background: var(--bg-card); border-color: var(--border-color); margin-top: 16px;"
    >
      <template #extra>
        <a-input-search
          v-model:value="resourceSearch"
          :placeholder="t('mcpTools.resources.searchPlaceholder')"
          allow-clear
          size="small"
          style="width: 200px;"
        />
      </template>
      <div v-if="resourcesLoading" style="text-align: center; padding: 30px;"><a-spin /></div>
      <div v-else-if="!resources.length" style="text-align: center; padding: 30px; color: var(--text-muted);">
        {{ t('mcpTools.resources.emptyHint') }}
      </div>
      <a-table
        v-else
        :columns="resourceColumns"
        :data-source="filteredResources"
        :pagination="{ pageSize: 15 }"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'uri'">
            <span style="color: #87d068; font-family: monospace; font-size: 11px; word-break: break-all;">{{ record.uri }}</span>
          </template>
          <template v-if="column.key === 'server'">
            <a-tag color="blue" style="font-size: 10px;">{{ record.server }}</a-tag>
          </template>
          <template v-if="column.key === 'mimeType'">
            <a-tag v-if="record.mimeType" style="font-size: 10px;">{{ record.mimeType }}</a-tag>
            <span v-else style="color: var(--text-muted); font-size: 10px;">—</span>
          </template>
          <template v-if="column.key === 'action'">
            <a-button size="small" type="link" @click="openReadModal(record)">
              <template #icon><EyeOutlined /></template>
              {{ t('mcpTools.resources.readAction') }}
            </a-button>
          </template>
        </template>
        <template #emptyText>
          <div style="padding: 30px; color: var(--text-muted);">{{ t('mcpTools.resources.emptyTable') }}</div>
        </template>
      </a-table>
    </a-card>

    <a-modal
      :open="runModalOpen"
      :title="runModalTitle"
      :width="640"
      :confirm-loading="running"
      :ok-text="running ? t('mcpTools.run.okRunning') : t('mcpTools.run.okIdle')"
      :cancel-text="t('mcpTools.run.cancel')"
      @ok="runSelectedTool"
      @cancel="closeRunModal"
    >
      <div v-if="selectedTool" style="display: flex; flex-direction: column; gap: 12px;">
        <div>
          <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">{{ t('mcpTools.run.serverLabel') }}</div>
          <div style="font-family: monospace; font-size: 13px;">
            <a-tag color="blue">{{ selectedTool.server }}</a-tag>
            <span style="color: #91caff;">{{ selectedTool.name }}</span>
          </div>
        </div>
        <div v-if="selectedTool.description">
          <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">{{ t('mcpTools.run.descriptionLabel') }}</div>
          <div style="font-size: 12px;">{{ selectedTool.description }}</div>
        </div>
        <div v-if="selectedTool.inputSchema">
          <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">{{ t('mcpTools.run.schemaLabel') }}</div>
          <pre style="background: var(--bg-card-hover); padding: 8px; border-radius: 4px; font-size: 11px; max-height: 140px; overflow: auto; margin: 0;">{{ formattedSchema }}</pre>
        </div>
        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: var(--text-muted); font-size: 11px;">{{ t('mcpTools.run.paramsLabel') }}</span>
            <a-radio-group v-model:value="paramMode" size="small" button-style="solid">
              <a-radio-button value="form" :disabled="!hasFormSchema">{{ t('mcpTools.run.modeForm') }}</a-radio-button>
              <a-radio-button value="json">{{ t('mcpTools.run.modeJson') }}</a-radio-button>
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
              {{ t('mcpTools.run.jsonParseFailed', { err: paramsParseError }) }}
            </div>
          </template>
        </div>
        <div v-if="runError" style="background: #2a1517; border: 1px solid #5c2426; padding: 8px; border-radius: 4px;">
          <div style="color: #ff4d4f; font-size: 11px; font-weight: 500; margin-bottom: 4px;">{{ t('mcpTools.run.errorTitle') }}</div>
          <pre style="color: #ff7875; font-size: 11px; margin: 0; white-space: pre-wrap;">{{ runError }}</pre>
        </div>
        <div v-if="runResult !== null">
          <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">{{ t('mcpTools.run.resultLabel') }}</div>
          <pre style="background: var(--bg-card-hover); padding: 8px; border-radius: 4px; font-size: 11px; max-height: 240px; overflow: auto; margin: 0; white-space: pre-wrap;">{{ formattedResult }}</pre>
        </div>
      </div>
    </a-modal>

    <a-modal
      :open="readModalOpen"
      :title="readModalTitle"
      :width="720"
      :footer="null"
      @cancel="closeReadModal"
    >
      <div v-if="selectedResource" style="display: flex; flex-direction: column; gap: 12px;">
        <div>
          <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">{{ t('mcpTools.read.serverLabel') }}</div>
          <div style="font-family: monospace; font-size: 12px; word-break: break-all;">
            <a-tag color="blue">{{ selectedResource.server }}</a-tag>
            <span style="color: #87d068;">{{ selectedResource.uri }}</span>
          </div>
        </div>
        <div v-if="selectedResource.description">
          <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">{{ t('mcpTools.read.descriptionLabel') }}</div>
          <div style="font-size: 12px;">{{ selectedResource.description }}</div>
        </div>
        <div v-if="reading" style="text-align: center; padding: 20px;">
          <a-spin :tip="t('mcpTools.read.spinnerTip')" />
        </div>
        <div v-if="readError" style="background: #2a1517; border: 1px solid #5c2426; padding: 8px; border-radius: 4px;">
          <div style="color: #ff4d4f; font-size: 11px; font-weight: 500; margin-bottom: 4px;">{{ t('mcpTools.read.errorTitle') }}</div>
          <pre style="color: #ff7875; font-size: 11px; margin: 0; white-space: pre-wrap;">{{ readError }}</pre>
        </div>
        <div v-if="readContents.length">
          <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">{{ t('mcpTools.read.contentsLabel', { count: readContents.length }) }}</div>
          <div v-for="(c, i) in readContents" :key="i" style="margin-bottom: 12px;">
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 4px;">
              <a-tag v-if="c.mimeType" size="small" style="font-size: 10px;">{{ c.mimeType }}</a-tag>
              <span v-if="c.uri && c.uri !== selectedResource.uri" style="color: var(--text-muted); font-size: 10px; font-family: monospace;">{{ c.uri }}</span>
            </div>
            <pre v-if="c.text" style="background: var(--bg-card-hover); padding: 8px; border-radius: 4px; font-size: 11px; max-height: 360px; overflow: auto; margin: 0; white-space: pre-wrap; word-break: break-all;">{{ c.text }}</pre>
            <div v-else-if="c.blob" style="font-size: 11px; color: var(--text-muted); font-style: italic;">
              {{ t('mcpTools.read.binaryNote', { count: c.blob.length }) }}
            </div>
            <div v-else style="font-size: 11px; color: var(--text-muted); font-style: italic;">
              {{ t('mcpTools.read.emptyContent') }}
            </div>
          </div>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ReloadOutlined, CloudServerOutlined, ToolOutlined, CheckCircleOutlined, PlayCircleOutlined, EyeOutlined } from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'
import { useMcp } from '../composables/useMcp.js'
import McpToolForm from '../components/McpToolForm.vue'
import { extractFields, defaultValues, validateValues } from '../utils/mcp-schema.js'

const { t } = useI18n()
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
  return tools.value.filter(tool => tool.name?.toLowerCase().includes(q) || tool.description?.toLowerCase().includes(q))
})

const toolColumns = computed(() => [
  { title: t('mcpTools.toolColumns.name'), key: 'name', dataIndex: 'name', width: '28%' },
  { title: t('mcpTools.toolColumns.server'), key: 'server', dataIndex: 'server', width: '18%' },
  { title: t('mcpTools.toolColumns.description'), dataIndex: 'description', ellipsis: true },
  { title: t('mcpTools.toolColumns.action'), key: 'action', width: 110 },
])

// Resources state — populated lazily on first render in topic mode. In CLI
// fallback mode the panel is hidden entirely (the legacy ws.execute paths
// don't expose mcp.list_resources output).
const resources = ref([])
const resourceSearch = ref('')
const resourcesLoading = ref(false)
const resourcesLoaded = ref(false)

const resourceColumns = computed(() => [
  { title: t('mcpTools.resourceColumns.uri'), key: 'uri', dataIndex: 'uri' },
  { title: t('mcpTools.resourceColumns.server'), key: 'server', dataIndex: 'server', width: '15%' },
  { title: t('mcpTools.resourceColumns.mime'), key: 'mimeType', dataIndex: 'mimeType', width: '15%' },
  { title: t('mcpTools.resourceColumns.action'), key: 'action', width: 90 },
])

const filteredResources = computed(() => {
  if (!resourceSearch.value) return resources.value
  const q = resourceSearch.value.toLowerCase()
  return resources.value.filter(
    (r) =>
      r.uri?.toLowerCase().includes(q) ||
      r.name?.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q),
  )
})

async function loadResources() {
  if (resourcesLoading.value) return
  resourcesLoading.value = true
  try {
    const r = await mcp.listResources()
    if (!r || !Array.isArray(r.servers)) {
      resources.value = []
      return
    }
    const flat = []
    for (const s of r.servers) {
      if (!Array.isArray(s.resources)) continue
      for (const res of s.resources) {
        flat.push({
          key: `${s.name}.${res.uri}`,
          uri: res.uri,
          name: res.name || '',
          description: res.description || '',
          mimeType: res.mimeType || null,
          server: s.name,
        })
      }
    }
    resources.value = flat
    resourcesLoaded.value = true
  } catch (err) {
    console.error('listResources failed:', err)
    resources.value = []
  } finally {
    resourcesLoading.value = false
  }
}

// Read-resource modal state.
const readModalOpen = ref(false)
const selectedResource = ref(null)
const reading = ref(false)
const readContents = ref([])
const readError = ref('')

const readModalTitle = computed(() => {
  if (!selectedResource.value) return t('mcpTools.read.fallbackTitle')
  return t('mcpTools.read.modalTitle', { server: selectedResource.value.server })
})

async function openReadModal(resource) {
  selectedResource.value = resource
  readContents.value = []
  readError.value = ''
  readModalOpen.value = true
  reading.value = true
  try {
    const r = await mcp.readResource(resource.server, resource.uri)
    if (r && Array.isArray(r.contents)) {
      readContents.value = r.contents
    } else {
      readContents.value = r ? [r] : []
    }
  } catch (err) {
    readError.value = err?.message || String(err)
  } finally {
    reading.value = false
  }
}

function closeReadModal() {
  readModalOpen.value = false
}

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
  if (!selectedTool.value) return t('mcpTools.run.fallbackTitle')
  return t('mcpTools.run.modalTitle', { server: selectedTool.value.server, tool: selectedTool.value.name })
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
  const fields = extractFields(tool?.inputSchema || null)
  paramMode.value = fields.length > 0 ? 'form' : 'json'
  formValues.value = defaultValues(fields)
  runModalOpen.value = true
}

function closeRunModal() {
  runModalOpen.value = false
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
        paramsParseError.value = t('mcpTools.run.paramsMustBeObject')
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

async function loadFromTopic() {
  const r = await mcp.listTools()
  if (!r || !Array.isArray(r.servers)) return false
  servers.value = r.servers.map((s) => ({
    key: s.name,
    name: s.name,
    command: '',
    args: [],
    description: s.state ? `state: ${s.state}` : '',
    error: s.error || null,
  }))
  const flat = []
  for (const s of r.servers) {
    if (!Array.isArray(s.tools)) continue
    for (const tool of s.tools) {
      flat.push({
        key: `${s.name}.${tool.name}`,
        name: tool.name,
        description: tool.description || '',
        server: s.name,
        inputSchema: tool.inputSchema || null,
      })
    }
  }
  tools.value = flat
  return true
}

async function load() {
  loading.value = true
  try {
    try {
      const ok = await loadFromTopic()
      if (ok) {
        dataSource.value = 'topic'
        return
      }
    } catch (err) {
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
    if (dataSource.value === 'topic') {
      loadResources()
    } else {
      resources.value = []
      resourcesLoaded.value = false
    }
  }
}

function parseServers(output) {
  const result = []
  const lines = output.split('\n')
  let current = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('MCP')) continue
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
    if (trimmed.match(/^\[/) || trimmed.match(/^Server:/i)) {
      currentServer = trimmed.replace(/[\[\]]/g, '').replace(/^Server:\s*/i, '').trim()
      continue
    }
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
