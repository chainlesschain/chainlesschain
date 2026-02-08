<template>
  <div class="workflow-canvas" @dragover.prevent @drop="handleDrop">
    <!-- Start Node -->
    <div class="start-node">
      <div class="node-icon start">
        <PlayCircleOutlined />
      </div>
      <span>Start</span>
    </div>

    <!-- Connection Line -->
    <div v-if="steps.length > 0" class="connection-line" />

    <!-- Steps -->
    <draggable
      v-model="localSteps"
      item-key="id"
      class="steps-container"
      handle=".drag-handle"
      ghost-class="ghost"
      @change="handleReorder"
    >
      <template #item="{ element, index }">
        <div class="step-wrapper">
          <step-node
            :step="element"
            :index="index"
            :selected="selectedStep?.id === element.id"
            :status="getStepStatus(index)"
            @click="$emit('select-step', element)"
            @delete="$emit('delete-step', element.id)"
          />
          <div v-if="index < steps.length - 1" class="connection-line" />
        </div>
      </template>
    </draggable>

    <!-- End Node -->
    <div v-if="steps.length > 0" class="end-node">
      <div class="connection-line" />
      <div class="node-icon end">
        <CheckCircleOutlined />
      </div>
      <span>End</span>
    </div>

    <!-- Empty State -->
    <div v-if="steps.length === 0" class="empty-state">
      <InboxOutlined />
      <p>Drag steps here or click to add</p>
    </div>

    <!-- Execution Progress Overlay -->
    <div v-if="isExecuting" class="execution-overlay">
      <a-progress
        type="circle"
        :percent="executionProgress"
        :status="executionProgressStatus"
      />
      <p>{{ executionMessage }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import draggable from "vuedraggable";
import {
  PlayCircleOutlined,
  CheckCircleOutlined,
  InboxOutlined,
} from "@ant-design/icons-vue";
import StepNode from "./StepNode.vue";

const props = defineProps({
  steps: {
    type: Array,
    default: () => [],
  },
  selectedStep: {
    type: Object,
    default: null,
  },
  executionStatus: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(["select-step", "reorder-steps", "delete-step"]);

const localSteps = ref([...props.steps]);

watch(
  () => props.steps,
  (newSteps) => {
    localSteps.value = [...newSteps];
  },
  { deep: true },
);

const isExecuting = computed(() => {
  return props.executionStatus?.status === "running";
});

const executionProgress = computed(() => {
  if (!props.executionStatus) {
    return 0;
  }
  const current = props.executionStatus.currentStep || 0;
  const total = props.steps.length || 1;
  return Math.round((current / total) * 100);
});

const executionProgressStatus = computed(() => {
  const status = props.executionStatus?.status;
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "exception";
  }
  return "active";
});

const executionMessage = computed(() => {
  if (!props.executionStatus) {
    return "";
  }
  const current = props.executionStatus.currentStep || 0;
  const total = props.steps.length;
  return `Executing step ${current + 1} of ${total}`;
});

const getStepStatus = (index) => {
  if (!props.executionStatus) {
    return "pending";
  }
  const results = props.executionStatus.results || [];
  const currentStep = props.executionStatus.currentStep;

  if (results[index]) {
    return results[index].success ? "success" : "failed";
  }
  if (index === currentStep && props.executionStatus.status === "running") {
    return "running";
  }
  return "pending";
};

const handleReorder = () => {
  emit("reorder-steps", [...localSteps.value]);
};

const handleDrop = (event) => {
  const stepData = event.dataTransfer.getData("step-template");
  if (stepData) {
    try {
      const template = JSON.parse(stepData);
      // Will be handled by parent via addStep
      console.log("Dropped template:", template);
    } catch (e) {
      console.error("Invalid drop data");
    }
  }
};
</script>

<style scoped>
.workflow-canvas {
  min-height: 100%;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  background:
    linear-gradient(90deg, rgba(0, 0, 0, 0.03) 1px, transparent 1px),
    linear-gradient(rgba(0, 0, 0, 0.03) 1px, transparent 1px);
  background-size: 20px 20px;
}

.start-node,
.end-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.node-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: #fff;
}

.node-icon.start {
  background: linear-gradient(135deg, #52c41a, #73d13d);
}

.node-icon.end {
  background: linear-gradient(135deg, #1890ff, #40a9ff);
}

.connection-line {
  width: 2px;
  height: 32px;
  background: #d9d9d9;
  position: relative;
}

.connection-line::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 8px solid #d9d9d9;
}

.steps-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 400px;
}

.step-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.ghost {
  opacity: 0.5;
  background: #e6f7ff;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
  color: #999;
  border: 2px dashed #d9d9d9;
  border-radius: 8px;
  margin: 24px;
  width: 300px;
}

.empty-state .anticon {
  font-size: 48px;
  margin-bottom: 16px;
}

.execution-overlay {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(255, 255, 255, 0.95);
  padding: 32px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  z-index: 100;
}
</style>
