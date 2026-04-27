<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">社区治理</h2>
        <p class="page-sub">提案 · 加权投票 · 启发式影响分析 · 投票预测</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button type="primary" @click="showCreateModal = true">
          <template #icon><PlusOutlined /></template>
          创建提案
        </a-button>
      </a-space>
    </div>

    <!-- noDb banner -->
    <a-alert
      v-if="errorState.noDb"
      type="info"
      show-icon
      message="该模块需要项目级数据库"
      description="`cc governance ...` 命令仅在 chainlesschain 项目目录下可用。请先运行 `cc init` 初始化项目，或在已初始化的目录启动 `cc serve`。"
      style="margin-bottom: 16px;"
    />

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="提案总数" :value="stats.proposalCount" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><FileTextOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="进行中"
            :value="stats.byStatus.active || 0"
            :value-style="{ color: (stats.byStatus.active || 0) > 0 ? '#1677ff' : '#888', fontSize: '20px' }"
          >
            <template #prefix><PlayCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="已通过"
            :value="stats.byStatus.passed || 0"
            :value-style="{ color: '#52c41a', fontSize: '20px' }"
          >
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="被否决"
            :value="stats.byStatus.rejected || 0"
            :value-style="{ color: '#ff4d4f', fontSize: '20px' }"
          >
            <template #prefix><CloseCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="投票总数" :value="stats.voteCount" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><LikeOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Type catalogue -->
    <a-card
      title="提案类型"
      size="small"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
      :body-style="{ padding: '12px 16px' }"
    >
      <a-row :gutter="[12, 12]">
        <a-col v-for="t in proposalTypes" :key="t.id" :xs="12" :sm="12" :lg="6">
          <div class="type-pill" :style="{ borderLeftColor: typeColor(t.id) }">
            <div class="type-head">
              <a-tag :color="typeColor(t.id)" style="font-family: monospace;">{{ t.id }}</a-tag>
              <span class="type-count">{{ stats.byType[t.id] || 0 }}</span>
            </div>
            <div class="type-name">{{ t.name }}</div>
            <div class="type-desc">{{ t.description }}</div>
          </div>
        </a-col>
      </a-row>
    </a-card>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="governance-tabs">
      <!-- ── Proposals tab ────────────────────────────────────────── -->
      <a-tab-pane key="proposals" tab="提案">
        <div class="filter-bar">
          <a-radio-group v-model:value="statusFilter" size="small" button-style="solid">
            <a-radio-button value="">全部状态</a-radio-button>
            <a-radio-button v-for="s in PROPOSAL_STATUSES" :key="s" :value="s">{{ statusLabel(s) }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="typeFilter" size="small">
            <a-radio-button value="">全部类型</a-radio-button>
            <a-radio-button v-for="t in PROPOSAL_TYPE_IDS" :key="t" :value="t">{{ typeLabel(t) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="proposalColumns"
          :data-source="filteredProposals"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'title'">
              <span style="color: var(--text-primary); font-weight: 500;">{{ record.title || '(未命名)' }}</span>
              <div style="color: var(--text-secondary); font-size: 11px; font-family: monospace; margin-top: 2px;">
                {{ record.id.slice(0, 16) }}
              </div>
            </template>
            <template v-if="column.key === 'type'">
              <a-tag :color="typeColor(record.type)" style="font-family: monospace;">{{ typeLabel(record.type) }}</a-tag>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'tally'">
              <span style="font-family: monospace; font-size: 12px;">
                <span style="color: #52c41a;">+{{ record.voteYes }}</span> /
                <span style="color: #ff4d4f;">-{{ record.voteNo }}</span> /
                <span style="color: var(--text-muted);">~{{ record.voteAbstain }}</span>
              </span>
              <a-progress
                v-if="record.voteYes + record.voteNo > 0"
                :percent="yesPct(record)"
                size="small"
                :show-info="false"
                :stroke-color="record.voteYes >= record.voteNo ? '#52c41a' : '#ff4d4f'"
                style="margin-top: 4px;"
              />
            </template>
            <template v-if="column.key === 'impact'">
              <a-tag v-if="record.impactLevel" :color="impactColor(record.impactLevel)">{{ impactLabel(record.impactLevel) }}</a-tag>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatGovernanceTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" @click="viewProposalDetails(record)">详情</a-button>
              <a-button v-if="record.status === 'draft'" size="small" type="link" @click="activateProposal(record)">启动投票</a-button>
              <a-button v-if="record.status === 'active'" size="small" type="link" style="color: #52c41a;" @click="openVoteModal(record)">投票</a-button>
              <a-popconfirm
                v-if="record.status === 'active'"
                title="关闭投票并按当前票数结算？"
                ok-text="关闭"
                cancel-text="返回"
                @confirm="closeProposal(record)"
              >
                <a-button size="small" type="link" danger>关闭</a-button>
              </a-popconfirm>
              <a-button size="small" type="link" @click="runAnalyze(record)">影响分析</a-button>
              <a-button size="small" type="link" @click="runPredict(record)">预测</a-button>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <FileTextOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ statusFilter || typeFilter ? '没有符合条件的提案' : '暂无提案，点"创建提案"创建第一条' }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Status & type breakdown tab ──────────────────────────── -->
      <a-tab-pane key="breakdown" tab="状态分布">
        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :lg="12">
            <a-card title="按状态" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <div v-for="s in PROPOSAL_STATUSES" :key="s" class="bd-row">
                <a-tag :color="statusColor(s)" style="min-width: 60px; text-align: center;">{{ statusLabel(s) }}</a-tag>
                <a-progress
                  :percent="pctOfTotal(stats.byStatus[s] || 0, stats.proposalCount)"
                  :stroke-color="statusBarColor(s)"
                  :format="() => `${stats.byStatus[s] || 0}`"
                  size="small"
                  style="flex: 1; margin-left: 12px;"
                />
              </div>
            </a-card>
          </a-col>
          <a-col :xs="24" :lg="12">
            <a-card title="按类型" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <div v-for="t in PROPOSAL_TYPE_IDS" :key="t" class="bd-row">
                <a-tag :color="typeColor(t)" style="min-width: 90px; text-align: center;">{{ typeLabel(t) }}</a-tag>
                <a-progress
                  :percent="pctOfTotal(stats.byType[t] || 0, stats.proposalCount)"
                  :stroke-color="typeBarColor(t)"
                  :format="() => `${stats.byType[t] || 0}`"
                  size="small"
                  style="flex: 1; margin-left: 12px;"
                />
              </div>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Create proposal modal ───────────────────────────────── -->
    <a-modal
      v-model:open="showCreateModal"
      title="创建提案"
      :confirm-loading="creating"
      :width="560"
      ok-text="创建"
      cancel-text="取消"
      @ok="createProposal"
      @cancel="resetCreateForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item label="标题" required>
          <a-input v-model:value="createForm.title" placeholder="例如: 增加深色模式支持" />
        </a-form-item>
        <a-form-item label="类型" required>
          <a-select v-model:value="createForm.type">
            <a-select-option v-for="t in PROPOSAL_TYPE_IDS" :key="t" :value="t">{{ typeLabel(t) }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="提案人 DID">
          <a-input v-model:value="createForm.proposerDid" placeholder="可选，例如 did:key:z6Mk..." />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea
            v-model:value="createForm.description"
            placeholder="提案的背景、动机、范围（描述越详细，影响分析的 benefit 评分越高）"
            :auto-size="{ minRows: 3, maxRows: 8 }"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Vote modal ───────────────────────────────────────────── -->
    <a-modal
      v-model:open="showVoteModal"
      :title="`对提案投票：${currentProposal?.title || ''}`"
      :confirm-loading="voting"
      :width="540"
      ok-text="投票"
      cancel-text="取消"
      @ok="submitVote"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item label="投票人 DID" required>
          <a-input v-model:value="voteForm.voterDid" placeholder="did:key:..." />
        </a-form-item>
        <a-form-item label="选项" required>
          <a-radio-group v-model:value="voteForm.value" button-style="solid">
            <a-radio-button value="yes" style="color: #52c41a;">赞成</a-radio-button>
            <a-radio-button value="no" style="color: #ff4d4f;">反对</a-radio-button>
            <a-radio-button value="abstain">弃权</a-radio-button>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="权重">
          <a-input-number v-model:value="voteForm.weight" :min="0.1" :step="0.1" style="width: 120px;" />
          <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">默认 1.0</span>
        </a-form-item>
        <a-form-item label="理由">
          <a-textarea
            v-model:value="voteForm.reason"
            placeholder="可选，说明投票理由"
            :auto-size="{ minRows: 2, maxRows: 5 }"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Proposal details modal ──────────────────────────────── -->
    <a-modal
      v-model:open="showDetailsModal"
      :title="`提案详情：${currentProposal?.title || ''}`"
      :width="780"
      :footer="null"
    >
      <div v-if="currentProposal" style="padding-top: 8px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="ID" :span="2">
            <span style="font-family: monospace; font-size: 12px;">{{ currentProposal.id }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="类型">
            <a-tag :color="typeColor(currentProposal.type)">{{ typeLabel(currentProposal.type) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-tag :color="statusColor(currentProposal.status)">{{ statusLabel(currentProposal.status) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="提案人" :span="2">
            <span v-if="currentProposal.proposerDid" style="font-family: monospace; font-size: 12px;">{{ currentProposal.proposerDid }}</span>
            <span v-else style="color: var(--text-muted);">未指定</span>
          </a-descriptions-item>
          <a-descriptions-item label="描述" :span="2">
            <div v-if="currentProposal.description" style="white-space: pre-wrap;">{{ currentProposal.description }}</div>
            <span v-else style="color: var(--text-muted);">—</span>
          </a-descriptions-item>
          <a-descriptions-item label="投票汇总" :span="2">
            <a-space>
              <a-tag color="green">赞成: {{ currentProposal.voteYes }}</a-tag>
              <a-tag color="red">反对: {{ currentProposal.voteNo }}</a-tag>
              <a-tag>弃权: {{ currentProposal.voteAbstain }}</a-tag>
            </a-space>
          </a-descriptions-item>
          <a-descriptions-item v-if="currentProposal.impactLevel" label="影响等级">
            <a-tag :color="impactColor(currentProposal.impactLevel)">{{ impactLabel(currentProposal.impactLevel) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">{{ formatGovernanceTime(currentProposal.createdAt) }}</a-descriptions-item>
          <a-descriptions-item v-if="currentProposal.votingStartsAt" label="投票开始">{{ formatGovernanceTime(currentProposal.votingStartsAt) }}</a-descriptions-item>
          <a-descriptions-item v-if="currentProposal.votingEndsAt" label="投票结束">{{ formatGovernanceTime(currentProposal.votingEndsAt) }}</a-descriptions-item>
        </a-descriptions>

        <!-- Votes list -->
        <h4 style="color: var(--text-primary); font-size: 13px; margin: 20px 0 10px;">投票记录</h4>
        <a-empty v-if="!detailVotes.length" description="暂无投票" :image="EMPTY_IMG" />
        <a-list v-else size="small" :data-source="detailVotes" :pagination="{ pageSize: 8 }">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-tag :color="voteColor(item.vote)" style="min-width: 50px; text-align: center;">{{ voteLabel(item.vote) }}</a-tag>
              <span style="margin-left: 8px; color: var(--text-muted); font-size: 11px;">w={{ item.weight }}</span>
              <span style="margin-left: 8px; font-family: monospace; font-size: 11px; color: var(--text-secondary);">{{ item.voterDid }}</span>
              <span v-if="item.reason" style="margin-left: 8px; color: var(--text-secondary); font-size: 12px;">— {{ item.reason }}</span>
              <span style="margin-left: auto; color: var(--text-muted); font-size: 11px;">{{ formatGovernanceTime(item.createdAt) }}</span>
            </a-list-item>
          </template>
        </a-list>
      </div>
    </a-modal>

    <!-- ── Analysis modal ──────────────────────────────────────── -->
    <a-modal
      v-model:open="showAnalysisModal"
      :title="`影响分析：${currentProposal?.title || ''}`"
      :width="640"
      :footer="null"
    >
      <div v-if="currentAnalysis" style="padding-top: 8px;">
        <a-row :gutter="[12, 12]" style="margin-bottom: 16px;">
          <a-col :span="8">
            <a-statistic title="影响等级" :value="impactLabel(currentAnalysis.impactLevel)" :value-style="{ color: impactBarColor(currentAnalysis.impactLevel), fontSize: '16px' }" />
          </a-col>
          <a-col :span="8">
            <a-statistic title="工作量" :value="effortLabel(currentAnalysis.estimatedEffort)" :value-style="{ fontSize: '16px' }" />
          </a-col>
          <a-col :span="8">
            <a-statistic title="社区情绪" :value="sentimentLabel(currentAnalysis.communitySentiment)" :value-style="{ fontSize: '16px' }" />
          </a-col>
        </a-row>

        <a-card title="风险 / 收益" size="small" style="margin-bottom: 12px;">
          <div style="margin-bottom: 8px;">
            <span style="color: var(--text-secondary); font-size: 12px;">风险评分</span>
            <a-progress :percent="Math.round(currentAnalysis.riskScore * 100)" stroke-color="#ff4d4f" />
          </div>
          <div>
            <span style="color: var(--text-secondary); font-size: 12px;">收益评分</span>
            <a-progress :percent="Math.round(currentAnalysis.benefitScore * 100)" stroke-color="#52c41a" />
          </div>
        </a-card>

        <a-card v-if="currentAnalysis.affectedComponents.length" title="影响组件" size="small" style="margin-bottom: 12px;">
          <a-tag v-for="c in currentAnalysis.affectedComponents" :key="c" color="blue">{{ c }}</a-tag>
        </a-card>

        <a-card v-if="currentAnalysis.recommendations.length" title="建议" size="small">
          <a-list size="small" :data-source="currentAnalysis.recommendations">
            <template #renderItem="{ item }">
              <a-list-item>
                <ArrowRightOutlined style="color: #faad14; margin-right: 8px;" />
                {{ item }}
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </div>
    </a-modal>

    <!-- ── Prediction modal ────────────────────────────────────── -->
    <a-modal
      v-model:open="showPredictionModal"
      :title="`投票预测：${currentProposal?.title || ''}`"
      :width="540"
      :footer="null"
    >
      <div v-if="currentPrediction" style="padding-top: 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <a-tag
            :color="currentPrediction.predictedOutcome === 'pass' ? 'green' : 'red'"
            style="font-size: 16px; padding: 6px 14px;"
          >
            {{ currentPrediction.predictedOutcome === 'pass' ? '预计通过' : '预计否决' }}
          </a-tag>
        </div>
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="置信度" :span="2">
            <a-progress :percent="Math.round(currentPrediction.confidence * 100)" :stroke-color="currentPrediction.confidence >= 0.6 ? '#52c41a' : '#faad14'" />
          </a-descriptions-item>
          <a-descriptions-item label="预测依据">
            <a-tag :color="currentPrediction.basedOn === 'votes' ? 'blue' : 'orange'">
              {{ currentPrediction.basedOn === 'votes' ? '已有投票' : '启发式（无投票）' }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="样本数">{{ currentPrediction.sampleSize }}</a-descriptions-item>
          <a-descriptions-item label="赞成概率">
            <span style="color: #52c41a;">{{ (currentPrediction.yesProb * 100).toFixed(1) }}%</span>
          </a-descriptions-item>
          <a-descriptions-item label="反对概率">
            <span style="color: #ff4d4f;">{{ (currentPrediction.noProb * 100).toFixed(1) }}%</span>
          </a-descriptions-item>
          <a-descriptions-item label="弃权概率" :span="2">
            <span style="color: var(--text-muted);">{{ (currentPrediction.abstainProb * 100).toFixed(1) }}%</span>
          </a-descriptions-item>
        </a-descriptions>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import {
  ReloadOutlined,
  PlusOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LikeOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons-vue'
import { message, Empty } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parseTypes,
  parseProposals,
  parseVotes,
  parseAnalysis,
  parsePrediction,
  parseStats,
  detectGovernanceError,
  formatGovernanceTime,
  PROPOSAL_STATUSES,
  PROPOSAL_TYPE_IDS,
} from '../utils/governance-parser.js'

const ws = useWsStore()

const EMPTY_IMG = Empty.PRESENTED_IMAGE_SIMPLE

const loading = ref(false)
const creating = ref(false)
const voting = ref(false)

const proposals = ref([])
const proposalTypes = ref([])
const stats = ref({
  proposalCount: 0,
  voteCount: 0,
  byStatus: {},
  byType: {},
})
const errorState = ref({ noDb: false, error: '' })

const activeTab = ref('proposals')
const statusFilter = ref('')
const typeFilter = ref('')

const showCreateModal = ref(false)
const showVoteModal = ref(false)
const showDetailsModal = ref(false)
const showAnalysisModal = ref(false)
const showPredictionModal = ref(false)

const createForm = reactive({ title: '', type: 'feature_request', proposerDid: '', description: '' })
const voteForm = reactive({ voterDid: '', value: 'yes', weight: 1.0, reason: '' })
const currentProposal = ref(null)
const detailVotes = ref([])
const currentAnalysis = ref(null)
const currentPrediction = ref(null)

const proposalColumns = [
  { title: '标题', key: 'title' },
  { title: '类型', key: 'type', width: '130px' },
  { title: '状态', key: 'status', width: '100px' },
  { title: '票数', key: 'tally', width: '180px' },
  { title: '影响', key: 'impact', width: '100px' },
  { title: '创建时间', key: 'createdAt', width: '160px' },
  { title: '操作', key: 'action', width: '320px' },
]

const filteredProposals = computed(() => {
  let rows = proposals.value
  if (statusFilter.value) rows = rows.filter(p => p.status === statusFilter.value)
  if (typeFilter.value) rows = rows.filter(p => p.type === typeFilter.value)
  return rows
})

function statusLabel(s) {
  return { draft: '草稿', active: '进行中', passed: '已通过', rejected: '已否决', expired: '已过期' }[s] || s
}
function statusColor(s) {
  return { draft: 'default', active: 'processing', passed: 'green', rejected: 'red', expired: 'default' }[s] || 'default'
}
function statusBarColor(s) {
  return { draft: '#888', active: '#1677ff', passed: '#52c41a', rejected: '#ff4d4f', expired: '#888' }[s] || '#888'
}

function typeLabel(t) {
  return {
    parameter_change: '参数变更',
    feature_request: '功能请求',
    policy_update: '策略更新',
    budget_allocation: '预算分配',
  }[t] || t
}
function typeColor(t) {
  return {
    parameter_change: 'cyan',
    feature_request: 'blue',
    policy_update: 'purple',
    budget_allocation: 'gold',
  }[t] || 'default'
}
function typeBarColor(t) {
  return { parameter_change: '#13c2c2', feature_request: '#1677ff', policy_update: '#722ed1', budget_allocation: '#faad14' }[t] || '#888'
}

function impactLabel(l) {
  return { low: '低', medium: '中', high: '高', critical: '关键' }[l] || l
}
function impactColor(l) {
  return { low: 'default', medium: 'blue', high: 'orange', critical: 'red' }[l] || 'default'
}
function impactBarColor(l) {
  return { low: '#888', medium: '#1677ff', high: '#faad14', critical: '#ff4d4f' }[l] || '#888'
}

function voteLabel(v) {
  return { yes: '赞成', no: '反对', abstain: '弃权' }[v] || v
}
function voteColor(v) {
  return { yes: 'green', no: 'red', abstain: 'default' }[v] || 'default'
}

function effortLabel(e) {
  return { small: '小', medium: '中', large: '大' }[e] || e || '—'
}
function sentimentLabel(s) {
  return { positive: '积极', cautious: '谨慎', negative: '负面' }[s] || s || '—'
}

function yesPct(p) {
  const decisive = p.voteYes + p.voteNo
  if (!decisive) return 0
  return Math.round((p.voteYes / decisive) * 100)
}
function pctOfTotal(n, total) {
  if (!total) return 0
  return Math.round((n / total) * 100)
}

async function loadAll() {
  loading.value = true
  errorState.value = { noDb: false, error: '' }
  try {
    const [typesRes, listRes, statsRes] = await Promise.all([
      ws.execute('governance types --json', 8000).catch(() => ({ output: '' })),
      ws.execute('governance list --json', 10000).catch(() => ({ output: '' })),
      ws.execute('governance stats --json', 8000).catch(() => ({ output: '' })),
    ])
    // Detect noDb on DB-backed commands
    const errs = [listRes, statsRes]
      .map(r => detectGovernanceError(r.output))
      .find(e => e.noDb)
    if (errs) {
      errorState.value = errs
    }
    proposalTypes.value = parseTypes(typesRes.output)
    proposals.value = parseProposals(listRes.output)
    stats.value = parseStats(statsRes.output)
  } catch (e) {
    message.error('加载治理数据失败: ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function createProposal() {
  if (!createForm.title.trim()) {
    message.warning('请填写标题')
    return
  }
  creating.value = true
  try {
    const parts = [`governance create "${createForm.title.trim().replace(/"/g, '\\"')}"`]
    parts.push(`-t ${createForm.type}`)
    if (createForm.proposerDid.trim()) {
      parts.push(`-p "${createForm.proposerDid.trim().replace(/"/g, '\\"')}"`)
    }
    if (createForm.description.trim()) {
      parts.push(`-d "${createForm.description.trim().replace(/"/g, '\\"')}"`)
    }
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    const err = detectGovernanceError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    if (!/"id"/.test(output)) {
      message.error('创建失败: ' + output.slice(0, 120))
      return
    }
    message.success('提案已创建（草稿）')
    showCreateModal.value = false
    resetCreateForm()
    await loadAll()
  } catch (e) {
    message.error('创建失败: ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function activateProposal(record) {
  await runProposalAction(`governance activate ${record.id} --json`, '已启动投票')
}

async function closeProposal(record) {
  await runProposalAction(`governance close ${record.id} --json`, '投票已关闭')
}

async function runProposalAction(command, successMsg) {
  try {
    const { output } = await ws.execute(command, 10000)
    const err = detectGovernanceError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    if (!/"id"|"proposalId"|"passed"/.test(output)) {
      message.error('操作失败: ' + output.slice(0, 120))
      return
    }
    message.success(successMsg)
    await loadAll()
  } catch (e) {
    message.error('操作失败: ' + (e?.message || e))
  }
}

function openVoteModal(record) {
  currentProposal.value = record
  voteForm.voterDid = ''
  voteForm.value = 'yes'
  voteForm.weight = 1.0
  voteForm.reason = ''
  showVoteModal.value = true
}

async function submitVote() {
  if (!currentProposal.value) return
  if (!voteForm.voterDid.trim()) {
    message.warning('请填写投票人 DID')
    return
  }
  voting.value = true
  try {
    const parts = [
      `governance vote ${currentProposal.value.id}`,
      `"${voteForm.voterDid.trim().replace(/"/g, '\\"')}"`,
      voteForm.value,
      `-w ${voteForm.weight}`,
    ]
    if (voteForm.reason.trim()) {
      parts.push(`-r "${voteForm.reason.trim().replace(/"/g, '\\"')}"`)
    }
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 8000)
    const err = detectGovernanceError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    if (!/"id"/.test(output)) {
      message.error('投票失败: ' + output.slice(0, 120))
      return
    }
    message.success('投票已记录')
    showVoteModal.value = false
    await loadAll()
  } catch (e) {
    message.error('投票失败: ' + (e?.message || e))
  } finally {
    voting.value = false
  }
}

async function viewProposalDetails(record) {
  currentProposal.value = record
  detailVotes.value = []
  showDetailsModal.value = true
  try {
    const { output } = await ws.execute(`governance votes ${record.id} --json`, 8000)
    detailVotes.value = parseVotes(output)
  } catch (e) {
    // Soft-fail — modal still shows proposal info
    void e
  }
}

async function runAnalyze(record) {
  currentProposal.value = record
  currentAnalysis.value = null
  try {
    const { output } = await ws.execute(`governance analyze ${record.id} --json`, 8000)
    const err = detectGovernanceError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    const a = parseAnalysis(output)
    if (!a) {
      message.error('分析失败: ' + output.slice(0, 120))
      return
    }
    currentAnalysis.value = a
    showAnalysisModal.value = true
  } catch (e) {
    message.error('分析失败: ' + (e?.message || e))
  }
}

async function runPredict(record) {
  currentProposal.value = record
  currentPrediction.value = null
  try {
    const { output } = await ws.execute(`governance predict ${record.id} --json`, 8000)
    const err = detectGovernanceError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    const p = parsePrediction(output)
    if (!p) {
      message.error('预测失败: ' + output.slice(0, 120))
      return
    }
    currentPrediction.value = p
    showPredictionModal.value = true
  } catch (e) {
    message.error('预测失败: ' + (e?.message || e))
  }
}

function resetCreateForm() {
  createForm.title = ''
  createForm.type = 'feature_request'
  createForm.proposerDid = ''
  createForm.description = ''
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

.governance-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

/* Type catalogue pills */
.type-pill {
  padding: 10px 12px;
  border-radius: 6px;
  background: rgba(22,119,255,.04);
  border: 1px solid var(--border-color);
  border-left: 3px solid #1677ff;
  height: 100%;
}
.type-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.type-count {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}
.type-name {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
}
.type-desc {
  color: var(--text-secondary);
  font-size: 11px;
  margin-top: 2px;
}

/* Breakdown rows */
.bd-row {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
</style>
