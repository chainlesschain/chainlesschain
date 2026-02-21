<template>
  <div
    :class="['skill-node', { 'skill-node--selected': selected }]"
    :style="borderStyle"
  >
    <Handle type="target" :position="Position.Top" />
    <div class="skill-node__body">
      <a-avatar
        :size="28"
        :style="{ backgroundColor: statusColor, flexShrink: 0 }"
      >
        S
      </a-avatar>
      <div class="skill-node__info">
        <div class="skill-node__label">
          {{ data.label || "Skill" }}
        </div>
        <div v-if="data.skillId" class="skill-node__id">
          {{ data.skillId }}
        </div>
      </div>
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<script setup>
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";

const props = defineProps({
  data: Object,
  selected: Boolean,
});

const statusColorMap = {
  completed: "#52c41a",
  running: "#1890ff",
  pending: "#d9d9d9",
  failed: "#ff4d4f",
};

const statusColor = computed(() => {
  return statusColorMap[props.data?.status] || statusColorMap.pending;
});

const borderStyle = computed(() => ({
  borderLeftColor: statusColor.value,
}));
</script>

<style scoped>
.skill-node {
  min-width: 150px;
  padding: 8px 12px;
  background: #fff;
  border-radius: 8px;
  border-left: 4px solid #d9d9d9;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
  transition: box-shadow 0.2s;
}

.skill-node--selected {
  box-shadow:
    0 0 0 2px #1890ff,
    0 1px 4px rgba(0, 0, 0, 0.1);
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
