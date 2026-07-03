/**
 * Pure display helpers extracted from AdditionalToolsStats.vue
 * (opportunistic split). Category color/name mappings and success-rate
 * formatting — no reactive state, so unit-testable in isolation.
 */

export function getCategoryColor(category) {
  const colorMap = {
    blockchain: "blue",
    finance: "green",
    crm: "orange",
    project: "purple",
    code: "cyan",
    simulation: "magenta",
    analysis: "geekblue",
    management: "lime",
    general: "default",
  };
  return colorMap[category] || "default";
}

export function getCategoryName(category) {
  const nameMap = {
    blockchain: "区块链",
    finance: "财务",
    crm: "CRM",
    project: "项目管理",
    code: "代码生成",
    simulation: "模拟仿真",
    analysis: "分析",
    management: "管理",
    general: "通用",
  };
  return nameMap[category] || category;
}

// 成功率 → 颜色档位（≥90 绿 / ≥70 蓝 / ≥50 黄 / 否则红）
export function getSuccessRateColor(rateStr) {
  const rate = parseFloat(rateStr);
  if (rate >= 90) {
    return "#52c41a";
  }
  if (rate >= 70) {
    return "#1890ff";
  }
  if (rate >= 50) {
    return "#faad14";
  }
  return "#f5222d";
}

// 由 usage/success 计算成功率百分比（无调用记录时返回 0）
export function getToolSuccessRate(tool) {
  if (!tool.usage_count || tool.usage_count === 0) {
    return 0;
  }
  return ((tool.success_count / tool.usage_count) * 100).toFixed(1);
}
