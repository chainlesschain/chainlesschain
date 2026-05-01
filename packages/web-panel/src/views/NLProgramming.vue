<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ $t('nlprog.title') }}</h2>
        <p class="page-sub">{{ $t('nlprog.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          {{ $t('nlprog.refresh') }}
        </a-button>
        <a-dropdown :trigger="['click']">
          <a-button type="primary">
            <template #icon><PlusOutlined /></template>
            {{ $t('nlprog.actionDropdown') }}
          </a-button>
          <template #overlay>
            <a-menu @click="handleNewClick">
              <a-menu-item key="analyze"><BulbOutlined /> {{ $t('nlprog.actions.analyze') }}</a-menu-item>
              <a-menu-item key="translate"><CodeOutlined /> {{ $t('nlprog.actions.translate') }}</a-menu-item>
              <a-menu-item key="convention"><FileTextOutlined /> {{ $t('nlprog.actions.convention') }}</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-space>
    </div>

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('nlprog.stats.translations')" :value="stats.translations.total" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><CodeOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('nlprog.stats.avgCompleteness')"
            :value="avgCompletenessPct"
            :precision="1"
            suffix="%"
            :value-style="{ color: stats.translations.avgCompleteness >= 0.7 ? '#52c41a' : '#faad14', fontSize: '20px' }"
          >
            <template #prefix><RiseOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('nlprog.stats.drafts')" :value="stats.translations.byStatus.draft" :value-style="{ color: '#faad14', fontSize: '20px' }">
            <template #prefix><EditOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('nlprog.stats.completed')" :value="stats.translations.byStatus.complete" :value-style="{ color: '#52c41a', fontSize: '20px' }">
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('nlprog.stats.conventions')" :value="stats.conventions.total" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><FileTextOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Intent breakdown -->
    <a-card
      v-if="stats.translations.total > 0"
      :title="$t('nlprog.intentCard')"
      size="small"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
      :body-style="{ padding: '12px 16px' }"
    >
      <a-space :size="[12, 8]" wrap>
        <a-tag v-for="i in INTENTS" :key="i" :color="intentColor(i)">
          {{ intentLabel(i) }}: {{ stats.translations.byIntent[i] || 0 }}
        </a-tag>
      </a-space>
    </a-card>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="nlprog-tabs">
      <!-- ── Translations tab ──────────────────────────────────────── -->
      <a-tab-pane key="translations" :tab="$t('nlprog.tabs.translations')">
        <div class="filter-bar">
          <a-radio-group v-model:value="intentFilter" size="small">
            <a-radio-button value="">{{ $t('nlprog.filter.allIntents') }}</a-radio-button>
            <a-radio-button v-for="i in INTENTS" :key="i" :value="i">{{ intentLabel(i) }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="statusFilter" size="small" button-style="solid">
            <a-radio-button value="">{{ $t('nlprog.filter.allStatuses') }}</a-radio-button>
            <a-radio-button v-for="s in TRANSLATION_STATUSES" :key="s" :value="s">{{ statusLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="translationColumns"
          :data-source="filteredTranslations"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('nlprog.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'inputText'">
              <span style="color: var(--text-primary);">{{ truncate(record.inputText, 80) }}</span>
            </template>
            <template v-if="column.key === 'intent'">
              <a-tag :color="intentColor(record.intent)" style="font-size: 11px;">{{ intentLabel(record.intent) }}</a-tag>
            </template>
            <template v-if="column.key === 'completeness'">
              <a-progress
                :percent="Math.round(record.completenessScore * 100)"
                size="small"
                :stroke-color="completenessColor(record.completenessScore)"
                :format="() => (record.completenessScore * 100).toFixed(0) + '%'"
              />
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'updatedAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatNlprogTime(record.updatedAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" @click="showTranslationDetails(record)">{{ $t('nlprog.table.actionDetails') }}</a-button>
              <a-dropdown :trigger="['click']">
                <a-button size="small" type="link">{{ $t('nlprog.table.actionStatusDropdown') }}</a-button>
                <template #overlay>
                  <a-menu @click="(e) => transitionStatus(record, e.key)">
                    <a-menu-item v-for="s in TRANSLATION_STATUSES" :key="s" :disabled="s === record.status">
                      {{ statusLabel(s) }}
                    </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
              <a-popconfirm
                :title="$t('nlprog.deleteTranslationConfirm.title')"
                :ok-text="$t('nlprog.deleteTranslationConfirm.ok')"
                :cancel-text="$t('nlprog.deleteTranslationConfirm.cancel')"
                @confirm="removeTranslation(record)"
              >
                <a-button size="small" type="link" danger>{{ $t('nlprog.deleteTranslationConfirm.ok') }}</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <CodeOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ intentFilter || statusFilter ? $t('nlprog.table.emptyTranslationsFiltered') : $t('nlprog.table.emptyTranslations') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Conventions tab ──────────────────────────────────────── -->
      <a-tab-pane key="conventions" :tab="$t('nlprog.tabs.conventions')">
        <div class="filter-bar">
          <a-radio-group v-model:value="categoryFilter" size="small" button-style="solid">
            <a-radio-button value="">{{ $t('nlprog.filter.allCategories') }}</a-radio-button>
            <a-radio-button v-for="c in STYLE_CATEGORIES" :key="c" :value="c">{{ categoryLabel(c) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="conventionColumns"
          :data-source="filteredConventions"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('nlprog.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'category'">
              <a-tag :color="categoryColor(record.category)">{{ categoryLabel(record.category) }}</a-tag>
            </template>
            <template v-if="column.key === 'pattern'">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 12px;">{{ record.pattern }}</span>
            </template>
            <template v-if="column.key === 'examples'">
              <a-tag
                v-for="ex in (Array.isArray(record.examples) ? record.examples.slice(0, 3) : [])"
                :key="ex"
                color="default"
                style="font-size: 10px; font-family: monospace; margin: 1px;"
              >{{ ex }}</a-tag>
              <span v-if="!Array.isArray(record.examples) || record.examples.length === 0" style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'confidence'">
              <span :style="{ color: completenessColor(record.confidence), fontWeight: 500 }">
                {{ (record.confidence * 100).toFixed(0) }}%
              </span>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatNlprogTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-popconfirm
                :title="$t('nlprog.deleteConventionConfirm.title')"
                :ok-text="$t('nlprog.deleteConventionConfirm.ok')"
                :cancel-text="$t('nlprog.deleteConventionConfirm.cancel')"
                @confirm="removeConvention(record)"
              >
                <a-button size="small" type="link" danger>{{ $t('nlprog.deleteConventionConfirm.ok') }}</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <FileTextOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ $t('nlprog.table.emptyConventions') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Analyze modal ────────────────────────────────────────── -->
    <a-modal
      v-model:open="showAnalyzeModal"
      :title="$t('nlprog.analyze_modal.title')"
      :confirm-loading="analyzing"
      :width="600"
      :ok-text="$t('nlprog.analyze_modal.ok')"
      :cancel-text="$t('nlprog.analyze_modal.cancel')"
      @ok="runAnalyze"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('nlprog.analyze_modal.textLabel')" required>
          <a-textarea
            v-model:value="analyzeForm.text"
            :placeholder="$t('nlprog.analyze_modal.textPlaceholder')"
            :auto-size="{ minRows: 3, maxRows: 6 }"
          />
        </a-form-item>
      </a-form>

      <a-card v-if="classifyResult || extractResult || stackResult" size="small" style="background: var(--bg-base); margin-top: 8px;">
        <div v-if="classifyResult" style="margin-bottom: 12px;">
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">{{ $t('nlprog.analyze_modal.intent') }}</div>
          <a-tag :color="intentColor(classifyResult.intent)" style="margin-right: 6px;">{{ intentLabel(classifyResult.intent) }}</a-tag>
          <span style="color: var(--text-secondary); font-size: 12px;">{{ $t('nlprog.analyze_modal.confidenceLine', { pct: (classifyResult.confidence * 100).toFixed(0) }) }}</span>
        </div>
        <div v-if="extractResult" style="margin-bottom: 12px;">
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">{{ $t('nlprog.analyze_modal.entities', { n: extractResult.count }) }}</div>
          <span v-if="!extractResult.entities.length" style="color: var(--text-muted);">{{ $t('nlprog.analyze_modal.notDetected') }}</span>
          <a-tag v-for="(e, idx) in extractResult.entities" :key="idx" color="purple" style="font-family: monospace; font-size: 11px; margin: 1px;">
            [{{ e.type }}] {{ e.value }}
          </a-tag>
        </div>
        <div v-if="stackResult">
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">{{ $t('nlprog.analyze_modal.stack') }}</div>
          <span v-if="!stackResult.detected.length" style="color: var(--text-muted);">{{ $t('nlprog.analyze_modal.notDetected') }}</span>
          <template v-else>
            <a-tag :color="'cyan'" style="font-family: monospace;">{{ $t('nlprog.analyze_modal.stackPrimary', { name: stackResult.primary }) }}</a-tag>
            <a-tag v-for="s in stackResult.detected.filter(d => d !== stackResult.primary)" :key="s" color="default" style="font-family: monospace; font-size: 11px;">{{ s }}</a-tag>
          </template>
        </div>
      </a-card>
    </a-modal>

    <!-- ── Translate modal ──────────────────────────────────────── -->
    <a-modal
      v-model:open="showTranslateModal"
      :title="$t('nlprog.translate_modal.title')"
      :confirm-loading="translating"
      :width="540"
      :ok-text="$t('nlprog.translate_modal.ok')"
      :cancel-text="$t('nlprog.translate_modal.cancel')"
      @ok="runTranslate"
      @cancel="resetTranslateForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('nlprog.translate_modal.textLabel')" required>
          <a-textarea
            v-model:value="translateForm.text"
            :placeholder="$t('nlprog.translate_modal.textPlaceholder')"
            :auto-size="{ minRows: 3, maxRows: 6 }"
          />
        </a-form-item>
        <a-form-item :label="$t('nlprog.translate_modal.intentLabel')">
          <a-select v-model:value="translateForm.intent" allow-clear :placeholder="$t('nlprog.translate_modal.intentPlaceholder')">
            <a-select-option v-for="i in INTENTS" :key="i" :value="i">{{ intentLabel(i) }}</a-select-option>
          </a-select>
        </a-form-item>
      </a-form>

      <a-alert
        v-if="translateError.noDb"
        type="warning"
        show-icon
        :message="$t('nlprog.translate_modal.noDbMessage')"
        :description="$t('nlprog.translate_modal.noDbDescription')"
        style="margin-top: 12px;"
      />
    </a-modal>

    <!-- ── Add convention modal ─────────────────────────────────── -->
    <a-modal
      v-model:open="showConventionModal"
      :title="$t('nlprog.convention_modal.title')"
      :confirm-loading="adding"
      :width="540"
      :ok-text="$t('nlprog.convention_modal.ok')"
      :cancel-text="$t('nlprog.convention_modal.cancel')"
      @ok="addConvention"
      @cancel="resetConventionForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('nlprog.convention_modal.categoryLabel')" required>
          <a-select v-model:value="conventionForm.category">
            <a-select-option v-for="c in STYLE_CATEGORIES" :key="c" :value="c">{{ categoryLabel(c) }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('nlprog.convention_modal.patternLabel')" required>
          <a-input v-model:value="conventionForm.pattern" :placeholder="$t('nlprog.convention_modal.patternPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('nlprog.convention_modal.examplesLabel')">
          <a-textarea
            v-model:value="conventionForm.examples"
            :placeholder="$t('nlprog.convention_modal.examplesPlaceholder')"
            :auto-size="{ minRows: 2, maxRows: 4 }"
          />
        </a-form-item>
        <a-form-item :label="$t('nlprog.convention_modal.confidenceLabel')">
          <a-input-number v-model:value="conventionForm.confidence" :min="0" :max="1" :step="0.05" style="width: 100%;" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Translation details modal ────────────────────────────── -->
    <a-modal
      v-model:open="showDetailsModal"
      :title="$t('nlprog.details.title', { id: currentTranslation?.id?.slice(0, 8) || '' })"
      :width="720"
      :footer="null"
    >
      <div v-if="currentTranslation" style="padding-top: 8px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item :label="$t('nlprog.details.intent')">
            <a-tag :color="intentColor(currentTranslation.intent)">{{ intentLabel(currentTranslation.intent) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('nlprog.details.status')">
            <a-tag :color="statusColor(currentTranslation.status)">{{ statusLabel(currentTranslation.status) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('nlprog.details.completeness')" :span="2">
            <a-progress
              :percent="Math.round(currentTranslation.completenessScore * 100)"
              :stroke-color="completenessColor(currentTranslation.completenessScore)"
              size="small"
            />
          </a-descriptions-item>
          <a-descriptions-item :label="$t('nlprog.details.createdAt')">{{ formatNlprogTime(currentTranslation.createdAt) }}</a-descriptions-item>
          <a-descriptions-item :label="$t('nlprog.details.updatedAt')">{{ formatNlprogTime(currentTranslation.updatedAt) }}</a-descriptions-item>
          <a-descriptions-item :label="$t('nlprog.details.inputText')" :span="2">
            <span style="white-space: pre-wrap; color: var(--text-primary);">{{ currentTranslation.inputText }}</span>
          </a-descriptions-item>
        </a-descriptions>

        <div style="margin-top: 16px;">
          <h4 style="color: var(--text-primary); font-size: 13px; margin-bottom: 8px;">{{ $t('nlprog.details.entities') }}</h4>
          <pre class="json-block">{{ formatJson(currentTranslation.entities) }}</pre>
        </div>
        <div>
          <h4 style="color: var(--text-primary); font-size: 13px; margin-bottom: 8px;">{{ $t('nlprog.details.techStack') }}</h4>
          <pre class="json-block">{{ formatJson(currentTranslation.techStack) }}</pre>
        </div>
        <div v-if="currentTranslation.spec">
          <h4 style="color: var(--text-primary); font-size: 13px; margin-bottom: 8px;">{{ $t('nlprog.details.spec') }}</h4>
          <pre class="json-block">{{ formatJson(currentTranslation.spec) }}</pre>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import {
  ReloadOutlined,
  PlusOutlined,
  CodeOutlined,
  BulbOutlined,
  FileTextOutlined,
  EditOutlined,
  CheckCircleOutlined,
  RiseOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useI18n } from 'vue-i18n'
import { useWsStore } from '../stores/ws.js'
import {
  parseClassifyResult,
  parseExtractResult,
  parseStackResult,
  parseTranslations,
  parseTranslateResult,
  detectTranslateError,
  parseConventions,
  parseStats,
  formatNlprogTime,
  INTENTS,
  TRANSLATION_STATUSES,
  STYLE_CATEGORIES,
} from '../utils/nlprog-parser.js'

const ws = useWsStore()
const { t } = useI18n()

const loading = ref(false)
const analyzing = ref(false)
const translating = ref(false)
const adding = ref(false)

const translations = ref([])
const conventions = ref([])
const stats = ref({
  translations: { total: 0, byIntent: {}, byStatus: { draft: 0, complete: 0, refined: 0 }, avgCompleteness: 0 },
  conventions: { total: 0, byCategory: {} },
})

const activeTab = ref('translations')
const intentFilter = ref('')
const statusFilter = ref('')
const categoryFilter = ref('')

const showAnalyzeModal = ref(false)
const showTranslateModal = ref(false)
const showConventionModal = ref(false)
const showDetailsModal = ref(false)

const analyzeForm = reactive({ text: '' })
const translateForm = reactive({ text: '', intent: null })
const conventionForm = reactive({ category: 'naming', pattern: '', examples: '', confidence: 0.8 })

const classifyResult = ref(null)
const extractResult = ref(null)
const stackResult = ref(null)
const translateError = ref({ noDb: false, error: '' })
const currentTranslation = ref(null)

const translationColumns = computed(() => [
  { title: t('nlprog.translationCols.inputText'), key: 'inputText' },
  { title: t('nlprog.translationCols.intent'), key: 'intent', width: '140px' },
  { title: t('nlprog.translationCols.completeness'), key: 'completeness', width: '160px' },
  { title: t('nlprog.translationCols.status'), key: 'status', width: '100px' },
  { title: t('nlprog.translationCols.updatedAt'), key: 'updatedAt', width: '160px' },
  { title: t('nlprog.translationCols.action'), key: 'action', width: '210px' },
])

const conventionColumns = computed(() => [
  { title: t('nlprog.conventionCols.category'), key: 'category', width: '120px' },
  { title: t('nlprog.conventionCols.pattern'), key: 'pattern' },
  { title: t('nlprog.conventionCols.examples'), key: 'examples', width: '220px' },
  { title: t('nlprog.conventionCols.confidence'), key: 'confidence', width: '90px' },
  { title: t('nlprog.conventionCols.createdAt'), key: 'createdAt', width: '160px' },
  { title: t('nlprog.conventionCols.action'), key: 'action', width: '90px' },
])

const avgCompletenessPct = computed(() => stats.value.translations.avgCompleteness * 100)

const filteredTranslations = computed(() => {
  let rows = translations.value
  if (intentFilter.value) rows = rows.filter(t => t.intent === intentFilter.value)
  if (statusFilter.value) rows = rows.filter(t => t.status === statusFilter.value)
  return rows
})

const filteredConventions = computed(() => {
  if (!categoryFilter.value) return conventions.value
  return conventions.value.filter(c => c.category === categoryFilter.value)
})

function intentLabel(i) {
  const key = `nlprog.intentLabels.${i}`
  const v = t(key)
  return v === key ? i : v
}
function intentColor(i) {
  return {
    create_component: 'blue', add_feature: 'green', fix_bug: 'red',
    refactor: 'purple', add_api: 'cyan', add_test: 'orange',
    update_style: 'magenta', configure: 'gold', general: 'default',
  }[i] || 'default'
}
function statusLabel(s) {
  const key = `nlprog.statusLabels.${s}`
  const v = t(key)
  return v === key ? s : v
}
function statusColor(s) {
  return { draft: 'default', complete: 'green', refined: 'cyan' }[s] || 'default'
}
function categoryLabel(c) {
  const key = `nlprog.categoryLabels.${c}`
  const v = t(key)
  return v === key ? c : v
}
function categoryColor(c) {
  return {
    naming: 'blue', architecture: 'purple', testing: 'cyan',
    style: 'magenta', imports: 'orange', components: 'green',
  }[c] || 'default'
}
function completenessColor(score) {
  if (score >= 0.7) return '#52c41a'
  if (score >= 0.4) return '#faad14'
  return '#ff4d4f'
}
function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '...' : s
}
function formatJson(v) {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

function handleNewClick({ key }) {
  if (key === 'analyze') {
    classifyResult.value = null
    extractResult.value = null
    stackResult.value = null
    showAnalyzeModal.value = true
  } else if (key === 'translate') {
    translateError.value = { noDb: false, error: '' }
    showTranslateModal.value = true
  } else if (key === 'convention') {
    showConventionModal.value = true
  }
}

async function loadAll() {
  loading.value = true
  try {
    const [listRes, convRes, statsRes] = await Promise.all([
      ws.execute('nlprog list --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('nlprog conventions --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('nlprog stats --json', 8000).catch(() => ({ output: '' })),
    ])
    translations.value = parseTranslations(listRes.output)
    conventions.value = parseConventions(convRes.output)
    stats.value = parseStats(statsRes.output)
  } catch (e) {
    message.error(t('nlprog.msg.loadFailed') + ': ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function runAnalyze() {
  const text = analyzeForm.text.trim()
  if (!text) {
    message.warning(t('nlprog.msg.textEmpty'))
    return
  }
  analyzing.value = true
  classifyResult.value = null
  extractResult.value = null
  stackResult.value = null
  try {
    const escaped = text.replace(/"/g, '\\"')
    const [c, e, s] = await Promise.all([
      ws.execute(`nlprog classify "${escaped}" --json`, 8000).catch(() => ({ output: '' })),
      ws.execute(`nlprog extract "${escaped}" --json`, 8000).catch(() => ({ output: '' })),
      ws.execute(`nlprog detect-stack "${escaped}" --json`, 8000).catch(() => ({ output: '' })),
    ])
    classifyResult.value = parseClassifyResult(c.output)
    extractResult.value = parseExtractResult(e.output)
    stackResult.value = parseStackResult(s.output)
    if (!classifyResult.value && !extractResult.value && !stackResult.value) {
      message.error(t('nlprog.msg.analyzeFailed'))
    }
  } catch (e) {
    message.error(t('nlprog.msg.analyzeFailed') + ': ' + (e?.message || e))
  } finally {
    analyzing.value = false
  }
}

async function runTranslate() {
  const text = translateForm.text.trim()
  if (!text) {
    message.warning(t('nlprog.msg.translateTextEmpty'))
    return
  }
  translating.value = true
  translateError.value = { noDb: false, error: '' }
  try {
    const parts = [`nlprog translate "${text.replace(/"/g, '\\"')}"`]
    if (translateForm.intent) parts.push(`--intent ${translateForm.intent}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 12000)
    const err = detectTranslateError(output)
    if (err.noDb) {
      translateError.value = err
      return  // keep modal open with the alert showing
    }
    const parsed = parseTranslateResult(output)
    if (!parsed) {
      message.error(t('nlprog.msg.translateFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('nlprog.msg.translateSuccess', { pct: (parsed.completeness * 100).toFixed(0) }))
    showTranslateModal.value = false
    resetTranslateForm()
    await loadAll()
  } catch (e) {
    message.error(t('nlprog.msg.translateFailed') + ': ' + (e?.message || e))
  } finally {
    translating.value = false
  }
}

async function transitionStatus(record, newStatus) {
  if (newStatus === record.status) return
  try {
    const { output } = await ws.execute(`nlprog status ${record.id} ${newStatus} --json`, 8000)
    if (/error|invalid/i.test(output) && !/"updated"/.test(output)) {
      message.error(t('nlprog.msg.transitionFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('nlprog.msg.transitionSuccess', { label: statusLabel(newStatus) }))
    await loadAll()
  } catch (e) {
    message.error(t('nlprog.msg.transitionFailed') + ': ' + (e?.message || e))
  }
}

async function removeTranslation(record) {
  try {
    const { output } = await ws.execute(`nlprog remove ${record.id} --json`, 8000)
    if (/error/i.test(output) && !/"removed"/.test(output)) {
      message.error(t('nlprog.msg.deleteFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('nlprog.msg.deleteSuccess'))
    await loadAll()
  } catch (e) {
    message.error(t('nlprog.msg.deleteFailed') + ': ' + (e?.message || e))
  }
}

function showTranslationDetails(record) {
  currentTranslation.value = record
  showDetailsModal.value = true
}

async function addConvention() {
  const pattern = conventionForm.pattern.trim()
  if (!pattern) {
    message.warning(t('nlprog.msg.patternEmpty'))
    return
  }
  // Validate examples JSON if provided
  if (conventionForm.examples.trim()) {
    try { JSON.parse(conventionForm.examples) } catch {
      message.warning(t('nlprog.msg.examplesBadJson'))
      return
    }
  }
  adding.value = true
  try {
    const parts = [`nlprog convention-add --category ${conventionForm.category}`]
    parts.push(`--pattern "${pattern.replace(/"/g, '\\"')}"`)
    if (conventionForm.examples.trim()) {
      parts.push(`--examples '${conventionForm.examples.trim().replace(/'/g, "'\\''")}'`)
    }
    if (conventionForm.confidence != null) parts.push(`--confidence ${conventionForm.confidence}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    if (/error|invalid|失败/i.test(output) && !/"added"/.test(output)) {
      message.error(t('nlprog.msg.addFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('nlprog.msg.addSuccess'))
    showConventionModal.value = false
    resetConventionForm()
    activeTab.value = 'conventions'
    await loadAll()
  } catch (e) {
    message.error(t('nlprog.msg.addFailed') + ': ' + (e?.message || e))
  } finally {
    adding.value = false
  }
}

async function removeConvention(record) {
  try {
    const { output } = await ws.execute(`nlprog convention-remove ${record.id} --json`, 8000)
    if (/error/i.test(output) && !/"removed"/.test(output)) {
      message.error(t('nlprog.msg.deleteFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('nlprog.msg.deleteSuccess'))
    await loadAll()
  } catch (e) {
    message.error(t('nlprog.msg.deleteFailed') + ': ' + (e?.message || e))
  }
}

function resetTranslateForm() {
  translateForm.text = ''
  translateForm.intent = null
}
function resetConventionForm() {
  conventionForm.category = 'naming'
  conventionForm.pattern = ''
  conventionForm.examples = ''
  conventionForm.confidence = 0.8
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

.nlprog-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.json-block {
  white-space: pre-wrap;
  word-break: break-all;
  color: #52c41a;
  font-size: 11px;
  background: var(--bg-base);
  padding: 8px 12px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  max-height: 240px;
  overflow: auto;
  margin: 0 0 16px;
  font-family: monospace;
}
</style>
