<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ $t('tenant.title') }}</h2>
        <p class="page-sub">{{ $t('tenant.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          {{ $t('tenant.refresh') }}
        </a-button>
        <a-dropdown :trigger="['click']">
          <a-button type="primary">
            <template #icon><PlusOutlined /></template>
            {{ $t('tenant.actionDropdown') }}
          </a-button>
          <template #overlay>
            <a-menu @click="handleNewClick">
              <a-menu-item key="tenant"><BankOutlined /> {{ $t('tenant.actions.tenant') }}</a-menu-item>
              <a-menu-item key="quota"><DashboardOutlined /> {{ $t('tenant.actions.quota') }}</a-menu-item>
              <a-menu-item key="record"><LineChartOutlined /> {{ $t('tenant.actions.record') }}</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-space>
    </div>

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('tenant.stats.total')" :value="stats.tenantCount" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><BankOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('tenant.stats.active')"
            :value="stats.activeSubscriptions"
            :value-style="{ color: stats.activeSubscriptions > 0 ? '#52c41a' : '#888', fontSize: '20px' }"
          >
            <template #prefix><CreditCardOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('tenant.stats.mrr')"
            :value="estimatedMrr"
            :precision="0"
            prefix="¥"
            :value-style="{ color: '#722ed1', fontSize: '20px' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('tenant.stats.apiCalls')" :value="stats.totalUsage.api_calls" :value-style="{ color: '#13c2c2', fontSize: '20px' }">
            <template #prefix><ApiOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('tenant.stats.storage')"
            :value="formatBytes(stats.totalUsage.storage_bytes)"
            :value-style="{ color: '#faad14', fontSize: '18px' }"
          />
        </a-card>
      </a-col>
    </a-row>

    <!-- Plan distribution -->
    <a-card
      v-if="stats.tenantCount > 0"
      :title="$t('tenant.plansCard')"
      size="small"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
      :body-style="{ padding: '12px 16px' }"
    >
      <a-space :size="[12, 8]" wrap>
        <a-tag v-for="p in PLAN_IDS" :key="p" :color="planColor(p)">
          {{ planLabel(p) }}: {{ stats.byPlan[p] || 0 }}
        </a-tag>
        <span style="color: var(--text-secondary); font-size: 12px; margin-left: 8px;">
          {{ $t('tenant.summarySuffix', { active: stats.byStatus.active, suspended: stats.byStatus.suspended, deleted: stats.byStatus.deleted }) }}
        </span>
      </a-space>
    </a-card>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="tenant-tabs">
      <!-- ── Tenants tab ───────────────────────────────────────────── -->
      <a-tab-pane key="tenants" :tab="$t('tenant.tabs.tenants')">
        <div class="filter-bar">
          <a-radio-group v-model:value="planFilter" size="small">
            <a-radio-button value="">{{ $t('tenant.filter.allPlans') }}</a-radio-button>
            <a-radio-button v-for="p in PLAN_IDS" :key="p" :value="p">{{ planLabel(p) }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="statusFilter" size="small" button-style="solid">
            <a-radio-button value="">{{ $t('tenant.filter.allStatuses') }}</a-radio-button>
            <a-radio-button v-for="s in TENANT_STATUSES" :key="s" :value="s">{{ tenantStatusLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="tenantColumns"
          :data-source="filteredTenants"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('tenant.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">
              <span style="color: var(--text-primary); font-weight: 500;">{{ record.name }}</span>
              <div style="color: var(--text-secondary); font-size: 11px; margin-top: 2px; font-family: monospace;">
                {{ record.slug }}
              </div>
            </template>
            <template v-if="column.key === 'plan'">
              <a-tag :color="planColor(record.plan)">{{ planLabel(record.plan) }}</a-tag>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="tenantStatusColor(record.status)">{{ tenantStatusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'owner'">
              <span v-if="record.ownerId" style="color: var(--text-secondary); font-family: monospace; font-size: 11px;">
                {{ record.ownerId }}
              </span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatTenantTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" @click="openSubscribe(record)">{{ $t('tenant.table.actionSubscribe') }}</a-button>
              <a-dropdown :trigger="['click']">
                <a-button size="small" type="link">{{ $t('tenant.table.actionPlanDropdown') }}</a-button>
                <template #overlay>
                  <a-menu @click="(e) => changePlan(record, e.key)">
                    <a-menu-item v-for="p in PLAN_IDS" :key="p" :disabled="p === record.plan">
                      {{ planLabel(p) }}
                    </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
              <a-button
                v-if="record.status === 'active'"
                size="small"
                type="link"
                @click="setStatus(record, 'suspended')"
              >{{ $t('tenant.table.actionSuspend') }}</a-button>
              <a-button
                v-else-if="record.status === 'suspended'"
                size="small"
                type="link"
                @click="setStatus(record, 'active')"
              >{{ $t('tenant.table.actionActivate') }}</a-button>
              <a-popconfirm
                v-if="record.status !== 'deleted'"
                :title="$t('tenant.deleteConfirm.title')"
                :ok-text="$t('tenant.deleteConfirm.ok')"
                :cancel-text="$t('tenant.deleteConfirm.cancel')"
                @confirm="deleteTenant(record)"
              >
                <a-button size="small" type="link" danger>{{ $t('tenant.deleteConfirm.ok') }}</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <BankOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ planFilter || statusFilter ? $t('tenant.table.emptyTenantsFiltered') : $t('tenant.table.emptyTenants') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Subscriptions tab ─────────────────────────────────────── -->
      <a-tab-pane key="subscriptions" :tab="$t('tenant.tabs.subscriptions')">
        <a-table
          :columns="subscriptionColumns"
          :data-source="subscriptions"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('tenant.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'tenant'">
              <span style="color: var(--text-primary); font-weight: 500;">{{ tenantName(record.tenantId) }}</span>
              <div style="color: var(--text-secondary); font-size: 11px; font-family: monospace;">
                {{ record.tenantId.slice(0, 8) }}
              </div>
            </template>
            <template v-if="column.key === 'plan'">
              <a-tag :color="planColor(record.plan)">{{ planLabel(record.plan) }}</a-tag>
            </template>
            <template v-if="column.key === 'amount'">
              <span v-if="record.amount != null" style="color: #722ed1; font-weight: 500;">¥{{ record.amount }}</span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="subStatusColor(record.status)">{{ subStatusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'startedAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatTenantTime(record.startedAt) }}</span>
            </template>
            <template v-if="column.key === 'expiresAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatTenantTime(record.expiresAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-popconfirm
                v-if="record.status === 'active'"
                :title="$t('tenant.cancelConfirm.title')"
                :ok-text="$t('tenant.cancelConfirm.ok')"
                :cancel-text="$t('tenant.cancelConfirm.cancel')"
                @confirm="cancelSubscription(record)"
              >
                <a-button size="small" type="link" danger>{{ $t('tenant.cancelConfirm.ok') }}</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <CreditCardOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ $t('tenant.table.emptySubscriptions') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Plans catalogue tab ──────────────────────────────────── -->
      <a-tab-pane key="plans" :tab="$t('tenant.tabs.plans')">
        <a-row :gutter="[16, 16]">
          <a-col v-for="plan in plans" :key="plan.id" :xs="24" :sm="12" :lg="6">
            <a-card :title="plan.name" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <template #extra>
                <a-tag :color="planColor(plan.id)">{{ plan.id }}</a-tag>
              </template>
              <div class="plan-fee">
                <span v-if="plan.monthlyFee != null">¥{{ plan.monthlyFee }} <span class="plan-fee-unit">{{ $t('tenant.planCard.monthlySuffix') }}</span></span>
                <span v-else style="color: #722ed1;">{{ $t('tenant.planCard.contactSales') }}</span>
              </div>
              <div class="plan-section">
                <div class="plan-section-title">{{ $t('tenant.planCard.quotas') }}</div>
                <div v-for="m in metrics" :key="m.id" class="plan-quota-row">
                  <span class="plan-quota-label">{{ m.name }}</span>
                  <span class="plan-quota-value">
                    {{ formatQuota(plan.quotas?.[m.id], m.id) }}
                  </span>
                </div>
              </div>
              <div class="plan-section">
                <div class="plan-section-title">{{ $t('tenant.planCard.features') }}</div>
                <a-tag v-for="f in plan.features" :key="f" style="font-size: 10px; margin: 1px;">{{ f }}</a-tag>
              </div>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Create tenant modal ──────────────────────────────────── -->
    <a-modal
      v-model:open="showCreateModal"
      :title="$t('tenant.create_modal.title')"
      :confirm-loading="creating"
      :width="520"
      :ok-text="$t('tenant.create_modal.ok')"
      :cancel-text="$t('tenant.create_modal.cancel')"
      @ok="createTenant"
      @cancel="resetCreateForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('tenant.create_modal.nameLabel')" required>
          <a-input v-model:value="createForm.name" :placeholder="$t('tenant.create_modal.namePlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('tenant.create_modal.slugLabel')" required>
          <a-input v-model:value="createForm.slug" :placeholder="$t('tenant.create_modal.slugPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('tenant.create_modal.planLabel')">
          <a-select v-model:value="createForm.plan">
            <a-select-option v-for="p in PLAN_IDS" :key="p" :value="p">{{ planLabel(p) }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('tenant.create_modal.ownerLabel')">
          <a-input v-model:value="createForm.owner" :placeholder="$t('tenant.create_modal.ownerPlaceholder')" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Subscribe modal ──────────────────────────────────────── -->
    <a-modal
      v-model:open="showSubscribeModal"
      :title="$t('tenant.subscribe_modal.title', { name: subscribeTargetName })"
      :confirm-loading="subscribing"
      :width="500"
      :ok-text="$t('tenant.subscribe_modal.ok')"
      :cancel-text="$t('tenant.subscribe_modal.cancel')"
      @ok="subscribeTenant"
      @cancel="resetSubscribeForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('tenant.subscribe_modal.planLabel')" required>
          <a-select v-model:value="subscribeForm.plan">
            <a-select-option v-for="p in PLAN_IDS" :key="p" :value="p">{{ planLabel(p) }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('tenant.subscribe_modal.amountLabel')">
          <a-input-number v-model:value="subscribeForm.amount" :min="0" :placeholder="$t('tenant.subscribe_modal.amountPlaceholder')" style="width: 100%;" />
        </a-form-item>
        <a-form-item :label="$t('tenant.subscribe_modal.durationLabel')">
          <a-radio-group v-model:value="subscribeForm.duration">
            <a-radio-button :value="30 * 24 * 60 * 60 * 1000">{{ $t('tenant.subscribe_modal.duration30') }}</a-radio-button>
            <a-radio-button :value="90 * 24 * 60 * 60 * 1000">{{ $t('tenant.subscribe_modal.duration90') }}</a-radio-button>
            <a-radio-button :value="365 * 24 * 60 * 60 * 1000">{{ $t('tenant.subscribe_modal.duration365') }}</a-radio-button>
          </a-radio-group>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Quota check modal ────────────────────────────────────── -->
    <a-modal
      v-model:open="showQuotaModal"
      :title="$t('tenant.quota_modal.title')"
      :confirm-loading="checking"
      :width="500"
      :ok-text="$t('tenant.quota_modal.ok')"
      :cancel-text="$t('tenant.quota_modal.cancel')"
      @ok="checkQuota"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('tenant.quota_modal.tenantLabel')" required>
          <a-select v-model:value="quotaForm.tenantId" show-search :placeholder="$t('tenant.quota_modal.tenantPlaceholder')">
            <a-select-option v-for="t in tenants" :key="t.id" :value="t.id">{{ t.name }} ({{ t.slug }})</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('tenant.quota_modal.metricLabel')" required>
          <a-select v-model:value="quotaForm.metric">
            <a-select-option v-for="m in KNOWN_METRICS" :key="m" :value="m">{{ m }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('tenant.quota_modal.periodLabel')">
          <a-input v-model:value="quotaForm.period" :placeholder="$t('tenant.quota_modal.periodPlaceholder')" />
        </a-form-item>
      </a-form>
      <a-card v-if="quotaResult" size="small" style="background: var(--bg-base); margin-top: 8px;">
        <a-statistic
          :title="$t('tenant.quota_modal.resultTitle')"
          :value="quotaResult.unlimited ? $t('tenant.quota_modal.unlimited') : (quotaResult.exceeded ? $t('tenant.quota_modal.exceeded') : $t('tenant.quota_modal.ok_state'))"
          :value-style="{ color: quotaResult.exceeded ? '#ff4d4f' : (quotaResult.unlimited ? '#722ed1' : '#52c41a') }"
        />
        <div style="margin-top: 12px; font-size: 12px; color: var(--text-secondary);">
          <div>{{ $t('tenant.quota_modal.planLine') }} <a-tag :color="planColor(quotaResult.plan)">{{ planLabel(quotaResult.plan) }}</a-tag></div>
          <div>{{ $t('tenant.quota_modal.periodLine', { period: quotaResult.period }) }}</div>
          <div>{{ $t('tenant.quota_modal.usedLine') }} <span style="font-family: monospace; color: var(--text-primary);">{{ formatMetricValue(quotaResult.used, quotaResult.metric) }}</span></div>
          <div v-if="!quotaResult.unlimited">
            {{ $t('tenant.quota_modal.limitLine') }} <span style="font-family: monospace;">{{ formatMetricValue(quotaResult.limit, quotaResult.metric) }}</span>
          </div>
          <div v-if="!quotaResult.unlimited && quotaResult.limit > 0" style="margin-top: 8px;">
            <a-progress
              :percent="Math.min(100, Math.round(100 * quotaResult.used / quotaResult.limit))"
              size="small"
              :status="quotaResult.exceeded ? 'exception' : 'active'"
            />
          </div>
        </div>
      </a-card>
    </a-modal>

    <!-- ── Record usage modal ───────────────────────────────────── -->
    <a-modal
      v-model:open="showRecordModal"
      :title="$t('tenant.record_modal.title')"
      :confirm-loading="recording"
      :width="500"
      :ok-text="$t('tenant.record_modal.ok')"
      :cancel-text="$t('tenant.record_modal.cancel')"
      @ok="recordUsage"
      @cancel="resetRecordForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('tenant.record_modal.tenantLabel')" required>
          <a-select v-model:value="recordForm.tenantId" show-search :placeholder="$t('tenant.record_modal.tenantPlaceholder')">
            <a-select-option v-for="t in tenants" :key="t.id" :value="t.id">{{ t.name }} ({{ t.slug }})</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('tenant.record_modal.metricLabel')" required>
          <a-select v-model:value="recordForm.metric">
            <a-select-option v-for="m in KNOWN_METRICS" :key="m" :value="m">{{ m }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('tenant.record_modal.valueLabel')" required>
          <a-input-number v-model:value="recordForm.value" :min="0" style="width: 100%;" />
        </a-form-item>
        <a-form-item :label="$t('tenant.record_modal.periodLabel')">
          <a-input v-model:value="recordForm.period" :placeholder="$t('tenant.record_modal.periodPlaceholder')" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import {
  ReloadOutlined,
  PlusOutlined,
  BankOutlined,
  CreditCardOutlined,
  DashboardOutlined,
  LineChartOutlined,
  ApiOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useI18n } from 'vue-i18n'
import { useWsStore } from '../stores/ws.js'
import {
  parsePlans,
  parseMetrics,
  parseTenants,
  parseSubscriptions,
  parseQuotaResult,
  parseStats,
  formatTenantTime,
  formatBytes,
  currentPeriod,
  PLAN_IDS,
  TENANT_STATUSES,
  KNOWN_METRICS,
} from '../utils/tenant-parser.js'

const ws = useWsStore()
const { t } = useI18n()

const loading = ref(false)
const creating = ref(false)
const subscribing = ref(false)
const checking = ref(false)
const recording = ref(false)

const tenants = ref([])
const subscriptions = ref([])
const plans = ref([])
const metrics = ref([])
const stats = ref({
  tenantCount: 0,
  byStatus: { active: 0, suspended: 0, deleted: 0 },
  byPlan: { free: 0, starter: 0, pro: 0, enterprise: 0 },
  subscriptionCount: 0,
  activeSubscriptions: 0,
  usageRecordCount: 0,
  totalUsage: { api_calls: 0, storage_bytes: 0, ai_requests: 0 },
})

const activeTab = ref('tenants')
const planFilter = ref('')
const statusFilter = ref('')

const showCreateModal = ref(false)
const showSubscribeModal = ref(false)
const showQuotaModal = ref(false)
const showRecordModal = ref(false)

const createForm = reactive({ name: '', slug: '', plan: 'free', owner: '' })
const subscribeForm = reactive({ tenantId: '', plan: 'pro', amount: null, duration: 30 * 24 * 60 * 60 * 1000 })
const subscribeTargetName = ref('')
const quotaForm = reactive({ tenantId: null, metric: 'api_calls', period: '' })
const recordForm = reactive({ tenantId: null, metric: 'api_calls', value: 1, period: '' })
const quotaResult = ref(null)

const tenantColumns = computed(() => [
  { title: t('tenant.tenantCols.name'), key: 'name' },
  { title: t('tenant.tenantCols.plan'), key: 'plan', width: '110px' },
  { title: t('tenant.tenantCols.status'), key: 'status', width: '100px' },
  { title: t('tenant.tenantCols.owner'), key: 'owner', width: '160px' },
  { title: t('tenant.tenantCols.createdAt'), key: 'createdAt', width: '160px' },
  { title: t('tenant.tenantCols.action'), key: 'action', width: '280px' },
])

const subscriptionColumns = computed(() => [
  { title: t('tenant.subscriptionCols.tenant'), key: 'tenant' },
  { title: t('tenant.subscriptionCols.plan'), key: 'plan', width: '110px' },
  { title: t('tenant.subscriptionCols.amount'), key: 'amount', width: '100px' },
  { title: t('tenant.subscriptionCols.status'), key: 'status', width: '110px' },
  { title: t('tenant.subscriptionCols.startedAt'), key: 'startedAt', width: '160px' },
  { title: t('tenant.subscriptionCols.expiresAt'), key: 'expiresAt', width: '160px' },
  { title: t('tenant.subscriptionCols.action'), key: 'action', width: '120px' },
])

const filteredTenants = computed(() => {
  let rows = tenants.value
  if (planFilter.value) rows = rows.filter(t => t.plan === planFilter.value)
  if (statusFilter.value) rows = rows.filter(t => t.status === statusFilter.value)
  return rows
})

const estimatedMrr = computed(() => {
  return subscriptions.value
    .filter(s => s.status === 'active' && typeof s.amount === 'number')
    .reduce((sum, s) => sum + s.amount, 0)
})

function planLabel(p) {
  const key = `tenant.planLabels.${p}`
  const v = t(key)
  return v === key ? p : v
}
function planColor(p) {
  return { free: 'default', starter: 'blue', pro: 'purple', enterprise: 'gold' }[p] || 'default'
}
function tenantStatusLabel(s) {
  const key = `tenant.tenantStatusLabels.${s}`
  const v = t(key)
  return v === key ? s : v
}
function tenantStatusColor(s) {
  return { active: 'green', suspended: 'orange', deleted: 'default' }[s] || 'default'
}
function subStatusLabel(s) {
  const key = `tenant.subStatusLabels.${s}`
  const v = t(key)
  return v === key ? s : v
}
function subStatusColor(s) {
  return { active: 'green', cancelled: 'default', expired: 'red', past_due: 'orange' }[s] || 'default'
}

function tenantName(tenantId) {
  const found = tenants.value.find(x => x.id === tenantId)
  return found ? found.name : t('tenant.deletedTenant')
}

function formatMetricValue(v, metric) {
  if (v == null) return '—'
  if (metric === 'storage_bytes') return formatBytes(v)
  return String(v)
}

function formatQuota(v, metric) {
  if (v == null) return t('tenant.planCard.unlimited')
  if (metric === 'storage_bytes') return formatBytes(v)
  return v.toLocaleString()
}

function handleNewClick({ key }) {
  if (key === 'tenant') showCreateModal.value = true
  else if (key === 'quota') {
    quotaResult.value = null
    showQuotaModal.value = true
  } else if (key === 'record') showRecordModal.value = true
}

async function loadAll() {
  loading.value = true
  try {
    const [tenantsRes, subsRes, plansRes, metricsRes, statsRes] = await Promise.all([
      ws.execute('tenant list --json', 10000).catch(() => ({ output: '' })),
      ws.execute('tenant subscriptions --json', 10000).catch(() => ({ output: '' })),
      ws.execute('tenant plans --json', 8000).catch(() => ({ output: '' })),
      ws.execute('tenant metrics --json', 8000).catch(() => ({ output: '' })),
      ws.execute('tenant stats --json', 8000).catch(() => ({ output: '' })),
    ])
    tenants.value = parseTenants(tenantsRes.output)
    subscriptions.value = parseSubscriptions(subsRes.output)
    plans.value = parsePlans(plansRes.output)
    metrics.value = parseMetrics(metricsRes.output)
    stats.value = parseStats(statsRes.output)
  } catch (e) {
    message.error(t('tenant.msg.loadFailed') + ': ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function createTenant() {
  const name = createForm.name.trim()
  const slug = createForm.slug.trim()
  if (!name || !slug) {
    message.warning(t('tenant.msg.createFieldsEmpty'))
    return
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug)) {
    message.warning(t('tenant.msg.slugInvalid'))
    return
  }
  creating.value = true
  try {
    const parts = [`tenant create "${name.replace(/"/g, '\\"')}" "${slug.replace(/"/g, '\\"')}"`]
    parts.push(`--plan ${createForm.plan}`)
    if (createForm.owner.trim()) parts.push(`--owner "${createForm.owner.trim().replace(/"/g, '\\"')}"`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    if (/error|Error|失败/i.test(output) && !/"id"/.test(output)) {
      message.error(t('tenant.msg.createFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('tenant.msg.createSuccess'))
    showCreateModal.value = false
    resetCreateForm()
    await loadAll()
  } catch (e) {
    message.error(t('tenant.msg.createFailed') + ': ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

function openSubscribe(record) {
  subscribeForm.tenantId = record.id
  subscribeForm.plan = record.plan === 'free' ? 'starter' : record.plan
  subscribeForm.amount = null
  subscribeForm.duration = 30 * 24 * 60 * 60 * 1000
  subscribeTargetName.value = record.name
  showSubscribeModal.value = true
}

async function subscribeTenant() {
  subscribing.value = true
  try {
    const parts = [`tenant subscribe ${subscribeForm.tenantId}`]
    parts.push(`--plan ${subscribeForm.plan}`)
    if (subscribeForm.amount != null) parts.push(`--amount ${subscribeForm.amount}`)
    if (subscribeForm.duration) parts.push(`--duration-ms ${subscribeForm.duration}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    if (/error|Error|失败/i.test(output) && !/"id"/.test(output)) {
      message.error(t('tenant.msg.subscribeFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('tenant.msg.subscribeSuccess'))
    showSubscribeModal.value = false
    resetSubscribeForm()
    activeTab.value = 'subscriptions'
    await loadAll()
  } catch (e) {
    message.error(t('tenant.msg.subscribeFailed') + ': ' + (e?.message || e))
  } finally {
    subscribing.value = false
  }
}

async function changePlan(record, newPlan) {
  if (newPlan === record.plan) return
  try {
    const { output } = await ws.execute(`tenant configure ${record.id} --plan ${newPlan} --json`, 8000)
    if (/error|Error/i.test(output) && !/"id"/.test(output)) {
      message.error(t('tenant.msg.planChangeFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('tenant.msg.planChangeSuccess', { plan: planLabel(newPlan) }))
    await loadAll()
  } catch (e) {
    message.error(t('tenant.msg.planChangeFailed') + ': ' + (e?.message || e))
  }
}

async function setStatus(record, newStatus) {
  try {
    const { output } = await ws.execute(`tenant configure ${record.id} --status ${newStatus} --json`, 8000)
    if (/error|Error/i.test(output) && !/"id"/.test(output)) {
      message.error(t('tenant.msg.statusChangeFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(newStatus === 'active' ? t('tenant.msg.activated') : t('tenant.msg.suspended'))
    await loadAll()
  } catch (e) {
    message.error(t('tenant.msg.statusChangeFailed') + ': ' + (e?.message || e))
  }
}

async function deleteTenant(record) {
  try {
    const { output } = await ws.execute(`tenant delete ${record.id} --json`, 8000)
    if (/error|Error/i.test(output) && !/deleted|removed/.test(output)) {
      message.error(t('tenant.msg.deleteFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('tenant.msg.deleteSuccess'))
    await loadAll()
  } catch (e) {
    message.error(t('tenant.msg.deleteFailed') + ': ' + (e?.message || e))
  }
}

async function cancelSubscription(record) {
  try {
    const { output } = await ws.execute(`tenant cancel ${record.tenantId}`, 8000)
    if (/error|Error/i.test(output) && !/cancelled|cancel/i.test(output)) {
      message.error(t('tenant.msg.cancelFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('tenant.msg.cancelSuccess'))
    await loadAll()
  } catch (e) {
    message.error(t('tenant.msg.cancelFailed') + ': ' + (e?.message || e))
  }
}

async function checkQuota() {
  if (!quotaForm.tenantId) {
    message.warning(t('tenant.msg.tenantEmpty'))
    return
  }
  checking.value = true
  quotaResult.value = null
  try {
    const parts = [`tenant check-quota ${quotaForm.tenantId} ${quotaForm.metric}`]
    if (quotaForm.period.trim()) parts.push(`--period ${quotaForm.period.trim()}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 8000)
    const parsed = parseQuotaResult(output)
    if (!parsed) {
      message.error(t('tenant.msg.checkFailed') + ': ' + output.slice(0, 120))
      return
    }
    quotaResult.value = parsed
    if (parsed.exceeded) {
      message.warning(t('tenant.msg.exceededWarning'))
    }
  } catch (e) {
    message.error(t('tenant.msg.checkFailed') + ': ' + (e?.message || e))
  } finally {
    checking.value = false
  }
}

async function recordUsage() {
  if (!recordForm.tenantId) {
    message.warning(t('tenant.msg.tenantEmpty'))
    return
  }
  if (recordForm.value == null || recordForm.value < 0) {
    message.warning(t('tenant.msg.valueInvalid'))
    return
  }
  recording.value = true
  try {
    const parts = [`tenant record ${recordForm.tenantId} ${recordForm.metric} ${recordForm.value}`]
    if (recordForm.period.trim()) parts.push(`--period ${recordForm.period.trim()}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 8000)
    if (/error|Error/i.test(output) && !/"id"|"tenant"/.test(output)) {
      message.error(t('tenant.msg.recordFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('tenant.msg.recordSuccess'))
    showRecordModal.value = false
    resetRecordForm()
    await loadAll()
  } catch (e) {
    message.error(t('tenant.msg.recordFailed') + ': ' + (e?.message || e))
  } finally {
    recording.value = false
  }
}

function resetCreateForm() {
  createForm.name = ''
  createForm.slug = ''
  createForm.plan = 'free'
  createForm.owner = ''
}
function resetSubscribeForm() {
  subscribeForm.tenantId = ''
  subscribeForm.plan = 'pro'
  subscribeForm.amount = null
  subscribeForm.duration = 30 * 24 * 60 * 60 * 1000
  subscribeTargetName.value = ''
}
function resetRecordForm() {
  recordForm.tenantId = null
  recordForm.metric = 'api_calls'
  recordForm.value = 1
  recordForm.period = ''
}

// Pre-fill current period when modals open
function ensurePeriodDefault(form) {
  if (!form.period) form.period = currentPeriod()
}
ensurePeriodDefault(quotaForm)
ensurePeriodDefault(recordForm)

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

.tenant-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

/* Plan card */
.plan-fee {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 12px;
}
.plan-fee-unit {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}
.plan-section { margin-top: 12px; }
.plan-section-title {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}
.plan-quota-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  padding: 2px 0;
}
.plan-quota-label { color: var(--text-secondary); }
.plan-quota-value { color: var(--text-primary); font-family: monospace; }
</style>
