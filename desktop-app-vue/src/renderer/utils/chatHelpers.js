/**
 * Chat 相关工具函数
 * 从 ChatPanel.vue 提取，供多个子组件复用
 */

import { logger, createLogger } from '@/utils/logger';
import { marked } from 'marked';

// 配置 marked 选项
marked.setOptions({
  breaks: true,
  gfm: true,
  sanitize: false, // marked 3.0+ 不再支持 sanitize，改用自定义渲染器
});

/**
 * 清理JSON字符串中的控制字符（用于修复无效JSON）
 * 注意：不能转义结构性空白（换行、制表符），只移除有害的控制字符
 * @param {string} jsonString - 原始JSON字符串
 * @returns {string} 清理后的JSON字符串
 */
export const sanitizeJSONString = (jsonString) => {
  if (!jsonString || typeof jsonString !== 'string') {
    return jsonString;
  }

  // 只移除有害的控制字符，保留换行符、制表符等JSON合法的空白字符
  // \x00-\x08: NUL到BS（退格之前）
  // \x0B: 垂直制表符
  // \x0C: 换页符
  // \x0E-\x1F: 其他控制字符（不包括 \x09=TAB, \x0A=LF, \x0D=CR）
  // \x7F-\x9F: DEL和扩展控制字符
  return jsonString.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
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
    logger.error('[ChatHelpers] 清理对象失败，使用手动清理:', error);

    // 如果JSON.stringify失败（可能是循环引用），手动清理
    const seen = new WeakSet();

    const clean = (value) => {
      // 处理基本类型
      if (value === null || typeof value !== 'object') {
        return value;
      }

      // 检测循环引用
      if (seen.has(value)) {
        return '[Circular]';
      }

      seen.add(value);

      // 处理数组
      if (Array.isArray(value)) {
        return value.map((item) => clean(item));
      }

      // 处理普通对象
      const cleaned = {};
      for (const key in value) {
        if (value.hasOwnProperty(key)) {
          const val = value[key];
          // 跳过函数
          if (typeof val === 'function') continue;
          // 跳过Symbol
          if (typeof val === 'symbol') continue;
          // 跳过undefined
          if (val === undefined) continue;

          cleaned[key] = clean(val);
        }
      }

      return cleaned;
    };

    return clean(obj);
  }
};

/**
 * 渲染 Markdown 为 HTML
 * @param {string|object} content - Markdown 内容
 * @returns {string} HTML 字符串
 */
export const renderMarkdown = (content) => {
  try {
    // 确保 content 是字符串
    let textContent = content;
    if (typeof content === 'object') {
      // 如果是对象，尝试提取文本内容
      textContent = content?.text || content?.content || JSON.stringify(content);
    }
    textContent = String(textContent || '');

    // marked.parse() 已配置为安全模式，会自动转义危险内容
    const rawHTML = marked.parse(textContent);
    return rawHTML;
  } catch (error) {
    logger.error('[ChatHelpers] Markdown 渲染失败:', error);
    // 发生错误时，转义文本以防止 XSS
    const div = document.createElement('div');
    div.textContent = String(content || '');
    return div.innerHTML;
  }
};

/**
 * 格式化时间为友好显示
 * @param {number|string|Date} timestamp - 时间戳
 * @returns {string} 格式化后的时间字符串
 */
export const formatTime = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 小于1分钟
  if (diff < 60000) {
    return '刚刚';
  }

  // 小于1小时
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`;
  }

  // 小于24小时
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}小时前`;
  }

  // 今天
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // 超过今天
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * 获取空状态文本
 * @param {string} contextMode - 上下文模式 (project|file|global)
 * @returns {string} 空状态文本
 */
export const getEmptyStateText = (contextMode) => {
  if (contextMode === 'project') {
    return '项目 AI 助手';
  } else if (contextMode === 'file') {
    return '文件 AI 助手';
  }
  return 'AI 助手';
};

/**
 * 获取空状态提示
 * @param {string} contextMode - 上下文模式
 * @param {object} currentFile - 当前文件对象
 * @returns {string} 空状态提示文本
 */
export const getEmptyHint = (contextMode, currentFile) => {
  if (contextMode === 'project') {
    return '询问项目相关问题，比如"这个项目有哪些文件？"';
  } else if (contextMode === 'file' && currentFile) {
    return `询问关于 ${currentFile.file_name} 的问题`;
  } else if (contextMode === 'file') {
    return '请先从左侧选择一个文件';
  }
  return '开始新对话';
};

/**
 * 获取输入框占位符文本
 * @param {string} contextMode - 上下文模式
 * @param {object} currentFile - 当前文件对象
 * @returns {string} 占位符文本
 */
export const getInputPlaceholder = (contextMode, currentFile) => {
  if (contextMode === 'project') {
    return '询问项目相关问题...';
  } else if (contextMode === 'file' && currentFile) {
    return `询问关于 ${currentFile.file_name} 的问题...`;
  } else if (contextMode === 'file') {
    return '请先选择一个文件...';
  }
  return '输入消息...';
};

/**
 * 获取上下文信息文本
 * @param {string} contextMode - 上下文模式
 * @param {object} currentFile - 当前文件对象
 * @returns {string} 上下文信息文本
 */
export const getContextInfo = (contextMode, currentFile) => {
  if (contextMode === 'project') {
    return '当前上下文：整个项目';
  } else if (contextMode === 'file' && currentFile) {
    return `当前上下文：${currentFile.file_name}`;
  } else if (contextMode === 'file') {
    return '请先选择一个文件';
  }
  return null;
};
