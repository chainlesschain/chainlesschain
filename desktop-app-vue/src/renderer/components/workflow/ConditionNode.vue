<template>
  <div class="condition-node" :class="{ selected }">
    <Handle type="target" :position="Position.Top" />
    <div class="diamond">
      <div class="diamond-content">
        <div class="label">
          {{ data.label }}
        </div>
        <div v-if="data.expression" class="expression">
          {{ data.expression }}
        </div>
      </div>
    </div>
    <Handle
      id="true"
      type="source"
      :position="Position.Bottom"
      :style="{ left: '25%' }"
    />
    <Handle
      id="false"
      type="source"
      :position="Position.Bottom"
      :style="{ left: '75%' }"
    />
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
.condition-node {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100px;
  height: 100px;
}
.diamond {
  width: 80px;
  height: 80px;
  transform: rotate(45deg);
  background: #fffbe6;
  border: 2px solid #faad14;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(250, 173, 20, 0.15);
  transition:
    box-shadow 0.2s,
    border-color 0.2s;
}
.selected .diamond {
  border-color: #d48806;
  box-shadow:
    0 0 0 2px rgba(250, 173, 20, 0.3),
    0 2px 8px rgba(250, 173, 20, 0.25);
}
.diamond-content {
  transform: rotate(-45deg);
  text-align: center;
  max-width: 60px;
  overflow: hidden;
}
.label {
  font-size: 11px;
  font-weight: 600;
  color: #874d00;
  line-height: 1.2;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
.expression {
  font-size: 9px;
  color: #ad8b00;
  margin-top: 2px;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
</style>
