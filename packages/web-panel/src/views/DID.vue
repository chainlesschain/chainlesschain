<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ $t('did.title') }}</h2>
        <p class="page-sub">{{ $t('did.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadList">
          <template #icon><ReloadOutlined /></template>
          {{ $t('did.refresh') }}
        </a-button>
        <a-button type="primary" @click="showCreateModal = true">
          <template #icon><PlusOutlined /></template>
          {{ $t('did.create') }}
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('did.stats.count')"
            :value="identities.length"
            :value-style="{ color: '#1677ff', fontSize: '20px' }"
          >
            <template #prefix><IdcardOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('did.stats.default')"
            :value="defaultIdentityDisplay"
            :value-style="{ color: defaultIdentityDisplay !== $t('did.stats.unsetDefault') ? '#52c41a' : '#888', fontSize: '13px', fontFamily: 'monospace' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('did.stats.method')"
            :value="methodDisplay"
            :value-style="{ color: '#722ed1', fontSize: '14px' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('did.stats.signable')"
            :value="identities.length > 0 ? $t('did.stats.yes') : $t('did.stats.no')"
            :value-style="{ color: identities.length > 0 ? '#52c41a' : '#ff4d4f', fontSize: '20px' }"
          >
            <template #prefix><KeyOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <a-alert
      v-if="!hasDesktopFeatures"
      :message="$t('did.webOnly.message')"
      :description="$t('did.webOnly.description')"
      type="info"
      show-icon
      closable
      style="margin-bottom: 16px;"
    />

    <div v-if="loading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
    <a-table
      v-else
      :columns="columns"
      :data-source="identities"
      :pagination="{ pageSize: 20, showTotal: (t) => $t('did.table.totalSuffix', { n: t }) }"
      size="small"
      style="background: var(--bg-card);"
      :row-class-name="() => 'did-row'"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'did'">
          <span style="color: #e0e0e0; font-family: monospace; font-size: 12px;">{{ record.did }}</span>
        </template>
        <template v-if="column.key === 'displayName'">
          <span style="color: var(--text-primary);">{{ record.displayName || '-' }}</span>
        </template>
        <template v-if="column.key === 'method'">
          <a-tag color="blue">{{ record.method }}</a-tag>
        </template>
        <template v-if="column.key === 'createdAt'">
          <span style="color: var(--text-secondary); font-size: 12px;">{{ record.createdAt || '-' }}</span>
        </template>
        <template v-if="column.key === 'isDefault'">
          <a-tag :color="record.isDefault ? 'green' : 'default'">
            {{ record.isDefault ? $t('did.table.defaultTag') : '-' }}
          </a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-space size="small">
            <a-button size="small" type="link" @click="openShow(record)">
              {{ $t('did.actions.details') }}
            </a-button>
            <a-button size="small" type="link" @click="openSign(record)">
              {{ $t('did.actions.sign') }}
            </a-button>
            <a-tooltip title="MTC 包含证明">
              <a-button size="small" type="link" @click="openMtcVerify(record)">
                <SafetyOutlined />
              </a-button>
            </a-tooltip>
            <a-button
              v-if="!record.isDefault"
              size="small"
              type="link"
              :loading="settingDefault === record.did"
              @click="setDefault(record)"
            >
              {{ $t('did.actions.setDefault') }}
            </a-button>
            <a-popconfirm
              :title="$t('did.deleteConfirm.title')"
              :ok-text="$t('did.deleteConfirm.ok')"
              ok-type="danger"
              :cancel-text="$t('did.deleteConfirm.cancel')"
              @confirm="deleteIdentity(record)"
            >
              <a-button size="small" type="link" danger :loading="deleting === record.did">
                {{ $t('did.actions.delete') }}
              </a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
      <template #emptyText>
        <a-empty :description="$t('did.table.empty')" />
      </template>
    </a-table>

    <!-- Create Modal -->
    <a-modal
      v-model:open="showCreateModal"
      :title="$t('did.create_modal.title')"
      :confirm-loading="creating"
      @ok="createIdentity"
      :ok-text="$t('did.create_modal.ok')"
      :cancel-text="$t('did.create_modal.cancel')"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
        <a-form-item :label="$t('did.create_modal.nameLabel')">
          <a-input v-model:value="newIdentityName" :placeholder="$t('did.create_modal.namePlaceholder')" allow-clear />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Show Details Modal -->
    <a-modal
      v-model:open="showDetailsModal"
      :title="$t('did.details.title', { label: currentIdentity?.displayName || currentIdentity?.did?.slice(0, 24) || '' })"
      :width="720"
      :footer="null"
    >
      <div v-if="currentIdentity" style="margin-top: 12px;">
        <a-descriptions :column="1" bordered size="small">
          <a-descriptions-item :label="$t('did.details.did')">
            <span style="font-family: monospace; color: #ccc; word-break: break-all;">{{ currentIdentity.did }}</span>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('did.details.name')">{{ currentIdentity.displayName || '-' }}</a-descriptions-item>
          <a-descriptions-item :label="$t('did.details.method')"><a-tag color="blue">{{ currentIdentity.method }}</a-tag></a-descriptions-item>
          <a-descriptions-item :label="$t('did.details.default')">
            <a-tag :color="currentIdentity.isDefault ? 'green' : 'default'">
              {{ currentIdentity.isDefault ? $t('did.details.yes') : $t('did.details.no') }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('did.details.createdAt')">{{ currentIdentity.createdAt || '-' }}</a-descriptions-item>
          <a-descriptions-item :label="$t('did.details.publicKey')">
            <span style="font-family: monospace; color: #888; font-size: 11px; word-break: break-all;">
              {{ currentIdentity.publicKey || $t('did.details.publicKeyLoading') }}
            </span>
          </a-descriptions-item>
        </a-descriptions>

        <div style="margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap;">
          <a-button :loading="loadingDocument" @click="loadDocument(currentIdentity)">
            <template #icon><FileTextOutlined /></template>
            {{ $t('did.details.viewDoc') }}
          </a-button>
        </div>

        <div v-if="currentDocument" style="margin-top: 16px;">
          <p style="color: var(--text-secondary); margin-bottom: 6px;">{{ $t('did.details.docHeader') }}</p>
          <pre style="white-space: pre-wrap; word-break: break-all; color: #52c41a; font-size: 11px; background: var(--bg-base); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color); max-height: 320px; overflow: auto;">{{ currentDocument }}</pre>
        </div>
      </div>
    </a-modal>

    <!-- Sign Modal -->
    <a-modal
      v-model:open="showSignModal"
      :title="$t('did.sign_modal.title', { label: signTargetDid?.slice(0, 28) || $t('did.sign_modal.defaultIdentityFallback') })"
      :confirm-loading="signing"
      @ok="signMessage"
      :ok-text="$t('did.sign_modal.ok')"
      :cancel-text="$t('did.sign_modal.cancel')"
    >
      <a-form :label-col="{ span: 4 }" :wrapper-col="{ span: 20 }" style="margin-top: 16px;">
        <a-form-item :label="$t('did.sign_modal.messageLabel')" required>
          <a-textarea v-model:value="signText" :placeholder="$t('did.sign_modal.messagePlaceholder')" :auto-size="{ minRows: 3, maxRows: 8 }" />
        </a-form-item>
      </a-form>
      <div v-if="signResult" style="margin-top: 12px;">
        <p style="color: var(--text-secondary); margin-bottom: 6px;">{{ $t('did.sign_modal.resultHeader') }}</p>
        <pre style="white-space: pre-wrap; word-break: break-all; color: #52c41a; font-size: 11px; background: var(--bg-base); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color);">{{ signResult.signature }}</pre>
      </div>
    </a-modal>

    <!-- MTC inclusion proof drawer -->
    <MtcVerifyDrawer
      v-model:open="mtcDrawerOpen"
      :title="mtcDrawerTitle"
      :hint="mtcDrawerHint"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  ReloadOutlined,
  PlusOutlined,
  IdcardOutlined,
  KeyOutlined,
  FileTextOutlined,
  SafetyOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useI18n } from 'vue-i18n'
import { useWsStore } from '../stores/ws.js'
import { parseDidList, parseDidShow, parseSignResult } from '../utils/did-parser.js'
import MtcVerifyDrawer from '../components/MtcVerifyDrawer.vue'

const ws = useWsStore()
const { t } = useI18n()

const hasDesktopFeatures = ref(false)
const loading = ref(false)
const creating = ref(false)
const signing = ref(false)
const settingDefault = ref('')
const deleting = ref('')
const loadingDocument = ref(false)

const identities = ref([])

const showCreateModal = ref(false)
const showDetailsModal = ref(false)
const showSignModal = ref(false)
const newIdentityName = ref('')
const currentIdentity = ref(null)
const currentDocument = ref('')
const signTargetDid = ref('')
const signText = ref('')
const signResult = ref(null)

const columns = computed(() => [
  { title: t('did.cols.did'), key: 'did', dataIndex: 'did', ellipsis: true },
  { title: t('did.cols.name'), key: 'displayName', dataIndex: 'displayName', width: '160px' },
  { title: t('did.cols.method'), key: 'method', dataIndex: 'method', width: '110px' },
  { title: t('did.cols.createdAt'), key: 'createdAt', dataIndex: 'createdAt', width: '180px' },
  { title: t('did.cols.default'), key: 'isDefault', width: '90px' },
  { title: t('did.cols.action'), key: 'action', width: '280px' },
])

const defaultIdentityDisplay = computed(() => {
  const def = identities.value.find(i => i.isDefault)
  if (!def) return t('did.stats.unsetDefault')
  const did = def.did
  return did.length > 24 ? did.slice(0, 12) + '...' + did.slice(-8) : did
})

const methodDisplay = computed(() => {
  const methods = new Set(identities.value.map(i => i.method).filter(Boolean))
  if (methods.size === 0) return t('did.stats.noMethod')
  if (methods.size === 1) return [...methods][0]
  return [...methods].join(', ')
})

async function loadList() {
  loading.value = true
  try {
    const { output } = await ws.execute('did list --json', 15000)
    identities.value = parseDidList(output)
  } catch (e) {
    message.error(t('did.msg.loadFailed') + ': ' + e.message)
    identities.value = []
  } finally {
    loading.value = false
  }
}

async function createIdentity() {
  creating.value = true
  try {
    const name = newIdentityName.value.trim()
    const cmd = name
      ? `did create --name "${name.replace(/"/g, '\\"')}" --json`
      : 'did create --json'
    const { output } = await ws.execute(cmd, 20000)
    if (/error|失败/i.test(output) && !output.includes('"did"')) {
      message.error(t('did.msg.createFailed') + ': ' + output.slice(0, 120))
    } else {
      message.success(t('did.msg.createSuccess'))
      showCreateModal.value = false
      newIdentityName.value = ''
      await loadList()
    }
  } catch (e) {
    message.error(t('did.msg.createFailed') + ': ' + e.message)
  } finally {
    creating.value = false
  }
}

async function setDefault(record) {
  settingDefault.value = record.did
  try {
    const { output, exitCode } = await ws.execute(`did set-default ${record.did}`, 15000)
    if (exitCode !== 0 || /error|not found|失败/i.test(output)) {
      message.error(t('did.msg.setDefaultFailed') + ': ' + output.slice(0, 120))
    } else {
      message.success(t('did.msg.setDefaultSuccess'))
      await loadList()
    }
  } catch (e) {
    message.error(t('did.msg.setDefaultFailed') + ': ' + e.message)
  } finally {
    settingDefault.value = ''
  }
}

async function deleteIdentity(record) {
  deleting.value = record.did
  try {
    const { output, exitCode } = await ws.execute(`did delete ${record.did} --force`, 15000)
    if (exitCode !== 0 || /error|not found|失败/i.test(output)) {
      message.error(t('did.msg.deleteFailed') + ': ' + output.slice(0, 120))
    } else {
      message.success(t('did.msg.deleteSuccess'))
      await loadList()
    }
  } catch (e) {
    message.error(t('did.msg.deleteFailed') + ': ' + e.message)
  } finally {
    deleting.value = ''
  }
}

async function openShow(record) {
  currentIdentity.value = { ...record }
  currentDocument.value = ''
  showDetailsModal.value = true
  if (!record.publicKey) {
    try {
      const { output } = await ws.execute(`did show ${record.did} --json`, 10000)
      const detail = parseDidShow(output)
      if (detail) {
        currentIdentity.value = { ...currentIdentity.value, ...detail }
      }
    } catch {
      /* keep summary fields visible even when show fails */
    }
  }
}

async function loadDocument(record) {
  loadingDocument.value = true
  try {
    const { output } = await ws.execute(`did resolve ${record.did}`, 10000)
    try {
      currentDocument.value = JSON.stringify(JSON.parse(output.trim()), null, 2)
    } catch {
      currentDocument.value = output.trim()
    }
  } catch (e) {
    message.error(t('did.msg.loadDocFailed') + ': ' + e.message)
  } finally {
    loadingDocument.value = false
  }
}

function openSign(record) {
  signTargetDid.value = record.did
  signText.value = ''
  signResult.value = null
  showSignModal.value = true
}

// MTC inclusion proof drawer ─────────────────────────────────────────────
const mtcDrawerOpen = ref(false)
const mtcDrawerTitle = ref('MTC 包含证明')
const mtcDrawerHint = ref('')

function shortDid(did) {
  if (!did) return ''
  return did.length <= 24 ? did : `${did.slice(0, 16)}…${did.slice(-6)}`
}

function openMtcVerify(record) {
  mtcDrawerTitle.value = `MTC 包含证明 · ${shortDid(record.did)}`
  mtcDrawerHint.value =
    `验证此 DID 是否在某个 MTC 批次中。请提供该批次的 envelope（其 leaf.subject 应等于此 DID）和 landmark 文件路径。` +
    ` 通常由 cc mtc batch-dids --out <dir> 生成。`
  mtcDrawerOpen.value = true
}

async function signMessage() {
  if (!signText.value.trim()) {
    message.warning(t('did.msg.signEmpty'))
    return
  }
  signing.value = true
  signResult.value = null
  try {
    const escapedMsg = signText.value.replace(/"/g, '\\"')
    const cmd = `did sign "${escapedMsg}" --did ${signTargetDid.value} --json`
    const { output, exitCode } = await ws.execute(cmd, 15000)
    const parsed = parseSignResult(output)
    if (parsed && parsed.signature) {
      signResult.value = parsed
      message.success(t('did.msg.signSuccess'))
    } else {
      message.error(t('did.msg.signFailed') + ': ' + (output || `exit ${exitCode}`).slice(0, 120))
    }
  } catch (e) {
    message.error(t('did.msg.signFailed') + ': ' + e.message)
  } finally {
    signing.value = false
  }
}

onMounted(() => {
  loadList()
})
</script>

<style scoped>
:deep(.did-row:hover td) { background: var(--bg-card-hover) !important; }
:deep(.ant-card-head) { border-color: var(--border-color) !important; color: var(--text-primary) !important; }
</style>
