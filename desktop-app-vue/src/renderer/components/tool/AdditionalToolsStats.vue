<template>
  <div class="additional-tools-stats">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="title">
        <h3>Additional Tools V3 统计仪表板</h3>
        <span class="subtitle">专业领域工具使用情况分析</span>
      </div>
      <a-space>
        <a-dropdown>
          <template #overlay>
            <a-menu @click="handleExport">
              <a-menu-item-group title="数据导出">
                <a-menu-item key="csv">
                  <FileTextOutlined /> 导出为 CSV
                </a-menu-item>
                <a-menu-item key="excel">
                  <FileExcelOutlined /> 导出为 Excel
                </a-menu-item>
                <a-menu-item key="pdf">
                  <FilePdfOutlined /> 导出为 PDF
                </a-menu-item>
              </a-menu-item-group>
              <a-menu-divider />
              <a-menu-item-group title="图表导出">
                <a-menu-item key="charts-all">
                  <PictureOutlined /> 导出所有图表
                </a-menu-item>
                <a-menu-item key="chart-usage">
                  <BarChartOutlined /> 使用排行图表
                </a-menu-item>
                <a-menu-item key="chart-success">
                  <BarChartOutlined /> 成功率图表
                </a-menu-item>
                <a-menu-item key="chart-performance">
                  <PieChartOutlined /> 性能分布图表
                </a-menu-item>
                <a-menu-item key="chart-trend">
                  <LineChartOutlined /> 趋势图表
                </a-menu-item>
              </a-menu-item-group>
            </a-menu>
          </template>
          <a-button>
            <template #icon><DownloadOutlined /></template>
            导出数据
            <DownOutlined />
          </a-button>
        </a-dropdown>
        <a-switch
          v-model:checked="autoRefresh"
          checked-children="自动刷新"
          un-checked-children="手动刷新"
          @change="handleAutoRefreshChange"
        />
        <a-button @click="handleRefresh" :loading="loading" type="primary">
          <template #icon><ReloadOutlined /></template>
          刷新数据
        </a-button>
      </a-space>
    </div>

    <!-- 筛选控件区 -->
    <a-card size="small" class="filter-card">
      <a-row :gutter="[16, 16]">
        <a-col :xs="24" :sm="12" :md="8">
          <div class="filter-item">
            <label>时间范围</label>
            <a-space direction="vertical" style="width: 100%" :size="4">
              <a-range-picker
                v-model:value="dateRange"
                style="width: 100%"
                :placeholder="['开始日期', '结束日期']"
                format="YYYY-MM-DD"
                @change="handleFilterChange"
              />
              <a-space :size="4">
                <a-button size="small" @click="setQuickDateRange('today')">今天</a-button>
                <a-button size="small" @click="setQuickDateRange('week')">本周</a-button>
                <a-button size="small" @click="setQuickDateRange('month')">本月</a-button>
                <a-button size="small" @click="setQuickDateRange('last7days')">最近7天</a-button>
                <a-button size="small" @click="setQuickDateRange('last30days')">最近30天</a-button>
              </a-space>
            </a-space>
          </div>
        </a-col>
        <a-col :xs="24" :sm="12" :md="8">
          <div class="filter-item">
            <label>分类筛选</label>
            <a-select
              v-model:value="selectedCategories"
              mode="multiple"
              style="width: 100%"
              placeholder="请选择分类"
              :options="categoryOptions"
              @change="handleFilterChange"
            />
          </div>
        </a-col>
        <a-col :xs="24" :sm="12" :md="8">
          <div class="filter-item">
            <label>搜索工具</label>
            <a-input-search
              v-model:value="searchKeyword"
              placeholder="工具名称、描述..."
              style="width: 100%"
              @search="handleFilterChange"
              @change="handleSearchChange"
            />
          </div>
        </a-col>
      </a-row>
      <a-row style="margin-top: 12px">
        <a-col :span="24">
          <a-space>
            <a-button @click="handleResetFilters" size="small">
              <template #icon><ClearOutlined /></template>
              重置筛选
            </a-button>
            <a-dropdown>
              <template #overlay>
                <a-menu @click="handleSavedFilters">
                  <a-menu-item key="save">
                    <SaveOutlined /> 保存当前筛选
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item-group v-if="savedFiltersList.length > 0" title="已保存的筛选">
                    <a-menu-item v-for="(filter, index) in savedFiltersList" :key="`load-${index}`">
                      <CheckOutlined v-if="filter.name" />
                      {{ filter.name || `筛选 ${index + 1}` }}
                      <a-button
                        size="small"
                        type="text"
                        danger
                        @click.stop="deleteSavedFilter(index)"
                        style="margin-left: 8px"
                      >
                        <DeleteOutlined />
                      </a-button>
                    </a-menu-item>
                  </a-menu-item-group>
                  <a-menu-item v-else disabled>
                    暂无保存的筛选条件
                  </a-menu-item>
                </a-menu>
              </template>
              <a-button size="small">
                <template #icon><SaveOutlined /></template>
                筛选管理
                <DownOutlined />
              </a-button>
            </a-dropdown>
            <a-tag v-if="hasActiveFilters" color="blue">
              已应用 {{ activeFilterCount }} 个筛选条件
            </a-tag>
          </a-space>
        </a-col>
      </a-row>
    </a-card>

    <!-- 加载状态 -->
    <div v-if="loading && !overview.totalTools" class="loading-container">
      <a-spin size="large" tip="加载统计数据中..."></a-spin>
    </div>

    <!-- 统计数据 -->
    <div v-else class="stats-container">
      <a-space direction="vertical" :size="24" style="width: 100%">
        <!-- 概览卡片 -->
        <a-row :gutter="16">
          <a-col :xs="24" :sm="12" :md="8" :lg="4" :xl="4">
            <a-card size="small" class="stat-card">
              <a-statistic
                title="总工具数"
                :value="overview.totalTools"
                :value-style="{ color: '#3f8600', fontSize: '28px' }"
              >
                <template #prefix><ToolOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :md="8" :lg="4" :xl="4">
            <a-card size="small" class="stat-card">
              <a-statistic
                title="已启用"
                :value="overview.enabledTools"
                :value-style="{ color: '#1890ff', fontSize: '28px' }"
              >
                <template #prefix><CheckCircleOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :md="8" :lg="5" :xl="5">
            <a-card size="small" class="stat-card">
              <a-statistic
                title="总调用次数"
                :value="overview.totalInvocations"
                :value-style="{ color: '#cf1322', fontSize: '28px' }"
              >
                <template #prefix><ThunderboltOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :md="8" :lg="5" :xl="5">
            <a-card size="small" class="stat-card">
              <a-statistic
                title="成功率"
                :value="overview.successRate"
                :value-style="{ color: getSuccessRateColor(overview.successRate), fontSize: '28px' }"
              >
                <template #prefix><CheckSquareOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :md="8" :lg="6" :xl="6">
            <a-card size="small" class="stat-card">
              <a-statistic
                title="平均响应时间"
                :value="overview.avgExecutionTime"
                suffix="ms"
                :precision="2"
                :value-style="{ color: '#722ed1', fontSize: '28px' }"
              >
                <template #prefix><ClockCircleOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
        </a-row>

        <!-- 图表区域 -->
        <a-row :gutter="16">
          <!-- 使用排行 Top 10 -->
          <a-col :xs="24" :lg="12">
            <a-card title="使用次数排行 Top 10" size="small" class="chart-card">
              <div ref="usageChartRef" style="width: 100%; height: 350px"></div>
            </a-card>
          </a-col>

          <!-- 成功率排行 Top 10 -->
          <a-col :xs="24" :lg="12">
            <a-card title="成功率排行 Top 10" size="small" class="chart-card">
              <div ref="successRateChartRef" style="width: 100%; height: 350px"></div>
            </a-card>
          </a-col>
        </a-row>

        <!-- 分类统计 & 性能分布 -->
        <a-row :gutter="16">
          <!-- 分类统计 -->
          <a-col :xs="24" :lg="14">
            <a-card title="分类统计" size="small" class="chart-card">
              <a-table
                :columns="categoryColumns"
                :data-source="categoryStats"
                :pagination="false"
                size="small"
                :scroll="{ y: 300 }"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'category'">
                    <a-tag :color="getCategoryColor(record.category)">
                      {{ getCategoryName(record.category) }}
                    </a-tag>
                  </template>
                  <template v-if="column.key === 'successRate'">
                    <span :style="{ color: getSuccessRateColor(record.successRate + '%') }">
                      {{ record.successRate }}%
                    </span>
                  </template>
                </template>
              </a-table>
            </a-card>
          </a-col>

          <!-- 性能分布 -->
          <a-col :xs="24" :lg="10">
            <a-card title="性能分布" size="small" class="chart-card">
              <div ref="performanceChartRef" style="width: 100%; height: 300px"></div>
            </a-card>
          </a-col>
        </a-row>

        <!-- 7天使用趋势 -->
        <a-row :gutter="16">
          <a-col :span="24">
            <a-card title="7天使用趋势" size="small" class="chart-card">
              <div ref="trendChartRef" style="width: 100%; height: 300px"></div>
            </a-card>
          </a-col>
        </a-row>

        <!-- 最近使用 -->
        <a-row :gutter="16">
          <a-col :span="24">
            <a-card title="最近使用" size="small" class="chart-card">
              <a-list
                :data-source="recentTools"
                :pagination="{ pageSize: 10, showSizeChanger: false }"
                size="small"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta>
                      <template #title>
                        <strong>{{ item.display_name || item.name }}</strong>
                      </template>
                      <template #description>
                        <a-space>
                          <a-tag>{{ getCategoryName(item.category) }}</a-tag>
                          <span style="color: #8c8c8c">{{ item.timeSinceLastUse }}</span>
                          <span style="color: #8c8c8c">
                            调用 {{ item.usage_count }} 次 |
                            成功率 {{ getToolSuccessRate(item) }}%
                          </span>
                        </a-space>
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
                <template #emptyText>
                  <a-empty description="暂无使用记录" />
                </template>
              </a-list>
            </a-card>
          </a-col>
        </a-row>
      </a-space>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import * as echarts from 'echarts';
import { message, Modal } from 'ant-design-vue';
import dayjs from 'dayjs';
import {
  ToolOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
  ClearOutlined,
  DownloadOutlined,
  DownOutlined,
  FileTextOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  PictureOutlined,
  BarChartOutlined,
  PieChartOutlined,
  LineChartOutlined,
  SaveOutlined,
  CheckOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue';

// 加载状态
const loading = ref(true);

// 自动刷新
const autoRefresh = ref(false);
let refreshTimer = null;

// 筛选状态
const dateRange = ref(null);
const selectedCategories = ref([]);
const searchKeyword = ref('');
let searchDebounceTimer = null;

// 分类选项（从后端动态获取）
const categoryOptions = ref([
  { label: '区块链', value: 'blockchain' },
  { label: '财务', value: 'finance' },
  { label: 'CRM', value: 'crm' },
  { label: '项目管理', value: 'project' },
  { label: '代码生成', value: 'code' },
  { label: '模拟仿真', value: 'simulation' },
  { label: '分析', value: 'analysis' },
  { label: '管理', value: 'management' },
  { label: '通用', value: 'general' },
  { label: '医疗', value: 'medical' },
  { label: '教育', value: 'education' },
  { label: '供应链', value: 'supply_chain' },
  { label: '人力资源', value: 'hr' },
]);

// 计算是否有活动筛选
const hasActiveFilters = computed(() => {
  return (dateRange.value && dateRange.value.length === 2) ||
         selectedCategories.value.length > 0 ||
         (searchKeyword.value && searchKeyword.value.trim().length > 0);
});

// 计算活动筛选数量
const activeFilterCount = computed(() => {
  let count = 0;
  if (dateRange.value && dateRange.value.length === 2) count++;
  if (selectedCategories.value.length > 0) count++;
  if (searchKeyword.value && searchKeyword.value.trim().length > 0) count++;
  return count;
});

// 保存的筛选条件列表
const savedFiltersList = ref([]);
const SAVED_FILTERS_KEY = 'additional-tools-stats-saved-filters';

// 从localStorage加载保存的筛选条件
const loadSavedFilters = () => {
  try {
    const saved = localStorage.getItem(SAVED_FILTERS_KEY);
    if (saved) {
      savedFiltersList.value = JSON.parse(saved);
    }
  } catch (error) {
    console.error('[SavedFilters] 加载失败:', error);
  }
};

// 保存筛选条件到localStorage
const saveSavedFilters = () => {
  try {
    localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(savedFiltersList.value));
  } catch (error) {
    console.error('[SavedFilters] 保存失败:', error);
  }
};

// 统计数据
const overview = ref({
  totalTools: 0,
  enabledTools: 0,
  totalInvocations: 0,
  totalSuccesses: 0,
  successRate: '0%',
  avgExecutionTime: 0,
});

const rankings = ref({
  mostUsed: [],
  highestSuccessRate: [],
  fastest: [],
});

const categoryStats = ref([]);
const recentTools = ref([]);
const dailyStats = ref([]);
const performanceMetrics = ref({
  tools: [],
  distribution: { excellent: 0, good: 0, fair: 0, slow: 0 },
});

// 图表引用
const usageChartRef = ref(null);
const successRateChartRef = ref(null);
const performanceChartRef = ref(null);
const trendChartRef = ref(null);

let usageChart = null;
let successRateChart = null;
let performanceChart = null;
let trendChart = null;

// 分类统计表格列
const categoryColumns = [
  {
    title: '分类',
    dataIndex: 'category',
    key: 'category',
    width: 120,
  },
  {
    title: '工具数',
    dataIndex: 'toolCount',
    key: 'toolCount',
    width: 80,
  },
  {
    title: '使用次数',
    dataIndex: 'totalUsage',
    key: 'totalUsage',
    width: 100,
  },
  {
    title: '成功率',
    dataIndex: 'successRate',
    key: 'successRate',
    width: 90,
  },
  {
    title: '平均响应时间',
    dataIndex: 'avgTime',
    key: 'avgTime',
    width: 120,
    customRender: ({ text }) => `${text.toFixed(2)}ms`,
  },
];

// 构建筛选参数
const buildFilters = () => {
  const filters = {};

  // 时间范围
  if (dateRange.value && dateRange.value.length === 2) {
    filters.dateRange = [
      dateRange.value[0].format('YYYY-MM-DD'),
      dateRange.value[1].format('YYYY-MM-DD')
    ];
  }

  // 分类筛选
  if (selectedCategories.value && selectedCategories.value.length > 0) {
    filters.categories = selectedCategories.value;
  }

  // 搜索关键词
  if (searchKeyword.value && searchKeyword.value.trim()) {
    filters.searchKeyword = searchKeyword.value.trim();
  }

  return filters;
};

// 加载统计数据（支持筛选）
const loadDashboardData = async () => {
  loading.value = true;
  try {
    const filters = buildFilters();
    const result = await window.electronAPI.tool.getAdditionalV3Dashboard(filters);

    if (result.success) {
      const data = result.data;

      // 设置概览数据
      overview.value = data.overview;

      // 设置排行榜数据
      rankings.value = data.rankings;

      // 设置分类统计
      categoryStats.value = data.categoryStats;

      // 设置最近使用
      recentTools.value = data.recentTools;

      // 设置每日统计
      dailyStats.value = data.dailyStats;

      // 设置性能指标
      performanceMetrics.value = data.performanceMetrics;

      // 初始化图表
      await initCharts();

      // 提示筛选已应用
      if (hasActiveFilters.value) {
        message.success(`已应用 ${activeFilterCount.value} 个筛选条件`);
      }
    } else {
      message.error('加载统计数据失败: ' + result.error);
    }
  } catch (error) {
    console.error('[AdditionalToolsStats] 加载数据失败:', error);
    message.error('加载统计数据失败');
  } finally {
    loading.value = false;
  }
};

// 筛选变更处理
const handleFilterChange = () => {
  loadDashboardData();
};

// 搜索框输入防抖处理
const handleSearchChange = () => {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  searchDebounceTimer = setTimeout(() => {
    loadDashboardData();
  }, 500); // 500ms防抖
};

// 重置筛选
const handleResetFilters = () => {
  dateRange.value = null;
  selectedCategories.value = [];
  searchKeyword.value = '';
  loadDashboardData();
  message.info('筛选条件已重置');
};

// ===================================
// 数据导出功能
// ===================================

/**
 * 导出为CSV格式
 */
const exportToCSV = () => {
  try {
    let csv = '';

    // 添加概览数据
    csv += '=== Additional Tools V3 统计报告 ===\n';
    csv += `生成时间:,${new Date().toLocaleString()}\n`;
    csv += `筛选条件:,${hasActiveFilters.value ? activeFilterCount.value + '个' : '无'}\n\n`;

    // 概览数据
    csv += '--- 概览统计 ---\n';
    csv += '指标,数值\n';
    csv += `总工具数,${overview.value.totalTools}\n`;
    csv += `已启用,${overview.value.enabledTools}\n`;
    csv += `总调用次数,${overview.value.totalInvocations}\n`;
    csv += `成功率,${overview.value.successRate}\n`;
    csv += `平均响应时间,${overview.value.avgExecutionTime}ms\n\n`;

    // 使用排行
    csv += '--- 使用次数排行 Top 10 ---\n';
    csv += '排名,工具名称,调用次数,成功次数,平均响应时间\n';
    rankings.value.mostUsed.slice(0, 10).forEach((tool, index) => {
      csv += `${index + 1},${tool.display_name || tool.name},${tool.usage_count},${tool.success_count},${tool.avg_execution_time}ms\n`;
    });
    csv += '\n';

    // 成功率排行
    csv += '--- 成功率排行 Top 10 ---\n';
    csv += '排名,工具名称,调用次数,成功率\n';
    rankings.value.highestSuccessRate.slice(0, 10).forEach((tool, index) => {
      csv += `${index + 1},${tool.display_name || tool.name},${tool.usage_count},${tool.success_rate}%\n`;
    });
    csv += '\n';

    // 分类统计
    csv += '--- 分类统计 ---\n';
    csv += '分类,工具数,使用次数,成功率,平均响应时间\n';
    categoryStats.value.forEach((cat) => {
      csv += `${cat.category},${cat.toolCount},${cat.totalUsage},${cat.successRate}%,${cat.avgTime}ms\n`;
    });
    csv += '\n';

    // 每日统计
    csv += '--- 最近7天统计 ---\n';
    csv += '日期,调用次数,成功次数,失败次数,成功率\n';
    dailyStats.value.forEach((stat) => {
      csv += `${stat.date},${stat.invokes},${stat.success},${stat.failure},${stat.successRate}%\n`;
    });

    // 创建下载
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `additional-tools-stats-${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    message.success('CSV导出成功');
  } catch (error) {
    console.error('[Export] CSV导出失败:', error);
    message.error('CSV导出失败: ' + error.message);
  }
};

/**
 * 导出为Excel格式（使用CSV兼容格式）
 */
const exportToExcel = () => {
  try {
    // 创建简单的HTML表格格式，Excel可以打开
    let html = '<html><head><meta charset="utf-8"></head><body>';
    html += '<h1>Additional Tools V3 统计报告</h1>';
    html += `<p>生成时间: ${new Date().toLocaleString()}</p>`;
    html += `<p>筛选条件: ${hasActiveFilters.value ? activeFilterCount.value + '个' : '无'}</p><br/>`;

    // 概览数据
    html += '<h2>概览统计</h2>';
    html += '<table border="1" cellpadding="5" cellspacing="0">';
    html += '<tr><th>指标</th><th>数值</th></tr>';
    html += `<tr><td>总工具数</td><td>${overview.value.totalTools}</td></tr>`;
    html += `<tr><td>已启用</td><td>${overview.value.enabledTools}</td></tr>`;
    html += `<tr><td>总调用次数</td><td>${overview.value.totalInvocations}</td></tr>`;
    html += `<tr><td>成功率</td><td>${overview.value.successRate}</td></tr>`;
    html += `<tr><td>平均响应时间</td><td>${overview.value.avgExecutionTime}ms</td></tr>`;
    html += '</table><br/>';

    // 使用排行
    html += '<h2>使用次数排行 Top 10</h2>';
    html += '<table border="1" cellpadding="5" cellspacing="0">';
    html += '<tr><th>排名</th><th>工具名称</th><th>调用次数</th><th>成功次数</th><th>平均响应时间</th></tr>';
    rankings.value.mostUsed.slice(0, 10).forEach((tool, index) => {
      html += `<tr><td>${index + 1}</td><td>${tool.display_name || tool.name}</td><td>${tool.usage_count}</td><td>${tool.success_count}</td><td>${tool.avg_execution_time}ms</td></tr>`;
    });
    html += '</table><br/>';

    // 分类统计
    html += '<h2>分类统计</h2>';
    html += '<table border="1" cellpadding="5" cellspacing="0">';
    html += '<tr><th>分类</th><th>工具数</th><th>使用次数</th><th>成功率</th><th>平均响应时间</th></tr>';
    categoryStats.value.forEach((cat) => {
      html += `<tr><td>${cat.category}</td><td>${cat.toolCount}</td><td>${cat.totalUsage}</td><td>${cat.successRate}%</td><td>${cat.avgTime}ms</td></tr>`;
    });
    html += '</table><br/>';

    html += '</body></html>';

    // 创建下载
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `additional-tools-stats-${Date.now()}.xls`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    message.success('Excel导出成功');
  } catch (error) {
    console.error('[Export] Excel导出失败:', error);
    message.error('Excel导出失败: ' + error.message);
  }
};

/**
 * 导出为PDF格式（生成纯文本报告）
 */
const exportToPDF = () => {
  try {
    // 创建简单的文本报告
    let text = '='.repeat(60) + '\n';
    text += '  Additional Tools V3 统计报告\n';
    text += '='.repeat(60) + '\n\n';
    text += `生成时间: ${new Date().toLocaleString()}\n`;
    text += `筛选条件: ${hasActiveFilters.value ? activeFilterCount.value + '个' : '无'}\n\n`;

    // 概览数据
    text += '-'.repeat(60) + '\n';
    text += '概览统计\n';
    text += '-'.repeat(60) + '\n';
    text += `总工具数:       ${overview.value.totalTools}\n`;
    text += `已启用:         ${overview.value.enabledTools}\n`;
    text += `总调用次数:     ${overview.value.totalInvocations}\n`;
    text += `成功率:         ${overview.value.successRate}\n`;
    text += `平均响应时间:   ${overview.value.avgExecutionTime}ms\n\n`;

    // 使用排行
    text += '-'.repeat(60) + '\n';
    text += '使用次数排行 Top 10\n';
    text += '-'.repeat(60) + '\n';
    rankings.value.mostUsed.slice(0, 10).forEach((tool, index) => {
      text += `${(index + 1).toString().padStart(2)}. ${(tool.display_name || tool.name).padEnd(30)} ${tool.usage_count}次\n`;
    });
    text += '\n';

    // 分类统计
    text += '-'.repeat(60) + '\n';
    text += '分类统计\n';
    text += '-'.repeat(60) + '\n';
    categoryStats.value.forEach((cat) => {
      text += `${cat.category.padEnd(15)} 工具数:${cat.toolCount} 使用:${cat.totalUsage}次 成功率:${cat.successRate}%\n`;
    });
    text += '\n';

    text += '='.repeat(60) + '\n';
    text += '报告结束\n';
    text += '='.repeat(60) + '\n';

    // 创建下载
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `additional-tools-stats-${Date.now()}.txt`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    message.success('PDF文本报告导出成功');
  } catch (error) {
    console.error('[Export] PDF导出失败:', error);
    message.error('PDF导出失败: ' + error.message);
  }
};

// ===================================
// 图表导出为图片功能
// ===================================

/**
 * 导出单个图表为PNG图片
 */
const exportChartAsImage = (chart, chartName) => {
  try {
    if (!chart) {
      message.warning(`${chartName}图表未初始化`);
      return;
    }

    // 获取图表的DataURL
    const dataURL = chart.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: '#fff'
    });

    // 创建下载链接
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = `${chartName}-${Date.now()}.png`;
    link.click();

    message.success(`${chartName}图表导出成功`);
  } catch (error) {
    console.error(`[Export] ${chartName}图表导出失败:`, error);
    message.error(`${chartName}图表导出失败: ` + error.message);
  }
};

/**
 * 导出所有图表为图片
 */
const exportAllCharts = async () => {
  try {
    message.loading({ content: '正在导出所有图表...', key: 'exportAllCharts' });

    const charts = [
      { chart: usageChart, name: '使用排行图表' },
      { chart: successRateChart, name: '成功率图表' },
      { chart: performanceChart, name: '性能分布图表' },
      { chart: trendChart, name: '趋势图表' }
    ];

    let successCount = 0;
    for (const { chart, name } of charts) {
      if (chart) {
        exportChartAsImage(chart, name);
        successCount++;
        await new Promise(resolve => setTimeout(resolve, 100)); // 延迟避免下载冲突
      }
    }

    message.success({ content: `成功导出 ${successCount} 个图表`, key: 'exportAllCharts' });
  } catch (error) {
    console.error('[Export] 导出所有图表失败:', error);
    message.error({ content: '导出所有图表失败: ' + error.message, key: 'exportAllCharts' });
  }
};

// ===================================
// 快捷时间范围功能
// ===================================

/**
 * 设置快捷时间范围
 */
const setQuickDateRange = (range) => {
  const today = dayjs();
  let start, end;

  switch (range) {
    case 'today':
      start = today.startOf('day');
      end = today.endOf('day');
      break;
    case 'week':
      start = today.startOf('week');
      end = today.endOf('week');
      break;
    case 'month':
      start = today.startOf('month');
      end = today.endOf('month');
      break;
    case 'last7days':
      start = today.subtract(6, 'day').startOf('day');
      end = today.endOf('day');
      break;
    case 'last30days':
      start = today.subtract(29, 'day').startOf('day');
      end = today.endOf('day');
      break;
    default:
      message.warning('未知的时间范围类型');
      return;
  }

  dateRange.value = [start, end];
  handleFilterChange();

  const rangeNames = {
    'today': '今天',
    'week': '本周',
    'month': '本月',
    'last7days': '最近7天',
    'last30days': '最近30天'
  };
  message.success(`已设置时间范围: ${rangeNames[range]}`);
};

// ===================================
// 筛选条件保存功能
// ===================================

/**
 * 保存当前筛选条件
 */
const saveCurrentFilter = () => {
  if (!hasActiveFilters.value) {
    message.warning('当前没有筛选条件');
    return;
  }

  Modal.confirm({
    title: '保存筛选条件',
    content: '请输入筛选名称:',
    okText: '保存',
    cancelText: '取消',
    onOk: () => {
      return new Promise((resolve) => {
        // 使用简单的prompt作为输入
        const name = prompt('请输入筛选名称:');
        if (name) {
          const filter = {
            name: name.trim(),
            dateRange: dateRange.value ? [
              dateRange.value[0].format('YYYY-MM-DD'),
              dateRange.value[1].format('YYYY-MM-DD')
            ] : null,
            categories: [...selectedCategories.value],
            searchKeyword: searchKeyword.value,
            savedAt: Date.now()
          };

          savedFiltersList.value.push(filter);
          saveSavedFilters();
          message.success(`筛选条件 "${name}" 已保存`);
        }
        resolve();
      });
    }
  });
};

/**
 * 加载保存的筛选条件
 */
const loadSavedFilter = (index) => {
  try {
    const filter = savedFiltersList.value[index];
    if (!filter) {
      message.warning('筛选条件不存在');
      return;
    }

    // 加载时间范围
    if (filter.dateRange && filter.dateRange.length === 2) {
      dateRange.value = [dayjs(filter.dateRange[0]), dayjs(filter.dateRange[1])];
    } else {
      dateRange.value = null;
    }

    // 加载分类
    selectedCategories.value = filter.categories || [];

    // 加载搜索关键词
    searchKeyword.value = filter.searchKeyword || '';

    // 刷新数据
    loadDashboardData();
    message.success(`已加载筛选条件: ${filter.name}`);
  } catch (error) {
    console.error('[SavedFilters] 加载筛选条件失败:', error);
    message.error('加载筛选条件失败: ' + error.message);
  }
};

/**
 * 删除保存的筛选条件
 */
const deleteSavedFilter = (index) => {
  try {
    const filter = savedFiltersList.value[index];
    if (!filter) return;

    Modal.confirm({
      title: '确认删除',
      content: `确定要删除筛选条件 "${filter.name}" 吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        savedFiltersList.value.splice(index, 1);
        saveSavedFilters();
        message.success('筛选条件已删除');
      }
    });
  } catch (error) {
    console.error('[SavedFilters] 删除筛选条件失败:', error);
    message.error('删除筛选条件失败: ' + error.message);
  }
};

/**
 * 筛选管理菜单处理
 */
const handleSavedFilters = ({ key }) => {
  if (key === 'save') {
    saveCurrentFilter();
  } else if (key.startsWith('load-')) {
    const index = parseInt(key.replace('load-', ''));
    loadSavedFilter(index);
  }
};

/**
 * 导出处理器（支持图表导出）
 */
const handleExport = ({ key }) => {
  switch (key) {
    case 'csv':
      exportToCSV();
      break;
    case 'excel':
      exportToExcel();
      break;
    case 'pdf':
      exportToPDF();
      break;
    case 'charts-all':
      exportAllCharts();
      break;
    case 'chart-usage':
      exportChartAsImage(usageChart, '使用排行');
      break;
    case 'chart-success':
      exportChartAsImage(successRateChart, '成功率');
      break;
    case 'chart-performance':
      exportChartAsImage(performanceChart, '性能分布');
      break;
    case 'chart-trend':
      exportChartAsImage(trendChart, '趋势');
      break;
    default:
      message.warning('未知的导出格式');
  }
};

// 初始化所有图表
const initCharts = async () => {
  await Promise.all([
    initUsageChart(),
    initSuccessRateChart(),
    initPerformanceChart(),
    initTrendChart(),
  ]);
};

// 使用次数柱状图
const initUsageChart = () => {
  if (!usageChartRef.value) return;

  usageChart = echarts.init(usageChartRef.value);

  const data = rankings.value.mostUsed.slice(0, 10);

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const item = params[0];
        return `${item.name}<br/>调用次数: ${item.value}`;
      },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      name: '调用次数',
    },
    yAxis: {
      type: 'category',
      data: data.map(t => t.display_name || t.name),
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        name: '调用次数',
        type: 'bar',
        data: data.map(t => t.usage_count),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: '#667eea' },
            { offset: 1, color: '#764ba2' },
          ]),
        },
        label: {
          show: true,
          position: 'right',
          formatter: '{c}',
        },
      },
    ],
  };

  usageChart.setOption(option);
};

// 成功率柱状图
const initSuccessRateChart = () => {
  if (!successRateChartRef.value) return;

  successRateChart = echarts.init(successRateChartRef.value);

  const data = rankings.value.highestSuccessRate.slice(0, 10);

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const item = params[0];
        return `${item.name}<br/>成功率: ${item.value}%`;
      },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      name: '成功率(%)',
      max: 100,
    },
    yAxis: {
      type: 'category',
      data: data.map(t => t.display_name || t.name),
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        name: '成功率',
        type: 'bar',
        data: data.map(t => t.success_rate),
        itemStyle: {
          color: (params) => {
            const rate = params.value;
            if (rate >= 90) return '#52c41a';
            if (rate >= 70) return '#1890ff';
            if (rate >= 50) return '#faad14';
            return '#f5222d';
          },
        },
        label: {
          show: true,
          position: 'right',
          formatter: '{c}%',
        },
      },
    ],
  };

  successRateChart.setOption(option);
};

// 性能分布饼图
const initPerformanceChart = () => {
  if (!performanceChartRef.value) return;

  performanceChart = echarts.init(performanceChartRef.value);

  const dist = performanceMetrics.value.distribution;

  const option = {
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} ({d}%)',
    },
    legend: {
      orient: 'vertical',
      left: 'left',
    },
    series: [
      {
        type: 'pie',
        radius: '60%',
        data: [
          { value: dist.excellent, name: '优秀 (<10ms)', itemStyle: { color: '#52c41a' } },
          { value: dist.good, name: '良好 (10-50ms)', itemStyle: { color: '#1890ff' } },
          { value: dist.fair, name: '一般 (50-100ms)', itemStyle: { color: '#faad14' } },
          { value: dist.slow, name: '较慢 (>100ms)', itemStyle: { color: '#f5222d' } },
        ],
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
  };

  performanceChart.setOption(option);
};

// 7天使用趋势折线图
const initTrendChart = () => {
  if (!trendChartRef.value) return;

  trendChart = echarts.init(trendChartRef.value);

  const data = dailyStats.value;

  const option = {
    tooltip: {
      trigger: 'axis',
    },
    legend: {
      data: ['调用次数', '成功次数', '失败次数'],
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: data.map(d => d.date),
    },
    yAxis: {
      type: 'value',
    },
    series: [
      {
        name: '调用次数',
        type: 'line',
        data: data.map(d => d.invokes),
        smooth: true,
        itemStyle: { color: '#1890ff' },
      },
      {
        name: '成功次数',
        type: 'line',
        data: data.map(d => d.success),
        smooth: true,
        itemStyle: { color: '#52c41a' },
      },
      {
        name: '失败次数',
        type: 'line',
        data: data.map(d => d.failure),
        smooth: true,
        itemStyle: { color: '#f5222d' },
      },
    ],
  };

  trendChart.setOption(option);
};

// 辅助函数
const getCategoryColor = (category) => {
  const colorMap = {
    blockchain: 'blue',
    finance: 'green',
    crm: 'orange',
    project: 'purple',
    code: 'cyan',
    simulation: 'magenta',
    analysis: 'geekblue',
    management: 'lime',
    general: 'default',
  };
  return colorMap[category] || 'default';
};

const getCategoryName = (category) => {
  const nameMap = {
    blockchain: '区块链',
    finance: '财务',
    crm: 'CRM',
    project: '项目管理',
    code: '代码生成',
    simulation: '模拟仿真',
    analysis: '分析',
    management: '管理',
    general: '通用',
  };
  return nameMap[category] || category;
};

const getSuccessRateColor = (rateStr) => {
  const rate = parseFloat(rateStr);
  if (rate >= 90) return '#52c41a';
  if (rate >= 70) return '#1890ff';
  if (rate >= 50) return '#faad14';
  return '#f5222d';
};

const getToolSuccessRate = (tool) => {
  if (!tool.usage_count || tool.usage_count === 0) return 0;
  return ((tool.success_count / tool.usage_count) * 100).toFixed(1);
};

// 手动刷新
const handleRefresh = async () => {
  await loadDashboardData();
  message.success('数据已刷新');
};

// 自动刷新切换
const handleAutoRefreshChange = (checked) => {
  if (checked) {
    // 启动自动刷新，每30秒刷新一次
    refreshTimer = setInterval(async () => {
      await loadDashboardData();
    }, 30000);
    message.info('已启用自动刷新（每30秒）');
  } else {
    // 停止自动刷新
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    message.info('已关闭自动刷新');
  }
};

// 响应式调整
const handleResize = () => {
  usageChart?.resize();
  successRateChart?.resize();
  performanceChart?.resize();
  trendChart?.resize();
};

// 生命周期
onMounted(async () => {
  // 加载保存的筛选条件
  loadSavedFilters();

  // 加载仪表板数据
  await loadDashboardData();

  // 监听窗口大小变化
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);

  // 清理自动刷新定时器
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  // 清理搜索防抖定时器
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  // 销毁图表
  usageChart?.dispose();
  successRateChart?.dispose();
  performanceChart?.dispose();
  trendChart?.dispose();
});

// 暴露刷新方法供父组件调用
defineExpose({
  refresh: loadDashboardData,
});
</script>

<style scoped lang="scss">
.additional-tools-stats {
  padding: 0;

  .toolbar {
    background: #fff;
    padding: 16px 24px;
    border-radius: 8px;
    margin-bottom: 16px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
    display: flex;
    justify-content: space-between;
    align-items: center;

    .title {
      h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: #262626;
      }

      .subtitle {
        display: block;
        margin-top: 4px;
        font-size: 13px;
        color: #8c8c8c;
      }
    }
  }

  .filter-card {
    margin-bottom: 16px;
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);

    :deep(.ant-card-body) {
      padding: 16px;
    }

    .filter-item {
      label {
        display: block;
        margin-bottom: 8px;
        font-size: 13px;
        font-weight: 500;
        color: #595959;
      }
    }
  }

  .loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 400px;
    background: #fff;
    border-radius: 8px;
  }

  .stats-container {
    .stat-card {
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
      transition: all 0.3s;

      &:hover {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        transform: translateY(-2px);
      }

      :deep(.ant-statistic-title) {
        font-size: 13px;
        color: #8c8c8c;
        margin-bottom: 4px;
      }

      :deep(.ant-statistic-content) {
        .ant-statistic-content-prefix {
          font-size: 22px;
          margin-right: 8px;
        }
      }
    }

    .chart-card {
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
      margin-bottom: 16px;

      :deep(.ant-card-head-title) {
        font-size: 15px;
        font-weight: 600;
      }
    }
  }
}

// 深色主题支持
:deep(.dark) .additional-tools-stats,
.additional-tools-stats.dark-theme {
  .toolbar {
    background: #141414;
    box-shadow: 0 1px 2px rgba(255, 255, 255, 0.05);

    .title h3 {
      color: #ffffff;
    }

    .title .subtitle {
      color: #8c8c8c;
    }
  }

  .filter-card {
    background: #141414;
    box-shadow: 0 1px 2px rgba(255, 255, 255, 0.05);

    :deep(.ant-card-body) {
      background: #141414;
    }

    .filter-item label {
      color: #d9d9d9;
    }
  }

  .loading-container {
    background: #141414;
  }

  .stats-container {
    .stat-card {
      background: #1f1f1f;
      box-shadow: 0 1px 2px rgba(255, 255, 255, 0.05);

      :deep(.ant-statistic-title) {
        color: #8c8c8c;
      }

      :deep(.ant-statistic-content) {
        color: #ffffff;
      }
    }

    .chart-card {
      background: #1f1f1f;
      box-shadow: 0 1px 2px rgba(255, 255, 255, 0.05);

      :deep(.ant-card-head) {
        background: #1f1f1f;
        border-bottom-color: #303030;
      }

      :deep(.ant-card-head-title) {
        color: #ffffff;
      }

      :deep(.ant-card-body) {
        background: #1f1f1f;
      }
    }

    :deep(.ant-table) {
      background: #1f1f1f;
      color: #ffffff;

      .ant-table-thead > tr > th {
        background: #262626;
        color: #ffffff;
        border-bottom-color: #303030;
      }

      .ant-table-tbody > tr > td {
        border-bottom-color: #303030;
        color: #d9d9d9;
      }

      .ant-table-tbody > tr:hover > td {
        background: #262626;
      }
    }

    :deep(.ant-list) {
      .ant-list-item {
        border-bottom-color: #303030;
        color: #d9d9d9;

        &:hover {
          background: #262626;
        }
      }
    }

    :deep(.ant-pagination) {
      .ant-pagination-item {
        background: #1f1f1f;
        border-color: #303030;

        a {
          color: #d9d9d9;
        }

        &:hover {
          border-color: #177ddc;

          a {
            color: #177ddc;
          }
        }
      }

      .ant-pagination-item-active {
        background: #177ddc;
        border-color: #177ddc;

        a {
          color: #ffffff;
        }
      }
    }
  }
}

// 响应式适配
@media (max-width: 768px) {
  .additional-tools-stats {
    .stat-card {
      margin-bottom: 12px;
    }

    .chart-card {
      :deep(.ant-card-body) {
        padding: 12px;
      }
    }
  }
}
</style>
