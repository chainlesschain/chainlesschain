/**
 * 文件安全性验证器
 *
 * 职责：
 * - 验证文件类型安全性
 * - 检查文件大小限制
 * - 防止恶意文件
 */

const { logger } = require('../utils/logger.js');
const path = require('path');

/**
 * 安全配置
 */
const SECURITY_CONFIG = {
  // 允许的MIME类型模式
  allowedMimePatterns: [
    'text/*',
    'application/pdf',
    'application/msword',
    'application/vnd.ms-*',
    'application/vnd.openxmlformats-officedocument.*',
    'application/vnd.oasis.opendocument.*',
    'image/*',
    'video/*',
    'audio/*',
    'application/json',
    'application/xml',
    'application/zip',
    'application/x-7z-compressed',
    'application/x-rar-compressed',
    'application/x-tar',
    'application/gzip',
  ],

  // 禁止的文件扩展名（可执行文件）
  blockedExtensions: [
    // Windows executables
    '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.vbs', '.ws', '.wsf',
    '.ps1', '.psm1', '.psd1',
    // macOS executables
    '.app', '.dmg', '.pkg', '.command',
    // Linux executables
    '.sh', '.run', '.bin',
    // Script files
    '.js', '.vbe', '.jse', '.wsh',
    // System files
    '.dll', '.sys', '.drv',
    // Other potentially dangerous
    '.hta', '.jar', '.apk', '.dex',
  ],

  // 危险MIME类型（明确禁止）
  dangerousMimeTypes: [
    'application/x-msdownload',
    'application/x-msdos-program',
    'application/x-executable',
    'application/x-sh',
    'application/x-bat',
    'application/x-ms-application',
    'application/vnd.microsoft.portable-executable',
  ],

  // 文件大小限制（500MB）
  maxFileSize: 500 * 1024 * 1024,

  // 最小文件大小（防止空文件）
  minFileSize: 1,

  // 允许的最大文件名长度
  maxFileNameLength: 255,
};

/**
 * 文件安全性验证器类
 */
class FileSecurityValidator {
  constructor(customConfig = {}) {
    // 合并自定义配置
    this.config = {
      ...SECURITY_CONFIG,
      ...customConfig,
    };

    logger.info('[FileSecurityValidator] 初始化完成', {
      maxFileSize: `${(this.config.maxFileSize / 1024 / 1024).toFixed(2)} MB`,
      blockedExtensions: this.config.blockedExtensions.length,
    });
  }

  /**
   * 验证文件安全性
   * @param {Object} file - 文件对象
   * @param {string} file.display_name - 文件名
   * @param {number} file.file_size - 文件大小（字节）
   * @param {string} file.mime_type - MIME类型
   * @returns {Object} 验证结果
   */
  validate(file) {
    const errors = [];
    const warnings = [];

    // 1. 检查文件是否存在必要信息
    if (!file || !file.display_name) {
      return {
        valid: false,
        errors: ['文件信息不完整'],
        warnings: [],
      };
    }

    // 2. 检查文件大小
    const sizeCheck = this.checkFileSize(file.file_size);
    if (!sizeCheck.valid) {
      errors.push(...sizeCheck.errors);
    }

    // 3. 检查文件扩展名
    const extCheck = this.checkFileExtension(file.display_name);
    if (!extCheck.valid) {
      errors.push(...extCheck.errors);
    }
    warnings.push(...extCheck.warnings);

    // 4. 检查MIME类型
    if (file.mime_type) {
      const mimeCheck = this.checkMimeType(file.mime_type);
      if (!mimeCheck.valid) {
        errors.push(...mimeCheck.errors);
      }
      warnings.push(...mimeCheck.warnings);
    }

    // 5. 检查文件名长度
    if (file.display_name.length > this.config.maxFileNameLength) {
      errors.push(`文件名过长: ${file.display_name.length} > ${this.config.maxFileNameLength}`);
    }

    // 6. 检查文件名特殊字符
    const nameCheck = this.checkFileName(file.display_name);
    if (!nameCheck.valid) {
      warnings.push(...nameCheck.warnings);
    }

    const valid = errors.length === 0;

    if (!valid) {
      logger.warn('[FileSecurityValidator] 文件验证失败:', {
        fileName: file.display_name,
        errors,
      });
    }

    return {
      valid,
      errors,
      warnings,
    };
  }

  /**
   * 检查文件大小
   * @param {number} size - 文件大小（字节）
   * @returns {Object} 检查结果
   */
  checkFileSize(size) {
    const errors = [];

    if (typeof size !== 'number' || size < 0) {
      errors.push('文件大小无效');
    } else if (size < this.config.minFileSize) {
      errors.push('文件大小过小，可能是空文件');
    } else if (size > this.config.maxFileSize) {
      const maxSizeMB = (this.config.maxFileSize / 1024 / 1024).toFixed(2);
      const actualSizeMB = (size / 1024 / 1024).toFixed(2);
      errors.push(`文件过大: ${actualSizeMB}MB 超过限制 ${maxSizeMB}MB`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 检查文件扩展名
   * @param {string} fileName - 文件名
   * @returns {Object} 检查结果
   */
  checkFileExtension(fileName) {
    const errors = [];
    const warnings = [];

    const ext = path.extname(fileName).toLowerCase();

    // 检查是否为禁止的扩展名
    if (this.config.blockedExtensions.includes(ext)) {
      errors.push(`禁止的文件类型: ${ext} (可执行文件)`);
    }

    // 检查是否有双扩展名（常见的恶意软件技巧）
    const extParts = fileName.split('.').slice(1);
    if (extParts.length > 2) {
      warnings.push(`文件名包含多个扩展名，可能存在风险: ${extParts.join('.')}`);
    }

    // 检查隐藏扩展名
    if (extParts.some(part => this.config.blockedExtensions.includes('.' + part.toLowerCase()))) {
      errors.push('文件名包含隐藏的危险扩展名');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 检查MIME类型
   * @param {string} mimeType - MIME类型
   * @returns {Object} 检查结果
   */
  checkMimeType(mimeType) {
    const errors = [];
    const warnings = [];

    if (!mimeType) {
      warnings.push('MIME类型未指定');
      return { valid: true, errors, warnings };
    }

    // 检查是否为明确禁止的MIME类型
    if (this.config.dangerousMimeTypes.includes(mimeType)) {
      errors.push(`禁止的MIME类型: ${mimeType} (可执行文件)`);
      return { valid: false, errors, warnings };
    }

    // 检查是否匹配允许的MIME类型模式
    const isAllowed = this.config.allowedMimePatterns.some(pattern => {
      if (pattern.endsWith('*')) {
        // 通配符模式
        return mimeType.startsWith(pattern.slice(0, -1));
      } else {
        // 精确匹配
        return mimeType === pattern;
      }
    });

    if (!isAllowed) {
      errors.push(`不支持的MIME类型: ${mimeType}`);
    }

    // 检查MIME类型与扩展名是否一致（警告）
    if (mimeType.includes('executable') || mimeType.includes('script')) {
      warnings.push('MIME类型指示可能为可执行文件');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 检查文件名
   * @param {string} fileName - 文件名
   * @returns {Object} 检查结果
   */
  checkFileName(fileName) {
    const warnings = [];

    // 检查特殊字符
    const dangerousChars = /[<>:"|?*]/;
    const hasControlChars = [...fileName].some((char) => char.charCodeAt(0) <= 31);
    if (dangerousChars.test(fileName) || hasControlChars) {
      warnings.push('文件名包含特殊字符');
    }

    // 检查Unicode字符（可能用于欺骗）
    const hasUnicode = [...fileName].some((char) => char.charCodeAt(0) > 127);
    if (hasUnicode) {
      warnings.push('文件名包含非ASCII字符，请确认文件来源可信');
    }

    // 检查隐藏文件（以.开头）
    if (fileName.startsWith('.') && fileName !== '.') {
      warnings.push('隐藏文件，请确认是否需要');
    }

    return {
      valid: true,
      warnings,
    };
  }

  /**
   * 批量验证文件
   * @param {Array} files - 文件列表
   * @returns {Object} 批量验证结果
   */
  validateBatch(files) {
    const results = {
      total: files.length,
      valid: 0,
      invalid: 0,
      warnings: 0,
      details: [],
    };

    files.forEach((file, index) => {
      const result = this.validate(file);

      results.details.push({
        index,
        fileName: file.display_name,
        ...result,
      });

      if (result.valid) {
        results.valid++;
      } else {
        results.invalid++;
      }

      if (result.warnings.length > 0) {
        results.warnings++;
      }
    });

    return results;
  }

  /**
   * 获取安全配置
   * @returns {Object} 当前安全配置
   */
  getConfig() {
    return {
      ...this.config,
      // 隐藏内部实现细节
      allowedMimePatternsCount: this.config.allowedMimePatterns.length,
      blockedExtensionsCount: this.config.blockedExtensions.length,
    };
  }

  /**
   * 更新安全配置
   * @param {Object} newConfig - 新配置
   */
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig,
    };

    logger.info('[FileSecurityValidator] 配置已更新');
  }

  /**
   * 检查文件是否为图片
   * @param {Object} file - 文件对象
   * @returns {boolean} 是否为图片
   */
  isImage(file) {
    return file.mime_type?.startsWith('image/');
  }

  /**
   * 检查文件是否为视频
   * @param {Object} file - 文件对象
   * @returns {boolean} 是否为视频
   */
  isVideo(file) {
    return file.mime_type?.startsWith('video/');
  }

  /**
   * 检查文件是否为文档
   * @param {Object} file - 文件对象
   * @returns {boolean} 是否为文档
   */
  isDocument(file) {
    const docMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.ms-',
      'application/vnd.openxmlformats-officedocument',
      'application/vnd.oasis.opendocument',
      'text/',
    ];

    return docMimeTypes.some(type => file.mime_type?.startsWith(type));
  }

  /**
   * 获取文件风险等级
   * @param {Object} file - 文件对象
   * @returns {string} 风险等级: low, medium, high
   */
  getRiskLevel(file) {
    const validation = this.validate(file);

    if (!validation.valid) {
      return 'high';
    }

    if (validation.warnings.length > 2) {
      return 'medium';
    }

    return 'low';
  }
}

module.exports = FileSecurityValidator;
