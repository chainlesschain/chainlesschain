<template>
  <div class="python-execution-panel">
    <!-- 执行控制区 -->
    <div class="execution-controls">
      <a-space>
        <a-button
          type="primary"
          :loading="executing"
          :disabled="!code || code.trim().length === 0"
          @click="handleExecute"
        >
          <play-circle-outlined v-if="!executing" />
          <loading-outlined v-else />
          {{ executing ? "执行中..." : "运行代码" }}
        </a-button>

        <a-button :disabled="!executing" @click="handleStop">
          <stop-outlined />
          停止
        </a-button>

        <a-button @click="handleClear">
          <clear-outlined />
          清空输出
        </a-button>

        <a-tooltip title="代码安全检查">
          <a-button :loading="checking" @click="handleSafetyCheck">
            <safety-outlined />
            安全检查
          </a-button>
        </a-tooltip>
      </a-space>

      <div v-if="executionTime" class="execution-time">
        执行时间: {{ executionTime }}ms
      </div>
    </div>

    <!-- 安全警告 -->
    <a-alert
      v-if="safetyWarnings.length > 0"
      type="warning"
      show-icon
      closable
      class="safety-alert"
    >
      <template #message>
        <div>检测到潜在危险操作:</div>
        <ul class="warning-list">
          <li v-for="(warning, index) in safetyWarnings" :key="index">
            {{ warning }}
          </li>
        </ul>
      </template>
      <template #description>
        <a-space>
          <span>是否仍要执行?</span>
          <a-button
            size="small"
            type="primary"
            danger
            @click="handleForceExecute"
          >
            强制执行
          </a-button>
        </a-space>
      </template>
    </a-alert>

    <!-- 执行步骤 -->
    <div v-if="showSteps && steps.length > 0" class="execution-steps">
      <div class="steps-header" @click="stepsExpanded = !stepsExpanded">
        <right-outlined :class="{ expanded: stepsExpanded }" />
        <span class="steps-title">{{ steps.length }} 个步骤</span>
      </div>

      <transition name="expand">
        <div v-show="stepsExpanded" class="steps-list">
          <div
            v-for="(step, index) in steps"
            :key="index"
            :class="['step-item', `status-${step.status}`]"
          >
            <div class="step-icon">
              <check-circle-outlined v-if="step.status === 'completed'" />
              <loading-outlined v-else-if="step.status === 'running'" spin />
              <clock-circle-outlined v-else />
            </div>
            <div class="step-content">
              <div class="step-title">
                {{ step.title }}
              </div>
              <div v-if="step.description" class="step-description">
                {{ step.description }}
              </div>
            </div>
          </div>
        </div>
      </transition>
    </div>

    <!-- 输出区域 -->
    <div class="execution-output">
      <a-tabs v-model:active-key="activeTab">
        <!-- 标准输出 -->
        <a-tab-pane key="stdout" tab="输出">
          <div class="output-content">
            <pre v-if="stdout" class="output-text">{{ stdout }}</pre>
            <div v-else class="output-empty">
              <inbox-outlined />
              <span>暂无输出</span>
            </div>
          </div>
        </a-tab-pane>

        <!-- 错误输出 -->
        <a-tab-pane key="stderr">
          <template #tab>
            <span>
              错误
              <a-badge
                v-if="stderr"
                :count="1"
                :offset="[10, 0]"
                :number-style="{ backgroundColor: '#f5222d' }"
              />
            </span>
          </template>
          <div class="output-content error">
            <pre v-if="stderr" class="output-text">{{ stderr }}</pre>
            <div v-else class="output-empty">
              <check-circle-outlined />
              <span>无错误</span>
            </div>
          </div>
        </a-tab-pane>

        <!-- 执行信息 -->
        <a-tab-pane key="info" tab="信息">
          <div class="output-content">
            <div class="info-item">
              <span class="info-label">退出代码:</span>
              <a-tag :color="exitCode === 0 ? 'success' : 'error'">
                {{ exitCode !== null ? exitCode : "-" }}
              </a-tag>
            </div>
            <div class="info-item">
              <span class="info-label">执行时间:</span>
              <span>{{ executionTime ? `${executionTime}ms` : "-" }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">执行状态:</span>
              <a-tag :color="getStatusColor(lastExecutionStatus)">
                {{ lastExecutionStatus || "未执行" }}
              </a-tag>
            </div>
            <div class="info-item">
              <span class="info-label">Python版本:</span>
              <span>{{ pythonVersion || "检测中..." }}</span>
            </div>
          </div>
        </a-tab-pane>
      </a-tabs>
    </div>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed } from "vue";
import {
  PlayCircleOutlined,
  StopOutlined,
  ClearOutlined,
  SafetyOutlined,
  RightOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined,
  InboxOutlined,
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";

const props = defineProps({
  code: {
    type: String,
    required: true,
  },
  filepath: {
    type: String,
    default: null,
  },
  showSteps: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["execution-complete", "execution-error"]);

// 执行状态
const executing = ref(false);
const currentExecutionId = ref(null); // 当前执行的进程ID
const checking = ref(false);
const activeTab = ref("stdout");

// 输出数据
const stdout = ref("");
const stderr = ref("");
const exitCode = ref(null);
const executionTime = ref(null);
const lastExecutionStatus = ref("");
const pythonVersion = ref("");

// 安全检查
const safetyWarnings = ref([]);

// 执行步骤
const steps = ref([]);
const stepsExpanded = ref(true);

// 获取Python版本
const detectPythonVersion = async () => {
  try {
    const result = await window.api.code.executePython(
      "import sys; print(sys.version)",
      {
        timeout: 3000,
      },
    );
    if (result.success && result.stdout) {
      pythonVersion.value = result.stdout.trim().split("\n")[0];
    }
  } catch (error) {
    logger.error("检测Python版本失败:", error);
  }
};

// 初始化
detectPythonVersion();

/**
 * 执行Python代码
 */
const handleExecute = async () => {
  if (!props.code || props.code.trim().length === 0) {
    message.warning("请输入代码");
    return;
  }

  // 清空之前的输出
  stdout.value = "";
  stderr.value = "";
  exitCode.value = null;
  executionTime.value = null;
  safetyWarnings.value = [];

  executing.value = true;
  lastExecutionStatus.value = "执行中";

  if (props.showSteps) {
    steps.value = [
      { title: "正在创建临时文件", status: "running" },
      { title: "正在执行代码", status: "pending" },
      { title: "正在收集输出", status: "pending" },
    ];
  }

  try {
    // 步骤1: 创建文件
    if (props.showSteps) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      steps.value[0].status = "completed";
      steps.value[1].status = "running";
    }

    // 步骤2: 执行代码
    // 生成执行ID用于追踪和停止
    currentExecutionId.value = `exec_${Date.now()}`;
    const result = await window.api.code.executePython(props.code, {
      timeout: 30000,
      executionId: currentExecutionId.value,
    });

    // 步骤3: 收集输出
    if (props.showSteps) {
      steps.value[1].status = "completed";
      steps.value[2].status = "running";
      await new Promise((resolve) => setTimeout(resolve, 200));
      steps.value[2].status = "completed";
    }

    // 处理结果
    if (result.success === false && result.error === "code_unsafe") {
      // 安全检查失败
      safetyWarnings.value = result.warnings || [];
      lastExecutionStatus.value = "安全检查失败";
      message.warning("代码包含潜在危险操作");
      return;
    }

    stdout.value = result.stdout || "";
    stderr.value = result.stderr || "";
    exitCode.value = result.exitCode;
    executionTime.value = result.executionTime;

    if (result.success) {
      lastExecutionStatus.value = "执行成功";
      message.success("代码执行成功");
      emit("execution-complete", result);
    } else {
      lastExecutionStatus.value = "执行失败";
      message.error("代码执行失败");
      activeTab.value = "stderr"; // 切换到错误标签
      emit("execution-error", result);
    }
  } catch (error) {
    logger.error("执行Python代码失败:", error);
    stderr.value = error.message || "执行失败";
    lastExecutionStatus.value = "异常终止";
    message.error(`执行失败: ${error.message}`);
    emit("execution-error", error);
  } finally {
    executing.value = false;
  }
};

/**
 * 强制执行(忽略安全警告)
 */
const handleForceExecute = async () => {
  safetyWarnings.value = [];
  executing.value = true;
  lastExecutionStatus.value = "强制执行中";

  try {
    const result = await window.api.code.executePython(props.code, {
      timeout: 30000,
      ignoreWarnings: true,
    });

    stdout.value = result.stdout || "";
    stderr.value = result.stderr || "";
    exitCode.value = result.exitCode;
    executionTime.value = result.executionTime;

    if (result.success) {
      lastExecutionStatus.value = "执行成功";
      message.success("代码执行成功");
      emit("execution-complete", result);
    } else {
      lastExecutionStatus.value = "执行失败";
      message.error("代码执行失败");
      activeTab.value = "stderr";
      emit("execution-error", result);
    }
  } catch (error) {
    logger.error("强制执行失败:", error);
    stderr.value = error.message || "执行失败";
    lastExecutionStatus.value = "异常终止";
    message.error(`执行失败: ${error.message}`);
    emit("execution-error", error);
  } finally {
    executing.value = false;
  }
};

/**
 * 停止执行
 */
const handleStop = async () => {
  if (!executing.value) {
    return;
  }

  try {
    // 调用停止执行的 API
    if (currentExecutionId.value && window.api?.code?.stopExecution) {
      await window.api.code.stopExecution(currentExecutionId.value);
    }

    executing.value = false;
    currentExecutionId.value = null;
    lastExecutionStatus.value = "已停止";
    stderr.value = "执行已被用户中断";

    // 更新步骤状态
    if (props.showSteps) {
      steps.value.forEach((step) => {
        if (step.status === "running") {
          step.status = "error";
        }
      });
    }

    message.warning("执行已停止");
  } catch (error) {
    logger.error("停止执行失败:", error);
    // 即使API调用失败，也重置状态
    executing.value = false;
    currentExecutionId.value = null;
    lastExecutionStatus.value = "已停止";
    message.info("执行已停止");
  }
};

/**
 * 清空输出
 */
const handleClear = () => {
  stdout.value = "";
  stderr.value = "";
  exitCode.value = null;
  executionTime.value = null;
  lastExecutionStatus.value = "";
  safetyWarnings.value = [];
  steps.value = [];
  message.success("输出已清空");
};

/**
 * 安全检查
 */
const handleSafetyCheck = async () => {
  if (!props.code || props.code.trim().length === 0) {
    message.warning("请输入代码");
    return;
  }

  checking.value = true;
  safetyWarnings.value = [];

  try {
    const result = await window.api.code.checkSafety(props.code);

    if (result.safe) {
      message.success("代码安全检查通过");
    } else {
      safetyWarnings.value = result.warnings || [];
      message.warning(`发现 ${result.warnings.length} 个潜在安全问题`);
    }
  } catch (error) {
    logger.error("安全检查失败:", error);
    message.error("安全检查失败");
  } finally {
    checking.value = false;
  }
};

/**
 * 获取状态颜色
 */
const getStatusColor = (status) => {
  const colorMap = {
    执行成功: "success",
    执行中: "processing",
    执行失败: "error",
    异常终止: "error",
    已停止: "default",
    安全检查失败: "warning",
  };
  return colorMap[status] || "default";
};

/**
 * 切换步骤展开/收起
 */
const toggleStepsExpanded = () => {
  stepsExpanded.value = !stepsExpanded.value;
};

// 暴露方法供父组件调用
defineExpose({
  execute: handleExecute,
  stop: handleStop,
  clear: handleClear,
  toggleStepsExpanded,
});
</script>

<style scoped lang="scss">
.python-execution-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
}

.execution-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #fafafa;
  border-bottom: 1px solid #f0f0f0;

  .execution-time {
    font-size: 13px;
    color: #666;
    font-weight: 500;
  }
}

.safety-alert {
  margin: 12px 16px;

  .warning-list {
    margin: 8px 0 0 0;
    padding-left: 20px;

    li {
      color: #fa8c16;
      font-size: 13px;
      margin: 4px 0;
    }
  }
}

.execution-steps {
  margin: 12px 16px;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 6px;

  .steps-header {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;

    .anticon {
      transition: transform 0.2s;

      &.expanded {
        transform: rotate(90deg);
      }
    }

    .steps-title {
      font-size: 14px;
      font-weight: 500;
      color: #333;
    }
  }

  .steps-list {
    padding: 12px 0 0 24px;
  }

  .step-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 8px;
    margin-bottom: 8px;
    background: white;
    border-radius: 6px;

    &:last-child {
      margin-bottom: 0;
    }

    &.status-completed .step-icon {
      color: #52c41a;
    }

    &.status-running {
      background: #e6f7ff;

      .step-icon {
        color: #1677ff;
      }
    }

    &.status-pending .step-icon {
      color: #d9d9d9;
    }

    .step-icon {
      font-size: 16px;
      padding-top: 2px;
    }

    .step-content {
      flex: 1;

      .step-title {
        font-size: 14px;
        color: #333;
      }

      .step-description {
        font-size: 12px;
        color: #666;
        margin-top: 4px;
      }
    }
  }
}

.execution-output {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  :deep(.ant-tabs) {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  :deep(.ant-tabs-content-holder) {
    flex: 1;
    overflow: hidden;
  }

  :deep(.ant-tabs-content) {
    height: 100%;
  }

  :deep(.ant-tabs-tabpane) {
    height: 100%;
    overflow: auto;
  }

  .output-content {
    height: 100%;
    overflow: auto;
    padding: 16px;

    &.error {
      background: #fff2f0;
    }

    .output-text {
      margin: 0;
      padding: 12px;
      background: #f5f5f5;
      border-radius: 4px;
      font-family: "Consolas", "Monaco", "Courier New", monospace;
      font-size: 13px;
      line-height: 1.6;
      color: #333;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    &.error .output-text {
      background: #fff1f0;
      color: #cf1322;
    }

    .output-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #bfbfbf;
      gap: 12px;

      .anticon {
        font-size: 48px;
      }

      span {
        font-size: 14px;
      }
    }

    .info-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      margin-bottom: 8px;
      background: #fafafa;
      border-radius: 6px;

      &:last-child {
        margin-bottom: 0;
      }

      .info-label {
        font-size: 14px;
        font-weight: 500;
        color: #666;
        min-width: 90px;
      }
    }
  }
}

// 展开/收起动画
.expand-enter-active,
.expand-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  max-height: 0;
  opacity: 0;
}

.expand-enter-to,
.expand-leave-from {
  max-height: 500px;
  opacity: 1;
}
</style>
