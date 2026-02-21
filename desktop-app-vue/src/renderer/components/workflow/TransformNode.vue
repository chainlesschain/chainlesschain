<template>
  <div class="transform-node" :class="{ selected }">
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
import { Handle, Position } from "@vue-flow/core";

defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
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
