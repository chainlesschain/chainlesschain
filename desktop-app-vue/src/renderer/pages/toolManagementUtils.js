/**
 * Pure helpers extracted from ToolManagement.vue (opportunistic split).
 * Tool category color+name, risk level color+label, and success-rate
 * calculation+color. No reactive state — unit-testable in isolation.
 */

export const getCategoryColor = (category) => {
  const colorMap = {
    file: "blue",
    code: "cyan",
    project: "green",
    system: "volcano",
    output: "orange",
    general: "default",
  };
  return colorMap[category] || "default";
};

export const getCategoryName = (category) => {
  const nameMap = {
    file: "文件操作",
    code: "代码生成",
    project: "项目管理",
    system: "系统操作",
    output: "输出格式化",
    general: "通用",
  };
  return nameMap[category] || category;
};

export const getRiskColor = (level) => {
  const colorMap = {
    1: "success",
    2: "warning",
    3: "orange",
    4: "error",
    5: "red",
  };
  return colorMap[level] || "default";
};

export const getRiskLabel = (level) => {
  const labelMap = {
    1: "低",
    2: "中",
    3: "较高",
    4: "高",
    5: "极高",
  };
  return labelMap[level] || "未知";
};

export const getSuccessRate = (tool) => {
  if (!tool.usage_count || tool.usage_count === 0) {
    return 0;
  }
  return ((tool.success_count / tool.usage_count) * 100).toFixed(1);
};

export const getSuccessRateColor = (tool) => {
  const rate = getSuccessRate(tool);
  if (rate >= 90) {
    return "#52c41a";
  }
  if (rate >= 70) {
    return "#faad14";
  }
  return "#ff4d4f";
};
