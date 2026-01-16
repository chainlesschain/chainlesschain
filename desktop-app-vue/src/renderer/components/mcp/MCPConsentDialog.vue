<template>
  <a-modal
    v-model:open="visible"
    title="MCP 安全确认"
    width="600px"
    :closable="false"
    :maskClosable="false"
    :keyboard="false"
    centered
  >
    <div class="consent-dialog">
      <!-- 风险级别标识 -->
      <a-alert
        :type="riskAlertType"
        :message="riskAlertMessage"
        show-icon
        style="margin-bottom: 16px"
      >
        <template #icon>
          <ExclamationCircleOutlined v-if="riskLevel === 'critical'" />
          <WarningOutlined v-else-if="riskLevel === 'high'" />
          <InfoCircleOutlined v-else />
        </template>
      </a-alert>

      <!-- 操作详情 -->
      <a-descriptions bordered :column="1" size="small">
        <a-descriptions-item label="服务器">
          <a-tag :color="serverSecurityColor">{{ serverName }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="工具">
          <code>{{ toolName }}</code>
        </a-descriptions-item>
        <a-descriptions-item label="操作类型">
          <a-tag :color="operationColor">{{ operationLabel }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item v-if="targetPath" label="目标路径">
          <code class="path-display">{{ targetPath }}</code>
        </a-descriptions-item>
        <a-descriptions-item label="风险级别">
          <a-tag :color="riskColor">{{ riskLabel }}</a-tag>
        </a-descriptions-item>
      </a-descriptions>

      <!-- 参数详情（可展开） -->
      <a-collapse v-if="hasParams" style="margin-top: 16px">
        <a-collapse-panel key="params" header="查看详细参数">
          <pre class="params-display">{{ formattedParams }}</pre>
        </a-collapse-panel>
      </a-collapse>

      <!-- 记住选择 -->
      <div class="remember-section" style="margin-top: 16px">
        <a-checkbox v-model:checked="rememberChoice">
          记住此选择（同一操作不再询问）
        </a-checkbox>
      </div>
    </div>

    <template #footer>
      <div class="footer-actions">
        <a-button @click="handleDeny" :loading="loading">
          <CloseOutlined /> 拒绝
        </a-button>
        <a-button @click="handleAlwaysDeny" danger :loading="loading">
          <StopOutlined /> 始终拒绝
        </a-button>
        <a-button type="primary" @click="handleAllow" :loading="loading">
          <CheckOutlined /> 允许
        </a-button>
        <a-button
          type="primary"
          @click="handleAlwaysAllow"
          :loading="loading"
          ghost
        >
          <SafetyOutlined /> 始终允许
        </a-button>
      </div>
    </template>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import {
  ExclamationCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  StopOutlined,
  SafetyOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  serverName: {
    type: String,
    required: true,
  },
  toolName: {
    type: String,
    required: true,
  },
  params: {
    type: Object,
    default: () => ({}),
  },
  riskLevel: {
    type: String,
    default: "medium",
    validator: (v) => ["low", "medium", "high", "critical"].includes(v),
  },
  operationType: {
    type: String,
    default: "read",
  },
  requestId: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["update:modelValue", "decision"]);

const loading = ref(false);
const rememberChoice = ref(false);

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit("update:modelValue", val),
});

// 目标路径
const targetPath = computed(() => {
  return props.params.path || props.params.uri || props.params.file || "";
});

// 是否有参数
const hasParams = computed(() => {
  return Object.keys(props.params).length > 0;
});

// 格式化参数
const formattedParams = computed(() => {
  return JSON.stringify(props.params, null, 2);
});

// 风险级别颜色
const riskColor = computed(() => {
  const colors = {
    low: "green",
    medium: "orange",
    high: "red",
    critical: "magenta",
  };
  return colors[props.riskLevel] || "default";
});

// 风险级别标签
const riskLabel = computed(() => {
  const labels = {
    low: "低风险",
    medium: "中等风险",
    high: "高风险",
    critical: "极高风险",
  };
  return labels[props.riskLevel] || props.riskLevel;
});

// 风险警告类型
const riskAlertType = computed(() => {
  const types = {
    low: "info",
    medium: "warning",
    high: "error",
    critical: "error",
  };
  return types[props.riskLevel] || "info";
});

// 风险警告消息
const riskAlertMessage = computed(() => {
  const messages = {
    low: "此操作风险较低，通常是安全的读取操作。",
    medium: "此操作涉及数据写入，请确认是否允许。",
    high: "此操作可能修改或删除数据，请谨慎确认。",
    critical: "此操作具有极高风险，可能造成数据丢失或系统损坏！",
  };
  return messages[props.riskLevel] || "请确认是否允许此操作。";
});

// 操作类型颜色
const operationColor = computed(() => {
  const colors = {
    read: "green",
    write: "orange",
    delete: "red",
    execute: "purple",
  };
  return colors[props.operationType] || "default";
});

// 操作类型标签
const operationLabel = computed(() => {
  const labels = {
    read: "读取",
    write: "写入",
    delete: "删除",
    execute: "执行",
  };
  return labels[props.operationType] || props.operationType;
});

// 服务器安全颜色
const serverSecurityColor = computed(() => {
  // 可以根据服务器类型设置不同颜色
  return "blue";
});

// 处理允许
const handleAllow = () => {
  sendDecision("allow");
};

// 处理始终允许
const handleAlwaysAllow = () => {
  sendDecision("always_allow");
};

// 处理拒绝
const handleDeny = () => {
  sendDecision("deny");
};

// 处理始终拒绝
const handleAlwaysDeny = () => {
  sendDecision("always_deny");
};

// 发送决定
const sendDecision = async (decision) => {
  loading.value = true;
  try {
    emit("decision", {
      requestId: props.requestId,
      decision,
      remember: rememberChoice.value,
    });
    visible.value = false;
  } finally {
    loading.value = false;
  }
};

// 重置状态
watch(visible, (val) => {
  if (!val) {
    rememberChoice.value = false;
    loading.value = false;
  }
});
</script>

<style scoped>
.consent-dialog {
  padding: 8px 0;
}

.path-display {
  word-break: break-all;
  background-color: #f5f5f5;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.params-display {
  background-color: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  font-size: 12px;
  max-height: 200px;
  overflow: auto;
  margin: 0;
}

.remember-section {
  padding: 12px;
  background-color: #fafafa;
  border-radius: 4px;
}

.footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

:deep(.ant-descriptions-item-label) {
  width: 100px;
}
</style>
