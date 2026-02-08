<template>
  <div class="empty-state" data-testid="chat-empty-state">
    <div class="empty-icon">
      <RobotOutlined />
    </div>
    <h4>{{ emptyStateText }}</h4>
    <p class="empty-hint">
      {{ emptyHint }}
    </p>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { RobotOutlined } from "@ant-design/icons-vue";
import { getEmptyStateText, getEmptyHint } from "../../utils/chatHelpers";

const props = defineProps({
  contextMode: {
    type: String,
    default: "global",
  },
  currentFile: {
    type: Object,
    default: null,
  },
});

const emptyStateText = computed(() => getEmptyStateText(props.contextMode));
const emptyHint = computed(() =>
  getEmptyHint(props.contextMode, props.currentFile),
);
</script>

<style scoped>
/* 空状态 */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  color: #9ca3af;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-state h4 {
  font-size: 18px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 14px;
  color: #9ca3af;
  margin: 0;
}
</style>
