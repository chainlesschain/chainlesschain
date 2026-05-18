<template>
  <div
    :class="['skill-node', { 'skill-node--selected': selected }, statusClass]"
    :style="borderStyle"
  >
    <Handle
      type="target"
      :position="Position.Top"
    />
    <div class="skill-node__body">
      <a-avatar
        :size="28"
        :style="{ backgroundColor: statusColor, flexShrink: 0 }"
      >
        <template v-if="executionStatus === 'completed'">
          &#10003;
        </template>
        <template v-else-if="executionStatus === 'failed'">
          &#10007;
        </template>
        <template v-else>
          S
        </template>
      </a-avatar>
      <div class="skill-node__info">
        <div class="skill-node__label">
          {{ data.label || "Skill" }}
        </div>
        <div
          v-if="data.skillId"
          class="skill-node__id"
        >
          {{ data.skillId }}
        </div>
      </div>
    </div>
    <Handle
      type="source"
      :position="Position.Bottom"
    />
  </div>
</template>

<script setup>
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import { useWorkflowDesignerStore } from "../../stores/workflow-designer";

const props = defineProps({
  id: String,
  data: Object,
  selected: Boolean,
});

const store = useWorkflowDesignerStore();

const executionStatus = computed(() => {
  return store.nodeStatuses[props.id] || props.data?.status || null;
});

const statusColorMap = {
  completed: "#52c41a",
  running: "#1890ff",
  pending: "#d9d9d9",
  failed: "#ff4d4f",
};

const statusColor = computed(() => {
  return statusColorMap[executionStatus.value] || statusColorMap.pending;
});

const borderStyle = computed(() => ({
  borderLeftColor: statusColor.value,
}));

const statusClass = computed(() => {
  if (executionStatus.value === "running") {return "skill-node--running";}
  if (executionStatus.value === "completed") {return "skill-node--completed";}
  if (executionStatus.value === "failed") {return "skill-node--failed";}
  return "";
});
</script>

<style scoped>
.skill-node {
  min-width: 150px;
  padding: 8px 12px;
  background: #fff;
  border-radius: 8px;
  border-left: 4px solid #d9d9d9;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
  transition: box-shadow 0.2s, border-color 0.3s;
}

.skill-node--selected {
  box-shadow:
    0 0 0 2px #1890ff,
    0 1px 4px rgba(0, 0, 0, 0.1);
}

.skill-node--running {
  animation: pulse-border 1.5s ease-in-out infinite;
}

.skill-node--completed {
  border-left-color: #52c41a;
  box-shadow: 0 0 0 1px rgba(82, 196, 26, 0.3), 0 1px 4px rgba(0, 0, 0, 0.1);
}

.skill-node--failed {
  border-left-color: #ff4d4f;
  box-shadow: 0 0 0 1px rgba(255, 77, 79, 0.3), 0 1px 4px rgba(0, 0, 0, 0.1);
}

@keyframes pulse-border {
  0%, 100% {
    box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.3), 0 1px 4px rgba(0, 0, 0, 0.1);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(24, 144, 255, 0.15), 0 1px 8px rgba(24, 144, 255, 0.2);
  }
}

.skill-node__body {
  display: flex;
  align-items: center;
  gap: 8px;
}

.skill-node__info {
  overflow: hidden;
}

.skill-node__label {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-node__id {
  font-size: 11px;
  color: #999;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
