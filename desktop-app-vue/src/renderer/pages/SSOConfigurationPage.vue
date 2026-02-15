<template>
  <div class="sso-configuration-page">
    <a-page-header
      title="SSO 身份认证配置"
      sub-title="管理企业单点登录提供商"
      @back="() => $router.back()"
    >
      <template #extra>
        <a-button type="primary" @click="handleAddProvider">
          <template #icon>
            <PlusOutlined />
          </template>
          添加提供商
        </a-button>
      </template>
    </a-page-header>

    <div class="sso-content">
      <a-table
        :columns="columns"
        :data-source="ssoStore.providers"
        :loading="ssoStore.loading"
        row-key="id"
        :pagination="{ pageSize: 10 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'provider_type'">
            <a-tag :color="getProviderTypeColor(record.provider_type)">
              {{ getProviderTypeLabel(record.provider_type) }}
            </a-tag>
          </template>

          <template v-else-if="column.key === 'enabled'">
            <a-switch
              :checked="record.enabled"
              @change="(checked: boolean) => handleToggleEnabled(record, checked)"
            />
          </template>

          <template v-else-if="column.key === 'created_at'">
            {{ formatTime(record.created_at) }}
          </template>

          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button type="link" size="small" @click="handleEditProvider(record)">
                <EditOutlined /> 编辑
              </a-button>
              <a-button type="link" size="small" @click="handleTestConnection(record)">
                <ApiOutlined /> 测试连接
              </a-button>
              <a-popconfirm
                title="确定要删除此提供商吗?"
                @confirm="handleDeleteProvider(record.id)"
              >
                <a-button type="link" size="small" danger>
                  <DeleteOutlined /> 删除
                </a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </div>

    <!-- Add/Edit Provider Modal -->
    <a-modal
      v-model:open="modalVisible"
      :title="editingProvider ? '编辑 SSO 提供商' : '添加 SSO 提供商'"
      width="640px"
      :confirm-loading="saving"
      @ok="handleSaveProvider"
      @cancel="handleCloseModal"
    >
      <a-form
        :model="providerForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item label="提供商名称" required>
          <a-input
            v-model:value="providerForm.provider_name"
            placeholder="输入提供商名称，如 Azure AD"
          />
        </a-form-item>

        <a-form-item label="协议类型" required>
          <a-select
            v-model:value="providerForm.provider_type"
            placeholder="选择协议类型"
            @change="handleProviderTypeChange"
          >
            <a-select-option value="saml">SAML</a-select-option>
            <a-select-option value="oauth">OAuth 2.0</a-select-option>
            <a-select-option value="oidc">OIDC</a-select-option>
          </a-select>
        </a-form-item>

        <!-- OAuth / OIDC Configuration -->
        <template v-if="providerForm.provider_type === 'oauth' || providerForm.provider_type === 'oidc'">
          <a-divider>OAuth / OIDC 配置</a-divider>

          <a-form-item label="Client ID" required>
            <a-input
              v-model:value="providerForm.config.clientId"
              placeholder="OAuth Client ID"
            />
          </a-form-item>

          <a-form-item label="Client Secret" required>
            <a-input-password
              v-model:value="providerForm.config.clientSecret"
              placeholder="OAuth Client Secret"
            />
          </a-form-item>

          <a-form-item label="Authorization URL" required>
            <a-input
              v-model:value="providerForm.config.authorizationEndpoint"
              placeholder="https://provider.com/oauth/authorize"
            />
          </a-form-item>

          <a-form-item label="Token URL" required>
            <a-input
              v-model:value="providerForm.config.tokenEndpoint"
              placeholder="https://provider.com/oauth/token"
            />
          </a-form-item>

          <a-form-item label="UserInfo URL">
            <a-input
              v-model:value="providerForm.config.userinfoEndpoint"
              placeholder="https://provider.com/oauth/userinfo"
            />
          </a-form-item>

          <a-form-item label="Scopes">
            <a-input
              v-model:value="providerForm.config.scopes"
              placeholder="openid profile email"
            />
          </a-form-item>

          <a-form-item label="Redirect URI">
            <a-input
              v-model:value="providerForm.config.redirectUri"
              placeholder="chainlesschain://sso/callback"
            />
          </a-form-item>
        </template>

        <!-- SAML Configuration -->
        <template v-if="providerForm.provider_type === 'saml'">
          <a-divider>SAML 配置</a-divider>

          <a-form-item label="Entity ID" required>
            <a-input
              v-model:value="providerForm.config.entityId"
              placeholder="SP Entity ID"
            />
          </a-form-item>

          <a-form-item label="IdP Entity ID" required>
            <a-input
              v-model:value="providerForm.config.idpEntityId"
              placeholder="IdP Entity ID"
            />
          </a-form-item>

          <a-form-item label="SSO URL" required>
            <a-input
              v-model:value="providerForm.config.ssoUrl"
              placeholder="https://idp.example.com/sso"
            />
          </a-form-item>

          <a-form-item label="SLO URL">
            <a-input
              v-model:value="providerForm.config.sloUrl"
              placeholder="https://idp.example.com/slo"
            />
          </a-form-item>

          <a-form-item label="证书" required>
            <a-textarea
              v-model:value="providerForm.config.certificate"
              placeholder="粘贴 IdP X.509 证书 (PEM 格式)"
              :rows="6"
            />
          </a-form-item>

          <a-form-item label="ACS URL">
            <a-input
              v-model:value="providerForm.config.assertionConsumerUrl"
              placeholder="https://app.example.com/saml/acs"
            />
          </a-form-item>
        </template>

        <a-divider />

        <a-form-item label="启用">
          <a-switch v-model:checked="providerForm.enabled" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ApiOutlined,
} from '@ant-design/icons-vue'
import { useSSOStore } from '../stores/sso'
import dayjs from 'dayjs'

const ssoStore = useSSOStore()

// State
const modalVisible = ref(false)
const saving = ref(false)
const editingProvider = ref<any>(null)

// Provider form
const providerForm = reactive({
  provider_name: '',
  provider_type: 'oidc' as 'saml' | 'oauth' | 'oidc',
  enabled: true,
  config: {
    // OAuth / OIDC fields
    clientId: '',
    clientSecret: '',
    authorizationEndpoint: '',
    tokenEndpoint: '',
    userinfoEndpoint: '',
    scopes: 'openid profile email',
    redirectUri: 'chainlesschain://sso/callback',
    // SAML fields
    entityId: '',
    idpEntityId: '',
    ssoUrl: '',
    sloUrl: '',
    certificate: '',
    assertionConsumerUrl: '',
  },
})

// Table columns
const columns = [
  {
    title: '提供商名称',
    dataIndex: 'provider_name',
    key: 'provider_name',
    width: 200,
  },
  {
    title: '协议类型',
    key: 'provider_type',
    dataIndex: 'provider_type',
    width: 120,
  },
  {
    title: '启用状态',
    key: 'enabled',
    dataIndex: 'enabled',
    width: 100,
  },
  {
    title: '创建时间',
    key: 'created_at',
    dataIndex: 'created_at',
    width: 180,
  },
  {
    title: '操作',
    key: 'actions',
    width: 260,
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

function resetForm() {
  providerForm.provider_name = ''
  providerForm.provider_type = 'oidc'
  providerForm.enabled = true
  providerForm.config = {
    clientId: '',
    clientSecret: '',
    authorizationEndpoint: '',
    tokenEndpoint: '',
    userinfoEndpoint: '',
    scopes: 'openid profile email',
    redirectUri: 'chainlesschain://sso/callback',
    entityId: '',
    idpEntityId: '',
    ssoUrl: '',
    sloUrl: '',
    certificate: '',
    assertionConsumerUrl: '',
  }
}

// Handlers
function handleAddProvider() {
  editingProvider.value = null
  resetForm()
  modalVisible.value = true
}

function handleEditProvider(provider: any) {
  editingProvider.value = provider
  providerForm.provider_name = provider.provider_name
  providerForm.provider_type = provider.provider_type
  providerForm.enabled = provider.enabled
  // Merge existing config into the form
  const cfg = provider.config || {}
  providerForm.config = {
    clientId: cfg.clientId || '',
    clientSecret: cfg.clientSecret || '',
    authorizationEndpoint: cfg.authorizationEndpoint || '',
    tokenEndpoint: cfg.tokenEndpoint || '',
    userinfoEndpoint: cfg.userinfoEndpoint || '',
    scopes: cfg.scopes || 'openid profile email',
    redirectUri: cfg.redirectUri || 'chainlesschain://sso/callback',
    entityId: cfg.entityId || '',
    idpEntityId: cfg.idpEntityId || '',
    ssoUrl: cfg.ssoUrl || '',
    sloUrl: cfg.sloUrl || '',
    certificate: cfg.certificate || '',
    assertionConsumerUrl: cfg.assertionConsumerUrl || '',
  }
  modalVisible.value = true
}

function handleCloseModal() {
  modalVisible.value = false
  editingProvider.value = null
}

function handleProviderTypeChange() {
  // Reset config fields when switching type
  providerForm.config = {
    clientId: '',
    clientSecret: '',
    authorizationEndpoint: '',
    tokenEndpoint: '',
    userinfoEndpoint: '',
    scopes: 'openid profile email',
    redirectUri: 'chainlesschain://sso/callback',
    entityId: '',
    idpEntityId: '',
    ssoUrl: '',
    sloUrl: '',
    certificate: '',
    assertionConsumerUrl: '',
  }
}

async function handleSaveProvider() {
  if (!providerForm.provider_name) {
    message.warning('请输入提供商名称')
    return
  }
  if (!providerForm.provider_type) {
    message.warning('请选择协议类型')
    return
  }

  saving.value = true
  try {
    const payload = {
      provider_name: providerForm.provider_name,
      provider_type: providerForm.provider_type,
      enabled: providerForm.enabled,
      config: JSON.stringify(providerForm.config),
    }

    if (editingProvider.value) {
      await ssoStore.updateProvider(editingProvider.value.id, payload)
      message.success('提供商已更新')
    } else {
      await ssoStore.addProvider(payload)
      message.success('提供商已添加')
    }
    handleCloseModal()
  } catch (error) {
    console.error('[SSOConfigurationPage] 保存失败:', error)
    message.error('保存失败')
  } finally {
    saving.value = false
  }
}

async function handleToggleEnabled(provider: any, checked: boolean) {
  try {
    await ssoStore.updateProvider(provider.id, { enabled: checked })
    message.success(checked ? '提供商已启用' : '提供商已禁用')
  } catch (error) {
    console.error('[SSOConfigurationPage] 切换状态失败:', error)
    message.error('更新状态失败')
  }
}

async function handleDeleteProvider(providerId: string) {
  try {
    await ssoStore.deleteProvider(providerId)
    message.success('提供商已删除')
  } catch (error) {
    console.error('[SSOConfigurationPage] 删除失败:', error)
    message.error('删除失败')
  }
}

async function handleTestConnection(provider: any) {
  try {
    const result = await ssoStore.testConnection(provider.id)
    if (result.success) {
      message.success('连接测试成功')
    } else {
      message.error(result.error || '连接测试失败')
    }
  } catch (error) {
    console.error('[SSOConfigurationPage] 测试连接失败:', error)
    message.error('测试连接失败')
  }
}

// Lifecycle
onMounted(() => {
  ssoStore.fetchProviders()
})
</script>

<style scoped lang="less">
.sso-configuration-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f0f2f5;
}

.sso-content {
  flex: 1;
  padding: 0 24px 24px;
  overflow: auto;

  :deep(.ant-table-wrapper) {
    background: #fff;
    padding: 16px;
    border-radius: 4px;
  }
}
</style>
