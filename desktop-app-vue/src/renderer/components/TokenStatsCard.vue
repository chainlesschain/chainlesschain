<template>
  <a-card
    title="Token 使用概览"
    size="small"
    class="token-stats-card"
    :loading="loading"
  >
    <template #extra>
      <a-button type="link" size="small" @click="handleViewDetails">
        查看详情 <RightOutlined />
      </a-button>
    </template>

    <a-row :gutter="16" class="stats-row">
      <a-col :span="12">
        <a-statistic
          title="今日"
          :value="stats.todayTokens"
          suffix="tokens"
          :value-style="{ fontSize: '18px', color: '#1890ff' }"
        />
        <div class="cost-label">${{ stats.todayCost.toFixed(4) }}</div>
      </a-col>
      <a-col :span="12">
        <a-statistic
          title="本周"
          :value="stats.weekTokens"
          suffix="tokens"
          :value-style="{ fontSize: '18px', color: '#52c41a' }"
        />
        <div class="cost-label">${{ stats.weekCost.toFixed(4) }}</div>
      </a-col>
    </a-row>

    <a-divider style="margin: 12px 0" />

    <a-row :gutter="8}>
      <a-col :span="12">
        <div class="metric-item">
          <ThunderboltOutlined class="metric-icon" style="color: #faad14" />
          <div class="metric-content">
            <div class="metric-label">缓存命中率</div>
            <div class="metric-value">{{ stats.cacheHitRate }}%</div>
          </div>
        </div>
      </a-col>
      <a-col :span="12">
        <div class="metric-item">
          <DollarOutlined class="metric-icon" style="color: #13c2c2" />
          <div class="metric-content">
            <div class="metric-label">平均成本/次</div>
            <div class="metric-value">${{ stats.avgCostPerCall.toFixed(5) }}</div>
          </div>
        </div>
      </a-col>
    </a-row>

    <a-divider style="margin: 12px 0" />

    <!-- 预算进度条 -->
    <div class="budget-section">
      <div class="budget-header">
        <span class="budget-title">本周预算</span>
        <span class="budget-amount">
          ${{ stats.weekCost.toFixed(2) }} / ${{ stats.weeklyLimit.toFixed(2) }}
        </span>
      </div>
      <a-progress
        :percent="weeklyBudgetPercent"
        :status="getBudgetStatus(weeklyBudgetPercent)"
        :stroke-color="getBudgetColor(weeklyBudgetPercent)"
        :show-info="false"
        size="small"
      />
    </div>

    <!-- 优化建议 -->
    <a-alert
      v-if="optimizationTip"
      :message="optimizationTip"
      type="info"
      show-icon
      closable
      style="margin-top: 12px"
    />
  </a-card>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import dayjs from 'dayjs';
import {
  RightOutlined,
  ThunderboltOutlined,
  DollarOutlined,
} from '@ant-design/icons-vue';

const router = useRouter();
const loading = ref(false);

const stats = reactive({
  todayTokens: 0,
  todayCost: 0,
  weekTokens: 0,
  weekCost: 0,
  cacheHitRate: 0,
  avgCostPerCall: 0,
  weeklyLimit: 5.0,
});

const optimizationTip = ref('');

// 计算属性
const weeklyBudgetPercent = computed(() => {
  if (stats.weeklyLimit === 0) return 0;
  return Math.min((stats.weekCost / stats.weeklyLimit) * 100, 100);
});

// 方法
function getBudgetStatus(percent) {
  if (percent >= 95) return 'exception';
  if (percent >= 80) return 'normal';
  return 'active';
}

function getBudgetColor(percent) {
  if (percent >= 95) return '#ff4d4f';
  if (percent >= 80) return '#faad14';
  return '#52c41a';
}

function handleViewDetails() {
  // 跳转到设置页面的 Token 使用 Tab
  router.push('/settings?tab=token-usage');
}

async function loadStats() {
  loading.value = true;
  try {
    const now = Date.now();
    const todayStart = dayjs().startOf('day').valueOf();
    const weekStart = dayjs().startOf('week').valueOf();

    // 获取今日统计
    const todayStats = await window.electronAPI.llm.getUsageStats({
      startDate: todayStart,
      endDate: now,
    });

    // 获取本周统计
    const weekStats = await window.electronAPI.llm.getUsageStats({
      startDate: weekStart,
      endDate: now,
    });

    // 获取预算
    const budget = await window.electronAPI.llm.getBudget();

    // 更新统计数据
    Object.assign(stats, {
      todayTokens: todayStats.totalTokens || 0,
      todayCost: todayStats.totalCost || 0,
      weekTokens: weekStats.totalTokens || 0,
      weekCost: weekStats.totalCost || 0,
      cacheHitRate: weekStats.cacheHitRate || 0,
      avgCostPerCall: weekStats.avgCostPerCall || 0,
      weeklyLimit: budget?.weeklyLimit || 5.0,
    });

    // 生成优化建议
    generateOptimizationTip();
  } catch (error) {
    console.error('加载 Token 统计失败:', error);
  } finally {
    loading.value = false;
  }
}

function generateOptimizationTip() {
  if (stats.cacheHitRate < 10) {
    optimizationTip.value = '缓存命中率较低，建议启用响应缓存功能';
  } else if (weeklyBudgetPercent.value > 80) {
    optimizationTip.value = '本周预算已使用超过 80%，请注意控制成本';
  } else if (stats.avgCostPerCall > 0.01) {
    optimizationTip.value = '平均成本较高，建议启用 Prompt 压缩功能';
  } else {
    optimizationTip.value = '';
  }
}

// 生命周期
onMounted(() => {
  loadStats();

  // 每 30 秒刷新一次
  const interval = setInterval(loadStats, 30000);

  // 组件卸载时清除定时器
  return () => clearInterval(interval);
});
</script>

<style scoped>
.token-stats-card {
  margin-top: 16px;
}

.stats-row {
  margin-bottom: 8px;
}

.cost-label {
  margin-top: 4px;
  font-size: 12px;
  color: #999;
  text-align: center;
}

.metric-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.metric-icon {
  font-size: 20px;
}

.metric-content {
  flex: 1;
}

.metric-label {
  font-size: 12px;
  color: #999;
}

.metric-value {
  font-size: 14px;
  font-weight: bold;
  color: #333;
}

.budget-section {
  margin-top: 8px;
}

.budget-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.budget-title {
  font-size: 13px;
  color: #666;
}

.budget-amount {
  font-size: 12px;
  font-weight: bold;
  color: #333;
}
</style>
