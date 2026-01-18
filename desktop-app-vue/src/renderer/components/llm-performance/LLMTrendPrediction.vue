<template>
  <a-card
    v-if="prediction.enabled"
    class="prediction-card"
    title="成本预测分析"
  >
    <template #extra>
      <a-tag color="purple"> <LineChartOutlined /> AI 预测 </a-tag>
    </template>
    <div class="prediction-grid">
      <div class="prediction-item">
        <div class="prediction-label">预计本月成本</div>
        <div
          class="prediction-value"
          :class="{
            warning:
              prediction.monthlyPredicted > monthlyLimit && monthlyLimit > 0,
          }"
        >
          ${{ prediction.monthlyPredicted.toFixed(2) }}
        </div>
        <div class="prediction-desc">基于当前使用趋势</div>
      </div>

      <div class="prediction-item">
        <div class="prediction-label">日均成本</div>
        <div class="prediction-value">
          ${{ prediction.dailyAverage.toFixed(4) }}
        </div>
        <div class="prediction-desc">过去 {{ timeRangeLabel }} 平均</div>
      </div>

      <div class="prediction-item">
        <div class="prediction-label">预算消耗天数</div>
        <div
          class="prediction-value"
          :class="{
            warning:
              prediction.daysUntilBudget < 7 && prediction.daysUntilBudget > 0,
          }"
        >
          {{
            prediction.daysUntilBudget > 0
              ? prediction.daysUntilBudget + " 天"
              : "充足"
          }}
        </div>
        <div class="prediction-desc">
          {{
            prediction.daysUntilBudget > 0
              ? "预计月预算用尽时间"
              : "当前趋势下预算充足"
          }}
        </div>
      </div>
    </div>
  </a-card>
</template>

<script setup>
import { computed } from "vue";
import { LineChartOutlined } from "@ant-design/icons-vue";

const props = defineProps({
  prediction: {
    type: Object,
    default: () => ({
      enabled: false,
      monthlyPredicted: 0,
      dailyAverage: 0,
      daysUntilBudget: 0,
    }),
  },
  monthlyLimit: {
    type: Number,
    default: 0,
  },
  timeRange: {
    type: String,
    default: "7d",
  },
});

const timeRangeLabel = computed(() => {
  switch (props.timeRange) {
    case "24h":
      return "1";
    case "7d":
      return "7";
    case "30d":
      return "30";
    default:
      return "7";
  }
});
</script>

<style lang="less" scoped>
.prediction-card {
  margin-bottom: 16px;
  border-left: 4px solid #722ed1;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .prediction-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }

  .prediction-item {
    text-align: center;
    padding: 16px;
    background: #fafafa;
    border-radius: 8px;
    transition: background-color 0.2s ease;

    &:hover {
      background: #f5f5f5;
    }

    .prediction-label {
      font-size: 13px;
      color: #8c8c8c;
      margin-bottom: 8px;
    }

    .prediction-value {
      font-size: 28px;
      font-weight: 600;
      color: #262626;
      margin-bottom: 4px;

      &.warning {
        color: #ff4d4f;
        animation: warningPulse 2s infinite;
      }
    }

    .prediction-desc {
      font-size: 12px;
      color: #bfbfbf;
    }
  }
}

@keyframes warningPulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

// Mobile responsiveness
@media (max-width: 767px) {
  .prediction-card {
    .prediction-grid {
      grid-template-columns: 1fr;
    }

    .prediction-item .prediction-value {
      font-size: 22px;
    }
  }
}
</style>
