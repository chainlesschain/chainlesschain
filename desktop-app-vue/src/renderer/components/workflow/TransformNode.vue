<template>
  <div class="transform-node" :class="[{ selected }, statusClass]">
    <Handle type="target" :position="Position.Top" />
    <div class="node-body">
      <div class="label">
        {{ data.label }}
      </div>
      <div v-if="data.expression" class="expression">
        {{ data.expression }}
      </div>
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<script setup>
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import { useWorkflowDesignerStore } from "../../stores/workflow-designer";

const props = defineProps({
  id: String,
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});

const store = useWorkflowDesignerStore();

const executionStatus = computed(() => {
  return store.nodeStatuses[props.id] || null;
});

const statusClass = computed(() => {
  if (executionStatus.value === "running") return "transform-node--running";
  if (executionStatus.value === "completed") return "transform-node--completed";
  if (executionStatus.value === "failed") return "transform-node--failed";
  return "";
});
</script>

<style scoped>
.transform-node {
  min-width: 140px;
}
.node-body {
  padding: 10px 16px;
  background: #e6fffb;
  border: 2px solid #13c2c2;
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(19, 194, 194, 0.12);
  transition:
    box-shadow 0.2s,
    border-color 0.2s;
}
.selected .node-body {
  border-color: #006d75;
  box-shadow:
    0 0 0 2px rgba(19, 194, 194, 0.25),
    0 2px 8px rgba(19, 194, 194, 0.2);
}

.transform-node--running .node-body {
  animation: pulse-transform 1.5s ease-in-out infinite;
}
.transform-node--completed .node-body {
  border-color: #52c41a;
  background: #f6ffed;
}
.transform-node--failed .node-body {
  border-color: #ff4d4f;
  background: #fff2f0;
}

@keyframes pulse-transform {
  0%, 100% {
    box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.3), 0 2px 6px rgba(19, 194, 194, 0.12);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(24, 144, 255, 0.15), 0 2px 8px rgba(24, 144, 255, 0.2);
  }
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: #006d75;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
.expression {
  font-size: 11px;
  color: #08979c;
  margin-top: 4px;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
</style>
