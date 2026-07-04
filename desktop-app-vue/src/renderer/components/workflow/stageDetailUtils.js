/**
 * Pure helpers extracted from StageDetail.vue (opportunistic split).
 * Stage badge digit, status color+text, progress status, step class map, score
 * color, and duration/detail formatting. No reactive state — unit-testable.
 */

export const getStageIcon = (stageName) => {
  const iconMap = {
    需求分析: "1",
    方案设计: "2",
    内容生成: "3",
    质量验证: "4",
    集成优化: "5",
    交付确认: "6",
  };
  return iconMap[stageName] || "?";
};

export const getStatusColor = (status) => {
  const colorMap = {
    pending: "default",
    running: "processing",
    completed: "success",
    failed: "error",
    skipped: "warning",
  };
  return colorMap[status] || "default";
};

export const getStatusText = (status) => {
  const textMap = {
    pending: "等待中",
    running: "执行中",
    completed: "已完成",
    failed: "失败",
    skipped: "已跳过",
  };
  return textMap[status] || "未知";
};

export const getProgressStatus = (status) => {
  if (status === "failed") {
    return "exception";
  }
  if (status === "completed") {
    return "success";
  }
  return "active";
};

export const getStepClass = (step) => {
  return {
    completed: step.status === "completed",
    running: step.status === "running",
    failed: step.status === "failed",
    pending: step.status === "pending",
  };
};

export const getScoreColor = (score) => {
  if (score >= 0.8) {
    return "#52c41a";
  }
  if (score >= 0.6) {
    return "#faad14";
  }
  return "#ff4d4f";
};

export const formatDuration = (ms) => {
  if (!ms || ms === 0) {
    return "";
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}分${remainingSeconds}秒`;
};

export const formatDetails = (details) => {
  if (typeof details === "string") {
    return details;
  }
  return JSON.stringify(details, null, 2);
};
