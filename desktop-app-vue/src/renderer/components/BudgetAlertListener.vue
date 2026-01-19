<template>
  <div />
</template>

<script setup>
import { onMounted, onUnmounted } from "vue";
import { notification, Modal } from "ant-design-vue";
import { useRouter } from "vue-router";
import {
  ExclamationCircleOutlined,
  WarningOutlined,
  DollarOutlined,
} from "@ant-design/icons-vue";
import { h } from "vue";

const router = useRouter();

// 预算告警处理
const handleBudgetAlert = (alert) => {
  console.log("[BudgetAlertListener] 收到预算告警:", alert);

  // 根据告警级别显示不同类型的通知
  if (alert.level === "critical") {
    // 危险级别 - 使用 Modal 确保用户看到
    Modal.error({
      title: "预算超限警告",
      icon: h(ExclamationCircleOutlined),
      content: h("div", [
        h(
          "p",
          `您的${alert.period}预算已使用 ${alert.percentage.toFixed(0)}%！`,
        ),
        h(
          "p",
          { style: "font-weight: bold; color: #ff4d4f" },
          `当前: $${alert.current.toFixed(2)} / 限额: $${alert.limit.toFixed(2)}`,
        ),
        h(
          "p",
          { style: "margin-top: 12px; color: #666" },
          "为了控制成本，建议您立即查看使用详情并调整预算设置。",
        ),
      ]),
      okText: "查看详情",
      onOk: () => {
        router.push("/settings?tab=token-usage");
      },
    });

    // 同时显示持久化通知
    notification.error({
      message: "⚠️ 预算超限警告",
      description: `${alert.period}预算已使用 ${alert.percentage.toFixed(0)}%！当前: $${alert.current.toFixed(2)} / 限额: $${alert.limit.toFixed(2)}`,
      duration: 0, // 不自动关闭
      onClick: () => {
        router.push("/settings?tab=token-usage");
        notification.destroy();
      },
    });
  } else if (alert.level === "warning") {
    // 警告级别 - 使用 warning 通知
    notification.warning({
      message: "💰 预算使用提醒",
      description: `${alert.period}预算已使用 ${alert.percentage.toFixed(0)}%，当前: $${alert.current.toFixed(2)} / 限额: $${alert.limit.toFixed(2)}`,
      icon: h(WarningOutlined, { style: "color: #faad14" }),
      duration: 10,
      onClick: () => {
        router.push("/settings?tab=token-usage");
      },
    });
  }
};

// LLM 服务暂停处理
const handleServicePaused = (data) => {
  console.log("[BudgetAlertListener] LLM 服务已暂停:", data);

  const { reason, alert } = data;

  if (reason === "budget-exceeded") {
    Modal.confirm({
      title: "LLM 服务已暂停",
      icon: h(ExclamationCircleOutlined),
      content: h("div", [
        h("p", "由于预算超限，LLM 服务已自动暂停。"),
        h(
          "p",
          { style: "margin-top: 12px" },
          `${alert.period}预算: $${alert.current.toFixed(2)} / $${alert.limit.toFixed(2)} (${alert.percentage.toFixed(0)}%)`,
        ),
        h(
          "p",
          { style: "margin-top: 12px; color: #666" },
          "您可以前往设置页面调整预算限额，或手动恢复服务。",
        ),
      ]),
      okText: "前往设置",
      cancelText: "稍后处理",
      onOk: () => {
        router.push("/settings?tab=token-usage");
      },
    });

    // 显示持久化通知
    notification.error({
      message: "🚫 LLM 服务已暂停",
      description: "预算超限，服务已自动暂停。请前往设置页面调整。",
      duration: 0,
      icon: h(DollarOutlined, { style: "color: #ff4d4f" }),
      onClick: () => {
        router.push("/settings?tab=token-usage");
        notification.destroy();
      },
    });
  }
};

// LLM 服务恢复处理
const handleServiceResumed = () => {
  console.log("[BudgetAlertListener] LLM 服务已恢复");

  notification.success({
    message: "✅ LLM 服务已恢复",
    description: "LLM 服务已恢复正常，您可以继续使用。",
    duration: 5,
  });
};

// 导航处理
const handleNavigate = (path) => {
  console.log("[BudgetAlertListener] 导航到:", path);
  router.push(path);
};

// 生命周期
onMounted(() => {
  console.log("[BudgetAlertListener] 开始监听预算告警事件");

  // 监听预算告警
  window.electronAPI?.llm?.on?.("llm:budget-alert", handleBudgetAlert);

  // 监听服务暂停
  window.electronAPI?.llm?.on?.("llm:service-paused", handleServicePaused);

  // 监听服务恢复
  window.electronAPI?.llm?.on?.("llm:service-resumed", handleServiceResumed);

  // 监听导航请求
  window.electronAPI?.llm?.on?.("navigate-to", handleNavigate);
});

onUnmounted(() => {
  console.log("[BudgetAlertListener] 停止监听预算告警事件");

  // 清理监听器
  window.electronAPI?.llm?.off?.("llm:budget-alert", handleBudgetAlert);
  window.electronAPI?.llm?.off?.("llm:service-paused", handleServicePaused);
  window.electronAPI?.llm?.off?.("llm:service-resumed", handleServiceResumed);
  window.electronAPI?.llm?.off?.("navigate-to", handleNavigate);
});
</script>

<style scoped>
/* 无需样式，这是一个逻辑组件 */
</style>
