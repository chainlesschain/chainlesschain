<template>
  <div class="sso-login-container">
    <a-card class="sso-login-card">
      <a-space direction="vertical" :size="24" style="width: 100%">
        <!-- Header -->
        <div class="sso-login-header">
          <SafetyCertificateOutlined :style="{ fontSize: '48px', color: '#1890ff' }" />
          <h2 class="sso-login-title">企业单点登录</h2>
          <p class="sso-login-subtitle">选择 SSO 提供商进行身份认证</p>
        </div>

        <!-- Loading State -->
        <div v-if="loading" class="sso-loading">
          <a-spin size="large" tip="加载提供商列表..." />
        </div>

        <!-- Provider List -->
        <div v-else-if="enabledProviders.length > 0" class="sso-provider-list">
          <div
            v-for="provider in enabledProviders"
            :key="provider.id"
            class="sso-provider-card"
            @click="handleSelectProvider(provider)"
          >
            <div class="provider-icon">
              <SafetyCertificateOutlined
                v-if="provider.provider_type === 'saml'"
                :style="{ fontSize: '24px', color: '#722ed1' }"
              />
              <CloudOutlined
                v-else-if="provider.provider_type === 'oauth'"
                :style="{ fontSize: '24px', color: '#1890ff' }"
              />
              <KeyOutlined
                v-else
                :style="{ fontSize: '24px', color: '#52c41a' }"
              />
            </div>
            <div class="provider-info">
              <div class="provider-name">{{ provider.provider_name }}</div>
              <div class="provider-type">
                <a-tag :color="getProviderTypeColor(provider.provider_type)" size="small">
                  {{ getProviderTypeLabel(provider.provider_type) }}
                </a-tag>
              </div>
            </div>
            <RightOutlined class="provider-arrow" />
          </div>
        </div>

        <!-- Empty State -->
        <a-empty v-else description="暂无可用的 SSO 提供商">
          <template #image>
            <DisconnectOutlined :style="{ fontSize: '48px', color: '#d9d9d9' }" />
          </template>
          <a-typography-text type="secondary">
            请联系管理员配置 SSO 提供商
          </a-typography-text>
        </a-empty>

        <!-- Callback Handling Status -->
        <div v-if="authInProgress" class="sso-auth-progress">
          <a-alert type="info" show-icon>
            <template #message>
              SSO 认证进行中
            </template>
            <template #description>
              请在打开的浏览器窗口中完成身份验证。验证完成后将自动返回应用。
            </template>
          </a-alert>
          <div class="auth-progress-actions">
            <a-button @click="handleCancelAuth">
              取消认证
            </a-button>
          </div>
        </div>

        <!-- Auth Error -->
        <a-alert
          v-if="authError"
          type="error"
          :message="authError"
          closable
          show-icon
          @close="authError = ''"
        />

        <!-- Back to normal login -->
        <div class="sso-login-footer">
          <a-button type="link" @click="handleBackToLogin">
            <ArrowLeftOutlined /> 返回普通登录
          </a-button>
        </div>
      </a-space>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import {
  SafetyCertificateOutlined,
  CloudOutlined,
  KeyOutlined,
  RightOutlined,
  ArrowLeftOutlined,
  DisconnectOutlined,
} from '@ant-design/icons-vue'
import { useSSOStore } from '../stores/sso'

const router = useRouter()
const ssoStore = useSSOStore()

// State
const loading = ref(false)
const authInProgress = ref(false)
const authError = ref('')

// Computed
const enabledProviders = computed(() => {
  return ssoStore.providers.filter((p: any) => p.enabled)
})

// Helpers
function getProviderTypeColor(type: string): string {
  const colors: Record<string, string> = {
    saml: 'purple',
    oauth: 'blue',
    oidc: 'green',
  }
  return colors[type] || 'default'
}

function getProviderTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    saml: 'SAML',
    oauth: 'OAuth 2.0',
    oidc: 'OIDC',
  }
  return labels[type] || type
}

// Handlers
async function handleSelectProvider(provider: any) {
  if (authInProgress.value) {
    message.warning('认证正在进行中，请稍候')
    return
  }

  authInProgress.value = true
  authError.value = ''

  try {
    const result = await ssoStore.initiateLogin(provider.id)

    if (result.success && result.authUrl) {
      // Open the auth URL in a new BrowserWindow or external browser
      if ((window as any).electronAPI?.shell?.openExternal) {
        await (window as any).electronAPI.shell.openExternal(result.authUrl)
      } else if ((window as any).electron?.shell?.openExternal) {
        await (window as any).electron.shell.openExternal(result.authUrl)
      } else {
        window.open(result.authUrl, '_blank')
      }
    } else {
      authError.value = result.error || '无法发起 SSO 登录'
      authInProgress.value = false
    }
  } catch (error) {
    console.error('[SSOLoginPage] SSO 登录发起失败:', error)
    authError.value = '发起 SSO 登录时出错'
    authInProgress.value = false
  }
}

function handleCancelAuth() {
  authInProgress.value = false
  message.info('已取消 SSO 认证')
}

function handleBackToLogin() {
  router.push('/login')
}

// Listen for SSO callback result from main process
let callbackCleanup: (() => void) | null = null

function setupCallbackListener() {
  const ipcRenderer = (window as any).electron?.ipcRenderer
  if (!ipcRenderer) return

  const handler = (_event: any, result: any) => {
    authInProgress.value = false

    if (result.success) {
      message.success('SSO 登录成功')
      router.push('/projects')
    } else {
      authError.value = result.error || 'SSO 认证失败'
    }
  }

  ipcRenderer.on('sso:callback-result', handler)
  callbackCleanup = () => {
    ipcRenderer.removeListener('sso:callback-result', handler)
  }
}

// Lifecycle
onMounted(async () => {
  loading.value = true
  try {
    await ssoStore.fetchProviders()
  } catch (error) {
    console.error('[SSOLoginPage] 加载提供商失败:', error)
  } finally {
    loading.value = false
  }

  setupCallbackListener()
})

onUnmounted(() => {
  if (callbackCleanup) {
    callbackCleanup()
    callbackCleanup = null
  }
})
</script>

<style scoped>
.sso-login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.sso-login-card {
  width: 460px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  animation: fadeIn 0.3s ease-in;
}

.sso-login-header {
  text-align: center;
}

.sso-login-title {
  margin-top: 16px;
  margin-bottom: 8px;
  font-size: 24px;
  font-weight: 500;
}

.sso-login-subtitle {
  margin: 0;
  color: rgba(0, 0, 0, 0.45);
}

.sso-loading {
  display: flex;
  justify-content: center;
  padding: 32px 0;
}

.sso-provider-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sso-provider-card {
  display: flex;
  align-items: center;
  padding: 16px;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.sso-provider-card:hover {
  border-color: #1890ff;
  box-shadow: 0 2px 8px rgba(24, 144, 255, 0.15);
  background-color: #fafafa;
}

.provider-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  border-radius: 8px;
  margin-right: 16px;
}

.provider-info {
  flex: 1;
}

.provider-name {
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 4px;
}

.provider-type {
  line-height: 1;
}

.provider-arrow {
  flex-shrink: 0;
  color: #bfbfbf;
  font-size: 14px;
}

.sso-auth-progress {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.auth-progress-actions {
  display: flex;
  justify-content: center;
}

.sso-login-footer {
  text-align: center;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
