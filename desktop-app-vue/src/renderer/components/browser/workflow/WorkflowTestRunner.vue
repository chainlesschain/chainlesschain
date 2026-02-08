<template>
  <div class="workflow-test-runner">
    <div class="runner-controls">
      <a-space>
        <a-select
          v-model:value="selectedTarget"
          style="width: 200px"
          placeholder="Select browser tab"
        >
          <a-select-option
            v-for="tab in browserTabs"
            :key="tab.id"
            :value="tab.id"
          >
            {{ tab.title || tab.url || "New Tab" }}
          </a-select-option>
        </a-select>
        <a-button
          type="primary"
          :loading="isRunning"
          :disabled="!canRun"
          @click="runTest"
        >
          <template #icon>
            <PlayCircleOutlined />
          </template>
          Run Test
        </a-button>
        <a-button v-if="isRunning" @click="pauseTest">
          <template #icon>
            <PauseCircleOutlined />
          </template>
        </a-button>
        <a-button v-if="isPaused" @click="resumeTest">
          <template #icon>
            <PlayCircleOutlined />
          </template>
        </a-button>
        <a-button v-if="isRunning || isPaused" danger @click="stopTest">
          <template #icon>
            <StopOutlined />
          </template>
        </a-button>
      </a-space>
      <a-space>
        <a-checkbox v-model:checked="stepByStep"> Step by Step </a-checkbox>
        <a-checkbox v-model:checked="slowMode"> Slow Mode </a-checkbox>
      </a-space>
    </div>

    <!-- Execution Log -->
    <div ref="logContainer" class="execution-log">
      <div
        v-for="(entry, index) in executionLog"
        :key="index"
        class="log-entry"
        :class="entry.type"
      >
        <span class="log-time">{{ formatTime(entry.timestamp) }}</span>
        <span class="log-icon">
          <CheckCircleOutlined v-if="entry.type === 'success'" />
          <CloseCircleOutlined v-if="entry.type === 'error'" />
          <LoadingOutlined v-if="entry.type === 'running'" spin />
          <InfoCircleOutlined v-if="entry.type === 'info'" />
        </span>
        <span class="log-message">{{ entry.message }}</span>
        <span v-if="entry.duration" class="log-duration"
          >{{ entry.duration }}ms</span
        >
      </div>
      <div v-if="executionLog.length === 0" class="empty-log">
        <ExperimentOutlined />
        <p>Run the test to see execution logs</p>
      </div>
    </div>

    <!-- Results Summary -->
    <div v-if="testResult" class="results-summary">
      <a-result
        :status="testResult.status === 'completed' ? 'success' : 'error'"
        :title="
          testResult.status === 'completed' ? 'Test Passed' : 'Test Failed'
        "
        :sub-title="resultSubtitle"
      >
        <template #extra>
          <a-button @click="clearResults"> Clear </a-button>
          <a-button type="primary" @click="runTest"> Run Again </a-button>
        </template>
      </a-result>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { message } from "ant-design-vue";
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StopOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  InfoCircleOutlined,
  ExperimentOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  workflowId: String,
  steps: {
    type: Array,
    default: () => [],
  },
  variables: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(["execution-update"]);

// State
const browserTabs = ref([]);
const selectedTarget = ref(null);
const isRunning = ref(false);
const isPaused = ref(false);
const stepByStep = ref(false);
const slowMode = ref(false);
const executionLog = ref([]);
const testResult = ref(null);
const currentExecutionId = ref(null);
const logContainer = ref(null);

// Computed
const canRun = computed(() => {
  return props.steps.length > 0 && !isRunning.value;
});

const resultSubtitle = computed(() => {
  if (!testResult.value) {
    return "";
  }
  const duration = testResult.value.duration;
  const stepCount = props.steps.length;
  return `Completed ${stepCount} steps in ${duration}ms`;
});

// Methods
const loadBrowserTabs = async () => {
  try {
    // This would call the browser API to get open tabs
    // For now, we'll use a placeholder
    browserTabs.value = [
      { id: "default", title: "Default Browser Tab", url: "" },
    ];
  } catch (error) {
    console.error("Failed to load browser tabs:", error);
  }
};

const addLogEntry = (type, message, duration = null) => {
  executionLog.value.push({
    type,
    message,
    timestamp: Date.now(),
    duration,
  });

  // Auto-scroll to bottom
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight;
    }
  });
};

const runTest = async () => {
  if (!props.steps.length) {
    message.warning("No steps to run");
    return;
  }

  isRunning.value = true;
  isPaused.value = false;
  testResult.value = null;
  executionLog.value = [];

  addLogEntry("info", "Starting workflow test...");

  const startTime = Date.now();

  try {
    const result = await window.electronAPI.browser.workflow.executeInline(
      {
        steps: props.steps,
        variables: props.variables,
      },
      selectedTarget.value,
      {
        ...props.variables,
        __testMode: true,
        __slowMode: slowMode.value,
        __stepByStep: stepByStep.value,
      },
    );

    currentExecutionId.value = result.executionId;

    // Process results
    if (result.results) {
      result.results.forEach((stepResult, index) => {
        const stepName =
          props.steps[index]?.action ||
          props.steps[index]?.type ||
          `Step ${index + 1}`;
        if (stepResult.success) {
          addLogEntry(
            "success",
            `Step ${index + 1}: ${stepName} completed`,
            stepResult.duration,
          );
        } else {
          addLogEntry(
            "error",
            `Step ${index + 1}: ${stepName} failed - ${stepResult.error}`,
          );
        }
      });
    }

    const duration = Date.now() - startTime;
    testResult.value = {
      status: result.status,
      duration,
      results: result.results,
    };

    if (result.status === "completed") {
      addLogEntry(
        "success",
        `Workflow completed successfully in ${duration}ms`,
      );
    } else {
      addLogEntry("error", `Workflow failed: ${result.errorMessage}`);
    }

    emit("execution-update", {
      status: result.status,
      results: result.results,
    });
  } catch (error) {
    addLogEntry("error", `Execution error: ${error.message}`);
    testResult.value = {
      status: "failed",
      duration: Date.now() - startTime,
      error: error.message,
    };

    emit("execution-update", {
      status: "failed",
      error: error.message,
    });
  } finally {
    isRunning.value = false;
    isPaused.value = false;
  }
};

const pauseTest = async () => {
  if (currentExecutionId.value) {
    try {
      await window.electronAPI.browser.workflow.pause(currentExecutionId.value);
      isPaused.value = true;
      addLogEntry("info", "Workflow paused");
    } catch (error) {
      message.error("Failed to pause: " + error.message);
    }
  }
};

const resumeTest = async () => {
  if (currentExecutionId.value) {
    try {
      await window.electronAPI.browser.workflow.resume(
        currentExecutionId.value,
      );
      isPaused.value = false;
      addLogEntry("info", "Workflow resumed");
    } catch (error) {
      message.error("Failed to resume: " + error.message);
    }
  }
};

const stopTest = async () => {
  if (currentExecutionId.value) {
    try {
      await window.electronAPI.browser.workflow.cancel(
        currentExecutionId.value,
      );
      isRunning.value = false;
      isPaused.value = false;
      addLogEntry("info", "Workflow cancelled");
    } catch (error) {
      message.error("Failed to stop: " + error.message);
    }
  }
};

const clearResults = () => {
  executionLog.value = [];
  testResult.value = null;
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

// Event listener
let unsubscribe = null;

onMounted(() => {
  loadBrowserTabs();

  // Subscribe to workflow events
  unsubscribe = window.electronAPI.browser.workflow.onEvent((event) => {
    if (event.executionId === currentExecutionId.value) {
      if (event.type === "step:completed") {
        const stepName =
          props.steps[event.stepIndex]?.action || `Step ${event.stepIndex + 1}`;
        addLogEntry(
          event.success ? "success" : "error",
          `${stepName}: ${event.success ? "completed" : event.error}`,
          event.duration,
        );
      }
    }
  });
});

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe();
  }
});
</script>

<style scoped>
.workflow-test-runner {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px;
}

.runner-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.execution-log {
  flex: 1;
  overflow: auto;
  background: #fafafa;
  border: 1px solid #e8e8e8;
  border-radius: 4px;
  padding: 8px;
  font-family: monospace;
  font-size: 12px;
}

.log-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid #f0f0f0;
}

.log-entry:last-child {
  border-bottom: none;
}

.log-entry.success .log-icon {
  color: #52c41a;
}

.log-entry.error .log-icon {
  color: #ff4d4f;
}

.log-entry.running .log-icon {
  color: #1890ff;
}

.log-entry.info .log-icon {
  color: #999;
}

.log-time {
  color: #999;
  font-size: 11px;
}

.log-message {
  flex: 1;
}

.log-duration {
  color: #999;
  font-size: 11px;
}

.empty-log {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
}

.empty-log .anticon {
  font-size: 32px;
  margin-bottom: 8px;
}

.results-summary {
  margin-top: 12px;
}

.results-summary :deep(.ant-result) {
  padding: 16px;
}
</style>
