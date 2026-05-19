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
        <div v-if="askResult.citations?.length" style="margin-top: 8px;">
          <span style="font-size: 12px; color: var(--text-color-secondary, #888);">事件链接（点击查看明细 / PDF 解密结果）：</span>
          <a-space style="margin-top: 4px;" wrap>
            <a-tag
              v-for="cid in askResult.citations"
              :key="cid"
              color="blue"
              style="cursor: pointer;"
              @click="showEventDetail(cid)"
            >
              {{ cid }}
            </a-tag>
          </a-space>
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
          <a-button @click="emailConfigOpen = true">
            <template #icon><MailOutlined /></template>
            添加邮箱账号
          </a-button>
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

      <!-- Phase 5.7 — live sync progress -->
      <div v-if="syncProgress.active" style="margin-top: 12px;">
        <a-card size="small" :bordered="true">
          <div class="kv" style="margin-bottom: 4px;">
            <strong>同步进行中</strong> · {{ syncProgress.adapter }} · {{ syncProgress.phase || '...' }}
            <span v-if="syncProgress.attempt && syncProgress.attempt > 1" style="color: #faad14;">
              (重试 #{{ syncProgress.attempt }})
            </span>
          </div>
          <a-progress
            v-if="syncProgress.total > 0"
            :percent="Math.round((syncProgress.current / syncProgress.total) * 100)"
            :status="syncProgress.errorMessage ? 'exception' : 'active'"
            size="small"
          />
          <a-progress v-else :percent="0" status="active" size="small" />
          <div class="kv hint" v-if="syncProgress.mailbox">
            邮箱 {{ syncProgress.mailbox }} · {{ syncProgress.current }} / {{ syncProgress.total }}
          </div>
          <div v-if="syncProgress.errorMessage" class="kv hint" style="color: #ff4d4f;">
            {{ syncProgress.errorMessage }}
          </div>
        </a-card>
      </div>

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

    <!-- Email config drawer (Phase 5.6) -->
    <a-drawer
      v-model:open="emailConfigOpen"
      title="添加邮箱账号"
      placement="right"
      width="560"
      :destroy-on-close="true"
      @close="resetEmailForm"
    >
      <a-alert
        message="数据回归个人 — 凭证落本地加密文件（与 vault 主密钥同目录），同步动作 100% 本地。"
        type="info"
        show-icon
        style="margin-bottom: 16px;"
      />

      <a-form layout="vertical" :model="emailForm">
        <a-form-item label="邮箱服务商" required>
          <a-select v-model:value="emailForm.provider" placeholder="选择服务商">
            <a-select-option value="qq">QQ 邮箱 (imap.qq.com)</a-select-option>
            <a-select-option value="163">网易邮箱 163/126</a-select-option>
            <a-select-option value="189">189 邮箱</a-select-option>
            <a-select-option value="outlook">Outlook / Hotmail</a-select-option>
            <a-select-option value="gmail">Gmail</a-select-option>
            <a-select-option value="custom">自定义 IMAP</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="邮箱地址" required>
          <a-input v-model:value="emailForm.email" placeholder="you@qq.com" autocomplete="off" />
        </a-form-item>

        <a-form-item required>
          <template #label>
            <a-space>
              <span>授权码（非登录密码）</span>
              <a-tooltip :title="providerAuthHint(emailForm.provider)">
                <InfoCircleOutlined style="color: #888;" />
              </a-tooltip>
            </a-space>
          </template>
          <a-input-password
            v-model:value="emailForm.authCode"
            placeholder="例：QQ 邮箱 设置 → 账户 → 开启 IMAP/SMTP → 生成的授权码"
            autocomplete="off"
          />
        </a-form-item>

        <a-form-item v-if="emailForm.provider === 'custom'" label="IMAP host">
          <a-input v-model:value="emailForm.host" placeholder="mail.example.com" />
        </a-form-item>
        <a-form-item v-if="emailForm.provider === 'custom'" label="端口">
          <a-input-number v-model:value="emailForm.port" :min="1" :max="65535" :default-value="993" />
        </a-form-item>

        <a-divider orientation="left" plain>PDF 账单解密提示（可选）</a-divider>
        <p class="hint">银行 PDF 月结大多加密；提供几个常用候选项让 Phase 5.5 自动解锁：</p>
        <a-form-item label="身份证后 6 位">
          <a-input v-model:value="emailForm.pdfPasswordHints.idCardLast6" placeholder="123456" autocomplete="off" />
        </a-form-item>
        <a-form-item label="手机后 6 位">
          <a-input v-model:value="emailForm.pdfPasswordHints.phoneLast6" placeholder="123456" autocomplete="off" />
        </a-form-item>
        <a-form-item label="信用卡尾 6 位">
          <a-input v-model:value="emailForm.pdfPasswordHints.cardLast6" placeholder="123456" autocomplete="off" />
        </a-form-item>

        <div v-if="emailTestResult" style="margin-top: 8px;">
          <a-alert
            :type="emailTestResult.ok ? 'success' : 'error'"
            show-icon
            :message="emailTestResult.ok ? '凭证有效 — 可以保存' : `认证失败: ${emailTestResult.reason || emailTestResult.error}`"
          />
        </div>
      </a-form>

      <template #footer>
        <a-space>
          <a-button @click="emailConfigOpen = false">取消</a-button>
          <a-button :loading="loading.testEmail" :disabled="!emailFormValid" @click="testEmailAuth">
            测试连接
          </a-button>
          <a-button
            type="primary"
            :loading="loading.saveEmail"
            :disabled="!emailFormValid || !emailTestResult?.ok"
            @click="saveEmail"
          >
            保存并注册
          </a-button>
        </a-space>
      </template>
    </a-drawer>

    <!-- Event detail drawer (Phase 5.6) -->
    <a-drawer
      v-model:open="eventDetailOpen"
      :title="eventDetail ? `事件 ${eventDetail.event.id}` : '加载中...'"
      placement="right"
      width="640"
      :destroy-on-close="true"
    >
      <template v-if="eventDetail">
        <a-descriptions :column="1" size="small" bordered>
          <a-descriptions-item label="类型">{{ eventDetail.event.subtype }}</a-descriptions-item>
          <a-descriptions-item label="发生于">
            {{ new Date(eventDetail.event.occurredAt).toLocaleString() }}
          </a-descriptions-item>
          <a-descriptions-item label="actor">{{ eventDetail.event.actor }}</a-descriptions-item>
          <a-descriptions-item v-if="eventDetail.event.content?.title" label="标题">
            {{ eventDetail.event.content.title }}
          </a-descriptions-item>
          <a-descriptions-item v-if="eventDetail.event.source?.adapter" label="来源 adapter">
            {{ eventDetail.event.source.adapter }} @ v{{ eventDetail.event.source.adapterVersion }}
          </a-descriptions-item>
        </a-descriptions>

        <a-divider v-if="eventDetail.classification" orientation="left" plain>分类</a-divider>
        <div v-if="eventDetail.classification">
          <a-tag color="blue">{{ eventDetail.classification.category }}</a-tag>
          <a-tag>{{ eventDetail.classification.layer }}</a-tag>
          <span style="margin-left: 8px;">置信 {{ Math.round((eventDetail.classification.confidence || 0) * 100) }}%</span>
        </div>

        <a-divider v-if="eventDetail.extraction" orientation="left" plain>结构化字段（{{ eventDetail.extraction.template }}）</a-divider>
        <pre v-if="eventDetail.extraction" class="json-pre">{{ JSON.stringify(eventDetail.extraction.fields, null, 2) }}</pre>

        <a-divider v-if="eventDetail.extraction?.pdfExtraction" orientation="left" plain>PDF 解密 / 解析</a-divider>
        <a-list
          v-if="eventDetail.extraction?.pdfExtraction"
          :data-source="eventDetail.extraction.pdfExtraction"
          size="small"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta :title="item.filename">
                <template #description>
                  <div>
                    <a-tag :color="item.decrypted ? 'green' : 'red'">
                      {{ item.decrypted ? '已解密' : '解密失败' }}
                    </a-tag>
                    <span style="margin-left: 6px;">尝试 {{ item.attempted }} 次</span>
                    <span v-if="item.transactionsExtracted != null" style="margin-left: 6px;">
                      · 提取 {{ item.transactionsExtracted }} 条交易
                    </span>
                  </div>
                  <div v-if="item.error" class="hint" style="margin-top: 4px;">
                    {{ item.error }}
                  </div>
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>

        <template v-if="eventDetail.extraction?.fields?.transactions?.length">
          <a-divider orientation="left" plain>交易明细</a-divider>
          <a-table
            :columns="transactionColumns"
            :data-source="eventDetail.extraction.fields.transactions"
            :pagination="{ pageSize: 10, size: 'small' }"
            :row-key="(_, i) => i"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'occurredAt'">
                {{ new Date(record.occurredAtMs).toLocaleDateString() }}
              </template>
              <template v-else-if="column.key === 'amount'">
                <span :class="record.amount.direction === 'in' ? 'amount-in' : 'amount-out'">
                  {{ record.amount.direction === 'in' ? '+' : '-' }}{{ record.amount.value.toFixed(2) }}
                  {{ record.amount.currency }}
                </span>
              </template>
            </template>
          </a-table>
        </template>
      </template>
      <a-empty v-else description="无事件数据" />
    </a-drawer>

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
import { ref, reactive, onMounted, computed } from 'vue'
import { message } from 'ant-design-vue'
import {
  ReloadOutlined, FileSearchOutlined, MessageOutlined, SendOutlined,
  AppstoreOutlined, MailOutlined, InfoCircleOutlined,
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

// Phase 5.6 — email config + event detail
const emailConfigOpen = ref(false)
const emailForm = reactive({
  provider: 'qq',
  email: '',
  authCode: '',
  host: '',
  port: 993,
  pdfPasswordHints: {
    idCardLast6: '',
    phoneLast6: '',
    cardLast6: '',
  },
})
const emailTestResult = ref(null)
const eventDetailOpen = ref(false)
const eventDetail = ref(null)
const emailAccounts = ref([])

// Phase 5.7 — live sync progress state
const syncProgress = reactive({
  active: false,
  adapter: '',
  phase: '',
  mailbox: '',
  current: 0,
  total: 0,
  attempt: 1,
  errorMessage: '',
})

const loading = reactive({
  refresh: false,
  ask: false,
  addMock: false,
  syncAll: false,
  sync: {},      // per-adapter
  audit: false,
  testEmail: false,
  saveEmail: false,
  eventDetail: false,
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
const transactionColumns = [
  { title: '日期', key: 'occurredAt', width: 100 },
  { title: '描述', dataIndex: 'description', key: 'description' },
  { title: '金额', key: 'amount', width: 140, align: 'right' },
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

function resetSyncProgress(adapterName = '') {
  syncProgress.active = true
  syncProgress.adapter = adapterName
  syncProgress.phase = 'starting'
  syncProgress.mailbox = ''
  syncProgress.current = 0
  syncProgress.total = 0
  syncProgress.attempt = 1
  syncProgress.errorMessage = ''
}

function handleSyncEvent(evt) {
  if (!evt) return
  if (evt.adapter) syncProgress.adapter = evt.adapter
  if (evt.phase) syncProgress.phase = evt.phase
  if (typeof evt.current === 'number') syncProgress.current = evt.current
  if (typeof evt.total === 'number') syncProgress.total = evt.total
  if (typeof evt.attempt === 'number') syncProgress.attempt = evt.attempt
  if (evt.mailbox) syncProgress.mailbox = evt.mailbox
  if (evt.phase === 'error') {
    syncProgress.errorMessage = evt.message || 'sync error'
  }
}

async function syncOne(name) {
  loading.sync[name] = true
  resetSyncProgress(name)
  try {
    // Phase 5.7: streaming when supported, falls back to plain syncAdapter
    if (typeof hub.syncAdapterStream === 'function') {
      lastSync.value = await hub.syncAdapterStream(name, {}, handleSyncEvent)
    } else {
      lastSync.value = await hub.syncAdapter(name)
    }
    await refresh()
  } catch (err) {
    message.error(`同步 ${name} 失败: ${err.message}`)
  } finally {
    loading.sync[name] = false
    syncProgress.active = false
  }
}

async function syncAll() {
  loading.syncAll = true
  resetSyncProgress('(all)')
  try {
    const reports = typeof hub.syncAllStream === 'function'
      ? await hub.syncAllStream({}, handleSyncEvent)
      : await hub.syncAll()
    lastSync.value = reports?.[reports.length - 1] || null
    await refresh()
    message.success(`已同步 ${reports?.length || 0} 个 adapter`)
  } catch (err) {
    message.error('同步失败: ' + err.message)
  } finally {
    loading.syncAll = false
    syncProgress.active = false
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

// ─── Phase 5.6 — email config handlers ─────────────────────────────────

const emailFormValid = computed(() => {
  if (!emailForm.email || !emailForm.email.includes('@')) return false
  if (!emailForm.authCode || emailForm.authCode.length < 4) return false
  if (emailForm.provider === 'custom' && !emailForm.host) return false
  return true
})

function providerAuthHint(provider) {
  const hints = {
    qq: 'QQ: 邮箱 → 设置 → 账户 → IMAP/SMTP → 开启 → 生成授权码',
    163: '163: 邮箱 → 设置 → POP3/SMTP/IMAP → 开启 IMAP/SMTP 服务 → 授权密码',
    189: '189: 设置 → 第三方客户端授权码',
    outlook: 'Outlook: account.microsoft.com/security → App password',
    gmail: 'Gmail: myaccount.google.com/apppasswords (需开启 2FA)',
    custom: '联系你的邮箱管理员获取 IMAP 端点 + app-password',
  }
  return hints[provider] || '请输入服务商授权码（不是登录密码）'
}

function resetEmailForm() {
  emailForm.provider = 'qq'
  emailForm.email = ''
  emailForm.authCode = ''
  emailForm.host = ''
  emailForm.port = 993
  emailForm.pdfPasswordHints = { idCardLast6: '', phoneLast6: '', cardLast6: '' }
  emailTestResult.value = null
}

function buildEmailAccountPayload() {
  const account = {
    provider: emailForm.provider,
    email: emailForm.email.trim(),
    authCode: emailForm.authCode,
  }
  if (emailForm.provider === 'custom') {
    account.host = emailForm.host.trim()
    account.port = emailForm.port || 993
    account.secure = true
  }
  return account
}

function buildPdfHints() {
  const hints = {}
  for (const k of Object.keys(emailForm.pdfPasswordHints)) {
    const v = emailForm.pdfPasswordHints[k]
    if (typeof v === 'string' && v.trim().length > 0) hints[k] = v.trim()
  }
  return Object.keys(hints).length > 0 ? hints : null
}

async function testEmailAuth() {
  if (!emailFormValid.value) return
  loading.testEmail = true
  emailTestResult.value = null
  try {
    emailTestResult.value = await hub.testEmailAuth(buildEmailAccountPayload())
  } catch (err) {
    emailTestResult.value = { ok: false, error: err.message }
  } finally {
    loading.testEmail = false
  }
}

async function saveEmail() {
  if (!emailFormValid.value || !emailTestResult.value?.ok) return
  loading.saveEmail = true
  try {
    const opts = {}
    const hints = buildPdfHints()
    if (hints) opts.pdfPasswordHints = hints
    await hub.registerEmail(buildEmailAccountPayload(), opts)
    message.success('邮箱账号已注册')
    emailConfigOpen.value = false
    resetEmailForm()
    await refresh()
  } catch (err) {
    message.error('保存失败: ' + err.message)
  } finally {
    loading.saveEmail = false
  }
}

// ─── Phase 5.6 — event detail ──────────────────────────────────────────

async function showEventDetail(eventId) {
  if (!eventId) return
  loading.eventDetail = true
  eventDetailOpen.value = true
  try {
    eventDetail.value = await hub.eventDetail(eventId)
  } catch (err) {
    eventDetail.value = null
    message.error('事件详情加载失败: ' + err.message)
  } finally {
    loading.eventDetail = false
  }
}

// Expose for template-level event handlers (e.g. citation click)
defineExpose({ showEventDetail })

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
.hint {
  color: var(--text-color-secondary, #888);
  font-size: 12px;
}
.json-pre {
  font-size: 12px;
  background: var(--bg-elevated, #fafafa);
  padding: 10px;
  border-radius: 4px;
  max-height: 280px;
  overflow: auto;
}
.amount-in {
  color: #52c41a;
  font-weight: 600;
}
.amount-out {
  color: #ff4d4f;
  font-weight: 600;
}
</style>
