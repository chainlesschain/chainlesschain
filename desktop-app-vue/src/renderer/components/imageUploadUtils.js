/**
 * Pure helpers extracted from ImageUpload.vue (opportunistic split).
 * File size / date formatting, OCR result header, and confidence / quality
 * color+label. No reactive state — unit-testable in isolation.
 */

export const formatFileSize = (bytes) => {
  if (!bytes) {
    return "0 B";
  }
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i];
};

export const formatDate = (timestamp) => {
  if (!timestamp) {
    return "-";
  }
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
};

export const getResultHeader = (result, index) => {
  const status = result.success ? "✓" : "✗";
  const filename = result.path
    ? result.path.split(/[/\\]/).pop()
    : `图片 ${index + 1}`;
  return `${status} ${filename}`;
};

export const getConfidenceColor = (confidence) => {
  if (confidence >= 80) {
    return "green";
  }
  if (confidence >= 60) {
    return "blue";
  }
  if (confidence >= 40) {
    return "orange";
  }
  return "red";
};

export const getQualityColor = (quality) => {
  const colors = {
    high: "green",
    medium: "blue",
    low: "orange",
    very_low: "red",
    unknown: "default",
  };
  return colors[quality] || "default";
};

export const getQualityLabel = (quality) => {
  const labels = {
    high: "高质量",
    medium: "中等质量",
    low: "低质量",
    very_low: "很低质量",
    unknown: "未知",
  };
  return labels[quality] || "未知";
};
