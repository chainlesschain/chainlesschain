<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">知识图谱</h2>
        <p class="page-sub">实体 / 关系 / 多跳推理 / 力导向图谱</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button type="primary" @click="showAddEntityModal = true">
          <template #icon><PlusOutlined /></template>
          添加实体
        </a-button>
        <a-button @click="showAddRelationModal = true" :disabled="entities.length < 2">
          <template #icon><LinkOutlined /></template>
          添加关系
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="实体数量"
            :value="stats.entityCount"
            :value-style="{ color: '#1677ff', fontSize: '20px' }"
          >
            <template #prefix><DeploymentUnitOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="关系数量"
            :value="stats.relationCount"
            :value-style="{ color: '#52c41a', fontSize: '20px' }"
          >
            <template #prefix><LinkOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="平均度"
            :value="stats.avgDegree"
            :precision="2"
            :value-style="{ color: '#faad14', fontSize: '20px' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="密度"
            :value="stats.density"
            :precision="4"
            :value-style="{ color: '#722ed1', fontSize: '20px' }"
          />
        </a-card>
      </a-col>
    </a-row>

    <a-alert
      v-if="!hasDesktopFeatures"
      message="仅 Web 模式"
      description="AI 自动抽取（从笔记/对话生成实体与关系）仅在桌面端可用，本页面禁用相关按钮。所有 CRUD/推理/统计操作通过 CLI 转发执行。"
      type="info"
      show-icon
      closable
      style="margin-bottom: 16px;"
    />

    <a-tabs v-model:activeKey="activeTab" type="card">
      <!-- Tab 1: 图谱可视化 -->
      <a-tab-pane key="graph">
        <template #tab>
          <ShareAltOutlined /> 图谱
        </template>

        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <template #extra>
            <a-space>
              <a-tooltip title="桌面应用专属：从笔记/对话/文档 AI 抽取实体与关系">
                <a-button disabled size="small">
                  <template #icon><ThunderboltOutlined /></template>
                  AI 重建
                </a-button>
              </a-tooltip>
              <span style="color: var(--text-muted); font-size: 11px;">需桌面端</span>
            </a-space>
          </template>
          <div v-if="entities.length === 0" style="padding: 60px; text-align: center;">
            <a-empty description="暂无实体数据。点击「添加实体」开始构建知识图谱" />
          </div>
          <div v-else style="height: 540px;">
            <v-chart :option="graphOption" autoresize />
          </div>
        </a-card>
      </a-tab-pane>

      <!-- Tab 2: 实体列表 -->
      <a-tab-pane key="entities">
        <template #tab>
          <DeploymentUnitOutlined /> 实体（{{ entities.length }}）
        </template>

        <a-table
          :columns="entityColumns"
          :data-source="entities"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          style="background: var(--bg-card);"
          :row-class-name="() => 'kg-row'"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'id'">
              <span style="color: #888; font-family: monospace; font-size: 11px;">{{ record.id.slice(0, 12) }}</span>
            </template>
            <template v-if="column.key === 'name'">
              <span style="color: var(--text-primary);">{{ record.name }}</span>
            </template>
            <template v-if="column.key === 'type'">
              <a-tag :color="entityTypeColor(record.type)">{{ record.type }}</a-tag>
            </template>
            <template v-if="column.key === 'tags'">
              <a-tag v-for="t in record.tags" :key="t" color="default">{{ t }}</a-tag>
              <span v-if="record.tags.length === 0" style="color: var(--text-muted);">-</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-space size="small">
                <a-button size="small" type="link" @click="openReason(record)">
                  推理
                </a-button>
                <a-popconfirm
                  title="删除实体？关联的关系将级联删除。"
                  ok-text="删除"
                  ok-type="danger"
                  cancel-text="取消"
                  @confirm="removeEntity(record)"
                >
                  <a-button size="small" type="link" danger :loading="removing === record.id">
                    删除
                  </a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </template>
          <template #emptyText>
            <a-empty description="暂无实体" />
          </template>
        </a-table>
      </a-tab-pane>

      <!-- Tab 3: 关系列表 -->
      <a-tab-pane key="relations">
        <template #tab>
          <LinkOutlined /> 关系（{{ relations.length }}）
        </template>

        <a-table
          :columns="relationColumns"
          :data-source="relations"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          style="background: var(--bg-card);"
          :row-class-name="() => 'kg-row'"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'source'">
              <span style="color: #888; font-family: monospace; font-size: 11px;">{{ entityNameOrId(record.sourceId) }}</span>
            </template>
            <template v-if="column.key === 'arrow'">
              <span style="color: var(--text-muted);">→</span>
            </template>
            <template v-if="column.key === 'target'">
              <span style="color: #888; font-family: monospace; font-size: 11px;">{{ entityNameOrId(record.targetId) }}</span>
            </template>
            <template v-if="column.key === 'relationType'">
              <a-tag color="cyan">{{ record.relationType }}</a-tag>
            </template>
            <template v-if="column.key === 'weight'">
              <span style="color: var(--text-secondary); font-family: monospace;">{{ record.weight.toFixed(2) }}</span>
            </template>
          </template>
          <template #emptyText>
            <a-empty description="暂无关系" />
          </template>
        </a-table>
      </a-tab-pane>

      <!-- Tab 4: 类型分布 -->
      <a-tab-pane key="distribution">
        <template #tab>
          <BarChartOutlined /> 分布
        </template>

        <a-row :gutter="[24, 24]">
          <a-col :xs="24" :md="12">
            <a-card title="实体类型分布" style="background: var(--bg-card); border-color: var(--border-color);">
              <div v-if="entityTypeRows.length === 0" style="padding: 40px; text-align: center; color: var(--text-muted);">
                暂无数据
              </div>
              <div v-for="row in entityTypeRows" :key="row.type" style="margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <a-tag :color="entityTypeColor(row.type)">{{ row.type }}</a-tag>
                  <span style="color: var(--text-secondary); font-family: monospace;">{{ row.count }}</span>
                </div>
                <a-progress :percent="row.percent" :show-info="false" :stroke-color="'#1677ff'" />
              </div>
            </a-card>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-card title="关系类型分布" style="background: var(--bg-card); border-color: var(--border-color);">
              <div v-if="relationTypeRows.length === 0" style="padding: 40px; text-align: center; color: var(--text-muted);">
                暂无数据
              </div>
              <div v-for="row in relationTypeRows" :key="row.type" style="margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <a-tag color="cyan">{{ row.type }}</a-tag>
                  <span style="color: var(--text-secondary); font-family: monospace;">{{ row.count }}</span>
                </div>
                <a-progress :percent="row.percent" :show-info="false" :stroke-color="'#52c41a'" />
              </div>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>
    </a-tabs>

    <!-- Add Entity Modal -->
    <a-modal
      v-model:open="showAddEntityModal"
      title="添加实体"
      :confirm-loading="addingEntity"
      @ok="addEntity"
      ok-text="添加"
      cancel-text="取消"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
        <a-form-item label="名称" required>
          <a-input v-model:value="newEntity.name" placeholder="实体名称（如 Alice / ChainlessChain / RAG）" />
        </a-form-item>
        <a-form-item label="类型" required>
          <a-select v-model:value="newEntity.type" placeholder="请选择实体类型" :loading="loadingTypes">
            <a-select-option v-for="t in entityTypes" :key="t.name" :value="t.name">
              {{ t.name }} <span style="color: var(--text-muted); font-size: 11px;">— {{ t.description }}</span>
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="标签">
          <a-input v-model:value="newEntity.tags" placeholder="逗号分隔，如 ai, project" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Add Relation Modal -->
    <a-modal
      v-model:open="showAddRelationModal"
      title="添加关系"
      :confirm-loading="addingRelation"
      @ok="addRelation"
      ok-text="添加"
      cancel-text="取消"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
        <a-form-item label="源实体" required>
          <a-select v-model:value="newRelation.sourceId" placeholder="选择源实体" show-search :filter-option="entityFilter">
            <a-select-option v-for="e in entities" :key="e.id" :value="e.id">
              {{ e.name }} ({{ e.type }})
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="目标实体" required>
          <a-select v-model:value="newRelation.targetId" placeholder="选择目标实体" show-search :filter-option="entityFilter">
            <a-select-option v-for="e in entities" :key="e.id" :value="e.id" :disabled="e.id === newRelation.sourceId">
              {{ e.name }} ({{ e.type }})
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="关系类型" required>
          <a-input v-model:value="newRelation.relationType" placeholder="如 知道 / 属于 / 创建" />
        </a-form-item>
        <a-form-item label="权重">
          <a-input-number v-model:value="newRelation.weight" :min="0.1" :max="10" :step="0.1" style="width: 100%;" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Reason Modal (BFS) -->
    <a-modal
      v-model:open="showReasonModal"
      :title="`多跳推理：${reasonStartName}`"
      :width="640"
      :footer="null"
    >
      <a-form layout="inline" style="margin-bottom: 16px;">
        <a-form-item label="最大深度">
          <a-input-number v-model:value="reasonOptions.maxDepth" :min="1" :max="10" />
        </a-form-item>
        <a-form-item label="方向">
          <a-select v-model:value="reasonOptions.direction" style="width: 100px;">
            <a-select-option value="out">出</a-select-option>
            <a-select-option value="in">入</a-select-option>
            <a-select-option value="both">双向</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item>
          <a-button type="primary" :loading="reasoning" @click="runReason">
            执行
          </a-button>
        </a-form-item>
      </a-form>

      <div v-if="reasonResults.length === 0 && !reasoning" style="padding: 30px; text-align: center; color: var(--text-muted);">
        点击「执行」查看从此实体出发可达的实体
      </div>
      <a-list v-else :data-source="reasonResults" size="small">
        <template #renderItem="{ item }">
          <a-list-item>
            <a-tag color="purple">depth={{ item.depth }}</a-tag>
            <a-tag :color="entityTypeColor(item.entity.type)" style="margin-left: 8px;">{{ item.entity.type }}</a-tag>
            <span style="margin-left: 12px; color: var(--text-primary);">{{ item.entity.name }}</span>
            <span style="margin-left: 8px; color: #888; font-family: monospace; font-size: 11px;">{{ item.entity.id.slice(0, 12) }}</span>
          </a-list-item>
        </template>
      </a-list>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import {
  ReloadOutlined,
  PlusOutlined,
  LinkOutlined,
  DeploymentUnitOutlined,
  ShareAltOutlined,
  BarChartOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { GraphChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent, TitleComponent } from 'echarts/components'
import { useWsStore } from '../stores/ws.js'
import {
  parseEntities,
  parseRelations,
  parseStats,
  parseReason,
  parseEntityTypes,
  buildGraphData,
} from '../utils/kg-parser.js'

use([CanvasRenderer, GraphChart, TooltipComponent, LegendComponent, TitleComponent])

const ws = useWsStore()

const hasDesktopFeatures = ref(false)
const loading = ref(false)
const loadingTypes = ref(false)
const addingEntity = ref(false)
const addingRelation = ref(false)
const removing = ref('')
const reasoning = ref(false)

const activeTab = ref('graph')
const entities = ref([])
const relations = ref([])
const entityTypes = ref([])
const stats = ref({
  entityCount: 0,
  relationCount: 0,
  avgDegree: 0,
  density: 0,
  typeDistribution: {},
  relationTypeDistribution: {},
})

const showAddEntityModal = ref(false)
const showAddRelationModal = ref(false)
const showReasonModal = ref(false)
const newEntity = reactive({ name: '', type: '', tags: '' })
const newRelation = reactive({ sourceId: '', targetId: '', relationType: '', weight: 1.0 })
const reasonOptions = reactive({ maxDepth: 3, direction: 'out' })
const reasonStartId = ref('')
const reasonStartName = ref('')
const reasonResults = ref([])

const entityColumns = [
  { title: 'ID', key: 'id', width: '120px' },
  { title: '名称', key: 'name', dataIndex: 'name', ellipsis: true },
  { title: '类型', key: 'type', dataIndex: 'type', width: '140px' },
  { title: '标签', key: 'tags', width: '200px' },
  { title: '操作', key: 'action', width: '160px' },
]

const relationColumns = [
  { title: '源', key: 'source', width: '120px' },
  { title: '', key: 'arrow', width: '40px' },
  { title: '目标', key: 'target', width: '120px' },
  { title: '关系', key: 'relationType', width: '160px' },
  { title: '权重', key: 'weight', width: '100px' },
]

const TYPE_COLORS = {
  Person: 'magenta',
  Organization: 'blue',
  Project: 'cyan',
  Technology: 'geekblue',
  Document: 'gold',
  Concept: 'purple',
  Event: 'volcano',
}
function entityTypeColor(type) {
  return TYPE_COLORS[type] || 'default'
}

const entityNameMap = computed(() => {
  const m = new Map()
  for (const e of entities.value) m.set(e.id, e.name || e.id.slice(0, 8))
  return m
})

function entityNameOrId(id) {
  return entityNameMap.value.get(id) || id.slice(0, 12)
}

function entityFilter(input, option) {
  return String(option?.children?.[0]?.children || '').toLowerCase().includes(String(input).toLowerCase())
}

const entityTypeRows = computed(() => {
  const dist = stats.value.typeDistribution || {}
  const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1
  return Object.entries(dist)
    .map(([type, count]) => ({ type, count, percent: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count)
})

const relationTypeRows = computed(() => {
  const dist = stats.value.relationTypeDistribution || {}
  const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1
  return Object.entries(dist)
    .map(([type, count]) => ({ type, count, percent: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count)
})

const graphOption = computed(() => {
  const { nodes, links, categories } = buildGraphData(entities.value, relations.value)
  return {
    tooltip: { show: true },
    legend: [{
      data: categories.map(c => c.name),
      textStyle: { color: '#aaa' },
      bottom: 0,
    }],
    series: [{
      type: 'graph',
      layout: 'force',
      data: nodes,
      links,
      categories,
      roam: true,
      label: { show: true, position: 'right', color: '#ddd', fontSize: 11 },
      lineStyle: { color: 'source', curveness: 0.1, opacity: 0.6 },
      emphasis: { focus: 'adjacency', lineStyle: { width: 4 } },
      force: { repulsion: 180, edgeLength: [60, 140], gravity: 0.05 },
    }],
  }
})

async function loadAll() {
  loading.value = true
  try {
    await Promise.all([loadEntities(), loadRelations(), loadStats()])
  } finally {
    loading.value = false
  }
}

async function loadEntities() {
  try {
    const { output } = await ws.execute('kg list --limit 500 --json', 15000)
    entities.value = parseEntities(output)
  } catch (e) {
    message.error('加载实体失败: ' + e.message)
    entities.value = []
  }
}

async function loadRelations() {
  try {
    const { output } = await ws.execute('kg relations --limit 1000 --json', 15000)
    relations.value = parseRelations(output)
  } catch (e) {
    message.error('加载关系失败: ' + e.message)
    relations.value = []
  }
}

async function loadStats() {
  try {
    const { output } = await ws.execute('kg stats --json', 10000)
    stats.value = parseStats(output)
  } catch (e) {
    message.error('加载统计失败: ' + e.message)
  }
}

async function loadEntityTypes() {
  if (entityTypes.value.length > 0) return
  loadingTypes.value = true
  try {
    const { output } = await ws.execute('kg entity-types --json', 10000)
    entityTypes.value = parseEntityTypes(output)
  } catch (e) {
    message.error('加载实体类型失败: ' + e.message)
  } finally {
    loadingTypes.value = false
  }
}

async function addEntity() {
  if (!newEntity.name.trim() || !newEntity.type) {
    message.warning('请输入名称并选择类型')
    return
  }
  addingEntity.value = true
  try {
    const name = newEntity.name.trim().replace(/"/g, '\\"')
    let cmd = `kg add "${name}" ${newEntity.type} --json`
    if (newEntity.tags.trim()) {
      cmd += ` --tags "${newEntity.tags.trim().replace(/"/g, '\\"')}"`
    }
    const { output, exitCode } = await ws.execute(cmd, 15000)
    if (exitCode !== 0 || /error|失败/i.test(output)) {
      message.error('添加失败: ' + output.slice(0, 120))
    } else {
      message.success('实体已添加')
      showAddEntityModal.value = false
      newEntity.name = ''
      newEntity.type = ''
      newEntity.tags = ''
      await loadAll()
    }
  } catch (e) {
    message.error('添加失败: ' + e.message)
  } finally {
    addingEntity.value = false
  }
}

async function addRelation() {
  if (!newRelation.sourceId || !newRelation.targetId || !newRelation.relationType.trim()) {
    message.warning('请填写源、目标和关系类型')
    return
  }
  if (newRelation.sourceId === newRelation.targetId) {
    message.warning('源和目标不能是同一实体')
    return
  }
  addingRelation.value = true
  try {
    const rt = newRelation.relationType.trim().replace(/"/g, '\\"')
    const cmd = `kg add-relation ${newRelation.sourceId} ${newRelation.targetId} "${rt}" --weight ${newRelation.weight} --json`
    const { output, exitCode } = await ws.execute(cmd, 15000)
    if (exitCode !== 0 || /error|失败/i.test(output)) {
      message.error('添加失败: ' + output.slice(0, 120))
    } else {
      message.success('关系已添加')
      showAddRelationModal.value = false
      newRelation.sourceId = ''
      newRelation.targetId = ''
      newRelation.relationType = ''
      newRelation.weight = 1.0
      await loadAll()
    }
  } catch (e) {
    message.error('添加失败: ' + e.message)
  } finally {
    addingRelation.value = false
  }
}

async function removeEntity(record) {
  removing.value = record.id
  try {
    const { output, exitCode } = await ws.execute(`kg remove ${record.id}`, 15000)
    if (exitCode !== 0 || /error|失败/i.test(output)) {
      message.error('删除失败: ' + output.slice(0, 120))
    } else {
      message.success('实体已删除')
      await loadAll()
    }
  } catch (e) {
    message.error('删除失败: ' + e.message)
  } finally {
    removing.value = ''
  }
}

function openReason(record) {
  reasonStartId.value = record.id
  reasonStartName.value = record.name
  reasonResults.value = []
  showReasonModal.value = true
}

async function runReason() {
  reasoning.value = true
  try {
    const cmd = `kg reason ${reasonStartId.value} --max-depth ${reasonOptions.maxDepth} --direction ${reasonOptions.direction} --json`
    const { output } = await ws.execute(cmd, 15000)
    reasonResults.value = parseReason(output)
    if (reasonResults.value.length === 0) {
      message.info('从该实体无可达节点')
    }
  } catch (e) {
    message.error('推理失败: ' + e.message)
  } finally {
    reasoning.value = false
  }
}

onMounted(() => {
  loadAll()
  loadEntityTypes()
})
</script>

<style scoped>
:deep(.kg-row:hover td) { background: var(--bg-card-hover) !important; }
:deep(.ant-tabs-tab) { color: var(--text-secondary) !important; }
:deep(.ant-tabs-tab-active .ant-tabs-tab-btn) { color: #1677ff !important; }
:deep(.ant-card-head) { border-color: var(--border-color) !important; color: var(--text-primary) !important; }
</style>
