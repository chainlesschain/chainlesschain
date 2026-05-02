<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('projects.title') }}</h2>
        <p class="page-sub">{{ t('projects.subtitle') }}</p>
      </div>
      <a-button type="primary" ghost :loading="statusLoading" @click="refreshStatus">
        <template #icon><ReloadOutlined /></template>
        {{ t('projects.refresh') }}
      </a-button>
    </div>

    <!-- Status -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('projects.stats.system')"
            :value="statusInfo.running ? t('projects.stats.running') : t('projects.stats.notRunning')"
            :value-style="{ color: statusInfo.running ? '#52c41a' : '#888', fontSize: '16px' }"
          >
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
          <div v-if="statusInfo.edition" style="margin-top: 6px; color: var(--text-muted); font-size: 11px;">
            {{ t('projects.stats.editionPrefix', { edition: statusInfo.edition }) }}
          </div>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('projects.stats.llmProvider')"
            :value="statusInfo.llmProvider || t('projects.stats.notConfigured')"
            :value-style="{ color: statusInfo.llmProvider ? '#1677ff' : '#888', fontSize: '16px' }"
          >
            <template #prefix><RocketOutlined /></template>
          </a-statistic>
          <div v-if="statusInfo.llmModel" style="margin-top: 6px; color: var(--text-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            {{ statusInfo.llmModel }}
          </div>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('projects.stats.init')"
            :value="statusInfo.setupDone ? t('projects.stats.done') : t('projects.stats.notDone')"
            :value-style="{ color: statusInfo.setupDone ? '#52c41a' : '#faad14', fontSize: '16px' }"
          >
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
          <div v-if="statusInfo.setupDate" style="margin-top: 6px; color: var(--text-muted); font-size: 11px;">
            {{ statusInfo.setupDate }}
          </div>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('projects.stats.config')"
            :value="configLoaded ? t('projects.stats.loaded') : t('projects.stats.notLoaded')"
            :value-style="{ color: configLoaded ? '#52c41a' : '#888', fontSize: '16px' }"
          >
            <template #prefix><ProjectOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Project Config Detail -->
    <a-card
      v-if="configItems.length"
      :title="t('projects.configCardTitle')"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
    >
      <a-descriptions :column="{ xs: 1, sm: 2, lg: 3 }" bordered size="small">
        <a-descriptions-item
          v-for="item in configItems"
          :key="item.key"
          :label="item.key"
        >
          <span style="font-family: monospace; color: #ccc;">{{ item.value }}</span>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <!-- Project Initialization -->
    <a-card
      :title="t('projects.initCardTitle')"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
    >
      <template #extra>
        <a-tag color="blue">{{ t('projects.templateCount', { count: templates.length }) }}</a-tag>
      </template>

      <a-row :gutter="[16, 16]">
        <a-col v-for="tpl in templates" :key="tpl.name" :xs="24" :sm="12" :lg="8">
          <a-card
            size="small"
            hoverable
            :class="['template-card', { 'template-selected': selectedTemplate === tpl.name }]"
            style="background: var(--bg-card); border-color: var(--border-color); cursor: pointer;"
            @click="selectedTemplate = tpl.name"
          >
            <div style="display: flex; align-items: flex-start; gap: 10px;">
              <component :is="tpl.icon" style="font-size: 24px; color: #1677ff; flex-shrink: 0; margin-top: 2px;" />
              <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 500; color: #e0e0e0; font-size: 14px; font-family: monospace; margin-bottom: 4px;">
                  {{ tpl.name }}
                </div>
                <div style="color: var(--text-secondary); font-size: 12px; line-height: 1.5;">
                  {{ tpl.description }}
                </div>
              </div>
            </div>
            <div v-if="selectedTemplate === tpl.name" style="margin-top: 8px; text-align: right;">
              <a-tag color="green">{{ t('projects.selected') }}</a-tag>
            </div>
          </a-card>
        </a-col>
      </a-row>

      <div style="margin-top: 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
        <a-button
          type="primary"
          :loading="initLoading"
          :disabled="!selectedTemplate || (selectedFolder && selectedFolderInitialized)"
          @click="initProject"
        >
          <template #icon><RocketOutlined /></template>
          {{ selectedFolder ? t('projects.actions.initInFolder') : t('projects.actions.initCwd') }}
        </a-button>
        <a-button
          :loading="folderPickerLoading"
          @click="pickProjectFolder"
        >
          <template #icon><FolderOpenOutlined /></template>
          {{ t('projects.actions.pickFolder') }}
        </a-button>
        <a-button
          v-if="selectedFolder"
          size="small"
          type="text"
          @click="clearSelectedFolder"
        >
          {{ t('projects.actions.clear') }}
        </a-button>
        <span v-if="selectedTemplate" style="color: var(--text-secondary); font-size: 12px;">
          {{ t('projects.actions.templatePrefix', { name: selectedTemplate }) }}
        </span>
      </div>
      <div
        v-if="selectedFolder"
        style="margin-top: 12px; padding: 10px 12px; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; font-size: 12px; display: flex; align-items: center; gap: 10px;"
      >
        <FolderOpenOutlined :style="{ color: selectedFolderInitialized ? '#52c41a' : '#1677ff' }" />
        <span style="font-family: monospace; color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          {{ selectedFolder }}
        </span>
        <a-tag v-if="selectedFolderInitialized" color="green">{{ t('projects.folder.alreadyProject') }}</a-tag>
        <a-tag v-else color="blue">{{ t('projects.folder.pendingInit') }}</a-tag>
      </div>
      <a-alert
        v-if="selectedFolder && selectedFolderInitialized"
        type="info"
        show-icon
        style="margin-top: 12px;"
        :message="t('projects.folder.alreadyMessage')"
        :description="t('projects.folder.alreadyDescription')"
      />

      <a-alert
        v-if="initResult"
        :message="initResult.success ? t('projects.initResult.success') : t('projects.initResult.failure')"
        :type="initResult.success ? 'success' : 'error'"
        show-icon
        closable
        style="margin-top: 16px;"
        @close="initResult = null"
      >
        <template #description>
          <pre style="margin: 0; font-size: 12px; white-space: pre-wrap; max-height: 200px; overflow-y: auto;">{{ initResult.output }}</pre>
        </template>
      </a-alert>
    </a-card>

    <!-- Doctor -->
    <a-card
      :title="t('projects.doctor.cardTitle')"
      style="background: var(--bg-card); border-color: var(--border-color);"
    >
      <template #extra>
        <a-button
          :loading="doctorLoading"
          @click="runDoctor"
          style="background: var(--bg-card-hover); border-color: var(--border-color);"
        >
          <template #icon><MedicineBoxOutlined /></template>
          {{ t('projects.doctor.runButton') }}
        </a-button>
      </template>

      <div v-if="doctorLoading" style="text-align: center; padding: 30px;">
        <a-spin />
        <div style="color: var(--text-muted); margin-top: 8px;">{{ t('projects.doctor.runningHint') }}</div>
      </div>

      <div v-else-if="doctorOutput">
        <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; max-height: 400px; overflow-y: auto; white-space: pre-wrap;">{{ doctorOutput }}</pre>
      </div>

      <a-empty v-else :description="t('projects.doctor.emptyHint')" />
    </a-card>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ProjectOutlined, RocketOutlined, MedicineBoxOutlined,
  ReloadOutlined, CheckCircleOutlined, FolderOpenOutlined
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import { useFs } from '../composables/useFs.js'

const { t } = useI18n()
const ws = useWsStore()
const fs = useFs()

const statusLoading = ref(false)
const initLoading = ref(false)
const doctorLoading = ref(false)
const folderPickerLoading = ref(false)
const selectedTemplate = ref('')
const doctorOutput = ref('')
const initResult = ref(null)
const configLoaded = ref(false)
const configItems = ref([])
const selectedFolder = ref(null)
const selectedFolderInitialized = ref(false)

const statusInfo = reactive({
  running: false,
  edition: '',
  llmProvider: '',
  llmModel: '',
  setupDone: false,
  setupDate: '',
})

const TEMPLATE_DEFS = [
  { name: 'code-project', icon: ProjectOutlined },
  { name: 'medical-triage', icon: MedicineBoxOutlined },
  { name: 'agriculture-expert', icon: RocketOutlined },
  { name: 'general-assistant', icon: CheckCircleOutlined },
  { name: 'ai-media-creator', icon: RocketOutlined },
  { name: 'ai-doc-creator', icon: ProjectOutlined },
]

const templates = computed(() =>
  TEMPLATE_DEFS.map(tpl => ({
    ...tpl,
    description: t(`projects.templates.${tpl.name}`),
  })),
)

function parseStatus(output) {
  statusInfo.running = output.includes('Desktop app running') || output.includes('Running')

  const edMatch = output.match(/Edition:\s+(\S+)/i)
  if (edMatch) statusInfo.edition = edMatch[1]

  const llmMatch = output.match(/LLM:\s+(\S+)\s+\(([^)]+)\)/i)
  if (llmMatch) {
    statusInfo.llmProvider = llmMatch[1]
    statusInfo.llmModel = llmMatch[2]
  } else {
    const llm2 = output.match(/LLM:\s+(\S+)/i)
    if (llm2) statusInfo.llmProvider = llm2[1]
  }

  statusInfo.setupDone = output.includes('Setup completed')
  const dateMatch = output.match(/Setup completed \(([^)]+)\)/i)
  if (dateMatch) {
    try { statusInfo.setupDate = new Date(dateMatch[1]).toLocaleDateString('zh-CN') } catch { statusInfo.setupDate = '' }
  }
}

function parseConfig(output) {
  const items = []
  const lines = output.split('\n')
  for (const line of lines) {
    const m = line.match(/^\s*(\S+)\s*[=:]\s*(.+)$/)
    if (m) {
      items.push({ key: m[1].trim(), value: m[2].trim() })
    }
  }
  configItems.value = items
  configLoaded.value = items.length > 0
}

async function refreshStatus() {
  statusLoading.value = true
  try {
    const [statusRes, configRes] = await Promise.all([
      ws.execute('status', 15000),
      ws.execute('config list', 15000),
    ])
    parseStatus(statusRes.output)
    parseConfig(configRes.output)
  } catch (e) {
    console.error('refresh failed:', e)
  } finally {
    statusLoading.value = false
  }
}

async function initProject() {
  if (!selectedTemplate.value) return
  if (selectedFolder.value && selectedFolderInitialized.value) {
    message.info(t('projects.messages.alreadyProjectInfo'))
    return
  }
  initLoading.value = true
  initResult.value = null
  try {
    let cmd = `init --template ${selectedTemplate.value} --yes`
    if (selectedFolder.value) {
      cmd += ` --cwd "${selectedFolder.value}"`
    }
    const { output, exitCode } = await ws.execute(cmd, 30000)
    initResult.value = { success: exitCode === 0, output }
    if (exitCode === 0) {
      if (selectedFolder.value) {
        selectedFolderInitialized.value = true
      }
      await refreshStatus()
    }
  } catch (e) {
    initResult.value = { success: false, output: t('projects.messages.initFailed', { err: e.message }) }
  } finally {
    initLoading.value = false
  }
}

async function pickProjectFolder() {
  folderPickerLoading.value = true
  try {
    const r = await fs.pickDirectory({ title: t('projects.folder.pickerTitle') })
    if (r.unsupported) {
      message.warning(t('projects.messages.browserUnsupported'))
      return
    }
    if (r.canceled) return
    selectedFolder.value = r.path
    selectedFolderInitialized.value = r.initialized
  } catch (e) {
    message.error(t('projects.messages.pickFolderFailed', { err: e.message }))
  } finally {
    folderPickerLoading.value = false
  }
}

function clearSelectedFolder() {
  selectedFolder.value = null
  selectedFolderInitialized.value = false
}

async function runDoctor() {
  doctorLoading.value = true
  doctorOutput.value = ''
  try {
    const { output } = await ws.execute('doctor', 30000)
    doctorOutput.value = output
  } catch (e) {
    doctorOutput.value = t('projects.messages.doctorFailed', { err: e.message })
  } finally {
    doctorLoading.value = false
  }
}

onMounted(refreshStatus)
</script>

<style scoped>
.template-card {
  transition: border-color 0.2s, box-shadow 0.2s;
}
.template-card:hover {
  border-color: #1677ff !important;
}
.template-selected {
  border-color: #1677ff !important;
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.15);
}
</style>
