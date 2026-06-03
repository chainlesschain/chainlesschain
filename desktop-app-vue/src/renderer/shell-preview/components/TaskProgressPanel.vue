<template>
  <section v-if="steps.length > 0" class="cb-tasks" data-testid="task-panel">
    <div class="cb-tasks__header">
      <div class="cb-tasks__title">
        Tasks {{ doneCount }}/{{ steps.length }}
      </div>
      <div class="cb-tasks__progress">
        <span
          class="cb-tasks__progress-bar"
          :style="{ width: `${percent}%` }"
        />
      </div>
    </div>
    <div class="cb-tasks__items">
      <div
        v-for="step in steps"
        :key="step.id"
        class="cb-task"
        :class="`cb-task--${step.status}`"
        :data-testid="`task-item-${step.id}`"
      >
        <span class="cb-task__dot" />
        <div class="cb-task__copy">
          <div class="cb-task__label">
            {{ step.label }}
          </div>
          <div v-if="step.detail" class="cb-task__detail">
            {{ step.detail }}
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PreviewTaskStep } from "../../stores/conversation-preview";

const props = defineProps<{ steps: PreviewTaskStep[] }>();

const doneCount = computed(
  () => props.steps.filter((step) => step.status === "done").length,
);

const percent = computed(() =>
  props.steps.length === 0
    ? 0
    : Math.round((doneCount.value / props.steps.length) * 100),
);
</script>

<style scoped>
.cb-tasks {
  max-width: 860px;
  margin-top: 24px;
  border-top: 1px solid var(--cc-preview-border-subtle);
  padding-top: 16px;
}

.cb-tasks__header {
  display: flex;
  align-items: center;
  gap: 14px;
}

.cb-tasks__title {
  font-size: 14px;
  font-weight: 600;
}

.cb-tasks__progress {
  width: 96px;
  height: 8px;
  border-radius: 999px;
  background: var(--cc-preview-progress-track);
  overflow: hidden;
}

.cb-tasks__progress-bar {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--cc-preview-progress-fill);
}

.cb-tasks__items {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cb-task {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  color: var(--cc-preview-text-secondary);
}

.cb-task__dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  margin-top: 4px;
  border: 1.5px solid var(--cc-preview-border-strong);
  background: transparent;
  flex-shrink: 0;
}

.cb-task--done .cb-task__dot {
  background: var(--cc-preview-status-done);
  border-color: var(--cc-preview-status-done);
}

.cb-task--running .cb-task__dot {
  background: transparent;
  border-color: var(--cc-preview-status-running);
  box-shadow: 0 0 0 3px var(--cc-preview-status-running-ring);
}

.cb-task__label {
  color: var(--cc-preview-text-primary);
  font-size: 15px;
  line-height: 1.45;
}

.cb-task--done .cb-task__label {
  text-decoration: line-through;
  color: var(--cc-preview-text-secondary);
}

.cb-task__detail {
  margin-top: 3px;
  font-size: 13px;
}
</style>
