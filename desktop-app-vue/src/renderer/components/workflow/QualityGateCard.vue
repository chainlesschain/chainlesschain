<template>
  <a-card
    class="quality-gate-card"
    :class="cardClass"
    size="small"
  >
    <template #title>
      <div class="gate-title">
        <span class="gate-icon">{{ gateIcon }}</span>
        <span class="gate-name">{{ gate.name }}</span>
      </div>
    </template>

    <template #extra>
      <a-tag
        :color="statusColor"
        size="small"
      >
        {{ statusText }}
      </a-tag>
    </template>

    <div class="gate-content">
      <!-- 检查项列表 -->
      <div class="checks-list">
        <div
          v-for="check in displayChecks"
          :key="check"
          class="check-item"
        >
          <span class="check-status">
            {{ getCheckStatusIcon(check) }}
          </span>
          <span class="check-name">{{ getCheckDisplayName(check) }}</span>
        </div>
      </div>

      <!-- 阈值与得分 -->
      <div class="gate-metrics">
        <a-progress
          type="circle"
          :percent="scorePercent"
          :width="60"
          :stroke-color="progressColor"
        >
          <template #format>
            <span class="score-text">{{ displayScore }}</span>
          </template>
        </a-progress>
        <div class="threshold-info">
          <span class="threshold-label">阈值</span>
          <span class="threshold-value">{{ (gate.threshold || 0.8) * 100 }}%</span>
        </div>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div
      v-if="showOverride"
      class="gate-actions"
    >
      <a-popconfirm
        title="确定要跳过此门禁吗？"
        description="跳过门禁可能影响最终输出质量"
        ok-text="确定跳过"
        cancel-text="取消"
        @confirm="handleOverride"
      >
        <a-button
          size="small"
          type="text"
          danger
        >
          跳过门禁
        </a-button>
      </a-popconfirm>
    </div>
  </a-card>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  gate: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["override"]);

// 检查项显示名称映射
const CHECK_NAMES = {
  intent_clarity: "意图清晰度",
  context_completeness: "上下文完整性",
  rag_relevance: "RAG相关性",
  task_feasibility: "任务可行性",
  resource_availability: "资源可用性",
  dependency_valid: "依赖有效性",
  content_completeness: "内容完整性",
  format_valid: "格式有效性",
  no_hallucination: "无幻觉",
  llm_quality_score: "LLM质量评分",
  consistency_check: "一致性检查",
  reference_valid: "引用有效性",
  format_correct: "格式正确性",
  size_optimal: "大小优化",
  metadata_complete: "元数据完整性",
  preview_ready: "预览就绪",
  export_valid: "导出有效性",
  user_confirmed: "用户确认",
};

// 计算属性
const cardClass = computed(() => ({
  "status-passed": props.gate.status === "passed",
  "status-failed": props.gate.status === "failed",
  "status-checking": props.gate.status === "checking",
  "status-pending": props.gate.status === "pending",
  "status-skipped": props.gate.status === "skipped",
}));

const gateIcon = computed(() => {
  const iconMap = {
    passed: "✅",
    failed: "❌",
    checking: "🔄",
    pending: "⏳",
    skipped: "⏭️",
  };
  return iconMap[props.gate.status] || "📋";
});

const statusColor = computed(() => {
  const colorMap = {
    passed: "success",
    failed: "error",
    checking: "processing",
    pending: "default",
    skipped: "warning",
  };
  return colorMap[props.gate.status] || "default";
});

const statusText = computed(() => {
  const textMap = {
    passed: "已通过",
    failed: "未通过",
    checking: "检查中",
    pending: "等待中",
    skipped: "已跳过",
  };
  return textMap[props.gate.status] || "未知";
});

const scorePercent = computed(() => {
  const score = props.gate.score;
  if (score === null || score === undefined) {
    return 0;
  }
  return Math.round(score * 100);
});

const displayScore = computed(() => {
  const score = props.gate.score;
  if (score === null || score === undefined) {
    return "-";
  }
  return (score * 100).toFixed(0);
});

const progressColor = computed(() => {
  const score = props.gate.score || 0;
  if (score >= 0.8) {
    return "#52c41a";
  }
  if (score >= 0.6) {
    return "#faad14";
  }
  return "#ff4d4f";
});

const displayChecks = computed(() => {
  // 从gate配置中获取检查项，或从id推断
  if (props.gate.checks && Array.isArray(props.gate.checks)) {
    return props.gate.checks.map((c) => c.checkId || c);
  }
  return [];
});

const showOverride = computed(() => {
  // 只有失败的非阻塞门禁可以跳过
  return props.gate.status === "failed" && !props.gate.blocking;
});

// 方法
const getCheckStatusIcon = (checkId) => {
  // 如果有检查结果，从中获取状态
  const check = props.gate.checks?.find(
    (c) => c.checkId === checkId || c === checkId,
  );
  if (check && typeof check === "object") {
    return check.passed ? "✅" : "❌";
  }
  // 默认状态
  if (props.gate.status === "passed") {
    return "✅";
  }
  if (props.gate.status === "failed") {
    return "❌";
  }
  return "⏳";
};

const getCheckDisplayName = (checkId) => {
  return CHECK_NAMES[checkId] || checkId;
};

const handleOverride = () => {
  emit("override", props.gate.id);
};
</script>

<style scoped lang="scss">
.quality-gate-card {
  border-radius: 8px;
  transition: all 0.3s;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  &.status-passed {
    border-color: #b7eb8f;
    background: linear-gradient(180deg, #f6ffed 0%, #fff 100%);
  }

  &.status-failed {
    border-color: #ffccc7;
    background: linear-gradient(180deg, #fff2f0 0%, #fff 100%);
  }

  &.status-checking {
    border-color: #91d5ff;
    background: linear-gradient(180deg, #e6f7ff 0%, #fff 100%);
  }

  &.status-skipped {
    border-color: #ffe58f;
    background: linear-gradient(180deg, #fffbe6 0%, #fff 100%);
  }
}

.gate-title {
  display: flex;
  align-items: center;
  gap: 8px;

  .gate-icon {
    font-size: 16px;
  }

  .gate-name {
    font-size: 14px;
    font-weight: 600;
    color: #262626;
  }
}

.gate-content {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.checks-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.check-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;

  .check-status {
    font-size: 12px;
  }

  .check-name {
    color: #595959;
  }
}

.gate-metrics {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;

  .score-text {
    font-size: 14px;
    font-weight: 600;
  }

  .threshold-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    font-size: 11px;

    .threshold-label {
      color: #8c8c8c;
    }

    .threshold-value {
      font-weight: 600;
      color: #595959;
    }
  }
}

.gate-actions {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
  text-align: right;
}
</style>
