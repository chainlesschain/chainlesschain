<template>
  <div class="enterprise-audit-page">
    <a-page-header
      title="企业审计日志"
      sub-title="查看和分析企业操作审计记录"
      @back="() => $router.back()"
    >
      <template #extra>
        <a-button type="primary" :loading="exporting" @click="handleExport">
          <template #icon>
            <ExportOutlined />
          </template>
          导出日志
        </a-button>
      </template>
    </a-page-header>

    <div class="audit-content">
      <!-- Filter Bar -->
      <a-card :bordered="false" class="filter-card">
        <a-row :gutter="16" align="middle">
          <a-col :span="5">
            <a-select
              v-model:value="filters.eventType"
              placeholder="事件类型"
              style="width: 100%"
              allow-clear
              @change="handleFilterChange"
            >
              <a-select-option value="">全部</a-select-option>
              <a-select-option value="login">登录</a-select-option>
              <a-select-option value="permission_change">权限变更</a-select-option>
              <a-select-option value="data_access">数据访问</a-select-option>
              <a-select-option value="data_modify">数据修改</a-select-option>
              <a-select-option value="data_delete">数据删除</a-select-option>
              <a-select-option value="config_change">配置变更</a-select-option>
              <a-select-option value="export">数据导出</a-select-option>
              <a-select-option value="system">系统事件</a-select-option>
            </a-select>
          </a-col>
          <a-col :span="4">
            <a-select
              v-model:value="filters.riskLevel"
              placeholder="风险等级"
              style="width: 100%"
              allow-clear
              @change="handleFilterChange"
            >
              <a-select-option value="">全部</a-select-option>
              <a-select-option value="low">低风险</a-select-option>
              <a-select-option value="medium">中风险</a-select-option>
              <a-select-option value="high">高风险</a-select-option>
              <a-select-option value="critical">严重</a-select-option>
            </a-select>
          </a-col>
          <a-col :span="6">
            <a-range-picker
              v-model:value="filters.dateRange"
              style="width: 100%"
              :placeholder="['开始日期', '结束日期']"
              @change="handleFilterChange"
            />
          </a-col>
          <a-col :span="5">
            <a-input
              v-model:value="filters.actor"
              placeholder="搜索操作者 DID"
              allow-clear
            />
          </a-col>
          <a-col :span="4">
            <a-button type="primary" @click="handleSearch">
              <template #icon>
                <SearchOutlined />
              </template>
              搜索
            </a-button>
          </a-col>
        </a-row>
      </a-card>

      <!-- Statistics Cards -->
      <a-row :gutter="16" class="stats-row">
        <a-col :span="6">
          <a-card :loading="statsLoading">
            <a-statistic
              title="总日志数"
              :value="statistics.totalLogs"
              :value-style="{ color: '#1890ff' }"
            >
              <template #prefix>
                <FileTextOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card :loading="statsLoading">
            <a-statistic
              title="严重事件"
              :value="statistics.criticalCount"
              :value-style="{ color: '#cf1322' }"
            >
              <template #prefix>
                <WarningOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card :loading="statsLoading">
            <a-statistic
              title="高风险操作"
              :value="statistics.highRiskCount"
              :value-style="{ color: '#fa8c16' }"
            >
              <template #prefix>
                <ExclamationCircleOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card :loading="statsLoading">
            <a-statistic
              title="已拦截操作"
              :value="statistics.blockedCount"
              :value-style="{ color: '#722ed1' }"
            >
              <template #prefix>
                <StopOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
      </a-row>

      <!-- Audit Log Table -->
      <a-card :bordered="false" class="table-card">
        <a-table
          :columns="columns"
          :data-source="auditStore.logs"
          :loading="auditStore.loading"
          :pagination="false"
          row-key="id"
          :scroll="{ x: 1200 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'timestamp'">
              {{ formatTime(record.timestamp) }}
            </template>

            <template v-else-if="column.key === 'event_type'">
              <a-tag :color="getEventTypeColor(record.event_type)">
                {{ getEventTypeLabel(record.event_type) }}
              </a-tag>
            </template>

            <template v-else-if="column.key === 'actor_did'">
              <a-tooltip :title="record.actor_did">
                {{ truncateDid(record.actor_did) }}
              </a-tooltip>
            </template>

            <template v-else-if="column.key === 'risk_level'">
              <a-tag :color="getRiskLevelColor(record.risk_level)">
                {{ getRiskLevelLabel(record.risk_level) }}
              </a-tag>
            </template>

            <template v-else-if="column.key === 'outcome'">
              <a-tag :color="getOutcomeColor(record.outcome)">
                {{ getOutcomeLabel(record.outcome) }}
              </a-tag>
            </template>

            <template v-else-if="column.key === 'actions'">
              <a-button type="link" size="small" @click="showDetail(record)">
                详情
              </a-button>
            </template>
          </template>
        </a-table>

        <div class="pagination-wrapper">
          <a-pagination
            v-model:current="currentPage"
            v-model:pageSize="pageSize"
            :total="auditStore.totalLogs"
            show-size-changer
            show-quick-jumper
            :show-total="(total: number) => `共 ${total} 条`"
            @change="handlePageChange"
            @showSizeChange="handlePageSizeChange"
          />
        </div>
      </a-card>
    </div>

    <!-- Log Detail Modal -->
    <a-modal
      v-model:open="detailVisible"
      title="审计日志详情"
      width="700px"
      :footer="null"
    >
      <a-descriptions v-if="selectedLog" :column="2" bordered size="small">
        <a-descriptions-item label="日志ID" :span="2">
          {{ selectedLog.id }}
        </a-descriptions-item>
        <a-descriptions-item label="时间戳" :span="2">
          {{ formatTime(selectedLog.timestamp) }}
        </a-descriptions-item>
        <a-descriptions-item label="事件类型">
          <a-tag :color="getEventTypeColor(selectedLog.event_type)">
            {{ getEventTypeLabel(selectedLog.event_type) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="风险等级">
          <a-tag :color="getRiskLevelColor(selectedLog.risk_level)">
            {{ getRiskLevelLabel(selectedLog.risk_level) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="操作者 DID" :span="2">
          {{ selectedLog.actor_did }}
        </a-descriptions-item>
        <a-descriptions-item label="操作" :span="2">
          {{ selectedLog.operation }}
        </a-descriptions-item>
        <a-descriptions-item label="结果">
          <a-tag :color="getOutcomeColor(selectedLog.outcome)">
            {{ getOutcomeLabel(selectedLog.outcome) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="IP 地址">
          {{ selectedLog.ip_address || '-' }}
        </a-descriptions-item>
        <a-descriptions-item label="详细信息" :span="2">
          <pre class="detail-json">{{ formatDetails(selectedLog.details) }}</pre>
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import {
  ExportOutlined,
  SearchOutlined,
  FileTextOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
  StopOutlined,
} from '@ant-design/icons-vue'
import { useAuditStore } from '../stores/audit'
import dayjs from 'dayjs'

const auditStore = useAuditStore()

// Filters
const filters = reactive({
  eventType: '' as string,
  riskLevel: '' as string,
  dateRange: null as any,
  actor: '' as string,
})

// Pagination
const currentPage = ref(1)
const pageSize = ref(20)

// State
const statsLoading = ref(false)
const exporting = ref(false)
const detailVisible = ref(false)
const selectedLog = ref<any>(null)

// Statistics
const statistics = reactive({
  totalLogs: 0,
  criticalCount: 0,
  highRiskCount: 0,
  blockedCount: 0,
})

// Table columns
const columns = [
  {
    title: '时间',
    key: 'timestamp',
    dataIndex: 'timestamp',
    width: 180,
    sorter: (a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  },
  {
    title: '事件类型',
    key: 'event_type',
    dataIndex: 'event_type',
    width: 130,
  },
  {
    title: '操作者',
    key: 'actor_did',
    dataIndex: 'actor_did',
    width: 180,
    ellipsis: true,
  },
  {
    title: '操作',
    key: 'operation',
    dataIndex: 'operation',
    ellipsis: true,
  },
  {
    title: '风险等级',
    key: 'risk_level',
    dataIndex: 'risk_level',
    width: 100,
  },
  {
    title: '结果',
    key: 'outcome',
    dataIndex: 'outcome',
    width: 100,
  },
  {
    title: '操作',
    key: 'actions',
    width: 80,
    fixed: 'right' as const,
  },
]

// Fetch audit logs
async function fetchLogs() {
  const params: Record<string, any> = {
    page: currentPage.value,
    pageSize: pageSize.value,
  }

  if (filters.eventType) {
    params.eventType = filters.eventType
  }
  if (filters.riskLevel) {
    params.riskLevel = filters.riskLevel
  }
  if (filters.dateRange && filters.dateRange.length === 2) {
    params.startTime = filters.dateRange[0].valueOf()
    params.endTime = filters.dateRange[1].valueOf()
  }
  if (filters.actor) {
    params.actor = filters.actor
  }

  await auditStore.fetchLogs(params)
}

// Fetch statistics
async function fetchStatistics() {
  statsLoading.value = true
  try {
    const result = await auditStore.fetchStatistics()
    if (result) {
      statistics.totalLogs = result.totalLogs || 0
      statistics.criticalCount = result.criticalCount || 0
      statistics.highRiskCount = result.highRiskCount || 0
      statistics.blockedCount = result.blockedCount || 0
    }
  } catch (error) {
    console.error('[EnterpriseAuditPage] 获取统计信息失败:', error)
  } finally {
    statsLoading.value = false
  }
}

// Filter change handler
function handleFilterChange() {
  currentPage.value = 1
  fetchLogs()
}

// Search handler
function handleSearch() {
  currentPage.value = 1
  fetchLogs()
}

// Pagination handlers
function handlePageChange(page: number, size: number) {
  currentPage.value = page
  pageSize.value = size
  fetchLogs()
}

function handlePageSizeChange(_current: number, size: number) {
  currentPage.value = 1
  pageSize.value = size
  fetchLogs()
}

// Export logs
async function handleExport() {
  exporting.value = true
  try {
    await auditStore.exportLogs({
      eventType: filters.eventType || undefined,
      riskLevel: filters.riskLevel || undefined,
      actorDid: filters.actor || undefined,
      dateRange: filters.dateRange,
    })
    message.success('审计日志导出成功')
  } catch (error) {
    console.error('[EnterpriseAuditPage] 导出失败:', error)
    message.error('导出失败')
  } finally {
    exporting.value = false
  }
}

// Show detail modal
function showDetail(record: any) {
  selectedLog.value = record
  detailVisible.value = true
}

// Format helpers
function formatTime(timestamp: string | number) {
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss')
}

function truncateDid(did: string) {
  if (!did) return '-'
  if (did.length <= 20) return did
  return did.substring(0, 10) + '...' + did.substring(did.length - 8)
}

function formatDetails(details: any) {
  if (!details) return '-'
  if (typeof details === 'string') {
    try {
      return JSON.stringify(JSON.parse(details), null, 2)
    } catch {
      return details
    }
  }
  return JSON.stringify(details, null, 2)
}

// Event type helpers
function getEventTypeColor(type: string) {
  const colors: Record<string, string> = {
    login: 'blue',
    permission_change: 'purple',
    data_access: 'cyan',
    data_modify: 'orange',
    data_delete: 'red',
    config_change: 'gold',
    export: 'geekblue',
    system: 'default',
  }
  return colors[type] || 'default'
}

function getEventTypeLabel(type: string) {
  const labels: Record<string, string> = {
    login: '登录',
    permission_change: '权限变更',
    data_access: '数据访问',
    data_modify: '数据修改',
    data_delete: '数据删除',
    config_change: '配置变更',
    export: '数据导出',
    system: '系统事件',
  }
  return labels[type] || type
}

// Risk level helpers
function getRiskLevelColor(level: string) {
  const colors: Record<string, string> = {
    low: 'green',
    medium: 'orange',
    high: 'red',
    critical: '#cf1322',
  }
  return colors[level] || 'default'
}

function getRiskLevelLabel(level: string) {
  const labels: Record<string, string> = {
    low: '低',
    medium: '中',
    high: '高',
    critical: '严重',
  }
  return labels[level] || level
}

// Outcome helpers
function getOutcomeColor(outcome: string) {
  const colors: Record<string, string> = {
    success: 'green',
    failure: 'red',
    blocked: 'volcano',
    pending: 'gold',
  }
  return colors[outcome] || 'default'
}

function getOutcomeLabel(outcome: string) {
  const labels: Record<string, string> = {
    success: '成功',
    failure: '失败',
    blocked: '已拦截',
    pending: '待处理',
  }
  return labels[outcome] || outcome
}

// Lifecycle
onMounted(() => {
  fetchLogs()
  fetchStatistics()
})
</script>

<style scoped lang="less">
.enterprise-audit-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f0f2f5;
}

.audit-content {
  flex: 1;
  padding: 0 24px 24px;
  overflow: auto;
}

.filter-card {
  margin-bottom: 16px;
}

.stats-row {
  margin-bottom: 16px;
}

.table-card {
  .pagination-wrapper {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  }
}

.detail-json {
  margin: 0;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 4px;
  max-height: 300px;
  overflow: auto;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
