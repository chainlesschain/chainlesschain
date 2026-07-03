/**
 * Pure helpers extracted from EnhancedFileTree.vue (opportunistic split).
 * Path/dirname normalization and Git-status → color/label mappings.
 * No reactive state — unit-testable in isolation.
 */

// 取文件路径的目录部分（先归一化 Windows 反斜杠）
export function getDirectoryName(filePath) {
  if (!filePath) {
    return "";
  }
  const normalized = filePath.replace(/\\/g, "/"); // Normalize Windows paths
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.substring(0, lastSlash) : "";
}

// Git 状态颜色
export function getStatusColor(status) {
  const colorMap = {
    modified: "orange",
    added: "green",
    deleted: "red",
    untracked: "blue",
    renamed: "purple",
  };
  return colorMap[status] || "default";
}

// Git 状态标签
export function getStatusLabel(status) {
  const labelMap = {
    modified: "M",
    added: "A",
    deleted: "D",
    untracked: "U",
    renamed: "R",
  };
  return labelMap[status] || "?";
}
