<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">隐私计算</h2>
        <p class="page-sub">联邦学习 · 多方计算 · 差分隐私 · 同态加密</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-dropdown :trigger="['click']">
          <a-button type="primary">
            <template #icon><PlusOutlined /></template>
            操作 ▼
          </a-button>
          <template #overlay>
            <a-menu @click="handleNewClick">
              <a-menu-item key="model"><ExperimentOutlined /> 创建联邦学习模型</a-menu-item>
              <a-menu-item key="computation"><ApartmentOutlined /> 创建 MPC 计算</a-menu-item>
              <a-menu-item key="dp"><LockOutlined /> 差分隐私发布</a-menu-item>
              <a-menu-item key="he"><SafetyOutlined /> 同态加密查询</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-space>
    </div>

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="FL 模型" :value="report.federatedLearning.totalModels" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><ExperimentOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="平均准确度"
            :value="avgAccuracyPct"
            :precision="1"
            suffix="%"
            :value-style="{ color: report.federatedLearning.avgAccuracy >= 0.8 ? '#52c41a' : '#faad14', fontSize: '20px' }"
          >
            <template #prefix><RiseOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="MPC 计算" :value="report.mpc.totalComputations" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><ApartmentOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="预算余量 ε"
            :value="report.privacyBudget.remaining"
            :precision="2"
            :value-style="{ color: budgetColor, fontSize: '20px' }"
          >
            <template #prefix><LockOutlined /></template>
            <template #suffix>
              <span style="font-size: 11px; color: var(--text-secondary);">/ {{ report.privacyBudget.limit }}</span>
            </template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="预算状态"
            :value="report.privacyBudget.exhausted ? '已耗尽' : '充足'"
            :value-style="{ color: report.privacyBudget.exhausted ? '#ff4d4f' : '#52c41a', fontSize: '20px' }"
          />
        </a-card>
      </a-col>
    </a-row>

    <!-- Catalogue cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="24" :md="8">
        <a-card title="MPC 协议" size="small" style="background: var(--bg-card); border-color: var(--border-color);" :body-style="{ padding: '12px 16px' }">
          <div v-for="p in protocols" :key="p.id" class="catalog-item">
            <a-tag color="purple" style="font-family: monospace;">{{ p.id }}</a-tag>
            <span class="catalog-name">{{ p.name }}</span>
            <span class="catalog-desc">{{ p.description }}</span>
          </div>
        </a-card>
      </a-col>
      <a-col :xs="24" :md="8">
        <a-card title="DP 噪声机制" size="small" style="background: var(--bg-card); border-color: var(--border-color);" :body-style="{ padding: '12px 16px' }">
          <div v-for="m in dpMechanisms" :key="m.id" class="catalog-item">
            <a-tag color="orange" style="font-family: monospace;">{{ m.id }}</a-tag>
            <span class="catalog-name">{{ m.name }}</span>
            <span class="catalog-desc">{{ m.description }}</span>
          </div>
        </a-card>
      </a-col>
      <a-col :xs="24" :md="8">
        <a-card title="HE 同态方案" size="small" style="background: var(--bg-card); border-color: var(--border-color);" :body-style="{ padding: '12px 16px' }">
          <div v-for="s in heSchemes" :key="s.id" class="catalog-item">
            <a-tag color="cyan" style="font-family: monospace;">{{ s.id }}</a-tag>
            <span class="catalog-name">{{ s.name }}</span>
            <span class="catalog-desc">{{ s.description }}</span>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="privacy-tabs">
      <!-- ── FL models tab ─────────────────────────────────────────── -->
      <a-tab-pane key="models" tab="联邦学习">
        <div class="filter-bar">
          <a-radio-group v-model:value="modelStatusFilter" size="small" button-style="solid">
            <a-radio-button value="">全部</a-radio-button>
            <a-radio-button v-for="s in FL_STATUSES" :key="s" :value="s">{{ flStatusLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="modelColumns"
          :data-source="filteredModels"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">
              <span style="color: var(--text-primary); font-weight: 500;">{{ record.name }}</span>
              <div style="color: var(--text-secondary); font-size: 11px; margin-top: 2px;">
                {{ record.modelType }} / {{ record.architecture }}
              </div>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="flStatusColor(record.status)">{{ flStatusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'progress'">
              <a-progress
                :percent="record.totalRounds ? Math.round(100 * record.currentRound / record.totalRounds) : 0"
                size="small"
                :status="record.status === 'failed' ? 'exception' : record.status === 'completed' ? 'success' : 'active'"
              />
              <div style="font-size: 11px; color: var(--text-secondary);">
                {{ record.currentRound }} / {{ record.totalRounds }} 轮
              </div>
            </template>
            <template v-if="column.key === 'accuracy'">
              <span :style="{ color: accuracyColor(record.accuracy), fontFamily: 'monospace' }">
                {{ (record.accuracy * 100).toFixed(1) }}%
              </span>
              <div v-if="record.loss != null" style="font-size: 11px; color: var(--text-secondary);">
                loss {{ record.loss.toFixed(3) }}
              </div>
            </template>
            <template v-if="column.key === 'participants'">
              <a-tag color="blue" style="font-size: 11px;">{{ record.participantCount }}</a-tag>
            </template>
            <template v-if="column.key === 'budget'">
              <span style="font-family: monospace; color: var(--text-secondary);">{{ record.privacyBudgetSpent.toFixed(3) }}</span>
            </template>
            <template v-if="column.key === 'updatedAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatPrivacyTime(record.updatedAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button
                v-if="canTrain(record)"
                size="small"
                type="link"
                :loading="trainingId === record.id"
                @click="trainOne(record)"
              >
                训练一轮
              </a-button>
              <a-popconfirm
                v-if="record.status !== 'failed' && record.status !== 'completed'"
                title="标记该模型为失败？"
                ok-text="确认"
                cancel-text="取消"
                @confirm="failModel(record)"
              >
                <a-button size="small" type="link" danger>标记失败</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <ExperimentOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ modelStatusFilter ? '没有符合条件的模型' : '暂无 FL 模型，点"操作 → 创建联邦学习模型"创建第一个' }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── MPC computations tab ──────────────────────────────────── -->
      <a-tab-pane key="computations" tab="MPC 计算">
        <div class="filter-bar">
          <a-radio-group v-model:value="mpcProtocolFilter" size="small">
            <a-radio-button value="">全部协议</a-radio-button>
            <a-radio-button v-for="p in MPC_PROTOCOLS" :key="p" :value="p">{{ p }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="mpcStatusFilter" size="small">
            <a-radio-button value="">全部状态</a-radio-button>
            <a-radio-button v-for="s in MPC_STATUSES" :key="s" :value="s">{{ mpcStatusLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="computationColumns"
          :data-source="filteredComputations"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'type'">
              <span style="color: var(--text-primary); font-family: monospace; font-weight: 500;">{{ record.computationType }}</span>
            </template>
            <template v-if="column.key === 'protocol'">
              <a-tag color="purple" style="font-family: monospace;">{{ record.protocol }}</a-tag>
            </template>
            <template v-if="column.key === 'progress'">
              <a-progress
                :percent="record.sharesRequired ? Math.round(100 * record.sharesReceived / record.sharesRequired) : 0"
                size="small"
                :status="record.status === 'completed' ? 'success' : 'active'"
                :format="() => `${record.sharesReceived}/${record.sharesRequired}`"
              />
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="mpcStatusColor(record.status)">{{ mpcStatusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'time'">
              <span v-if="record.computationTimeMs != null" style="font-family: monospace; color: var(--text-secondary); font-size: 12px;">
                {{ record.computationTimeMs }} ms
              </span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatPrivacyTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button
                v-if="record.status !== 'completed'"
                size="small"
                type="link"
                :loading="submittingShareId === record.id"
                @click="submitShare(record)"
              >
                提交份额
              </a-button>
              <span v-else style="color: var(--text-muted); font-size: 11px; font-family: monospace;">
                hash {{ record.resultHash?.slice(0, 8) || '—' }}
              </span>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <ApartmentOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              暂无 MPC 计算，点"操作 → 创建 MPC 计算"创建第一个
            </div>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Create FL model modal ─────────────────────────────────── -->
    <a-modal
      v-model:open="showModelModal"
      title="创建联邦学习模型"
      :confirm-loading="creating"
      :width="540"
      ok-text="创建"
      cancel-text="取消"
      @ok="createModel"
      @cancel="resetModelForm"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
        <a-form-item label="模型名称" required>
          <a-input v-model:value="modelForm.name" placeholder="例如: fraud-detector" />
        </a-form-item>
        <a-form-item label="模型类型">
          <a-input v-model:value="modelForm.modelType" placeholder="neural_network（默认）" />
        </a-form-item>
        <a-form-item label="架构">
          <a-input v-model:value="modelForm.architecture" placeholder="mlp（默认）" />
        </a-form-item>
        <a-form-item label="总轮次">
          <a-input-number v-model:value="modelForm.rounds" :min="1" :max="1000" style="width: 100%;" />
        </a-form-item>
        <a-form-item label="学习率">
          <a-input-number v-model:value="modelForm.lr" :min="0" :max="1" :step="0.001" style="width: 100%;" />
        </a-form-item>
        <a-form-item label="参与方数量">
          <a-input-number v-model:value="modelForm.participants" :min="0" :max="1000" style="width: 100%;" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Create MPC computation modal ─────────────────────────── -->
    <a-modal
      v-model:open="showComputationModal"
      title="创建 MPC 计算"
      :confirm-loading="creating"
      :width="520"
      ok-text="创建"
      cancel-text="取消"
      @ok="createComputation"
      @cancel="resetComputationForm"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
        <a-form-item label="计算类型" required>
          <a-input v-model:value="computationForm.type" placeholder="例如: sum / multiplication" />
        </a-form-item>
        <a-form-item label="协议">
          <a-select v-model:value="computationForm.protocol">
            <a-select-option v-for="p in MPC_PROTOCOLS" :key="p" :value="p">{{ p }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="参与方 ID">
          <a-textarea
            v-model:value="computationForm.participants"
            placeholder="逗号分隔，例如: alice,bob,carol"
            :auto-size="{ minRows: 2, maxRows: 4 }"
          />
        </a-form-item>
        <a-form-item label="所需份额">
          <a-input-number v-model:value="computationForm.threshold" :min="2" :max="100" placeholder="留空自动取半数" style="width: 100%;" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── DP publish modal ─────────────────────────────────────── -->
    <a-modal
      v-model:open="showDPModal"
      title="差分隐私发布"
      :confirm-loading="publishing"
      :width="520"
      ok-text="发布"
      cancel-text="关闭"
      @ok="publishDP"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
        <a-form-item label="数据" required>
          <a-input v-model:value="dpForm.data" placeholder="数字或 JSON 数组，例如 10 或 [1,2,3]" />
        </a-form-item>
        <a-form-item label="噪声机制">
          <a-radio-group v-model:value="dpForm.mechanism">
            <a-radio-button v-for="m in DP_MECHANISMS" :key="m" :value="m">{{ m }}</a-radio-button>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="ε (epsilon)">
          <a-input-number v-model:value="dpForm.epsilon" :min="0" :step="0.01" style="width: 100%;" />
        </a-form-item>
        <a-form-item label="δ (delta)">
          <a-input-number v-model:value="dpForm.delta" :min="0" :step="0.000001" style="width: 100%;" />
        </a-form-item>
        <a-form-item label="敏感度">
          <a-input-number v-model:value="dpForm.sensitivity" :min="0" :step="0.1" style="width: 100%;" />
        </a-form-item>
      </a-form>

      <a-card v-if="dpResult" size="small" style="background: var(--bg-base); margin-top: 8px;">
        <template v-if="dpResult.published">
          <a-statistic
            title="加噪后数据"
            :value="dpResult.data"
            :precision="3"
            :value-style="{ color: '#52c41a' }"
          />
          <div style="margin-top: 12px; font-size: 12px; color: var(--text-secondary);">
            <div>消耗预算: {{ dpResult.budgetSpent.toFixed(3) }}</div>
            <div>剩余预算: {{ dpResult.budgetRemaining.toFixed(3) }}</div>
            <div>机制: {{ dpResult.mechanism }} (ε={{ dpResult.epsilon }})</div>
          </div>
        </template>
        <template v-else>
          <a-statistic title="发布失败" :value="dpResult.reason || 'unknown'" :value-style="{ color: '#ff4d4f' }" />
        </template>
      </a-card>
    </a-modal>

    <!-- ── HE query modal ───────────────────────────────────────── -->
    <a-modal
      v-model:open="showHEModal"
      title="同态加密查询"
      :confirm-loading="querying"
      :width="500"
      ok-text="查询"
      cancel-text="关闭"
      @ok="queryHE"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
        <a-form-item label="数据" required>
          <a-textarea
            v-model:value="heForm.data"
            placeholder="JSON 数组，例如 [1,2,3,4,5]"
            :auto-size="{ minRows: 2, maxRows: 4 }"
          />
        </a-form-item>
        <a-form-item label="操作">
          <a-radio-group v-model:value="heForm.operation">
            <a-radio-button v-for="o in HE_OPERATIONS" :key="o" :value="o">{{ o }}</a-radio-button>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="同态方案">
          <a-radio-group v-model:value="heForm.scheme">
            <a-radio-button v-for="s in HE_SCHEMES" :key="s" :value="s">{{ s }}</a-radio-button>
          </a-radio-group>
        </a-form-item>
      </a-form>

      <a-card v-if="heResult" size="small" style="background: var(--bg-base); margin-top: 8px;">
        <a-statistic
          title="加密计算结果"
          :value="heResult.result"
          :value-style="{ color: '#1677ff' }"
        />
        <div style="margin-top: 12px; font-size: 12px; color: var(--text-secondary);">
          <div>方案: {{ heResult.scheme }}</div>
          <div>操作: {{ heResult.operation }}</div>
          <div>输入项数: {{ heResult.inputCount }}</div>
          <a-tag v-if="heResult.encrypted" color="green" style="margin-top: 4px; font-size: 10px;">已加密</a-tag>
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
  ExperimentOutlined,
  ApartmentOutlined,
  LockOutlined,
  SafetyOutlined,
  RiseOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parseCatalog,
  parseModels,
  parseComputations,
  parseDPResult,
  parseHEResult,
  parseReport,
  formatPrivacyTime,
  FL_STATUSES,
  MPC_STATUSES,
  MPC_PROTOCOLS,
  DP_MECHANISMS,
  HE_SCHEMES,
  HE_OPERATIONS,
} from '../utils/privacy-parser.js'

const ws = useWsStore()

const loading = ref(false)
const creating = ref(false)
const publishing = ref(false)
const querying = ref(false)
const trainingId = ref('')
const submittingShareId = ref('')

const protocols = ref([])
const dpMechanisms = ref([])
const heSchemes = ref([])
const models = ref([])
const computations = ref([])
const report = ref({
  privacyBudget: { spent: 0, limit: 0, remaining: 0, exhausted: false },
  federatedLearning: { totalModels: 0, completed: 0, training: 0, avgAccuracy: 0 },
  mpc: { totalComputations: 0, completed: 0, pending: 0, byProtocol: {} },
})

const activeTab = ref('models')
const modelStatusFilter = ref('')
const mpcProtocolFilter = ref('')
const mpcStatusFilter = ref('')

const showModelModal = ref(false)
const showComputationModal = ref(false)
const showDPModal = ref(false)
const showHEModal = ref(false)

const modelForm = reactive({
  name: '', modelType: '', architecture: '', rounds: 10, lr: 0.01, participants: 0,
})
const computationForm = reactive({
  type: '', protocol: 'shamir', participants: '', threshold: null,
})
const dpForm = reactive({
  data: '', mechanism: 'laplace', epsilon: 0.1, delta: 0.00001, sensitivity: 1,
})
const heForm = reactive({
  data: '', operation: 'sum', scheme: 'paillier',
})
const dpResult = ref(null)
const heResult = ref(null)

const modelColumns = [
  { title: '名称', key: 'name' },
  { title: '状态', key: 'status', width: '120px' },
  { title: '进度', key: 'progress', width: '160px' },
  { title: '准确度', key: 'accuracy', width: '110px' },
  { title: '参与方', key: 'participants', width: '90px' },
  { title: '预算 ε', key: 'budget', width: '100px' },
  { title: '更新时间', key: 'updatedAt', width: '160px' },
  { title: '操作', key: 'action', width: '180px' },
]

const computationColumns = [
  { title: '类型', key: 'type', width: '160px' },
  { title: '协议', key: 'protocol', width: '100px' },
  { title: '份额进度', key: 'progress' },
  { title: '状态', key: 'status', width: '110px' },
  { title: '耗时', key: 'time', width: '110px' },
  { title: '创建时间', key: 'createdAt', width: '160px' },
  { title: '操作', key: 'action', width: '160px' },
]

const avgAccuracyPct = computed(() => report.value.federatedLearning.avgAccuracy * 100)

const budgetColor = computed(() => {
  const r = report.value.privacyBudget.remaining
  const l = report.value.privacyBudget.limit
  if (l === 0) return '#888'
  const ratio = r / l
  if (ratio < 0.2) return '#ff4d4f'
  if (ratio < 0.5) return '#faad14'
  return '#52c41a'
})

const filteredModels = computed(() => {
  if (!modelStatusFilter.value) return models.value
  return models.value.filter(m => m.status === modelStatusFilter.value)
})

const filteredComputations = computed(() => {
  let rows = computations.value
  if (mpcProtocolFilter.value) rows = rows.filter(c => c.protocol === mpcProtocolFilter.value)
  if (mpcStatusFilter.value) rows = rows.filter(c => c.status === mpcStatusFilter.value)
  return rows
})

function flStatusLabel(s) {
  return { initializing: '初始化', training: '训练中', aggregating: '聚合中', completed: '已完成', failed: '失败' }[s] || s
}
function flStatusColor(s) {
  return { initializing: 'default', training: 'processing', aggregating: 'cyan', completed: 'green', failed: 'red' }[s] || 'default'
}
function mpcStatusLabel(s) {
  return { pending: '待处理', computing: '计算中', completed: '已完成' }[s] || s
}
function mpcStatusColor(s) {
  return { pending: 'default', computing: 'processing', completed: 'green' }[s] || 'default'
}
function accuracyColor(a) {
  if (a >= 0.85) return '#52c41a'
  if (a >= 0.6) return '#faad14'
  return '#ff4d4f'
}

function canTrain(record) {
  return record.status === 'initializing' || record.status === 'training' || record.status === 'aggregating'
}

function handleNewClick({ key }) {
  if (key === 'model') showModelModal.value = true
  else if (key === 'computation') showComputationModal.value = true
  else if (key === 'dp') {
    dpResult.value = null
    showDPModal.value = true
  } else if (key === 'he') {
    heResult.value = null
    showHEModal.value = true
  }
}

async function loadAll() {
  loading.value = true
  try {
    const [protoRes, dpRes, heRes, modelsRes, compsRes, reportRes] = await Promise.all([
      ws.execute('privacy protocols --json', 8000).catch(() => ({ output: '' })),
      ws.execute('privacy dp-mechanisms --json', 8000).catch(() => ({ output: '' })),
      ws.execute('privacy he-schemes --json', 8000).catch(() => ({ output: '' })),
      ws.execute('privacy models --limit 100 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('privacy computations --limit 100 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('privacy report --json', 8000).catch(() => ({ output: '' })),
    ])
    protocols.value = parseCatalog(protoRes.output)
    dpMechanisms.value = parseCatalog(dpRes.output)
    heSchemes.value = parseCatalog(heRes.output)
    models.value = parseModels(modelsRes.output)
    computations.value = parseComputations(compsRes.output)
    report.value = parseReport(reportRes.output)
  } catch (e) {
    message.error('加载隐私计算数据失败: ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function createModel() {
  if (!modelForm.name.trim()) {
    message.warning('请输入模型名称')
    return
  }
  creating.value = true
  try {
    const parts = [`privacy create-model "${modelForm.name.trim().replace(/"/g, '\\"')}"`]
    if (modelForm.modelType.trim()) parts.push(`--type "${modelForm.modelType.trim().replace(/"/g, '\\"')}"`)
    if (modelForm.architecture.trim()) parts.push(`--arch "${modelForm.architecture.trim().replace(/"/g, '\\"')}"`)
    if (modelForm.rounds != null) parts.push(`--rounds ${modelForm.rounds}`)
    if (modelForm.lr != null) parts.push(`--lr ${modelForm.lr}`)
    if (modelForm.participants != null) parts.push(`--participants ${modelForm.participants}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 12000)
    if (/error|失败/i.test(output) && !/"modelId"/.test(output)) {
      message.error('创建失败: ' + output.slice(0, 120))
      return
    }
    message.success('FL 模型已创建')
    showModelModal.value = false
    resetModelForm()
    await loadAll()
  } catch (e) {
    message.error('创建失败: ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function createComputation() {
  if (!computationForm.type.trim()) {
    message.warning('请输入计算类型')
    return
  }
  creating.value = true
  try {
    const parts = [`privacy create-computation "${computationForm.type.trim().replace(/"/g, '\\"')}"`]
    parts.push(`--protocol ${computationForm.protocol}`)
    if (computationForm.participants.trim()) {
      const ids = computationForm.participants.split(/[,\s]+/).filter(Boolean).join(',')
      if (ids) parts.push(`--participants "${ids}"`)
    }
    if (computationForm.threshold != null) parts.push(`--threshold ${computationForm.threshold}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    if (/error|失败|invalid/i.test(output) && !/"computationId"/.test(output)) {
      message.error('创建失败: ' + output.slice(0, 120))
      return
    }
    message.success('MPC 计算已创建')
    showComputationModal.value = false
    resetComputationForm()
    activeTab.value = 'computations'
    await loadAll()
  } catch (e) {
    message.error('创建失败: ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function trainOne(record) {
  trainingId.value = record.id
  try {
    const { output } = await ws.execute(`privacy train ${record.id} --json`, 12000)
    if (/error|失败/i.test(output) && !/"trained"/.test(output)) {
      message.error('训练失败: ' + output.slice(0, 120))
      return
    }
    message.success('训练一轮完成')
    await loadAll()
  } catch (e) {
    message.error('训练失败: ' + (e?.message || e))
  } finally {
    trainingId.value = ''
  }
}

async function failModel(record) {
  try {
    const { output } = await ws.execute(`privacy fail-model ${record.id} --json`, 8000)
    if (/error/i.test(output) && !/"failed"/.test(output)) {
      message.error('标记失败: ' + output.slice(0, 120))
      return
    }
    message.success('已标记为失败')
    await loadAll()
  } catch (e) {
    message.error('标记失败: ' + (e?.message || e))
  }
}

async function submitShare(record) {
  submittingShareId.value = record.id
  try {
    const { output } = await ws.execute(`privacy submit-share ${record.id} --json`, 10000)
    if (/error|失败/i.test(output) && !/"submitted"/.test(output)) {
      message.error('提交失败: ' + output.slice(0, 120))
      return
    }
    message.success('份额已提交')
    await loadAll()
  } catch (e) {
    message.error('提交失败: ' + (e?.message || e))
  } finally {
    submittingShareId.value = ''
  }
}

async function publishDP() {
  if (!dpForm.data.trim()) {
    message.warning('请输入数据')
    return
  }
  publishing.value = true
  dpResult.value = null
  try {
    const parts = ['privacy dp-publish']
    parts.push(`--data ${JSON.stringify(dpForm.data.trim())}`)
    parts.push(`--mechanism ${dpForm.mechanism}`)
    if (dpForm.epsilon != null) parts.push(`--epsilon ${dpForm.epsilon}`)
    if (dpForm.delta != null) parts.push(`--delta ${dpForm.delta}`)
    if (dpForm.sensitivity != null) parts.push(`--sensitivity ${dpForm.sensitivity}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    const parsed = parseDPResult(output)
    if (!parsed) {
      message.error('发布失败: ' + output.slice(0, 120))
      return
    }
    dpResult.value = parsed
    if (parsed.published) {
      message.success('已发布')
      await loadAll()  // refresh budget
    } else {
      message.warning(`发布拒绝: ${parsed.reason || 'unknown'}`)
    }
  } catch (e) {
    message.error('发布失败: ' + (e?.message || e))
  } finally {
    publishing.value = false
  }
}

async function queryHE() {
  if (!heForm.data.trim()) {
    message.warning('请输入数据')
    return
  }
  // Validate JSON
  try { JSON.parse(heForm.data) } catch {
    message.warning('数据格式错误，请输入合法 JSON 数组')
    return
  }
  querying.value = true
  heResult.value = null
  try {
    const parts = ['privacy he-query']
    parts.push(`--data ${JSON.stringify(heForm.data.trim())}`)
    parts.push(`--operation ${heForm.operation}`)
    parts.push(`--scheme ${heForm.scheme}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    const parsed = parseHEResult(output)
    if (!parsed) {
      message.error('查询失败: ' + output.slice(0, 120))
      return
    }
    heResult.value = parsed
    message.success(`计算完成 (${parsed.scheme}/${parsed.operation})`)
  } catch (e) {
    message.error('查询失败: ' + (e?.message || e))
  } finally {
    querying.value = false
  }
}

function resetModelForm() {
  modelForm.name = ''
  modelForm.modelType = ''
  modelForm.architecture = ''
  modelForm.rounds = 10
  modelForm.lr = 0.01
  modelForm.participants = 0
}
function resetComputationForm() {
  computationForm.type = ''
  computationForm.protocol = 'shamir'
  computationForm.participants = ''
  computationForm.threshold = null
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

.privacy-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.catalog-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
}
.catalog-item:last-child { margin-bottom: 0; }
.catalog-name {
  color: var(--text-primary);
  font-weight: 500;
}
.catalog-desc {
  color: var(--text-secondary);
  font-size: 11px;
  margin-left: auto;
}
</style>
