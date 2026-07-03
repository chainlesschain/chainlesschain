/**
 * Pure helpers extracted from RecordingPanel.vue (opportunistic split).
 * Duration / timestamp formatting and browser-event type label+color+
 * description. No reactive state — unit-testable in isolation.
 */

export const formatDuration = (ms) => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  } else if (minutes > 0) {
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return `${seconds}s`;
};

export const formatTimestamp = (timestamp) => {
  return new Date(timestamp).toLocaleString("zh-CN");
};

export const formatEventTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString("zh-CN");
};

export const getEventTypeLabel = (type) => {
  const labels = {
    click: "点击",
    type: "输入",
    navigate: "导航",
    scroll: "滚动",
    key: "按键",
    select: "选择",
    hover: "悬停",
    focus: "聚焦",
    blur: "失焦",
  };
  return labels[type] || type;
};

export const getEventColor = (type) => {
  const colors = {
    click: "blue",
    type: "green",
    navigate: "purple",
    scroll: "orange",
    key: "cyan",
  };
  return colors[type] || "default";
};

export const getEventDescription = (event) => {
  switch (event.type) {
    case "click":
      return `点击 ${event.selector || "元素"}`;
    case "type":
      return `输入 "${event.text || ""}"`;
    case "navigate":
      return `导航到 ${event.url || ""}`;
    case "scroll":
      return `滚动到 (${event.x}, ${event.y})`;
    case "key":
      return `按键 ${event.key || ""}`;
    default:
      return event.description || "";
  }
};
