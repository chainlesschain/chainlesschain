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
          🦙 本地模型（Ollama）
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
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { ReloadOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useProvidersStore } from '../stores/providers.js'

const providersStore = useProvidersStore()

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

onMounted(() => {
  providersStore.loadProviders()
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
</style>
