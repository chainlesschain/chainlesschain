/**
 * FileHandler - 文件处理管理器
 *
 * 处理浏览器自动化中的文件操作：
 * - 下载跟踪和管理
 * - 上传处理
 * - 文件类型验证
 * - 下载进度监控
 *
 * @module browser/actions/file-handler
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require("events");
const path = require("path");

// Lazy load fs to allow dependency injection in tests
let fsModule = null;
const getFsModule = () => {
  if (!fsModule) {
    fsModule = require("fs");
  }
  return fsModule;
};

/**
 * 下载状态
 */
const DownloadState = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  FAILED: "failed",
  PAUSED: "paused",
};

/**
 * 文件类型分类
 */
const FileCategory = {
  DOCUMENT: "document",
  IMAGE: "image",
  VIDEO: "video",
  AUDIO: "audio",
  ARCHIVE: "archive",
  CODE: "code",
  DATA: "data",
  EXECUTABLE: "executable",
  OTHER: "other",
};

/**
 * 文件类型映射
 */
const FILE_TYPE_MAP = {
  // Documents
  ".pdf": FileCategory.DOCUMENT,
  ".doc": FileCategory.DOCUMENT,
  ".docx": FileCategory.DOCUMENT,
  ".xls": FileCategory.DOCUMENT,
  ".xlsx": FileCategory.DOCUMENT,
  ".ppt": FileCategory.DOCUMENT,
  ".pptx": FileCategory.DOCUMENT,
  ".txt": FileCategory.DOCUMENT,
  ".rtf": FileCategory.DOCUMENT,
  ".odt": FileCategory.DOCUMENT,

  // Images
  ".jpg": FileCategory.IMAGE,
  ".jpeg": FileCategory.IMAGE,
  ".png": FileCategory.IMAGE,
  ".gif": FileCategory.IMAGE,
  ".bmp": FileCategory.IMAGE,
  ".svg": FileCategory.IMAGE,
  ".webp": FileCategory.IMAGE,
  ".ico": FileCategory.IMAGE,

  // Video
  ".mp4": FileCategory.VIDEO,
  ".avi": FileCategory.VIDEO,
  ".mkv": FileCategory.VIDEO,
  ".mov": FileCategory.VIDEO,
  ".wmv": FileCategory.VIDEO,
  ".webm": FileCategory.VIDEO,

  // Audio
  ".mp3": FileCategory.AUDIO,
  ".wav": FileCategory.AUDIO,
  ".ogg": FileCategory.AUDIO,
  ".flac": FileCategory.AUDIO,
  ".aac": FileCategory.AUDIO,

  // Archives
  ".zip": FileCategory.ARCHIVE,
  ".rar": FileCategory.ARCHIVE,
  ".7z": FileCategory.ARCHIVE,
  ".tar": FileCategory.ARCHIVE,
  ".gz": FileCategory.ARCHIVE,

  // Code
  ".js": FileCategory.CODE,
  ".ts": FileCategory.CODE,
  ".py": FileCategory.CODE,
  ".java": FileCategory.CODE,
  ".cpp": FileCategory.CODE,
  ".c": FileCategory.CODE,
  ".html": FileCategory.CODE,
  ".css": FileCategory.CODE,
  ".json": FileCategory.CODE,
  ".xml": FileCategory.CODE,

  // Data
  ".csv": FileCategory.DATA,
  ".sql": FileCategory.DATA,
  ".db": FileCategory.DATA,

  // Executable
  ".exe": FileCategory.EXECUTABLE,
  ".msi": FileCategory.EXECUTABLE,
  ".dmg": FileCategory.EXECUTABLE,
  ".app": FileCategory.EXECUTABLE,
  ".deb": FileCategory.EXECUTABLE,
  ".rpm": FileCategory.EXECUTABLE,
};

class FileHandler extends EventEmitter {
  /**
   * @param {Object} browserEngine - Browser engine instance
   * @param {Object} config - Configuration options
   * @param {Object} [dependencies] - Optional dependency injection for testing
   */
  constructor(browserEngine = null, config = {}, dependencies = {}) {
    super();

    // Dependency injection for testing
    this.fs = dependencies.fs || getFsModule();

    this.browserEngine = browserEngine;
    this.config = {
      downloadDir: config.downloadDir || null,
      maxConcurrentDownloads: config.maxConcurrentDownloads || 3,
      autoRename: config.autoRename !== false,
      blockExecutables: config.blockExecutables || false,
      allowedCategories: config.allowedCategories || null,
      maxFileSize: config.maxFileSize || 0, // 0 = no limit
      trackProgress: config.trackProgress !== false,
      ...config,
    };

    // 下载队列
    this.downloads = new Map();

    // 上传记录
    this.uploads = [];

    // 统计
    this.stats = {
      totalDownloads: 0,
      completedDownloads: 0,
      failedDownloads: 0,
      totalUploads: 0,
      totalBytes: 0,
      byCategory: {},
    };
  }

  /**
   * 设置浏览器引擎
   * @param {Object} browserEngine
   */
  setBrowserEngine(browserEngine) {
    this.browserEngine = browserEngine;
  }

  /**
   * 设置下载目录
   * @param {string} dir - 下载目录
   * @returns {Object}
   */
  setDownloadDir(dir) {
    if (!this.fs.existsSync(dir)) {
      try {
        this.fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    this.config.downloadDir = dir;
    return { success: true, dir };
  }

  /**
   * 开始下载
   * @param {string} targetId - 标签页 ID
   * @param {string} url - 下载 URL
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async startDownload(targetId, url, options = {}) {
    const downloadId = `dl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 获取文件信息
    const fileInfo = this._parseUrl(url);

    // 检查文件类型
    if (
      this.config.blockExecutables &&
      fileInfo.category === FileCategory.EXECUTABLE
    ) {
      return { success: false, error: "Executable files are blocked" };
    }

    if (
      this.config.allowedCategories &&
      !this.config.allowedCategories.includes(fileInfo.category)
    ) {
      return {
        success: false,
        error: `File category '${fileInfo.category}' is not allowed`,
      };
    }

    // 确定保存路径
    let savePath = options.savePath;
    if (!savePath && this.config.downloadDir) {
      let filename = options.filename || fileInfo.filename;

      if (this.config.autoRename) {
        filename = this._generateUniqueName(this.config.downloadDir, filename);
      }

      savePath = path.join(this.config.downloadDir, filename);
    }

    // 创建下载记录
    const download = {
      id: downloadId,
      url,
      savePath,
      filename: fileInfo.filename,
      extension: fileInfo.extension,
      category: fileInfo.category,
      state: DownloadState.PENDING,
      progress: 0,
      totalBytes: 0,
      receivedBytes: 0,
      startTime: Date.now(),
      endTime: null,
      error: null,
      targetId,
    };

    this.downloads.set(downloadId, download);
    this.stats.totalDownloads++;

    return await this._rejectUngovernedDownload(download);
  }

  /**
   * Reject legacy page/fetch downloads until the governed artifact contract
   * can provide real completion, size, digest and quarantine evidence.
   * @private
   */
  async _rejectUngovernedDownload(download) {
    const error =
      "Page downloads require the governed browser download contract";
    download.url = null;
    download.savePath = null;
    download.filename = null;
    download.state = DownloadState.FAILED;
    download.error = error;
    download.endTime = Date.now();
    this.stats.failedDownloads++;
    this.emit("downloadFailed", download);
    return { success: false, error, downloadId: download.id };
  }

  /**
   * 取消下载
   * @param {string} downloadId - 下载 ID
   * @returns {Object}
   */
  cancelDownload(downloadId) {
    const download = this.downloads.get(downloadId);
    if (!download) {
      return { success: false, error: "Download not found" };
    }

    if (download.state === DownloadState.COMPLETED) {
      return { success: false, error: "Download already completed" };
    }

    download.state = DownloadState.CANCELLED;
    download.endTime = Date.now();

    this.emit("downloadCancelled", download);

    return { success: true };
  }

  /**
   * 获取下载状态
   * @param {string} downloadId - 下载 ID
   * @returns {Object}
   */
  getDownload(downloadId) {
    return this.downloads.get(downloadId) || null;
  }

  /**
   * 列出下载
   * @param {Object} filter - 过滤条件
   * @returns {Array}
   */
  listDownloads(filter = {}) {
    let downloads = Array.from(this.downloads.values());

    if (filter.state) {
      downloads = downloads.filter((d) => d.state === filter.state);
    }

    if (filter.category) {
      downloads = downloads.filter((d) => d.category === filter.category);
    }

    if (filter.limit) {
      downloads = downloads.slice(-filter.limit);
    }

    return downloads.reverse();
  }

  /**
   * 记录上传
   * @param {string} targetId - 标签页 ID
   * @param {string} selector - 上传元素选择器
   * @param {Array} files - 文件信息列表
   * @returns {Object}
   */
  recordUpload(targetId, selector, files) {
    const uploadId = `up_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const upload = {
      id: uploadId,
      targetId,
      selector,
      files: files.map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type,
        category: this._getCategory(f.name),
      })),
      timestamp: Date.now(),
    };

    this.uploads.push(upload);
    this.stats.totalUploads++;

    this.emit("uploaded", upload);

    return { success: true, uploadId };
  }

  /**
   * 获取上传历史
   * @param {number} limit - 返回数量
   * @returns {Array}
   */
  getUploads(limit = 20) {
    return this.uploads.slice(-limit).reverse();
  }

  /**
   * 验证文件
   * @param {string} filePath - 文件路径
   * @param {Object} rules - 验证规则
   * @returns {Object}
   */
  validateFile(filePath, rules = {}) {
    const errors = [];

    try {
      const stat = this.fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const category = FILE_TYPE_MAP[ext] || FileCategory.OTHER;

      // 大小检查
      if (rules.maxSize && stat.size > rules.maxSize) {
        errors.push(`File size ${stat.size} exceeds limit ${rules.maxSize}`);
      }

      if (rules.minSize && stat.size < rules.minSize) {
        errors.push(`File size ${stat.size} is below minimum ${rules.minSize}`);
      }

      // 类型检查
      if (rules.allowedExtensions && !rules.allowedExtensions.includes(ext)) {
        errors.push(`Extension ${ext} is not allowed`);
      }

      if (rules.blockedExtensions && rules.blockedExtensions.includes(ext)) {
        errors.push(`Extension ${ext} is blocked`);
      }

      // 分类检查
      if (
        rules.allowedCategories &&
        !rules.allowedCategories.includes(category)
      ) {
        errors.push(`Category ${category} is not allowed`);
      }

      if (
        rules.blockedCategories &&
        rules.blockedCategories.includes(category)
      ) {
        errors.push(`Category ${category} is blocked`);
      }

      return {
        valid: errors.length === 0,
        errors,
        info: {
          path: filePath,
          size: stat.size,
          extension: ext,
          category,
        },
      };
    } catch (error) {
      return {
        valid: false,
        errors: [error.message],
      };
    }
  }

  /**
   * 获取文件信息
   * @param {string} filePath - 文件路径
   * @returns {Object}
   */
  getFileInfo(filePath) {
    try {
      const stat = this.fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();

      return {
        success: true,
        info: {
          path: filePath,
          name: path.basename(filePath),
          extension: ext,
          category: FILE_TYPE_MAP[ext] || FileCategory.OTHER,
          size: stat.size,
          created: stat.birthtime,
          modified: stat.mtime,
        },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 解析 URL
   * @private
   */
  _parseUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = path.basename(pathname) || "download";
      const extension = path.extname(filename).toLowerCase();

      return {
        filename,
        extension,
        category: FILE_TYPE_MAP[extension] || FileCategory.OTHER,
      };
    } catch {
      return {
        filename: "download",
        extension: "",
        category: FileCategory.OTHER,
      };
    }
  }

  /**
   * 生成唯一文件名
   * @private
   */
  _generateUniqueName(dir, filename) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    let newName = filename;
    let counter = 1;

    while (this.fs.existsSync(path.join(dir, newName))) {
      newName = `${base} (${counter})${ext}`;
      counter++;
    }

    return newName;
  }

  /**
   * 获取文件分类
   * @private
   */
  _getCategory(filename) {
    const ext = path.extname(filename).toLowerCase();
    return FILE_TYPE_MAP[ext] || FileCategory.OTHER;
  }

  /**
   * 更新分类统计
   * @private
   */
  _updateCategoryStats(category) {
    if (!this.stats.byCategory[category]) {
      this.stats.byCategory[category] = 0;
    }
    this.stats.byCategory[category]++;
  }

  /**
   * 获取统计
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      successRate:
        this.stats.totalDownloads > 0
          ? (
              (this.stats.completedDownloads / this.stats.totalDownloads) *
              100
            ).toFixed(2) + "%"
          : "0%",
    };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      totalDownloads: 0,
      completedDownloads: 0,
      failedDownloads: 0,
      totalUploads: 0,
      totalBytes: 0,
      byCategory: {},
    };
    this.emit("statsReset");
  }

  /**
   * 清理下载记录
   * @param {Object} options - 清理选项
   * @returns {Object}
   */
  cleanup(options = {}) {
    let cleaned = 0;

    for (const [id, download] of this.downloads) {
      if (options.completedOnly && download.state !== DownloadState.COMPLETED) {
        continue;
      }

      if (options.olderThan) {
        const age = Date.now() - download.startTime;
        if (age < options.olderThan) {
          continue;
        }
      }

      this.downloads.delete(id);
      cleaned++;
    }

    return { success: true, cleaned };
  }
}

// 单例
let fileHandlerInstance = null;

function getFileHandler(browserEngine, config) {
  if (!fileHandlerInstance) {
    fileHandlerInstance = new FileHandler(browserEngine, config);
  } else if (browserEngine) {
    fileHandlerInstance.setBrowserEngine(browserEngine);
  }
  return fileHandlerInstance;
}

module.exports = {
  FileHandler,
  DownloadState,
  FileCategory,
  getFileHandler,
};
