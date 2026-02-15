<template>
  <div class="identity-linking-page">
    <a-page-header
      title="身份关联管理"
      sub-title="将 DID 身份与 SSO 提供商关联"
      @back="() => $router.back()"
    >
      <template #extra>
        <a-button type="primary" @click="handleOpenLinkModal">
          <template #icon>
            <LinkOutlined />
          </template>
          关联新身份
        </a-button>
      </template>
    </a-page-header>

    <div class="linking-content">
      <!-- Current DID Display -->
      <a-card :bordered="false" class="did-card">
        <a-descriptions title="当前 DID 身份" :column="1" size="small">
          <a-descriptions-item label="DID 标识">
            <a-typography-text copyable>
              {{ currentDID || '未设置' }}
            </a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item label="身份状态">
            <a-badge
              :status="currentDID ? 'success' : 'default'"
              :text="currentDID ? '已激活' : '未激活'"
            />
          </a-descriptions-item>
        </a-descriptions>
      </a-card>

      <!-- Linked Identities Table -->
      <a-card :bordered="false" class="table-card" title="已关联身份">
        <a-table
          :columns="columns"
          :data-source="ssoStore.linkedIdentities"
          :loading="ssoStore.loading"
          row-key="id"
          :pagination="{ pageSize: 10 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'provider_name'">
              <a-space>
                <SafetyCertificateOutlined
                  v-if="record.provider_type === 'saml'"
                  :style="{ color: '#722ed1' }"
                />
                <CloudOutlined
                  v-else-if="record.provider_type === 'oauth'"
                  :style="{ color: '#1890ff' }"
                />
                <KeyOutlined
                  v-else
                  :style="{ color: '#52c41a' }"
                />
                {{ record.provider_name }}
              </a-space>
            </template>

            <template v-else-if="column.key === 'sso_subject'">
              <a-typography-text ellipsis :content="record.sso_subject" style="max-width: 200px" />
            </template>

            <template v-else-if="column.key === 'verified'">
              <CheckCircleOutlined
                v-if="record.verified"
                :style="{ color: '#52c41a', fontSize: '18px' }"
              />
              <CloseCircleOutlined
                v-else
                :style="{ color: '#ff4d4f', fontSize: '18px' }"
              />
            </template>

            <template v-else-if="column.key === 'created_at'">
              {{ formatTime(record.created_at) }}
            </template>

            <template v-else-if="column.key === 'actions'">
              <a-space>
                <a-button
                  v-if="!record.verified"
                  type="link"
                  size="small"
                  @click="handleVerifyLink(record)"
                >
                  <SafetyCertificateOutlined /> 验证
                </a-button>
                <a-popconfirm
                  title="确定要取消此身份关联吗？取消后需要重新验证。"
                  ok-text="确认取消"
                  cancel-text="返回"
                  @confirm="handleUnlink(record.did, record.provider_id)"
                >
                  <a-button type="link" size="small" danger>
                    <DisconnectOutlined /> 取消关联
                  </a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-card>
    </div>

    <!-- Link New Identity Modal -->
    <a-modal
      v-model:open="linkModalVisible"
      title="关联新身份"
      width="520px"
      :confirm-loading="linking"
      :ok-button-props="{ disabled: !linkForm.providerId }"
      @ok="handleStartLinking"
      @cancel="handleCloseLinkModal"
    >
      <a-form
        :model="linkForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item label="SSO 提供商" required>
          <a-select
            v-model:value="linkForm.providerId"
            placeholder="选择要关联的 SSO 提供商"
            :loading="ssoStore.loading"
          >
            <a-select-option
              v-for="provider in availableProviders"
              :key="provider.id"
              :value="provider.id"
            >
              <a-space>
                <a-tag :color="getProviderTypeColor(provider.provider_type)" size="small">
                  {{ getProviderTypeLabel(provider.provider_type) }}
                </a-tag>
                {{ provider.provider_name }}
              </a-space>
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
          <a-alert
            type="info"
            show-icon
            message="身份关联流程"
            description="选择提供商后，系统将发起 SSO 登录以验证您的身份。验证成功后将自动创建身份关联。"
          />
        </a-form-item>
      </a-form>

      <!-- Linking progress -->
      <div v-if="linkingInProgress" class="linking-progress">
        <a-spin tip="正在通过 SSO 验证身份..." />
        <a-button type="link" @click="handleCancelLinking">取消</a-button>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { message } from 'ant-design-vue'
import {
  LinkOutlined,
  DisconnectOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SafetyCertificateOutlined,
  CloudOutlined,
  KeyOutlined,
} from '@ant-design/icons-vue'
import { useSSOStore } from '../stores/sso'
import { useAppStore } from '../stores/app'
import dayjs from 'dayjs'

const ssoStore = useSSOStore()
const appStore = useAppStore()

// State
const linkModalVisible = ref(false)
const linking = ref(false)
const linkingInProgress = ref(false)

const linkForm = ref({
  providerId: undefined as string | undefined,
})

// Computed
const currentDID = computed(() => {
  return appStore.deviceId || ''
})

const availableProviders = computed(() => {
  return ssoStore.providers.filter((p: any) => p.enabled)
})

// Table columns
const columns = [
  {
    title: '提供商',
    key: 'provider_name',
    dataIndex: 'provider_name',
    width: 200,
  },
  {
    title: 'SSO 主体标识',
    key: 'sso_subject',
    dataIndex: 'sso_subject',
    width: 220,
    ellipsis: true,
  },
  {
    title: '验证状态',
    key: 'verified',
    dataIndex: 'verified',
    width: 100,
    align: 'center' as const,
  },
  {
    title: '关联时间',
    key: 'created_at',
    dataIndex: 'created_at',
    width: 180,
    sorter: (a: any, b: any) => {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 200,
    fixed: 'right' as const,
  },
]

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

function formatTime(timestamp: string | number): string {
  if (!timestamp) return '-'
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss')
}

// Handlers
function handleOpenLinkModal() {
  if (!currentDID.value) {
    message.warning('请先创建 DID 身份后再进行关联')
    return
  }
  linkForm.value.providerId = undefined
  linkingInProgress.value = false
  linkModalVisible.value = true
}

function handleCloseLinkModal() {
  linkModalVisible.value = false
  linkingInProgress.value = false
}

async function handleStartLinking() {
  if (!linkForm.value.providerId) {
    message.warning('请选择 SSO 提供商')
    return
  }

  linking.value = true
  linkingInProgress.value = true

  try {
    // Initiate SSO login to verify identity
    const loginResult = await ssoStore.initiateLogin(linkForm.value.providerId)

    if (loginResult.success && loginResult.authUrl) {
      // Open auth URL for identity verification
      if ((window as any).electronAPI?.shell?.openExternal) {
        await (window as any).electronAPI.shell.openExternal(loginResult.authUrl)
      } else if ((window as any).electron?.shell?.openExternal) {
        await (window as any).electron.shell.openExternal(loginResult.authUrl)
      } else {
        window.open(loginResult.authUrl, '_blank')
      }
      // Wait for callback (handled by listener)
    } else {
      message.error(loginResult.error || '无法发起身份验证')
      linkingInProgress.value = false
    }
  } catch (error) {
    console.error('[IdentityLinkingPage] 身份关联失败:', error)
    message.error('身份关联失败')
    linkingInProgress.value = false
  } finally {
    linking.value = false
  }
}

function handleCancelLinking() {
  linkingInProgress.value = false
  message.info('已取消身份关联')
}

async function handleVerifyLink(record: any) {
  try {
    const result = await ssoStore.verifyLink(record.id)
    if (result.success) {
      message.success('身份验证成功')
      await ssoStore.fetchLinkedIdentities()
    } else {
      message.error(result.error || '身份验证失败')
    }
  } catch (error) {
    console.error('[IdentityLinkingPage] 验证失败:', error)
    message.error('验证失败')
  }
}

async function handleUnlink(did: string, providerId: string) {
  try {
    await ssoStore.unlinkIdentity(did, providerId)
    message.success('已取消身份关联')
  } catch (error) {
    console.error('[IdentityLinkingPage] 取消关联失败:', error)
    message.error('取消关联失败')
  }
}

// SSO callback listener for identity linking
let callbackCleanup: (() => void) | null = null

function setupCallbackListener() {
  const ipcRenderer = (window as any).electron?.ipcRenderer
  if (!ipcRenderer) return

  const handler = async (_event: any, result: any) => {
    linkingInProgress.value = false

    if (result.success && linkForm.value.providerId) {
      // Create the identity link with the SSO subject from the callback
      try {
        const linkResult = await ssoStore.createLink({
          providerId: linkForm.value.providerId,
          ssoSubject: result.ssoSubject,
          did: currentDID.value,
        })

        if (linkResult.success) {
          message.success('身份关联成功')
          linkModalVisible.value = false
          await ssoStore.fetchLinkedIdentities()
        } else {
          message.error(linkResult.error || '创建身份关联失败')
        }
      } catch (error) {
        console.error('[IdentityLinkingPage] 创建关联失败:', error)
        message.error('创建身份关联失败')
      }
    } else if (!result.success) {
      message.error(result.error || 'SSO 验证失败，无法创建关联')
    }
  }

  ipcRenderer.on('sso:link-callback', handler)
  callbackCleanup = () => {
    ipcRenderer.removeListener('sso:link-callback', handler)
  }
}

// Lifecycle
onMounted(async () => {
  await Promise.all([
    ssoStore.fetchProviders(),
    ssoStore.fetchLinkedIdentities(),
  ])
  setupCallbackListener()
})

onUnmounted(() => {
  if (callbackCleanup) {
    callbackCleanup()
    callbackCleanup = null
  }
})
</script>

<style scoped lang="less">
.identity-linking-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f0f2f5;
}

.linking-content {
  flex: 1;
  padding: 0 24px 24px;
  overflow: auto;
}

.did-card {
  margin-bottom: 16px;
}

.table-card {
  margin-bottom: 16px;
}

.linking-progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 0;
  border-top: 1px solid #f0f0f0;
  margin-top: 16px;
}
</style>
