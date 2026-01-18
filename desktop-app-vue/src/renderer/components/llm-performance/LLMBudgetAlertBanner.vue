<template>
  <transition name="slide-fade">
    <div
      v-if="visible"
      :class="['budget-alert-banner', alertLevel]"
      role="alert"
      :aria-live="alertLevel === 'critical' ? 'assertive' : 'polite'"
    >
      <div class="alert-content">
        <component :is="alertIcon" class="alert-icon" />
        <div class="alert-text">
          <strong>{{ alertTitle }}</strong>
          <span>{{ alertMessage }}</span>
        </div>
      </div>
      <div class="alert-actions">
        <a-button size="small" ghost @click="$emit('settings')">
          调整预算
        </a-button>
        <a-button
          size="small"
          type="text"
          @click="$emit('dismiss')"
          aria-label="关闭告警"
        >
          <CloseOutlined />
        </a-button>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed, markRaw } from "vue";
import {
  CloseOutlined,
  ExclamationCircleOutlined,
  AlertOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  budgetPercent: {
    type: Number,
    default: 0,
  },
  warningThreshold: {
    type: Number,
    default: 80,
  },
  criticalThreshold: {
    type: Number,
    default: 95,
  },
});

defineEmits(["dismiss", "settings"]);

const alertLevel = computed(() => {
  if (props.budgetPercent >= props.criticalThreshold) return "critical";
  if (props.budgetPercent >= props.warningThreshold) return "warning";
  return "";
});

const alertIcon = computed(() => {
  if (props.budgetPercent >= props.criticalThreshold) {
    return markRaw(ExclamationCircleOutlined);
  }
  return markRaw(AlertOutlined);
});

const alertTitle = computed(() => {
  if (props.budgetPercent >= props.criticalThreshold) {
    return "预算超出警告！";
  }
  return "预算接近阈值";
});

const alertMessage = computed(() => {
  if (props.budgetPercent >= 100) {
    return `当前使用已超出预算限制 (${props.budgetPercent.toFixed(1)}%)，建议立即调整或暂停服务。`;
  }
  return `当前使用已达到预算的 ${props.budgetPercent.toFixed(1)}%，请注意控制使用量。`;
});
</script>

<style lang="less" scoped>
.budget-alert-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-radius: 8px;
  margin-bottom: 16px;
  animation: pulse 2s infinite;

  &.warning {
    background: linear-gradient(90deg, #fff7e6 0%, #ffe7ba 100%);
    border: 1px solid #ffc069;

    .alert-icon {
      color: #faad14;
    }
  }

  &.critical {
    background: linear-gradient(90deg, #fff1f0 0%, #ffccc7 100%);
    border: 1px solid #ff7875;

    .alert-icon {
      color: #ff4d4f;
    }
  }

  .alert-content {
    display: flex;
    align-items: center;
    gap: 12px;

    .alert-icon {
      font-size: 24px;
    }

    .alert-text {
      display: flex;
      flex-direction: column;
      gap: 2px;

      strong {
        font-size: 14px;
        color: #262626;
      }

      span {
        font-size: 13px;
        color: #595959;
      }
    }
  }

  .alert-actions {
    display: flex;
    gap: 8px;
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.9;
  }
}

// Slide fade transition
.slide-fade-enter-active {
  transition: all 0.3s ease-out;
}

.slide-fade-leave-active {
  transition: all 0.2s ease-in;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(-20px);
  opacity: 0;
}

// Mobile responsiveness
@media (max-width: 768px) {
  .budget-alert-banner {
    flex-direction: column;
    gap: 12px;
    text-align: center;

    .alert-content {
      flex-direction: column;
    }
  }
}
</style>
