<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">智能推荐</h2>
        <p class="page-sub">兴趣画像 · 主题衰减 · 内容评分 · 反馈学习</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button type="primary" @click="showCreateProfileModal = true">
          <template #icon><UserAddOutlined /></template>
          创建画像
        </a-button>
      </a-space>
    </div>

    <!-- User selector -->
    <a-card size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;" :body-style="{ padding: '10px 16px' }">
      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
        <span style="color: var(--text-secondary); font-size: 12px;">当前用户:</span>
        <a-select
          v-model:value="selectedUser"
          :options="profiles.map(p => ({ value: p.userId, label: `${p.userId} (${p.topicCount} topics)` }))"
          placeholder="选择用户档案"
          style="min-width: 280px;"
          allow-clear
          show-search
          @change="onUserChange"
        />
        <a-button v-if="selectedUser" size="small" @click="applyDecay">
          <template #icon><FieldTimeOutlined /></template>
          应用衰减
        </a-button>
        <a-button v-if="selectedUser" size="small" @click="loadSuggestions">
          <template #icon><BulbOutlined /></template>
          建议调整
        </a-button>
      </div>
    </a-card>

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="用户档案" :value="profiles.length" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><UserOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="推荐总数"
            :value="userStats.total"
            :value-style="{ color: '#722ed1', fontSize: '20px' }"
          >
            <template #prefix><FireOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="待查看"
            :value="userStats.pending"
            :value-style="{ color: userStats.pending > 0 ? '#faad14' : '#888', fontSize: '20px' }"
          >
            <template #prefix><EyeInvisibleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="反馈率"
            :value="userStats.feedbackRate * 100"
            suffix="%"
            :precision="1"
            :value-style="{ color: '#13c2c2', fontSize: '20px' }"
          >
            <template #prefix><LikeOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="平均分"
            :value="userStats.avgScore"
            :precision="3"
            :value-style="{ color: scoreColor(userStats.avgScore), fontSize: '20px' }"
          >
            <template #prefix><StarOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Content type catalogue -->
    <a-card
      title="内容类型"
      size="small"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
      :body-style="{ padding: '12px 16px' }"
    >
      <a-row :gutter="[12, 12]">
        <a-col v-for="t in CONTENT_TYPE_IDS" :key="t" :xs="12" :sm="6">
          <div class="type-pill" :style="{ borderLeftColor: typeBarColor(t) }">
            <a-tag :color="typeColor(t)" style="font-family: monospace;">{{ t }}</a-tag>
            <div class="type-name">{{ typeLabel(t) }}</div>
          </div>
        </a-col>
      </a-row>
    </a-card>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="recommend-tabs">
      <!-- ── Recommendations tab ────────────────────────────────── -->
      <a-tab-pane key="recs" tab="推荐流">
        <div class="filter-bar">
          <a-radio-group v-model:value="statusFilter" size="small" button-style="solid">
            <a-radio-button value="">全部状态</a-radio-button>
            <a-radio-button v-for="s in RECOMMENDATION_STATUSES" :key="s" :value="s">{{ statusLabel(s) }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="typeFilter" size="small">
            <a-radio-button value="">全部类型</a-radio-button>
            <a-radio-button v-for="t in CONTENT_TYPE_IDS" :key="t" :value="t">{{ typeLabel(t) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-empty v-if="!selectedUser" description="请先选择用户档案" :image="EMPTY_IMG" style="padding: 40px 0;" />
        <a-table
          v-else
          :columns="recColumns"
          :data-source="filteredRecs"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          :loading="loadingRecs"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'title'">
              <span style="color: var(--text-primary); font-weight: 500;">{{ record.title || '(无标题)' }}</span>
              <div style="color: var(--text-muted); font-size: 11px; margin-top: 2px;">
                {{ record.contentId }}
              </div>
            </template>
            <template v-if="column.key === 'contentType'">
              <a-tag :color="typeColor(record.contentType)" style="font-family: monospace;">{{ record.contentType }}</a-tag>
            </template>
            <template v-if="column.key === 'score'">
              <a-progress
                :percent="Math.round(record.score * 100)"
                :stroke-color="scoreColor(record.score)"
                size="small"
                :format="() => record.score.toFixed(3)"
              />
            </template>
            <template v-if="column.key === 'reason'">
              <span style="color: var(--text-secondary); font-size: 12px;">{{ record.reason }}</span>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'feedback'">
              <a-tag v-if="record.feedback" :color="feedbackColor(record.feedback)">{{ feedbackLabel(record.feedback) }}</a-tag>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button v-if="record.status === 'pending'" size="small" type="link" @click="markViewed(record)">查看</a-button>
              <a-dropdown v-if="record.status !== 'dismissed'">
                <a-button size="small" type="link">反馈 ▼</a-button>
                <template #overlay>
                  <a-menu @click="({ key }) => provideFeedback(record, key)">
                    <a-menu-item key="like" style="color: #52c41a;">赞</a-menu-item>
                    <a-menu-item key="dislike" style="color: #ff4d4f;">踩</a-menu-item>
                    <a-menu-item key="later">稍后</a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
              <a-popconfirm
                v-if="record.status !== 'dismissed'"
                title="忽略该推荐？"
                ok-text="忽略"
                cancel-text="取消"
                @confirm="dismissRec(record)"
              >
                <a-button size="small" type="link" danger>忽略</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <FireOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ statusFilter || typeFilter ? '没有符合条件的推荐' : '该用户暂无推荐 — 用 cc recommend generate 从内容池生成' }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Profiles tab ───────────────────────────────────────── -->
      <a-tab-pane key="profiles" tab="用户档案">
        <a-table
          :columns="profileColumns"
          :data-source="profiles"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 个档案` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'userId'">
              <span style="color: var(--text-primary); font-family: monospace; font-weight: 500;">{{ record.userId }}</span>
            </template>
            <template v-if="column.key === 'topicCount'">
              <a-tag color="blue">{{ record.topicCount }} 主题</a-tag>
            </template>
            <template v-if="column.key === 'decayFactor'">
              <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">{{ record.decayFactor.toFixed(2) }}</span>
            </template>
            <template v-if="column.key === 'updateCount'">
              <span style="color: var(--text-secondary);">{{ record.updateCount }}</span>
            </template>
            <template v-if="column.key === 'lastUpdated'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatRecommendTime(record.lastUpdated) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" @click="viewProfileDetails(record)">详情</a-button>
              <a-button size="small" type="link" @click="selectAndSwitch(record.userId)">切换</a-button>
              <a-popconfirm
                title="删除该档案？"
                ok-text="删除"
                cancel-text="取消"
                @confirm="deleteProfile(record)"
              >
                <a-button size="small" type="link" danger>删除</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <UserOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              暂无用户档案
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Top interests tab ──────────────────────────────────── -->
      <a-tab-pane key="interests" tab="兴趣画像">
        <a-empty v-if="!selectedUser" description="请先选择用户档案" :image="EMPTY_IMG" style="padding: 40px 0;" />
        <a-row v-else :gutter="[16, 16]">
          <a-col :xs="24" :lg="14">
            <a-card title="主题权重" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <a-empty v-if="!topInterests.length" description="该用户暂无兴趣权重" :image="EMPTY_IMG" />
              <div v-else>
                <div v-for="i in topInterests" :key="i.key" class="interest-row">
                  <span class="interest-topic">{{ i.topic }}</span>
                  <a-progress
                    :percent="Math.round(i.weight * 100)"
                    :stroke-color="weightColor(i.weight)"
                    :format="() => i.weight.toFixed(3)"
                    size="small"
                    style="flex: 1; margin-left: 12px;"
                  />
                </div>
              </div>
            </a-card>
          </a-col>
          <a-col :xs="24" :lg="10">
            <a-card title="反馈建议" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <a-empty v-if="!suggestions.length" description="暂无建议 — 需要更多反馈" :image="EMPTY_IMG" />
              <a-list v-else size="small" :data-source="suggestions">
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-tag :color="item.action === 'boost' ? 'green' : 'orange'">
                      {{ item.action === 'boost' ? '提升' : '降低' }}
                    </a-tag>
                    <span style="margin-left: 8px; font-family: monospace; color: var(--text-primary);">{{ item.topic }}</span>
                    <span style="margin-left: auto; color: var(--text-secondary); font-size: 12px;">±{{ item.amount }}</span>
                  </a-list-item>
                </template>
              </a-list>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Create profile modal ───────────────────────────────── -->
    <a-modal
      v-model:open="showCreateProfileModal"
      title="创建用户档案"
      :confirm-loading="creating"
      :width="560"
      ok-text="创建"
      cancel-text="取消"
      @ok="submitCreateProfile"
      @cancel="resetCreateForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item label="用户 ID" required>
          <a-input v-model:value="createForm.userId" placeholder="例如 alice" />
        </a-form-item>
        <a-form-item label="主题权重">
          <a-textarea
            v-model:value="createForm.topicsJson"
            placeholder='可选 JSON，例如 {"ai":0.8,"vue":0.5}'
            :auto-size="{ minRows: 2, maxRows: 5 }"
          />
        </a-form-item>
        <a-form-item label="交互权重">
          <a-textarea
            v-model:value="createForm.weightsJson"
            placeholder='可选 JSON，例如 {"like":1.0,"view":0.3}'
            :auto-size="{ minRows: 2, maxRows: 5 }"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Profile details modal ──────────────────────────────── -->
    <a-modal
      v-model:open="showDetailsModal"
      :title="`档案详情：${currentProfile?.userId || ''}`"
      :width="680"
      :footer="null"
    >
      <div v-if="currentProfile" style="padding-top: 8px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="ID" :span="2">
            <span style="font-family: monospace; font-size: 12px;">{{ currentProfile.id }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="主题数">{{ currentProfile.topicCount }}</a-descriptions-item>
          <a-descriptions-item label="衰减因子">{{ currentProfile.decayFactor.toFixed(2) }}</a-descriptions-item>
          <a-descriptions-item label="更新次数">{{ currentProfile.updateCount }}</a-descriptions-item>
          <a-descriptions-item label="最后更新">{{ formatRecommendTime(currentProfile.lastUpdated) }}</a-descriptions-item>
        </a-descriptions>

        <h4 style="color: var(--text-primary); font-size: 13px; margin: 16px 0 8px;">主题权重</h4>
        <a-empty v-if="!Object.keys(currentProfile.topics).length" description="无主题权重" :image="EMPTY_IMG" />
        <div v-else>
          <div v-for="(w, t) in currentProfile.topics" :key="t" class="interest-row">
            <span class="interest-topic">{{ t }}</span>
            <a-progress
              :percent="Math.round(w * 100)"
              :stroke-color="weightColor(w)"
              :format="() => w.toFixed(3)"
              size="small"
              style="flex: 1; margin-left: 12px;"
            />
          </div>
        </div>

        <h4 v-if="Object.keys(currentProfile.interactionWeights).length" style="color: var(--text-primary); font-size: 13px; margin: 16px 0 8px;">交互权重</h4>
        <pre v-if="Object.keys(currentProfile.interactionWeights).length" class="weights-pre">{{ formatJson(currentProfile.interactionWeights) }}</pre>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import {
  ReloadOutlined,
  UserAddOutlined,
  UserOutlined,
  FireOutlined,
  EyeInvisibleOutlined,
  LikeOutlined,
  StarOutlined,
  FieldTimeOutlined,
  BulbOutlined,
} from '@ant-design/icons-vue'
import { message, Empty } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parseProfiles,
  parseRecommendations,
  parseUserStats,
  parseTopInterests,
  parseSuggestions,
  parseActionResult,
  formatRecommendTime,
  CONTENT_TYPE_IDS,
  RECOMMENDATION_STATUSES,
} from '../utils/recommend-parser.js'

const ws = useWsStore()

const EMPTY_IMG = Empty.PRESENTED_IMAGE_SIMPLE

const loading = ref(false)
const loadingRecs = ref(false)
const creating = ref(false)

const profiles = ref([])
const recs = ref([])
const userStats = ref({ total: 0, pending: 0, viewed: 0, dismissed: 0, feedbackCount: 0, feedbackRate: 0, avgScore: 0 })
const topInterests = ref([])
const suggestions = ref([])

const selectedUser = ref(null)
const activeTab = ref('recs')
const statusFilter = ref('')
const typeFilter = ref('')

const showCreateProfileModal = ref(false)
const showDetailsModal = ref(false)

const createForm = reactive({ userId: '', topicsJson: '', weightsJson: '' })
const currentProfile = ref(null)

const recColumns = [
  { title: '标题', key: 'title' },
  { title: '类型', key: 'contentType', width: '110px' },
  { title: '评分', key: 'score', width: '180px' },
  { title: '理由', key: 'reason', width: '220px' },
  { title: '状态', key: 'status', width: '100px' },
  { title: '反馈', key: 'feedback', width: '90px' },
  { title: '操作', key: 'action', width: '210px' },
]

const profileColumns = [
  { title: '用户 ID', key: 'userId' },
  { title: '主题数', key: 'topicCount', width: '110px' },
  { title: '衰减因子', key: 'decayFactor', width: '110px' },
  { title: '更新次数', key: 'updateCount', width: '110px' },
  { title: '最后更新', key: 'lastUpdated', width: '180px' },
  { title: '操作', key: 'action', width: '200px' },
]

const filteredRecs = computed(() => {
  let rows = recs.value
  if (statusFilter.value) rows = rows.filter(r => r.status === statusFilter.value)
  if (typeFilter.value) rows = rows.filter(r => r.contentType === typeFilter.value)
  return rows
})

function typeLabel(t) {
  return { note: '笔记', post: '帖子', article: '文章', document: '文档' }[t] || t
}
function typeColor(t) {
  return { note: 'blue', post: 'green', article: 'purple', document: 'orange' }[t] || 'default'
}
function typeBarColor(t) {
  return { note: '#1677ff', post: '#52c41a', article: '#722ed1', document: '#fa8c16' }[t] || '#888'
}

function statusLabel(s) {
  return { pending: '待查看', viewed: '已查看', dismissed: '已忽略' }[s] || s
}
function statusColor(s) {
  return { pending: 'processing', viewed: 'green', dismissed: 'default' }[s] || 'default'
}

function feedbackLabel(f) {
  return { like: '赞', dislike: '踩', later: '稍后' }[f] || f
}
function feedbackColor(f) {
  return { like: 'green', dislike: 'red', later: 'gold' }[f] || 'default'
}

function scoreColor(s) {
  if (s >= 0.7) return '#52c41a'
  if (s >= 0.4) return '#1677ff'
  if (s >= 0.2) return '#faad14'
  return '#ff4d4f'
}

function weightColor(w) {
  if (w >= 0.7) return '#52c41a'
  if (w >= 0.4) return '#1677ff'
  if (w >= 0.2) return '#faad14'
  return '#888'
}

function formatJson(obj) {
  try { return JSON.stringify(obj, null, 2) } catch { return String(obj) }
}

async function loadAll() {
  loading.value = true
  try {
    const { output } = await ws.execute('recommend profiles --json', 10000).catch(() => ({ output: '' }))
    profiles.value = parseProfiles(output)
    if (selectedUser.value && !profiles.value.find(p => p.userId === selectedUser.value)) {
      selectedUser.value = null
    }
    if (selectedUser.value) {
      await loadUserData()
    }
  } catch (e) {
    message.error('加载档案失败: ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function loadUserData() {
  if (!selectedUser.value) {
    recs.value = []
    userStats.value = { total: 0, pending: 0, viewed: 0, dismissed: 0, feedbackCount: 0, feedbackRate: 0, avgScore: 0 }
    topInterests.value = []
    return
  }
  loadingRecs.value = true
  try {
    const uid = encodeArg(selectedUser.value)
    const [recsRes, statsRes, interestsRes] = await Promise.all([
      ws.execute(`recommend list ${uid} --limit 200 --json`, 10000).catch(() => ({ output: '' })),
      ws.execute(`recommend stats ${uid} --json`, 8000).catch(() => ({ output: '' })),
      ws.execute(`recommend top-interests ${uid} --limit 30 --json`, 8000).catch(() => ({ output: '' })),
    ])
    recs.value = parseRecommendations(recsRes.output)
    userStats.value = parseUserStats(statsRes.output)
    topInterests.value = parseTopInterests(interestsRes.output)
  } catch (e) {
    message.error('加载用户数据失败: ' + (e?.message || e))
  } finally {
    loadingRecs.value = false
  }
}

function encodeArg(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`
}

function onUserChange() {
  suggestions.value = []
  loadUserData()
}

function selectAndSwitch(userId) {
  selectedUser.value = userId
  activeTab.value = 'recs'
  loadUserData()
}

async function submitCreateProfile() {
  if (!createForm.userId.trim()) {
    message.warning('请填写用户 ID')
    return
  }
  if (createForm.topicsJson.trim()) {
    try { JSON.parse(createForm.topicsJson) } catch {
      message.warning('主题权重 JSON 格式错误')
      return
    }
  }
  if (createForm.weightsJson.trim()) {
    try { JSON.parse(createForm.weightsJson) } catch {
      message.warning('交互权重 JSON 格式错误')
      return
    }
  }
  creating.value = true
  try {
    const parts = [`recommend create-profile ${encodeArg(createForm.userId.trim())}`]
    if (createForm.topicsJson.trim()) {
      parts.push(`-t ${shellQuote(createForm.topicsJson.trim())}`)
    }
    if (createForm.weightsJson.trim()) {
      parts.push(`-w ${shellQuote(createForm.weightsJson.trim())}`)
    }
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    const r = parseActionResult(output)
    if (!r.ok) {
      message.error('创建失败: ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success(`档案已创建：${r.profileId?.slice(0, 8) || ''}`)
    showCreateProfileModal.value = false
    const newUser = createForm.userId.trim()
    resetCreateForm()
    await loadAll()
    selectedUser.value = newUser
    await loadUserData()
  } catch (e) {
    message.error('创建失败: ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`
}

async function applyDecay() {
  if (!selectedUser.value) return
  try {
    const { output } = await ws.execute(`recommend decay ${encodeArg(selectedUser.value)} --json`, 8000)
    const r = parseActionResult(output)
    if (!r.ok) {
      message.error('衰减失败: ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success(r.topicCount !== null ? `衰减已应用，剩余 ${r.topicCount} 个主题` : '衰减已应用')
    await loadAll()
  } catch (e) {
    message.error('衰减失败: ' + (e?.message || e))
  }
}

async function loadSuggestions() {
  if (!selectedUser.value) return
  try {
    const { output } = await ws.execute(`recommend suggest ${encodeArg(selectedUser.value)} --json`, 8000)
    suggestions.value = parseSuggestions(output)
    activeTab.value = 'interests'
    if (!suggestions.value.length) {
      message.info('暂无建议 — 需要更多反馈')
    } else {
      message.success(`找到 ${suggestions.value.length} 条建议`)
    }
  } catch (e) {
    message.error('加载建议失败: ' + (e?.message || e))
  }
}

async function deleteProfile(record) {
  try {
    const { output } = await ws.execute(`recommend delete-profile ${encodeArg(record.userId)} --json`, 8000)
    const r = parseActionResult(output)
    if (!r.ok) {
      message.error('删除失败: ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success('档案已删除')
    if (selectedUser.value === record.userId) selectedUser.value = null
    await loadAll()
  } catch (e) {
    message.error('删除失败: ' + (e?.message || e))
  }
}

function viewProfileDetails(record) {
  currentProfile.value = record
  showDetailsModal.value = true
}

async function markViewed(record) {
  try {
    const { output } = await ws.execute(`recommend view ${record.id} --json`, 8000)
    const r = parseActionResult(output)
    if (!r.ok) {
      message.error('标记失败: ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success('已标记为已查看')
    await loadUserData()
  } catch (e) {
    message.error('标记失败: ' + (e?.message || e))
  }
}

async function provideFeedback(record, value) {
  try {
    const { output } = await ws.execute(`recommend feedback ${record.id} ${value} --json`, 8000)
    const r = parseActionResult(output)
    if (!r.ok) {
      message.error('反馈失败: ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success('反馈已记录')
    await loadUserData()
  } catch (e) {
    message.error('反馈失败: ' + (e?.message || e))
  }
}

async function dismissRec(record) {
  try {
    const { output } = await ws.execute(`recommend dismiss ${record.id} --json`, 8000)
    const r = parseActionResult(output)
    if (!r.ok) {
      message.error('忽略失败: ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success('已忽略')
    await loadUserData()
  } catch (e) {
    message.error('忽略失败: ' + (e?.message || e))
  }
}

function resetCreateForm() {
  createForm.userId = ''
  createForm.topicsJson = ''
  createForm.weightsJson = ''
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

.recommend-tabs :deep(.ant-tabs-nav) {
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
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(22,119,255,.04);
  border: 1px solid var(--border-color);
  border-left: 3px solid #1677ff;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}
.type-name {
  color: var(--text-primary);
  font-size: 13px;
}

/* Interest rows */
.interest-row {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
.interest-topic {
  min-width: 100px;
  font-family: monospace;
  font-size: 12px;
  color: var(--text-primary);
}

.weights-pre {
  margin: 0;
  padding: 8px 10px;
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 11px;
  max-height: 200px;
  overflow: auto;
  color: var(--text-primary);
}
</style>
