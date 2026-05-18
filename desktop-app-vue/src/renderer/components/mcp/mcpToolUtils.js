export const normalizeToolSchema = (tool) => {
  return (
    tool?.inputSchema || tool?.parameters || { type: "object", properties: {} }
  );
};

export const normalizeToolDescriptor = (tool) => {
  const schema = normalizeToolSchema(tool);
  const isReadOnly = tool?.isReadOnly === true;
  return {
    ...tool,
    title: tool?.title || tool?.name || "",
    inputSchema: schema,
    parameters: schema,
    category: tool?.category || (isReadOnly ? "read" : "execute"),
    riskLevel: tool?.riskLevel || (isReadOnly ? "low" : "medium"),
    isReadOnly,
  };
};

export const getToolCategoryColor = (category) => {
  const colors = {
    read: "green",
    write: "orange",
    delete: "red",
    execute: "blue",
    skill: "purple",
    filesystem: "cyan",
    git: "geekblue",
  };
  return colors[category] || "default";
};

export const getToolCategoryLabel = (category) => {
  const labels = {
    read: "Read",
    write: "Write",
    delete: "Delete",
    execute: "Execute",
    skill: "Skill",
    filesystem: "Filesystem",
    git: "Git",
  };
  return labels[category] || category || "Unknown";
};

export const getToolRiskColor = (riskLevel) => {
  const colors = {
    low: "green",
    medium: "orange",
    high: "red",
  };
  return colors[riskLevel] || "default";
};

export const getToolRiskLabel = (riskLevel) => {
  const labels = {
    low: "Low",
    medium: "Medium",
    high: "High",
  };
  return labels[riskLevel] || riskLevel || "Unknown";
};

export const formatToolResult = (result) => {
  if (!result) {
    return "";
  }

  try {
    if (result.success && result.result) {
      if (Array.isArray(result.result.content)) {
        return result.result.content
          .map((item) => {
            if (item.type === "text") {
              return item.text;
            } else if (item.type === "image") {
              return `[图片: ${item.mimeType}]`;
            } else if (item.type === "resource") {
              return `[资源: ${item.uri}]`;
            }
            return JSON.stringify(item, null, 2);
          })
          .join("\n");
      }
      return JSON.stringify(result.result, null, 2);
    }
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
};
