<template>
  <div class="parallel-node" :class="{ selected }">
    <Handle type="target" :position="Position.Top" />
    <div class="node-body">
      <span class="parallel-icon">||</span>
      <span class="label">{{ data.label }}</span>
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<script setup>
import { Handle, Position } from "@vue-flow/core";

defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});
</script>

<style scoped>
.parallel-node {
  min-width: 160px;
}
.node-body {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: #f9f0ff;
  border: 2px dashed #722ed1;
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(114, 46, 209, 0.12);
  transition:
    box-shadow 0.2s,
    border-color 0.2s;
}
.selected .node-body {
  border-color: #531dab;
  border-style: solid;
  box-shadow:
    0 0 0 2px rgba(114, 46, 209, 0.25),
    0 2px 8px rgba(114, 46, 209, 0.2);
}
.parallel-icon {
  font-size: 16px;
  font-weight: 700;
  color: #722ed1;
  letter-spacing: -2px;
  flex-shrink: 0;
}
.label {
  font-size: 13px;
  font-weight: 600;
  color: #391085;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
</style>
