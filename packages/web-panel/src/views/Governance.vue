<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ $t('governance.title') }}</h2>
        <p class="page-sub">{{ $t('governance.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          {{ $t('governance.refresh') }}
        </a-button>
        <a-button type="primary" @click="showCreateModal = true">
          <template #icon><PlusOutlined /></template>
          {{ $t('governance.create') }}
        </a-button>
      </a-space>
    </div>

    <!-- noDb banner -->
    <a-alert
      v-if="errorState.noDb"
      type="info"
      show-icon
      :message="$t('governance.noDb.message')"
      :description="$t('governance.noDb.description')"
      style="margin-bottom: 16px;"
    />

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('governance.stats.total')" :value="stats.proposalCount" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><FileTextOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('governance.stats.active')"
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
            :title="$t('governance.stats.passed')"
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
            :title="$t('governance.stats.rejected')"
            :value="stats.byStatus.rejected || 0"
            :value-style="{ color: '#ff4d4f', fontSize: '20px' }"
          >
            <template #prefix><CloseCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('governance.stats.votes')" :value="stats.voteCount" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><LikeOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Type catalogue -->
    <a-card
      :title="$t('governance.typesCard')"
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
      <a-tab-pane key="proposals" :tab="$t('governance.tabs.proposals')">
        <div class="filter-bar">
          <a-radio-group v-model:value="statusFilter" size="small" button-style="solid">
            <a-radio-button value="">{{ $t('governance.filter.allStatuses') }}</a-radio-button>
            <a-radio-button v-for="s in PROPOSAL_STATUSES" :key="s" :value="s">{{ statusLabel(s) }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="typeFilter" size="small">
            <a-radio-button value="">{{ $t('governance.filter.allTypes') }}</a-radio-button>
            <a-radio-button v-for="t in PROPOSAL_TYPE_IDS" :key="t" :value="t">{{ typeLabel(t) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="proposalColumns"
          :data-source="filteredProposals"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('governance.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'title'">
              <span style="color: var(--text-primary); font-weight: 500;">{{ record.title || $t('governance.table.unnamed') }}</span>
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
              <a-button size="small" type="link" @click="viewProposalDetails(record)">{{ $t('governance.actions.details') }}</a-button>
              <a-button v-if="record.status === 'draft'" size="small" type="link" @click="activateProposal(record)">{{ $t('governance.actions.activate') }}</a-button>
              <a-button v-if="record.status === 'active'" size="small" type="link" style="color: #52c41a;" @click="openVoteModal(record)">{{ $t('governance.actions.vote') }}</a-button>
              <a-popconfirm
                v-if="record.status === 'active'"
                :title="$t('governance.closeConfirm.title')"
                :ok-text="$t('governance.closeConfirm.ok')"
                :cancel-text="$t('governance.closeConfirm.cancel')"
                @confirm="closeProposal(record)"
              >
                <a-button size="small" type="link" danger>{{ $t('governance.actions.close') }}</a-button>
              </a-popconfirm>
              <a-button size="small" type="link" @click="runAnalyze(record)">{{ $t('governance.actions.analyze') }}</a-button>
              <a-button size="small" type="link" @click="runPredict(record)">{{ $t('governance.actions.predict') }}</a-button>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <FileTextOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ statusFilter || typeFilter ? $t('governance.table.emptyFiltered') : $t('governance.table.empty') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Status & type breakdown tab ──────────────────────────── -->
      <a-tab-pane key="breakdown" :tab="$t('governance.tabs.breakdown')">
        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :lg="12">
            <a-card :title="$t('governance.breakdown.byStatus')" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
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
            <a-card :title="$t('governance.breakdown.byType')" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
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
      :title="$t('governance.create_modal.title')"
      :confirm-loading="creating"
      :width="560"
      :ok-text="$t('governance.create_modal.ok')"
      :cancel-text="$t('governance.create_modal.cancel')"
      @ok="createProposal"
      @cancel="resetCreateForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('governance.create_modal.titleLabel')" required>
          <a-input v-model:value="createForm.title" :placeholder="$t('governance.create_modal.titlePlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('governance.create_modal.typeLabel')" required>
          <a-select v-model:value="createForm.type">
            <a-select-option v-for="t in PROPOSAL_TYPE_IDS" :key="t" :value="t">{{ typeLabel(t) }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('governance.create_modal.proposerLabel')">
          <a-input v-model:value="createForm.proposerDid" :placeholder="$t('governance.create_modal.proposerPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('governance.create_modal.descLabel')">
          <a-textarea
            v-model:value="createForm.description"
            :placeholder="$t('governance.create_modal.descPlaceholder')"
            :auto-size="{ minRows: 3, maxRows: 8 }"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Vote modal ───────────────────────────────────────────── -->
    <a-modal
      v-model:open="showVoteModal"
      :title="$t('governance.vote_modal.title', { title: currentProposal?.title || '' })"
      :confirm-loading="voting"
      :width="540"
      :ok-text="$t('governance.vote_modal.ok')"
      :cancel-text="$t('governance.vote_modal.cancel')"
      @ok="submitVote"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('governance.vote_modal.voterLabel')" required>
          <a-input v-model:value="voteForm.voterDid" placeholder="did:key:..." />
        </a-form-item>
        <a-form-item :label="$t('governance.vote_modal.valueLabel')" required>
          <a-radio-group v-model:value="voteForm.value" button-style="solid">
            <a-radio-button value="yes" style="color: #52c41a;">{{ $t('governance.vote_modal.yes') }}</a-radio-button>
            <a-radio-button value="no" style="color: #ff4d4f;">{{ $t('governance.vote_modal.no') }}</a-radio-button>
            <a-radio-button value="abstain">{{ $t('governance.vote_modal.abstain') }}</a-radio-button>
          </a-radio-group>
        </a-form-item>
        <a-form-item :label="$t('governance.vote_modal.weightLabel')">
          <a-input-number v-model:value="voteForm.weight" :min="0.1" :step="0.1" style="width: 120px;" />
          <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">{{ $t('governance.vote_modal.weightHint') }}</span>
        </a-form-item>
        <a-form-item :label="$t('governance.vote_modal.reasonLabel')">
          <a-textarea
            v-model:value="voteForm.reason"
            :placeholder="$t('governance.vote_modal.reasonPlaceholder')"
            :auto-size="{ minRows: 2, maxRows: 5 }"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Proposal details modal ──────────────────────────────── -->
    <a-modal
      v-model:open="showDetailsModal"
      :title="$t('governance.details.title', { title: currentProposal?.title || '' })"
      :width="780"
      :footer="null"
    >
      <div v-if="currentProposal" style="padding-top: 8px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item :label="$t('governance.details.id')" :span="2">
            <span style="font-family: monospace; font-size: 12px;">{{ currentProposal.id }}</span>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('governance.details.type')">
            <a-tag :color="typeColor(currentProposal.type)">{{ typeLabel(currentProposal.type) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('governance.details.status')">
            <a-tag :color="statusColor(currentProposal.status)">{{ statusLabel(currentProposal.status) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('governance.details.proposer')" :span="2">
            <span v-if="currentProposal.proposerDid" style="font-family: monospace; font-size: 12px;">{{ currentProposal.proposerDid }}</span>
            <span v-else style="color: var(--text-muted);">{{ $t('governance.details.proposerUnset') }}</span>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('governance.details.description')" :span="2">
            <div v-if="currentProposal.description" style="white-space: pre-wrap;">{{ currentProposal.description }}</div>
            <span v-else style="color: var(--text-muted);">—</span>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('governance.details.tally')" :span="2">
            <a-space>
              <a-tag color="green">{{ $t('governance.details.tallyYes', { n: currentProposal.voteYes }) }}</a-tag>
              <a-tag color="red">{{ $t('governance.details.tallyNo', { n: currentProposal.voteNo }) }}</a-tag>
              <a-tag>{{ $t('governance.details.tallyAbstain', { n: currentProposal.voteAbstain }) }}</a-tag>
            </a-space>
          </a-descriptions-item>
          <a-descriptions-item v-if="currentProposal.impactLevel" :label="$t('governance.details.impact')">
            <a-tag :color="impactColor(currentProposal.impactLevel)">{{ impactLabel(currentProposal.impactLevel) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('governance.details.createdAt')">{{ formatGovernanceTime(currentProposal.createdAt) }}</a-descriptions-item>
          <a-descriptions-item v-if="currentProposal.votingStartsAt" :label="$t('governance.details.votingStartsAt')">{{ formatGovernanceTime(currentProposal.votingStartsAt) }}</a-descriptions-item>
          <a-descriptions-item v-if="currentProposal.votingEndsAt" :label="$t('governance.details.votingEndsAt')">{{ formatGovernanceTime(currentProposal.votingEndsAt) }}</a-descriptions-item>
        </a-descriptions>

        <!-- Votes list -->
        <h4 style="color: var(--text-primary); font-size: 13px; margin: 20px 0 10px;">{{ $t('governance.details.votesHeader') }}</h4>
        <a-empty v-if="!detailVotes.length" :description="$t('governance.details.votesEmpty')" :image="EMPTY_IMG" />
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
      :title="$t('governance.analysis.title', { title: currentProposal?.title || '' })"
      :width="640"
      :footer="null"
    >
      <div v-if="currentAnalysis" style="padding-top: 8px;">
        <a-row :gutter="[12, 12]" style="margin-bottom: 16px;">
          <a-col :span="8">
            <a-statistic :title="$t('governance.analysis.impactLevel')" :value="impactLabel(currentAnalysis.impactLevel)" :value-style="{ color: impactBarColor(currentAnalysis.impactLevel), fontSize: '16px' }" />
          </a-col>
          <a-col :span="8">
            <a-statistic :title="$t('governance.analysis.effort')" :value="effortLabel(currentAnalysis.estimatedEffort)" :value-style="{ fontSize: '16px' }" />
          </a-col>
          <a-col :span="8">
            <a-statistic :title="$t('governance.analysis.sentiment')" :value="sentimentLabel(currentAnalysis.communitySentiment)" :value-style="{ fontSize: '16px' }" />
          </a-col>
        </a-row>

        <a-card :title="$t('governance.analysis.riskBenefit')" size="small" style="margin-bottom: 12px;">
          <div style="margin-bottom: 8px;">
            <span style="color: var(--text-secondary); font-size: 12px;">{{ $t('governance.analysis.riskScore') }}</span>
            <a-progress :percent="Math.round(currentAnalysis.riskScore * 100)" stroke-color="#ff4d4f" />
          </div>
          <div>
            <span style="color: var(--text-secondary); font-size: 12px;">{{ $t('governance.analysis.benefitScore') }}</span>
            <a-progress :percent="Math.round(currentAnalysis.benefitScore * 100)" stroke-color="#52c41a" />
          </div>
        </a-card>

        <a-card v-if="currentAnalysis.affectedComponents.length" :title="$t('governance.analysis.components')" size="small" style="margin-bottom: 12px;">
          <a-tag v-for="c in currentAnalysis.affectedComponents" :key="c" color="blue">{{ c }}</a-tag>
        </a-card>

        <a-card v-if="currentAnalysis.recommendations.length" :title="$t('governance.analysis.recommendations')" size="small">
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
      :title="$t('governance.prediction.title', { title: currentProposal?.title || '' })"
      :width="540"
      :footer="null"
    >
      <div v-if="currentPrediction" style="padding-top: 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <a-tag
            :color="currentPrediction.predictedOutcome === 'pass' ? 'green' : 'red'"
            style="font-size: 16px; padding: 6px 14px;"
          >
            {{ currentPrediction.predictedOutcome === 'pass' ? $t('governance.prediction.outcomePass') : $t('governance.prediction.outcomeReject') }}
          </a-tag>
        </div>
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item :label="$t('governance.prediction.confidence')" :span="2">
            <a-progress :percent="Math.round(currentPrediction.confidence * 100)" :stroke-color="currentPrediction.confidence >= 0.6 ? '#52c41a' : '#faad14'" />
          </a-descriptions-item>
          <a-descriptions-item :label="$t('governance.prediction.basedOn')">
            <a-tag :color="currentPrediction.basedOn === 'votes' ? 'blue' : 'orange'">
              {{ currentPrediction.basedOn === 'votes' ? $t('governance.prediction.basedOnVotes') : $t('governance.prediction.basedOnHeuristic') }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('governance.prediction.sampleSize')">{{ currentPrediction.sampleSize }}</a-descriptions-item>
          <a-descriptions-item :label="$t('governance.prediction.yesProb')">
            <span style="color: #52c41a;">{{ (currentPrediction.yesProb * 100).toFixed(1) }}%</span>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('governance.prediction.noProb')">
            <span style="color: #ff4d4f;">{{ (currentPrediction.noProb * 100).toFixed(1) }}%</span>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('governance.prediction.abstainProb')" :span="2">
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
import { useI18n } from 'vue-i18n'
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
const { t } = useI18n()

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

const proposalColumns = computed(() => [
  { title: t('governance.cols.title'), key: 'title' },
  { title: t('governance.cols.type'), key: 'type', width: '130px' },
  { title: t('governance.cols.status'), key: 'status', width: '100px' },
  { title: t('governance.cols.tally'), key: 'tally', width: '180px' },
  { title: t('governance.cols.impact'), key: 'impact', width: '100px' },
  { title: t('governance.cols.createdAt'), key: 'createdAt', width: '160px' },
  { title: t('governance.cols.action'), key: 'action', width: '320px' },
])

const filteredProposals = computed(() => {
  let rows = proposals.value
  if (statusFilter.value) rows = rows.filter(p => p.status === statusFilter.value)
  if (typeFilter.value) rows = rows.filter(p => p.type === typeFilter.value)
  return rows
})

function statusLabel(s) {
  const key = `governance.statusLabels.${s}`
  const v = t(key)
  return v === key ? s : v
}
function statusColor(s) {
  return { draft: 'default', active: 'processing', passed: 'green', rejected: 'red', expired: 'default' }[s] || 'default'
}
function statusBarColor(s) {
  return { draft: '#888', active: '#1677ff', passed: '#52c41a', rejected: '#ff4d4f', expired: '#888' }[s] || '#888'
}

// renamed param to avoid shadowing the t() i18n helper
function typeLabel(typeId) {
  const key = `governance.typeLabels.${typeId}`
  const v = t(key)
  return v === key ? typeId : v
}
function typeColor(typeId) {
  return {
    parameter_change: 'cyan',
    feature_request: 'blue',
    policy_update: 'purple',
    budget_allocation: 'gold',
  }[typeId] || 'default'
}
function typeBarColor(typeId) {
  return { parameter_change: '#13c2c2', feature_request: '#1677ff', policy_update: '#722ed1', budget_allocation: '#faad14' }[typeId] || '#888'
}

function impactLabel(l) {
  const key = `governance.impactLabels.${l}`
  const v = t(key)
  return v === key ? l : v
}
function impactColor(l) {
  return { low: 'default', medium: 'blue', high: 'orange', critical: 'red' }[l] || 'default'
}
function impactBarColor(l) {
  return { low: '#888', medium: '#1677ff', high: '#faad14', critical: '#ff4d4f' }[l] || '#888'
}

function voteLabel(v) {
  const key = `governance.voteLabels.${v}`
  const out = t(key)
  return out === key ? v : out
}
function voteColor(v) {
  return { yes: 'green', no: 'red', abstain: 'default' }[v] || 'default'
}

function effortLabel(e) {
  if (!e) return '—'
  const key = `governance.effortLabels.${e}`
  const v = t(key)
  return v === key ? e : v
}
function sentimentLabel(s) {
  if (!s) return '—'
  const key = `governance.sentimentLabels.${s}`
  const v = t(key)
  return v === key ? s : v
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
    message.error(t('governance.msg.loadFailed') + ': ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function createProposal() {
  if (!createForm.title.trim()) {
    message.warning(t('governance.msg.titleEmpty'))
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
      message.error(t('governance.msg.needCcInit'))
      return
    }
    if (!/"id"/.test(output)) {
      message.error(t('governance.msg.createFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('governance.msg.createSuccess'))
    showCreateModal.value = false
    resetCreateForm()
    await loadAll()
  } catch (e) {
    message.error(t('governance.msg.createFailed') + ': ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function activateProposal(record) {
  await runProposalAction(`governance activate ${record.id} --json`, t('governance.msg.activated'))
}

async function closeProposal(record) {
  await runProposalAction(`governance close ${record.id} --json`, t('governance.msg.closed'))
}

async function runProposalAction(command, successMsg) {
  try {
    const { output } = await ws.execute(command, 10000)
    const err = detectGovernanceError(output)
    if (err.noDb) {
      message.error(t('governance.msg.needCcInit'))
      return
    }
    if (!/"id"|"proposalId"|"passed"/.test(output)) {
      message.error(t('governance.msg.actionFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(successMsg)
    await loadAll()
  } catch (e) {
    message.error(t('governance.msg.actionFailed') + ': ' + (e?.message || e))
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
    message.warning(t('governance.msg.voterEmpty'))
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
      message.error(t('governance.msg.needCcInit'))
      return
    }
    if (!/"id"/.test(output)) {
      message.error(t('governance.msg.voteFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('governance.msg.voteSuccess'))
    showVoteModal.value = false
    await loadAll()
  } catch (e) {
    message.error(t('governance.msg.voteFailed') + ': ' + (e?.message || e))
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
      message.error(t('governance.msg.needCcInit'))
      return
    }
    const a = parseAnalysis(output)
    if (!a) {
      message.error(t('governance.msg.analyzeFailed') + ': ' + output.slice(0, 120))
      return
    }
    currentAnalysis.value = a
    showAnalysisModal.value = true
  } catch (e) {
    message.error(t('governance.msg.analyzeFailed') + ': ' + (e?.message || e))
  }
}

async function runPredict(record) {
  currentProposal.value = record
  currentPrediction.value = null
  try {
    const { output } = await ws.execute(`governance predict ${record.id} --json`, 8000)
    const err = detectGovernanceError(output)
    if (err.noDb) {
      message.error(t('governance.msg.needCcInit'))
      return
    }
    const p = parsePrediction(output)
    if (!p) {
      message.error(t('governance.msg.predictFailed') + ': ' + output.slice(0, 120))
      return
    }
    currentPrediction.value = p
    showPredictionModal.value = true
  } catch (e) {
    message.error(t('governance.msg.predictFailed') + ': ' + (e?.message || e))
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
