<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('wallet.title') }}</h2>
        <p class="page-sub">{{ t('wallet.subtitle') }}</p>
      </div>
      <a-button type="primary" ghost :loading="refreshing" @click="refreshCurrentTab">
        <template #icon><ReloadOutlined /></template>
        {{ t('wallet.refresh') }}
      </a-button>
    </div>

    <!-- Stats Cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('wallet.stats.walletCount')"
            :value="wallets.length"
            :value-style="{ color: '#1677ff', fontSize: '20px' }"
          >
            <template #prefix><WalletOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('wallet.stats.assetCount')"
            :value="assets.length"
            :value-style="{ color: '#52c41a', fontSize: '20px' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('wallet.stats.defaultWallet')"
            :value="defaultWalletDisplay"
            :value-style="{ color: defaultWalletDisplay !== t('wallet.stats.defaultUnset') ? '#faad14' : '#888', fontSize: '14px', fontFamily: 'monospace' }"
          >
            <template #prefix><WalletOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('wallet.stats.totalTx')"
            :value="txHistory.length"
            :value-style="{ color: '#ff4d4f', fontSize: '20px' }"
          >
            <template #prefix><SwapOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <a-tabs v-model:activeKey="activeTab" type="card" @change="onTabChange">
      <!-- Tab 1: Wallet List -->
      <a-tab-pane key="wallets">
        <template #tab>
          <WalletOutlined /> {{ t('wallet.tabs.wallets') }}
        </template>

        <a-space style="margin-bottom: 16px;">
          <a-button type="primary" :loading="walletsLoading" @click="loadWallets">
            <template #icon><ReloadOutlined /></template>
            {{ t('wallet.wallets.refreshList') }}
          </a-button>
          <a-button @click="showCreateModal = true">
            <template #icon><PlusOutlined /></template>
            {{ t('wallet.wallets.createButton') }}
          </a-button>
        </a-space>

        <div v-if="walletsLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <a-table
          v-else
          :columns="walletColumns"
          :data-source="wallets"
          :pagination="{ pageSize: 20, showTotal: (count) => t('wallet.totals.rows', { count }) }"
          size="small"
          style="background: var(--bg-card);"
          :row-class-name="() => 'wallet-row'"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'address'">
              <span style="color: #e0e0e0; font-family: monospace; font-size: 12px;">{{ record.address }}</span>
            </template>
            <template v-if="column.key === 'name'">
              <span style="color: var(--text-primary);">{{ record.name || '-' }}</span>
            </template>
            <template v-if="column.key === 'isDefault'">
              <a-tag :color="record.isDefault ? 'green' : 'default'">
                {{ record.isDefault ? t('wallet.wallets.default') : '-' }}
              </a-tag>
            </template>
            <template v-if="column.key === 'balance'">
              <span style="color: #52c41a; font-family: monospace;">{{ record.balance ?? '-' }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button
                v-if="!record.isDefault"
                size="small"
                type="link"
                :loading="settingDefault === record.address"
                @click="setDefault(record.address)"
              >
                {{ t('wallet.wallets.setDefault') }}
              </a-button>
              <span v-else style="color: var(--text-muted); font-size: 12px;">{{ t('wallet.wallets.currentDefault') }}</span>
            </template>
          </template>
          <template #emptyText>
            <a-empty :description="t('wallet.wallets.emptyText')" />
          </template>
        </a-table>

        <!-- Create Wallet Modal -->
        <a-modal
          v-model:open="showCreateModal"
          :title="t('wallet.wallets.createTitle')"
          :confirm-loading="creating"
          @ok="createWallet"
          :ok-text="t('wallet.wallets.createOk')"
          :cancel-text="t('common.cancel')"
        >
          <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
            <a-form-item :label="t('wallet.wallets.nameLabel')" required>
              <a-input v-model:value="newWalletName" :placeholder="t('wallet.wallets.namePlaceholder')" />
            </a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>

      <!-- Tab 2: Assets -->
      <a-tab-pane key="assets">
        <template #tab>
          <WalletOutlined /> {{ t('wallet.tabs.assets') }}
        </template>

        <a-space style="margin-bottom: 16px;">
          <a-button type="primary" :loading="assetsLoading" @click="loadAssets">
            <template #icon><ReloadOutlined /></template>
            {{ t('wallet.assets.refreshAssets') }}
          </a-button>
          <a-button @click="showAssetModal = true">
            <template #icon><PlusOutlined /></template>
            {{ t('wallet.assets.registerButton') }}
          </a-button>
        </a-space>

        <div v-if="assetsLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <a-table
          v-else
          :columns="assetColumns"
          :data-source="assets"
          :pagination="{ pageSize: 20, showTotal: (count) => t('wallet.totals.rows', { count }) }"
          size="small"
          style="background: var(--bg-card);"
          :row-class-name="() => 'wallet-row'"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">
              <span style="color: #e0e0e0;">{{ record.name }}</span>
            </template>
            <template v-if="column.key === 'type'">
              <a-tag :color="assetTypeColor(record.type)">{{ record.type }}</a-tag>
            </template>
            <template v-if="column.key === 'description'">
              <span style="color: var(--text-secondary); font-size: 12px;">{{ record.description || '-' }}</span>
            </template>
            <template v-if="column.key === 'address'">
              <span style="color: var(--text-muted); font-family: monospace; font-size: 12px;">{{ record.address || '-' }}</span>
            </template>
          </template>
          <template #emptyText>
            <a-empty :description="t('wallet.assets.emptyText')" />
          </template>
        </a-table>

        <!-- Register Asset Modal -->
        <a-modal
          v-model:open="showAssetModal"
          :title="t('wallet.assets.registerTitle')"
          :confirm-loading="registering"
          @ok="registerAsset"
          :ok-text="t('wallet.assets.registerOk')"
          :cancel-text="t('common.cancel')"
        >
          <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
            <a-form-item :label="t('wallet.assets.nameLabel')" required>
              <a-input v-model:value="newAsset.name" :placeholder="t('wallet.assets.namePlaceholder')" />
            </a-form-item>
            <a-form-item :label="t('wallet.assets.typeLabel')" required>
              <a-select v-model:value="newAsset.type" :placeholder="t('wallet.assets.typePlaceholder')">
                <a-select-option value="token">Token</a-select-option>
                <a-select-option value="nft">NFT</a-select-option>
                <a-select-option value="data">Data</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item :label="t('wallet.assets.descLabel')">
              <a-input v-model:value="newAsset.description" :placeholder="t('wallet.assets.descPlaceholder')" />
            </a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>

      <!-- Tab 3: Transfer -->
      <a-tab-pane key="transfer">
        <template #tab>
          <SendOutlined /> {{ t('wallet.tabs.transfer') }}
        </template>

        <a-row :gutter="[24, 24]">
          <a-col :xs="24" :md="12">
            <a-card :title="t('wallet.transfer.formCardTitle')" style="background: var(--bg-card); border-color: var(--border-color);">
              <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
                <a-form-item :label="t('wallet.transfer.assetIdLabel')" required>
                  <a-input v-model:value="transferForm.assetId" :placeholder="t('wallet.transfer.assetIdPlaceholder')" />
                </a-form-item>
                <a-form-item :label="t('wallet.transfer.toAddressLabel')" required>
                  <a-input v-model:value="transferForm.toAddress" :placeholder="t('wallet.transfer.toAddressPlaceholder')" />
                </a-form-item>
                <a-form-item :label="t('wallet.transfer.amountLabel')" required>
                  <a-input-number
                    v-model:value="transferForm.amount"
                    :min="0"
                    :step="0.01"
                    :placeholder="t('wallet.transfer.amountPlaceholder')"
                    style="width: 100%;"
                  />
                </a-form-item>
                <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
                  <a-button
                    type="primary"
                    :loading="transferring"
                    :disabled="!transferForm.assetId.trim() || !transferForm.toAddress.trim() || !transferForm.amount"
                    @click="confirmTransfer"
                  >
                    <template #icon><SendOutlined /></template>
                    {{ t('wallet.transfer.submitButton') }}
                  </a-button>
                </a-form-item>
              </a-form>
              <div v-if="transferResult" style="margin-top: 8px;">
                <a-tag :color="transferResult.success ? 'green' : 'red'">
                  {{ transferResult.success ? t('wallet.transfer.successTag') : t('wallet.transfer.failureTag') }}
                </a-tag>
                <pre style="white-space: pre-wrap; word-break: break-all; color: var(--text-secondary); font-size: 11px; margin-top: 8px; background: var(--bg-base); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">{{ transferResult.output }}</pre>
              </div>
            </a-card>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-card :title="t('wallet.transfer.historyCardTitle')" style="background: var(--bg-card); border-color: var(--border-color);">
              <template #extra>
                <a-button size="small" :loading="historyLoading" @click="loadHistory">
                  <template #icon><ReloadOutlined /></template>
                </a-button>
              </template>
              <div v-if="historyLoading" style="text-align: center; padding: 30px;"><a-spin /></div>
              <a-table
                v-else
                :columns="historyColumns"
                :data-source="txHistory"
                :pagination="{ pageSize: 10, showTotal: (count) => t('wallet.totals.rows', { count }), size: 'small' }"
                size="small"
                :row-class-name="() => 'wallet-row'"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'time'">
                    <span style="color: var(--text-secondary); font-size: 12px; font-family: monospace;">{{ record.time }}</span>
                  </template>
                  <template v-if="column.key === 'type'">
                    <a-tag :color="record.type === 'send' ? 'orange' : 'green'">{{ record.type }}</a-tag>
                  </template>
                  <template v-if="column.key === 'amount'">
                    <span style="color: #e0e0e0; font-family: monospace;">{{ record.amount }}</span>
                  </template>
                  <template v-if="column.key === 'to'">
                    <span style="color: var(--text-muted); font-family: monospace; font-size: 11px;">{{ record.to }}</span>
                  </template>
                </template>
                <template #emptyText>
                  <a-empty :description="t('wallet.transfer.historyEmpty')" />
                </template>
              </a-table>
            </a-card>
          </a-col>
        </a-row>

        <!-- Transfer Confirmation Modal -->
        <a-modal
          v-model:open="showTransferConfirm"
          :title="t('wallet.transfer.confirmTitle')"
          :confirm-loading="transferring"
          @ok="doTransfer"
          :ok-text="t('wallet.transfer.confirmOk')"
          :cancel-text="t('common.cancel')"
          ok-type="primary"
        >
          <div style="margin-top: 16px;">
            <p style="color: var(--text-primary);">{{ t('wallet.transfer.confirmIntro') }}</p>
            <a-descriptions :column="1" bordered size="small" style="margin-top: 12px;">
              <a-descriptions-item :label="t('wallet.transfer.assetIdLabel')">
                <span style="font-family: monospace; color: #ccc;">{{ transferForm.assetId }}</span>
              </a-descriptions-item>
              <a-descriptions-item :label="t('wallet.transfer.toAddressLabel')">
                <span style="font-family: monospace; color: #ccc;">{{ transferForm.toAddress }}</span>
              </a-descriptions-item>
              <a-descriptions-item :label="t('wallet.transfer.amountLabel')">
                <span style="font-family: monospace; color: #52c41a;">{{ transferForm.amount }}</span>
              </a-descriptions-item>
            </a-descriptions>
          </div>
        </a-modal>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  WalletOutlined,
  SwapOutlined,
  ReloadOutlined,
  PlusOutlined,
  SendOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'

const { t } = useI18n()
const ws = useWsStore()

// --- Shared ---
const activeTab = ref('wallets')
const refreshing = ref(false)

function tryParseJson(output) {
  try { return JSON.parse(output) } catch { return null }
}

async function refreshCurrentTab() {
  refreshing.value = true
  try {
    if (activeTab.value === 'wallets') await loadWallets()
    else if (activeTab.value === 'assets') await loadAssets()
    else if (activeTab.value === 'transfer') await loadHistory()
  } finally {
    refreshing.value = false
  }
}

function onTabChange(key) {
  if (key === 'assets' && assets.value.length === 0) loadAssets()
  if (key === 'transfer' && txHistory.value.length === 0) loadHistory()
}

// --- Tab 1: Wallet List ---
const walletsLoading = ref(false)
const creating = ref(false)
const settingDefault = ref('')
const wallets = ref([])
const showCreateModal = ref(false)
const newWalletName = ref('')

const walletColumns = computed(() => [
  { title: t('wallet.walletColumns.address'), key: 'address', dataIndex: 'address', ellipsis: true },
  { title: t('wallet.walletColumns.name'), key: 'name', dataIndex: 'name', width: '150px' },
  { title: t('wallet.walletColumns.isDefault'), key: 'isDefault', width: '80px' },
  { title: t('wallet.walletColumns.balance'), key: 'balance', dataIndex: 'balance', width: '120px' },
  { title: t('wallet.walletColumns.action'), key: 'action', width: '100px' },
])

const defaultWalletDisplay = computed(() => {
  const def = wallets.value.find(w => w.isDefault)
  if (!def || !def.address) return t('wallet.stats.defaultUnset')
  const addr = def.address
  if (addr.length > 16) return addr.slice(0, 8) + '...' + addr.slice(-6)
  return addr
})

async function loadWallets() {
  walletsLoading.value = true
  try {
    const { output } = await ws.execute('wallet list --json', 15000)
    const parsed = tryParseJson(output)
    if (parsed && Array.isArray(parsed)) {
      wallets.value = parsed.map((w, i) => ({
        key: w.address || w.id || i,
        address: w.address || w.id || '-',
        name: w.name || w.label || '-',
        isDefault: w.isDefault || w.default || false,
        balance: w.balance ?? '-',
      }))
    } else if (parsed && parsed.wallets && Array.isArray(parsed.wallets)) {
      wallets.value = parsed.wallets.map((w, i) => ({
        key: w.address || w.id || i,
        address: w.address || w.id || '-',
        name: w.name || w.label || '-',
        isDefault: w.isDefault || w.default || false,
        balance: w.balance ?? '-',
      }))
    } else {
      wallets.value = parseWalletListText(output)
    }
  } catch (e) {
    message.error(t('wallet.messages.loadWalletsFailed', { err: e.message }))
  } finally {
    walletsLoading.value = false
  }
}

function parseWalletListText(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.match(/^\d+ wallet/i)) continue
    const addrMatch = trimmed.match(/(0x[a-fA-F0-9]{8,})/)
    if (addrMatch) {
      const isDefault = /default|默认|\*/.test(trimmed)
      const nameMatch = trimmed.match(/name[:\s]+(\S+)/i)
      result.push({
        key: addrMatch[1],
        address: addrMatch[1],
        name: nameMatch ? nameMatch[1] : '-',
        isDefault,
        balance: '-',
      })
    }
  }
  return result
}

async function createWallet() {
  if (!newWalletName.value.trim()) { message.warning(t('wallet.messages.walletNameRequired')); return }
  creating.value = true
  try {
    const { output } = await ws.execute(`wallet create --name "${newWalletName.value.trim()}" --json`, 20000)
    if (output.includes('error') || output.includes('失败')) {
      message.error(t('wallet.messages.walletCreateFailed', { err: output.slice(0, 120) }))
    } else {
      message.success(t('wallet.messages.walletCreateOk'))
      showCreateModal.value = false
      newWalletName.value = ''
      await loadWallets()
    }
  } catch (e) {
    message.error(t('wallet.messages.walletCreateFailed', { err: e.message }))
  } finally {
    creating.value = false
  }
}

async function setDefault(address) {
  settingDefault.value = address
  try {
    const { output } = await ws.execute(`wallet set-default ${address}`, 15000)
    if (output.includes('error') || output.includes('失败')) {
      message.error(t('wallet.messages.setDefaultFailed', { err: output.slice(0, 120) }))
    } else {
      message.success(t('wallet.messages.setDefaultOk'))
      await loadWallets()
    }
  } catch (e) {
    message.error(t('wallet.messages.setDefaultFailed', { err: e.message }))
  } finally {
    settingDefault.value = ''
  }
}

// --- Tab 2: Assets ---
const assetsLoading = ref(false)
const registering = ref(false)
const assets = ref([])
const showAssetModal = ref(false)
const newAsset = reactive({ name: '', type: 'token', description: '' })

const assetColumns = computed(() => [
  { title: t('wallet.assetColumns.name'), key: 'name', dataIndex: 'name', width: '180px' },
  { title: t('wallet.assetColumns.type'), key: 'type', dataIndex: 'type', width: '100px' },
  { title: t('wallet.assetColumns.description'), key: 'description', dataIndex: 'description', ellipsis: true },
  { title: t('wallet.assetColumns.address'), key: 'address', dataIndex: 'address', ellipsis: true },
])

function assetTypeColor(type) {
  const map = { token: 'blue', nft: 'purple', data: 'cyan' }
  return map[(type || '').toLowerCase()] || 'default'
}

async function loadAssets() {
  assetsLoading.value = true
  try {
    const { output } = await ws.execute('wallet assets --json', 15000)
    const parsed = tryParseJson(output)
    if (parsed && Array.isArray(parsed)) {
      assets.value = parsed.map((a, i) => ({
        key: a.id || a.address || i,
        name: a.name || '-',
        type: a.type || '-',
        description: a.description || '',
        address: a.address || a.id || '-',
      }))
    } else if (parsed && parsed.assets && Array.isArray(parsed.assets)) {
      assets.value = parsed.assets.map((a, i) => ({
        key: a.id || a.address || i,
        name: a.name || '-',
        type: a.type || '-',
        description: a.description || '',
        address: a.address || a.id || '-',
      }))
    } else {
      assets.value = parseAssetsText(output)
    }
  } catch (e) {
    message.error(t('wallet.messages.loadAssetsFailed', { err: e.message }))
  } finally {
    assetsLoading.value = false
  }
}

function parseAssetsText(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.match(/^\d+ asset/i)) continue
    const parts = trimmed.split(/\s*[|│]\s*/)
    if (parts.length >= 2) {
      result.push({
        key: result.length,
        name: parts[0] || '-',
        type: parts[1] || '-',
        description: parts[2] || '',
        address: parts[3] || '-',
      })
    }
  }
  return result
}

async function registerAsset() {
  if (!newAsset.name.trim()) { message.warning(t('wallet.messages.assetNameRequired')); return }
  registering.value = true
  try {
    let cmd = `wallet asset "${newAsset.name.trim()}" --type ${newAsset.type}`
    if (newAsset.description.trim()) {
      cmd += ` --description "${newAsset.description.trim().replace(/"/g, '\\"')}"`
    }
    cmd += ' --json'
    const { output } = await ws.execute(cmd, 20000)
    if (output.includes('error') || output.includes('失败')) {
      message.error(t('wallet.messages.assetRegisterFailed', { err: output.slice(0, 120) }))
    } else {
      message.success(t('wallet.messages.assetRegisterOk'))
      showAssetModal.value = false
      newAsset.name = ''
      newAsset.type = 'token'
      newAsset.description = ''
      await loadAssets()
    }
  } catch (e) {
    message.error(t('wallet.messages.assetRegisterFailed', { err: e.message }))
  } finally {
    registering.value = false
  }
}

// --- Tab 3: Transfer ---
const transferring = ref(false)
const historyLoading = ref(false)
const showTransferConfirm = ref(false)
const transferResult = ref(null)
const txHistory = ref([])
const transferForm = reactive({ assetId: '', toAddress: '', amount: null })

const historyColumns = computed(() => [
  { title: t('wallet.historyColumns.time'), key: 'time', dataIndex: 'time', width: '150px' },
  { title: t('wallet.historyColumns.type'), key: 'type', dataIndex: 'type', width: '80px' },
  { title: t('wallet.historyColumns.amount'), key: 'amount', dataIndex: 'amount', width: '100px' },
  { title: t('wallet.historyColumns.to'), key: 'to', dataIndex: 'to', ellipsis: true },
])

function confirmTransfer() {
  if (!transferForm.assetId.trim() || !transferForm.toAddress.trim() || !transferForm.amount) {
    message.warning(t('wallet.messages.transferIncomplete'))
    return
  }
  showTransferConfirm.value = true
}

async function doTransfer() {
  transferring.value = true
  transferResult.value = null
  try {
    const cmd = `wallet transfer ${transferForm.assetId.trim()} ${transferForm.toAddress.trim()} --amount ${transferForm.amount}`
    const { output, exitCode } = await ws.execute(cmd, 30000)
    transferResult.value = {
      success: exitCode === 0 && !output.includes('error') && !output.includes('失败'),
      output: output || t('wallet.messages.transferDefault'),
    }
    if (transferResult.value.success) {
      message.success(t('wallet.messages.transferOk'))
      showTransferConfirm.value = false
      await loadHistory()
    } else {
      showTransferConfirm.value = false
    }
  } catch (e) {
    transferResult.value = { success: false, output: t('wallet.messages.transferFailed', { err: e.message }) }
    showTransferConfirm.value = false
  } finally {
    transferring.value = false
  }
}

async function loadHistory() {
  historyLoading.value = true
  try {
    const { output } = await ws.execute('wallet history --limit 20 --json', 15000)
    const parsed = tryParseJson(output)
    if (parsed && Array.isArray(parsed)) {
      txHistory.value = parsed.map((tx, i) => ({
        key: tx.id || tx.hash || i,
        time: tx.time || tx.timestamp || tx.createdAt || '-',
        type: tx.type || tx.direction || '-',
        amount: tx.amount ?? '-',
        to: tx.to || tx.recipient || '-',
      }))
    } else if (parsed && parsed.history && Array.isArray(parsed.history)) {
      txHistory.value = parsed.history.map((tx, i) => ({
        key: tx.id || tx.hash || i,
        time: tx.time || tx.timestamp || tx.createdAt || '-',
        type: tx.type || tx.direction || '-',
        amount: tx.amount ?? '-',
        to: tx.to || tx.recipient || '-',
      }))
    } else {
      txHistory.value = parseHistoryText(output)
    }
  } catch (e) {
    message.error(t('wallet.messages.loadHistoryFailed', { err: e.message }))
  } finally {
    historyLoading.value = false
  }
}

function parseHistoryText(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.match(/^\d+ transaction/i)) continue
    const parts = trimmed.split(/\s*[|│]\s*/)
    if (parts.length >= 3) {
      result.push({
        key: result.length,
        time: parts[0] || '-',
        type: parts[1] || '-',
        amount: parts[2] || '-',
        to: parts[3] || '-',
      })
    }
  }
  return result
}

onMounted(() => {
  loadWallets()
})
</script>

<style scoped>
:deep(.wallet-row:hover td) { background: var(--bg-card-hover) !important; }
:deep(.ant-tabs-tab) { color: var(--text-secondary) !important; }
:deep(.ant-tabs-tab-active .ant-tabs-tab-btn) { color: #1677ff !important; }
:deep(.ant-card-head) { border-color: var(--border-color) !important; color: var(--text-primary) !important; }
</style>
