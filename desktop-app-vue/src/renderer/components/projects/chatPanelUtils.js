import { marked } from "marked";
import { logger } from "@/utils/logger";

/**
 * 清理JSON字符串中的控制字符
 * 修复 "Bad control character in string literal" 错误
 * 注意：不能转义结构性空白（换行、制表符），只移除有害的控制字符
 * @param {string} jsonString - 原始JSON字符串
 * @returns {string} 清理后的JSON字符串
 */
export const sanitizeJSONString = (jsonString) => {
  if (!jsonString || typeof jsonString !== "string") {
    return jsonString;
  }

  // 只移除有害的控制字符，保留换行符、制表符等JSON合法的空白字符
  // \x00-\x08: NUL到BS（退格之前）
  // \x0B: 垂直制表符
  // \x0C: 换页符
  // \x0E-\x1F: 其他控制字符（不包括 \x09=TAB, \x0A=LF, \x0D=CR）
  // \x7F-\x9F: DEL和扩展控制字符
  // eslint-disable-next-line no-control-regex
  return jsonString.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
};

export const WINDOWS_RESERVED_FILE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export const sanitizeFileName = (rawName, fallbackName = "document") => {
  const baseName = String(rawName || fallbackName)
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
  const normalized = baseName || fallbackName;
  const safeName = WINDOWS_RESERVED_FILE_NAMES.has(normalized.toUpperCase())
    ? `${normalized}_file`
    : normalized;
  return safeName.slice(0, 120);
};

export const getDirectoryPath = (targetPath) => {
  if (!targetPath || typeof targetPath !== "string") {
    return "";
  }
  const normalized = targetPath.trim();
  const lastSlashIndex = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  if (lastSlashIndex <= 0) {
    return normalized;
  }
  return normalized.slice(0, lastSlashIndex);
};

export const joinPath = (dirPath, fileName) => {
  const separator = dirPath.includes("\\") ? "\\" : "/";
  return dirPath.endsWith("/") || dirPath.endsWith("\\")
    ? `${dirPath}${fileName}`
    : `${dirPath}${separator}${fileName}`;
};

export const resolveProjectOutput = async (
  projectId,
  rawBaseName,
  extension,
  fallbackBaseName,
) => {
  const project = await window.electronAPI.project.get(projectId);
  if (!project || !project.root_path) {
    throw new Error("无法获取项目路径，请确保项目已正确配置");
  }

  let targetDir = project.root_path;
  try {
    const statResult = await window.electronAPI.file.stat(targetDir);
    if (statResult?.success && statResult.stats?.isFile) {
      targetDir = getDirectoryPath(targetDir);
    }
  } catch (statError) {
    logger.warn("[ChatPanel] 项目路径检查失败，按目录继续处理:", statError);
  }

  if (!targetDir) {
    throw new Error("项目路径无效，无法生成输出文件");
  }

  const safeBaseName = sanitizeFileName(rawBaseName, fallbackBaseName);
  const fileName = `${safeBaseName}.${extension}`;
  const outputPath = joinPath(targetDir, fileName);

  return { fileName, outputPath, targetDir };
};

/**
 * 清理对象，移除不可序列化的内容（用于IPC传输）
 * @param {any} obj - 要清理的对象
 * @returns {any} 清理后的对象
 */
export const cleanForIPC = (obj) => {
  try {
    // 使用JSON序列化来清理不可序列化的对象
    return JSON.parse(JSON.stringify(obj));
  } catch (error) {
    logger.error("[ChatPanel] 清理对象失败，使用手动清理:", error);

    // 如果JSON.stringify失败（可能是循环引用），手动清理
    const seen = new WeakSet();

    const clean = (value) => {
      // 处理基本类型
      if (value === null || typeof value !== "object") {
        return value;
      }

      // 检测循环引用
      if (seen.has(value)) {
        return "[Circular]";
      }

      seen.add(value);

      // 处理数组
      if (Array.isArray(value)) {
        return value.map((item) => clean(item));
      }

      // 处理普通对象
      const cleaned = {};
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const val = value[key];
          // 跳过函数
          if (typeof val === "function") {
            continue;
          }
          // 跳过Symbol
          if (typeof val === "symbol") {
            continue;
          }
          // 跳过undefined
          if (val === undefined) {
            continue;
          }

          cleaned[key] = clean(val);
        }
      }

      return cleaned;
    };

    return clean(obj);
  }
};

/**
 * Empty-state header label, varies by chat context mode.
 */
export const getEmptyStateText = (contextMode) => {
  if (contextMode === "project") {
    return "项目 AI 助手";
  }
  if (contextMode === "file") {
    return "文件 AI 助手";
  }
  return "AI 助手";
};

/**
 * Empty-state secondary hint, varies by context mode + current file.
 */
export const getEmptyHint = (contextMode, currentFileName) => {
  if (contextMode === "project") {
    return '询问项目相关问题，比如"这个项目有哪些文件？"';
  }
  if (contextMode === "file" && currentFileName) {
    return `询问关于 ${currentFileName} 的问题`;
  }
  if (contextMode === "file") {
    return "请先从左侧选择一个文件";
  }
  return "开始新对话";
};

/**
 * Input placeholder, varies by context mode + current file.
 */
export const getInputPlaceholder = (contextMode, currentFileName) => {
  if (contextMode === "project") {
    return "询问项目相关问题...";
  }
  if (contextMode === "file" && currentFileName) {
    return `询问关于 ${currentFileName} 的问题...`;
  }
  if (contextMode === "file") {
    return "请先选择一个文件...";
  }
  return "输入消息...";
};

/**
 * Render Markdown to (sanitized) HTML. marked is configured globally
 * with safe-mode escaping; this helper just normalizes object inputs
 * and adds an XSS-safe fallback when marked itself throws.
 */
export const renderMarkdown = (content) => {
  try {
    let textContent = content;
    if (typeof content === "object") {
      textContent =
        content?.text || content?.content || JSON.stringify(content);
    }
    textContent = String(textContent || "");
    return marked.parse(textContent);
  } catch (error) {
    logger.error("Markdown 渲染失败:", error);
    const div = document.createElement("div");
    div.textContent = String(content || "");
    return div.innerHTML;
  }
};

/**
 * Friendly relative timestamp.
 *  < 1m     → "刚刚"
 *  < 1h     → "N分钟前"
 *  < 24h    → "N小时前"
 *  same day → "HH:mm"
 *  else     → "MM-DD HH:mm" (zh-CN)
 */
export const formatTime = (timestamp) => {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) {
    return "刚刚";
  }
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`;
  }
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}小时前`;
  }
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};
