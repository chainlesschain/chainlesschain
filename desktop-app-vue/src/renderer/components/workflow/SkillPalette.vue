<template>
  <div class="skill-palette">
    <div class="palette-header">
      <h3>节点面板</h3>
    </div>
    <div class="palette-list">
      <div
        v-for="item in nodeList"
        :key="item.type"
        class="palette-item"
        :style="{ borderLeftColor: colorMap[item.type] || '#d9d9d9' }"
        draggable="true"
        @dragstart="onDragStart($event, item)"
      >
        <div class="palette-item__label">
          {{ item.label }}
        </div>
        <div v-if="item.description" class="palette-item__desc">
          {{ item.description }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  skills: { type: Array, default: () => [] },
});

const defaultNodes = [
  {
    type: "skill",
    label: "技能节点",
    description: "执行一个技能",
    category: "basic",
  },
  {
    type: "condition",
    label: "条件节点",
    description: "条件分支判断",
    category: "control",
  },
  {
    type: "parallel",
    label: "并行节点",
    description: "并行执行多个分支",
    category: "control",
  },
  {
    type: "transform",
    label: "转换节点",
    description: "数据转换处理",
    category: "data",
  },
  {
    type: "loop",
    label: "循环节点",
    description: "循环执行子流程",
    category: "control",
  },
];

const colorMap = {
  skill: "#1890ff",
  condition: "#fa8c16",
  parallel: "#722ed1",
  transform: "#13c2c2",
  loop: "#52c41a",
};

const nodeList = computed(() => {
  return props.skills && props.skills.length > 0 ? props.skills : defaultNodes;
});

const onDragStart = (event, item) => {
  event.dataTransfer.setData("application/json", JSON.stringify(item));
  event.dataTransfer.effectAllowed = "copy";
};
</script>

<style scoped>
.skill-palette {
  padding: 12px;
  height: 100%;
  overflow-y: auto;
}

.palette-header {
  margin-bottom: 12px;
}

.palette-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #262626;
}

.palette-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.palette-item {
  padding: 8px 10px;
  margin: 4px 0;
  background: #fafafa;
  border-radius: 6px;
  border-left: 4px solid #d9d9d9;
  cursor: grab;
  transition:
    background 0.2s,
    box-shadow 0.2s;
  user-select: none;
}

.palette-item:hover {
  background: #f0f0f0;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.palette-item:active {
  cursor: grabbing;
}

.palette-item__label {
  font-size: 13px;
  font-weight: 500;
  color: #262626;
}

.palette-item__desc {
  font-size: 11px;
  color: #8c8c8c;
  margin-top: 2px;
}
</style>
