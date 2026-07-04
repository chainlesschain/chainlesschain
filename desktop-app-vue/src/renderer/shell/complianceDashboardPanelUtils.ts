/**
 * Pure helpers extracted from ComplianceDashboardPanel.vue (opportunistic
 * split). Score color, rules summary, DSR status/type color+label, and date
 * formatting. No reactive state — unit-testable in isolation.
 */

export function getScoreColor(score: number): string {
  if (score > 80) {
    return "#52c41a";
  }
  if (score > 60) {
    return "#faad14";
  }
  return "#ff4d4f";
}

export function formatRulesSummary(rules: string): string {
  if (!rules) {
    return "-";
  }
  try {
    const parsed = JSON.parse(rules);
    const keys = Object.keys(parsed);
    if (keys.length === 0) {
      return "-";
    }
    return keys.slice(0, 3).join(", ") + (keys.length > 3 ? "..." : "");
  } catch {
    return rules.length > 50 ? rules.substring(0, 50) + "..." : rules;
  }
}

export function getDSRStatusColor(status: string): string {
  const map: Record<string, string> = {
    pending: "blue",
    in_progress: "orange",
    completed: "green",
    rejected: "red",
  };
  return map[status] || "default";
}

export function getDSRStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "待处理",
    in_progress: "处理中",
    completed: "已完成",
    rejected: "已拒绝",
  };
  return map[status] || status;
}

export function getDSRTypeLabel(type?: string): string {
  const map: Record<string, string> = {
    access: "数据访问",
    deletion: "数据删除",
    rectification: "数据更正",
    portability: "数据迁移",
  };
  return map[type || ""] || type || "-";
}

export function formatDate(timestamp: number): string {
  if (!timestamp) {
    return "-";
  }
  return new Date(timestamp).toLocaleString("zh-CN");
}
