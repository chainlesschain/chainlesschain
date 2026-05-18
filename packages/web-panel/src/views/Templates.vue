<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('templates.title') }}</h2>
        <p class="page-sub">{{ t('templates.subtitle') }}</p>
      </div>
    </div>

    <a-tabs v-model:activeKey="activeTab" type="card">
      <!-- Tab 1: Project templates -->
      <a-tab-pane key="project">
        <template #tab>
          <AppstoreOutlined />
          {{ t('templates.tabs.project') }}
        </template>

        <a-row :gutter="[16, 16]">
          <a-col v-for="tpl in projectTemplates" :key="tpl.name" :xs="24" :sm="12" :lg="8">
            <a-card
              size="small"
              hoverable
              class="template-card"
              style="background: var(--bg-card); border-color: var(--border-color);"
            >
              <div style="display: flex; align-items: flex-start; gap: 10px;">
                <RocketOutlined style="font-size: 24px; color: #1677ff; flex-shrink: 0; margin-top: 2px;" />
                <div style="flex: 1; min-width: 0;">
                  <div style="font-weight: 500; color: #e0e0e0; font-size: 14px; font-family: monospace; margin-bottom: 4px;">
                    {{ tpl.name }}
                  </div>
                  <div style="color: var(--text-secondary); font-size: 12px; line-height: 1.5;">
                    {{ tpl.description }}
                  </div>
                </div>
              </div>
              <div style="margin-top: 12px; text-align: right;">
                <a-button
                  type="primary"
                  size="small"
                  :loading="initLoading === tpl.name"
                  @click="confirmInit(tpl.name)"
                >
                  <template #icon><PlayCircleOutlined /></template>
                  {{ t('templates.project.initButton') }}
                </a-button>
              </div>
            </a-card>
          </a-col>
        </a-row>

        <a-alert
          v-if="initResult"
          :message="initResult.success ? t('templates.project.initSuccessAlert') : t('templates.project.initFailureAlert')"
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
      </a-tab-pane>

      <!-- Tab 2: BI templates -->
      <a-tab-pane key="bi">
        <template #tab>
          <BarChartOutlined />
          {{ t('templates.tabs.bi') }}
        </template>

        <div v-if="biLoading" style="text-align: center; padding: 40px;">
          <a-spin />
          <div style="color: var(--text-muted); margin-top: 8px;">{{ t('templates.bi.loadingHint') }}</div>
        </div>

        <a-empty v-else-if="!biTemplates.length" :description="t('templates.bi.emptyText')" />

        <a-row v-else :gutter="[16, 16]">
          <a-col v-for="tpl in biTemplates" :key="tpl.id" :xs="24" :sm="12" :lg="8">
            <a-card
              size="small"
              hoverable
              class="template-card"
              style="background: var(--bg-card); border-color: var(--border-color);"
            >
              <div style="display: flex; align-items: flex-start; gap: 10px;">
                <BarChartOutlined style="font-size: 24px; color: #722ed1; flex-shrink: 0; margin-top: 2px;" />
                <div style="flex: 1; min-width: 0;">
                  <div style="font-weight: 500; color: #e0e0e0; font-size: 14px; margin-bottom: 4px;">
                    {{ tpl.name }}
                  </div>
                  <div style="color: var(--text-secondary); font-size: 12px; line-height: 1.5;">
                    {{ tpl.description || t('templates.bi.noDescription') }}
                  </div>
                  <div v-if="tpl.id" style="margin-top: 4px;">
                    <a-tag size="small" color="purple">{{ tpl.id }}</a-tag>
                  </div>
                </div>
              </div>
              <div style="margin-top: 12px; text-align: right;">
                <a-button
                  type="primary"
                  size="small"
                  :loading="biCreating === tpl.id"
                  @click="createBiDashboard(tpl.id)"
                >
                  <template #icon><PlayCircleOutlined /></template>
                  {{ t('templates.bi.createButton') }}
                </a-button>
              </div>
            </a-card>
          </a-col>
        </a-row>

        <a-alert
          v-if="biResult"
          :message="biResult.success ? t('templates.bi.createSuccessAlert') : t('templates.bi.createFailureAlert')"
          :type="biResult.success ? 'success' : 'error'"
          show-icon
          closable
          style="margin-top: 16px;"
          @close="biResult = null"
        >
          <template #description>
            <pre style="margin: 0; font-size: 12px; white-space: pre-wrap; max-height: 200px; overflow-y: auto;">{{ biResult.output }}</pre>
          </template>
        </a-alert>
      </a-tab-pane>

      <!-- Tab 3: Prompt templates -->
      <a-tab-pane key="prompts">
        <template #tab>
          <FileTextOutlined />
          {{ t('templates.tabs.prompts') }}
        </template>

        <div style="margin-bottom: 16px; display: flex; gap: 8px;">
          <a-button type="primary" @click="showPromptModal = true">
            <template #icon><PlusOutlined /></template>
            {{ t('templates.prompts.newButton') }}
          </a-button>
          <a-button :disabled="!promptTemplates.length" :loading="exportingPrompts" @click="exportPrompts">
            <template #icon><ExportOutlined /></template>
            {{ t('templates.prompts.exportAll') }}
          </a-button>
          <a-button :loading="importingPrompts" @click="importPrompts">
            <template #icon><ImportOutlined /></template>
            {{ t('templates.prompts.import') }}
          </a-button>
        </div>

        <a-empty v-if="!promptTemplates.length" :description="t('templates.prompts.emptyText')" />

        <a-row v-else :gutter="[16, 16]">
          <a-col v-for="(pt, idx) in promptTemplates" :key="idx" :xs="24" :sm="12" :lg="8">
            <a-card
              size="small"
              class="template-card"
              style="background: var(--bg-card); border-color: var(--border-color);"
            >
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <FileTextOutlined style="font-size: 18px; color: #52c41a;" />
                <span style="font-weight: 500; color: #e0e0e0; font-size: 14px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  {{ pt.name }}
                </span>
                <a-tag :color="categoryColor(pt.category)" size="small">{{ pt.category }}</a-tag>
              </div>
              <div style="color: var(--text-secondary); font-size: 12px; line-height: 1.5; max-height: 60px; overflow: hidden; text-overflow: ellipsis; white-space: pre-wrap;">
                {{ pt.content.length > 120 ? pt.content.slice(0, 120) + '...' : pt.content }}
              </div>
              <div style="margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end;">
                <a-button size="small" @click="usePrompt(pt)">
                  <template #icon><RocketOutlined /></template>
                  {{ t('templates.prompts.useButton') }}
                </a-button>
                <a-button size="small" @click="copyPrompt(pt)">
                  <template #icon><CopyOutlined /></template>
                  {{ t('templates.prompts.copyButton') }}
                </a-button>
                <a-button size="small" danger @click="deletePrompt(idx)">
                  <template #icon><DeleteOutlined /></template>
                  {{ t('templates.prompts.deleteButton') }}
                </a-button>
              </div>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>
    </a-tabs>

    <!-- Init Confirmation Modal -->
    <a-modal
      v-model:open="showInitConfirm"
      :title="t('templates.project.confirmTitle')"
      @ok="doInit"
      @cancel="showInitConfirm = false"
      :ok-text="t('templates.project.confirmOk')"
      :cancel-text="t('common.cancel')"
    >
      <p>{{ t('templates.project.confirmIntro') }} <strong>{{ pendingTemplate }}</strong> {{ t('templates.project.confirmIntroSuffix') }}</p>
      <p style="color: var(--text-muted); font-size: 12px;">{{ t('templates.project.confirmHint') }}</p>
    </a-modal>

    <!-- New Prompt Modal -->
    <a-modal
      v-model:open="showPromptModal"
      :title="t('templates.prompts.modalTitle')"
      @ok="savePrompt"
      @cancel="resetPromptForm"
      :ok-text="t('templates.prompts.modalOk')"
      :cancel-text="t('common.cancel')"
      :ok-button-props="{ disabled: !newPrompt.name || !newPrompt.content }"
    >
      <a-form layout="vertical">
        <a-form-item :label="t('templates.prompts.nameLabel')" required>
          <a-input v-model:value="newPrompt.name" :placeholder="t('templates.prompts.namePlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('templates.prompts.categoryLabel')">
          <a-select v-model:value="newPrompt.category" style="width: 100%;">
            <a-select-option value="general">general</a-select-option>
            <a-select-option value="code">code</a-select-option>
            <a-select-option value="writing">writing</a-select-option>
            <a-select-option value="analysis">analysis</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="t('templates.prompts.contentLabel')" required>
          <a-textarea v-model:value="newPrompt.content" :rows="6" :placeholder="t('templates.prompts.contentPlaceholder')" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  AppstoreOutlined, BarChartOutlined, FileTextOutlined,
  PlusOutlined, CopyOutlined, DeleteOutlined,
  RocketOutlined, PlayCircleOutlined,
  ExportOutlined, ImportOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import { useFs } from '../composables/useFs.js'

const { t } = useI18n()
const ws = useWsStore()
const router = useRouter()
const fs = useFs()
const exportingPrompts = ref(false)
const importingPrompts = ref(false)

const activeTab = ref('project')

// --- Project Templates ---
const initLoading = ref('')
const initResult = ref(null)
const showInitConfirm = ref(false)
const pendingTemplate = ref('')

const PROJECT_TEMPLATE_NAMES = [
  'code-project', 'data-science', 'devops', 'medical-triage',
  'agriculture-expert', 'general-assistant', 'ai-media-creator',
  'ai-doc-creator', 'empty',
]

const projectTemplates = computed(() =>
  PROJECT_TEMPLATE_NAMES.map(name => ({
    name,
    description: t(`templates.project.items.${name}`),
  })),
)

function confirmInit(name) {
  pendingTemplate.value = name
  showInitConfirm.value = true
}

async function doInit() {
  showInitConfirm.value = false
  const name = pendingTemplate.value
  if (!name) return
  initLoading.value = name
  initResult.value = null
  try {
    const cmd = `init --template ${name} --yes`
    const { output, exitCode } = await ws.execute(cmd, 30000)
    initResult.value = { success: exitCode === 0, output }
  } catch (e) {
    initResult.value = { success: false, output: t('templates.messages.initFailed', { err: e.message }) }
  } finally {
    initLoading.value = ''
  }
}

// --- BI Templates ---
const biLoading = ref(false)
const biTemplates = ref([])
const biCreating = ref('')
const biResult = ref(null)

async function loadBiTemplates() {
  biLoading.value = true
  try {
    const { output } = await ws.execute('bi templates --json', 15000)
    const parsed = JSON.parse(output)
    biTemplates.value = Array.isArray(parsed) ? parsed : (parsed.templates || [])
  } catch (_e) {
    biTemplates.value = []
  } finally {
    biLoading.value = false
  }
}

async function createBiDashboard(id) {
  biCreating.value = id
  biResult.value = null
  try {
    const cmd = `bi dashboard create --template ${id} --json`
    const { output, exitCode } = await ws.execute(cmd, 30000)
    biResult.value = { success: exitCode === 0, output }
  } catch (e) {
    biResult.value = { success: false, output: t('templates.messages.createFailed', { err: e.message }) }
  } finally {
    biCreating.value = ''
  }
}

// --- Prompt Templates ---
const STORAGE_KEY = 'cc_prompt_templates'
const promptTemplates = ref([])
const showPromptModal = ref(false)
const newPrompt = reactive({
  name: '',
  category: 'general',
  content: '',
})

function loadPromptTemplates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    promptTemplates.value = raw ? JSON.parse(raw) : []
  } catch (_e) {
    promptTemplates.value = []
  }
}

function persistPrompts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(promptTemplates.value))
}

function savePrompt() {
  if (!newPrompt.name || !newPrompt.content) return
  promptTemplates.value.push({
    name: newPrompt.name,
    category: newPrompt.category,
    content: newPrompt.content,
  })
  persistPrompts()
  resetPromptForm()
  message.success(t('templates.messages.promptSaved'))
}

function resetPromptForm() {
  showPromptModal.value = false
  newPrompt.name = ''
  newPrompt.category = 'general'
  newPrompt.content = ''
}

async function exportPrompts() {
  if (!promptTemplates.value.length) return
  exportingPrompts.value = true
  try {
    const r = await fs.saveJson(
      { schema: 1, prompts: promptTemplates.value },
      { defaultPath: `prompt-templates-${new Date().toISOString().slice(0, 10)}.json` },
    )
    if (r.canceled) return
    message.success(r.path
      ? t('templates.messages.exportOk', { count: promptTemplates.value.length, path: r.path })
      : t('templates.messages.exportOkDefault'))
  } catch (e) {
    message.error(t('templates.messages.exportFailed', { err: e.message || e }))
  } finally {
    exportingPrompts.value = false
  }
}

async function importPrompts() {
  importingPrompts.value = true
  try {
    const r = await fs.pickFileText({
      title: t('templates.prompts.filePickerTitle'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!r || r.canceled) return
    if (r.reason === 'too_large') {
      message.error(t('templates.messages.fileTooLarge'))
      return
    }
    let parsed
    try {
      parsed = JSON.parse(r.content || '')
    } catch (e) {
      message.error(t('templates.messages.jsonParseFailed', { err: e.message }))
      return
    }
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.prompts) ? parsed.prompts : null
    if (!list) {
      message.error(t('templates.messages.fileShapeUnknown', { expected: 'prompts: [...]' }))
      return
    }
    let added = 0
    for (const p of list) {
      if (!p || typeof p !== 'object') continue
      if (typeof p.name !== 'string' || typeof p.content !== 'string') continue
      promptTemplates.value.push({
        name: p.name,
        category: typeof p.category === 'string' ? p.category : 'general',
        content: p.content,
      })
      added++
    }
    if (added) {
      persistPrompts()
      message.success(t('templates.messages.importedCount', { count: added }))
    } else {
      message.warning(t('templates.messages.importEmpty'))
    }
  } catch (e) {
    message.error(t('templates.messages.importFailed', { err: e.message || e }))
  } finally {
    importingPrompts.value = false
  }
}

function deletePrompt(idx) {
  promptTemplates.value.splice(idx, 1)
  persistPrompts()
  message.success(t('templates.messages.promptDeleted'))
}

function copyPrompt(pt) {
  navigator.clipboard.writeText(pt.content).then(() => {
    message.success(t('templates.messages.copiedClipboard'))
  }).catch(() => {
    message.error(t('templates.messages.copyFailed'))
  })
}

function usePrompt(pt) {
  router.push({ path: '/chat', query: { prompt: pt.content } })
}

function categoryColor(cat) {
  const colors = { general: 'blue', code: 'green', writing: 'orange', analysis: 'purple' }
  return colors[cat] || 'default'
}

onMounted(() => {
  loadPromptTemplates()
  loadBiTemplates()
})
</script>

<style scoped>
.template-card {
  transition: border-color 0.2s, box-shadow 0.2s;
}
.template-card:hover {
  border-color: #1677ff !important;
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.15);
}
</style>
