/**
 * 文件操作工具函数
 */

import { logger, createLogger } from '@/utils/logger';
import { fileMetadataCache } from './lru-cache';

// 文件类型检测缓存（使用LRU Cache优化）
const FILE_TYPE_CACHE_ENABLED = true;

/**
 * 安全地拼接文件路径，防止路径遍历攻击
 * @param {string} basePath - 基础路径（项目根路径）
 * @param {string} relativePath - 相对路径
 * @returns {string} 安全的完整路径
 * @throws {Error} 如果路径不安全
 */
export function sanitizePath(basePath, relativePath) {
  if (!basePath || !relativePath) {
    throw new Error('路径参数不能为空');
  }

  // 使用path模块的替代方案（浏览器环境）
  const normalize = (p) => {
    // 移除多余的斜杠和反斜杠
    return p.replace(/[/\\]+/g, '/').replace(/\/$/, '');
  };

  const join = (base, relative) => {
    const cleanBase = normalize(base);
    const cleanRelative = relative.replace(/^[/\\]+/, '');
    return `${cleanBase}/${cleanRelative}`;
  };

  // 规范化路径
  const normalizedBase = normalize(basePath);
  const fullPath = join(basePath, relativePath);
  const normalizedFull = normalize(fullPath);

  // 检查是否包含路径遍历字符
  if (relativePath.includes('..')) {
    throw new Error('路径不能包含 ".." 字符');
  }

  // 检查完整路径是否在基础路径下
  // 需要考虑Windows路径（C:\）和Unix路径（/）
  const basePathLower = normalizedBase.toLowerCase();
  const fullPathLower = normalizedFull.toLowerCase();

  if (!fullPathLower.startsWith(basePathLower)) {
    logger.error('[Security] 路径遍历检测失败:', {
      basePath: normalizedBase,
      fullPath: normalizedFull,
    });
    throw new Error('无效的文件路径：超出项目目录范围');
  }

  return fullPath;
}

/**
 * 文件大小限制（字节）
 */
export const FILE_SIZE_LIMITS = {
  TEXT: 10 * 1024 * 1024,      // 10MB - 文本文件
  IMAGE: 50 * 1024 * 1024,     // 50MB - 图片文件
  VIDEO: 500 * 1024 * 1024,    // 500MB - 视频文件
  DOCUMENT: 100 * 1024 * 1024, // 100MB - 文档文件
  DEFAULT: 10 * 1024 * 1024,   // 10MB - 默认限制
};

/**
 * 获取文件类型对应的大小限制
 * @param {string} extension - 文件扩展名
 * @returns {number} 字节数
 */
export function getFileSizeLimit(extension) {
  const ext = extension?.toLowerCase();

  // 文本文件
  const textExtensions = ['txt', 'md', 'js', 'ts', 'vue', 'jsx', 'tsx', 'html', 'css', 'json', 'xml', 'yml', 'yaml'];
  if (textExtensions.includes(ext)) {
    return FILE_SIZE_LIMITS.TEXT;
  }

  // 图片文件
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  if (imageExtensions.includes(ext)) {
    return FILE_SIZE_LIMITS.IMAGE;
  }

  // 视频文件
  const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
  if (videoExtensions.includes(ext)) {
    return FILE_SIZE_LIMITS.VIDEO;
  }

  // 文档文件
  const documentExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
  if (documentExtensions.includes(ext)) {
    return FILE_SIZE_LIMITS.DOCUMENT;
  }

  return FILE_SIZE_LIMITS.DEFAULT;
}

/**
 * 格式化文件大小为人类可读格式
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的大小
 */
export function formatFileSize(bytes) {
  if (bytes === 0) {return '0 B';}
  if (!bytes) {return 'Unknown';}

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * 检查文件大小是否超过限制
 * @param {number} fileSize - 文件大小（字节）
 * @param {string} extension - 文件扩展名
 * @returns {Object} { isValid: boolean, limit: number, message: string }
 */
export function validateFileSize(fileSize, extension) {
  const limit = getFileSizeLimit(extension);

  if (fileSize > limit) {
    return {
      isValid: false,
      limit,
      message: `文件过大 (${formatFileSize(fileSize)})，超过限制 (${formatFileSize(limit)})。建议在外部编辑器中打开。`,
    };
  }

  return {
    isValid: true,
    limit,
    message: '',
  };
}

/**
 * 节流函数
 * @param {Function} func - 要节流的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} 节流后的函数
 */
export function throttle(func, wait = 16) {
  let timeout = null;
  let previous = 0;

  return function (...args) {
    const now = Date.now();
    const remaining = wait - (now - previous);

    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      func.apply(this, args);
    } else if (!timeout) {
      timeout = setTimeout(() => {
        previous = Date.now();
        timeout = null;
        func.apply(this, args);
      }, remaining);
    }
  };
}

/**
 * 防抖函数
 * @param {Function} func - 要防抖的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
export function debounce(func, wait = 300) {
  let timeout = null;

  return function (...args) {
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      func.apply(this, args);
    }, wait);
  };
}

/**
 * 获取文件类型信息（带缓存优化）
 * @param {string} filePath - 文件路径
 * @param {string} fileName - 文件名
 * @returns {Object} 文件类型信息
 */
export function getFileTypeInfo(filePath, fileName) {
  // 尝试从缓存获取
  if (FILE_TYPE_CACHE_ENABLED) {
    const cached = fileMetadataCache.getFileType(filePath);
    if (cached) {
      return cached;
    }
  }

  // 计算文件类型信息
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  const editableExtensions = ['js', 'ts', 'vue', 'jsx', 'tsx', 'html', 'css', 'scss', 'less', 'json', 'md', 'txt', 'xml', 'yml', 'yaml'];
  const excelExtensions = ['xlsx', 'xls', 'csv'];
  const wordExtensions = ['docx', 'doc'];
  const pptExtensions = ['pptx', 'ppt'];
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  const pdfExtensions = ['pdf'];
  const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];

  const typeInfo = {
    extension: ext,
    isEditable: editableExtensions.includes(ext),
    isExcel: excelExtensions.includes(ext),
    isWord: wordExtensions.includes(ext),
    isPPT: pptExtensions.includes(ext),
    isPDF: pdfExtensions.includes(ext),
    isImage: imageExtensions.includes(ext),
    isVideo: videoExtensions.includes(ext),
    isAudio: audioExtensions.includes(ext),
    isCode: ['js', 'ts', 'vue', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c'].includes(ext),
    isMarkdown: ext === 'md',
  };

  // 缓存结果
  if (FILE_TYPE_CACHE_ENABLED) {
    fileMetadataCache.setFileType(filePath, typeInfo);
  }

  return typeInfo;
}

/**
 * 获取缓存统计信息
 * @returns {Object}
 */
export function getCacheStats() {
  return fileMetadataCache.getStats();
}

/**
 * 清空文件类型缓存
 */
export function clearFileTypeCache() {
  fileMetadataCache.clearAll();
}

