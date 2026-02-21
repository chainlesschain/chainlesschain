<template>
  <div class="workflow-debug-panel">
    <!-- 执行状态栏 -->
    <div class="debug-header">
      <div class="debug-status">
        <span class="debug-label">状态</span>
        <a-tag :color="stateColor">
          {{ stateText }}
        </a-tag>
        <span v-if="executionState?.duration" class="debug-duration">
          <ClockCircleOutlined />
          {{ formatDuration(executionState.duration) }}
        </span>
      </div>
    </div>

    <!-- 步骤结果时间线 -->
    <div v-if="stepResults.length" class="debug-steps">
      <div class="section-title">步骤结果</div>
      <div class="steps-list">
        <div v-for="(step, idx) in stepResults" :key="idx" class="step-row">
          <a-tag :color="step.success ? 'green' : 'red'" size="small">
            {{ step.success ? "成功" : "失败" }}
          </a-tag>
          <span class="step-name">{{ step.name || `步骤 ${idx + 1}` }}</span>
          <span v-if="step.duration" class="step-duration">
            {{ formatDuration(step.duration) }}
          </span>
        </div>
      </div>
    </div>

    <!-- 调试日志 -->
    <div v-if="debugLog && debugLog.length" class="debug-log-section">
      <div class="section-title">调试日志</div>
      <div class="debug-log-output">
        <div v-for="(line, idx) in debugLog" :key="idx" class="log-line">
          {{ line }}
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-if="!stepResults.length && (!debugLog || !debugLog.length)"
      class="debug-empty"
    >
      <span>暂无执行数据</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { ClockCircleOutlined } from "@ant-design/icons-vue";

const props = defineProps({
  executionState: { type: Object, default: () => ({}) },
  debugLog: { type: Array, default: () => [] },
});

const stateColorMap = {
  completed: "green",
  failed: "red",
  running: "blue",
  idle: "default",
  paused: "orange",
};

const stateTextMap = {
  completed: "已完成",
  failed: "失败",
  running: "运行中",
  idle: "空闲",
  paused: "已暂停",
};

const stateColor = computed(
  () => stateColorMap[props.executionState?.state] || "default",
);
const stateText = computed(
  () => stateTextMap[props.executionState?.state] || "未知",
);
const stepResults = computed(() => props.executionState?.stepResults || []);

const formatDuration = (ms) => {
  if (!ms) {
    return "0ms";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const sec = Math.floor(ms / 1000);
  if (sec < 60) {
    return `${sec}秒`;
  }
  const min = Math.floor(sec / 60);
  return `${min}分${sec % 60}秒`;
};
</script>

<style scoped>
.workflow-debug-panel {
  border-top: 1px solid #e8e8e8;
  max-height: 200px;
  overflow-y: auto;
  padding: 10px 16px;
  background: #fafafa;
  font-size: 13px;
}

.debug-header {
  margin-bottom: 8px;
}

.debug-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.debug-label {
  font-weight: 600;
  color: #595959;
}

.debug-duration {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #8c8c8c;
  font-size: 12px;
  margin-left: auto;
}

.section-title {
  font-weight: 600;
  font-size: 12px;
  color: #595959;
  margin-bottom: 6px;
}

.debug-steps {
  margin-bottom: 8px;
}

.steps-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.step-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-name {
  color: #262626;
}

.step-duration {
  margin-left: auto;
  color: #8c8c8c;
  font-size: 12px;
}

.debug-log-section {
  margin-top: 8px;
}

.debug-log-output {
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: "Menlo", "Consolas", "Courier New", monospace;
  font-size: 11px;
  padding: 8px;
  border-radius: 4px;
  max-height: 100px;
  overflow-y: auto;
  line-height: 1.6;
}

.log-line {
  white-space: pre-wrap;
  word-break: break-all;
}

.debug-empty {
  text-align: center;
  color: #bfbfbf;
  padding: 16px 0;
}
</style>
