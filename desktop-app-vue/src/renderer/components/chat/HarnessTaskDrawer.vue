<template>
  <a-drawer
    v-model:open="openModel"
    title="Background Task Details"
    width="520"
  >
    <div v-if="selectedTask" class="harness-task-drawer">
      <div class="approval-step-main">
        <div class="approval-panel-label">Selected task</div>
        <a-tag>
          {{ selectedTask.status || "unknown" }}
        </a-tag>
      </div>
      <div class="harness-task-detail-title">
        {{ selectedTask.title || selectedTask.name || selectedTask.id }}
      </div>
      <div class="harness-task-meta">
        <span>Task ID: {{ selectedTask.id }}</span>
        <span v-if="selectedTask.type">Type: {{ selectedTask.type }}</span>
      </div>
      <div
        v-if="selectedTask.summary || selectedTask.description"
        class="approval-step-description"
      >
        {{ selectedTask.summary || selectedTask.description }}
      </div>
      <div v-if="selectedTaskHistoryItems.length > 0" class="harness-history">
        <div class="approval-panel-label">History</div>
        <ul class="harness-history-list">
          <li
            v-for="(item, index) in selectedTaskHistoryItems"
            :key="item.id || `${selectedTask.id}-history-${index}`"
            class="harness-history-item"
          >
            <span class="harness-history-event">
              {{ item.event || item.type || "event" }}
            </span>
            <span v-if="item.timestamp" class="harness-history-time">
              {{ item.timestamp }}
            </span>
            <span
              v-if="item.message || item.summary"
              class="harness-history-message"
            >
              {{ item.message || item.summary }}
            </span>
          </li>
        </ul>
        <div class="harness-task-actions">
          <a-button
            v-if="selectedTaskHistoryHasMore"
            size="small"
            @click="emit('load-more-history')"
          >
            Load More History
          </a-button>
        </div>
      </div>
      <a-empty
        v-else
        description="No history entries available for this task yet."
      />
      <div class="harness-task-actions">
        <a-button
          size="small"
          :disabled="!selectedTaskHasPrevious"
          @click="emit('navigate', -1)"
        >
          Previous Task
        </a-button>
        <a-button
          size="small"
          :disabled="!selectedTaskHasNext"
          @click="emit('navigate', 1)"
        >
          Next Task
        </a-button>
        <a-button size="small" @click="openModel = false"> Close </a-button>
        <a-button size="small" @click="emit('clear-selection')">
          Clear Selection
        </a-button>
      </div>
    </div>
    <a-empty
      v-else
      description="Select a background task to inspect its details."
    />
  </a-drawer>
</template>

<script setup>
const openModel = defineModel("open", { type: Boolean, default: false });

defineProps({
  selectedTask: {
    type: Object,
    default: null,
  },
  selectedTaskHistoryItems: {
    type: Array,
    default: () => [],
  },
  selectedTaskHistoryHasMore: {
    type: Boolean,
    default: false,
  },
  selectedTaskHasPrevious: {
    type: Boolean,
    default: false,
  },
  selectedTaskHasNext: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["load-more-history", "navigate", "clear-selection"]);
</script>

<style scoped lang="scss">
.harness-task-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.harness-task-drawer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.harness-task-detail-title {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 6px;
}

.harness-task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #475569;
}

.harness-history {
  margin-top: 10px;
}

.harness-history-list {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.harness-history-item {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(191, 219, 254, 0.6);
  font-size: 12px;
  color: #334155;
}

.harness-history-event {
  font-weight: 700;
  color: #1d4ed8;
}

.harness-history-time {
  color: #64748b;
}

.harness-history-message {
  flex: 1 1 100%;
}

.approval-panel-label {
  font-size: 12px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.approval-step-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.approval-step-description {
  margin-top: 6px;
  color: #6b7280;
  line-height: 1.6;
}
</style>
