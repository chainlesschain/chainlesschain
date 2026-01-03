/**
 * File Validator
 *
 * 文件安全验证器
 * - MIME类型检测
 * - 文件大小限制
 * - 恶意文件检测
 * - 文件扩展名白名单
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * 允许的文件类型配置
 */
const ALLOWED_FILE_TYPES = {
  // 文档类
  document: {
    extensions: ['.md', '.txt', '.pdf', '.doc', '.docx', '.rtf', '.odt'],
    mimeTypes: [
      'text/plain',
      'text/markdown',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/rtf',
      'application/vnd.oasis.opendocument.text',
    ],
    maxSize: 50 * 1024 * 1024, // 50MB
  },

  // 图片类
  image: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'],
    mimeTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/bmp',
      'image/webp',
      'image/svg+xml',
      'image/x-icon',
    ],
    maxSize: 20 * 1024 * 1024, // 20MB
  },

  // 音频类
  audio: {
    extensions: ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'],
    mimeTypes: [
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'audio/mp4',
      'audio/flac',
      'audio/aac',
    ],
    maxSize: 100 * 1024 * 1024, // 100MB
  },

  // 视频类
  video: {
    extensions: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'],
    mimeTypes: [
      'video/mp4',
      'video/x-msvideo',
      'video/x-matroska',
      'video/quicktime',
      'video/x-ms-wmv',
      'video/x-flv',
      'video/webm',
    ],
    maxSize: 500 * 1024 * 1024, // 500MB
  },

  // 压缩包类
  archive: {
    extensions: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'],
    mimeTypes: [
      'application/zip',
      'application/x-rar-compressed',
      'application/x-7z-compressed',
      'application/x-tar',
      'application/gzip',
      'application/x-bzip2',
    ],
    maxSize: 200 * 1024 * 1024, // 200MB
  },

  // 表格类
  spreadsheet: {
    extensions: ['.xls', '.xlsx', '.csv', '.ods'],
    mimeTypes: [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/vnd.oasis.opendocument.spreadsheet',
    ],
    maxSize: 20 * 1024 * 1024, // 20MB
  },

  // 演示文稿类
  presentation: {
    extensions: ['.ppt', '.pptx', '.odp'],
    mimeTypes: [
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.oasis.opendocument.presentation',
    ],
    maxSize: 50 * 1024 * 1024, // 50MB
  },

  // 代码文件
  code: {
    extensions: ['.js', '.ts', '.py', '.java', '.c', '.cpp', '.go', '.rs', '.php', '.rb', '.sh', '.html', '.css', '.json', '.xml', '.yaml', '.yml'],
    mimeTypes: [
      'application/javascript',
      'application/typescript',
      'text/x-python',
      'text/x-java',
      'text/x-c',
      'text/x-c++',
      'text/x-go',
      'text/x-rust',
      'text/x-php',
      'text/x-ruby',
      'text/x-shellscript',
      'text/html',
      'text/css',
      'application/json',
      'application/xml',
      'text/yaml',
    ],
    maxSize: 10 * 1024 * 1024, // 10MB
  },
};

/**
 * 危险文件扩展名黑名单
 */
const DANGEROUS_EXTENSIONS = [
  '.exe', '.dll', '.so', '.dylib',  // 可执行文件
  '.bat', '.cmd', '.sh', '.ps1',     // 脚本文件
  '.msi', '.app', '.deb', '.rpm',    // 安装包
  '.vbs', '.wsf', '.scr',            // 系统脚本
  '.jar', '.apk',                    // Java/Android应用
];

/**
 * 文件头签名 (Magic Numbers)
 * 用于验证真实的文件类型
 */
const FILE_SIGNATURES = {
  // 图片
  'ffd8ff': 'image/jpeg',
  '89504e47': 'image/png',
  '47494638': 'image/gif',
  '424d': 'image/bmp',
  '52494646': 'image/webp',  // RIFF (WebP)

  // 文档
  '25504446': 'application/pdf',
  'd0cf11e0': 'application/msword',  // Office文档
  '504b0304': 'application/zip',     // ZIP (也用于docx, xlsx等)

  // 音频
  '494433': 'audio/mp3',
  '52494646': 'audio/wav',

  // 视频
  '00000018': 'video/mp4',
  '1a45dfa3': 'video/mkv',
};

class FileValidator {
  /**
   * 验证文件
   * @param {string} filePath - 文件路径
   * @param {string} category - 文件类别 (document, image, audio, video, archive, spreadsheet, presentation, code)
   * @returns {Promise<Object>} 验证结果
   */
  static async validateFile(filePath, category = null) {
    const result = {
      valid: false,
      filePath: filePath,
      category: category,
      errors: [],
      warnings: [],
      fileInfo: {},
    };

    try {
      // 1. 检查文件是否存在
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        result.errors.push('Path is not a file');
        return result;
      }

      result.fileInfo.size = stats.size;
      result.fileInfo.modified = stats.mtime;

      // 2. 获取文件扩展名
      const ext = path.extname(filePath).toLowerCase();
      result.fileInfo.extension = ext;

      // 3. 检查是否是危险文件
      if (DANGEROUS_EXTENSIONS.includes(ext)) {
        result.errors.push(`Dangerous file type: ${ext}`);
        return result;
      }

      // 4. 检查文件类别
      let fileCategory = category;
      if (!fileCategory) {
        fileCategory = this.detectCategory(ext);
      }

      if (!fileCategory) {
        result.errors.push(`Unknown file category for extension: ${ext}`);
        return result;
      }

      result.category = fileCategory;
      const categoryConfig = ALLOWED_FILE_TYPES[fileCategory];

      if (!categoryConfig) {
        result.errors.push(`Invalid category: ${fileCategory}`);
        return result;
      }

      // 5. 检查扩展名是否允许
      if (!categoryConfig.extensions.includes(ext)) {
        result.errors.push(`Extension ${ext} not allowed for category ${fileCategory}`);
        return result;
      }

      // 6. 检查文件大小
      if (stats.size > categoryConfig.maxSize) {
        result.errors.push(`File size ${stats.size} exceeds limit ${categoryConfig.maxSize}`);
        return result;
      }

      // 7. 验证文件头签名 (Magic Number)
      const signature = await this.readFileSignature(filePath);
      result.fileInfo.signature = signature;

      // 检查签名是否匹配
      const expectedMimeType = this.getMimeTypeFromSignature(signature);
      if (expectedMimeType && !categoryConfig.mimeTypes.includes(expectedMimeType)) {
        result.warnings.push(`File signature suggests ${expectedMimeType}, but expected ${fileCategory}`);
      }

      // 8. 计算文件哈希 (用于检测恶意文件)
      const hash = await this.calculateFileHash(filePath);
      result.fileInfo.hash = hash;

      // 9. 额外安全检查
      await this.performSecurityChecks(filePath, result);

      // 所有检查通过
      if (result.errors.length === 0) {
        result.valid = true;
      }

      return result;

    } catch (error) {
      result.errors.push(`Validation error: ${error.message}`);
      return result;
    }
  }

  /**
   * 检测文件类别
   */
  static detectCategory(extension) {
    for (const [category, config] of Object.entries(ALLOWED_FILE_TYPES)) {
      if (config.extensions.includes(extension)) {
        return category;
      }
    }
    return null;
  }

  /**
   * 读取文件头签名
   */
  static async readFileSignature(filePath, length = 8) {
    const buffer = Buffer.alloc(length);
    const fd = await fs.open(filePath, 'r');

    try {
      await fd.read(buffer, 0, length, 0);
      return buffer.toString('hex');
    } finally {
      await fd.close();
    }
  }

  /**
   * 根据签名获取MIME类型
   */
  static getMimeTypeFromSignature(signature) {
    for (const [sig, mimeType] of Object.entries(FILE_SIGNATURES)) {
      if (signature.startsWith(sig.toLowerCase())) {
        return mimeType;
      }
    }
    return null;
  }

  /**
   * 计算文件哈希值 (SHA256)
   */
  static async calculateFileHash(filePath) {
    const hash = crypto.createHash('sha256');
    const data = await fs.readFile(filePath);
    hash.update(data);
    return hash.digest('hex');
  }

  /**
   * 执行额外的安全检查
   */
  static async performSecurityChecks(filePath, result) {
    const ext = path.extname(filePath).toLowerCase();

    // 检查SVG文件中的脚本注入
    if (ext === '.svg') {
      const content = await fs.readFile(filePath, 'utf8');

      // 检查是否包含脚本标签
      if (/<script[\s>]/i.test(content)) {
        result.warnings.push('SVG file contains script tags - potential XSS risk');
      }

      // 检查是否包含外部引用
      if (/xlink:href=['"](?!data:)/i.test(content)) {
        result.warnings.push('SVG file contains external references');
      }
    }

    // 检查HTML文件中的危险内容
    if (ext === '.html' || ext === '.htm') {
      const content = await fs.readFile(filePath, 'utf8');

      if (/<script[\s>]/i.test(content)) {
        result.warnings.push('HTML file contains script tags');
      }

      if (/on\w+\s*=/i.test(content)) {
        result.warnings.push('HTML file contains inline event handlers');
      }
    }

    // 检查文件名中的路径遍历
    const basename = path.basename(filePath);
    if (basename.includes('..') || basename.includes('/') || basename.includes('\\')) {
      result.errors.push('Filename contains path traversal characters');
    }
  }

  /**
   * 批量验证文件
   */
  static async validateFiles(filePaths, category = null) {
    const results = [];

    for (const filePath of filePaths) {
      const result = await this.validateFile(filePath, category);
      results.push(result);
    }

    return results;
  }

  /**
   * 获取允许的文件扩展名列表
   */
  static getAllowedExtensions(category = null) {
    if (category) {
      return ALLOWED_FILE_TYPES[category]?.extensions || [];
    }

    // 返回所有类别的扩展名
    const allExtensions = new Set();
    for (const config of Object.values(ALLOWED_FILE_TYPES)) {
      config.extensions.forEach(ext => allExtensions.add(ext));
    }
    return Array.from(allExtensions);
  }

  /**
   * 获取允许的MIME类型列表
   */
  static getAllowedMimeTypes(category = null) {
    if (category) {
      return ALLOWED_FILE_TYPES[category]?.mimeTypes || [];
    }

    // 返回所有类别的MIME类型
    const allMimeTypes = new Set();
    for (const config of Object.values(ALLOWED_FILE_TYPES)) {
      config.mimeTypes.forEach(type => allMimeTypes.add(type));
    }
    return Array.from(allMimeTypes);
  }

  /**
   * 获取最大文件大小
   */
  static getMaxFileSize(category) {
    return ALLOWED_FILE_TYPES[category]?.maxSize || 10 * 1024 * 1024;
  }
}

module.exports = FileValidator;
