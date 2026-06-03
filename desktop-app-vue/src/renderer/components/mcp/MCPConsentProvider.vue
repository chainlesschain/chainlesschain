<template>
  <div class="mcp-consent-provider">
    <!-- 同意对话框 -->
    <MCPConsentDialog
      v-model="dialogVisible"
      :server-name="currentRequest?.serverName || ''"
      :tool-name="currentRequest?.toolName || ''"
      :params="currentRequest?.params || {}"
      :risk-level="currentRequest?.riskLevel || 'medium'"
      :operation-type="currentRequest?.operationType || 'read'"
      :request-id="currentRequest?.requestId || ''"
      @decision="handleDecision"
    />

    <!-- 插槽内容 -->
    <slot />
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, onMounted, onUnmounted, provide } from "vue";
import { message } from "ant-design-vue";
import MCPConsentDialog from "./MCPConsentDialog.vue";

// 当前同意请求
const currentRequest = ref(null);
const dialogVisible = ref(false);

// 请求队列（支持多个同时请求）
const requestQueue = ref([]);

// 处理下一个请求
const processNextRequest = () => {
  if (requestQueue.value.length > 0 && !dialogVisible.value) {
    currentRequest.value = requestQueue.value.shift();
    dialogVisible.value = true;
  }
};

// 处理同意请求事件
const handleConsentRequest = (request) => {
  logger.info("[MCPConsentProvider] Received consent request:", request);

  // 添加到队列
  requestQueue.value.push(request);

  // 处理队列
  processNextRequest();
};

// 处理用户决定
const handleDecision = async ({ requestId, decision, remember }) => {
  logger.info("[MCPConsentProvider] User decision:", {
    requestId,
    decision,
    remember,
  });

  try {
    // 发送决定到主进程
    const result = await window.electronAPI.mcp.consentResponse(
      requestId,
      decision,
    );

    if (result.success) {
      const actionText = {
        allow: "已允许操作",
        deny: "已拒绝操作",
        always_allow: "已始终允许此操作",
        always_deny: "已始终拒绝此操作",
      };

      message.info(actionText[decision] || "操作已处理");
    } else {
      logger.error(
        "[MCPConsentProvider] Failed to send decision:",
        result.error,
      );
      message.error("处理决定失败: " + result.error);
    }
  } catch (error) {
    logger.error("[MCPConsentProvider] Error sending decision:", error);
    message.error("发送决定失败");
  }

  // 关闭对话框并处理下一个请求
  dialogVisible.value = false;
  currentRequest.value = null;

  // 延迟处理下一个请求，避免对话框闪烁
  setTimeout(() => {
    processNextRequest();
  }, 300);
};

// 取消当前请求
const cancelCurrentRequest = async () => {
  if (currentRequest.value) {
    try {
      await window.electronAPI.mcp.cancelConsent(
        currentRequest.value.requestId,
      );
    } catch (error) {
      logger.error("[MCPConsentProvider] Error cancelling request:", error);
    }

    dialogVisible.value = false;
    currentRequest.value = null;
    processNextRequest();
  }
};

// 清空队列
const clearQueue = () => {
  requestQueue.value = [];
  currentRequest.value = null;
  dialogVisible.value = false;
};

// 获取队列状态
const getQueueStatus = () => ({
  queueLength: requestQueue.value.length,
  hasActiveRequest: !!currentRequest.value,
});

// 提供给子组件使用
provide("mcpConsent", {
  cancelCurrentRequest,
  clearQueue,
  getQueueStatus,
});

// 事件监听清理函数
let unsubscribe = null;

onMounted(() => {
  // 注册同意请求事件监听
  if (window.electronAPI?.mcp?.onConsentRequest) {
    unsubscribe = window.electronAPI.mcp.onConsentRequest(handleConsentRequest);
    logger.info("[MCPConsentProvider] Consent request listener registered");
  } else {
    logger.warn("[MCPConsentProvider] MCP API not available");
  }
});

onUnmounted(() => {
  // 清理事件监听
  if (unsubscribe) {
    unsubscribe();
    logger.info("[MCPConsentProvider] Consent request listener removed");
  }

  // 清空队列
  clearQueue();
});

// 暴露方法给父组件
defineExpose({
  cancelCurrentRequest,
  clearQueue,
  getQueueStatus,
});
</script>

<style scoped>
.mcp-consent-provider {
  /* Provider 不影响布局 */
}
</style>
