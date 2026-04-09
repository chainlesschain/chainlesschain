<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">模板中心</h2>
        <p class="page-sub">项目模板 / BI 模板 / Prompt 模板</p>
      </div>
    </div>

    <a-tabs v-model:activeKey="activeTab" type="card">
      <!-- Tab 1: 项目模板 -->
      <a-tab-pane key="project">
        <template #tab>
          <AppstoreOutlined />
          项目模板
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
                  初始化
                </a-button>
              </div>
            </a-card>
          </a-col>
        </a-row>

        <a-alert
          v-if="initResult"
          :message="initResult.success ? '初始化成功' : '初始化失败'"
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

      <!-- Tab 2: BI 模板 -->
      <a-tab-pane key="bi">
        <template #tab>
          <BarChartOutlined />
          BI 模板
        </template>

        <div v-if="biLoading" style="text-align: center; padding: 40px;">
          <a-spin />
          <div style="color: var(--text-muted); margin-top: 8px;">加载 BI 模板...</div>
        </div>

        <a-empty v-else-if="!biTemplates.length" description="暂无 BI 模板" />

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
                    {{ tpl.description || '暂无描述' }}
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
                  创建仪表板
                </a-button>
              </div>
            </a-card>
          </a-col>
        </a-row>

        <a-alert
          v-if="biResult"
          :message="biResult.success ? '仪表板创建成功' : '创建失败'"
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

      <!-- Tab 3: Prompt 模板 -->
      <a-tab-pane key="prompts">
        <template #tab>
          <FileTextOutlined />
          Prompt 模板
        </template>

        <div style="margin-bottom: 16px;">
          <a-button type="primary" @click="showPromptModal = true">
            <template #icon><PlusOutlined /></template>
            新建模板
          </a-button>
        </div>

        <a-empty v-if="!promptTemplates.length" description="暂无 Prompt 模板，点击上方按钮创建" />

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
                  使用
                </a-button>
                <a-button size="small" @click="copyPrompt(pt)">
                  <template #icon><CopyOutlined /></template>
                  复制
                </a-button>
                <a-button size="small" danger @click="deletePrompt(idx)">
                  <template #icon><DeleteOutlined /></template>
                  删除
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
      title="确认初始化"
      @ok="doInit"
      @cancel="showInitConfirm = false"
      ok-text="确认"
      cancel-text="取消"
    >
      <p>确定要使用模板 <strong>{{ pendingTemplate }}</strong> 初始化项目吗？</p>
      <p style="color: var(--text-muted); font-size: 12px;">这将在当前工作目录创建项目结构。</p>
    </a-modal>

    <!-- New Prompt Modal -->
    <a-modal
      v-model:open="showPromptModal"
      title="新建 Prompt 模板"
      @ok="savePrompt"
      @cancel="resetPromptForm"
      ok-text="保存"
      cancel-text="取消"
      :ok-button-props="{ disabled: !newPrompt.name || !newPrompt.content }"
    >
      <a-form layout="vertical">
        <a-form-item label="模板名称" required>
          <a-input v-model:value="newPrompt.name" placeholder="输入模板名称" />
        </a-form-item>
        <a-form-item label="分类">
          <a-select v-model:value="newPrompt.category" style="width: 100%;">
            <a-select-option value="general">general</a-select-option>
            <a-select-option value="code">code</a-select-option>
            <a-select-option value="writing">writing</a-select-option>
            <a-select-option value="analysis">analysis</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="模板内容" required>
          <a-textarea v-model:value="newPrompt.content" :rows="6" placeholder="输入 Prompt 模板内容" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  AppstoreOutlined, BarChartOutlined, FileTextOutlined,
  PlusOutlined, CopyOutlined, DeleteOutlined,
  RocketOutlined, PlayCircleOutlined
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'

const ws = useWsStore()
const router = useRouter()

const activeTab = ref('project')

// --- Project Templates ---
const initLoading = ref('')
const initResult = ref(null)
const showInitConfirm = ref(false)
const pendingTemplate = ref('')

const projectTemplates = [
  { name: 'code-project', description: '代码项目 — 代码审查、重构、单元测试' },
  { name: 'data-science', description: '数据科学 — ML/数据分析、可视化' },
  { name: 'devops', description: 'DevOps — 基础设施、部署、监控' },
  { name: 'medical-triage', description: '医疗分诊 — 症状分析、分诊建议' },
  { name: 'agriculture-expert', description: '农业专家 — 作物管理、病虫害' },
  { name: 'general-assistant', description: '通用助手 — 日常问答、任务管理' },
  { name: 'ai-media-creator', description: 'AI 媒体创作 — 图文生成、视频脚本' },
  { name: 'ai-doc-creator', description: 'AI 文档创作 — 文档生成、格式转换' },
  { name: 'empty', description: '空白模板 — 最小项目结构' },
]

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
    initResult.value = { success: false, output: `初始化失败: ${e.message}` }
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
    biResult.value = { success: false, output: `创建失败: ${e.message}` }
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
  message.success('模板已保存')
}

function resetPromptForm() {
  showPromptModal.value = false
  newPrompt.name = ''
  newPrompt.category = 'general'
  newPrompt.content = ''
}

function deletePrompt(idx) {
  promptTemplates.value.splice(idx, 1)
  persistPrompts()
  message.success('模板已删除')
}

function copyPrompt(pt) {
  navigator.clipboard.writeText(pt.content).then(() => {
    message.success('已复制到剪贴板')
  }).catch(() => {
    message.error('复制失败')
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
