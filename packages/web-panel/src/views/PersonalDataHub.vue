<template>
  <div class="pdh-page">
    <!-- Page header -->
    <div class="pdh-header">
      <div>
        <h2 class="page-title">个人数据中台</h2>
        <p class="page-sub">
          让数据回归个人 — 各 app 数据本地加密落盘，本地 LLM 跨源分析，零云端外传。
        </p>
      </div>
      <a-space>
        <a-button :loading="loading.refresh" @click="refresh">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button type="primary" ghost @click="auditOpen = true">
          <template #icon><FileSearchOutlined /></template>
          审计日志
        </a-button>
      </a-space>
    </div>

    <!-- Health row -->
    <a-row :gutter="16" style="margin-bottom: 16px;">
      <a-col :xs="24" :sm="12" :md="6">
        <a-card size="small" :title="'Vault'">
          <template #extra>
            <a-tag :color="health?.vault?.ok ? 'green' : 'red'">
              {{ health?.vault?.ok ? '正常' : '未就绪' }}
            </a-tag>
          </template>
          <div class="kv">schema v{{ health?.vault?.schemaVersion ?? '?' }}</div>
          <div class="kv" v-if="stats?.vault">
            事件 {{ stats.vault.events }} · 联系人 {{ stats.vault.persons }}
          </div>
          <div class="kv" v-if="stats?.vault">
            地点 {{ stats.vault.places }} · 商品 {{ stats.vault.items }} · 主题 {{ stats.vault.topics }}
          </div>
        </a-card>
      </a-col>

      <a-col :xs="24" :sm="12" :md="6">
        <a-card size="small" :title="'本地 LLM'">
          <template #extra>
            <a-tag :color="health?.llm?.ok ? (health.llm.isLocal ? 'green' : 'orange') : 'red'">
              {{ health?.llm?.ok ? (health.llm.isLocal ? '本地' : '非本地') : '未就绪' }}
            </a-tag>
          </template>
          <div class="kv">{{ health?.llm?.name || '—' }}</div>
          <div class="kv hint" v-if="health?.llm?.ok && !health.llm.isLocal">
            ⚠️ 非本地 — ask 会被隐私 gate 拒绝，除非显式 acceptNonLocal
          </div>
        </a-card>
      </a-col>

      <a-col :xs="24" :sm="12" :md="6">
        <a-card size="small" :title="'KG 索引'">
          <template #extra>
            <a-tag :color="health?.kgSink?.ok ? 'green' : 'default'">
              {{ health?.kgSink?.ok ? '已连接' : '不可用' }}
            </a-tag>
          </template>
          <div class="kv">events / persons → cc knowledge-graph 实体 + 关系</div>
        </a-card>
      </a-col>

      <a-col :xs="24" :sm="12" :md="6">
        <a-card size="small" :title="'RAG 索引'">
          <template #extra>
            <a-tag :color="health?.ragSink?.ok ? 'green' : 'default'">
              {{ health?.ragSink?.ok ? '已连接' : '不可用' }}
            </a-tag>
          </template>
          <div class="kv">文本 → BM25（vector 留待后续 phase）</div>
        </a-card>
      </a-col>
    </a-row>

    <!-- Ask box -->
    <a-card style="margin-bottom: 16px;">
      <template #title>
        <a-space><MessageOutlined /><span>问我数据</span></a-space>
      </template>
      <a-textarea
        v-model:value="askInput"
        :rows="2"
        placeholder="例：上个月在淘宝总共花了多少？／我妈生日那周买了啥送哪儿？"
        @keydown.enter.exact.prevent="ask"
      />
      <div style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center;">
        <a-checkbox v-model:checked="acceptNonLocal">允许非本地 LLM (volcengine / anthropic 等)</a-checkbox>
        <a-button type="primary" :loading="loading.ask" :disabled="!askInput.trim()" @click="ask">
          <template #icon><SendOutlined /></template>
          提问
        </a-button>
      </div>

      <div v-if="askError" style="margin-top: 12px;">
        <a-alert type="error" show-icon :message="askError" />
      </div>

      <div v-if="askResult" style="margin-top: 12px;">
        <a-alert
          v-if="askResult.warning === 'no-facts'"
          type="warning"
          show-icon
          message="vault 里没找到匹配的事件（'no-facts'）—— 先同步几个 adapter 让数据进 vault"
          style="margin-bottom: 12px;"
        />
        <a-alert
          v-else-if="askResult.warning === 'hallucinated-citations'"
          type="warning"
          show-icon
          :message="`LLM 引用了 ${askResult.hallucinatedCitations?.length || 0} 个不存在的 event id —— 模型在编造`"
          style="margin-bottom: 12px;"
        />
        <div class="answer">{{ askResult.answer }}</div>
        <div style="margin-top: 8px; font-size: 12px; color: var(--text-color-secondary, #888);">
          引用 {{ askResult.citations?.length || 0 }} 条事实 · {{ askResult.facts?.length || 0 }} facts 入 prompt ·
          {{ askResult.durationMs }}ms · {{ askResult.model }}
        </div>
      </div>
    </a-card>

    <!-- Adapters -->
    <a-card style="margin-bottom: 16px;">
      <template #title>
        <a-space><AppstoreOutlined /><span>Adapters</span></a-space>
      </template>
      <template #extra>
        <a-space>
          <a-button @click="addMock" :loading="loading.addMock">
            注册 MockAdapter（开发）
          </a-button>
          <a-button type="primary" @click="syncAll" :loading="loading.syncAll" :disabled="!adapters.length">
            同步全部
          </a-button>
        </a-space>
      </template>

      <a-table
        v-if="adapters.length"
        :columns="adapterColumns"
        :data-source="adapters"
        :pagination="false"
        :row-key="(r) => r.name"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'sensitivity'">
            <a-tag :color="sensitivityColor(record.sensitivity)">{{ record.sensitivity }}</a-tag>
            <a-tag v-if="record.legalGate" color="red" style="margin-left: 4px;">需法律确认</a-tag>
          </template>
          <template v-else-if="column.key === 'capabilities'">
            <a-tag v-for="c in record.capabilities" :key="c" style="margin-right: 4px;">{{ c }}</a-tag>
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button size="small" :loading="loading.sync[record.name]" @click="syncOne(record.name)">
                同步
              </a-button>
              <a-popconfirm
                :title="`从注册表移除 ${record.name}？（vault 数据不会删除）`"
                @confirm="unregisterAdapter(record.name)"
              >
                <a-button size="small" danger>移除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
      <a-empty v-else description="无已注册 adapter — 点上方按钮注册 MockAdapter 看效果" />

      <!-- Last sync report -->
      <div v-if="lastSync" style="margin-top: 12px;">
        <a-alert
          :type="lastSync.status === 'ok' ? 'success' : 'error'"
          show-icon
          :message="`同步 ${lastSync.adapter}: ${lastSync.status}`"
          :description="syncSummary(lastSync)"
        />
      </div>
    </a-card>

    <!-- Audit drawer -->
    <a-drawer
      v-model:open="auditOpen"
      title="审计日志（数据 lineage）"
      placement="right"
      width="600"
      @after-open-change="loadAudit"
    >
      <a-table
        :columns="auditColumns"
        :data-source="auditRows"
        :pagination="{ pageSize: 20, size: 'small' }"
        :row-key="(r) => r.id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'at'">
            {{ new Date(record.at).toLocaleString() }}
          </template>
          <template v-else-if="column.key === 'details'">
            <code style="font-size: 11px;">{{ record.details || '—' }}</code>
          </template>
        </template>
      </a-table>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import {
  ReloadOutlined, FileSearchOutlined, MessageOutlined, SendOutlined,
  AppstoreOutlined,
} from '@ant-design/icons-vue'
import { usePersonalDataHub } from '../composables/usePersonalDataHub.js'

const hub = usePersonalDataHub()

// State
const health = ref(null)
const stats = ref(null)
const adapters = ref([])
const askInput = ref('')
const askResult = ref(null)
const askError = ref('')
const acceptNonLocal = ref(false)
const auditOpen = ref(false)
const auditRows = ref([])
const lastSync = ref(null)

const loading = reactive({
  refresh: false,
  ask: false,
  addMock: false,
  syncAll: false,
  sync: {},      // per-adapter
  audit: false,
})

// Table columns
const adapterColumns = [
  { title: '名称', dataIndex: 'name', key: 'name', width: 140 },
  { title: '版本', dataIndex: 'version', key: 'version', width: 80 },
  { title: '能力', key: 'capabilities' },
  { title: '敏感度', key: 'sensitivity', width: 140 },
  { title: '操作', key: 'actions', width: 160, align: 'right' },
]
const auditColumns = [
  { title: '时间', key: 'at', dataIndex: 'at', width: 170 },
  { title: '动作', dataIndex: 'action', key: 'action', width: 200 },
  { title: '详情', key: 'details' },
]

function sensitivityColor(s) {
  return s === 'high' ? 'red' : s === 'medium' ? 'orange' : 'default'
}

function syncSummary(r) {
  if (!r) return ''
  const ec = r.entityCounts || {}
  return `events=${ec.events ?? 0} persons=${ec.persons ?? 0} | raw=${r.rawCount ?? 0} invalid=${r.invalidCount ?? 0} | KG triples=${r.kgTripleCount ?? 0} RAG docs=${r.ragDocCount ?? 0} | ${r.durationMs ?? 0}ms`
}

// Actions
async function refresh() {
  loading.refresh = true
  try {
    health.value = await hub.health()
    stats.value = await hub.stats()
    adapters.value = await hub.listAdapters()
  } catch (err) {
    message.error('刷新失败: ' + err.message)
  } finally {
    loading.refresh = false
  }
}

async function ask() {
  if (!askInput.value.trim()) return
  loading.ask = true
  askError.value = ''
  askResult.value = null
  try {
    askResult.value = await hub.ask(askInput.value.trim(), { acceptNonLocal: acceptNonLocal.value })
  } catch (err) {
    askError.value = err.message
  } finally {
    loading.ask = false
  }
}

async function addMock() {
  loading.addMock = true
  try {
    await hub.registerMock({ count: 30, seed: Date.now() % 1000 })
    await refresh()
    message.success('MockAdapter 已注册（30 条 mock 数据 ready 同步）')
  } catch (err) {
    message.error('注册失败: ' + err.message)
  } finally {
    loading.addMock = false
  }
}

async function syncOne(name) {
  loading.sync[name] = true
  try {
    lastSync.value = await hub.syncAdapter(name)
    await refresh()
  } catch (err) {
    message.error(`同步 ${name} 失败: ${err.message}`)
  } finally {
    loading.sync[name] = false
  }
}

async function syncAll() {
  loading.syncAll = true
  try {
    const reports = await hub.syncAll()
    lastSync.value = reports?.[reports.length - 1] || null
    await refresh()
    message.success(`已同步 ${reports?.length || 0} 个 adapter`)
  } catch (err) {
    message.error('同步失败: ' + err.message)
  } finally {
    loading.syncAll = false
  }
}

async function unregisterAdapter(name) {
  try {
    await hub.unregister(name)
    await refresh()
  } catch (err) {
    message.error('移除失败: ' + err.message)
  }
}

async function loadAudit(open) {
  if (!open) return
  loading.audit = true
  try {
    auditRows.value = await hub.recentAudit({ limit: 200 })
  } catch (err) {
    message.error('审计日志加载失败: ' + err.message)
  } finally {
    loading.audit = false
  }
}

onMounted(refresh)
</script>

<style scoped>
.pdh-page {
  padding: 16px;
  max-width: 1400px;
  margin: 0 auto;
}
.pdh-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  gap: 16px;
  flex-wrap: wrap;
}
.page-title {
  margin: 0 0 4px 0;
  font-size: 22px;
  font-weight: 600;
}
.page-sub {
  margin: 0;
  color: var(--text-color-secondary, #888);
  font-size: 13px;
}
.kv {
  font-size: 13px;
  color: var(--text-color, #333);
  line-height: 1.6;
}
.kv.hint {
  color: #faad14;
  font-size: 12px;
  margin-top: 4px;
}
.answer {
  white-space: pre-wrap;
  font-size: 14px;
  line-height: 1.7;
  background: var(--bg-elevated, #fafafa);
  padding: 12px;
  border-radius: 6px;
  border-left: 3px solid #1677ff;
}
</style>
