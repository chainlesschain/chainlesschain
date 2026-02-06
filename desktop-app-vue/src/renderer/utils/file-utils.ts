/**
 * 文件操作工具函数
 */

import { logger } from '@/utils/logger';
import { fileMetadataCache } from './lru-cache';

// ==================== 类型定义 ====================

/**
 * 文件大小限制
 */
export interface FileSizeLimits {
  TEXT: number;
  IMAGE: number;
  VIDEO: number;
  DOCUMENT: number;
  DEFAULT: number;
}

/**
 * 文件大小验证结果
 */
export interface FileSizeValidationResult {
  isValid: boolean;
  limit: number;
  message: string;
}

/**
 * 文件类型信息
 */
export interface FileTypeInfo {
  extension: string;
  isEditable: boolean;
  isExcel: boolean;
  isWord: boolean;
  isPPT: boolean;
  isPDF: boolean;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  isCode: boolean;
  isMarkdown: boolean;
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

// ==================== 常量 ====================

// 文件类型检测缓存（使用LRU Cache优化）
const FILE_TYPE_CACHE_ENABLED = true;

/**
 * 文件大小限制（字节）
 */
export const FILE_SIZE_LIMITS: FileSizeLimits = {
  TEXT: 10 * 1024 * 1024,      // 10MB - 文本文件
  IMAGE: 50 * 1024 * 1024,     // 50MB - 图片文件
  VIDEO: 500 * 1024 * 1024,    // 500MB - 视频文件
  DOCUMENT: 100 * 1024 * 1024, // 100MB - 文档文件
  DEFAULT: 10 * 1024 * 1024,   // 10MB - 默认限制
};

// 文件扩展名分类
const TEXT_EXTENSIONS = ['txt', 'md', 'js', 'ts', 'vue', 'jsx', 'tsx', 'html', 'css', 'json', 'xml', 'yml', 'yaml'];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
const DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
const EDITABLE_EXTENSIONS = ['js', 'ts', 'vue', 'jsx', 'tsx', 'html', 'css', 'scss', 'less', 'json', 'md', 'txt', 'xml', 'yml', 'yaml'];
const EXCEL_EXTENSIONS = ['xlsx', 'xls', 'csv'];
const WORD_EXTENSIONS = ['docx', 'doc'];
const PPT_EXTENSIONS = ['pptx', 'ppt'];
const PDF_EXTENSIONS = ['pdf'];
const CODE_EXTENSIONS = ['js', 'ts', 'vue', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c'];

// ==================== 路径安全函数 ====================

/**
 * 安全地拼接文件路径，防止路径遍历攻击
 * @param basePath - 基础路径（项目根路径）
 * @param relativePath - 相对路径
 * @returns 安全的完整路径
 * @throws 如果路径不安全
 */
export function sanitizePath(basePath: string, relativePath: string): string {
  if (!basePath || !relativePath) {
    throw new Error('路径参数不能为空');
  }

  // 使用path模块的替代方案（浏览器环境）
  const normalize = (p: string): string => {
    // 移除多余的斜杠和反斜杠
    return p.replace(/[/\\]+/g, '/').replace(/\/$/, '');
  };

  const join = (base: string, relative: string): string => {
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

// ==================== 文件大小函数 ====================

/**
 * 获取文件类型对应的大小限制
 * @param extension - 文件扩展名
 * @returns 字节数
 */
export function getFileSizeLimit(extension: string | undefined): number {
  const ext = extension?.toLowerCase();

  // 文本文件
  if (ext && TEXT_EXTENSIONS.includes(ext)) {
    return FILE_SIZE_LIMITS.TEXT;
  }

  // 图片文件
  if (ext && IMAGE_EXTENSIONS.includes(ext)) {
    return FILE_SIZE_LIMITS.IMAGE;
  }

  // 视频文件
  if (ext && VIDEO_EXTENSIONS.includes(ext)) {
    return FILE_SIZE_LIMITS.VIDEO;
  }

  // 文档文件
  if (ext && DOCUMENT_EXTENSIONS.includes(ext)) {
    return FILE_SIZE_LIMITS.DOCUMENT;
  }

  return FILE_SIZE_LIMITS.DEFAULT;
}

/**
 * 格式化文件大小为人类可读格式
 * @param bytes - 字节数
 * @returns 格式化后的大小
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === 0) { return '0 B'; }
  if (!bytes) { return 'Unknown'; }

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * 检查文件大小是否超过限制
 * @param fileSize - 文件大小（字节）
 * @param extension - 文件扩展名
 * @returns 验证结果
 */
export function validateFileSize(fileSize: number, extension: string): FileSizeValidationResult {
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

// ==================== 节流防抖函数 ====================

/**
 * 节流函数
 * @param func - 要节流的函数
 * @param wait - 等待时间（毫秒）
 * @returns 节流后的函数
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number = 16
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let previous = 0;

  return function (this: any, ...args: Parameters<T>): void {
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
 * @param func - 要防抖的函数
 * @param wait - 等待时间（毫秒）
 * @returns 防抖后的函数
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number = 300
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function (this: any, ...args: Parameters<T>): void {
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      func.apply(this, args);
    }, wait);
  };
}

// ==================== 文件类型函数 ====================

/**
 * 获取文件类型信息（带缓存优化）
 * @param filePath - 文件路径
 * @param fileName - 文件名
 * @returns 文件类型信息
 */
export function getFileTypeInfo(filePath: string, fileName: string): FileTypeInfo {
  // 尝试从缓存获取
  if (FILE_TYPE_CACHE_ENABLED) {
    const cached = fileMetadataCache.getFileType(filePath);
    if (cached) {
      return cached as FileTypeInfo;
    }
  }

  // 计算文件类型信息
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  const typeInfo: FileTypeInfo = {
    extension: ext,
    isEditable: EDITABLE_EXTENSIONS.includes(ext),
    isExcel: EXCEL_EXTENSIONS.includes(ext),
    isWord: WORD_EXTENSIONS.includes(ext),
    isPPT: PPT_EXTENSIONS.includes(ext),
    isPDF: PDF_EXTENSIONS.includes(ext),
    isImage: IMAGE_EXTENSIONS.includes(ext),
    isVideo: VIDEO_EXTENSIONS.includes(ext),
    isAudio: AUDIO_EXTENSIONS.includes(ext),
    isCode: CODE_EXTENSIONS.includes(ext),
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
 * @returns 缓存统计
 */
export function getCacheStats(): CacheStats {
  return fileMetadataCache.getStats();
}

/**
 * 清空文件类型缓存
 */
export function clearFileTypeCache(): void {
  fileMetadataCache.clearAll();
}
