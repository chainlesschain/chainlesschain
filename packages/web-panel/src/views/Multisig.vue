<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">M-of-N 多签</h2>
        <p class="page-sub">marketplace.purchase 大额、DID 关键操作、跨链桥 outbound 的联合签名审批</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button @click="onSweep">
          <template #icon><ClockCircleOutlined /></template>
          扫过期
        </a-button>
      </a-space>
    </div>

    <!-- Stats -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="总提案" :value="proposals.length" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><FileTextOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="待签" :value="countByState.pending" :value-style="{ color: '#faad14', fontSize: '20px' }">
            <template #prefix><ClockCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="已达阈值" :value="countByState.reached" :value-style="{ color: '#13c2c2', fontSize: '20px' }">
            <template #prefix><CheckSquareOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="已执行" :value="countByState.consumed" :value-style="{ color: '#52c41a', fontSize: '20px' }">
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="已取消" :value="countByState.cancelled" :value-style="{ color: '#8c8c8c', fontSize: '20px' }">
            <template #prefix><CloseCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="已过期" :value="countByState.expired" :value-style="{ color: '#ff4d4f', fontSize: '20px' }">
            <template #prefix><ExclamationCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <a-tabs v-model:activeKey="activeTab">
      <!-- Proposals tab -->
      <a-tab-pane key="proposals" tab="提案列表">
        <div class="filter-bar">
          <a-radio-group v-model:value="stateFilter" size="small" button-style="solid">
            <a-radio-button value="">全部</a-radio-button>
            <a-radio-button value="pending">待签</a-radio-button>
            <a-radio-button value="reached">已达阈值</a-radio-button>
            <a-radio-button value="consumed">已执行</a-radio-button>
            <a-radio-button value="cancelled">已取消</a-radio-button>
            <a-radio-button value="expired">已过期</a-radio-button>
          </a-radio-group>
          <a-input-search
            v-model:value="domainFilter"
            placeholder="按 domain 过滤 (marketplace.purchase 等)"
            allow-clear
            style="max-width: 360px; margin-left: 12px;"
          />
        </div>
        <a-table
          :columns="columns"
          :data-source="filteredProposals"
          :loading="loading"
          :pagination="{ pageSize: 20, showSizeChanger: true, pageSizeOptions: ['10','20','50','100'] }"
          row-key="id"
          size="middle"
          @row-click="onRowClick"
          :row-class-name="() => 'multisig-row'"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'id'">
              <code style="font-size: 12px;">{{ record.id.slice(0, 16) }}…</code>
            </template>
            <template v-else-if="column.key === 'state'">
              <a-tag :color="stateColor(record.state)">{{ record.state }}</a-tag>
            </template>
            <template v-else-if="column.key === 'sigs'">
              <a-tag :color="record.n === record.m ? 'cyan' : 'default'">{{ record.m }}/{{ record.n }}</a-tag>
            </template>
            <template v-else-if="column.key === 'createdAt'">
              <a-tooltip :title="new Date(record.createdAtMs).toLocaleString()">
                {{ relTime(record.createdAtMs) }}
              </a-tooltip>
            </template>
            <template v-else-if="column.key === 'expiresAt'">
              <a-tooltip :title="new Date(record.expiresAtMs).toLocaleString()">
                <span :style="{ color: record.expiresAtMs < Date.now() ? '#ff4d4f' : 'inherit' }">
                  {{ relTime(record.expiresAtMs) }}
                </span>
              </a-tooltip>
            </template>
            <template v-else-if="column.key === 'actions'">
              <a-space size="small">
                <a-button size="small" @click.stop="openDetail(record)">详情</a-button>
                <a-button
                  v-if="record.state === 'pending' || record.state === 'reached'"
                  size="small"
                  danger
                  @click.stop="onCancel(record)"
                >取消</a-button>
                <a-button
                  v-if="record.state === 'reached' && record.domain === 'marketplace.purchase'"
                  size="small"
                  type="primary"
                  @click.stop="onConsume(record)"
                >执行购买</a-button>
                <a-button
                  v-if="record.state === 'reached' && record.domain === 'crosschain.bridge.outbound'"
                  size="small"
                  type="primary"
                  @click.stop="onBridgeConsume(record)"
                >执行跨链桥</a-button>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- Policies tab -->
      <a-tab-pane key="policies" tab="域策略">
        <a-empty v-if="policies.length === 0" description="暂无域策略 — 用 CLI 配置: cc multisig policy set <domain> --m <M> --members <json>" />
        <a-list v-else :data-source="policies" item-layout="vertical">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-card>
                <h4 style="margin: 0 0 8px 0;">
                  <a-tag color="purple">{{ item.domain }}</a-tag>
                  <span style="margin-left: 8px; color: var(--text-secondary);">
                    {{ item.policy.m }}-of-{{ item.policy.members.length }}
                    <a-tag v-if="item.policy.requirePqc" color="orange" style="margin-left: 8px;">requirePQC</a-tag>
                  </span>
                </h4>
                <a-descriptions size="small" :column="2">
                  <a-descriptions-item label="阈值 M">{{ item.policy.m }}</a-descriptions-item>
                  <a-descriptions-item label="成员数 N">{{ item.policy.members.length }}</a-descriptions-item>
                  <a-descriptions-item label="算法">
                    <a-tag v-for="a in (item.policy.algorithms || [])" :key="a" size="small">{{ a }}</a-tag>
                  </a-descriptions-item>
                  <a-descriptions-item label="默认有效期">
                    {{ Math.round((item.policy.defaultExpiryMs || 86400000) / 1000 / 60 / 60) }}h
                  </a-descriptions-item>
                </a-descriptions>
                <details style="margin-top: 8px;">
                  <summary style="cursor: pointer; color: var(--text-secondary);">展开成员列表 ({{ item.policy.members.length }})</summary>
                  <a-table
                    :columns="memberColumns"
                    :data-source="item.policy.members"
                    :pagination="false"
                    size="small"
                    row-key="did"
                    style="margin-top: 8px;"
                  />
                </details>
              </a-card>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>
    </a-tabs>

    <!-- Detail drawer -->
    <a-drawer
      v-model:open="detailOpen"
      :title="detail ? `提案 ${detail.proposal.id}` : '提案详情'"
      width="640"
      destroy-on-close
    >
      <div v-if="detail">
        <a-descriptions :column="1" bordered size="small">
          <a-descriptions-item label="Domain">{{ detail.proposal.domain }}</a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-tag :color="stateColor(detail.proposal.state)">{{ detail.proposal.state }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="阈值">
            {{ detail.proposal.thresholdM }}-of-{{ detail.proposal.memberSet.length }}
          </a-descriptions-item>
          <a-descriptions-item label="已签 / 需签">
            {{ detail.signatures.length }} / {{ detail.proposal.thresholdM }}
          </a-descriptions-item>
          <a-descriptions-item label="发起方">{{ detail.proposal.initiatorDid }}</a-descriptions-item>
          <a-descriptions-item label="创建时间">{{ new Date(detail.proposal.createdAtMs).toLocaleString() }}</a-descriptions-item>
          <a-descriptions-item label="过期时间">{{ new Date(detail.proposal.expiresAtMs).toLocaleString() }}</a-descriptions-item>
          <a-descriptions-item label="Payload">
            <pre style="margin: 0; max-height: 240px; overflow: auto; font-size: 12px;">{{ detail.proposal.payload ? JSON.stringify(detail.proposal.payload, null, 2) : detail.proposal.payloadJcs }}</pre>
          </a-descriptions-item>
        </a-descriptions>

        <h4 style="margin: 16px 0 8px 0;">签名列表 ({{ detail.signatures.length }})</h4>
        <a-list :data-source="detail.signatures" size="small">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #title>
                  <CheckCircleOutlined style="color: #52c41a; margin-right: 6px;" />
                  <code style="font-size: 12px;">{{ item.signerDid }}</code>
                </template>
                <template #description>
                  {{ item.alg }} — {{ new Date(item.signedAtMs).toLocaleString() }}
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>

        <a-divider />
        <a-alert
          message="签名 / 执行操作需通过 CLI 提供私钥"
          description="Web shell 不直接持有私钥（接 Unified KeyStore 仍未收口）。本面板用于查看提案状态，签名请用 cc multisig sign；执行已 reached 的提案可在此面板按 domain 直达（marketplace.purchase / crosschain.bridge.outbound），其它 domain 走 cc multisig finalize。"
          type="info"
          show-icon
          style="margin-bottom: 12px;"
        />
        <a-space>
          <a-button
            v-if="detail.proposal.state === 'pending' || detail.proposal.state === 'reached'"
            danger
            @click="onCancel(detail.proposal)"
          >取消提案</a-button>
          <a-button
            v-if="detail.proposal.state === 'reached' && detail.proposal.domain === 'marketplace.purchase'"
            type="primary"
            @click="onConsume(detail.proposal)"
          >执行购买 (cc marketplace consume)</a-button>
          <a-button
            v-if="detail.proposal.state === 'reached' && detail.proposal.domain === 'crosschain.bridge.outbound'"
            type="primary"
            @click="onBridgeConsume(detail.proposal)"
          >执行跨链桥 (cc crosschain bridge-consume)</a-button>
          <a-button
            v-if="detail.proposal.state === 'reached' && detail.proposal.domain !== 'marketplace.purchase' && detail.proposal.domain !== 'crosschain.bridge.outbound'"
            type="primary"
            @click="onFinalize(detail.proposal)"
          >finalize (cc multisig finalize)</a-button>
        </a-space>
      </div>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  ReloadOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CheckSquareOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
} from '@ant-design/icons-vue'
import { message, Modal } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import { useShellMode } from '../composables/useShellMode.js'

const ws = useWsStore()
const { isEmbedded } = useShellMode()

// #21 B.2 — desktop web-shell registers in-process multisig.* + marketplace.consume
// topics that avoid the 6-10s asar:true subprocess cold-start. cc serve mode
// (isEmbedded=false) keeps the original ws.executeJson('cc multisig ...') path
// since there's no asar overhead in standalone node.
async function callMultisigTopic(topic, msg, fallbackCmd, timeoutMs = 8000) {
  if (isEmbedded) {
    const reply = await ws.sendRaw({ type: topic, ...msg }, timeoutMs)
    if (!reply?.ok) {
      const err = reply?.error
      throw new Error(typeof err === 'string' ? err : err?.message || `${topic} failed`)
    }
    return reply.result
  }
  return ws.executeJson(fallbackCmd, timeoutMs)
}
const loading = ref(false)
const proposals = ref([])
const policies = ref([])
const activeTab = ref('proposals')
const stateFilter = ref('')
const domainFilter = ref('')

const detailOpen = ref(false)
const detail = ref(null)

const columns = [
  { title: 'ID', key: 'id', width: 200 },
  { title: 'Domain', dataIndex: 'domain', width: 220 },
  { title: '状态', key: 'state', width: 110 },
  { title: '阈值', key: 'sigs', width: 80 },
  { title: '创建', key: 'createdAt', width: 140 },
  { title: '过期', key: 'expiresAt', width: 140 },
  { title: '操作', key: 'actions', width: 240, fixed: 'right' },
]

const memberColumns = [
  { title: 'DID', dataIndex: 'did' },
  { title: 'Alg', dataIndex: 'alg', width: 200 },
]

const countByState = computed(() => {
  const c = { pending: 0, reached: 0, consumed: 0, cancelled: 0, expired: 0 }
  for (const p of proposals.value) {
    if (c[p.state] !== undefined) c[p.state] += 1
  }
  return c
})

const filteredProposals = computed(() => {
  return proposals.value.filter((p) => {
    if (stateFilter.value && p.state !== stateFilter.value) return false
    if (domainFilter.value && !p.domain.toLowerCase().includes(domainFilter.value.toLowerCase())) return false
    return true
  })
})

function stateColor(state) {
  switch (state) {
    case 'pending': return 'gold'
    case 'reached': return 'cyan'
    case 'consumed': return 'green'
    case 'cancelled': return 'default'
    case 'expired': return 'red'
    default: return 'default'
  }
}

function relTime(ms) {
  const diff = ms - Date.now()
  const absMin = Math.abs(diff) / 60_000
  if (absMin < 60) return diff > 0 ? `${Math.round(absMin)} 分钟后` : `${Math.round(absMin)} 分钟前`
  const absH = absMin / 60
  if (absH < 24) return diff > 0 ? `${Math.round(absH)} 小时后` : `${Math.round(absH)} 小时前`
  const absD = absH / 24
  return diff > 0 ? `${Math.round(absD)} 天后` : `${Math.round(absD)} 天前`
}

async function loadAll() {
  loading.value = true
  try {
    const [propList, polList] = await Promise.all([
      callMultisigTopic(
        'multisig.list',
        { limit: 500 },
        'multisig list --limit 500 --json',
        10000,
      ).catch(() => []),
      // Policies don't have a list command in Phase 1 yet — try domains we know about
      Promise.all(
        ['marketplace.purchase', 'crosschain.bridge.outbound', 'did.rotate'].map(async (d) => {
          try {
            const p = await callMultisigTopic(
              'multisig.policy.show',
              { domain: d },
              `multisig policy show ${d} --json`,
              8000,
            )
            return { domain: d, policy: p, updatedAtMs: Date.now() }
          } catch {
            return null
          }
        }),
      ).then((arr) => arr.filter(Boolean)),
    ])
    proposals.value = Array.isArray(propList) ? propList : []
    policies.value = Array.isArray(polList) ? polList : []
  } catch (err) {
    message.error('加载失败: ' + (err.message || err))
  } finally {
    loading.value = false
  }
}

async function openDetail(record) {
  try {
    const got = await callMultisigTopic(
      'multisig.show',
      { proposalId: record.id },
      `multisig show ${record.id} --json`,
      8000,
    )
    detail.value = got
    detailOpen.value = true
  } catch (err) {
    message.error('加载详情失败: ' + (err.message || err))
  }
}

function onRowClick(record) {
  return { onClick: () => openDetail(record) }
}

async function onCancel(record) {
  Modal.confirm({
    title: `取消提案 ${record.id.slice(0, 12)}…?`,
    content: '已签名的成员需要重新发起新提案。此操作不可撤销。',
    okText: '取消提案',
    okType: 'danger',
    cancelText: '保持',
    onOk: async () => {
      try {
        const r = await callMultisigTopic(
          'multisig.cancel',
          { proposalId: record.id, reason: 'web-shell' },
          `multisig cancel ${record.id} --reason web-shell --json`,
          8000,
        )
        if (r.ok) {
          message.success('提案已取消')
          detailOpen.value = false
          await loadAll()
        } else {
          message.error('取消失败: ' + r.reason)
        }
      } catch (err) {
        message.error(err.message || String(err))
      }
    },
  })
}

async function onConsume(record) {
  try {
    const r = await callMultisigTopic(
      'marketplace.consume',
      { proposalId: record.id },
      `marketplace consume ${record.id} --json`,
      10000,
    )
    if (r.status === 'consumed') {
      message.success(`订单 ${r.order.itemId} 已执行 (¥${(r.order.amountFen / 100).toFixed(2)})`)
      detailOpen.value = false
      await loadAll()
    } else {
      message.error('执行失败: ' + (r.reason || JSON.stringify(r)))
    }
  } catch (err) {
    message.error(err.message || String(err))
  }
}

// #21 B.5 Layer 1 PR3 — crosschain bridge outbound consume.
// Web-shell (isEmbedded=true) path: in-process topic finalizes the proposal
//   and returns {status, proposalId, payload}. cc_bridges row insert still
//   requires `cc crosschain bridge-consume <id>` (web-shell doesn't own the
//   crosschain DB handle). Modal prompts the user.
// cc serve (isEmbedded=false) path: spawnSync the CLI, which returns
//   {status, proposalId, bridgeId, fee, payload} — bridgeId presence signals
//   the row was actually inserted; no follow-up needed.
async function onBridgeConsume(record) {
  try {
    const r = await callMultisigTopic(
      'crosschain.bridge.consume',
      { proposalId: record.id },
      `crosschain bridge-consume ${record.id} --json`,
      10000,
    )
    if (r.status === 'consumed') {
      const p = r.payload || {}
      const route = `${p.fromChain || '?'} → ${p.toChain || '?'} (amount ${p.amount ?? '?'})`
      if (r.bridgeId) {
        message.success(`跨链桥已执行: ${route} · bridgeId ${r.bridgeId}`)
      } else {
        message.success(`跨链桥提案已 finalize: ${route}`)
        Modal.info({
          title: '跨链桥提案 finalize 完成',
          content: `Proposal 已标记 consumed。\n\n在 CLI 侧运行以下命令完成 cc_bridges 行插入：\n\n  cc crosschain bridge-consume ${record.id}\n\nweb-shell 不持有 crosschain DB 句柄，实际 SQLite 插入仍由 CLI 端执行。`,
        })
      }
      detailOpen.value = false
      await loadAll()
    } else {
      message.error('执行失败: ' + (r.reason || JSON.stringify(r)))
    }
  } catch (err) {
    message.error(err.message || String(err))
  }
}

async function onFinalize(record) {
  try {
    const r = await callMultisigTopic(
      'multisig.finalize',
      { proposalId: record.id },
      `multisig finalize ${record.id} --json`,
      8000,
    )
    if (r.ok) {
      message.success('提案已 finalize')
      detailOpen.value = false
      await loadAll()
    } else {
      message.error('Finalize 失败: ' + r.reason)
    }
  } catch (err) {
    message.error(err.message || String(err))
  }
}

async function onSweep() {
  try {
    const r = await callMultisigTopic(
      'multisig.sweep',
      {},
      'multisig sweep --json',
      8000,
    )
    if (r.expired === 0) {
      message.info('无过期提案')
    } else {
      message.success(`已标记 ${r.expired} 条提案为过期`)
      await loadAll()
    }
  } catch (err) {
    message.error(err.message || String(err))
  }
}

onMounted(loadAll)
</script>

<style scoped>
.page-title {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}
.page-sub {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 4px 0 0 0;
}
.filter-bar {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
}
.multisig-row {
  cursor: pointer;
}
.multisig-row:hover {
  background: var(--bg-hover, rgba(22, 119, 255, 0.05));
}
</style>
