<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">SLA 管理</h2>
        <p class="page-sub">服务等级合约 · 指标记录 · 偏差检测 · 补偿计算</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button @click="showRecordModal = true">
          <template #icon><LineChartOutlined /></template>
          记录指标
        </a-button>
        <a-button type="primary" @click="showCreateModal = true">
          <template #icon><PlusOutlined /></template>
          新建合约
        </a-button>
      </a-space>
    </div>

    <!-- noDb banner -->
    <a-alert
      v-if="errorState.noDb"
      type="info"
      show-icon
      message="该模块需要项目级数据库"
      description="`cc sla ...` 命令仅在 chainlesschain 项目目录下可用。请先运行 `cc init` 初始化项目，或在已初始化的目录启动 `cc serve`。"
      style="margin-bottom: 16px;"
    />

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="合约总数" :value="stats.totalContracts" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><FileProtectOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="活跃合约"
            :value="stats.activeContracts"
            :value-style="{ color: stats.activeContracts > 0 ? '#52c41a' : '#888', fontSize: '20px' }"
          >
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="合作组织"
            :value="stats.activeOrgs"
            :value-style="{ color: '#722ed1', fontSize: '20px' }"
            :suffix="stats.maxActiveSlasPerOrg ? `· cap=${stats.maxActiveSlasPerOrg}` : ''"
          >
            <template #prefix><TeamOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="违规总数"
            :value="stats.violations.total"
            :value-style="{ color: stats.violations.total > 0 ? '#ff4d4f' : '#888', fontSize: '20px' }"
          >
            <template #prefix><WarningOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="累计补偿"
            :value="stats.violations.totalCompensation"
            :precision="2"
            :value-style="{ color: '#faad14', fontSize: '20px' }"
          >
            <template #prefix><DollarOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Tier catalogue -->
    <a-card
      title="SLA 等级"
      size="small"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
      :body-style="{ padding: '12px 16px' }"
    >
      <a-row :gutter="[12, 12]">
        <a-col v-for="t in tiers" :key="t.name" :xs="24" :sm="8">
          <div class="tier-pill" :style="{ borderLeftColor: tierBarColor(t.name) }">
            <div class="tier-head">
              <a-tag :color="tierColor(t.name)" style="font-family: monospace; font-size: 13px;">{{ t.name.toUpperCase() }}</a-tag>
              <span class="tier-comp">补偿率 {{ (t.compensationRate * 100).toFixed(1) }}%</span>
            </div>
            <div class="tier-terms">
              <span class="tier-term">可用性 ≥ {{ (t.availability * 100).toFixed(2) }}%</span>
              <span class="tier-term">p95 ≤ {{ t.maxResponseTime }}ms</span>
              <span class="tier-term">RPS ≥ {{ t.minThroughput }}</span>
              <span class="tier-term">错误率 ≤ {{ (t.maxErrorRate * 100).toFixed(2) }}%</span>
            </div>
          </div>
        </a-col>
      </a-row>
    </a-card>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="sla-tabs">
      <!-- ── Contracts tab ────────────────────────────────────── -->
      <a-tab-pane key="contracts" tab="合约">
        <div class="filter-bar">
          <a-radio-group v-model:value="tierFilter" size="small" button-style="solid">
            <a-radio-button value="">全部等级</a-radio-button>
            <a-radio-button v-for="t in SLA_TIER_NAMES" :key="t" :value="t">{{ t.toUpperCase() }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="statusFilter" size="small">
            <a-radio-button value="">全部状态</a-radio-button>
            <a-radio-button v-for="s in SLA_STATUSES" :key="s" :value="s">{{ statusLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="contractColumns"
          :data-source="filteredContracts"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 个合约` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'slaId'">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 12px;">{{ record.slaId.slice(0, 12) }}</span>
            </template>
            <template v-if="column.key === 'orgId'">
              <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">{{ record.orgId }}</span>
            </template>
            <template v-if="column.key === 'tier'">
              <a-tag :color="tierColor(record.tier)" style="font-family: monospace;">{{ record.tier.toUpperCase() }}</a-tag>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'monthlyFee'">
              <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">{{ record.monthlyFee.toFixed(2) }}</span>
            </template>
            <template v-if="column.key === 'endDate'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatSlaTime(record.endDate) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" @click="viewMetrics(record)">指标</a-button>
              <a-button size="small" type="link" @click="checkContract(record)">检查</a-button>
              <a-button size="small" type="link" @click="viewReport(record)">报告</a-button>
              <a-popconfirm
                v-if="record.status === 'active'"
                title="终止该合约？"
                ok-text="终止"
                cancel-text="取消"
                @confirm="terminateContract(record)"
              >
                <a-button size="small" type="link" danger>终止</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <FileProtectOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ tierFilter || statusFilter ? '没有符合条件的合约' : '暂无合约，点"新建合约"创建第一个' }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Violations tab ───────────────────────────────────── -->
      <a-tab-pane key="violations" tab="违规">
        <div class="filter-bar">
          <a-radio-group v-model:value="severityFilter" size="small" button-style="solid">
            <a-radio-button value="">全部严重度</a-radio-button>
            <a-radio-button v-for="s in VIOLATION_SEVERITIES" :key="s" :value="s">{{ severityLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="violationColumns"
          :data-source="filteredViolations"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'violationId'">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 12px;">{{ record.violationId.slice(0, 12) }}</span>
            </template>
            <template v-if="column.key === 'term'">
              <a-tag color="default" style="font-family: monospace;">{{ termLabel(record.term) }}</a-tag>
            </template>
            <template v-if="column.key === 'severity'">
              <a-tag :color="severityColor(record.severity)">{{ severityLabel(record.severity) }}</a-tag>
            </template>
            <template v-if="column.key === 'deviation'">
              <a-progress
                :percent="Math.min(100, Math.round(record.deviationPercent))"
                :stroke-color="severityBarColor(record.severity)"
                size="small"
                :format="() => `${record.deviationPercent.toFixed(1)}%`"
              />
            </template>
            <template v-if="column.key === 'expected'">
              <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">{{ formatTermValue(record.term, record.expectedValue) }}</span>
            </template>
            <template v-if="column.key === 'actual'">
              <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">{{ formatTermValue(record.term, record.actualValue) }}</span>
            </template>
            <template v-if="column.key === 'compensation'">
              <span v-if="record.compensationAmount !== null" style="color: #faad14; font-weight: 500;">{{ record.compensationAmount.toFixed(2) }}</span>
              <span v-else style="color: var(--text-muted);">未计算</span>
            </template>
            <template v-if="column.key === 'occurredAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatSlaTime(record.occurredAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button v-if="record.compensationAmount === null" size="small" type="link" @click="computeCompensation(record)">计算补偿</a-button>
              <a-button v-else size="small" type="link" @click="viewCompensation(record)">查看</a-button>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <CheckCircleOutlined style="font-size: 36px; margin-bottom: 10px; display: block; color: #52c41a;" />
              {{ severityFilter ? '没有符合条件的违规' : '暂无违规记录' }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Breakdown tab ────────────────────────────────────── -->
      <a-tab-pane key="breakdown" tab="分布统计">
        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :lg="12">
            <a-card title="合约 — 按状态" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 12px;">
              <div v-for="s in SLA_STATUSES" :key="s" class="bd-row">
                <a-tag :color="statusColor(s)" style="min-width: 80px; text-align: center;">{{ statusLabel(s) }}</a-tag>
                <a-progress
                  :percent="pctOfTotal(stats.byStatus[s] || 0, stats.totalContracts)"
                  :stroke-color="statusBarColor(s)"
                  :format="() => `${stats.byStatus[s] || 0}`"
                  size="small"
                  style="flex: 1; margin-left: 12px;"
                />
              </div>
            </a-card>
            <a-card title="合约 — 按等级" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <div v-for="t in SLA_TIER_NAMES" :key="t" class="bd-row">
                <a-tag :color="tierColor(t)" style="min-width: 80px; text-align: center; font-family: monospace;">{{ t.toUpperCase() }}</a-tag>
                <a-progress
                  :percent="pctOfTotal(stats.byTier[t] || 0, stats.totalContracts)"
                  :stroke-color="tierBarColor(t)"
                  :format="() => `${stats.byTier[t] || 0}`"
                  size="small"
                  style="flex: 1; margin-left: 12px;"
                />
              </div>
            </a-card>
          </a-col>
          <a-col :xs="24" :lg="12">
            <a-card title="违规 — 按严重度" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 12px;">
              <div v-for="s in VIOLATION_SEVERITIES" :key="s" class="bd-row">
                <a-tag :color="severityColor(s)" style="min-width: 80px; text-align: center;">{{ severityLabel(s) }}</a-tag>
                <a-progress
                  :percent="pctOfTotal(stats.violations.bySeverity[s] || 0, stats.violations.total)"
                  :stroke-color="severityBarColor(s)"
                  :format="() => `${stats.violations.bySeverity[s] || 0}`"
                  size="small"
                  style="flex: 1; margin-left: 12px;"
                />
              </div>
            </a-card>
            <a-card title="违规 — 按指标" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <div v-for="t in SLA_TERMS_LIST" :key="t" class="bd-row">
                <a-tag color="default" style="min-width: 110px; text-align: center; font-family: monospace; font-size: 11px;">{{ termLabel(t) }}</a-tag>
                <a-progress
                  :percent="pctOfTotal(stats.violations.byTerm[t] || 0, stats.violations.total)"
                  stroke-color="#fa8c16"
                  :format="() => `${stats.violations.byTerm[t] || 0}`"
                  size="small"
                  style="flex: 1; margin-left: 12px;"
                />
              </div>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Create contract modal ──────────────────────────────── -->
    <a-modal
      v-model:open="showCreateModal"
      title="新建 SLA 合约"
      :confirm-loading="creating"
      :width="540"
      ok-text="创建"
      cancel-text="取消"
      @ok="submitCreate"
      @cancel="resetCreateForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item label="组织 ID" required>
          <a-input v-model:value="createForm.orgId" placeholder="例如 org-acme" />
        </a-form-item>
        <a-form-item label="等级" required>
          <a-select v-model:value="createForm.tier">
            <a-select-option v-for="t in SLA_TIER_NAMES" :key="t" :value="t">{{ t.toUpperCase() }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="月费">
          <a-input-number v-model:value="createForm.monthlyFee" :min="0" :step="100" style="width: 160px;" />
        </a-form-item>
        <a-form-item label="期限 (天)">
          <a-input-number v-model:value="createForm.durationDays" :min="1" :step="30" style="width: 160px;" />
          <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">默认 30 天</span>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Record metric modal ────────────────────────────────── -->
    <a-modal
      v-model:open="showRecordModal"
      title="记录指标"
      :confirm-loading="recording"
      :width="540"
      ok-text="记录"
      cancel-text="取消"
      @ok="submitRecord"
      @cancel="resetRecordForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item label="SLA" required>
          <a-select
            v-model:value="recordForm.slaId"
            placeholder="选择合约"
            :options="contracts.map(c => ({ value: c.slaId, label: `${c.slaId.slice(0, 8)} · ${c.orgId} [${c.tier}]` }))"
            show-search
          />
        </a-form-item>
        <a-form-item label="指标" required>
          <a-select v-model:value="recordForm.term">
            <a-select-option v-for="t in SLA_TERMS_LIST" :key="t" :value="t">{{ termLabel(t) }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="数值" required>
          <a-input-number v-model:value="recordForm.value" :step="0.01" style="width: 200px;" />
          <div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">{{ termHint(recordForm.term) }}</div>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Metrics modal ──────────────────────────────────────── -->
    <a-modal
      v-model:open="showMetricsModal"
      :title="`指标聚合：${currentContract?.slaId?.slice(0, 12) || ''}`"
      :width="640"
      :footer="null"
    >
      <div v-if="currentContract" style="padding-top: 8px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="组织">{{ currentContract.orgId }}</a-descriptions-item>
          <a-descriptions-item label="等级">
            <a-tag :color="tierColor(currentContract.tier)">{{ currentContract.tier.toUpperCase() }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="样本数">{{ currentMetrics.totalSamples }}</a-descriptions-item>
          <a-descriptions-item label="月费">{{ currentContract.monthlyFee.toFixed(2) }}</a-descriptions-item>
        </a-descriptions>

        <h4 style="color: var(--text-primary); font-size: 13px; margin: 16px 0 10px;">按指标聚合</h4>
        <a-empty v-if="!Object.keys(currentMetrics.byTerm).length" description="尚无指标数据" :image="EMPTY_IMG" />
        <a-table
          v-else
          :columns="aggColumns"
          :data-source="aggDataSource"
          size="small"
          :pagination="false"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'term'">
              <a-tag color="default" style="font-family: monospace;">{{ termLabel(record.term) }}</a-tag>
            </template>
            <template v-if="column.key === 'expected'">
              <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">{{ formatTermValue(record.term, record.expected) }}</span>
            </template>
            <template v-else-if="['mean', 'p95', 'min', 'max'].includes(column.key)">
              <span style="font-family: monospace; font-size: 12px;">{{ formatTermValue(record.term, record[column.key]) }}</span>
            </template>
          </template>
        </a-table>
      </div>
    </a-modal>

    <!-- ── Check result modal ─────────────────────────────────── -->
    <a-modal
      v-model:open="showCheckModal"
      :title="`违规检测：${currentContract?.slaId?.slice(0, 12) || ''}`"
      :width="640"
      :footer="null"
    >
      <div v-if="currentCheck" style="padding-top: 8px;">
        <a-result
          :status="currentCheck.totalViolations === 0 ? 'success' : 'warning'"
          :title="currentCheck.totalViolations === 0 ? '未检测到违规' : `检测到 ${currentCheck.totalViolations} 项违规`"
          :sub-title="`检测时间: ${formatSlaTime(currentCheck.checkedAt)}`"
        />
        <a-list v-if="currentCheck.totalViolations > 0" size="small" :data-source="currentCheck.violations">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-tag :color="severityColor(item.severity)" style="min-width: 50px; text-align: center;">{{ severityLabel(item.severity) }}</a-tag>
              <span style="margin-left: 8px; font-family: monospace; font-size: 12px;">{{ termLabel(item.term) }}</span>
              <span style="margin-left: 8px; color: var(--text-secondary); font-size: 12px;">
                期望 {{ formatTermValue(item.term, item.expectedValue) }} · 实际 {{ formatTermValue(item.term, item.actualValue) }}
              </span>
              <span style="margin-left: auto; color: #ff4d4f; font-weight: 500;">{{ item.deviationPercent.toFixed(2) }}%</span>
            </a-list-item>
          </template>
        </a-list>
      </div>
    </a-modal>

    <!-- ── Report modal ───────────────────────────────────────── -->
    <a-modal
      v-model:open="showReportModal"
      :title="`合规报告：${currentContract?.slaId?.slice(0, 12) || ''}`"
      :width="720"
      :footer="null"
    >
      <div v-if="currentReport" style="padding-top: 8px;">
        <a-row :gutter="12" style="margin-bottom: 16px;">
          <a-col :span="8">
            <a-statistic
              title="合规率"
              :value="currentReport.compliance * 100"
              suffix="%"
              :precision="2"
              :value-style="{ color: complianceColor(currentReport.compliance), fontSize: '20px' }"
            />
          </a-col>
          <a-col :span="8">
            <a-statistic title="违规总数" :value="currentReport.violations.total" :value-style="{ color: '#ff4d4f', fontSize: '20px' }" />
          </a-col>
          <a-col :span="8">
            <a-statistic title="累计补偿" :value="currentReport.violations.totalCompensation" :precision="2" :value-style="{ color: '#faad14', fontSize: '20px' }" />
          </a-col>
        </a-row>

        <h4 style="color: var(--text-primary); font-size: 13px; margin: 16px 0 8px;">违规分布 — 按严重度</h4>
        <div v-for="s in VIOLATION_SEVERITIES" :key="s" class="bd-row">
          <a-tag :color="severityColor(s)" style="min-width: 80px; text-align: center;">{{ severityLabel(s) }}</a-tag>
          <a-progress
            :percent="pctOfTotal(currentReport.violations.bySeverity[s] || 0, currentReport.violations.total)"
            :stroke-color="severityBarColor(s)"
            :format="() => `${currentReport.violations.bySeverity[s] || 0}`"
            size="small"
            style="flex: 1; margin-left: 12px;"
          />
        </div>

        <h4 v-if="Object.keys(currentReport.metricsByTerm).length" style="color: var(--text-primary); font-size: 13px; margin: 16px 0 8px;">指标聚合</h4>
        <a-table
          v-if="Object.keys(currentReport.metricsByTerm).length"
          :columns="aggColumns"
          :data-source="reportAggDataSource"
          size="small"
          :pagination="false"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'term'">
              <a-tag color="default" style="font-family: monospace;">{{ termLabel(record.term) }}</a-tag>
            </template>
            <template v-if="column.key === 'expected'">
              <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">{{ formatTermValue(record.term, record.expected) }}</span>
            </template>
            <template v-else-if="['mean', 'p95', 'min', 'max'].includes(column.key)">
              <span style="font-family: monospace; font-size: 12px;">{{ formatTermValue(record.term, record[column.key]) }}</span>
            </template>
          </template>
        </a-table>
      </div>
    </a-modal>

    <!-- ── Compensation modal ─────────────────────────────────── -->
    <a-modal
      v-model:open="showCompensationModal"
      :title="`补偿计算：${currentViolation?.violationId?.slice(0, 12) || ''}`"
      :width="540"
      :footer="null"
    >
      <div v-if="currentCompensation" style="padding-top: 8px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="违规 ID" :span="2">
            <span style="font-family: monospace; font-size: 12px;">{{ currentCompensation.violationId }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="严重度">
            <a-tag :color="severityColor(currentCompensation.severity)">{{ severityLabel(currentCompensation.severity) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="基础金额">
            <span style="font-family: monospace;">{{ currentCompensation.base.toFixed(4) }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="偏差倍数">
            <span style="font-family: monospace;">×{{ currentCompensation.multiplier.toFixed(2) }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="最终补偿">
            <span style="color: #faad14; font-weight: 600; font-family: monospace; font-size: 14px;">{{ currentCompensation.amount.toFixed(2) }}</span>
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
  LineChartOutlined,
  FileProtectOutlined,
  CheckCircleOutlined,
  TeamOutlined,
  WarningOutlined,
  DollarOutlined,
} from '@ant-design/icons-vue'
import { message, Empty } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parseTiers,
  parseContracts,
  parseMetrics,
  parseViolations,
  parseCheckResult,
  parseCompensation,
  parseReport,
  parseStatsV2,
  parseContract,
  detectSlaError,
  formatSlaTime,
  SLA_TIER_NAMES,
  SLA_STATUSES,
  SLA_TERMS_LIST,
  VIOLATION_SEVERITIES,
} from '../utils/sla-parser.js'

const ws = useWsStore()

const EMPTY_IMG = Empty.PRESENTED_IMAGE_SIMPLE

const loading = ref(false)
const creating = ref(false)
const recording = ref(false)

const tiers = ref([])
const contracts = ref([])
const violations = ref([])
const stats = ref({
  totalContracts: 0,
  activeContracts: 0,
  activeOrgs: 0,
  maxActiveSlasPerOrg: 0,
  byStatus: {},
  byTier: {},
  violations: { total: 0, byTerm: {}, bySeverity: {}, byStatus: {}, totalCompensation: 0 },
})
const errorState = ref({ noDb: false, error: '' })

const activeTab = ref('contracts')
const tierFilter = ref('')
const statusFilter = ref('')
const severityFilter = ref('')

const showCreateModal = ref(false)
const showRecordModal = ref(false)
const showMetricsModal = ref(false)
const showCheckModal = ref(false)
const showReportModal = ref(false)
const showCompensationModal = ref(false)

const createForm = reactive({ orgId: '', tier: 'silver', monthlyFee: 1000, durationDays: 30 })
const recordForm = reactive({ slaId: null, term: 'availability', value: null })

const currentContract = ref(null)
const currentMetrics = ref({ slaId: '', totalSamples: 0, byTerm: {} })
const currentCheck = ref(null)
const currentReport = ref(null)
const currentViolation = ref(null)
const currentCompensation = ref(null)

const contractColumns = [
  { title: 'SLA ID', key: 'slaId', width: '120px' },
  { title: '组织', key: 'orgId', width: '160px' },
  { title: '等级', key: 'tier', width: '90px' },
  { title: '状态', key: 'status', width: '100px' },
  { title: '月费', key: 'monthlyFee', width: '110px' },
  { title: '到期', key: 'endDate', width: '160px' },
  { title: '操作', key: 'action', width: '260px' },
]

const violationColumns = [
  { title: 'ID', key: 'violationId', width: '120px' },
  { title: '指标', key: 'term', width: '140px' },
  { title: '严重度', key: 'severity', width: '100px' },
  { title: '偏差', key: 'deviation', width: '180px' },
  { title: '期望', key: 'expected', width: '110px' },
  { title: '实际', key: 'actual', width: '110px' },
  { title: '补偿', key: 'compensation', width: '110px' },
  { title: '发生时间', key: 'occurredAt', width: '160px' },
  { title: '操作', key: 'action', width: '120px' },
]

const aggColumns = [
  { title: '指标', key: 'term', width: '140px' },
  { title: '期望', key: 'expected', width: '110px' },
  { title: '均值', key: 'mean', width: '110px' },
  { title: 'p95', key: 'p95', width: '110px' },
  { title: '最小', key: 'min', width: '110px' },
  { title: '最大', key: 'max', width: '110px' },
  { title: '样本数', key: 'count', width: '90px' },
]

const filteredContracts = computed(() => {
  let rows = contracts.value
  if (tierFilter.value) rows = rows.filter(c => c.tier === tierFilter.value)
  if (statusFilter.value) rows = rows.filter(c => c.status === statusFilter.value)
  return rows
})

const filteredViolations = computed(() => {
  let rows = violations.value
  if (severityFilter.value) rows = rows.filter(v => v.severity === severityFilter.value)
  return rows
})

const aggDataSource = computed(() => {
  if (!currentContract.value) return []
  return Object.entries(currentMetrics.value.byTerm).map(([term, agg]) => ({
    key: term,
    term,
    expected: expectedFor(currentContract.value.terms, term),
    ...agg,
  }))
})

const reportAggDataSource = computed(() => {
  if (!currentReport.value || !currentContract.value) return []
  return Object.entries(currentReport.value.metricsByTerm).map(([term, agg]) => ({
    key: term,
    term,
    expected: expectedFor(currentContract.value.terms, term),
    ...agg,
  }))
})

function expectedFor(terms, term) {
  if (!terms) return 0
  switch (term) {
    case 'availability': return terms.availability
    case 'response_time': return terms.maxResponseTime
    case 'throughput': return terms.minThroughput
    case 'error_rate': return terms.maxErrorRate
    default: return 0
  }
}

function tierColor(t) {
  return { gold: 'gold', silver: 'default', bronze: 'orange' }[t] || 'default'
}
function tierBarColor(t) {
  return { gold: '#faad14', silver: '#8c8c8c', bronze: '#d4a373' }[t] || '#888'
}

function statusLabel(s) {
  return { active: '活跃', expired: '已过期', terminated: '已终止' }[s] || s
}
function statusColor(s) {
  return { active: 'green', expired: 'default', terminated: 'red' }[s] || 'default'
}
function statusBarColor(s) {
  return { active: '#52c41a', expired: '#888', terminated: '#ff4d4f' }[s] || '#888'
}

function termLabel(t) {
  return {
    availability: '可用性',
    response_time: '响应时间',
    throughput: '吞吐量',
    error_rate: '错误率',
  }[t] || t
}

function termHint(t) {
  return {
    availability: '比例 0~1，例如 0.997',
    response_time: '毫秒，例如 120',
    throughput: '每秒请求数，例如 850',
    error_rate: '比例 0~1，例如 0.003',
  }[t] || ''
}

function formatTermValue(term, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  if (term === 'availability' || term === 'error_rate') {
    return (v * 100).toFixed(3) + '%'
  }
  if (term === 'response_time') return v.toFixed(1) + 'ms'
  if (term === 'throughput') return v.toFixed(0) + ' rps'
  return v.toFixed(4)
}

function severityLabel(s) {
  return { minor: '轻微', moderate: '中等', major: '严重', critical: '关键' }[s] || s
}
function severityColor(s) {
  return { minor: 'default', moderate: 'gold', major: 'orange', critical: 'red' }[s] || 'default'
}
function severityBarColor(s) {
  return { minor: '#888', moderate: '#faad14', major: '#fa8c16', critical: '#ff4d4f' }[s] || '#888'
}

function complianceColor(c) {
  if (c >= 0.99) return '#52c41a'
  if (c >= 0.9) return '#1677ff'
  if (c >= 0.7) return '#faad14'
  return '#ff4d4f'
}

function pctOfTotal(n, total) {
  if (!total) return 0
  return Math.round((n / total) * 100)
}

async function loadAll() {
  loading.value = true
  errorState.value = { noDb: false, error: '' }
  try {
    const [tiersRes, listRes, violRes, statsRes] = await Promise.all([
      ws.execute('sla tiers --json', 8000).catch(() => ({ output: '' })),
      ws.execute('sla list --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('sla violations --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('sla stats-v2', 8000).catch(() => ({ output: '' })),
    ])
    const errs = [listRes, violRes, statsRes]
      .map(r => detectSlaError(r.output))
      .find(e => e.noDb)
    if (errs) {
      errorState.value = errs
    }
    tiers.value = parseTiers(tiersRes.output)
    contracts.value = parseContracts(listRes.output)
    violations.value = parseViolations(violRes.output)
    stats.value = parseStatsV2(statsRes.output)
  } catch (e) {
    message.error('加载 SLA 数据失败: ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function submitCreate() {
  if (!createForm.orgId.trim()) {
    message.warning('请填写组织 ID')
    return
  }
  creating.value = true
  try {
    const durationMs = createForm.durationDays * 24 * 60 * 60 * 1000
    const parts = [
      `sla create "${createForm.orgId.trim().replace(/"/g, '\\"')}"`,
      `-t ${createForm.tier}`,
      `-d ${durationMs}`,
      `-f ${createForm.monthlyFee || 0}`,
      '--json',
    ]
    const { output } = await ws.execute(parts.join(' '), 10000)
    const err = detectSlaError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    const c = parseContract(output)
    if (!c) {
      message.error('创建失败: ' + output.slice(0, 120))
      return
    }
    message.success(`合约已创建：${c.slaId.slice(0, 8)}`)
    showCreateModal.value = false
    resetCreateForm()
    await loadAll()
  } catch (e) {
    message.error('创建失败: ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function submitRecord() {
  if (!recordForm.slaId) {
    message.warning('请选择 SLA 合约')
    return
  }
  if (recordForm.value === null || recordForm.value === undefined) {
    message.warning('请填写指标数值')
    return
  }
  recording.value = true
  try {
    const { output } = await ws.execute(
      `sla record ${recordForm.slaId} ${recordForm.term} ${recordForm.value} --json`,
      8000,
    )
    const err = detectSlaError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    if (!/"metricId"|"term"/.test(output)) {
      message.error('记录失败: ' + output.slice(0, 120))
      return
    }
    message.success('指标已记录')
    showRecordModal.value = false
    resetRecordForm()
  } catch (e) {
    message.error('记录失败: ' + (e?.message || e))
  } finally {
    recording.value = false
  }
}

async function terminateContract(record) {
  try {
    const { output } = await ws.execute(`sla terminate ${record.slaId}`, 8000)
    const err = detectSlaError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    if (/Failed/i.test(output) && !/terminated/i.test(output)) {
      message.error('终止失败: ' + output.slice(0, 120))
      return
    }
    message.success('合约已终止')
    await loadAll()
  } catch (e) {
    message.error('终止失败: ' + (e?.message || e))
  }
}

async function viewMetrics(record) {
  currentContract.value = record
  currentMetrics.value = { slaId: '', totalSamples: 0, byTerm: {} }
  showMetricsModal.value = true
  try {
    const { output } = await ws.execute(`sla metrics ${record.slaId} --json`, 8000)
    currentMetrics.value = parseMetrics(output)
  } catch (e) {
    message.error('加载指标失败: ' + (e?.message || e))
  }
}

async function checkContract(record) {
  currentContract.value = record
  currentCheck.value = null
  showCheckModal.value = true
  try {
    const { output } = await ws.execute(`sla check ${record.slaId} --json`, 10000)
    const err = detectSlaError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    currentCheck.value = parseCheckResult(output)
    if (currentCheck.value.totalViolations > 0) {
      // Refresh violations table
      await loadAll()
    }
  } catch (e) {
    message.error('检查失败: ' + (e?.message || e))
  }
}

async function viewReport(record) {
  currentContract.value = record
  currentReport.value = null
  showReportModal.value = true
  try {
    const { output } = await ws.execute(`sla report ${record.slaId} --json`, 10000)
    currentReport.value = parseReport(output)
  } catch (e) {
    message.error('加载报告失败: ' + (e?.message || e))
  }
}

async function computeCompensation(record) {
  currentViolation.value = record
  currentCompensation.value = null
  try {
    const { output } = await ws.execute(`sla compensate ${record.violationId} --json`, 8000)
    const err = detectSlaError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    currentCompensation.value = parseCompensation(output)
    if (!currentCompensation.value) {
      message.error('计算失败: ' + output.slice(0, 120))
      return
    }
    showCompensationModal.value = true
    await loadAll()
  } catch (e) {
    message.error('计算失败: ' + (e?.message || e))
  }
}

function viewCompensation(record) {
  currentViolation.value = record
  currentCompensation.value = {
    violationId: record.violationId,
    slaId: record.slaId,
    severity: record.severity,
    base: 0,
    multiplier: 0,
    amount: record.compensationAmount || 0,
  }
  showCompensationModal.value = true
}

function resetCreateForm() {
  createForm.orgId = ''
  createForm.tier = 'silver'
  createForm.monthlyFee = 1000
  createForm.durationDays = 30
}

function resetRecordForm() {
  recordForm.slaId = null
  recordForm.term = 'availability'
  recordForm.value = null
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

.sla-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

/* Tier catalogue pills */
.tier-pill {
  padding: 12px 14px;
  border-radius: 6px;
  background: rgba(22,119,255,.04);
  border: 1px solid var(--border-color);
  border-left: 3px solid #1677ff;
  height: 100%;
}
.tier-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.tier-comp {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
}
.tier-terms {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tier-term {
  color: var(--text-secondary);
  font-size: 11px;
  font-family: monospace;
}

/* Breakdown rows */
.bd-row {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
</style>
