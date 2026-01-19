<template>
  <div class="credit-score-container">
    <a-card>
      <template #title>
        <a-space>
          <trophy-outlined />
          <span>信用评分</span>
        </a-space>
      </template>
      <template #extra>
        <a-button @click="loadCreditReport">
          <template #icon>
            <reload-outlined />
          </template>
          刷新
        </a-button>
      </template>

      <a-spin :spinning="loading">
        <div v-if="creditReport">
          <!-- 信用评分概览 -->
          <a-row :gutter="[24, 24]">
            <a-col
              :span="24"
              :md="8"
            >
              <a-card
                class="score-card"
                :bordered="false"
              >
                <div class="score-display">
                  <div
                    class="score-number"
                    :style="{ color: getLevelColor(creditReport.levelColor) }"
                  >
                    {{ creditReport.creditScore }}
                  </div>
                  <div class="score-label">
                    信用评分
                  </div>
                  <a-progress
                    :percent="(creditReport.creditScore / 1000) * 100"
                    :show-info="false"
                    :stroke-color="getLevelColor(creditReport.levelColor)"
                  />
                </div>
              </a-card>
            </a-col>

            <a-col
              :span="24"
              :md="8"
            >
              <a-card
                class="level-card"
                :bordered="false"
              >
                <div class="level-display">
                  <a-badge
                    :color="getLevelColor(creditReport.levelColor)"
                    :text="creditReport.creditLevel"
                    style="font-size: 24px; font-weight: bold"
                  />
                  <div class="level-label">
                    信用等级
                  </div>
                  <div class="benefits-list">
                    <div
                      v-for="(benefit, index) in creditReport.benefits"
                      :key="index"
                      class="benefit-item"
                    >
                      <check-circle-outlined style="color: #52c41a" />
                      <span>{{ benefit }}</span>
                    </div>
                  </div>
                </div>
              </a-card>
            </a-col>

            <a-col
              :span="24"
              :md="8"
            >
              <a-card
                class="stats-card"
                :bordered="false"
              >
                <a-statistic
                  title="交易总数"
                  :value="creditReport.statistics.totalTransactions"
                  :value-style="{ color: '#1890ff' }"
                >
                  <template #prefix>
                    <transaction-outlined />
                  </template>
                </a-statistic>
                <a-divider style="margin: 12px 0" />
                <a-statistic
                  title="完成率"
                  :value="creditReport.statistics.completionRate"
                  suffix="%"
                  :value-style="{ color: '#52c41a' }"
                />
              </a-card>
            </a-col>
          </a-row>

          <!-- 统计详情 -->
          <a-card
            title="信用统计"
            style="margin-top: 24px"
          >
            <a-row :gutter="[16, 16]">
              <a-col
                :span="12"
                :md="6"
              >
                <a-statistic
                  title="完成交易"
                  :value="creditReport.statistics.completedTransactions"
                >
                  <template #prefix>
                    <check-circle-outlined style="color: #52c41a" />
                  </template>
                </a-statistic>
              </a-col>
              <a-col
                :span="12"
                :md="6"
              >
                <a-statistic
                  title="好评数"
                  :value="creditReport.statistics.positiveReviews"
                >
                  <template #prefix>
                    <like-outlined style="color: #faad14" />
                  </template>
                </a-statistic>
              </a-col>
              <a-col
                :span="12"
                :md="6"
              >
                <a-statistic
                  title="好评率"
                  :value="creditReport.statistics.positiveRate"
                  suffix="%"
                >
                  <template #prefix>
                    <star-outlined style="color: #faad14" />
                  </template>
                </a-statistic>
              </a-col>
              <a-col
                :span="12"
                :md="6"
              >
                <a-statistic
                  title="交易金额"
                  :value="creditReport.statistics.totalVolume"
                  :precision="0"
                >
                  <template #prefix>
                    <dollar-outlined style="color: #1890ff" />
                  </template>
                </a-statistic>
              </a-col>
              <a-col
                :span="12"
                :md="6"
              >
                <a-statistic
                  title="纠纷率"
                  :value="creditReport.statistics.disputeRate"
                  suffix="%"
                  :value-style="{ color: creditReport.statistics.disputeRate > 5 ? '#ff4d4f' : '#52c41a' }"
                >
                  <template #prefix>
                    <warning-outlined />
                  </template>
                </a-statistic>
              </a-col>
              <a-col
                :span="12"
                :md="6"
              >
                <a-statistic
                  title="退款率"
                  :value="creditReport.statistics.refundRate"
                  suffix="%"
                  :value-style="{ color: creditReport.statistics.refundRate > 10 ? '#ff4d4f' : '#52c41a' }"
                >
                  <template #prefix>
                    <undo-outlined />
                  </template>
                </a-statistic>
              </a-col>
              <a-col
                :span="12"
                :md="6"
              >
                <a-statistic
                  title="差评数"
                  :value="creditReport.statistics.negativeReviews"
                  :value-style="{ color: creditReport.statistics.negativeReviews > 0 ? '#ff4d4f' : '#999' }"
                >
                  <template #prefix>
                    <dislike-outlined />
                  </template>
                </a-statistic>
              </a-col>
              <a-col
                :span="12"
                :md="6"
              >
                <a-statistic
                  title="平均响应"
                  :value="formatResponseTime(creditReport.statistics.avgResponseTime)"
                >
                  <template #prefix>
                    <clock-circle-outlined style="color: #1890ff" />
                  </template>
                </a-statistic>
              </a-col>
            </a-row>
          </a-card>

          <!-- 信用等级说明 -->
          <a-card
            title="信用等级体系"
            style="margin-top: 24px"
          >
            <a-table
              :columns="levelColumns"
              :data-source="creditLevels"
              :pagination="false"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'level'">
                  <a-badge
                    :color="getLevelColor(record.color)"
                    :text="record.name"
                  />
                </template>
                <template v-else-if="column.key === 'range'">
                  {{ record.min }} - {{ record.max }} 分
                </template>
                <template v-else-if="column.key === 'benefits'">
                  <a-space wrap>
                    <a-tag
                      v-for="(benefit, index) in record.benefits"
                      :key="index"
                      color="blue"
                      size="small"
                    >
                      {{ benefit }}
                    </a-tag>
                  </a-space>
                  <span
                    v-if="record.benefits.length === 0"
                    style="color: #999"
                  >暂无特权</span>
                </template>
              </template>
            </a-table>
          </a-card>

          <!-- 最近信用记录 -->
          <a-card
            title="最近信用记录"
            style="margin-top: 24px"
          >
            <a-timeline>
              <a-timeline-item
                v-for="record in creditReport.recentRecords"
                :key="record.id"
                :color="record.scoreChange > 0 ? 'green' : record.scoreChange < 0 ? 'red' : 'blue'"
              >
                <div class="record-item">
                  <div class="record-header">
                    <span
                      class="record-change"
                      :style="{
                        color: record.scoreChange > 0 ? '#52c41a' : record.scoreChange < 0 ? '#ff4d4f' : '#1890ff'
                      }"
                    >
                      {{ record.scoreChange > 0 ? '+' : '' }}{{ record.scoreChange }} 分
                    </span>
                    <span class="record-time">{{ formatTime(record.createdAt) }}</span>
                  </div>
                  <div class="record-reason">
                    {{ record.reason }}
                  </div>
                  <div class="record-type">
                    <a-tag size="small">
                      {{ getEventTypeName(record.eventType) }}
                    </a-tag>
                    <span style="color: #999; font-size: 12px">
                      变更后: {{ record.scoreAfter }} 分
                    </span>
                  </div>
                </div>
              </a-timeline-item>
            </a-timeline>

            <div
              v-if="creditReport.recentRecords.length === 0"
              style="text-align: center; padding: 40px; color: #999"
            >
              暂无信用记录
            </div>
          </a-card>
        </div>
      </a-spin>
    </a-card>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  TrophyOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  TransactionOutlined,
  LikeOutlined,
  DislikeOutlined,
  StarOutlined,
  DollarOutlined,
  WarningOutlined,
  UndoOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';

// Store
const tradeStore = useTradeStore();

// Props
const props = defineProps({
  userDid: {
    type: String,
    default: null,
  },
});

// 从 store 获取状态
const loading = computed(() => tradeStore.credit.loading);
const userCredit = computed(() => tradeStore.credit.userCredit);
const scoreHistory = computed(() => tradeStore.credit.scoreHistory);

// 本地状态 - 用于组装信用报告
const creditReport = ref(null);

// 信用等级定义
const creditLevels = [
  { name: '新手', min: 0, max: 100, color: 'gray', benefits: [] },
  { name: '青铜', min: 101, max: 300, color: 'bronze', benefits: ['降低 5% 手续费'] },
  { name: '白银', min: 301, max: 600, color: 'silver', benefits: ['降低 10% 手续费', '优先展示'] },
  { name: '黄金', min: 601, max: 900, color: 'gold', benefits: ['降低 15% 手续费', '优先展示', '更高托管比例'] },
  { name: '钻石', min: 901, max: 1000, color: 'diamond', benefits: ['降低 20% 手续费', '优先展示', '免保证金', 'VIP 支持'] }
];

// 表格列定义
const levelColumns = [
  { title: '等级', key: 'level', width: 120 },
  { title: '分数范围', key: 'range', width: 150 },
  { title: '等级特权', key: 'benefits' },
];

// 加载信用报告
const loadCreditReport = async () => {
  try {
    // 确定用户DID
    let targetDid = props.userDid;

    if (!targetDid) {
      // 获取当前用户DID
      const currentIdentity = await window.electronAPI.did.getCurrentIdentity();
      targetDid = currentIdentity?.did;
    }

    if (!targetDid) {
      antMessage.warning('请先创建DID身份');
      return;
    }

    // 使用 store 加载用户信用
    await tradeStore.loadUserCredit(targetDid);

    // 使用 store 加载信用历史
    await tradeStore.loadScoreHistory(targetDid, 10);

    // 如果成功加载，组装信用报告
    if (userCredit.value) {
      const credit = userCredit.value;

      // 获取信用等级信息
      const levelInfo = creditLevels.find(
        level => credit.credit_score >= level.min && credit.credit_score <= level.max
      ) || creditLevels[0];

      // 计算完成率
      const completionRate = credit.total_transactions > 0
        ? ((credit.completed_transactions / credit.total_transactions) * 100).toFixed(1)
        : 0;

      // 计算好评率
      const totalReviews = credit.positive_reviews + credit.negative_reviews;
      const positiveRate = totalReviews > 0
        ? ((credit.positive_reviews / totalReviews) * 100).toFixed(1)
        : 0;

      // 计算纠纷率
      const disputeRate = credit.total_transactions > 0
        ? ((credit.disputes / credit.total_transactions) * 100).toFixed(1)
        : 0;

      // 计算退款率
      const refundRate = credit.total_transactions > 0
        ? ((credit.refunds / credit.total_transactions) * 100).toFixed(1)
        : 0;

      // 组装信用报告
      creditReport.value = {
        creditScore: credit.credit_score,
        creditLevel: levelInfo.name,
        levelColor: levelInfo.color,
        benefits: levelInfo.benefits || [],
        statistics: {
          totalTransactions: credit.total_transactions,
          completedTransactions: credit.completed_transactions,
          completionRate,
          positiveReviews: credit.positive_reviews,
          negativeReviews: credit.negative_reviews,
          positiveRate,
          totalVolume: credit.total_volume,
          disputes: credit.disputes,
          refunds: credit.refunds,
          disputeRate,
          refundRate,
          avgResponseTime: credit.avg_response_time,
        },
        recentRecords: scoreHistory.value.map(record => ({
          id: record.id,
          scoreChange: record.score_change,
          scoreAfter: record.score_after,
          reason: record.reason,
          eventType: record.event_type,
          createdAt: record.created_at,
        })),
      };

      logger.info('[CreditScore] 信用报告已加载:', creditReport.value);
    }
  } catch (error) {
    logger.error('[CreditScore] 加载信用报告失败:', error);
    antMessage.error(error.message || '加载信用报告失败');
  }
};

// 工具函数
const getLevelColor = (color) => {
  const colors = {
    gray: '#8c8c8c',
    bronze: '#cd7f32',
    silver: '#c0c0c0',
    gold: '#ffd700',
    diamond: '#b9f2ff',
  };
  return colors[color] || '#1890ff';
};

const getEventTypeName = (type) => {
  const names = {
    trade_completed: '完成交易',
    trade_cancelled: '取消交易',
    positive_review: '好评',
    negative_review: '差评',
    dispute: '纠纷',
    dispute_resolved: '纠纷解决',
    refund: '退款',
  };
  return names[type] || type;
};

const formatResponseTime = (ms) => {
  if (!ms || ms === 0) {return '无数据';}
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}小时${minutes}分`;
  }
  return `${minutes}分钟`;
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
};

// 生命周期
onMounted(() => {
  loadCreditReport();
});
</script>

<style scoped>
.credit-score-container {
  padding: 20px;
}

.score-card,
.level-card,
.stats-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  height: 100%;
}

.score-display {
  text-align: center;
  padding: 20px 0;
}

.score-number {
  font-size: 64px;
  font-weight: bold;
  line-height: 1;
  margin-bottom: 8px;
}

.score-label {
  font-size: 16px;
  opacity: 0.9;
  margin-bottom: 16px;
}

.level-display {
  text-align: center;
  padding: 20px 0;
}

.level-label {
  font-size: 14px;
  opacity: 0.9;
  margin: 12px 0;
}

.benefits-list {
  margin-top: 16px;
  text-align: left;
}

.benefit-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 13px;
}

.stats-card :deep(.ant-statistic-title) {
  color: rgba(255, 255, 255, 0.85);
}

.stats-card :deep(.ant-statistic-content) {
  color: white;
}

.record-item {
  margin-bottom: 8px;
}

.record-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.record-change {
  font-weight: bold;
  font-size: 16px;
}

.record-time {
  font-size: 12px;
  color: #999;
}

.record-reason {
  font-size: 14px;
  color: #333;
  margin-bottom: 4px;
}

.record-type {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
