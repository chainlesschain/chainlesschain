/**
 * Pure display helpers extracted from OrganizationKnowledgePage.vue
 * (opportunistic split). Relative-time formatting and knowledge type/scope
 * name+color mappings. No reactive state — unit-testable in isolation.
 */

// 相对时间：刚刚 / N分钟前 / 今天 HH:MM / 昨天 HH:MM / 完整日期
export function formatTime(timestamp) {
  if (!timestamp) {
    return "-";
  }
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 1分钟内
  if (diff < 60000) {
    return "刚刚";
  }
  // 1小时内
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`;
  }
  // 今天
  if (date.toDateString() === now.toDateString()) {
    return `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  }
  // 昨天
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `昨天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  }
  // 其他
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 知识类型名称
export function getTypeName(type) {
  const typeMap = {
    note: "笔记",
    document: "文档",
    conversation: "对话",
    web_clip: "网页剪藏",
  };
  return typeMap[type] || type;
}

// 知识类型颜色
export function getTypeColor(type) {
  const colorMap = {
    note: "blue",
    document: "green",
    conversation: "orange",
    web_clip: "purple",
  };
  return colorMap[type] || "default";
}

// 可见范围名称
export function getScopeName(scope) {
  const scopeMap = {
    private: "私有",
    team: "团队",
    org: "组织",
    public: "公开",
  };
  return scopeMap[scope] || scope;
}

// 可见范围颜色
export function getScopeColor(scope) {
  const colorMap = {
    private: "default",
    team: "blue",
    org: "green",
    public: "orange",
  };
  return colorMap[scope] || "default";
}
