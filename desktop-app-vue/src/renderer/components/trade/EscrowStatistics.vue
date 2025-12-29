<template>
  <div class="escrow-statistics">
    <a-row :gutter="16">
      <!-- 总托管数 -->
      <a-col :xs="24" :sm="12" :md="6">
        <a-card class="stat-card" hoverable>
          <a-statistic
            title="总托管数"
            :value="statistics.total"
            :value-style="{ color: '#1890ff' }"
          >
            <template #prefix>
              <lock-outlined />
            </template>
          </a-statistic>
          <div class="stat-footer">
            <a-tag color="blue">全部记录</a-tag>
          </div>
        </a-card>
      </a-col>

      <!-- 锁定中 -->
      <a-col :xs="24" :sm="12" :md="6">
        <a-card class="stat-card" hoverable>
          <a-statistic
            title="锁定中"
            :value="statistics.locked"
            :value-style="{ color: '#faad14' }"
          >
            <template #prefix>
              <safety-certificate-outlined />
            </template>
          </a-statistic>
          <div class="stat-footer">
            <a-progress
              :percent="lockedPercentage"
              :stroke-color="{ '0%': '#faad14', '100%': '#ffd666' }"
              :show-info="false"
              size="small"
            />
            <span class="stat-percentage">{{ lockedPercentage.toFixed(1) }}%</span>
          </div>
        </a-card>
      </a-col>

      <!-- 已释放 -->
      <a-col :xs="24" :sm="12" :md="6">
        <a-card class="stat-card" hoverable>
          <a-statistic
            title="已释放"
            :value="statistics.released"
            :value-style="{ color: '#52c41a' }"
          >
            <template #prefix>
              <check-circle-outlined />
            </template>
          </a-statistic>
          <div class="stat-footer">
            <a-progress
              :percent="releasedPercentage"
              :stroke-color="{ '0%': '#52c41a', '100%': '#95de64' }"
              :show-info="false"
              size="small"
            />
            <span class="stat-percentage">{{ releasedPercentage.toFixed(1) }}%</span>
          </div>
        </a-card>
      </a-col>

      <!-- 已退款 -->
      <a-col :xs="24" :sm="12" :md="6">
        <a-card class="stat-card" hoverable>
          <a-statistic
            title="已退款"
            :value="statistics.refunded"
            :value-style="{ color: '#ff7a45' }"
          >
            <template #prefix>
              <rollback-outlined />
            </template>
          </a-statistic>
          <div class="stat-footer">
            <a-progress
              :percent="refundedPercentage"
              :stroke-color="{ '0%': '#ff7a45', '100%': '#ff9c6e' }"
              :show-info="false"
              size="small"
            />
            <span class="stat-percentage">{{ refundedPercentage.toFixed(1) }}%</span>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <!-- 详细统计 -->
    <a-row :gutter="16" style="margin-top: 16px">
      <!-- 争议数量 -->
      <a-col :xs="24" :sm="12" :md="8">
        <a-card class="stat-card detail-card" hoverable>
          <div class="detail-stat">
            <div class="detail-icon" style="background: linear-gradient(135deg, #f5222d 0%, #ff4d4f 100%)">
              <exclamation-circle-outlined style="font-size: 24px; color: white" />
            </div>
            <div class="detail-content">
              <div class="detail-title">有争议</div>
              <div class="detail-value">{{ statistics.disputed }}</div>
              <div class="detail-description">
                <a-tag color="red" size="small">需要处理</a-tag>
              </div>
            </div>
          </div>
        </a-card>
      </a-col>

      <!-- 托管总金额 -->
      <a-col :xs="24" :sm="12" :md="8">
        <a-card class="stat-card detail-card" hoverable>
          <div class="detail-stat">
            <div class="detail-icon" style="background: linear-gradient(135deg, #faad14 0%, #ffc53d 100%)">
              <dollar-outlined style="font-size: 24px; color: white" />
            </div>
            <div class="detail-content">
              <div class="detail-title">托管总金额</div>
              <div class="detail-value">{{ formatAmount(totalLockedAmount) }}</div>
              <div class="detail-description">
                <span style="color: #8c8c8c; font-size: 12px">当前锁定资金</span>
              </div>
            </div>
          </div>
        </a-card>
      </a-col>

      <!-- 平均处理时间 -->
      <a-col :xs="24" :sm="12" :md="8">
        <a-card class="stat-card detail-card" hoverable>
          <div class="detail-stat">
            <div class="detail-icon" style="background: linear-gradient(135deg, #1890ff 0%, #40a9ff 100%)">
              <clock-circle-outlined style="font-size: 24px; color: white" />
            </div>
            <div class="detail-content">
              <div class="detail-title">平均处理时间</div>
              <div class="detail-value">{{ averageProcessTime }}</div>
              <div class="detail-description">
                <span style="color: #8c8c8c; font-size: 12px">从创建到完成</span>
              </div>
            </div>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <!-- 状态分布图表 -->
    <a-row :gutter="16" style="margin-top: 16px">
      <a-col :span="24">
        <a-card title="状态分布" size="small">
          <div class="status-distribution">
            <div
              v-for="status in statusDistribution"
              :key="status.name"
              class="status-item"
              :style="{ flex: status.percentage }"
            >
              <div class="status-bar" :style="{ backgroundColor: status.color }">
                <span class="status-label">{{ status.name }}</span>
                <span class="status-count">{{ status.count }}</span>
              </div>
            </div>
          </div>

          <div class="status-legend">
            <div v-for="status in statusDistribution" :key="status.name" class="legend-item">
              <span class="legend-color" :style="{ backgroundColor: status.color }"></span>
              <span class="legend-name">{{ status.name }}</span>
              <span class="legend-percentage">{{ status.percentage.toFixed(1) }}%</span>
            </div>
          </div>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import {
  LockOutlined,
  SafetyCertificateOutlined,
  CheckCircleOutlined,
  RollbackOutlined,
  ExclamationCircleOutlined,
  DollarOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';

// Store
const tradeStore = useTradeStore();

// 从 store 获取数据
const statistics = computed(() => tradeStore.escrow.statistics);
const escrows = computed(() => tradeStore.escrow.escrows);

// 计算百分比
const lockedPercentage = computed(() => {
  if (statistics.value.total === 0) return 0;
  return (statistics.value.locked / statistics.value.total) * 100;
});

const releasedPercentage = computed(() => {
  if (statistics.value.total === 0) return 0;
  return (statistics.value.released / statistics.value.total) * 100;
});

const refundedPercentage = computed(() => {
  if (statistics.value.total === 0) return 0;
  return (statistics.value.refunded / statistics.value.total) * 100;
});

// 托管总金额（当前锁定）
const totalLockedAmount = computed(() => {
  const lockedEscrows = escrows.value.filter((e) => e.status === 'locked');
  return lockedEscrows.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
});

// 平均处理时间
const averageProcessTime = computed(() => {
  const completedEscrows = escrows.value.filter(
    (e) => e.status === 'released' || e.status === 'refunded'
  );

  if (completedEscrows.length === 0) return '-';

  const totalTime = completedEscrows.reduce((sum, e) => {
    const created = new Date(e.created_at).getTime();
    const updated = new Date(e.updated_at || e.created_at).getTime();
    return sum + (updated - created);
  }, 0);

  const avgMs = totalTime / completedEscrows.length;
  const avgHours = Math.floor(avgMs / (60 * 60 * 1000));
  const avgDays = Math.floor(avgHours / 24);

  if (avgDays > 0) {
    return `${avgDays} 天`;
  } else if (avgHours > 0) {
    return `${avgHours} 小时`;
  } else {
    return '< 1 小时';
  }
});

// 状态分布
const statusDistribution = computed(() => {
  const total = statistics.value.total || 1; // 避免除以0

  const distribution = [
    {
      name: '锁定中',
      count: statistics.value.locked,
      percentage: (statistics.value.locked / total) * 100,
      color: '#faad14',
    },
    {
      name: '已释放',
      count: statistics.value.released,
      percentage: (statistics.value.released / total) * 100,
      color: '#52c41a',
    },
    {
      name: '已退款',
      count: statistics.value.refunded,
      percentage: (statistics.value.refunded / total) * 100,
      color: '#ff7a45',
    },
    {
      name: '有争议',
      count: statistics.value.disputed,
      percentage: (statistics.value.disputed / total) * 100,
      color: '#f5222d',
    },
  ];

  // 过滤掉0的项目
  return distribution.filter((item) => item.count > 0);
});

// 工具函数
const formatAmount = (amount) => {
  if (!amount && amount !== 0) return '0';
  const num = parseFloat(amount);
  if (isNaN(num)) return '0';
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

// 生命周期
onMounted(async () => {
  // 加载统计数据
  await tradeStore.loadEscrowStatistics();
});
</script>

<style scoped>
.escrow-statistics {
  /* 样式 */
}

.stat-card {
  border-radius: 12px;
  transition: all 0.3s;
}

.stat-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.stat-footer {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.stat-percentage {
  font-size: 14px;
  font-weight: 600;
  color: #595959;
}

.detail-card {
  height: 100%;
}

.detail-stat {
  display: flex;
  gap: 16px;
  align-items: center;
}

.detail-icon {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.detail-content {
  flex: 1;
}

.detail-title {
  font-size: 14px;
  color: #8c8c8c;
  margin-bottom: 8px;
}

.detail-value {
  font-size: 24px;
  font-weight: 700;
  color: #262626;
  margin-bottom: 4px;
}

.detail-description {
  font-size: 12px;
  color: #8c8c8c;
}

.status-distribution {
  display: flex;
  gap: 2px;
  margin-bottom: 16px;
  border-radius: 8px;
  overflow: hidden;
  height: 60px;
}

.status-item {
  min-width: 0;
}

.status-bar {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px;
  transition: all 0.3s;
  cursor: pointer;
}

.status-bar:hover {
  opacity: 0.8;
  transform: translateY(-2px);
}

.status-label {
  font-size: 12px;
  color: white;
  font-weight: 500;
  margin-bottom: 4px;
}

.status-count {
  font-size: 16px;
  color: white;
  font-weight: 700;
}

.status-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 12px;
  background: #fafafa;
  border-radius: 8px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

.legend-name {
  font-size: 13px;
  color: #595959;
}

.legend-percentage {
  font-size: 12px;
  color: #8c8c8c;
  margin-left: 4px;
}

:deep(.ant-statistic-title) {
  font-size: 14px;
  color: #8c8c8c;
  margin-bottom: 8px;
}

:deep(.ant-statistic-content) {
  font-size: 28px;
  font-weight: 700;
}

:deep(.ant-statistic-content-prefix) {
  margin-right: 8px;
}

:deep(.ant-progress-bg) {
  height: 6px !important;
  border-radius: 3px;
}
</style>
