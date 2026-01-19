<template>
  <div class="error-monitor-page">
    <div class="page-header">
      <h1>
        <BugOutlined />
        错误监控仪表板
      </h1>
      <p class="page-description">
        AI 智能诊断、自动修复和错误分析
      </p>
    </div>

    <div class="page-content">
      <!-- 统计概览 -->
      <a-row
        :gutter="16"
        class="stats-row"
      >
        <a-col :span="6">
          <a-card>
            <a-skeleton
              :loading="loading"
              active
              :paragraph="{ rows: 1 }"
            >
              <a-statistic
                title="总错误数"
                :value="stats.total"
                :prefix="h(ExclamationCircleOutlined)"
              />
            </a-skeleton>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card>
            <a-skeleton
              :loading="loading"
              active
              :paragraph="{ rows: 1 }"
            >
              <a-statistic
                title="严重/高优先级"
                :value="
                  stats.bySeverity?.critical + stats.bySeverity?.high || 0
                "
                :prefix="h(WarningOutlined)"
                :value-style="{ color: '#cf1322' }"
              />
            </a-skeleton>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card>
            <a-skeleton
              :loading="loading"
              active
              :paragraph="{ rows: 1 }"
            >
              <a-statistic
                title="自动修复率"
                :value="stats.autoFixRate"
                suffix="%"
                :prefix="h(ToolOutlined)"
                :value-style="{
                  color:
                    parseFloat(stats.autoFixRate) > 50 ? '#3f8600' : '#faad14',
                }"
              />
            </a-skeleton>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card>
            <a-skeleton
              :loading="loading"
              active
              :paragraph="{ rows: 1 }"
            >
              <a-statistic
                title="解决率"
                :value="stats.resolutionRate"
                suffix="%"
                :prefix="h(CheckCircleOutlined)"
                :value-style="{
                  color:
                    parseFloat(stats.resolutionRate) > 50
                      ? '#3f8600'
                      : '#cf1322',
                }"
              />
            </a-skeleton>
          </a-card>
        </a-col>
      </a-row>

      <!-- 严重程度分布 -->
      <a-row
        :gutter="16"
        class="severity-row"
      >
        <a-col :span="6">
          <a-card size="small">
            <a-statistic
              title="Critical"
              :value="stats.bySeverity?.critical || 0"
              :value-style="{ color: '#cf1322', fontSize: '18px' }"
            >
              <template #prefix>
                <CloseCircleOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small">
            <a-statistic
              title="High"
              :value="stats.bySeverity?.high || 0"
              :value-style="{ color: '#fa541c', fontSize: '18px' }"
            >
              <template #prefix>
                <WarningOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small">
            <a-statistic
              title="Medium"
              :value="stats.bySeverity?.medium || 0"
              :value-style="{ color: '#faad14', fontSize: '18px' }"
            >
              <template #prefix>
                <InfoCircleOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small">
            <a-statistic
              title="Low"
              :value="stats.bySeverity?.low || 0"
              :value-style="{ color: '#52c41a', fontSize: '18px' }"
            >
              <template #prefix>
                <CheckCircleOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
      </a-row>

      <!-- 图表和分类统计 -->
      <a-row
        :gutter="16"
        class="charts-row"
      >
        <!-- 每日趋势图 -->
        <a-col :span="16">
          <a-card
            title="错误趋势"
            class="chart-card"
          >
            <template #extra>
              <a-radio-group
                v-model:value="trendDays"
                size="small"
                @change="loadDailyTrend"
              >
                <a-radio-button :value="7">
                  7天
                </a-radio-button>
                <a-radio-button :value="14">
                  14天
                </a-radio-button>
                <a-radio-button :value="30">
                  30天
                </a-radio-button>
              </a-radio-group>
            </template>
            <div
              ref="trendChartRef"
              class="chart-container"
            />
          </a-card>
        </a-col>

        <!-- 分类统计 -->
        <a-col :span="8">
          <a-card
            title="错误分类"
            class="chart-card"
          >
            <a-list
              size="small"
              :data-source="classificationStats"
              :loading="loading"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #title>
                      <span>{{
                        classificationLabels[item.classification] ||
                          item.classification
                      }}</span>
                      <a-badge
                        v-if="item.critical_count > 0"
                        :count="item.critical_count"
                        :number-style="{ backgroundColor: '#cf1322' }"
                        style="margin-left: 8px"
                      />
                    </template>
                    <template #description>
                      自动修复: {{ item.auto_fixed_count || 0 }} /
                      {{ item.count }}
                    </template>
                  </a-list-item-meta>
                  <template #actions>
                    <a-tag :color="getClassificationColor(item.classification)">
                      {{ item.count }}
                    </a-tag>
                  </template>
                </a-list-item>
              </template>
            </a-list>
          </a-card>
        </a-col>
      </a-row>

      <!-- 错误历史列表 -->
      <a-card
        title="错误历史"
        class="history-card"
      >
        <template #extra>
          <a-space>
            <a-input-search
              v-model:value="searchKeyword"
              placeholder="搜索错误"
              style="width: 200px"
              @search="loadHistory"
            />
            <a-select
              v-model:value="filterSeverity"
              placeholder="严重程度"
              style="width: 120px"
              allow-clear
              @change="loadHistory"
            >
              <a-select-option value="critical">
                Critical
              </a-select-option>
              <a-select-option value="high">
                High
              </a-select-option>
              <a-select-option value="medium">
                Medium
              </a-select-option>
              <a-select-option value="low">
                Low
              </a-select-option>
            </a-select>
            <a-select
              v-model:value="filterClassification"
              placeholder="错误分类"
              style="width: 140px"
              allow-clear
              @change="loadHistory"
            >
              <a-select-option value="DATABASE">
                数据库
              </a-select-option>
              <a-select-option value="NETWORK">
                网络
              </a-select-option>
              <a-select-option value="FILESYSTEM">
                文件系统
              </a-select-option>
              <a-select-option value="TIMEOUT">
                超时
              </a-select-option>
              <a-select-option value="MEMORY">
                内存
              </a-select-option>
              <a-select-option value="PERMISSION">
                权限
              </a-select-option>
            </a-select>
            <a-button @click="refreshAll">
              <ReloadOutlined />
              刷新
            </a-button>
          </a-space>
        </template>

        <a-table
          :columns="columns"
          :data-source="historyList"
          :loading="historyLoading"
          :pagination="pagination"
          row-key="id"
          @change="handleTableChange"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'severity'">
              <a-tag :color="getSeverityColor(record.severity)">
                {{ record.severity }}
              </a-tag>
            </template>
            <template v-if="column.key === 'classification'">
              <a-tag :color="getClassificationColor(record.classification)">
                {{
                  classificationLabels[record.classification] ||
                    record.classification
                }}
              </a-tag>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="getStatusColor(record.status)">
                {{ statusLabels[record.status] || record.status }}
              </a-tag>
            </template>
            <template v-if="column.key === 'auto_fix'">
              <a-tooltip
                :title="record.auto_fix_success ? '自动修复成功' : '未修复'"
              >
                <CheckCircleOutlined
                  v-if="record.auto_fix_success"
                  style="color: #52c41a; font-size: 16px"
                />
                <CloseCircleOutlined
                  v-else-if="record.auto_fix_attempted"
                  style="color: #cf1322; font-size: 16px"
                />
                <MinusCircleOutlined
                  v-else
                  style="color: #d9d9d9; font-size: 16px"
                />
              </a-tooltip>
            </template>
            <template v-if="column.key === 'created_at'">
              {{ formatTime(record.created_at) }}
            </template>
            <template v-if="column.key === 'action'">
              <a-space>
                <a-tooltip title="查看详情">
                  <a-button
                    type="link"
                    size="small"
                    @click="showDetail(record)"
                  >
                    <EyeOutlined />
                  </a-button>
                </a-tooltip>
                <a-tooltip title="生成报告">
                  <a-button
                    type="link"
                    size="small"
                    @click="generateReport(record)"
                  >
                    <FileTextOutlined />
                  </a-button>
                </a-tooltip>
                <a-tooltip title="标记已解决">
                  <a-button
                    v-if="record.status !== 'fixed'"
                    type="link"
                    size="small"
                    @click="markAsFixed(record)"
                  >
                    <CheckOutlined />
                  </a-button>
                </a-tooltip>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-card>

      <!-- AI 诊断配置 -->
      <a-card
        title="AI 诊断配置"
        class="config-card"
      >
        <a-form layout="inline">
          <a-form-item label="启用 AI 诊断">
            <a-switch
              v-model:checked="config.enable_ai_diagnosis"
              @change="updateConfig('enable_ai_diagnosis', $event)"
            />
          </a-form-item>
          <a-form-item label="启用自动修复">
            <a-switch
              v-model:checked="config.enable_auto_fix"
              @change="updateConfig('enable_auto_fix', $event)"
            />
          </a-form-item>
          <a-form-item label="保留天数">
            <a-input-number
              v-model:value="config.retention_days"
              :min="7"
              :max="365"
              @change="updateConfig('retention_days', $event)"
            />
          </a-form-item>
          <a-form-item>
            <a-button
              type="primary"
              danger
              @click="cleanupOldData"
            >
              <DeleteOutlined />
              清理旧数据
            </a-button>
          </a-form-item>
        </a-form>
      </a-card>
    </div>

    <!-- 详情抽屉 -->
    <a-drawer
      v-model:open="detailVisible"
      title="错误详情"
      width="700"
      placement="right"
    >
      <template v-if="currentError">
        <a-descriptions
          bordered
          :column="2"
        >
          <a-descriptions-item
            label="错误类型"
            :span="1"
          >
            {{ currentError.error_type }}
          </a-descriptions-item>
          <a-descriptions-item
            label="分类"
            :span="1"
          >
            <a-tag :color="getClassificationColor(currentError.classification)">
              {{
                classificationLabels[currentError.classification] ||
                  currentError.classification
              }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item
            label="严重程度"
            :span="1"
          >
            <a-tag :color="getSeverityColor(currentError.severity)">
              {{ currentError.severity }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item
            label="状态"
            :span="1"
          >
            <a-tag :color="getStatusColor(currentError.status)">
              {{ statusLabels[currentError.status] || currentError.status }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item
            label="错误消息"
            :span="2"
          >
            <a-typography-paragraph
              :content="currentError.error_message"
              :ellipsis="{ rows: 3, expandable: true }"
            />
          </a-descriptions-item>
          <a-descriptions-item
            label="发生时间"
            :span="2"
          >
            {{ formatTime(currentError.created_at) }}
          </a-descriptions-item>
        </a-descriptions>

        <a-divider>堆栈跟踪</a-divider>
        <a-typography-paragraph v-if="currentError.error_stack">
          <pre class="stack-trace">{{ currentError.error_stack }}</pre>
        </a-typography-paragraph>
        <a-empty
          v-else
          description="无堆栈信息"
        />

        <a-divider>自动修复</a-divider>
        <a-result
          v-if="currentError.auto_fix_success"
          status="success"
          title="自动修复成功"
          :sub-title="currentError.auto_fix_result?.message || '已自动修复'"
        />
        <a-result
          v-else-if="currentError.auto_fix_attempted"
          status="error"
          title="自动修复失败"
          :sub-title="currentError.auto_fix_result?.message || '修复失败'"
        />
        <a-result
          v-else
          status="info"
          title="未尝试自动修复"
        />

        <a-divider>AI 诊断</a-divider>
        <div v-if="currentError.ai_diagnosis">
          <a-alert
            v-if="currentError.ai_root_cause"
            type="warning"
            show-icon
            style="margin-bottom: 16px"
          >
            <template #message>
              根本原因
            </template>
            <template #description>
              {{ currentError.ai_root_cause }}
            </template>
          </a-alert>

          <a-card
            v-if="currentError.ai_fix_suggestions?.length"
            title="修复建议"
            size="small"
          >
            <a-list
              :data-source="currentError.ai_fix_suggestions"
              size="small"
            >
              <template #renderItem="{ item, index }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #avatar>
                      <a-avatar :style="{ backgroundColor: '#1890ff' }">
                        {{ index + 1 }}
                      </a-avatar>
                    </template>
                    <template #description>
                      {{ item }}
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>
          </a-card>
        </div>
        <a-empty
          v-else
          description="无 AI 诊断结果"
        />

        <a-divider />
        <a-space>
          <a-button
            type="primary"
            @click="reanalyzeError(currentError)"
          >
            <ReloadOutlined />
            重新分析
          </a-button>
          <a-button @click="generateReport(currentError)">
            <FileTextOutlined />
            生成报告
          </a-button>
          <a-button
            v-if="currentError.status !== 'fixed'"
            type="primary"
            ghost
            @click="markAsFixed(currentError)"
          >
            <CheckOutlined />
            标记已解决
          </a-button>
        </a-space>
      </template>
    </a-drawer>

    <!-- 报告模态框 -->
    <a-modal
      v-model:open="reportVisible"
      title="诊断报告"
      width="800"
      :footer="null"
    >
      <div
        class="report-content"
        v-html="reportHtml"
      />
      <a-divider />
      <a-space>
        <a-button
          type="primary"
          @click="copyReport"
        >
          <CopyOutlined />
          复制
        </a-button>
        <a-button @click="downloadReport">
          <DownloadOutlined />
          下载
        </a-button>
      </a-space>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, reactive, onMounted, onUnmounted, h } from "vue";
import { message } from "ant-design-vue";
import {
  BugOutlined,
  ExclamationCircleOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  MinusCircleOutlined,
  ToolOutlined,
  ReloadOutlined,
  EyeOutlined,
  FileTextOutlined,
  CheckOutlined,
  DeleteOutlined,
  CopyOutlined,
  DownloadOutlined,
} from "@ant-design/icons-vue";
import { init } from "../utils/echartsConfig";
import { marked } from "marked";

// 状态
const loading = ref(false);
const historyLoading = ref(false);
const stats = ref({
  total: 0,
  bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
  autoFixRate: "0.00",
  resolutionRate: "0.00",
});
const classificationStats = ref([]);
const historyList = ref([]);
const trendDays = ref(7);
const trendChartRef = ref(null);
let trendChart = null;

// 筛选
const searchKeyword = ref("");
const filterSeverity = ref(null);
const filterClassification = ref(null);

// 分页
const pagination = reactive({
  current: 1,
  pageSize: 10,
  total: 0,
});

// 配置
const config = ref({
  enable_ai_diagnosis: true,
  enable_auto_fix: true,
  retention_days: 30,
});

// 详情
const detailVisible = ref(false);
const currentError = ref(null);

// 报告
const reportVisible = ref(false);
const reportContent = ref("");
const reportHtml = ref("");

// 标签映射
const classificationLabels = {
  // 数据库错误
  DATABASE: "数据库",
  DATABASE_LOCKED: "数据库锁定",
  DATABASE_CORRUPT: "数据库损坏",
  DATABASE_READONLY: "数据库只读",
  // 网络错误
  NETWORK: "网络",
  NETWORK_ERROR: "网络错误",
  CONNECTION_REFUSED: "连接被拒绝",
  CONNECTION_RESET: "连接重置",
  TIMEOUT: "超时",
  DNS_ERROR: "DNS解析失败",
  SSL_ERROR: "SSL/TLS错误",
  // 文件系统错误
  FILESYSTEM: "文件系统",
  FILE_NOT_FOUND: "文件未找到",
  PERMISSION_DENIED: "权限拒绝",
  DISK_FULL: "磁盘已满",
  FILE_LOCKED: "文件锁定",
  PATH_TOO_LONG: "路径过长",
  // 内存错误
  MEMORY: "内存",
  MEMORY_LEAK: "内存泄漏",
  STACK_OVERFLOW: "栈溢出",
  // API/HTTP 错误
  RATE_LIMIT: "速率限制",
  AUTH_ERROR: "认证错误",
  SERVER_ERROR: "服务器错误",
  // Electron 错误
  GPU_ERROR: "GPU错误",
  IPC_ERROR: "IPC通信错误",
  WINDOW_ERROR: "窗口错误",
  // LLM/AI 错误
  LLM_CONTEXT_LENGTH: "上下文长度超限",
  LLM_MODEL_ERROR: "模型错误",
  LLM_API_ERROR: "LLM API错误",
  // 验证错误
  VALIDATION: "验证错误",
  // JavaScript 错误
  TYPE_ERROR: "类型错误",
  REFERENCE_ERROR: "引用错误",
  SYNTAX_ERROR: "语法错误",
  RANGE_ERROR: "范围错误",
  PERMISSION: "权限",
  UNKNOWN: "未知",
};

const statusLabels = {
  new: "新建",
  analyzing: "分析中",
  analyzed: "已分析",
  fixing: "修复中",
  fixed: "已修复",
  ignored: "已忽略",
};

// 表格列定义
const columns = [
  {
    title: "错误消息",
    dataIndex: "error_message",
    key: "error_message",
    ellipsis: true,
    width: 300,
  },
  {
    title: "分类",
    dataIndex: "classification",
    key: "classification",
    width: 100,
  },
  {
    title: "严重程度",
    dataIndex: "severity",
    key: "severity",
    width: 100,
  },
  {
    title: "状态",
    dataIndex: "status",
    key: "status",
    width: 90,
  },
  {
    title: "自动修复",
    key: "auto_fix",
    width: 80,
    align: "center",
  },
  {
    title: "时间",
    dataIndex: "created_at",
    key: "created_at",
    width: 160,
  },
  {
    title: "操作",
    key: "action",
    width: 120,
    fixed: "right",
  },
];

// 颜色映射函数
const getSeverityColor = (severity) => {
  const colors = {
    critical: "red",
    high: "orange",
    medium: "gold",
    low: "green",
  };
  return colors[severity] || "default";
};

const getClassificationColor = (classification) => {
  const colors = {
    // 数据库错误 - 蓝色系
    DATABASE: "blue",
    DATABASE_LOCKED: "blue",
    DATABASE_CORRUPT: "red",
    DATABASE_READONLY: "geekblue",
    // 网络错误 - 紫色系
    NETWORK: "purple",
    NETWORK_ERROR: "purple",
    CONNECTION_REFUSED: "purple",
    CONNECTION_RESET: "purple",
    TIMEOUT: "gold",
    DNS_ERROR: "volcano",
    SSL_ERROR: "orange",
    // 文件系统错误 - 青色系
    FILESYSTEM: "cyan",
    FILE_NOT_FOUND: "cyan",
    PERMISSION_DENIED: "orange",
    DISK_FULL: "red",
    FILE_LOCKED: "gold",
    PATH_TOO_LONG: "lime",
    // 内存错误 - 红色系
    MEMORY: "red",
    MEMORY_LEAK: "red",
    STACK_OVERFLOW: "magenta",
    // API/HTTP 错误
    RATE_LIMIT: "gold",
    AUTH_ERROR: "orange",
    SERVER_ERROR: "volcano",
    // Electron 错误 - 灰色系
    GPU_ERROR: "default",
    IPC_ERROR: "default",
    WINDOW_ERROR: "default",
    // LLM/AI 错误 - 绿色系
    LLM_CONTEXT_LENGTH: "green",
    LLM_MODEL_ERROR: "lime",
    LLM_API_ERROR: "green",
    // 验证错误
    VALIDATION: "orange",
    // JavaScript 错误 - 品红系
    TYPE_ERROR: "magenta",
    REFERENCE_ERROR: "volcano",
    SYNTAX_ERROR: "geekblue",
    RANGE_ERROR: "pink",
    PERMISSION: "orange",
  };
  return colors[classification] || "default";
};

const getStatusColor = (status) => {
  const colors = {
    new: "default",
    analyzing: "processing",
    analyzed: "blue",
    fixing: "orange",
    fixed: "success",
    ignored: "default",
  };
  return colors[status] || "default";
};

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) {return "N/A";}
  return new Date(timestamp).toLocaleString();
};

// 加载统计数据
const loadStats = async () => {
  loading.value = true;
  try {
    const result = await window.electronAPI.invoke("error:get-stats", {
      days: trendDays.value,
    });
    stats.value = result;
  } catch (error) {
    logger.error("加载统计数据失败:", error);
  } finally {
    loading.value = false;
  }
};

// 加载分类统计
const loadClassificationStats = async () => {
  try {
    const result = await window.electronAPI.invoke(
      "error:get-classification-stats",
      trendDays.value,
    );
    classificationStats.value = result || [];
  } catch (error) {
    logger.error("加载分类统计失败:", error);
  }
};

// 加载历史记录
const loadHistory = async () => {
  historyLoading.value = true;
  try {
    const result = await window.electronAPI.invoke(
      "error:get-analysis-history",
      {
        limit: pagination.pageSize,
        offset: (pagination.current - 1) * pagination.pageSize,
        severity: filterSeverity.value,
        classification: filterClassification.value,
        search: searchKeyword.value,
      },
    );
    historyList.value = result || [];
    // 假设总数从统计中获取
    pagination.total = stats.value.total;
  } catch (error) {
    logger.error("加载历史记录失败:", error);
  } finally {
    historyLoading.value = false;
  }
};

// 加载每日趋势
const loadDailyTrend = async () => {
  try {
    const result = await window.electronAPI.invoke(
      "error:get-daily-trend",
      trendDays.value,
    );
    renderTrendChart(result || []);
  } catch (error) {
    logger.error("加载每日趋势失败:", error);
  }
};

// 渲染趋势图
const renderTrendChart = (data) => {
  if (!trendChartRef.value) {return;}

  if (!trendChart) {
    trendChart = init(trendChartRef.value);
  }

  const dates = data.map((d) => d.date).reverse();
  const totals = data.map((d) => d.total).reverse();
  const criticals = data.map((d) => d.critical).reverse();
  const highs = data.map((d) => d.high).reverse();
  const autoFixed = data.map((d) => d.auto_fixed).reverse();

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
    },
    legend: {
      data: ["总错误", "严重", "高优先级", "自动修复"],
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: dates,
    },
    yAxis: {
      type: "value",
    },
    series: [
      {
        name: "总错误",
        type: "line",
        data: totals,
        smooth: true,
        itemStyle: { color: "#1890ff" },
      },
      {
        name: "严重",
        type: "line",
        data: criticals,
        smooth: true,
        itemStyle: { color: "#cf1322" },
      },
      {
        name: "高优先级",
        type: "line",
        data: highs,
        smooth: true,
        itemStyle: { color: "#fa541c" },
      },
      {
        name: "自动修复",
        type: "line",
        data: autoFixed,
        smooth: true,
        itemStyle: { color: "#52c41a" },
      },
    ],
  };

  trendChart.setOption(option);
};

// 加载配置
const loadConfig = async () => {
  try {
    const result = await window.electronAPI.invoke("error:get-config");
    config.value = { ...config.value, ...result };
  } catch (error) {
    logger.error("加载配置失败:", error);
  }
};

// 更新配置
const updateConfig = async (key, value) => {
  try {
    await window.electronAPI.invoke("error:update-config", { [key]: value });
    message.success("配置已更新");
  } catch (error) {
    logger.error("更新配置失败:", error);
    message.error("更新配置失败");
  }
};

// 清理旧数据
const cleanupOldData = async () => {
  try {
    const result = await window.electronAPI.invoke(
      "error:cleanup-old-analyses",
      config.value.retention_days,
    );
    message.success(`已清理 ${result.deletedCount} 条旧记录`);
    refreshAll();
  } catch (error) {
    logger.error("清理失败:", error);
    message.error("清理失败");
  }
};

// 显示详情
const showDetail = (record) => {
  currentError.value = record;
  detailVisible.value = true;
};

// 生成报告
const generateReport = async (record) => {
  try {
    const report = await window.electronAPI.invoke(
      "error:get-diagnosis-report",
      record.id,
    );
    reportContent.value = report;
    reportHtml.value = marked(report);
    reportVisible.value = true;
  } catch (error) {
    logger.error("生成报告失败:", error);
    message.error("生成报告失败");
  }
};

// 标记已修复
const markAsFixed = async (record) => {
  try {
    await window.electronAPI.invoke(
      "error:update-status",
      record.id,
      "fixed",
      "手动标记已修复",
    );
    message.success("已标记为已修复");
    loadHistory();
    loadStats();
  } catch (error) {
    logger.error("更新状态失败:", error);
    message.error("更新状态失败");
  }
};

// 重新分析
const reanalyzeError = async (record) => {
  try {
    message.loading({ content: "正在重新分析...", key: "reanalyze" });
    await window.electronAPI.invoke("error:reanalyze", record.error_id);
    message.success({ content: "重新分析完成", key: "reanalyze" });
    loadHistory();
  } catch (error) {
    logger.error("重新分析失败:", error);
    message.error({ content: "重新分析失败", key: "reanalyze" });
  }
};

// 复制报告
const copyReport = () => {
  navigator.clipboard.writeText(reportContent.value);
  message.success("已复制到剪贴板");
};

// 下载报告
const downloadReport = () => {
  const blob = new Blob([reportContent.value], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `error-report-${new Date().toISOString().split("T")[0]}.md`;
  a.click();
  URL.revokeObjectURL(url);
};

// 表格分页变化
const handleTableChange = (pag) => {
  pagination.current = pag.current;
  pagination.pageSize = pag.pageSize;
  loadHistory();
};

// 刷新全部
const refreshAll = () => {
  loadStats();
  loadClassificationStats();
  loadHistory();
  loadDailyTrend();
};

// 生命周期
onMounted(() => {
  refreshAll();
  loadConfig();

  // 监听窗口大小变化
  window.addEventListener("resize", () => {
    trendChart?.resize();
  });
});

onUnmounted(() => {
  trendChart?.dispose();
});
</script>

<style lang="less" scoped>
.error-monitor-page {
  padding: 24px;
  background: #f0f2f5;
  min-height: 100vh;

  .page-header {
    margin-bottom: 24px;

    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .page-description {
      color: #666;
      margin: 0;
    }
  }

  .page-content {
    .stats-row,
    .severity-row,
    .charts-row {
      margin-bottom: 16px;
    }

    .chart-card {
      .chart-container {
        height: 300px;
      }
    }

    .history-card {
      margin-bottom: 16px;
    }

    .config-card {
      margin-bottom: 16px;
    }
  }

  .stack-trace {
    background: #f5f5f5;
    padding: 12px;
    border-radius: 4px;
    font-size: 12px;
    overflow-x: auto;
    max-height: 200px;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .report-content {
    max-height: 500px;
    overflow-y: auto;
    padding: 16px;
    background: #fafafa;
    border-radius: 4px;

    :deep(h1) {
      font-size: 20px;
    }

    :deep(h2) {
      font-size: 16px;
      margin-top: 16px;
    }

    :deep(pre) {
      background: #f5f5f5;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
    }

    :deep(table) {
      width: 100%;
      border-collapse: collapse;

      th,
      td {
        border: 1px solid #e8e8e8;
        padding: 8px;
        text-align: left;
      }

      th {
        background: #fafafa;
      }
    }
  }
}
</style>
