<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ $t('crosschain.title') }}</h2>
        <p class="page-sub">{{ $t('crosschain.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          {{ $t('crosschain.refresh') }}
        </a-button>
        <a-dropdown :trigger="['click']">
          <a-button type="primary">
            <template #icon><PlusOutlined /></template>
            {{ $t('crosschain.newDropdown') }}
          </a-button>
          <template #overlay>
            <a-menu @click="handleNewClick">
              <a-menu-item key="bridge"><SwapOutlined /> {{ $t('crosschain.actions.bridge') }}</a-menu-item>
              <a-menu-item key="swap"><InteractionOutlined /> {{ $t('crosschain.actions.swap') }}</a-menu-item>
              <a-menu-item key="message"><MailOutlined /> {{ $t('crosschain.actions.message') }}</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
        <a-button @click="showFeeModal = true">
          <template #icon><CalculatorOutlined /></template>
          {{ $t('crosschain.feeEstimate') }}
        </a-button>
      </a-space>
    </div>

    <!-- Stats overview -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('crosschain.stats.chains')" :value="chains.length" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><LinkOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('crosschain.stats.bridges')" :value="stats.bridges.total" :value-style="{ color: '#52c41a', fontSize: '20px' }">
            <template #prefix><SwapOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('crosschain.stats.swaps')" :value="stats.swaps.total" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><InteractionOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('crosschain.stats.messages')" :value="stats.messages.total" :value-style="{ color: '#faad14', fontSize: '20px' }">
            <template #prefix><MailOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('crosschain.stats.volume')"
            :value="stats.bridges.totalVolume"
            :precision="2"
            :value-style="{ color: '#13c2c2', fontSize: '20px' }"
          >
            <template #prefix><DollarOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Chain catalogue -->
    <a-card
      v-if="chains.length"
      :title="$t('crosschain.chainsCard')"
      size="small"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
      :body-style="{ padding: '12px 16px' }"
    >
      <a-space :size="[12, 8]" wrap>
        <a-tag v-for="chain in chains" :key="chain.id" :color="chainColor(chain.id)">
          {{ chain.name }} <span style="opacity: 0.7;">({{ chain.symbol }})</span>
          <span v-if="chain.chainId > 0" style="opacity: 0.55; font-size: 10px; margin-left: 4px;">#{{ chain.chainId }}</span>
        </a-tag>
      </a-space>
    </a-card>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="xchain-tabs">
      <!-- ── Bridges tab ───────────────────────────────────────────── -->
      <a-tab-pane key="bridges" :tab="$t('crosschain.tabs.bridges')">
        <a-table
          :columns="bridgeColumns"
          :data-source="bridges"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('crosschain.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'route'">
              <span style="color: var(--text-primary);">{{ chainName(record.fromChain) }}</span>
              <ArrowRightOutlined style="margin: 0 6px; color: var(--text-secondary); font-size: 11px;" />
              <span style="color: var(--text-primary);">{{ chainName(record.toChain) }}</span>
            </template>
            <template v-if="column.key === 'amount'">
              <span style="color: #722ed1; font-weight: 500;">{{ record.amount }}</span>
              <span style="color: var(--text-secondary); margin-left: 4px; font-size: 11px;">{{ record.asset }}</span>
            </template>
            <template v-if="column.key === 'fee'">
              <span style="color: var(--text-secondary); font-size: 12px;">{{ record.feeAmount }}</span>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="bridgeStatusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatXChainTime(record.createdAt) }}</span>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <SwapOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ $t('crosschain.table.emptyBridges') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Swaps tab ─────────────────────────────────────────────── -->
      <a-tab-pane key="swaps" :tab="$t('crosschain.tabs.swaps')">
        <a-table
          :columns="swapColumns"
          :data-source="swaps"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('crosschain.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'route'">
              <span style="color: var(--text-primary);">{{ chainName(record.fromChain) }}</span>
              <span style="color: var(--text-secondary); font-size: 11px; margin: 0 4px;">({{ record.fromAsset }})</span>
              <ArrowRightOutlined style="margin: 0 4px; color: var(--text-secondary); font-size: 11px;" />
              <span style="color: var(--text-primary);">{{ chainName(record.toChain) }}</span>
              <span style="color: var(--text-secondary); font-size: 11px; margin-left: 4px;">({{ record.toAsset }})</span>
            </template>
            <template v-if="column.key === 'amount'">
              <span style="color: #722ed1; font-weight: 500;">{{ record.amount }}</span>
            </template>
            <template v-if="column.key === 'hashLock'">
              <span v-if="record.hashLock" style="color: var(--text-secondary); font-family: monospace; font-size: 11px;">
                {{ record.hashLock.slice(0, 14) }}...
              </span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="swapStatusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'expiresAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatXChainTime(record.expiresAt) }}</span>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <InteractionOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ $t('crosschain.table.emptySwaps') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Messages tab ──────────────────────────────────────────── -->
      <a-tab-pane key="messages" :tab="$t('crosschain.tabs.messages')">
        <a-table
          :columns="messageColumns"
          :data-source="messages"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('crosschain.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'route'">
              <span style="color: var(--text-primary);">{{ chainName(record.fromChain) }}</span>
              <ArrowRightOutlined style="margin: 0 6px; color: var(--text-secondary); font-size: 11px;" />
              <span style="color: var(--text-primary);">{{ chainName(record.toChain) }}</span>
            </template>
            <template v-if="column.key === 'payload'">
              <span style="color: var(--text-secondary); font-size: 12px;">{{ truncate(record.payload, 60) || '—' }}</span>
            </template>
            <template v-if="column.key === 'retries'">
              <a-tag v-if="record.retries > 0" color="orange" style="font-size: 11px;">{{ $t('crosschain.table.retrySuffix', { n: record.retries }) }}</a-tag>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="messageStatusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatXChainTime(record.createdAt) }}</span>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <MailOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ $t('crosschain.table.emptyMessages') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Bridge modal ──────────────────────────────────────────── -->
    <a-modal
      v-model:open="showBridgeModal"
      :title="$t('crosschain.bridge_modal.title')"
      :confirm-loading="bridging"
      :width="540"
      :ok-text="$t('crosschain.bridge_modal.ok')"
      :cancel-text="$t('crosschain.bridge_modal.cancel')"
      @ok="initiateBridge"
      @cancel="resetBridgeForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('crosschain.bridge_modal.fromChain')" required>
          <a-select v-model:value="bridgeForm.fromChain" :placeholder="$t('crosschain.bridge_modal.fromChainPlaceholder')">
            <a-select-option v-for="c in chains" :key="c.id" :value="c.id">{{ c.name }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('crosschain.bridge_modal.toChain')" required>
          <a-select v-model:value="bridgeForm.toChain" :placeholder="$t('crosschain.bridge_modal.toChainPlaceholder')">
            <a-select-option v-for="c in chains" :key="c.id" :value="c.id" :disabled="c.id === bridgeForm.fromChain">
              {{ c.name }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('crosschain.bridge_modal.amount')" required>
          <a-input-number v-model:value="bridgeForm.amount" :min="0" :precision="6" style="width: 100%;" />
        </a-form-item>
        <a-form-item :label="$t('crosschain.bridge_modal.asset')">
          <a-input v-model:value="bridgeForm.asset" :placeholder="$t('crosschain.bridge_modal.assetPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('crosschain.bridge_modal.sender')">
          <a-input v-model:value="bridgeForm.sender" :placeholder="$t('crosschain.bridge_modal.senderPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('crosschain.bridge_modal.recipient')">
          <a-input v-model:value="bridgeForm.recipient" :placeholder="$t('crosschain.bridge_modal.recipientPlaceholder')" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Swap modal ────────────────────────────────────────────── -->
    <a-modal
      v-model:open="showSwapModal"
      :title="$t('crosschain.swap_modal.title')"
      :confirm-loading="swapping"
      :width="540"
      :ok-text="$t('crosschain.swap_modal.ok')"
      :cancel-text="$t('crosschain.swap_modal.cancel')"
      @ok="initiateSwap"
      @cancel="resetSwapForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('crosschain.swap_modal.fromChain')" required>
          <a-select v-model:value="swapForm.fromChain" :placeholder="$t('crosschain.swap_modal.fromChainPlaceholder')">
            <a-select-option v-for="c in chains" :key="c.id" :value="c.id">{{ c.name }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('crosschain.swap_modal.toChain')" required>
          <a-select v-model:value="swapForm.toChain" :placeholder="$t('crosschain.swap_modal.toChainPlaceholder')">
            <a-select-option v-for="c in chains" :key="c.id" :value="c.id" :disabled="c.id === swapForm.fromChain">
              {{ c.name }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('crosschain.swap_modal.amount')" required>
          <a-input-number v-model:value="swapForm.amount" :min="0" :precision="6" style="width: 100%;" />
        </a-form-item>
        <a-form-item :label="$t('crosschain.swap_modal.fromAsset')">
          <a-input v-model:value="swapForm.fromAsset" :placeholder="$t('crosschain.swap_modal.assetPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('crosschain.swap_modal.toAsset')">
          <a-input v-model:value="swapForm.toAsset" :placeholder="$t('crosschain.swap_modal.assetPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('crosschain.swap_modal.counterparty')">
          <a-input v-model:value="swapForm.counterparty" :placeholder="$t('crosschain.swap_modal.counterpartyPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('crosschain.swap_modal.timeoutMs')">
          <a-input-number v-model:value="swapForm.timeoutMs" :min="0" :placeholder="$t('crosschain.swap_modal.timeoutPlaceholder')" style="width: 100%;" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Message modal ─────────────────────────────────────────── -->
    <a-modal
      v-model:open="showMessageModal"
      :title="$t('crosschain.message_modal.title')"
      :confirm-loading="sending"
      :width="520"
      :ok-text="$t('crosschain.message_modal.ok')"
      :cancel-text="$t('crosschain.message_modal.cancel')"
      @ok="sendMessage"
      @cancel="resetMessageForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('crosschain.message_modal.fromChain')" required>
          <a-select v-model:value="messageForm.fromChain" :placeholder="$t('crosschain.message_modal.fromChainPlaceholder')">
            <a-select-option v-for="c in chains" :key="c.id" :value="c.id">{{ c.name }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('crosschain.message_modal.toChain')" required>
          <a-select v-model:value="messageForm.toChain" :placeholder="$t('crosschain.message_modal.toChainPlaceholder')">
            <a-select-option v-for="c in chains" :key="c.id" :value="c.id" :disabled="c.id === messageForm.fromChain">
              {{ c.name }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('crosschain.message_modal.payload')">
          <a-textarea v-model:value="messageForm.payload" :auto-size="{ minRows: 3, maxRows: 8 }" />
        </a-form-item>
        <a-form-item :label="$t('crosschain.message_modal.contract')">
          <a-input v-model:value="messageForm.contract" :placeholder="$t('crosschain.message_modal.contractPlaceholder')" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Fee estimate modal ────────────────────────────────────── -->
    <a-modal
      v-model:open="showFeeModal"
      :title="$t('crosschain.fee_modal.title')"
      :confirm-loading="estimating"
      :width="480"
      :ok-text="$t('crosschain.fee_modal.ok')"
      :cancel-text="$t('crosschain.fee_modal.cancel')"
      @ok="estimateFee"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('crosschain.fee_modal.fromChain')" required>
          <a-select v-model:value="feeForm.fromChain">
            <a-select-option v-for="c in chains" :key="c.id" :value="c.id">{{ c.name }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('crosschain.fee_modal.toChain')" required>
          <a-select v-model:value="feeForm.toChain">
            <a-select-option v-for="c in chains" :key="c.id" :value="c.id" :disabled="c.id === feeForm.fromChain">
              {{ c.name }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('crosschain.fee_modal.amount')" required>
          <a-input-number v-model:value="feeForm.amount" :min="0" :precision="6" style="width: 100%;" />
        </a-form-item>
      </a-form>
      <a-card v-if="feeResult" size="small" style="background: var(--bg-base); margin-top: 8px;">
        <a-statistic
          :title="$t('crosschain.fee_modal.resultTitle')"
          :value="feeResult.fee"
          :precision="4"
          :suffix="feeResult.currency"
          :value-style="{ color: '#1677ff' }"
        />
        <div style="margin-top: 12px; font-size: 12px; color: var(--text-secondary);">
          <div>{{ $t('crosschain.fee_modal.sourceFee', { fee: feeResult.breakdown.sourceFee, currency: feeResult.currency }) }}</div>
          <div>{{ $t('crosschain.fee_modal.destFee', { fee: feeResult.breakdown.destFee, currency: feeResult.currency }) }}</div>
          <div>{{ $t('crosschain.fee_modal.bridgeFee', { fee: feeResult.breakdown.bridgeFee, currency: feeResult.currency }) }}</div>
        </div>
      </a-card>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import {
  ReloadOutlined,
  PlusOutlined,
  SwapOutlined,
  InteractionOutlined,
  MailOutlined,
  CalculatorOutlined,
  LinkOutlined,
  DollarOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useI18n } from 'vue-i18n'
import { useWsStore } from '../stores/ws.js'
import {
  parseChains,
  parseBridges,
  parseSwaps,
  parseMessages,
  parseStats,
  parseFeeEstimate,
  formatXChainTime,
} from '../utils/crosschain-parser.js'

const ws = useWsStore()
const { t } = useI18n()

const loading = ref(false)
const bridging = ref(false)
const swapping = ref(false)
const sending = ref(false)
const estimating = ref(false)

const chains = ref([])
const bridges = ref([])
const swaps = ref([])
const messages = ref([])
const stats = ref({
  bridges: { total: 0, byStatus: {}, totalVolume: 0, totalFees: 0 },
  swaps: { total: 0, byStatus: {} },
  messages: { total: 0, byStatus: {} },
})

const activeTab = ref('bridges')
const showBridgeModal = ref(false)
const showSwapModal = ref(false)
const showMessageModal = ref(false)
const showFeeModal = ref(false)

const bridgeForm = reactive({
  fromChain: '', toChain: '', amount: null, asset: '', sender: '', recipient: '',
})
const swapForm = reactive({
  fromChain: '', toChain: '', amount: null, fromAsset: '', toAsset: '', counterparty: '', timeoutMs: null,
})
const messageForm = reactive({
  fromChain: '', toChain: '', payload: '', contract: '',
})
const feeForm = reactive({
  fromChain: '', toChain: '', amount: null,
})
const feeResult = ref(null)

// Wrapped in computed() so column titles re-render on locale toggle.
const bridgeColumns = computed(() => [
  { title: t('crosschain.bridgeCols.route'), key: 'route' },
  { title: t('crosschain.bridgeCols.amount'), key: 'amount', width: '160px' },
  { title: t('crosschain.bridgeCols.fee'), key: 'fee', width: '100px' },
  { title: t('crosschain.bridgeCols.status'), key: 'status', width: '110px' },
  { title: t('crosschain.bridgeCols.createdAt'), key: 'createdAt', width: '160px' },
])

const swapColumns = computed(() => [
  { title: t('crosschain.swapCols.route'), key: 'route' },
  { title: t('crosschain.swapCols.amount'), key: 'amount', width: '110px' },
  { title: t('crosschain.swapCols.hashLock'), key: 'hashLock', width: '160px' },
  { title: t('crosschain.swapCols.status'), key: 'status', width: '120px' },
  { title: t('crosschain.swapCols.expiresAt'), key: 'expiresAt', width: '160px' },
])

const messageColumns = computed(() => [
  { title: t('crosschain.messageCols.route'), key: 'route', width: '220px' },
  { title: t('crosschain.messageCols.payload'), key: 'payload' },
  { title: t('crosschain.messageCols.retries'), key: 'retries', width: '80px' },
  { title: t('crosschain.messageCols.status'), key: 'status', width: '110px' },
  { title: t('crosschain.messageCols.createdAt'), key: 'createdAt', width: '160px' },
])

const CHAIN_COLORS = {
  ethereum: 'blue',
  polygon: 'purple',
  bsc: 'gold',
  arbitrum: 'cyan',
  solana: 'magenta',
}
function chainColor(id) { return CHAIN_COLORS[id] || 'default' }

function chainName(id) {
  const c = chains.value.find(x => x.id === id)
  return c ? c.name : (id || '—')
}

function statusLabel(s) {
  const key = `crosschain.statusLabels.${s}`
  const v = t(key)
  return v === key ? s : v
}

function bridgeStatusColor(s) {
  return {
    pending: 'default', locked: 'processing', minted: 'cyan',
    completed: 'green', refunded: 'orange', failed: 'red',
  }[s] || 'default'
}
function swapStatusColor(s) {
  return {
    initiated: 'default', hash_locked: 'processing',
    claimed: 'green', refunded: 'orange', expired: 'red',
  }[s] || 'default'
}
function messageStatusColor(s) {
  return {
    pending: 'default', sent: 'processing', delivered: 'green', failed: 'red',
  }[s] || 'default'
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '...' : s
}

function handleNewClick({ key }) {
  if (key === 'bridge') showBridgeModal.value = true
  else if (key === 'swap') showSwapModal.value = true
  else if (key === 'message') showMessageModal.value = true
}

async function loadAll() {
  loading.value = true
  try {
    const [chainsRes, bRes, sRes, mRes, statsRes] = await Promise.all([
      ws.execute('crosschain chains --json', 8000).catch(() => ({ output: '' })),
      ws.execute('crosschain bridges --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('crosschain swaps --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('crosschain messages --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('crosschain stats --json', 8000).catch(() => ({ output: '' })),
    ])
    chains.value = parseChains(chainsRes.output)
    bridges.value = parseBridges(bRes.output)
    swaps.value = parseSwaps(sRes.output)
    messages.value = parseMessages(mRes.output)
    stats.value = parseStats(statsRes.output)
  } catch (e) {
    message.error(t('crosschain.msg.loadFailed') + ': ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

function validatePair(form) {
  if (!form.fromChain || !form.toChain) {
    message.warning(t('crosschain.msg.pairEmpty'))
    return false
  }
  if (form.fromChain === form.toChain) {
    message.warning(t('crosschain.msg.pairSame'))
    return false
  }
  return true
}

async function initiateBridge() {
  if (!validatePair(bridgeForm)) return
  if (!bridgeForm.amount || bridgeForm.amount <= 0) {
    message.warning(t('crosschain.msg.amountInvalid'))
    return
  }
  bridging.value = true
  try {
    const parts = [`crosschain bridge ${bridgeForm.fromChain} ${bridgeForm.toChain} ${bridgeForm.amount}`]
    if (bridgeForm.asset.trim()) parts.push(`--asset "${bridgeForm.asset.trim().replace(/"/g, '\\"')}"`)
    if (bridgeForm.sender.trim()) parts.push(`--sender "${bridgeForm.sender.trim().replace(/"/g, '\\"')}"`)
    if (bridgeForm.recipient.trim()) parts.push(`--recipient "${bridgeForm.recipient.trim().replace(/"/g, '\\"')}"`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 15000)
    if (/error|failed|失败|unsupported/i.test(output) && !/"bridgeId"/.test(output)) {
      message.error(t('crosschain.msg.bridgeFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('crosschain.msg.bridgeSuccess'))
    showBridgeModal.value = false
    resetBridgeForm()
    activeTab.value = 'bridges'
    await loadAll()
  } catch (e) {
    message.error(t('crosschain.msg.bridgeFailed') + ': ' + (e?.message || e))
  } finally {
    bridging.value = false
  }
}

async function initiateSwap() {
  if (!validatePair(swapForm)) return
  if (!swapForm.amount || swapForm.amount <= 0) {
    message.warning(t('crosschain.msg.amountInvalid'))
    return
  }
  swapping.value = true
  try {
    const parts = [`crosschain swap ${swapForm.fromChain} ${swapForm.toChain} ${swapForm.amount}`]
    if (swapForm.fromAsset.trim()) parts.push(`--from-asset "${swapForm.fromAsset.trim().replace(/"/g, '\\"')}"`)
    if (swapForm.toAsset.trim()) parts.push(`--to-asset "${swapForm.toAsset.trim().replace(/"/g, '\\"')}"`)
    if (swapForm.counterparty.trim()) parts.push(`--counterparty "${swapForm.counterparty.trim().replace(/"/g, '\\"')}"`)
    if (swapForm.timeoutMs != null) parts.push(`--timeout ${swapForm.timeoutMs}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 15000)
    if (/error|failed|失败|unsupported/i.test(output) && !/"swapId"/.test(output)) {
      message.error(t('crosschain.msg.swapFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('crosschain.msg.swapSuccess'))
    showSwapModal.value = false
    resetSwapForm()
    activeTab.value = 'swaps'
    await loadAll()
  } catch (e) {
    message.error(t('crosschain.msg.swapFailed') + ': ' + (e?.message || e))
  } finally {
    swapping.value = false
  }
}

async function sendMessage() {
  if (!validatePair(messageForm)) return
  sending.value = true
  try {
    const parts = [`crosschain send ${messageForm.fromChain} ${messageForm.toChain}`]
    if (messageForm.payload.trim()) parts.push(`--payload "${messageForm.payload.trim().replace(/"/g, '\\"')}"`)
    if (messageForm.contract.trim()) parts.push(`--contract "${messageForm.contract.trim().replace(/"/g, '\\"')}"`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 12000)
    if (/error|failed|失败|unsupported/i.test(output) && !/"messageId"/.test(output)) {
      message.error(t('crosschain.msg.sendFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('crosschain.msg.sendSuccess'))
    showMessageModal.value = false
    resetMessageForm()
    activeTab.value = 'messages'
    await loadAll()
  } catch (e) {
    message.error(t('crosschain.msg.sendFailed') + ': ' + (e?.message || e))
  } finally {
    sending.value = false
  }
}

async function estimateFee() {
  if (!validatePair(feeForm)) return
  if (!feeForm.amount || feeForm.amount <= 0) {
    message.warning(t('crosschain.msg.amountInvalid'))
    return
  }
  estimating.value = true
  feeResult.value = null
  try {
    const cmd = `crosschain estimate-fee ${feeForm.fromChain} ${feeForm.toChain} ${feeForm.amount} --json`
    const { output } = await ws.execute(cmd, 8000)
    const parsed = parseFeeEstimate(output)
    if (!parsed) {
      message.error(t('crosschain.msg.feeFailed') + ': ' + output.slice(0, 120))
      return
    }
    feeResult.value = parsed
  } catch (e) {
    message.error(t('crosschain.msg.feeFailed') + ': ' + (e?.message || e))
  } finally {
    estimating.value = false
  }
}

function resetBridgeForm() {
  bridgeForm.fromChain = ''
  bridgeForm.toChain = ''
  bridgeForm.amount = null
  bridgeForm.asset = ''
  bridgeForm.sender = ''
  bridgeForm.recipient = ''
}
function resetSwapForm() {
  swapForm.fromChain = ''
  swapForm.toChain = ''
  swapForm.amount = null
  swapForm.fromAsset = ''
  swapForm.toAsset = ''
  swapForm.counterparty = ''
  swapForm.timeoutMs = null
}
function resetMessageForm() {
  messageForm.fromChain = ''
  messageForm.toChain = ''
  messageForm.payload = ''
  messageForm.contract = ''
}

onMounted(loadAll)
</script>

<style scoped>
.page-title {
  margin: 0;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 600;
}
.page-sub {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.xchain-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}
</style>
