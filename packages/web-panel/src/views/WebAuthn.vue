<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('webauthn.title') }}</h2>
        <p class="page-sub">{{ t('webauthn.subtitle') }}</p>
      </div>
      <a-button type="primary" ghost :loading="refreshing" @click="refreshCurrentTab">
        <template #icon><ReloadOutlined /></template>
        {{ t('webauthn.refresh') }}
      </a-button>
    </div>

    <a-tabs v-model:activeKey="activeTab" type="card" @change="onTabChange">
      <!-- Tab 1: WebAuthn -->
      <a-tab-pane key="webauthn">
        <template #tab>
          <KeyOutlined />
          {{ t('webauthn.tabs.webauthn') }}
        </template>

        <a-space style="margin-bottom: 16px;">
          <a-button type="primary" @click="showRegisterModal = true">
            <template #icon><PlusOutlined /></template>
            {{ t('webauthn.credentials.registerButton') }}
          </a-button>
        </a-space>

        <div v-if="credentialLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <a-table
          v-else
          :columns="credentialColumns"
          :data-source="credentialList"
          :pagination="{ pageSize: 20, showTotal: (count) => t('webauthn.totals.rows', { count }) }"
          size="small"
          style="background: var(--bg-card);"
          :row-class-name="() => 'auth-row'"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'id'">
              <span style="color: #e0e0e0; font-family: monospace; font-size: 12px;" :title="record.id">
                {{ truncateId(record.id) }}
              </span>
            </template>
            <template v-if="column.key === 'name'">
              <span style="color: var(--text-primary);">{{ record.name }}</span>
            </template>
            <template v-if="column.key === 'type'">
              <a-tag color="blue">{{ record.type || 'public-key' }}</a-tag>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 12px;">{{ record.createdAt || '-' }}</span>
            </template>
            <template v-if="column.key === 'lastUsed'">
              <span style="color: var(--text-secondary); font-size: 12px;">{{ record.lastUsed || '-' }}</span>
            </template>
            <template v-if="column.key === 'actions'">
              <a-popconfirm
                :title="t('webauthn.credentials.deleteConfirm')"
                :ok-text="t('webauthn.credentials.deleteOk')"
                :cancel-text="t('common.cancel')"
                @confirm="deleteCredential(record)"
              >
                <a-button type="link" danger size="small">
                  <template #icon><DeleteOutlined /></template>
                  {{ t('webauthn.credentials.delete') }}
                </a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <a-empty :description="t('webauthn.credentials.emptyText')" />
          </template>
        </a-table>

        <!-- Register Modal -->
        <a-modal
          v-model:open="showRegisterModal"
          :title="t('webauthn.credentials.registerTitle')"
          :confirm-loading="registering"
          @ok="registerCredential"
          :ok-text="t('webauthn.credentials.registerOk')"
          :cancel-text="t('common.cancel')"
        >
          <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
            <a-form-item :label="t('webauthn.credentials.nameLabel')" required>
              <a-input v-model:value="newCredentialName" :placeholder="t('webauthn.credentials.namePlaceholder')" />
            </a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>

      <!-- Tab 2: SSO Config -->
      <a-tab-pane key="sso">
        <template #tab>
          <SafetyOutlined />
          {{ t('webauthn.tabs.sso') }}
        </template>

        <div v-if="ssoLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <template v-else>
          <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
            <a-col :xs="12" :sm="6" v-for="stat in ssoStats" :key="stat.key">
              <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
                <a-statistic
                  :title="stat.label"
                  :value="stat.value"
                  :value-style="{ color: stat.color, fontSize: '20px' }"
                />
              </a-card>
            </a-col>
          </a-row>

          <a-card style="background: var(--bg-card); border-color: var(--border-color);" :title="t('webauthn.sso.currentTitle')">
            <a-descriptions :column="{ xs: 1, sm: 2 }" bordered size="small" style="background: var(--bg-card);">
              <a-descriptions-item :label="t('webauthn.sso.providerLabel')">
                <a-tag :color="ssoConfig.provider ? 'blue' : 'default'">
                  {{ ssoConfig.provider || t('webauthn.sso.notConfigured') }}
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item :label="t('webauthn.sso.clientIdLabel')">
                <span style="color: #e0e0e0; font-family: monospace; font-size: 12px;">
                  {{ ssoConfig.clientId || '-' }}
                </span>
              </a-descriptions-item>
              <a-descriptions-item :label="t('webauthn.sso.redirectUrlLabel')">
                <span style="color: var(--text-secondary); font-size: 12px;">
                  {{ ssoConfig.redirectUrl || '-' }}
                </span>
              </a-descriptions-item>
              <a-descriptions-item :label="t('webauthn.sso.statusLabel')">
                <a-tag :color="ssoConfig.enabled ? 'green' : 'default'">
                  {{ ssoConfig.enabled ? t('webauthn.sso.enabled') : t('webauthn.sso.disabled') }}
                </a-tag>
              </a-descriptions-item>
            </a-descriptions>

            <div style="margin-top: 16px;">
              <a-button type="primary" @click="showSsoModal = true">
                <template #icon><KeyOutlined /></template>
                {{ t('webauthn.sso.configureButton') }}
              </a-button>
            </div>
          </a-card>
        </template>

        <!-- SSO Config Modal -->
        <a-modal
          v-model:open="showSsoModal"
          :title="t('webauthn.sso.modalTitle')"
          :confirm-loading="ssoSaving"
          @ok="saveSsoConfig"
          :ok-text="t('webauthn.sso.modalOk')"
          :cancel-text="t('common.cancel')"
          width="520px"
        >
          <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
            <a-form-item :label="t('webauthn.sso.providerLabel')" required>
              <a-select v-model:value="ssoForm.provider" :placeholder="t('webauthn.sso.providerPlaceholder')">
                <a-select-option value="OIDC">OIDC</a-select-option>
                <a-select-option value="SAML">SAML</a-select-option>
                <a-select-option value="LDAP">LDAP</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item :label="t('webauthn.sso.clientIdLabel')" required>
              <a-input v-model:value="ssoForm.clientId" :placeholder="t('webauthn.sso.clientIdPlaceholder')" />
            </a-form-item>
            <a-form-item :label="t('webauthn.sso.clientSecretLabel')">
              <a-input-password v-model:value="ssoForm.clientSecret" :placeholder="t('webauthn.sso.clientSecretPlaceholder')" />
            </a-form-item>
            <a-form-item :label="t('webauthn.sso.issuerLabel')">
              <a-input v-model:value="ssoForm.issuerUrl" :placeholder="t('webauthn.sso.issuerPlaceholder')" />
            </a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>

      <!-- Tab 3: 2FA -->
      <a-tab-pane key="2fa">
        <template #tab>
          <LockOutlined />
          {{ t('webauthn.tabs.tfa') }}
        </template>

        <div v-if="tfaLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <template v-else>
          <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;" :title="t('webauthn.tfa.totpCardTitle')">
            <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
              <span style="color: var(--text-primary); font-size: 14px;">{{ t('webauthn.tfa.statusPrefix') }}</span>
              <a-tag :color="tfaEnabled ? 'green' : 'default'" style="font-size: 13px;">
                {{ tfaEnabled ? t('webauthn.tfa.enabled') : t('webauthn.tfa.disabled') }}
              </a-tag>
            </div>

            <a-space>
              <a-button
                v-if="!tfaEnabled"
                type="primary"
                :loading="tfaToggling"
                @click="enableTOTP"
              >
                <template #icon><LockOutlined /></template>
                {{ t('webauthn.tfa.enableButton') }}
              </a-button>
              <a-popconfirm
                v-else
                :title="t('webauthn.tfa.disableConfirm')"
                :ok-text="t('webauthn.tfa.disableOk')"
                :cancel-text="t('common.cancel')"
                @confirm="disableTOTP"
              >
                <a-button danger :loading="tfaToggling">
                  {{ t('webauthn.tfa.disableButton') }}
                </a-button>
              </a-popconfirm>
            </a-space>

            <div v-if="totpResult" style="margin-top: 16px;">
              <pre style="white-space: pre-wrap; word-break: break-all; color: #52c41a; font-size: 11px; background: var(--bg-base); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color);">{{ totpResult }}</pre>
            </div>
          </a-card>

          <a-card style="background: var(--bg-card); border-color: var(--border-color);" :title="t('webauthn.tfa.recoveryCardTitle')">
            <p style="color: var(--text-secondary); margin-bottom: 12px;">
              {{ t('webauthn.tfa.recoveryHint') }}
            </p>

            <a-button :loading="generatingCodes" @click="generateRecoveryCodes">
              <template #icon><ReloadOutlined /></template>
              {{ t('webauthn.tfa.generateButton') }}
            </a-button>

            <div v-if="recoveryCodes.length > 0" style="margin-top: 16px;">
              <a-alert
                type="warning"
                show-icon
                style="margin-bottom: 12px;"
                :message="t('webauthn.tfa.saveAlert')"
              />
              <div style="background: var(--bg-base); padding: 16px; border-radius: 6px; border: 1px solid var(--border-color);">
                <div
                  v-for="(code, idx) in recoveryCodes"
                  :key="idx"
                  style="font-family: monospace; font-size: 14px; color: #e0e0e0; padding: 4px 0; letter-spacing: 2px;"
                >
                  {{ idx + 1 }}. {{ code }}
                </div>
              </div>
            </div>
          </a-card>
        </template>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  KeyOutlined,
  SafetyOutlined,
  LockOutlined,
  PlusOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'

const { t } = useI18n()
const ws = useWsStore()

// --- Shared ---
const activeTab = ref('webauthn')
const refreshing = ref(false)

async function refreshCurrentTab() {
  refreshing.value = true
  try {
    if (activeTab.value === 'webauthn') await loadCredentials()
    else if (activeTab.value === 'sso') await loadSsoStatus()
    else if (activeTab.value === '2fa') await loadTfaStatus()
  } finally {
    refreshing.value = false
  }
}

function onTabChange(key) {
  if (key === 'sso' && !ssoLoaded.value) loadSsoStatus()
  if (key === '2fa' && !tfaLoaded.value) loadTfaStatus()
}

// --- Helpers ---
function tryParseJSON(output) {
  try {
    return JSON.parse(output)
  } catch (_e) {
    return null
  }
}

function truncateId(id) {
  if (!id) return '-'
  if (id.length <= 16) return id
  return id.slice(0, 8) + '...' + id.slice(-8)
}

// --- Tab 1: WebAuthn ---
const credentialLoading = ref(false)
const registering = ref(false)
const credentialList = ref([])
const showRegisterModal = ref(false)
const newCredentialName = ref('')

const credentialColumns = computed(() => [
  { title: t('webauthn.credentialColumns.id'), key: 'id', dataIndex: 'id', width: '180px' },
  { title: t('webauthn.credentialColumns.name'), key: 'name', dataIndex: 'name', width: '160px' },
  { title: t('webauthn.credentialColumns.type'), key: 'type', dataIndex: 'type', width: '120px' },
  { title: t('webauthn.credentialColumns.createdAt'), key: 'createdAt', dataIndex: 'createdAt', width: '180px' },
  { title: t('webauthn.credentialColumns.lastUsed'), key: 'lastUsed', dataIndex: 'lastUsed', width: '180px' },
  { title: t('webauthn.credentialColumns.actions'), key: 'actions', width: '100px', fixed: 'right' },
])

async function loadCredentials() {
  credentialLoading.value = true
  try {
    const { output } = await ws.execute('webauthn list --json', 15000)
    const parsed = tryParseJSON(output)
    if (parsed && Array.isArray(parsed)) {
      credentialList.value = parsed.map((item, idx) => ({
        key: item.id || idx,
        id: item.id || '-',
        name: item.name || item.displayName || '-',
        type: item.type || 'public-key',
        createdAt: item.createdAt || item.created || '-',
        lastUsed: item.lastUsed || item.lastAuthentication || '-',
      }))
    } else if (parsed && parsed.credentials) {
      credentialList.value = parsed.credentials.map((item, idx) => ({
        key: item.id || idx,
        id: item.id || '-',
        name: item.name || item.displayName || '-',
        type: item.type || 'public-key',
        createdAt: item.createdAt || item.created || '-',
        lastUsed: item.lastUsed || item.lastAuthentication || '-',
      }))
    } else {
      credentialList.value = parseCredentialText(output)
    }
  } catch (e) {
    message.error(t('webauthn.messages.loadFailed', { err: e.message }))
  } finally {
    credentialLoading.value = false
  }
}

function parseCredentialText(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('No ')) continue
    const parts = trimmed.split(/\s*[|│]\s*/)
    if (parts.length >= 2) {
      result.push({
        key: result.length,
        id: parts[0] || '-',
        name: parts[1] || '-',
        type: parts[2] || 'public-key',
        createdAt: parts[3] || '-',
        lastUsed: parts[4] || '-',
      })
    }
  }
  return result
}

async function registerCredential() {
  const name = newCredentialName.value.trim()
  if (!name) { message.warning(t('webauthn.messages.credNameRequired')); return }
  registering.value = true
  try {
    const escapedName = name.replace(/"/g, '\\"')
    const { output } = await ws.execute(`webauthn register --name "${escapedName}" --json`, 30000)
    if (output.includes('error') || output.includes('失败')) {
      message.error(t('webauthn.messages.registerFailed', { err: output.slice(0, 120) }))
    } else {
      message.success(t('webauthn.messages.registerOk'))
      showRegisterModal.value = false
      newCredentialName.value = ''
      await loadCredentials()
    }
  } catch (e) {
    message.error(t('webauthn.messages.registerFailed', { err: e.message }))
  } finally {
    registering.value = false
  }
}

async function deleteCredential(record) {
  try {
    const { output } = await ws.execute(`webauthn delete "${record.id}"`, 15000)
    if (output.includes('error') || output.includes('失败')) {
      message.error(t('webauthn.messages.deleteFailed', { err: output.slice(0, 120) }))
    } else {
      message.success(t('webauthn.messages.deleteOk'))
      await loadCredentials()
    }
  } catch (e) {
    message.error(t('webauthn.messages.deleteFailed', { err: e.message }))
  }
}

// --- Tab 2: SSO ---
const ssoLoading = ref(false)
const ssoLoaded = ref(false)
const ssoSaving = ref(false)
const showSsoModal = ref(false)
const ssoConfig = ref({
  provider: '',
  clientId: '',
  redirectUrl: '',
  enabled: false,
})
const ssoForm = ref({
  provider: undefined,
  clientId: '',
  clientSecret: '',
  issuerUrl: '',
})

const ssoStats = computed(() => [
  {
    key: 'provider',
    label: t('webauthn.sso.providerLabel'),
    value: ssoConfig.value.provider || t('webauthn.sso.notConfigured'),
    color: ssoConfig.value.provider ? '#1677ff' : '#999',
  },
  {
    key: 'status',
    label: t('webauthn.sso.statusLabel'),
    value: ssoConfig.value.enabled ? t('webauthn.sso.enabled') : t('webauthn.sso.disabled'),
    color: ssoConfig.value.enabled ? '#52c41a' : '#faad14',
  },
])

async function loadSsoStatus() {
  ssoLoading.value = true
  try {
    const { output } = await ws.execute('sso status --json', 15000)
    const parsed = tryParseJSON(output)
    if (parsed) {
      ssoConfig.value = {
        provider: parsed.provider || '',
        clientId: parsed.clientId || parsed.client_id || '',
        redirectUrl: parsed.redirectUrl || parsed.redirect_url || parsed.callbackUrl || '',
        enabled: parsed.enabled || parsed.active || false,
      }
    } else {
      const lines = output.split('\n')
      for (const line of lines) {
        const kv = line.trim().match(/^(.+?)\s*[:=：]\s*(.+)$/)
        if (kv) {
          const k = kv[1].toLowerCase()
          const v = kv[2].trim()
          if (k.includes('provider')) ssoConfig.value.provider = v
          else if (k.includes('client') && k.includes('id')) ssoConfig.value.clientId = v
          else if (k.includes('redirect') || k.includes('callback')) ssoConfig.value.redirectUrl = v
          else if (k.includes('status') || k.includes('enabled')) ssoConfig.value.enabled = /true|enabled|active|已启用/i.test(v)
        }
      }
    }
    ssoLoaded.value = true
  } catch (_e) {
    ssoConfig.value = { provider: '', clientId: '', redirectUrl: '', enabled: false }
    ssoLoaded.value = true
  } finally {
    ssoLoading.value = false
  }
}

async function saveSsoConfig() {
  if (!ssoForm.value.provider) { message.warning(t('webauthn.messages.providerRequired')); return }
  if (!ssoForm.value.clientId.trim()) { message.warning(t('webauthn.messages.clientIdRequired')); return }
  ssoSaving.value = true
  try {
    const commands = [
      `config set sso.provider ${ssoForm.value.provider}`,
      `config set sso.clientId ${ssoForm.value.clientId.trim()}`,
    ]
    if (ssoForm.value.clientSecret.trim()) {
      commands.push(`config set sso.clientSecret ${ssoForm.value.clientSecret.trim()}`)
    }
    if (ssoForm.value.issuerUrl.trim()) {
      commands.push(`config set sso.issuerUrl ${ssoForm.value.issuerUrl.trim()}`)
    }
    for (const cmd of commands) {
      await ws.execute(cmd, 10000)
    }
    message.success(t('webauthn.messages.ssoSaveOk'))
    showSsoModal.value = false
    await loadSsoStatus()
  } catch (e) {
    message.error(t('webauthn.messages.ssoSaveFailed', { err: e.message }))
  } finally {
    ssoSaving.value = false
  }
}

// --- Tab 3: 2FA ---
const tfaLoading = ref(false)
const tfaLoaded = ref(false)
const tfaEnabled = ref(false)
const tfaToggling = ref(false)
const totpResult = ref('')
const generatingCodes = ref(false)
const recoveryCodes = ref([])

async function loadTfaStatus() {
  tfaLoading.value = true
  try {
    const { output } = await ws.execute('auth 2fa status --json', 15000)
    const parsed = tryParseJSON(output)
    if (parsed) {
      tfaEnabled.value = parsed.enabled || parsed.active || false
    } else {
      tfaEnabled.value = /enabled|已启用|active/i.test(output)
    }
    tfaLoaded.value = true
  } catch (_e) {
    tfaEnabled.value = false
    tfaLoaded.value = true
  } finally {
    tfaLoading.value = false
  }
}

async function enableTOTP() {
  tfaToggling.value = true
  totpResult.value = ''
  try {
    const { output } = await ws.execute('auth 2fa enable --type totp --json', 20000)
    if (output.includes('error') || output.includes('失败')) {
      message.error(t('webauthn.messages.totpEnableFailed', { err: output.slice(0, 120) }))
    } else {
      const parsed = tryParseJSON(output)
      if (parsed && parsed.secret) {
        const lines = [
          t('webauthn.tfa.totpResultPrefix', { secret: parsed.secret }),
          t('webauthn.tfa.totpResultUrl', { url: parsed.otpAuthUrl || parsed.uri || '' }),
        ]
        totpResult.value = lines.join('\n')
      } else {
        totpResult.value = output
      }
      tfaEnabled.value = true
      message.success(t('webauthn.messages.totpEnableOk'))
    }
  } catch (e) {
    message.error(t('webauthn.messages.totpEnableFailed', { err: e.message }))
  } finally {
    tfaToggling.value = false
  }
}

async function disableTOTP() {
  tfaToggling.value = true
  totpResult.value = ''
  try {
    const { output } = await ws.execute('auth 2fa disable', 15000)
    if (output.includes('error') || output.includes('失败')) {
      message.error(t('webauthn.messages.totpDisableFailed', { err: output.slice(0, 120) }))
    } else {
      tfaEnabled.value = false
      message.success(t('webauthn.messages.totpDisableOk'))
    }
  } catch (e) {
    message.error(t('webauthn.messages.totpDisableFailed', { err: e.message }))
  } finally {
    tfaToggling.value = false
  }
}

async function generateRecoveryCodes() {
  generatingCodes.value = true
  recoveryCodes.value = []
  try {
    const { output } = await ws.execute('auth 2fa recovery-codes --json', 15000)
    const parsed = tryParseJSON(output)
    if (parsed && Array.isArray(parsed.codes)) {
      recoveryCodes.value = parsed.codes
    } else if (parsed && Array.isArray(parsed)) {
      recoveryCodes.value = parsed
    } else {
      const codes = output.split('\n')
        .map((l) => l.trim())
        .filter((l) => l && /^[A-Za-z0-9-]{6,}$/.test(l))
      recoveryCodes.value = codes.length > 0 ? codes : [output.trim() || t('webauthn.messages.codesUnable')]
    }
    if (recoveryCodes.value.length > 0 && recoveryCodes.value[0] !== t('webauthn.messages.codesUnable')) {
      message.success(t('webauthn.messages.codesOk'))
    }
  } catch (e) {
    message.error(t('webauthn.messages.codesFailed', { err: e.message }))
  } finally {
    generatingCodes.value = false
  }
}

onMounted(() => {
  loadCredentials()
})
</script>

<style scoped>
:deep(.auth-row:hover td) { background: var(--bg-card-hover) !important; }
:deep(.ant-tabs-tab) { color: var(--text-secondary) !important; }
:deep(.ant-tabs-tab-active .ant-tabs-tab-btn) { color: #1677ff !important; }
:deep(.ant-card-head) { border-color: var(--border-color) !important; color: var(--text-primary) !important; }
:deep(.ant-descriptions-item-label) { color: var(--text-secondary) !important; background: var(--bg-base) !important; }
:deep(.ant-descriptions-item-content) { color: var(--text-primary) !important; }
</style>
