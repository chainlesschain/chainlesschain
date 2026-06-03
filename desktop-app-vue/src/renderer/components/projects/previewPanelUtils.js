/**
 * Pure helpers extracted from PreviewPanel.vue. All inputs are
 * primitives or plain objects; no Vue reactivity or component state.
 */

export const getFileExtension = (fileName = "") => {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1 || lastDot === fileName.length - 1) {
    return "";
  }
  return fileName.slice(lastDot + 1).toLowerCase();
};

export const extractResolvedPath = (resolvedPath, actionLabel = "路径解析") => {
  if (typeof resolvedPath === "string" && resolvedPath) {
    return resolvedPath;
  }

  if (resolvedPath && typeof resolvedPath === "object") {
    if (resolvedPath.success === false) {
      throw new Error(resolvedPath.error || `${actionLabel}失败`);
    }
    if (typeof resolvedPath.path === "string" && resolvedPath.path) {
      return resolvedPath.path;
    }
  }

  throw new Error(`${actionLabel}失败: 无效路径返回`);
};

export const normalizeErrorMessage = (err, fallbackMessage = "加载失败") => {
  if (err instanceof Error && err.message) {
    return err.message;
  }

  if (typeof err === "string" && err.trim()) {
    return err;
  }

  try {
    const serialized = JSON.stringify(err);
    if (serialized && serialized !== "{}" && serialized !== "null") {
      return serialized;
    }
  } catch {
    // serialization fallthrough — return fallbackMessage below
  }

  return fallbackMessage;
};

export const toLogErrorData = (err) => {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return err;
};

export const normalizePreviewFailureMessage = (result, fallbackMessage) => {
  if (!result || typeof result !== "object") {
    return fallbackMessage;
  }

  const baseMessage = result.error || fallbackMessage;
  const details = result.details;
  if (!details) {
    return baseMessage;
  }

  if (typeof details === "string") {
    return `${baseMessage} (${details})`;
  }

  if (typeof details === "object") {
    const detailMessage = details.message || details.name || "";
    return detailMessage ? `${baseMessage} (${detailMessage})` : baseMessage;
  }

  return baseMessage;
};

const FILE_TYPE_COLORS = {
  image: "green",
  markdown: "blue",
  code: "purple",
  csv: "orange",
  json: "cyan",
  pdf: "red",
  video: "magenta",
  audio: "geekblue",
  word: "blue",
  excel: "green",
  powerpoint: "volcano",
  archive: "gold",
  unsupported: "default",
};

export const getFileTypeColor = (fileType) =>
  FILE_TYPE_COLORS[fileType] || "default";

const FILE_TYPE_LABELS = {
  image: "图片",
  markdown: "Markdown",
  code: "代码",
  csv: "CSV表格",
  json: "JSON",
  pdf: "PDF",
  video: "视频",
  audio: "音频",
  word: "Word文档",
  excel: "Excel表格",
  powerpoint: "PowerPoint",
  archive: "压缩包",
  unsupported: "不支持",
};

export const getFileTypeLabel = (fileType) =>
  FILE_TYPE_LABELS[fileType] || "未知";

const LEGACY_OFFICE_EXTENSIONS = {
  word: { legacy: ["doc"], modern: ".docx" },
  excel: { legacy: ["xls"], modern: ".xlsx" },
  powerpoint: { legacy: ["ppt"], modern: ".pptx" },
};

/**
 * Throw if the file's extension is a legacy Office format we can't preview
 * (.doc / .xls / .ppt). Caller passes the file name explicitly so this stays
 * pure — no props.file dependency like the previous in-component version.
 */
export const ensureSupportedOfficeExtension = (targetType, fileName) => {
  const config = LEGACY_OFFICE_EXTENSIONS[targetType];
  if (!config) {
    return;
  }

  const extension = getFileExtension(fileName);
  if (config.legacy.includes(extension)) {
    throw new Error(
      `暂不支持 .${extension} 预览，请转换为 ${config.modern} 后重试`,
    );
  }
};

const CODE_LANGUAGE_MAP = {
  js: "javascript",
  ts: "typescript",
  jsx: "javascript",
  tsx: "typescript",
  vue: "html",
  htm: "html",
  html: "html",
  css: "css",
  scss: "scss",
  less: "less",
  json: "json",
  xml: "xml",
  yml: "yaml",
  yaml: "yaml",
  txt: "plaintext",
};

export const getCodeLanguageForExtension = (extension) =>
  CODE_LANGUAGE_MAP[extension] || "plaintext";
