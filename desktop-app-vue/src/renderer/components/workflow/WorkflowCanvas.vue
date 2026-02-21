<template>
  <div class="workflow-canvas" @drop="onDrop" @dragover.prevent>
    <VueFlow
      :nodes="nodes"
      :edges="edges"
      :node-types="nodeTypes"
      :default-viewport="{ zoom: 1 }"
      fit-view-on-init
      @node-click="onNodeClick"
      @node-drag-stop="onNodeDragStop"
      @connect="onConnect"
    >
      <Background pattern-color="#aaa" :gap="16" />
      <Controls />
      <MiniMap />
    </VueFlow>
  </div>
</template>

<script setup>
import { markRaw } from "vue";
import { VueFlow, useVueFlow } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";

import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

import SkillNode from "./SkillNode.vue";
import ConditionNode from "./ConditionNode.vue";
import ParallelNode from "./ParallelNode.vue";
import TransformNode from "./TransformNode.vue";

const props = defineProps({
  nodes: {
    type: Array,
    default: () => [],
  },
  edges: {
    type: Array,
    default: () => [],
  },
  selectedNode: {
    type: String,
    default: null,
  },
});

const emit = defineEmits([
  "node-click",
  "node-drag-stop",
  "connect",
  "drop",
  "node-remove",
  "update:selectedNode",
]);

const nodeTypes = {
  skill: markRaw(SkillNode),
  condition: markRaw(ConditionNode),
  parallel: markRaw(ParallelNode),
  transform: markRaw(TransformNode),
  loop: markRaw(TransformNode),
};

const { project } = useVueFlow();

const onNodeClick = (event) => {
  const node = event.node || event;
  emit("node-click", { node });
  emit("update:selectedNode", node.id);
};

const onNodeDragStop = (event) => {
  const node = event.node || event;
  emit("node-drag-stop", { node });
};

const onConnect = (params) => {
  emit("connect", params);
};

const onDrop = (event) => {
  event.preventDefault();

  let type = event.dataTransfer?.getData("application/vueflow-type");
  let parsedData = {};

  if (type) {
    const data = event.dataTransfer?.getData("application/vueflow-data");
    try {
      parsedData = data ? JSON.parse(data) : {};
    } catch {
      // ignore
    }
  } else {
    // Fallback: read from application/json (SkillPalette format)
    const jsonStr = event.dataTransfer?.getData("application/json");
    if (jsonStr) {
      try {
        const obj = JSON.parse(jsonStr);
        type = obj.type;
        parsedData = obj;
      } catch {
        // ignore
      }
    }
  }

  if (!type) {
    return;
  }

  const { left, top } = event.currentTarget.getBoundingClientRect();
  const position = project({
    x: event.clientX - left,
    y: event.clientY - top,
  });

  emit("drop", {
    type,
    position,
    data: parsedData,
  });
};
</script>

<style scoped>
.workflow-canvas {
  width: 100%;
  height: 100%;
  background: #fff;
}
</style>
