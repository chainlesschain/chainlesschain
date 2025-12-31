/**
 * 视频处理系统配置
 * 定义视频导入、分析、存储的各种配置参数
 */

const path = require('path');
const os = require('os');

/**
 * 视频配置类
 */
class VideoConfig {
  constructor() {
    // 支持的视频格式
    this.supportedFormats = [
      'mp4', 'avi', 'mov', 'mkv', 'flv', 'webm', 'wmv',
      'mpg', 'mpeg', 'm4v', '3gp', 'ogv', 'ts', 'mts'
    ];

    // 支持的音频格式（从视频中提取）
    this.supportedAudioFormats = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'];

    // 支持的字幕格式
    this.supportedSubtitleFormats = ['srt', 'ass', 'vtt', 'sub', 'ssa'];

    // 视频文件大小限制（字节）
    this.maxFileSize = 5 * 1024 * 1024 * 1024; // 5GB

    // 缩略图配置
    this.thumbnail = {
      width: 320,
      height: 240,
      format: 'jpg',
      quality: 85,
      timeOffset: '00:00:01', // 从第1秒截取
      folder: 'thumbnails'
    };

    // 关键帧提取配置
    this.keyframes = {
      maxCount: 50, // 最多提取50个关键帧
      interval: 5, // 每5秒提取一次
      sceneChangeThreshold: 0.4, // 场景变化阈值
      minInterval: 2, // 最小间隔（秒）
      width: 640,
      height: 360,
      format: 'jpg',
      quality: 80,
      folder: 'keyframes'
    };

    // 音频提取配置
    this.audio = {
      format: 'mp3',
      bitrate: '192k',
      channels: 2,
      sampleRate: 44100,
      folder: 'audio'
    };

    // 视频压缩预设
    this.compressionPresets = {
      '1080p': {
        width: 1920,
        height: 1080,
        videoBitrate: '5000k',
        audioBitrate: '192k',
        fps: 30,
        codec: 'libx264',
        crf: 23
      },
      '720p': {
        width: 1280,
        height: 720,
        videoBitrate: '2500k',
        audioBitrate: '128k',
        fps: 30,
        codec: 'libx264',
        crf: 23
      },
      '480p': {
        width: 854,
        height: 480,
        videoBitrate: '1000k',
        audioBitrate: '96k',
        fps: 24,
        codec: 'libx264',
        crf: 24
      },
      '360p': {
        width: 640,
        height: 360,
        videoBitrate: '500k',
        audioBitrate: '64k',
        fps: 24,
        codec: 'libx264',
        crf: 25
      }
    };

    // OCR 配置（关键帧文本识别）
    this.ocr = {
      enabled: true,
      language: 'chi_sim+eng', // 中文简体 + 英文
      confidence: 0.6, // 最低置信度
      dpi: 300,
      psm: 3 // Page segmentation mode: 3 = Fully automatic page segmentation
    };

    // 视频分析配置
    this.analysis = {
      // 是否自动提取音频
      extractAudio: true,
      // 是否生成缩略图
      generateThumbnail: true,
      // 是否提取关键帧
      extractKeyframes: true,
      // 是否进行OCR
      performOCR: true,
      // 是否进行场景检测
      detectScenes: true,
      // 分析引擎
      engine: 'ffmpeg',
      // 并发处理数
      concurrency: 2
    };

    // 存储路径配置
    this.storage = {
      // 基础目录（相对于用户数据目录）
      baseDir: 'videos',
      // 子目录结构
      subdirs: {
        originals: 'originals',    // 原始视频
        thumbnails: 'thumbnails',  // 缩略图
        keyframes: 'keyframes',    // 关键帧
        audio: 'audio',            // 音频文件
        subtitles: 'subtitles',    // 字幕文件
        temp: 'temp',              // 临时文件
        exports: 'exports'         // 导出文件
      }
    };

    // FFmpeg 配置
    this.ffmpeg = {
      // FFmpeg 二进制路径（如果为空则使用系统路径）
      binPath: '',
      // FFprobe 二进制路径
      probePath: '',
      // 超时时间（毫秒）
      timeout: 300000, // 5分钟
      // 日志级别
      logLevel: 'error'
    };

    // 导入配置
    this.import = {
      // 是否自动分析
      autoAnalyze: true,
      // 是否保留原文件
      keepOriginal: true,
      // 是否复制到存储目录
      copyToStorage: true,
      // 导入时的文件命名规则
      namingRule: 'timestamp', // 'original' | 'timestamp' | 'uuid'
      // 批量导入并发数
      batchConcurrency: 3,
      // 单次导入超时（毫秒）
      importTimeout: 600000 // 10分钟
    };

    // 性能配置
    this.performance = {
      // 最大并发任务数
      maxConcurrentTasks: Math.max(1, os.cpus().length - 1),
      // 内存限制（MB）
      memoryLimit: 2048,
      // 是否使用硬件加速
      hardwareAcceleration: true,
      // 缓存大小（MB）
      cacheSize: 512
    };

    // 字幕配置
    this.subtitle = {
      // 默认字体
      defaultFont: 'Arial',
      // 默认字号
      defaultFontSize: 24,
      // 默认颜色
      defaultColor: 'white',
      // 默认位置
      defaultPosition: 'bottom',
      // 是否自动生成字幕
      autoGenerate: false,
      // 字幕语言
      language: 'zh-CN'
    };

    // AI 分析配置
    this.ai = {
      // 是否启用 AI 分析
      enabled: true,
      // AI 模型
      model: 'qwen2:7b',
      // 分析项目
      features: {
        transcription: true,    // 语音转文字
        summarization: true,    // 内容摘要
        tagging: true,          // 自动标签
        sentiment: true,        // 情感分析
        topicExtraction: true,  // 主题提取
        objectDetection: false  // 物体检测（需要视觉模型）
      },
      // 提示词模板
      prompts: {
        summary: '请对以下视频转录内容进行总结，提取关键信息：\n\n{transcription}',
        tags: '请为以下视频内容生成5-10个关键标签：\n\n{transcription}',
        topics: '请提取以下内容的主要主题（最多5个）：\n\n{transcription}'
      }
    };

    // 导出配置
    this.export = {
      // 默认格式
      defaultFormat: 'mp4',
      // 默认质量预设
      defaultPreset: '720p',
      // 是否保留元数据
      keepMetadata: true,
      // 导出时的编码器
      encoder: 'libx264'
    };

    // 调试配置
    this.debug = {
      // 是否启用调试模式
      enabled: false,
      // 详细日志
      verbose: false,
      // 保留临时文件
      keepTempFiles: false
    };
  }

  /**
   * 检查文件格式是否支持
   * @param {string} filePath - 文件路径
   * @returns {boolean}
   */
  isSupportedFormat(filePath) {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    return this.supportedFormats.includes(ext);
  }

  /**
   * 检查文件大小是否超限
   * @param {number} fileSize - 文件大小（字节）
   * @returns {boolean}
   */
  isFileSizeValid(fileSize) {
    return fileSize <= this.maxFileSize;
  }

  /**
   * 获取存储路径
   * @param {string} subdir - 子目录名称
   * @param {string} userDataPath - 用户数据路径
   * @returns {string}
   */
  getStoragePath(subdir, userDataPath) {
    return path.join(
      userDataPath,
      this.storage.baseDir,
      this.storage.subdirs[subdir] || subdir
    );
  }

  /**
   * 生成文件名
   * @param {string} originalName - 原始文件名
   * @returns {string}
   */
  generateFileName(originalName) {
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);

    switch (this.import.namingRule) {
      case 'timestamp':
        return `${baseName}_${Date.now()}${ext}`;
      case 'uuid':
        return `${this.generateUUID()}${ext}`;
      case 'original':
      default:
        return originalName;
    }
  }

  /**
   * 生成 UUID
   * @returns {string}
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 获取压缩预设
   * @param {string} preset - 预设名称
   * @returns {Object}
   */
  getCompressionPreset(preset) {
    return this.compressionPresets[preset] || this.compressionPresets['720p'];
  }

  /**
   * 更新配置
   * @param {Object} updates - 配置更新对象
   */
  updateConfig(updates) {
    Object.keys(updates).forEach(key => {
      if (typeof this[key] === 'object' && !Array.isArray(this[key])) {
        this[key] = { ...this[key], ...updates[key] };
      } else {
        this[key] = updates[key];
      }
    });
  }

  /**
   * 导出配置为 JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      supportedFormats: this.supportedFormats,
      supportedAudioFormats: this.supportedAudioFormats,
      supportedSubtitleFormats: this.supportedSubtitleFormats,
      maxFileSize: this.maxFileSize,
      thumbnail: this.thumbnail,
      keyframes: this.keyframes,
      audio: this.audio,
      compressionPresets: this.compressionPresets,
      ocr: this.ocr,
      analysis: this.analysis,
      storage: this.storage,
      ffmpeg: this.ffmpeg,
      import: this.import,
      performance: this.performance,
      subtitle: this.subtitle,
      ai: this.ai,
      export: this.export,
      debug: this.debug
    };
  }
}

// 创建单例实例
let configInstance = null;

/**
 * 获取配置实例
 * @returns {VideoConfig}
 */
function getVideoConfig() {
  if (!configInstance) {
    configInstance = new VideoConfig();
  }
  return configInstance;
}

module.exports = {
  VideoConfig,
  getVideoConfig
};
