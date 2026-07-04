/**
 * Pure helpers extracted from WorkflowProgress.vue (opportunistic split).
 * Stage-key lookup, stage description, step icon class map, and duration
 * formatting. No reactive state — unit-testable in isolation.
 *
 * NOTE: the statusText/statusColor/can* computeds + toggle* handlers stay in
 * the SFC — they read/mutate the reactive `workflow` / expand refs.
 */

export const getStageKey = (index) => {
  const keys = [
    "analysis",
    "design",
    "generation",
    "validation",
    "integration",
    "delivery",
  ];
  return keys[index] || "unknown";
};

export const getStageDescription = (stage) => {
  if (stage.status === "completed") {
    return `完成 (${formatDuration(stage.duration)})`;
  }
  if (stage.status === "running") {
    return `${stage.progress || 0}%`;
  }
  if (stage.status === "failed") {
    return "失败";
  }
  return "";
};

export const getStepIconClass = (stage) => {
  return {
    completed: stage.status === "completed",
    running: stage.status === "running",
    failed: stage.status === "failed",
    pending: stage.status === "pending",
  };
};

export const formatDuration = (ms) => {
  if (!ms || ms === 0) {
    return "0秒";
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}分${remainingSeconds}秒`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}时${remainingMinutes}分`;
};
