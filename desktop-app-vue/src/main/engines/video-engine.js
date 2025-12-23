/**
 * 视频处理引擎
 * 负责视频剪辑、格式转换、字幕生成和视频合并
 * 使用FFmpeg进行视频处理
 */

const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');

class VideoEngine extends EventEmitter {
  constructor(llmManager = null) {
    super();
    this.llmManager = llmManager;

    // 支持的视频格式
    this.supportedFormats = ['mp4', 'avi', 'mov', 'mkv', 'flv', 'webm', 'wmv'];

    // 支持的字幕格式
    this.supportedSubtitleFormats = ['srt', 'ass', 'vtt'];

    // 预设配置
    this.presets = {
      '1080p': {
        width: 1920,
        height: 1080,
        videoBitrate: '5000k',
        audioBitrate: '192k'
      },
      '720p': {
        width: 1280,
        height: 720,
        videoBitrate: '2500k',
        audioBitrate: '128k'
      },
      '480p': {
        width: 854,
        height: 480,
        videoBitrate: '1000k',
        audioBitrate: '96k'
      }
    };
  }

  /**
   * 处理项目任务
   * @param {Object} params - 任务参数
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   */
  async handleProjectTask(params, onProgress = null) {
    const { taskType, inputPath, outputPath, options = {} } = params;

    console.log('[Video Engine] 执行任务:', taskType);

    switch (taskType) {
      case 'convert':
        return await this.convertFormat(inputPath, outputPath, options, onProgress);

      case 'trim':
        return await this.trimVideo(inputPath, outputPath, options, onProgress);

      case 'merge':
        return await this.mergeVideos(params.videoList, outputPath, options, onProgress);

      case 'addSubtitles':
        return await this.addSubtitles(inputPath, params.subtitlePath, outputPath, options, onProgress);

      case 'extractAudio':
        return await this.extractAudio(inputPath, outputPath, options, onProgress);

      case 'generateThumbnail':
        return await this.generateThumbnail(inputPath, outputPath, options);

      case 'compress':
        return await this.compressVideo(inputPath, outputPath, options, onProgress);

      case 'generateSubtitles':
        return await this.generateSubtitlesWithAI(inputPath, outputPath, options, onProgress);

      default:
        throw new Error(`不支持的任务类型: ${taskType}`);
    }
  }

  /**
   * 视频格式转换
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 转换选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 转换结果
   */
  async convertFormat(inputPath, outputPath, options = {}, onProgress = null) {
    const {
      format = 'mp4',
      videoBitrate = '2000k',
      audioBitrate = '128k',
      fps = null,
      codec = 'libx264'
    } = options;

    console.log(`[Video Engine] 转换格式: ${inputPath} -> ${outputPath}`);

    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .output(outputPath)
        .videoCodec(codec)
        .videoBitrate(videoBitrate)
        .audioBitrate(audioBitrate)
        .format(format);

      if (fps) {
        command.fps(fps);
      }

      // 进度监听
      if (onProgress) {
        command.on('progress', (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在转换视频: ${Math.round(percent)}%`
          });
        });
      }

      command
        .on('end', () => {
          console.log('[Video Engine] 格式转换完成');
          resolve({
            success: true,
            outputPath: outputPath,
            format: format
          });
        })
        .on('error', (error) => {
          console.error('[Video Engine] 格式转换失败:', error);
          reject(error);
        })
        .run();
    });
  }

  /**
   * 视频剪辑
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 剪辑选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 剪辑结果
   */
  async trimVideo(inputPath, outputPath, options = {}, onProgress = null) {
    const {
      startTime = '00:00:00',
      duration = null,
      endTime = null
    } = options;

    console.log(`[Video Engine] 剪辑视频: ${startTime} ~ ${endTime || duration}`);

    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .output(outputPath)
        .setStartTime(startTime);

      if (duration) {
        command.setDuration(duration);
      } else if (endTime) {
        command.inputOptions([`-to ${endTime}`]);
      }

      if (onProgress) {
        command.on('progress', (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在剪辑视频: ${Math.round(percent)}%`
          });
        });
      }

      command
        .on('end', () => {
          console.log('[Video Engine] 视频剪辑完成');
          resolve({
            success: true,
            outputPath: outputPath,
            startTime: startTime,
            duration: duration
          });
        })
        .on('error', (error) => {
          console.error('[Video Engine] 视频剪辑失败:', error);
          reject(error);
        })
        .run();
    });
  }

  /**
   * 合并多个视频
   * @param {Array<string>} videoList - 视频文件路径列表
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 合并选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 合并结果
   */
  async mergeVideos(videoList, outputPath, options = {}, onProgress = null) {
    const { transition = 'concat' } = options;

    console.log(`[Video Engine] 合并 ${videoList.length} 个视频文件`);

    // 创建临时文件列表
    const listFilePath = path.join(path.dirname(outputPath), 'concat_list.txt');
    const listContent = videoList.map(video => `file '${video}'`).join('\n');
    await fs.writeFile(listFilePath, listContent, 'utf-8');

    return new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(listFilePath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions('-c copy')
        .output(outputPath);

      if (onProgress) {
        command.on('progress', (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在合并视频: ${Math.round(percent)}%`
          });
        });
      }

      command
        .on('end', async () => {
          // 删除临时文件
          try {
            await fs.unlink(listFilePath);
          } catch (error) {
            console.warn('[Video Engine] 删除临时文件失败:', error);
          }

          console.log('[Video Engine] 视频合并完成');
          resolve({
            success: true,
            outputPath: outputPath,
            videoCount: videoList.length
          });
        })
        .on('error', async (error) => {
          // 删除临时文件
          try {
            await fs.unlink(listFilePath);
          } catch (err) {
            console.warn('[Video Engine] 删除临时文件失败:', err);
          }

          console.error('[Video Engine] 视频合并失败:', error);
          reject(error);
        })
        .run();
    });
  }

  /**
   * 添加字幕
   * @param {string} inputPath - 输入视频路径
   * @param {string} subtitlePath - 字幕文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   */
  async addSubtitles(inputPath, subtitlePath, outputPath, options = {}, onProgress = null) {
    const {
      fontName = 'Arial',
      fontSize = 24,
      fontColor = 'white',
      position = 'bottom'
    } = options;

    console.log(`[Video Engine] 添加字幕: ${subtitlePath}`);

    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .output(outputPath)
        .videoFilters([
          {
            filter: 'subtitles',
            options: {
              filename: subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:'),
              force_style: `FontName=${fontName},FontSize=${fontSize},PrimaryColour=&H${fontColor}`
            }
          }
        ]);

      if (onProgress) {
        command.on('progress', (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在添加字幕: ${Math.round(percent)}%`
          });
        });
      }

      command
        .on('end', () => {
          console.log('[Video Engine] 字幕添加完成');
          resolve({
            success: true,
            outputPath: outputPath
          });
        })
        .on('error', (error) => {
          console.error('[Video Engine] 字幕添加失败:', error);
          reject(error);
        })
        .run();
    });
  }

  /**
   * 提取音频
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputPath - 输出音频路径
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 提取结果
   */
  async extractAudio(inputPath, outputPath, options = {}, onProgress = null) {
    const {
      format = 'mp3',
      bitrate = '192k',
      channels = 2
    } = options;

    console.log(`[Video Engine] 提取音频: ${inputPath}`);

    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .output(outputPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate(bitrate)
        .audioChannels(channels)
        .format(format);

      if (onProgress) {
        command.on('progress', (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在提取音频: ${Math.round(percent)}%`
          });
        });
      }

      command
        .on('end', () => {
          console.log('[Video Engine] 音频提取完成');
          resolve({
            success: true,
            outputPath: outputPath,
            format: format
          });
        })
        .on('error', (error) => {
          console.error('[Video Engine] 音频提取失败:', error);
          reject(error);
        })
        .run();
    });
  }

  /**
   * 生成缩略图
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputPath - 输出图片路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 生成结果
   */
  async generateThumbnail(inputPath, outputPath, options = {}) {
    const {
      timeOffset = '00:00:01',
      size = '320x240'
    } = options;

    console.log(`[Video Engine] 生成缩略图: ${inputPath}`);

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .screenshots({
          timestamps: [timeOffset],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: size
        })
        .on('end', () => {
          console.log('[Video Engine] 缩略图生成完成');
          resolve({
            success: true,
            outputPath: outputPath
          });
        })
        .on('error', (error) => {
          console.error('[Video Engine] 缩略图生成失败:', error);
          reject(error);
        });
    });
  }

  /**
   * 压缩视频
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputPath - 输出视频路径
   * @param {Object} options - 压缩选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 压缩结果
   */
  async compressVideo(inputPath, outputPath, options = {}, onProgress = null) {
    const {
      preset = '720p',
      crf = 23 // 质量参数：0-51，值越小质量越好，文件越大
    } = options;

    const presetConfig = this.presets[preset] || this.presets['720p'];

    console.log(`[Video Engine] 压缩视频: ${preset} (CRF=${crf})`);

    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .output(outputPath)
        .videoCodec('libx264')
        .size(`${presetConfig.width}x${presetConfig.height}`)
        .outputOptions([
          `-crf ${crf}`,
          '-preset medium'
        ])
        .audioBitrate(presetConfig.audioBitrate);

      if (onProgress) {
        command.on('progress', (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在压缩视频: ${Math.round(percent)}%`
          });
        });
      }

      command
        .on('end', () => {
          console.log('[Video Engine] 视频压缩完成');
          resolve({
            success: true,
            outputPath: outputPath,
            preset: preset
          });
        })
        .on('error', (error) => {
          console.error('[Video Engine] 视频压缩失败:', error);
          reject(error);
        })
        .run();
    });
  }

  /**
   * 使用AI生成字幕
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputPath - 输出字幕路径
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 生成结果
   */
  async generateSubtitlesWithAI(inputPath, outputPath, options = {}, onProgress = null) {
    const { language = 'zh' } = options;

    console.log(`[Video Engine] 使用AI生成字幕 (语言: ${language})`);

    try {
      // 1. 提取音频
      if (onProgress) {
        onProgress({ percent: 10, message: '正在提取音频...' });
      }

      const audioPath = path.join(path.dirname(outputPath), 'temp_audio.mp3');
      await this.extractAudio(inputPath, audioPath, { format: 'mp3' });

      // 2. 使用LLM转录音频（如果有Whisper或类似服务）
      if (onProgress) {
        onProgress({ percent: 30, message: '正在转录音频...' });
      }

      // 注意：这里需要集成Whisper API或其他语音识别服务
      // 由于这是示例，我们使用LLM生成示例字幕
      const subtitles = await this.generateSubtitlesContent(audioPath, language);

      // 3. 保存字幕文件
      if (onProgress) {
        onProgress({ percent: 80, message: '正在保存字幕...' });
      }

      await fs.writeFile(outputPath, subtitles, 'utf-8');

      // 4. 清理临时文件
      try {
        await fs.unlink(audioPath);
      } catch (error) {
        console.warn('[Video Engine] 删除临时音频文件失败:', error);
      }

      if (onProgress) {
        onProgress({ percent: 100, message: '字幕生成完成' });
      }

      console.log('[Video Engine] AI字幕生成完成');
      return {
        success: true,
        outputPath: outputPath,
        language: language
      };

    } catch (error) {
      console.error('[Video Engine] AI字幕生成失败:', error);
      throw error;
    }
  }

  /**
   * 生成字幕内容（示例实现）
   * @param {string} audioPath - 音频文件路径
   * @param {string} language - 语言
   * @returns {Promise<string>} SRT格式字幕
   */
  async generateSubtitlesContent(audioPath, language) {
    // 这里应该调用Whisper API或其他语音识别服务
    // 作为示例，我们返回一个简单的SRT格式字幕
    const srtContent = `1
00:00:00,000 --> 00:00:05,000
欢迎观看视频

2
00:00:05,000 --> 00:00:10,000
这是自动生成的字幕

3
00:00:10,000 --> 00:00:15,000
您可以根据需要进行编辑
`;

    return srtContent;
  }

  /**
   * 获取视频信息
   * @param {string} videoPath - 视频文件路径
   * @returns {Promise<Object>} 视频信息
   */
  async getVideoInfo(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (error, metadata) => {
        if (error) {
          console.error('[Video Engine] 获取视频信息失败:', error);
          reject(error);
        } else {
          const videoStream = metadata.streams.find(s => s.codec_type === 'video');
          const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

          resolve({
            duration: metadata.format.duration,
            size: metadata.format.size,
            bitrate: metadata.format.bit_rate,
            format: metadata.format.format_name,
            video: videoStream ? {
              codec: videoStream.codec_name,
              width: videoStream.width,
              height: videoStream.height,
              fps: eval(videoStream.r_frame_rate)
            } : null,
            audio: audioStream ? {
              codec: audioStream.codec_name,
              sampleRate: audioStream.sample_rate,
              channels: audioStream.channels
            } : null
          });
        }
      });
    });
  }
}

// 单例模式
let videoEngine = null;

/**
 * 获取视频引擎实例
 * @param {Object} llmManager - LLM管理器
 * @returns {VideoEngine}
 */
function getVideoEngine(llmManager = null) {
  if (!videoEngine) {
    videoEngine = new VideoEngine(llmManager);
  } else if (llmManager && !videoEngine.llmManager) {
    videoEngine.llmManager = llmManager;
  }
  return videoEngine;
}

module.exports = {
  VideoEngine,
  getVideoEngine
};
