<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">认证管理</h2>
        <p class="page-sub">WebAuthn / SSO / 双因素认证</p>
      </div>
      <a-button type="primary" ghost :loading="refreshing" @click="refreshCurrentTab">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <a-tabs v-model:activeKey="activeTab" type="card" @change="onTabChange">
      <!-- Tab 1: WebAuthn -->
      <a-tab-pane key="webauthn">
        <template #tab>
          <KeyOutlined />
          WebAuthn
        </template>

        <a-space style="margin-bottom: 16px;">
          <a-button type="primary" @click="showRegisterModal = true">
            <template #icon><PlusOutlined /></template>
            注册新凭证
          </a-button>
        </a-space>

        <div v-if="credentialLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <a-table
          v-else
          :columns="credentialColumns"
          :data-source="credentialList"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
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
                title="确定要删除此凭证吗？"
                ok-text="确定"
                cancel-text="取消"
                @confirm="deleteCredential(record)"
              >
                <a-button type="link" danger size="small">
                  <template #icon><DeleteOutlined /></template>
                  删除
                </a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <a-empty description="暂无 WebAuthn 凭证，点击「注册新凭证」添加" />
          </template>
        </a-table>

        <!-- Register Modal -->
        <a-modal
          v-model:open="showRegisterModal"
          title="注册 WebAuthn 凭证"
          :confirm-loading="registering"
          @ok="registerCredential"
          ok-text="注册"
          cancel-text="取消"
        >
          <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
            <a-form-item label="凭证名称" required>
              <a-input v-model:value="newCredentialName" placeholder="例如：YubiKey-5, TouchID" />
            </a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>

      <!-- Tab 2: SSO Config -->
      <a-tab-pane key="sso">
        <template #tab>
          <SafetyOutlined />
          SSO 配置
        </template>

        <div v-if="ssoLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <template v-else>
          <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
            <a-col :xs="12" :sm="6" v-for="stat in ssoStats" :key="stat.label">
              <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
                <a-statistic
                  :title="stat.label"
                  :value="stat.value"
                  :value-style="{ color: stat.color, fontSize: '20px' }"
                />
              </a-card>
            </a-col>
          </a-row>

          <a-card style="background: var(--bg-card); border-color: var(--border-color);" title="当前 SSO 配置">
            <a-descriptions :column="{ xs: 1, sm: 2 }" bordered size="small" style="background: var(--bg-card);">
              <a-descriptions-item label="提供商">
                <a-tag :color="ssoConfig.provider ? 'blue' : 'default'">
                  {{ ssoConfig.provider || '未配置' }}
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="Client ID">
                <span style="color: #e0e0e0; font-family: monospace; font-size: 12px;">
                  {{ ssoConfig.clientId || '-' }}
                </span>
              </a-descriptions-item>
              <a-descriptions-item label="Redirect URL">
                <span style="color: var(--text-secondary); font-size: 12px;">
                  {{ ssoConfig.redirectUrl || '-' }}
                </span>
              </a-descriptions-item>
              <a-descriptions-item label="状态">
                <a-tag :color="ssoConfig.enabled ? 'green' : 'default'">
                  {{ ssoConfig.enabled ? '已启用' : '未启用' }}
                </a-tag>
              </a-descriptions-item>
            </a-descriptions>

            <div style="margin-top: 16px;">
              <a-button type="primary" @click="showSsoModal = true">
                <template #icon><KeyOutlined /></template>
                配置 SSO
              </a-button>
            </div>
          </a-card>
        </template>

        <!-- SSO Config Modal -->
        <a-modal
          v-model:open="showSsoModal"
          title="配置 SSO"
          :confirm-loading="ssoSaving"
          @ok="saveSsoConfig"
          ok-text="保存"
          cancel-text="取消"
          width="520px"
        >
          <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
            <a-form-item label="提供商" required>
              <a-select v-model:value="ssoForm.provider" placeholder="选择 SSO 提供商">
                <a-select-option value="OIDC">OIDC</a-select-option>
                <a-select-option value="SAML">SAML</a-select-option>
                <a-select-option value="LDAP">LDAP</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="Client ID" required>
              <a-input v-model:value="ssoForm.clientId" placeholder="输入 Client ID" />
            </a-form-item>
            <a-form-item label="Client Secret">
              <a-input-password v-model:value="ssoForm.clientSecret" placeholder="输入 Client Secret" />
            </a-form-item>
            <a-form-item label="Issuer URL">
              <a-input v-model:value="ssoForm.issuerUrl" placeholder="https://sso.example.com" />
            </a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>

      <!-- Tab 3: 2FA -->
      <a-tab-pane key="2fa">
        <template #tab>
          <LockOutlined />
          双因素认证
        </template>

        <div v-if="tfaLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <template v-else>
          <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;" title="TOTP 双因素认证">
            <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
              <span style="color: var(--text-primary); font-size: 14px;">状态:</span>
              <a-tag :color="tfaEnabled ? 'green' : 'default'" style="font-size: 13px;">
                {{ tfaEnabled ? '已启用' : '未启用' }}
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
                启用 TOTP
              </a-button>
              <a-popconfirm
                v-else
                title="确定要禁用双因素认证吗？这会降低账户安全性。"
                ok-text="确定禁用"
                cancel-text="取消"
                @confirm="disableTOTP"
              >
                <a-button danger :loading="tfaToggling">
                  禁用
                </a-button>
              </a-popconfirm>
            </a-space>

            <div v-if="totpResult" style="margin-top: 16px;">
              <pre style="white-space: pre-wrap; word-break: break-all; color: #52c41a; font-size: 11px; background: var(--bg-base); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color);">{{ totpResult }}</pre>
            </div>
          </a-card>

          <a-card style="background: var(--bg-card); border-color: var(--border-color);" title="恢复码">
            <p style="color: var(--text-secondary); margin-bottom: 12px;">
              恢复码可在丢失 TOTP 设备时用于登录。请妥善保管。
            </p>

            <a-button :loading="generatingCodes" @click="generateRecoveryCodes">
              <template #icon><ReloadOutlined /></template>
              生成恢复码
            </a-button>

            <div v-if="recoveryCodes.length > 0" style="margin-top: 16px;">
              <a-alert
                type="warning"
                show-icon
                style="margin-bottom: 12px;"
                message="请立即保存这些恢复码，关闭后将无法再次查看。"
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
import { ref, onMounted } from 'vue'
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

const credentialColumns = [
  { title: 'ID', key: 'id', dataIndex: 'id', width: '180px' },
  { title: '名称', key: 'name', dataIndex: 'name', width: '160px' },
  { title: '类型', key: 'type', dataIndex: 'type', width: '120px' },
  { title: '创建时间', key: 'createdAt', dataIndex: 'createdAt', width: '180px' },
  { title: '最后使用', key: 'lastUsed', dataIndex: 'lastUsed', width: '180px' },
  { title: '操作', key: 'actions', width: '100px', fixed: 'right' },
]

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
    message.error('加载 WebAuthn 凭证失败: ' + e.message)
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
  if (!name) { message.warning('请输入凭证名称'); return }
  registering.value = true
  try {
    const escapedName = name.replace(/"/g, '\\"')
    const { output } = await ws.execute(`webauthn register --name "${escapedName}" --json`, 30000)
    if (output.includes('error') || output.includes('失败')) {
      message.error('注册失败: ' + output.slice(0, 120))
    } else {
      message.success('WebAuthn 凭证已注册')
      showRegisterModal.value = false
      newCredentialName.value = ''
      await loadCredentials()
    }
  } catch (e) {
    message.error('注册失败: ' + e.message)
  } finally {
    registering.value = false
  }
}

async function deleteCredential(record) {
  try {
    const { output } = await ws.execute(`webauthn delete "${record.id}"`, 15000)
    if (output.includes('error') || output.includes('失败')) {
      message.error('删除失败: ' + output.slice(0, 120))
    } else {
      message.success('凭证已删除')
      await loadCredentials()
    }
  } catch (e) {
    message.error('删除失败: ' + e.message)
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
const ssoStats = ref([])

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
      // Fallback: parse text output
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
    ssoStats.value = [
      { label: '提供商', value: ssoConfig.value.provider || '未配置', color: ssoConfig.value.provider ? '#1677ff' : '#999' },
      { label: '状态', value: ssoConfig.value.enabled ? '已启用' : '未启用', color: ssoConfig.value.enabled ? '#52c41a' : '#faad14' },
    ]
    ssoLoaded.value = true
  } catch (e) {
    ssoConfig.value = { provider: '', clientId: '', redirectUrl: '', enabled: false }
    ssoStats.value = [
      { label: '提供商', value: '未配置', color: '#999' },
      { label: '状态', value: '未启用', color: '#faad14' },
    ]
    ssoLoaded.value = true
  } finally {
    ssoLoading.value = false
  }
}

async function saveSsoConfig() {
  if (!ssoForm.value.provider) { message.warning('请选择 SSO 提供商'); return }
  if (!ssoForm.value.clientId.trim()) { message.warning('请输入 Client ID'); return }
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
    message.success('SSO 配置已保存')
    showSsoModal.value = false
    await loadSsoStatus()
  } catch (e) {
    message.error('保存失败: ' + e.message)
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
      message.error('启用失败: ' + output.slice(0, 120))
    } else {
      const parsed = tryParseJSON(output)
      if (parsed && parsed.secret) {
        totpResult.value = `TOTP Secret: ${parsed.secret}\nOTP Auth URL: ${parsed.otpAuthUrl || parsed.uri || ''}`
      } else {
        totpResult.value = output
      }
      tfaEnabled.value = true
      message.success('TOTP 已启用')
    }
  } catch (e) {
    message.error('启用失败: ' + e.message)
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
      message.error('禁用失败: ' + output.slice(0, 120))
    } else {
      tfaEnabled.value = false
      message.success('双因素认证已禁用')
    }
  } catch (e) {
    message.error('禁用失败: ' + e.message)
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
      // Parse text: one code per line
      const codes = output.split('\n')
        .map((l) => l.trim())
        .filter((l) => l && /^[A-Za-z0-9-]{6,}$/.test(l))
      recoveryCodes.value = codes.length > 0 ? codes : [output.trim() || '无法生成恢复码']
    }
    if (recoveryCodes.value.length > 0 && recoveryCodes.value[0] !== '无法生成恢复码') {
      message.success('恢复码已生成')
    }
  } catch (e) {
    message.error('生成恢复码失败: ' + e.message)
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
