import { logger, createLogger } from '@/utils/logger';

/**
 * 多媒体API工具类
 *
 * 封装与主进程的IPC通信，提供简洁的API调用
 * 自动处理进度事件和错误处理
 */

class MultimediaAPI {
  constructor() {
    this.progressCallbacks = new Map();
    this.setupProgressListener();
  }

  /**
   * 设置进度监听器
   */
  setupProgressListener() {
    if (window.electronAPI) {
      window.electronAPI.on('task-progress', (event, data) => {
        const callback = this.progressCallbacks.get(data.taskId);
        if (callback) {
          callback(data);
        }
      });
    }
  }

  /**
   * 调用IPC方法的通用包装
   * @param {string} channel - IPC通道
   * @param {Object} params - 参数
   * @param {Function} onProgress - 进度回调
   * @returns {Promise}
   */
  async invoke(channel, params = {}, onProgress = null) {
    try {
      if (onProgress) {
        const taskId = `${channel}_${Date.now()}`;
        this.progressCallbacks.set(taskId, onProgress);

        const result = await window.electronAPI.invoke(channel, {
          ...params,
          taskId,
        });

        this.progressCallbacks.delete(taskId);
        return result;
      }

      return await window.electronAPI.invoke(channel, params);
    } catch (error) {
      logger.error(`[MultimediaAPI] ${channel} 调用失败:`, error);
      throw error;
    }
  }

  // ==================== 图片处理 API ====================

  /**
   * 上传图片
   * @param {string} imagePath - 图片路径
   * @param {Object} options - 上传选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}
   */
  async uploadImage(imagePath, options = {}, onProgress = null) {
    return this.invoke('image:upload', { imagePath, options }, onProgress);
  }

  /**
   * 批量上传图片
   * @param {Array<string>} imagePaths - 图片路径列表
   * @param {Object} options - 上传选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Array>}
   */
  async uploadImages(imagePaths, options = {}, onProgress = null) {
    return this.invoke('image:batch-upload', { imagePaths, options }, onProgress);
  }

  /**
   * 批量OCR识别
   * @param {Array<string>} imagePaths - 图片路径列表
   * @param {Object} options - OCR选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Array>}
   */
  async batchOCR(imagePaths, options = {}, onProgress = null) {
    return this.invoke('image:batch-ocr', { imagePaths, options }, onProgress);
  }

  /**
   * 图片压缩
   * @param {string} imagePath - 图片路径
   * @param {Object} options - 压缩选项
   * @returns {Promise<Object>}
   */
  async compressImage(imagePath, options = {}) {
    return this.invoke('image:compress', { imagePath, options });
  }

  // ==================== 音频处理 API ====================

  /**
   * 音频转录
   * @param {string} audioPath - 音频路径
   * @param {Object} options - 转录选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}
   */
  async transcribeAudio(audioPath, options = {}, onProgress = null) {
    return this.invoke('audio:transcribe', { audioPath, options }, onProgress);
  }

  /**
   * 批量音频转录
   * @param {Array<string>} audioPaths - 音频路径列表
   * @param {Object} options - 转录选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Array>}
   */
  async batchTranscribe(audioPaths, options = {}, onProgress = null) {
    return this.invoke('audio:batch-transcribe', { audioPaths, options }, onProgress);
  }

  // ==================== 视频处理 API ====================

  /**
   * 获取视频信息
   * @param {string} videoPath - 视频路径
   * @returns {Promise<Object>}
   */
  async getVideoInfo(videoPath) {
    return this.invoke('video:getInfo', { videoPath });
  }

  /**
   * 应用视频滤镜
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 滤镜选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}
   */
  async applyVideoFilter(inputPath, outputPath, options = {}, onProgress = null) {
    return this.invoke(
      'video:applyFilter',
      { inputPath, outputPath, options },
      onProgress
    );
  }

  /**
   * 应用视频滤镜链
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {Array} filters - 滤镜链
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}
   */
  async applyVideoFilterChain(inputPath, outputPath, filters, onProgress = null) {
    return this.invoke(
      'video:applyFilterChain',
      { inputPath, outputPath, filters },
      onProgress
    );
  }

  /**
   * 提取音频
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}
   */
  async extractAudio(inputPath, outputPath, onProgress = null) {
    return this.invoke('video:extractAudio', { inputPath, outputPath }, onProgress);
  }

  /**
   * 分离音轨
   * @param {string} inputPath - 输入路径
   * @param {string} outputDir - 输出目录
   * @returns {Promise<Object>}
   */
  async separateAudioTracks(inputPath, outputDir) {
    return this.invoke('video:separateAudio', { inputPath, outputDir });
  }

  /**
   * 替换音轨
   * @param {string} videoPath - 视频路径
   * @param {string} audioPath - 音频路径
   * @param {string} outputPath - 输出路径
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}
   */
  async replaceAudio(videoPath, audioPath, outputPath, onProgress = null) {
    return this.invoke(
      'video:replaceAudio',
      { videoPath, audioPath, outputPath },
      onProgress
    );
  }

  /**
   * 调整音量
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {number} volumeLevel - 音量级别
   * @param {Object} options - 其他选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}
   */
  async adjustVolume(inputPath, outputPath, volumeLevel, options = {}, onProgress = null) {
    return this.invoke(
      'video:adjustVolume',
      { inputPath, outputPath, volumeLevel, ...options },
      onProgress
    );
  }

  /**
   * 添加字幕
   * @param {string} inputPath - 输入路径
   * @param {string} subtitlePath - 字幕路径
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 字幕选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}
   */
  async addSubtitles(inputPath, subtitlePath, outputPath, options = {}, onProgress = null) {
    return this.invoke(
      'video:addSubtitles',
      { inputPath, subtitlePath, outputPath, options },
      onProgress
    );
  }

  /**
   * 使用预设添加字幕
   * @param {string} inputPath - 输入路径
   * @param {string} subtitlePath - 字幕路径
   * @param {string} outputPath - 输出路径
   * @param {string} presetName - 预设名称
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}
   */
  async addSubtitlesWithPreset(
    inputPath,
    subtitlePath,
    outputPath,
    presetName,
    onProgress = null
  ) {
    return this.invoke(
      'video:addSubtitlesWithPreset',
      { inputPath, subtitlePath, outputPath, presetName },
      onProgress
    );
  }

  /**
   * 视频格式转换
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 转换选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}
   */
  async convertVideo(inputPath, outputPath, options = {}, onProgress = null) {
    return this.invoke(
      'video:convert',
      { inputPath, outputPath, options },
      onProgress
    );
  }

  /**
   * 裁剪视频
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 裁剪选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}
   */
  async trimVideo(inputPath, outputPath, options = {}, onProgress = null) {
    return this.invoke('video:trim', { inputPath, outputPath, options }, onProgress);
  }

  /**
   * 压缩视频
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 压缩选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}
   */
  async compressVideo(inputPath, outputPath, options = {}, onProgress = null) {
    return this.invoke(
      'video:compress',
      { inputPath, outputPath, options },
      onProgress
    );
  }

  /**
   * 生成缩略图
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async generateThumbnail(inputPath, outputPath, options = {}) {
    return this.invoke('video:generateThumbnail', { inputPath, outputPath, options });
  }

  /**
   * 合并视频
   * @param {Array<string>} videoPaths - 视频路径列表
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 合并选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}
   */
  async mergeVideos(videoPaths, outputPath, options = {}, onProgress = null) {
    return this.invoke(
      'video:merge',
      { videoPaths, outputPath, options },
      onProgress
    );
  }
}

// 创建单例实例
const multimediaAPI = new MultimediaAPI();

export default multimediaAPI;

// 也导出类供需要的场景使用
export { MultimediaAPI };
