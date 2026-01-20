<template>
  <a-card title="预算使用情况" class="budget-panel">
    <template #extra>
      <a-tag :color="statusColor"> <FundOutlined /> {{ statusText }} </a-tag>
    </template>
    <a-skeleton :loading="loading" active>
      <!-- Daily budget -->
      <div class="budget-item">
        <div class="budget-label">
          <span>日预算</span>
          <span class="budget-value">
            ${{ safeToFixed(budget.dailySpend, 4) }} / ${{
              budget.dailyLimit > 0 ? safeToFixed(budget.dailyLimit, 2) : "∞"
            }}
          </span>
        </div>
        <a-progress
          :percent="dailyPercent"
          :status="getBudgetStatus(dailyPercent)"
          :stroke-color="getBudgetColor(dailyPercent)"
          size="small"
        />
      </div>

      <!-- Weekly budget -->
      <div class="budget-item">
        <div class="budget-label">
          <span>周预算</span>
          <span class="budget-value">
            ${{ safeToFixed(budget.weeklySpend, 4) }} / ${{
              budget.weeklyLimit > 0 ? safeToFixed(budget.weeklyLimit, 2) : "∞"
            }}
          </span>
        </div>
        <a-progress
          :percent="weeklyPercent"
          :status="getBudgetStatus(weeklyPercent)"
          :stroke-color="getBudgetColor(weeklyPercent)"
          size="small"
        />
      </div>

      <!-- Monthly budget -->
      <div class="budget-item">
        <div class="budget-label">
          <span>月预算</span>
          <span class="budget-value">
            ${{ safeToFixed(budget.monthlySpend, 4) }} / ${{
              budget.monthlyLimit > 0
                ? safeToFixed(budget.monthlyLimit, 2)
                : "∞"
            }}
          </span>
        </div>
        <a-progress
          :percent="monthlyPercent"
          :status="getBudgetStatus(monthlyPercent)"
          :stroke-color="getBudgetColor(monthlyPercent)"
          size="small"
        />
      </div>

      <a-divider style="margin: 16px 0" />
      <div class="budget-info">
        <a-space>
          <WarningOutlined
            v-if="maxPercent >= budget.warningThreshold"
            style="color: #faad14"
          />
          <span>告警阈值: {{ budget.warningThreshold }}%</span>
          <a-divider type="vertical" />
          <span>危险阈值: {{ budget.criticalThreshold }}%</span>
        </a-space>
      </div>
    </a-skeleton>
  </a-card>
</template>

<script setup>
import { computed } from "vue";
import { FundOutlined, WarningOutlined } from "@ant-design/icons-vue";

/**
 * 安全格式化数值，防止 undefined/null 导致的 toFixed 错误
 */
function safeToFixed(value, decimals = 2) {
  const num = Number(value);
  if (value == null || isNaN(num)) {
    return "0.00";
  }
  return num.toFixed(decimals);
}

const props = defineProps({
  budget: {
    type: Object,
    default: () => ({
      dailyLimit: 0,
      weeklyLimit: 0,
      monthlyLimit: 0,
      dailySpend: 0,
      weeklySpend: 0,
      monthlySpend: 0,
      warningThreshold: 80,
      criticalThreshold: 95,
    }),
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const dailyPercent = computed(() => {
  if (props.budget.dailyLimit <= 0) {
    return 0;
  }
  return Math.min(
    100,
    (props.budget.dailySpend / props.budget.dailyLimit) * 100,
  );
});

const weeklyPercent = computed(() => {
  if (props.budget.weeklyLimit <= 0) {
    return 0;
  }
  return Math.min(
    100,
    (props.budget.weeklySpend / props.budget.weeklyLimit) * 100,
  );
});

const monthlyPercent = computed(() => {
  if (props.budget.monthlyLimit <= 0) {
    return 0;
  }
  return Math.min(
    100,
    (props.budget.monthlySpend / props.budget.monthlyLimit) * 100,
  );
});

const maxPercent = computed(() => {
  return Math.max(
    dailyPercent.value,
    weeklyPercent.value,
    monthlyPercent.value,
  );
});

const statusColor = computed(() => {
  if (maxPercent.value >= props.budget.criticalThreshold) {
    return "red";
  }
  if (maxPercent.value >= props.budget.warningThreshold) {
    return "orange";
  }
  return "green";
});

const statusText = computed(() => {
  if (maxPercent.value >= props.budget.criticalThreshold) {
    return "超出预算";
  }
  if (maxPercent.value >= props.budget.warningThreshold) {
    return "接近预算";
  }
  return "预算正常";
});

const getBudgetStatus = (percent) => {
  if (percent >= 100) {
    return "exception";
  }
  if (percent >= props.budget.warningThreshold) {
    return "active";
  }
  return "normal";
};

const getBudgetColor = (percent) => {
  if (percent >= props.budget.criticalThreshold) {
    return "#cf1322";
  }
  if (percent >= props.budget.warningThreshold) {
    return "#faad14";
  }
  return "#52c41a";
};
</script>

<style lang="less" scoped>
.budget-panel {
  height: 100%;

  .budget-item {
    margin-bottom: 16px;

    &:last-of-type {
      margin-bottom: 0;
    }

    .budget-label {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
      font-size: 14px;
      color: #595959;

      .budget-value {
        font-weight: 500;
        color: #262626;
      }
    }
  }

  .budget-info {
    font-size: 13px;
    color: #8c8c8c;
  }
}
</style>
