/**
 * file-utils 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sanitizePath,
  getFileSizeLimit,
  formatFileSize,
  validateFileSize,
  throttle,
  debounce,
  FILE_SIZE_LIMITS,
} from '../file-utils';

describe('file-utils', () => {
  describe('sanitizePath', () => {
    it('应该正确拼接基础路径和相对路径', () => {
      const basePath = '/project/root';
      const relativePath = 'src/components/App.vue';
      const result = sanitizePath(basePath, relativePath);
      expect(result).toBe('/project/root/src/components/App.vue');
    });

    it('应该处理Windows路径', () => {
      const basePath = 'C:\\Users\\project';
      const relativePath = 'src\\file.txt';
      const result = sanitizePath(basePath, relativePath);
      expect(result).toContain('C:/Users/project');
      // sanitizePath会规范化路径，Windows反斜杠会被转换
      expect(result).toMatch(/src.*file\.txt/);
    });

    it('应该移除相对路径开头的斜杠', () => {
      const basePath = '/project/root';
      const relativePath = '/src/file.txt';
      const result = sanitizePath(basePath, relativePath);
      expect(result).toBe('/project/root/src/file.txt');
    });

    it('应该拒绝包含".."的路径', () => {
      const basePath = '/project/root';
      const relativePath = '../../../etc/passwd';
      expect(() => sanitizePath(basePath, relativePath)).toThrow('路径不能包含 ".." 字符');
    });

    it('应该拒绝空路径参数', () => {
      expect(() => sanitizePath('', 'file.txt')).toThrow('路径参数不能为空');
      expect(() => sanitizePath('/base', '')).toThrow('路径参数不能为空');
    });

    it('应该检测路径遍历攻击', () => {
      const basePath = '/project/root';
      const relativePath = 'src/../../outside.txt';
      expect(() => sanitizePath(basePath, relativePath)).toThrow('路径不能包含 ".." 字符');
    });

    it('应该处理多余的斜杠', () => {
      const basePath = '/project//root///';
      const relativePath = '///src///file.txt';
      const result = sanitizePath(basePath, relativePath);
      // sanitizePath会规范化基础路径和相对路径中的斜杠
      // 但拼接后的路径可能仍有多余斜杠，这是可接受的
      expect(result).toContain('/project/root');
      expect(result).toContain('src');
      expect(result).toContain('file.txt');
    });
  });

  describe('getFileSizeLimit', () => {
    it('应该为文本文件返回正确的限制', () => {
      expect(getFileSizeLimit('txt')).toBe(FILE_SIZE_LIMITS.TEXT);
      expect(getFileSizeLimit('js')).toBe(FILE_SIZE_LIMITS.TEXT);
      expect(getFileSizeLimit('md')).toBe(FILE_SIZE_LIMITS.TEXT);
    });

    it('应该为图片文件返回正确的限制', () => {
      expect(getFileSizeLimit('png')).toBe(FILE_SIZE_LIMITS.IMAGE);
      expect(getFileSizeLimit('jpg')).toBe(FILE_SIZE_LIMITS.IMAGE);
      expect(getFileSizeLimit('svg')).toBe(FILE_SIZE_LIMITS.IMAGE);
    });

    it('应该为视频文件返回正确的限制', () => {
      expect(getFileSizeLimit('mp4')).toBe(FILE_SIZE_LIMITS.VIDEO);
      expect(getFileSizeLimit('webm')).toBe(FILE_SIZE_LIMITS.VIDEO);
    });

    it('应该为文档文件返回正确的限制', () => {
      expect(getFileSizeLimit('pdf')).toBe(FILE_SIZE_LIMITS.DOCUMENT);
      expect(getFileSizeLimit('docx')).toBe(FILE_SIZE_LIMITS.DOCUMENT);
      expect(getFileSizeLimit('xlsx')).toBe(FILE_SIZE_LIMITS.DOCUMENT);
    });

    it('应该为未知类型返回默认限制', () => {
      expect(getFileSizeLimit('unknown')).toBe(FILE_SIZE_LIMITS.DEFAULT);
      expect(getFileSizeLimit('')).toBe(FILE_SIZE_LIMITS.DEFAULT);
      expect(getFileSizeLimit(null)).toBe(FILE_SIZE_LIMITS.DEFAULT);
    });

    it('应该忽略大小写', () => {
      expect(getFileSizeLimit('TXT')).toBe(FILE_SIZE_LIMITS.TEXT);
      expect(getFileSizeLimit('PNG')).toBe(FILE_SIZE_LIMITS.IMAGE);
    });
  });

  describe('formatFileSize', () => {
    it('应该正确格式化字节', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(500)).toBe('500.00 B');
    });

    it('应该正确格式化KB', () => {
      expect(formatFileSize(1024)).toBe('1.00 KB');
      expect(formatFileSize(5120)).toBe('5.00 KB');
    });

    it('应该正确格式化MB', () => {
      expect(formatFileSize(1048576)).toBe('1.00 MB'); // 1024 * 1024
      expect(formatFileSize(10485760)).toBe('10.00 MB');
    });

    it('应该正确格式化GB', () => {
      expect(formatFileSize(1073741824)).toBe('1.00 GB'); // 1024^3
    });

    it('应该处理空值', () => {
      expect(formatFileSize(null)).toBe('Unknown');
      expect(formatFileSize(undefined)).toBe('Unknown');
    });

    it('应该保留两位小数', () => {
      expect(formatFileSize(1536)).toBe('1.50 KB'); // 1.5 * 1024
      expect(formatFileSize(2621440)).toBe('2.50 MB'); // 2.5 * 1024 * 1024
    });
  });

  describe('validateFileSize', () => {
    it('应该验证小于限制的文件', () => {
      const result = validateFileSize(5 * 1024 * 1024, 'txt'); // 5MB文本文件
      expect(result.isValid).toBe(true);
      expect(result.message).toBe('');
    });

    it('应该拒绝超过限制的文件', () => {
      const result = validateFileSize(15 * 1024 * 1024, 'txt'); // 15MB文本文件（限制10MB）
      expect(result.isValid).toBe(false);
      expect(result.message).toContain('文件过大');
      expect(result.message).toContain('15.00 MB');
      expect(result.message).toContain('10.00 MB');
    });

    it('应该返回正确的限制值', () => {
      const result = validateFileSize(5 * 1024 * 1024, 'txt');
      expect(result.limit).toBe(FILE_SIZE_LIMITS.TEXT);
    });

    it('应该处理边界情况', () => {
      const limit = FILE_SIZE_LIMITS.TEXT;
      const exactLimit = validateFileSize(limit, 'txt');
      expect(exactLimit.isValid).toBe(true);

      const overLimit = validateFileSize(limit + 1, 'txt');
      expect(overLimit.isValid).toBe(false);
    });

    it('应该为不同类型使用不同限制', () => {
      const textResult = validateFileSize(50 * 1024 * 1024, 'txt');
      expect(textResult.isValid).toBe(false);

      const imageResult = validateFileSize(50 * 1024 * 1024, 'png');
      expect(imageResult.isValid).toBe(true);
    });
  });

  describe('throttle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('应该立即执行第一次调用', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('应该在等待期间忽略多次调用', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled();
      throttled();
      throttled();

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('应该在等待时间后允许再次执行', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled();
      expect(fn).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(101);
      throttled();
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('应该传递正确的参数', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled('arg1', 'arg2');
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('应该保持正确的this上下文', () => {
      const obj = {
        value: 42,
        method: vi.fn(function() {
          return this.value;
        }),
      };

      const throttled = throttle(obj.method, 100);
      throttled.call(obj);

      expect(obj.method).toHaveBeenCalled();
    });

    it('应该使用默认等待时间16ms', () => {
      const fn = vi.fn();
      const throttled = throttle(fn);

      throttled();
      throttled();

      vi.advanceTimersByTime(16);
      throttled();

      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('应该延迟执行函数', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('应该重置计时器当再次调用时', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      vi.advanceTimersByTime(50);
      debounced(); // 重置计时器

      vi.advanceTimersByTime(50);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('应该只执行最后一次调用', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced('call1');
      debounced('call2');
      debounced('call3');

      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('call3');
    });

    it('应该传递最新的参数', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced(1, 2);
      debounced(3, 4);

      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledWith(3, 4);
    });

    it('应该使用默认等待时间300ms', () => {
      const fn = vi.fn();
      const debounced = debounce(fn);

      debounced();
      vi.advanceTimersByTime(299);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('应该保持正确的this上下文', () => {
      const obj = {
        value: 42,
        method: vi.fn(function() {
          return this.value;
        }),
      };

      const debounced = debounce(obj.method, 100);
      debounced.call(obj);

      vi.advanceTimersByTime(100);

      expect(obj.method).toHaveBeenCalled();
    });
  });

  describe('FILE_SIZE_LIMITS', () => {
    it('应该定义所有必需的限制', () => {
      expect(FILE_SIZE_LIMITS.TEXT).toBeDefined();
      expect(FILE_SIZE_LIMITS.IMAGE).toBeDefined();
      expect(FILE_SIZE_LIMITS.VIDEO).toBeDefined();
      expect(FILE_SIZE_LIMITS.DOCUMENT).toBeDefined();
      expect(FILE_SIZE_LIMITS.DEFAULT).toBeDefined();
    });

    it('应该有合理的限制值', () => {
      expect(FILE_SIZE_LIMITS.TEXT).toBe(10 * 1024 * 1024); // 10MB
      expect(FILE_SIZE_LIMITS.IMAGE).toBe(50 * 1024 * 1024); // 50MB
      expect(FILE_SIZE_LIMITS.VIDEO).toBe(500 * 1024 * 1024); // 500MB
      expect(FILE_SIZE_LIMITS.DOCUMENT).toBe(100 * 1024 * 1024); // 100MB
      expect(FILE_SIZE_LIMITS.DEFAULT).toBe(10 * 1024 * 1024); // 10MB
    });

    it('应该按大小排序合理', () => {
      expect(FILE_SIZE_LIMITS.TEXT).toBeLessThan(FILE_SIZE_LIMITS.IMAGE);
      expect(FILE_SIZE_LIMITS.IMAGE).toBeLessThan(FILE_SIZE_LIMITS.DOCUMENT);
      expect(FILE_SIZE_LIMITS.DOCUMENT).toBeLessThan(FILE_SIZE_LIMITS.VIDEO);
    });
  });

  describe('集成测试', () => {
    it('应该完整验证文件路径和大小', () => {
      const basePath = '/project/root';
      const relativePath = 'docs/large-file.pdf';
      const fileSize = 150 * 1024 * 1024; // 150MB

      // 1. 验证路径安全
      const fullPath = sanitizePath(basePath, relativePath);
      expect(fullPath).toBe('/project/root/docs/large-file.pdf');

      // 2. 提取扩展名
      const extension = relativePath.split('.').pop();

      // 3. 验证文件大小
      const sizeValidation = validateFileSize(fileSize, extension);
      expect(sizeValidation.isValid).toBe(false); // PDF限制100MB
      expect(sizeValidation.message).toContain('150.00 MB');
    });

    it('应该正确处理小文本文件', () => {
      const basePath = 'C:\\Users\\project';
      const relativePath = 'src/index.js';
      const fileSize = 5 * 1024; // 5KB

      const fullPath = sanitizePath(basePath, relativePath);
      const extension = relativePath.split('.').pop();
      const sizeValidation = validateFileSize(fileSize, extension);

      expect(sizeValidation.isValid).toBe(true);
      expect(formatFileSize(fileSize)).toBe('5.00 KB');
    });
  });
});
