<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">LLM 配置</h2>
        <p class="page-sub">管理 AI 服务提供商</p>
      </div>
      <a-button type="primary" ghost :loading="providersStore.loading" @click="providersStore.loadProviders()">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <!-- Active Provider Banner -->
    <a-alert
      v-if="providersStore.activeProvider"
      type="success"
      style="margin-bottom: 20px; background: rgba(41,162,112,.08); border-color: rgba(41,162,112,.3);"
      show-icon
    >
      <template #message>
        <span>当前激活：<strong>{{ providersStore.activeProvider }}</strong></span>
      </template>
    </a-alert>

    <!-- Loading -->
    <div v-if="providersStore.loading" style="text-align: center; padding: 60px;">
      <a-spin size="large" />
      <div style="color: var(--text-muted); margin-top: 12px;">加载 LLM 信息中...</div>
    </div>

    <!-- Providers Grid -->
    <div v-else>
      <div class="providers-grid">
        <a-card
          v-for="provider in providersStore.providers"
          :key="provider.name"
          class="provider-card"
          :class="{ active: provider.active }"
          style="background: var(--bg-card);"
          size="small"
        >
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
            <span style="font-size: 24px;">{{ provider.icon }}</span>
            <div style="flex: 1;">
              <div style="color: #e0e0e0; font-weight: 500;">{{ provider.label }}</div>
              <div style="color: var(--text-secondary); font-size: 11px; font-family: monospace;">{{ provider.name }}</div>
            </div>
            <div>
              <a-tag v-if="provider.active" color="green">活跃</a-tag>
              <a-badge v-else-if="provider.status === 'ok'" status="success" text="" />
              <a-badge v-else-if="provider.status === 'error'" status="error" text="" />
            </div>
          </div>

          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <a-button
              size="small"
              style="background: var(--bg-card-hover); border-color: var(--border-color);"
              :loading="providersStore.testing === provider.name"
              @click="test(provider.name)"
            >
              测试
            </a-button>
            <a-button
              v-if="!provider.active"
              size="small"
              type="primary"
              ghost
              @click="switchProvider(provider.name)"
            >
              切换
            </a-button>
            <a-tag v-else color="green" style="margin: 0; line-height: 24px;">当前</a-tag>
          </div>
        </a-card>
      </div>

      <!-- Local Models (Ollama) -->
      <div v-if="providersStore.localModels.length" style="margin-top: 24px;">
        <h3 style="color: #ccc; font-size: 15px; margin-bottom: 12px;">
          本地模型（Ollama）
        </h3>
        <a-list
          :data-source="providersStore.localModels"
          size="small"
          style="background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-color);"
        >
          <template #renderItem="{ item }">
            <a-list-item style="padding: 10px 16px; border-color: #252525;">
              <span style="color: #ccc; font-family: monospace; font-size: 13px;">{{ item.name }}</span>
              <template #actions>
                <a-tag color="cyan" style="font-size: 10px;">{{ item.size || 'local' }}</a-tag>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </div>

      <!-- LLM Parameter Settings -->
      <a-divider style="border-color: var(--border-color); margin: 32px 0 24px;" />

      <a-alert
        v-if="showRestartHint"
        type="warning"
        show-icon
        closable
        style="margin-bottom: 16px;"
        message="配置已保存，但当前聊天会话仍在用旧 key"
        description="桌面端的 LLM 会话只在新建会话时重读配置。请新建一个 Chat，或重启应用，新 key/Provider 才会生效。"
        @close="showRestartHint = false"
      />

      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
        <h3 class="section-title">LLM 参数设置</h3>
        <a-button
          size="small"
          :loading="configLoading"
          @click="loadConfig"
          style="background: var(--bg-card-hover); border-color: var(--border-color);"
        >
          <template #icon><ReloadOutlined /></template>
          加载配置
        </a-button>
      </div>

      <a-card class="config-card" style="background: var(--bg-card); border-color: var(--border-color);">
        <a-form
          :model="configForm"
          layout="vertical"
          class="config-form"
        >
          <div class="config-grid">
            <!-- Provider -->
            <a-form-item label="Provider（提供商）">
              <a-select
                v-model:value="configForm.provider"
                placeholder="选择 LLM 提供商"
                :options="providerOptions"
                style="width: 100%;"
                :disabled="configSaving"
              />
            </a-form-item>

            <!-- Model -->
            <a-form-item label="Model（模型名称）">
              <a-input
                v-model:value="configForm.model"
                placeholder="例如 doubao-seed-1-6-251015"
                allow-clear
                :disabled="configSaving"
              />
            </a-form-item>

            <!-- API Key -->
            <a-form-item label="API Key">
              <a-input-password
                v-model:value="configForm.apiKey"
                placeholder="输入 API Key"
                :disabled="configSaving"
              />
            </a-form-item>

            <!-- Base URL -->
            <a-form-item label="Base URL">
              <a-input
                v-model:value="configForm.baseUrl"
                placeholder="例如 https://ark.cn-beijing.volces.com/api/v3"
                allow-clear
                :disabled="configSaving"
              />
            </a-form-item>

            <!-- Temperature -->
            <a-form-item label="Temperature（温度）">
              <div style="display: flex; align-items: center; gap: 12px;">
                <a-slider
                  v-model:value="configForm.temperature"
                  :min="0"
                  :max="2"
                  :step="0.1"
                  style="flex: 1;"
                  :disabled="configSaving"
                />
                <a-input-number
                  v-model:value="configForm.temperature"
                  :min="0"
                  :max="2"
                  :step="0.1"
                  :precision="1"
                  style="width: 80px;"
                  :disabled="configSaving"
                />
              </div>
            </a-form-item>

            <!-- Max Tokens -->
            <a-form-item label="Max Tokens（最大输出长度）">
              <a-input-number
                v-model:value="configForm.maxTokens"
                :min="256"
                :max="128000"
                :step="256"
                style="width: 100%;"
                placeholder="4096"
                :disabled="configSaving"
              />
            </a-form-item>
          </div>

          <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 16px;">
            <a-button
              @click="resetForm"
              :disabled="configSaving"
              style="background: var(--bg-card-hover); border-color: var(--border-color);"
            >
              重置
            </a-button>
            <a-button
              type="primary"
              :loading="configSaving"
              @click="saveConfig"
            >
              保存配置
            </a-button>
          </div>
        </a-form>
      </a-card>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ReloadOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useProvidersStore } from '../stores/providers.js'
import { useWsStore } from '../stores/ws.js'
import { parseLlmConfigOutput } from '../utils/parsers.js'

const providersStore = useProvidersStore()
const ws = useWsStore()

const configLoading = ref(false)
const configSaving = ref(false)
const showRestartHint = ref(false)

const configForm = reactive({
  provider: undefined,
  model: '',
  apiKey: '',
  baseUrl: '',
  temperature: 0.7,
  maxTokens: 4096,
})

// Snapshot of loaded config to detect changes
let loadedConfig = {}

const knownProviders = [
  'ollama', 'openai', 'anthropic', 'volcengine', 'deepseek',
  'gemini', 'groq', 'mistral', 'custom', 'zhipu',
]

const providerLabels = {
  ollama: 'Ollama（本地）',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  volcengine: '火山引擎（豆包）',
  deepseek: 'DeepSeek',
  gemini: 'Google Gemini',
  groq: 'Groq',
  mistral: 'Mistral',
  custom: 'Custom（自定义）',
  zhipu: '智谱 AI',
}

const providerOptions = knownProviders.map(name => ({
  value: name,
  label: providerLabels[name] || name,
}))

async function switchProvider(name) {
  try {
    await providersStore.switchProvider(name)
    message.success(`已切换到 ${name}`)
  } catch (e) {
    message.error(`切换失败: ${e.message}`)
  }
}

async function test(name) {
  const ok = await providersStore.testProvider(name)
  if (ok) {
    message.success(`${name} 连接正常`)
  } else {
    message.warning(`${name} 连接失败，请检查配置`)
  }
}

async function loadConfig() {
  configLoading.value = true
  try {
    const { output } = await ws.execute('config list', 15000)
    const parsed = parseLlmConfigOutput(output)

    if (parsed.provider) configForm.provider = parsed.provider
    if (parsed.model) configForm.model = parsed.model
    if (parsed.apiKey) configForm.apiKey = parsed.apiKey
    if (parsed.baseUrl) configForm.baseUrl = parsed.baseUrl
    if (parsed.temperature !== undefined) configForm.temperature = parsed.temperature
    if (parsed.maxTokens !== undefined) configForm.maxTokens = parsed.maxTokens

    // Snapshot ONLY backend-parsed values. Do NOT clone configForm — that
    // would capture any user-typed-but-unsaved value (notably apiKey, which
    // the CLI masks as `****` and the parser filters out) as the "loaded"
    // baseline, causing the subsequent saveConfig diff check to see no
    // change and silently skip writing the user's input to disk.
    loadedConfig = {
      provider: parsed.provider ?? '',
      model: parsed.model ?? '',
      apiKey: parsed.apiKey ?? '',
      baseUrl: parsed.baseUrl ?? '',
      temperature: parsed.temperature ?? configForm.temperature,
      maxTokens: parsed.maxTokens ?? configForm.maxTokens,
    }

    message.success('配置已加载')
  } catch (e) {
    message.error(`加载配置失败: ${e.message}`)
  } finally {
    configLoading.value = false
  }
}

async function saveConfig() {
  configSaving.value = true
  const errors = []
  const saved = []

  try {
    // Only send config set for fields that changed from loaded snapshot
    if (configForm.provider && configForm.provider !== loadedConfig.provider) {
      try {
        await ws.execute(`config set llm.provider ${configForm.provider}`, 10000)
        saved.push('provider')
      } catch (e) {
        errors.push(`provider: ${e.message}`)
      }
    }

    if (configForm.model && configForm.model !== loadedConfig.model) {
      try {
        await ws.execute(`config set llm.model ${configForm.model}`, 10000)
        saved.push('model')
      } catch (e) {
        errors.push(`model: ${e.message}`)
      }
    }

    if (configForm.apiKey && configForm.apiKey !== loadedConfig.apiKey) {
      try {
        await ws.execute(`config set llm.apiKey ${configForm.apiKey}`, 10000)
        saved.push('apiKey')
      } catch (e) {
        errors.push(`apiKey: ${e.message}`)
      }
    }

    if (configForm.baseUrl !== undefined && configForm.baseUrl !== loadedConfig.baseUrl) {
      try {
        await ws.execute(`config set llm.baseUrl ${configForm.baseUrl}`, 10000)
        saved.push('baseUrl')
      } catch (e) {
        errors.push(`baseUrl: ${e.message}`)
      }
    }

    if (configForm.temperature !== loadedConfig.temperature) {
      try {
        await ws.execute(`config set llm.temperature ${configForm.temperature}`, 10000)
        saved.push('temperature')
      } catch (e) {
        errors.push(`temperature: ${e.message}`)
      }
    }

    if (configForm.maxTokens !== loadedConfig.maxTokens) {
      try {
        await ws.execute(`config set llm.maxTokens ${configForm.maxTokens}`, 10000)
        saved.push('maxTokens')
      } catch (e) {
        errors.push(`maxTokens: ${e.message}`)
      }
    }

    if (errors.length > 0) {
      message.warning(`部分配置保存失败: ${errors.join('; ')}`)
    } else if (saved.length > 0) {
      message.success(`已保存 ${saved.length} 项配置`)
      // Update snapshot from form — at this point form == on-disk state.
      loadedConfig = { ...configForm }
      // The desktop WS session manager re-reads config.json only when a new
      // Session is created (see ws-cli-loader.js:118-128). Existing chat
      // sessions still hold the old LLM credentials, so the user must start
      // a new chat or restart the app for the change to reach the LLM client.
      // Surface this explicitly when credentials/provider/baseUrl changed.
      const needsRestart =
        saved.includes('apiKey') ||
        saved.includes('provider') ||
        saved.includes('baseUrl') ||
        saved.includes('model')
      if (needsRestart) {
        showRestartHint.value = true
      }
      // Refresh provider list in case provider/model changed
      if (saved.includes('provider')) {
        providersStore.loadProviders()
      }
    } else {
      message.info('没有检测到配置变更')
    }
  } catch (e) {
    message.error(`保存配置失败: ${e.message}`)
  } finally {
    configSaving.value = false
  }
}

function resetForm() {
  configForm.provider = loadedConfig.provider || undefined
  configForm.model = loadedConfig.model || ''
  configForm.apiKey = loadedConfig.apiKey || ''
  configForm.baseUrl = loadedConfig.baseUrl || ''
  configForm.temperature = loadedConfig.temperature ?? 0.7
  configForm.maxTokens = loadedConfig.maxTokens ?? 4096
}

onMounted(() => {
  providersStore.loadProviders()
  loadConfig()
})
</script>

<style scoped>
.providers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.provider-card {
  border: 1px solid var(--border-color) !important;
  transition: border-color 0.2s;
}
.provider-card:hover {
  border-color: var(--text-muted) !important;
}
.provider-card.active {
  border-color: #52c41a !important;
  background: rgba(41,162,112,.08) !important;
}

.section-title {
  color: var(--text-primary, #ccc);
  font-size: 16px;
  font-weight: 500;
  margin: 0;
}

.config-card {
  border-radius: 8px;
}

.config-card :deep(.ant-card-body) {
  padding: 24px;
}

.config-form :deep(.ant-form-item-label > label) {
  color: var(--text-secondary, #aaa);
  font-size: 13px;
}

.config-form :deep(.ant-input),
.config-form :deep(.ant-input-password input),
.config-form :deep(.ant-input-number),
.config-form :deep(.ant-select-selector) {
  background: var(--bg-card-hover, #1a1a1a) !important;
  border-color: var(--border-color, #333) !important;
  color: var(--text-primary, #e0e0e0) !important;
}

.config-form :deep(.ant-input::placeholder),
.config-form :deep(.ant-input-password input::placeholder) {
  color: var(--text-muted, #555) !important;
}

.config-form :deep(.ant-input-number-input) {
  color: var(--text-primary, #e0e0e0) !important;
}

.config-form :deep(.ant-select-selection-item) {
  color: var(--text-primary, #e0e0e0) !important;
}

.config-form :deep(.ant-select-arrow) {
  color: var(--text-muted, #555);
}

.config-form :deep(.ant-slider-rail) {
  background: var(--border-color, #333);
}

.config-form :deep(.ant-slider-track) {
  background: #1890ff;
}

.config-form :deep(.ant-slider-handle) {
  border-color: #1890ff;
}

.config-form :deep(.ant-input-password-icon) {
  color: var(--text-muted, #555);
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 24px;
}

@media (max-width: 640px) {
  .config-grid {
    grid-template-columns: 1fr;
  }
}
</style>
