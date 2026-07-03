/**
 * Pure helpers extracted from VirtualFileTree.vue (opportunistic split).
 * Icon CSS-class-by-extension and git-status color. No reactive state.
 *
 * NOTE: `getFileIcon` stays in the SFC — it returns Ant Design icon
 * *components*, so extracting it would couple this util to ant-design-vue.
 */

export const getIconColor = (item) => {
  if (!item.isLeaf) {
    return "folder-icon";
  }

  const ext = item.title.split(".").pop()?.toLowerCase();
  const colorMap = {
    md: "text-blue-500",
    js: "text-yellow-500",
    ts: "text-blue-600",
    vue: "text-green-500",
    html: "text-orange-500",
    css: "text-blue-400",
    json: "text-gray-500",
  };

  return colorMap[ext] || "file-icon";
};

export const getGitStatusColor = (status) => {
  const colorMap = {
    modified: "orange",
    added: "green",
    deleted: "red",
    untracked: "blue",
  };
  return colorMap[status] || "default";
};
