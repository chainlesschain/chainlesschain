<template>
  <a-card
    title="LLM 成本追踪"
    size="small"
    class="token-dashboard-widget"
    :loading="loading"
  >
    <template #extra>
      <a-tooltip title="刷新">
        <ReloadOutlined
          class="refresh-icon"
          :spin="loading"
          @click="loadStats"
        />
      </a-tooltip>
    </template>

    <!-- 本周支出 -->
    <div class="main-stat">
      <div class="stat-label">
        本周支出
      </div>
      <div class="stat-value">
        <span class="amount">${{ weekSpend.toFixed(2) }}</span>
        <span class="limit">/ ${{ weekLimit.toFixed(2) }}</span>
      </div>
      <a-progress
        :percent="weekPercent"
        :status="getProgressStatus(weekPercent)"
        :stroke-color="getProgressColor(weekPercent)"
        :show-info="false"
        size="small"
        class="progress-bar"
      />
    </div>

    <a-divider style="margin: 12px 0" />

    <!-- 关键指标 -->
    <a-row
      :gutter="8"
      class="metrics-row"
    >
      <a-col
        :span="12"
      >
        <div class="metric-box">
          <ThunderboltOutlined class="metric-icon cache" />
          <div class="metric-info">
            <div class="metric-label">
              缓存命中
            </div>
            <div class="metric-value">
              {{ cacheHitRate }}%
            </div>
          </div>
        </div>
      </a-col>
      <a-col
        :span="12"
      >
        <div class="metric-box">
          <DollarOutlined class="metric-icon cost" />
          <div class="metric-info">
            <div class="metric-label">
              节省成本
            </div>
            <div class="metric-value">
              ${{ savedCost.toFixed(2) }}
            </div>
          </div>
        </div>
      </a-col>
    </a-row>

    <!-- 每日统计 -->
    <div class="daily-stats">
      <div class="daily-item">
        <span class="daily-label">今日调用:</span>
        <span class="daily-value">{{ todayCalls }} 次</span>
      </div>
      <div class="daily-item">
        <span class="daily-label">今日成本:</span>
        <span class="daily-value">${{ todayCost.toFixed(4) }}</span>
      </div>
    </div>

    <!-- 预算警告 -->
    <a-alert
      v-if="budgetWarning"
      :message="budgetWarning"
      :type="budgetWarningType"
      show-icon
      closable
      banner
      style="margin-top: 12px"
    />

    <!-- 操作按钮 -->
    <a-button
      type="link"
      block
      class="detail-button"
      @click="navigateToDetails"
    >
      查看详细报告 <RightOutlined />
    </a-button>
  </a-card>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import dayjs from 'dayjs';
import {
  ReloadOutlined,
  ThunderboltOutlined,
  DollarOutlined,
  RightOutlined,
} from '@ant-design/icons-vue';

const router = useRouter();
const loading = ref(false);

// 数据
const weekSpend = ref(0);
const weekLimit = ref(5.0);
const cacheHitRate = ref(0);
const savedCost = ref(0);
const todayCalls = ref(0);
const todayCost = ref(0);

let refreshInterval = null;

// 计算属性
const weekPercent = computed(() => {
  if (weekLimit.value === 0) {return 0;}
  return Math.min((weekSpend.value / weekLimit.value) * 100, 100);
});

const budgetWarning = computed(() => {
  const percent = weekPercent.value;
  if (percent >= 95) {
    return `本周预算已使用 ${percent.toFixed(0)}%，即将超限！`;
  } else if (percent >= 80) {
    return `本周预算已使用 ${percent.toFixed(0)}%，请注意控制成本`;
  }
  return '';
});

const budgetWarningType = computed(() => {
  const percent = weekPercent.value;
  if (percent >= 95) {return 'error';}
  if (percent >= 80) {return 'warning';}
  return 'info';
});

// 方法
function getProgressStatus(percent) {
  if (percent >= 95) {return 'exception';}
  if (percent >= 80) {return 'normal';}
  return 'active';
}

function getProgressColor(percent) {
  if (percent >= 95) {return '#ff4d4f';}
  if (percent >= 80) {return '#faad14';}
  return '#52c41a';
}

async function loadStats() {
  loading.value = true;
  try {
    const now = Date.now();
    const todayStart = dayjs().startOf('day').valueOf();
    const weekStart = dayjs().startOf('week').valueOf();

    // 获取本周统计
    const weekStats = await window.electronAPI.llm.getUsageStats({
      startDate: weekStart,
      endDate: now,
    });

    // 获取今日统计
    const todayStats = await window.electronAPI.llm.getUsageStats({
      startDate: todayStart,
      endDate: now,
    });

    // 获取预算
    const budget = await window.electronAPI.llm.getBudget();

    // 获取缓存统计
    const cacheStats = await window.electronAPI.llm.getCacheStats();

    // 更新数据
    weekSpend.value = weekStats.totalCost || 0;
    weekLimit.value = budget?.weeklyLimit || 5.0;
    cacheHitRate.value = parseFloat((weekStats.cacheHitRate || 0).toFixed(1));
    savedCost.value = weekStats.costSaved || 0;
    todayCalls.value = todayStats.totalCalls || 0;
    todayCost.value = todayStats.totalCost || 0;
  } catch (error) {
    logger.error('加载 Dashboard 统计失败:', error);
  } finally {
    loading.value = false;
  }
}

function navigateToDetails() {
  router.push('/settings?tab=token-usage');
}

// 生命周期
onMounted(() => {
  loadStats();

  // 每 60 秒刷新一次
  refreshInterval = setInterval(loadStats, 60000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});
</script>

<style scoped>
.token-dashboard-widget {
  height: 100%;
}

.refresh-icon {
  cursor: pointer;
  font-size: 14px;
  color: #999;
  transition: color 0.3s;
}

.refresh-icon:hover {
  color: #1890ff;
}

.main-stat {
  text-align: center;
}

.stat-label {
  font-size: 13px;
  color: #999;
  margin-bottom: 8px;
}

.stat-value {
  margin-bottom: 12px;
}

.amount {
  font-size: 28px;
  font-weight: bold;
  color: #333;
}

.limit {
  font-size: 16px;
  color: #999;
  margin-left: 4px;
}

.progress-bar {
  margin-top: 8px;
}

.metrics-row {
  margin-bottom: 12px;
}

.metric-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
}

.metric-icon {
  font-size: 20px;
}

.metric-icon.cache {
  color: #faad14;
}

.metric-icon.cost {
  color: #52c41a;
}

.metric-info {
  flex: 1;
}

.metric-label {
  font-size: 11px;
  color: #999;
  line-height: 1.2;
}

.metric-value {
  font-size: 14px;
  font-weight: bold;
  color: #333;
  line-height: 1.4;
}

.daily-stats {
  background: #fafafa;
  padding: 8px 12px;
  border-radius: 4px;
  margin-top: 12px;
}

.daily-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.daily-item:last-child {
  margin-bottom: 0;
}

.daily-label {
  font-size: 12px;
  color: #666;
}

.daily-value {
  font-size: 12px;
  font-weight: bold;
  color: #333;
}

.detail-button {
  margin-top: 12px;
  padding: 0;
  height: auto;
}
</style>
