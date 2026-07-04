/**
 * Pure helpers extracted from GitHistoryDialog.vue (opportunistic split).
 * Commit color, file-status color, SHA shortening, and relative/full date
 * formatting (date-fns + zh-cn locale). No reactive state — unit-testable.
 *
 * NOTE: getCommitIcon/getFileStatusIcon stay in the SFC — they return Ant icon
 * components.
 */
import { formatDistanceToNow, format } from "date-fns";
import { zhCN } from "date-fns/locale";

export const getCommitColor = (commit) => {
  if (commit.isHead) {
    return "blue";
  }
  if (commit.isMerge) {
    return "purple";
  }
  return "green";
};

export const getFileStatusColor = (status) => {
  const colorMap = {
    added: "green",
    modified: "orange",
    deleted: "red",
  };
  return colorMap[status] || "default";
};

export const formatSha = (sha) => {
  return sha ? sha.substring(0, 7) : "";
};

export const formatRelativeTime = (timestamp) => {
  try {
    const date =
      typeof timestamp === "number"
        ? new Date(timestamp * 1000)
        : new Date(timestamp);
    return formatDistanceToNow(date, {
      addSuffix: true,
      locale: zhCN,
    });
  } catch {
    return "未知时间";
  }
};

export const formatFullDate = (timestamp) => {
  try {
    const date =
      typeof timestamp === "number"
        ? new Date(timestamp * 1000)
        : new Date(timestamp);
    return format(date, "yyyy-MM-dd HH:mm:ss", { locale: zhCN });
  } catch {
    return "未知时间";
  }
};
