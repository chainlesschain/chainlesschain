/**
 * 音频处理器
 *
 * 负责音频格式转换、预处理、元数据提取等
 * 使用 FFmpeg 进行音频处理
 */

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;
const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

/**
 * 音频处理配置
 */
const DEFAULT_CONFIG = {
  // Whisper 最佳格式
  whisperFormat: {
    codec: 'pcm_s16le',
    format: 'wav',
    sampleRate: 16000,
    channels: 1,
  },

  // 支持的输入格式
  supportedFormats: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'webm', 'mp4', 'avi', 'mov'],

  // 临时文件目录
  tempDir: os.tmpdir(),
};

/**
 * 音频处理器类
 */
class AudioProcessor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 检查 FFmpeg 是否可用
   */
  async checkFFmpeg() {
    return new Promise((resolve) => {
      ffmpeg.getAvailableFormats((err, formats) => {
        if (err) {
          console.error('[AudioProcessor] FFmpeg 不可用:', err);
          resolve(false);
        } else {
          console.log('[AudioProcessor] FFmpeg 可用');
          resolve(true);
        }
      });
    });
  }

  /**
   * 获取音频元数据
   * @param {string} audioPath - 音频文件路径
   * @returns {Promise<Object>} 元数据
   */
  async getMetadata(audioPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) {
          console.error('[AudioProcessor] 获取元数据失败:', err);
          reject(err);
          return;
        }

        try {
          const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

          if (!audioStream) {
            reject(new Error('未找到音频流'));
            return;
          }

          const result = {
            // 基本信息
            duration: metadata.format.duration || 0,
            size: metadata.format.size || 0,
            bitrate: metadata.format.bit_rate || 0,
            format: metadata.format.format_name || '',

            // 音频流信息
            codec: audioStream.codec_name || '',
            sampleRate: audioStream.sample_rate || 0,
            channels: audioStream.channels || 0,
            channelLayout: audioStream.channel_layout || '',
            bitDepth: audioStream.bits_per_sample || 0,

            // 完整元数据（用于调试）
            raw: metadata,
          };

          resolve(result);
        } catch (error) {
          console.error('[AudioProcessor] 解析元数据失败:', error);
          reject(error);
        }
      });
    });
  }

  /**
   * 转换为 Whisper 最佳格式
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径（可选）
   * @returns {Promise<Object>} 处理结果
   */
  async convertToWhisperFormat(inputPath, outputPath = null) {
    try {
      this.emit('convert-start', { inputPath });

      // 如果未指定输出路径，使用临时目录
      const output = outputPath || path.join(
        this.config.tempDir,
        `whisper_${uuidv4()}.wav`
      );

      // 获取原始元数据
      const originalMeta = await this.getMetadata(inputPath);

      return new Promise((resolve, reject) => {
        const command = ffmpeg(inputPath);

        // 设置音频参数
        command
          .audioChannels(this.config.whisperFormat.channels)       // 单声道
          .audioFrequency(this.config.whisperFormat.sampleRate)    // 16kHz
          .audioCodec(this.config.whisperFormat.codec)             // PCM 16-bit
          .format(this.config.whisperFormat.format);               // WAV

        // 进度监听
        command.on('progress', (progress) => {
          this.emit('convert-progress', {
            inputPath,
            outputPath: output,
            percent: progress.percent || 0,
            currentTime: progress.timemark,
          });
        });

        // 完成监听
        command.on('end', async () => {
          try {
            // 获取输出文件信息
            const stats = await fs.stat(output);
            const outputMeta = await this.getMetadata(output);

            const result = {
              success: true,
              inputPath: inputPath,
              outputPath: output,
              originalSize: originalMeta.size,
              convertedSize: stats.size,
              originalDuration: originalMeta.duration,
              convertedDuration: outputMeta.duration,
              originalFormat: originalMeta.format,
              convertedFormat: outputMeta.format,
              sampleRate: outputMeta.sampleRate,
              channels: outputMeta.channels,
            };

            this.emit('convert-complete', result);
            resolve(result);
          } catch (error) {
            console.error('[AudioProcessor] 获取转换结果失败:', error);
            reject(error);
          }
        });

        // 错误监听
        command.on('error', (error) => {
          console.error('[AudioProcessor] 转换失败:', error);
          this.emit('convert-error', { inputPath, error });
          reject(error);
        });

        // 执行转换
        command.save(output);
      });
    } catch (error) {
      console.error('[AudioProcessor] 转换准备失败:', error);
      this.emit('convert-error', { inputPath, error });
      throw error;
    }
  }

  /**
   * 音量归一化
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @returns {Promise<Object>}
   */
  async normalizeVolume(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      this.emit('normalize-start', { inputPath });

      ffmpeg(inputPath)
        .audioFilters('loudnorm')  // 响度归一化滤镜
        .on('progress', (progress) => {
          this.emit('normalize-progress', {
            inputPath,
            percent: progress.percent || 0,
          });
        })
        .on('end', () => {
          this.emit('normalize-complete', { inputPath, outputPath });
          resolve({ success: true, outputPath });
        })
        .on('error', (error) => {
          console.error('[AudioProcessor] 归一化失败:', error);
          this.emit('normalize-error', { inputPath, error });
          reject(error);
        })
        .save(outputPath);
    });
  }

  /**
   * 去除静音
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async trimSilence(inputPath, outputPath, options = {}) {
    const {
      threshold = '-50dB',    // 静音阈值
      duration = '0.5',       // 静音持续时间
    } = options;

    return new Promise((resolve, reject) => {
      this.emit('trim-start', { inputPath });

      ffmpeg(inputPath)
        .audioFilters(`silenceremove=start_periods=1:start_duration=${duration}:start_threshold=${threshold}`)
        .on('progress', (progress) => {
          this.emit('trim-progress', {
            inputPath,
            percent: progress.percent || 0,
          });
        })
        .on('end', () => {
          this.emit('trim-complete', { inputPath, outputPath });
          resolve({ success: true, outputPath });
        })
        .on('error', (error) => {
          console.error('[AudioProcessor] 去除静音失败:', error);
          this.emit('trim-error', { inputPath, error });
          reject(error);
        })
        .save(outputPath);
    });
  }

  /**
   * 提取音频（从视频文件）
   * @param {string} videoPath - 视频文件路径
   * @param {string} outputPath - 输出音频路径
   * @returns {Promise<Object>}
   */
  async extractAudio(videoPath, outputPath) {
    return new Promise((resolve, reject) => {
      this.emit('extract-start', { videoPath });

      ffmpeg(videoPath)
        .noVideo()           // 不包含视频流
        .audioCodec('libmp3lame')  // MP3 编码
        .on('progress', (progress) => {
          this.emit('extract-progress', {
            videoPath,
            percent: progress.percent || 0,
          });
        })
        .on('end', () => {
          this.emit('extract-complete', { videoPath, outputPath });
          resolve({ success: true, outputPath });
        })
        .on('error', (error) => {
          console.error('[AudioProcessor] 提取音频失败:', error);
          this.emit('extract-error', { videoPath, error });
          reject(error);
        })
        .save(outputPath);
    });
  }

  /**
   * 音频分段
   * @param {string} inputPath - 输入文件路径
   * @param {number} segmentDuration - 段长度（秒）
   * @param {string} outputDir - 输出目录
   * @returns {Promise<Array>} 分段文件列表
   */
  async segmentAudio(inputPath, segmentDuration = 300, outputDir = null) {
    try {
      this.emit('segment-start', { inputPath, segmentDuration });

      // 获取音频时长
      const metadata = await this.getMetadata(inputPath);
      const totalDuration = metadata.duration;

      if (totalDuration <= segmentDuration) {
        // 不需要分段
        return [inputPath];
      }

      const segments = [];
      const outputDirectory = outputDir || path.join(this.config.tempDir, `segments_${uuidv4()}`);

      // 创建输出目录
      await fs.mkdir(outputDirectory, { recursive: true });

      const numSegments = Math.ceil(totalDuration / segmentDuration);

      for (let i = 0; i < numSegments; i++) {
        const startTime = i * segmentDuration;
        const outputPath = path.join(outputDirectory, `segment_${i}.wav`);

        await this.extractSegment(inputPath, outputPath, startTime, segmentDuration);
        segments.push(outputPath);

        this.emit('segment-progress', {
          inputPath,
          current: i + 1,
          total: numSegments,
          percent: Math.round(((i + 1) / numSegments) * 100),
        });
      }

      this.emit('segment-complete', {
        inputPath,
        segments: segments,
        count: segments.length,
      });

      return segments;
    } catch (error) {
      console.error('[AudioProcessor] 分段失败:', error);
      this.emit('segment-error', { inputPath, error });
      throw error;
    }
  }

  /**
   * 提取音频片段
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {number} startTime - 开始时间（秒）
   * @param {number} duration - 持续时间（秒）
   * @returns {Promise<Object>}
   */
  async extractSegment(inputPath, outputPath, startTime, duration) {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(startTime)
        .duration(duration)
        .audioChannels(this.config.whisperFormat.channels)
        .audioFrequency(this.config.whisperFormat.sampleRate)
        .audioCodec(this.config.whisperFormat.codec)
        .format(this.config.whisperFormat.format)
        .on('end', () => resolve({ success: true, outputPath }))
        .on('error', reject)
        .save(outputPath);
    });
  }

  /**
   * 检测是否包含语音
   * @param {string} audioPath - 音频文件路径
   * @returns {Promise<Object>} 检测结果
   */
  async detectSpeech(audioPath) {
    try {
      const metadata = await this.getMetadata(audioPath);

      // 简单启发式：检查时长和大小
      const hasSpeech = metadata.duration > 0.5 && metadata.size > 1024;

      return {
        hasSpeech: hasSpeech,
        duration: metadata.duration,
        confidence: hasSpeech ? 0.8 : 0.2,  // 简单估计
      };
    } catch (error) {
      console.error('[AudioProcessor] 语音检测失败:', error);
      return {
        hasSpeech: false,
        duration: 0,
        confidence: 0,
        error: error.message,
      };
    }
  }

  /**
   * 批量处理音频
   * @param {Array} audioPaths - 音频文件路径列表
   * @param {string} operation - 操作类型
   * @param {Object} options - 操作选项
   * @returns {Promise<Array>} 处理结果列表
   */
  async batchProcess(audioPaths, operation = 'convert', options = {}) {
    const results = [];

    for (let i = 0; i < audioPaths.length; i++) {
      try {
        this.emit('batch-progress', {
          current: i + 1,
          total: audioPaths.length,
          percentage: Math.round(((i + 1) / audioPaths.length) * 100),
        });

        let result;
        switch (operation) {
          case 'convert':
            result = await this.convertToWhisperFormat(audioPaths[i]);
            break;
          case 'normalize':
            const outputPath = path.join(this.config.tempDir, `normalized_${uuidv4()}.wav`);
            result = await this.normalizeVolume(audioPaths[i], outputPath);
            break;
          case 'metadata':
            result = await this.getMetadata(audioPaths[i]);
            break;
          default:
            throw new Error(`未知操作: ${operation}`);
        }

        results.push({
          success: true,
          path: audioPaths[i],
          ...result,
        });
      } catch (error) {
        results.push({
          success: false,
          path: audioPaths[i],
          error: error.message,
        });
      }
    }

    this.emit('batch-complete', {
      total: audioPaths.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    });

    return results;
  }

  /**
   * 检查文件是否为支持的音频格式
   * @param {string} filePath - 文件路径
   * @returns {boolean}
   */
  isSupportedFormat(filePath) {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    return this.config.supportedFormats.includes(ext);
  }

  /**
   * 获取支持的格式列表
   * @returns {Array}
   */
  getSupportedFormats() {
    return [...this.config.supportedFormats];
  }

  /**
   * 更新配置
   * @param {Object} newConfig
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('[AudioProcessor] 配置已更新');
  }

  /**
   * 清理临时文件
   * @param {Array} filePaths - 文件路径列表
   */
  async cleanupTempFiles(filePaths) {
    const errors = [];

    for (const filePath of filePaths) {
      try {
        await fs.unlink(filePath);
        console.log(`[AudioProcessor] 已删除临时文件: ${path.basename(filePath)}`);
      } catch (error) {
        console.warn(`[AudioProcessor] 删除临时文件失败: ${filePath}`, error);
        errors.push({ filePath, error: error.message });
      }
    }

    return {
      deleted: filePaths.length - errors.length,
      failed: errors.length,
      errors: errors,
    };
  }
}

module.exports = AudioProcessor;
