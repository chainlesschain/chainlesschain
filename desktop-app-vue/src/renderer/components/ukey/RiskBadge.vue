<template>
  <a-tooltip
    :title="tooltipText"
    placement="top"
  >
    <a-tag
      :color="tagColor"
      class="risk-badge"
      :class="`risk-${level}`"
    >
      <span class="risk-icon">{{ riskIcon }}</span>
      <span class="risk-label">{{ riskLabel }}</span>
      <span
        v-if="showScore"
        class="risk-score"
      >({{ score }})</span>
    </a-tag>
  </a-tooltip>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps({
  level: {
    type: String,
    default: "low",
    validator: (v) => ["low", "medium", "high", "critical"].includes(v),
  },
  score: { type: Number, default: null },
  showScore: { type: Boolean, default: false },
  reasons: { type: Array, default: () => [] },
});

const tagColor = computed(
  () =>
    ({
      low: "green",
      medium: "orange",
      high: "red",
      critical: "#7B00D4",
    })[props.level] || "default",
);

const riskIcon = computed(
  () =>
    ({
      low: "✅",
      medium: "⚠️",
      high: "🔴",
      critical: "💀",
    })[props.level] || "❓",
);

const riskLabel = computed(
  () =>
    ({
      low: t("ukey.risk.low"),
      medium: t("ukey.risk.medium"),
      high: t("ukey.risk.high"),
      critical: t("ukey.risk.critical"),
    })[props.level] || props.level,
);

const tooltipText = computed(() => {
  const base =
    {
      low: t("ukey.risk.lowDesc"),
      medium: t("ukey.risk.mediumDesc"),
      high: t("ukey.risk.highDesc"),
      critical: t("ukey.risk.criticalDesc"),
    }[props.level] || "";

  if (props.reasons?.length > 0) {
    return `${base}\n• ${props.reasons.join("\n• ")}`;
  }
  return base;
});
</script>

<style scoped>
.risk-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  cursor: help;
}
.risk-critical {
  animation: critical-pulse 2s ease-in-out infinite;
}
@keyframes critical-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
.risk-score {
  font-size: 11px;
  opacity: 0.8;
}
</style>
