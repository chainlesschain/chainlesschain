<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">项目存储配置</h2>
        <p class="page-sub">根目录 / 配额 / 自动同步</p>
      </div>
      <a-button :loading="loading" @click="loadConfig">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <a-alert
      message="仅 Web 模式"
      description="目录选择器（原生文件对话框）仅在桌面端可用，本页面需手动输入路径。修改根目录后需重启桌面应用生效；web 端只影响后端配置文件。"
      type="info"
      show-icon
      closable
      style="margin-bottom: 16px;"
    />

    <a-card style="background: var(--bg-card); border-color: var(--border-color);">
      <template #title>
        <span style="color: var(--text-primary);">
          <FolderOutlined style="margin-right: 8px;" />项目存储
        </span>
      </template>

      <a-spin :spinning="loading">
        <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="max-width: 720px;">
          <a-form-item label="项目根目录">
            <a-input
              v-model:value="form.rootPath"
              placeholder="项目文件存储的根目录绝对路径"
              :disabled="saving"
            />
            <template #extra>
              <span style="color: var(--text-muted); font-size: 11px;">
                需绝对路径；修改后重启桌面应用生效
              </span>
            </template>
          </a-form-item>

          <a-form-item label="最大项目大小">
            <a-input-number
              v-model:value="form.maxSizeMB"
              :min="100"
              :max="10000"
              :step="100"
              addon-after="MB"
              style="width: 220px;"
              :disabled="saving"
            />
          </a-form-item>

          <a-form-item label="自动同步">
            <a-switch v-model:checked="form.autoSync" :disabled="saving" />
            <span style="margin-left: 12px; color: var(--text-secondary); font-size: 12px;">
              自动同步项目到后端服务器
            </span>
          </a-form-item>

          <a-form-item v-if="form.autoSync" label="同步间隔">
            <a-input-number
              v-model:value="form.syncIntervalSeconds"
              :min="60"
              :max="3600"
              :step="60"
              addon-after="秒"
              style="width: 220px;"
              :disabled="saving"
            />
          </a-form-item>

          <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
            <a-space>
              <a-button @click="resetForm" :disabled="saving || loading">
                重置
              </a-button>
              <a-button type="primary" :loading="saving" :disabled="!isDirty" @click="saveConfig">
                保存配置
              </a-button>
              <span v-if="isDirty" style="color: #faad14; font-size: 12px; margin-left: 8px;">
                有未保存的修改
              </span>
            </a-space>
          </a-form-item>
        </a-form>
      </a-spin>
    </a-card>
  </div>
</template>

<script setup>
import { reactive, ref, computed, onMounted } from 'vue'
import { ReloadOutlined, FolderOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parseProjectConfig,
  diffProjectConfig,
  PROJECT_DEFAULTS,
} from '../utils/project-settings-parser.js'

const ws = useWsStore()

const loading = ref(false)
const saving = ref(false)
const form = reactive({ ...PROJECT_DEFAULTS })
const baseline = ref({ ...PROJECT_DEFAULTS })

const isDirty = computed(() => {
  return Object.keys(diffProjectConfig(baseline.value, form)).length > 0
})

async function loadConfig() {
  loading.value = true
  try {
    const { output } = await ws.execute('config get project', 10000)
    const parsed = parseProjectConfig(output)
    Object.assign(form, parsed)
    baseline.value = { ...parsed }
  } catch (e) {
    if (/key not found/i.test(e.message)) {
      Object.assign(form, PROJECT_DEFAULTS)
      baseline.value = { ...PROJECT_DEFAULTS }
    } else {
      message.error('加载配置失败: ' + e.message)
    }
  } finally {
    loading.value = false
  }
}

function resetForm() {
  Object.assign(form, baseline.value)
}

async function saveConfig() {
  const changes = diffProjectConfig(baseline.value, form)
  const keys = Object.keys(changes)
  if (keys.length === 0) {
    message.info('没有需要保存的修改')
    return
  }

  saving.value = true
  let okCount = 0
  let failCount = 0
  for (const key of keys) {
    const value = changes[key]
    const escaped = String(value).replace(/"/g, '\\"')
    const cmd = `config set project.${key} "${escaped}"`
    try {
      const { output, exitCode } = await ws.execute(cmd, 10000)
      if (exitCode !== 0 || /error|failed|失败/i.test(output)) {
        failCount++
        message.error(`保存 ${key} 失败: ${output.slice(0, 80)}`)
      } else {
        okCount++
      }
    } catch (e) {
      failCount++
      message.error(`保存 ${key} 失败: ${e.message}`)
    }
  }

  saving.value = false

  if (failCount === 0) {
    message.success(`保存成功（${okCount} 项）`)
    baseline.value = { ...form }
  } else if (okCount > 0) {
    message.warning(`部分保存成功：${okCount} 成功 / ${failCount} 失败`)
    await loadConfig()
  }
}

onMounted(() => {
  loadConfig()
})
</script>

<style scoped>
:deep(.ant-card-head) { border-color: var(--border-color) !important; color: var(--text-primary) !important; }
</style>
