/**
 * 视频导入器
 * 负责视频文件的导入、元数据提取、缩略图生成和数据库存储
 * 使用 EventEmitter 模式发送进度和状态更新
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');
const { getVideoConfig } = require('./video-config');
const VideoStorage = require('./video-storage');
const { getVideoEngine } = require('../engines/video-engine');

/**
 * 视频导入器类
 */
class VideoImporter extends EventEmitter {
  /**
   * @param {Object} database - 数据库实例
   * @param {string} userDataPath - 用户数据路径
   */
  constructor(database, userDataPath) {
    super();
    this.db = database;
    this.userDataPath = userDataPath;
    this.config = getVideoConfig();
    this.storage = new VideoStorage(database);
    this.videoEngine = getVideoEngine();

    // 当前导入任务队列
    this.importQueue = [];
    // 正在处理的任务
    this.processingTasks = new Map();
  }

  /**
   * 初始化存储目录
   * @returns {Promise<void>}
   */
  async initializeStorageDirectories() {
    const subdirs = Object.keys(this.config.storage.subdirs);

    for (const subdir of subdirs) {
      const dirPath = this.config.getStoragePath(subdir, this.userDataPath);
      try {
        await fs.mkdir(dirPath, { recursive: true });
      } catch (error) {
        console.error(`[Video Importer] 创建目录失败: ${dirPath}`, error);
        throw error;
      }
    }

    console.log('[Video Importer] 存储目录初始化完成');
  }

  /**
   * 导入单个视频文件
   * @param {string} filePath - 视频文件路径
   * @param {Object} options - 导入选项
   * @returns {Promise<Object>} 导入结果
   */
  async importVideo(filePath, options = {}) {
    const taskId = uuidv4();
    const {
      knowledgeId = null,
      autoAnalyze = this.config.import.autoAnalyze,
      copyToStorage = this.config.import.copyToStorage,
      generateThumbnail = this.config.analysis.generateThumbnail,
      extractMetadata = true
    } = options;

    console.log(`[Video Importer] 开始导入视频: ${filePath}`);
    this.emit('import:start', { taskId, filePath });

    try {
      // 1. 验证文件
      this.emit('import:progress', { taskId, progress: 5, message: '验证文件...' });
      await this.validateFile(filePath);

      // 2. 提取元数据
      this.emit('import:progress', { taskId, progress: 10, message: '提取元数据...' });
      const metadata = extractMetadata ? await this.extractMetadata(filePath) : {};

      // 3. 复制文件到存储目录（如果需要）
      let storedFilePath = filePath;
      if (copyToStorage) {
        this.emit('import:progress', { taskId, progress: 30, message: '复制文件...' });
        storedFilePath = await this.copyFileToStorage(filePath);
      }

      // 4. 生成缩略图
      let thumbnailPath = null;
      if (generateThumbnail) {
        this.emit('import:progress', { taskId, progress: 50, message: '生成缩略图...' });
        thumbnailPath = await this.generateThumbnail(storedFilePath, taskId);
      }

      // 5. 创建数据库记录
      this.emit('import:progress', { taskId, progress: 80, message: '保存到数据库...' });
      const videoRecord = await this.storage.createVideoFile({
        fileName: path.basename(filePath),
        filePath: storedFilePath,
        fileSize: metadata.size || 0,
        duration: metadata.duration || 0,
        width: metadata.width || 0,
        height: metadata.height || 0,
        fps: metadata.fps || 0,
        format: metadata.format || path.extname(filePath).slice(1),
        videoCodec: metadata.videoCodec || '',
        audioCodec: metadata.audioCodec || '',
        bitrate: metadata.bitrate || 0,
        hasAudio: metadata.hasAudio !== undefined ? metadata.hasAudio : true,
        thumbnailPath: thumbnailPath,
        knowledgeId: knowledgeId,
        analysisStatus: autoAnalyze ? 'pending' : 'skipped',
        analysisProgress: 0
      });

      // 6. 自动分析（如果启用）
      if (autoAnalyze) {
        this.emit('import:progress', { taskId, progress: 90, message: '开始分析...' });
        // 异步执行分析，不阻塞导入完成
        this.analyzeVideo(videoRecord.id).catch(error => {
          console.error('[Video Importer] 视频分析失败:', error);
          this.emit('analysis:error', { videoId: videoRecord.id, error: error.message });
        });
      }

      this.emit('import:progress', { taskId, progress: 100, message: '导入完成' });
      this.emit('import:complete', { taskId, video: videoRecord });

      console.log(`[Video Importer] 视频导入完成: ${videoRecord.id}`);
      return {
        success: true,
        video: videoRecord,
        taskId
      };

    } catch (error) {
      console.error('[Video Importer] 导入失败:', error);
      this.emit('import:error', { taskId, error: error.message });
      throw error;
    }
  }

  /**
   * 批量导入视频文件
   * @param {Array<string>} filePaths - 文件路径数组
   * @param {Object} options - 导入选项
   * @returns {Promise<Array>} 导入结果数组
   */
  async importVideoBatch(filePaths, options = {}) {
    const batchId = uuidv4();
    const results = [];
    const concurrency = this.config.import.batchConcurrency;

    console.log(`[Video Importer] 批量导入 ${filePaths.length} 个视频文件`);
    this.emit('batch:start', { batchId, count: filePaths.length });

    for (let i = 0; i < filePaths.length; i += concurrency) {
      const batch = filePaths.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(filePath => this.importVideo(filePath, options))
      );

      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            success: false,
            filePath: batch[index],
            error: result.reason.message
          });
        }
      });

      const progress = Math.round(((i + batch.length) / filePaths.length) * 100);
      this.emit('batch:progress', { batchId, progress, completed: i + batch.length, total: filePaths.length });
    }

    this.emit('batch:complete', { batchId, results });
    console.log(`[Video Importer] 批量导入完成: ${results.length} 个文件`);

    return results;
  }

  /**
   * 验证视频文件
   * @param {string} filePath - 文件路径
   * @returns {Promise<void>}
   */
  async validateFile(filePath) {
    // 检查文件是否存在
    try {
      await fs.access(filePath, fsSync.constants.R_OK);
    } catch (error) {
      throw new Error(`文件不存在或无法访问: ${filePath}`);
    }

    // 检查文件格式
    if (!this.config.isSupportedFormat(filePath)) {
      throw new Error(`不支持的视频格式: ${path.extname(filePath)}`);
    }

    // 检查文件大小
    const stats = await fs.stat(filePath);
    if (!this.config.isFileSizeValid(stats.size)) {
      throw new Error(`文件大小超过限制: ${stats.size} 字节`);
    }

    console.log('[Video Importer] 文件验证通过');
  }

  /**
   * 提取视频元数据
   * @param {string} filePath - 视频文件路径
   * @returns {Promise<Object>} 元数据
   */
  async extractMetadata(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (error, metadata) => {
        if (error) {
          console.error('[Video Importer] 元数据提取失败:', error);
          reject(error);
          return;
        }

        try {
          const videoStream = metadata.streams.find(s => s.codec_type === 'video');
          const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
          const format = metadata.format;

          const result = {
            duration: format.duration,
            size: format.size,
            bitrate: format.bit_rate,
            format: format.format_name,
            width: videoStream?.width || 0,
            height: videoStream?.height || 0,
            fps: videoStream ? this.parseFps(videoStream.r_frame_rate) : 0,
            videoCodec: videoStream?.codec_name || '',
            audioCodec: audioStream?.codec_name || '',
            hasAudio: !!audioStream,
            channels: audioStream?.channels || 0,
            sampleRate: audioStream?.sample_rate || 0
          };

          console.log('[Video Importer] 元数据提取成功:', result);
          resolve(result);
        } catch (parseError) {
          console.error('[Video Importer] 元数据解析失败:', parseError);
          reject(parseError);
        }
      });
    });
  }

  /**
   * 解析帧率字符串
   * @param {string} fpsString - 帧率字符串 (如 "30/1")
   * @returns {number}
   */
  parseFps(fpsString) {
    if (!fpsString) return 0;
    const parts = fpsString.split('/');
    if (parts.length === 2) {
      return parseFloat(parts[0]) / parseFloat(parts[1]);
    }
    return parseFloat(fpsString);
  }

  /**
   * 复制文件到存储目录
   * @param {string} sourceFilePath - 源文件路径
   * @returns {Promise<string>} 目标文件路径
   */
  async copyFileToStorage(sourceFilePath) {
    const fileName = this.config.generateFileName(path.basename(sourceFilePath));
    const destDir = this.config.getStoragePath('originals', this.userDataPath);
    const destPath = path.join(destDir, fileName);

    await fs.mkdir(destDir, { recursive: true });
    await fs.copyFile(sourceFilePath, destPath);

    console.log(`[Video Importer] 文件已复制: ${destPath}`);
    return destPath;
  }

  /**
   * 生成缩略图
   * @param {string} filePath - 视频文件路径
   * @param {string} taskId - 任务ID
   * @returns {Promise<string>} 缩略图路径
   */
  async generateThumbnail(filePath, taskId) {
    const thumbnailDir = this.config.getStoragePath('thumbnails', this.userDataPath);
    await fs.mkdir(thumbnailDir, { recursive: true });

    const thumbnailFileName = `${taskId}_thumb.${this.config.thumbnail.format}`;
    const thumbnailPath = path.join(thumbnailDir, thumbnailFileName);

    const result = await this.videoEngine.generateThumbnail(filePath, thumbnailPath, {
      timeOffset: this.config.thumbnail.timeOffset,
      size: `${this.config.thumbnail.width}x${this.config.thumbnail.height}`
    });

    console.log(`[Video Importer] 缩略图已生成: ${thumbnailPath}`);
    return result.outputPath;
  }

  /**
   * 分析视频
   * @param {string} videoId - 视频ID
   * @returns {Promise<Object>} 分析结果
   */
  async analyzeVideo(videoId) {
    console.log(`[Video Importer] 开始分析视频: ${videoId}`);
    this.emit('analysis:start', { videoId });

    try {
      // 更新状态为分析中
      await this.storage.updateVideoFile(videoId, {
        analysis_status: 'analyzing',
        analysis_progress: 0
      });

      const video = await this.storage.getVideoFile(videoId);
      if (!video) {
        throw new Error(`视频不存在: ${videoId}`);
      }

      const analysisResult = {
        videoFileId: videoId,
        analysisEngine: 'ffmpeg'
      };

      // 1. 提取音频（如果启用）
      if (this.config.analysis.extractAudio && video.has_audio) {
        this.emit('analysis:progress', { videoId, progress: 20, message: '提取音频...' });
        try {
          const audioPath = await this.extractAudio(video);
          analysisResult.audioPath = audioPath;
        } catch (error) {
          console.warn('[Video Importer] 音频提取失败:', error);
        }
      }

      // 2. 提取关键帧（如果启用）
      if (this.config.analysis.extractKeyframes) {
        this.emit('analysis:progress', { videoId, progress: 40, message: '提取关键帧...' });
        try {
          await this.extractKeyframes(video);
        } catch (error) {
          console.warn('[Video Importer] 关键帧提取失败:', error);
        }
      }

      // 3. 场景检测（如果启用）
      if (this.config.analysis.detectScenes) {
        this.emit('analysis:progress', { videoId, progress: 60, message: '检测场景...' });
        try {
          await this.detectScenes(video);
        } catch (error) {
          console.warn('[Video Importer] 场景检测失败:', error);
        }
      }

      // 4. OCR 识别（如果启用且有关键帧）
      if (this.config.analysis.performOCR && this.config.ocr.enabled) {
        this.emit('analysis:progress', { videoId, progress: 80, message: 'OCR 识别...' });
        try {
          const ocrText = await this.performOCR(video);
          if (ocrText) {
            analysisResult.ocrText = ocrText;
            analysisResult.ocrConfidence = 0.8; // 示例值
          }
        } catch (error) {
          console.warn('[Video Importer] OCR 识别失败:', error);
        }
      }

      // 5. 保存分析结果
      this.emit('analysis:progress', { videoId, progress: 90, message: '保存分析结果...' });
      await this.storage.createVideoAnalysis(analysisResult);

      // 6. 更新视频状态
      await this.storage.updateVideoFile(videoId, {
        analysis_status: 'completed',
        analysis_progress: 100
      });

      this.emit('analysis:progress', { videoId, progress: 100, message: '分析完成' });
      this.emit('analysis:complete', { videoId, result: analysisResult });

      console.log(`[Video Importer] 视频分析完成: ${videoId}`);
      return analysisResult;

    } catch (error) {
      console.error('[Video Importer] 视频分析失败:', error);

      // 更新状态为失败
      await this.storage.updateVideoFile(videoId, {
        analysis_status: 'failed',
        analysis_progress: 0
      });

      this.emit('analysis:error', { videoId, error: error.message });
      throw error;
    }
  }

  /**
   * 提取音频
   * @param {Object} video - 视频记录
   * @returns {Promise<string>} 音频文件路径
   */
  async extractAudio(video) {
    const audioDir = this.config.getStoragePath('audio', this.userDataPath);
    await fs.mkdir(audioDir, { recursive: true });

    const audioFileName = `${path.parse(video.file_name).name}.${this.config.audio.format}`;
    const audioPath = path.join(audioDir, audioFileName);

    await this.videoEngine.extractAudio(video.file_path, audioPath, {
      format: this.config.audio.format,
      bitrate: this.config.audio.bitrate,
      channels: this.config.audio.channels
    });

    console.log(`[Video Importer] 音频已提取: ${audioPath}`);
    return audioPath;
  }

  /**
   * 提取关键帧
   * @param {Object} video - 视频记录
   * @returns {Promise<Array>} 关键帧列表
   */
  async extractKeyframes(video) {
    const keyframeDir = this.config.getStoragePath('keyframes', this.userDataPath);
    await fs.mkdir(keyframeDir, { recursive: true });

    const duration = video.duration || 0;
    const interval = this.config.keyframes.interval;
    const maxCount = this.config.keyframes.maxCount;
    const keyframes = [];

    // 计算关键帧时间点
    const count = Math.min(Math.floor(duration / interval), maxCount);

    for (let i = 0; i < count; i++) {
      const timestamp = i * interval;
      const keyframePath = path.join(keyframeDir, `${video.id}_frame_${i}.jpg`);

      try {
        await this.videoEngine.generateThumbnail(video.file_path, keyframePath, {
          timeOffset: this.formatTime(timestamp),
          size: `${this.config.keyframes.width}x${this.config.keyframes.height}`
        });

        const keyframe = await this.storage.createKeyframe({
          videoFileId: video.id,
          framePath: keyframePath,
          timestamp: timestamp,
          sceneChangeScore: null
        });

        keyframes.push(keyframe);
      } catch (error) {
        console.warn(`[Video Importer] 关键帧提取失败 (${timestamp}s):`, error);
      }
    }

    console.log(`[Video Importer] 已提取 ${keyframes.length} 个关键帧`);
    return keyframes;
  }

  /**
   * 检测场景
   * @param {Object} video - 视频记录
   * @returns {Promise<Array>} 场景列表
   */
  async detectScenes(video) {
    // 简单的基于时间的场景分割
    // 实际应用中可以使用更复杂的场景检测算法
    const duration = video.duration || 0;
    const sceneInterval = 30; // 每30秒一个场景
    const scenes = [];

    const sceneCount = Math.ceil(duration / sceneInterval);

    for (let i = 0; i < sceneCount; i++) {
      const startTime = i * sceneInterval;
      const endTime = Math.min((i + 1) * sceneInterval, duration);

      const scene = await this.storage.createScene({
        videoFileId: video.id,
        sceneIndex: i,
        startTime: startTime,
        endTime: endTime,
        duration: endTime - startTime,
        description: `场景 ${i + 1}`
      });

      scenes.push(scene);
    }

    console.log(`[Video Importer] 已检测 ${scenes.length} 个场景`);
    return scenes;
  }

  /**
   * 执行 OCR 识别
   * @param {Object} video - 视频记录
   * @returns {Promise<string>} OCR 文本
   */
  async performOCR(video) {
    // 获取关键帧
    const keyframes = await this.storage.getKeyframesByVideoId(video.id);
    if (keyframes.length === 0) {
      return '';
    }

    // 这里应该调用 OCR 服务（如 Tesseract.js）
    // 作为示例，返回空字符串
    console.log(`[Video Importer] OCR 识别已跳过（需要集成 OCR 服务）`);
    return '';
  }

  /**
   * 格式化时间为 HH:MM:SS
   * @param {number} seconds - 秒数
   * @returns {string}
   */
  formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * 取消导入任务
   * @param {string} taskId - 任务ID
   * @returns {Promise<void>}
   */
  async cancelImport(taskId) {
    console.log(`[Video Importer] 取消导入任务: ${taskId}`);
    this.emit('import:cancelled', { taskId });
    // 实际应用中需要中断正在进行的 FFmpeg 进程
  }

  /**
   * 获取导入进度
   * @param {string} taskId - 任务ID
   * @returns {Object|null}
   */
  getImportProgress(taskId) {
    return this.processingTasks.get(taskId) || null;
  }
}

module.exports = VideoImporter;
