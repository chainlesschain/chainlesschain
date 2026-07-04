/**
 * Pure helpers extracted from EnterpriseAuditPanel.vue (opportunistic split).
 * Time formatting, DID truncation, detail pretty-printing, and event-type /
 * risk-level / outcome color+label maps. No reactive state — unit-testable.
 */
import dayjs from "dayjs";

export function formatTime(timestamp: string | number): string {
  return dayjs(timestamp).format("YYYY-MM-DD HH:mm:ss");
}

export function truncateDid(did: string): string {
  if (!did) {
    return "-";
  }
  if (did.length <= 20) {
    return did;
  }
  return did.substring(0, 10) + "..." + did.substring(did.length - 8);
}

export function formatDetails(details: unknown): string {
  if (!details) {
    return "-";
  }
  if (typeof details === "string") {
    try {
      return JSON.stringify(JSON.parse(details), null, 2);
    } catch {
      return details;
    }
  }
  return JSON.stringify(details, null, 2);
}

export function getEventTypeColor(type: string): string {
  const colors: Record<string, string> = {
    login: "blue",
    permission_change: "purple",
    data_access: "cyan",
    data_modify: "orange",
    data_delete: "red",
    config_change: "gold",
    export: "geekblue",
    system: "default",
  };
  return colors[type] || "default";
}

export function getEventTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    login: "登录",
    permission_change: "权限变更",
    data_access: "数据访问",
    data_modify: "数据修改",
    data_delete: "数据删除",
    config_change: "配置变更",
    export: "数据导出",
    system: "系统事件",
  };
  return labels[type] || type;
}

export function getRiskLevelColor(level: string): string {
  const colors: Record<string, string> = {
    low: "green",
    medium: "orange",
    high: "red",
    critical: "#cf1322",
  };
  return colors[level] || "default";
}

export function getRiskLevelLabel(level: string): string {
  const labels: Record<string, string> = {
    low: "低",
    medium: "中",
    high: "高",
    critical: "严重",
  };
  return labels[level] || level;
}

export function getOutcomeColor(outcome: string): string {
  const colors: Record<string, string> = {
    success: "green",
    failure: "red",
    blocked: "volcano",
    pending: "gold",
  };
  return colors[outcome] || "default";
}

export function getOutcomeLabel(outcome: string): string {
  const labels: Record<string, string> = {
    success: "成功",
    failure: "失败",
    blocked: "已拦截",
    pending: "待处理",
  };
  return labels[outcome] || outcome;
}
