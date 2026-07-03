/**
 * Pure display helpers extracted from TaskExecutionMonitor.vue
 * (opportunistic split). File hints, duration/time formatting, and task-status
 * color/text/progress/badge + tool-label mappings. No reactive state — all take
 * their inputs as args, so unit-testable in isolation.
 */

// 文件类型提示（按扩展名）
export function getFileHint(fileName) {
  const ext = fileName.split(".").pop().toLowerCase();
  const hints = {
    pptx: "可编辑PPT制作指南(修改版1)",
    docx: "可编辑文档",
    xlsx: "可编辑表格",
    pdf: "PDF文档",
    html: "网页文件",
  };
  return hints[ext] || "";
}

// 持续时间：H小时M分钟 / M分钟S秒 / S秒
export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`;
  } else if (minutes > 0) {
    return `${minutes}分钟${seconds % 60}秒`;
  } else {
    return `${seconds}秒`;
  }
}

// 时:分:秒
export function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// 状态颜色
export function getStatusColor(status) {
  const colors = {
    pending: "default",
    in_progress: "processing",
    completed: "success",
    failed: "error",
    cancelled: "warning",
  };
  return colors[status] || "default";
}

// 状态文本
export function getStatusText(status) {
  const texts = {
    pending: "等待中",
    in_progress: "执行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return texts[status] || status;
}

// 进度条状态
export function getProgressStatus(status) {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "exception";
  }
  if (status === "in_progress") {
    return "active";
  }
  return "normal";
}

// Badge 状态
export function getBadgeStatus(status) {
  const statusMap = {
    pending: "default",
    in_progress: "processing",
    completed: "success",
    failed: "error",
  };
  return statusMap[status] || "default";
}

// 工具标签
export function getToolLabel(tool) {
  const labels = {
    "web-engine": "网页",
    "document-engine": "文档",
    "data-engine": "数据",
    "ppt-engine": "PPT",
    "code-engine": "代码",
    "image-engine": "图像",
  };
  return labels[tool] || tool;
}
