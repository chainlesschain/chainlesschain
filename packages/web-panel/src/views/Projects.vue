<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">项目管理</h2>
        <p class="page-sub">初始化 / 状态 / 诊断</p>
      </div>
      <a-button type="primary" ghost :loading="statusLoading" @click="refreshStatus">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <!-- 项目状态 -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="系统状态"
            :value="statusInfo.running ? '运行中' : '未运行'"
            :value-style="{ color: statusInfo.running ? '#52c41a' : '#888', fontSize: '16px' }"
          >
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
          <div v-if="statusInfo.edition" style="margin-top: 6px; color: var(--text-muted); font-size: 11px;">
            版本: {{ statusInfo.edition }}
          </div>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="LLM 提供商"
            :value="statusInfo.llmProvider || '未配置'"
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
            title="初始化"
            :value="statusInfo.setupDone ? '已完成' : '未完成'"
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
            title="项目配置"
            :value="configLoaded ? '已加载' : '未加载'"
            :value-style="{ color: configLoaded ? '#52c41a' : '#888', fontSize: '16px' }"
          >
            <template #prefix><ProjectOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- 项目配置详情 -->
    <a-card
      v-if="configItems.length"
      title="项目配置"
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

    <!-- 项目初始化 -->
    <a-card
      title="项目初始化"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
    >
      <template #extra>
        <a-tag color="blue">{{ templates.length }} 个模板</a-tag>
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
              <a-tag color="green">已选择</a-tag>
            </div>
          </a-card>
        </a-col>
      </a-row>

      <div style="margin-top: 16px; display: flex; align-items: center; gap: 12px;">
        <a-button
          type="primary"
          :loading="initLoading"
          :disabled="!selectedTemplate"
          @click="initProject"
        >
          <template #icon><RocketOutlined /></template>
          初始化
        </a-button>
        <span v-if="selectedTemplate" style="color: var(--text-secondary); font-size: 12px;">
          模板: {{ selectedTemplate }}
        </span>
      </div>

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
    </a-card>

    <!-- 环境诊断 -->
    <a-card
      title="环境诊断"
      style="background: var(--bg-card); border-color: var(--border-color);"
    >
      <template #extra>
        <a-button
          :loading="doctorLoading"
          @click="runDoctor"
          style="background: var(--bg-card-hover); border-color: var(--border-color);"
        >
          <template #icon><MedicineBoxOutlined /></template>
          运行诊断
        </a-button>
      </template>

      <div v-if="doctorLoading" style="text-align: center; padding: 30px;">
        <a-spin />
        <div style="color: var(--text-muted); margin-top: 8px;">正在诊断环境...</div>
      </div>

      <div v-else-if="doctorOutput">
        <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; max-height: 400px; overflow-y: auto; white-space: pre-wrap;">{{ doctorOutput }}</pre>
      </div>

      <a-empty v-else description="点击「运行诊断」检查环境状态" />
    </a-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import {
  ProjectOutlined, RocketOutlined, MedicineBoxOutlined,
  ReloadOutlined, CheckCircleOutlined
} from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'

const ws = useWsStore()

const statusLoading = ref(false)
const initLoading = ref(false)
const doctorLoading = ref(false)
const selectedTemplate = ref('')
const doctorOutput = ref('')
const initResult = ref(null)
const configLoaded = ref(false)
const configItems = ref([])

const statusInfo = reactive({
  running: false,
  edition: '',
  llmProvider: '',
  llmModel: '',
  setupDone: false,
  setupDate: '',
})

const templates = [
  { name: 'code-project', description: '代码项目模板 — 代码审查、重构、单元测试生成', icon: ProjectOutlined },
  { name: 'medical-triage', description: '医疗分诊模板 — 症状分析、分诊建议、病历管理', icon: MedicineBoxOutlined },
  { name: 'agriculture-expert', description: '农业专家模板 — 作物管理、病虫害识别、农事建议', icon: RocketOutlined },
  { name: 'general-assistant', description: '通用助手模板 — 日常问答、文档处理、任务管理', icon: CheckCircleOutlined },
  { name: 'ai-media-creator', description: 'AI 媒体创作模板 — 图文生成、视频脚本、内容编辑', icon: RocketOutlined },
  { name: 'ai-doc-creator', description: 'AI 文档创作模板 — 文档生成、格式转换、文档编辑', icon: ProjectOutlined },
]

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
  initLoading.value = true
  initResult.value = null
  try {
    const cmd = `init --template ${selectedTemplate.value} --yes`
    const { output, exitCode } = await ws.execute(cmd, 30000)
    initResult.value = { success: exitCode === 0, output }
    if (exitCode === 0) {
      await refreshStatus()
    }
  } catch (e) {
    initResult.value = { success: false, output: `初始化失败: ${e.message}` }
  } finally {
    initLoading.value = false
  }
}

async function runDoctor() {
  doctorLoading.value = true
  doctorOutput.value = ''
  try {
    const { output } = await ws.execute('doctor', 30000)
    doctorOutput.value = output
  } catch (e) {
    doctorOutput.value = `诊断失败: ${e.message}`
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
