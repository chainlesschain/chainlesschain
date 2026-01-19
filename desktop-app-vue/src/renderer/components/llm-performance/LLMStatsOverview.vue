<template>
  <div class="stats-overview">
    <!-- Main stats row -->
    <div class="stats-grid main-stats">
      <a-card
        class="stat-card"
        hoverable
      >
        <a-skeleton
          :loading="loading"
          active
          :paragraph="{ rows: 1 }"
        >
          <a-statistic
            title="总调用次数"
            :value="stats.totalCalls"
            :prefix="h(ApiOutlined)"
          >
            <template #suffix>
              <span
                v-if="periodComparison.callsChange !== 0"
                class="stat-change"
                :class="periodComparison.callsChange > 0 ? 'up' : 'down'"
              >
                <ArrowUpOutlined v-if="periodComparison.callsChange > 0" />
                <ArrowDownOutlined v-else />
                {{ Math.abs(periodComparison.callsChange).toFixed(1) }}%
              </span>
            </template>
          </a-statistic>
        </a-skeleton>
      </a-card>

      <a-card
        class="stat-card"
        hoverable
      >
        <a-skeleton
          :loading="loading"
          active
          :paragraph="{ rows: 1 }"
        >
          <a-statistic
            title="总 Token 消耗"
            :value="stats.totalTokens"
            :prefix="h(ThunderboltOutlined)"
            :formatter="formatTokens"
          >
            <template #suffix>
              <span
                v-if="periodComparison.tokensChange !== 0"
                class="stat-change"
                :class="periodComparison.tokensChange > 0 ? 'up' : 'down'"
              >
                <ArrowUpOutlined v-if="periodComparison.tokensChange > 0" />
                <ArrowDownOutlined v-else />
                {{ Math.abs(periodComparison.tokensChange).toFixed(1) }}%
              </span>
            </template>
          </a-statistic>
        </a-skeleton>
      </a-card>

      <a-card
        class="stat-card"
        hoverable
      >
        <a-skeleton
          :loading="loading"
          active
          :paragraph="{ rows: 1 }"
        >
          <a-statistic
            title="总成本"
            :value="stats.totalCostUsd"
            prefix="$"
            :precision="4"
            :value-style="{
              color: stats.totalCostUsd > 10 ? '#cf1322' : '#3f8600',
            }"
          >
            <template #suffix>
              <span
                v-if="periodComparison.costChange !== 0"
                class="stat-change"
                :class="periodComparison.costChange > 0 ? 'up' : 'down'"
              >
                <ArrowUpOutlined v-if="periodComparison.costChange > 0" />
                <ArrowDownOutlined v-else />
                {{ Math.abs(periodComparison.costChange).toFixed(1) }}%
              </span>
            </template>
          </a-statistic>
          <div class="sub-value">
            ¥{{ (stats.totalCostCny || 0).toFixed(2) }}
          </div>
        </a-skeleton>
      </a-card>

      <a-card
        class="stat-card"
        hoverable
      >
        <a-skeleton
          :loading="loading"
          active
          :paragraph="{ rows: 1 }"
        >
          <a-statistic
            title="缓存命中率"
            :value="stats.cacheHitRate"
            suffix="%"
            :precision="2"
            :prefix="h(RocketOutlined)"
            :value-style="{
              color: stats.cacheHitRate > 50 ? '#3f8600' : '#cf1322',
            }"
          />
        </a-skeleton>
      </a-card>
    </div>

    <!-- Optimization stats row -->
    <div class="stats-grid optimization-stats">
      <a-card
        class="stat-card"
        hoverable
      >
        <a-skeleton
          :loading="loading"
          active
          :paragraph="{ rows: 1 }"
        >
          <a-statistic
            title="压缩调用次数"
            :value="stats.compressedCalls"
            :prefix="h(CompressOutlined)"
            :value-style="{ color: '#1890ff' }"
          />
          <div class="stat-desc">
            节省约 30-40% Tokens
          </div>
        </a-skeleton>
      </a-card>

      <a-card
        class="stat-card"
        hoverable
      >
        <a-skeleton
          :loading="loading"
          active
          :paragraph="{ rows: 1 }"
        >
          <a-statistic
            title="平均响应时间"
            :value="stats.avgResponseTime"
            suffix="ms"
            :prefix="h(ClockCircleOutlined)"
            :value-style="{
              color: stats.avgResponseTime < 1000 ? '#3f8600' : '#cf1322',
            }"
          />
        </a-skeleton>
      </a-card>

      <a-card
        class="stat-card"
        hoverable
      >
        <a-skeleton
          :loading="loading"
          active
          :paragraph="{ rows: 1 }"
        >
          <a-statistic
            title="缓存节省成本"
            :value="cachedSavings"
            prefix="$"
            :precision="4"
            :value-style="{ color: '#52c41a' }"
          />
          <div class="stat-desc">
            预计节省
          </div>
        </a-skeleton>
      </a-card>
    </div>
  </div>
</template>

<script setup>
import { h, computed } from "vue";
import {
  ApiOutlined,
  ThunderboltOutlined,
  RocketOutlined,
  CompressOutlined,
  ClockCircleOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  stats: {
    type: Object,
    default: () => ({
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      totalCostCny: 0,
      cachedCalls: 0,
      compressedCalls: 0,
      cacheHitRate: 0,
      avgResponseTime: 0,
    }),
  },
  loading: {
    type: Boolean,
    default: false,
  },
  periodComparison: {
    type: Object,
    default: () => ({
      callsChange: 0,
      tokensChange: 0,
      costChange: 0,
    }),
  },
});

// Cached savings calculation
const cachedSavings = computed(() => {
  const avgCostPerCall =
    props.stats.totalCalls > 0
      ? props.stats.totalCostUsd / props.stats.totalCalls
      : 0;
  return props.stats.cachedCalls * avgCostPerCall;
});

// Format tokens (e.g., 1234567 -> 1.23M)
const formatTokens = (value) => {
  if (value >= 1000000) {
    return (value / 1000000).toFixed(2) + "M";
  } else if (value >= 1000) {
    return (value / 1000).toFixed(2) + "K";
  }
  return value.toString();
};
</script>

<style lang="less" scoped>
.stats-overview {
  .stats-grid {
    display: grid;
    gap: 16px;
    margin-bottom: 16px;

    &.main-stats {
      grid-template-columns: repeat(4, 1fr);
    }

    &.optimization-stats {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .stat-card {
    transition:
      transform 0.2s ease,
      box-shadow 0.2s ease;

    &:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    }

    // Animation on data change
    &.updating {
      animation: statPulse 0.3s ease;
    }
  }

  .stat-change {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 12px;
    font-weight: normal;
    margin-left: 8px;

    &.up {
      color: #52c41a;
    }

    &.down {
      color: #ff4d4f;
    }
  }

  .sub-value {
    font-size: 12px;
    color: #8c8c8c;
    margin-top: 4px;
  }

  .stat-desc {
    font-size: 12px;
    color: #8c8c8c;
    margin-top: 4px;
  }
}

@keyframes statPulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.02);
  }
  100% {
    transform: scale(1);
  }
}

// Mobile responsiveness
@media (max-width: 1199px) {
  .stats-overview {
    .stats-grid {
      &.main-stats {
        grid-template-columns: repeat(2, 1fr);
      }

      &.optimization-stats {
        grid-template-columns: repeat(2, 1fr);
      }
    }
  }
}

@media (max-width: 767px) {
  .stats-overview {
    .stats-grid {
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));

      &.main-stats,
      &.optimization-stats {
        grid-template-columns: repeat(2, 1fr);
      }
    }
  }
}

:deep(.ant-card) {
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  border-radius: 8px;
}

:deep(.ant-statistic-title) {
  font-size: 14px;
  color: #718096;
}

:deep(.ant-statistic-content) {
  font-size: 24px;
  font-weight: 600;
}
</style>
